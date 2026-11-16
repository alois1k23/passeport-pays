// Prix à l'unité de mesure : calcul, validation de la contenance, flux Google (unit_pricing_*).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const U = require('../../js/unites.js');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('prix unitaire : bases de référence', () => {
  assert.deepEqual(U.prixUnitaire(4.2, 250, 'g'), { prix: 1.68, base: '100 g', qte: 100, unite: 'g' });
  assert.equal(U.prixUnitaire(12, 1000, 'g').base, 'kg');
  assert.equal(U.prixUnitaire(3.5, 75, 'cl').prix, 4.67);
  assert.equal(U.prixUnitaire(9, 6, 'piece').prix, 1.5);
  assert.equal(U.prixUnitaire(9, 1, 'piece'), null, 'une seule pièce : pas de prix unitaire');
  assert.equal(U.prixUnitaire(9, 0, 'g'), null); assert.equal(U.prixUnitaire(9, 10, 'tonne'), null);
  assert.equal(U.libelle(1.5, 'l'), '1,5 l'); assert.equal(U.libelle(6, 'piece'), '6 pièces');
});

test('contenance : validée, transmise au flux', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', FLUX_MEMO_MS: '0' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'u@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Épicerie', pays: 'ch' } } });
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'X', prix: 4, stock: 2, contenance: 250, unite: 'tonne' } })).j.code, 'contenance_invalide');
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'X', prix: 4, stock: 2, contenance: -1, unite: 'g' } })).j.code, 'contenance_invalide');
    const id = (await c('POST', '/api/admin/produits', { produit: { nom: 'Café moulu', prix: 4.2, stock: 2, contenance: 250, unite: 'g' } })).j.id;
    const e = (await c('GET', '/api/admin/etat')).j;
    assert.deepEqual([e.produits.find(p => p.id === id).contenance, e.produits.find(p => p.id === id).unite], [250, 'g']);
    const xml = await (await fetch(`${base}/s/${e.serveur.slug}/produits.xml`)).text();
    assert.match(xml, /<g:unit_pricing_measure>250g<\/g:unit_pricing_measure><g:unit_pricing_base_measure>100g<\/g:unit_pricing_base_measure>/);
  } finally { s.close(); }
});
