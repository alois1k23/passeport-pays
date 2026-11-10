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
const silencieux = { log() {}, error(...a) { if (process.env.DEBUG_TEST) console.error(...a); } };

before(async () => {
  db = ouvrir(':memory:');
  serveur = http.createServer();
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
  serveur.on('request', creerApp({ db, env: { DEMO_DELAI_EXPEDITION_MS: '0', LIMITE_ESSAIS: '1000', TENDANCES_VENTES_AGE_MS: '0' }, urlPublique: base, journal: silencieux }));
});
after(() => serveur.close());

/* Petit client qui garde le cookie de session. */
function client() {
  let cookie = '';
  return async (methode, chemin, corps, { brut = false, sansPaiement = false } = {}) => {
    const rep = await fetch(base + chemin, {
      method: methode, redirect: 'manual',
      headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: corps ? JSON.stringify(corps) : undefined
    });
    const sc = rep.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (brut) return rep;
    const texte = await rep.text();
    const resultat = { statut: rep.status, json: texte ? JSON.parse(texte) : null };
    // Comme un vrai client : après l'inscription, il paie son abonnement (paiement simulé) avant d'accéder à son espace.
    if (chemin === '/api/auth/inscription' && rep.status === 201 && !sansPaiement) {
      const c = await fetch(base + '/api/abonnement/commencer', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ formule: 'croissance' }) });
      const { url } = await c.json();
      await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    }
    return resultat;
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
  assert.equal(cmd.json.total, 121.1, '118 − 5 % (2 articles) = 112,10 + 9 (Priority jamais offert)');
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
  assert.match(await (await fetch(`${base}/`)).text(), /ce que vous gagnez vraiment/);
  assert.match(await (await fetch(`${base}/app`)).text(), /id="vue"/);
  assert.equal((await fetch(`${base}/img/apercu-analyse.jpg`)).headers.get('content-type'), 'image/jpeg');
});

test('réseaux sociaux : brouillon, validation, publication automatique à l’échéance', async () => {
  const c = config('Lacustre');
  c.social = { comptes: { instagram: true, tiktok: false }, reglages: { auto: true, validation: true, frequence: { instagram: 3 } } };
  await marchand('PUT', '/api/admin/config', { config: c });
  const maintenant = Date.now();
  const r = await marchand('POST', '/api/admin/publications', { publications: [
    { reseau: 'instagram', date: maintenant - 1000, format: 'Reel', pilier: 'probleme', accroche: 'Un salon trop froid ?', legende: 'x', hashtags: ['#a'], statut: 'programmee' },
    { reseau: 'tiktok', date: maintenant - 1000, format: 'Vidéo', pilier: 'produit', accroche: 'POV', legende: 'y', statut: 'programmee' },
    { reseau: 'instagram', date: maintenant + 86400000, format: 'Carrousel', pilier: 'avis', accroche: 'Avis', legende: 'z' }
  ] });
  assert.equal(r.statut, 201);
  assert.equal((await marchand('POST', '/api/admin/publications', { publications: [{ reseau: 'myspace', date: 1 }] })).statut, 400);
  const n = await serveur.listeners('request')[0].publierEcheances();
  assert.equal(n, 1, 'seule la publication Instagram due part (TikTok non connecté, la 3e est un brouillon futur)');
  const e = await marchand('GET', '/api/admin/etat');
  const insta = e.json.publications.find(p => p.accroche === 'Un salon trop froid ?');
  assert.equal(insta.statut, 'publiee');
  assert.ok(insta.stats.vues > 0 && insta.stats.simulees);
  assert.equal((await marchand('PUT', `/api/admin/publications/${insta.id}`, { publication: { legende: 'modif' } })).statut, 409);
  const brouillon = e.json.publications.find(p => p.statut === 'brouillon');
  await marchand('PUT', `/api/admin/publications/${brouillon.id}`, { publication: { statut: 'programmee', legende: 'validée' } });
  const pub = await marchand('POST', `/api/admin/publications/${brouillon.id}/publier`);
  assert.equal(pub.json.publication.statut, 'publiee');
  assert.equal(e.json.social.comptes.pinterest, false);
});


