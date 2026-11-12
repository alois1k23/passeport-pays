// Rapports de violation CSP : les deux formats des navigateurs, sans données personnelles, limités.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('rapports de violation CSP', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const poster = (corps, type) => fetch(base + '/csp-rapport', { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(corps) });
  try {
    const page = await fetch(base + '/');
    assert.match(page.headers.get('content-security-policy'), /report-uri \/csp-rapport$/);
    // Ancien format (report-uri)
    assert.equal((await poster({ 'csp-report': { 'document-uri': `${base}/s/boutique?email=lea@exemple.ch&jeton=secret`, 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://pirate.exemple/vol.js?c=123' } }, 'application/csp-report')).status, 200);
    // Nouveau format (Reporting API)
    assert.equal((await poster([{ type: 'csp-violation', body: { documentURL: `${base}/app#commandes`, effectiveDirective: 'img-src', blockedURL: 'https://traceur.exemple/p.gif?id=9' } }, { type: 'deprecation', body: {} }], 'application/reports+json')).status, 200);
    const lignes = db.prepare('SELECT directive, bloque, page FROM csp_rapports ORDER BY rowid').all();
    assert.deepEqual(lignes.map(x => ({ ...x })), [
      { directive: 'script-src-elem', bloque: 'https://pirate.exemple', page: `${base}/s/…` },
      { directive: 'img-src', bloque: 'https://traceur.exemple', page: `${base}/app` }
    ], 'ni requête, ni ancre, ni identifiant dans le chemin, ni chemin de la ressource bloquée');
    // Origine géante tronquée, règle inventée refusée, même violation depuis le même réseau comptée une fois par jour.
    await poster({ 'csp-report': { 'document-uri': base + '/', 'violated-directive': 'img-src', 'blocked-uri': `https://${'a'.repeat(5000)}.x/` } }, 'application/csp-report');
    await poster({ 'csp-report': { 'document-uri': base + '/', 'violated-directive': 'appelez-le-0800', 'blocked-uri': 'https://faux.exemple' } }, 'application/csp-report');
    await poster({ 'csp-report': { 'document-uri': base + '/', 'violated-directive': 'img-src', 'blocked-uri': 'https://traceur.exemple/autre.gif' } }, 'application/csp-report');
    assert.ok(db.prepare('SELECT MAX(LENGTH(bloque)) n FROM csp_rapports').get().n <= 100);
    assert.ok(!db.prepare("SELECT 1 FROM csp_rapports WHERE directive = 'appelez-le-0800'").get());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM csp_rapports WHERE bloque = 'https://traceur.exemple'").get().n, 1);
    assert.equal((await fetch(base + '/csp-rapport', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: 'x'.repeat(20000) })).status, 413, 'corps limité à 16 Ko');
    // Corps invalide : ignoré sans erreur ; au-delà de 30 rapports en 10 minutes par réseau : ignorés.
    assert.equal((await fetch(base + '/csp-rapport', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: 'pas du json' })).status, 200);
    for (let i = 0; i < 40; i++) await poster({ 'csp-report': { 'document-uri': base + '/', 'violated-directive': 'img-src', 'blocked-uri': 'data' } }, 'application/csp-report');
    assert.ok(db.prepare('SELECT COUNT(*) n FROM csp_rapports').get().n <= 30);
  } finally { s.close(); }
});
