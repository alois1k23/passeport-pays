// Cartes cadeaux : code secret (empreinte seule en base), débit atomique, registre, paiement en ligne et en caisse,
// annulation, remboursement, paiement abandonné puis repris, limites d'essais.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const CC = require('../src/cartes-cadeaux');

test('module : code, empreinte, saisie tolérante, débit atomique, registre', () => {
  const db = ouvrir(':memory:'), K = CC.creer(db, crypto.randomBytes(32));
  const { carte, code } = K.emettre('b1', { montant: 50, devise: 'EUR' });
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.equal(carte.solde, 50); assert.equal(carte.fin, code.slice(-4));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cartes_cadeaux').all()).includes(code.replace(/-/g, '')), 'code jamais stocké en clair');
  const brut = code.replace(/-/g, '');
  assert.ok(K.trouver('b1', brut.toLowerCase()), 'minuscules et sans tirets');
  assert.ok(K.trouver('b1', ` ${code.replace(/0/g, 'O')} `), 'O lu comme 0');
  assert.equal(K.trouver('b2', code), null, 'carte d’une autre boutique');
  assert.equal(K.trouver('b1', 'AAAA-AAAA-AAAA-AAAA'), null);
  const row = K.trouver('b1', code);
  assert.equal(K.debiter(row.id, 3000), true); assert.equal(K.debiter(row.id, 2001), false, 'solde insuffisant : rien n’est débité');
  assert.equal(K.debiter(row.id, 2000), true); assert.equal(K.debiter(row.id, 1), false);
  K.crediter(row.id, 500, { type: 'remboursement' });
  assert.equal(K.disponible(K.trouver('b1', code)), 500);
  assert.deepEqual(K.verifier('b1'), []);
  const { mouvements } = K.detail('b1', row.id);
  assert.deepEqual(mouvements.map(m => [m.type, m.montant, m.solde]), [['emission', 50, 50], ['utilisation', -30, 20], ['utilisation', -20, 0], ['remboursement', 5, 5]]);
  // Expirée ou désactivée : plus utilisable.
  const exp = K.emettre('b1', { montant: 10, devise: 'EUR', expireLe: Date.now() - 1 });
  assert.equal(K.disponible(K.trouver('b1', exp.code)), 0); assert.equal(K.debiter(exp.carte.id, 100), false);
  K.desactiver('b1', row.id); assert.equal(K.debiter(row.id, 100), false);
  assert.throws(() => K.emettre('b1', { montant: 0.5, devise: 'EUR' }), /entre 1 et 10 000/);
  assert.throws(() => K.emettre('b1', { montant: 20000, devise: 'EUR' }), /entre 1 et 10 000/);
  // Altération du registre détectée.
  db.prepare('UPDATE cartes_cadeaux SET solde = solde + 100 WHERE id = ?').run(exp.carte.id);
  assert.deepEqual(K.verifier('b1'), [exp.carte.id]);
});

