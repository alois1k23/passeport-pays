// Données personnelles des clients chiffrées au repos : AES-256-GCM authentifié, index aveugle de l'e-mail,
// migration des commandes en clair au démarrage, aucune donnée client lisible dans la base.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const Pii = require('../src/pii');

test('module : aller-retour, falsification, liaison à la commande, trousseau, index par boutique', () => {
  const cle = crypto.randomBytes(32), K = Pii.creer(cle), ctx = { boutique: 'b1', commande: 'c1' };
  const client = { nom: 'Élodie Martin', email: 'Elodie@Exemple.fr', adresse: '3 rue Haute', npa: '69002', ville: 'Lyon' };
  const c = K.chiffrer(client, ctx);
  assert.match(c, /^v2\.[A-Za-z0-9_-]+$/); assert.ok(!c.includes('Martin'));
  assert.deepEqual(K.dechiffrer(c, ctx), client);
  assert.notEqual(K.chiffrer(client, ctx), c, 'vecteur aléatoire : deux chiffrés différents');
  const b = Buffer.from(c.slice(3), 'base64url'); b[b.length - 1] ^= 1;
  assert.throws(() => K.dechiffrer(`v2.${b.toString('base64url')}`, ctx), 'falsification détectée');
  assert.throws(() => K.dechiffrer(c, { boutique: 'b2', commande: 'c1' }), 'recopié dans une autre boutique : refusé');
  assert.throws(() => K.dechiffrer(c, { boutique: 'b1', commande: 'c2' }), 'recopié dans une autre commande : refusé');
  assert.throws(() => K.dechiffrer(`v2.${b.subarray(0, 20).toString('base64url')}`, ctx), 'étiquette tronquée refusée');
  assert.throws(() => Pii.creer(crypto.randomBytes(32)).dechiffrer(c, ctx), 'autre clé : illisible');
  // Trousseau : nouvelle clé courante, l'ancienne déchiffre encore (à renouveler).
  const K2 = Pii.creer([crypto.randomBytes(32), cle]);
  assert.deepEqual(K2.dechiffrer(c, ctx), client); assert.equal(K2.aRenouveler(c, ctx), true); assert.equal(K.aRenouveler(c, ctx), false);
  // Lecture tolérante : client « illisible », chiffré d'origine conservé à l'écriture.
  const lu = Pii.creer(crypto.randomBytes(32)).depuisStockage({ a: 1, clientChiffre: c }, ctx);
  assert.equal(lu.client.illisible, true);
  assert.deepEqual(K.versStockage(lu, ctx), { a: 1, clientChiffre: c }, 'jamais écrasé');
  // Index : sans casse ni espaces, différent d'une boutique à l'autre.
  assert.equal(K.index('b1', 'elodie@exemple.fr'), K.index('b1', ' ELODIE@exemple.FR '));
  assert.notEqual(K.index('b1', 'elodie@exemple.fr'), K.index('b2', 'elodie@exemple.fr'));
  assert.deepEqual(K.depuisStockage(K.versStockage({ a: 1, client }, ctx), ctx), { a: 1, client });
  assert.deepEqual(K.depuisStockage({ a: 1, client }, ctx), { a: 1, client }, 'ancienne commande en clair lue telle quelle');
});

