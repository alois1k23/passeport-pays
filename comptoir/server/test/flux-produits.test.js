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
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'flux@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Lin & <Co>', pays: 'ch' } } });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'croissance' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    const nappe = (await c('POST', '/api/admin/produits', { produit: { nom: 'Nappe "Été" <brodée>', prix: 60, stock: 4, ean: '4006381333931', description: 'Lin\u0001 lavé', categorie: 'Table' } })).j.id;
    const ts = (await c('POST', '/api/admin/produits', { produit: { nom: 'T-shirt', prix: 30, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }], variantes: [{ id: 'S', valeurs: ['S'], stock: 0, ean: '96385074' }, { id: 'M', valeurs: ['M'], stock: 2, prix: 32 }] } })).j.id;
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
    assert.match(xml, new RegExp(`<g:id>${ts}-S</g:id><title>T-shirt – S</title>.*?<g:availability>out of stock</g:availability>.*?<g:gtin>96385074</g:gtin><g:item_group_id>${ts}</g:item_group_id>`));
    assert.match(xml, new RegExp(`<g:id>${ts}-M</g:id>.*?<g:price>32\\.00 CHF</g:price><g:availability>in stock</g:availability>.*?<g:identifier_exists>no</g:identifier_exists><g:item_group_id>${ts}</g:item_group_id>`));
    assert.match(xml, new RegExp(`<g:id>${pre}</g:id>.*?<g:availability>preorder</g:availability><g:availability_date>\\d{4}-\\d\\d-\\d\\dT12:00:00Z</g:availability_date>`));
    assert.doesNotMatch(xml, /Masqué|Guide PDF/, 'masqué et numérique exclus');
    assert.equal((xml.match(/<item>/g) || []).length, 4);
    // Abonnement terminé : flux vide (pas de vitrine gratuite chez Google).
    db.prepare("UPDATE abonnements SET statut = 'resilie'").run();
    assert.equal(((await (await fetch(`${base}/s/${slug}/produits.xml`)).text()).match(/<item>/g) || []).length, 0);
  } finally { s.close(); }
});
