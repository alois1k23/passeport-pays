// Codes-barres : chiffre de contrôle GS1, unicité dans la boutique, données structurées, import CSV.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Gtin = require('../../js/gtin.js');
const I = require('../../js/import-catalogue.js');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('chiffre de contrôle GS1', () => {
  for (const ok of ['4006381333931', '96385074', '036000291452', '4006-381 333931', '10012345678902']) assert.equal(Gtin.valide(ok), true, ok);
  for (const ko of ['4006381333932', '123', 'abcdefghijklm', '', null, '40063813339310000']) assert.equal(Gtin.valide(ko), false, String(ko));
});

test('import : code-barres valide gardé, invalide ou en double ignoré avec un avertissement', () => {
  const csv = 'Nom,Prix,EAN13\nTorchon,18,4006381333931\nNappe,60,4006381333932\nPlaid,90,4006381333931\n';
  const r = I.convertir(csv);
  assert.equal(r.produits.find(p => p.nom === 'Torchon').ean, '4006381333931');
  assert.equal(r.produits.find(p => p.nom === 'Nappe').ean, undefined);
  assert.equal(r.produits.find(p => p.nom === 'Plaid').ean, undefined);
  assert.equal(r.erreurs.filter(e => /code-barres/.test(e.message)).length, 2);
  const shop = 'Handle,Title,Variant Price,Variant Barcode\ncafe,Café,14,96385074\n';
  assert.equal(I.convertir(shop).produits[0].ean, '96385074');
});

test('code-barres : fiche, unicité, page produit', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'ean@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Épicerie', pays: 'ch' } } });
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Faux', prix: 5, stock: 3, ean: '4006381333932' } })).j.code, 'ean_invalide');
    const id = (await c('POST', '/api/admin/produits', { produit: { nom: 'Chocolat', prix: 5, stock: 3, ean: '4006 381 333931' } })).j.id;
    assert.equal((await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === id).ean, '4006381333931', 'espaces retirés');
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Autre', prix: 5, stock: 3, ean: '4006381333931' } })).j.code, 'ean_doublon');
    // Le même produit réenregistré garde son code ; un code vidé est retiré.
    assert.equal((await c('PUT', `/api/admin/produits/${id}`, { produit: { nom: 'Chocolat noir', prix: 5, stock: 3, ean: '4006381333931' } })).s, 200);
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const page = await (await fetch(`${base}/s/${slug}/p/${id}`)).text();
    assert.match(page, /"gtin13":"4006381333931"/);
    assert.equal((await c('PUT', `/api/admin/produits/${id}`, { produit: { nom: 'Chocolat noir', prix: 5, stock: 3, ean: '' } })).s, 200);
    assert.equal((await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === id).ean, undefined);
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Autre', prix: 5, stock: 3, ean: '4006381333931' } })).s, 201, 'code libéré');
    // Import d'un produit dont le code-barres est déjà dans la boutique : importé sans le code, avec un avertissement.
    const imp = await c('POST', '/api/admin/produits/importer-csv', { csv: 'Nom,Prix,EAN13\nBiscuit,4,4006381333931\n' });
    assert.equal(imp.s, 200, JSON.stringify(imp.j));
    assert.ok(JSON.stringify(imp.j).includes('code-barres déjà utilisé'));
    const bis = (await c('GET', '/api/admin/etat')).j.produits.find(p => p.nom === 'Biscuit');
    assert.ok(bis && !bis.ean);
  } finally { s.close(); }
});
