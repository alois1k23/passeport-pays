// Import d'un catalogue existant : exports CSV de Shopify, WooCommerce, PrestaShop et tableur simple.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const I = require('../../js/import-catalogue.js');
const { creerIntegrations } = require('../src/integrations');

const SHOPIFY = `Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Status
t-shirt-bio,T-shirt bio,"<p>Coton <b>bio</b> &amp; doux</p><script>alert(1)</script><ul><li>Lavable</li></ul>",Atelier,Vêtements,,true,Taille,S,Couleur,Blanc,TS-S-B,4,29.90,39.90,https://cdn.exemple.ch/ts.jpg,active
t-shirt-bio,,,,,,,,M,,Blanc,TS-M-B,6,29.90,,,
t-shirt-bio,,,,,,,,L,,Noir,TS-L-N,0,32.00,,https://cdn.exemple.ch/ts2.jpg,
mug,"Mug ""Lac Léman""",Céramique,,Maison,,true,Title,Default Title,,,MUG,12,18,,https://cdn.exemple.ch/mug.png,draft
sans-prix,Sans prix,,,,,true,Title,Default Title,,,,,,,,active
`;
const WOO = `ID,Type,SKU,Name,Published,Short description,Description,Regular price,Sale price,Stock,Categories,Images,Parent,Attribute 1 name,Attribute 1 value(s),Attribute 2 name,Attribute 2 value(s)
10,simple,SAV-1,Savon au miel,1,Doux,"<p>Fait main à Bienne</p>",12.50,9.90,30,Maison > Bain,https://cdn.exemple.ch/savon.jpg,,,,,
11,variable,BOUG,Bougie,1,,Parfumée,,,,Maison,,,Parfum,"Figue, Cèdre",,
12,variation,BOUG-F,Bougie - Figue,1,,,24,,5,,,id:11,Parfum,Figue,,
13,variation,BOUG-C,Bougie - Cèdre,1,,,26,,3,,,id:11,Parfum,Cèdre,,
14,grouped,GRP,Groupe,1,,,,,,,,,,,,
15,variation,ORPH,Orpheline,1,,,10,,1,,,id:99,Parfum,X,,
`;
const PRESTA = `Product ID;Active (0/1);Name *;Categories (x,y,z...);Price tax excluded;Price tax included;Reference #;Quantity;Description;Image URLs (x,y,z...)
1;1;Fondue moitié-moitié;Épicerie,Fromage;20,00;21,60;FOND;15;<p>800 g</p>;https://cdn.exemple.ch/f.jpg,https://cdn.exemple.ch/f2.jpg
2;0;Caquelon;Cuisine;45,00;;CAQ;2;Fonte;
3;1;Réchaud;Cuisine;;abc;RECH;1;;
`;
const SIMPLE = `nom;prix;stock;catégorie;prix barré;image
Carte postale;2,50;100;Papeterie;;
"Affiche, 50×70";1'290.00;3;Déco;1'490.00;javascript:alert(1)
=HYPERLIEN("x");5;1;;;
`;

test('lecture CSV : guillemets, retours à la ligne, BOM, séparateurs', () => {
  const r = I.lireCsv('﻿a;b\r\n"x;1";"ligne\nsuite"\r\n"y""z";\r\n');
  assert.equal(r.separateur, ';');
  assert.deepEqual(r.lignes, [['a', 'b'], ['x;1', 'ligne\nsuite'], ['y"z', '']]);
  assert.equal(I.texteDepuisHtml('<p>A &amp; B</p><script>x()</script><img src=x onerror=alert(1)>C&#233;&#x2603;'), 'A & B\nCé☃');
  assert.equal(I.lireNombre("1'290.50"), 1290.5); assert.equal(I.lireNombre('1 290,50'), 1290.5); assert.equal(I.lireNombre('1,290.50'), 1290.5);
  assert.equal(I.lireNombre('29,9'), 29.9); assert.equal(I.lireNombre('CHF 12.–'), 12); assert.equal(I.lireNombre('Fr. 7.50'), 7.5); assert.ok(Number.isNaN(I.lireNombre('abc'))); assert.equal(I.lireNombre(''), null);
});

