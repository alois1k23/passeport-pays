// Inventaire : comptes appliqués d'un bloc, conflit si une vente a changé le stock pendant le comptage, articles sans stock refusés.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('inventaire : application, conflit, forcer, refus', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'inv@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Inv', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Inv Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'inv@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const a = (await c('POST', '/api/admin/produits', { produit: { nom: 'Bougie', prix: 24, stock: 10 } })).j.id;
    const t = (await c('POST', '/api/admin/produits', { produit: { nom: 'T-shirt', prix: 30, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }], variantes: [{ id: 'S', valeurs: ['S'], stock: 4 }, { id: 'M', valeurs: ['M'], stock: 6 }] } })).j.id;
    const num = (await c('POST', '/api/admin/produits', { produit: { nom: 'PDF', prix: 5, stock: 99, numerique: true } })).j.id;
    const stock = async () => { const e = (await c('GET', '/api/admin/etat')).j.produits; const p = e.find(x => x.id === a), q = e.find(x => x.id === t); return { a: p.stock, s: q.variantes.find(v => v.id === 'S').stock, m: q.variantes.find(v => v.id === 'M').stock, t: q.stock }; };
    // Refus : article sans stock propre, variante manquante, quantité invalide.
    assert.equal((await c('POST', '/api/admin/inventaire', { lignes: [{ produitId: num, compte: 1, stockVu: 99 }] })).j.code, 'inventaire_article');
    assert.equal((await c('POST', '/api/admin/inventaire', { lignes: [{ produitId: t, compte: 1, stockVu: 10 }] })).j.code, 'inventaire_variante');
    assert.equal((await c('POST', '/api/admin/inventaire', { lignes: [{ produitId: a, compte: -2, stockVu: 10 }] })).j.code, 'inventaire_qte');
    // Une vente pendant le comptage : conflit, rien n'est appliqué (tout ou rien).
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const cmd = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: a, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Ana', email: 'ana@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    await fetch(cmd.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.equal((await stock()).a, 9);
    const lignes = [{ produitId: a, compte: 8, stockVu: 10 }, { produitId: t, varianteId: 'S', compte: 3, stockVu: 4 }];
    const conflit = await c('POST', '/api/admin/inventaire', { lignes });
    assert.equal(conflit.s, 409); assert.equal(conflit.j.code, 'inventaire_conflit');
    assert.deepEqual(conflit.j.conflits.map(x => [x.nom, x.stockVu, x.actuel, x.compte]), [['Bougie', 10, 9, 8]]);
    assert.deepEqual(await stock(), { a: 9, s: 4, m: 6, t: 10 }, 'rien appliqué');
    // Forcer : le comptage fait foi, moins la bougie vendue (payée) mais encore en rayon ; le total des variantes suit.
    const ok = await c('POST', '/api/admin/inventaire', { lignes, forcer: true });
    assert.equal(ok.s, 200, JSON.stringify(ok.j)); assert.equal(ok.j.appliques, 2); assert.equal(ok.j.ecarts.length, 2);
    assert.deepEqual(await stock(), { a: 7, s: 3, m: 6, t: 9 });
    assert.deepEqual((await c('GET', '/api/admin/inventaire/engages')).j.engages, { [`${a}|`]: 1 });
    // Sans vente entre-temps : appliqué directement ; noté dans l'activité du compte.
    assert.equal((await c('POST', '/api/admin/inventaire', { lignes: [{ produitId: t, varianteId: 'M', compte: 7, stockVu: 6 }] })).s, 200);
    assert.deepEqual(await stock(), { a: 7, s: 3, m: 7, t: 10 });
    // Commande expédiée : la bougie a quitté le rayon, plus rien n'est retenu.
    db.prepare("UPDATE commandes SET statut = 'expediee'").run();
    assert.deepEqual((await c('GET', '/api/admin/inventaire/engages')).j.engages, {});
    assert.equal((await c('POST', '/api/admin/inventaire', { lignes: Array.from({ length: 10001 }, () => ({ produitId: a, compte: 1, stockVu: 7 })) })).j.code, 'inventaire_trop');
    assert.ok(db.prepare("SELECT 1 FROM journal_compte WHERE type = 'inventaire'").get());
  } finally { s.close(); }
});
