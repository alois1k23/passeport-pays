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
