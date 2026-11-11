// Sécurité du compte marchand : double authentification, codes de secours, appareils connectés, journal, alertes.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');

test('double authentification de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = (ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15') => {
    const jar = {};
    return async (m, chemin, corps) => {
      const r = await fetch(base + chemin, { method: m, headers: { 'User-Agent': ua, ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined });
      for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; }
      return { s: r.status, j: await r.json().catch(() => null) };
    };
  };
  try {
    const a = client();
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Sûre' } } })).s, 201);
    // Mise en place : secret, premier code, mot de passe exigé
    const prep = await a('POST', '/api/admin/compte/2fa/preparer');
    assert.match(prep.j.uri, /^otpauth:\/\/totp\//);
    assert.ok(!JSON.stringify(db.prepare('SELECT secret FROM deux_facteurs').get()).includes(prep.j.secret), 'secret chiffré en base');
    assert.equal((await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: '000000' })).s, 400);
    assert.equal((await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'faux faux faux', code: totp.code(prep.j.secret, totp.pasActuel()) })).s, 401);
    const act = await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.j.secret, totp.pasActuel()) });
    assert.equal(act.s, 200); assert.equal(act.j.codesSecours.length, 10);
    // Connexion depuis un autre appareil : mot de passe seul ne suffit plus
    const b = client('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36');
    const c1 = await b('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal(c1.j.deuxFacteurs, true); assert.ok(c1.j.defi);
    assert.equal((await b('GET', '/api/admin/etat')).s, 401, 'aucune session avant le second facteur');
    assert.equal((await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi + 'x', code: '123456' })).s, 401, 'défi falsifié refusé');
    // Le code déjà utilisé à l'activation ne sert pas une seconde fois
    const pas = totp.pasActuel();
    const deja = await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi, code: totp.code(prep.j.secret, pas) });
    if (deja.s === 200) assert.fail('code rejoué accepté');
    const ok2 = await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi, code: act.j.codesSecours[0] });
    assert.equal(ok2.s, 200, 'code de secours accepté');
    assert.equal((await b('GET', '/api/admin/etat')).s, 200);
    // Le même code de secours ne resservira pas
    const c2 = await client()('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal((await client()('POST', '/api/auth/connexion/2fa', { defi: c2.j.defi, code: act.j.codesSecours[0] })).s, 401);
    // Alerte de nouvel appareil et journal
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'sur@exemple.ch' AND sujet = 'Nouvelle connexion à votre compte Comptoir'").get());
    const sec = await a('GET', '/api/admin/compte/securite');
    assert.equal(sec.j.deuxFacteurs, true); assert.equal(sec.j.codesSecoursRestants, 9);
    assert.ok(sec.j.sessions.some(x => x.appareil === 'Chrome sur Android') && sec.j.sessions.some(x => x.actuelle && x.appareil === 'Safari sur Mac'));
    assert.ok(['2fa-activee', 'code-secours', 'connexion', 'echec-2fa'].every(t => sec.j.journal.some(x => x.type === t)), sec.j.journal.map(x => x.type).join());
    // Révocation de l'appareil Android
    const android = sec.j.sessions.find(x => x.appareil === 'Chrome sur Android');
    assert.equal((await a('POST', `/api/admin/compte/sessions/${android.id}/revoquer`)).s, 200);
    assert.equal((await b('GET', '/api/admin/etat')).s, 401, 'appareil révoqué déconnecté');
    // Trop d'essais de code : bloqué
    const c3 = await client()('POST', '/api/auth/connexion', { email: 'sur@exemple.ch', motDePasse: 'un mot de passe solide' });
    const x = client(); let dernier;
    for (let k = 0; k < 7; k++) dernier = (await x('POST', '/api/auth/connexion/2fa', { defi: c3.j.defi, code: String(100000 + k) })).s;
    assert.equal(dernier, 429);
    // Désactivation : mot de passe et code exigés
    assert.equal((await a('POST', '/api/admin/compte/2fa/desactiver', { motDePasse: 'un mot de passe solide', code: '000000' })).s, 400);
  } finally { s.close(); }
});
