// Argent et stock : scénarios trouvés par la relecture du code (doubles paiements, annulation, survente, offres).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

let serveur, base, db, cookie = '', slug, pStock, pOffre;
before(async () => {
  db = ouvrir(':memory:');
  serveur = http.createServer();
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
  serveur.on('request', creerApp({ db, env: { DEMO_DELAI_EXPEDITION_MS: '-1', LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const r = await appel('POST', '/api/auth/inscription', { email: 'argent@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Argent', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'Argent', adresse: 'Rue du Test 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 50, stock: 5, type: 'stock' }, { nom: 'Bougie', prix: 20, stock: 50, type: 'stock' }] });
  slug = r.j.slug;
  const { j: { url } } = await appel('POST', '/api/abonnement/commencer', { formule: 'pro' });
  await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
  const e = await appel('GET', '/api/admin/etat');
  pStock = e.j.produits.find(p => p.nom === 'Vase').id; pOffre = e.j.produits.find(p => p.nom === 'Bougie').id;
  const { produits, commandes, serveur: s, avis, abonnes, envois, audience, offresVues, ...conf } = e.j;
  conf.offres = { ...conf.offres, regles: [{ id: 'r1', si: '*', alors: pOffre, remise: 50, type: 'panier', actif: true }] };
  await appel('PUT', '/api/admin/config', { config: conf });
});
after(() => serveur.close());
async function appel(m, chemin, corps, avecCookie = true) {
  const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(avecCookie && cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc && avecCookie) cookie = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
}
const client = { nom: 'Client', email: 'c@exemple.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' };
const commander = lignes => appel('POST', `/api/public/${slug}/commandes`, { lignes, livraison: 'poste-eco', client }, false);
const stock = async () => (await appel('GET', '/api/admin/etat')).j.produits.find(p => p.id === pStock).stock;
const commande = async id => (await appel('GET', '/api/admin/etat')).j.commandes.find(c => c.id === id);

test('deux liens de paiement payés pour une commande : un seul encaissé, le second à rembourser', async () => {
  const c = await commander([{ produitId: pStock, qte: 1 }]);
  const avant = await stock();
  const r2 = await appel('POST', `/api/public/${slug}/commandes/${c.j.commandeId}/reprendre`, { jeton: c.j.jeton }, false);
  await fetch(r2.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  await fetch(c.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });   // ancien lien, fermé
  assert.equal(await stock(), avant - 1, 'stock décrémenté une seule fois');
  const cmd = await commande(c.j.commandeId);
  assert.equal(cmd.statut, 'payee');
  const pmts = db.prepare('SELECT statut FROM paiements WHERE commande_id = ?').all(c.j.commandeId).map(x => x.statut).sort();
  assert.deepEqual(pmts, ['annule', 'paye']);
});

test('commande annulée puis payée : reste annulée, paiement à rembourser, stock inchangé', async () => {
  const c = await commander([{ produitId: pStock, qte: 1 }]);
  const avant = await stock();
  assert.equal((await appel('POST', `/api/admin/commandes/${c.j.commandeId}/statut`, { statut: 'annulee' })).s, 200);
  await fetch(c.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  assert.equal((await commande(c.j.commandeId)).statut, 'annulee');
  assert.equal(await stock(), avant);
});

test('commande payée : plus d’annulation sans remboursement', async () => {
  const c = await commander([{ produitId: pStock, qte: 1 }]);
  await fetch(c.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  assert.equal((await appel('POST', `/api/admin/commandes/${c.j.commandeId}/statut`, { statut: 'annulee' })).s, 409);
  const avant = await stock();
  assert.equal((await appel('POST', `/api/admin/commandes/${c.j.commandeId}/statut`, { statut: 'remboursee' })).s, 200);
  assert.equal(await stock(), avant + 1);
  assert.equal(db.prepare("SELECT statut FROM paiements WHERE commande_id = ? AND statut = 'rembourse'").all(c.j.commandeId).length, 1);
});

test('stock contrôlé sur la quantité totale, même en plusieurs lignes', async () => {
  const s = await stock();
  const r = await commander([{ produitId: pStock, qte: s - 1 }, { produitId: pStock, qte: 2 }]);
  assert.equal(r.s, 409);
  assert.equal((await commander(Array.from({ length: 21 }, () => ({ produitId: pOffre, qte: 1 })))).s, 400, 'plus de 20 du même produit');
});

test('offre complémentaire : une seule ligne au prix réduit, et un achat normal exigé', async () => {
  const seulesOffres = await commander(Array.from({ length: 5 }, () => ({ produitId: pOffre, qte: 1, offre: 'r1' })));
  const memesSansOffre = await commander([{ produitId: pOffre, qte: 5 }]);
  assert.equal(seulesOffres.j.total, memesSansOffre.j.total, 'sans achat normal : aucune réduction d’offre');
  const mix = await commander([{ produitId: pStock, qte: 1 }, { produitId: pOffre, qte: 1, offre: 'r1' }, { produitId: pOffre, qte: 1, offre: 'r1' }]);
  const sansOffre = await commander([{ produitId: pStock, qte: 1 }, { produitId: pOffre, qte: 1 }]);
  assert.equal(mix.j.total, Math.round((sansOffre.j.total + 10) * 100) / 100, 'une bougie à −50 % (10), la seconde au prix normal');
});

test('paiement marqué à la main : stock décrémenté et liens en ligne fermés', async () => {
  const c = await commander([{ produitId: pStock, qte: 1 }]);
  const avant = await stock();
  assert.equal((await appel('POST', `/api/admin/commandes/${c.j.commandeId}/statut`, { statut: 'payee' })).s, 200);
  assert.equal(await stock(), avant - 1);
  await fetch(c.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  assert.equal(await stock(), avant - 1, 'le lien en ligne ne débite plus rien');
});

test('abonnement Stripe : changer de formule modifie la souscription (prorata) et les droits tout de suite', async () => {
  const { ouvrir } = require('../src/db');
  const { creerGestion } = require('../src/abonnements');
  const db2 = ouvrir(':memory:');
  const appels = [];
  const fauxFetch = async (url, opts) => {
    appels.push({ url, methode: opts.method, corps: opts.body ? new URLSearchParams(String(opts.body)) : null });
    if (opts.method === 'GET') return { ok: true, json: async () => ({ id: 'sub_1', items: { data: [{ id: 'si_1', price: { currency: 'chf', product: 'prod_1' } }] } }) };
    if (/\/products$/.test(url)) return { ok: true, json: async () => ({ id: 'prod_pro' }) };
    return { ok: true, json: async () => ({ id: 'sub_1' }) };
  };
  const g = creerGestion({ db: db2, env: { STRIPE_SECRET_KEY: 'sk_live_x' }, urlPublique: 'https://x', fetchImpl: fauxFetch });
  db2.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m1', 'a@b.ch', 'x', 0)").run();
  db2.prepare("INSERT INTO abonnements (marchand_id, formule, devise, statut, periode_fin, ref_externe, client_externe, cree_le, maj_le) VALUES ('m1', 'lancement', 'CHF', 'actif', ?, 'sub_1', 'cus_1', 0, 0)").run(Date.now() + 86400000 * 20);
  await g.changer({ marchand: { id: 'm1' }, formule: 'pro' });
  const maj = appels.find(a => a.methode === 'POST' && /subscriptions/.test(a.url));
  assert.equal(appels.find(a => /\/products$/.test(a.url)).corps.get('name'), 'Comptoir Pro');
  assert.equal(maj.url, 'https://api.stripe.com/v1/subscriptions/sub_1');
  assert.equal(maj.corps.get('items[0][id]'), 'si_1');
  assert.equal(maj.corps.get('items[0][price_data][unit_amount]'), '11900');
  assert.equal(maj.corps.get('proration_behavior'), 'create_prorations');
  assert.equal(maj.corps.get('items[0][price_data][product]'), 'prod_pro');
  assert.equal(maj.corps.get('cancel_at_period_end'), 'false');
  assert.equal(g.etat('m1').formule, 'pro');
  // Changement fait dans le tableau de bord Stripe : le webhook remet les droits à jour
  g.evenementStripe({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', metadata: { formule: 'croissance' }, cancel_at_period_end: false } } });
  assert.equal(g.etat('m1').formule, 'croissance');
});
