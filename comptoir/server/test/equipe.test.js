// Équipe : invitation, acceptation, rôles « commandes » et « complet », traçabilité, retrait.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('équipe de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const client = () => { const jar = {}; return async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; } return { s: r.status, j: await r.json().catch(() => null) }; }; };
  const lienInvitation = email => /invitation=([\w-]+)/.exec(db.prepare("SELECT corps FROM emails WHERE destinataire = ? AND sujet LIKE 'Invitation%' ORDER BY id DESC").get(email).corps)[1];
  try {
    const p = client();
    const ins = await p('POST', '/api/auth/inscription', { email: 'patronne@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Équipe', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'E', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 9, type: 'stock' }] });
    const { url } = (await p('POST', '/api/abonnement/commencer', { formule: 'croissance' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.equal((await p('POST', '/api/admin/equipe/inviter', { email: 'patronne@exemple.ch', role: 'commandes' })).s, 409, 'adresse déjà utilisée');
    assert.equal((await p('POST', '/api/admin/equipe/inviter', { email: 'leo@exemple.ch', role: 'commandes' })).s, 201);
    assert.equal((await p('POST', '/api/admin/equipe/inviter', { email: 'mia@exemple.ch', role: 'complet' })).s, 201);
    // Léo accepte (rôle commandes)
    const leo = client(), jl = lienInvitation('leo@exemple.ch');
    assert.equal((await leo('GET', `/api/auth/invitation?jeton=${jl}`)).j.boutique, 'Équipe');
    assert.equal((await leo('POST', '/api/auth/invitation', { jeton: jl, motDePasse: 'azerty123!' })).s, 400, 'politique de mot de passe');
    assert.equal((await leo('POST', '/api/auth/invitation', { jeton: jl, motDePasse: 'un autre mot de passe solide' })).s, 201);
    assert.equal((await client()('POST', '/api/auth/invitation', { jeton: jl, motDePasse: 'un autre mot de passe solide' })).s, 404, 'invitation à usage unique');
    const sess = (await leo('GET', '/api/session')).j;
    assert.equal(sess.role, 'commandes'); assert.equal(sess.slug, ins.j.slug); assert.equal(sess.abonnement.actif, true, 'abonnement du propriétaire');
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'patronne@exemple.ch' AND sujet LIKE '%a rejoint votre équipe'").get());
    // Une commande payée
    const pub = (await p('GET', `/api/public/${ins.j.slug}`)).j;
    const cmd = await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A B', email: 'ab@x.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json());
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    // Léo : voit et prépare les commandes, rien d'autre
    assert.equal((await leo('GET', '/api/admin/etat')).s, 200);
    { const r = await leo('POST', `/api/admin/commandes/${cmd.commandeId}/statut`, { statut: 'preparation' }); assert.equal(r.s, 200, JSON.stringify(r.j)); }
    const histo = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(cmd.commandeId).donnees).historique;
    assert.ok(histo.some(h => /\(par leo@exemple\.ch\)$/.test(h.texte)), 'action tracée au nom du membre');
    assert.equal((await leo('POST', `/api/admin/commandes/${cmd.commandeId}/statut`, { statut: 'remboursee' })).s, 403, 'pas de remboursement');
    assert.equal((await leo('PUT', '/api/admin/config', { config: {} })).s, 403, 'pas de réglages');
    assert.equal((await leo('GET', '/api/admin/integrations')).s, 403);
    assert.equal((await leo('GET', '/api/admin/equipe')).s, 403);
    assert.equal((await leo('POST', '/api/abonnement/commencer', { formule: 'pro' })).s, 403, 'pas d’abonnement');
    assert.equal((await leo('GET', '/api/admin/compte/securite')).s, 200, 'sa propre sécurité reste accessible');
    // Mia : gestion complète, sauf intégrations, équipe et paiements
    const mia = client();
    assert.equal((await mia('POST', '/api/auth/invitation', { jeton: lienInvitation('mia@exemple.ch'), motDePasse: 'encore un mot de passe solide' })).s, 201);
    assert.equal((await mia('GET', '/api/admin/clients/export?email=ab@x.ch')).s, 200);
    assert.equal((await mia('GET', '/api/admin/integrations')).s, 403);
    assert.equal((await mia('POST', '/api/admin/reinitialiser', {})).s, 403, 'pas de remise à zéro');
    // Liste et retrait
    const eq = (await p('GET', '/api/admin/equipe')).j;
    assert.deepEqual(eq.membres.map(x => x.email).sort(), ['leo@exemple.ch', 'mia@exemple.ch']);
    const idLeo = eq.membres.find(x => x.email === 'leo@exemple.ch').id;
    assert.equal((await p('POST', `/api/admin/equipe/${idLeo}/retirer`)).s, 200);
    assert.equal((await leo('GET', '/api/admin/etat')).s, 401, 'accès coupé immédiatement');
    // Suppression du compte du propriétaire : les comptes de l'équipe disparaissent aussi
    assert.equal((await p('POST', '/api/admin/compte/supprimer', { motDePasse: 'un mot de passe solide' })).s, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM marchands').get().n, 0);
  } finally { s.close(); }
});
