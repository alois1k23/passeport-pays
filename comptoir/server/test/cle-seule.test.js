// « Exiger la clé d'accès » : la connexion par mot de passe est refusée, le marchand prévenu ; sans clé, l'option se désactive.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('exiger la clé d’accès', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  const mdp = 'un mot de passe solide';
  try {
    await c('POST', '/api/auth/inscription', { email: 'cs@exemple.ch', motDePasse: mdp, config: { boutique: { nom: 'Cle', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'C', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [] });
    const mid = db.prepare('SELECT id FROM marchands').get().id;
    assert.equal((await c('POST', '/api/admin/compte/cle-seule', { actif: true, motDePasse: mdp })).s, 409, 'pas sans clé d’accès');
    db.prepare("INSERT INTO cles_acces (id, marchand_id, nom, cle, compteur, cree_le) VALUES ('ca1', ?, 'iPhone', 'x', 0, ?)").run(mid, Date.now());
    assert.equal((await c('POST', '/api/admin/compte/cle-seule', { actif: true, motDePasse: 'faux mot de passe' })).s, 401);
    // Une autre session ouverte par mot de passe (un tiers, par exemple) : fermée à l'activation.
    const autre = (await fetch(base + '/api/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'cs@exemple.ch', motDePasse: mdp }) })).headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    assert.equal((await (await fetch(base + '/api/session', { headers: { Cookie: autre } })).json()).connecte, true);
    assert.deepEqual((await c('POST', '/api/admin/compte/cle-seule', { actif: true, motDePasse: mdp })).j, { cleSeule: true });
    assert.equal((await (await fetch(base + '/api/session', { headers: { Cookie: autre } })).json()).connecte, false, 'session par mot de passe fermée');
    assert.equal((await c('GET', '/api/session')).j.connecte, true, 'la session en cours reste ouverte');
    // Dernière clé : suppression refusée tant que l'option est active.
    assert.equal((await c('POST', '/api/admin/compte/cles-acces/ca1/supprimer', { motDePasse: mdp })).s, 409);
    const bilan = (await c('GET', '/api/admin/compte/securite')).j;
    assert.equal(bilan.cleSeule, true); assert.equal(bilan.bilan.find(x => x.titre === 'Mot de passe complété par un second facteur').ok, true);
    assert.equal((await c('GET', '/api/session')).j.compteProtege, true);
    // Bon mot de passe : refusé, et le marchand est prévenu une seule fois par heure.
    cookie = '';
    let r = await c('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: mdp });
    assert.equal(r.s, 403); assert.equal(r.j.code, 'cle_requise');
    assert.equal((await c('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: mdp })).s, 403);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet = 'Connexion par mot de passe refusée sur votre compte Comptoir'").get().n, 1);
    assert.equal((await c('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: 'faux mot de passe' })).s, 401, 'mauvais mot de passe : erreur habituelle');
    for (let i = 0; i < 9; i++) await c('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: mdp });
    assert.equal((await c('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: mdp })).s, 429, 'essais limités');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM journal_compte WHERE type = 'mdp-refuse-cle-seule'").get().n, 1, 'journal non inondé');
    assert.equal(cookie, '', 'aucune session ouverte');
    // Réinitialisation du mot de passe (récupération) : clés supprimées, mot de passe de nouveau accepté.
    db.prepare('UPDATE marchands SET cle_seule = 1 WHERE id = ?').run(mid);
    cookie = '';
    await c('POST', '/api/auth/oubli', { email: 'cs@exemple.ch' });
    const jeton = /reinitialiser=([\w-]+)/.exec(db.prepare("SELECT corps FROM emails WHERE destinataire = 'cs@exemple.ch' ORDER BY id DESC").get().corps)[1];
    assert.equal((await c('POST', '/api/auth/reinitialiser', { jeton, motDePasse: 'nouveau mot de passe solide' })).s, 200);
    assert.equal(db.prepare('SELECT cle_seule FROM marchands WHERE id = ?').get(mid).cle_seule, 0);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE sujet = 'Mot de passe réinitialisé sur votre compte Comptoir' AND corps LIKE '%clé d’accès a été supprimée et la connexion par mot de passe%'").get(), 'marchand prévenu');
    assert.equal(cookie, '', 'pas de session ouverte par le lien quand le compte exigeait sa clé');
    cookie = '';
    assert.equal((await c('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: 'nouveau mot de passe solide' })).s, 200, 'accès rétabli par e-mail');
  } finally { s.close(); }
});
