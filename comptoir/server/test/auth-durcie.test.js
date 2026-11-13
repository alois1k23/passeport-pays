// Durcissement de l'authentification : requêtes d'un autre site refusées (même sans corps), essais comptés par bloc
// d'adresses voisines, code de secours consommé une seule fois même en parallèle, appareils connus oubliés.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');

async function demarrer(env = {}) {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', ...env }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = (ip = '198.51.100.1', ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15') => {
    const jar = {};
    return async (m, chemin, corps, entetes = {}) => {
      const r = await fetch(base + chemin, { method: m, headers: { 'User-Agent': ua, 'X-Forwarded-For': ip, ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; '), ...entetes }, body: corps ? JSON.stringify(corps) : undefined });
      for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; }
      return { s: r.status, j: await r.json().catch(() => null) };
    };
  };
  return { db, s, base, client };
}

test('requête venue d’un autre site : refusée, même sans corps ; même site et webhooks acceptés', async () => {
  const { s, base, client } = await demarrer();
  try {
    const a = client();
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'csrf@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Csrf' } } })).s, 201);
    const hote = new URL(base).host;
    // Sans corps (déconnexion des autres appareils) : la règle « JSON obligatoire » ne la couvrait pas.
    assert.equal((await a('POST', '/api/admin/compte/deconnecter-autres', null, { 'Sec-Fetch-Site': 'cross-site' })).s, 403);
    assert.equal((await a('POST', '/api/admin/compte/deconnecter-autres', null, { 'Sec-Fetch-Site': 'same-site' })).s, 403, 'sous-domaine voisin refusé');
    assert.equal((await a('POST', '/api/admin/compte/deconnecter-autres', null, { Origin: 'https://attaquant.exemple' })).s, 403);
    assert.equal((await a('POST', '/api/admin/compte/deconnecter-autres', null, { Origin: 'null' })).s, 403, 'origine opaque (iframe sandbox) refusée');
    assert.equal((await a('POST', '/api/admin/compte/deconnecter-autres', null, { Origin: 'pas une url' })).s, 403);
    // Même origine (navigateur ou outil sans en-têtes de provenance) : accepté.
    assert.notEqual((await a('POST', '/api/admin/compte/deconnecter-autres', null, { 'Sec-Fetch-Site': 'same-origin', Origin: `http://${hote}` })).s, 403);
    assert.notEqual((await a('POST', '/api/admin/compte/deconnecter-autres')).s, 403);
    // Lecture (GET) jamais bloquée ; webhook (pas de navigateur) jamais bloqué par cette règle.
    assert.equal((await a('GET', '/api/admin/etat', null, { 'Sec-Fetch-Site': 'cross-site' })).s, 200);
    assert.notEqual((await a('POST', '/api/webhooks/stripe', { type: 'x' }, { 'Sec-Fetch-Site': 'cross-site' })).s, 403);
  } finally { s.close(); }
});

