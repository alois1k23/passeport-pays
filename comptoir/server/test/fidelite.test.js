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

  const db = ouvrir(':memory:'), K = Fid.creer(db, crypto.randomBytes(32));
  K.crediter('b', 'Lou@Exemple.fr', 150, { commandeId: 'c1' });
  assert.equal(K.solde('b', 'lou@exemple.fr'), 150, 'e-mail sans casse');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM fidelite_comptes').all()).includes('lou@'), 'e-mail jamais stocké en clair');
  assert.equal(K.debiter('b', 'lou@exemple.fr', 200), 150, 'débit borné au solde');
  assert.equal(K.solde('b', 'lou@exemple.fr'), 0);
  K.crediter('b', 'lou@exemple.fr', 80);
  assert.equal(K.solde('b', 'lou@exemple.fr', Date.now() + 25 * 31 * 86400000), 0, 'expiré après 24 mois d’inactivité');
  assert.deepEqual(K.verifier('b'), []);
  const code = K.nouveauCode('b', 'lou@exemple.fr');
  assert.equal(K.verifierCode('b', 'autre@exemple.fr', code), false);
  for (let i = 0; i < 5; i++) assert.equal(K.verifierCode('b', 'lou@exemple.fr', '000000' === code ? '111111' : '000000'), false);
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code), false, 'bloqué après 5 erreurs');
  const code2 = K.nouveauCode('b', 'lou@exemple.fr');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code2, { maintenant: Date.now() + 16 * 60000 }), false, 'expiré après 15 minutes');
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code2, { consommer: true }), true);
  assert.equal(K.verifierCode('b', 'lou@exemple.fr', code2), false, 'à usage unique');
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
    assert.deepEqual((await appel('POST', `/api/public/${slug}/fidelite/code`, { email: 'inconnu@exemple.fr' }, false)).json, { ok: true });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE destinataire = 'inconnu@exemple.fr'").get().n, 0);
    assert.deepEqual((await appel('POST', `/api/public/${slug}/fidelite/code`, { email: client.email }, false)).json, { ok: true });
    const mail = db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY rowid DESC').get(client.email).corps;
    const code = /code pour les utiliser sur votre commande : (\d{6})/.exec(mail)[1];
    // Sans code ou avec un faux code : refusé.
    assert.equal((await commander({ fidelite: { code: '000000' === code ? '111111' : '000000' } })).statut, 400);
    const solde = (await appel('POST', `/api/public/${slug}/fidelite/solde`, { email: client.email, code }, false)).json;
    assert.deepEqual([solde.points, solde.valeur, solde.utilisable], [200, 10, true]);
    // Utilisation : 200 points = 10 € de remise sur les prix ; le code est consommé.
    cmd = await commander({ fidelite: { code } });
    assert.equal(cmd.statut, 201, JSON.stringify(cmd.json)); assert.equal(cmd.json.total, 90, 'livraison offerte (seuil calculé avant les points)');
    const c = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.json.commandeId).donnees);
    assert.equal(c.lignes[0].prix, 90); assert.deepEqual(c.fidelite, { points: 200, montant: 10 }); assert.match(c.motifRemise, /200 points/);
    assert.equal((await commander({ fidelite: { code } })).statut, 400, 'code à usage unique');
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
