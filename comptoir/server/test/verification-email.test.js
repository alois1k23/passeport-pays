// Vérification de l'adresse e-mail : lien envoyé à l'inscription, usage unique, renvoi, reprise d'un compte ouvert
// par un tiers avec l'adresse (réinitialisation), comptes antérieurs considérés comme vérifiés.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

async function demarrer(db = ouvrir(':memory:')) {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = (ip = '198.51.100.1') => {
    const jar = {};
    return async (m, chemin, corps) => {
      const r = await fetch(base + chemin, { method: m, headers: { 'X-Forwarded-For': ip, ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined });
      for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; }
      return { s: r.status, j: await r.json().catch(() => null) };
    };
  };
  const liens = email => db.prepare("SELECT corps FROM emails WHERE destinataire = ? AND sujet LIKE 'Confirmez%' ORDER BY id").all(email).map(x => x.corps.match(/verifier-email=([\w-]+)/)[1]);
  return { db, s, client, liens };
}

test('lien de confirmation : sans session, usage unique, renvoi qui remplace l’ancien lien', async () => {
  const { s, client, liens } = await demarrer();
  try {
    const a = client();
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'neuve@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Neuve' } } })).s, 201);
    assert.equal((await a('GET', '/api/session')).j.emailVerifie, false);
    assert.equal((await a('GET', '/api/admin/etat')).j.serveur.emailVerifie, false);
    assert.equal(liens('neuve@exemple.ch').length, 1, 'un lien envoyé à l’inscription');
    // Renvoi : un nouveau lien, l'ancien ne vaut plus rien.
    assert.equal((await a('POST', '/api/admin/compte/verifier-email/renvoyer')).s, 200);
    const [ancien, nouveau] = liens('neuve@exemple.ch');
    assert.equal((await client('203.0.113.5')('POST', '/api/auth/verifier-email', { jeton: ancien })).s, 400);
    assert.equal((await client('203.0.113.5')('POST', '/api/auth/verifier-email', { jeton: 'faux' })).s, 400);
    // Ouvert sur un autre appareil, sans session : accepté.
    const deux = await Promise.all([client('203.0.113.5')('POST', '/api/auth/verifier-email', { jeton: nouveau }), client('203.0.113.6')('POST', '/api/auth/verifier-email', { jeton: nouveau })]);
    assert.deepEqual(deux.map(x => x.s).sort(), [200, 400], 'deux requêtes simultanées : une seule aboutit');
    assert.equal(deux.find(x => x.s === 200).j.email, 'neuve@exemple.ch');
    assert.equal((await a('GET', '/api/session')).j.emailVerifie, true);
    assert.equal((await client('203.0.113.5')('POST', '/api/auth/verifier-email', { jeton: nouveau })).s, 400, 'usage unique');
    assert.deepEqual((await a('POST', '/api/admin/compte/verifier-email/renvoyer')).j, { ok: true, deja: true });
    assert.ok((await a('GET', '/api/admin/compte/securite')).j.journal.some(x => x.type === 'email-verifie'));
  } finally { s.close(); }
});

test('renvoi du lien limité ; un lien expiré est refusé', async () => {
  const { db, s, client, liens } = await demarrer();
  try {
    const a = client();
    await a('POST', '/api/auth/inscription', { email: 'limite@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Limite' } } });
    const statuts = []; for (let i = 0; i < 4; i++) statuts.push((await a('POST', '/api/admin/compte/verifier-email/renvoyer')).s);
    assert.deepEqual(statuts, [200, 200, 200, 429]);
    db.prepare('UPDATE verifications_email SET expire_le = ?').run(Date.now() - 1);
    assert.equal((await a('POST', '/api/auth/verifier-email', { jeton: liens('limite@exemple.ch').at(-1) })).s, 400);
    assert.equal((await a('GET', '/api/session')).j.emailVerifie, false);
  } finally { s.close(); }
});

test('compte ouvert par un tiers avec l’adresse d’autrui : la vraie titulaire le reprend par « mot de passe oublié »', async () => {
  const { db, s, client } = await demarrer();
  try {
    const tiers = client('203.0.113.66');
    assert.equal((await tiers('POST', '/api/auth/inscription', { email: 'victime@exemple.ch', motDePasse: 'un mot de passe du tiers', config: { boutique: { nom: 'Squat' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] })).s, 201);
    // Le tiers ne peut écrire à personne au nom de cette adresse.
    assert.equal((await tiers('POST', '/api/admin/equipe/inviter', { email: 'cible@exemple.ch', role: 'commandes' })).j.code, 'email_non_verifie');
    const produit = (await tiers('GET', '/api/admin/etat')).j.produits[0].id;
    const devis = await tiers('POST', '/api/admin/devis', { client: { raison: 'Cible SA', contact: 'Cible', email: 'cible@exemple.ch', adresse: 'Rue 1, 1003 Lausanne' }, lignes: [{ produitId: produit, qte: 1 }] });
    assert.equal(devis.s, 201, JSON.stringify(devis.j));
    assert.equal((await tiers('POST', `/api/admin/devis/${devis.j.devis.id}/envoyer`)).j.code, 'email_non_verifie', 'pas de devis envoyé à un tiers');
    assert.ok(!db.prepare("SELECT 1 FROM emails WHERE destinataire = 'cible@exemple.ch'").get(), 'aucun e-mail parti vers le tiers');
    // La titulaire demande un lien de réinitialisation, qu'elle seule reçoit.
    const titulaire = client('192.0.2.10');
    await titulaire('POST', '/api/auth/oubli', { email: 'victime@exemple.ch' });
    const jeton = db.prepare("SELECT corps FROM emails WHERE destinataire = 'victime@exemple.ch' AND sujet LIKE 'Réinitialiser%'").get().corps.match(/reinitialiser=([\w-]+)/)[1];
    assert.equal((await titulaire('POST', '/api/auth/reinitialiser', { jeton, motDePasse: 'le mot de passe de la titulaire' })).s, 200);
    assert.equal((await tiers('GET', '/api/admin/etat')).s, 401, 'le tiers est déconnecté');
    assert.equal((await titulaire('POST', '/api/auth/connexion', { email: 'victime@exemple.ch', motDePasse: 'le mot de passe de la titulaire' })).s, 200);
    assert.equal((await titulaire('GET', '/api/session')).j.emailVerifie, true, 'la réinitialisation prouve l’adresse');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM verifications_email').get().n, 0, 'liens en attente effacés');
  } finally { s.close(); }
});

test('comptes antérieurs à la règle : considérés comme vérifiés, sans toucher aux nouveaux comptes au redémarrage', async () => {
  const db = ouvrir(':memory:');
  db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m_ancien', 'ancien@exemple.ch', 'x', 1)").run();
  const { s } = await demarrer(db);
  try {
    assert.equal(db.prepare("SELECT email_verifie_le FROM marchands WHERE id = 'm_ancien'").get().email_verifie_le, 0);
    // Un nouveau compte, lui, ne l'est pas.
    db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m_neuf', 'neuf@exemple.ch', 'x', 2)").run();
    assert.equal(db.prepare("SELECT email_verifie_le FROM marchands WHERE id = 'm_neuf'").get().email_verifie_le, null);
  } finally { s.close(); }
  // Redémarrage : la migration ne repasse pas les nouveaux comptes en vérifiés.
  const { s: s2 } = await demarrer(db);
  try { assert.equal(db.prepare("SELECT email_verifie_le FROM marchands WHERE id = 'm_neuf'").get().email_verifie_le, null); } finally { s2.close(); }
});
