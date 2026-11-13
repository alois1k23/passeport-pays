// Programme de fidélité : gain au paiement, utilisation avec code reçu par e-mail, remise appliquée aux prix (TVA juste),
// annulation, points engagés non comptés deux fois, expiration, anti-énumération, droits.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const Fid = require('../src/fidelite');
const F = require('../src/facture-electronique');

test('module : remise répartie sur les prix, plafond, seuil, registre, expiration, codes', () => {
  const reg = { ...Fid.DEFAUT, actif: true };
  const lignes = [{ nom: 'A', prix: 19.9, qte: 3, tauxTva: 0.2 }, { nom: 'B', prix: 7.35, qte: 2, tauxTva: 0.055 }];
  assert.equal(Fid.appliquerPoints(lignes, reg, 99), null, 'sous le seuil');
  const r = Fid.appliquerPoints(lignes, reg, 400);   // 400 points = 20,00
  const avant = Math.round((19.9 * 3 + 7.35 * 2) * 100), apres = Math.round(r.lignes.reduce((a, l) => a + l.prix * l.qte, 0) * 100);
  assert.equal(avant - apres, r.remise); assert.ok(Math.abs(r.remise - 2000) <= 5); assert.ok(r.points <= 400);
  const plafond = Fid.appliquerPoints(lignes, reg, 100000);
  assert.ok(plafond.remise <= Math.floor(avant / 2) + 5, 'au plus la moitié des articles');
  // La facture électronique d'une commande remisée en points est cohérente.
  const c = { numero: 1, facture: 'FA-1', date: Date.now(), statut: 'payee', lignes: r.lignes, port: 5.9, total: Math.round((apres + 590)) / 100, client: { nom: 'X' } };
  assert.deepEqual(F.verifier(F.produire(c, { boutique: { pays: 'fr', nom: 'X' }, entreprise: { raison: 'X', adresse: 'R 1, 75001 Paris', tvaIntra: 'FR1' } })), []);

  const db = ouvrir(':memory:'), K = Fid.creer(db, crypto.randomBytes(32)); K.ecrireReglages('b', { actif: true });   // programme actif : l'expiration s'applique
  K.crediter('b', 'Lou@Exemple.fr', 150, { commandeId: 'c1' });
  assert.equal(K.solde('b', 'lou@exemple.fr'), 150, 'e-mail sans casse');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM fidelite_comptes').all()).includes('lou@'), 'e-mail jamais stocké en clair');
  assert.equal(K.debiter('b', 'lou@exemple.fr', 200), 150, 'débit borné au solde');
  assert.equal(K.solde('b', 'lou@exemple.fr'), 0);
  K.crediter('b', 'lou@exemple.fr', 80);
  assert.equal(K.solde('b', 'lou@exemple.fr', Date.now() + 25 * 31 * 86400000), 0, 'expiré après 24 mois d’inactivité');
  assert.deepEqual(K.verifier('b'), []);
  const { code, demande } = K.nouveauCode('b', 'lou@exemple.fr');
  assert.equal(K.verifierCode('b', 'autre@exemple.fr', code, { demande }), false);
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code), false, 'sans la demande : refusé');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code, { demande: 'autre' }), false, 'autre demande : refusé');
  for (let i = 0; i < 5; i++) assert.equal(K.verifierCode('b', 'lou@exemple.fr', '000000' === code ? '111111' : '000000', { demande, reseau: 'r1' }), false);
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code, { demande }), false, 'bloqué après 5 erreurs');
  const d2 = K.nouveauCode('b', 'lou@exemple.fr');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', d2.code, { demande: d2.demande, maintenant: Date.now() + 16 * 60000 }), false, 'expiré après 15 minutes');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', d2.code, { demande: d2.demande, consommer: true }), true);
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', d2.code, { demande: d2.demande }), false, 'à usage unique');
  // Un tiers qui connaît l'adresse épuise ses essais (réseau r1), pas ceux du client sur son réseau (r2).
  for (let i = 0; i < 2; i++) { const t = K.nouveauCode('b', 'lou@exemple.fr'); for (let j = 0; j < 5; j++) K.verifierCode('b', 'lou@exemple.fr', t.code === '000000' ? '111111' : '000000', { demande: t.demande, reseau: 'r1' }); }
  const t3 = K.nouveauCode('b', 'lou@exemple.fr');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', t3.code, { demande: t3.demande, reseau: 'r1' }), false, 'réseau de l’attaquant bloqué');
  const v = K.nouveauCode('b', 'lou@exemple.fr');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', v.code, { demande: v.demande, reseau: 'r2' }), true, 'le client, chez lui, n’est pas bloqué');
  // Même adresse en NFD et en NFC : un seul compte.
  K.crediter('b', 'lo\u00fc@exemple.fr', 10); assert.equal(K.solde('b', 'lou\u0308@exemple.fr'), 10, 'ü composé (NFC) ou décomposé (NFD) : même compte');
  assert.throws(() => Fid.lireReglages({ pointsParUnite: 0 }), /entre 1 et 100/);
});

