// Retours partiels : remboursement d'une partie des articles, avoir partiel scellé, remise répartie au centime,
// argent puis carte cadeau, stock remis, avoir final du reste, cohérence du journal inaltérable.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const R = require('../src/retours-partiels');

test('calcul : lignes au centime (prix déjà remisés, même fractionnaires), somme des avoirs = facture (1000 commandes)', () => {
  let graine = 7; const hasard = n => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % n; };
  for (let k = 0; k < 1000; k++) {
    // Prix payés (remise déjà déduite, parfois à fraction de centime : 12,90 × 0,95 = 12,255), remise informative.
    const facteur = hasard(3) ? 1 - hasard(30) / 100 : 1;
    const lignes = Array.from({ length: 1 + hasard(4) }, (_, i) => ({ nom: `A${i}`, prix: (99 + hasard(9000)) / 100 * facteur, qte: 1 + hasard(5) }));
    const articles = Math.round(lignes.reduce((a, l) => a + l.prix * l.qte, 0) * 100), port = hasard(2) ? 590 : 0;
    const c = { facture: 'FA-1', lignes, remise: 3.5, port: port / 100, total: (articles + port) / 100, retoursPartiels: [] };
    assert.equal(R.netsLignes(c).reduce((a, b) => a + b, 0), articles, 'lignes = montant payé pour les articles, au centime');
    // Retours d'une unité à la fois tant qu'il en reste au moins une ailleurs, puis avoir final.
    for (;;) {
      const d = R.deja(c), restants = lignes.map((l, i) => l.qte - d.qte[i]);
      if (restants.reduce((a, b) => a + b, 0) <= 1) break;
      const i = restants.findIndex(q => q > 0);
      const r = R.calculer(c, { lignes: [{ index: i, qte: 1 }], port: c.retoursPartiels.length === 1 }, { argentPaye: Math.round(c.total * 100) });
      c.retoursPartiels.push({ numero: `AV-${c.retoursPartiels.length}`, date: 0, ...r });
    }
    const somme = c.retoursPartiels.reduce((a, p) => a + p.montant, 0) + R.resteAvoir(c);
    assert.equal(somme, Math.round(c.total * 100), 'avoirs partiels + avoir final = facture');
    assert.ok(R.resteAvoir(c) >= 0);
    // La vue de l'avoir final : articles restants + livraison restante = total (à l'arrondi des fractions de centime près).
    const v = R.vueReste({ ...c, avoir: { numero: 'AV-F', date: 0, montant: R.resteAvoir(c) / 100 } });
    assert.ok(Math.abs(Math.round((v.sousTotal + v.port) * 100) - Math.round(v.total * 100)) <= lignes.length, `${v.sousTotal} + ${v.port} ≈ ${v.total}`);
    assert.equal(v.remise, 0); assert.equal(v.retoursPartiels, undefined);
  }
});

test('calcul : refus explicites (quantité, tout rendu, livraison deux fois, montant payé)', () => {
  const c = { facture: 'FA-1', lignes: [{ nom: 'A', prix: 10, qte: 2 }, { nom: 'B', prix: 5, qte: 1 }], remise: 0, port: 5, total: 30, retoursPartiels: [] };
  const opt = { argentPaye: 3000 };
  assert.throws(() => R.calculer(c, { lignes: [{ index: 0, qte: 3 }] }, opt), /au plus/);
  assert.throws(() => R.calculer(c, { lignes: [{ index: 0, qte: 2 }, { index: 1, qte: 1 }] }, opt), /Rembourser.*commande entière/);
  assert.throws(() => R.calculer(c, { lignes: [{ index: 5, qte: 1 }] }, opt), /inconnu/);
  assert.throws(() => R.calculer(c, { lignes: [{ index: 0, qte: 1.5 }] }, opt), /invalide/);
  assert.throws(() => R.calculer(c, { lignes: [{ index: 0, qte: 1 }, { index: 0, qte: 1 }] }, opt), /inconnu/, 'même ligne deux fois');
  assert.throws(() => R.calculer(c, { lignes: [] }, opt), /au moins un article/);
  const r = R.calculer(c, { lignes: [{ index: 0, qte: 1 }], port: true }, opt);
  assert.deepEqual([r.montant, r.port, r.argent, r.carte], [1500, 500, 1500, 0]);
  c.retoursPartiels.push({ numero: 'AV-2', ...r });
  assert.throws(() => R.calculer(c, { lignes: [{ index: 1, qte: 1 }], port: true }, opt), /déjà été remboursée/);
  // Carte cadeau : argent d'abord, puis la carte, jamais plus que ce qui a été payé.
  const k = { facture: 'FA-3', lignes: [{ nom: 'A', prix: 20, qte: 3 }], remise: 0, port: 0, total: 60, carteCadeau: { id: 'cc', fin: 'ABCD', montant: 50 }, retoursPartiels: [] };
  const r1 = R.calculer(k, { lignes: [{ index: 0, qte: 1 }] }, { argentPaye: 1000 });
  assert.deepEqual([r1.argent, r1.carte], [1000, 1000]);
  k.retoursPartiels.push({ numero: 'AV-4', ...r1 });
  const r2 = R.calculer(k, { lignes: [{ index: 0, qte: 1 }] }, { argentPaye: 1000 });
  assert.deepEqual([r2.argent, r2.carte], [0, 2000]);
});

