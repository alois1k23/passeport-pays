// Créneaux de retrait : génération (délai, horizon, capacité, changement d'heure), choix obligatoire, dernière place.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const C = require('../src/creneaux');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('génération des créneaux', () => {
  const r = C.regles({ magasin: { creneaux: { actif: true, jours: { 1: ['09:00', '12:00'], 2: ['14:00', '16:00'], 6: ['10:00', '11:00'] }, duree: 30, capacite: 2, delai: 120, horizon: 7 } } });
  const l = C.liste(r, Date.parse('2026-11-16T07:30:00Z'));   // lundi 8 h 30 à Lausanne
  assert.equal(C.libelle(l[0].debut, l[0].fin), 'lundi 16 novembre, 10 h 30 – 11 h 00', 'délai de préparation de 2 heures');
  assert.equal(l.length, 15);
  // Capacité : un créneau plein disparaît.
  assert.ok(!C.liste(r, Date.parse('2026-11-16T07:30:00Z'), new Map([[l[0].debut, 2]])).some(x => x.debut === l[0].debut));
  // Passage à l'heure d'été (28 mars 2027) : 2 h n'existe pas, aucun créneau fantôme.
  const r2 = C.regles({ magasin: { creneaux: { actif: true, jours: { 0: ['01:00', '04:00'] }, duree: 60, capacite: 1, delai: 60, horizon: 3 } } });
  assert.deepEqual(C.liste(r2, Date.parse('2027-03-27T00:00:00Z')).map(x => C.libelle(x.debut, x.fin)), ['dimanche 28 mars, 01 h 00 – 03 h 00', 'dimanche 28 mars, 03 h 00 – 04 h 00']);
  // Samedi 23 h 30, veille du passage à l'heure d'été : le dimanche n'est pas sauté (jours du calendrier).
  const r4 = C.regles({ magasin: { creneaux: { actif: true, jours: { 0: ['10:00', '11:00'], 1: ['10:00', '11:00'] }, duree: 60, capacite: 1, delai: 60, horizon: 3 } } });
  assert.deepEqual(C.liste(r4, Date.parse('2027-03-27T22:30:00Z')).map(x => C.libelle(x.debut, x.fin).split(',')[0]), ['dimanche 28 mars', 'lundi 29 mars']);
  // Automne (heure répétée) : chaque jour une seule fois, horizon complet.
  const r5 = C.regles({ magasin: { creneaux: { actif: true, jours: { 0: ['10:00', '11:00'], 1: ['10:00', '11:00'], 6: ['10:00', '11:00'], 2: ['10:00', '11:00'] }, duree: 60, capacite: 1, delai: 60, horizon: 3 } } });
  assert.deepEqual(C.liste(r5, Date.parse('2026-10-23T22:30:00Z')).map(x => C.libelle(x.debut, x.fin).split(',')[0]), ['samedi 24 octobre', 'dimanche 25 octobre', 'lundi 26 octobre', 'mardi 27 octobre']);
  // Réservations comptées par chevauchement (durée changée de 30 à 60 minutes).
  const r6 = C.regles({ magasin: { creneaux: { actif: true, jours: { 1: ['10:00', '12:00'] }, duree: 60, capacite: 1, delai: 60, horizon: 1 } } });
  const l6 = C.liste(r6, Date.parse('2026-11-16T06:00:00Z'));
  assert.equal(C.liste(r6, Date.parse('2026-11-16T06:00:00Z'), [{ debut: l6[0].debut + 30 * 60000, fin: l6[0].debut + 60 * 60000 }]).length, l6.length - 1);
  // Valeurs bornées (configuration venue du navigateur).
  const r3 = C.regles({ magasin: { creneaux: { actif: true, jours: { 1: ['25:00', '26:00'], 2: ['12:00', '11:00'], 3: ['<b>', '9:00'] }, duree: 7, capacite: 9999, delai: 5, horizon: 365 } } });
  assert.equal(r3.actif, false); assert.equal(r3.duree, 30); assert.equal(r3.capacite, 50); assert.equal(r3.delai, 120); assert.equal(r3.horizon, 7);
});

