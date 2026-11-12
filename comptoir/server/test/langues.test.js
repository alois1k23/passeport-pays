// Commande passée en allemand : e-mails au client en allemand ; langue non proposée par la boutique : français.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('e-mails du client dans la langue de sa commande', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'de@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier Zed', pays: 'ch', secteur: 'maison', sections: [], langues: ['fr', 'de'] }, entreprise: { raison: 'Z', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 9, type: 'stock' }] });
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    const commander = async (langue, email) => { const x = await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', langue, client: { nom: 'Hans Muster', email, adresse: 'Bahnhofstrasse 1', npa: '8001', ville: 'Zürich' } }) }).then(r => r.json()); await fetch(x.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' }); return x; };
    const de = await commander('de', 'hans@exemple.ch');
    const m = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'hans@exemple.ch'").get();
    assert.equal(m.sujet, `Bestellung Nr. ${de.numero} bestätigt`); assert.match(m.corps, /Guten Tag Hans Muster/); assert.match(m.corps, /Bezahlter Betrag/);
    await commander('it', 'ugo@exemple.ch');   // italien non proposé par cette boutique
    assert.match(db.prepare("SELECT sujet FROM emails WHERE destinataire = 'ugo@exemple.ch'").get().sujet, /confirmée/);
    // Expédition en allemand
    await c('POST', `/api/admin/commandes/${de.commandeId}/statut`, { statut: 'preparation' });
    assert.equal((await c('POST', `/api/admin/commandes/${de.commandeId}/statut`, { statut: 'expediee', suivi: '99.00.123456.12345678', transporteur: 'La Poste' })).s, 200);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'hans@exemple.ch' AND sujet LIKE 'Ihre Bestellung Nr.%unterwegs'").get());
  } finally { s.close(); }
});