async function boutique() {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const emails = [];
  const app = creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', app);
  let cookie = '';
  const appel = async (m, chemin, corps, avecSession = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecSession ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && avecSession) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null, texte = null; try { texte = await r.clone().text(); json = JSON.parse(texte); } catch { /* pas du JSON */ } return { statut: r.status, json, texte, type: r.headers.get('content-type') }; };
  const conf = { boutique: { nom: 'Retours', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Retours SAS', adresse: '5 rue Neuve, 69001 Lyon', email: 'r@exemple.fr', tvaIntra: 'FR12345678901', siret: '12345678901234' } };
  assert.equal((await appel('POST', '/api/auth/inscription', { email: 'rp@exemple.fr', motDePasse: 'un mot de passe solide', config: conf, produits: [{ nom: 'Vase', prix: 40, stock: 50, type: 'stock' }, { nom: 'Bougie', prix: 12.9, stock: 50, type: 'stock' }] })).statut, 201);
  const etat = (await appel('GET', '/api/admin/etat')).json;
  return { db, s, appel, emails, slug: db.prepare('SELECT slug FROM boutiques').get().slug, produits: etat.produits.map(p => p.id) };
}
const client = { nom: 'Lou Martin', email: 'lou@exemple.fr', adresse: '3 rue Haute', npa: '69002', ville: 'Lyon' };
// Comme l'écran : aperçu, puis confirmation avec le rang et le montant vus.
const retourner = async (appel, base, corps) => {
  const ap = await appel('POST', base, { ...corps, apercu: true });
  if (ap.statut !== 200) return ap;
  return appel('POST', base, { ...corps, attendu: { rang: ap.json.apercu.rang, montant: ap.json.apercu.montant } });
};
const lire = (db, id) => { const r = db.prepare('SELECT * FROM commandes WHERE id = ?').get(id); return { statut: r.statut, ...JSON.parse(r.donnees) }; };
const stock = (db, id) => JSON.parse(db.prepare('SELECT donnees FROM produits WHERE id = ?').get(id).donnees).stock;

test('serveur : deux retours partiels puis remboursement du reste ; avoirs, stock, journal et e-mail cohérents', async () => {
  const { db, s, appel, slug, produits: [vase, bougie] } = await boutique();
  try {
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: vase, qte: 3 }, { produitId: bougie, qte: 2 }], livraison: 'colissimo', client }, false);
    assert.equal(cmd.statut, 201, JSON.stringify(cmd.json));
    await appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    const id = cmd.json.commandeId, c0 = lire(db, id);
    assert.equal(c0.statut, 'payee'); assert.ok(c0.facture);
    const stockVase = stock(db, vase);
    const base = `/api/admin/commandes/${id}/retour-partiel`;
    // Aperçu : rien ne bouge.
    const ap = await appel('POST', base, { lignes: [{ index: 0, qte: 1 }], apercu: true });
    assert.equal(ap.statut, 200, JSON.stringify(ap.json));
    const attendu = Math.round(R.netsLignes(c0)[0] / 3);
    assert.equal(attendu, Math.round(c0.lignes[0].prix * 100), 'un vase : son prix payé (remise par palier déjà déduite), pas moins');
    assert.equal(ap.json.apercu.montant, attendu);
    assert.equal(ap.json.apercu.mode, 'simulation');
    assert.equal(lire(db, id).retoursPartiels, undefined); assert.equal(stock(db, vase), stockVase);
    // Retour d'un vase : avoir partiel, stock +1, e-mail au client.
    // Sans le montant vu à l'aperçu : refusé.
    assert.equal((await appel('POST', base, { lignes: [{ index: 0, qte: 1 }] })).json.code, 'deja_enregistre');
    const r1 = await retourner(appel, base, { lignes: [{ index: 0, qte: 1 }], motif: 'Fêlé à la livraison' });
    assert.equal(r1.statut, 200, JSON.stringify(r1.json));
    // Même confirmation renvoyée (réponse perdue, second onglet) : refusée, pas de second remboursement.
    assert.equal((await appel('POST', base, { lignes: [{ index: 0, qte: 1 }], attendu: { rang: 1, montant: attendu } })).json.code, 'deja_enregistre');
    // Montant différent de celui affiché : refusé.
    assert.equal((await appel('POST', base, { lignes: [{ index: 0, qte: 1 }], attendu: { rang: 2, montant: attendu + 1 } })).json.code, 'montant_change');
    // Livraison seule : refusée (un avoir porte sur des articles) ; entrée malformée : 400, pas 500.
    assert.equal((await appel('POST', base, { lignes: [], port: true, apercu: true })).json.code, 'retour_vide');
    assert.equal((await appel('POST', base, { lignes: [null], apercu: true })).statut, 400);
    assert.equal((await appel('POST', base, { lignes: [{ index: null, qte: 1 }], apercu: true })).statut, 400);
    let c = lire(db, id);
    assert.equal(c.retoursPartiels.length, 1); assert.equal(c.retoursPartiels[0].montant, attendu); assert.match(r1.json.avoir, /^AV-\d{4}-\d{4}$/);
    assert.equal(stock(db, vase), stockVase + 1);
    assert.match(c.historique.at(-1).texte, /Retour partiel AV-.*Fêlé/);
    const mail = db.prepare("SELECT * FROM emails WHERE destinataire = 'lou@exemple.fr' ORDER BY rowid DESC LIMIT 1").get();
    assert.match(mail.sujet, /Remboursement partiel/);
    // Avoir partiel en XML (EN 16931, type 381, montant de l'avoir) et en PDF.
    const xml = await appel('GET', `/api/admin/commandes/${id}/facture-electronique?avoir=${r1.json.avoir}`);
    assert.equal(xml.statut, 200, xml.texte);
    assert.match(xml.texte, /<ram:TypeCode>381<\/ram:TypeCode>/); assert.match(xml.texte, /Avoir partiel sur la facture/);
    assert.match(xml.texte, new RegExp(`<ram:GrandTotalAmount>${(attendu / 100).toFixed(2)}</ram:GrandTotalAmount>`));
    const pdf = await appel('GET', `/api/admin/commandes/${id}/facture-pdf?avoir=${r1.json.avoir}`);
    assert.equal(pdf.statut, 200); assert.match(pdf.type, /pdf/);
    assert.equal((await appel('GET', `/api/admin/commandes/${id}/facture-pdf?avoir=AV-1999-0001`)).statut, 404);
    // Deuxième retour : une bougie et la livraison, sans remise en stock (abîmée).
    const stockBougie = stock(db, bougie);
    const r2 = await retourner(appel, base, { lignes: [{ index: 1, qte: 1 }], port: true, remettreEnStock: false });
    assert.equal(r2.statut, 200, JSON.stringify(r2.json));
    assert.equal(stock(db, bougie), stockBougie, 'article abîmé : pas remis en stock');
    // Tout le reste d'un coup : refus, c'est un remboursement complet.
    const tout = await retourner(appel, base, { lignes: [{ index: 0, qte: 2 }, { index: 1, qte: 1 }] });
    assert.equal(tout.statut, 409); assert.equal(tout.json.code, 'retour_complet');
    // Journal : les deux avoirs partiels sont scellés et la chaîne est intacte.
    let v = (await appel('POST', '/api/admin/journal-inalterable/verifier', {})).json;
    assert.equal(v.ok, true, JSON.stringify(v.anomalies));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM journal_inalterable WHERE type = 'avoir-partiel'").get().n, 2);
    const sceau = JSON.parse(db.prepare("SELECT contenu FROM journal_inalterable WHERE type = 'avoir-partiel' ORDER BY seq LIMIT 1").get().contenu);
    assert.deepEqual(sceau.lignes.map(l => [l[0], l[1]]), [['Vase', 1]], 'le sceau porte les articles rendus');
    assert.equal(sceau.total, -attendu);
    // Remboursement du reste : avoir final = facture − avoirs partiels ; stock des unités restantes remis.
    const rb = await appel('POST', `/api/admin/commandes/${id}/statut`, { statut: 'remboursee' });
    assert.equal(rb.statut, 200, JSON.stringify(rb.json));
    c = lire(db, id);
    const somme = c.retoursPartiels.reduce((a, p) => a + p.montant, 0) + Math.round(c.avoir.montant * 100);
    assert.equal(somme, Math.round(c.total * 100), 'avoirs = facture, au centime');
    assert.equal(stock(db, vase), stockVase + 3); assert.equal(stock(db, bougie), stockBougie + 1, 'seule la bougie intacte revient');
    const xmlF = await appel('GET', `/api/admin/commandes/${id}/facture-electronique?avoir=1`);
    assert.equal(xmlF.statut, 200, xmlF.texte);
    assert.match(xmlF.texte, new RegExp(`<ram:GrandTotalAmount>${c.avoir.montant.toFixed(2)}</ram:GrandTotalAmount>`));
    assert.match(xmlF.texte, /Avoir pour le solde de la facture/);
    v = (await appel('POST', '/api/admin/journal-inalterable/verifier', {})).json;
    assert.equal(v.ok, true, JSON.stringify(v.anomalies));
    // Plus de retour partiel sur une commande remboursée.
    assert.equal((await retourner(appel, base, { lignes: [{ index: 0, qte: 1 }] })).statut, 409);
    // Un avoir partiel modifié en base est détecté.
    const brut = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(id).donnees);
    brut.retoursPartiels[0].montant += 100;
    db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(JSON.stringify(brut), id);
    v = (await appel('POST', '/api/admin/journal-inalterable/verifier', {})).json;
    assert.equal(v.ok, false); assert.match(v.anomalies.join(' '), /ne correspond plus à son sceau/);
  } finally { s.close(); }
});