test('créneaux à la commande : obligatoire, revérifié, dernière place', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'cr@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Retrait', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Ret Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'cr@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const pid = (await c('POST', '/api/admin/produits', { produit: { nom: 'Bougie', prix: 24, stock: 9 } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j, slug = etat.serveur.slug;
    const tous = { 0: ['00:00', '23:45'], 1: ['00:00', '23:45'], 2: ['00:00', '23:45'], 3: ['00:00', '23:45'], 4: ['00:00', '23:45'], 5: ['00:00', '23:45'], 6: ['00:00', '23:45'] };
    assert.equal((await c('PUT', '/api/admin/config', { config: { ...etat, magasin: { ...etat.magasin, adresse: 'Rue 1, Lausanne', clickCollect: true, creneaux: { actif: true, jours: tous, duree: 60, capacite: 1, delai: 60, horizon: 3 } } } })).s, 200);
    assert.equal((await c('GET', `/api/public/${slug}`, null, { avecCookie: false })).j.creneaux, true);
    const liste = (await c('GET', `/api/public/${slug}/creneaux`, null, { avecCookie: false })).j.creneaux;
    assert.ok(liste.length > 20 && liste[0].libelle.includes(' h '));
    const commander = (extra, email = 'ana@exemple.ch') => c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'retrait', client: { nom: 'Ana', email, ville: 'Lausanne' }, ...extra }, { avecCookie: false });
    assert.equal((await commander({})).j.code, 'creneau_requis');
    assert.equal((await commander({ creneau: liste[0].debut + 60000 })).j.code, 'creneau_pris', 'heure inventée refusée');
    const ok = await commander({ creneau: liste[0].debut });
    assert.equal(ok.s, 201, JSON.stringify(ok.j));
    // Capacité 1 : la place est prise (même en attente de paiement), le créneau disparaît de la liste.
    assert.equal((await commander({ creneau: liste[0].debut }, 'lou@exemple.ch')).j.code, 'creneau_pris');
    assert.ok(!(await c('GET', `/api/public/${slug}/creneaux`, null, { avecCookie: false })).j.creneaux.some(x => x.debut === liste[0].debut));
    // Un même réseau ne retient pas plus de 2 créneaux sans payer.
    const deux = await commander({ creneau: liste[1].debut }, 'b@exemple.ch');
    assert.equal(deux.s, 201, JSON.stringify(deux.j));
    assert.equal((await commander({ creneau: liste[2].debut }, 'c@exemple.ch')).j.code, 'creneau_limite');
    // Réservation impayée de plus de 35 minutes : la place se libère ; le paiement repris plus tard est refusé si elle a été reprise.
    db.prepare('UPDATE commandes SET date = ? WHERE id = ?').run(Date.now() - 40 * 60000, deux.j.commandeId);
    const reprise = await commander({ creneau: liste[1].debut }, 'd@exemple.ch');
    assert.equal(reprise.s, 201, 'place libérée après 35 minutes');
    const jeton = db.prepare('SELECT jeton_client FROM commandes WHERE id = ?').get(deux.j.commandeId).jeton_client;
    assert.equal((await c('POST', `/api/public/${slug}/commandes/${deux.j.commandeId}/reprendre`, { jeton }, { avecCookie: false })).j.code, 'creneau_pris', 'paiement repris pour un créneau repris : refusé');
    await fetch(ok.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const cmd = (await c('GET', '/api/admin/etat')).j.commandes.find(x => x.id === ok.j.commandeId);
    assert.equal(cmd.retraitCreneau, liste[0].debut); assert.equal(cmd.retraitCreneauFin, liste[0].debut + 3600000);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'ana@exemple.ch' AND corps LIKE '%Retrait prévu : %'").get(), 'créneau dans la confirmation');
    // Commande annulée : la place se libère.
    db.prepare("UPDATE commandes SET statut = 'annulee' WHERE id = ?").run(ok.j.commandeId);
    assert.ok((await c('GET', `/api/public/${slug}/creneaux`, null, { avecCookie: false })).j.creneaux.some(x => x.debut === liste[0].debut));
    // Livraison à domicile : aucun créneau demandé.
    assert.equal((await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Max', email: 'max@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { avecCookie: false })).s, 201);
  } finally { s.close(); }
});
