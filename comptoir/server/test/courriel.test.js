// Envoi des e-mails par Brevo et Postmark : réponse au marchand, en-tête de désinscription, texte brut.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ouvrir } = require('../src/db');
const courriel = require('../src/courriel');

for (const [nom, env] of [['brevo', { BREVO_API_KEY: 'k', EMAIL_EXPEDITEUR: 'Comptoir <envoi@comptoir.example>' }], ['postmark', { POSTMARK_TOKEN: 't', EMAIL_EXPEDITEUR: 'Comptoir <envoi@comptoir.example>' }]]) {
  test(`${nom} : Reply-To du marchand et List-Unsubscribe`, async () => {
    const db = ouvrir(':memory:');
    courriel.creerTables(db);
    db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m', 'm@x.ch', 'x', 0)").run();
    db.prepare('INSERT INTO boutiques (id, marchand_id, slug, config, cree_le) VALUES (?, ?, ?, ?, 0)').run('b', 'm', 'b', JSON.stringify({ boutique: { nom: 'Ma Boutique' }, entreprise: { email: 'contact@maboutique.ch' } }));
    db.prepare("INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le, desinscription) VALUES ('b', 'client@x.ch', 'Bienvenue', 'Texte <b>brut</b>', 0, 'https://comptoir.example/desinscription?j=abc')").run();
    const envois = [];
    const p = courriel.prestataire(env, async (url, o) => { envois.push({ url, corps: JSON.parse(o.body) }); return { ok: true }; });
    assert.equal(await courriel.envoyerFile(db, p, { journal: { error() {} } }), 1);
    const c = envois[0].corps;
    if (nom === 'brevo') {
      assert.deepEqual(c.replyTo, { email: 'contact@maboutique.ch' });
      assert.equal(c.headers['List-Unsubscribe'], '<https://comptoir.example/desinscription?j=abc>');
      assert.equal(c.textContent, 'Texte <b>brut</b>');
      assert.equal(c.htmlContent, undefined);
      assert.equal(c.sender.name, 'Ma Boutique');
    } else {
      assert.equal(c.ReplyTo, 'contact@maboutique.ch');
      assert.ok(c.Headers.some(h => h.Name === 'List-Unsubscribe'));
      assert.equal(c.HtmlBody, undefined);
      assert.match(c.From, /^"Ma Boutique" <envoi@comptoir\.example>$/);
    }
  });
}
