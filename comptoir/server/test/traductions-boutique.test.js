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
  return t => ctx.T.traduireTexte(t);
}

const TEXTES = [
  'Offrir une carte cadeau', 'Valable en ligne et en boutique chez Atelier Nord. Elle est envoyée par e-mail dès le paiement.', 'Montant', 'Votre nom',
  'E-mail de la personne à qui vous l’offrez (facultatif)', 'Son prénom (facultatif)', 'Votre message (facultatif)', 'Payer et envoyer la carte',
  'Utiliser', 'Utiliser mes points de fidélité', 'Recevoir un code', 'Valider', 'À payer', 'Payer avec la carte cadeau', 'Points de fidélité',
  'Cette commande vous rapporte 40 points de fidélité.', 'Carte cadeau acceptée : solde CHF 20.00.', 'Carte cadeau ····K1HB',
  'Vous avez 12 points : utilisables dès 100 points.', 'Utiliser mes 250 points (valeur CHF 2.50)', 'Utiliser mes 250 points (−CHF 2.50)',
  'Carte cadeau inconnue, expirée ou épuisée.', 'Si cette adresse a des points, un code vient d’y être envoyé (valable 15 minutes).',
  'Changer d’adresse ou demander un nouveau code', 'Paiement reçu : la carte cadeau vient de partir par e-mail.',
  'Pas assez de points pour une remise (minimum 100 points).', 'Vase ajouté au panier. 2 articles dans le panier.', 'Vase retiré du panier.', 'Vase : quantité 3.',
  'Facture FA-2026-0001 (PDF)', 'Avoir AV-2026-0002 (PDF)', 'Avoir AV-2026-0003 (PDF, CHF 36.00)', 'Retour du 13.11.2026 : remboursé.',
  'Retour demandé le 13.11.2026 : renvoyez les articles à l’adresse reçue par e-mail.', 'Quantité à retourner : Vase'
];

for (const langue of ['de', 'it', 'en']) {
  test(`boutique en ${langue} : cartes cadeaux et fidélité entièrement traduites`, () => {
    const t = traducteur(langue);
    const manquants = TEXTES.filter(x => { const r = t(x); return r === null || r === x; });
    assert.deepEqual(manquants, []);
    assert.match(t('Valable en ligne et en boutique chez Atelier Nord. Elle est envoyée par e-mail dès le paiement.'), /Atelier Nord/, 'nom de la boutique gardé');
    assert.match(t('Carte cadeau acceptée : solde CHF 20.00.'), /CHF 20\.00/);
  });
}

test('e-mails de la carte cadeau dans la langue de l’acheteur ; code masqué dans la copie ; français laissé au texte d’origine', () => {
  const o = { nomBoutique: 'Atelier Nord', offerte: true, acheteur: 'Lou', montant: 'CHF 50.00', code: 'ABCD-EFGH-JKMN-PQRS', expireLe: Date.UTC(2028, 10, 13), url: 'https://x/s/atelier-nord', message: 'Joyeux anniversaire', nomDest: 'Sam', email: 'sam@exemple.ch', contact: 'contact@atelier.ch' };
  const de = EmailsClients.carteCadeauCode('de', o), it = EmailsClients.carteCadeauCode('it', o), en = EmailsClients.carteCadeauCode('en', { ...o, offerte: false, message: '' });
  assert.match(de.sujet, /Geschenkgutschein von Atelier Nord für Sie/); assert.match(de.corps, /Guten Tag Sam/); assert.match(de.corps, /geschenkt von Lou/); assert.match(de.corps, /Nachricht von Lou/);
  assert.match(it.corps, /Codice: ABCD-EFGH-JKMN-PQRS/); assert.match(it.corps, /offerta da Lou/);
  assert.match(en.sujet, /^Your Atelier Nord gift card$/); assert.match(en.corps, /^Hello Sam,/); assert.match(EmailsClients.carteCadeauCode('en', { ...o, nomDest: '' }).corps, /^Hello,/); assert.doesNotMatch(en.corps, /Message from/);
  for (const m of [de, it, en]) { assert.ok(m.corps.includes(o.code)); assert.ok(!masquerSecrets(m.corps).includes(o.code), 'code retiré de la copie gardée'); }
  const avis = EmailsClients.carteCadeauAvis('en', o);
  assert.match(avis.corps, /sent to sam@exemple\.ch/); assert.doesNotMatch(avis.corps, /ABCD/, 'l’avis à l’acheteur ne contient jamais le code');
  assert.equal(EmailsClients.carteCadeauCode('fr', o), null); assert.equal(EmailsClients.carteCadeauCode(undefined, o), null);
});
