'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('modification groupée : prix en %, prix fixé, prix barré, catégorie, masquage ; tout ou rien', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'g@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Groupe', pays: 'ch' } } });
    const id = async p => (await c('POST', '/api/admin/produits', { produit: { stock: 5, ...p } })).j.id;
    const a = await id({ nom: 'Pull', prix: 80 });
    const b = await id({ nom: 'T-shirt', prix: 30, options: [{ nom: 'Taille', valeurs: ['S', 'XL'] }], variantes: [{ id: 'S', valeurs: ['S'], stock: 2 }, { id: 'XL', valeurs: ['XL'], stock: 1, prix: 34 }] });
    const cher = await id({ nom: 'Montre', prix: 50000 });
    const P = async () => Object.fromEntries((await c('GET', '/api/admin/etat')).j.produits.map(p => [p.id, p]));
    const g = corps => c('POST', '/api/admin/produits/groupe', corps);
    // Validation.
    assert.equal((await g({ ids: [], action: 'pourcent', valeur: -10 })).s, 400);
    assert.equal((await g({ ids: [a], action: 'pourcent', valeur: -95 })).s, 400);
    assert.equal((await g({ ids: [a], action: 'pourcent', valeur: 0 })).s, 400);
    assert.equal((await g({ ids: [a], action: 'supprimer' })).s, 400);
    assert.equal((await g({ ids: new Array(501).fill(a), action: 'masquer' })).s, 400);
    // -25 % avec ancien prix barré : prix des variantes aussi.
    let r = await g({ ids: [a, b, 'inconnu'], action: 'pourcent', valeur: -25, barrer: true });
    assert.equal(r.s, 200); assert.equal(r.j.modifies, 2, 'identifiant inconnu ignoré');
    let p = await P();
    assert.equal(p[a].prix, 60); assert.equal(p[a].prixReference, 80);
    assert.equal(p[b].prix, 22.5); assert.equal(p[b].variantes.find(v => v.id === 'XL').prix, 25.5);
    assert.equal(p[a].stock, 5, 'stock inchangé');
    // Prix barré non licite (pas 30 jours) : absent de la boutique publique.
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const pub = (await (await fetch(`${base}/api/public/${slug}`)).json()).produits.find(x => x.id === a);
    assert.ok(!pub.prixReference && !pub.prixBarre, 'prix barré non affiché sans 30 jours de pratique');
    // Hausse : le prix barré devenu inférieur est retiré.
    await g({ ids: [a], action: 'pourcent', valeur: 50 });
    p = await P(); assert.equal(p[a].prix, 90); assert.equal(p[a].prixReference, undefined);
    // Prix fixé : les prix propres des variantes sont retirés.
    await g({ ids: [b], action: 'prix', valeur: 19.9 });
    p = await P(); assert.equal(p[b].prix, 19.9); assert.ok(p[b].variantes.every(v => v.prix === undefined));
    // Catégorie et masquage.
    await g({ ids: [a, b], action: 'categorie', valeur: '  Hiver ' });
    await g({ ids: [b], action: 'masquer' });
    p = await P(); assert.equal(p[a].categorie, 'Hiver'); assert.equal(p[b].categorie, 'Hiver'); assert.equal(p[b].actif, false); assert.equal(p[a].actif, true);
    // Tout ou rien : +500 % fait dépasser le plafond de prix à un produit ; rien n'est appliqué, le produit est nommé.
    r = await g({ ids: [a, cher], action: 'pourcent', valeur: 500 });
    assert.equal(r.s, 400, 'prix au-delà du plafond refusé'); assert.match(r.j.erreur, /« Montre »/, 'le produit fautif est nommé');
    p = await P(); assert.equal(p[a].prix, 90, 'rien n’a été appliqué');
  } finally { s.close(); }
});
