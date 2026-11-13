// Devis professionnels : calcul (montants identiques à la commande et à la facture), lien secret, acceptation unique,
// refus, expiration, modification après envoi, paiement en ligne de la commande née du devis, droits.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const Devis = require('../src/devis');
const F = require('../src/facture-electronique');

const config = { boutique: { pays: 'fr', nom: 'Atelier' }, entreprise: { regime: 'normal', raison: 'Atelier SAS', adresse: '5 rue Neuve, 69001 Lyon' } };
const client = { raison: 'Hôtel du Lac SA', contact: 'Mme Roux', email: 'achats@hotel-lac.fr', adresse: '1 quai Est', npa: '74000', ville: 'Annecy', tva: 'FR99123456789' };

test('calcul : catalogue et lignes libres, remise, port ; montants repris par la facture électronique', () => {
  const produits = [{ id: 'p1', nom: 'Vase', prix: 60, actif: true }, { id: 'p2', nom: 'Thé', prix: 10.55, actif: true, tauxReduit: true }];
  const d = Devis.preparer({ client, remisePct: 10, port: 25, lignes: [{ produitId: 'p1', qte: 12 }, { produitId: 'p2', qte: 40 }, { nom: 'Pose sur site', qte: 1, prixHt: 350 }] }, produits, config);
  assert.deepEqual(d.lignes.map(l => l.totalTtc), [648, 379.8, 378], 'totaux calculés par ligne');
  assert.equal(d.total, 648 + 379.8 + 378 + 25);
  assert.equal(d.remise, Math.round((720 + 422 + 420 - (648 + 379.8 + 378)) * 100) / 100);
  // Grande quantité en HT : pas de dérive d'arrondi unitaire (9,99 HT × 1000 = 9 990,00 HT = 11 988,00 TTC).
  const g = Devis.preparer({ client, lignes: [{ nom: 'Gobelets', qte: 1000, prixHt: 9.99 }] }, produits, config);
  assert.equal(g.total, 11988); assert.equal(g.lignes[0].prixHtSaisi, 9.99);
  const vg = Devis.ventiler(g, config); assert.equal(vg[0].ht, 9990);
  assert.throws(() => Devis.preparer({ client: { ...client, pays: 'de' }, lignes: [{ nom: 'X', qte: 1, prixHt: 1 }] }, produits, config), /autre pays/);
  // La commande née du devis produit une facture électronique cohérente au même total.
  const c = { numero: 1, facture: 'FA-1', date: Date.now(), statut: 'payee', lignes: d.lignes, port: d.port, total: d.total, tauxTva: d.tauxTva, client: { nom: client.raison, tva: client.tva } };
  const xml = F.produire(c, { ...config, entreprise: { ...config.entreprise, tvaIntra: 'FR12345678901' } });
  assert.deepEqual(F.verifier(xml), []); assert.ok(xml.includes(`<ram:GrandTotalAmount>${d.total.toFixed(2)}</ram:GrandTotalAmount>`));
  assert.match(xml, /<ram:BuyerTradeParty>.*<ram:ID schemeID="VA">FR99123456789<\/ram:ID>/s, 'numéro de TVA du client professionnel');
  // Validations
  for (const [saisie, motif] of [[{ client, lignes: [] }, /entre 1 et 100 lignes/], [{ client, lignes: [{ nom: 'X', qte: 1.5, prixHt: 1 }] }, /quantité/], [{ client, lignes: [{ nom: 'X', qte: 1, prixHt: -1 }] }, /prix HT/], [{ client, remisePct: 95, lignes: [{ nom: 'X', qte: 1, prixHt: 1 }] }, /Remise/], [{ client: { ...client, email: 'pas-un-email' }, lignes: [{ nom: 'X', qte: 1, prixHt: 1 }] }, /E-mail/], [{ client: { ...client, raison: '' }, lignes: [{ nom: 'X', qte: 1, prixHt: 1 }] }, /Raison sociale/], [{ client, lignes: [{ produitId: 'nope', qte: 1 }] }, /introuvable/], [{ client, lignes: [{ nom: 'X', qte: 1, prixHt: 0 }] }, /positif/]]) assert.throws(() => Devis.preparer(saisie, produits, config), motif);
});

