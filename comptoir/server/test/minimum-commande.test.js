'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('commande minimum : refusée en dessous (livraison), retrait dispensé sauf réglage, publiée pour la boutique', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, avec = true) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie && avec ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avec) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'm@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Fleurs', pays: 'ch' }, magasin: { clickCollect: true, adresse: 'Rue 2, 1003 Lausanne' }, entreprise: { raison: 'F Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'm@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const rose = (await c('POST', '/api/admin/produits', { produit: { nom: 'Rose', prix: 8, stock: 100 } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j, slug = etat.serveur.slug;
    const cfg = { boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, livraisons: etat.livraisons, offres: etat.offres, reglages: { ...etat.reglages, minimumCommande: 30 } };
    const put = await c('PUT', '/api/admin/config', { config: cfg }); assert.equal(put.s, 200, JSON.stringify(put.j));
    const pub = async () => (await c('GET', `/api/public/${slug}`, null, false)).j;
    assert.deepEqual((await pub()).minimum, { montant: 30, retrait: false });
    const commander = (qte, livraison) => c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: rose, qte }], livraison, client: { nom: 'Ana', email: 'ana@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, false);
    let r = await commander(3, 'poste-eco');
    assert.equal(r.s, 400); assert.equal(r.j.code, 'minimum_commande'); assert.match(r.j.erreur, /CHF 30\.00 d’articles \(sauf retrait en magasin\)/);
    // 4 roses = 32 CHF, mais -10 % dès 3 articles (palier par défaut) : 28.80, encore en dessous ; 5 roses : 36 CHF.
    assert.equal((await commander(4, 'poste-eco')).j.code, 'minimum_commande', 'après remise de quantité');
    r = await commander(5, 'poste-eco'); assert.ok(r.j.commandeId, JSON.stringify(r.j));
    assert.ok((await commander(1, 'retrait')).j.commandeId, 'retrait dispensé');
    cfg.reglages = { ...cfg.reglages, minimumRetrait: true };
    await c('PUT', '/api/admin/config', { config: cfg });
    assert.equal((await commander(1, 'retrait')).j.code, 'minimum_commande', 'retrait soumis au minimum');
    // Valeur nettoyée : bornée à 1000, arrondie ; 0 = aucun.
    cfg.reglages = { ...cfg.reglages, minimumCommande: 99999 }; await c('PUT', '/api/admin/config', { config: cfg });
    assert.equal((await pub()).minimum.montant, 1000);
    cfg.reglages = { ...cfg.reglages, minimumCommande: 0 }; await c('PUT', '/api/admin/config', { config: cfg });
    assert.equal((await pub()).minimum, null);
    assert.ok((await commander(1, 'poste-eco')).j.commandeId, 'plus de minimum');
  } finally { s.close(); }
});
