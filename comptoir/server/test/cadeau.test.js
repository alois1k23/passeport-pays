// Emballage cadeau : proposé par la boutique, message nettoyé, chiffré avec les données du client, effacé avec elles.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('emballage cadeau : option de la boutique, message, effacement', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'cad@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Cadeaux', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Cad Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'cad@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const pid = (await c('POST', '/api/admin/produits', { produit: { nom: 'Bougie', prix: 24, stock: 9 } })).j.id;
    const etat = (await c('GET', '/api/admin/etat')).j, slug = etat.serveur.slug;
    const commander = async corps => { const r = await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Ana', email: 'ana@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' }, ...corps }, { avecCookie: false }); assert.equal(r.s, 201, JSON.stringify(r.j)); return r.j; };
    // Pas proposé : la demande est ignorée.
    assert.equal((await c('GET', `/api/public/${slug}`, null, { avecCookie: false })).j.cadeau, false);
    const sans = await commander({ cadeau: true, messageCadeau: 'Coucou' });
    assert.ok(!(await c('GET', '/api/admin/etat')).j.commandes.find(x => x.id === sans.commandeId).cadeau);
    // Proposé par la boutique.
    assert.equal((await c('PUT', '/api/admin/config', { config: { ...etat, reglages: { ...etat.reglages, emballageCadeau: true } } })).s, 200);
    assert.equal((await c('GET', `/api/public/${slug}`, null, { avecCookie: false })).j.cadeau, true);
    const avec = await commander({ cadeau: true, messageCadeau: 'Joyeux anniversaire\u0007 Léa !\n\n\n\nBises‮' + 'x'.repeat(400) });
    const cmd = (await c('GET', '/api/admin/etat')).j.commandes.find(x => x.id === avec.commandeId);
    assert.equal(cmd.cadeau, true);
    assert.match(cmd.client.messageCadeau, /^Joyeux anniversaire  Léa !\n\nBises x+$/, 'caractères de contrôle et d’inversion retirés, lignes vides réduites');
    assert.equal(cmd.client.messageCadeau.length, 300);
    assert.ok(!db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(avec.commandeId).donnees.includes('anniversaire'), 'message chiffré avec les données du client');
    await fetch(avec.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'cad@exemple.ch' AND corps LIKE '%Emballage cadeau demandé%'").get(), 'marchand prévenu');
    // Effacement des données du client : le message part avec elles.
    db.prepare("UPDATE commandes SET statut = 'livree'").run();
    assert.equal((await c('POST', '/api/admin/clients/effacer', { email: 'ana@exemple.ch' })).s, 200);
    assert.equal((await c('GET', '/api/admin/etat')).j.commandes.find(x => x.id === avec.commandeId).client.messageCadeau, undefined);
  } finally { s.close(); }
});
