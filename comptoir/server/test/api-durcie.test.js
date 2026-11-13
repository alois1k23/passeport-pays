// API publique et webhooks durcis (relecture adversariale, chantier 48) : liste des clients paginée sans tout déchiffrer,
// file des webhooks bornée (toutes lignes), ruptures dédoublonnées, prix sous le centime refusé, secrets chiffrés et
// renouvelables avec double signature pendant 24 heures.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('API v1 et webhooks : pagination des clients, file bornée, ruptures, prix, rotation du secret', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', INTEGRATIONS_HTTP_LOCAL: '1' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  const recus = [];
  const rec = http.createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { recus.push({ corps: d, sig: req.headers['comptoir-signature'] }); res.end('ok'); }); });
  await new Promise(ok => rec.listen(0, '127.0.0.1', ok));
  let cookie = '';
  const c = async (m, chemin, corps, entetes = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...entetes }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && /session/.test(sc.join(';'))) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'apid@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'APId', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'APId Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'apid@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 100, type: 'stock' }] });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'croissance' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    const k = (await c('POST', '/api/admin/integrations/cles', { nom: 'Outil', portees: ['clients:lecture', 'produits:lecture', 'produits:ecriture'] })).j.cle;
    const cle = { Authorization: `Bearer ${k}` };
    const wh = (await c('POST', '/api/admin/integrations/webhooks', { url: `http://127.0.0.1:${rec.address().port}/hook`, evenements: ['commande.payee', 'produit.rupture'] })).j;
    // Secret chiffré en base (jamais en clair).
    assert.ok(!JSON.stringify(db.prepare('SELECT secret FROM webhooks').all()).includes(wh.secret));
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j, produit = pub.produits[0].id;
    // Commandes payées : Lou deux fois, Max, Zoé.
    for (const email of ['lou@exemple.ch', 'Lou@Exemple.ch', 'max@exemple.ch', 'zoe@exemple.ch']) {
      const cmd = (await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: produit, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Client', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json()));
      await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    }
    // Clients par pages de 2, sans doublon, regroupés par adresse (casse ignorée).
    const p1 = await c('GET', '/api/v1/clients?limite=2', null, cle);
    assert.equal(p1.s, 200); assert.equal(p1.j.donnees.length, 2); assert.ok(p1.j.suite);
    const p2 = await c('GET', `/api/v1/clients?limite=2&apres=${p1.j.suite}`, null, cle);
    assert.equal(p2.j.donnees.length, 1); assert.equal(p2.j.suite, null);
    const tous = [...p1.j.donnees, ...p2.j.donnees];
    assert.deepEqual(tous.map(x => x.email).sort(), ['lou@exemple.ch', 'max@exemple.ch', 'zoe@exemple.ch']);
    assert.equal(tous.find(x => x.email === 'lou@exemple.ch').commandes, 2);
    assert.equal((await c('GET', '/api/v1/clients?apres=nimporte', null, cle)).j.code, 'curseur');

    // Webhooks livrés : seules les métadonnées restent (contenu effacé).
    await gerer.envoyerWebhooks();
    assert.equal(recus.length, 4);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM webhook_envois WHERE statut = 'envoye' AND corps <> ''").get().n === 0, 'contenu effacé après livraison');

    // Nouveau secret : pendant 24 h, deux signatures (ancienne puis nouvelle), chacune vérifiable.
    const rot = await c('POST', `/api/admin/integrations/webhooks/${wh.id}/secret`);
    assert.equal(rot.s, 200); assert.match(rot.j.secret, /^whsec_/); assert.notEqual(rot.j.secret, wh.secret);
    // Ruptures : un stock qui oscille entre 0 et 5 n'émet qu'une rupture par produit et par 10 minutes.
    for (const stock of [0, 5, 0, 5, 0]) assert.equal((await c('PATCH', `/api/v1/produits/${produit}`, { stock }, cle)).s, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM webhook_envois WHERE evenement = 'produit.rupture'").get().n, 1);
    recus.length = 0; await gerer.envoyerWebhooks();
    assert.equal(recus.length, 1);
    const sig = recus[0].sig, t = /t=(\d+)/.exec(sig)[1], v1 = [...sig.matchAll(/v1=([0-9a-f]+)/g)].map(m => m[1]);
    const hmac = sec => crypto.createHmac('sha256', sec).update(`${t}.${recus[0].corps}`).digest('hex');
    assert.deepEqual(v1, [hmac(wh.secret), hmac(rot.j.secret)], 'ancienne signature puis nouvelle');
    // Au-delà de 24 h : seulement le nouveau secret.
    db.prepare('UPDATE webhooks SET secret_ancien_jusqu = 1').run();
    recus.length = 0; await c('POST', '/api/admin/integrations/webhooks/tester');
    assert.equal(recus.length, 1); assert.equal([...recus[0].sig.matchAll(/v1=/g)].length, 1, 'une seule signature après 24 h');
    { const t2 = /t=(\d+)/.exec(recus[0].sig)[1]; assert.match(recus[0].sig, new RegExp(`v1=${crypto.createHmac('sha256', rot.j.secret).update(`${t2}.${recus[0].corps}`).digest('hex')}`)); }

    // Prix sous le centime : refusé (il serait devenu 0, produit gratuit).
    assert.equal((await c('PATCH', `/api/v1/produits/${produit}`, { prix: 0.004 }, cle)).j.code, 'prix');
    assert.equal((await c('PATCH', `/api/v1/produits/${produit}`, { prix: 0.01 }, cle)).s, 200);

    assert.equal((await c('PATCH', `/api/v1/produits/${produit}`, { stock: 10 }, cle)).s, 200);
    // File bornée, tous statuts : au plus 5 000 lignes par webhook, les plus anciennes supprimées.
    const ins2 = db.prepare("INSERT INTO webhook_envois (id, webhook_id, evenement, corps, statut, prochain_essai, cree_le) VALUES (?, ?, 'commande.payee', '', 'envoye', 0, ?)");
    for (let i = 0; i < 5010; i++) ins2.run(`evt_vieux_${i}`, wh.id, i);
    const cmd = (await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: produit, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Client', email: 'ana@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json()));
    assert.ok(cmd.paiementUrl, JSON.stringify(cmd));
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.ok(db.prepare('SELECT COUNT(*) n FROM webhook_envois WHERE webhook_id = ?').get(wh.id).n <= 5000);
    assert.ok(db.prepare("SELECT 1 FROM webhook_envois WHERE webhook_id = ? AND statut = 'attente' AND evenement = 'commande.payee'").get(wh.id), 'le nouvel envoi est gardé');
  } finally { s.close(); rec.close(); }
});
