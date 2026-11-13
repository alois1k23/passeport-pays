// Robustesse HTTP : requêtes impossibles à lire, JSON aux clés piégées, dates invalides, corps non objets.
// Aucune ne doit faire tomber le processus ni renvoyer d'erreur 500.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('requêtes hostiles : jamais de plantage ni d’erreur 500', async () => {
  const erreurs = [];
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const port = s.address().port, base = `http://127.0.0.1:${port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '100000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error: (...a) => { if (String(a[0]).startsWith('[erreur]')) erreurs.push(String(a[1])); } } }));
  const brut = ligne => new Promise(ok => { const c = net.connect(port, '127.0.0.1', () => c.write(`${ligne} HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n`)); let r = ''; c.on('data', d => { r += d; }); c.on('end', () => ok(r)); c.on('error', () => ok(r)); });
  let cookie = '';
  const appel = async (m, chemin, texte) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: texte }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return r.status; };
  try {
    // Adresses impossibles à lire : 400, et le serveur répond encore ensuite.
    for (const l of ['GET //', 'GET //:x', 'GET http://[']) assert.match(await brut(l), /^HTTP\/1\.1 400/, l);
    assert.equal((await fetch(base + '/api/session')).status, 200, 'toujours en vie');
    await appel('POST', '/api/auth/inscription', JSON.stringify({ email: 'r@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'R', pays: 'ch', secteur: 'maison', sections: [] } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] }));
    const slug = db.prepare('SELECT slug FROM boutiques').get().slug;
    // Objets aux clés « toString » / « valueOf » : ignorées à la lecture (plus de « Cannot convert object to primitive value »).
    const piege = JSON.stringify({ code: { toString: 1 }, jeton: { valueOf: 1 }, commandeId: { toString: 'x' }, email: { toString: 1 }, type: { toString: 1 }, session: { valueOf: 1 } });
    for (const chemin of [`/api/public/${slug}/code`, `/api/public/${slug}/avis`, `/api/public/${slug}/evenement`, `/api/public/${slug}/fidelite/solde`, `/api/public/${slug}/carte-cadeau`, `/api/public/${slug}/commandes/x/abandonner`, '/api/admin/cartes-cadeaux', '/api/admin/compte/mot-de-passe'])
      assert.ok((await appel('POST', chemin, piege)) < 500, chemin);
    // Dates impossibles dans l'export des cartes : 400.
    for (const q of ['fin=2026-13-01', 'debut=2026-02-30', 'debut=9999-99-99']) assert.equal(await appel('GET', `/api/admin/cartes-cadeaux/export?${q}`), 400, q);
    // Corps JSON non objets hors de /api/ (fournisseur de démonstration, webhooks) : jamais d'erreur 500.
    for (const corps of ['null', '[1]', '42', '{"lignes":[null]}']) assert.ok((await appel('POST', '/demo-fournisseur/commandes', corps)) < 500, corps);
    assert.deepEqual(erreurs, [], 'aucune exception non gérée');
  } finally { s.close(); }
});
