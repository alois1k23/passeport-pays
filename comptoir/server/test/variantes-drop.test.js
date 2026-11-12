// Variantes sur un produit en dropshipping : pas de stock propre, référence fournisseur par variante transmise avec la commande.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('dropshipping à variantes : commande et transmission au fournisseur', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'vd@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Mode', pays: 'ch', secteur: 'mode', sections: [] }, entreprise: { raison: 'M', adresse: 'Rue 1, 1003 Lausanne' }, reglages: { autoTransmission: true } },
      produits: [{ nom: 'T-shirt', prix: 30, type: 'drop', source: 'f01', codeFournisseur: 'demo', actif: true, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }, { nom: 'Couleur', valeurs: ['Noir'] }], variantes: [{ id: 'S/Noir', ref: 'TS-S-BLK\u0007' }, { id: 'M/Noir', ref: 'TS-M-BLK', prix: 32 }] }] });
    assert.equal(ins.s, 201, JSON.stringify(ins.j));
    const prod = (await c('GET', '/api/admin/etat')).j.produits[0];
    assert.equal(prod.type, 'drop'); assert.equal(prod.variantes.length, 2);
    assert.deepEqual(prod.variantes.map(v => [v.id, v.ref, v.stock]), [['S/Noir', 'TS-S-BLK', 999], ['M/Noir', 'TS-M-BLK', 999]], 'référence nettoyée, pas de stock propre');
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j.produits[0];
    // Sans variante : refusé ; avec : prix de la variante, sans contrôle de stock (stock du fournisseur).
    const commander = varianteId => fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.id, qte: 1, ...(varianteId ? { varianteId } : {}) }], livraison: 'poste-eco', client: { nom: 'Léa Martin', email: 'lea@exemple.ch', adresse: 'Rue 2', npa: '1004', ville: 'Lausanne' } }) });
    assert.equal((await commander()).status, 400);
    const cmd = await (await commander('M/Noir')).json();
    assert.ok(cmd.paiementUrl, JSON.stringify(cmd));
    assert.equal(JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.commandeId).donnees).lignes[0].prix, 32, 'prix de la variante');
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    await new Promise(r => setTimeout(r, 300));
    const envoi = db.prepare('SELECT donnees FROM demo_fournisseur_commandes').get();
    assert.ok(envoi, JSON.stringify(JSON.parse(db.prepare('SELECT donnees FROM commandes').get().donnees).historique));
    const ligne = JSON.parse(envoi.donnees).lignes[0];
    assert.deepEqual(ligne.variante, { id: 'M/Noir', valeurs: ['M', 'Noir'], ref: 'TS-M-BLK' });
    assert.equal(ligne.qte, 1);
    // API : stock null pour un produit du fournisseur, référence exposée.
    const prodApi = (await c('GET', '/api/admin/etat')).j.produits[0];
    assert.equal(prodApi.variantes[1].stock, 999, 'stock du fournisseur inchangé (pas décompté)');
  } finally { s.close(); }
});
