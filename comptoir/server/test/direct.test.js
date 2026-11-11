// Tableau de bord en direct : flux SSE, nouvelle commande poussée, session révoquée = flux fermé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('flux en direct : commande payée poussée, fermeture à la déconnexion', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', FLUX_INTERVALLE_MS: '50', FLUX_CONTROLE_MS: '200' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined, redirect: 'manual' }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  const ins = await c('POST', '/api/auth/inscription', { email: 'direct@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Direct', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'D', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] });
  // Ouverture du flux
  const recu = []; let fin = false;
  const req = http.get(base + '/api/admin/flux', { headers: { Cookie: cookie } });
  const reponse = await new Promise(ok => req.on('response', ok));
  assert.equal(reponse.statusCode, 200); assert.match(reponse.headers['content-type'], /text\/event-stream/);
  reponse.setEncoding('utf8'); reponse.on('data', d => recu.push(d)); reponse.on('end', () => { fin = true; });
  try {
    const pub = (await c('GET', `/api/public/${ins.j.slug}`)).j;
    const cmd = (await fetch(`${base}/api/public/${ins.j.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A B', email: 'ab@x.ch', adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json()));
    await fetch(cmd.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const t0 = Date.now(); while (!recu.join('').includes('event: maj') && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 30));
    const txt = recu.join(''), maj = /event: maj\ndata: (.*)\n/.exec(txt);
    assert.ok(maj, 'mise à jour poussée : ' + txt);
    assert.ok(JSON.parse(maj[1]).nouvelles.some(n => n.numero === cmd.numero), 'numéro de la nouvelle commande transmis');
    // Sans session : refus
    assert.equal((await fetch(base + '/api/admin/flux')).status, 401);
    // Déconnexion : le flux se ferme (contrôle de session)
    db.prepare('DELETE FROM sessions').run();
    db.prepare("UPDATE commandes SET statut = 'preparation'").run();
    const t1 = Date.now(); while (!fin && Date.now() - t1 < 35000) await new Promise(r => setTimeout(r, 100));
    assert.ok(fin, 'flux fermé après la fin de session');
  } finally { req.destroy(); s.close(); s.closeAllConnections(); }
});
