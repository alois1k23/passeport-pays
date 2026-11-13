// Journal inaltérable : pièces scellées (ticket, facture, avoir), clôtures, falsifications détectées.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const JI = require('../src/journal-inalterable');

async function demarrer() {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  await c('POST', '/api/auth/inscription', { email: 'ji@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Marché', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'M', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Miel', prix: 12, stock: 50, type: 'stock' }] });
  return { db, s, base, gerer, c, cookie: () => cookie };
}
const verifier = (c, corps = {}) => c('POST', '/api/admin/journal-inalterable/verifier', corps).then(r => r.j);

test('journal inaltérable : scellement, clôture, export, falsifications', async () => {
  const { db, s, base, gerer, c, cookie } = await demarrer();
  try {
    const p = (await c('GET', '/api/admin/etat')).j.produits[0];
    const t1 = (await c('POST', '/api/admin/caisse', { lignes: [{ produitId: p.id, qte: 2 }], moyen: 'carte', cle: 'j1' })).j;
    const t2 = (await c('POST', '/api/admin/caisse', { lignes: [{ produitId: p.id, qte: 1 }], moyen: 'twint', cle: 'j2' })).j;
    assert.equal((await c('POST', `/api/admin/commandes/${t2.id}/statut`, { statut: 'remboursee' })).s, 200);
    let r = await verifier(c);
    assert.equal(r.ok, true, JSON.stringify(r.anomalies)); assert.equal(r.pieces, 3);
    // Clôture des jours terminés, une seule par jour.
    gerer.automatisationsEcheances(Date.now() + 86400000); gerer.automatisationsEcheances(Date.now() + 86400000);
    const etat = (await c('GET', '/api/admin/journal-inalterable')).j;
    assert.equal(etat.clotures, 1);
    assert.deepEqual([etat.derniereCloture.pieces, etat.derniereCloture.avoirs, etat.derniereCloture.totalJour, etat.derniereCloture.grandTotal], [3, 1, 2400, 2400], '24 + 12 − 12 = CHF 24.00');
    assert.equal((await verifier(c)).ok, true);
    const csv = await (await fetch(base + '/api/admin/journal-inalterable/export', { headers: { Cookie: cookie() } })).text();
    assert.match(csv.replace(/^﻿/, ''), /^seq;type;reference/); assert.equal(csv.trim().split('\n').length, 5);

    // 1. Montant d'un ticket modifié directement en base.
    const row = db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(t1.id), d = JSON.parse(row.donnees);
    db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(JSON.stringify({ ...d, total: 10 }), t1.id);
    r = await verifier(c); assert.equal(r.ok, false); assert.match(r.anomalies.join(' '), new RegExp(`${t1.facture} : la pièce ne correspond plus`));
    db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(row.donnees, t1.id);
    assert.equal((await verifier(c)).ok, true, 'rétabli');
    // 2. Contenu réécrit et empreinte recalculée sans la clé du serveur (SHA-256 simple) : détecté.
    const e2 = db.prepare('SELECT * FROM journal_inalterable WHERE seq = 2').get(), e1 = db.prepare('SELECT empreinte FROM journal_inalterable WHERE seq = 1').get();
    const faux = e2.contenu.replace('"total":1200', '"total":100');
    db.prepare('UPDATE journal_inalterable SET contenu = ?, empreinte = ? WHERE seq = 2').run(faux, crypto.createHash('sha256').update(`${e1.empreinte}|2|${e2.type}|${e2.ref}|${e2.le}|${faux}`).digest('hex'));
    assert.match((await verifier(c)).anomalies.join(' '), /Entrée n° 2 .* modifiée/);
    db.prepare('UPDATE journal_inalterable SET contenu = ?, empreinte = ? WHERE seq = 2').run(e2.contenu, e2.empreinte);
    // 3. Fin de chaîne coupée (dernière clôture et dernier avoir supprimés, commande comprise) : numéros manquants.
    const sauve = db.prepare('SELECT * FROM journal_inalterable WHERE seq >= 3 ORDER BY seq').all();
    db.prepare('DELETE FROM journal_inalterable WHERE seq >= 3').run();
    r = await verifier(c); assert.match(r.anomalies.join(' '), /Numéros de pièces manquants dans le journal : 3/); assert.match(r.anomalies.join(' '), /non scellée/);
    for (const e of sauve) db.prepare('INSERT INTO journal_inalterable (boutique_id, seq, type, ref, commande_id, le, contenu, empreinte, cloture_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(e.boutique_id, e.seq, e.type, e.ref, e.commande_id, e.le, e.contenu, e.empreinte, e.cloture_seq);
    assert.equal((await verifier(c)).ok, true);
    // 4. Empreinte reçue par e-mail : retrouvée ; une empreinte inconnue est signalée.
    r = await verifier(c, { ancre: etat.derniereCloture.empreinte }); assert.equal(r.ancreOk, true); assert.equal(r.ok, true);
    r = await verifier(c, { ancre: 'a'.repeat(64) }); assert.equal(r.ancreOk, false); assert.equal(r.ok, true, 'une empreinte mal recopiée n’est pas une anomalie du journal');
    assert.equal((await c('POST', '/api/admin/journal-inalterable/verifier', { ancre: 'xyz' })).s, 400);
    // 5. Total de clôture falsifié (avec empreinte recalculée en SHA-256 simple) : détecté deux fois.
    const cl = db.prepare("SELECT * FROM journal_inalterable WHERE type = 'cloture'").get();
    db.prepare('UPDATE journal_inalterable SET contenu = ? WHERE seq = ?').run(cl.contenu.replace('"totalJour":2400', '"totalJour":2000'), cl.seq);
    r = await verifier(c); assert.match(r.anomalies.join(' '), /total du jour faux/); assert.match(r.anomalies.join(' '), /modifiée/);
    db.prepare('UPDATE journal_inalterable SET contenu = ? WHERE seq = ?').run(cl.contenu, cl.seq);
  } finally { s.close(); }
});

test('clôtures : une vente juste après minuit est comptée une fois, le jour suivant', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE commandes (id TEXT PRIMARY KEY, boutique_id TEXT, numero INTEGER, date INTEGER, statut TEXT, donnees TEXT)');
  const J = JI.creer(db, Buffer.alloc(32, 7));
  const minuitZurich = new Date('2026-11-13T00:00:00+01:00').getTime();
  const piece = (id, n, total, le) => J.sceller('b', { id, numero: n, facture: `FA-2026-${n}`, date: le, total, lignes: [] }, le);
  piece('c1', 1, 10, minuitZurich - 3600000);           // 12.11, 23 h
  piece('c2', 2, 20, minuitZurich + 120000);            // 13.11, 00 h 02, scellée avant la clôture du 12
  J.cloturer('b', minuitZurich + 300000);               // clôture du 12 (à 00 h 05)
  piece('c3', 3, 40, minuitZurich + 3600000);           // 13.11, 01 h
  J.cloturer('b', minuitZurich + 86400000 + 300000);    // clôture du 13
  const cl = db.prepare("SELECT contenu FROM journal_inalterable WHERE type = 'cloture' ORDER BY seq").all().map(x => JSON.parse(x.contenu));
  assert.deepEqual(cl.map(x => [x.jour, x.totalJour, x.grandTotal]), [['2026-11-12', 1000, 1000], ['2026-11-13', 6000, 7000]]);
  // Pièce reprise avec une date ancienne (jour déjà clôturé) : comptée dans la clôture suivante, jamais perdue.
  piece('c4', 4, 5, minuitZurich - 5 * 86400000);
  J.cloturer('b', minuitZurich + 2 * 86400000 + 300000);
  const der = JSON.parse(db.prepare("SELECT contenu FROM journal_inalterable WHERE type = 'cloture' ORDER BY seq DESC").get().contenu);
  assert.deepEqual([der.jour, der.totalJour, der.grandTotal], ['2026-11-14', 500, 7500]);
  // Second numéro de facture pour la même commande : refusé.
  assert.deepEqual(J.sceller('b', { id: 'c1', numero: 1, facture: 'FA-2026-9', total: 10, lignes: [] }).conflits, ['FA-2026-9 (déjà FA-2026-1)']);
});

test('variantes du fournisseur : référence jamais publique, stock non modifiable par l’API', async () => {
  const { s, c } = await demarrer();
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'ref@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Mode', pays: 'ch', secteur: 'mode', sections: [] }, entreprise: { raison: 'M', adresse: 'Rue 1, 1003 Lausanne' } },
      produits: [{ nom: 'T-shirt', prix: 30, type: 'drop', source: 'f01', codeFournisseur: 'demo', actif: true, options: [{ nom: 'Taille', valeurs: ['S'] }], variantes: [{ id: 'S', ref: 'ALI-123456-S' }] }] });
    const pub = await (await fetch(`${s.address ? '' : ''}http://127.0.0.1:${s.address().port}/api/public/${ins.j.slug}`)).text();
    assert.doesNotMatch(pub, /ALI-123456-S/, 'référence fournisseur absente de la boutique publique');
    assert.match(pub, /"variantes":\[\{"id":"S"/);
  } finally { s.close(); }
});

