// Variantes : variante obligatoire, prix et stock par variante, stock rendu au remboursement.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('variantes de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'var@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Var', pays: 'ch', secteur: 'mode', sections: [] }, entreprise: { raison: 'V', adresse: 'Rue 1, 1003 Lausanne' } },
      produits: [{ nom: 'T-shirt', prix: 30, type: 'stock', options: [{ nom: 'Taille', valeurs: ['S', 'M'] }, { nom: 'Couleur', valeurs: ['Blanc', 'Noir/Mat'] }], variantes: [{ id: 'M/Noir-Mat', stock: 2, prix: 35 }, { id: 'S/Blanc', stock: 1 }] }] });
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j, p = pub.produits[0];
    assert.equal(p.variantes.length, 4, '2 × 2 combinaisons'); assert.equal(p.stock, 3, 'stock = somme des variantes');
    assert.ok(p.variantes.some(v => v.id === 'M/Noir-Mat'), 'barre oblique d’une valeur neutralisée');
    const commander = (lignes, email = 'a@x.ch') => fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes, livraison: 'poste-eco', client: { nom: 'A B', email, adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(async r => ({ s: r.status, j: await r.json() }));
    assert.equal((await commander([{ produitId: p.id, qte: 1 }])).s, 400, 'variante obligatoire');
    assert.equal((await commander([{ produitId: p.id, varianteId: 'XL/Rouge', qte: 1 }])).s, 400, 'variante inconnue');
    assert.equal((await commander([{ produitId: p.id, varianteId: 'L/Blanc', qte: 1 }])).s, 400);
    assert.equal((await commander([{ produitId: p.id, varianteId: 'S/Noir-Mat', qte: 1 }])).s, 409, 'variante sans stock');
    const cmd = await commander([{ produitId: p.id, varianteId: 'M/Noir-Mat', qte: 2 }]);
    assert.equal(cmd.s, 201, JSON.stringify(cmd.j));
    await fetch(cmd.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const apres = JSON.parse(db.prepare('SELECT donnees FROM produits').get().donnees);
    assert.equal(apres.variantes.find(v => v.id === 'M/Noir-Mat').stock, 0); assert.equal(apres.stock, 1, 'stock du produit recalculé');
    const ligne = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.j.commandeId).donnees).lignes[0];
    assert.equal(ligne.nom, 'T-shirt (M / Noir-Mat)'); assert.equal(ligne.varianteId, 'M/Noir-Mat'); assert.equal(ligne.prixInitial ?? ligne.prix, ligne.prixInitial ? 35 : ligne.prix, 'prix de la variante'); assert.ok([35, 33.25].includes(ligne.prix), 'prix de la variante (remise de volume éventuelle) : ' + ligne.prix);
    // Remboursement : la variante retrouve son stock
    assert.equal((await c('POST', `/api/admin/commandes/${cmd.j.commandeId}/statut`, { statut: 'remboursee' })).s, 200);
    assert.equal(JSON.parse(db.prepare('SELECT donnees FROM produits').get().donnees).variantes.find(v => v.id === 'M/Noir-Mat').stock, 2);
  } finally { s.close(); }
});