test('parcours : gain, code par e-mail, utilisation, annulation ; anti-énumération et droits', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error: (...a) => process.env.DBG && console.error(...a) } }));
  let cookie = '';
  const appel = async (m, chemin, corps, session = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && session ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && session) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  try {
    assert.equal((await appel('POST', '/api/auth/inscription', { email: 'fid@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Fidèle', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'F SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [{ nom: 'Vase', prix: 100, stock: 50, type: 'stock' }] })).statut, 201);
    const produit = (await appel('GET', '/api/admin/etat')).json.produits[0].id, slug = db.prepare('SELECT slug FROM boutiques').get().slug;
    const client = { nom: 'Lou', email: 'lou@exemple.fr', adresse: '3 rue Haute', npa: '69002', ville: 'Lyon' };
    const commander = async corps => appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, ...corps }, false);
    const payer = async cmd => appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    // Programme inactif : rien.
    assert.equal((await appel('POST', `/api/public/${slug}/fidelite/code`, { email: client.email }, false)).statut, 404);
    assert.equal((await appel('PUT', '/api/admin/fidelite', { actif: true, pointsParUnite: 2, valeurPour100: 500, seuil: 100, plafondPct: 50, expirationMois: 24 })).statut, 200);
    assert.equal((await appel('GET', `/api/public/${slug}`, null, false)).json.fidelite.pointsParUnite, 2);
    // 1re commande payée (100 €) : 200 points.
    let cmd = await commander({}); await payer(cmd);
    assert.equal((await appel('GET', '/api/admin/fidelite')).json.stats.points, 200);
    // Code : même réponse pour une adresse sans points, et aucun e-mail envoyé à cette adresse.
    const inconnu = (await appel('POST', `/api/public/${slug}/fidelite/code`, { email: 'inconnu@exemple.fr' }, false)).json;
    assert.deepEqual(Object.keys(inconnu).sort(), ['demande', 'ok']); assert.match(inconnu.demande, /^[\w-]{24}$/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE destinataire = 'inconnu@exemple.fr'").get().n, 0);
    const connu = (await appel('POST', `/api/public/${slug}/fidelite/code`, { email: client.email }, false)).json;
    assert.deepEqual(Object.keys(connu).sort(), ['demande', 'ok'], 'même forme de réponse : rien n’indique qui a des points');
    const demande = connu.demande;
    const mail = db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY rowid DESC').get(client.email).corps;
    const code = /code pour les utiliser sur votre commande : (\d{6})/.exec(mail)[1];
    // Sans code ou avec un faux code : refusé.
    assert.equal((await commander({ fidelite: { code: '000000' === code ? '111111' : '000000', demande } })).statut, 400);
    assert.equal((await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, code }, false)).statut, 400, 'sans la demande : refusé');
    const solde = (await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, code, demande }, false)).json;
    assert.deepEqual([solde.points, solde.valeur, solde.utilisable], [200, 10, true]);
    // Utilisation : 200 points = 10 € de remise sur les prix ; le code est consommé.
    cmd = await commander({ fidelite: { code, demande } });
    assert.equal(cmd.statut, 201, JSON.stringify(cmd.json)); assert.equal(cmd.json.total, 90, 'livraison offerte (seuil calculé avant les points)');
    const c = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.json.commandeId).donnees);
    assert.equal(c.lignes[0].prix, 90); assert.deepEqual([c.fidelite.points, c.fidelite.montant, c.fidelite.debite], [200, 10, 200], 'points débités dès la commande'); assert.match(c.motifRemise, /200 points/);
    assert.equal((await commander({ fidelite: { code, demande } })).statut, 400, 'code à usage unique');
    await payer(cmd);
    const apres = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.json.commandeId).donnees).fidelite;
    assert.equal(apres.debite, 200); assert.equal(apres.gagnes, 180, 'points gagnés sur le prix payé (90 €)');
    assert.equal((await appel('GET', '/api/admin/fidelite')).json.stats.points, 180);
    // Remboursement : points gagnés retirés, points utilisés rendus, une seule fois.
    assert.equal((await appel('POST', `/api/admin/commandes/${cmd.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 200);
    assert.equal((await appel('GET', '/api/admin/fidelite')).json.stats.points, 200);
    const g = (await appel('GET', '/api/admin/fidelite')).json; assert.equal(g.registreCoherent, true);
    // Sans session : refusé.
    assert.equal((await appel('PUT', '/api/admin/fidelite', { actif: false }, false)).statut, 401);
    assert.equal((await appel('PUT', '/api/admin/fidelite', { actif: true, pointsParUnite: 1000 })).statut, 400);
  } finally { s.close(); }
});

test('relecture : points réservés dès la commande, paiement manuel, abandon, reprise, effacement, force brute, générosité', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const app = creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non', LIMITES_FACTEUR: '50' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', app);
  let cookie = '';
  const appel = async (m, chemin, corps, session = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && session ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && session) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  try {
    await appel('POST', '/api/auth/inscription', { email: 'fid2@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'F2', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'F SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [{ nom: 'Vase', prix: 100, stock: 50, type: 'stock' }] });
    const produit = (await appel('GET', '/api/admin/etat')).json.produits[0].id, slug = db.prepare('SELECT slug FROM boutiques').get().slug, bid = db.prepare('SELECT id FROM boutiques').get().id;
    // Générosité plafonnée à 30 %.
    assert.equal((await appel('PUT', '/api/admin/fidelite', { actif: true, pointsParUnite: 100, valeurPour100: 5000 })).statut, 400);
    assert.equal((await appel('PUT', '/api/admin/fidelite', { actif: true })).statut, 200);
    assert.equal((await appel('PUT', '/api/admin/fidelite', { actif: true, seuil: 50 })).json.reglages.pointsParUnite, 1, 'mise à jour partielle : le reste est gardé');
    const client = { nom: 'Lou', email: 'lou@exemple.fr', adresse: '3 rue Haute', npa: '69002', ville: 'Lyon' };
    const solde = () => { const K = Fid.creer(db, crypto.randomBytes(32)); void K; return db.prepare('SELECT COALESCE(SUM(points), 0) n FROM fidelite_comptes WHERE boutique_id = ?').get(bid).n; };
    const code = async () => { const { demande } = (await appel('POST', `/api/public/${slug}/fidelite/code`, { email: client.email }, false)).json; return { code: /: (\d{6})/.exec(db.prepare('SELECT corps FROM emails WHERE destinataire = ? AND sujet LIKE ? ORDER BY rowid DESC').get(client.email, '%code%').corps)[1], demande }; };
    const commander = corps => appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client, ...corps }, false);
    // 3 commandes payées : 300 points.
    for (let i = 0; i < 3; i++) { const c = await commander({}); await appel('POST', `/paiement-simule/${c.json.paiementUrl.split('/').pop()}/confirmer`, null, false); }
    assert.equal(solde(), 300);
    // Commande avec points : débités tout de suite ; une 2e commande ne peut pas les réutiliser.
    let c1 = await commander({ fidelite: await code() });
    assert.equal(c1.statut, 201); assert.equal(solde(), 0);
    assert.equal((await commander({ fidelite: await code().catch(() => ({ code: '000000', demande: 'x' })) })).statut, 400);
    // Payée à la main (virement) : rien de plus n'est débité, des points sont gagnés.
    assert.equal((await appel('POST', `/api/admin/commandes/${c1.json.commandeId}/statut`, { statut: 'payee' })).statut, 200);
    assert.equal(solde(), 85, 'points gagnés sur les 85 € payés (100 € − 15 € de points)');
    // Abandon : points rendus tout de suite, puis reprise refusée s'ils ont été dépensés ailleurs.
    for (let i = 0; i < 3; i++) { const c = await commander({}); await appel('POST', `/paiement-simule/${c.json.paiementUrl.split('/').pop()}/confirmer`, null, false); }
    const avant = solde();
    const c2 = await commander({ fidelite: await code() });
    const pris = avant - solde(); assert.ok(pris > 0);
    await appel('POST', `/api/public/${slug}/commandes/${c2.json.commandeId}/abandonner`, { jeton: c2.json.jeton }, false);
    assert.equal(solde(), avant, 'points rendus à l’abandon');
    const c3 = await commander({ fidelite: await code() }); assert.equal(c3.statut, 201);
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${c2.json.commandeId}/reprendre`, { jeton: c2.json.jeton }, false)).statut, 409, 'points dépensés ailleurs : reprise refusée');
    assert.equal((await appel('POST', `/api/admin/commandes/${c2.json.commandeId}/statut`, { statut: 'payee' })).statut, 409, 'ni marquée payée');
    // Annulation d'une commande en attente : points rendus.
    const s0 = solde();
    assert.equal((await appel('POST', `/api/admin/commandes/${c3.json.commandeId}/statut`, { statut: 'annulee' })).statut, 200);
    assert.ok(solde() > s0);
    // Force brute depuis un même réseau : 10 échecs sur 24 h bloquent, même en redemandant des codes.
    const faux = b => b.code === '000000' ? '111111' : '000000';
    let bon = await code();
    for (let i = 0; i < 4; i++) await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, demande: bon.demande, code: faux(bon) }, false);
    bon = await code();
    for (let i = 0; i < 5; i++) await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, demande: bon.demande, code: faux(bon) }, false);
    bon = await code();
    await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, demande: bon.demande, code: faux(bon) }, false);   // 10e échec
    bon = await code();
    assert.equal((await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, ...bon }, false)).statut, 400, 'bloqué après 10 échecs, même avec le bon code');
    // Effacement du client : ses points disparaissent.
    await appel('POST', `/api/admin/commandes/${c2.json.commandeId}/statut`, { statut: 'annulee' });   // pas d'effacement avec une commande en cours
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE statut = 'payee'").run();   // commandes livrées : effacement permis
    assert.equal((await appel('POST', '/api/admin/clients/effacer', { email: client.email })).statut, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fidelite_comptes').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM fidelite_mouvements').get().n, 0);
    assert.equal((await appel('GET', '/api/admin/fidelite')).json.registreCoherent, true);
    void app;
  } finally { s.close(); }
});

