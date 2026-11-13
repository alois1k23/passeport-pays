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

test('panne du service d’envoi : les e-mails attendent et partent ensuite, sans être perdus', async () => {
  const db = ouvrir(':memory:');
  courriel.creerTables(db);
  for (let k = 0; k < 3; k++) db.prepare('INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le) VALUES (NULL, ?, ?, ?, ?)').run(`c${k}@x.ch`, `Commande n° ${k} confirmée`, 'Merci', Date.now());
  let panne = true, envoyes = 0;
  const p = courriel.prestataire({ BREVO_API_KEY: 'k', EMAIL_EXPEDITEUR: 'Comptoir <envoi@comptoir.example>' }, async () => panne ? { ok: false, status: 503 } : (envoyes++, { ok: true, status: 201 }));
  const reel = Date.now; let t = reel();
  Date.now = () => t;
  try {
    for (let k = 0; k < 8; k++) { await courriel.envoyerFile(db, p, { journal: { error() {} } }); t += 60000; }   // 8 minutes de panne
    assert.equal(db.prepare('SELECT COUNT(*) n FROM emails WHERE envoye = 0').get().n, 3);
    panne = false;
    for (let k = 0; k < 40; k++) { await courriel.envoyerFile(db, p, { journal: { error() {} } }); t += 10 * 60000; }
    assert.equal(envoyes, 3, 'tous partis après la panne');
    // Adresse refusée par le service (400) : abandon immédiat, signalé
    db.prepare('INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le) VALUES (NULL, ?, ?, ?, ?)').run('faux@x', 'Test', 'x', t);
    const p400 = courriel.prestataire({ BREVO_API_KEY: 'k', EMAIL_EXPEDITEUR: 'Comptoir <envoi@comptoir.example>' }, async () => ({ ok: false, status: 400 }));
    const erreurs = []; await courriel.envoyerFile(db, p400, { journal: { error: (...a) => erreurs.push(a.join(' ')) } });
    assert.match(erreurs[0], /ABANDON/);
  } finally { Date.now = reel; }
});

test('journal du serveur : adresses e-mail masquées (domaine gardé)', () => {
  const { masquerAdresses } = require('../src/courriel');
  assert.equal(masquerAdresses('Refusé : lou.martin@exemple.fr'), 'Refusé : l•••@exemple.fr');
  assert.equal(masquerAdresses('<a@b.ch>, x.y+z@sous.domaine.com'), '<a•••@b.ch>, x•••@sous.domaine.com');
  assert.equal(masquerAdresses('sans adresse'), 'sans adresse');
});
