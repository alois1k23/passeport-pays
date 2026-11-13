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
    // Avoirs de la semaine sur une commande : un retour partiel (12,00) et un geste commercial (3,00).
    const row = db.prepare('SELECT id, donnees FROM commandes ORDER BY numero LIMIT 1').get(), d = JSON.parse(row.donnees);
    d.facture = d.facture || 'FA-2026-0099'; d.payeLe = d.payeLe || lundi.getTime() - 3 * 86400000;
    d.retoursPartiels = [{ numero: 'AV-2026-0101', date: lundi.getTime() - 2 * 86400000, lignes: [{ index: 0, qte: 1, montant: 1200 }], port: 0, montant: 1200, argent: 1200, carte: 0 },
      { numero: 'AV-2026-0102', date: lundi.getTime() - 86400000, geste: true, lignes: [{ index: 0, qte: 0, montant: 300 }], port: 0, montant: 300, argent: 300, carte: 0 }];
    db.prepare('UPDATE commandes SET donnees = ?, maj_le = ? WHERE id = ?').run(JSON.stringify(d), lundi.getTime() - 86400000, row.id);
    gerer.automatisationsEcheances(lundi.getTime());
    const r = db.prepare("SELECT sujet, corps FROM emails WHERE destinataire = 'lundi@exemple.ch' AND sujet LIKE 'Votre semaine%'").all();
    assert.equal(r.length, 1, 'un rapport');
    assert.match(r[0].sujet, /3 commandes/); assert.match(r[0].corps, /Meilleurs produits :\n- Vase : 3 vendus/); assert.match(r[0].corps, /3 commandes à préparer et expédier/);
    assert.match(r[0].corps, /- Remboursements : CHF 15\.00 \(2 avoirs, dont 1 geste commercial pour CHF 3\.00\)/);
    assert.doesNotMatch(r[0].corps, /undefined|NaN/);
    gerer.automatisationsEcheances(lundi.getTime() + 3600000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet LIKE 'Votre semaine%'").get().n, 1, 'une seule fois par semaine');
    // Semaine suivante : aucune commande récente, mais un geste commercial sur une commande ancienne → rapport quand même.
    const lundi2 = lundi.getTime() + 7 * 86400000;
    db.prepare('UPDATE commandes SET date = ?').run(lundi2 - 40 * 86400000);
    const d2 = JSON.parse(db.prepare('SELECT donnees FROM commandes WHERE id = ?').get(row.id).donnees);
    d2.retoursPartiels.push({ numero: 'AV-2026-0103', date: lundi2 - 86400000, geste: true, lignes: [{ index: 0, qte: 0, montant: 500 }], port: 0, montant: 500, argent: 500, carte: 0 });
    db.prepare('UPDATE commandes SET donnees = ?, maj_le = ? WHERE id = ?').run(JSON.stringify(d2), lundi2 - 86400000, row.id);
    gerer.automatisationsEcheances(lundi2);
    const r2 = db.prepare("SELECT corps FROM emails WHERE destinataire = 'lundi@exemple.ch' AND sujet LIKE 'Votre semaine%' ORDER BY rowid DESC").get();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet LIKE 'Votre semaine%'").get().n, 2, 'rapport envoyé malgré l’absence de commande récente');
    assert.match(r2.corps, /- Remboursements : CHF 5\.00 \(1 avoir, dont 1 geste commercial/);
  } finally { s.close(); }
});
