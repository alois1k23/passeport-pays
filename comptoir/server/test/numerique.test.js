// Produits numériques : fichier envoyé en morceaux (empreinte contrôlée), commande sans adresse avec consentement,
// liens personnels après paiement (5 téléchargements, 30 jours), refus après remboursement, renvoi par le marchand.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const { nomSur, dispositionPieceJointe } = require('../src/numerique');

test('noms de fichiers et en-tête de pièce jointe', () => {
  assert.equal(nomSur('../../etc/passwd'), null);
  assert.equal(nomSur('virus.exe'), null);
  assert.equal(nomSur('.pdf'), null);
  assert.deepEqual(nomSur('C:\\docs\\Livre « été ».PDF'), { nom: 'Livre « été ».PDF', ext: 'pdf', type: 'application/pdf' });
  assert.equal(nomSur('a\u202Efdp.exe'), null, 'inversion du sens retirée : l’extension réelle .exe est refusée');
  assert.equal(nomSur('a\u202Egnp.pdf').nom, 'agnp.pdf');
  assert.match(dispositionPieceJointe('Été "2026".pdf'), /^attachment; filename="Ete _2026_.pdf"; filename\*=UTF-8''%C3%89t%C3%A9%20%222026%22.pdf$/);
});

test('produit numérique de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps, { avecCookie = true } = {}) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie && avecCookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc && avecCookie) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    const ins = await c('POST', '/api/auth/inscription', { email: 'num@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Num', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Num Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'num@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] });
    const pid = (await c('POST', '/api/admin/produits', { produit: { nom: 'Guide de Lausanne (PDF)', prix: 12, stock: 1000, numerique: true } })).j.id;
    // Sans fichier : pas en vente (le client paierait sans rien recevoir).
    const slug0 = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    assert.ok(!(await c('GET', `/api/public/${slug0}`, null, { avecCookie: false })).j.produits.some(p => p.id === pid));
    // Fichier de 2,5 Mo en 3 morceaux.
    const fichier = crypto.randomBytes(2.5 * 1024 * 1024), empreinte = crypto.createHash('sha256').update(fichier).digest('hex');
    assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/debut`, { nom: 'guide.exe', taille: fichier.length, empreinte })).j.code, 'fichier_type');
    assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/debut`, { nom: 'guide.pdf', taille: 26 * 1024 * 1024, empreinte })).j.code, 'fichier_taille');
    const d = (await c('POST', `/api/admin/produits/${pid}/fichier/debut`, { nom: 'Guide Lausanne.pdf', taille: fichier.length, empreinte })).j;
    assert.equal(d.morceaux, 3);
    for (let i = 0; i < 3; i++) assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/morceau`, { envoi: d.envoi, rang: i, donnees: fichier.subarray(i * d.morceau, (i + 1) * d.morceau).toString('base64') })).s, 200);
    assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/morceau`, { envoi: d.envoi, rang: 0, donnees: 'AAAA' })).j.code, 'morceau_invalide', 'taille inattendue');
    const fin = await c('POST', `/api/admin/produits/${pid}/fichier/fin`, { envoi: d.envoi });
    assert.equal(fin.s, 200, JSON.stringify(fin.j)); assert.equal(fin.j.fichier.taille, fichier.length);
    // Empreinte fausse : refusé, rien enregistré à la place.
    const d2 = (await c('POST', `/api/admin/produits/${pid}/fichier/debut`, { nom: 'autre.pdf', taille: 10, empreinte: '0'.repeat(64) })).j;
    await c('POST', `/api/admin/produits/${pid}/fichier/morceau`, { envoi: d2.envoi, rang: 0, donnees: Buffer.alloc(10).toString('base64') });
    assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/fin`, { envoi: d2.envoi })).j.code, 'fichier_empreinte');
    const etat = (await c('GET', '/api/admin/etat')).j;
    assert.equal(etat.produits.find(p => p.id === pid).fichier.nom, 'Guide Lausanne.pdf');
    // Commande numérique : sans consentement refusée, puis sans adresse.
    const slug = etat.serveur.slug;
    const commander = corps => c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }], livraison: 'numerique', client: { nom: 'Léa Dupont', email: 'lea@exemple.ch' }, ...corps }, { avecCookie: false });
    assert.equal((await commander({})).j.code, 'consentement_numerique');
    const cmd = await commander({ consentementNumerique: true });
    assert.equal(cmd.s, 201, JSON.stringify(cmd.j));
    // Panier mixte : l'envoi par e-mail n'est pas un mode de livraison possible.
    const vase = etat.produits.find(p => p.nom === 'Vase').id;
    assert.equal((await c('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: pid, qte: 1 }, { produitId: vase, qte: 1 }], livraison: 'numerique', consentementNumerique: true, client: { nom: 'Léa Dupont', email: 'lea@exemple.ch' } }, { avecCookie: false })).j.code, 'livraison_invalide');
    // Paiement : liens envoyés, commande livrée.
    await fetch(cmd.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const row = db.prepare('SELECT statut, donnees FROM commandes WHERE id = ?').get(cmd.j.commandeId);
    assert.equal(row.statut, 'livree');
    const mail = db.prepare("SELECT corps FROM emails WHERE sujet LIKE 'Vos téléchargements%'").get();
    const lien = mail.corps.match(/\/telecharger\/([\w-]+)/)[1];
    assert.ok(!db.prepare('SELECT 1 FROM telechargements WHERE jeton_hash = ?').get(lien), 'jeton jamais gardé en clair');
    // HEAD (aperçu de lien, antivirus de messagerie) : réponse sans décompter un téléchargement.
    assert.equal((await fetch(`${base}/telecharger/${lien}`, { method: 'HEAD' })).status, 200);
    assert.equal(db.prepare('SELECT restants FROM telechargements').get().restants, 5);
    // Lien masqué dans le journal des e-mails une fois envoyé.
    assert.equal(require('../src/courriel').masquerSecrets(mail.corps).includes(lien), false);
    const t = await fetch(`${base}/telecharger/${lien}`);
    assert.equal(t.status, 200);
    assert.match(t.headers.get('content-disposition'), /^attachment; filename="Guide Lausanne.pdf"/);
    assert.equal(t.headers.get('content-type'), 'application/octet-stream');
    assert.match(t.headers.get('content-security-policy'), /sandbox/);
    assert.ok(Buffer.from(await t.arrayBuffer()).equals(fichier), 'fichier identique');
    for (let i = 0; i < 4; i++) assert.equal((await fetch(`${base}/telecharger/${lien}`)).status, 200);
    assert.equal((await fetch(`${base}/telecharger/${lien}`)).status, 429, 'cinq téléchargements au plus');
    assert.equal((await fetch(`${base}/telecharger/faux${lien}`)).status, 404);
    // Renvoi par le marchand : nouveau lien, l'ancien ne vaut plus rien.
    assert.equal((await c('POST', `/api/admin/commandes/${cmd.j.commandeId}/telechargements`)).j.envoyes, 1);
    const nouveau = db.prepare("SELECT corps FROM emails WHERE sujet LIKE 'Vos téléchargements%' ORDER BY id DESC").get().corps.match(/\/telecharger\/([\w-]+)/)[1];
    assert.notEqual(nouveau, lien);
    assert.equal((await fetch(`${base}/telecharger/${nouveau}`)).status, 200);
    assert.equal((await c('GET', `/api/admin/commandes/${cmd.j.commandeId}/telechargements`)).j.liens[0].restants, 4);
    // Commande remboursée : plus aucun téléchargement.
    db.prepare("UPDATE commandes SET statut = 'remboursee' WHERE id = ?").run(cmd.j.commandeId);
    assert.equal((await fetch(`${base}/telecharger/${nouveau}`)).status, 410);
    // Un autre marchand ne touche pas au fichier.
    cookie = '';
    await c('POST', '/api/auth/inscription', { email: 'autre@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Autre' } } });
    assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/debut`, { nom: 'x.pdf', taille: 10, empreinte })).s, 404);
    assert.equal((await c('DELETE', `/api/admin/produits/${pid}/fichier`)).s, 404);
  } finally { s.close(); }
});
