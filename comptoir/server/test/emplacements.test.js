// Stock sur plusieurs emplacements : initialisation, ordre de prélèvement par canal, retours, corrections,
// transferts, contrôle « somme des emplacements = stock de la fiche ».
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ouvrir } = require('../src/db');
const Emp = require('../src/emplacements');

test('module : répartition, ventes par canal, retours, transferts, corrections, contrôle', () => {
  const db = ouvrir(':memory:'), E = Emp.creer(db);
  const produits = [{ id: 'p1', stock: 10 }, { id: 'p2', stock: 0, variantes: [{ id: 'v1', stock: 4 }, { id: 'v2', stock: 2 }] }, { id: 'p3', type: 'drop', stock: 999 }];
  assert.equal(E.actif('b'), false);
  assert.deepEqual(E.retirer('b', 'p1', '', 3), {}, 'sans emplacement : rien');
  const ent = E.creer('b', { nom: 'Entrepôt Lyon', type: 'entrepot' }, produits);
  const mag = E.creer('b', { nom: 'Boutique Croix-Rousse', type: 'magasin' }, produits);
  assert.throws(() => E.creer('b', { nom: 'entrepôt lyon', type: 'entrepot' }, produits), /déjà ce nom/);
  assert.throws(() => E.creer('b', { nom: 'X', type: 'cave' }, produits), /Type/);
  let rep = E.repartition('b');
  assert.deepEqual(rep.p1[''], { [ent.id]: 10 }, 'le premier emplacement reçoit tout le stock');
  assert.deepEqual(rep.p2, { v1: { [ent.id]: 4 }, v2: { [ent.id]: 2 } });
  assert.equal(rep.p3, undefined, 'dropshipping : pas de stock à répartir');
  // Transfert de 4 vases au magasin.
  E.transferer('b', { produitId: 'p1', varianteId: '', de: ent.id, vers: mag.id, quantite: 4 });
  assert.throws(() => E.transferer('b', { produitId: 'p1', varianteId: '', de: mag.id, vers: ent.id, quantite: 5 }), /Seulement 4/);
  assert.throws(() => E.transferer('b', { produitId: 'p1', varianteId: '', de: mag.id, vers: mag.id, quantite: 1 }), /différents/);
  // Caisse : prend au magasin d'abord ; en ligne : à l'entrepôt d'abord.
  assert.deepEqual(E.retirer('b', 'p1', '', 5, { canal: 'magasin' }), { [mag.id]: 4, [ent.id]: 1 });
  produits[0].stock = 5;
  const pris = E.retirer('b', 'p1', '', 2, { canal: 'web' }); assert.deepEqual(pris, { [ent.id]: 2 });
  produits[0].stock = 3;
  assert.deepEqual(E.verifier('b', produits), []);
  // Retour : là d'où ça venait.
  E.remettre('b', 'p1', '', 2, pris); produits[0].stock = 5;
  assert.equal(E.repartition('b').p1[''][ent.id], 5);
  // Correction depuis la fiche : +3 au principal, puis −6 (principal d'abord).
  E.ajusterTotal('b', 'p1', '', 3); produits[0].stock = 8;
  E.ajusterTotal('b', 'p1', '', -6); produits[0].stock = 2;
  assert.deepEqual(E.verifier('b', produits), []);
  // Écart détecté.
  produits[0].stock = 3;
  assert.deepEqual(E.verifier('b', produits), [{ produitId: 'p1', varianteId: null, fiche: 3, emplacements: 2 }]);
  // Suppression : seulement vide ; le principal en dernier.
  assert.throws(() => E.supprimer('b', ent.id), /contient encore|principal/);
  E.supprimer('b', mag.id);
  assert.equal(E.lister('b').length, 1);
  assert.ok(E.mouvements('b').some(m => m.type === 'transfert'));
});

