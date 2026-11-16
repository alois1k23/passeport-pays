// Boutique canadienne (prise en charge partielle) : transporteurs de Postes Canada, régime de petit fournisseur imposé,
// jamais de TVA française sur une commande ou une facture, pas de mention du droit français.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const prix = require('../src/prix');

test('Canada : modes de livraison, taux nul et régime imposé', () => {
  const modes = prix.modesLivraison({ boutique: { pays: 'ca' }, magasin: {} });
  assert.deepEqual(Object.keys(modes), ['postes-regulier', 'postes-xpress']);
  for (const regime of ['normal', 'franchise', 'ch-assujetti']) {
    assert.equal(prix.tauxTva({ boutique: { pays: 'ca' }, entreprise: { regime } }), 0, regime);
    assert.equal(prix.tauxReduit({ boutique: { pays: 'ca' }, entreprise: { regime } }), 0, regime);
  }
  assert.equal(prix.tauxTva({ boutique: { pays: 'fr' }, entreprise: { regime: 'normal' } }), 0.2, 'France inchangée');
});

test('Canada : commande sans TVA, régime « petit fournisseur » gardé même si « normal » est envoyé, pas de droit français dans l’e-mail', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, avec = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avec ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avec) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'qc@exemple.ca', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Érablière', pays: 'ca' }, entreprise: { raison: 'Érablière inc.', adresse: '12 rue Saint-Paul, Montréal QC H2Y 1H1', email: 'qc@exemple.ca', regime: 'normal' } } });
    const etat = (await c('GET', '/api/admin/etat')).j;
    assert.equal(etat.boutique.devise, 'CAD'); assert.equal(etat.entreprise.regime, 'franchise', 'régime imposé à l’inscription');
    await c('PUT', '/api/admin/config', { config: { boutique: etat.boutique, entreprise: { ...etat.entreprise, regime: 'normal' }, magasin: etat.magasin, livraisons: etat.livraisons, offres: etat.offres, reglages: etat.reglages } });
    assert.equal((await c('GET', '/api/admin/etat')).j.entreprise.regime, 'franchise', 'régime imposé à l’enregistrement');
    const sirop = (await c('POST', '/api/admin/produits', { produit: { nom: 'Sirop', prix: 20, stock: 9 } })).j.id;
    const pub = (await c('GET', `/api/public/${etat.serveur.slug}`, null, false)).j;
    assert.deepEqual(Object.keys(pub.livraisons), ['postes-regulier', 'postes-xpress']);
    const r = await c('POST', `/api/public/${etat.serveur.slug}/commandes`, { lignes: [{ produitId: sirop, qte: 1 }], livraison: 'postes-regulier', client: { nom: 'Léa Tremblay', email: 'lea@exemple.ca', adresse: '5 rue Ontario', npa: 'H2X 1Y6', ville: 'Montréal' } }, false);
    assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.total, 35, '20 + 15 de port, sans taxe');
    await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const cmd = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(r.j.commandeId).donnees);
    assert.equal(cmd.tauxTva || 0, 0, 'pas de TVA figée sur la commande'); assert.ok(cmd.lignes.every(l => !l.tauxTva), 'ni sur les lignes');
    const mail = db.prepare("SELECT corps FROM emails WHERE destinataire = 'lea@exemple.ca' AND sujet LIKE 'Commande n°%confirmée'").get();
    assert.ok(mail); assert.doesNotMatch(mail.corps, /L221-18|Code de la consommation|VI\.47/, 'pas de droit français ou belge');
  } finally { s.close(); }
});