test('échecs de connexion comptés par compte et par bloc /24 ; ni l’appareil du marchand ni les voisins ne sont bloqués', async () => {
  const { s, client } = await demarrer({ LIMITE_ESSAIS: '4' });
  try {
    const proprio = client('192.0.2.50');
    assert.equal((await proprio('POST', '/api/auth/inscription', { email: 'bloc@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Bloc' } } })).s, 201);
    assert.equal((await proprio('POST', '/api/auth/connexion', { email: 'bloc@exemple.ch', motDePasse: 'un mot de passe solide' })).s, 200);
    // 4 échecs permis par adresse, 12 par compte et par bloc : changer d'adresse voisine ne remet pas le compteur à zéro.
    let dernier, essais = 0;
    for (let i = 1; i <= 10 && dernier !== 429; i++) {
      const c = client(`203.0.113.${i}`);
      for (let k = 0; k < 2 && dernier !== 429; k++) { dernier = (await c('POST', '/api/auth/connexion', { email: 'bloc@exemple.ch', motDePasse: 'mauvais mot' })).s; essais++; }
    }
    assert.equal(dernier, 429); assert.ok(essais <= 13, `bloqué après ${essais} essais`);
    // Même bon mot de passe depuis ce bloc, appareil inconnu : refusé.
    assert.equal((await client('203.0.113.77')('POST', '/api/auth/connexion', { email: 'bloc@exemple.ch', motDePasse: 'un mot de passe solide' })).s, 429);
    // Un voisin du même bloc, sur son propre compte : jamais bloqué par l'attaque (pas de compteur commun au bloc).
    const voisin = client('203.0.113.200');
    assert.equal((await voisin('POST', '/api/auth/inscription', { email: 'voisin@exemple.ch', motDePasse: 'un autre mot de passe sûr', config: { boutique: { nom: 'Voisin' } } })).s, 201);
    assert.equal((await client('203.0.113.201')('POST', '/api/auth/connexion', { email: 'voisin@exemple.ch', motDePasse: 'un autre mot de passe sûr' })).s, 200);
    // Le marchand, sur son appareil connu, depuis le bloc de l'attaquant (même café) : il passe.
    assert.equal((await proprio('POST', '/api/auth/connexion', { email: 'bloc@exemple.ch', motDePasse: 'un mot de passe solide' }, { 'X-Forwarded-For': '203.0.113.90' })).s, 200);
  } finally { s.close(); }
});

test('code de secours envoyé deux fois en parallèle : une seule connexion ; appareils connus oubliés à l’activation', async () => {
  const { db, s, client } = await demarrer();
  try {
    const a = client();
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'para@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Para' } } })).s, 201);
    const avant = db.prepare('SELECT COUNT(*) n FROM appareils_connus').get().n;
    assert.ok(avant >= 1, 'appareil noté à l’inscription');
    const prep = await a('POST', '/api/admin/compte/2fa/preparer');
    const act = await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel()) });
    assert.equal(act.s, 200);
    // Les appareils reconnus avant la double authentification ne contournent plus rien, sauf celui qui l'active
    // (son cookie atteint bien /api/admin : il n'est pas limité à /api/auth).
    assert.equal(db.prepare('SELECT COUNT(*) n FROM appareils_connus').get().n, 1);
    const b = client('198.51.100.9', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0'), c = client('198.51.100.10', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0');
    const d1 = (await b('POST', '/api/auth/connexion', { email: 'para@exemple.ch', motDePasse: 'un mot de passe solide' })).j.defi;
    const d2 = (await c('POST', '/api/auth/connexion', { email: 'para@exemple.ch', motDePasse: 'un mot de passe solide' })).j.defi;
    const code = act.j.codesSecours[0];
    const [r1, r2] = await Promise.all([b('POST', '/api/auth/connexion/2fa', { defi: d1, code }), c('POST', '/api/auth/connexion/2fa', { defi: d2, code })]);
    assert.deepEqual([r1.s, r2.s].sort(), [200, 401], 'un code de secours ne sert qu’une fois');
    // Ni pour désactiver la double authentification ensuite.
    assert.notEqual((await a('POST', '/api/admin/compte/2fa/desactiver', { motDePasse: 'un mot de passe solide', code })).s, 200);
    assert.equal(db.prepare('SELECT actif FROM deux_facteurs').get().actif, 1);
    // Révoquer la session d'un appareil révoque aussi cet appareil : il perd ses compteurs à part.
    const gagnant = r1.s === 200 ? b : c;
    const nAvant = db.prepare('SELECT COUNT(*) n FROM appareils_connus').get().n;
    const sec = await a('GET', '/api/admin/compte/securite');
    const autre = sec.j.sessions.find(x => !x.actuelle);
    assert.equal((await a('POST', `/api/admin/compte/sessions/${autre.id}/revoquer`)).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM appareils_connus').get().n, nAvant - 1);
    assert.equal((await gagnant('GET', '/api/admin/etat')).s, 401);
  } finally { s.close(); }
});