test('codes promo, newsletter et e-mail de bienvenue', async () => {
  const c = config('Lacustre');
  c.offres = { paliersActifs: false, codes: [{ code: 'lancement20', remise: 20 }] };
  c.automatisations = { bienvenue: { actif: true, remise: 10, code: 'BIENVENUE10' } };
  await marchand('PUT', '/api/admin/config', { config: c });
  const acheteur = client();
  assert.equal((await acheteur('POST', `/api/public/${slug}/code`, { code: 'faux' })).statut, 404);
  assert.deepEqual((await acheteur('POST', `/api/public/${slug}/code`, { code: 'Lancement20' })).json, { code: 'LANCEMENT20', remise: 20 });
  const etat = await marchand('GET', '/api/admin/etat');
  const coffret = etat.json.produits.find(p => p.type === 'stock');
  const cmd = await acheteur('POST', `/api/public/${slug}/commandes`, { code: 'LANCEMENT20', lignes: [{ produitId: coffret.id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'C', email: 'c@exemple.ch', adresse: 'Rue 3', npa: '1004', ville: 'Lausanne' } });
  assert.equal(cmd.json.total, 54.2, '59 − 20 % = 47,20 + 7 de port (sous 60 après remise)');
  assert.equal((await acheteur('POST', `/api/public/${slug}/commandes`, { code: 'INCONNU', lignes: [{ produitId: coffret.id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'C', email: 'c@exemple.ch', adresse: 'Rue 3', npa: '1004', ville: 'Lausanne' } })).statut, 400);
  await acheteur('POST', `/api/public/${slug}/newsletter`, { email: 'nouveau@exemple.ch' });
  await acheteur('POST', `/api/public/${slug}/newsletter`, { email: 'nouveau@exemple.ch' });
  const mails = (await marchand('GET', '/api/admin/emails')).json.filter(m => m.destinataire === 'nouveau@exemple.ch');
  assert.equal(mails.length, 1, 'un seul e-mail de bienvenue');
  assert.match(mails[0].corps, /BIENVENUE10/);
  assert.equal((await marchand('GET', '/api/admin/etat')).json.abonnes, 1);
});

test('relance de paiement abandonné, reprise et récupération ; demande d’avis', async () => {
  const c = config('Lacustre');
  c.automatisations = { paiement: { actif: true, etapes: [{ heures: 1 }, { heures: 24 }] }, avis: { actif: true, jours: 7 } };
  await marchand('PUT', '/api/admin/config', { config: c });
  const etat = await marchand('GET', '/api/admin/etat');
  const coffret = etat.json.produits.find(p => p.type === 'stock');
  const acheteur = client();
  const cmd = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: coffret.id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Dana', email: 'dana@exemple.ch', adresse: 'Rue 4', npa: '1005', ville: 'Lausanne' } });
  const gerer = serveur.listeners('request')[0];
  const maintenant = Date.now();
  assert.equal(gerer.automatisationsEcheances(maintenant + 30 * 60000) >= 0, true);
  let mails = () => marchand('GET', '/api/admin/emails').then(r => r.json.filter(m => m.destinataire === 'dana@exemple.ch'));
  assert.equal((await mails()).length, 0, 'pas de relance avant 1 heure');
  gerer.automatisationsEcheances(maintenant + 2 * 3600000);
  gerer.automatisationsEcheances(maintenant + 2 * 3600000);
  assert.equal((await mails()).length, 1, 'une seule relance après 1 heure, même si le planificateur repasse');
  gerer.automatisationsEcheances(maintenant + 25 * 3600000);
  const relances = await mails();
  assert.equal(relances.length, 2);
  const lien = /reprendre=([^&]+)&jeton=(\S+)/.exec(relances[0].corps);
  const rep = await acheteur('POST', `/api/public/${slug}/commandes/${decodeURIComponent(lien[1])}/reprendre`, { jeton: decodeURIComponent(lien[2]) });
  assert.match(rep.json.paiementUrl, /paiement-simule/);
  await fetch(rep.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  let e = await marchand('GET', '/api/admin/etat');
  const c2 = e.json.commandes.find(x => x.id === cmd.json.commandeId);
  assert.equal(c2.statut, 'payee');
  assert.equal(c2.recuperee, true);
  assert.equal((await acheteur('POST', `/api/public/${slug}/commandes/${cmd.json.commandeId}/reprendre`, { jeton: cmd.json.jeton })).statut, 409);
  // Livraison puis demande d'avis 7 jours plus tard
  for (const s of ['preparation', 'expediee', 'livree']) await marchand('POST', `/api/admin/commandes/${c2.id}/statut`, { statut: s });
  gerer.automatisationsEcheances(Date.now() + 8 * 86400000);
  assert.ok((await mails()).some(m => /Votre avis/.test(m.sujet)));
  e = await marchand('GET', '/api/admin/etat');
  assert.ok(e.json.envois.paiement >= 2 && e.json.envois.avis >= 1);
});

test('avis vérifiés : lien personnel, une fois par produit, publiés avec la note', async () => {
  const e = await marchand('GET', '/api/admin/etat');
  const livree = e.json.commandes.find(c => c.statut === 'livree' || c.statut === 'remboursee' || c.statut === 'expediee');
  const enAttente = e.json.commandes.find(c => c.statut === 'attente');
  const row = jeton => db.prepare('SELECT jeton_client FROM commandes WHERE id = ?').get(jeton).jeton_client;
  const acheteur = client();
  // commande non reçue : refus
  if (enAttente) assert.equal((await acheteur('POST', `/api/public/${slug}/avis`, { commandeId: enAttente.id, jeton: row(enAttente.id), avis: [{ produitId: enAttente.lignes[0].produitId, note: 5 }] })).statut, 409);
  const cible = e.json.commandes.find(c => c.statut === 'expediee' || c.statut === 'livree');
  assert.ok(cible, 'une commande expédiée ou livrée existe');
  assert.equal((await acheteur('POST', `/api/public/${slug}/avis`, { commandeId: cible.id, jeton: 'faux', avis: [] })).statut, 404);
  const aDonner = await acheteur('GET', `/api/public/${slug}/avis-a-donner?commande=${cible.id}&jeton=${row(cible.id)}`);
  assert.equal(aDonner.json.produits.length, cible.lignes.length);
  assert.equal((await acheteur('POST', `/api/public/${slug}/avis`, { commandeId: cible.id, jeton: row(cible.id), avis: [{ produitId: cible.lignes[0].produitId, note: 9 }] })).statut, 400);
  const ok = await acheteur('POST', `/api/public/${slug}/avis`, { commandeId: cible.id, jeton: row(cible.id), avis: [{ produitId: cible.lignes[0].produitId, note: 4, texte: 'Très joli, livré vite.' }] });
  assert.equal(ok.statut, 201);
  assert.equal((await acheteur('POST', `/api/public/${slug}/avis`, { commandeId: cible.id, jeton: row(cible.id), avis: [{ produitId: cible.lignes[0].produitId, note: 1 }] })).statut, 409, 'pas deux fois');
  const pub = await acheteur('GET', `/api/public/${slug}`);
  const p = pub.json.produits.find(x => x.id === cible.lignes[0].produitId);
  assert.equal(p.avis.n, 1); assert.equal(p.avis.moyenne, 4);
  assert.equal(pub.json.avisRecents[0].texte, 'Très joli, livré vite.');
  const av = (await marchand('GET', '/api/admin/etat')).json.avis[0];
  await marchand('PATCH', `/api/admin/avis/${av.id}`, { reponse: 'Merci !' });
  assert.equal((await acheteur('GET', `/api/public/${slug}`)).json.avisRecents[0].reponse, 'Merci !');
  const autre = client();
  await autre('POST', '/api/auth/connexion', { email: 'max@exemple.ch', motDePasse: 'autre mot de passe solide' });
  assert.equal((await autre('PATCH', `/api/admin/avis/${av.id}`, { reponse: 'pirate' })).statut, 404);
});

test('offre dans le panier et complément après l’achat (même colis)', async () => {
  const e = await marchand('GET', '/api/admin/etat');
  const coffret = e.json.produits.find(p => p.type === 'stock');
  const c = config('Lacustre');
  c.offres = { paliersActifs: false, regles: [{ id: 'bump', si: idDrop, alors: coffret.id, remise: 20, type: 'panier' }, { id: 'apres', si: '*', alors: idDrop, remise: 15, type: 'apres' }] };
  await marchand('PUT', '/api/admin/config', { config: c });
  const acheteur = client();
  // Ligne d’offre valide : 59 − 20 % = 47,20 ; produit principal 54 ; total 101,20 (port offert)
  const cmd = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: idDrop, qte: 1 }, { produitId: coffret.id, qte: 1, offre: 'bump' }], livraison: 'poste-eco', client: { nom: 'Eva', email: 'eva@exemple.ch', adresse: 'Rue 5', npa: '1006', ville: 'Lausanne' } });
  assert.equal(cmd.json.total, 101.2, JSON.stringify(cmd.json));
  // Ligne d’offre sans sa condition : prix normal
  const sansCond = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: coffret.id, qte: 1, offre: 'bump' }], livraison: 'poste-eco', client: { nom: 'Eva', email: 'eva@exemple.ch', adresse: 'Rue 5', npa: '1006', ville: 'Lausanne' } });
  assert.equal(sansCond.json.total, 66, 'prix normal 59 + 7 de port (sous le seuil de 60)');
  // Après paiement : l’offre « après achat » est proposée, une seule fois
  await fetch(cmd.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  const suivi = await acheteur('GET', `/api/public/${slug}/commandes/${cmd.json.commandeId}?jeton=${cmd.json.jeton}`);
  // le produit idDrop est déjà dans la commande : la règle « après » vise idDrop, donc pas d’offre
  assert.equal(suivi.json.offreApres, null);
  // Commande d’un produit en stock (reste « à préparer »), offre après achat sur le produit en dropshipping
  const r = db.prepare('SELECT donnees FROM produits WHERE id = ?').get(coffret.id); const dd = JSON.parse(r.donnees); dd.stock = 10;
  db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(JSON.stringify(dd), coffret.id);
  const c2 = config('Lacustre');
  c2.offres = { regles: [{ id: 'apres', si: '*', alors: idDrop, remise: 15, type: 'apres' }] };
  await marchand('PUT', '/api/admin/config', { config: c2 });
  const cmd2 = await acheteur('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: coffret.id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Eva', email: 'eva@exemple.ch', adresse: 'Rue 5', npa: '1006', ville: 'Lausanne' } });
  await fetch(cmd2.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  const s2 = await acheteur('GET', `/api/public/${slug}/commandes/${cmd2.json.commandeId}?jeton=${cmd2.json.jeton}`);
  assert.equal(s2.json.offreApres.prixOffre, 45.9, '54 − 15 %');
  const comp = await acheteur('POST', `/api/public/${slug}/commandes/${cmd2.json.commandeId}/complement`, { jeton: cmd2.json.jeton, regle: 'apres' });
  assert.match(comp.json.paiementUrl, /paiement-simule/);
  await fetch(comp.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
  const etat = (await marchand('GET', '/api/admin/etat')).json;
  const parent = etat.commandes.find(x => x.id === cmd2.json.commandeId);
  assert.equal(parent.complements.length, 1);
  const enfant = etat.commandes.find(x => x.id === parent.complements[0]);
  assert.equal(enfant.port, 0); assert.equal(enfant.total, 45.9); assert.ok(['payee', 'fournisseur', 'expediee'].includes(enfant.statut));
  assert.equal((await acheteur('POST', `/api/public/${slug}/commandes/${cmd2.json.commandeId}/complement`, { jeton: cmd2.json.jeton, regle: 'apres' })).statut, 409, 'une seule fois');
});