async function boutique(envPlus = {}) {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const app = creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non', ...envPlus }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', app);
  let cookie = '';
  const appel = async (m, chemin, corps, avecSession = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecSession ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && avecSession) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.clone().json(); } catch { /* pas du JSON */ } return { statut: r.status, json }; };
  const conf = { boutique: { nom: 'Cadeaux', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Cadeaux SAS', adresse: '5 rue Neuve, 69001 Lyon', email: 'c@exemple.fr', tvaIntra: 'FR12345678901', siret: '12345678901234' } };
  assert.equal((await appel('POST', '/api/auth/inscription', { email: 'cc@exemple.fr', motDePasse: 'un mot de passe solide', config: conf, produits: [{ nom: 'Vase', prix: 40, stock: 50, type: 'stock' }] })).statut, 201);
  const etat = (await appel('GET', '/api/admin/etat')).json;
  return { db, s, base, app, appel, slug: db.prepare('SELECT slug FROM boutiques').get().slug, produit: etat.produits[0].id };
}
const client = { nom: 'Lou Martin', email: 'lou@exemple.fr', adresse: '3 rue Haute', npa: '69002', ville: 'Lyon' };

test('en ligne : carte partielle, totale, paiement abandonné puis repris, annulation, remboursement', async () => {
  const { db, s, appel, slug, produit, app } = await boutique();
  try {
    const emise = await appel('POST', '/api/admin/cartes-cadeaux', { montant: 50, destinataire: 'Lou' });
    assert.equal(emise.statut, 201); const code = emise.json.code;
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 50);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, false)).statut, 404);

    // 1 vase (40 €) + 5,90 € de port : la carte paie tout. Commande payée sans paiement en ligne, facture émise.
    const port = (await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code.toLowerCase() }, false));
    assert.equal(port.statut, 201, JSON.stringify(port.json)); assert.equal(port.json.payeeParCarte, true);
    let c = (await appel('GET', `/api/admin/commandes/${port.json.commandeId}`)).json;
    c = c && c.commande ? c.commande : JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(port.json.commandeId).donnees);
    const statut1 = db.prepare('SELECT statut FROM commandes WHERE id = ?').get(port.json.commandeId).statut;
    assert.equal(statut1, 'payee'); assert.ok(c.facture); assert.equal(c.carteCadeau.montant, 45.9);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 4.1);

    // 2 vases (76 € après la remise par palier, port offert) : 4,10 € sur la carte, 71,90 € en ligne. Le paiement en ligne porte sur le reste.
    const mixte = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 2 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    assert.equal(mixte.statut, 201); assert.match(mixte.json.paiementUrl, /paiement-simule/);
    const pid = mixte.json.paiementUrl.split('/').pop();
    assert.equal(db.prepare('SELECT montant_centimes FROM paiements WHERE id = ?').get(pid).montant_centimes, 7190);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).statut, 409, 'solde réservé par la commande en attente : message distinct');
    // Carte réservée : une seconde commande est refusée (409, montant réservé), rien n'est débité.
    assert.equal((await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false)).statut, 409);

    // Paiement abandonné : 2 heures plus tard, la carte est recréditée et le lien fermé.
    app.automatisationsEcheances(Date.now() + 2 * 3600000 + 60000);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 4.1);
    assert.equal(db.prepare('SELECT statut FROM paiements WHERE id = ?').get(pid).statut, 'annule');
    // Le client reprend son paiement : la carte est débitée à nouveau, le nouveau lien porte sur le reste.
    const jeton = mixte.json.jeton;
    const rep = await appel('POST', `/api/public/${slug}/commandes/${mixte.json.commandeId}/reprendre`, { jeton }, false);
    assert.equal(rep.statut, 200, JSON.stringify(rep.json));
    const pid2 = rep.json.paiementUrl.split('/').pop();
    assert.equal(db.prepare('SELECT montant_centimes FROM paiements WHERE id = ?').get(pid2).montant_centimes, 7190);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).statut, 409);
    // Relance de la maintenance peu après la reprise : la réservation (comptée depuis la reprise) n'est pas libérée.
    app.automatisationsEcheances(Date.now() + 5 * 60000);
    assert.equal(db.prepare('SELECT statut FROM paiements WHERE id = ?').get(pid2).statut, 'cree', 'nouveau lien intact');
    assert.equal((await appel('POST', `/paiement-simule/${pid2}/confirmer`, null, false)).statut, 303);
    assert.equal(db.prepare('SELECT statut FROM commandes WHERE id = ?').get(mixte.json.commandeId).statut, 'payee');

    // Remboursement : la part de la carte revient sur la carte.
    assert.equal((await appel('POST', `/api/admin/commandes/${mixte.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 200);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 4.1);
    // Annulation d'une commande en attente : la réservation revient aussi.
    const att = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    assert.equal((await appel('POST', `/api/admin/commandes/${att.json.commandeId}/statut`, { statut: 'annulee' })).statut, 200);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 4.1);
    // Annulation puis passage du nettoyage : pas de second crédit.
    app.automatisationsEcheances(Date.now() + 4 * 3600000);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 4.1);

    const liste = (await appel('GET', '/api/admin/cartes-cadeaux')).json;
    assert.equal(liste.registreCoherent, true); assert.equal(liste.cartes[0].solde, 4.1);
    assert.ok(!JSON.stringify(liste).includes(code.replace(/-/g, '')), 'le code n’est plus jamais renvoyé');
  } finally { s.close(); }
});

test('paiement reçu après libération, alors que la carte a été vidée ailleurs : argent à rendre, commande non payée', async () => {
  const { db, s, appel, slug, produit, app } = await boutique();
  try {
    const { code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 30 })).json;
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    const pid = cmd.json.paiementUrl.split('/').pop();
    app.automatisationsEcheances(Date.now() + 3 * 3600000);
    db.prepare("UPDATE paiements SET statut = 'cree' WHERE id = ?").run(pid);   // lien encore ouvert chez le prestataire
    // La carte sert entre-temps en caisse.
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'carte', carteCadeau: code, cle: 'cc1' })).statut, 201);
    await appel('POST', `/paiement-simule/${pid}/confirmer`, null, false);
    assert.equal(db.prepare('SELECT statut FROM commandes WHERE id = ?').get(cmd.json.commandeId).statut, 'attente');
    assert.equal(db.prepare('SELECT statut FROM paiements WHERE id = ?').get(pid).statut, 'a_rembourser');
  } finally { s.close(); }
});

test('caisse : carte puis reste en espèces, hors ligne refusé ; droits et limites', async () => {
  const { db, s, appel, slug, produit } = await boutique();
  try {
    const { code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 25, expireMois: 12 })).json;
    const v = await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'especes', carteCadeau: code, cle: 'k1' });
    assert.equal(v.statut, 201); assert.match(v.json.carteCadeau, /25,00/); assert.match(v.json.reste, /15,00/); assert.match(v.json.soldeCarte, /0,00/);
    const c = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(v.json.id).donnees);
    assert.equal(c.carteCadeau.montant, 25); assert.equal(c.total, 40);
    // Même ticket renvoyé : pas de second débit.
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'especes', carteCadeau: code, cle: 'k1' })).json.id, v.json.id);
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'carte', carteCadeau: code, cle: 'k2' })).statut, 400, 'carte épuisée');
    const autre = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 10 })).json.code;
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'carte', carteCadeau: autre, horsLigneLe: Date.now() - 60000, cle: 'k3' })).statut, 400, 'hors ligne : refusée');
    // Validations
    assert.equal((await appel('POST', '/api/admin/cartes-cadeaux', { montant: 'abc' })).statut, 400);
    assert.equal((await appel('POST', '/api/admin/cartes-cadeaux', { montant: 10, expireMois: 0 })).statut, 400);
    // Sans session
    assert.equal((await appel('POST', '/api/admin/cartes-cadeaux', { montant: 10 }, false)).statut, 401);
    assert.equal((await appel('GET', '/api/admin/cartes-cadeaux', null, false)).statut, 401);
    // Essais de codes au hasard : bloqués après 20.
    let dernier = 0;
    for (let i = 0; i < 22; i++) dernier = (await appel('POST', `/api/public/${slug}/carte-cadeau`, { code: crypto.randomBytes(8).toString('hex') }, false)).statut;
    assert.equal(dernier, 429);
  } finally { s.close(); }
});

test('relecture : payée à la main après libération, abandon du paiement, minimum de 0,50, vérification en caisse', async () => {
  const { db, s, appel, slug, produit, app } = await boutique({ LIMITES_FACTEUR: '5' });   // nombreuses commandes impayées depuis une même adresse
  try {
    // Marquée payée à la main après la libération : la carte est débitée à nouveau (sinon sa part serait offerte).
    let { code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 20 })).json;
    let cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    app.automatisationsEcheances(Date.now() + 3 * 3600000);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 20);
    assert.equal((await appel('POST', `/api/admin/commandes/${cmd.json.commandeId}/statut`, { statut: 'payee' })).statut, 200);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).statut, 404, 'carte débitée');
    // Si la carte a été vidée entre-temps : refus clair, commande inchangée.
    ({ code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 20 })).json);
    cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    app.automatisationsEcheances(Date.now() + 3 * 3600000);
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'carte', carteCadeau: code, cle: 'vide' })).statut, 201);
    const r = await appel('POST', `/api/admin/commandes/${cmd.json.commandeId}/statut`, { statut: 'payee' });
    assert.equal(r.statut, 409); assert.equal(db.prepare('SELECT statut FROM commandes WHERE id = ?').get(cmd.json.commandeId).statut, 'attente');

    // Paiement annulé par le client : la carte revient tout de suite, un nouvel essai fonctionne.
    ({ code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 15 })).json);
    cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${cmd.json.commandeId}/abandonner`, { jeton: 'faux' }, false)).statut, 404);
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${cmd.json.commandeId}/abandonner`, { jeton: cmd.json.jeton }, false)).statut, 200);
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${cmd.json.commandeId}/abandonner`, { jeton: cmd.json.jeton }, false)).statut, 200, 'idempotent');
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 15);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM paiements WHERE commande_id = ? AND statut = 'cree'").get(cmd.json.commandeId).n, 0);
    assert.equal((await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false)).statut, 201);

    // Reste inférieur au minimum du prestataire (0,50) : la carte laisse 0,50 à payer en ligne.
    ({ code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 45.7 })).json);
    cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    const pid = cmd.json.paiementUrl.split('/').pop();
    assert.equal(db.prepare('SELECT montant_centimes FROM paiements WHERE id = ?').get(pid).montant_centimes, 50);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 0.3, 'le reste de la carte reste utilisable');

    // Caisse : vérification du solde avant d'encaisser ; seuls les échecs sont limités.
    ({ code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 12 })).json);
    for (let i = 0; i < 40; i++) assert.equal((await appel('POST', '/api/admin/caisse/carte', { code })).json.solde, 12);
    let dernier = 0; for (let i = 0; i < 152; i++) dernier = (await appel('POST', '/api/admin/caisse/carte', { code: 'AAAA-BBBB-CCCC-DDDD' })).statut;
    assert.equal(dernier, 429);
  } finally { s.close(); }
});

