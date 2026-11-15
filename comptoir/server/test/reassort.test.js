// Rappels de réassort : accord exprès du client, e-mail après N jours avec panier prêt, arrêt en un clic, effacement.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('rappel de réassort : demandé, envoyé, arrêté, effacé', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  const gerer = s.listeners('request')[0];
  const rappels = email => db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = ? AND (sujet LIKE 'Le moment de recommander%' OR sujet LIKE 'Zeit zum%') ORDER BY id").all(email);
  try {
    await c('POST', '/api/auth/inscription', { email: 're@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Torréfaction', pays: 'ch', secteur: 'epicerie', langues: ['fr', 'de'] }, entreprise: { raison: 'Torré Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 're@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Café', prix: 14, stock: 50, reassortJours: 3 } })).j.code, 'reassort_jours');
    const cafe = (await c('POST', '/api/admin/produits', { produit: { nom: 'Café en grains', prix: 14, stock: 50, reassortJours: 30 } })).j.id;
    const the = (await c('POST', '/api/admin/produits', { produit: { nom: 'Thé vert', prix: 9, stock: 50, reassortJours: 21 } })).j.id;
    const tasse = (await c('POST', '/api/admin/produits', { produit: { nom: 'Tasse', prix: 20, stock: 50 } })).j.id;
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const pub = (await c('GET', `/api/public/${slug}`, null, { avecCookie: false })).j.produits;
    assert.equal(pub.find(p => p.id === cafe).reassortJours, 30);
    const commander = async (email, extra) => {
      const r = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: cafe, qte: 2 }, { produitId: the, qte: 1 }, { produitId: tasse, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Ana Rossi', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' }, ...extra }, { avecCookie: false });
      assert.equal(r.s, 201, JSON.stringify(r.j));
      await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
      return r.j;
    };
    // Sans la case : rien.
    await commander('sans@exemple.ch', {});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 0);
    // Case cochée : un rappel, au délai le plus court (thé, 21 jours), pour les produits qui le proposent.
    await commander('ana@exemple.ch', { rappelReassort: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
    const brut = db.prepare('SELECT donnees, email_index FROM reassorts').get();
    assert.match(brut.donnees, /^v\d\./, 'chiffré au repos'); assert.ok(!brut.donnees.includes('ana@') && !brut.email_index.includes('ana@'));
    gerer.automatisationsEcheances(Date.now() + 10 * 86400000);
    assert.equal(rappels('ana@exemple.ch').length, 0, 'trop tôt');
    gerer.automatisationsEcheances(Date.now() + 22 * 86400000);
    const r1 = rappels('ana@exemple.ch');
    assert.equal(r1.length, 1);
    assert.match(r1[0].corps, /- 2 × Café en grains\n- 1 × Thé vert/);
    assert.ok(!r1[0].corps.includes('Tasse'), 'seulement les produits à rappel');
    const panier = r1[0].corps.match(/\?panier=([^\s&]+)/)[1];
    assert.equal(decodeURIComponent(panier), `${cafe}:2,${the}:1`);
    // Même passage dans l'heure : pas de doublon ; 21 jours plus tard : un deuxième rappel.
    gerer.automatisationsEcheances(Date.now() + 22 * 86400000 + 1000);
    assert.equal(rappels('ana@exemple.ch').length, 1);
    gerer.automatisationsEcheances(Date.now() + 44 * 86400000);
    assert.equal(rappels('ana@exemple.ch').length, 2);
    // Lien d'arrêt : la page demande confirmation (GET sans effet), puis POST arrête.
    const lien = r1[0].corps.match(/\/reassort\/arreter\?j=([^\s&]+)/)[1];
    const page = await fetch(`${base}/reassort/arreter?j=${lien}`);
    assert.equal(page.status, 200); assert.match(await page.text(), /Arrêter les rappels/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
    assert.equal((await fetch(`${base}/reassort/arreter?j=${lien}x`, { method: 'POST' })).status, 400, 'signature fausse');
    const fin = await fetch(`${base}/reassort/arreter?j=${lien}`, { method: 'POST' });
    assert.equal(fin.status, 200); assert.match(await fin.text(), /ne recevrez plus/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 0);
    gerer.automatisationsEcheances(Date.now() + 70 * 86400000);
    assert.equal(rappels('ana@exemple.ch').length, 2, 'plus rien après l’arrêt');
    // Commande en allemand : rappel en allemand. Effacement du client : sa demande disparaît.
    await commander('max@exemple.ch', { rappelReassort: true, langue: 'de' });
    gerer.automatisationsEcheances(Date.now() + 100 * 86400000);
    const de = rappels('max@exemple.ch');
    assert.equal(de.length, 1); assert.match(de[0].sujet, /^Zeit zum Nachbestellen bei Torréfaction\?$/); assert.match(de[0].corps, /&lang=de/);
    await commander('lou@exemple.ch', { rappelReassort: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 2);
    db.prepare("UPDATE commandes SET statut = 'livree'").run();
    // (l'entretien avancé dans le temps a effacé la session : nouvelle connexion)
    cookie = ''; await c('POST', '/api/auth/connexion', { email: 're@exemple.ch', motDePasse: 'un mot de passe solide' });
    const eff = await c('POST', '/api/admin/clients/effacer', { email: 'lou@exemple.ch' });
    assert.equal(eff.s, 200, JSON.stringify(eff.j));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
  } finally { s.close(); }
});