async function monter() {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const emails = [];
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non', LOG_EMAILS: '' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const api = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  const formulaire = (chemin, champs) => fetch(base + chemin, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(champs).toString() });
  assert.equal((await api('POST', '/api/auth/inscription', { email: 'dv@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Atelier SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal', iban: 'FR7630006000011234567890189' } }, produits: [{ nom: 'Vase', prix: 60, stock: 100, type: 'stock' }] })).statut, 201);
  const etat = (await api('GET', '/api/admin/etat')).json;
  return { db, s, base, api, formulaire, emails, produit: etat.produits[0].id };
}

test('parcours : création, envoi, consultation, acceptation unique, commande payée en ligne', async () => {
  const { db, s, base, api, formulaire, produit } = await monter();
  try {
    const cree = await api('POST', '/api/admin/devis', { client, objet: 'Décoration du hall', remisePct: 5, port: 30, validiteJours: 15, lignes: [{ produitId: produit, qte: 10 }, { nom: 'Livraison et installation <b>sur site</b>', qte: 1, prixHt: 200 }], conditions: 'Acompte à la commande.' });
    assert.equal(cree.statut, 201, JSON.stringify(cree.json)); const id = cree.json.devis.id;
    assert.match(cree.json.devis.numero, /^DE-\d{4}-0001$/); assert.equal(cree.json.devis.statut, 'brouillon');
    assert.equal(cree.json.devis.total, Math.round((57 * 10 + 228 + 30) * 100) / 100);
    // Brouillon : pas de lien public.
    assert.equal((await fetch(`${base}/devis/atelier/${id}?jeton=x`)).status, 404);
    const env = await api('POST', `/api/admin/devis/${id}/envoyer`);
    assert.equal(env.statut, 200); const lien = env.json.lien; const jeton = new URL(lien).searchParams.get('jeton');
    assert.ok(jeton.length >= 40);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM devis').all()).includes(jeton), 'jeton jamais stocké en clair');
    assert.ok(db.prepare('SELECT corps FROM emails WHERE destinataire = ?').get(client.email).corps.includes(lien), 'lien envoyé au client');
    // Page publique : contenu échappé, en-têtes stricts, mauvais jeton refusé.
    let page = await fetch(lien); const html = await page.text();
    assert.equal(page.status, 200); assert.match(page.headers.get('cache-control'), /no-store/);
    assert.ok(html.includes('&lt;b&gt;sur site&lt;/b&gt;') && !html.includes('<b>sur site</b>'), 'texte échappé');
    assert.match(html, /Hôtel du Lac SA/); assert.match(html, /Bon pour accord/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-inline/);
    assert.equal((await fetch(lien.replace(jeton, jeton.slice(0, -2) + 'xx'))).status, 404);
    // Acceptation sans case cochée : refusée.
    let rep = await formulaire(`/devis/atelier/${id}/accepter`, { jeton, nom: 'M. Roux' });
    assert.equal(rep.status, 200); assert.match(await rep.text(), /cochez « bon pour accord »/, 'erreur affichée dans la page du devis');
    // Deux acceptations simultanées : une seule commande.
    const [a1, a2] = await Promise.all([formulaire(`/devis/atelier/${id}/accepter`, { jeton, nom: 'C. Roux, directrice', accord: 'oui' }), formulaire(`/devis/atelier/${id}/accepter`, { jeton, nom: 'C. Roux, directrice', accord: 'oui' })]);
    assert.deepEqual([a1.status, a2.status].sort(), [200, 303], 'une acceptation, l’autre réaffiche la page');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM commandes WHERE json_extract(donnees, '$.devis.id') = ?").get(id).n, 1);
    const d = (await api('GET', `/api/admin/devis/${id}`)).json.devis;
    assert.equal(d.statut, 'accepte'); assert.equal(d.acceptation.nom, 'C. Roux, directrice'); assert.match(d.acceptation.empreinte, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(d).includes('127.0.0.1'), 'adresse IP non stockée en clair');
    const row = db.prepare('SELECT * FROM commandes WHERE id = ?').get(d.commande.id);
    assert.ok(!row.donnees.includes('Hôtel du Lac') && !row.donnees.includes(client.email), 'client chiffré en base');
    const commandeApi = async id => (await api('GET', '/api/admin/etat')).json.commandes.find(x => x.id === id);
    const c = await commandeApi(d.commande.id);
    assert.equal(row.statut, 'attente'); assert.equal(c.total, d.total); assert.equal(c.client.nom, 'Hôtel du Lac SA'); assert.equal(c.client.tva, client.tva);
    // Le devis accepté ne change plus.
    assert.equal((await api('PUT', `/api/admin/devis/${id}`, { client, lignes: [{ nom: 'X', qte: 1, prixHt: 1 }] })).statut, 409);
    assert.match(await (await formulaire(`/devis/atelier/${id}/refuser`, { jeton })).text(), /plus en attente de réponse/);
    // Paiement en ligne depuis la page du devis : montant = total du devis, puis commande payée et facturée.
    page = await fetch(lien); assert.match(await page.text(), /Payer .* en ligne/);
    const payer = await formulaire(`/devis/atelier/${id}/payer`, { jeton });
    assert.equal(payer.status, 303); const pid = payer.headers.get('location').split('/').pop();
    assert.equal(db.prepare('SELECT montant_centimes FROM paiements WHERE id = ?').get(pid).montant_centimes, Math.round(d.total * 100));
    await fetch(`${base}/paiement-simule/${pid}/confirmer`, { method: 'POST', redirect: 'manual' });
    const apres = db.prepare('SELECT statut, donnees FROM commandes WHERE id = ?').get(d.commande.id);
    assert.equal(apres.statut, 'payee'); assert.ok((await commandeApi(d.commande.id)).facture);
    assert.equal(JSON.parse(db.prepare('SELECT donnees FROM produits WHERE id = ?').get(produit).donnees).stock, 90, 'stock du catalogue ; la ligne libre n’y touche pas');
    const cfg = JSON.parse(db.prepare('SELECT config FROM boutiques').get().config); cfg.entreprise.tvaIntra = 'FR12345678901'; cfg.entreprise.siret = '12345678901234'; db.prepare('UPDATE boutiques SET config = ?').run(JSON.stringify(cfg));
    const c2 = { ...(await commandeApi(d.commande.id)), numero: 1 };
    const xml = F.produire(c2, cfg); assert.deepEqual(F.verifier(xml), []); assert.ok(xml.includes(`<ram:GrandTotalAmount>${d.total.toFixed(2)}</ram:GrandTotalAmount>`));
    assert.ok(!c2.lignes.some(l => l.type === 'drop' && !l.codeFournisseur));
    // Facture PDF d'une vente entre professionnels : numéro de TVA du client et mentions de l'art. L441-10.
    const pdf = require('../src/facturx-pdf').produire(c2, cfg, { xml });
    const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
    let texte = null; try { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-')); fs.writeFileSync(path.join(dir, 'f.pdf'), pdf); texte = execFileSync('pdftotext', [path.join(dir, 'f.pdf'), '-']).toString().replace(/\s+/g, ' '); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* sans poppler */ }
    if (texte) { assert.match(texte, /N° TVA FR99123456789/); assert.match(texte, /L441-10/); assert.match(texte, /Selon le devis DE-\d{4}-0001/); }
    assert.ok(c2.echeance > Date.now(), 'échéance de paiement fixée à l’acceptation');
  } finally { s.close(); }
});

test('refus, expiration, modification après envoi (ancien lien désactivé), annulation, duplication, droits', async () => {
  const { s, base, api, formulaire, produit } = await monter();
  try {
    const nouveau = async () => (await api('POST', '/api/admin/devis', { client, lignes: [{ produitId: produit, qte: 2 }] })).json.devis.id;
    // Refus
    let id = await nouveau(); let jeton = new URL((await api('POST', `/api/admin/devis/${id}/envoyer`)).json.lien).searchParams.get('jeton');
    assert.equal((await formulaire(`/devis/atelier/${id}/refuser`, { jeton })).status, 303);
    assert.equal((await api('GET', `/api/admin/devis/${id}`)).json.devis.statut, 'refuse');
    assert.match(await (await formulaire(`/devis/atelier/${id}/accepter`, { jeton, nom: 'X', accord: 'oui' })).text(), /plus en attente/);
    // Modification après envoi : le lien envoyé ne marche plus ; un nouvel envoi en donne un autre.
    id = await nouveau(); jeton = new URL((await api('POST', `/api/admin/devis/${id}/envoyer`)).json.lien).searchParams.get('jeton');
    assert.equal((await api('PUT', `/api/admin/devis/${id}`, { client, lignes: [{ produitId: produit, qte: 3 }] })).json.devis.statut, 'brouillon');
    assert.equal((await fetch(`${base}/devis/atelier/${id}?jeton=${jeton}`)).status, 404);
    const jeton2 = new URL((await api('POST', `/api/admin/devis/${id}/envoyer`)).json.lien).searchParams.get('jeton');
    assert.notEqual(jeton2, jeton); assert.equal((await fetch(`${base}/devis/atelier/${id}?jeton=${jeton2}`)).status, 200);
    // Annulation : lien coupé.
    assert.equal((await api('POST', `/api/admin/devis/${id}/annuler`)).json.devis.statut, 'annule');
    assert.equal((await fetch(`${base}/devis/atelier/${id}?jeton=${jeton2}`)).status, 404);
    // Duplication : nouveau numéro, brouillon.
    const copie = (await api('POST', `/api/admin/devis/${id}/dupliquer`)).json.devis;
    assert.equal(copie.statut, 'brouillon'); assert.notEqual(copie.id, id);
    // Liste
    const liste = (await api('GET', '/api/admin/devis')).json.devis;
    assert.equal(liste.length, 3); assert.ok(liste.every(x => !('lignes' in x)));
    // Sans session
    assert.equal((await fetch(`${base}/api/admin/devis`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/devis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client, lignes: [{ nom: 'X', qte: 1, prixHt: 1 }] }) })).status, 401);
  } finally { s.close(); }
});

test('expiration : un devis échu ne s’accepte plus', async () => {
  const { db, s, base, api, formulaire, produit } = await monter();
  try {
    const id = (await api('POST', '/api/admin/devis', { client, validiteJours: 1, lignes: [{ produitId: produit, qte: 1 }] })).json.devis.id;
    const jeton = new URL((await api('POST', `/api/admin/devis/${id}/envoyer`)).json.lien).searchParams.get('jeton');
    const row = db.prepare('SELECT donnees FROM devis WHERE id = ?').get(id), d = JSON.parse(row.donnees);
    d.valableJusquau = Date.now() - 1000; db.prepare('UPDATE devis SET donnees = ? WHERE id = ?').run(JSON.stringify(d), id);
    assert.equal((await api('GET', `/api/admin/devis/${id}`)).json.devis.statut, 'expire');
    assert.match(await (await fetch(`${base}/devis/atelier/${id}?jeton=${jeton}`)).text(), /a expiré/);
    assert.match(await (await formulaire(`/devis/atelier/${id}/accepter`, { jeton, nom: 'X', accord: 'oui' })).text(), /a expiré/);
  } finally { s.close(); }
});
