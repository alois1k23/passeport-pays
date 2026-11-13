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
    // Adresse déjà prise : même réponse (pas de repérage), seule sa titulaire est prévenue.
    assert.deepEqual((await a('POST', '/api/admin/compte/email', { email: 'prise@exemple.ch' })).j, { ok: true });
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'prise@exemple.ch' AND sujet = 'Demande de changement d’adresse Comptoir'").get());
    // Identité récente exigée.
    db.prepare("UPDATE sessions SET cree_le = cree_le - 30 * 60000 WHERE marchand_id = (SELECT id FROM marchands WHERE email = 'ancien@exemple.ch')").run();
    assert.equal((await a('POST', '/api/admin/compte/email', { email: 'nouveau@exemple.ch' })).j.code, 'identite_a_confirmer');
    await a('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
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