test('serveur : carte cadeau recréditée au-delà de l’argent payé, deux demandes simultanées', async () => {
  const { db, s, appel, slug, produits: [vase] } = await boutique();
  try {
    const code = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 100 })).json.code;
    // 3 vases : la carte paie 100, le reste en ligne.
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: vase, qte: 3 }], livraison: 'colissimo', client, carteCadeau: code }, false);
    assert.equal(cmd.statut, 201, JSON.stringify(cmd.json));
    await appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    const id = cmd.json.commandeId, c0 = lire(db, id), argent = Math.round(c0.total * 100) - 10000;
    const base = `/api/admin/commandes/${id}/retour-partiel`;
    // Deux demandes en même temps pour 2 vases sur 3 : une seule passe (la seconde dépasserait ce qui reste).
    const vu = (await appel('POST', base, { lignes: [{ index: 0, qte: 2 }], apercu: true })).json.apercu;
    const corps = { lignes: [{ index: 0, qte: 2 }], attendu: { rang: vu.rang, montant: vu.montant } };
    const [a, b] = await Promise.all([appel('POST', base, corps), appel('POST', base, corps)]);
    assert.deepEqual([a.statut, b.statut].sort(), [200, 409]);
    let c = lire(db, id);
    assert.equal(c.retoursPartiels.length, 1);
    const p1 = c.retoursPartiels[0];
    assert.equal(p1.argent, Math.min(argent, p1.montant)); assert.equal(p1.argent + p1.carte, p1.montant);
    const solde = (await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde;
    assert.equal(Math.round(solde * 100), p1.carte, 'part au-delà de l’argent payé : sur la carte');
    // Remboursement du reste : la carte reçoit seulement ce qui ne l'a pas encore été.
    assert.equal((await appel('POST', `/api/admin/commandes/${id}/statut`, { statut: 'remboursee' })).statut, 200);
    assert.equal((await appel('POST', `/api/public/${slug}/carte-cadeau`, { code }, false)).json.solde, 100, 'carte entièrement rendue, pas plus');
    assert.deepEqual(db.prepare('SELECT COUNT(*) n FROM cartes_cadeaux').get().n, 1);
    c = lire(db, id);
    assert.equal(c.retoursPartiels.reduce((x, p) => x + p.montant, 0) + Math.round(c.avoir.montant * 100), Math.round(c.total * 100));
  } finally { s.close(); }
});

