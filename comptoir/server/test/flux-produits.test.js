// Flux produits (Google Merchant Center, Meta) : produits en vente, variantes groupées, gtin, précommande, échappement.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('flux produits : contenu, variantes, échappement, boutique fermée', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', FLUX_MEMO_MS: '0' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'flux@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Lin & <Co>', pays: 'ch' }, entreprise: { raison: 'Lin Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'flux@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'croissance' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    const nappe = (await c('POST', '/api/admin/produits', { produit: { nom: 'Nappe "Été" <brodée>', prix: 60, stock: 4, ean: '4006381333931', description: 'Lin\u0001 lavé', categorie: 'Table' } })).j.id;
    const ts = (await c('POST', '/api/admin/produits', { produit: { nom: 'T-shirt', prix: 30, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }], variantes: [{ id: 'S', valeurs: ['S'], stock: 0, ean: '96385074' }, { id: 'M', valeurs: ['M'], stock: 2, prix: 32 }] } })).j.id;
    const marque = (await c('POST', '/api/admin/produits', { produit: { nom: 'Thé', prix: 12, stock: 3, marque: '  Maison\u0007 du   Thé ' } })).j.id;
    const pre = (await c('POST', '/api/admin/produits', { produit: { nom: 'Calendrier', prix: 25, stock: 9, precommande: true, expeditionPrevue: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) } })).j.id;
    await c('POST', '/api/admin/produits', { produit: { nom: 'Masqué', prix: 5, stock: 9, actif: false } });
    await c('POST', '/api/admin/produits', { produit: { nom: 'Guide PDF', prix: 5, stock: 9, numerique: true } });
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const r = await fetch(`${base}/s/${slug}/produits.xml`);
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/xml/);
    const xml = await r.text();
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:g="http:\/\/base.google.com\/ns\/1.0">/);
    assert.match(xml, /<title>Lin &amp; &lt;Co&gt;<\/title>/);
    assert.match(xml, new RegExp(`<g:id>${nappe}</g:id><title>Nappe &quot;Été&quot; &lt;brodée&gt;</title><description>Lin  lavé</description>`), 'échappé, caractère de contrôle retiré');
    assert.match(xml, /<g:price>60\.00 CHF<\/g:price><g:availability>in stock<\/g:availability><g:condition>new<\/g:condition><g:brand>Lin &amp; &lt;Co&gt;<\/g:brand><g:gtin>4006381333931<\/g:gtin><g:product_type>Table<\/g:product_type>/);
    assert.match(xml, new RegExp(`<g:id>${ts}-[0-9a-f]{10}</g:id><title>T-shirt – S</title>.*?<g:availability>out of stock</g:availability>.*?<g:gtin>96385074</g:gtin><g:item_group_id>${ts}</g:item_group_id><g:size>S</g:size>`));
    // Page de la variante (lien du flux) : offre de cette variante, prix et code compris (Google compare la page et le flux).
    const pageV = await (await fetch(`${base}/s/${slug}/p/${ts}?variante=M`)).text();
    assert.match(pageV, /<meta property="product:price:amount" content="32.00">/, 'prix de la variante dans les balises aussi');
    assert.match(pageV, /"offers":\{"@type":"Offer","price":"32.00","priceCurrency":"CHF","availability":"https:\/\/schema.org\/InStock","url":"[^"]*\?variante=M"/);
    assert.match(xml, new RegExp(`<title>T-shirt – S</title><description>T-shirt</description><link>[^<]*/p/${ts}\\?variante=S</link>`), 'lien vers la variante');
    assert.match(xml, new RegExp(`<g:id>${ts}-[0-9a-f]{10}</g:id><title>T-shirt – M</title>.*?<g:price>32\\.00 CHF</g:price><g:availability>in stock</g:availability>.*?<g:identifier_exists>no</g:identifier_exists><g:item_group_id>${ts}</g:item_group_id>`));
    assert.match(xml, new RegExp(`<g:id>${pre}</g:id>.*?<g:availability>preorder</g:availability><g:availability_date>\\d{4}-\\d\\d-\\d\\dT12:00:00Z</g:availability_date>`));
    assert.doesNotMatch(xml, /Masqué|Guide PDF/, 'masqué et numérique exclus');
    assert.match(xml, new RegExp(`<g:id>${marque}</g:id>.*?<g:brand>Maison du Thé</g:brand>`), 'marque du produit, nettoyée');
    assert.match(await (await fetch(`${base}/s/${slug}/p/${marque}`)).text(), /"brand":\{"@type":"Brand","name":"Maison du Thé"\}/);
    assert.equal((xml.match(/<item>/g) || []).length, 5);
    assert.ok([...xml.matchAll(/<g:id>([^<]*)<\/g:id>/g)].every(m => m[1].length <= 50), 'identifiants de 50 caractères au plus');
    // Nom long plein d'apostrophes et d'esperluettes : coupé avant l'échappement (jamais d'entité coupée) ; émoji gardé,
    // caractères interdits en XML retirés.
    const nomLong = "L'été d'or & l'hiver d'argent ".repeat(4).slice(0, 118);
    const long = (await c('POST', '/api/admin/produits', { produit: { nom: nomLong, prix: 9, description: 'ok\ufffe fin 🎄', options: [{ nom: 'Couleur', valeurs: ["Rouge & or d'été 🎁"] }], variantes: [{ id: "Rouge & or d'été 🎁", valeurs: ["Rouge & or d'été 🎁"], stock: 2 }] } }));
    assert.equal(long.s, 201, JSON.stringify(long.j));
    const xml2 = await (await fetch(`${base}/s/${slug}/produits.xml`)).text();
    const titre = new RegExp(`<g:id>${long.j.id}-[0-9a-f]{10}</g:id><title>([^<]*)</title><description>([^<]*)</description>`).exec(xml2);
    assert.match(xml2, /<g:color>Rouge &amp; or d&#39;été 🎁<\/g:color>/, 'couleur de la variante, émoji gardé');
    assert.ok(titre, 'article présent');
    assert.doesNotMatch(titre[1], /&[a-z#0-9]*$/, 'pas d’entité coupée'); assert.match(titre[2], /^ok  fin 🎄$/);
    assert.doesNotMatch(xml2, /\ufffe/);
    // Dernier exemplaire retenu par une commande en attente de paiement : annoncé épuisé.
    const unique = (await c('POST', '/api/admin/produits', { produit: { nom: 'Pièce unique', prix: 80, stock: 1 } })).j.id;
    const enAttente = await fetch(`${base}/api/public/${slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: unique, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Lou', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }) });
    assert.equal(enAttente.status, 201, await enAttente.clone().text());
    assert.match(await (await fetch(`${base}/s/${slug}/produits.xml`)).text(), new RegExp(`<g:id>${unique}</g:id>.*?<g:availability>out of stock</g:availability>`));
    // Abonnement terminé : flux vide (pas de vitrine gratuite chez Google).
    db.prepare("UPDATE abonnements SET statut = 'resilie'").run();
    assert.equal(((await (await fetch(`${base}/s/${slug}/produits.xml`)).text()).match(/<item>/g) || []).length, 0);
    // Limite de fréquence : au-delà de 60 demandes par 10 minutes (facteur des tests : 1000), refus 429.
    assert.equal((await fetch(`${base}/s/${slug}/produits.xml`)).status, 200);
  } finally { s.close(); }
});

test('flux produits : gardé une minute en mémoire, limité à 60 demandes par 10 minutes', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'memo@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Memo', pays: 'ch' } } });
    const id = (await c('POST', '/api/admin/produits', { produit: { nom: 'Avant', prix: 5, stock: 3 } })).j.id;
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    assert.match(await (await fetch(`${base}/s/${slug}/produits.xml`)).text(), /Avant/);
    await c('PUT', `/api/admin/produits/${id}`, { produit: { nom: 'Après', prix: 5, stock: 3 } });
    assert.match(await (await fetch(`${base}/s/${slug}/produits.xml`)).text(), /Avant/, 'gardé en mémoire une minute');
    let dernier = 0;
    for (let i = 0; i < 70; i++) dernier = (await fetch(`${base}/s/${slug}/produits.xml`)).status;
    assert.equal(dernier, 200, 'réponses gardées en mémoire : jamais limitées (robots de Google et Meta)');
  } finally { s.close(); }
});

test('flux produits : 60 calculs par 10 minutes, par boutique et par adresse', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non', FLUX_MEMO_MS: '0' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const slugs = [];
  try {
    for (const nom of ['Un', 'Deux']) {
      let cookie = '';
      const r = await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${nom}@exemple.ch`, motDePasse: 'un mot de passe solide', config: { boutique: { nom } } }) });
      cookie = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
      slugs.push((await (await fetch(base + '/api/admin/etat', { headers: { Cookie: cookie } })).json()).serveur.slug);
    }
    let dernier = 0;
    for (let i = 0; i < 61; i++) dernier = (await fetch(`${base}/s/${slugs[0]}/produits.xml`)).status;
    assert.equal(dernier, 429);
    assert.equal((await fetch(`${base}/s/${slugs[1]}/produits.xml`)).status, 200, 'une autre boutique n’est pas touchée');
  } finally { s.close(); }
});
