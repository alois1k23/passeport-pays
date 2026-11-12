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
    pret: (n) => `Ihre Bestellung Nr. ${n} ist abholbereit`, pretCorps: (adr, h, n) => `Ihre Bestellung liegt im Geschäft für Sie bereit: ${adr}${h ? `\nÖffnungszeiten: ${h}` : ''}.\nBitte nennen Sie diese Bestellnummer: ${n}.`,
    partiel: n => `Ein Teil Ihrer Bestellung Nr. ${n} ist unterwegs`, partielCorps: (t, lignes, suivi) => `Diese Artikel wurden${t ? ` mit ${t}` : ''} versandt:\n${lignes}\nSendungsnummer: ${suivi}\n\nDer Rest Ihrer Bestellung folgt separat; wir melden uns beim Versand.`,
    relance: (s, i) => i === 0 ? `Ihre Bestellung bei ${s} wartet auf Sie` : `Ihr Warenkorb bei ${s} wartet noch auf Sie`, relanceCorps: (n, mt, lien) => `Ihre Bestellung Nr. ${n} (${mt}) wurde nicht abgeschlossen. Ein Problem beim Bezahlen? Hier können Sie sie fortsetzen:\n${lien}`, relanceCode: (r, c) => `\n\nEine kleine Entscheidungshilfe: -${r} % mit dem Code ${c}.`, equipe: s => `Ihr Team von ${s}`,
    avis: s => `Ihre Meinung zu Ihrer Bestellung bei ${s}`, avisCorps: (p, lien) => `Sie haben ${p} erhalten. Wie gefällt es Ihnen? Ihre Bewertung hilft anderen bei der Wahl und uns beim Besserwerden. Sie dauert 30 Sekunden:\n${lien}`, merciFin: 'Vielen Dank',
    piedContact: 'Kontakt', piedCommande: s => `Sie erhalten diese E-Mail aufgrund Ihrer Bestellung bei ${s}. Um solche Nachrichten nicht mehr zu erhalten`, piedNouvelles: s => `Sie erhalten diese E-Mail, weil Sie Neuigkeiten von ${s} abonniert haben. Zum Abbestellen`,
    legal: 'Rechtliche Hinweise (auf Französisch, massgebende Fassung):', dateLocale: 'de-CH' },
  it: { bonjour: n => `Buongiorno ${n}`, merci: s => `Grazie per il tuo ordine presso ${s}.`, sujetConfirmation: n => `Ordine n. ${n} confermato`,
    retrait: 'Ti scriviamo appena l’ordine è pronto per il ritiro.', expedition: 'Ti scriviamo alla spedizione, con il numero di tracciamento.', suivre: 'Segui il tuo ordine',
    question: e => `Una domanda? Rispondi a questa e-mail${e ? ` o scrivi a ${e}` : ''}.`, sujetExpedition: n => `Il tuo ordine n. ${n} è in viaggio`,
    colisParti: t => `Il tuo pacco è partito${t ? ` con ${t}` : ''}.`, numeroSuivi: 'Numero di tracciamento', suivreColis: 'Segui il pacco', votreCommande: 'Il tuo ordine', aBientot: 'Grazie e a presto',
    totalPaye: 'Totale pagato', livraison: 'Spedizione', offerte: 'gratuita', retraitGratuit: 'Ritiro in negozio: gratuito', remise: (m, e) => `(prezzo scontato${m ? `: ${m}` : ''}, risparmio di ${e})`,
    sujetFacture: n => `Ordine n. ${n}: la tua fattura QR`, facture: (url, mt, ech) => `La tua fattura QR (da pagare con l’app della tua banca, scansionando il codice QR):\n${url}\n\nImporto: ${mt} · da pagare entro il ${ech}.\nIl tuo ordine viene preparato alla ricezione del pagamento.`,
    pret: (n) => `Il tuo ordine n. ${n} è pronto`, pretCorps: (adr, h, n) => `Il tuo ordine ti aspetta in negozio: ${adr}${h ? `\nOrari: ${h}` : ''}.\nPresenta questo numero d’ordine: ${n}.`,
    partiel: n => `Una parte del tuo ordine n. ${n} è in viaggio`, partielCorps: (t, lignes, suivi) => `Questi articoli sono partiti${t ? ` con ${t}` : ''}:\n${lignes}\nNumero di tracciamento: ${suivi}\n\nIl resto dell’ordine segue separatamente; ti scriveremo alla spedizione.`,
    relance: (s, i) => i === 0 ? `Il tuo ordine presso ${s} ti aspetta` : `Il tuo carrello presso ${s} ti aspetta ancora`, relanceCorps: (n, mt, lien) => `Il tuo ordine n. ${n} (${mt}) non è stato completato. Un problema al momento di pagare? Puoi riprenderlo qui:\n${lien}`, relanceCode: (r, c) => `\n\nPer aiutarti a decidere: -${r} % con il codice ${c}.`, equipe: s => `Il team di ${s}`,
    avis: s => `La tua opinione sul tuo ordine presso ${s}`, avisCorps: (p, lien) => `Hai ricevuto ${p}. Cosa ne pensi? La tua recensione aiuta altri clienti a scegliere, e noi a migliorare. Bastano 30 secondi:\n${lien}`, merciFin: 'Grazie',
    piedContact: 'Contatto', piedCommande: s => `Ricevi questa e-mail in seguito al tuo ordine presso ${s}. Per non ricevere più questo tipo di messaggi`, piedNouvelles: s => `Ricevi questa e-mail perché hai accettato le novità di ${s}. Per non riceverle più`,
    legal: 'Informazioni legali (in francese, versione che fa fede):', dateLocale: 'it-CH' },
  en: { bonjour: n => `Hello ${n}`, merci: s => `Thank you for your order at ${s}.`, sujetConfirmation: n => `Order no. ${n} confirmed`,
    retrait: 'We will email you as soon as your order is ready for pickup.', expedition: 'We will email you when it ships, with the tracking number.', suivre: 'Track your order',
    question: e => `A question? Just reply to this email${e ? ` or write to ${e}` : ''}.`, sujetExpedition: n => `Your order no. ${n} is on its way`,
    colisParti: t => `Your parcel has shipped${t ? ` with ${t}` : ''}.`, numeroSuivi: 'Tracking number', suivreColis: 'Track the parcel', votreCommande: 'Your order', aBientot: 'Thank you and see you soon',
    totalPaye: 'Total paid', livraison: 'Shipping', offerte: 'free', retraitGratuit: 'In-store pickup: free', remise: (m, e) => `(discounted price${m ? `: ${m}` : ''}, you saved ${e})`,
    sujetFacture: n => `Order no. ${n}: your QR invoice`, facture: (url, mt, ech) => `Your QR invoice (pay with your banking app by scanning the QR code):\n${url}\n\nAmount: ${mt} · payable by ${ech}.\nYour order is prepared once payment is received.`,
    pret: (n) => `Your order no. ${n} is ready`, pretCorps: (adr, h, n) => `Your order is waiting for you in store: ${adr}${h ? `\nOpening hours: ${h}` : ''}.\nPlease show this order number: ${n}.`,
    partiel: n => `Part of your order no. ${n} is on its way`, partielCorps: (t, lignes, suivi) => `These items have shipped${t ? ` with ${t}` : ''}:\n${lignes}\nTracking number: ${suivi}\n\nThe rest of your order will follow separately; we will email you when it ships.`,
    relance: (s, i) => i === 0 ? `Your order at ${s} is waiting` : `Your cart at ${s} is still waiting`, relanceCorps: (n, mt, lien) => `Your order no. ${n} (${mt}) was not completed. A problem at checkout? You can pick it up here:\n${lien}`, relanceCode: (r, c) => `\n\nTo help you decide: ${r}% off with the code ${c}.`, equipe: s => `The ${s} team`,
    avis: s => `Your opinion on your ${s} order`, avisCorps: (p, lien) => `You received ${p}. What do you think? Your review helps other customers choose, and helps us improve. It takes 30 seconds:\n${lien}`, merciFin: 'Thank you',
    piedContact: 'Contact', piedCommande: s => `You are receiving this email following your order at ${s}. To stop receiving this kind of message`, piedNouvelles: s => `You are receiving this email because you signed up for news from ${s}. To unsubscribe`,
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
function pret(c, o) { const t = T[langueDe(c)]; return { sujet: t.pret(c.numero), corps: `${t.bonjour(c.client.nom)},\n\n${t.pretCorps(o.adresse, o.horaires, c.numero)}\n\n${t.votreCommande} : ${o.lienCommande}\n\n${o.nomBoutique}` }; }
function partiel(c, o) { const t = T[langueDe(c)]; return { sujet: t.partiel(c.numero), corps: `${t.bonjour(c.client.nom)},\n\n${t.partielCorps(c.transporteurFournisseur, o.lignes, c.suiviFournisseur)}\n\n${t.votreCommande} : ${o.lienCommande}\n\n${o.nomBoutique}` }; }
function relance(c, o) { const t = T[langueDe(c)]; return { sujet: t.relance(o.nomBoutique, o.i), corps: `${t.bonjour(c.client.nom)},\n\n${t.relanceCorps(c.numero, o.formatMontant(c.total), o.lien)}${o.remise ? t.relanceCode(o.remise, o.code) : ''}\n\n${t.equipe(o.nomBoutique)}` }; }
function avis(c, o) { const t = T[langueDe(c)]; return { sujet: t.avis(o.nomBoutique), corps: `${t.bonjour(c.client.nom)},\n\n${t.avisCorps(c.lignes.map(l => l.nom).join(', '), o.lien)}\n\n${t.merciFin},\n${t.equipe(o.nomBoutique)}` }; }
// Lien vers la boutique dans la langue de la commande (la page s'ouvre dans la même langue que l'e-mail).
const avecLangue = (url, c) => langueDe(c) ? `${url}${url.includes('?') ? '&' : '?'}lang=${c.langue}` : url;
const textesPied = langue => T[langue] ? { contact: T[langue].piedContact, commande: T[langue].piedCommande, nouvelles: T[langue].piedNouvelles } : null;
module.exports = { textesPied, langueDe, confirmation, expedition, factureQr, pret, partiel, relance, avis, avecLangue, LANGUES: Object.keys(T) };
