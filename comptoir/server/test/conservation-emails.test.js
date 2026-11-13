// Conservation des e-mails : contenu effacé 7 jours après l'envoi (30 jours pour un e-mail abandonné), ligne entière
// (destinataire compris) supprimée après 180 jours. Les e-mails en attente d'envoi ne sont jamais touchés.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('e-mails : contenu effacé au bout de 7 jours (envoyé) ou 30 jours (abandonné), trace supprimée après 180 jours', () => {
  const db = ouvrir(':memory:');
  const gerer = creerApp({ db, env: { ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: 'http://x', journal: { log() {}, error() {} } });
  const j = 86400000, maintenant = Date.now();
  const ins = db.prepare('INSERT INTO emails (destinataire, sujet, corps, cree_le, envoye, tentatives) VALUES (?, ?, ?, ?, ?, ?)');
  const id = (dest, age, envoye, tentatives = 0) => ins.run(dest, 'Commande', 'Bonjour Lou Martin, Rue 3, 1003 Lausanne', maintenant - age * j, envoye, tentatives).lastInsertRowid;
  const recent = id('recent@exemple.ch', 2, 1), envoye8 = id('huit@exemple.ch', 8, 1), abandonne10 = id('aband10@exemple.ch', 10, 0, 12),
    abandonne31 = id('aband31@exemple.ch', 31, 0, 12), attente = id('attente@exemple.ch', 40, 0, 3), vieux = id('vieux@exemple.ch', 181, 1);
  gerer.automatisationsEcheances(maintenant);
  const corps = x => (db.prepare('SELECT corps FROM emails WHERE id = ?').get(x) || {}).corps;
  assert.match(corps(recent), /Lou Martin/, 'envoyé il y a 2 jours : gardé');
  assert.equal(corps(envoye8), '(contenu effacé après 7 jours)');
  assert.match(corps(abandonne10), /Lou Martin/, 'abandonné depuis 10 jours : gardé (le marchand peut encore le traiter)');
  assert.equal(corps(abandonne31), '(contenu effacé après 30 jours)');
  assert.match(corps(attente), /Lou Martin/, 'en attente d’envoi : jamais touché');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM emails WHERE id = ?').get(vieux).n, 0, 'après 180 jours : plus aucune trace du destinataire');
});

test('cartes cadeaux : un envoi abandonné est repéré même après plus de 100 cartes bien reçues ; vieil e-mail en attente supprimé', () => {
  const db = ouvrir(':memory:');
  const gerer = creerApp({ db, env: { ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: 'http://x', journal: { log() {}, error() {} } });
  db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m', 'm@exemple.ch', 'x', 1)").run();
  db.prepare("INSERT INTO boutiques (id, marchand_id, slug, config, cree_le) VALUES ('b', 'm', 's', '{\"boutique\":{\"nom\":\"B\",\"pays\":\"ch\"}}', 1)").run();
  const mail = db.prepare('INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le, envoye, tentatives) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const cmd = db.prepare("INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, 'b', ?, ?, 'payee', 'j', ?)");
  for (let i = 0; i < 120; i++) { const e = mail.run('b', `c${i}@exemple.ch`, 'Votre carte', 'Code XXXX', Date.now(), 1, 1).lastInsertRowid; cmd.run(`ok${i}`, i, i, JSON.stringify({ canal: 'carte', client: {}, lignes: [], historique: [], carteEmise: { email: Number(e), id: 'k', fin: 'ABCD' } })); }
  const rate = mail.run('b', 'perdu@exemple.ch', 'Votre carte', 'Code ZZZZ-SECRET', Date.now(), 0, 12).lastInsertRowid;
  cmd.run('perdue', 999, 999, JSON.stringify({ canal: 'carte', client: {}, lignes: [], historique: [], carteEmise: { email: Number(rate), id: 'k2', fin: 'ZZZZ' } }));
  const vieuxEnAttente = mail.run('b', 'vieux@exemple.ch', 'X', 'Y', Date.now() - 181 * 86400000, 0, 3).lastInsertRowid;
  gerer.automatisationsEcheances(Date.now());
  assert.ok(JSON.parse(db.prepare("SELECT donnees FROM commandes WHERE id = 'perdue'").get().donnees).carteEmise.echecEnvoi, 'envoi abandonné repéré');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM emails WHERE id = ?').get(vieuxEnAttente).n, 0);
});