test('robustesse : migration v1, clé changée, entrée illisible, pièce sortie des clôtures', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE commandes (id TEXT PRIMARY KEY, boutique_id TEXT, numero INTEGER, date INTEGER, statut TEXT, donnees TEXT)');
  // Journal de la version 1 (SHA-256 simple, sans clôtures listées) : mis de côté, pièces rescellées.
  db.exec("CREATE TABLE journal_inalterable (boutique_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, ref TEXT NOT NULL, commande_id TEXT, le INTEGER NOT NULL, contenu TEXT NOT NULL, empreinte TEXT NOT NULL, PRIMARY KEY (boutique_id, seq), UNIQUE (boutique_id, type, ref))");
  const t0 = Date.now() - 10 * 86400000;
  for (let i = 1; i <= 3; i++) {
    db.prepare('INSERT INTO commandes VALUES (?, ?, ?, ?, ?, ?)').run(`c${i}`, 'b', i, t0 + i * 3600000, 'livree', JSON.stringify({ facture: `FA-2026-${i}`, dateFacture: t0 + i * 3600000, total: 10 * i, lignes: [] }));
    db.prepare("INSERT INTO journal_inalterable VALUES ('b', ?, 'facture', ?, ?, ?, '{}', 'ancienne')").run(i, `FA-2026-${i}`, `c${i}`, t0);
  }
  const lire = row => ({ ...JSON.parse(row.donnees), id: row.id, numero: row.numero, date: row.date, statut: row.statut });
  const lireCommandes = ids => new Map(ids.map(id => [id, lire(db.prepare('SELECT * FROM commandes WHERE id = ?').get(id))]));
  let J = JI.creer(db, Buffer.alloc(32, 3));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM journal_inalterable_v1').get().n, 3, 'version 1 gardée à part');
  assert.equal(J.reprendre(lire), 3);
  J.cloturer('b');
  let r = await J.verifier('b', { lireCommandes, compteurFactures: 3 });
  assert.equal(r.ok, true, JSON.stringify(r.anomalies));
  // Entrée illisible : signalée, la vérification va au bout.
  const sauve = db.prepare('SELECT contenu FROM journal_inalterable WHERE seq = 2').get().contenu;
  db.prepare("UPDATE journal_inalterable SET contenu = 'pas du json' WHERE seq = 2").run();
  r = await J.verifier('b', { lireCommandes, compteurFactures: 3 });
  assert.match(r.anomalies.join(' '), /Entrée n° 2 .* illisible/);
  assert.doesNotThrow(() => J.etat('b')); assert.doesNotThrow(() => J.exporterCsv('b'));
  db.prepare('UPDATE journal_inalterable SET contenu = ? WHERE seq = 2').run(sauve);
  // Clé changée : une seule anomalie claire, pas « chaque pièce modifiée ».
  J = JI.creer(db, Buffer.alloc(32, 4));
  r = await J.verifier('b', { lireCommandes, compteurFactures: 3 });
  assert.equal(r.cleChangee, true); assert.equal(r.nbAnomalies, 1); assert.match(r.anomalies[0], /clé de signature du serveur a changé/);
  assert.equal(J.etat('b').cleChangee, true);
});

