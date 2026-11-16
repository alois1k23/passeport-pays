// Parrainage : code personnel après une commande payée, remise du filleul sur sa première commande seulement (jamais sur
// soi-même), récompense du parrain 14 jours après la livraison si la commande est gardée, à usage unique et personnelle.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const Parrainage = require('../src/parrainage');

test('réglages du parrainage : bornés de 5 à 30 %, inactif par défaut', () => {
  assert.deepEqual(Parrainage.nettoyerReglages(undefined), { actif: false, filleul: 10, parrain: 10, minimum: 20 });
  assert.deepEqual(Parrainage.nettoyerReglages({ actif: true, filleul: 90, parrain: 1, minimum: 9999 }), { actif: true, filleul: 30, parrain: 5, minimum: 500 });
  assert.equal(Parrainage.canonique(' A.Na+promo@GoogleMail.com '), 'ana@gmail.com');
  assert.equal(Parrainage.canonique('ana+x@exemple.ch'), 'ana@exemple.ch');
  assert.equal(Parrainage.canonique('a.na@exemple.ch'), 'a.na@exemple.ch', 'les points ne comptent que chez Gmail');
  assert.equal(Parrainage.canonique('A.n-a@pm.me'), 'ana@proton.me'); assert.equal(Parrainage.canonique('ana-promo@yahoo.com'), 'ana@yahoo.com');
  assert.equal(Parrainage.nettoyerReglages({ actif: 'oui' }).actif, false);
});

