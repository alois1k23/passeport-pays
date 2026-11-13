// Changement de l'adresse e-mail du compte : identité récente, lien vers la nouvelle adresse, avertissement et
// annulation par l'ancienne (sessions et appareils révoqués), aucune révélation des adresses déjà prises.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('changement d’adresse : confirmé par la nouvelle, annulable par l’ancienne', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const lien = (dest, param) => (db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY id DESC').all(dest).map(x => (x.corps.match(new RegExp(`${param}=([\\w-]+)`)) || [])[1]).find(Boolean));
  try {
    const a = client();
    await a('POST', '/api/auth/inscription', { email: 'ancien@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Ch' } } });
    await client()('POST', '/api/auth/inscription', { email: 'prise@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Autre' } } });
    // Même juste après la connexion, le mot de passe est redemandé (une session récente ne suffit pas ici).
    assert.equal((await a('POST', '/api/admin/compte/email', { email: 'prise@exemple.ch' })).j.code, 'identite_a_confirmer');
    await a('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
    // Adresse déjà prise : même réponse (pas de repérage), seule sa titulaire est prévenue.
    assert.deepEqual((await a('POST', '/api/admin/compte/email', { email: 'prise@exemple.ch' })).j, { ok: true });
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'prise@exemple.ch' AND sujet = 'Demande de changement d’adresse Comptoir'").get());

    assert.equal((await a('POST', '/api/admin/compte/email', { email: 'nouveau@exemple.ch' })).s, 200);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'ancien@exemple.ch' AND sujet LIKE 'Changement d’adresse demandé%'").get(), 'ancienne adresse prévenue');
    assert.equal(db.prepare("SELECT email FROM marchands WHERE email LIKE '%ancien%'").get().email, 'ancien@exemple.ch', 'rien ne change avant la confirmation');
    // Confirmation depuis la nouvelle adresse (lien à usage unique).
    const jeton = lien('nouveau@exemple.ch', 'changer-email');
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton })).j.email, 'nouveau@exemple.ch');
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton })).s, 400, 'usage unique');
    assert.equal((await a('GET', '/api/session')).j.email, 'nouveau@exemple.ch');
    assert.equal((await client()('POST', '/api/auth/connexion', { email: 'nouveau@exemple.ch', motDePasse: 'un mot de passe solide' })).s, 200);
    // Annulation par l'ancienne adresse : adresse rendue, tout déconnecté, lien de nouveau mot de passe envoyé.
    const annul = lien('ancien@exemple.ch', 'annuler-email');
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: annul })).s, 200);
    assert.equal((await a('GET', '/api/session')).j.connecte, false, 'sessions révoquées');
    assert.ok(db.prepare("SELECT 1 FROM marchands WHERE email = 'ancien@exemple.ch'").get());
    assert.ok(lien('ancien@exemple.ch', 'reinitialiser'), 'lien pour un nouveau mot de passe');
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: annul })).s, 400, 'usage unique');
  } finally { s.close(); }
});

test('changement d’adresse : un intrus ne peut ni effacer l’annulation, ni prendre l’ancienne adresse, ni garder ce qu’il a installé', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const totp = require('../src/totp');
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const lien = (dest, param) => (db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY id DESC').all(dest).map(x => (x.corps.match(new RegExp(`${param}=([\\w-]+)`)) || [])[1]).find(Boolean));
  try {
    // L'intrus connaît le mot de passe et a une session.
    const intrus = client();
    await intrus('POST', '/api/auth/inscription', { email: 'a@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'A' } } });
    await intrus('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
    await intrus('POST', '/api/admin/compte/email', { email: 'b@pirate.example' });
    // Il installe sa propre double authentification, puis confirme le changement.
    const prep = await intrus('POST', '/api/admin/compte/2fa/preparer');
    assert.equal((await intrus('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel()) })).s, 200);
    // (l'activation de la double authentification fait tomber le changement en attente : il le redemande)
    await intrus('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel() + 1) });
    await intrus('POST', '/api/admin/compte/email', { email: 'b@pirate.example' });
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton: lien('b@pirate.example', 'changer-email') })).s, 200);
    // Second changement B→C refusé tant que la titulaire peut annuler le premier.
    await intrus('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel() + 2) });
    assert.equal((await intrus('POST', '/api/admin/compte/email', { email: 'c@pirate.example' })).j.code, 'changement_en_cours');
    // L'ancienne adresse reste réservée : personne ne peut s'inscrire avec elle.
    assert.equal((await client()('POST', '/api/auth/inscription', { email: 'a@exemple.ch', motDePasse: 'un autre mot de passe sûr', config: { boutique: { nom: 'Squat' } } })).s, 409);
    // La titulaire annule : adresse rendue, double authentification de l'intrus retirée, intrus déconnecté.
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: lien('a@exemple.ch', 'annuler-email') })).s, 200);
    assert.ok(db.prepare("SELECT 1 FROM marchands WHERE email = 'a@exemple.ch'").get());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM deux_facteurs').get().n, 0, 'double authentification installée par l’intrus retirée');
    assert.equal((await intrus('GET', '/api/session')).j.connecte, false);
  } finally { s.close(); }
});

