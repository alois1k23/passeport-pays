// Santé et console de l'exploitant : invisible pour les marchands, exige un compte protégé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');

test('santé et console de l’exploitant', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', OPERATEUR_EMAILS: 'chef@comptoir.example' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; } const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* html */ } return { s: r.status, j, t }; }; };
  try {
    const sante = await client()('GET', '/sante');
    assert.equal(sante.s, 200); assert.equal(sante.j.ok, true); assert.deepEqual(Object.keys(sante.j).sort(), ['depuis', 'ok'], 'aucune donnée sensible');
    const marchand = client();
    await marchand('POST', '/api/auth/inscription', { email: 'marchand@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'M' } } });
    assert.equal((await marchand('GET', '/operateur')).s, 404, 'invisible pour un marchand');
    assert.equal((await client()('GET', '/operateur')).s, 404, 'invisible sans connexion');
    const op = client();
    await op('POST', '/api/auth/inscription', { email: 'chef@comptoir.example', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Op' } } });
    assert.match((await op('GET', '/operateur')).t, /Activez d’abord la double authentification/);
    const prep = (await op('POST', '/api/admin/compte/2fa/preparer')).j;
    assert.equal((await op('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.secret, totp.pasActuel()) })).s, 200);
    const page = await op('GET', '/operateur');
    assert.equal(page.s, 200); assert.match(page.t, /Comptes marchands/); assert.match(page.t, /Revenu mensuel récurrent/);
    assert.doesNotMatch(page.t, /marchand@exemple\.ch/, 'aucune adresse affichée');
  } finally { s.close(); }
});
