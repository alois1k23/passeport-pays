// Caisse hors ligne (vente datée à l'encaissement, écart de prix signalé) et garde-fous de « Prévenez-moi ».
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

async function demarrer() {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  return { db, s, base, gerer, c };
}

test('vente hors ligne : date de l’encaissement, écart de prix signalé, pas de doublon', async () => {
  const { db, s, c } = await demarrer();
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'ca@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Marché', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'M', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Miel', prix: 12, stock: 1, type: 'stock' }] });
    assert.equal(ins.s, 201);
    const p = (await c('GET', '/api/admin/etat')).j.produits[0];
    const vendueLe = Date.now() - 3 * 86400000;
    const vente = { lignes: [{ produitId: p.id, qte: 2 }], moyen: 'especes', cle: 't_essai_1', horsLigneLe: vendueLe, totalAttendu: 20 };
    const r = await c('POST', '/api/admin/caisse', vente);
    assert.equal(r.s, 201, JSON.stringify(r.j));
    const row = db.prepare('SELECT date, donnees FROM commandes WHERE id = ?').get(r.j.id);
    assert.equal(row.date, vendueLe, 'datée au moment de la vente');
    const d = JSON.parse(row.donnees);
    assert.equal(d.dateFacture, vendueLe);
    const h = d.historique.map(x => x.texte).join(' | ');
    assert.match(h, /hors ligne/); assert.match(h, /stock insuffisant pour Miel/); assert.match(h, /montant affiché à la caisse CHF 20\.00, prix actuels CHF 24\.00/);
    assert.equal((await c('POST', '/api/admin/caisse', vente)).j.id, r.j.id, 'renvoi : même vente');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM commandes WHERE statut = 'retiree'").get().n, 1);
    // Trop ancienne (plus de 30 jours) : traitée comme une vente normale, donc contrôle du stock.
    assert.equal((await c('POST', '/api/admin/caisse', { ...vente, cle: 't_essai_2', horsLigneLe: Date.now() - 40 * 86400000 })).s, 409);
  } finally { s.close(); }
});

test('« Prévenez-moi » : refusé si disponible, variante supprimée, une boutique pleine ne bloque pas les autres', async () => {
  const { db, s, base, gerer, c } = await demarrer();
  const publier = (chemin, corps) => fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'pv@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'A', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Bol', prix: 30, stock: 3, type: 'stock' }, { nom: 'Tasse', prix: 15, stock: 0, type: 'stock' }] });
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    const bol = pub.produits.find(x => x.nom === 'Bol'), tasse = pub.produits.find(x => x.nom === 'Tasse');
    const r = await publier(`/api/public/${ins.j.slug}/produits/${bol.id}/alerte`, { email: 'victime@exemple.ch' });
    assert.equal(r.status, 409, 'article disponible : pas d’e-mail à une adresse quelconque');
    for (let i = 0; i < 7; i++) await publier(`/api/public/${ins.j.slug}/produits/${tasse.id}/alerte`, { email: 'repete@exemple.ch' });
    // Beaucoup de demandes en attente (simulées en base) avant une demande servable : elle part quand même.
    const ins2 = db.prepare('SELECT id FROM boutiques').get();
    const ajout = db.prepare("INSERT INTO alertes_stock (boutique_id, produit_id, variante_id, email, cree_le) VALUES (?, ?, '', ?, ?)");
    for (let i = 0; i < 2500; i++) ajout.run(ins2.id, tasse.id, `attente${i}@exemple.ch`, Date.now());
    db.prepare("INSERT INTO alertes_stock (boutique_id, produit_id, variante_id, email, cree_le) VALUES (?, ?, '', ?, ?)").run(ins2.id, bol.id, 'servable@exemple.ch', Date.now());
    db.prepare("INSERT INTO alertes_stock (boutique_id, produit_id, variante_id, email, cree_le) VALUES (?, ?, 'XL', ?, ?)").run(ins2.id, bol.id, 'variante@exemple.ch', Date.now());
    gerer.automatisationsEcheances(Date.now());
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'servable@exemple.ch'").get(), 'servie malgré 2500 demandes en attente');
    assert.ok(!db.prepare("SELECT 1 FROM emails WHERE destinataire = 'variante@exemple.ch'").get(), 'variante inexistante : aucun e-mail');
    assert.ok(!db.prepare("SELECT 1 FROM alertes_stock WHERE email = 'variante@exemple.ch'").get(), 'et la demande est effacée');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM alertes_stock WHERE email LIKE 'attente%'").get().n, 2500, 'les autres attendent toujours');
  } finally { s.close(); }
});
