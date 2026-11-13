// Boutique publique durcie (relecture adversariale, chantier 45) : texte du client sans lien dans les e-mails de la
// boutique, réservations de stock bornées par réseau, code de bienvenue ni publié ni utilisable deux fois.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

async function demarrer() {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const appel = async (m, chemin, corps, { cookie, ip = '198.51.100.1' } = {}) => {
    const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'X-Forwarded-For': ip, ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
    return { s: r.status, j: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
  };
  const ins = await appel('POST', '/api/auth/inscription', { email: 'durcie@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Durcie', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Durcie Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'durcie@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 15, type: 'stock' }] });
  const etat = (await appel('GET', '/api/admin/etat', null, { cookie: ins.cookie })).j;
  const commander = (client, opts = {}, extra = {}) => appel('POST', `/api/public/${etat.serveur.slug}/commandes`, { lignes: [{ produitId: etat.produits[0].id, qte: extra.qte || 1 }], livraison: 'poste-eco', client: { nom: 'Lou', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne', ...client }, ...extra.corps }, opts);
  return { db, s, appel, etat, commander, cookie: ins.cookie };
}

test('nom et adresse du client : une seule ligne, sans lien ni adresse de site (repris dans les e-mails de la boutique)', async () => {
  const { s, appel, commander, cookie } = await demarrer();
  try {
    // Sauts de ligne et caractères de contrôle : remplacés par des espaces.
    const r = await commander({ nom: 'Lou\nMartin', adresse: 'Rue 3\r\nCopie : x', ville: 'Lausanne\u202E' });
    assert.equal(r.s, 201, JSON.stringify(r.j));
    const c = (await appel('GET', '/api/admin/etat', null, { cookie })).j.commandes[0].client;
    assert.equal(c.nom, 'Lou Martin'); assert.equal(c.adresse, 'Rue 3 Copie : x'); assert.equal(c.ville, 'Lausanne');
    // Un lien, même maquillé, est refusé avec un message clair (jamais réécrit en silence : le nom va sur la facture).
    for (const nom of ['Client, ALERTE https://evil.example/v', 'Voir www.piege.example', 'evil[.]example', 'Lou 1.2.3.4/login', 'Café.fr Sàrl'])
      assert.equal((await commander({ nom }, { ip: '203.0.113.30' })).j.code, 'nom_invalide', nom);
    assert.equal((await commander({ ville: 'Lausanne https://x.example' }, { ip: '203.0.113.31' })).j.code, 'ville_invalide');
    // Les vrais noms passent tels quels.
    for (const [k, nom] of ['J. Dupont', 'Müller & Co.', 'St.Gallen Sàrl', 'Dr. Med. Weber'].entries()) {
      const ok = await commander({ nom, email: `n${k}@exemple.ch` }, { ip: `203.0.113.${40 + k}` });
      assert.equal(ok.s, 201, `${nom} : ${JSON.stringify(ok.j)}`);
    }
  } finally { s.close(); }
});

test('réservations de stock : un même réseau ne retient pas tout le stock avec des adresses jetables', async () => {
  const { s, commander } = await demarrer();
  try {
    // Une seule commande impayée ne retient pas plus de la moitié du stock (15 → 8).
    assert.equal((await commander({ email: 'a0@jetable.example' }, { ip: '198.51.100.77' }, { qte: 15 })).j.code, 'trop_reserve');
    // 5 sur 15 : accepté ; puis 5 de plus du même réseau, autre adresse : 10 > 8 → refusé.
    assert.equal((await commander({ email: 'a1@jetable.example' }, {}, { qte: 5 })).s, 201);
    const r2 = await commander({ email: 'a2@jetable.example' }, {}, { qte: 5 });
    assert.equal(r2.s, 429); assert.equal(r2.j.code, 'trop_reserve');
    // Le vrai client, ailleurs, achète.
    assert.equal((await commander({ email: 'vrai@exemple.ch' }, { ip: '203.0.113.9' }, { qte: 1 })).s, 201);
    // Un client qui recommence sa propre commande (même adresse) n'est pas bloqué.
    assert.equal((await commander({ email: 'a1@jetable.example' }, {}, { qte: 5 })).s, 201);
  } finally { s.close(); }
});

test('code de bienvenue : jamais publié, et pas deux commandes en attente avec lui', async () => {
  const { s, appel, etat, commander } = await demarrer();
  try {
    const pub = (await appel('GET', `/api/public/${etat.serveur.slug}`)).j;
    assert.equal(pub.newsletter.code, true, 'seulement « il y a un code »');
    assert.ok(!JSON.stringify(pub).includes('BIENVENUE10'), 'le code n’est pas dans la vitrine publique');
    const o1 = await commander({ email: 'vic@exemple.ch' }, {}, { corps: { code: 'BIENVENUE10' } });
    assert.equal(o1.s, 201, JSON.stringify(o1.j));
    const o2 = await commander({ email: 'vic@exemple.ch' }, { ip: '203.0.113.20' }, { corps: { code: 'BIENVENUE10' } });
    assert.equal(o2.j.code, 'code_premiere_commande', 'deuxième commande ouverte avec le même code : refusée');
  } finally { s.close(); }
});

test('paiement repris plus tard (lien de relance) : stock revérifié et réservé de nouveau', async () => {
  const { db, s, appel, etat, commander } = await demarrer();
  try {
    const slug = etat.serveur.slug;
    db.prepare("UPDATE produits SET donnees = json_set(donnees, '$.stock', 1)").run();
    const x = await commander({ email: 'x@exemple.ch' });
    assert.equal(x.s, 201);
    // Deux heures plus tard, la réservation de X est échue ; Y achète et paie le dernier exemplaire.
    db.prepare('UPDATE commandes SET date = date - 2 * 3600000 WHERE id = ?').run(x.j.commandeId);
    const y = await commander({ email: 'y@exemple.ch' }, { ip: '203.0.113.50' });
    assert.equal(y.s, 201, JSON.stringify(y.j));
    await appel('POST', `/paiement-simule/${y.j.paiementUrl.split('/').pop()}/confirmer`);
    // X reprend son paiement par le lien de relance : refusé, l'article n'est plus là (pas de vente en double).
    const rx = await appel('POST', `/api/public/${slug}/commandes/${x.j.commandeId}/reprendre`, { jeton: x.j.jeton });
    assert.equal(rx.s, 409); assert.equal(rx.j.code, 'stock_insuffisant');
    // Stock remis à 2 : X reprend, et sa réservation repart de maintenant (Z, un autre client, ne peut plus le prendre).
    db.prepare("UPDATE produits SET donnees = json_set(donnees, '$.stock', 1)").run();
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${x.j.commandeId}/reprendre`, { jeton: x.j.jeton })).s, 200);
    assert.equal((await commander({ email: 'z@exemple.ch' }, { ip: '203.0.113.51' })).j.code, 'stock_insuffisant');
  } finally { s.close(); }
});

test('code de bienvenue : le client qui annule son paiement recommence avec le code ; l’ancienne commande ne repart pas avec', async () => {
  const { db, s, appel, etat, commander } = await demarrer();
  try {
    const slug = etat.serveur.slug;
    const o1 = await commander({ email: 'eve@exemple.ch' }, {}, { corps: { code: 'BIENVENUE10' } });
    assert.equal(o1.s, 201, JSON.stringify(o1.j));
    // Le client annule sur la page de paiement (la boutique appelle « abandonner ») puis recommence avec le code.
    assert.equal((await appel('POST', `/api/public/${slug}/commandes/${o1.j.commandeId}/abandonner`, { jeton: o1.j.jeton })).s, 200);
    const o2 = await commander({ email: 'eve@exemple.ch' }, {}, { corps: { code: 'BIENVENUE10' } });
    assert.equal(o2.s, 201, JSON.stringify(o2.j));
    // L'ancienne commande ne peut plus être reprise avec le code tant que la nouvelle est ouverte.
    const r1 = await appel('POST', `/api/public/${slug}/commandes/${o1.j.commandeId}/reprendre`, { jeton: o1.j.jeton });
    assert.equal(r1.s, 409); assert.equal(r1.j.code, 'code_premiere_commande');
  } finally { s.close(); }
});
