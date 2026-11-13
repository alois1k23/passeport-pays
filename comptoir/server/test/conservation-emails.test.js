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
