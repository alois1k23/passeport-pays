// Lots et coffrets : stock calculé depuis les composants (masqués compris), composants décomptés à la vente, rendus
// exactement (retour partiel puis remboursement), panier mixte borné, compositions refusées.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('lot de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  const stock = id => JSON.parse(db.prepare('SELECT donnees FROM produits WHERE id = ?').get(id).donnees).stock;
  try {
    await c('POST', '/api/auth/inscription', { email: 'lot@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Lot', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Lot Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'lot@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const creer = async p => (await c('POST', '/api/admin/produits', { produit: p })).j;
    const savon = (await creer({ nom: 'Savon', prix: 8, stock: 10 })).id;
    const bougie = (await creer({ nom: 'Bougie', prix: 20, stock: 4, actif: false })).id;   // vendue seulement dans le coffret
    const tee = (await creer({ nom: 'T-shirt', prix: 30, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }], variantes: [{ id: 'S', stock: 3 }, { id: 'M', stock: 3 }] })).id;
    // Compositions refusées.
    assert.equal((await creer({ nom: 'X', prix: 1, composants: [{ produitId: savon, qte: 1 }] })).code, 'lot_invalide', 'un seul produit');
    assert.equal((await creer({ nom: 'X', prix: 1, composants: [{ produitId: savon, qte: 1 }, { produitId: tee, qte: 1 }] })).code, 'lot_composant', 'produit à variantes');
    assert.equal((await creer({ nom: 'X', prix: 1, composants: [{ produitId: savon, qte: 1 }, { produitId: 'p_inexistant', qte: 1 }] })).code, 'lot_composant');
    assert.equal((await creer({ nom: 'X', prix: 1, composants: [{ produitId: savon, qte: 0 }, { produitId: bougie, qte: 1 }] })).code, 'lot_invalide', 'quantité 0');
    const coffret = (await creer({ nom: 'Coffret bien-être', prix: 32, stock: 999, composants: [{ produitId: savon, qte: 2 }, { produitId: bougie, qte: 1 }] })).id;
    assert.equal((await creer({ nom: 'Lot de lots', prix: 1, composants: [{ produitId: coffret, qte: 1 }, { produitId: savon, qte: 1 }] })).code, 'lot_composant', 'pas de lot dans un lot');
    // Stock calculé : min(10 / 2, 4 / 1) = 4 (le stock saisi est ignoré).
    const etat = (await c('GET', '/api/admin/etat')).j;
    assert.equal(etat.produits.find(p => p.id === coffret).stock, 4);
    const pub = (await c('GET', `/api/public/${etat.serveur.slug}`, null, { avecCookie: false })).j;
    const pc = pub.produits.find(p => p.id === coffret);
    assert.equal(pc.stock, 4); assert.deepEqual(pc.contenu, [{ nom: 'Savon', qte: 2 }, { nom: 'Bougie', qte: 1 }]);
    assert.equal(pc.composants, undefined, 'identifiants des composants non publiés');
    assert.ok(!pub.produits.some(p => p.id === bougie), 'composant masqué : pas en vente seul');
    const commander = (lignes, email) => c('POST', `/api/public/${etat.serveur.slug}/commandes`, { lignes, livraison: 'poste-eco', client: { nom: 'Ana Rey', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    // Panier mixte : 3 coffrets (6 savons) + 5 savons = 11 > 10 : refusé.
    assert.equal((await commander([{ produitId: coffret, qte: 3 }, { produitId: savon, qte: 5 }], 'a@exemple.ch')).j.code, 'stock_insuffisant');
    // Vente de 2 coffrets : 4 savons et 2 bougies décomptés.
    const cmd = await commander([{ produitId: coffret, qte: 2 }], 'b@exemple.ch');
    assert.equal(cmd.s, 201, JSON.stringify(cmd.j));
    // Pendant le paiement, le coffret retient ses composants : un autre client ne peut pas prendre 3 bougies.
    assert.equal((await commander([{ produitId: coffret, qte: 3 }], 'c@exemple.ch')).j.code, 'stock_insuffisant');
    await fetch(cmd.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.equal(stock(savon), 6); assert.equal(stock(bougie), 2);
    assert.equal((await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === coffret).stock, 2);
    // Retour partiel d'un coffret, puis remboursement du reste : rendus exactement, jamais deux fois.
    const rp = `/api/admin/commandes/${cmd.j.commandeId}/retour-partiel`;
    const ap = await c('POST', rp, { lignes: [{ index: 0, qte: 1 }], apercu: true, stock: true });
    assert.equal(ap.s, 200, JSON.stringify(ap.j));
    const r1 = await c('POST', rp, { lignes: [{ index: 0, qte: 1 }], stock: true, attendu: { rang: ap.j.apercu.rang, montant: ap.j.apercu.montant } });
    assert.equal(r1.s, 200, JSON.stringify(r1.j));
    assert.equal(stock(savon), 8); assert.equal(stock(bougie), 3);
    const rb = await c('POST', `/api/admin/commandes/${cmd.j.commandeId}/statut`, { statut: 'remboursee' });
    assert.equal(rb.s, 200, JSON.stringify(rb.j));
    assert.equal(stock(savon), 10); assert.equal(stock(bougie), 4);
  } finally { s.close(); }
});
