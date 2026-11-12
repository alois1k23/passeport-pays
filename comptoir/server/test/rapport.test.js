// Rapport du lundi : envoyé une fois par semaine, avec les chiffres de la semaine passée ; désactivable.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('rapport hebdomadaire du marchand', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const gerer = creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } });
  s.on('request', gerer);
  try {
    const ins = await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'lundi@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Lundi', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'L', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [{ nom: 'Vase', prix: 40, stock: 9, type: 'stock' }] }) }).then(r => r.json());
    const pub = await fetch(`${base}/api/public/${ins.slug}`).then(r => r.json());
    for (let i = 0; i < 3; i++) { const x = await fetch(`${base}/api/public/${ins.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pub.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'A B', email: `a${i}@x.ch`, adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) }).then(r => r.json()); await fetch(x.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' }); }
    // Commandes datées de la semaine passée ; le lundi suivant à 8 h, le rapport part
    const maintenant = new Date(); const lundi = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + ((8 - maintenant.getDay()) % 7 || 7), 8, 0);
    db.prepare('UPDATE commandes SET date = ?').run(lundi.getTime() - 3 * 86400000);
    gerer.automatisationsEcheances(lundi.getTime());
    const r = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'lundi@exemple.ch' AND sujet LIKE 'Votre semaine%'").all();
    assert.equal(r.length, 1, 'un rapport');
    assert.match(r[0].sujet, /3 commandes/); assert.match(r[0].corps, /Meilleurs produits :\n- Vase : 3 vendus/); assert.match(r[0].corps, /3 commandes à préparer et expédier/);
    assert.doesNotMatch(r[0].corps, /undefined|NaN/);
    gerer.automatisationsEcheances(lundi.getTime() + 3600000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet LIKE 'Votre semaine%'").get().n, 1, 'une seule fois par semaine');
  } finally { s.close(); }
});