test('changement en attente : il tombe quand la titulaire change son mot de passe', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const jar = {}; const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'p@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'P' } } });
    await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
    await c('POST', '/api/admin/compte/email', { email: 'q@pirate.example' });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM changements_email').get().n, 1);
    assert.equal((await c('POST', '/api/admin/compte/mot-de-passe', { actuel: 'un mot de passe solide', nouveau: 'un nouveau mot de passe sûr' })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM changements_email').get().n, 0, 'le lien envoyé à la nouvelle adresse ne vaut plus rien');
  } finally { s.close(); }
});

test('annulation : « clé d’accès seule » d’avant la demande conservée, équipe ajoutée par l’intrus retirée ; connexion avec code ≠ identité confirmée', async () => {
  const totp = require('../src/totp');
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const lien = (dest, param) => (db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY id DESC').all(dest).map(x => (x.corps.match(new RegExp(`${param}=([\\w-]+)`)) || [])[1]).find(Boolean));
  try {
    // Titulaire avec double authentification : la connexion par code vaut confirmation d'identité.
    const t = client();
    await t('POST', '/api/auth/inscription', { email: 'cs@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Cs' } } });
    await t('POST', '/api/auth/verifier-email', { jeton: lien('cs@exemple.ch', 'verifier-email') });
    const prep = await t('POST', '/api/admin/compte/2fa/preparer');
    await t('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel()) });
    const intrus = client();
    const d = await intrus('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal(d.j.deuxFacteurs, true);
    assert.equal((await intrus('POST', '/api/auth/connexion/2fa', { defi: d.j.defi, code: totp.code(prep.j.secret, totp.pasActuel() + 1) })).s, 200);
    // Une connexion, même avec code, ne vaut pas confirmation explicite (un cookie volé juste après ne suffit pas).
    assert.equal((await intrus('POST', '/api/admin/compte/email', { email: 'x@pirate.example' })).j.code, 'identite_a_confirmer');
    // L'intrus (qui a ici les deux facteurs) invite un premier complice, puis attend avant de demander le changement.
    db.prepare('UPDATE sessions SET identite_le = ?').run(Date.now());
    assert.equal((await intrus('POST', '/api/admin/equipe/inviter', { email: 'avant@pirate.example', role: 'commandes' })).s, 201);
    db.prepare('UPDATE invitations SET cree_le = cree_le - 600000').run(); db.prepare('UPDATE sessions SET cree_le = cree_le - 600000').run();   // 10 minutes plus tôt
    // La protection « clé d'accès seule » de la titulaire existait avant la demande.
    db.prepare("INSERT INTO cles_acces (id, marchand_id, nom, cle, compteur, cree_le) SELECT 'k-titulaire', id, 'Tel', '{}', 0, ? FROM marchands WHERE email = 'cs@exemple.ch'").run(Date.now() - 30 * 86400000);
    db.prepare('UPDATE marchands SET cle_seule = 1, cle_seule_le = ?').run(Date.now() - 86400000);
    assert.equal((await intrus('POST', '/api/admin/compte/email', { email: 'x@pirate.example' })).s, 200);
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton: lien('x@pirate.example', 'changer-email') })).s, 200);
    // L'intrus invite un complice, qui accepte, et en invite un autre.
    db.prepare('UPDATE sessions SET identite_le = ?').run(Date.now());
    assert.equal((await intrus('POST', '/api/admin/equipe/inviter', { email: 'complice@pirate.example', role: 'commandes' })).s, 201);
    assert.equal((await client()('POST', '/api/auth/invitation', { jeton: lien('complice@pirate.example', 'invitation'), motDePasse: 'complice mot de passe sûr' })).s, 201);
    assert.equal((await intrus('POST', '/api/admin/equipe/inviter', { email: 'autre@pirate.example', role: 'commandes' })).s, 201);
    // Annulation : l'équipe ajoutée depuis est retirée, la « clé d'accès seule » d'avant reste en place.
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: lien('cs@exemple.ch', 'annuler-email') })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM equipe').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invitations').get().n, 0);   // celle d'avant la demande aussi (session de moins de 24 h)
    assert.ok(db.prepare("SELECT corps FROM emails WHERE destinataire = 'cs@exemple.ch' AND sujet LIKE 'Changement d’adresse annulé%'").get().corps.includes('membre complice@pirate.example'));
    assert.equal((await client()('POST', '/api/auth/connexion', { email: 'cs@exemple.ch', motDePasse: 'un mot de passe solide' })).s, 401, 'mot de passe connu de l’intrus invalidé');
    assert.ok(!db.prepare("SELECT 1 FROM marchands WHERE email = 'complice@pirate.example'").get(), 'compte du complice supprimé');
    assert.equal(db.prepare("SELECT cle_seule FROM marchands WHERE email = 'cs@exemple.ch'").get().cle_seule, 1, 'protection d’avant conservée');
  } finally { s.close(); }
});

