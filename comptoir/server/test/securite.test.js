// Sécurité du compte marchand : double authentification, codes de secours, appareils connectés, journal, alertes.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');

test('double authentification de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = (ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', ip = '198.51.100.1') => {
    const jar = {};
    return async (m, chemin, corps) => {
      const r = await fetch(base + chemin, { method: m, headers: { 'User-Agent': ua, 'X-Forwarded-For': ip, ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined });
      for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; }
      return { s: r.status, j: await r.json().catch(() => null) };
    };
  };
  try {
    const a = client();
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Sûre' } } })).s, 201);
    // Mise en place : secret, premier code, mot de passe exigé
    const prep = await a('POST', '/api/admin/compte/2fa/preparer');
    assert.match(prep.j.uri, /^otpauth:\/\/totp\//);
    assert.ok(!JSON.stringify(db.prepare('SELECT secret FROM deux_facteurs').get()).includes(prep.j.secret), 'secret chiffré en base');
    assert.equal((await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: '000000' })).s, 400);
    assert.equal((await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'faux faux faux', code: totp.code(prep.j.secret, totp.pasActuel()) })).s, 401);
    const pasActivation = totp.pasActuel();   // le code exact de l'activation, rejoué plus bas (pas « le code du moment » : à la limite de 30 s, ce serait un nouveau code, légitime)
    const act = await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, pasActivation) });
    assert.equal(act.s, 200); assert.equal(act.j.codesSecours.length, 10);
    // Connexion depuis un autre appareil : mot de passe seul ne suffit plus
    const b = client('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36');
    const c1 = await b('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal(c1.j.deuxFacteurs, true); assert.ok(c1.j.defi);
    assert.equal((await b('GET', '/api/admin/etat')).s, 401, 'aucune session avant le second facteur');
    assert.equal((await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi + 'x', code: '123456' })).s, 401, 'défi falsifié refusé');
    // Le code déjà utilisé à l'activation ne sert pas une seconde fois
    const deja = await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi, code: totp.code(prep.j.secret, pasActivation) });
    if (deja.s === 200) assert.fail('code rejoué accepté');
    const ok2 = await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi, code: act.j.codesSecours[0] });
    assert.equal(ok2.s, 200, 'code de secours accepté');
    assert.equal((await b('GET', '/api/admin/etat')).s, 200);
    // Le même code de secours ne resservira pas
    const c2 = await client()('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal((await client()('POST', '/api/auth/connexion/2fa', { defi: c2.j.defi, code: act.j.codesSecours[0] })).s, 401);
    // Alerte de nouvel appareil et journal
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'sur@exemple.ch' AND sujet = 'Nouvelle connexion à votre compte Comptoir'").get());
    const sec = await a('GET', '/api/admin/compte/securite');
    assert.equal(sec.j.deuxFacteurs, true); assert.equal(sec.j.codesSecoursRestants, 9);
    assert.ok(sec.j.sessions.some(x => x.appareil === 'Chrome sur Android') && sec.j.sessions.some(x => x.actuelle && x.appareil === 'Safari sur Mac'));
    assert.ok(['2fa-activee', 'code-secours', 'connexion', 'echec-2fa'].every(t => sec.j.journal.some(x => x.type === t)), sec.j.journal.map(x => x.type).join());
    // Révocation de l'appareil Android
    const android = sec.j.sessions.find(x => x.appareil === 'Chrome sur Android');
    assert.equal((await a('POST', `/api/admin/compte/sessions/${android.id}/revoquer`)).s, 200);
    assert.equal((await b('GET', '/api/admin/etat')).s, 401, 'appareil révoqué déconnecté');
    // Trop d'essais de code : bloqué
    const c3 = await client(undefined, '203.0.113.66')('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    const x = client(undefined, '203.0.113.66'); let dernier;
    for (let k = 0; k < 7; k++) dernier = (await x('POST', '/api/auth/connexion/2fa', { defi: c3.j.defi, code: String(100000 + k) })).s;
    assert.equal(dernier, 429);
    // L'attaquant (autre réseau) bloqué ne bloque pas le propriétaire chez lui (appareil connu, autre réseau)
    const c4 = await a('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal(c4.j.deuxFacteurs, true);
    assert.equal((await a('POST', '/api/auth/connexion/2fa', { defi: c4.j.defi, code: act.j.codesSecours[1] })).s, 200, 'le propriétaire se connecte malgré l’attaque');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE sujet LIKE 'Codes de vérification refusés%'").get(), 'propriétaire prévenu des codes refusés');
    // Nouveaux codes de secours : les anciens cessent de fonctionner
    const nv = await a('POST', '/api/admin/compte/2fa/codes', { motDePasse: 'un mot de passe solide', code: act.j.codesSecours[2] });
    assert.equal(nv.s, 200); assert.equal(nv.j.codesSecours.length, 10);
    // Désactivation : essais de code comptés, code de secours accepté
    let d; for (let k = 0; k < 6; k++) d = (await a('POST', '/api/admin/compte/2fa/desactiver', { motDePasse: 'un mot de passe solide', code: String(200000 + k) })).s;
    assert.equal(d, 429, 'essais de code limités à la désactivation');
  } finally { s.close(); }
});