test('Stripe : remboursement partiel avec montant et clé d’idempotence ; sans montant, le reste', async () => {
  const { prestataireStripe } = require('../src/paiements');
  const appels = [];
  const fauxFetch = async (url, opts) => {
    appels.push({ url, methode: opts.method || 'GET', corps: opts.body ? new URLSearchParams(String(opts.body)) : null, cle: (opts.headers || {})['Idempotency-Key'] });
    if (!opts.method || opts.method === 'GET') return { ok: true, json: async () => ({ id: 'cs_1', payment_intent: 'pi_1' }) };
    return { ok: true, json: async () => ({ id: 're_1' }) };
  };
  const st = prestataireStripe({ cleSecrete: 'sk_test_x', secretWebhook: 'whsec_x', urlPublique: 'https://x', fetchImpl: fauxFetch });
  await st.rembourser({ paiement: { ref_externe: 'cs_1', compte: 'acct_1' }, montant: 1250, cle: 'retour-c1-1-1250' });
  const r1 = appels.find(a => a.methode === 'POST');
  assert.equal(r1.corps.get('payment_intent'), 'pi_1'); assert.equal(r1.corps.get('amount'), '1250'); assert.equal(r1.cle, 'retour-c1-1-1250');
  await st.rembourser({ paiement: { ref_externe: 'cs_1' } });
  const r2 = appels.filter(a => a.methode === 'POST')[1];
  assert.equal(r2.corps.get('amount'), null, 'sans montant : Stripe rembourse ce qui reste');
});

