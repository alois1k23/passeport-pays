// Facture électronique EN 16931 (XML CII) : règles arithmétiques de la norme, contrôles avant production, route.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const F = require('../src/facture-electronique');

test('totaux cohérents sur 2000 commandes aléatoires (deux taux, port, remise)', () => {
  const config = { boutique: { pays: 'fr', nom: 'E' }, entreprise: { raison: 'E SAS', adresse: '12 rue des Lilas, 75011 Paris', siret: '12345678901234', tvaIntra: 'FR12345678901' } };
  let graine = 7; const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 2000; k++) {
    const lignes = Array.from({ length: 1 + Math.floor(alea() * 4) }, (_, i) => ({ nom: `P${i}`, prix: Math.round(alea() * 9000 + 50) / 100, qte: 1 + Math.floor(alea() * 5), tauxTva: alea() < 0.4 ? 0.055 : 0.2 }));
    const st = lignes.reduce((a, l) => a + l.prix * l.qte, 0), remise = alea() < 0.5 ? Math.round(st * 10) / 100 : 0, port = alea() < 0.5 ? 6.9 : 0;
    const c = { numero: 1, facture: 'FA-1', date: Date.now(), statut: 'payee', lignes, remise, port, total: Math.round((st - remise + port) * 100) / 100, client: { nom: 'L' } };
    const xml = F.produire(c, config);
    assert.deepEqual(F.verifier(xml), [], JSON.stringify(c));
    assert.ok(xml.includes(`<ram:GrandTotalAmount>${c.total.toFixed(2)}</ram:GrandTotalAmount>`), 'total TTC = montant encaissé');
  }
  assert.equal(F.decouperAdresse('Rue du Lac 4, 1003 Lausanne').npa, '1003');
  assert.match(F.produire({ numero: 1, facture: 'FA-<1>', date: 0, statut: 'payee', lignes: [{ nom: 'A & B "C"', prix: 10, qte: 1, tauxTva: 0.2 }], total: 10, client: { nom: '<script>' } }, config), /A &amp; B &quot;C&quot;.*&lt;script&gt;/s, 'texte échappé');
});

test('route : contrôle des mentions, XML téléchargeable, avoir', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return r; };
  try {
    const conf = { boutique: { nom: 'Atelier', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Atelier SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } };
    assert.equal((await c('POST', '/api/auth/inscription', { email: 'fx@exemple.fr', motDePasse: 'un mot de passe solide', config: conf, produits: [{ nom: 'Vase', prix: 60, stock: 5, type: 'stock' }] })).status, 201);
    const etat = await (await c('GET', '/api/admin/etat')).json();
    const vente = await (await c('POST', '/api/admin/caisse', { lignes: [{ produitId: etat.produits[0].id, qte: 2 }], moyen: 'carte', cle: 't_fx' })).json();
    let r = await c('GET', `/api/admin/commandes/${vente.id}/facture-electronique`);
    assert.equal(r.status, 409); assert.match((await r.json()).erreur, /numéro de TVA/);
    const cfg = JSON.parse(db.prepare('SELECT config FROM boutiques').get().config); cfg.entreprise.tvaIntra = 'FR12345678901'; cfg.entreprise.siret = '12345678901234';
    db.prepare('UPDATE boutiques SET config = ?').run(JSON.stringify(cfg));
    r = await c('GET', `/api/admin/commandes/${vente.id}/facture-electronique`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/xml/); assert.match(r.headers.get('content-disposition'), /attachment; filename="FA-\d{4}-\d{4}\.xml"/); assert.match(r.headers.get('cache-control'), /no-store/);
    const xml = await r.text();
    assert.match(xml, /<ram:ID>urn:cen\.eu:en16931:2017<\/ram:ID>/); assert.match(xml, /<ram:TypeCode>380<\/ram:TypeCode>/);
    assert.match(xml, /<ram:BasisAmount>100\.00<\/ram:BasisAmount><ram:CategoryCode>S<\/ram:CategoryCode><ram:RateApplicablePercent>20<\/ram:RateApplicablePercent>/);
    assert.match(xml, /<ram:GrandTotalAmount>120\.00<\/ram:GrandTotalAmount><ram:TotalPrepaidAmount>120\.00<\/ram:TotalPrepaidAmount><ram:DuePayableAmount>0\.00/);
    assert.match(xml, /schemeID="0002">12345678901234/); assert.match(xml, /schemeID="VA">FR12345678901/);
    assert.equal((await c('GET', `/api/admin/commandes/${vente.id}/facture-electronique?avoir=1`)).status, 404, 'pas d’avoir');
    // Sans session : refusé.
    assert.equal((await fetch(`${base}/api/admin/commandes/${vente.id}/facture-electronique`)).status, 401);
  } finally { s.close(); }
});
