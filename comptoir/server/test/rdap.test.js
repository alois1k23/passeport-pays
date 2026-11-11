// Disponibilité des noms de domaine : interrogation du registre (RDAP), ici simulé par un petit serveur local.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

let serveur, registre, base, demandes = 0;
const silencieux = { log() {}, error() {} };

before(async () => {
  // Registre factice : « libre-… » n'existe pas (404), « panne-… » répond 503, tout le reste est enregistré (200).
  registre = http.createServer((req, res) => {
    demandes++;
    if (/\/domain\/libre-/.test(req.url)) { res.writeHead(404); return res.end(); }
    if (/\/domain\/panne-/.test(req.url)) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/rdap+json' }); res.end('{"objectClassName":"domain"}');
  });
  await new Promise(ok => registre.listen(0, '127.0.0.1', ok));
  serveur = http.createServer();
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
  serveur.on('request', creerApp({ db: ouvrir(':memory:'), env: { LIMITES_FACTEUR: '1000', RDAP_URL: `http://127.0.0.1:${registre.address().port}` }, urlPublique: base, journal: silencieux }));
});
after(() => { serveur.close(); registre.close(); });

test('disponibilité d’un domaine : libre, pris, registre injoignable, saisie invalide', async () => {
  let cookie = '';
  const c = async (m, chemin, corps) => {
    const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); return { statut: r.status, json: t ? JSON.parse(t) : null };
  };
  // Sans compte : refusé
  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=libre-test.ch')).statut, 401);
  assert.equal((await c('POST', '/api/auth/inscription', { email: 'rdap@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Registre', pays: 'ch', secteur: 'maison' } } })).statut, 201);
  const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'lancement' })).json;
  await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });

  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=libre-test.ch')).json.etat, 'libre');
  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=lacustre.ch')).json.etat, 'pris');
  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=panne-test.ch')).json.etat, 'inconnu');
  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=pas%20un%20domaine')).statut, 400);
  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=../../etc')).statut, 400);
  // Mise en cache : une seconde question sur le même domaine n'interroge pas le registre
  const avant = demandes;
  assert.equal((await c('GET', '/api/admin/domaine/disponible?d=lacustre.ch')).json.etat, 'pris');
  assert.equal(demandes, avant);
});