test('annulation : « clé d’accès seule » activée par l’intrus après la demande, retirée', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const lien = (dest, param) => (db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY id DESC').all(dest).map(x => (x.corps.match(new RegExp(`${param}=([\\w-]+)`)) || [])[1]).find(Boolean));
  try {
    const i = client();
    await i('POST', '/api/auth/inscription', { email: 'k@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'K' } } });
    await i('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
    await i('POST', '/api/admin/compte/email', { email: 'k@pirate.example' });
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton: lien('k@pirate.example', 'changer-email') })).s, 200);
    db.prepare('UPDATE marchands SET cle_seule = 1, cle_seule_le = ?').run(Date.now());   // activée par l'intrus
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: lien('k@exemple.ch', 'annuler-email') })).s, 200);
    assert.equal(db.prepare('SELECT cle_seule FROM marchands').get().cle_seule, 0);
  } finally { s.close(); }
});

test('annulation : « clé d’accès seule » désactivée par l’intrus, rétablie', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const lien = (dest, param) => (db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY id DESC').all(dest).map(x => (x.corps.match(new RegExp(`${param}=([\\w-]+)`)) || [])[1]).find(Boolean));
  try {
    const i = client();
    await i('POST', '/api/auth/inscription', { email: 'r@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'R' } } });
    const mid = db.prepare('SELECT id FROM marchands').get().id;
    // La titulaire avait une clé d'accès et « clé d'accès seule » (posées directement : le test porte sur l'annulation).
    db.prepare("INSERT INTO cles_acces (id, marchand_id, nom, cle, compteur, cree_le) VALUES ('k1', ?, 'Téléphone', '{}', 0, ?)").run(mid, Date.now() - 86400000 * 30);
    db.prepare('UPDATE marchands SET cle_seule = 1, cle_seule_le = ?').run(Date.now() - 86400000 * 30);
    db.prepare('UPDATE sessions SET identite_le = ?').run(Date.now());
    await i('POST', '/api/admin/compte/email', { email: 'r@pirate.example' });
    db.prepare('UPDATE marchands SET cle_seule = 0, cle_seule_le = ?').run(Date.now());   // désactivée par l'intrus
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton: lien('r@pirate.example', 'changer-email') })).s, 200);
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: lien('r@exemple.ch', 'annuler-email') })).s, 200);
    assert.equal(db.prepare('SELECT cle_seule FROM marchands').get().cle_seule, 1, 'protection rétablie');
  } finally { s.close(); }
});


