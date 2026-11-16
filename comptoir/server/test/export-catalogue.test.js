// Export du catalogue (format Shopify) : relu par l'import de Comptoir sans perte, cellules neutralisées pour les tableurs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../js/export-catalogue.js');
const I = require('../../js/import-catalogue.js');

test('export puis import : mêmes produits, variantes, codes-barres, marque', () => {
  const produits = [
    { id: 'p_aaa111', nom: 'Nappe "Été", lin', prix: 60, prixReference: 75, stock: 4, description: 'Lin lavé.\nTissé au Portugal <main>.', categorie: 'Table', marque: 'Atelier', ean: '4006381333931', actif: true },
    { id: 'p_bbb222', nom: 'T-shirt', prix: 30, categorie: 'Mode', options: [{ nom: 'Taille', valeurs: ['S', 'M'] }, { nom: 'Couleur', valeurs: ['Bleu'] }], variantes: [{ id: 'S/Bleu', valeurs: ['S', 'Bleu'], stock: 2, ean: '96385074' }, { id: 'M/Bleu', valeurs: ['M', 'Bleu'], stock: 3, prix: 32 }], actif: false },
    { id: 'p_ccc333', nom: '=HYPERLINK("http://x")', prix: 5, stock: 1 }
  ];
  const csv = E.versShopify(produits, { marqueParDefaut: 'Ma boutique' });
  assert.ok(csv.startsWith('﻿Handle,Title,'));
  assert.match(csv, /,"'=HYPERLINK\(""http:\/\/x""\)",/, 'formule neutralisée (apostrophe), guillemets doublés');
  const r = I.convertir(csv);
  assert.equal(r.format, 'shopify'); assert.equal(r.produits.length, 3);
  const nappe = r.produits.find(p => p.nom === 'Nappe "Été", lin');
  assert.equal(nappe.prix, 60); assert.equal(nappe.prixReference, 75); assert.equal(nappe.stock, 4); assert.equal(nappe.ean, '4006381333931'); assert.equal(nappe.marque, 'Atelier'); assert.equal(nappe.categorie, 'Table');
  assert.match(nappe.description, /Lin lavé\.\s+Tissé au Portugal <main>\./);
  const t = r.produits.find(p => p.nom === 'T-shirt');
  assert.equal(t.actif, false); assert.equal(t.marque, 'Ma boutique');
  assert.deepEqual(t.options.map(o => o.nom), ['Taille', 'Couleur']);
  assert.deepEqual(t.variantes.map(v => [v.id, v.stock, v.prix ?? null, v.ean ?? null]), [['S/Bleu', 2, null, '96385074'], ['M/Bleu', 3, 32, null]]);
});

test('export : prix barré licite seulement, handles uniques, statut, stock suivi, formules, relecture fidèle', () => {
  const produits = [
    { id: 'p_AbCdEf', nom: 'Tasse', prix: 10, stock: 1 },
    { id: 'p_aBcDeF', nom: 'Tasse', prix: 10, stock: 2 },
    { id: 'p_x-_y', nom: '+ de goût', categorie: '-50%', prix: 50, prixReference: 90, stock: 3, options: [{ nom: 'Taille', valeurs: ['-S', 'L'] }], variantes: [{ id: 'L', valeurs: ['L'], stock: 1, prix: 65 }, { id: '-S', valeurs: ['-S'], stock: 2 }] },
    { id: 'p_v', nom: 'À vérifier', prix: 8, stock: 1, aVerifier: true },
    { id: 'p_d', nom: 'Lampe', prix: 40, type: 'drop' },
    { id: 'p_n', nom: 'E-book', prix: 9, stock: 1000, numerique: true },
    { id: 'p_e', nom: 'Piège', prix: 3, stock: 1, ean: '=1+2' },
    { id: 'p_b', nom: 'Bol', prix: 12, stock: 4, options: [{ nom: 'Couleur', valeurs: ['Rouge'] }], variantes: [{ id: 'Rouge', valeurs: ['Rouge'], stock: 4 }] },
    { id: 'p_s', nom: 'Gilet', prix: 70, stock: 1, refImport: 'shopify:gilet-laine' }
  ];
  const csv = E.versShopify(produits, { prixBarre: p => (p.id === 'p_x-_y' ? 90 : null) });
  const lignes = csv.trim().split('\r\n'), entete = lignes[0].replace('﻿', '').split(',');
  const handles = lignes.slice(1).map(l => l.split(',')[0]);
  assert.ok(handles.every(h => /^[a-z0-9-]+$/.test(h)), 'handles en lettres minuscules, chiffres et tirets');
  const tasses = [...new Set(handles.filter(h => h.startsWith('tasse')))];
  assert.equal(tasses.length, 2, 'deux produits de même nom : deux handles');
  assert.ok(handles.includes('gilet-laine'), 'handle Shopify d’origine repris');
  assert.match(csv, /,'-50%,/, '« -50% » neutralisé'); assert.doesNotMatch(csv, /'\+ de goût/, '« + de goût » laissé intact');
  assert.doesNotMatch(csv, /=1\+2/, 'code-barres invalide non écrit');
  for (const c of ['Variant Inventory Tracker', 'Variant Inventory Policy', 'Variant Requires Shipping', 'Tags']) assert.ok(entete.includes(c), c);
  const r = I.convertir(csv);
  const P = n => r.produits.filter(p => p.nom === n);
  assert.equal(P('Tasse').length, 2);
  const g = P('+ de goût')[0];
  assert.equal(g.categorie, '-50%', 'apostrophe retirée à la relecture'); assert.equal(g.prix, 50); assert.equal(g.prixReference, 90, 'variante au prix de base en premier : prix barré gardé');
  assert.deepEqual(g.variantes.map(v => [v.id, v.prix ?? null]).sort(), [['-S', null], ['L', 65]]);
  assert.ok(!/,65\.00,90\.00,/.test(csv), 'pas de prix barré sur une variante plus chère');
  assert.equal(P('À vérifier')[0].actif, false, 'produit à vérifier exporté en brouillon');
  assert.equal(P('Bol')[0].variantes.length, 1, 'une seule valeur d’option gardée');
  const sansLicite = E.versShopify([{ id: 'x', nom: 'Promo', prix: 50, prixReference: 90, stock: 1 }], { prixBarre: () => null });
  assert.doesNotMatch(sansLicite, /90\.00/, 'prix barré illicite non exporté');
  assert.match(csv.split('\r\n').find(l => l.includes('E-book')), /,FALSE,/, 'produit numérique sans expédition');
  assert.match(csv.split('\r\n').find(l => l.includes('Lampe')), /,,,continue,/, 'drop : stock non suivi, vente continue');
});
