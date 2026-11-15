// Rappels de réassort : accord exprès du client, e-mail après N jours avec panier prêt, arrêt en un clic, effacement.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('rappel de réassort : demandé, envoyé, arrêté, effacé', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  const gerer = s.listeners('request')[0];
  const rappels = email => db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = ? AND (sujet LIKE 'Le moment de recommander%' OR sujet LIKE 'Zeit zum%') ORDER BY id").all(email);
  try {
    await c('POST', '/api/auth/inscription', { email: 're@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Torréfaction', pays: 'ch', secteur: 'epicerie', langues: ['fr', 'de'] }, entreprise: { raison: 'Torré Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 're@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    assert.equal((await c('POST', '/api/admin/produits', { produit: { nom: 'Café', prix: 14, stock: 50, reassortJours: 3 } })).j.code, 'reassort_jours');
    const cafe = (await c('POST', '/api/admin/produits', { produit: { nom: 'Café en grains', prix: 14, stock: 50, reassortJours: 30 } })).j.id;
    const the = (await c('POST', '/api/admin/produits', { produit: { nom: 'Thé vert', prix: 9, stock: 50, reassortJours: 21 } })).j.id;
    const tasse = (await c('POST', '/api/admin/produits', { produit: { nom: 'Tasse', prix: 20, stock: 50 } })).j.id;
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const pub = (await c('GET', `/api/public/${slug}`, null, { avecCookie: false })).j.produits;
    assert.equal(pub.find(p => p.id === cafe).reassortJours, 30);
    const commander = async (email, extra) => {
      const r = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: cafe, qte: 2 }, { produitId: the, qte: 1 }, { produitId: tasse, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Ana Rossi', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' }, ...extra }, { avecCookie: false });
      assert.equal(r.s, 201, JSON.stringify(r.j));
      await fetch(r.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
      return r.j;
    };
    // Sans la case : rien.
    await commander('sans@exemple.ch', {});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 0);
    // Case cochée : un rappel, au délai le plus court (thé, 21 jours), pour les produits qui le proposent.
    await commander('ana@exemple.ch', { rappelReassort: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
    const brut = db.prepare('SELECT donnees, email_index FROM reassorts').get();
    assert.match(brut.donnees, /^v\d\./, 'chiffré au repos'); assert.ok(!brut.donnees.includes('ana@') && !brut.email_index.includes('ana@'));
    gerer.automatisationsEcheances(Date.now() + 10 * 86400000);
    assert.equal(rappels('ana@exemple.ch').length, 0, 'trop tôt');
    gerer.automatisationsEcheances(Date.now() + 22 * 86400000);
    const r1 = rappels('ana@exemple.ch');
    assert.equal(r1.length, 1);
    assert.match(r1[0].corps, /- 2 × Café en grains\n- 1 × Thé vert/);
    assert.ok(!r1[0].corps.includes('Tasse'), 'seulement les produits à rappel');
    const panier = r1[0].corps.match(/\?panier=([^\s&]+)/)[1];
    assert.equal(decodeURIComponent(panier), `${cafe}:2,${the}:1`);
    // Même passage dans l'heure : pas de doublon ; 21 jours plus tard : un deuxième rappel.
    gerer.automatisationsEcheances(Date.now() + 22 * 86400000 + 1000);
    assert.equal(rappels('ana@exemple.ch').length, 1);
    gerer.automatisationsEcheances(Date.now() + 44 * 86400000);
    assert.equal(rappels('ana@exemple.ch').length, 2);
    // Lien d'arrêt : la page demande confirmation (GET sans effet), puis POST arrête.
    const lien = r1[0].corps.match(/\/reassort\/arreter\?j=([^\s&]+)/)[1];
    const page = await fetch(`${base}/reassort/arreter?j=${lien}`);
    assert.equal(page.status, 200); assert.match(await page.text(), /Arrêter les rappels/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
    assert.equal((await fetch(`${base}/reassort/arreter?j=${lien}x`, { method: 'POST' })).status, 400, 'signature fausse');
    const fin = await fetch(`${base}/reassort/arreter?j=${lien}`, { method: 'POST' });
    assert.equal(fin.status, 200); assert.match(await fin.text(), /ne recevrez plus/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 0);
    gerer.automatisationsEcheances(Date.now() + 70 * 86400000);
    assert.equal(rappels('ana@exemple.ch').length, 2, 'plus rien après l’arrêt');
    // La confirmation de commande annonce le rappel, avec son lien d'arrêt.
    assert.match(db.prepare("SELECT corps FROM emails WHERE destinataire = 'ana@exemple.ch' AND sujet LIKE 'Commande n°%confirmée'").get().corps, /nous vous rappellerons de recommander dans 21 jours \(rien n’est débité\)\. Pas de rappel : http\S+\/reassort\/arreter\?j=/);
    // Arrêt en un clic aussi par l'en-tête List-Unsubscribe de la messagerie.
    assert.match(db.prepare("SELECT desinscription FROM emails WHERE destinataire = 'ana@exemple.ch' AND sujet LIKE 'Le moment%'").get().desinscription, /\/reassort\/arreter\?j=/);
    // Remboursée : la demande tombe.
    cookie = ''; await c('POST', '/api/auth/connexion', { email: 're@exemple.ch', motDePasse: 'un mot de passe solide' });   // session effacée par l'entretien avancé dans le temps
    const remb = await commander('remb@exemple.ch', { rappelReassort: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts WHERE commande_id = ?').get(remb.commandeId).n, 1);
    assert.equal((await c('POST', `/api/admin/commandes/${remb.commandeId}/statut`, { statut: 'remboursee' })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts WHERE commande_id = ?').get(remb.commandeId).n, 0, 'remboursée : plus de rappel');
    // Produit à variantes : le rappel remet la même variante au panier.
    const tee = (await c('POST', '/api/admin/produits', { produit: { nom: 'Chaussettes', prix: 12, reassortJours: 60, options: [{ nom: 'Pointure', valeurs: ['36-40', '41-46'] }], variantes: [{ id: '36-40', valeurs: ['36-40'], stock: 9 }, { id: '41-46', valeurs: ['41-46'], stock: 9 }] } })).j.id;
    const rv = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: tee, varianteId: '41-46', qte: 3 }], livraison: 'poste-eco', rappelReassort: true, client: { nom: 'Zoé', email: 'zoe@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    assert.equal(rv.s, 201, JSON.stringify(rv.j));
    await fetch(rv.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    db.prepare('UPDATE reassorts SET prochain = ? WHERE commande_id = ?').run(Date.now() - 1000, rv.j.commandeId);
    gerer.automatisationsEcheances(Date.now() + 71 * 86400000);   // calcul au plus une fois par heure : après le dernier passage du test
    const mv = db.prepare("SELECT corps FROM emails WHERE destinataire = 'zoe@exemple.ch' AND sujet LIKE 'Le moment%'").get();
    assert.ok(mv, 'rappel envoyé'); assert.match(mv.corps, /- 3 × Chaussettes \(41-46\)/);
    assert.equal(decodeURIComponent(mv.corps.match(/\?panier=([^\s&]+)/)[1]), `${tee}:3:41-46`);
    db.prepare('DELETE FROM reassorts WHERE commande_id = ?').run(rv.j.commandeId);
    cookie = ''; await c('POST', '/api/auth/connexion', { email: 're@exemple.ch', motDePasse: 'un mot de passe solide' });   // session effacée par l'entretien avancé dans le temps
    // Arrêt par le marchand, depuis la commande.
    const parM = await commander('tel@exemple.ch', { rappelReassort: true });
    assert.ok((await c('GET', '/api/admin/etat')).j.reassortsActifs.includes(parM.commandeId));
    assert.equal((await c('POST', `/api/admin/commandes/${parM.commandeId}/reassort/arreter`, {})).s, 200);
    assert.equal((await c('POST', `/api/admin/commandes/${parM.commandeId}/reassort/arreter`, {})).s, 404);
    assert.ok(!(await c('GET', '/api/admin/etat')).j.reassortsActifs.includes(parM.commandeId));
    // Le client recommande sans cocher la case : son rappel repart de zéro (pas de rappel juste après sa commande).
    const r1c = await commander('re@client.ch', { rappelReassort: true });
    db.prepare('UPDATE reassorts SET prochain = ? WHERE commande_id = ?').run(Date.now() + 86400000, r1c.commandeId);
    await commander('re@client.ch', {});
    assert.ok(db.prepare('SELECT prochain FROM reassorts WHERE commande_id = ?').get(r1c.commandeId).prochain > Date.now() + 20 * 86400000, 'rappel repoussé');
    db.prepare('DELETE FROM reassorts WHERE commande_id = ?').run(r1c.commandeId);
    // Paiement constaté à la main (facture, virement) : la demande est créée comme pour un paiement en ligne.
    const man = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: cafe, qte: 1 }], livraison: 'poste-eco', rappelReassort: true, client: { nom: 'Eva', email: 'eva@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    assert.equal((await c('POST', `/api/admin/commandes/${man.j.commandeId}/statut`, { statut: 'payee' })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts WHERE commande_id = ?').get(man.j.commandeId).n, 1);
    db.prepare('DELETE FROM reassorts WHERE commande_id = ?').run(man.j.commandeId);
    // Précommande : le délai part de la date d'expédition annoncée.
    const plaid = (await c('POST', '/api/admin/produits', { produit: { nom: 'Café de Noël', prix: 20, stock: 9, reassortJours: 30, precommande: true, expeditionPrevue: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10) } })).j.id;
    const rp = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: plaid, qte: 1 }], livraison: 'poste-eco', rappelReassort: true, client: { nom: 'Noé', email: 'noe@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false });
    await fetch(rp.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.ok(db.prepare('SELECT prochain FROM reassorts WHERE commande_id = ?').get(rp.j.commandeId).prochain > Date.now() + 85 * 86400000, 'après l’expédition annoncée');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'noe@exemple.ch' AND corps LIKE '%recommander 30 jours après l’expédition%'").get(), 'confirmation : délai après l’expédition');
    db.prepare('DELETE FROM reassorts WHERE commande_id = ?').run(rp.j.commandeId);
    // Commande en allemand : rappel en allemand. Effacement du client : sa demande disparaît.
    await commander('max@exemple.ch', { rappelReassort: true, langue: 'de' });
    gerer.automatisationsEcheances(Date.now() + 100 * 86400000);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'max@exemple.ch' AND corps LIKE '%erinnern wir Sie in 21 Tagen ans Nachbestellen%' AND corps LIKE '%/reassort/arreter?j=%&lang=de%'").get(), 'confirmation en allemand avec la mention');
    const de = rappels('max@exemple.ch');
    assert.equal(de.length, 1); assert.match(de[0].sujet, /^Zeit zum Nachbestellen bei Torréfaction\?$/); assert.match(de[0].corps, /&lang=de/);
    await commander('lou@exemple.ch', { rappelReassort: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 2);
    db.prepare("UPDATE commandes SET statut = 'livree'").run();
    // (l'entretien avancé dans le temps a effacé la session : nouvelle connexion)
    cookie = ''; await c('POST', '/api/auth/connexion', { email: 're@exemple.ch', motDePasse: 'un mot de passe solide' });
    const eff = await c('POST', '/api/admin/clients/effacer', { email: 'lou@exemple.ch' });
    assert.equal(eff.s, 200, JSON.stringify(eff.j));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 1);
    // Produits supprimés : la demande restante disparaît au passage suivant (pas de données gardées pour rien).
    for (const id of [cafe, the]) assert.equal((await c('DELETE', `/api/admin/produits/${id}`)).s, 200);
    gerer.automatisationsEcheances(Date.now() + 300 * 86400000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reassorts').get().n, 0);
  } finally { s.close(); }
});
