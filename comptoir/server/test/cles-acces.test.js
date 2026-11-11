// Clés d'accès (passkeys, WebAuthn) : un authentificateur logiciel (clé P-256) joue le rôle du téléphone.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const W = require('../src/webauthn');

// Encodeur CBOR minimal (pour fabriquer les réponses de l'authentificateur)
function cbor(v) {
  const tete = (type, n) => n < 24 ? Buffer.from([(type << 5) | n]) : n < 256 ? Buffer.from([(type << 5) | 24, n]) : Buffer.from([(type << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([tete(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([tete(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('type');
}
function authentificateur(origine, rpId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }), credId = crypto.randomBytes(16);
  let compteur = 0;
  const authData = (avecCle, drapeaux = 0x05) => {
    const base = Buffer.concat([crypto.createHash('sha256').update(rpId).digest(), Buffer.from([drapeaux | (avecCle ? 0x40 : 0)]), Buffer.from([0, 0, 0, ++compteur])]);
    if (!avecCle) return base;
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    return Buffer.concat([base, Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
  };
  const cd = (type, challenge, o = origine) => Buffer.from(JSON.stringify({ type, challenge, origin: o }));
  return {
    credId: credId.toString('base64url'),
    creer: (opt, { drapeaux } = {}) => ({ id: credId.toString('base64url'), clientDataJSON: W.b64u(cd('webauthn.create', opt.challenge)), attestationObject: W.b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(true, drapeaux)]]))) }),
    signer: (opt, { userHandle, origine: o, figerCompteur } = {}) => {
      if (figerCompteur) compteur = 0;   // compteur revenu en arrière : copie de la clé
      const ad = authData(false), c = cd('webauthn.get', opt.challenge, o);
      const sig = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(c).digest()]), { key: privateKey, dsaEncoding: 'der' });
      return { id: credId.toString('base64url'), clientDataJSON: W.b64u(c), authenticatorData: W.b64u(ad), signature: W.b64u(sig), userHandle };
    }
  };
}

test('CBOR : entrées piégées refusées sans planter', () => {
  assert.throws(() => W.decoderCbor(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff])), /tronqué/);
  assert.throws(() => W.decoderCbor(Buffer.from(Array(20).fill(0x81))), /profond/);
  assert.equal(W.decoderCbor(cbor(new Map([['a', 1]]))).valeur.get('a'), 1);
});

test('clés d’accès de bout en bout : enregistrement, connexion sans mot de passe, refus', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  try {
    const a = client();
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'cle@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Clé' } } })).s, 201);
    const tel = authentificateur(base, '127.0.0.1');
    assert.equal((await a('POST', '/api/admin/compte/cles-acces/options', { motDePasse: 'faux faux faux' })).s, 401, 'mot de passe exigé');
    const opt = (await a('POST', '/api/admin/compte/cles-acces/options', { motDePasse: 'un mot de passe solide' })).j.publicKey;
    assert.equal(opt.authenticatorSelection.userVerification, 'required');
    // Sans vérification de l'utilisateur (UV) : refusée
    const sansUv = await a('POST', '/api/admin/compte/cles-acces', { reponse: tel.creer(opt, { drapeaux: 0x01 }) });
    assert.equal(sansUv.s, 400);
    const opt2 = (await a('POST', '/api/admin/compte/cles-acces/options', { motDePasse: 'un mot de passe solide' })).j.publicKey;
    const ajout = await a('POST', '/api/admin/compte/cles-acces', { nom: 'iPhone', reponse: tel.creer(opt2) });
    assert.equal(ajout.s, 201, JSON.stringify(ajout.j));
    assert.equal((await a('POST', '/api/admin/compte/cles-acces', { reponse: tel.creer(opt2) })).s, 400, 'défi à usage unique');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE sujet LIKE 'Clé d’accès ajoutée%'").get(), 'marchand prévenu');
    // Connexion sans mot de passe, depuis un autre navigateur
    const b = client();
    const o = (await b('POST', '/api/auth/cle-acces/options')).j.publicKey;
    const cx = await b('POST', '/api/auth/cle-acces/connexion', { reponse: tel.signer(o) });
    assert.equal(cx.s, 200, JSON.stringify(cx.j));
    assert.equal((await b('GET', '/api/admin/etat')).s, 200, 'session ouverte');
    // Rejeu de la même réponse : refusé (défi consommé)
    const rejeu = tel.signer(o);
    assert.equal((await client()('POST', '/api/auth/cle-acces/connexion', { reponse: rejeu })).s, 400);
    // Autre site (hameçonnage) : refusé
    const o2 = (await b('POST', '/api/auth/cle-acces/options')).j.publicKey;
    assert.equal((await client()('POST', '/api/auth/cle-acces/connexion', { reponse: tel.signer(o2, { origine: 'https://comptoir-connexion.example' }) })).s, 401);
    // Signature d'une autre clé : refusée
    const pirate = authentificateur(base, '127.0.0.1');
    const o3 = (await b('POST', '/api/auth/cle-acces/options')).j.publicKey;
    const faux = { ...pirate.signer(o3), id: tel.credId };
    assert.equal((await client()('POST', '/api/auth/cle-acces/connexion', { reponse: faux })).s, 401);
    // Compteur qui ne progresse pas : clé clonée, refusée
    const o4 = (await b('POST', '/api/auth/cle-acces/options')).j.publicKey;
    assert.equal((await client()('POST', '/api/auth/cle-acces/connexion', { reponse: tel.signer(o4, { figerCompteur: true }) })).s, 401);
    // Liste et suppression (mot de passe exigé)
    const sec = await a('GET', '/api/admin/compte/securite');
    assert.equal(sec.j.clesAcces.length, 1); assert.equal(sec.j.clesAcces[0].nom, 'iPhone');
    assert.ok(sec.j.journal.some(x => x.type === 'cle-acces'));
    // Réinitialisation du mot de passe par e-mail : les clés d'accès sont retirées (une clé ajoutée par un tiers ne survit pas)
    const autreCle = authentificateur(base, '127.0.0.1');
    const o6 = (await a('POST', '/api/admin/compte/cles-acces/options', { motDePasse: 'un mot de passe solide' })).j.publicKey;
    assert.equal((await a('POST', '/api/admin/compte/cles-acces', { reponse: autreCle.creer(o6) })).s, 201);
    const crypto2 = require('node:crypto'), jeton = crypto2.randomBytes(16).toString('base64url');
    db.prepare('INSERT INTO reinitialisations (jeton_hash, marchand_id, expire_le) SELECT ?, id, ? FROM marchands').run(crypto2.createHash('sha256').update(jeton).digest('hex'), Date.now() + 3600000);
    assert.equal((await client()('POST', '/api/auth/reinitialiser', { jeton, motDePasse: 'un mot de passe solide' })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cles_acces').get().n, 0, 'clés d’accès retirées');
    const o7 = (await client()('POST', '/api/auth/cle-acces/options')).j.publicKey;
    assert.equal((await client()('POST', '/api/auth/cle-acces/connexion', { reponse: autreCle.signer(o7) })).s, 401);
    const o5 = (await b('POST', '/api/auth/cle-acces/options')).j.publicKey;
    assert.equal((await client()('POST', '/api/auth/cle-acces/connexion', { reponse: tel.signer(o5) })).s, 401, 'clé supprimée');
  } finally { s.close(); }
});
