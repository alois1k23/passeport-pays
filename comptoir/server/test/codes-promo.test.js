// Codes promo avec limites : montant minimum, nombre total d'utilisations (sans dépassement, même en parallèle), une fois
// par client ; une commande abandonnée rend son utilisation, et la reprise d'un vieux lien ne la dépasse pas.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('codes promo : minimum, utilisations maximales, une fois par client', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = async (m, chemin, corps, cookie) => {
    const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    return { s: r.status, j: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
  };
  try {
    const ins = await appel('POST', '/api/auth/inscription', { email: 'codes@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Codes', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Codes Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'codes@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 500, type: 'stock' }] });
    const cookie = ins.cookie;
    const etat = (await appel('GET', '/api/admin/etat', null, cookie)).j, slug = etat.serveur.slug, produit = etat.produits[0].id;
    const conf = (await appel('GET', '/api/admin/etat', null, cookie)).j;
    conf.offres = { ...(conf.offres || {}), paliersActifs: false, codes: [{ code: 'ETE', remise: 10, minimum: 50, max: 2, unParClient: true }, { code: 'UNIQUE', remise: 20, max: 1 }] };
    assert.equal((await appel('PUT', '/api/admin/config', { config: conf }, cookie)).s, 200);
    const commander = (email, code, qte = 2) => appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte }], livraison: 'poste-eco', code, client: { nom: 'Client', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } });
    const payer = o => appel('POST', `/paiement-simule/${o.j.paiementUrl.split('/').pop()}/confirmer`);

    // Montant minimum : 40 < 50 refusé avec le montant ; 80 accepté. La saisie du code annonce ses conditions.
    assert.equal((await commander('a@exemple.ch', 'ETE', 1)).j.code, 'code_minimum');
    const info = (await appel('POST', `/api/public/${slug}/code`, { code: 'ete' })).j;
    assert.equal(info.minimum, 50); assert.deepEqual(info.conditions.map(x => x.type), ['minimum', 'client']);
    assert.match(info.conditions[0].texte, /^Dès CHF 50\.00 d’achat\.$/);
    const a1 = await commander('a@exemple.ch', 'ETE'); assert.equal(a1.s, 201, JSON.stringify(a1.j)); await payer(a1);
    // Une fois par client : même adresse refusée, autre adresse acceptée.
    assert.equal((await commander('A@Exemple.ch', 'ETE')).j.code, 'code_deja_utilise');
    const b1 = await commander('b@exemple.ch', 'ETE'); assert.equal(b1.s, 201);
    // Deux utilisations au plus (la commande de B, en attente de paiement, compte) : la troisième est refusée.
    assert.equal((await commander('c@exemple.ch', 'ETE')).j.code, 'code_epuise');
    assert.equal((await appel('POST', `/api/public/${slug}/code`, { code: 'ETE' })).j.code, 'code_epuise');
    // B quitte le paiement : son utilisation est rendue, C peut s'en servir.
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${b1.j.commandeId}/abandonner`, { jeton: b1.j.jeton })).s, 200);
    const c1 = await commander('c@exemple.ch', 'ETE'); assert.equal(c1.s, 201, JSON.stringify(c1.j));
    // B reprend son vieux lien plus tard : le code n'a plus d'utilisation libre, la reprise est refusée.
    const rb = await appel('POST', `/api/public/${slug}/commandes/${b1.j.commandeId}/reprendre`, { jeton: b1.j.jeton });
    assert.equal(rb.s, 409); assert.equal(rb.j.code, 'code_epuise');

    // Dernière utilisation demandée par deux clients en même temps : une seule commande l'obtient.
    const [x, y] = await Promise.all([commander('x@exemple.ch', 'UNIQUE'), commander('y@exemple.ch', 'UNIQUE')]);
    assert.deepEqual([x.s, y.s].sort(), [201, 400]);
    assert.equal([x, y].find(r => r.s === 400).j.code, 'code_epuise');
    // Paiement arrivé tard : X avait pris la dernière utilisation de UNIQUE ; son lien a plus de 35 minutes et Z prend
    // l'utilisation libérée ; le paiement de X arrive ensuite : la vente est faite, le dépassement est signalé.
    const gagnant = [x, y].find(r => r.s === 201);
    db.prepare("UPDATE paiements SET cree_le = cree_le - 40 * 60000 WHERE commande_id = ?").run(gagnant.j.commandeId);
    const z = await commander('z@exemple.ch', 'UNIQUE'); assert.equal(z.s, 201, JSON.stringify(z.j));
    await payer(gagnant);
    const tard = (await appel('GET', '/api/admin/etat', null, cookie)).j.commandes.find(c => c.id === gagnant.j.commandeId);
    assert.equal(tard.statut, 'payee'); assert.equal(tard.codeDepasse, true);
    assert.ok(tard.historique.some(h => /Paiement reçu tard/.test(h.texte)));
    // Le marchand voit le nombre d'utilisations calculé par le serveur.
    assert.equal((await appel('GET', '/api/admin/etat', null, cookie)).j.serveur.utilisationsCodes.UNIQUE, 2);
    // Le code utilisé est noté sur la commande (statistiques du marchand).
    const cmds = (await appel('GET', '/api/admin/etat', null, cookie)).j.commandes;
    assert.equal(cmds.filter(c => c.codePromo === 'ETE').length, 3);
    assert.equal(cmds.filter(c => c.codePromo === 'UNIQUE').length, 2);
  } finally { s.close(); }
});

test('montant minimum comparé au panier avec les prix d’offre', () => {
  const R = require('../../js/remises.js');
  const cfg = { offres: { paliersActifs: false, codes: [{ code: 'MIN', remise: 10, minimum: 50 }] } };
  // 40 + article offert à 15 au lieu de 30 : 55 au prix affiché, 55 > 50 : le code s'applique.
  assert.equal(R.appliquer([{ produitId: 'a', prix: 40, qte: 1 }, { produitId: 'b', prix: 30, prixOffre: 15, qte: 1 }], cfg, 'MIN').codeMinimum, null);
  // 30 + offre à 15 (au lieu de 30) : 45 < 50 : pas appliqué, même si le prix plein ferait 60.
  assert.equal(R.appliquer([{ produitId: 'a', prix: 30, qte: 1 }, { produitId: 'b', prix: 30, prixOffre: 15, qte: 1 }], cfg, 'MIN').codeMinimum, 50);
});

test('codes promo : une commande remboursée rend son utilisation ; un code recréé repart de zéro', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = async (m, chemin, corps, cookie) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); return { s: r.status, j: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') }; };
  try {
    const ins = await appel('POST', '/api/auth/inscription', { email: 'rc@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Rc', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Rc Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'rc@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 500, type: 'stock' }] });
    const cookie = ins.cookie, conf = (await appel('GET', '/api/admin/etat', null, cookie)).j, slug = conf.serveur.slug, produit = conf.produits[0].id;
    const poser = async codes => { conf.offres = { ...(conf.offres || {}), paliersActifs: false, codes }; assert.equal((await appel('PUT', '/api/admin/config', { config: conf }, cookie)).s, 200); };
    await poser([{ code: 'UN', remise: 10, max: 1, cree: Date.now() - 1000 }]);
    const commander = email => appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 1 }], livraison: 'poste-eco', code: 'UN', client: { nom: 'C', email, adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } });
    const a = await commander('a@exemple.ch'); assert.equal(a.s, 201);
    await appel('POST', `/paiement-simule/${a.j.paiementUrl.split('/').pop()}/confirmer`);
    assert.equal((await commander('b@exemple.ch')).j.code, 'code_epuise');
    // Commande entièrement remboursée : l'utilisation revient.
    db.prepare("UPDATE commandes SET statut = 'remboursee' WHERE id = ?").run(a.j.commandeId);
    const b = await commander('b@exemple.ch'); assert.equal(b.s, 201, JSON.stringify(b.j));
    await appel('POST', `/paiement-simule/${b.j.paiementUrl.split('/').pop()}/confirmer`);
    assert.equal((await commander('c@exemple.ch')).j.code, 'code_epuise');
    // Code retiré puis recréé (nouvelle date de création) : les commandes d'avant ne comptent plus.
    await poser([]); await poser([{ code: 'UN', remise: 10, max: 1, cree: Date.now() + 10 }]);
    await new Promise(ok => setTimeout(ok, 20));
    assert.equal((await commander('c@exemple.ch')).s, 201);
    assert.equal((await appel('GET', '/api/admin/etat', null, cookie)).j.serveur.utilisationsCodes.UN, 1);
  } finally { s.close(); }
});
