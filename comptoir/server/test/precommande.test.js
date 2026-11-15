// Précommandes : date d'expédition annoncée (dans l'année), reprise sur la commande et dans l'e-mail, ignorée une fois passée.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('précommande : date validée, annoncée, reprise dans la commande et l’e-mail', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  const jour = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    await c('POST', '/api/auth/inscription', { email: 'pre@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Pre', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Pre Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'pre@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const produit = extra => ({ nom: 'Calendrier 2027', prix: 25, stock: 50, precommande: true, ...extra });
    assert.equal((await c('POST', '/api/admin/produits', { produit: produit({}) })).j.code, 'precommande_date', 'date exigée');
    // Date passée : enregistré, mais sans précommande (jamais bloqué).
    const passe = (await c('POST', '/api/admin/produits', { produit: produit({ expeditionPrevue: jour(-3) }) })).j.id;
    assert.ok(passe);
    assert.equal((await c('POST', '/api/admin/produits', { produit: produit({ expeditionPrevue: jour(400) }) })).j.code, 'precommande_date', 'plus d’un an');
    const pid = (await c('POST', '/api/admin/produits', { produit: produit({ expeditionPrevue: jour(20) }) })).j.id;
    // Un produit numérique n'est jamais en précommande (livré tout de suite).
    const num = (await c('POST', '/api/admin/produits', { produit: { nom: 'Fichier', prix: 5, stock: 10, numerique: true, precommande: true, expeditionPrevue: jour(20) } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j;
    assert.equal(etat.produits.find(p => p.id === passe).precommande, undefined);
    assert.equal(etat.produits.find(p => p.id === pid).expeditionPrevue, jour(20));
    assert.equal(etat.produits.find(p => p.id === num).precommande, undefined);
    const pub = (await c('GET', `/api/public/${etat.serveur.slug}`, null, { avecCookie: false })).j.produits.find(p => p.id === pid);
    assert.equal(pub.precommande, true); assert.equal(pub.expeditionPrevue, jour(20));
    const cmd = await c('POST', `/api/public/${etat.serveur.slug}/commandes`, { lignes: [{ produitId: pid, qte: 2 }], livraison: 'poste-eco', client: { nom: 'Lou Martin', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    assert.equal(cmd.s, 201, JSON.stringify(cmd.j));
    await fetch(cmd.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const ligne = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.j.commandeId).donnees).lignes[0];
    assert.equal(ligne.precommande, jour(20));
    const date = jour(20).split('-').reverse().join('.');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'lou@exemple.ch' AND corps LIKE ?").get(`%précommande, expédition prévue le ${date}%`), 'date dans l’e-mail du client');
    // Date passée (le marchand n'a pas mis à jour la fiche) : plus annoncée, plus reportée sur les commandes.
    db.prepare("UPDATE produits SET donnees = json_set(donnees, '$.expeditionPrevue', ?) WHERE id = ?").run(jour(-1), pid);
    const cmd2 = await c('POST', `/api/public/${etat.serveur.slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Max Rey', email: 'max@exemple.ch', adresse: 'Rue 4', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    assert.equal(cmd2.s, 201);
    assert.equal(JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd2.j.commandeId).donnees).lignes[0].precommande, undefined);
    // Fiche à la date dépassée : on peut toujours changer le prix (formulaire, ou synchronisation qui renvoie tout).
    const fiche = (await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === pid);
    const maj = await c('PUT', `/api/admin/produits/${pid}`, { produit: { ...fiche, prix: 27 } });
    assert.equal(maj.s, 200, JSON.stringify(maj.j));
    assert.equal((await c('GET', '/api/admin/etat')).j.produits.find(p => p.id === pid).precommande, undefined);
  } finally { s.close(); }
});
