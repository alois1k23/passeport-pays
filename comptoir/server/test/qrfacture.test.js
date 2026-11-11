// QR-facture suisse : IBAN, références QRR et SCOR, contenu du QR code (norme SIX), dessin.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../../js/qrfacture.js');

test('IBAN suisse et QR-IBAN', () => {
  assert.equal(Q.ibanValide('CH93 0076 2011 6238 5295 7'), true);
  assert.equal(Q.ibanValide('CH93 0076 2011 6238 5295 8'), false, 'chiffre de contrôle faux');
  assert.equal(Q.ibanValide('DE89370400440532013000'), false, 'hors Suisse / Liechtenstein');
  assert.equal(Q.estQrIban('CH44 3199 9123 0008 8901 2'), true);
  assert.equal(Q.estQrIban('CH93 0076 2011 6238 5295 7'), false);
});

test('références QRR (modulo 10 récursif) et SCOR (ISO 11649)', () => {
  // Exemple de la norme SIX : 21 00000 00003 13947 14300 09017
  assert.equal(Q.referenceQrr('21000000000313947143000901'), '210000000003139471430009017');
  assert.equal(Q.qrrValide('210000000003139471430009017'), true);
  assert.equal(Q.qrrValide('210000000003139471430009018'), false);
  // Exemple ISO 11649 : RF18 5390 0754 7034
  assert.equal(Q.referenceScor('539007547034'), 'RF18539007547034');
  assert.equal(Q.scorValide('RF18539007547034'), true);
  assert.equal(Q.scorValide(Q.referenceScor('FA20260012')), true);
});

test('contenu du Swiss QR Code et adresse structurée', () => {
  const creancier = { nom: 'Atelier Léman Sàrl', ...Q.decouperAdresse('Rue du Lac 12, 1003 Lausanne') };
  assert.deepEqual([creancier.rue, creancier.numero, creancier.npa, creancier.localite], ['Rue du Lac', '12', '1003', 'Lausanne']);
  const fr = Q.decouperAdresse('14 rue des Tanneurs, 69001 Lyon', 'FR');
  assert.deepEqual([fr.rue, fr.numero, fr.npa, fr.localite], ['rue des Tanneurs', '14', '69001', 'Lyon']);
  const c = Q.charge({ iban: 'CH44 3199 9123 0008 8901 2', creancier, montant: 1949.75, debiteur: { nom: 'Pia Rutschmann', ...Q.decouperAdresse('Marktgasse 28, 9400 Rorschach') }, reference: Q.referenceQrr('21000000000313947143000901'), message: 'Commande n° 1001' });
  const l = c.split('\r\n');
  assert.equal(l.length, 31, 'nombre de lignes de la norme');
  assert.deepEqual(l.slice(0, 4), ['SPC', '0200', '1', 'CH4431999123000889012']);
  assert.equal(l[4], 'S'); assert.equal(l[18], '1949.75'); assert.equal(l[19], 'CHF');
  assert.equal(l[27], 'QRR'); assert.equal(l[28], '210000000003139471430009017'); assert.equal(l[30], 'EPD');
  const s = Q.svg(c);
  assert.match(s, /^<svg [^>]*width="46mm"/); assert.match(s, /QR code de paiement suisse/);
  assert.ok(Q.sectionPaiement({ iban: 'CH4431999123000889012', creancier, montant: 10, reference: Q.referenceQrr('1001'), message: 'x' }).includes('Section paiement'));
});
