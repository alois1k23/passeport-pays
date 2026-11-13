// Export complet de la boutique : propriétaire seulement, mot de passe redemandé, aucun secret, toutes les données.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('export complet', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return r; };
  const mdp = 'un mot de passe solide';
  try {
    await c('POST', '/api/auth/inscription', { email: 'ex@exemple.ch', motDePasse: mdp, config: { boutique: { nom: 'Export', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'E', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }, { nom: 'Ancien', prix: 10, stock: 1, type: 'stock' }] });
    const slug = db.prepare('SELECT slug FROM boutiques').get().slug, pid = (await (await c('GET', '/api/admin/etat')).json()).produits[0].id;
    const cmd = await (await fetch(`${base}/api/public/${slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Léa Martin', email: 'lea@exemple.ch', adresse: 'Rue 2', npa: '1004', ville: 'Lausanne' } }) })).json();
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const ancien = (await (await c('GET', '/api/admin/etat')).json()).produits.find(x => x.nom === 'Ancien');
    assert.equal((await c('DELETE', `/api/admin/produits/${ancien.id}`)).status, 200);
    // Nouveautés à exporter : un devis, une carte cadeau, un emplacement, le programme de fidélité.
    assert.equal((await c('POST', '/api/admin/devis', { client: { raison: 'Hôtel SA', email: 'h@exemple.ch' }, lignes: [{ nom: 'Pose', qte: 1, prixHt: 100 }] })).status, 201);
    const carte = await (await c('POST', '/api/admin/cartes-cadeaux', { montant: 30 })).json();
    assert.equal((await c('POST', '/api/admin/emplacements', { nom: 'Entrepôt', type: 'entrepot' })).status, 201);
    assert.equal((await c('PUT', '/api/admin/fidelite', { actif: true })).status, 200);
    assert.equal((await c('POST', '/api/admin/export-complet', { motDePasse: 'faux mot de passe' })).status, 401);
    const r = await c('POST', '/api/admin/export-complet', { motDePasse: mdp });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="comptoir-.*\.json"/); assert.match(r.headers.get('cache-control'), /no-store/);
    const texte = await r.text(), d = JSON.parse(texte);
    assert.equal(d.format, 'comptoir-export'); assert.equal(d.produits.length, 2);
    assert.equal(d.produits.find(x => x.nom === 'Ancien').supprime, true, 'produit supprimé marqué'); assert.ok(!d.produits.find(x => x.nom === 'Vase').supprime);
    assert.equal(d.photos, 'dans le fichier'); assert.equal(d.commandes.length, 1);
    assert.equal(d.clients[0].email, 'lea@exemple.ch'); assert.equal(d.configuration.boutique.nom, 'Export');
    assert.ok(d.journalVentes.length >= 1, 'journal des ventes inclus');
    assert.equal(d.devis[0].client.raison, 'Hôtel SA', 'devis déchiffré');
    assert.equal(d.cartesCadeaux.cartes[0].solde, 30); assert.ok(!texte.includes(carte.code.replace(/-/g, '')) && !texte.includes(carte.code), 'code de carte jamais exporté');
    assert.equal(d.emplacements.liste[0].nom, 'Entrepôt'); assert.ok(d.emplacements.mouvements.length >= 1);
    assert.equal(d.fidelite.reglages.actif, true);
    const jeton = db.prepare('SELECT jeton_client FROM commandes').get().jeton_client;
    assert.ok(!texte.includes(jeton), 'jeton du client absent'); assert.doesNotMatch(texte, /mot_de_passe|scrypt\$/);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE sujet = 'Export complet de votre boutique Comptoir'").get(), 'propriétaire prévenu');
  } finally { s.close(); }
});
