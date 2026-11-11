// Politique de mot de passe : mots de passe courants, suites, reprise de l'e-mail, fuites connues (anonymat k).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const M = require('../src/motdepasse');

test('mots de passe refusés et acceptés', () => {
  const ctx = { email: 'marie.dupont@exemple.ch', noms: ['Atelier Léman'] };
  for (const p of ['azerty123!', 'Lausanne2024', 'Motdepasse1', 'abcdefghijk', '9876543210', 'aaaaaaaaaaaa', 'marie.dupont99', 'atelierleman!', 'court']) assert.ok(M.evaluer(p, ctx), p);
  for (const p of ['un mot de passe solide', 'Cheval-Batterie-Agrafe', 'tram 7 vers Renens à 6h12']) assert.equal(M.evaluer(p, ctx), null, p);
});

test('fuites connues : seul le préfixe de l’empreinte part, panne du service tolérée', async () => {
  const mdp = 'P@ssw0rd-fuite', h = crypto.createHash('sha1').update(mdp).digest('hex').toUpperCase();
  let demande = '';
  const f = M.creerVerificationFuites({ url: 'https://x/range/', fetchImpl: async u => { demande = u; return { ok: true, text: async () => `0000000000000000000000000000000000A:0\r\n${h.slice(5)}:4242\r\n` }; } });
  assert.equal(await f(mdp), 4242);
  assert.equal(demande, 'https://x/range/' + h.slice(0, 5), 'seuls 5 caractères de l’empreinte');
  assert.ok(!demande.includes(h.slice(5)));
  assert.equal(await f('autre chose de long'), 0);
  const panne = M.creerVerificationFuites({ fetchImpl: async () => { throw new Error('réseau'); } });
  assert.equal(await panne('nimporte quoi long'), null);
});