test('prix barré affiché seulement s’il est licite (historique tenu par le serveur)', async () => {
  const e = await marchand('GET', '/api/admin/etat');
  const coffret = e.json.produits.find(p => p.type === 'stock');
  // Le navigateur ne peut pas fabriquer un historique
  await marchand('PUT', `/api/admin/produits/${coffret.id}`, { produit: { ...coffret, prix: 49, prixReference: 59, historiquePrix: [{ date: 0, prix: 59 }, { date: Date.now() - 1, prix: 49 }] } });
  let pub = await client()('GET', `/api/public/${slug}`);
  assert.equal(pub.json.produits.find(p => p.id === coffret.id).prixBarre, undefined, 'refusé : 59 n’a pas été pratiqué 30 jours');
  assert.equal(pub.json.produits.find(p => p.id === coffret.id).historiquePrix, undefined, 'historique jamais public');
  // On simule un historique ancien directement en base (59 pendant 60 jours, puis 49)
  const row = db.prepare('SELECT donnees FROM produits WHERE id = ?').get(coffret.id);
  const d = JSON.parse(row.donnees);
  d.historiquePrix = [{ date: Date.now() - 70 * 86400000, prix: 59 }, { date: Date.now() - 5 * 86400000, prix: 49 }];
  db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(JSON.stringify(d), coffret.id);
  pub = await client()('GET', `/api/public/${slug}`);
  assert.equal(pub.json.produits.find(p => p.id === coffret.id).prixBarre, 59);
});

