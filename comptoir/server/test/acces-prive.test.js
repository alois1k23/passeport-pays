// Aperçu privé (ACCES_PRIVE) : tout le site demande le mot de passe, rien n'est indexé ; les webhooks restent ouverts.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('aperçu privé : mot de passe exigé partout, noindex, webhooks ouverts, sans variable rien ne change', async () => {
  assert.throws(() => creerApp({ db: ouvrir(':memory:'), env: { ACCES_PRIVE: 'court' }, urlPublique: 'http://x', journal: { log() {}, error() {} } }), /12 caractères/);
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { ACCES_PRIVE: 'un aperçu bien secret', LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  try {
    for (const chemin of ['/', '/app', '/s/une-boutique', '/js/app.js']) {
      const r = await fetch(base + chemin, { redirect: 'manual' });
      assert.equal(r.status, 401, chemin); assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.match(await r.text(), /Aperçu privé/);
    }
    const api = await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(api.status, 401); assert.equal((await api.json()).code, 'apercu_prive');
    assert.match(await (await fetch(base + '/robots.txt')).text(), /Disallow: \//);
    // Webhook Stripe : pas bloqué par l'aperçu (sa propre signature est contrôlée ensuite).
    assert.notEqual((await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    // Mauvais mot de passe, puis le bon : cookie, redirection vers la page demandée (jamais vers un autre site).
    const faux = await fetch(base + '/acces-prive', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'mot=non&retour=%2Fapp', redirect: 'manual' });
    assert.equal(faux.status, 401); assert.equal(faux.headers.get('set-cookie'), null);
    const bon = await fetch(base + '/acces-prive', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `mot=${encodeURIComponent('un aperçu bien secret')}&retour=%2Fapp`, redirect: 'manual' });
    assert.equal(bon.status, 303); assert.equal(bon.headers.get('location'), '/app');
    const cookie = bon.headers.get('set-cookie').split(';')[0]; assert.match(bon.headers.get('set-cookie'), /HttpOnly/);
    const ext = await fetch(base + '/acces-prive', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `mot=${encodeURIComponent('un aperçu bien secret')}&retour=${encodeURIComponent('//mechant.example')}`, redirect: 'manual' });
    assert.equal(ext.headers.get('location'), '/', 'pas de redirection vers un autre site');
    const app = await fetch(base + '/app', { headers: { Cookie: cookie } });
    assert.equal(app.status, 200); assert.equal(app.headers.get('x-robots-tag'), 'noindex, nofollow', 'jamais indexé, même connecté');
    assert.equal((await fetch(base + '/app', { headers: { Cookie: 'comptoir_apercu=faux' } })).status, 401);
  } finally { s.close(); }
  // Sans la variable : site ouvert comme avant.
  const s2 = http.createServer(); await new Promise(ok => s2.listen(0, '127.0.0.1', ok));
  s2.on('request', creerApp({ db: ouvrir(':memory:'), env: { ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: `http://127.0.0.1:${s2.address().port}`, journal: { log() {}, error() {} } }));
  try { const r = await fetch(`http://127.0.0.1:${s2.address().port}/app`); assert.equal(r.status, 200); assert.equal(r.headers.get('x-robots-tag'), null); } finally { s2.close(); }
});
