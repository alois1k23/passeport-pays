// E-mails commerciaux dans la langue du client : confirmation d'inscription, page de confirmation, bienvenue, reconquête.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('newsletter et reconquête dans la langue du client', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  const publier = (chemin, corps) => fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'ml@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Alpage', pays: 'ch', secteur: 'maison', sections: [], langues: ['fr', 'de'] }, entreprise: { raison: 'A', adresse: 'Rue 1, 1003 Lausanne' }, automatisations: { bienvenue: { actif: true, remise: 10, code: 'BIENVENUE10' }, reconquete: { actif: true, jours: 90, remise: 15, code: 'RETOUR15' } } }, produits: [{ nom: 'Fromage', prix: 20, stock: 50, type: 'stock' }] });
    const slug = ins.j.slug;
    // Inscription en allemand ; l'italien n'est pas proposé par cette boutique : français.
    assert.equal((await publier(`/api/public/${slug}/newsletter`, { email: 'hans@exemple.ch', langue: 'de' })).status, 200);
    assert.equal((await publier(`/api/public/${slug}/newsletter`, { email: 'gina@exemple.ch', langue: 'it' })).status, 200);
    const conf = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'hans@exemple.ch'").get();
    assert.equal(conf.sujet, 'Bestätigen Sie Ihre Anmeldung bei Alpage');
    assert.match(db.prepare("SELECT sujet FROM emails WHERE destinataire = 'gina@exemple.ch'").get().sujet, /^Confirmez/, 'langue non proposée : français');
    const lien = /\/reinscription\?j=[\w.-]+/.exec(conf.corps)[0];
    const page = await (await fetch(base + lien)).text();
    assert.match(page, /Anmeldung bestätigen/);
    assert.match(await (await fetch(base + lien, { method: 'POST' })).text(), /Erledigt/);
    const bienvenue = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'hans@exemple.ch' AND sujet LIKE 'Willkommen%'").get();
    assert.ok(bienvenue, 'bienvenue en allemand');
    assert.match(bienvenue.corps, /-10 % auf Ihre erste Bestellung mit dem Code BIENVENUE10/);
    assert.match(bienvenue.corps, /lang=de/);
    assert.match(bienvenue.corps, /Zum Abbestellen/, 'pied de désinscription traduit');
    assert.equal(db.prepare("SELECT langue FROM abonnes WHERE email = 'hans@exemple.ch'").get().langue, 'de');
    // Désinscription depuis le pied de l'e-mail : page en allemand.
    const desinscrire = /\/desinscription\?j=[\w.-]+&lang=de/.exec(bienvenue.corps)[0];
    const pageD = await (await fetch(base + desinscrire)).text();
    assert.match(pageD, /<html lang="de">/); assert.match(pageD, /<button>Abmelden<\/button>/); assert.match(pageD, /&amp;lang=de/);
    assert.match(await (await fetch(base + desinscrire, { method: 'POST' })).text(), /erhält keine Werbe-E-Mails/);
    assert.match(await (await fetch(base + '/desinscription?j=faux&lang=constructor')).text(), /<html lang="fr">[\s\S]*Lien invalide/, 'langue inconnue : français');

    // Reconquête : client germanophone ayant accepté les nouvelles, sans commande depuis 90 jours.
    const pub = (await c('GET', `/api/public/${slug}`)).j;
    const cmd = await (await publier(`/api/public/${slug}/commandes`, { langue: 'de', lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Ursula Meier', email: 'ursula@exemple.ch', adresse: 'Weg 2', npa: '3000', ville: 'Bern', consentement: true } })).json();
    assert.ok(cmd.commandeId, JSON.stringify(cmd));
    const row = db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.commandeId);
    const d = JSON.parse(row.donnees); d.statut = 'livree';
    db.prepare("UPDATE commandes SET statut = 'livree', donnees = ? WHERE id = ?").run(JSON.stringify(d), cmd.commandeId);
    gerer.automatisationsEcheances(Date.now() + 91 * 86400000);
    const rq = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'ursula@exemple.ch' AND sujet LIKE 'Lange%'").get();
    assert.ok(rq, 'reconquête en allemand');
    assert.equal(rq.sujet, 'Lange nicht gesehen, Ursula');
    assert.match(rq.corps, /-15 % mit dem Code RETOUR15/);
    // « Mes commandes » : dans la langue de la dernière commande.
    assert.equal((await publier(`/api/public/${slug}/mes-commandes`, { email: 'ursula@exemple.ch' })).status, 200);
    const mc = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'ursula@exemple.ch' AND sujet LIKE 'Ihre Bestellungen%'").get();
    assert.ok(mc, 'liste des commandes en allemand'); assert.match(mc.corps, /Nr\. \d+ vom .* \(geliefert\): http/);
  } finally { s.close(); }
});

test('nouveautés traduites : carte cadeau et points dans le récapitulatif, code de fidélité', () => {
  const E = require('../src/emails-clients');
  const c = { numero: 7, langue: 'de', client: { nom: 'Anna' }, lignes: [{ nom: 'Vase', qte: 1, prix: 40 }], total: 40, port: 0, livraison: 'retrait', carteCadeau: { montant: 15, fin: 'AB12' }, fidelite: { gagnes: 25 } };
  const o = { nomBoutique: 'Atelier', formatMontant: m => `CHF ${m.toFixed(2)}`, nomLivraison: 'Retrait', lienCommande: 'https://x', legal: '' };
  const m = E.confirmation(c, o);
  assert.match(m.corps, /davon CHF 15\.00 mit Geschenkgutschein ····AB12, Rest CHF 25\.00/);
  assert.match(m.corps, /Gesammelte Treuepunkte: 25/);
  for (const [l, motif] of [['de', /Ihr Code/], ['it', /Il suo codice/], ['en', /Your code/]]) {
    const k = E.codeFidelite(l, { nomBoutique: 'Atelier', points: 120, valeur: 'CHF 6.00', code: '123456' });
    assert.match(k.corps, motif); assert.match(k.corps, /123456/); assert.match(k.corps, /120/);
  }
  assert.equal(E.codeFidelite('fr', { nomBoutique: 'A', points: 1, valeur: '1', code: '1' }), null, 'français : texte d’origine');
});
