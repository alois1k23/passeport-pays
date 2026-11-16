// Rotation de SECRET_CHIFFREMENT : les tables qui gardent un index aveugle de l'adresse (parrainage, rappels de
// réassort) et l'index canonique des commandes sont recalculés avec la nouvelle clé. Sans cela, le parrain recevrait
// un second code, les contrôles anti-abus ne verraient plus rien et l'effacement d'un client resterait incomplet.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

const K1 = crypto.randomBytes(32).toString('hex'), K2 = crypto.randomBytes(32).toString('hex');
async function demarrer(db, env) {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', ...env }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, avec = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avec ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avec) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  return { s, c };
}

test('rotation de la clé : parrainage, rappels de réassort et index canonique réindexés', async () => {
  const db = ouvrir(':memory:');
  let srv = await demarrer(db, { SECRET_CHIFFREMENT: K1 }), c = srv.c, slug, vase, cmdAna, codeAna;
  const commander = (email, extra = {}) => c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: vase, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Client Test', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' }, ...extra }, false);
  const payer = async r => { assert.equal(r.s, 201, JSON.stringify(r.j)); await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' }); return r.j; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'k@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Clés', pays: 'ch' }, entreprise: { raison: 'K Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'k@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    vase = (await c('POST', '/api/admin/produits', { produit: { nom: 'Café', prix: 100, stock: 50, reassortJours: 30 } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j; slug = etat.serveur.slug;
    await c('PUT', '/api/admin/config', { config: { boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, livraisons: etat.livraisons, offres: etat.offres, reglages: etat.reglages, parrainage: { actif: true, filleul: 10, parrain: 10, minimum: 0 } } });
    cmdAna = await payer(await commander('ana@exemple.ch', { rappelReassort: true }));
    codeAna = (await c('POST', `/api/public/${slug}/parrainage`, { commandeId: cmdAna.commandeId, jeton: cmdAna.jeton }, false)).j.code;
    assert.match(codeAna, /^AMI/);
    await payer(await commander('bob@exemple.ch', { code: codeAna }));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
  } finally { srv.s.close(); }
  const avant = db.prepare('SELECT email_index, canon FROM parrains').get();
  // --- Redémarrage avec K2, K1 en ancienne clé
  srv = await demarrer(db, { SECRET_CHIFFREMENT: K2, SECRET_CHIFFREMENT_ANCIENNES: K1 }); c = srv.c;
  try {
    const apres = db.prepare('SELECT email_index, canon, donnees FROM parrains').get();
    assert.notEqual(apres.email_index, avant.email_index, 'index du parrain recalculé'); assert.notEqual(apres.canon, avant.canon);
    // Le parrain retrouve SON code (pas un second) ; un alias de lui-même reste refusé ; le filleul ne revient pas sous un alias.
    assert.equal((await c('POST', `/api/public/${slug}/parrainage`, { commandeId: cmdAna.commandeId, jeton: cmdAna.jeton }, false)).j.code, codeAna);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM parrains').get().n, 1);
    assert.equal((await commander('ana+x@exemple.ch', { code: codeAna })).j.code, 'parrainage_soi');
    assert.equal((await commander('bob+y@exemple.ch', { code: codeAna })).j.code, 'code_premiere_commande');
    // Effacement d'Ana : son code et son rappel de réassort sont retrouvés et effacés.
    await c('POST', '/api/auth/connexion', { email: 'k@exemple.ch', motDePasse: 'un mot de passe solide' });
    db.prepare("UPDATE commandes SET statut = 'livree'").run();
    const r = await c('POST', '/api/admin/clients/effacer', { email: 'ana@exemple.ch' }); assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM parrains').get().n, 0, 'code du parrain effacé');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 0, 'rappel de réassort effacé');
  } finally { srv.s.close(); }
});
