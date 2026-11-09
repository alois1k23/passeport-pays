// Tests de bout en bout : `node --test server/test/` (aucune dépendance).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const { verifierSignatureStripe, prestataireStripe } = require('../src/paiements');

let serveur, base, db;
const silencieux = { log() {}, error() {} };

before(async () => {
  db = ouvrir(':memory:');
  serveur = http.createServer();
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
  serveur.on('request', creerApp({ db, env: { DEMO_DELAI_EXPEDITION_MS: '0' }, urlPublique: base, journal: silencieux }));
});
after(() => serveur.close());

/* Petit client qui garde le cookie de session. */
function client() {
  let cookie = '';
  return async (methode, chemin, corps, { brut = false } = {}) => {
    const rep = await fetch(base + chemin, {
      method: methode, redirect: 'manual',
      headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: corps ? JSON.stringify(corps) : undefined
    });
    const sc = rep.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (brut) return rep;
    const texte = await rep.text();
    return { statut: rep.status, json: texte ? JSON.parse(texte) : null };
  };
}

const config = nom => ({
  boutique: { nom, pays: 'ch', secteur: 'maison', modele: 'drop', theme: { bg: '#EEF3F4', surface: '#FFFFFF', text: '#14242B', muted: '#566A72', primary: '#1D5C70', onPrimary: '#FFFFFF', font: "'Outfit', system-ui, sans-serif", body: "'Outfit', system-ui, sans-serif", radius: 12 }, sections: [{ id: 's1', type: 'hero', props: { titre: nom } }] },
  entreprise: { raison: nom, regime: 'ch-non' },
  magasin: { clickCollect: false },
  reglages: { autoTransmission: true, cpa: 8 }
});

const marchand = client();
let slug;

test('inscription, session et état initial', async () => {
  const r = await marchand('POST', '/api/auth/inscription', { email: 'lea@exemple.ch', motDePasse: 'un mot de passe solide', config: config('Lacustre'), produits: [{ nom: 'Coffret Léman', prix: 59, stock: 3, type: 'stock', cout: 21 }] });
  assert.equal(r.statut, 201);
  slug = r.json.slug;
  assert.equal(slug, 'lacustre');
  const s = await marchand('GET', '/api/session');
  assert.equal(s.json.connecte, true);
  const e = await marchand('GET', '/api/admin/etat');
  assert.equal(e.json.boutique.devise, 'CHF');
  assert.equal(e.json.produits.length, 1);
});

test('refuse un mot de passe trop court et un e-mail déjà pris', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/inscription', { email: 'x@exemple.ch', motDePasse: 'court', config: config('X') })).statut, 400);
  assert.equal((await c('POST', '/api/auth/inscription', { email: 'lea@exemple.ch', motDePasse: 'un mot de passe solide', config: config('Y') })).statut, 409);
  assert.equal((await c('POST', '/api/auth/connexion', { email: 'lea@exemple.ch', motDePasse: 'mauvais mot de passe' })).statut, 401);
});

test('les routes admin exigent une session', async () => {
  const anonyme = client();
  assert.equal((await anonyme('GET', '/api/admin/etat')).statut, 401);
});

test('nettoie un thème malveillant (injection dans les couleurs)', async () => {
  const c = config('Lacustre');
  c.boutique.theme.bg = '"><script>alert(1)</script>';
  c.boutique.theme.font = 'url(javascript:alert(1))';
  await marchand('PUT', '/api/admin/config', { config: c });
  const pub = await client()('GET', `/api/public/${slug}`);
  assert.equal(pub.json.boutique.theme.bg, '#333333');
  assert.notEqual(pub.json.boutique.theme.font, 'url(javascript:alert(1))');
  await marchand('PUT', '/api/admin/config', { config: config('Lacustre') });
});

let idDrop;
test('import d’un produit depuis le catalogue fournisseur', async () => {
  const cat = await marchand('GET', '/api/admin/catalogue');
  assert.ok(cat.json.produits.length > 10);
  const r = await marchand('POST', '/api/admin/produits/import', { source: 'f03' });
  assert.equal(r.statut, 201);
  idDrop = r.json.id;
  const pub = await client()('GET', `/api/public/${slug}`);
  const p = pub.json.produits.find(x => x.id === idDrop);
  assert.equal(p.type, 'drop');
  assert.equal(p.cout, undefined, 'le coût fournisseur ne doit pas être public');
  assert.equal(p.fournisseur, undefined);
});