test('expiration en lot : points expirés retirés des statistiques, registre cohérent, expirations prochaines annoncées', () => {
  const db = ouvrir(':memory:'), K = Fid.creer(db, crypto.randomBytes(32)), j = 86400000, t0 = Date.UTC(2026, 0, 1);
  K.ecrireReglages('b1', { actif: true, expirationMois: 6 });
  K.crediter('b1', 'ancien@exemple.fr', 300, { maintenant: t0 });
  K.crediter('b1', 'bientot@exemple.fr', 200, { maintenant: t0 + 30 * j });   // expire vers t0 + 213 j
  K.crediter('b1', 'actif@exemple.fr', 100, { maintenant: t0 + 200 * j });
  const maintenant = t0 + 200 * j;   // 200 jours après le premier gain (6 mois ≈ 183 j) : expiré ; le deuxième expire dans ~13 jours
  // Statistiques en lecture seule : les points expirés ne comptent plus, même avant le passage de la maintenance.
  const st = K.stats('b1', maintenant);
  assert.equal(st.points, 300, 'les 300 points expirés ne comptent plus');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fidelite_mouvements WHERE type = 'expiration'").get().n, 0, 'rien écrit par les statistiques');
  assert.equal(K.expirer('b1', maintenant), 1, 'maintenance : un compte expiré');
  assert.equal(st.membres, 2);
  assert.deepEqual(st.bientot, { comptes: 1, points: 200 });
  assert.equal(st.valeur, K.valeur(K.reglages('b1'), 300));
  assert.equal(K.solde('b1', 'ancien@exemple.fr', maintenant), 0);
  assert.deepEqual(K.verifier('b1'), [], 'registre : expiration inscrite');
  assert.equal(K.expirer('b1', maintenant), 0, 'idempotent');
  // Programme en pause : rien n'expire. Lots : au plus « lot » comptes par passage.
  K.crediter('b1', 'pause@exemple.fr', 50, { maintenant: t0 });
  K.ecrireReglages('b1', { actif: false, expirationMois: 6 }, maintenant);
  assert.equal(K.expirer('b1', maintenant), 0);
  K.ecrireReglages('b1', { actif: true, expirationMois: 6 }, t0);   // (reprise datée avant les comptes : rien n'est décalé)
  for (let i = 0; i < 5; i++) K.crediter('b1', `lot${i}@exemple.fr`, 10, { maintenant: t0 });
  assert.equal(K.expirer('b1', maintenant, { lot: 4 }), 4); assert.equal(K.expirer('b1', maintenant, { lot: 4 }), 2); assert.deepEqual(K.verifier('b1'), []);
  assert.equal(K.stats('b1', maintenant).trenteJours.expiration, -400, '300 + 50 (compte de la pause) + 5 × 10');
});

