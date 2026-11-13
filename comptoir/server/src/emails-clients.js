/* E-mails aux clients dans leur langue (allemand, italien, anglais) quand ils ont commandé dans cette langue.
   Le français reste le texte d'origine d'app.js. Les noms des produits et de la boutique ne sont pas traduits ;
   les informations légales (droit de rétractation) restent en français, annoncées dans la langue du client. */
'use strict';
const T = {
  de: {
    pointsGagnes: n => `Gesammelte Treuepunkte: ${n}`, carteCadeau: (m, f, r) => `  davon ${m} mit Geschenkkarte ····${f}, Rest ${r}`,
    codeFidelite: s => `${s}: Ihr Code für Ihre Treuepunkte`, codeFideliteCorps: (s, p, v, c) => `Sie haben ${p} Treuepunkte bei ${s} (${v}).\n\nIhr Code, um sie bei Ihrer Bestellung einzulösen: ${c}\nEr ist 15 Minuten gültig.\n\nSie haben nichts angefordert? Ignorieren Sie diese E-Mail: Ohne diesen Code kann niemand Ihre Punkte verwenden.`,
    mesCommandes: s => `Ihre Bestellungen bei ${s}`, mesCommandesCorps: (s, l) => `Hier sind Ihre Bestellungen bei ${s}:\n\n${l}\n\nHaben Sie nichts angefordert? Dann ignorieren Sie diese E-Mail.`, statuts: { payee: 'bezahlt', preparation: 'in Vorbereitung', fournisseur: 'in Vorbereitung', expediee: 'versandt', livree: 'geliefert', prete: 'abholbereit', retiree: 'abgeholt', remboursee: 'erstattet' }, numero: 'Nr.', du: 'vom',
    pageOptin: ['Neuigkeiten der Boutique erhalten', e => `Bestätigen Sie die Anmeldung von ${e}.`, 'Anmeldung bestätigen', 'Erledigt', e => `${e} erhält ab jetzt die Neuigkeiten dieser Boutique. Sie können sich jederzeit über jede E-Mail abmelden.`],
    optin: s => `Bestätigen Sie Ihre Anmeldung bei ${s}`, optinCorps: (s, lien) => `Sie (oder jemand anderes) haben Neuigkeiten und Angebote von ${s} angefordert. Zur Bestätigung klicken Sie hier:\n${lien}\n\nWaren Sie das nicht? Dann ignorieren Sie diese E-Mail: Sie erhalten nichts weiter.`,
    bienvenue: s => `Willkommen bei ${s}`, bienvenueCorps: (r, c) => `Vielen Dank für Ihre Anmeldung.${r && c ? ` Hier sind -${r} % auf Ihre erste Bestellung mit dem Code ${c}.` : ''}`,
    reconquete: p => `Lange nicht gesehen, ${p}`, reconqueteCorps: (s, r, c) => `Seit Ihrer letzten Bestellung sind bei ${s} neue Produkte eingetroffen.${r && c ? ` Für Ihre Rückkehr: -${r} % mit dem Code ${c}.` : ''}`, consenti: 'Sie erhalten diese E-Mail, weil Sie unseren Neuigkeiten zugestimmt haben.',
    salut: 'Guten Tag', bonjour: n => `Guten Tag ${n}`, merci: s => `Vielen Dank für Ihre Bestellung bei ${s}.`, sujetConfirmation: n => `Bestellung Nr. ${n} bestätigt`,
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
  it: {
    pointsGagnes: n => `Punti fedeltà guadagnati: ${n}`, carteCadeau: (m, f, r) => `  di cui ${m} con la carta regalo ····${f}, resto ${r}`,
    codeFidelite: s => `${s}: il suo codice per usare i punti`, codeFideliteCorps: (s, p, v, c) => `Ha ${p} punti fedeltà presso ${s} (${v}).\n\nIl suo codice per usarli nell’ordine: ${c}\nÈ valido 15 minuti.\n\nNon ha richiesto nulla? Ignori questa e-mail: senza questo codice nessuno può usare i suoi punti.`,
    mesCommandes: s => `I tuoi ordini presso ${s}`, mesCommandesCorps: (s, l) => `Ecco i tuoi ordini presso ${s}:\n\n${l}\n\nNon hai chiesto nulla? Ignora questa e-mail.`, statuts: { payee: 'pagato', preparation: 'in preparazione', fournisseur: 'in preparazione', expediee: 'spedito', livree: 'consegnato', prete: 'pronto per il ritiro', retiree: 'ritirato', remboursee: 'rimborsato' }, numero: 'n.', du: 'del',
    pageOptin: ['Ricevere le novità del negozio', e => `Conferma l’iscrizione di ${e}.`, 'Conferma l’iscrizione', 'Fatto', e => `${e} riceverà d’ora in poi le novità di questo negozio. Puoi annullare l’iscrizione in qualsiasi momento da ogni e-mail.`],
    optin: s => `Conferma la tua iscrizione presso ${s}`, optinCorps: (s, lien) => `Tu (o qualcun altro) hai chiesto di ricevere le novità e le offerte di ${s}. Per confermare, clicca qui:\n${lien}\n\nNon sei stato tu? Ignora questa e-mail: non riceverai nient’altro.`,
    bienvenue: s => `Benvenuto da ${s}`, bienvenueCorps: (r, c) => `Grazie per la tua iscrizione.${r && c ? ` Ecco -${r} % sul tuo primo ordine con il codice ${c}.` : ''}`,
    reconquete: p => `È passato un po’ di tempo, ${p}`, reconqueteCorps: (s, r, c) => `Dal tuo ultimo ordine sono arrivati nuovi prodotti da ${s}.${r && c ? ` Per il tuo ritorno: -${r} % con il codice ${c}.` : ''}`, consenti: 'Ricevi questa e-mail perché hai accettato le nostre novità.',
    salut: 'Buongiorno', bonjour: n => `Buongiorno ${n}`, merci: s => `Grazie per il tuo ordine presso ${s}.`, sujetConfirmation: n => `Ordine n. ${n} confermato`,
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
  en: {
    pointsGagnes: n => `Loyalty points earned: ${n}`, carteCadeau: (m, f, r) => `  including ${m} paid with gift card ····${f}, remainder ${r}`,
    codeFidelite: s => `${s}: your code to use your points`, codeFideliteCorps: (s, p, v, c) => `You have ${p} loyalty points at ${s} (${v}).\n\nYour code to use them on your order: ${c}\nIt is valid for 15 minutes.\n\nDidn’t ask for this? Ignore this email: without this code, nobody can use your points.`,
    mesCommandes: s => `Your orders at ${s}`, mesCommandesCorps: (s, l) => `Here are your orders at ${s}:\n\n${l}\n\nDidn’t ask for this? Just ignore this email.`, statuts: { payee: 'paid', preparation: 'being prepared', fournisseur: 'being prepared', expediee: 'shipped', livree: 'delivered', prete: 'ready for pickup', retiree: 'picked up', remboursee: 'refunded' }, numero: 'no.', du: 'of',
    pageOptin: ['Get news from the shop', e => `Confirm the sign-up of ${e}.`, 'Confirm sign-up', 'Done', e => `${e} will now receive news from this shop. You can unsubscribe at any time from any email.`],
    optin: s => `Confirm your sign-up at ${s}`, optinCorps: (s, lien) => `You (or someone else) asked to receive news and offers from ${s}. To confirm, click here:\n${lien}\n\nNot you? Just ignore this email: you will not receive anything else.`,
    bienvenue: s => `Welcome to ${s}`, bienvenueCorps: (r, c) => `Thank you for signing up.${r && c ? ` Here is ${r}% off your first order with the code ${c}.` : ''}`,
    reconquete: p => `It has been a while, ${p}`, reconqueteCorps: (s, r, c) => `New products have arrived at ${s} since your last order.${r && c ? ` To welcome you back: ${r}% off with the code ${c}.` : ''}`, consenti: 'You are receiving this email because you agreed to receive our news.',
    salut: 'Hello', bonjour: n => `Hello ${n}`, merci: s => `Thank you for your order at ${s}.`, sujetConfirmation: n => `Order no. ${n} confirmed`,
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
const langueDe = c => (c && typeof c.langue === 'string' && Object.hasOwn(T, c.langue)) ? c.langue : null;

function recapitulatif(t, c, { formatMontant, nomLivraison }) {
  return [
    ...c.lignes.map(l => `- ${l.qte} × ${l.nom} : ${formatMontant(l.prix * l.qte)}`),
    ...(c.remise ? [`  ${t.remise(c.motifRemise, formatMontant(c.remise))}`] : []),
    c.livraison === 'retrait' ? `- ${t.retraitGratuit}` : `- ${t.livraison} (${nomLivraison}) : ${c.port ? formatMontant(c.port) : t.offerte}`,
    `${t.totalPaye} : ${formatMontant(c.total)}`,
    ...(c.carteCadeau && c.carteCadeau.montant ? [t.carteCadeau(formatMontant(c.carteCadeau.montant), c.carteCadeau.fin, formatMontant(Math.max(0, c.total - c.carteCadeau.montant)))] : []),
    ...(c.fidelite && c.fidelite.gagnes ? [t.pointsGagnes(c.fidelite.gagnes)] : [])
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
/* E-mails commerciaux : la langue vient de l'inscription (newsletter) ou de la dernière commande. */
const lng = l => typeof l === 'string' && Object.hasOwn(T, l) ? l : null;
function optin(langue, o) { const t = T[lng(langue)]; return t && { sujet: t.optin(o.nomBoutique), corps: `${t.salut},\n\n${t.optinCorps(o.nomBoutique, o.lien)}\n\n${o.nomBoutique}` }; }
function bienvenue(langue, o) { const t = T[lng(langue)]; return t && { sujet: t.bienvenue(o.nomBoutique), corps: `${t.salut},\n\n${t.bienvenueCorps(o.remise, o.code)}\n\n${o.lien}\n\n${t.equipe(o.nomBoutique)}` }; }
function reconquete(c, o) { const t = T[langueDe(c)]; return t && { sujet: t.reconquete(String(c.client.nom || '').split(' ')[0]), corps: `${t.bonjour(c.client.nom)},\n\n${t.reconqueteCorps(o.nomBoutique, o.remise, o.code)}\n\n${o.lien}\n\n${t.equipe(o.nomBoutique)}\n\n${t.consenti}` }; }
const pageOptin = langue => lng(langue) ? T[langue].pageOptin : null;
/* Pages publiques d'inscription et de désinscription (titre, texte, bouton) dans la langue du client. */
const PAGES = {
  fr: { invalide: ['Lien invalide', 'Ce lien est incomplet ou a été modifié.'], dejaConfirme: ['Déjà confirmé', e => `${e} est déjà inscrit.`],
    desinscrire: [n => `Ne plus recevoir les e-mails de ${n}`, e => `Confirmez pour ${e}. Vous recevrez toujours les e-mails liés à vos commandes (confirmation, expédition).`, 'Me désinscrire'],
    dejaDesinscrit: ['Vous êtes déjà désinscrit', (e, n) => `${e} ne reçoit plus les nouvelles et offres de ${n}.`], desinscrit: ['C’est fait', e => `${e} ne recevra plus d’e-mails commerciaux de cette boutique.`] },
  de: { invalide: ['Ungültiger Link', 'Dieser Link ist unvollständig oder wurde verändert.'], dejaConfirme: ['Bereits bestätigt', e => `${e} ist bereits angemeldet.`],
    desinscrire: [n => `Keine E-Mails mehr von ${n}`, e => `Bitte bestätigen Sie für ${e}. E-Mails zu Ihren Bestellungen (Bestätigung, Versand) erhalten Sie weiterhin.`, 'Abmelden'],
    dejaDesinscrit: ['Sie sind bereits abgemeldet', (e, n) => `${e} erhält keine Neuigkeiten und Angebote von ${n} mehr.`], desinscrit: ['Erledigt', e => `${e} erhält keine Werbe-E-Mails dieser Boutique mehr.`] },
  it: { invalide: ['Link non valido', 'Questo link è incompleto o è stato modificato.'], dejaConfirme: ['Già confermato', e => `${e} è già iscritto.`],
    desinscrire: [n => `Non ricevere più e-mail da ${n}`, e => `Conferma per ${e}. Continuerai a ricevere le e-mail relative ai tuoi ordini (conferma, spedizione).`, 'Annulla l’iscrizione'],
    dejaDesinscrit: ['Iscrizione già annullata', (e, n) => `${e} non riceve più le novità e le offerte di ${n}.`], desinscrit: ['Fatto', e => `${e} non riceverà più e-mail commerciali da questo negozio.`] },
  en: { invalide: ['Invalid link', 'This link is incomplete or has been altered.'], dejaConfirme: ['Already confirmed', e => `${e} is already signed up.`],
    desinscrire: [n => `Stop emails from ${n}`, e => `Please confirm for ${e}. You will still receive emails about your orders (confirmation, shipping).`, 'Unsubscribe'],
    dejaDesinscrit: ['You are already unsubscribed', (e, n) => `${e} no longer receives news and offers from ${n}.`], desinscrit: ['Done', e => `${e} will no longer receive marketing emails from this shop.`] }
};
const pages = langue => PAGES[lng(langue) || 'fr'];
/* Liste des commandes d'une adresse (« Mes commandes ») ; commandes : [{ numero, date, statut, lien }]. */
/* Code pour utiliser ses points de fidélité, dans la langue du client (null en français : texte d'app.js). */
function codeFidelite(langue, o) { const t = T[lng(langue)]; if (!t) return null; return { sujet: t.codeFidelite(o.nomBoutique), corps: `${t.salut},\n\n${t.codeFideliteCorps(o.nomBoutique, o.points, o.valeur, o.code)}\n\n${o.nomBoutique}` }; }
function mesCommandes(langue, o) {
  const l = lng(langue), t = l && T[l]; if (!t) return null;
  const lignes = o.commandes.map(c => `- ${t.numero} ${c.numero} ${t.du} ${new Date(c.date).toLocaleDateString(t.dateLocale)} (${t.statuts[c.statut] || c.statut}): ${c.lien}`).join('\n');
  return { sujet: t.mesCommandes(o.nomBoutique), corps: `${t.salut},\n\n${t.mesCommandesCorps(o.nomBoutique, lignes)}\n\n${o.nomBoutique}` };
}
const avecLangue = (url, c) => langueDe(c) ? `${url}${url.includes('?') ? '&' : '?'}lang=${c.langue}` : url;
const textesPied = langue => lng(langue) ? { contact: T[langue].piedContact, commande: T[langue].piedCommande, nouvelles: T[langue].piedNouvelles } : null;
module.exports = { codeFidelite, mesCommandes, pages, pageOptin, textesPied, langueDe, optin, bienvenue, reconquete, confirmation, expedition, factureQr, pret, partiel, relance, avis, avecLangue, LANGUES: Object.keys(T) };