test('Belgique : validité d’au moins 2 ans', async () => {
  const { db, s, appel } = await boutique();
  try {
    const cfg = JSON.parse(db.prepare('SELECT config FROM boutiques').get().config); cfg.boutique.pays = 'be';
    db.prepare('UPDATE boutiques SET config = ?').run(JSON.stringify(cfg));
    assert.equal((await appel('POST', '/api/admin/cartes-cadeaux', { montant: 10, expireMois: 12 })).statut, 400);
    assert.equal((await appel('POST', '/api/admin/cartes-cadeaux', { montant: 10, expireMois: 24 })).statut, 201);
  } finally { s.close(); }
});

test('vente en ligne : achat, paiement, carte émise et envoyée au destinataire, sans facture ; remboursement', async () => {
  const { db, s, appel, slug } = await boutique();
  try {
    assert.equal((await appel('POST', `/api/public/${slug}/cartes-cadeaux/achat`, { montant: 50, client: { nom: 'Léa', email: 'lea@exemple.fr' } }, false)).statut, 404, 'vente inactive');
    assert.equal((await appel('PUT', '/api/admin/cartes-cadeaux/vente', { actif: true, montants: [2] })).statut, 400);
    assert.deepEqual((await appel('PUT', '/api/admin/cartes-cadeaux/vente', { actif: true, montants: [100, 30, 50, 50], validiteMois: 24 })).json.vente.montants, [30, 50, 100]);
    assert.deepEqual((await appel('GET', '/api/admin/cartes-cadeaux/vente')).json.vente.montants, [30, 50, 100]);
    assert.deepEqual((await appel('GET', `/api/public/${slug}`, null, false)).json.cartesCadeaux, { montants: [30, 50, 100] });
    assert.equal((await appel('POST', `/api/public/${slug}/cartes-cadeaux/achat`, { montant: 42, client: { nom: 'Léa', email: 'lea@exemple.fr' } }, false)).statut, 400, 'montant hors liste');
    const a = await appel('POST', `/api/public/${slug}/cartes-cadeaux/achat`, { montant: 50, client: { nom: 'Léa Martin', email: 'lea@exemple.fr' }, destinataire: { nom: 'Tom', email: 'tom@exemple.fr' }, message: 'Joyeux anniversaire !' }, false);
    assert.equal(a.statut, 201);
    const pid = a.json.paiementUrl.split('/').pop();
    assert.equal(db.prepare('SELECT montant_centimes FROM paiements WHERE id = ?').get(pid).montant_centimes, 5000);
    await appel('POST', `/paiement-simule/${pid}/confirmer`, null, false);
    const c = (await appel('GET', '/api/admin/etat')).json.commandes.find(x => x.id === a.json.commandeId);
    assert.equal(c.statut, 'payee'); assert.equal(c.facture, undefined, 'pas de facture pour un bon à usages multiples'); assert.ok(c.carteEmise);
    const mail = db.prepare("SELECT corps FROM emails WHERE destinataire = 'tom@exemple.fr'").get().corps;
    assert.match(mail, /offerte par Léa Martin/); assert.match(mail, /Joyeux anniversaire/);
    const code = /Code : ([0-9A-Z-]{19})/.exec(mail)[1];
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 50);
    assert.ok(!JSON.stringify(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(a.json.commandeId)).includes('tom@exemple.fr'), 'destinataire chiffré avec le client');
    // Remboursement : la carte non utilisée est désactivée.
    assert.equal((await appel('POST', `/api/admin/commandes/${a.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 200);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).statut, 404);
    // Une carte déjà utilisée ne se rembourse plus en entier.
    const b2 = await appel('POST', `/api/public/${slug}/cartes-cadeaux/achat`, { montant: 30, client: { nom: 'Léa', email: 'lea@exemple.fr' } }, false);
    await appel('POST', `/paiement-simule/${b2.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    const code2 = /Code : ([0-9A-Z-]{19})/.exec(db.prepare("SELECT corps FROM emails WHERE destinataire = 'lea@exemple.fr' AND sujet LIKE 'Votre carte cadeau%' AND sujet NOT LIKE '%est partie' ORDER BY rowid DESC").get().corps)[1];
    const produit = (await appel('GET', '/api/admin/etat')).json.produits[0].id;
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'carte', carteCadeau: code2, cle: 'v1' })).statut, 201);
    assert.equal((await appel('POST', `/api/admin/commandes/${b2.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 409);
  } finally { s.close(); }
});

test('webhook « carte.emise » : envoyé sans le code de la carte', async () => {
  const { db, s, appel } = await boutique({ INTEGRATIONS_HTTP_LOCAL: '1' });   // point d'arrivée local accepté pour le test
  try {
    const wh = await appel('POST', '/api/admin/integrations/webhooks', { url: 'http://127.0.0.1:9/carte', evenements: ['carte.emise'] });
    assert.equal(wh.statut, 201, JSON.stringify(wh.json));
    const { code } = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 40 })).json;
    const e = db.prepare("SELECT e.id, e.corps, w.boutique_id FROM webhook_envois e JOIN webhooks w ON w.id = e.webhook_id WHERE e.evenement = 'carte.emise'").get();
    const P = require('../src/pii').creer(Buffer.from(db.prepare("SELECT valeur FROM cles WHERE nom = 'chiffrement'").get().valeur, 'hex'));
    const corps = P.dechiffrer(e.corps, { boutique: e.boutique_id, commande: `webhook:${e.id}` }).corps, d = JSON.parse(corps).donnees;
    assert.equal(d.montant, 40); assert.equal(d.fin, code.slice(-4));
    assert.ok(!corps.includes(code) && !corps.includes(code.replace(/-/g, '')), 'jamais le code complet');
  } finally { s.close(); }
});

test('relecture de la vente : pas d’argent rendu si la carte a servi, pas d’expédition, message sans lien, montants décimaux', async () => {
  const { db, s, appel, slug } = await boutique();
  try {
    assert.deepEqual((await appel('PUT', '/api/admin/cartes-cadeaux/vente', { actif: true, montants: [19.99, 50] })).json.vente.montants, [19.99, 50], '19,99 accepté');
    const achat = await appel('POST', `/api/public/${slug}/cartes-cadeaux/achat`, { montant: 50, client: { nom: 'Léa', email: 'lea@exemple.fr' }, destinataire: { email: 'tom@exemple.fr' }, message: 'Votre compte est suspendu, activez-le ici : https://evil.example/x ou evil.example' }, false);
    const pid = achat.json.paiementUrl.split('/').pop();
    // Une carte cadeau ne se marque pas payée à la main ; elle se paie en ligne.
    assert.equal((await appel('POST', `/api/admin/commandes/${achat.json.commandeId}/statut`, { statut: 'payee' })).statut, 409);
    await appel('POST', `/paiement-simule/${pid}/confirmer`, null, false);
    const mail = db.prepare("SELECT corps FROM emails WHERE destinataire = 'tom@exemple.fr'").get().corps;
    assert.doesNotMatch(mail, /evil\.example/, 'aucun lien de l’acheteur dans l’e-mail'); assert.match(mail, /\[…\]/);
    assert.match(mail, /texte libre, non vérifié par la boutique/);
    // Pas d'expédition possible ; pas d'offre complémentaire.
    assert.equal((await appel('POST', `/api/admin/commandes/${achat.json.commandeId}/statut`, { statut: 'expediee' })).statut, 409);
    // La carte sert, puis le remboursement est refusé AVANT tout mouvement d'argent.
    const code = /Code : ([0-9A-Z-]{19})/.exec(db.prepare("SELECT corps FROM emails WHERE destinataire = 'tom@exemple.fr'").get().corps)[1];
    const produit = (await appel('GET', '/api/admin/etat')).json.produits[0].id;
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 1 }], moyen: 'carte', carteCadeau: code, cle: 'w1' })).statut, 201);
    assert.equal((await appel('POST', `/api/admin/commandes/${achat.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 409);
    assert.equal(db.prepare('SELECT statut FROM paiements WHERE id = ?').get(pid).statut, 'paye', 'argent non rendu');
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 10, 'carte toujours active');
  } finally { s.close(); }
});

test('export pour la fiduciaire : mouvements de la période, encours en fin de période, soldes expirés à part, pas de formule', () => {
  const db = ouvrir(':memory:'), K = CC.creer(db, crypto.randomBytes(32)), j = 86400000, t0 = Date.UTC(2026, 0, 10);
  const a = K.emettre('b1', { montant: 50, devise: 'CHF', maintenant: t0, origine: 'vente', commandeId: 'c1' });
  const b = K.emettre('b1', { montant: 20, devise: 'CHF', maintenant: t0 + j, expireLe: t0 + 30 * j });
  K.debiter(a.carte.id, 1500, { commandeId: 'c2', texte: '=HYPERLINK("x")', maintenant: t0 + 5 * j });
  K.emettre('b2', { montant: 99, devise: 'CHF', maintenant: t0 });   // autre boutique : absente
  const csv = K.exporter('b1', { debut: t0, fin: t0 + 60 * j, numeros: new Map([['c1', 1001], ['c2', 1002]]) });
  const lignes = csv.replace(/^﻿/, '').trim().split('\n');
  assert.equal(lignes.length, 1 + 3 + 3, 'en-tête, 3 mouvements, ligne vide et 2 lignes de synthèse');
  assert.match(lignes[1], /"vendue";"Émission";50\.00;50\.00;"1001"/);
  assert.match(lignes[3], /"Utilisation";-15\.00;35\.00;"1002";"'=HYPERLINK/, 'texte neutralisé pour le tableur');
  assert.match(csv, /"Encours au 2026-03-10";"1 carte\(s\)";;"Solde des cartes actives non expirées";35\.00/);
  assert.match(csv, /"Soldes non utilisables";;;"Cartes expirées ou désactivées[^"]*";20\.00/);
  assert.doesNotMatch(csv, /99\.00/);
  // Encours à une date passée : avant l'utilisation, 50 + 20.
  assert.match(K.exporter('b1', { debut: t0, fin: t0 + 3 * j }), /"2 carte\(s\)";;"Solde des cartes actives non expirées";70\.00/);
  assert.equal(b.carte.solde, 20);
});
