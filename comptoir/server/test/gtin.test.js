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

test('barres EAN-13 et EAN-8 : relues par un décodeur indépendant des tables d’encodage', () => {
  // Décodeur : chaque chiffre se reconnaît à la largeur de ses 4 barres et espaces (méthode des lecteurs), pas aux tables.
  const largeurs = m => { const r = []; let n = 1; for (let i = 1; i <= m.length; i++) { if (m[i] === m[i - 1]) n++; else { r.push(n); n = 1; } } return r.join(''); };
  const CHIFFRES = { '3211': 0, '2221': 1, '2122': 2, '1411': 3, '1132': 4, '1231': 5, '1114': 6, '1312': 7, '1213': 8, '3112': 9 };
  const lire = (bits, n) => {
    assert.equal(bits.slice(0, 3), '101'); assert.equal(bits.slice(-3), '101');
    const g = bits.slice(3, 3 + 7 * n), c = bits.slice(3 + 7 * n, 8 + 7 * n), d = bits.slice(8 + 7 * n, -3);
    assert.equal(c, '01010');
    const chiffre = m => { const w = largeurs(m), r = CHIFFRES[w] ?? CHIFFRES[[...w].reverse().join('')]; assert.notEqual(r, undefined, m); return { r, pair: m.split('').filter(x => x === '1').length % 2 === 0 }; };
    const gauche = Array.from({ length: n }, (_, i) => chiffre(g.slice(i * 7, i * 7 + 7))), droite = Array.from({ length: n }, (_, i) => chiffre(d.slice(i * 7, i * 7 + 7)));
    return { gauche, droite };
  };
  const PARITE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  for (const code of ['4006381333931', '7612345678900'.slice(0, 12) + '', '2084286247272', '036000291452']) {
    const c13 = code.length === 12 ? '0' + code : code.length === 13 ? code : null; if (!c13 || !Gtin.valide(c13)) continue;
    const { gauche, droite } = lire(Gtin.barres(code), 6);
    const premier = PARITE.indexOf(gauche.map(x => x.pair ? 'G' : 'L').join(''));
    assert.equal(`${premier}${gauche.map(x => x.r).join('')}${droite.map(x => x.r).join('')}`, c13, code);
  }
  const { gauche, droite } = lire(Gtin.barres('96385074'), 4);
  assert.equal(gauche.concat(droite).map(x => x.r).join(''), '96385074');
  assert.equal(Gtin.barres('10012345678902'), null, 'GTIN-14 : pas d’EAN');
  const pris = new Set(); for (let i = 0; i < 50; i++) { const c = Gtin.codeInterne(pris); assert.ok(Gtin.valide(c) && c.startsWith('20') && !pris.has(c)); pris.add(c); }
});

test('import : code-barres valide gardé, invalide ou en double ignoré avec un avertissement', () => {
  const csv = 'Nom,Prix,EAN13\nTorchon,18,4006381333931\nNappe,60,4006381333932\nPlaid,90,4006381333931\n';
  const r = I.convertir(csv);
  assert.equal(r.produits.find(p => p.nom === 'Torchon').ean, '4006381333931');
  assert.equal(r.produits.find(p => p.nom === 'Nappe').ean, undefined);
  assert.equal(r.produits.find(p => p.nom === 'Plaid').ean, undefined);
  assert.equal(r.erreurs.filter(e => /code-barres/.test(e.message)).length, 2);
  const shop = 'Handle,Title,Variant Price,Variant Barcode\ncafe,Café,14,96385074\n';
  const varShop = 'Handle,Title,Option1 Name,Option1 Value,Variant Price,Variant Barcode\nts,T-shirt,Taille,S,30,96385074\nts,,Taille,M,30,4006381333932\n';
  const vs = I.convertir(varShop).produits[0].variantes;
  assert.equal(vs.find(v => v.id === 'S').ean, '96385074'); assert.equal(vs.find(v => v.id === 'M').ean, undefined);
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
    // Variantes : un code par taille, unique aussi face aux autres produits ; un code faux est refusé.
    const opts = [{ nom: 'Taille', valeurs: ['S', 'M'] }];
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'T-shirt', prix: 30, options: opts, variantes: [{ id: 'S', valeurs: ['S'], stock: 2, ean: '96385074' }, { id: 'M', valeurs: ['M'], stock: 2, ean: '96385075' }] } })).j.code, 'ean_invalide');
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'T-shirt', prix: 30, options: opts, variantes: [{ id: 'S', valeurs: ['S'], stock: 2, ean: '96385074' }, { id: 'M', valeurs: ['M'], stock: 2, ean: '96385074' }] } })).j.code, 'ean_doublon');
    const ts = (await c('POST', '/api/admin/produits', { produit: { nom: 'T-shirt', prix: 30, options: opts, variantes: [{ id: 'S', valeurs: ['S'], stock: 2, ean: '96385074' }, { id: 'M', valeurs: ['M'], stock: 2 }] } })).j.id;
    assert.equal((await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === ts).variantes.find(v => v.id === 'S').ean, '96385074');
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Bonnet', prix: 20, stock: 1, ean: '96385074' } })).j.code, 'ean_doublon', 'code d’une variante d’un autre produit');
    // Même article en UPC-A (12), EAN-13 (0…) ou GTIN-14 (00…) : un seul code, rangé en 13 chiffres.
    const upc = (await c('POST', '/api/admin/produits', { produit: { nom: 'Soda', prix: 2, stock: 5, ean: '036000291452' } })).j.id;
    assert.equal((await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === upc).ean, '0036000291452');
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Soda bis', prix: 2, stock: 5, ean: '00036000291452' } })).j.code, 'ean_doublon');
    // Import d'un produit dont le code-barres est déjà dans la boutique : importé sans le code, avec un avertissement.
    const imp = await c('POST', '/api/admin/produits/importer-csv', { csv: 'Nom,Prix,EAN13\nBiscuit,4,4006381333931\n' });
    assert.equal(imp.s, 200, JSON.stringify(imp.j));
    assert.ok(JSON.stringify(imp.j).includes('code-barres déjà utilisé'));
    const bis = (await c('GET', '/api/admin/etat')).j.produits.find(p => p.nom === 'Biscuit');
    assert.ok(bis && !bis.ean);
    // Réinitialisation (ou restauration) avec deux fois le même code : le second produit est gardé, sans code.
    const config = (await c('GET', '/api/admin/etat')).j;
    const re = await c('POST', '/api/admin/reinitialiser', { config: { boutique: config.boutique, entreprise: config.entreprise }, produits: [{ nom: 'Un', prix: 3, stock: 1, ean: '96385074' }, { nom: 'Deux', prix: 3, stock: 1, ean: '96385074' }] });
    assert.equal(re.s, 200, JSON.stringify(re.j));
    const apres = (await c('GET', '/api/admin/etat')).j.produits;
    assert.equal(apres.find(p => p.nom === 'Un').ean, '96385074'); assert.equal(apres.find(p => p.nom === 'Deux').ean, undefined);
  } finally { s.close(); }
});