test('une pièce ancienne absente de toute clôture est signalée', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE commandes (id TEXT PRIMARY KEY, boutique_id TEXT, numero INTEGER, date INTEGER, statut TEXT, donnees TEXT)');
  const J = JI.creer(db, Buffer.alloc(32, 5)), t0 = Date.now() - 10 * 86400000;
  const lire = row => ({ ...JSON.parse(row.donnees), id: row.id, numero: row.numero, date: row.date, statut: row.statut });
  for (let i = 1; i <= 2; i++) {
    const c = { id: `c${i}`, numero: i, facture: `FA-2026-${i}`, dateFacture: t0, date: t0, total: 5, lignes: [] };
    db.prepare('INSERT INTO commandes VALUES (?, ?, ?, ?, ?, ?)').run(c.id, 'b', i, t0, 'livree', JSON.stringify(c));
    J.sceller('b', c, t0);
  }
  // Une pièce marquée « déjà clôturée » à tort : elle n'entre dans aucune clôture.
  db.prepare('UPDATE journal_inalterable SET cloture_seq = 999 WHERE seq = 2').run();
  J.cloturer('b');
  const r = await J.verifier('b', { lireCommandes: ids => new Map(ids.map(id => [id, lire(db.prepare('SELECT * FROM commandes WHERE id = ?').get(id))])), compteurFactures: 2 });
  assert.match(r.anomalies.join(' '), /1 pièce absente de toute clôture \(FA-2026-2\)/);
});

