// Cohérence des montants : 300 paniers aléatoires (prix décimaux, quantités, paliers, codes, seuil de port,
// offres complémentaires) calculés par le serveur et comparés au calcul de l'interface (mêmes règles partagées).
// Puis : le taux de TVA d'une commande reste figé si le régime change ensuite.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const Remises = require('../../js/remises.js');
const prix = require('../src/prix');

let serveur, base, cookie = '';
before(async () => {
  serveur = http.createServer();
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
  serveur.on('request', creerApp({ db: ouvrir(':memory:'), env: { DEMO_DELAI_EXPEDITION_MS: '-1', LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
});
after(() => serveur.close());
const appel = async (m, chemin, corps) => {
  const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => null) };
};
// Générateur pseudo-aléatoire reproductible
let graine = 42;
const alea = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };

test('300 paniers : total du serveur = calcul de l’interface, au centime', async () => {
  const produits = [12.345, 9.9, 0.05, 19.95, 49, 59.99, 99.5, 7.25].map((p, i) => ({ nom: 'P' + i, prix: p, stock: 100000, type: 'stock', cout: 2 }));
  const r = await appel('POST', '/api/auth/inscription', { email: 'calc@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Calculs', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'Calculs', regime: 'ch-assujetti' } }, produits });
  assert.equal(r.s, 201);
  const { j: { url } } = await appel('POST', '/api/abonnement/commencer', { formule: 'pro' });
  await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
  const e = await appel('GET', '/api/admin/etat');
  const ids = e.j.produits.map(p => p.id);
  assert.equal(e.j.produits.find(p => p.nom === 'P0').prix, 12.35, 'prix arrondi au centime à l’enregistrement');
  const { produits: _, commandes, serveur: __, avis, abonnes, envois, audience, offresVues, ...conf } = e.j;
  conf.offres = { ...conf.offres, paliersActifs: true, paliers: [{ qte: 3, remise: 5 }, { qte: 6, remise: 12 }], codes: [{ code: 'DIX', remise: 10 }, { code: 'VINGT', remise: 20 }], seuilPort: 60,
    regles: [{ id: 'r1', si: ids[1], alors: ids[2], remise: 30, type: 'panier', actif: true }] };
  assert.equal((await appel('PUT', '/api/admin/config', { config: conf })).s, 200);
  const config = { ...conf, entreprise: conf.entreprise };
  const modes = prix.modesLivraison(config);
  let ecarts = 0, essais = 0;
  for (let k = 0; k < 300; k++) {
    const n = 1 + Math.floor(alea() * 4);
    const lignes = Array.from({ length: n }, () => ({ produitId: ids[Math.floor(alea() * ids.length)], qte: 1 + Math.floor(alea() * 5) }));
    if (alea() < 0.3 && lignes.some(l => l.produitId === ids[1])) lignes.push({ produitId: ids[2], qte: 1, offre: 'r1' });
    const code = [undefined, 'dix', 'VINGT', ' dix '][Math.floor(alea() * 4)];
    const livraison = Object.keys(modes)[Math.floor(alea() * Object.keys(modes).length)];
    const c = await appel('POST', '/api/public/calculs/commandes', { lignes, livraison, code, client: { nom: 'Test', email: 't@exemple.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } });
    if (c.s !== 201) continue;
    essais++;
    // Calcul de l'interface : mêmes lignes que le serveur (fusion des doublons, prix du produit), mêmes règles.
    const fusion = [];
    for (const l of lignes) { const p = e.j.produits.find(x => x.id === l.produitId); const ex = !l.offre && fusion.find(f => f.produitId === l.produitId && !f.offre); if (ex) ex.qte += l.qte; else fusion.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: l.qte, ...(l.offre ? { offre: l.offre } : {}) }); }
    const calc = Remises.appliquer(fusion, config, code);
    const attendu = prix.arrondi(calc.apresRemise + prix.fraisPort(modes[livraison], calc.apresRemise, 60));
    if (Math.abs(attendu - c.j.total) > 0.001) { ecarts++; if (ecarts < 4) console.log('écart', JSON.stringify({ lignes, code, livraison, attendu, serveur: c.j.total })); }
  }
  assert.ok(essais > 250, `${essais} commandes créées`);
  assert.equal(ecarts, 0, `${ecarts} écarts entre serveur et interface`);
  // Lignes et totaux : jamais plus de 2 décimales
  const apres = await appel('GET', '/api/admin/etat');
  for (const cmd of apres.j.commandes) {
    for (const v of [cmd.total, cmd.sousTotal, cmd.remise, cmd.port, ...cmd.lignes.map(l => l.prix)]) assert.equal(Math.round(v * 100) / 100, v, `montant à plus de 2 décimales : ${v}`);
    assert.equal(cmd.tauxTva, 0.081, 'taux de TVA suisse figé dans la commande');
  }
});

test('changement de régime de TVA : les commandes passées gardent leur taux', async () => {
  const e = await appel('GET', '/api/admin/etat');
  const { produits, commandes, serveur: s, avis, abonnes, envois, audience, offresVues, ...conf } = e.j;
  conf.entreprise = { ...conf.entreprise, regime: 'ch-non' };
  assert.equal((await appel('PUT', '/api/admin/config', { config: conf })).s, 200);
  const apres = await appel('GET', '/api/admin/etat');
  assert.ok(apres.j.commandes.length > 0);
  assert.ok(apres.j.commandes.every(c => c.tauxTva === 0.081), 'taux inchangé sur les commandes existantes');
  const pid = apres.j.produits[0].id;
  const c = await appel('POST', '/api/public/calculs/commandes', { lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Test', email: 't@exemple.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } });
  assert.equal(c.s, 201);
  const fin = await appel('GET', '/api/admin/etat');
  assert.equal(fin.j.commandes.find(x => x.id === c.j.commandeId).tauxTva, 0, 'nouvelle commande au nouveau régime');
});
