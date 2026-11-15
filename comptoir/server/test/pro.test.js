// Clients professionnels : comptes ouverts par le marchand, connexion par code reçu par e-mail (sans révéler qui est
// client pro), remise et facture appliquées par le serveur, plafond des factures impayées.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('clients professionnels de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  const pub = (m, chemin, corps) => c(m, chemin, corps, { avecCookie: false });
  try {
    await c('POST', '/api/auth/inscription', { email: 'gros@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Gros', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Gros Sàrl', adresse: 'Rue du Lac 1, 1003 Lausanne', email: 'gros@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA', iban: 'CH93 0076 2011 6238 5295 7' } } });
    const pid = (await c('POST', '/api/admin/produits', { produit: { nom: 'Nappe', prix: 100, stock: 50 } })).j.id;
    // Comptes pro : validation.
    assert.equal((await c('POST', '/api/admin/pro', { email: 'pas-un-email', raison: 'X' })).j.code, 'pro_email');
    assert.equal((await c('POST', '/api/admin/pro', { email: 'a@b.ch', raison: 'X', remise: 60 })).j.code, 'pro_remise');
    const cpt = await c('POST', '/api/admin/pro', { email: 'Achats@HotelDuLac.ch', raison: 'Hôtel du Lac SA', ide: 'CHE-111.222.333', remise: 15, facture: true, plafond: 150 });
    assert.equal(cpt.s, 201, JSON.stringify(cpt.j));
    assert.equal((await c('POST', '/api/admin/pro', { email: 'achats@hoteldulac.ch', raison: 'Doublon' })).j.code, 'pro_doublon');
    assert.ok(!JSON.stringify(db.prepare('SELECT donnees FROM clients_pro').all()).includes('Hôtel'), 'raison sociale chiffrée au repos');
    const liste = (await c('GET', '/api/admin/pro')).j;
    assert.equal(liste.clients[0].raison, 'Hôtel du Lac SA'); assert.equal(liste.factureDisponible, true);
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    // Code : même réponse pour une adresse inconnue (aucun e-mail), un code pour l'adresse pro.
    const mails = () => db.prepare("SELECT corps FROM emails WHERE sujet LIKE 'Votre code d’accès professionnel%' ORDER BY id DESC").all();
    const inconnu = await pub('POST', `/api/public/${slug}/pro/code`, { email: 'inconnu@exemple.ch' });
    assert.equal(inconnu.s, 200); assert.ok(inconnu.j.demande); assert.equal(mails().length, 0);
    const d = await pub('POST', `/api/public/${slug}/pro/code`, { email: 'achats@hoteldulac.ch' });
    const code = mails()[0].corps.match(/: (\d{6})/)[1];
    assert.equal((await pub('POST', `/api/public/${slug}/pro/connexion`, { email: 'achats@hoteldulac.ch', demande: d.j.demande, code: code === '000000' ? '111111' : '000000' })).j.code, 'pro_code');
    assert.equal((await pub('POST', `/api/public/${slug}/pro/connexion`, { email: 'achats@hoteldulac.ch', demande: inconnu.j.demande, code })).j.code, 'pro_code', 'code d’une autre demande');
    const cx = await pub('POST', `/api/public/${slug}/pro/connexion`, { email: 'achats@hoteldulac.ch', demande: d.j.demande, code });
    assert.equal(cx.s, 200); assert.deepEqual(cx.j.pro, { raison: 'Hôtel du Lac SA', remise: 15, facture: true });
    assert.equal((await pub('POST', `/api/public/${slug}/pro/connexion`, { email: 'achats@hoteldulac.ch', demande: d.j.demande, code })).s, 401, 'code à usage unique');
    const jeton = cx.j.jeton;
    assert.equal((await pub('POST', `/api/public/${slug}/pro/moi`, { jeton })).j.pro.raison, 'Hôtel du Lac SA');
    // Commande pro : remise appliquée par le serveur ; autre adresse, code promo : refusés.
    const client = email => ({ nom: 'Marc Favre', email, adresse: 'Quai 2', npa: '1006', ville: 'Lausanne' });
    const commander = extra => pub('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: client('achats@hoteldulac.ch'), pro: jeton, ...extra });
    assert.equal((await commander({ client: client('autre@exemple.ch') })).j.code, 'pro_email');
    assert.equal((await commander({ code: 'BIENVENUE10' })).j.code, 'pro_cumul');
    assert.equal((await commander({ pro: 'x'.repeat(43) })).j.code, 'pro_session');
    const o1 = await commander({ moyen: 'facture' });
    assert.equal(o1.s, 201, JSON.stringify(o1.j));
    const c1 = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(o1.j.commandeId).donnees);
    assert.equal(c1.lignes[0].prix, 85); assert.equal(c1.moyen, 'facture'); assert.equal(c1.pro.id, cpt.j.client.id);
    assert.ok(!db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(o1.j.commandeId).donnees.includes('Hôtel du Lac'), 'raison sociale chiffrée avec le client');
    assert.equal((await c('GET', '/api/admin/etat')).j.commandes.find(x => x.id === o1.j.commandeId).client.entreprise, 'Hôtel du Lac SA');
    // Plafond : 150, une facture de 85 (+ port) encore impayée : une seconde est refusée.
    assert.equal((await commander({ moyen: 'facture' })).j.code, 'pro_plafond');
    // Sans compte pro, la facture n'est pas proposée par cette boutique.
    assert.equal((await pub('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: client('x@exemple.ch'), moyen: 'facture' })).j.code, 'moyen_invalide');
    // 20 codes faux en 24 h sur le compte (tous réseaux) : bloqué, même avec le bon code ; le marchand est prévenu.
    for (let k = 0; k < 20; k++) {
      const dd = await pub('POST', `/api/public/${slug}/pro/code`, { email: 'achats@hoteldulac.ch' });
      await pub('POST', `/api/public/${slug}/pro/connexion`, { email: 'achats@hoteldulac.ch', demande: dd.j.demande, code: '000000' === mails()[0].corps.match(/: (\d{6})/)[1] ? '111111' : '000000' });
    }
    const avantBlocage = mails().length;
    const d3 = await pub('POST', `/api/public/${slug}/pro/code`, { email: 'achats@hoteldulac.ch' });
    assert.equal(mails().length, avantBlocage, 'bloqué : plus de code envoyé');
    assert.equal((await pub('POST', `/api/public/${slug}/pro/connexion`, { email: 'achats@hoteldulac.ch', demande: d3.j.demande, code: '123456' })).j.code, 'pro_code');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE sujet = 'Espace pro : connexions bloquées pour un client'").get());
    // Compte supprimé : la session ne vaut plus rien.
    assert.equal((await c('DELETE', `/api/admin/pro/${cpt.j.client.id}`)).s, 200);
    assert.equal((await pub('POST', `/api/public/${slug}/pro/moi`, { jeton })).j.pro, null);
    assert.equal((await commander({})).j.code, 'pro_session');
  } finally { s.close(); }
});