test('pause du programme : aucun point n’expire, et l’inactivité repart de la reprise', () => {
  const db = ouvrir(':memory:'), K = Fid.creer(db, crypto.randomBytes(32)), j = 86400000, t0 = Date.UTC(2026, 0, 1);
  K.ecrireReglages('b1', { actif: true, expirationMois: 6 }, t0);
  K.crediter('b1', 'lou@exemple.fr', 500, { maintenant: t0 });
  K.ecrireReglages('b1', { actif: false }, t0 + 10 * j);
  const t1 = t0 + 900 * j;   // 30 mois plus tard, toujours en pause
  assert.equal(K.solde('b1', 'lou@exemple.fr', t1), 500, 'pas d’expiration pendant la pause');
  assert.equal(K.expirer('b1', t1), 0);
  K.ecrireReglages('b1', { actif: true }, t1);
  assert.equal(K.expirer('b1', t1 + j), 0, 'reprise : pas d’expiration en masse');
  assert.equal(K.solde('b1', 'lou@exemple.fr', t1 + 100 * j), 500);
  assert.equal(K.solde('b1', 'lou@exemple.fr', t1 + 200 * j), 0, 'expire 6 mois après la reprise sans achat');
  assert.deepEqual(K.verifier('b1'), []);
});

test('codes : réseau sûr exempté des plafonds tous réseaux ; 30 échecs ailleurs bloquent ; pause décalée de sa durée', () => {
  const db = ouvrir(':memory:'), K = Fid.creer(db, crypto.randomBytes(32));
  K.ecrireReglages('b', { actif: true });
  K.crediter('b', 'lou@exemple.fr', 200);
  const juste = (reseau) => { const d = K.nouveauCode('b', 'lou@exemple.fr'); return K.verifierCode('b', 'lou@exemple.fr', d.code, { demande: d.demande, reseau }); };
  assert.equal(juste('maison'), true);
  assert.equal(K.reseauSur('b', 'lou@exemple.fr', 'maison'), true); assert.equal(K.reseauSur('b', 'lou@exemple.fr', 'ailleurs'), false);
  // 30 échecs depuis 4 réseaux d'attaque : bloqués partout… sauf au réseau sûr du client.
  for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) { const d = K.nouveauCode('b', 'lou@exemple.fr'); for (let i = 0; i < 5 && (r * 10 + k * 5 + i) < 30; i++) K.verifierCode('b', 'lou@exemple.fr', d.code === '000000' ? '111111' : '000000', { demande: d.demande, reseau: `att${r}` }); }
  assert.equal(juste('nouveau'), false, 'nouveau réseau : bloqué par le plafond de 30');
  assert.equal(juste('maison'), true, 'réseau sûr du client : jamais bloqué par un tiers');
  // Pause de 100 jours : l'inactivité est décalée de 100 jours, pas remise à zéro.
  const j = 86400000, t0 = Date.UTC(2026, 0, 1);
  const db2 = ouvrir(':memory:'), K2 = Fid.creer(db2, crypto.randomBytes(32));
  K2.ecrireReglages('b', { actif: true, expirationMois: 6 }, t0);
  K2.crediter('b', 'a@exemple.fr', 50, { maintenant: t0 });
  K2.ecrireReglages('b', { actif: false }, t0 + 50 * j);
  K2.ecrireReglages('b', { actif: true }, t0 + 150 * j);
  assert.equal(K2.solde('b', 'a@exemple.fr', t0 + 270 * j), 50, '183 j d’inactivité + 100 j de pause : pas encore expiré');
  assert.equal(K2.solde('b', 'a@exemple.fr', t0 + 290 * j), 0, 'expiré 100 jours plus tard qu’à l’origine');
});

