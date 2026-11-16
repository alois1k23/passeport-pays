// Boutique en allemand, italien et anglais : textes des cartes cadeaux et de la fidélité traduits (formulaire d'achat,
// paiement, messages du serveur), e-mails de la carte dans la langue de l'acheteur, code toujours masqué dans la copie.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EmailsClients = require('../src/emails-clients');
const { masquerSecrets } = require('../src/courriel');

const source = fs.readFileSync(path.join(__dirname, '../../js/traductions.js'), 'utf8');
function traducteur(langue) {
  const ctx = { location: { search: `?lang=${langue}`, href: 'http://x/' }, navigator: { languages: [langue] }, localStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: {}, body: null, querySelector: () => null, getElementById: () => null }, MutationObserver: class { observe() {} }, requestAnimationFrame: () => 0, URL, URLSearchParams };
  vm.runInNewContext(`${source}\nthis.T = Traductions;`, ctx);
  ctx.T.demarrer([langue]);
  const t = x => ctx.T.traduireTexte(x); t.annonce = x => ctx.T.traduireAnnonce(x);
  return t;
}

const TEXTES = [
  'Offrir une carte cadeau', 'Valable en ligne et en boutique chez Atelier Nord. Elle est envoyée par e-mail dès le paiement.', 'Montant', 'Votre nom',
  'E-mail de la personne à qui vous l’offrez (facultatif)', 'Son prénom (facultatif)', 'Votre message (facultatif)', 'Payer et envoyer la carte',
  'Utiliser', 'Utiliser mes points de fidélité', 'Recevoir un code', 'Valider', 'À payer', 'Payer avec la carte cadeau', 'Points de fidélité',
  'Cette commande vous rapporte 40 points de fidélité.', 'Carte cadeau acceptée : solde CHF 20.00.', 'Carte cadeau ····K1HB',
  'Vous avez 12 points : utilisables dès 100 points.', 'Utiliser mes 250 points (valeur CHF 2.50)', 'Utiliser mes 250 points (−CHF 2.50)',
  'Carte cadeau inconnue, expirée ou épuisée.', 'Si cette adresse a des points, un code vient d’y être envoyé (valable 15 minutes).',
  'Changer d’adresse ou demander un nouveau code', 'Paiement reçu : la carte cadeau vient de partir par e-mail.',
  'Pas assez de points pour une remise (minimum 100 points).',
  'Facture FA-2026-0001 (PDF)', 'Avoir AV-2026-0002 (PDF)', 'Avoir AV-2026-0003 (PDF, CHF 36.00)', 'Retour du 13.11.2026 : remboursé.',
  'Retour demandé le 13.11.2026 : renvoyez les articles à l’adresse reçue par e-mail.', 'Quantité à retourner : Vase',
  // Nouveautés du 16 novembre : compléments, commande minimum, liens de panier, prix unitaire, allergènes, réassort.
  'Souvent achetés avec', 'Choisir', 'Espace pro', 'TVA comprise', 'Il manque', ', ou choisissez le retrait en magasin.',
  'Commande minimum : CHF 50.00 d’articles.', 'Commande minimum : CHF 30.00 d’articles (sauf retrait en magasin).',
  'Certains articles de ce lien ne sont plus disponibles : les autres sont dans votre panier.', 'Les articles de ce lien ne sont plus disponibles.',
  '6 pièces · CHF 1.00 / pièce', 'contient soja, lait (y compris lactose).', 'Remise · 5 % dès 2 articles',
  'Me rappeler par e-mail de recommander dans 30 jours, avec mon panier prêt (rien n’est débité ; arrêt en un clic dans l’e-mail).',
  // Relecture du chantier 112 : précommandes, espace pro, codes promo, TVA, contenu numérique, créneaux, erreurs du serveur.
  'Entreprise non assujettie à la TVA', 'TTC, TVA incluse', 'Précommander', 'Précommande', 'Précommande · expédition prévue le 06.12.2026',
  ': expédition prévue le 06.12.2026. Vous payez maintenant ; votre commande part dès que l’article arrive.', 'Expédition prévue le 06.12.2026',
  '♥ Mes favoris (3)', 'Espace professionnel', 'Votre entreprise a un compte pro chez Atelier Nord ? Recevez un code par e-mail pour voir vos prix.',
  'Code reçu', 'Se connecter', 'Se déconnecter', 'Tarif professionnel', 'Contient', 'Stock maximum atteint', 'envoi par e-mail',
  'Code ETE appliqué : −10 %. Valable sur une première commande.', 'Code ETE : −10 % dès CHF 30.00 d’achat. Une fois par adresse e-mail.',
  'Remise · Code ETE (−10 %) + offre complémentaire', 'Remise · Offre −15 %', 'Ce code s’applique dès CHF 30.00 d’achat.',
  'Choisissez un créneau de retrait.', 'Ce créneau de retrait vient d’être pris ou n’est plus disponible : choisissez-en un autre.',
  'Pour utiliser vos points, commandez avec l’adresse ana@exemple.ch.', 'Retrait PickPost / My Post 24'
];

