/* E-mails aux clients dans leur langue (allemand, italien, anglais) quand ils ont commandé dans cette langue.
   Le français reste le texte d'origine d'app.js. Les noms des produits et de la boutique ne sont pas traduits ;
   les informations légales (droit de rétractation) restent en français, annoncées dans la langue du client. */
'use strict';
const T = {
  de: { bonjour: n => `Guten Tag ${n}`, merci: s => `Vielen Dank für Ihre Bestellung bei ${s}.`, sujetConfirmation: n => `Bestellung Nr. ${n} bestätigt`,
    retrait: 'Wir melden uns, sobald Ihre Bestellung zur Abholung bereit ist.', expedition: 'Wir melden uns beim Versand, mit der Sendungsnummer.', suivre: 'Bestellung verfolgen',
    question: e => `Eine Frage? Antworten Sie einfach auf diese E-Mail${e ? ` oder schreiben Sie an ${e}` : ''}.`, sujetExpedition: n => `Ihre Bestellung Nr. ${n} ist unterwegs`,
    colisParti: t => `Ihr Paket wurde${t ? ` mit ${t}` : ''} versandt.`, numeroSuivi: 'Sendungsnummer', suivreColis: 'Paket verfolgen', votreCommande: 'Ihre Bestellung', aBientot: 'Vielen Dank und bis bald',
    totalPaye: 'Bezahlter Betrag', livraison: 'Versand', offerte: 'gratis', retraitGratuit: 'Abholung im Geschäft: gratis', remise: (m, e) => `(Preis nach Rabatt${m ? `: ${m}` : ''}, ${e} gespart)`,
    sujetFacture: n => `Bestellung Nr. ${n}: Ihre QR-Rechnung`, facture: (url, mt, ech) => `Ihre QR-Rechnung (mit Ihrer Banking-App bezahlen, QR-Code scannen):\n${url}\n\nBetrag: ${mt} · zahlbar bis ${ech}.\nIhre Bestellung wird nach Zahlungseingang vorbereitet.`,
    legal: 'Rechtliche Hinweise (auf Französisch, massgebende Fassung):', dateLocale: 'de-CH' },
  it: { bonjour: n => `Buongiorno ${n}`, merci: s => `Grazie per il tuo ordine presso ${s}.`, sujetConfirmation: n => `Ordine n. ${n} confermato`,
    retrait: 'Ti scriviamo appena l’ordine è pronto per il ritiro.', expedition: 'Ti scriviamo alla spedizione, con il numero di tracciamento.', suivre: 'Segui il tuo ordine',
    question: e => `Una domanda? Rispondi a questa e-mail${e ? ` o scrivi a ${e}` : ''}.`, sujetExpedition: n => `Il tuo ordine n. ${n} è in viaggio`,
    colisParti: t => `Il tuo pacco è partito${t ? ` con ${t}` : ''}.`, numeroSuivi: 'Numero di tracciamento', suivreColis: 'Segui il pacco', votreCommande: 'Il tuo ordine', aBientot: 'Grazie e a presto',
    totalPaye: 'Totale pagato', livraison: 'Spedizione', offerte: 'gratuita', retraitGratuit: 'Ritiro in negozio: gratuito', remise: (m, e) => `(prezzo scontato${m ? `: ${m}` : ''}, risparmio di ${e})`,
    sujetFacture: n => `Ordine n. ${n}: la tua fattura QR`, facture: (url, mt, ech) => `La tua fattura QR (da pagare con l’app della tua banca, scansionando il codice QR):\n${url}\n\nImporto: ${mt} · da pagare entro il ${ech}.\nIl tuo ordine viene preparato alla ricezione del pagamento.`,
    legal: 'Informazioni legali (in francese, versione che fa fede):', dateLocale: 'it-CH' },
  en: { bonjour: n => `Hello ${n}`, merci: s => `Thank you for your order at ${s}.`, sujetConfirmation: n => `Order no. ${n} confirmed`,
    retrait: 'We will email you as soon as your order is ready for pickup.', expedition: 'We will email you when it ships, with the tracking number.', suivre: 'Track your order',
    question: e => `A question? Just reply to this email${e ? ` or write to ${e}` : ''}.`, sujetExpedition: n => `Your order no. ${n} is on its way`,
    colisParti: t => `Your parcel has shipped${t ? ` with ${t}` : ''}.`, numeroSuivi: 'Tracking number', suivreColis: 'Track the parcel', votreCommande: 'Your order', aBientot: 'Thank you and see you soon',
    totalPaye: 'Total paid', livraison: 'Shipping', offerte: 'free', retraitGratuit: 'In-store pickup: free', remise: (m, e) => `(discounted price${m ? `: ${m}` : ''}, you saved ${e})`,
    sujetFacture: n => `Order no. ${n}: your QR invoice`, facture: (url, mt, ech) => `Your QR invoice (pay with your banking app by scanning the QR code):\n${url}\n\nAmount: ${mt} · payable by ${ech}.\nYour order is prepared once payment is received.`,
    legal: 'Legal information (in French, the prevailing version):', dateLocale: 'en-GB' }
};
const langueDe = c => (c && T[c.langue]) ? c.langue : null;

function recapitulatif(t, c, { formatMontant, nomLivraison }) {
  return [
    ...c.lignes.map(l => `- ${l.qte} × ${l.nom} : ${formatMontant(l.prix * l.qte)}`),
    ...(c.remise ? [`  ${t.remise(c.motifRemise, formatMontant(c.remise))}`] : []),
    c.livraison === 'retrait' ? `- ${t.retraitGratuit}` : `- ${t.livraison} (${nomLivraison}) : ${c.port ? formatMontant(c.port) : t.offerte}`,
    `${t.totalPaye} : ${formatMontant(c.total)}`
  ].join('\n');
}
function confirmation(c, o) {
  const t = T[langueDe(c)];
  return { sujet: t.sujetConfirmation(c.numero), corps: `${t.bonjour(c.client.nom)},\n\n${t.merci(o.nomBoutique)}\n\n${recapitulatif(t, c, o)}\n\n${c.livraison === 'retrait' ? t.retrait : t.expedition}\n${t.suivre} : ${o.lienCommande}\n\n${t.question(o.contact)}${o.legal ? `\n\n${t.legal}${o.legal}` : ''}` };
}
function expedition(c, o) {
  const t = T[langueDe(c)];
  return { sujet: t.sujetExpedition(c.numero), corps: `${t.bonjour(c.client.nom)},\n\n${t.colisParti(c.transporteur)}${c.suivi ? `\n${t.numeroSuivi} : ${c.suivi}` : ''}${c.suivi && o.lienSuivi ? `\n${t.suivreColis} : ${o.lienSuivi}` : ''}\n\n${t.votreCommande} : ${o.lienCommande}\n\n${t.aBientot},\n${o.nomBoutique}` };
}
function factureQr(c, o) {
  const t = T[langueDe(c)];
  return { sujet: t.sujetFacture(c.numero), corps: `${t.bonjour(c.client.nom)},\n\n${t.merci(o.nomBoutique)}\n\n${recapitulatif(t, c, o)}\n\n${t.facture(o.factureUrl, o.formatMontant(c.total), new Date(c.echeance).toLocaleDateString(t.dateLocale))}\n\n${o.nomBoutique}` };
}
module.exports = { langueDe, confirmation, expedition, factureQr, LANGUES: Object.keys(T) };
