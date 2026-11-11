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
    const vue = await c('GET', '/api/admin/integrations');
    assert.equal(vue.s, 200); assert.equal(vue.j.inclus, false, 'API réservée à Croissance');
    assert.equal((await c('POST', '/api/admin/integrations/cles', { nom: 'x', portees: ['commandes:lecture'] })).s, 403);
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
    // Données personnelles : masquées sans la permission clients:lecture
    assert.equal(liste.j.donnees[0].client.email, undefined, 'e-mail masqué sans clients:lecture');
    const k3 = (await c('POST', '/api/admin/integrations/cles', { nom: 'CRM', portees: ['commandes:lecture', 'clients:lecture'] })).j;
    assert.equal((await c('GET', '/api/v1/commandes', null, cle(k3.cle))).j.donnees[0].client.email, 'ab@x.ch');
    // Pagination : commandes à la même milliseconde, aucune sautée ni répétée ; tri par modification
    const b = db.prepare('SELECT id FROM boutiques WHERE slug = ?').get(ins.j.slug);
    const modele = db.prepare('SELECT * FROM commandes WHERE numero = ?').get(cmd.numero);
    for (let k = 0; k < 7; k++) db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run('x' + k, b.id, 5000 + k, 1700000000000, 'payee', 'j' + k, modele.donnees);
    const vus = []; let suite = null, tours = 0;
    do { const pg = await c('GET', `/api/v1/commandes?limite=3${suite ? `&apres=${suite}` : ''}`, null, cle(k3.cle)); vus.push(...pg.j.donnees.map(x => x.numero)); suite = pg.j.suite; } while (suite && ++tours < 10);
    assert.deepEqual([...vus].sort(), [...new Set(vus)].sort(), 'aucun doublon'); assert.equal(vus.length, 8, 'aucune commande sautée');
    const modifiees = await c('GET', `/api/v1/commandes?tri=modification&depuis=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`, null, cle(k3.cle));
    assert.deepEqual(modifiees.j.donnees.map(x => x.numero), [cmd.numero], 'synchronisation des modifications');
    assert.equal((await c('PATCH', `/api/v1/produits/${prods.j.donnees[0].id}`, { actif: 'false' }, cle(k2.cle))).s, 400, 'booléen exigé');
    // Rupture émise par l'API aussi
    await c('PATCH', `/api/v1/produits/${prods.j.donnees[0].id}`, { stock: 0 }, cle(k2.cle));
    assert.ok(db.prepare("SELECT 1 FROM webhook_envois WHERE evenement = 'produit.rupture'").get());
    // Test depuis l'écran : envoyé tout de suite, hors file
    const avantFile = db.prepare('SELECT COUNT(*) n FROM webhook_envois').get().n;
    const test = await c('POST', '/api/admin/integrations/webhooks/tester');
    assert.equal(test.j.resultats[0].ok, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM webhook_envois').get().n, avantFile);
    // Effacement d'un client (RGPD) : ses envois gardés disparaissent
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE boutique_id = ?").run(b.id);
    assert.equal((await c('POST', '/api/admin/clients/effacer', { email: 'ab@x.ch' })).s, 200);
    assert.ok(!db.prepare("SELECT 1 FROM webhook_envois WHERE instr(corps, 'ab@x.ch') > 0").get(), 'plus de données du client dans la file');
    // Révocation
    assert.equal((await c('POST', `/api/admin/integrations/cles/${k1.id}/revoquer`)).s, 200);
    assert.equal((await c('GET', '/api/v1/commandes', null, cle(k1.cle))).s, 401, 'clé révoquée');
    // Retour à Lancement : l'API se ferme
    assert.equal((await c('POST', '/api/abonnement/changer', { formule: 'lancement' })).s, 200);
    assert.equal((await c('GET', '/api/v1/produits', null, cle(k2.cle))).s, 402);
    // Formule sans API : plus aucun événement ne sort
    const n0 = db.prepare('SELECT COUNT(*) n FROM webhook_envois').get().n;
    assert.equal((await c('POST', '/api/admin/commandes/x1/statut', { statut: 'remboursee' })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM webhook_envois').get().n, n0);
    // Mais le marchand peut encore supprimer son webhook
    assert.equal((await c('POST', `/api/admin/integrations/webhooks/${wh.id}/supprimer`)).s, 200);
  } finally { s.close(); rec.close(); }
});

