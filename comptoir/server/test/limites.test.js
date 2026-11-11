// Limite de débit sur la création de commandes publiques (30 par adresse et par quart d'heure).
'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict'); const http = require('node:http');
const { ouvrir } = require('../src/db'); const { creerApp } = require('../src/app');
test('limite de commandes publiques par adresse', async () => {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db: ouvrir(':memory:'), env: {}, urlPublique: base, journal: { log() {}, error() {} } }));
  const codes = []; for (let k = 0; k < 35; k++) codes.push((await fetch(base + '/api/public/x/commandes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
  s.close(); assert.equal(codes.slice(0, 30).filter(c => c === 429).length, 0); assert.ok(codes.slice(30).every(c => c === 429), codes.join(','));
});

test('connexion : les réussites ne comptent pas, les échecs sont limités par compte, chaque client derrière le proxy compte à part', async () => {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db: ouvrir(':memory:'), env: { LIMITE_ESSAIS: '5' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = (chemin, corps, ip) => fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(corps) });
  assert.equal((await appel('/api/auth/inscription', { email: 'limite@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Limite' } } }, '203.0.113.1')).status, 201);
  // 12 connexions réussies depuis la même adresse : jamais bloquées
  for (let k = 0; k < 12; k++) assert.equal((await appel('/api/auth/connexion', { email: 'limite@exemple.ch', motDePasse: 'un mot de passe solide' }, '203.0.113.1')).status, 200);
  // Un attaquant (autre adresse) épuise ses essais sur un compte inexistant : bloqué lui seul
  for (let k = 0; k < 5; k++) assert.equal((await appel('/api/auth/connexion', { email: 'autre@exemple.ch', motDePasse: 'faux faux faux' }, '198.51.100.7')).status, 401);
  assert.equal((await appel('/api/auth/connexion', { email: 'autre@exemple.ch', motDePasse: 'faux faux faux' }, '198.51.100.7')).status, 429);
  assert.equal((await appel('/api/auth/connexion', { email: 'limite@exemple.ch', motDePasse: 'un mot de passe solide' }, '203.0.113.1')).status, 200, 'les autres clients ne sont pas bloqués');
  // Un X-Forwarded-For forgé à gauche ne change pas l'adresse retenue (la dernière, ajoutée par le proxy)
  assert.equal((await appel('/api/auth/connexion', { email: 'autre2@exemple.ch', motDePasse: 'x' }, '1.2.3.4, 198.51.100.7')).status, 429);
  s.close();
});
