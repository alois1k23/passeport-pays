// Session liée à son appareil : un cookie rejoué depuis un autre navigateur ou système ferme la session.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  chromeMacNeuf: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  safariIpad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  appIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeAndroidOrdi: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0'
};

test('cookie rejoué depuis un autre navigateur ou système : session fermée, titulaire prévenue ; mises à jour et iPad tolérés', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = async (m, chemin, { cookie = '', ua, corps } = {}) => {
    const r = await fetch(base + chemin, { method: m, headers: { 'User-Agent': ua, ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    return { s: r.status, j: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).filter(x => x.startsWith('__Host-') || x.includes('session')).join('; ') };
  };
  try {
    const ins = await appel('POST', '/api/auth/inscription', { ua: UA.chromeMac, corps: { email: 'app@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'App' } } } });
    const cookie = ins.cookie;
    assert.ok(cookie);
    await appel('POST', '/api/auth/verifier-email', { ua: UA.chromeMac, corps: { jeton: db.prepare("SELECT corps FROM emails WHERE sujet LIKE 'Confirmez%'").get().corps.match(/verifier-email=([\w-]+)/)[1] } });
    // Même navigateur, mis à jour : la session continue.
    assert.equal((await appel('GET', '/api/admin/etat', { cookie, ua: UA.chromeMacNeuf })).s, 200);
    // Le cookie copié vers Firefox sous Windows : refusé, et la session est fermée pour tout le monde.
    assert.equal((await appel('GET', '/api/admin/etat', { cookie, ua: UA.firefoxWin })).s, 401);
    assert.equal((await appel('GET', '/api/session', { cookie, ua: UA.chromeMac })).j.connecte, false, 'même le navigateur d’origine doit se reconnecter');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
    assert.ok(db.prepare("SELECT 1 FROM journal_compte WHERE type = 'session-autre-appareil' AND detail LIKE '%Firefox sur Windows%'").get());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet = 'Session fermée : utilisée depuis un autre appareil'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM signaux_securite WHERE type = 'session-autre-appareil'").get().n, 1, 'signal pour la console de l’exploitant');

    // Safari sur iPad qui se présente tantôt en iPad, tantôt en Mac : toléré.
    const c2 = (await appel('POST', '/api/auth/connexion', { ua: UA.safariIpad, corps: { email: 'app@exemple.ch', motDePasse: 'un mot de passe solide' } })).cookie;
    assert.equal((await appel('GET', '/api/admin/etat', { cookie: c2, ua: UA.safariMac })).s, 200);
    assert.equal((await appel('GET', '/api/session', { cookie: c2, ua: UA.safariIpad })).j.connecte, true);
    // Mais un autre navigateur sur le même système : refusé (et pas de second e-mail avant 6 heures).
    assert.equal((await appel('GET', '/api/session', { cookie: c2, ua: UA.chromeMac })).j.connecte, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet = 'Session fermée : utilisée depuis un autre appareil'").get().n, 1);
    // App installée sur l'écran d'accueil de l'iPhone (sans « Safari » dans l'en-tête) après connexion dans Safari : tolérée.
    const c4 = (await appel('POST', '/api/auth/connexion', { ua: UA.safariIphone, corps: { email: 'app@exemple.ch', motDePasse: 'un mot de passe solide' } })).cookie;
    assert.equal((await appel('GET', '/api/session', { cookie: c4, ua: UA.appIphone })).j.connecte, true);
    // Android en « version pour ordinateur » (se présente comme Linux) : tolérée ; un autre navigateur Android : refusé.
    const c5 = (await appel('POST', '/api/auth/connexion', { ua: UA.chromeAndroid, corps: { email: 'app@exemple.ch', motDePasse: 'un mot de passe solide' } })).cookie;
    assert.equal((await appel('GET', '/api/session', { cookie: c5, ua: UA.chromeAndroidOrdi })).j.connecte, true);
    assert.equal((await appel('GET', '/api/session', { cookie: c5, ua: UA.firefoxAndroid })).j.connecte, false);
    // Un Mac avec un autre navigateur que celui de la session : refusé (la tolérance iOS ne s'étend pas au Mac).
    const c6 = (await appel('POST', '/api/auth/connexion', { ua: UA.safariMac, corps: { email: 'app@exemple.ch', motDePasse: 'un mot de passe solide' } })).cookie;
    assert.equal((await appel('GET', '/api/session', { cookie: c6, ua: UA.chromeMac })).j.connecte, false);
    // Sessions d'avant la règle (appareil inconnu) : l'appareil est noté au premier passage, puis vérifié.
    const c3 = (await appel('POST', '/api/auth/connexion', { ua: UA.firefoxWin, corps: { email: 'app@exemple.ch', motDePasse: 'un mot de passe solide' } })).cookie;
    db.prepare('UPDATE sessions SET appareil = NULL').run();
    assert.equal((await appel('GET', '/api/session', { cookie: c3, ua: UA.firefoxWin })).j.connecte, true);
    assert.ok(db.prepare("SELECT 1 FROM sessions WHERE appareil = 'Firefox sur Windows'").get(), 'appareil noté');
  } finally { s.close(); }
});
