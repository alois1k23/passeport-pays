// Score de risque des commandes : règles explicables ; transmission automatique retenue si le risque est élevé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const R = require('../src/risque');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('règles : commande normale faible, signaux cumulés élevés, client connu atténue', () => {
  const k = R.creerCompteurs();
  const normale = R.evaluer({ client: { nom: 'Pia Muster', email: 'pia@exemple.ch' }, lignes: [{ qte: 1 }], total: 60 }, { reseau: '1.2.3.0', compteurs: k, panierMoyen: 55 });
  assert.equal(normale.niveau, 'faible'); assert.deepEqual(normale.raisons, []);
  for (let i = 0; i < 4; i++) k.ajouter('r::9.9.9.0', `client${i}@exemple.ch`);
  // Un client qui réessaie 4 fois son paiement (même e-mail, même réseau) : pas une rafale
  const k2 = R.creerCompteurs();
  for (let i = 0; i < 4; i++) k2.ajouter('r::5.5.5.0', 'anna@exemple.ch'), k2.ajouter('e::anna@exemple.ch', '5.5.5.0');
  assert.equal(R.evaluer({ client: { nom: 'Anna Muster', email: 'anna@exemple.ch' }, lignes: [{ qte: 1 }], total: 80 }, { reseau: '5.5.5.0', compteurs: k2, panierMoyen: 60 }).niveau, 'faible', 'nouvel essai de paiement');
  // Client professionnel : 12 articles pour CHF 900, sans autre signal : au plus « moyen »
  assert.notEqual(R.evaluer({ client: { nom: 'Bureau Muster', email: 'achats@muster.ch' }, lignes: [{ qte: 12 }], total: 900 }, { reseau: '7.7.7.0', compteurs: R.creerCompteurs(), panierMoyen: 60 }).niveau, 'eleve');
  // Nom nordique : pas « incohérent »
  assert.equal(R.evaluer({ client: { nom: 'Bjørn Strøm', email: 'bjorn@exemple.no' }, lignes: [{ qte: 1 }], total: 50 }, { reseau: '8.8.8.0', compteurs: R.creerCompteurs() }).niveau, 'faible');
  const louche = R.evaluer({ client: { nom: 'Xkcd Wrtzpq', email: 'ab1234567@yopmail.com' }, lignes: [{ qte: 10 }], total: 900 }, { reseau: '9.9.9.0', compteurs: k, panierMoyen: 60, boutique: '' });
  assert.equal(louche.niveau, 'eleve'); assert.ok(louche.raisons.some(r => /jetable/.test(r)) && louche.raisons.some(r => /même réseau/.test(r)));
  const fidele = R.evaluer({ client: { nom: 'Pia Muster', email: 'pia@exemple.ch' }, lignes: [{ qte: 5 }], total: 80 }, { reseau: '1.2.3.0', compteurs: k, panierMoyen: 55, clientConnu: true });
  assert.equal(fidele.niveau, 'faible');
});

test('commande à risque élevé : signalée au marchand, transmission au fournisseur retenue', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'risque@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Risque', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'R', adresse: 'Rue 1, 1003 Lausanne' }, reglages: { autoTransmission: true } }, produits: [{ nom: 'Lampe', prix: 45, type: 'drop', source: 'catalogue', codeFournisseur: 'demo', actif: true }] });
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    const drop = pub.produits.find(p => p.type === 'drop');
    assert.ok(drop, 'produit en dropshipping dans la boutique de départ');
    const commander = (nom, email, qte) => fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: drop.id, qte }], livraison: 'poste-eco', client: { nom, email, adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json());
    for (let i = 0; i < 3; i++) await commander('Anna Test', `anna${i}@exemple.ch`, 1);   // même réseau, en rafale
    const cmd = await commander('Qwrtz Xplk', 'zz12345678@yopmail.com', 10);
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    await new Promise(r => setTimeout(r, 200));
    const row = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE numero = ?').get(cmd.numero).donnees);
    assert.equal(row.risque.niveau, 'eleve', JSON.stringify(row.risque));
    assert.ok(!row.refFournisseur, 'pas transmise automatiquement');
    assert.ok(row.historique.some(h => /retenue/.test(h.texte)));
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE corps LIKE '%risque de fraude élevé%'").get(), 'marchand prévenu par e-mail');
  } finally { s.close(); }
});
