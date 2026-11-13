// Santé et console de l'exploitant : invisible pour les marchands, exige un compte protégé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');

test('santé et console de l’exploitant', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', OPERATEUR_EMAILS: 'chef@comptoir.example' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined }); for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; } const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* html */ } return { s: r.status, j, t }; }; };
  try {
    const sante = await client()('GET', '/sante');
    assert.equal(sante.s, 200); assert.equal(sante.j.ok, true); assert.deepEqual(Object.keys(sante.j).sort(), ['depuis', 'ok'], 'aucune donnée sensible');
    const marchand = client();
    await marchand('POST', '/api/auth/inscription', { email: 'marchand@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'M' } } });
    assert.equal((await marchand('GET', '/operateur')).s, 404, 'invisible pour un marchand');
    assert.equal((await client()('GET', '/operateur')).s, 404, 'invisible sans connexion');
    const op = client();
    await op('POST', '/api/auth/inscription', { email: 'chef@comptoir.example', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Op' } } });
    assert.match((await op('GET', '/operateur')).t, /Activez d’abord la double authentification/);
    const prep = (await op('POST', '/api/admin/compte/2fa/preparer')).j;
    assert.equal((await op('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(prep.secret, totp.pasActuel()) })).s, 200);
    assert.match((await op('GET', '/operateur')).t, /lien de confirmation/, 'adresse à prouver');
    const lien = /\/operateur\?verifier=[\w-]+/.exec(db.prepare("SELECT corps FROM emails WHERE destinataire = 'chef@comptoir.example' AND sujet LIKE 'Console%'").get().corps)[0];
    assert.match((await op('GET', '/operateur?verifier=faux')).t, /lien de confirmation/, 'faux lien refusé');
    await op('GET', lien);
    const page = await op('GET', '/operateur');
    assert.equal(page.s, 200); assert.match(page.t, /Comptes marchands/); assert.match(page.t, /Revenu mensuel récurrent/);
    assert.doesNotMatch(page.t, /marchand@exemple\.ch/, 'aucune adresse affichée');
    // Bilan de sécurité : clé gardée dans la base signalée (pas de SECRET_CHIFFREMENT ici), comptes protégés comptés.
    assert.match(page.t, /<h2>Sécurité<\/h2>/);
    assert.match(page.t, /<tr class="alerte"><td>Clé de chiffrement<\/td><td class="d"><b>GARDÉE DANS LA BASE/);
    assert.match(page.t, /Données illisibles avec les clés connues[^<]*<\/td><td class="d"><b>aucune/);
    assert.match(page.t, /Comptes marchands protégés[^<]*<\/td><td class="d"><b>0 \/ 1 \(0 %\)/, 'compte de l’exploitant exclu');
    // Alertes : secret de webhook illisible, paiement reçu à rembourser.
    const bid = db.prepare('SELECT id FROM boutiques LIMIT 1').get().id;
    db.prepare("INSERT INTO webhooks (id, boutique_id, url, secret, evenements, cree_le) VALUES ('wh_x', ?, 'https://exemple.ch/h', 'v2.casse', '[]', 1)").run(bid);
    db.prepare("INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES ('c_x', ?, 9999, 1, 'annulee', 'j', '{}')").run(bid);
    db.prepare("INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES ('pay_x', 'c_x', 'stripe', 1000, 'CHF', 'a_rembourser', 1)").run();
    const page2 = await op('GET', '/operateur');
    assert.match(page2.t, /<tr class="alerte"><td>Données illisibles avec les clés connues[^<]*<\/td><td class="d"><b>0 commande\(s\) · 0 secret\(s\) de double authentification · 1 secret\(s\) de webhook/);
    assert.match(page2.t, /<tr class="alerte"><td>Paiements reçus à rembourser<\/td><td class="d"><b>1</);
    // Sauvegardes : aucune encore, puis une vérifiée il y a 2 h (pas d'alerte), puis une tentative en échec (alerte).
    assert.match(page2.t, /<tr class="alerte"><td>Sauvegardes<\/td><td class="d"><b>aucune encore/);
    const etat = v => db.prepare("INSERT INTO cles (nom, valeur) VALUES ('sauvegarde-etat', ?) ON CONFLICT (nom) DO UPDATE SET valeur = excluded.valeur").run(JSON.stringify(v));
    etat({ ok: true, reussie: Date.now() - 2 * 3600000, chiffree: true, verifiee: true, commandes: 12 });
    assert.match((await op('GET', '/operateur')).t, /<tr><td>Sauvegardes<\/td><td class="d"><b>dernière restaurée à l’essai il y a 2 h · chiffrée · 12 commandes/);
    etat({ ok: false, erreur: 'disque plein', reussie: Date.now() - 2 * 3600000, chiffree: true });
    assert.match((await op('GET', '/operateur')).t, /<tr class="alerte"><td>Sauvegardes[^<]*<\/td><td class="d"><b>[^<]*DERNIÈRE TENTATIVE EN ÉCHEC<\/b><br><span>Dernière erreur : disque plein/);
  } finally { s.close(); }
});
