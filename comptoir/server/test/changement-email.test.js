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
