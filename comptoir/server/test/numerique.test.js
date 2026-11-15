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
    const ins = await c('POST', '/api/auth/inscription', { email: 'num@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Num', pays: 'ch', secteur: 'maison', langues: ['fr', 'de'] }, entreprise: { raison: 'Num Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'num@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }] });
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
    // Commande passée en allemand : e-mail des liens en allemand.
    const cmdDe = await commander({ consentementNumerique: true, langue: 'de' });
    assert.equal(cmdDe.s, 201, JSON.stringify(cmdDe.j));
    await fetch(cmdDe.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const mailDe = db.prepare("SELECT sujet, corps FROM emails WHERE sujet LIKE 'Ihre Downloads%'").get();
    assert.ok(mailDe, 'e-mail en allemand');
    assert.match(mailDe.corps, /Vielen Dank für Ihren Einkauf bei Num/);
    assert.match(mailDe.corps, /\/telecharger\/[\w-]+/);
    // Vente en caisse d'un produit numérique : e-mail du client demandé, liens envoyés après l'encaissement.
    assert.equal((await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'especes', cle: 'num-1' })).j.code, 'caisse_email');
    assert.equal((await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'especes', cle: 'num-2', email: 'pas-un-email' })).s, 400);
    // Compte dont l'adresse n'est pas confirmée : pas d'e-mail vers une adresse saisie (sinon, envoi de messages à n'importe qui).
    assert.equal((await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'twint', cle: 'num-2b', email: 'marc@exemple.ch' })).j.code, 'email_non_verifie');
    db.prepare('UPDATE marchands SET email_verifie_le = ?').run(Date.now());
    // Produit numérique sans fichier : refusé en caisse.
    const sansFichier = (await c('POST', '/api/admin/produits', { produit: { nom: 'Sans fichier', prix: 3, stock: 10, numerique: true } })).j.id;
    assert.equal((await c('POST', '/api/admin/caisse', { lignes: [{ produitId: sansFichier, qte: 1 }], moyen: 'twint', cle: 'num-2c', email: 'marc@exemple.ch' })).j.code, 'sans_fichier');
    const vente = await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'twint', cle: 'num-3', email: 'Marc@Exemple.ch' });
    assert.equal(vente.s, 201, JSON.stringify(vente.j));
    const mailCaisse = db.prepare("SELECT destinataire, corps FROM emails WHERE sujet = ?").get(`Vos téléchargements : commande n° ${vente.j.numero}`);
    assert.ok(mailCaisse, 'liens envoyés après la vente en caisse');
    assert.match(mailCaisse.corps, /^Bonjour,\n/, 'pas de « Bonjour Client en boutique »');
    const lienCaisse = mailCaisse.corps.match(/\/telecharger\/([\w-]+)/)[1];
    assert.equal((await fetch(`${base}/telecharger/${lienCaisse}`)).status, 200);
    // Même ticket renvoyé (réseau coupé) : pas de seconde vente ni de second e-mail.
    assert.equal((await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'twint', cle: 'num-3', email: 'Marc@Exemple.ch' })).j.numero, vente.j.numero);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM emails WHERE sujet = ?").get(`Vos téléchargements : commande n° ${vente.j.numero}`).n, 1);
    // Vente hors ligne renvoyée sans e-mail : acceptée (déjà encaissée), le marchand renverra les liens.
    const horsLigne = await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'especes', cle: 'num-4', horsLigneLe: Date.now() - 60000 });
    assert.equal(horsLigne.s, 201);
    assert.equal((await c('POST', `/api/admin/commandes/${horsLigne.j.id}/telechargements`, {})).j.code, 'sans_email');
    assert.equal((await c('POST', `/api/admin/commandes/${horsLigne.j.id}/telechargements`, { email: 'zoe@exemple.ch' })).j.envoyes, 1);
    assert.ok(db.prepare("SELECT 1 FROM emails WHERE destinataire = 'zoe@exemple.ch' AND sujet LIKE 'Vos téléchargements%'").get(), 'liens envoyés à l’adresse donnée');
    assert.equal((await c('POST', `/api/admin/commandes/${horsLigne.j.id}/telechargements`, {})).j.envoyes, 1, 'adresse gardée sur la commande');
    // Vente hors ligne avec une adresse mal tapée : acceptée quand même (déjà encaissée), signalée sur la commande.
    const typo = await c('POST', '/api/admin/caisse', { lignes: [{ produitId: pid, qte: 1 }], moyen: 'especes', cle: 'num-5', horsLigneLe: Date.now() - 60000, email: 'jean@gmail' });
    assert.equal(typo.s, 201, JSON.stringify(typo.j));
    const cTypo = (await c('GET', '/api/admin/etat')).j.commandes.find(x => x.id === typo.j.id);
    assert.equal(cTypo.alerteNumerique, true);
    assert.ok(cTypo.historique.some(h => /e-mail du client invalide/.test(h.texte)));
    // Commande en ligne dont le client a été effacé : aucune adresse ne peut y être remise.
    const cmdEff = await commander({ consentementNumerique: true });
    await fetch(cmdEff.j.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const eff = await c('POST', '/api/admin/clients/effacer', { email: 'lea@exemple.ch' });
    assert.equal(eff.s, 200, JSON.stringify(eff.j));
    assert.equal((await c('POST', `/api/admin/commandes/${cmdEff.j.commandeId}/telechargements`, { email: 'autre@exemple.ch' })).j.code, 'sans_email');
    // Un autre marchand ne touche pas au fichier.
    cookie = '';
    await c('POST', '/api/auth/inscription', { email: 'autre@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Autre' } } });
    assert.equal((await c('POST', `/api/admin/produits/${pid}/fichier/debut`, { nom: 'x.pdf', taille: 10, empreinte })).s, 404);
    assert.equal((await c('DELETE', `/api/admin/produits/${pid}/fichier`)).s, 404);
  } finally { s.close(); }
});
