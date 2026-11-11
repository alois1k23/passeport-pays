// API publique et webhooks des marchands : clés à portée limitée, signature, nouvel essai, protection SSRF, formule.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const { ipInterne } = require('../src/integrations');

test('adresses internes refusées pour les webhooks (SSRF)', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(ipInterne(ip), true, ip);
  for (const ip of ['8.8.8.8', '185.199.108.153', '2a00:1450:4001::1']) assert.equal(ipInterne(ip), false, ip);
});

test('API v1 et webhooks de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', INTEGRATIONS_HTTP_LOCAL: '1' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  // Récepteur de webhooks du marchand (refuse le premier envoi pour tester le nouvel essai)
  const recus = []; let refuser = 1;
  const rec = http.createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { if (refuser > 0) { refuser--; res.writeHead(500); return res.end(); } recus.push({ corps: d, sig: req.headers['comptoir-signature'], type: req.headers['comptoir-evenement'] }); res.writeHead(204); res.end(); }); });
  await new Promise(ok => rec.listen(0, '127.0.0.1', ok));
  let cookie = '';
  const c = async (m, chemin, corps, entetes = {}) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...entetes }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length && !entetes.Authorization) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'api@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'API', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'API', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] });
    let { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'lancement' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.equal((await c('GET', '/api/admin/integrations')).s, 403, 'API réservée à Croissance');
    assert.equal((await c('POST', '/api/abonnement/changer', { formule: 'croissance' })).s, 200);
    // Clé en lecture seule des commandes, et clé produits
    const k1 = (await c('POST', '/api/admin/integrations/cles', { nom: 'Compta', portees: ['commandes:lecture', 'commandes:ecriture'] })).j;
    const k2 = (await c('POST', '/api/admin/integrations/cles', { nom: 'Entrepôt', portees: ['produits:lecture', 'produits:ecriture'] })).j;
    assert.match(k1.cle, /^cpt_/);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM cles_api').all()).includes(k1.cle), 'clé gardée en empreinte seulement');
    const cle = k => ({ Authorization: `Bearer ${k}` });
    // Webhook : https exigé, adresses internes refusées ; http local permis pour l'essai
    assert.equal((await c('POST', '/api/admin/integrations/webhooks', { url: 'http://exemple.ch/x', evenements: ['commande.payee'] })).s, 400);
    assert.equal((await c('POST', '/api/admin/integrations/webhooks', { url: 'https://169.254.169.254/latest', evenements: ['commande.payee'] })).s, 400);
    const wh = (await c('POST', '/api/admin/integrations/webhooks', { url: `http://127.0.0.1:${rec.address().port}/hook`, evenements: ['commande.payee', 'commande.expediee', 'produit.rupture'] })).j;
    assert.match(wh.secret, /^whsec_/);
    // Une vente : commande.payee
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    const cmd = (await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A B', email: 'ab@x.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json()));
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    await gerer.envoyerWebhooks();   // 1er essai : le récepteur répond 500
    assert.equal(recus.length, 0);
    db.prepare('UPDATE webhook_envois SET prochain_essai = 0').run();
    await gerer.envoyerWebhooks();   // nouvel essai : reçu
    assert.equal(recus.length, 1); assert.equal(recus[0].type, 'commande.payee');
    const [, t, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(recus[0].sig);
    assert.equal(v1, crypto.createHmac('sha256', wh.secret).update(`${t}.${recus[0].corps}`).digest('hex'), 'signature vérifiable');
    const ev = JSON.parse(recus[0].corps);
    assert.equal(ev.donnees.numero, cmd.numero); assert.equal(ev.donnees.devise, 'CHF'); assert.ok(!('jeton' in ev.donnees));
    // API : lecture, permissions, expédition
    const liste = await c('GET', '/api/v1/commandes', null, cle(k1.cle));
    assert.equal(liste.s, 200); assert.equal(liste.j.donnees.length, 1);
    assert.equal((await c('GET', '/api/v1/produits', null, cle(k1.cle))).s, 403, 'permission manquante');
    assert.equal((await c('GET', '/api/v1/commandes', null, cle('cpt_faux_faux_faux_faux_faux_x'))).s, 401);
    const exp = await c('POST', `/api/v1/commandes/${cmd.numero}/expedier`, { suivi: '99.00.123456.12345678', transporteur: 'La Poste' }, cle(k1.cle));
    assert.equal(exp.s, 200, JSON.stringify(exp.j)); assert.equal(exp.j.statut, 'expediee');
    await gerer.envoyerWebhooks();
    assert.equal(recus[recus.length - 1].type, 'commande.expediee');
    // Produits : stock mis à jour par l'entrepôt
    const prods = await c('GET', '/api/v1/produits', null, cle(k2.cle));
    const p = await c('PATCH', `/api/v1/produits/${prods.j.donnees[0].id}`, { stock: 12 }, cle(k2.cle));
    assert.equal(p.s, 200); assert.equal(p.j.stock, 12);
    // Révocation
    assert.equal((await c('POST', `/api/admin/integrations/cles/${k1.id}/revoquer`)).s, 200);
    assert.equal((await c('GET', '/api/v1/commandes', null, cle(k1.cle))).s, 401, 'clé révoquée');
    // Retour à Lancement : l'API se ferme
    assert.equal((await c('POST', '/api/abonnement/changer', { formule: 'lancement' })).s, 200);
    assert.equal((await c('GET', '/api/v1/produits', null, cle(k2.cle))).s, 402);
  } finally { s.close(); rec.close(); }
});