test('relecture croisée : lien de réinitialisation de l’intrus caduc après l’annulation ; clé seule sans clé retirée ; codes refusés comptés par session', async () => {
  const totp = require('../src/totp');
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const lien = (dest, param) => (db.prepare('SELECT corps FROM emails WHERE destinataire = ? ORDER BY id DESC').all(dest).map(x => (x.corps.match(new RegExp(`${param}=([\\w-]+)`)) || [])[1]).find(Boolean));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  try {
    const intrus = client();
    await intrus('POST', '/api/auth/inscription', { email: 'a@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'A' } } });
    await intrus('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
    // La titulaire avait « clé d'accès seule » et une clé ; l'intrus supprime la clé pendant la période.
    const mid = db.prepare('SELECT id FROM marchands').get().id;
    db.prepare("INSERT INTO cles_acces (id, marchand_id, nom, cle, compteur, cree_le) VALUES ('k1', ?, 'Tel', '{}', 0, ?)").run(mid, Date.now() - 30 * 86400000);
    db.prepare('UPDATE marchands SET cle_seule = 1, cle_seule_le = ?').run(Date.now() - 30 * 86400000);
    await intrus('POST', '/api/admin/compte/email', { email: 'b@pirate.example' });
    assert.equal((await client()('POST', '/api/auth/changer-email', { jeton: lien('b@pirate.example', 'changer-email') })).s, 200);
    db.prepare('DELETE FROM cles_acces').run();
    await client()('POST', '/api/auth/oubli', { email: 'b@pirate.example' });
    const resetIntrus = lien('b@pirate.example', 'reinitialiser');
    assert.ok(resetIntrus);
    assert.equal((await client()('POST', '/api/auth/annuler-changement-email', { jeton: lien('a@exemple.ch', 'annuler-email') })).s, 200);
    // Le lien de l'intrus ne sert plus ; celui de la titulaire, oui.
    assert.equal((await client()('POST', '/api/auth/reinitialiser', { jeton: resetIntrus, motDePasse: 'mot de passe du voleur 42!' })).j.code, 'lien_expire');
    assert.equal(db.prepare('SELECT cle_seule FROM marchands').get().cle_seule, 0, 'plus aucune clé : option retirée (pas 72 h de blocage)');
    const t = client();
    assert.equal((await t('POST', '/api/auth/reinitialiser', { jeton: lien('a@exemple.ch', 'reinitialiser'), motDePasse: 'nouveau mot de passe de la titulaire' })).s, 200);
    assert.equal((await t('GET', '/api/session')).j.connecte, true);
    // Codes refusés hors confirmation (ici, codes de secours) : comptés dans la session, qui est fermée au 5e.
    const prep = await t('POST', '/api/admin/compte/2fa/preparer');
    await t('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'nouveau mot de passe de la titulaire' });
    assert.equal((await t('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'nouveau mot de passe de la titulaire', code: totp.code(prep.j.secret, totp.pasActuel() - 1) })).s, 200);
    const v = client();
    const d = await v('POST', '/api/auth/connexion', { email: 'a@exemple.ch', motDePasse: 'nouveau mot de passe de la titulaire' });
    await v('POST', '/api/auth/connexion/2fa', { defi: d.j.defi, code: totp.code(prep.j.secret, totp.pasActuel()) });
    let dernier;
    for (let k = 0; k < 5; k++) dernier = await v('POST', '/api/admin/compte/2fa/codes', { motDePasse: 'nouveau mot de passe de la titulaire', code: '00000' + k });
    assert.equal(dernier.j.code, 'session_fermee');
    // La session de la titulaire n'est pas bloquée pour autant (compteur des codes propre à chaque session).
    assert.equal((await t('POST', '/api/admin/compte/2fa/codes', { motDePasse: 'nouveau mot de passe de la titulaire', code: totp.code(prep.j.secret, totp.pasActuel() + 1) })).s, 200);
  } finally { s.close(); }
});
