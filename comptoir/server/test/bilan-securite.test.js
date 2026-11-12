// Bilan de sécurité du compte : protection de la connexion, tentatives suspectes, appareils oubliés, clés d'API dormantes.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('bilan de sécurité', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'bs@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Bilan', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'B', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [] });
    const titre = (b, t) => b.find(x => x.titre === t);
    let b = (await c('GET', '/api/admin/compte/securite')).j.bilan;
    assert.equal(titre(b, 'Mot de passe complété par un second facteur').ok, false);
    assert.equal(b[0].titre, 'Mot de passe complété par un second facteur', 'le plus important en premier');
    assert.equal(titre(b, 'Aucune tentative suspecte').ok, true);
    // Code de double authentification faux après le bon mot de passe, appareil oublié, clé d'API dormante.
    const mid = db.prepare('SELECT id FROM marchands').get().id, bid = db.prepare('SELECT id FROM boutiques').get().id;
    db.prepare("INSERT INTO journal_compte (marchand_id, date, type, detail, reseau) VALUES (?, ?, 'echec-2fa', '', '')").run(mid, Date.now());
    assert.equal(titre((await c('GET', '/api/admin/compte/securite')).j.bilan, 'Aucune tentative suspecte').ok, true, 'une faute de frappe isolée ne déclenche pas l’alerte');
    db.prepare("INSERT INTO journal_compte (marchand_id, date, type, detail, reseau) VALUES (?, ?, 'echec-2fa', '', '')").run(mid, Date.now());
    db.prepare('INSERT INTO sessions (jeton_hash, marchand_id, expire_le, cree_le, vu_le) VALUES (?, ?, ?, ?, ?)').run('x'.repeat(64), mid, Date.now() + 86400000, Date.now() - 60 * 86400000, Date.now() - 45 * 86400000);
    db.prepare("INSERT INTO cles_api (id, boutique_id, nom, prefixe, empreinte, portees, cree_le, utilisee_le, revoquee) VALUES ('k', ?, 'Compta', 'ct_', 'e', '[]', ?, NULL, 0)").run(bid, Date.now() - 120 * 86400000);
    b = (await c('GET', '/api/admin/compte/securite')).j.bilan;
    assert.match(titre(b, 'Aucune tentative suspecte').detail, /2 tentatives avec votre bon mot de passe cette semaine/);
    assert.match(titre(b, 'Appareils inactifs déconnectés').detail, /1 appareil sans activité depuis plus de 30 jours/);
    assert.match(titre(b, 'Clés d’API utilisées').detail, /Compta/);
    assert.equal(titre(b, 'Clés d’API utilisées').cible, 'integrations');
    // Une clé d'accès seule ne protège pas le mot de passe : toujours signalé.
    db.prepare("INSERT INTO cles_acces (id, marchand_id, nom, cle, compteur, cree_le) VALUES ('ca', ?, 'iPhone', 'x', 0, ?)").run(mid, Date.now());
    const p = titre((await c('GET', '/api/admin/compte/securite')).j.bilan, 'Mot de passe complété par un second facteur');
    assert.equal(p.ok, false); assert.match(p.detail, /clé d’accès protège vos propres connexions/);
    assert.equal((await c('GET', '/api/session')).j.compteProtege, false);
  } finally { s.close(); }
});
