// Stripe Connect : chaque boutique encaisse sur son propre compte Stripe (faux Stripe local).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('Stripe Connect : commandes fermées avant activation, vente et remboursement sur le compte de la boutique', async () => {
  const appels = [];
  let actif = false, twint = 'pending', refuser = false, paye = false;
  const reponse = json => ({ ok: true, status: 200, json: async () => json });
  const fauxFetch = async (url, opts = {}) => {
    const chemin = url.replace('https://api.stripe.com/v1/', ''), compte = (opts.headers || {})['Stripe-Account'] || null;
    appels.push({ chemin, compte, methode: opts.method || 'GET', corps: opts.body ? new URLSearchParams(opts.body) : null });
    if (chemin === 'accounts') await new Promise(ok => setTimeout(ok, 30));   // lent : deux demandes simultanées se croisent
    if (chemin === 'accounts') return reponse({ id: 'acct_boutique' });
    if (chemin === 'accounts/acct_boutique') return reponse({ id: 'acct_boutique', charges_enabled: actif, details_submitted: actif, capabilities: { card_payments: 'active', twint_payments: twint } });
    if (chemin === 'account_links') return reponse({ url: 'https://connect.stripe.com/setup/e/xyz' });
    if (chemin === 'checkout/sessions') return refuser ? { ok: false, status: 400, json: async () => ({ error: { message: 'The payment method type twint is invalid.' } }) } : reponse({ id: 'cs_' + appels.length, url: 'https://checkout.stripe.com/c/x' });
    if (/^checkout\/sessions\/cs_\d+$/.test(chemin)) return reponse({ id: chemin.split('/')[2], payment_intent: 'pi_1', payment_status: paye ? 'paid' : 'unpaid' });
    if (chemin === 'refunds') return reponse({ id: 're_1' });
    return reponse({});
  };
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITES_FACTEUR: '1000', LIMITE_ESSAIS: '1000', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_plateforme', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, fetchImpl: fauxFetch, journal: { log() {}, error() {} } }));
  try {
    let cookie = '';
    const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); const t = await r.text(); return { statut: r.status, json: t ? JSON.parse(t) : null }; };
    const ins = await c('POST', '/api/auth/inscription', { email: 'connect@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Connect', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'Connect', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] });
    assert.equal(ins.statut, 201);
    const pub = await fetch(`${base}/api/public/${ins.json.slug}`).then(r => r.json());
    const commander = () => fetch(`${base}/api/public/${ins.json.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A B', email: 'ab@x.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(async r => ({ statut: r.status, json: await r.json() }));
    // Avant l'activation : aucune commande (et donc aucun encaissement sur le compte de la plateforme)
    const avant = await commander();
    assert.equal(avant.statut, 409); assert.equal(avant.json.code, 'paiements_inactifs');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM commandes').get().n, 0);
    assert.equal((await c('GET', '/api/admin/etat')).json.serveur.paiementsBoutique.pret, false);
    // Activation : compte créé, lien vers Stripe ; une seconde demande réutilise le même compte
    const [act, act2] = await Promise.all([c('POST', '/api/admin/paiements/activer'), c('POST', '/api/admin/paiements/activer')]);   // deux onglets
    assert.equal(act.json.url, 'https://connect.stripe.com/setup/e/xyz');
    assert.equal(act2.statut, 409);
    await c('POST', '/api/admin/paiements/activer');
    assert.equal(appels.filter(a => a.chemin === 'accounts').length, 1);
    actif = true;   // le marchand termine chez Stripe
    assert.equal((await c('GET', '/api/admin/paiements/etat')).json.pret, true);
    // Vente : la session Checkout est créée sur le compte de la boutique
    const cmd = await commander();
    assert.equal(cmd.statut, 201, JSON.stringify(cmd.json));
    const session = appels.filter(a => a.chemin === 'checkout/sessions').pop();
    assert.equal(session.compte, 'acct_boutique');
    assert.deepEqual(session.corps.getAll('payment_method_types[]'), ['card'], 'TWINT pas encore activé par Stripe : non proposé');
    // Stripe refuse la session : pas de commande fantôme
    refuser = true;
    const nAvant = db.prepare('SELECT COUNT(*) n FROM commandes').get().n;
    assert.equal((await commander()).statut, 502);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM commandes').get().n, nAvant);
    refuser = false;
    // Retour du client sans webhook : la page de commande interroge Stripe et confirme le paiement
    const cmdRetour = await commander();
    paye = true;
    const st = await fetch(`${base}/api/public/${ins.json.slug}/commandes/${cmdRetour.json.commandeId}?jeton=${cmdRetour.json.jeton}`).then(r => r.json());
    assert.equal(st.statut, 'payee');
    paye = false;
    const pay = db.prepare('SELECT * FROM paiements WHERE commande_id = ?').get(cmd.json.commandeId);
    assert.equal(pay.compte, 'acct_boutique');
    // Webhook d'un compte connecté
    const signer = (corps, secret) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')}`; };
    const webhook = async (ev, secret = 'whsec_connect') => { const corps = JSON.stringify(ev); return (await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signer(corps, secret) }, body: corps })).status; };
    const evPaye = compte => ({ type: 'checkout.session.completed', account: compte, data: { object: { id: pay.ref_externe, payment_status: 'paid', metadata: { paiement_id: pay.id } } } });
    assert.equal(await webhook(evPaye('acct_autre')), 200);   // une autre boutique ne peut pas confirmer cette vente
    assert.equal(db.prepare('SELECT statut FROM commandes WHERE id = ?').get(cmd.json.commandeId).statut, 'attente');
    assert.equal(await webhook(evPaye('acct_boutique')), 200);
    assert.equal(db.prepare('SELECT statut FROM commandes WHERE id = ?').get(cmd.json.commandeId).statut, 'payee');
    // Remboursement : sur le compte qui a encaissé
    assert.equal((await c('POST', `/api/admin/commandes/${cmd.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 200);
    assert.ok(appels.filter(a => a.chemin === 'refunds').every(a => a.compte === 'acct_boutique') && appels.some(a => a.chemin === 'refunds'));
    // account.updated : compte désactivé par Stripe → commandes à nouveau fermées
    // TWINT activé par Stripe : proposé ensuite
    assert.equal(await webhook({ type: 'account.updated', account: 'acct_boutique', data: { object: { charges_enabled: true, details_submitted: true, capabilities: { twint_payments: 'active' } } } }), 200);
    await commander();
    assert.deepEqual(appels.filter(a => a.chemin === 'checkout/sessions').pop().corps.getAll('payment_method_types[]'), ['card', 'twint']);
    assert.equal(await webhook({ type: 'account.updated', account: 'acct_boutique', data: { object: { charges_enabled: false, details_submitted: true } } }), 200);
    assert.equal((await commander()).json.code, 'paiements_inactifs');
    // Un événement de compte connecté n'est jamais lu comme un abonnement Comptoir
    assert.equal(await webhook({ type: 'customer.subscription.deleted', account: 'acct_boutique', data: { object: { id: 'sub_x', metadata: {} } } }), 200);
  } finally { s.close(); }
});
