// Sauvegarde puis restauration d'une base vivante : retours partiels, geste, cartes cadeaux, fidélité, journal scellé.
// La copie restaurée doit être utilisable et vérifiable de bout en bout (pas seulement lisible).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const S = require('../src/sauvegarde');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

async function demarrer(fichier, env) {
  const db = ouvrir(fichier);
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non', ...env }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const appel = async (m, chemin, corps, avecSession = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecSession ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && avecSession) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  return { db, s, appel };
}

test('restauration : la copie chiffrée d’une boutique active est utilisable et vérifiable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpt-rest-'));
  const env = { SECRET_CHIFFREMENT: crypto.randomBytes(32).toString('hex') }, cleSauv = crypto.randomBytes(32).toString('hex');
  try {
    const a = await demarrer(path.join(dir, 'base.db'), env);
    let numero, idCmd, code, slug, produit, avant;
    try {
      const conf = { boutique: { nom: 'Rest', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Rest SAS', adresse: '5 rue Neuve, 69001 Lyon', email: 'r@exemple.fr', tvaIntra: 'FR12345678901', siret: '12345678901234' } };
      assert.equal((await a.appel('POST', '/api/auth/inscription', { email: 'rest@exemple.fr', motDePasse: 'un mot de passe solide', config: conf, produits: [{ nom: 'Vase', prix: 40, stock: 50, type: 'stock' }] })).statut, 201);
      await a.appel('PUT', '/api/admin/fidelite', { actif: true });
      const e = (await a.appel('GET', '/api/admin/etat')).json; slug = e.serveur.slug; produit = e.produits[0].id;
      code = (await a.appel('POST', '/api/admin/cartes-cadeaux', { montant: 300 })).json.code;   // la commande est payée par la carte ; les retours la recréditent
      const client = { nom: 'Lou Martin', email: 'lou@exemple.fr', adresse: '3 rue Haute', npa: '69002', ville: 'Lyon' };
      const cmd = await a.appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: e.produits[0].id, qte: 3 }], livraison: 'colissimo', client, carteCadeau: code }, false);
      await a.appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
      numero = cmd.json.numero; idCmd = cmd.json.commandeId;
      const base = `/api/admin/commandes/${idCmd}/retour-partiel`;
      for (const corps of [{ lignes: [{ index: 0, qte: 1 }] }, { geste: 4 }]) { const ap = (await a.appel('POST', base, { ...corps, apercu: true })).json.apercu; assert.equal((await a.appel('POST', base, { ...corps, attendu: { rang: ap.rang, montant: ap.montant } })).statut, 200); }
      // Valeurs relevées avant la sauvegarde, à retrouver à l'identique sur la copie.
      avant = { solde: (await a.appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, points: (await a.appel('GET', '/api/admin/fidelite')).json.stats.points,
        pieces: a.db.prepare("SELECT COUNT(*) n FROM journal_inalterable WHERE type != 'cloture'").get().n, stock: (await a.appel('GET', '/api/admin/etat')).json.produits[0].stock };
      assert.ok(avant.solde > 0 && avant.points > 0 && avant.pieces >= 3, JSON.stringify(avant));
      // Sauvegarde du jour, chiffrée.
      await S.sauvegarderBase(a.db, path.join(dir, 'sauv'), { cle: cleSauv, date: new Date('2026-11-13T05:00:00Z') });
    } finally { a.s.close(); }
    const copie = fs.readdirSync(path.join(dir, 'sauv')).find(f => f.endsWith('.db.enc'));
    assert.ok(copie, 'copie chiffrée présente');
    execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--restaurer', path.join(dir, 'sauv', copie), path.join(dir, 'restauree.db')], { env: { ...process.env, SAUVEGARDE_CLE: cleSauv }, stdio: 'ignore' });
    // Application relancée sur la copie, avec la même clé du serveur.
    const b = await demarrer(path.join(dir, 'restauree.db'), env);
    try {
      assert.equal((await b.appel('POST', '/api/auth/connexion', { email: 'rest@exemple.fr', motDePasse: 'un mot de passe solide' })).statut, 200);
      const v = (await b.appel('POST', '/api/admin/journal-inalterable/verifier', {})).json;
      assert.equal(v.ok, true, JSON.stringify(v.anomalies)); assert.ok(v.pieces >= 3, 'facture et deux avoirs scellés');
      const cmdR = (await b.appel('GET', '/api/admin/etat')).json.commandes.find(x => x.id === idCmd);
      assert.equal(cmdR.client.email, 'lou@exemple.fr', 'données du client déchiffrées');
      assert.equal(cmdR.retoursPartiels.length, 2);
      // Mêmes valeurs qu'avant la sauvegarde.
      assert.equal((await b.appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, avant.solde, 'solde de la carte');
      assert.equal((await b.appel('GET', '/api/admin/fidelite')).json.stats.points, avant.points, 'points en circulation');
      assert.equal(b.db.prepare("SELECT COUNT(*) n FROM journal_inalterable WHERE type != 'cloture'").get().n, avant.pieces, 'pièces du journal');
      assert.equal((await b.appel('GET', '/api/admin/etat')).json.produits[0].stock, avant.stock, 'stock');
      // La carte sert encore sur la copie.
      const achat = await b.appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'colissimo', client: { nom: 'Sam', email: 'sam@exemple.fr', adresse: '1 rue', npa: '69001', ville: 'Lyon' }, carteCadeau: code }, false);
      assert.equal(achat.statut, 201, JSON.stringify(achat.json));
      const cartes = (await b.appel('GET', '/api/admin/cartes-cadeaux')).json; assert.equal(cartes.registreCoherent, true);
      assert.equal((await b.appel('GET', '/api/admin/fidelite')).json.registreCoherent, true);
      // Et elle continue de vivre : remboursement du reste, journal toujours intact.
      assert.equal((await b.appel('POST', `/api/admin/commandes/${idCmd}/statut`, { statut: 'remboursee' })).statut, 200);
      assert.equal((await b.appel('POST', '/api/admin/journal-inalterable/verifier', {})).json.ok, true);
      assert.ok(numero);
    } finally { b.s.close(); }
    // Erreur la plus probable en vrai : redémarrage avec une autre clé du serveur. Le journal le dit (clé changée),
    // sans accuser chaque pièce de falsification.
    const c2 = await demarrer(path.join(dir, 'restauree.db'), { SECRET_CHIFFREMENT: crypto.randomBytes(32).toString('hex') });
    try {
      assert.equal((await c2.appel('POST', '/api/auth/connexion', { email: 'rest@exemple.fr', motDePasse: 'un mot de passe solide' })).statut, 200);
      const v2 = (await c2.appel('POST', '/api/admin/journal-inalterable/verifier', {})).json;
      assert.equal(v2.ok, false); assert.equal(v2.cleChangee, true);
    } finally { c2.s.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
