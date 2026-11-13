// Clés d'API limitées : date d'expiration et adresses IP autorisées (une clé volée ne sert ni après, ni ailleurs).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('clé d’API : expiration et réseaux autorisés', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, entetes = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...entetes }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'lim@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Lim', pays: 'ch' } } });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'croissance' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    // Saisies refusées : durée hors liste, réseau invalide ou trop large, plus de 10 réseaux.
    for (const [corps, code] of [[{ expireJours: 7 }, 'expiration'], [{ reseaux: '203.0.113.300' }, 'reseaux'], [{ reseaux: '10.0.0.0/4' }, 'reseaux'], [{ reseaux: 'evil.example' }, 'reseaux'], [{ reseaux: Array.from({ length: 11 }, (_, k) => `203.0.113.${k}`).join(',') }, 'reseaux']])
      assert.equal((await c('POST', '/api/admin/integrations/cles', { nom: 'X', portees: ['produits:lecture'], ...corps })).j.code, code, JSON.stringify(corps));
    const k = await c('POST', '/api/admin/integrations/cles', { nom: 'Entrepôt', portees: ['produits:lecture'], expireJours: '90', reseaux: '203.0.113.0/24, 2001:db8::/48, 2001:db8:5:5::1' });
    assert.equal(k.s, 201); assert.deepEqual(k.j.reseaux, ['203.0.113.0/24', '2001:db8::/48', '2001:db8:5:5::1/64'], 'IPv6 bornée au /64');
    const cle = ip => ({ Authorization: `Bearer ${k.j.cle}`, 'X-Forwarded-For': ip });
    { const r = await c('GET', '/api/v1/produits', null, cle('203.0.113.45')); assert.equal(r.s, 200, JSON.stringify(r.j)); }
    assert.equal((await c('GET', '/api/v1/produits', null, cle('2001:db8:0:1::5'))).s, 200, 'IPv6 autorisée');
    assert.equal((await c('GET', '/api/v1/produits', null, cle('2001:db8:5:5::abcd'))).s, 200, 'même réseau /64');
    const ailleurs = await c('GET', '/api/v1/produits', null, cle('198.51.100.9'));
    assert.equal(ailleurs.s, 403); assert.equal(ailleurs.j.code, 'reseau_refuse');
    // Liste : validité et réseaux affichés.
    const liste = (await c('GET', '/api/admin/integrations')).j.cles[0];
    assert.ok(liste.expire_le > Date.now() + 89 * 86400000); assert.equal(liste.expiree, false); assert.deepEqual(liste.reseaux, ['203.0.113.0/24', '2001:db8::/48', '2001:db8:5:5::1/64']);
    // Expirée : refusée, et le bilan de sécurité le signale.
    db.prepare('UPDATE cles_api SET expire_le = ?').run(Date.now() - 1000);
    const exp = await c('GET', '/api/v1/produits', null, cle('203.0.113.45'));
    assert.equal(exp.s, 401); assert.equal(exp.j.code, 'cle_expiree');
    const bilan = JSON.stringify((await c('GET', '/api/admin/compte/securite')).j);
    assert.match(bilan, /Clés d’API à renouveler/); assert.match(bilan, /« Entrepôt » a expiré/);
    // Clé sans aucune limite : acceptée (compatibilité), mais signalée.
    const libre = await c('POST', '/api/admin/integrations/cles', { nom: 'Libre', portees: ['produits:lecture'], expireJours: 'jamais' });
    assert.equal((await c('GET', '/api/v1/produits', null, { Authorization: `Bearer ${libre.j.cle}`, 'X-Forwarded-For': '198.51.100.9' })).s, 200);
    assert.match(JSON.stringify((await c('GET', '/api/admin/compte/securite')).j), /1 clé d’API sans date d’expiration ni adresse IP autorisée/);
  } finally { s.close(); }
});
