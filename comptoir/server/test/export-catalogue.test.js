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
