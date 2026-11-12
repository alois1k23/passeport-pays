// « Prévenez-moi » : demande sur un produit épuisé, e-mail unique au retour en stock, adresse effacée ensuite.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('alerte de retour en stock', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'al@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Alerte', pays: 'ch', secteur: 'maison', sections: [], langues: ['fr', 'de'] }, entreprise: { raison: 'A', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 0, type: 'stock' }] });
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j, p = pub.produits[0];
    const demander = (email, langue) => fetch(`${base}/api/public/${ins.j.slug}/produits/${p.id}/alerte`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, langue }) });
    assert.equal((await demander('lea@exemple.ch')).status, 200);
    assert.equal((await demander('hans@exemple.ch', 'de')).status, 200);
    assert.equal((await demander('lea@exemple.ch')).status, 200, 'doublon accepté sans double inscription');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM alertes_stock').get().n, 2);
    assert.equal((await c('GET', '/api/admin/etat')).j.attentesStock[`${p.id}|`], 2, 'le marchand voit 2 clients en attente');
    gerer.automatisationsEcheances(Date.now());
    assert.ok(!db.prepare("SELECT 1 FROM emails WHERE sujet LIKE 'De retour%'").get(), 'rien tant que le stock est vide');
    const fiche = JSON.parse(db.prepare('SELECT donnees FROM produits').get().donnees);
    assert.equal((await c('PUT', `/api/admin/produits/${p.id}`, { produit: { ...fiche, stock: 5, stockSaisi: true } })).s, 200);
    gerer.automatisationsEcheances(Date.now());
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'lea@exemple.ch' AND sujet = 'De retour en stock : Vase'").get());
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'hans@exemple.ch' AND sujet = 'Wieder an Lager: Vase'").get(), 'dans la langue du client');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM alertes_stock').get().n, 0, 'adresses effacées après l’envoi');
    gerer.automatisationsEcheances(Date.now() + 600000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet LIKE 'De retour%'").get().n, 1, 'un seul e-mail');
  } finally { s.close(); }
});
