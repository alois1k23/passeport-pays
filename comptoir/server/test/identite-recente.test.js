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

test('IBAN : le changer (ou activer la facture QR) demande une identité récente, et le propriétaire est prévenu', async () => {
  const { db, s, c } = await demarrer();
  try {
    await c('POST', '/api/auth/inscription', { email: 'iban@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Iban', pays: 'ch' } } });
    const conf = (await c('GET', '/api/admin/etat')).j;
    conf.entreprise = { ...(conf.entreprise || {}), raison: 'Iban Sàrl', iban: 'CH93 0076 2011 6238 5295 7' };
    assert.equal((await c('PUT', '/api/admin/config', { config: conf })).s, 200, 'juste après la connexion : permis');
    vieillir(db, 20);
    // Autre réglage, même IBAN : permis sans confirmation (l'enregistrement automatique n'est pas gêné).
    conf.boutique.slogan = 'Nouveau slogan';
    assert.equal((await c('PUT', '/api/admin/config', { config: conf })).s, 200);
    // IBAN d'un tiers : refusé sans identité confirmée, et rien n'est enregistré.
    conf.entreprise.iban = 'CH56 0483 5012 3456 7800 9';
    const refus = await c('PUT', '/api/admin/config', { config: conf });
    assert.equal(refus.s, 403); assert.equal(refus.j.code, 'identite_a_confirmer');
    assert.match(JSON.parse(db.prepare('SELECT config FROM boutiques').get().config).entreprise.iban, /0076/);
    await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' });
    assert.equal((await c('PUT', '/api/admin/config', { config: conf })).s, 200);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'iban@exemple.ch' AND sujet = 'IBAN de votre boutique modifié'").get(), 'propriétaire prévenu');
    assert.ok((await c('GET', '/api/admin/compte/securite')).j.journal.some(x => x.type === 'iban-modifie'));
  } finally { s.close(); }
});

test('sessions d’avant la règle : pas comptées comme identité récente au premier démarrage', async () => {
  const { db: _d, s, c } = await demarrer();
  try {
    await c('POST', '/api/auth/inscription', { email: 'vieille@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Vieille' } } });
    _d.prepare('UPDATE sessions SET cree_le = NULL, identite_le = NULL').run();
    // Redémarrage : la migration donne à ces sessions une date « d'il y a plus de 15 minutes ».
    creerApp({ db: _d, env: { ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: 'http://x', journal: { log() {}, error() {} } });
    const sess = _d.prepare('SELECT cree_le FROM sessions').get();
    assert.ok(sess.cree_le < Date.now() - 15 * 60000 && sess.cree_le > Date.now() - 20 * 60000);
  } finally { s.close(); }
});

test('premier IBAN, réinitialisation, e-mail de l’entreprise, domaine : mêmes exigences d’identité récente', async () => {
  const { db, s, c } = await demarrer();
  try {
    await c('POST', '/api/auth/inscription', { email: 'pre@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Pre', pays: 'ch' }, entreprise: { raison: 'Pre Sàrl', email: 'contact@pre.example' } } });
    vieillir(db, 20);
    const conf = (await c('GET', '/api/admin/etat')).j;
    // Premier IBAN (la boutique n'en avait pas) : exigé aussi.
    assert.equal((await c('PUT', '/api/admin/config', { config: { ...conf, entreprise: { ...conf.entreprise, iban: 'CH56 0483 5012 3456 7800 9' } } })).j.code, 'identite_a_confirmer');
    // Par la réinitialisation de la boutique : même règle (avant, elle passait sans contrôle ni alerte).
    assert.equal((await c('POST', '/api/admin/reinitialiser', { config: { ...conf, entreprise: { ...conf.entreprise, iban: 'CH56 0483 5012 3456 7800 9' }, reglages: { ...(conf.reglages || {}), factureQr: true } }, produits: [] })).j.code, 'identite_a_confirmer');
    assert.equal(JSON.parse(db.prepare('SELECT config FROM boutiques').get().config).entreprise.iban || '', '', 'rien d’enregistré');
    // E-mail de contact de l'entreprise (adresse de réponse des e-mails aux clients).
    assert.equal((await c('PUT', '/api/admin/config', { config: { ...conf, entreprise: { ...conf.entreprise, email: 'pirate@exemple.example' } } })).j.code, 'identite_a_confirmer');
    // Vérification d'un domaine.
    assert.equal((await c('POST', '/api/admin/domaine/verifier', { domaine: 'boutique.exemple.ch' })).j.code, 'identite_a_confirmer');
    // Un autre réglage passe sans confirmation (enregistrement automatique).
    assert.equal((await c('PUT', '/api/admin/config', { config: { ...conf, boutique: { ...conf.boutique, slogan: 'Bonjour' } } })).s, 200);
  } finally { s.close(); }
});

test('essais de mot de passe refusés dans une session : au 5e, la session est fermée et la titulaire prévenue', async () => {
  const { db, s, c } = await demarrer();
  try {
    await c('POST', '/api/auth/inscription', { email: 'vol@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Vol' } } });
    const jeton = db.prepare('SELECT jeton_hash FROM sessions').get().jeton_hash;
    // Une seconde session (la titulaire, sur un autre appareil) : intacte.
    db.prepare("INSERT INTO sessions (jeton_hash, marchand_id, expire_le, cree_le, vu_le) SELECT 'autre', marchand_id, expire_le, cree_le, vu_le FROM sessions").run();
    // Une réussite remet le compteur à zéro.
    for (let k = 0; k < 4; k++) assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'mauvais ' + k })).s, 401);
    assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'un mot de passe solide' })).s, 200);
    assert.equal(db.prepare('SELECT echecs_identite n FROM sessions WHERE jeton_hash = ?').get(jeton).n, 0);
    // Essais répartis sur plusieurs routes qui redemandent le mot de passe : comptés ensemble.
    assert.equal((await c('POST', '/api/admin/compte/cles-acces/options', { motDePasse: 'mauvais a' })).s, 401);
    assert.equal((await c('POST', '/api/admin/compte/mot-de-passe', { actuel: 'mauvais b', nouveau: 'un autre mot de passe sûr' })).s, 401);
    for (let k = 0; k < 2; k++) assert.equal((await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'mauvais c' + k })).s, 401);
    const fin = await c('POST', '/api/admin/compte/confirmer-identite', { motDePasse: 'mauvais d' });
    assert.equal(fin.s, 401); assert.equal(fin.j.code, 'session_fermee');
    assert.equal((await c('GET', '/api/session')).j.connecte, false, 'session fermée');
    assert.ok(db.prepare("SELECT 1 FROM sessions WHERE jeton_hash = 'autre'").get(), 'les autres sessions restent');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'vol@exemple.ch' AND sujet = 'Session fermée après des essais de confirmation refusés'").get());
    assert.ok(db.prepare("SELECT 1 FROM journal_compte WHERE type = 'session-fermee-echecs'").get());
  } finally { s.close(); }
});
