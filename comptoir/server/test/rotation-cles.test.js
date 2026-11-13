// Rotation de SECRET_CHIFFREMENT : l'ancienne clé passe dans SECRET_CHIFFREMENT_ANCIENNES ; au redémarrage, tout reste
// lisible et utilisable, et ce qui peut l'être est rechiffré avec la nouvelle clé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const totp = require('../src/totp');
const Pii = require('../src/pii');
const Fid = require('../src/fidelite');
const Cartes = require('../src/cartes-cadeaux');
const JI = require('../src/journal-inalterable');

const K1 = crypto.randomBytes(32).toString('hex'), K2 = crypto.randomBytes(32).toString('hex'), K3 = crypto.randomBytes(32).toString('hex');

async function demarrer(db, env) {
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const erreurs = [];
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non', ...env }, urlPublique: base, journal: { log() {}, error: (...a) => erreurs.push(a.join(' ')) } }));
  const client = () => {
    const jar = {};
    return async (m, chemin, corps) => {
      const r = await fetch(base + chemin, { method: m, headers: { 'X-Forwarded-For': '198.51.100.1', ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined });
      for (const c of r.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; }
      return { s: r.status, j: await r.json().catch(() => null) };
    };
  };
  return { s, base, client, erreurs };
}

test('rotation de la clé : commandes, devis, webhooks, double authentification, cartes cadeaux et journal survivent', async () => {
  const db = ouvrir(':memory:');
  // --- Avec la clé K1
  let srv = await demarrer(db, { SECRET_CHIFFREMENT: K1 });
  let a = srv.client(), secret, carteCode, slug, bid;
  try {
    assert.equal((await a('POST', '/api/auth/inscription', { email: 'rot@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Rotation', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Rot Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'rot@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 50, type: 'stock' }] })).s, 201);
    const etat = (await a('GET', '/api/admin/etat')).j; slug = etat.serveur.slug; bid = db.prepare('SELECT id FROM boutiques').get().id;
    // Commande payée (client chiffré, index aveugle, facture scellée au journal)
    const cmd = (await srv.client()('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: etat.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Lou Martin', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } })).j;
    await fetch(`${srv.base}/paiement-simule/${cmd.paiementUrl.split('/').pop()}/confirmer`, { method: 'POST', redirect: 'manual' });
    // Devis avec coordonnées du client
    assert.equal((await a('POST', '/api/admin/devis', { client: { raison: 'Hôtel SA', contact: 'Mme Roux', email: 'achats@hotel.ch', adresse: 'Quai 1', npa: '1000', ville: 'Lausanne' }, lignes: [{ produitId: etat.produits[0].id, qte: 2 }] })).s, 201);
    // Carte cadeau émise à la main
    carteCode = (await a('POST', '/api/admin/cartes-cadeaux', { montant: 50 })).j.code;
    assert.ok(carteCode, 'code de la carte rendu à l’émission');
    // Double authentification active
    const prep = await a('POST', '/api/admin/compte/2fa/preparer'); secret = prep.j.secret;
    assert.equal((await a('POST', '/api/admin/compte/2fa/activer', { motDePasse: 'un mot de passe solide', code: totp.code(secret, totp.pasActuel()) })).s, 200);
    // Envoi de webhook en attente, chiffré avec K1 (inséré directement : pas de serveur distant dans ce test)
    db.prepare("INSERT INTO webhooks (id, boutique_id, url, secret, evenements, cree_le) VALUES ('wh_1', ?, 'https://exemple.ch/hook', 's', '[]', 1)").run(bid);
    const P1 = Pii.creer([Buffer.from(K1, 'hex')]);
    db.prepare("INSERT INTO webhook_envois (id, webhook_id, evenement, corps, prochain_essai, cree_le, email_index) VALUES ('we_1', 'wh_1', 'commande.payee', ?, ?, 1, ?)")
      .run(P1.chiffrer({ corps: JSON.stringify({ donnees: { client: { email: 'lou@exemple.ch' } } }) }, { boutique: bid, commande: 'webhook:we_1' }), Date.now() + 3600000, P1.index(bid, 'lou@exemple.ch'));
    assert.equal((await a('POST', '/api/admin/journal-inalterable/verifier')).j.ok, true);
  } finally { srv.s.close(); }

  // --- Rotation : K2 devient la clé, K1 passe dans les anciennes
  srv = await demarrer(db, { SECRET_CHIFFREMENT: K2, SECRET_CHIFFREMENT_ANCIENNES: K1 });
  try {
    const P2 = Pii.creer([Buffer.from(K2, 'hex')]);   // la nouvelle clé seule
    // Commandes : rechiffrées et réindexées avec K2
    const row = db.prepare('SELECT id, boutique_id, donnees, email_index FROM commandes').get();
    assert.equal(P2.dechiffrer(JSON.parse(row.donnees).clientChiffre, { boutique: row.boutique_id, commande: row.id }).email, 'lou@exemple.ch');
    assert.equal(row.email_index, P2.index(bid, 'lou@exemple.ch'), 'index aveugle refait avec la nouvelle clé');
    // Devis et webhook en attente : rechiffrés avec K2 (et le webhook réindexé)
    const dv = db.prepare('SELECT id, boutique_id, donnees FROM devis').get();
    assert.equal(P2.aRenouveler(JSON.parse(dv.donnees).clientChiffre, { boutique: dv.boutique_id, commande: `devis:${dv.id}` }), false);
    const we = db.prepare("SELECT corps, email_index FROM webhook_envois WHERE id = 'we_1'").get();
    assert.match(JSON.parse(P2.dechiffrer(we.corps, { boutique: bid, commande: 'webhook:we_1' }).corps).donnees.client.email, /lou@/);
    assert.equal(we.email_index, P2.index(bid, 'lou@exemple.ch'));
    // Secret de double authentification rechiffré avec K2 : la connexion avec un code de l'application marche
    assert.equal(totp.dechiffrer(Buffer.from(K2, 'hex'), db.prepare('SELECT secret FROM deux_facteurs').get().secret), secret);
    const b = srv.client();
    const c1 = await b('POST', '/api/auth/connexion', { email: 'rot@exemple.ch', motDePasse: 'un mot de passe solide' });
    assert.equal(c1.j.deuxFacteurs, true);
    assert.equal((await b('POST', '/api/auth/connexion/2fa', { defi: c1.j.defi, code: totp.code(secret, totp.pasActuel() + 1) })).s, 200, 'code TOTP accepté après rotation');
    // Commande du client retrouvée par son e-mail (index refait) : la page de commande et les fiches suivent
    assert.equal((await b('GET', '/api/admin/etat')).j.commandes[0].client.email, 'lou@exemple.ch');
    // Carte cadeau : retrouvée par son code, empreinte refaite avec la nouvelle clé
    const avant = db.prepare('SELECT empreinte FROM cartes_cadeaux').get().empreinte;
    const solde = await srv.client()('POST', `/api/public/${slug}/carte-cadeau`, { code: carteCode });
    assert.equal(solde.s, 200, JSON.stringify(solde.j)); assert.equal(solde.j.solde, 50);
    assert.notEqual(db.prepare('SELECT empreinte FROM cartes_cadeaux').get().empreinte, avant, 'empreinte refaite');
    // Journal : les entrées signées avec K1 se vérifient encore ; la rotation est notée ; une nouvelle pièce est signée avec K2
    const jv = (await b('POST', '/api/admin/journal-inalterable/verifier')).j;
    assert.equal(jv.ok, true, JSON.stringify(jv.anomalies)); assert.equal(jv.cleChangee, false);
    assert.equal((await b('GET', '/api/admin/journal-inalterable')).j.rotationsCle, 1);
    assert.deepEqual(srv.erreurs.filter(e => /ATTENTION|illisible/.test(e)), []);
  } finally { srv.s.close(); }

  // --- Ancienne clé oubliée trop tôt : rien n'est perdu en silence, l'exploitant est prévenu
  srv = await demarrer(db, { SECRET_CHIFFREMENT: K3 });
  try {
    assert.ok(srv.erreurs.some(e => /illisibles avec les clés connues|illisible/.test(e)), srv.erreurs.join('\n'));
    assert.ok(srv.erreurs.some(e => /double authentification illisible/.test(e)), 'secrets 2FA illisibles signalés');
  } finally { srv.s.close(); }
});

test('fidélité après rotation : points, historique et réseaux de confiance repris sous la nouvelle empreinte', () => {
  const db = ouvrir(':memory:'), k1 = crypto.randomBytes(32), k2 = crypto.randomBytes(32);
  const A = Fid.creer(db, k1); A.ecrireReglages('b', { actif: true });
  A.crediter('b', 'lou@exemple.ch', 120, { commandeId: 'c1' }); A.reseauSur('b', 'lou@exemple.ch', 'r1');
  const B = Fid.creer(db, [k2, k1]);
  assert.equal(B.solde('b', 'Lou@Exemple.ch'), 120, 'solde retrouvé');
  assert.equal(db.prepare('SELECT COUNT(DISTINCT empreinte) n FROM fidelite_mouvements').get().n, 1, 'une seule empreinte : la nouvelle');
  assert.equal(B.debiter('b', 'lou@exemple.ch', 20), 20);
  assert.equal(B.solde('b', 'lou@exemple.ch'), 100);
  assert.deepEqual(B.verifier('b'), [], 'historique cohérent après la reprise');
  // La nouvelle clé seule retrouve tout (l'ancienne n'est plus nécessaire pour ce client).
  assert.equal(Fid.creer(db, k2).solde('b', 'lou@exemple.ch'), 100);
});

test('cartes cadeaux après rotation : solde et utilisation sans double dépense', () => {
  const db = ouvrir(':memory:'), k1 = crypto.randomBytes(32), k2 = crypto.randomBytes(32);
  const A = Cartes.creer(db, k1);
  const { code } = A.emettre('b', { montant: 30, devise: 'CHF', origine: 'manuelle' });
  const B = Cartes.creer(db, [k2, k1]);
  assert.equal(B.trouver('b', code).solde, 3000);
  assert.equal(Cartes.creer(db, k2).trouver('b', code).solde, 3000, 'empreinte refaite : la nouvelle clé seule suffit');
  assert.equal(Cartes.creer(db, k1).trouver('b', code), null, 'l’ancienne empreinte n’existe plus');
});

test('journal : une entrée signée avec une ancienne clé après une entrée de la nouvelle est signalée', async () => {
  const db = ouvrir(':memory:'), k1 = crypto.randomBytes(32), k2 = crypto.randomBytes(32);
  const piece = n => ({ id: `c${n}`, numero: n, facture: `F-${n}`, dateFacture: n, date: n, lignes: [{ nom: 'x', prix: 10, qte: 1 }], total: 10, port: 0, client: {} });
  const lireCommandes = ids => new Map(ids.map(id => [id, piece(Number(id.slice(1)))]));
  JI.creer(db, k1).sceller('b', piece(1), 1);
  const J2 = JI.creer(db, [k2, k1]);
  J2.sceller('b', piece(2), 2);
  const ok = await J2.verifier('b', { lireCommandes, compteurFactures: 2 });
  assert.equal(ok.anomalies.filter(x => /empreinte|clé plus ancienne/.test(x)).length, 0, JSON.stringify(ok.anomalies));
  // Quelqu'un qui détient l'ancienne clé ajoute une pièce après coup : refusée par l'ordre des clés.
  JI.creer(db, k1).sceller('b', piece(3), 3);
  const r = await JI.creer(db, [k2, k1]).verifier('b', { lireCommandes, compteurFactures: 3 });
  assert.ok(r.anomalies.some(x => /déjà remplacée/.test(x)), JSON.stringify(r.anomalies));
});

test('journal : deux rotations, anciennes clés listées dans n’importe quel ordre ; ancienne clé datée d’après sa rotation signalée', async () => {
  const db = ouvrir(':memory:'), k1 = crypto.randomBytes(32), k2 = crypto.randomBytes(32), k3 = crypto.randomBytes(32);
  const piece = (n, le = n) => ({ id: `c${n}`, numero: n, facture: `F-${n}`, dateFacture: le, date: le, lignes: [{ nom: 'x', prix: 10, qte: 1 }], total: 10, port: 0, client: {} });
  const lireCommandes = ids => new Map(ids.map(id => [id, piece(Number(id.slice(1)))]));
  const suspects = r => r.anomalies.filter(x => /empreinte|suspect/.test(x));
  JI.creer(db, k1).sceller('b', piece(1), 1);
  JI.creer(db, [k2, k1]).sceller('b', piece(2), 2);
  JI.creer(db, [k3, k2, k1]).sceller('b', piece(3), 3);
  // L'exploitant a ajouté les anciennes clés à la suite (la plus ancienne d'abord) : rien de suspect.
  for (const ordre of [[k3, k2, k1], [k3, k1, k2]]) assert.deepEqual(suspects(await JI.creer(db, ordre).verifier('b', { lireCommandes, compteurFactures: 3 })), [], 'ordre des anciennes clés sans effet');
  // Pièce ajoutée plus tard avec la clé k2 (remplacée), datée d'aujourd'hui : signalée.
  const db2 = ouvrir(':memory:');
  JI.creer(db2, k1).sceller('b', piece(1), 1);
  const avecK1 = JI.creer(db2, [k2, k1]);   // rotation notée maintenant
  JI.creer(db2, k1).sceller('b', piece(2, Date.now() + 3600000), Date.now() + 3600000);   // k1 signe encore, après la rotation
  const r = await avecK1.verifier('b', { lireCommandes: ids => new Map(ids.map(id => [id, id === 'c2' ? piece(2, Date.now() + 3600000) : piece(1)])), compteurFactures: 2 });
  assert.ok(r.anomalies.some(x => /datée d’après sa rotation/.test(x)), JSON.stringify(r.anomalies));
});

test('rotation : une commande illisible (ancienne clé oubliée) est rechiffrée et réindexée quand la clé revient', async () => {
  const db = ouvrir(':memory:');
  let srv = await demarrer(db, { SECRET_CHIFFREMENT: K1 });
  let bid;
  try {
    const a = srv.client();
    await a('POST', '/api/auth/inscription', { email: 'oubli@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Oubli', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Oubli Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'oubli@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 50, type: 'stock' }] });
    const etat = (await a('GET', '/api/admin/etat')).j; bid = db.prepare('SELECT id FROM boutiques').get().id;
    const cmd = await srv.client()('POST', `/api/public/${etat.serveur.slug}/commandes`, { lignes: [{ produitId: etat.produits[0].id, qte: 1 }], livraison: 'poste-eco', client: { nom: 'Lou', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } });
    assert.ok(cmd.s < 300, JSON.stringify(cmd.j));
  } finally { srv.s.close(); }
  srv = await demarrer(db, { SECRET_CHIFFREMENT: K2 }); srv.s.close();   // K1 oubliée : illisible, signalé
  assert.ok(srv.erreurs.some(e => /illisibles avec les clés connues/.test(e)));
  srv = await demarrer(db, { SECRET_CHIFFREMENT: K2, SECRET_CHIFFREMENT_ANCIENNES: K1 }); srv.s.close();   // K1 remise
  assert.equal(db.prepare('SELECT email_index FROM commandes').get().email_index, Pii.creer([Buffer.from(K2, 'hex')]).index(bid, 'lou@exemple.ch'), 'réindexée avec la clé courante');
});