test('mesure d’audience sans cookie et entonnoir', async () => {
  const a = client();
  for (const type of ['vue', 'produit', 'panier', 'livraison']) assert.equal((await a('POST', `/api/public/${slug}/evenement`, { type, session: 'sess-abcdef01' })).statut, 200);
  await a('POST', `/api/public/${slug}/evenement`, { type: 'vue', session: 'sess-abcdef02' });
  assert.equal((await a('POST', `/api/public/${slug}/evenement`, { type: 'pirate', session: 'sess-abcdef02' })).statut, 400);
  const etat = (await marchand('GET', '/api/admin/etat')).json;
  const parType = t => etat.audience.filter(x => x.type === t).reduce((s, x) => s + x.n, 0);
  assert.equal(parType('vue'), 2); assert.equal(parType('livraison'), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('evenements') WHERE name LIKE '%ip%'").get().n, 0, 'aucune colonne IP');
});

test('mot de passe oublié, e-mails envoyés par le service, domaine personnalisé', async () => {
  const anonyme = client();
  assert.equal((await anonyme('POST', '/api/auth/oubli', { email: 'inconnu@exemple.ch' })).statut, 200, 'même réponse si le compte n’existe pas');
  await anonyme('POST', '/api/auth/oubli', { email: 'lea@exemple.ch' });
  const mail = db.prepare("SELECT corps FROM emails WHERE destinataire = 'lea@exemple.ch' ORDER BY id DESC LIMIT 1").get();
  const jeton = /reinitialiser=([\w-]+)/.exec(mail.corps)[1];
  assert.equal((await anonyme('POST', '/api/auth/reinitialiser', { jeton, motDePasse: 'court' })).statut, 400);
  assert.equal((await anonyme('POST', '/api/auth/reinitialiser', { jeton, motDePasse: 'nouveau mot de passe solide' })).statut, 200);
  assert.equal((await anonyme('POST', '/api/auth/reinitialiser', { jeton, motDePasse: 'nouveau mot de passe solide' })).statut, 400, 'lien à usage unique');
  assert.equal((await marchand('GET', '/api/admin/etat')).statut, 401, 'anciennes sessions fermées');
  assert.equal((await marchand('POST', '/api/auth/connexion', { email: 'lea@exemple.ch', motDePasse: 'nouveau mot de passe solide' })).statut, 200);

  // Envoi par Brevo (faux service)
  const courriel = require('../src/courriel');
  const envoyes = [];
  const p = courriel.prestataire({ BREVO_API_KEY: 'k', EMAIL_EXPEDITEUR: 'Comptoir <ne-pas-repondre@exemple.ch>' }, async (url, o) => { envoyes.push(JSON.parse(o.body)); return { ok: true }; });
  const n = await courriel.envoyerFile(db, p, { lot: 500, journal: { error() {} } });
  assert.ok(n > 0 && envoyes[0].sender.email === 'ne-pas-repondre@exemple.ch');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM emails WHERE envoye = 0').get().n, 0);

  // Domaine : refusé tant que le DNS ne pointe pas vers Comptoir
  const c = config('Lacustre');
  c.boutique.domaine = { domaine: 'lacustre-test.invalid' };
  await marchand('PUT', '/api/admin/config', { config: c });
  assert.equal((await marchand('POST', '/api/admin/domaine/verifier')).statut, 409);
  // Impossible de se déclarer « actif » sans vérification
  c.boutique.domaine = { domaine: 'pirate.example', actif: true };
  await marchand('PUT', '/api/admin/config', { config: c });
  assert.equal((await marchand('GET', '/api/admin/etat')).json.boutique.domaine.actif, false);
  const getHote = hote => new Promise((ok, ko) => http.get({ host: '127.0.0.1', port: serveur.address().port, path: '/', headers: { Host: hote } }, r => { let t = ''; r.on('data', c => { t += c; }); r.on('end', () => ok(t)); }).on('error', ko));
  assert.doesNotMatch(await getHote('pirate.example'), /comptoir-slug/, 'domaine non vérifié : pas de boutique servie');
  // Domaine vérifié (vérification simulée en base) : la boutique est servie à la racine
  const row = db.prepare('SELECT id, config FROM boutiques WHERE slug = ?').get(slug);
  const cf = JSON.parse(row.config); cf.boutique.domaine = { domaine: 'lacustre.example', actif: true };
  db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(cf), row.id);
  assert.match(await getHote('lacustre.example'), new RegExp(`name="comptoir-slug" content="${slug}"`));
  assert.equal((await fetch(`${base}/api/tls/autoriser?domain=lacustre.example`)).status, 200);
  assert.equal((await fetch(`${base}/api/tls/autoriser?domain=pirate.example`)).status, 404, 'pas de certificat pour un domaine non vérifié');
});

