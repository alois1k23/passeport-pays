'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('compléments : choix du marchand, puis achats groupés à partir de 3 commandes, seulement des produits en vente', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, avecCookie = true) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'co@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Café', pays: 'ch' }, entreprise: { raison: 'Café Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'co@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const id = async (nom, extra = {}) => (await c('POST', '/api/admin/produits', { produit: { nom, prix: 10, stock: 100, ...extra } })).j.id;
    const cafe = await id('Café'), tasse = await id('Tasse'), filtre = await id('Filtres'), sucre = await id('Sucre'), cache = await id('Caché', { actif: false });
    // Choix du marchand : nettoyé (soi-même, doublons, identifiants invalides), 3 au plus.
    const etat = (await c('GET', '/api/admin/etat')).j, prod = etat.produits.find(x => x.id === cafe);
    await c('PUT', `/api/admin/produits/${cafe}`, { produit: { ...prod, complements: [cafe, tasse, tasse, '<x>', cache, filtre, sucre] } });
    const stocke = (await c('GET', '/api/admin/etat')).j.produits.find(x => x.id === cafe).complements;
    assert.deepEqual(stocke, [tasse, cache, filtre], 'sans soi-même, sans doublon ni identifiant invalide, 3 au plus');
    const slug = etat.serveur.slug;
    const pub = async () => Object.fromEntries((await c('GET', `/api/public/${slug}`, null, false)).j.produits.map(p => [p.id, p.complements]));
    let p = await pub();
    assert.deepEqual(p[cafe], [tasse, filtre], 'le produit masqué est retiré');
    assert.equal(p[sucre], undefined, 'pas encore d’achats groupés');
    // Achats groupés : sucre + tasse dans 2 commandes payées : pas assez ; une 3e : la paire apparaît.
    const commander = async () => {
      const r = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: sucre, qte: 1 }, { produitId: tasse, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Ana Rossi', email: 'ana@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, false);
      await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST' });
    };
    await commander(); await commander();
    // Une commande non payée ne compte pas.
    await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: sucre, qte: 1 }, { produitId: tasse, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Bo', email: 'bo@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, false);
    const neuve = () => { s.removeAllListeners('request'); s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } })); };
    neuve();   // le calcul est gardé 10 minutes : une nouvelle application relit la base
    assert.equal((await pub())[sucre], undefined, '2 commandes payées (et une impayée) : rien n’est publié');
    await commander();
    neuve();
    p = await pub();
    assert.deepEqual(p[sucre], [tasse], '3 commandes payées : la paire est publiée');
    assert.deepEqual(p[tasse], [sucre], 'dans les deux sens');
    assert.deepEqual(p[cafe], [tasse, filtre], 'le choix du marchand reste en tête');
  } finally { s.close(); }
});
