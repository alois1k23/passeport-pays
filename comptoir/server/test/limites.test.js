// Limite de débit sur la création de commandes publiques (30 par adresse et par quart d'heure).
'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict'); const http = require('node:http');
const { ouvrir } = require('../src/db'); const { creerApp } = require('../src/app');
test('limite de commandes publiques par adresse', async () => {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db: ouvrir(':memory:'), env: { ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const ins = await (await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'lim@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Limite' }, entreprise: { raison: 'L', adresse: 'Rue 1, 1003 Lausanne' } } }) })).json();
  const codes = []; for (let k = 0; k < 35; k++) codes.push((await fetch(`${base}/api/public/${ins.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
  // Une boutique inventée ne crée pas de compteur (et répond 404)
  assert.equal((await fetch(base + '/api/public/inventee-' + Date.now() + '/commandes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
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

test('un tiers ne peut pas verrouiller le compte d’un marchand depuis d’autres adresses', async () => {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db: ouvrir(':memory:'), env: { LIMITE_ESSAIS: '5' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = (chemin, corps, ip) => fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(corps) });
  await appel('/api/auth/inscription', { email: 'victime@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Victime' } } }, '203.0.113.50');
  for (let k = 0; k < 10; k++) await appel('/api/auth/connexion', { email: 'victime@exemple.ch', motDePasse: 'mauvais' }, `198.51.100.${k + 1}`);
  assert.equal((await appel('/api/auth/connexion', { email: 'victime@exemple.ch', motDePasse: 'un mot de passe solide' }, '203.0.113.50')).status, 200);
  s.close();
});

test('attaque répartie sur un compte : le marchand se connecte quand même depuis son appareil ; IPv6 compté par réseau', async () => {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db: ouvrir(':memory:'), env: { LIMITE_ESSAIS: '3' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = (corps, ip, cookie) => fetch(base + '/api/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(corps) });
  await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' }, body: JSON.stringify({ email: 'cible@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Cible' } } }) });
  // Le marchand se connecte une fois chez lui : son appareil reçoit le cookie signé
  const r0 = await appel({ email: 'cible@exemple.ch', motDePasse: 'un mot de passe solide' }, '203.0.113.9');
  const appareil = r0.headers.getSetCookie().find(c => c.startsWith('comptoir_appareil=')).split(';')[0];
  // 25 adresses × 3 échecs : seuil du compte (60) dépassé
  for (let k = 1; k <= 25; k++) for (let n = 0; n < 3; n++) await appel({ email: 'cible@exemple.ch', motDePasse: 'faux' }, `198.51.100.${k}`);
  assert.equal((await appel({ email: 'cible@exemple.ch', motDePasse: 'un mot de passe solide' }, '192.0.2.77')).status, 429, 'appareil inconnu : bloqué');
  assert.equal((await appel({ email: 'cible@exemple.ch', motDePasse: 'un mot de passe solide' }, '192.0.2.77', appareil)).status, 200, 'son appareil passe toujours');
  // IPv6 : trois adresses du même /64 partagent la même limite
  for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:0db8:0001:0002:aaaa::3']) await appel({ email: 'x@exemple.ch', motDePasse: 'faux' }, ip);
  assert.equal((await appel({ email: 'y@exemple.ch', motDePasse: 'faux' }, '2001:db8:1:2:ffff::9')).status, 429);
  s.close();
});

test('connexion : des essais lancés en parallèle ne contournent pas la limite', async () => {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db: ouvrir(':memory:'), env: { LIMITE_ESSAIS: '5' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = (chemin, corps, ip) => fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(corps) });
  assert.equal((await appel('/api/auth/inscription', { email: 'rafale@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Rafale' } } }, '203.0.113.9')).status, 201);
  const codes = (await Promise.all(Array.from({ length: 40 }, (_, k) => appel('/api/auth/connexion', { email: 'rafale@exemple.ch', motDePasse: 'mauvais ' + k }, '198.51.100.20')))).map(r => r.status);
  assert.ok(codes.filter(c => c === 401).length <= 5, codes.join(','));
  assert.ok(codes.filter(c => c === 429).length >= 35, codes.join(','));
  s.close();
});