test('suppression du compte : mot de passe exigé, données et boutique effacées', async () => {
  const c = client();
  const r = await c('POST', '/api/auth/inscription', { email: 'depart@exemple.ch', motDePasse: 'un mot de passe solide', config: config('Boutique Départ'), produits: [{ nom: 'Bol', prix: 30, stock: 2, type: 'stock', cout: 9 }] });
  assert.equal(r.statut, 201);
  const s = await c('GET', '/api/session');
  assert.equal(typeof s.json.emails === 'string' || s.json.emails === null, true);
  const e = await c('GET', '/api/admin/etat');
  assert.ok(e.json.serveur.creeLe > 0);
  assert.equal((await c('POST', '/api/admin/compte/supprimer', { motDePasse: 'mauvais' })).statut, 401);
  assert.equal((await c('POST', '/api/admin/compte/supprimer', { motDePasse: 'un mot de passe solide' })).statut, 200);
  assert.equal((await c('GET', '/api/admin/etat')).statut, 401);
  assert.equal((await client()('GET', '/api/public/' + r.json.slug)).statut, 404);
  assert.equal((await client()('POST', '/api/auth/connexion', { email: 'depart@exemple.ch', motDePasse: 'un mot de passe solide' })).statut, 401);
});

test('abonnement : rien n’est accessible avant le paiement, puis seulement sa propre boutique', async () => {
  const c = client();
  const r = await c('POST', '/api/auth/inscription', { email: 'nouveau@exemple.ch', motDePasse: 'un mot de passe solide', config: config('Boutique Payante'), produits: [{ nom: 'Tasse', prix: 25, stock: 4, type: 'stock', cout: 8 }] }, { sansPaiement: true });
  assert.equal(r.statut, 201);
  const s = await c('GET', '/api/session');
  assert.equal(s.json.abonnement.actif, false);
  // Espace marchand et vitrine fermés tant que rien n'est payé
  assert.equal((await c('GET', '/api/admin/etat')).statut, 402);
  assert.equal((await c('PUT', '/api/admin/config', { config: config('X') })).statut, 402);
  assert.equal((await client()('GET', '/api/public/' + r.json.slug)).statut, 404);
  // Choix de la formule et paiement
  const formules = await c('GET', '/api/abonnement');
  assert.equal(formules.json.devise, 'CHF');
  assert.deepEqual(formules.json.formules.map(f => f.id), ['lancement', 'croissance', 'pro']);
  assert.equal((await c('POST', '/api/abonnement/commencer', { formule: 'inconnue' })).statut, 400);
  const debut = await c('POST', '/api/abonnement/commencer', { formule: 'lancement' });
  assert.match(debut.json.url, /\/abonnement-simule\//);
  const page = await fetch(debut.json.url);
  assert.match(await page.text(), /CHF 29/);
  const conf = await fetch(debut.json.url + '/confirmer', { method: 'POST', redirect: 'manual' });
  assert.equal(conf.status, 303);
  assert.match(conf.headers.get('location'), /\/app\?abonnement=ok/);
  // Le lien de paiement ne sert qu'une fois
  assert.equal((await fetch(debut.json.url)).status, 404);
  const e = await c('GET', '/api/admin/etat');
  assert.equal(e.statut, 200);
  assert.equal(e.json.serveur.abonnement.formule, 'lancement');
  assert.equal(e.json.produits.length, 1);
  assert.equal((await client()('GET', '/api/public/' + r.json.slug)).statut, 200);
  // Un second paiement est refusé ; changement de formule et résiliation (accès gardé jusqu'à la fin de la période)
  assert.equal((await c('POST', '/api/abonnement/commencer', { formule: 'pro' })).statut, 409);
  assert.equal((await c('POST', '/api/abonnement/changer', { formule: 'pro' })).statut, 200);
  assert.equal((await c('POST', '/api/abonnement/resilier', {})).statut, 200);
  const apres = await c('GET', '/api/abonnement');
  assert.equal(apres.json.formule, 'pro');
  assert.equal(apres.json.finDemandee, true);
  assert.equal(apres.json.actif, true);
  // Isolation : ce marchand ne voit que sa boutique, jamais celle de Lacustre
  assert.ok(!e.json.produits.some(p => p.nom === 'Coffret Léman'));
  assert.equal(e.json.serveur.slug, r.json.slug);
});

test('produits stars : produits préparés à l’inscription, ventes agrégées seulement à partir de 2 boutiques', async () => {
  const vendre = async (nom, email, sources) => {
    const c = client();
    const r = await c('POST', '/api/auth/inscription', { email, motDePasse: 'un mot de passe solide', config: config(nom), importer: sources });
    assert.equal(r.statut, 201);
    const e = await c('GET', '/api/admin/etat');
    const prods = e.json.produits.filter(p => p.type === 'drop');
    assert.deepEqual(prods.map(p => p.source).sort(), sources.slice().sort(), 'produits fournisseurs préparés dès l’inscription');
    const acheteur = client();
    const cmd = await acheteur('POST', `/api/public/${r.json.slug}/commandes`, { lignes: prods.map(p => ({ produitId: p.id, qte: 1 })), livraison: 'poste-eco', client: { nom: 'Test', email: 'achat@exemple.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } });
    assert.equal(cmd.statut, 201);
    await fetch(cmd.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    return c;
  };
  const a = await vendre('Stars A', 'stars-a@exemple.ch', ['f03', 'f07']);
  assert.equal((await a('GET', '/api/admin/tendances')).statut, 200);   // première collecte, avant la seconde boutique
  await vendre('Stars B', 'stars-b@exemple.ch', ['f03']);
  // Les ventes sont recalculées à la consultation (âge maximal réglé à 0 ms pour le test)
  const t = await a('GET', '/api/admin/tendances');
  assert.equal(t.statut, 200);
  assert.ok(t.json.majLe > 0);
  assert.ok(t.json.ventes.f03.boutiques >= 2, 'vendu par au moins deux boutiques : visible');
  assert.ok(t.json.ventes.f03.n28 >= 2);
  assert.equal(t.json.ventes.f07, undefined, 'vendu par une seule boutique : jamais exposé');
  assert.equal(t.json.sources.trends.actif, false, 'sans clé SerpApi, la source est signalée inactive');
  // Un marchand sans abonnement n'y a pas accès
  const sans = client();
  await sans('POST', '/api/auth/inscription', { email: 'stars-c@exemple.ch', motDePasse: 'un mot de passe solide', config: config('Stars C') }, { sansPaiement: true });
  assert.equal((await sans('GET', '/api/admin/tendances')).statut, 402);
});
