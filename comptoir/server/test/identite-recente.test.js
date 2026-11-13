// Identité confirmée récemment pour les actions sensibles (clé d'API, webhook, nouveau secret, invitation d'équipe) et
// durée de vie absolue des sessions : un cookie volé ne suffit pas à ouvrir un accès durable aux données, ni ne vit
// indéfiniment.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');

async function demarrer() {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const jar = {};
  const c = async (m, chemin, corps) => {
    const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined });
    for (const x of r.headers.getSetCookie()) { const [nv] = x.split(';'); jar[nv.split('=')[0]] = nv; }
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  return { db, s, c };
}
const vieillir = (db, minutes) => db.prepare('UPDATE sessions SET cree_le = cree_le - ?, identite_le = identite_le - ?').run(minutes * 60000, minutes * 60000);

test('action sensible : identité confirmée depuis moins de 15 minutes, mot de passe et code exigés', async () => {
  const { db, s, c } = await demarrer();
  try {
    assert.equal((await c('POST', '/api/auth/inscription', { email: 'id@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Id' } } })).s, 201);
    const lien = db.prepare("SELECT corps FROM emails WHERE sujet LIKE 'Confirmez%'").get().corps.match(/verifier-email=([\w-]+)/)[1];
    await c('POST', '/api/auth/verifier-email', { jeton: lien });
    // Juste après la connexion : l'action passe.
    assert.equal((await c('POST', '/api/admin/equipe/inviter', { email: 'a@exemple.ch', role: 'commandes' })).s, 201);
    // 20 minutes plus tard (cookie copié, par exemple) : refusée tant que l'identité n'est pas confirmée.
    vieillir(db, 20);
    const refus = await c('POST', '/api/admin/equipe/inviter', { email: 'b@exemple.ch', role: 'commandes' });
    assert.equal(refus.s, 403); assert.equal(refus.j.code, 'identite_a_confirmer');
    assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'faux mot de passe' })).s, 401);
    assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' })).s, 200);
    assert.equal((await c('POST', '/api/admin/equipe/inviter', { email: 'b@exemple.ch', role: 'commandes' })).s, 201);
    assert.ok((await c('GET', '/api/admin/compte/securite')).j.journal.some(x => x.type === 'identite-confirmee'));
    // Double authentification active : le code est exigé aussi.
    const prep = await c('POST', '/api/admin/compte/2fa/preparer');
    vieillir(db, 1);   // l'activation elle-même demande déjà mot de passe et code
    assert.equal((await c('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel()) })).s, 200);
    vieillir(db, 20);
    assert.equal((await c('GET', '/api/session')).j.deuxFacteurs, true);
    assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' })).j.code, 'code_2fa');
    assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel() + 1) })).s, 200);
    assert.equal((await c('POST', '/api/admin/equipe/inviter', { email: 'c@exemple.ch', role: 'commandes' })).s, 201);
    // Compte « clé d'accès seule » : le mot de passe ne suffit pas.
    db.prepare('UPDATE marchands SET cle_seule = 1').run(); vieillir(db, 20);
    assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide', code: '000000' })).j.code, 'cle_seule');
  } finally { s.close(); }
});

test('session : durée de vie absolue de 90 jours, même utilisée chaque jour', async () => {
  const { db, s, c } = await demarrer();
  try {
    await c('POST', '/api/auth/inscription', { email: 'vie@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Vie' } } });
    assert.equal((await c('GET', '/api/session')).j.connecte, true);
    // Utilisée la veille de ses 90 jours : renouvelée sans dépasser la limite absolue.
    db.prepare('UPDATE sessions SET cree_le = ?, expire_le = ?').run(Date.now() - 89 * 86400000, Date.now() + 3 * 86400000);
    assert.equal((await c('GET', '/api/session')).j.connecte, true);
    assert.ok(db.prepare('SELECT expire_le FROM sessions').get().expire_le < Date.now() + 5 * 86400000, 'pas repoussée de 30 jours au-delà des 90');
    // Au-delà de 90 jours : fermée et effacée.
    db.prepare('UPDATE sessions SET cree_le = ?, expire_le = ?').run(Date.now() - 91 * 86400000, Date.now() + 20 * 86400000);
    assert.equal((await c('GET', '/api/session')).j.connecte, false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  } finally { s.close(); }
});