test('serveur : retour dont l’argent est parti sans avoir enregistré, terminé à l’identique ; remboursement complet bloqué en attendant', async () => {
  const { db, s, appel, slug, produits: [vase] } = await boutique();
  try {
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: vase, qte: 3 }], livraison: 'colissimo', client }, false);
    await appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    const id = cmd.json.commandeId, base = `/api/admin/commandes/${id}/retour-partiel`;
    const vu = (await appel('POST', base, { lignes: [{ index: 0, qte: 1 }], apercu: true })).json.apercu;
    // Situation après une panne entre le remboursement et l'avoir : marqueur posé (comme avant l'appel à Stripe).
    const brut = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(id).donnees);
    brut.retourEnCours = { rang: 1, cle: `retour-${id}-1`, calcul: { lignes: vu.lignes.map(({ index, qte, montant }) => ({ index, qte, montant })), port: 0, montant: vu.montant, argent: vu.argent, carte: 0 }, mode: 'simulation', paiementId: null, stock: true, motif: null, le: Date.now() };
    // Un litige ouvert entre-temps ne doit pas empêcher d'enregistrer un remboursement déjà fait.
    brut.litige = { statut: 'needs_response', montant: 1, raison: 'fraudulent' };
    db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(JSON.stringify(brut), id);
    assert.equal((await appel('POST', `/api/admin/commandes/${id}/statut`, { statut: 'remboursee' })).json.code, 'retour_en_cours');
    assert.equal((await appel('POST', base, { lignes: [{ index: 0, qte: 1 }], apercu: true })).json.code, 'retour_en_cours');
    const fin = await appel('POST', base, { reprendre: true });
    assert.equal(fin.statut, 200, JSON.stringify(fin.json)); assert.equal(fin.json.repris, true);
    const c = lire(db, id);
    assert.equal(c.retourEnCours, undefined); assert.equal(c.retoursPartiels.length, 1); assert.equal(c.retoursPartiels[0].montant, vu.montant);
    assert.match(c.historique.at(-1).texte, /litige bancaire est ouvert/);
    // Rejoué : rien de plus.
    assert.equal((await appel('POST', base, { reprendre: true })).statut, 409);
    assert.equal(lire(db, id).retoursPartiels.length, 1);
    const v = (await appel('POST', '/api/admin/journal-inalterable/verifier', {})).json;
    assert.equal(v.ok, true, JSON.stringify(v.anomalies));
  } finally { s.close(); }
});