test('chaque clôture part vers les webhooks abonnés à journal.cloture', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', INTEGRATIONS_HTTP_LOCAL: '1' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'wh@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Ancre', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'A', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Miel', prix: 12, stock: 50, type: 'stock' }] });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'lancement' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.equal((await c('POST', '/api/abonnement/changer', { formule: 'pro' })).s, 200);
    const wh = await c('POST', '/api/admin/integrations/webhooks', { url: 'http://127.0.0.1:9/ancre', evenements: ['journal.cloture'] }); assert.equal(wh.s, 201, JSON.stringify(wh.j));
    const p = (await c('GET', '/api/admin/etat')).j.produits[0];
    assert.equal((await c('POST', '/api/admin/caisse', { lignes: [{ produitId: p.id, qte: 1 }], moyen: 'carte', cle: 'w1' })).s, 201);
    gerer.automatisationsEcheances(Date.now() + 86400000);
    const envoi = db.prepare("SELECT e.id, e.corps, w.boutique_id FROM webhook_envois e JOIN webhooks w ON w.id = e.webhook_id WHERE e.evenement = 'journal.cloture'").get();
    assert.ok(envoi, 'clôture envoyée au webhook');
    assert.match(envoi.corps, /^v2\./, 'file des webhooks chiffrée au repos');
    const P = require('../src/pii').creer(Buffer.from(db.prepare("SELECT valeur FROM cles WHERE nom = 'chiffrement'").get().valeur, 'hex'));
    const d = JSON.parse(P.dechiffrer(envoi.corps, { boutique: envoi.boutique_id, commande: `webhook:${envoi.id}` }).corps).donnees;
    assert.match(d.empreinte, /^[0-9a-f]{64}$/); assert.equal(d.pieces, 1); assert.equal(d.totalJour, 12); assert.equal(d.grandTotal, 12);
    assert.equal(d.empreinte, (await c('GET', '/api/admin/journal-inalterable')).j.derniereCloture.empreinte);
  } finally { s.close(); }
});

test('reprise après interruption : seules les pièces manquantes sont scellées, sans doublon', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE commandes (id TEXT PRIMARY KEY, boutique_id TEXT, numero INTEGER, date INTEGER, statut TEXT, donnees TEXT)');
  const J = JI.creer(db, Buffer.alloc(32, 9)), t0 = Date.now() - 5 * 86400000;
  const lire = row => ({ ...JSON.parse(row.donnees), id: row.id, numero: row.numero, date: row.date, statut: row.statut });
  const ajouter = (i, extra = {}) => db.prepare('INSERT INTO commandes VALUES (?, ?, ?, ?, ?, ?)').run(`c${i}`, 'b', i, t0 + i * 1000, 'livree', JSON.stringify({ facture: `FA-2026-${i}`, dateFacture: t0 + i * 1000, total: 10, lignes: [], ...extra }));
  for (let i = 1; i <= 3; i++) ajouter(i);
  J.sceller('b', lire(db.prepare("SELECT * FROM commandes WHERE id = 'c1'").get()), t0);   // scellement interrompu après la première pièce
  assert.equal(J.nonScellees('b').length, 2);
  assert.equal(J.reprendre(lire), 2, 'les deux pièces manquantes');
  assert.equal(J.reprendre(lire), 0, 'rien de plus au second passage');
  // Un avoir émis plus tard sur une commande déjà scellée : seul l'avoir est repris, daté de sa propre date.
  db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(JSON.stringify({ facture: 'FA-2026-2', dateFacture: t0 + 2000, total: 10, lignes: [], avoir: { numero: 'AV-2026-4', date: t0 + 86400000, montant: 10 } }), 'c2');
  assert.equal(J.reprendre(lire), 1);
  assert.equal(db.prepare("SELECT le FROM journal_inalterable WHERE ref = 'AV-2026-4'").get().le, t0 + 86400000, 'avoir daté de sa date');
  J.cloturer('b');   // sans clôture, la vérification signale à juste titre des pièces de plus de deux jours hors clôture
  const r = await J.verifier('b', { lireCommandes: ids => new Map(ids.map(id => [id, lire(db.prepare('SELECT * FROM commandes WHERE id = ?').get(id))])), compteurFactures: 4 });
  assert.equal(r.ok, true, JSON.stringify(r.anomalies));
});