test('serveur : emplacements, transfert, caisse au magasin, vente en ligne à l’entrepôt, remboursement, fiche corrigée', async () => {
  const http = require('node:http');
  const { creerApp } = require('../src/app');
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const appel = async (m, chemin, corps, session = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && session ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length && session) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  try {
    await appel('POST', '/api/auth/inscription', { email: 'emp@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Emp', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'E SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [{ nom: 'Vase', prix: 40, stock: 10, type: 'stock' }] });
    const etat = (await appel('GET', '/api/admin/etat')).json, produit = etat.produits[0].id, slug = db.prepare('SELECT slug FROM boutiques').get().slug;
    const ent = (await appel('POST', '/api/admin/emplacements', { nom: 'Entrepôt', type: 'entrepot' })).json.emplacement;
    const mag = (await appel('POST', '/api/admin/emplacements', { nom: 'Boutique', type: 'magasin' })).json.emplacement;
    const rep = async () => (await appel('GET', '/api/admin/emplacements')).json;
    assert.deepEqual((await rep()).repartition[produit][''], { [ent.id]: 10 });
    assert.equal((await appel('POST', '/api/admin/emplacements/transferts', { produitId: produit, de: ent.id, vers: mag.id, quantite: 3 })).statut, 200);
    assert.equal((await appel('POST', '/api/admin/emplacements/transferts', { produitId: produit, de: mag.id, vers: ent.id, quantite: 9 })).statut, 409);
    // Caisse : au magasin.
    assert.equal((await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: produit, qte: 2 }], moyen: 'carte', cle: 'e1' })).statut, 201);
    let r = await rep(); assert.deepEqual(r.repartition[produit][''], { [ent.id]: 7, [mag.id]: 1 });
    // En ligne : à l'entrepôt ; remboursement : remis à l'entrepôt.
    const cmd = await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 2 }], livraison: 'colissimo', client: { nom: 'L', email: 'l@exemple.fr', adresse: 'R 1', npa: '69002', ville: 'Lyon' } }, false);
    await appel('POST', `/paiement-simule/${cmd.json.paiementUrl.split('/').pop()}/confirmer`, null, false);
    r = await rep(); assert.deepEqual(r.repartition[produit][''], { [ent.id]: 5, [mag.id]: 1 });
    assert.equal((await appel('POST', `/api/admin/commandes/${cmd.json.commandeId}/statut`, { statut: 'remboursee' })).statut, 200);
    r = await rep(); assert.deepEqual(r.repartition[produit][''], { [ent.id]: 7, [mag.id]: 1 });
    // Fiche produit corrigée (inventaire) : l'écart va à l'emplacement principal.
    const p = (await appel('GET', '/api/admin/etat')).json.produits[0];
    assert.equal((await appel('PUT', `/api/admin/produits/${produit}`, { produit: { ...p, stock: 12, stockSaisi: true } })).statut, 200);
    r = await rep(); assert.deepEqual(r.repartition[produit][''], { [ent.id]: 11, [mag.id]: 1 }); assert.deepEqual(r.ecarts, []);
    // Suppression : refusée tant que l'emplacement contient du stock.
    assert.equal((await appel('DELETE', `/api/admin/emplacements/${mag.id}`)).statut, 409);
    assert.equal((await appel('GET', '/api/admin/emplacements', null, false)).statut, 401);
  } finally { s.close(); }
});

test('relecture : remboursement d’un ticket au bon endroit, variantes disparues, produit supprimé', async () => {
  const http = require('node:http');
  const { creerApp } = require('../src/app');
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const appel = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); let json = null; try { json = await r.json(); } catch { /* vide */ } return { statut: r.status, json }; };
  try {
    await appel('POST', '/api/auth/inscription', { email: 'emp2@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Emp2', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'E SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } }, produits: [{ nom: 'Vase', prix: 40, stock: 10, type: 'stock' }, { nom: 'Pull', prix: 50, stock: 0, type: 'stock', options: [{ nom: 'Taille', valeurs: ['M', 'L'] }], variantes: [{ id: 'M', valeurs: ['M'], stock: 4 }, { id: 'L', valeurs: ['L'], stock: 2 }] }] });
    const produits = (await appel('GET', '/api/admin/etat')).json.produits, vase = produits.find(p => p.nom === 'Vase'), pull = produits.find(p => p.nom === 'Pull');
    const ent = (await appel('POST', '/api/admin/emplacements', { nom: 'Entrepôt', type: 'entrepot' })).json.emplacement;
    const mag = (await appel('POST', '/api/admin/emplacements', { nom: 'Boutique', type: 'magasin' })).json.emplacement;
    await appel('POST', '/api/admin/emplacements/transferts', { produitId: vase.id, de: ent.id, vers: mag.id, quantite: 5 });
    const rep = async () => (await appel('GET', '/api/admin/emplacements')).json;
    // Ticket de caisse remboursé : les articles reviennent au magasin.
    const t = await appel('POST', '/api/admin/caisse', { lignes: [{ produitId: vase.id, qte: 2 }], moyen: 'carte', cle: 'r1' });
    assert.deepEqual((await rep()).repartition[vase.id][''], { [ent.id]: 5, [mag.id]: 3 });
    assert.equal((await appel('POST', `/api/admin/commandes/${t.json.id}/statut`, { statut: 'remboursee' })).statut, 200);
    assert.deepEqual((await rep()).repartition[vase.id][''], { [ent.id]: 5, [mag.id]: 5 }, 'revenus au magasin');
    // Variante renommée : plus de ligne orpheline, aucun écart.
    const p2 = (await appel('GET', '/api/admin/etat')).json.produits.find(p => p.id === pull.id);
    assert.equal((await appel('PUT', `/api/admin/produits/${pull.id}`, { produit: { ...p2, options: [{ nom: 'Taille', valeurs: ['Medium', 'L'] }] } })).statut, 200);
    let r = await rep();
    assert.deepEqual(r.ecarts, []); assert.equal(Object.keys(r.repartition[pull.id]).includes('M'), false, 'ancienne variante retirée'); assert.ok(r.repartition[pull.id].Medium, 'nouvelle variante répartie');
    // Produit supprimé : ses articles ne bloquent plus l'emplacement.
    await appel('POST', '/api/admin/emplacements/transferts', { produitId: pull.id, varianteId: 'L', de: ent.id, vers: mag.id, quantite: 2 });
    assert.equal((await appel('DELETE', `/api/admin/produits/${pull.id}`)).statut, 200);
    assert.equal((await appel('DELETE', `/api/admin/produits/${vase.id}`)).statut, 200);
    assert.equal((await appel('DELETE', `/api/admin/emplacements/${mag.id}`)).statut, 200, 'emplacement vide après suppression des produits');
  } finally { s.close(); }
});
