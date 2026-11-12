// Retours : demande du client dans le délai (14 jours en France, délai du marchand en Suisse), marchand prévenu.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('demande de retour de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const boutique = async (email, pays, entreprise) => {
    const m = client();
    const ins = await m('POST', '/api/auth/inscription', { email, motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Retours ' + pays, pays, secteur: 'maison', sections: [] }, entreprise: { raison: 'R', adresse: pays === 'ch' ? 'Rue 1, 1003 Lausanne' : '14 rue des Tanneurs, 69001 Lyon', ...entreprise } }, produits: [{ nom: 'Vase', prix: 40, stock: 9, type: 'stock' }, { nom: 'Lampe', prix: 60, stock: 9, type: 'stock' }] });
    const pub = (await m('GET', `/api/public/${ins.j.slug}`)).j;
    const cmd = await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: pub.produits.map(p => ({ produitId: p.id, qte: 2 })), livraison: Object.keys(pub.livraisons)[0], client: { nom: 'Lou Martin', email: `lou-${pays}@exemple.fr`, adresse: 'Rue 2', npa: pays === 'ch' ? '1006' : '69002', ville: 'Ville' } }) }).then(r => r.json());
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    for (const st of ['preparation', 'expediee', 'livree']) await m('POST', `/api/admin/commandes/${cmd.commandeId}/statut`, { statut: st, suivi: 'X1' });
    return { m, slug: ins.j.slug, cmd, pub };
  };
  try {
    const fr = await boutique('fr@exemple.fr', 'fr', {});
    const suivi = await fetch(`${base}/api/public/${fr.slug}/commandes/${fr.cmd.commandeId}?jeton=${fr.cmd.jeton}`).then(r => r.json());
    assert.equal(suivi.retourPossible, true, 'France : rétractation 14 jours');
    const demande = { jeton: fr.cmd.jeton, lignes: [{ produitId: fr.pub.produits[0].id, qte: 1 }], motif: 'Trop petit' };
    assert.equal((await fetch(`${base}/api/public/${fr.slug}/commandes/${fr.cmd.commandeId}/retour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...demande, jeton: 'faux' }) })).status, 404);
    assert.equal((await fetch(`${base}/api/public/${fr.slug}/commandes/${fr.cmd.commandeId}/retour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demande) })).status, 201);
    assert.equal((await fetch(`${base}/api/public/${fr.slug}/commandes/${fr.cmd.commandeId}/retour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demande) })).status, 409, 'une seule demande');
    const c = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(fr.cmd.commandeId).donnees);
    assert.equal(c.retour.statut, 'demande'); assert.equal(c.retour.montant, c.lignes.find(l => l.produitId === fr.pub.produits[0].id).prix, 'montant au prix réellement payé'); assert.equal(c.retour.motif, 'Trop petit');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'fr@exemple.fr' AND sujet LIKE 'Retour demandé%'").get(), 'marchand prévenu');
    assert.match(db.prepare("SELECT corps FROM emails WHERE destinataire = 'lou-fr@exemple.fr' AND sujet LIKE 'Votre demande de retour%'").get().corps, /69001 Lyon/, 'adresse de retour envoyée au client');
    // Remboursement : retour clos
    assert.equal((await fr.m('POST', `/api/admin/commandes/${fr.cmd.commandeId}/statut`, { statut: 'remboursee' })).s, 200);
    assert.equal(JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(fr.cmd.commandeId).donnees).retour.statut, 'rembourse');
    // Délai dépassé
    db.prepare("UPDATE commandes SET donnees = json_set(donnees, '$.historique', json('[]')), date = ? WHERE id = ?").run(Date.now() - 40 * 86400000, fr.cmd.commandeId);
    // Suisse sans politique de retour : pas de demande possible
    const ch = await boutique('ch@exemple.ch', 'ch', {});
    const s2 = await fetch(`${base}/api/public/${ch.slug}/commandes/${ch.cmd.commandeId}?jeton=${ch.cmd.jeton}`).then(r => r.json());
    assert.equal(s2.retourPossible, false, 'Suisse : pas de droit de rétractation général');
    assert.equal((await fetch(`${base}/api/public/${ch.slug}/commandes/${ch.cmd.commandeId}/retour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jeton: ch.cmd.jeton, lignes: [{ produitId: ch.pub.produits[0].id, qte: 1 }] }) })).status, 409);
  } finally { s.close(); }
});

test('mes commandes : liens envoyés à l’adresse, réponse identique sinon', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  try {
    const ins = await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'mc@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'MC', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'M', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 9, type: 'stock' }] }) }).then(r => r.json());
    const pub = await fetch(`${base}/api/public/${ins.slug}`).then(r => r.json());
    const cmd = await fetch(`${base}/api/public/${ins.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Zoé', email: 'Zoe@Exemple.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json());
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const demander = email => fetch(`${base}/api/public/${ins.slug}/mes-commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).then(async r => ({ s: r.status, j: await r.json() }));
    const inconnu = await demander('personne@exemple.ch'), connu = await demander('zoe@exemple.ch');
    assert.deepEqual(inconnu, connu, 'même réponse');
    const m = db.prepare("SELECT corps FROM emails WHERE destinataire = 'zoe@exemple.ch' AND sujet LIKE 'Vos commandes%'").get();
    assert.match(m.corps, new RegExp(`n° ${cmd.numero} .*commande=${cmd.commandeId}&jeton=`));
    assert.ok(!db.prepare("SELECT 1 FROM emails WHERE destinataire = 'personne@exemple.ch'").get());
  } finally { s.close(); }
});