test('serveur : commandes chiffrées, recherche par e-mail, migration au démarrage, effacement', async () => {
  const db = ouvrir(':memory:');
  const env = { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' };
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  let app = creerApp({ db, env, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', (q, r) => app(q, r));
  let cookie = '';
  const appel = async (m, chemin, corps, session = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && session ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && session) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  try {
    await appel('POST', '/api/auth/inscription', { email: 'pii@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Pii', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'P SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [{ nom: 'Vase', prix: 40, stock: 50, type: 'stock' }] });
    const produit = (await appel('GET', '/api/admin/etat')).json.produits[0].id, slug = db.prepare('SELECT slug FROM boutiques').get().slug;
    const client = { nom: 'Élodie Martin', email: 'elodie@exemple.fr', adresse: '3 rue des Secrets', npa: '69002', ville: 'Lyon' };
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client }, false);
    await appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    // Base : rien de lisible sur le client ; index aveugle renseigné.
    const row = db.prepare('SELECT donnees, email_index FROM commandes WHERE id = ?').get(cmd.json.commandeId);
    for (const t of ['Martin', 'elodie@', 'Secrets', '69002']) assert.ok(!row.donnees.includes(t), `« ${t} » absent de la base`);
    assert.match(row.email_index, /^[0-9a-f]{40}$/);
    // Espace marchand et suivi client : lisibles.
    const c = (await appel('GET', '/api/admin/etat')).json.commandes.find(x => x.id === cmd.json.commandeId);
    assert.equal(c.client.nom, 'Élodie Martin'); assert.equal(c.client.adresse, '3 rue des Secrets');
    // Recherche par e-mail (« mes commandes ») : passe par l'index.
    assert.equal((await appel('POST', `/api/public/${slug}/mes-commandes`, { email: 'ELODIE@exemple.fr' }, false)).statut, 200);
    assert.match(db.prepare("SELECT corps FROM emails WHERE destinataire = 'elodie@exemple.fr' ORDER BY rowid DESC").get().corps, new RegExp(`${c.numero}`), 'e-mail « mes commandes » envoyé');
    // Commande ancienne, en clair (avant le chiffrement) : chiffrée au redémarrage, sans perte.
    db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run('c_ancienne', db.prepare('SELECT id FROM boutiques').get().id, 999, Date.now() - 86400000, 'livree', 'j', JSON.stringify({ client: { nom: 'Ancien Client', email: 'ancien@exemple.fr', ville: 'Nyon' }, lignes: [{ nom: 'Vase', prix: 40, qte: 1 }], total: 40, historique: [] }));
    app = creerApp({ db, env, urlPublique: base, journal: { log() {}, error() {} } });
    const r2 = db.prepare('SELECT donnees, email_index FROM commandes WHERE id = ?').get('c_ancienne');
    assert.ok(!r2.donnees.includes('Ancien Client') && r2.email_index);
    assert.equal((await appel('GET', '/api/admin/etat')).json.commandes.find(x => x.id === 'c_ancienne').client.nom, 'Ancien Client');
    // Donnée falsifiée : la boutique reste utilisable (client « illisible »), le chiffré n'est pas écrasé.
    const bid = db.prepare('SELECT id FROM boutiques').get().id;
    const r3 = db.prepare('SELECT donnees FROM commandes WHERE id = ?').get('c_ancienne'), d3 = JSON.parse(r3.donnees);
    d3.clientChiffre = d3.clientChiffre.slice(0, -6) + 'AAAAAA'; db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(JSON.stringify(d3), 'c_ancienne');
    const etat = await appel('GET', '/api/admin/etat'); assert.equal(etat.statut, 200);
    assert.equal(etat.json.commandes.find(x => x.id === 'c_ancienne').client.illisible, true);
    assert.equal((await appel('PATCH', '/api/admin/commandes/c_ancienne', { note: 'x' })).statut, 200);
    assert.equal(JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get('c_ancienne').donnees).clientChiffre, d3.clientChiffre, 'chiffré d’origine conservé');
    // Lignes abîmées ou client vide : le démarrage ne bloque pas et ne boucle pas.
    db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run('c_vide', bid, 997, Date.now(), 'livree', 'j', JSON.stringify({ client: '', lignes: [] }));
    db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run('c_abimee', bid, 996, Date.now(), 'livree', 'j', '{abîmé');
    app = creerApp({ db, env, urlPublique: base, journal: { log() {}, error() {} } });
    db.prepare('DELETE FROM commandes WHERE id = ?').run('c_abimee');
    // Nouvelle clé SECRET_CHIFFREMENT, sans lister la clé de la base : rien n'est lu avec elle (une copie volée de la base
    // ne doit rien pouvoir signer ni déchiffrer de neuf), rien n'est écrasé, et l'exploitant est prévenu.
    const nouvelle = crypto.randomBytes(32).toString('hex'), alertes = [];
    app = creerApp({ db, env: { ...env, SECRET_CHIFFREMENT: nouvelle }, urlPublique: base, journal: { log() {}, error: (...x) => alertes.push(x.join(' ')) } });
    assert.ok(alertes.some(x => /clé gardée dans la base a servi/.test(x)), alertes.join('\n'));
    assert.equal((await appel('GET', '/api/admin/etat')).json.commandes.find(x => x.id === cmd.json.commandeId).client.nom, '(données client illisibles)');
    // L'exploitant liste la clé de la base dans SECRET_CHIFFREMENT_ANCIENNES : tout est rechiffré, rien n'est perdu.
    const cleBase = db.prepare("SELECT valeur FROM cles WHERE nom = 'chiffrement'").get().valeur;
    app = creerApp({ db, env: { ...env, SECRET_CHIFFREMENT: nouvelle, SECRET_CHIFFREMENT_ANCIENNES: cleBase }, urlPublique: base, journal: { log() {}, error() {} } });
    const apres = await appel('GET', '/api/admin/etat'); assert.equal(apres.statut, 200);
    assert.equal(apres.json.commandes.find(x => x.id === cmd.json.commandeId).client.nom, 'Élodie Martin');
    // Effacement d'un client : effacé aussi dans le chiffré.
    db.prepare("UPDATE commandes SET statut = 'livree'").run();
    assert.equal((await appel('POST', '/api/admin/clients/effacer', { email: 'elodie@exemple.fr' })).statut, 200);
    assert.equal((await appel('GET', '/api/admin/etat')).json.commandes.find(x => x.id === cmd.json.commandeId).client.nom, 'Client effacé');
  } finally { s.close(); }
});