test('parrainage : lien, remise du filleul, refus sur soi et après une première commande, récompense à 14 jours', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const gerer = s.listeners('request')[0];
  let cookie = '';
  const c = async (m, chemin, corps, avec = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avec ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avec) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'p@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier', pays: 'ch' }, entreprise: { raison: 'A Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'p@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const vase = (await c('POST', '/api/admin/produits', { produit: { nom: 'Vase', prix: 100, stock: 50 } })).j.id;
    const bille = (await c('POST', '/api/admin/produits', { produit: { nom: 'Bille', prix: 1, stock: 50 } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j, slug = etat.serveur.slug;
    const commander = (email, extra = {}, produit = vase) => c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'poste-eco', client: { nom: email.split('@')[0] + ' Rossi', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' }, ...extra }, false);
    const payer = async r => { assert.equal(r.s, 201, JSON.stringify(r.j)); await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' }); return r.j; };
    const lien = cmd => c('POST', `/api/public/${slug}/parrainage`, { commandeId: cmd.commandeId, jeton: cmd.jeton }, false);
    // Programme inactif : pas de lien, et un code « AMI… » n'existe pas.
    const ana1 = await payer(await commander('ana@exemple.ch'));
    assert.equal((await lien(ana1)).j.code, 'parrainage_inactif');
    const cfg = { boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, livraisons: etat.livraisons, offres: etat.offres, reglages: etat.reglages, parrainage: { actif: true, filleul: 10, parrain: 15, minimum: 30 } };
    assert.equal((await c('PUT', '/api/admin/config', { config: cfg })).s, 200);
    assert.deepEqual((await c('GET', `/api/public/${slug}`, null, false)).j.parrainage, { filleul: 10, parrain: 15 });
    // Lien : jeton exigé ; commande non payée refusée ; le même code à chaque demande.
    assert.equal((await c('POST', `/api/public/${slug}/parrainage`, { commandeId: ana1.commandeId, jeton: 'faux' }, false)).s, 404);
    const enAttente = await commander('zoe@exemple.ch'); assert.equal((await lien(enAttente.j)).j.code, 'parrainage_attente');
    const l1 = (await lien(ana1)).j, l2 = (await lien(ana1)).j;
    assert.match(l1.code, /^AMI[A-Z2-9]{6}$/); assert.equal(l1.code, l2.code); assert.match(l1.lien, new RegExp(`/s/${slug}/\\?code=${l1.code}$`));
    { const d = db.prepare('SELECT donnees FROM parrains').get().donnees; assert.match(d, /^v\d\./, 'adresse du parrain chiffrée au repos'); assert.ok(!d.includes('ana@exemple.ch')); }
    // Saisie du code : remise et condition annoncées.
    const code = await c('POST', `/api/public/${slug}/code`, { code: l1.code.toLowerCase() }, false);
    assert.equal(code.j.remise, 10); assert.match(code.j.condition, /première commande/);
    // Sur soi-même : refusé, alias compris (« +étiquette »).
    assert.equal((await commander('ana@exemple.ch', { code: l1.code })).j.code, 'parrainage_soi');
    assert.equal((await commander('ana+2@exemple.ch', { code: l1.code })).j.code, 'parrainage_soi');
    // Montant minimum du filleul (30) : une bille à 1 ne suffit pas.
    assert.equal((await commander('eve@exemple.ch', { code: l1.code }, bille)).j.code, 'parrainage_minimum');
    // Filleul : −10 % (100 → 90 + port), commande payée ; une deuxième commande avec le code est refusée.
    const bob = await commander('bob@exemple.ch', { code: l1.code });
    const sans = (await commander('carl@exemple.ch')).j;
    assert.equal(Math.round((sans.total - bob.j.total) * 100) / 100, 10, `remise du filleul (${sans.total} / ${bob.j.total})`);
    await payer(bob);
    assert.equal((await commander('bob@exemple.ch', { code: l1.code })).j.code, 'code_premiere_commande');
    assert.equal((await commander('bob+alias@exemple.ch', { code: l1.code })).j.code, 'code_premiere_commande', 'un filleul ne revient pas avec un alias');
    assert.equal(db.prepare("SELECT statut FROM filleuls WHERE commande_id = ?").get(bob.j.commandeId).statut, 'attente');
    // Reprise du paiement : gus abandonne une commande A avec le code, en passe une B (acceptée), la paie, puis reprend A :
    // refusée (une seule commande de filleul).
    const gusA = (await commander('gus@exemple.ch', { code: l1.code })).j;
    db.prepare('UPDATE paiements SET cree_le = ? WHERE commande_id = ?').run(Date.now() - 40 * 60000, gusA.commandeId);   // lien de paiement fermé
    await payer(await commander('gus@exemple.ch', { code: l1.code }));
    const reprise = await c('POST', `/api/public/${slug}/commandes/${gusA.commandeId}/reprendre`, { jeton: gusA.jeton }, false);
    assert.equal(reprise.j && reprise.j.code, 'code_premiere_commande', JSON.stringify(reprise.j));
    // Toutes les commandes du test viennent du même poste : le parrain reçoit ici un autre réseau (règle testée plus bas).
    db.prepare("UPDATE parrains SET reseau = 'reseau-du-parrain'").run();
    // Payée mais pas livrée : rien, même après des semaines. Livrée : le délai de 14 jours part de là.
    gerer.automatisationsEcheances(Date.now() + 30 * 86400000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE destinataire = 'ana@exemple.ch' AND sujet LIKE 'Merci !%'").get().n, 0);
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE id = ?").run(bob.j.commandeId);
    gerer.automatisationsEcheances(Date.now() + 31 * 86400000);   // première vue livrée
    gerer.automatisationsEcheances(Date.now() + 40 * 86400000);   // 9 jours plus tard : pas encore
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE destinataire = 'ana@exemple.ch' AND sujet LIKE 'Merci !%'").get().n, 0);
    gerer.automatisationsEcheances(Date.now() + 46 * 86400000);
    gerer.automatisationsEcheances(Date.now() + 47 * 86400000);
    const mails = db.prepare("SELECT corps FROM emails WHERE destinataire = 'ana@exemple.ch' AND sujet LIKE 'Merci !%'").all();
    assert.equal(mails.length, 1, 'une seule récompense');
    const merci = /(MERCI[A-Z2-9]{6})/.exec(mails[0].corps)[1];
    assert.match(mails[0].corps, /−15 %/);
    // La récompense : seulement avec l'adresse du parrain, une seule fois.
    assert.equal((await commander('bob@exemple.ch', { code: merci })).j.code, 'recompense_autre');
    const anaX = (await commander('ana@exemple.ch', { code: merci })).j;   // abandonnée
    db.prepare('UPDATE paiements SET cree_le = ? WHERE commande_id = ?').run(Date.now() - 40 * 60000, anaX.commandeId);
    const ana2 = await commander('ana@exemple.ch', { code: merci });
    assert.equal(ana2.s, 201, JSON.stringify(ana2.j)); await payer(ana2);
    assert.equal((await commander('ana@exemple.ch', { code: merci })).j.code, 'code_epuise');
    const repriseX = await c('POST', `/api/public/${slug}/commandes/${anaX.commandeId}/reprendre`, { jeton: anaX.jeton }, false);
    assert.equal(repriseX.j && repriseX.j.code, 'code_epuise', `récompense à usage unique, même à la reprise : ${JSON.stringify(repriseX.j)}`);
    // Filleul remboursé, ou livré puis retour partiel : pas de récompense.
    const dan = await payer(await commander('dan@exemple.ch', { code: l1.code }));
    db.prepare("UPDATE commandes SET statut = 'remboursee' WHERE id = ?").run(dan.commandeId);
    const fay = await payer(await commander('fay@exemple.ch', { code: l1.code }));
    { const row = db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(fay.commandeId); const d = JSON.parse(row.donnees); d.retoursPartiels = [{ montant: 50 }]; db.prepare("UPDATE commandes SET statut = 'livree', donnees = ? WHERE id = ?").run(JSON.stringify(d), fay.commandeId); }
    gerer.automatisationsEcheances(Date.now() + 60 * 86400000);
    gerer.automatisationsEcheances(Date.now() + 80 * 86400000);
    assert.equal(db.prepare("SELECT statut FROM filleuls WHERE commande_id = ?").get(dan.commandeId).statut, 'annule');
    assert.equal(db.prepare("SELECT statut FROM filleuls WHERE commande_id = ?").get(fay.commandeId).statut, 'annule');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE destinataire = 'ana@exemple.ch' AND sujet LIKE 'Merci !%'").get().n, 1);
    // Relecture 2 : client existant sous un alias, retour partiel puis alias, un seul code par personne, délai repris.
    await payer(await commander('carl@exemple.ch'));   // déjà client, sans code
    assert.equal((await commander('carl+ami@exemple.ch', { code: l1.code })).j.code, 'code_premiere_commande', 'client existant sous un alias');
    assert.equal((await commander('fay+2@exemple.ch', { code: l1.code })).j.code, 'code_premiere_commande', 'filleul revenu avec un alias après un retour partiel');
    { const anaB = await payer(await commander('ana+b@exemple.ch')); assert.equal((await lien(anaB)).j.code, l1.code, 'un seul code pour une adresse et ses alias'); }
    const hal = await payer(await commander('hal@exemple.ch', { code: l1.code }));
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE id = ?").run(hal.commandeId);
    gerer.automatisationsEcheances(Date.now() + 81 * 86400000);   // vue livrée
    db.prepare("UPDATE commandes SET statut = 'expediee' WHERE id = ?").run(hal.commandeId);   // repassée en arrière
    gerer.automatisationsEcheances(Date.now() + 82 * 86400000);
    assert.equal(db.prepare('SELECT livre_le FROM filleuls WHERE commande_id = ?').get(hal.commandeId).livre_le, null, 'délai de rétractation repris à zéro');
    // Même réseau que le parrain : pas de récompense (la remise du filleul reste).
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE id = ?").run(hal.commandeId);
    db.prepare("UPDATE parrains SET reseau = (SELECT json_extract(donnees, '$.reseau') FROM commandes WHERE id = ?)").run(hal.commandeId);
    gerer.automatisationsEcheances(Date.now() + 83 * 86400000);
    gerer.automatisationsEcheances(Date.now() + 98 * 86400000);
    assert.equal(db.prepare('SELECT statut FROM filleuls WHERE commande_id = ?').get(hal.commandeId).statut, 'annule', 'même réseau que le parrain');
    // Effacement du parrain : code, récompenses et index disparaissent.
    // (le saut de 80 jours a fait expirer la session du marchand : nouvelle connexion)
    cookie = ''; assert.equal((await c('POST', '/api/auth/connexion', { email: 'p@exemple.ch', motDePasse: 'un mot de passe solide' })).s, 200);
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE statut IN ('payee', 'attente')").run();   // effacement refusé tant qu'une commande est en cours
    { const r = await c('POST', '/api/admin/clients/effacer', { email: 'ana@exemple.ch' }); assert.equal(r.s, 200, JSON.stringify(r.j)); }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM parrains').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM recompenses').get().n, 0);
  } finally { s.close(); }
});

test('parrainage : e-mail de remerciement dans la langue de la commande du parrain', async () => {
  const EmailsClients = require('../src/emails-clients');
  assert.equal(EmailsClients.recompenseParrainage('fr', {}), null, 'français : texte d’origine');
  assert.equal(EmailsClients.recompenseParrainage('__proto__', {}), null);
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const gerer = s.listeners('request')[0];
  let cookie = '';
  const c = async (m, chemin, corps, avec = true) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avec ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avec) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'de@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Laden', pays: 'ch', langues: ['fr', 'de', 'it'] }, entreprise: { raison: 'L GmbH', adresse: 'Rue 1, 1003 Lausanne', email: 'de@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const vase = (await c('POST', '/api/admin/produits', { produit: { nom: 'Vase', prix: 100, stock: 50 } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j, slug = etat.serveur.slug;
    await c('PUT', '/api/admin/config', { config: { boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, livraisons: etat.livraisons, offres: etat.offres, reglages: etat.reglages, parrainage: { actif: true, filleul: 10, parrain: 12, minimum: 0 } } });
    const commander = (email, extra = {}) => c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: vase, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Lena Muster', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' }, ...extra }, false);
    const payer = async r => { assert.equal(r.s, 201, JSON.stringify(r.j)); await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' }); return r.j; };
    const lena = await payer(await commander('lena@exemple.ch', { langue: 'de' }));
    const code = (await c('POST', `/api/public/${slug}/parrainage`, { commandeId: lena.commandeId, jeton: lena.jeton }, false)).j.code;
    const max = await payer(await commander('max@exemple.ch', { code }));
    db.prepare("UPDATE parrains SET reseau = 'autre'").run();
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE id = ?").run(max.commandeId);
    gerer.automatisationsEcheances(Date.now() + 86400000);
    gerer.automatisationsEcheances(Date.now() + 16 * 86400000);
    const m = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'lena@exemple.ch' AND sujet LIKE 'Danke!%'").get();
    assert.ok(m, 'e-mail en allemand');
    assert.match(m.sujet, /Rabatt von 12 % bei Laden/); assert.match(m.corps, /^Guten Tag Lena,/); assert.match(m.corps, /Dankeschön-Code: MERCI[A-Z2-9]{6}/);
    assert.match(m.corps, new RegExp(`/s/${slug}/\\?code=MERCI[A-Z2-9]{6}&lang=de`), 'lien complet');
    assert.match(m.corps, /\d{1,2}\.\d{1,2}\.\d{4}/, 'date au format suisse allemand');
    // Nouvelle demande de lien depuis une commande en italien : la langue suit ; le pied aussi.
    const lena2 = await payer(await commander('lena@exemple.ch', { langue: 'it' }));
    assert.equal((await c('POST', `/api/public/${slug}/parrainage`, { commandeId: lena2.commandeId, jeton: lena2.jeton }, false)).j.code, code);
    db.prepare("UPDATE parrains SET reseau = 'autre'").run();   // la nouvelle demande a repris le réseau (même poste dans le test)
    const zoe = await payer(await commander('zoe@exemple.ch', { code }));
    db.prepare("UPDATE commandes SET statut = 'livree' WHERE id = ?").run(zoe.commandeId);
    gerer.automatisationsEcheances(Date.now() + 17 * 86400000);
    gerer.automatisationsEcheances(Date.now() + 32 * 86400000);
    const mi = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'lena@exemple.ch' AND sujet LIKE 'Grazie!%'").get();
    assert.ok(mi, 'e-mail en italien'); assert.match(mi.corps, /Contatto/, 'pied en italien'); assert.doesNotMatch(mi.corps, /Contact :/);
  } finally { s.close(); }
});
