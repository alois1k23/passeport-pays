// En HTTPS, la session utilise le préfixe __Host- ; un cookie de session sans préfixe (posé par un tiers) est ignoré.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('cookie de session __Host- en HTTPS', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: 'https://comptoir.exemple', journal: { log() {}, error() {} } }));
  try {
    const r = await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://comptoir.exemple' }, body: JSON.stringify({ email: 'hc@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Hote', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'H', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [] }) });
    assert.equal(r.status, 201, await r.text());
    const sc = r.headers.getSetCookie().find(c => c.startsWith('__Host-comptoir_session='));
    assert.ok(sc, r.headers.getSetCookie().join(' | ')); assert.match(sc, /; Secure/); assert.match(sc, /Path=\//); assert.doesNotMatch(sc, /Domain=/i);
    const jeton = sc.split(';')[0].split('=')[1];
    const etat = cookie => fetch(base + '/api/admin/etat', { headers: { Cookie: cookie } }).then(x => x.status);
    assert.equal(await etat(`__Host-comptoir_session=${jeton}`), 200);
    assert.equal(await etat(`comptoir_session=${jeton}`), 401, 'cookie sans préfixe ignoré en HTTPS');
    assert.equal(await etat(`comptoir_session=${jeton}; __Host-comptoir_session=autre`), 401, 'le cookie __Host- prime');
  } finally { s.close(); }
});
