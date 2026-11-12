/* Facture électronique structurée : UN/CEFACT CII D16B, profil EN 16931 (norme européenne de la facture électronique).
   C'est le format XML de Factur-X (France) et de ZUGFeRD, lu par les logiciels comptables et les plateformes de
   dématérialisation. Le fichier est produit à partir de la commande telle qu'elle est facturée :
   - les prix sont TTC dans Comptoir : chaque ligne est convertie HT à son taux figé à la vente ;
   - port et remise sont répartis entre les taux au prorata des articles (comme sur la facture imprimée), puis portés
     en frais (livraison) et remise au niveau du document, par taux ;
   - bases et TVA par taux sont exactement celles de la facture imprimée, et le total TTC est celui encaissé.
   Ce module ne transmet rien : en France, l'envoi passe par une plateforme agréée (PA). */
'use strict';
const prix = require('./prix');

const r2 = n => Math.round(n * 100) / 100;
const m = n => r2(n).toFixed(2);
// Échappement XML, et retrait des caractères interdits en XML 1.0 (contrôles, U+FFFE/U+FFFF, demi-paires UTF-16 isolées).
const x = t => String(t ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const date102 = ms => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const pct = t => String(Math.round(t * 1000) / 10);

/* Taux d'une ligne : figé à la vente ; à défaut (anciennes commandes), le taux actuel de la boutique, comme la facture imprimée. */
const tauxDeLigne = (c, l, defaut) => typeof l.tauxTva === 'number' ? l.tauxTva : typeof c.tauxTva === 'number' ? c.tauxTva : defaut;

/* Ventilation TTC par taux : même calcul que la facture imprimée (js/modules.js, tva()). */
function ventiler(c, defaut = 0) {
  const ttc = c.total, base = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1;
  const groupes = {};
  for (const l of c.lignes) { const t = tauxDeLigne(c, l, defaut); groupes[t] = (groupes[t] || 0) + ttc * (l.prix * l.qte) / base; }
  if (!c.lignes.length) groupes[typeof c.tauxTva === 'number' ? c.tauxTva : defaut] = ttc;
  const parTaux = Object.entries(groupes).map(([t, v]) => ({ taux: Number(t), ttc: r2(v) })).sort((a, b) => b.ttc - a.ttc);
  if (parTaux.length) parTaux[0].ttc = r2(parTaux[0].ttc + ttc - parTaux.reduce((a, v) => a + v.ttc, 0));
  for (const v of parTaux) { v.ht = v.taux ? r2(v.ttc / (1 + v.taux)) : v.ttc; v.tva = r2(v.ttc - v.ht); }
  return parTaux.sort((a, b) => b.taux - a.taux);
}

/* « Rue 1, 1003 Lausanne » → { rue, npa, ville } */
function decouperAdresse(texte) {
  const t = String(texte || '').trim();
  const mt = /^(.*?)[,\s]+(\d{4,5})\s+(.+)$/.exec(t);
  return mt ? { rue: mt[1].trim(), npa: mt[2], ville: mt[3].trim() } : { rue: t, npa: '', ville: '' };
}

/* Identifiant légal du vendeur (BT-30) et son schéma ISO 6523 : SIREN (0002) en France, numéro d'entreprise (0208)
   en Belgique, IDE (0183) en Suisse. Un identifiant non reconnu est transmis sans schéma. */
function identifiantLegal(siret, pays) {
  const brut = String(siret || '').trim(), chiffres = brut.replace(/\D/g, '');
  if (!brut) return null;
  if (pays === 'FR' && (chiffres.length === 14 || chiffres.length === 9)) return { id: chiffres.slice(0, 9), schema: '0002' };
  if (pays === 'BE' && chiffres.length === 10) return { id: chiffres, schema: '0208' };
  if (pays === 'CH' && chiffres.length === 9 && /^CHE/i.test(brut)) return { id: `CHE${chiffres}`, schema: '0183' };
  return { id: brut, schema: '' };
}

/* Catégorie de TVA d'un taux nul : franchise (France, Belgique) = exonération « E » ;
   entreprise suisse non assujettie = « O » (hors champ de la TVA). */
const MOTIF = {
  fr: { categorie: 'E', texte: 'TVA non applicable, art. 293 B du CGI (franchise en base)' },
  be: { categorie: 'E', texte: 'Régime particulier de franchise des petites entreprises (art. 56bis du Code de la TVA)' },
  ch: { categorie: 'O', texte: 'Entreprise non assujettie à la TVA (art. 10 LTVA)' }
};
const motifPour = pays => MOTIF[pays] || { categorie: 'E', texte: 'TVA non applicable (entreprise non assujettie)' };

/* Statuts qui supposent un paiement reçu. Une commande annulée ne l'est que si un paiement a été enregistré. */
const STATUTS_PAYES = new Set(['payee', 'preparation', 'fournisseur', 'expediee', 'livree', 'prete', 'retiree', 'remboursee']);
const estPayee = c => !!(c.payeLe || c.payeManuelLe) || STATUTS_PAYES.has(c.statut);

/* Contrôles avant production : ce qui manque pour un fichier recevable. Renvoie une liste de messages. */
function manques(c, config) {
  const e = config.entreprise || {}, out = [], defaut = prix.tauxTva(config);
  const assujetti = (c.lignes || []).some(l => tauxDeLigne(c, l, defaut) > 0);
  if (!c.lignes || !c.lignes.length) out.push('au moins un article');
  if (!e.raison) out.push('raison sociale du vendeur');
  if (!decouperAdresse(e.adresse).npa) out.push('adresse complète du vendeur (rue, code postal et localité)');
  if (assujetti && !e.tvaIntra) out.push('numéro de TVA du vendeur');
  // Exonération (franchise) : la norme demande un identifiant fiscal du vendeur (BR-E-02) ; le SIRET ou le numéro d'entreprise en tient lieu.
  if (!assujetti && motifPour(config.boutique.pays).categorie === 'E' && !e.tvaIntra && !e.siret) out.push('identifiant de l’entreprise (SIRET ou numéro d’entreprise)');
  if (!c.facture) out.push('numéro de facture (commande pas encore facturée)');
  return out;
}

function partie(balise, { nom, legal, adresse, pays, email, tva, fiscal }) {
  return `<ram:${balise}><ram:Name>${x(nom)}</ram:Name>`
    + (legal ? `<ram:SpecifiedLegalOrganization><ram:ID${legal.schema ? ` schemeID="${legal.schema}"` : ''}>${x(legal.id)}</ram:ID></ram:SpecifiedLegalOrganization>` : '')
    + `<ram:PostalTradeAddress>${adresse.npa ? `<ram:PostcodeCode>${x(adresse.npa)}</ram:PostcodeCode>` : ''}${adresse.rue ? `<ram:LineOne>${x(adresse.rue)}</ram:LineOne>` : ''}${adresse.ville ? `<ram:CityName>${x(adresse.ville)}</ram:CityName>` : ''}<ram:CountryID>${x(pays)}</ram:CountryID></ram:PostalTradeAddress>`
    + (email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(email)}</ram:URIID></ram:URIUniversalCommunication>` : '')
    + (tva ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(tva)}</ram:ID></ram:SpecifiedTaxRegistration>` : '')
    + (!tva && fiscal ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(fiscal)}</ram:ID></ram:SpecifiedTaxRegistration>` : '')
    + `</ram:${balise}>`;
}

/* Produit le XML (client professionnel : son numéro de TVA est repris, BT-48). avoir = true : note de crédit (type 381) qui renvoie à la facture d'origine. */
function produire(c, config, { avoir = false, devise = 'EUR' } = {}) {
  const e = config.entreprise || {}, pays = String(config.boutique.pays || 'fr').toUpperCase();
  const defaut = prix.tauxTva(config);
  const parTaux = ventiler(c, defaut);
  const motif = motifPour(config.boutique.pays);
  const categorie = t => t > 0 ? 'S' : motif.categorie;
  // Catégorie « O » : ni taux ni numéro de TVA (BR-O-02, BR-O-05).
  const taxe = t => `<ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${categorie(t)}</ram:CategoryCode>${categorie(t) === 'O' ? '' : `<ram:RateApplicablePercent>${pct(t)}</ram:RateApplicablePercent>`}`;
  const horsChamp = parTaux.every(v => categorie(v.taux) === 'O');

  // Lignes HT : prix unitaire HT (4 décimales), montant de ligne arrondi au centime.
  const lignes = c.lignes.map((l, i) => {
    const t = tauxDeLigne(c, l, defaut), pu = Math.round(l.prix / (1 + t) * 10000) / 10000;
    return { id: i + 1, nom: l.nom, qte: l.qte, pu, net: r2(pu * l.qte), taux: t };
  });
  // Par taux : base imprimée = lignes + frais de port − remise (les arrondis de conversion vont dans l'une ou l'autre).
  const ttcArticles = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1;
  const frais = [], remises = [];
  for (const v of parTaux) {
    const lignesHt = r2(lignes.filter(l => l.taux === v.taux).reduce((a, l) => a + l.net, 0));
    const partArticles = c.lignes.filter(l => tauxDeLigne(c, l, defaut) === v.taux).reduce((a, l) => a + l.prix * l.qte, 0) / ttcArticles;
    let port = c.port ? r2(c.port * partArticles / (1 + v.taux)) : 0;
    let remise = r2(lignesHt + port - v.ht);
    if (remise < 0) { port = r2(port - remise); remise = 0; }   // arrondi de conversion : ajouté aux frais
    if (port > 0) frais.push({ montant: port, taux: v.taux, motif: c.port ? 'Livraison' : 'Arrondi' });
    if (remise > 0) remises.push({ montant: remise, taux: v.taux, motif: c.remise ? `Remise${c.motifRemise ? ` (${String(c.motifRemise).slice(0, 60)})` : ''}` : 'Arrondi' });
  }
  const totalLignes = r2(lignes.reduce((a, l) => a + l.net, 0));
  const totalFrais = r2(frais.reduce((a, f) => a + f.montant, 0)), totalRemises = r2(remises.reduce((a, f) => a + f.montant, 0));
  const base = r2(parTaux.reduce((a, v) => a + v.ht, 0)), tva = r2(parTaux.reduce((a, v) => a + v.tva, 0)), ttc = r2(base + tva);

  // Paiement : facture payée (ou avoir d'une facture payée, donc remboursée) = montant déjà réglé.
  // Avoir d'une facture jamais payée : rien n'est remboursé, l'avoir solde la facture ouverte.
  const paye = estPayee(c);
  // Espèces en francs : le client paie le montant arrondi à 5 centimes (BT-114, arrondi du montant à payer).
  const arrondi = !avoir && paye && typeof c.arrondi === 'number' && c.arrondi && typeof c.encaisse === 'number' ? r2(c.arrondi) : 0;
  const prepaye = paye ? r2(ttc + arrondi) : 0;
  const du = r2(ttc - prepaye + arrondi);
  const numero = avoir ? c.avoir.numero : c.facture;
  const dateDoc = avoir ? c.avoir.date : (c.dateFacture || c.date);
  const client = c.client || {};
  const legal = identifiantLegal(e.siret, pays);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>${x(numero)}</ram:ID><ram:TypeCode>${avoir ? 381 : 380}</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${date102(dateDoc)}</udt:DateTimeString></ram:IssueDateTime>${avoir ? `<ram:IncludedNote><ram:Content>Avoir annulant la facture ${x(c.facture)} (commande ${c.statut === 'remboursee' ? 'remboursée' : 'annulée'}).</ram:Content></ram:IncludedNote>` : ''}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lignes.map(l => `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>${x(l.nom)}</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.pu.toFixed(4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.qte}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax>${taxe(l.taux)}</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${m(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`).join('\n')}
<ram:ApplicableHeaderTradeAgreement>${c.numero ? `<ram:BuyerReference>${x(`Commande ${c.numero}`)}</ram:BuyerReference>` : ''}${partie('SellerTradeParty', { nom: e.raison || config.boutique.nom, legal, adresse: decouperAdresse(e.adresse), pays, email: e.email, tva: horsChamp ? '' : e.tvaIntra, fiscal: e.siret })}${partie('BuyerTradeParty', { nom: client.nom || 'Client', adresse: { rue: client.adresse || '', npa: client.npa || '', ville: client.ville || '' }, pays: String(client.pays || pays).toUpperCase(), email: client.email, tva: client.tva })}</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(c.date)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>${c.referenceQr ? `<ram:PaymentReference>${x(c.referenceQr)}</ram:PaymentReference>` : ''}<ram:InvoiceCurrencyCode>${x(devise)}</ram:InvoiceCurrencyCode>${!avoir && !paye && e.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>30</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(String(e.iban).replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
${parTaux.map(v => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${m(v.tva)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${v.taux > 0 ? '' : `<ram:ExemptionReason>${x(motif.texte)}</ram:ExemptionReason>`}<ram:BasisAmount>${m(v.ht)}</ram:BasisAmount><ram:CategoryCode>${categorie(v.taux)}</ram:CategoryCode>${categorie(v.taux) === 'O' ? '' : `<ram:RateApplicablePercent>${pct(v.taux)}</ram:RateApplicablePercent>`}</ram:ApplicableTradeTax>`).join('\n')}
${[...frais.map(f => ({ ...f, charge: true })), ...remises.map(f => ({ ...f, charge: false }))].map(f => `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>${f.charge}</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${m(f.montant)}</ram:ActualAmount><ram:Reason>${x(f.motif)}</ram:Reason><ram:CategoryTradeTax>${taxe(f.taux)}</ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`).join('\n')}
${!avoir && !paye && c.echeance ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${date102(c.echeance)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${m(totalLignes)}</ram:LineTotalAmount>${totalFrais ? `<ram:ChargeTotalAmount>${m(totalFrais)}</ram:ChargeTotalAmount>` : ''}${totalRemises ? `<ram:AllowanceTotalAmount>${m(totalRemises)}</ram:AllowanceTotalAmount>` : ''}<ram:TaxBasisTotalAmount>${m(base)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${x(devise)}">${m(tva)}</ram:TaxTotalAmount>${arrondi ? `<ram:RoundingAmount>${m(arrondi)}</ram:RoundingAmount>` : ''}<ram:GrandTotalAmount>${m(ttc)}</ram:GrandTotalAmount>${prepaye ? `<ram:TotalPrepaidAmount>${m(prepaye)}</ram:TotalPrepaidAmount>` : ''}<ram:DuePayableAmount>${m(du)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${avoir ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(c.facture)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${date102(c.dateFacture || c.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/* Contrôle du XML produit : caractères valides, au moins une ligne, et règles de calcul EN 16931
   (BR-CO-10 à 17, BR-S-08 et équivalents par catégorie). Sert aux tests et à refuser un fichier incohérent. */
function verifier(xml) {
  const erreurs = [];
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(xml)) erreurs.push('caractère interdit en XML');
  const blocs = (h, nom) => { const out = []; const o = `<ram:${nom}>`, f = `</ram:${nom}>`; let i = 0;
    for (;;) { const s = h.indexOf(o, i); if (s < 0) return out; const e = h.indexOf(f, s); if (e < 0) return out; out.push(h.slice(s + o.length, e)); i = e + f.length; } };
  const val = (h, nom) => { const v = new RegExp(`<ram:${nom}(?: [^>]*)?>([^<]*)</ram:${nom}>`).exec(h); return v ? v[1] : null; };
  const num = (h, nom) => Number(val(h, nom) || 0);
  const egal = (a, b) => Math.abs(a - b) < 0.005;
  const cle = h => `${val(h, 'CategoryCode')}|${Number(val(h, 'RateApplicablePercent') || 0)}`;

  const lignes = blocs(xml, 'IncludedSupplyChainTradeLineItem').map(l => ({ cle: cle(blocs(l, 'ApplicableTradeTax')[0] || ''), net: num(l, 'LineTotalAmount') }));
  if (!lignes.length) erreurs.push('BR-16 (aucune ligne)');
  const ac = blocs(xml, 'SpecifiedTradeAllowanceCharge').map(a => ({ charge: /<udt:Indicator>true</.test(a), montant: num(a, 'ActualAmount'), cle: cle(blocs(a, 'CategoryTradeTax')[0] || '') }));
  const tete = blocs(xml, 'SpecifiedTradeSettlementHeaderMonetarySummation')[0] || '';
  const T = n => num(tete, n);
  if (!egal(r2(lignes.reduce((a, v) => a + v.net, 0)), T('LineTotalAmount'))) erreurs.push('BR-CO-10');
  const frais = r2(ac.filter(v => v.charge).reduce((a, v) => a + v.montant, 0)), rem = r2(ac.filter(v => !v.charge).reduce((a, v) => a + v.montant, 0));
  if (!egal(T('ChargeTotalAmount'), frais) || !egal(T('AllowanceTotalAmount'), rem)) erreurs.push('BR-CO-11/12');
  if (!egal(r2(T('LineTotalAmount') - rem + frais), T('TaxBasisTotalAmount'))) erreurs.push('BR-CO-13');
  if (!egal(r2(T('TaxBasisTotalAmount') + T('TaxTotalAmount')), T('GrandTotalAmount'))) erreurs.push('BR-CO-15');
  if (!egal(r2(T('GrandTotalAmount') - T('TotalPrepaidAmount') + T('RoundingAmount')), T('DuePayableAmount'))) erreurs.push('BR-CO-16');
  // Ventilation de TVA de l'en-tête (blocs avec un montant calculé)
  const ventilation = blocs(xml, 'ApplicableTradeTax').filter(b => b.includes('<ram:CalculatedAmount>'));
  if (!egal(r2(ventilation.reduce((a, b) => a + num(b, 'CalculatedAmount'), 0)), T('TaxTotalAmount'))) erreurs.push('BR-CO-14');
  for (const b of ventilation) {
    const k = cle(b), base = num(b, 'BasisAmount'), montant = num(b, 'CalculatedAmount'), t = Number(val(b, 'RateApplicablePercent') || 0);
    const attendu = r2(lignes.filter(l => l.cle === k).reduce((a, l) => a + l.net, 0) + ac.filter(a => a.cle === k).reduce((a, f) => a + (f.charge ? f.montant : -f.montant), 0));
    if (!egal(attendu, base)) erreurs.push(`BR-${k.split('|')[0]}-08 (${t} %)`);
    if (Math.abs(montant - r2(base * t / 100)) > 1) erreurs.push(`BR-CO-17 (${t} %)`);
    if (val(b, 'CategoryCode') !== 'S' && !val(b, 'ExemptionReason')) erreurs.push(`BR-${val(b, 'CategoryCode')}-10`);
  }
  return erreurs;
}

module.exports = { produire, verifier, manques, ventiler, decouperAdresse, identifiantLegal, estPayee };
