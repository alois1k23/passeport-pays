// Corrections de l'audit de sécurité global : secrets masqués dans les e-mails gardés, domaine d'un marchand limité
// à sa boutique, devis anonymisés à l'effacement, empreinte du devis accepté recalculable, commandes impayées bornées.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const courriel = require('../src/courriel');
const Devis = require('../src/devis');

test('secrets masqués : liens personnels, codes de fidélité, codes de cartes cadeaux', () => {
  const t = courriel.masquerSecrets('Lien : https://x/app?reinitialiser=abcdef123456&x=1\nDevis : https://x/devis/s/dv_1?jeton=SECRET\nVotre code pour les utiliser sur votre commande : 482913\nCarte : 3BRF-WV55-C0FR-3VQ3\nhttps://x/operateur?verifier=sig');
  for (const secret of ['abcdef123456', 'SECRET', '482913', '3BRF-WV55-C0FR-3VQ3', 'sig']) assert.ok(!t.includes(secret), secret);
  assert.match(t, /reinitialiser=…/); assert.match(t, /••••••/);
});

test('e-mail envoyé : la copie gardée ne contient plus le lien de réinitialisation', async () => {
  const db = ouvrir(':memory:'); courriel.creerTables && courriel.creerTables(db);
  db.prepare("INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le) VALUES (NULL, 'a@exemple.fr', 'Réinitialiser', 'https://x/app?reinitialiser=jeton-tres-secret', ?)").run(Date.now());
  const envoyes = [];
  await courriel.envoyerFile(db, { envoyer: async m => { envoyes.push(m.corps); } });
  assert.match(envoyes[0], /jeton-tres-secret/, 'le destinataire reçoit le vrai lien');
  assert.ok(!db.prepare('SELECT corps FROM emails').get().corps.includes('jeton-tres-secret'), 'la base ne le garde pas');
});

test('domaine d’un marchand : pas d’espace marchand ni de connexion ; empreinte du devis ; commandes impayées bornées', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  try {
    const r0 = await fetch(`${base}/api/auth/inscription`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dom@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Dom', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'D SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] }) });
    const cookie = r0.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    const cfg = JSON.parse(db.prepare('SELECT config FROM boutiques').get().config); cfg.boutique.domaine = { domaine: 'boutique-dom.ch', actif: true };
    db.prepare('UPDATE boutiques SET config = ?').run(JSON.stringify(cfg));
    const surDomaine = (chemin, opt = {}) => new Promise(ok => { const q = http.request({ host: '127.0.0.1', port: s.address().port, path: chemin, method: opt.method || 'GET', headers: { Host: 'boutique-dom.ch', ...(opt.headers || {}) } }, r => { r.resume(); r.on('end', () => ok(r.statusCode)); }); q.end(opt.corps); });
    for (const chemin of ['/app', '/api/admin/etat', '/operateur']) assert.equal(await surDomaine(chemin, { headers: { Cookie: cookie } }), 404, chemin);
    assert.equal(await surDomaine('/api/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, corps: '{}' }), 404);
    assert.equal((await fetch(`${base}/app`)).status, 200, 'sur le domaine de Comptoir : servi');
    // Empreinte du devis : recalculable après l'acceptation (le signataire n'en fait pas partie).
    const d = { client: { raison: 'X', email: 'x@exemple.fr' }, lignes: [{ nom: 'A', qte: 1, prix: 10, tauxTva: 0.2 }], port: 0, total: 10, conditions: '', valableJusquau: 1 };
    assert.equal(Devis.empreinteContenu('DE-1', d), Devis.empreinteContenu('DE-1', { ...d, client: { ...d.client, signataire: 'Mme X' } }));
    // Commandes impayées depuis une même adresse : bornées.
    const slug = db.prepare('SELECT slug FROM boutiques').get().slug, produit = db.prepare('SELECT id FROM produits').get().id;
    let dernier = 0;
    for (let i = 0; i < 6; i++) dernier = (await fetch(`${base}/api/public/${slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client: { nom: 'B', email: 'bloqueur@exemple.fr', adresse: 'R 1', npa: '69002', ville: 'Lyon' } }) })).status;
    assert.equal(dernier, 429, 'au-delà de 3 commandes impayées en cours');
  } finally { s.close(); }
});

test('effacement d’un client : ses devis sont anonymisés', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const api = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { statut: r.status, json: await r.json().catch(() => null) }; };
  try {
    await api('POST', '/api/auth/inscription', { email: 'ef@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Ef', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'E SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [] });
    const dv = (await api('POST', '/api/admin/devis', { client: { raison: 'Hôtel Secret SA', contact: 'Mme Roux', email: 'achats@secret.fr' }, lignes: [{ nom: 'Pose', qte: 1, prixHt: 100 }] })).json.devis;
    assert.equal((await api('POST', '/api/admin/clients/effacer', { email: 'ACHATS@secret.fr' })).statut, 200);
    const d = (await api('GET', `/api/admin/devis/${dv.id}`)).json.devis;
    assert.equal(d.client.raison, 'Client effacé'); assert.equal(d.client.email, ''); assert.equal(d.total, 120, 'montants gardés');
  } finally { s.close(); }
});