test('client : facture et avoirs en PDF avec le jeton de sa commande ; demande de retour limitée au reste', async () => {
  const { db, s, appel, slug, produits: [vase] } = await boutique();
  try {
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: vase, qte: 3 }], livraison: 'colissimo', client }, false);
    await appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    const id = cmd.json.commandeId, jeton = cmd.json.jeton, base = `/api/admin/commandes/${id}/retour-partiel`;
    const r1 = await retourner(appel, base, { lignes: [{ index: 0, qte: 1 }] });
    assert.equal(r1.statut, 200);
    const doc = q => appel('GET', `/api/public/${slug}/commandes/${id}/document?jeton=${jeton}${q || ''}`, null, false);
    const f = await doc(); assert.equal(f.statut, 200); assert.match(f.type, /pdf/); assert.ok(f.texte.startsWith('%PDF'));
    const a = await doc(`&avoir=${r1.json.avoir}`); assert.equal(a.statut, 200); assert.match(a.texte, /factur-x\.xml/);
    assert.equal((await doc('&avoir=AV-2000-0001')).statut, 404);
    assert.equal((await doc('&avoir=1')).statut, 404, 'pas encore d’avoir final');
    assert.equal((await appel('GET', `/api/public/${slug}/commandes/${id}/document?jeton=mauvais`, null, false)).statut, 404);
    assert.equal((await appel('GET', `/api/public/${slug}/commandes/${id}/document`, null, false)).statut, 404);
    // Page de suivi : facture, avoir partiel et unités déjà rendues.
    const suivi = (await appel('GET', `/api/public/${slug}/commandes/${id}?jeton=${jeton}`, null, false)).json;
    assert.ok(suivi.facture); assert.deepEqual(suivi.avoirsPartiels.map(x => x.numero), [r1.json.avoir]); assert.equal(suivi.lignes[0].rendu, 1);
    // Livrée : le client demande un retour ; au plus les 2 unités restantes.
    for (const st of ['preparation', 'expediee', 'livree']) assert.equal((await appel('POST', `/api/admin/commandes/${id}/statut`, { statut: st, suivi: 'X1' })).statut, 200);
    const dem = await appel('POST', `/api/public/${slug}/commandes/${id}/retour`, { jeton, lignes: [{ ligne: 0, qte: 3 }] }, false);
    assert.equal(dem.statut, 201, JSON.stringify(dem.json));
    const c = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(id).donnees);
    assert.equal(c.retour.lignes[0].qte, 2, 'plafonné aux unités pas encore rendues');
  } finally { s.close(); }
});

test('facture QR annulée avant paiement : le PDF dit de ne pas payer, sans montant dû ni IBAN', async () => {
  const FacturxPdf = require('../src/facturx-pdf');
  const config = { boutique: { nom: 'B', pays: 'ch', devise: 'CHF' }, entreprise: { raison: 'B Sàrl', adresse: 'Rue 1, 1003 Lausanne', regime: 'ch-non', iban: 'CH93 0076 2011 6238 5295 7', email: 'b@exemple.ch', tvaIntra: '' } };
  const c = { id: 'c1', numero: 7, date: Date.now(), statut: 'annulee', facture: 'FA-2026-0001', dateFacture: Date.now(), moyen: 'facture', referenceQr: '210000000003139471430009017', echeance: Date.now() + 864e6,
    client: { nom: 'Lou', adresse: 'Rue 2', npa: '1003', ville: 'Lausanne' }, lignes: [{ nom: 'Vase', prix: 40, qte: 1, tauxTva: 0 }], sousTotal: 40, port: 0, total: 40, tauxTva: 0, avoir: { numero: 'AV-2026-0002', date: Date.now(), montant: 40 } };
  const pdf = FacturxPdf.produire(c, config, { devise: 'CHF', xml: '<x/>' });
  // Texte extrait par pdftotext (test ignoré sans poppler).
  const { execFileSync } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  let texte;
  try { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-')); const f = path.join(d, 'a.pdf'); fs.writeFileSync(f, pdf); texte = execFileSync('pdftotext', [f, '-']).toString(); fs.rmSync(d, { recursive: true, force: true }); } catch { return; }
  assert.doesNotMatch(texte, /Montant à payer|IBAN/);
  assert.match(texte, /Facture annulée par l’avoir AV-2026-0002 : ne la payez pas\./);
});