test('Shopify : variantes, prix barré, statut, HTML retiré, photos ; sans prix signalé', () => {
  const r = I.convertir(SHOPIFY);
  assert.equal(r.format, 'shopify'); assert.equal(r.produits.length, 2);
  const ts = r.produits[0];
  assert.equal(ts.nom, 'T-shirt bio'); assert.equal(ts.prix, 29.9); assert.equal(ts.prixReference, 39.9); assert.equal(ts.stock, 10);
  assert.equal(ts.description, 'Coton bio & doux\n• Lavable'); assert.ok(!/script|alert/.test(ts.description));
  assert.deepEqual(ts.options, [{ nom: 'Taille', valeurs: ['S', 'M', 'L'] }, { nom: 'Couleur', valeurs: ['Blanc', 'Noir'] }]);
  assert.equal(ts.variantes.length, 3); assert.equal(ts.variantes[2].prix, 32); assert.equal(ts.variantes[2].id, 'L/Noir');
  assert.deepEqual(ts.images, ['https://cdn.exemple.ch/ts.jpg']);
  const mug = r.produits[1];
  assert.equal(mug.nom, 'Mug "Lac Léman"'); assert.equal(mug.actif, false, 'brouillon importé masqué'); assert.equal(mug.options, undefined);
  assert.ok(r.erreurs.some(e => /Sans prix/.test(e.message)));
});

test('WooCommerce : promotion, produit variable et ses variations, types non gérés et orphelines signalés', () => {
  const r = I.convertir(WOO);
  assert.equal(r.format, 'woocommerce'); assert.equal(r.produits.length, 2);
  const s = r.produits[0];
  assert.equal(s.prix, 9.9); assert.equal(s.prixReference, 12.5); assert.equal(s.categorie, 'Bain'); assert.equal(s.description, 'Fait main à Bienne');
  const b = r.produits[1];
  assert.equal(b.prix, 24); assert.equal(b.stock, 8); assert.deepEqual(b.options, [{ nom: 'Parfum', valeurs: ['Figue', 'Cèdre'] }]);
  assert.equal(b.variantes.find(v => v.id === 'Cèdre').prix, 26);
  assert.ok(r.erreurs.some(e => /grouped/.test(e.message))); assert.ok(r.erreurs.some(e => /sans produit parent/.test(e.message)));
});

test('PrestaShop et tableur : prix TTC, prix HT seul signalé, nombres suisses, liens non https ignorés', () => {
  const p = I.convertir(PRESTA);
  assert.equal(p.format, 'prestashop'); assert.equal(p.produits.length, 2);
  assert.equal(p.produits[0].prix, 21.6); assert.equal(p.produits[0].categorie, 'Épicerie'); assert.deepEqual(p.produits[0].images, ['https://cdn.exemple.ch/f.jpg']);
  assert.equal(p.produits[1].prix, 45); assert.equal(p.produits[1].actif, false);
  assert.ok(p.erreurs.some(e => e.avertissement && /hors taxes/.test(e.message)));
  assert.ok(p.erreurs.some(e => /illisible/.test(e.message)));
  const s = I.convertir(SIMPLE);
  assert.equal(s.format, 'simple'); assert.equal(s.produits.length, 3);
  assert.equal(s.produits[1].nom, 'Affiche, 50×70'); assert.equal(s.produits[1].prix, 1290); assert.equal(s.produits[1].prixReference, 1490);
  assert.deepEqual(s.produits[1].images, [], 'javascript: refusé');
  assert.equal(s.produits[2].nom, '=HYPERLIEN("x")', 'gardé comme texte (jamais interprété)');
  assert.equal(I.convertir('a,b\n1,2').format, null);
});