test('file des webhooks : une adresse en panne ne bloque pas les autres boutiques, pause après 3 jours', async () => {
  const { creerIntegrations } = require('../src/integrations');
  const db = ouvrir(':memory:');
  db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m', 'm@x.ch', 'x', 0)").run();
  for (const b of ['A', 'B']) db.prepare("INSERT INTO boutiques (id, marchand_id, slug, config, cree_le) VALUES (?, 'm', ?, '{}', 0)").run(b, b.toLowerCase());
  const ok = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200); res.end(); }); });
  const panne = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(503); res.end(); }); });
  await Promise.all([ok, panne].map(x => new Promise(r => x.listen(0, '127.0.0.1', r))));
  const integ = creerIntegrations({ db, env: { INTEGRATIONS_HTTP_LOCAL: '1' }, journal: { log() {}, error() {} } });
  try {
    const wa = await integ.creerWebhook('A', { url: `http://127.0.0.1:${panne.address().port}/`, evenements: ['commande.payee'] });
    const wb = await integ.creerWebhook('B', { url: `http://127.0.0.1:${ok.address().port}/`, evenements: ['commande.payee'] });
    for (let k = 0; k < 80; k++) integ.emettre('A', 'commande.payee', { k });
    db.prepare("UPDATE webhooks SET actif = 0 WHERE id = ?").run(wa.id);   // A en pause, 80 envois en attente
    integ.emettre('B', 'commande.payee', { k: 'b' });
    await integ.envoyerFile();
    assert.equal(db.prepare("SELECT statut FROM webhook_envois WHERE webhook_id = ?").get(wb.id).statut, 'envoye', 'B livré malgré A');
    // Pendant la pause, les événements de A restent en file ; la réactivation les relance
    integ.emettre('A', 'commande.payee', { k: 'pendant la pause' });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM webhook_envois WHERE webhook_id = ? AND statut = 'attente'").get(wa.id).n, 81);
    integ.reactiverWebhook('A', wa.id);
    await integ.envoyerFile();
    assert.equal(db.prepare('SELECT actif FROM webhooks WHERE id = ?').get(wa.id).actif, 1, 'une panne courte ne met pas en pause');
    db.prepare('UPDATE webhooks SET premier_echec = ? WHERE id = ?').run(Date.now() - 4 * 86400000, wa.id);
    db.prepare('UPDATE webhook_envois SET prochain_essai = 0').run();
    await integ.envoyerFile();
    assert.equal(db.prepare('SELECT actif FROM webhooks WHERE id = ?').get(wa.id).actif, 0, 'pause après 3 jours sans succès');
  } finally { ok.close(); panne.close(); }
});

test('SSRF : formes IPv6 et adresses mappées refusées', () => {
  const { ipInterne } = require('../src/integrations');
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:101::1', 'fec0::1', '198.18.0.1', '[::1]', 'fe80::1', 'fd00::1']) assert.equal(ipInterne(ip), true, ip);
  for (const ip of ['8.8.8.8', '2a00:1450:4001::200e', '::ffff:808:808']) assert.equal(ipInterne(ip), false, ip);
});

test('DNS rebinding : la connexion part vers l’adresse vérifiée, jamais vers une adresse interne', async () => {
  const { creerIntegrations } = require('../src/integrations');
  const db = ouvrir(':memory:');
  let n = 0;
  // 1re résolution (contrôle à l'enregistrement) : adresse publique ; 2e (connexion) : 127.0.0.1
  const erreurs = [];
  const integ = creerIntegrations({ db, journal: { log() {}, error: (...a) => erreurs.push(a.join(' ')) }, resoudre: async () => (n++ === 0 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]) });
  assert.equal(await integ.verifierUrl('https://piege.example/hook'), 'https://piege.example/hook');
  assert.equal(await integ.poster('https://piege.example/hook', '{}', {}, 2000), 0, 'connexion refusée');
  assert.match(erreurs.join(), /EINTERNE/, 'refusée par le contrôle d’adresse, pas par hasard');
});
