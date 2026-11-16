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

test('Canada (relecture) : devis, adresse de facture, carte cadeau sans limite, régime forcé à la lecture', async () => {
  const { decouperAdresse } = require('../src/facture-electronique.js');
  assert.deepEqual(decouperAdresse('12 rue Saint-Paul, Montréal QC H2Y 1H1'), { rue: '12 rue Saint-Paul', npa: 'H2Y 1H1', ville: 'Montréal QC' });
  assert.deepEqual(decouperAdresse('Rue 1, 1003 Lausanne'), { rue: 'Rue 1', npa: '1003', ville: 'Lausanne' }, 'Suisse inchangée');
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, avec = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avec ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avec) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'qc2@exemple.ca', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Érablière', pays: 'ca' }, entreprise: { raison: 'Érablière inc.', siret: '123456789', adresse: '12 rue Saint-Paul, Montréal QC H2Y 1H1', email: 'qc2@exemple.ca', regime: 'franchise' } } });
    // Boutique enregistrée avant la règle (régime « normal » stocké) : lue en petit fournisseur, sans taxe.
    const row = db.prepare('SELECT id, config FROM boutiques').get(); const cfg = JSON.parse(row.config); cfg.entreprise.regime = 'normal';
    db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(cfg), row.id);
    assert.equal((await c('GET', '/api/admin/etat')).j.entreprise.regime, 'franchise', 'régime forcé à la lecture');
    // Carte cadeau en ligne : 0 = sans limite accepté au Canada (refusé ailleurs).
    assert.equal((await c('GET', '/api/admin/cartes-cadeaux/vente')).j.vente.validiteMois, 0, 'sans limite par défaut au Canada');
    const v = await c('PUT', '/api/admin/cartes-cadeaux/vente', { actif: true, montants: [25, 50], validiteMois: 0 });
    assert.equal(v.s, 200, JSON.stringify(v.j));
    // Commande payée : facture PDF disponible avec l'adresse canadienne, sans mention française.
    const sirop = (await c('POST', '/api/admin/produits', { produit: { nom: 'Sirop', prix: 20, stock: 9 } })).j.id;
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const r = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: sirop, qte: 1 }], livraison: 'postes-regulier', client: { nom: 'Léa Tremblay', email: 'lea@exemple.ca', adresse: '5 rue Ontario', npa: 'H2X 1Y6', ville: 'Montréal' } }, false);
    assert.equal(r.s, 201, JSON.stringify(r.j)); assert.equal(r.j.total, 35, 'sans taxe malgré le régime « normal » stocké');
    await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const pdf = await fetch(`${base}/api/admin/commandes/${r.j.commandeId}/facture-pdf`, { headers: { Cookie: cookie } });
    assert.equal(pdf.status, 200, 'facture PDF produite avec une adresse canadienne : ' + (pdf.status !== 200 ? await pdf.clone().text() : ''));
    // Le PDF est compressé : les mentions se vérifient dans la facture électronique (XML Factur-X).
    const xml = await (await fetch(`${base}/api/admin/commandes/${r.j.commandeId}/facture-electronique`, { headers: { Cookie: cookie } })).text();
    assert.match(xml, /<ram:PostcodeCode>H2Y 1H1<\/ram:PostcodeCode>/, 'code postal canadien'); assert.match(xml, /<ram:CountryID>CA<\/ram:CountryID>/);
    assert.doesNotMatch(xml, /293 B|L441-10/, 'pas de mention française');
    // Carte cadeau achetée en ligne : sans date d'expiration, e-mail « sans limite de durée ».
    const carte = await c('POST', `/api/public/${slug}/cartes-cadeaux/achat`, { montant: 25, client: { nom: 'Léa Tremblay', email: 'lea@exemple.ca' } }, false);
    if (carte.j && carte.j.paiementUrl) {
      await fetch(carte.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
      assert.equal(db.prepare("SELECT expire_le FROM cartes_cadeaux WHERE origine = 'vente'").get().expire_le, null, 'carte sans date');
      assert.match(db.prepare("SELECT corps FROM emails WHERE destinataire = 'lea@exemple.ca' AND corps LIKE '%Valable%'").get().corps, /sans limite de durée/);
    } else assert.fail('achat de carte : ' + JSON.stringify(carte.j));
    const lienVerif = db.prepare("SELECT corps FROM emails WHERE destinataire = 'qc2@exemple.ca' AND sujet LIKE 'Confirmez%'").get().corps.match(/verifier-email=([\w-]+)/)[1];
    assert.equal((await c('POST', '/api/auth/verifier-email', { jeton: lienVerif })).s, 200);
    // Devis canadien (client au Canada) : accepté, mention du petit fournisseur, jamais le CGI français.
    const cree = await c('POST', '/api/admin/devis', { client: { raison: 'Café du Port inc.', email: 'achats@cafe.ca', adresse: '8 rue Ontario', npa: 'H2X 1Y6', ville: 'Montréal', pays: 'ca' }, lignes: [{ nom: 'Sirop en gros', qte: 10, prixHt: 15 }] });
    assert.ok(cree.j.devis && cree.j.devis.client.pays === 'ca', JSON.stringify(cree.j));
    const env = await c('POST', `/api/admin/devis/${cree.j.devis.id}/envoyer`); assert.ok(env.j && env.j.lien, JSON.stringify(env.j));
    const html = await (await fetch(env.j.lien)).text();
    assert.match(html, /Petit fournisseur/); assert.doesNotMatch(html, /293 B du CGI/);
  } finally { s.close(); }
});
