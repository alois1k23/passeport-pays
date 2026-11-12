// Journal inaltérable : pièces scellées (ticket, facture, avoir), clôture journalière, falsifications détectées.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('journal inaltérable des ventes', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null), r }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'ji@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Marché', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'M', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Miel', prix: 12, stock: 50, type: 'stock' }] });
    const p = (await c('GET', '/api/admin/etat')).j.produits[0];
    const t1 = (await c('POST', '/api/admin/caisse', { lignes: [{ produitId: p.id, qte: 2 }], moyen: 'carte', cle: 'j1' })).j;
    const t2 = (await c('POST', '/api/admin/caisse', { lignes: [{ produitId: p.id, qte: 1 }], moyen: 'twint', cle: 'j2' })).j;
    let etat = (await c('GET', '/api/admin/journal-inalterable')).j;
    assert.equal(etat.ok, true); assert.equal(etat.pieces, 2); assert.match(etat.empreinte, /^[0-9a-f]{64}$/);
    // Remboursement : un avoir scellé, négatif.
    assert.equal((await c('POST', `/api/admin/commandes/${t2.id}/statut`, { statut: 'remboursee' })).s, 200);
    etat = (await c('GET', '/api/admin/journal-inalterable')).j;
    assert.equal(etat.pieces, 3); assert.equal(etat.ok, true, JSON.stringify(etat.anomalies));
    // Clôture des jours terminés : demain, la journée d'aujourd'hui est clôturée avec le grand total perpétuel.
    gerer.automatisationsEcheances(Date.now() + 86400000);
    gerer.automatisationsEcheances(Date.now() + 86400000);   // une seule clôture par jour
    etat = (await c('GET', '/api/admin/journal-inalterable')).j;
    assert.equal(etat.clotures, 1);
    assert.deepEqual([etat.derniereCloture.pieces, etat.derniereCloture.avoirs, etat.derniereCloture.totalJour, etat.derniereCloture.grandTotal], [3, 1, 2400, 2400], '24 + 12 − 12 = CHF 24.00');
    // Export CSV pour l'archivage.
    const csv = await (await fetch(base + '/api/admin/journal-inalterable/export', { headers: { Cookie: cookie } })).text();
    assert.match(csv.replace(/^\uFEFF/, ''), /^seq;type;reference/); assert.equal(csv.trim().split('\n').length, 5);
    // Falsification 1 : montant d'un ticket modifié directement en base.
    const row = db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(t1.id), d = JSON.parse(row.donnees);
    db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(JSON.stringify({ ...d, total: 10 }), t1.id);
    etat = (await c('GET', '/api/admin/journal-inalterable')).j;
    assert.equal(etat.ok, false); assert.match(etat.anomalies.join(' '), new RegExp(`${t1.facture} : la pièce ne correspond plus`));
    db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(row.donnees, t1.id);
    assert.equal((await c('GET', '/api/admin/journal-inalterable')).j.ok, true, 'rétabli');
    // Falsification 2 : contenu scellé réécrit dans le journal.
    const e2 = db.prepare('SELECT contenu FROM journal_inalterable WHERE seq = 2').get();
    db.prepare('UPDATE journal_inalterable SET contenu = ? WHERE seq = 2').run(e2.contenu.replace('"total":1200', '"total":100'));
    assert.match((await c('GET', '/api/admin/journal-inalterable')).j.anomalies.join(' '), /Entrée n° 2 .* modifiée/);
    db.prepare('UPDATE journal_inalterable SET contenu = ? WHERE seq = 2').run(e2.contenu);
    // Falsification 3 : une entrée supprimée.
    db.prepare('DELETE FROM journal_inalterable WHERE seq = 1').run();
    assert.match((await c('GET', '/api/admin/journal-inalterable')).j.anomalies.join(' '), /Entrée n° 1 manquante/);
    // Effacement d'un client (RGPD) : le journal reste valide (aucune donnée personnelle scellée).
  } finally { s.close(); }
});