for (const langue of ['de', 'it', 'en']) {
  test(`boutique en ${langue} : cartes cadeaux et fidélité entièrement traduites`, () => {
    const t = traducteur(langue);
    const manquants = TEXTES.filter(x => { const r = t(x); return r === null || r === x; });
    assert.deepEqual(manquants, []);
    assert.match(t('Valable en ligne et en boutique chez Atelier Nord. Elle est envoyée par e-mail dès le paiement.'), /Atelier Nord/, 'nom de la boutique gardé');
    assert.match(t('Carte cadeau acceptée : solde CHF 20.00.'), /CHF 20\.00/);
    assert.doesNotMatch(t('contient soja, lait (y compris lactose).'), /lait|soja,/, 'noms des allergènes traduits');
    // Textes du marchand jamais réécrits par un modèle trop large.
    assert.equal(t('Notre thé en favori'), null); assert.equal(t('contient 3 sachets de thé.'), null);
    assert.doesNotMatch(t('Code ETE appliqué : −10 %. Valable sur une première commande.'), /première/, 'condition du code traduite');
    // Annonces pour lecteur d'écran : traduites à part ; jamais appliquées au texte du marchand.
    for (const x of ['Vase ajouté au panier. 2 articles dans le panier.', 'Vase retiré du panier.', 'Vase : quantité 3.']) assert.notEqual(t.annonce(x), x, x);
    assert.equal(t('Le produit a été retiré du panier.'), null, 'texte du marchand intact');
    assert.equal(t('Prix : quantité 3.'), null);
  });
}

test('e-mails de la carte cadeau dans la langue de l’acheteur ; code masqué dans la copie ; français laissé au texte d’origine', () => {
  const o = { nomBoutique: 'Atelier Nord', offerte: true, acheteur: 'Lou', montant: 'CHF 50.00', code: 'ABCD-EFGH-JKMN-PQRS', expireLe: Date.UTC(2028, 10, 13), url: 'https://x/s/atelier-nord', message: 'Joyeux anniversaire', nomDest: 'Sam', email: 'sam@exemple.ch', contact: 'contact@atelier.ch' };
  const de = EmailsClients.carteCadeauCode('de', o), it = EmailsClients.carteCadeauCode('it', o), en = EmailsClients.carteCadeauCode('en', { ...o, offerte: false, message: '' });
  assert.match(de.sujet, /Geschenkgutschein von Atelier Nord für Sie/); assert.match(de.corps, /Guten Tag Sam/); assert.match(de.corps, /geschenkt von Lou/); assert.match(de.corps, /Nachricht von Lou/);
  assert.match(it.corps, /Codice: ABCD-EFGH-JKMN-PQRS/); assert.match(it.corps, /offerta da Lou/);
  assert.match(en.sujet, /^Your gift card from Atelier Nord$/); assert.match(en.corps, /^Hello Sam,/); assert.match(EmailsClients.carteCadeauCode('en', { ...o, nomDest: '' }).corps, /^Hello,/); assert.doesNotMatch(en.corps, /Message from/);
  for (const m of [de, it, en]) { assert.ok(m.corps.includes(o.code)); assert.ok(!masquerSecrets(m.corps).includes(o.code), 'code retiré de la copie gardée'); }
  const avis = EmailsClients.carteCadeauAvis('en', o);
  assert.match(avis.corps, /sent to sam@exemple\.ch/); assert.doesNotMatch(avis.corps, /ABCD/, 'l’avis à l’acheteur ne contient jamais le code');
  assert.equal(EmailsClients.carteCadeauCode('fr', o), null); assert.equal(EmailsClients.carteCadeauCode(undefined, o), null);
});

test('erreurs fixes de la route de commande publique : traduites en allemand, italien et anglais', () => {
  const T = require('../../js/traductions.js');
  const src = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const debut = src.indexOf("r.post('/api/public/:slug/commandes'"), fin = src.indexOf('\n  r.', debut + 10);
  const route = src.slice(debut, fin);
  // Messages littéraux seulement (entre apostrophes droites) ; ceux avec des valeurs sont couverts par des modèles testés plus haut.
  const messages = [...route.matchAll(/erreur\(4\d\d, '((?:[^'\\]|\\.)+)'/g)].map(m => m[1]);
  assert.ok(messages.length >= 8, `messages relevés : ${messages.length}`);
  const manquants = messages.filter(x => ['de', 'it', 'en'].some(l => !T.couvert(x, l)));
  assert.deepEqual(manquants, []);
});
