// Notifications push : vecteur de test de la RFC 8291, abonnement, envoi chiffré à chaque commande payée, VAPID signé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const W = require('../src/webpush');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('chiffrement conforme au vecteur de test de la RFC 8291', () => {
  const corps = W.chiffrer(Buffer.from('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24', 'base64url'), { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { sel: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), expediteur: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' });
  assert.equal(W.b64u(corps), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  assert.equal(W.endpointValide('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(W.endpointValide('https://169.254.169.254/latest'), false, 'adresse interne refusée');
  assert.equal(W.endpointValide('http://fcm.googleapis.com/x'), false);
});

// Déchiffrement côté « téléphone » (RFC 8291, rôle de l'agent utilisateur)
function dechiffrer(corps, ua, auth) {
  const sel = corps.subarray(0, 16), idlen = corps[20], asPub = corps.subarray(21, 21 + idlen), chiffre = corps.subarray(21 + idlen);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(chiffre.subarray(-16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, -16)), d.final()]);
  return JSON.parse(clair.subarray(0, clair.lastIndexOf(2)).toString());
}

test('commande payée : notification push chiffrée vers l’appareil du marchand', async () => {
  const recus = [];
  const fetchImpl = async (url, o) => { if (String(url).startsWith('https://fcm.googleapis.com/')) { recus.push({ url, o }); return new Response(null, { status: 201 }); } return fetch(url, o); };
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, fetchImpl, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'push@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Push', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'P', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 9, type: 'stock' }] });
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
    const { cle } = (await c('GET', '/api/admin/push')).j;
    assert.equal(Buffer.from(cle, 'base64url').length, 65, 'clé VAPID publique P-256');
    assert.equal((await c('POST', '/api/admin/push/abonner', { abonnement: { endpoint: 'https://evil.example/hook', keys: { p256dh: W.b64u(ua.getPublicKey()), auth: W.b64u(auth) } } })).s, 400, 'service push inconnu refusé');
    assert.equal((await c('POST', '/api/admin/push/abonner', { abonnement: { endpoint: 'https://fcm.googleapis.com/fcm/send/appareil1', keys: { p256dh: W.b64u(ua.getPublicKey()), auth: W.b64u(auth) } } })).s, 200);
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    const cmd = await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A B', email: 'ab@x.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json());
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const t0 = Date.now(); while (!recus.length && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 30));
    assert.equal(recus.length, 1);
    const { o } = recus[0];
    assert.equal(o.headers['Content-Encoding'], 'aes128gcm'); assert.ok(Number(o.headers.TTL) > 0);
    // VAPID : JWT ES256 vérifiable avec la clé publique, pour l'origine du service push
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(o.headers.Authorization);
    const [h, p, sig] = jwt.split('.');
    const pubBuf = Buffer.from(k, 'base64url');
    const cleV = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: W.b64u(pubBuf.subarray(1, 33)), y: W.b64u(pubBuf.subarray(33)) }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: cleV, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'signature VAPID valide');
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');
    // Le « téléphone » déchiffre le message
    const msg = dechiffrer(Buffer.from(o.body), ua, auth);
    assert.equal(msg.titre, `Nouvelle commande n° ${cmd.numero}`); assert.match(msg.texte, /CHF 47\.00 · Lausanne/);
    // Abonnement expiré (410) : supprimé
    const fetch410 = async () => new Response(null, { status: 410 });
    assert.equal(await W.envoyer({ endpoint: 'https://fcm.googleapis.com/x', p256dh: W.b64u(ua.getPublicKey()), auth: W.b64u(auth) }, { t: 1 }, { ...JSON.parse(db.prepare("SELECT valeur FROM cles WHERE nom = 'vapid'").get().valeur), sujet: 'mailto:a@b.ch' }, { fetchImpl: fetch410 }), 410);
  } finally { s.close(); }
});