test('ménage : codes, échecs et réseaux sûrs périmés effacés, les récents gardés', () => {
  const db = ouvrir(':memory:'), K = Fid.creer(db, crypto.randomBytes(32)), j = 86400000, t0 = Date.UTC(2026, 0, 1);
  K.ecrireReglages('b', { actif: true });
  K.crediter('b', 'a@exemple.fr', 100, { maintenant: t0 });
  const d = K.nouveauCode('b', 'a@exemple.fr', t0);
  K.verifierCode('b', 'a@exemple.fr', d.code === '000000' ? '111111' : '000000', { demande: d.demande, reseau: 'r1', maintenant: t0 });
  const d2 = K.nouveauCode('b', 'a@exemple.fr', t0); K.verifierCode('b', 'a@exemple.fr', d2.code, { demande: d2.demande, reseau: 'maison', maintenant: t0 });
  const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(K.menage(t0 + j / 2), 0, 'rien de périmé au bout de 12 h');
  assert.ok(K.menage(t0 + 2 * j) >= 2); assert.equal(n('fidelite_codes_demandes'), 0); assert.equal(n('fidelite_echecs'), 0);
  assert.equal(n('fidelite_reseaux_surs'), 1, 'réseau sûr gardé un an');
  K.menage(t0 + 366 * j); assert.equal(n('fidelite_reseaux_surs'), 0);
});