test('parcours client : commande, paiement simulé, transmission et expédition par le fournisseur', async () => {
  const acheteur = client();
  // Le prix envoyé par le navigateur est ignoré : le serveur prend celui de la base.
  const cmd = await acheteur('POST', `/api/public/${slug}/commandes`, {
    lignes: [{ produitId: idDrop, qte: 1, prix: 0.01 }], livraison: 'poste-eco',
    client: { nom: 'Alex Morel', email: 'alex@exemple.ch', adresse: 'Rue de Bourg 1', npa: '1003', ville: 'Lausanne' }
  });
  assert.equal(cmd.statut, 201);
  assert.equal(cmd.json.total, 61, '54 CHF + 7 CHF de port (sous le seuil de 60)');
  assert.match(cmd.json.paiementUrl, /\/paiement-simule\/pay_/);

  // Avant paiement : statut « attente »
  const suivi = () => acheteur('GET', `/api/public/${slug}/commandes/${cmd.json.commandeId}?jeton=${cmd.json.jeton}`);
  assert.equal((await suivi()).json.statut, 'attente');
  // Mauvais jeton : rien ne fuit
  assert.equal((await acheteur('GET', `/api/public/${slug}/commandes/${cmd.json.commandeId}?jeton=faux`)).statut, 404);

  // Page de paiement puis confirmation
  const page = await fetch(cmd.json.paiementUrl);
  assert.match(await page.text(), /Payer avec TWINT/);
  const conf = await fetch(cmd.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  assert.equal(conf.status, 303);
  assert.match(conf.headers.get('location'), new RegExp(`/s/${slug}\\?commande=`));

  // Transmise automatiquement au fournisseur, puis expédiée (le faux fournisseur expédie tout de suite)
  let statut;
  for (let i = 0; i < 40 && statut !== 'expediee'; i++) { statut = (await suivi()).json.statut; if (statut !== 'expediee') await new Promise(r => setTimeout(r, 25)); }
  assert.equal(statut, 'expediee');
  const final = await suivi();
  assert.match(final.json.suivi, /^99\.60\./);

  const etat = await marchand('GET', '/api/admin/etat');
  const c = etat.json.commandes.find(x => x.id === cmd.json.commandeId);
  assert.match(c.refFournisseur, /^FO-/);
  assert.match(c.facture, /^FA-\d{4}-0001$/);
  assert.ok(c.historique.some(h => /Transmise automatiquement/.test(h.texte)));
  const mails = await marchand('GET', '/api/admin/emails');
  assert.deepEqual(mails.json.map(m => m.sujet).sort(), [`Commande n° ${c.numero} confirmée`, `Votre commande n° ${c.numero} est en route`].sort());

  // Confirmer deux fois ne crée pas de seconde facture
  await fetch(cmd.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  const e2 = await marchand('GET', '/api/admin/etat');
  assert.equal(e2.json.compteurFacture, 1);
});

test('stock, transitions et caisse pour les produits en stock', async () => {
  const etat = await marchand('GET', '/api/admin/etat');
  const coffret = etat.json.produits.find(p => p.type === 'stock');
  const acheteur = client();
  const trop = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: coffret.id, qte: 5 }], livraison: 'poste-eco', client: { nom: 'A', email: 'a@exemple.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } });
  assert.equal(trop.statut, 409, 'stock insuffisant (3 en stock)');
  const npa = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: coffret.id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A', email: 'a@exemple.ch', adresse: 'Rue 1', npa: '75001', ville: 'Paris' } });
  assert.equal(npa.statut, 400, 'NPA suisse à 4 chiffres');

  const cmd = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: coffret.id, qte: 2 }], livraison: 'poste-prio', client: { nom: 'B', email: 'b@exemple.ch', adresse: 'Rue 2', npa: '1006', ville: 'Lausanne' } });
  assert.equal(cmd.json.total, 127, '118 + 9 (Priority jamais offert)');
  await fetch(cmd.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  let e = await marchand('GET', '/api/admin/etat');
  assert.equal(e.json.produits.find(p => p.id === coffret.id).stock, 1);

  const id = cmd.json.commandeId;
  assert.equal((await marchand('POST', `/api/admin/commandes/${id}/statut`, { statut: 'livree' })).statut, 409, 'transition interdite');
  assert.equal((await marchand('POST', `/api/admin/commandes/${id}/statut`, { statut: 'preparation' })).statut, 200);
  const exp = await marchand('POST', `/api/admin/commandes/${id}/statut`, { statut: 'expediee' });
  assert.ok(exp.json.commande.suivi);
  await marchand('POST', `/api/admin/commandes/${id}/statut`, { statut: 'livree' });
  await marchand('POST', `/api/admin/commandes/${id}/statut`, { statut: 'remboursee' });
  e = await marchand('GET', '/api/admin/etat');
  assert.equal(e.json.produits.find(p => p.id === coffret.id).stock, 3, 'stock remis après remboursement');

  const vente = await marchand('POST', '/api/admin/caisse', { lignes: [{ produitId: coffret.id, qte: 1 }], moyen: 'twint' });
  assert.equal(vente.statut, 201);
  assert.equal((await marchand('POST', '/api/admin/caisse', { lignes: [{ produitId: idDrop, qte: 1 }] })).statut, 400, 'pas de dropshipping en caisse');
  await marchand('PATCH', `/api/admin/commandes/${id}`, { note: 'Client fidèle' });
  e = await marchand('GET', '/api/admin/etat');
  assert.equal(e.json.commandes.find(c => c.id === id).note, 'Client fidèle');
});

