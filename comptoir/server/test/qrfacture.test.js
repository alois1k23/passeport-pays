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

test('paiement sur facture QR de bout en bout : commande, facture, relevé bancaire camt.054', async () => {
  const http = require('node:http');
  const { ouvrir } = require('../src/db');
  const { creerApp } = require('../src/app');
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); const t = await r.text(); try { return { s: r.status, j: JSON.parse(t), t }; } catch { return { s: r.status, t }; } };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'qr@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier QR', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'Atelier QR Sàrl', adresse: 'Rue du Lac 12, 1003 Lausanne', iban: 'CH44 3199 9123 0008 8901 2', regime: 'ch-non' }, reglages: { factureQr: true } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'lancement' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    assert.ok(pub.factureQr, 'facture QR proposée');
    const cmd = await c('POST', `/api/public/${ins.j.slug}/commandes`, { lignes: [{ produitId: pub.produits[0].id, qte: 2 }], livraison: 'poste-eco', moyen: 'facture', client: { nom: 'Pia Muster', email: 'pia@exemple.ch', adresse: 'Marktgasse 28', npa: '9400', ville: 'Rorschach' } });
    assert.equal(cmd.s, 201, JSON.stringify(cmd.j)); assert.ok(cmd.j.factureUrl);
    const page = await fetch(cmd.j.factureUrl); const html = await page.text();
    assert.equal(page.status, 200); assert.match(html, /Section paiement/); assert.match(html, /QR code de paiement suisse/); assert.match(html, /CH44 3199 9123 0008 8901 2/);
    assert.equal((await fetch(cmd.j.factureUrl.replace(/jeton=.*/, 'jeton=faux'))).status, 404, 'facture protégée par le jeton');
    const row = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.j.commandeId).donnees);
    assert.ok(Q.qrrValide(row.referenceQr), 'référence QRR valable (QR-IBAN)'); assert.match(row.facture, /^FA-/);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'pia@exemple.ch' AND sujet LIKE '%facture QR'").get());
    // Relevé camt.054 : un paiement reconnu, un inconnu, un débit ignoré
    const tx = (ref, montant, sens = 'CRDT') => `<TxDtls><Amt Ccy="CHF">${montant}</Amt><CdtDbtInd>${sens}</CdtDbtInd><RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${ref}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>`;
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><Ntfctn><Ntry>${tx(row.referenceQr, (row.total).toFixed(2))}${tx('000000000000000000000000000', '10.00')}${tx(row.referenceQr, '5.00', 'DBIT')}</Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
    const imp = await c('POST', '/api/admin/paiements/camt', { xml });
    assert.equal(imp.s, 200, JSON.stringify(imp.j)); assert.deepEqual(imp.j.payees, [cmd.j.numero]); assert.equal(imp.j.inconnues.length, 1);
    assert.equal(db.prepare('SELECT statut FROM commandes WHERE id = ?').get(cmd.j.commandeId).statut, 'payee');
    assert.equal(JSON.parse(db.prepare("SELECT donnees FROM produits WHERE boutique_id = (SELECT id FROM boutiques WHERE slug = ?)").get(ins.j.slug).donnees).stock, 3, 'stock retiré au paiement');
    const encore = await c('POST', '/api/admin/paiements/camt', { xml });
    assert.deepEqual(encore.j.payees, []); assert.deepEqual(encore.j.deja, [cmd.j.numero], 'relevé importé deux fois : rien de doublé');
    assert.equal((await c('POST', '/api/admin/paiements/camt', { xml: '<html>pas un relevé</html>' })).s, 400);
    // Boutique sans IBAN valable : moyen refusé
    db.prepare("UPDATE boutiques SET config = json_set(config, '$.entreprise.iban', 'CH00 1234') WHERE slug = ?").run(ins.j.slug);
    assert.equal((await c('POST', `/api/public/${ins.j.slug}/commandes`, { lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', moyen: 'facture', client: { nom: 'A B', email: 'ab@x.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } })).s, 400);
  } finally { s.close(); }
});