test('import dans la boutique : aperçu sans écriture, import, réimport sans doublon, limites', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'imp@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Imp', pays: 'ch' } } });
    const nbProduits = () => db.prepare('SELECT COUNT(*) n FROM produits WHERE supprime = 0').get().n;
    const avant = nbProduits();
    const ap = await c('POST', '/api/admin/produits/importer-csv/apercu', { csv: SHOPIFY });
    assert.equal(ap.s, 200); assert.equal(ap.j.nomFormat, 'Shopify'); assert.equal(ap.j.nouveaux, 2); assert.equal(ap.j.avecPhoto, 2);
    assert.equal(nbProduits(), avant, 'aperçu : rien écrit');
    const imp = await c('POST', '/api/admin/produits/importer-csv', { csv: SHOPIFY, photos: false });
    assert.equal(imp.s, 200, JSON.stringify(imp.j)); assert.equal(imp.j.importes, 2); assert.equal(imp.j.photosEnCours, 0);
    const ts = (await c('GET', '/api/admin/etat')).j.produits.find(p => p.nom === 'T-shirt bio');
    // Comptoir garde toutes les combinaisons (3 tailles × 2 couleurs) ; celles absentes du fichier sont à 0 (épuisées).
    assert.equal(ts.variantes.length, 6); assert.equal(ts.stock, 10); assert.equal(ts.prixReference, 39.9);
    assert.equal(ts.variantes.find(v => v.id === 'L/Noir').prix, 32); assert.equal(ts.variantes.find(v => v.id === 'M/Blanc').stock, 6); assert.equal(ts.variantes.find(v => v.id === 'L/Blanc').stock, 0);
    // Réimport : rien de recréé.
    const re = await c('POST', '/api/admin/produits/importer-csv', { csv: SHOPIFY, photos: false });
    assert.equal(re.j.importes, 0); assert.equal(re.j.dejaImportes, 2);
    // Fichiers refusés proprement.
    assert.equal((await c('POST', '/api/admin/produits/importer-csv/apercu', { csv: '' })).j.code, 'csv_vide');
    assert.equal((await c('POST', '/api/admin/produits/importer-csv/apercu', { csv: { x: 1 } })).j.code, 'csv_vide');
    const vide = await c('POST', '/api/admin/produits/importer-csv', { csv: 'x,y\n1,2' });
    assert.equal(vide.j.importes, 0); assert.ok(vide.j.erreurs[0].message.includes('Format non reconnu'));
    // Les autres formats aussi.
    assert.equal((await c('POST', '/api/admin/produits/importer-csv', { csv: WOO, photos: false })).j.importes, 2);
    assert.equal((await c('POST', '/api/admin/produits/importer-csv', { csv: PRESTA, photos: false })).j.importes, 2);
    assert.ok(db.prepare("SELECT 1 FROM journal_compte WHERE type = 'import-catalogue'").get());
  } finally { s.close(); }
});

test('photos importées : seulement de vraies images, 300 Ko au plus, jamais d’adresse interne', async () => {
  const img = http.createServer((req, res) => {
    if (req.url === '/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)])); }
    if (req.url === '/faux.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end('<svg onload=alert(1)>'); }
    if (req.url === '/gros.jpg') { res.writeHead(200); return res.end(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400 * 1024)])); }
    if (req.url === '/redir') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise(ok => img.listen(0, '127.0.0.1', ok));
  const u = `http://127.0.0.1:${img.address().port}`;
  try {
    const local = creerIntegrations({ db: ouvrir(':memory:'), env: { INTEGRATIONS_HTTP_LOCAL: '1' }, journal: { log() {}, error() {} } });
    assert.match(await local.telechargerImage(`${u}/ok.png`), /^data:image\/png;base64,/);
    assert.equal(await local.telechargerImage(`${u}/faux.png`), null, 'contenu qui n’est pas une image');
    assert.equal(await local.telechargerImage(`${u}/gros.jpg`), null, 'trop lourd');
    assert.equal(await local.telechargerImage(`${u}/redir`), null, 'redirection non suivie');
    // Sans le mode d'essai : http refusé, adresses internes refusées (y compris par un nom qui y pointe).
    const prod = creerIntegrations({ db: ouvrir(':memory:'), env: {}, journal: { log() {}, error() {} }, resoudre: async () => [{ address: '10.0.0.5', family: 4 }] });
    assert.equal(await prod.telechargerImage(`${u}/ok.png`), null);
    assert.equal(await prod.telechargerImage('https://169.254.169.254/latest/meta-data'), null);
    assert.equal(await prod.telechargerImage('https://interne.exemple/ok.png'), null, 'nom qui pointe vers 10.0.0.5');
  } finally { img.close(); }
});