test('un marchand ne voit ni ne modifie les données d’un autre', async () => {
  const autre = client();
  await autre('POST', '/api/auth/inscription', { email: 'max@exemple.ch', motDePasse: 'autre mot de passe solide', config: config('Lacustre') });
  const e = await autre('GET', '/api/admin/etat');
  assert.equal(e.json.serveur.slug, 'lacustre-2', 'slug unique');
  assert.equal(e.json.commandes.length, 0);
  assert.equal((await autre('PUT', `/api/admin/produits/${idDrop}`, { produit: { nom: 'Piraté', prix: 1 } })).statut, 404);
  const mine = await marchand('GET', '/api/admin/etat');
  const cmd = mine.json.commandes[0];
  assert.equal((await autre('POST', `/api/admin/commandes/${cmd.id}/statut`, { statut: 'annulee' })).statut, 404);
});

test('webhooks : signatures fournisseur et Stripe vérifiées', async () => {
  const faux = await fetch(`${base}/api/webhooks/fournisseurs/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': 'abc' }, body: '{"ref":"FO-1","statut":"expediee"}' });
  assert.equal(faux.status, 401);
  const secret = 'whsec_test';
  const corps = '{"type":"checkout.session.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex');
  assert.equal(verifierSignatureStripe(corps, `t=${t},v1=${sig}`, secret), true);
  assert.equal(verifierSignatureStripe(corps, `t=${t},v1=${sig}`, 'autre'), false);
  assert.equal(verifierSignatureStripe(corps, `t=${t - 1000},v1=${sig}`, secret), false, 'trop ancien');
});

test('Stripe : session Checkout en CHF avec TWINT', async () => {
  let envoye;
  const fauxFetch = async (url, opts) => { envoye = { url, corps: new URLSearchParams(opts.body) }; return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' }) }; };
  const s = prestataireStripe({ cleSecrete: 'sk_test', secretWebhook: 'whsec', fetchImpl: fauxFetch });
  const r = await s.creerSession({ paiement: { id: 'pay_1' }, commande: { id: 'c_1', client: { email: 'a@b.ch' }, lignes: [{ nom: 'Lampe', prix: 39, qte: 2 }], port: 7 }, devise: 'CHF', urlRetour: 'https://x/ok', urlAnnulation: 'https://x/ko' });
  assert.equal(r.refExterne, 'cs_test_1');
  assert.deepEqual(envoye.corps.getAll('payment_method_types[]'), ['card', 'twint']);
  assert.equal(envoye.corps.get('line_items[0][price_data][unit_amount]'), '3900');
  assert.equal(envoye.corps.get('line_items[1][price_data][product_data][name]'), 'Livraison');
});

test('fichiers statiques : le code serveur et la base ne sont pas servis', async () => {
  assert.equal((await fetch(`${base}/server/src/app.js`)).status, 404);
  assert.equal((await fetch(`${base}/js/../server/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/js/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/s/${slug}`)).status, 200);
});
