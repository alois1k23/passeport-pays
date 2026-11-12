/* Facture électronique structurée : UN/CEFACT CII D16B, profil EN 16931 (norme européenne de la facture électronique).
   C'est le format XML de Factur-X (France) et de ZUGFeRD, lu par les logiciels comptables et les plateformes de
   dématérialisation. Le fichier est produit à partir de la commande telle qu'elle est facturée :
   - les prix sont TTC dans Comptoir : chaque ligne est convertie HT à son taux figé à la vente ;
   - port et remise sont répartis entre les taux au prorata des articles (comme sur la facture imprimée), puis portés
     en frais (livraison) et remise au niveau du document, par taux ;
   - bases et TVA par taux sont exactement celles de la facture imprimée, et le total TTC est celui encaissé.
   Ce module ne transmet rien : en France, l'envoi passe par une plateforme agréée (PA). */
'use strict';

const r2 = n => Math.round(n * 100) / 100;
const m = n => r2(n).toFixed(2);
const x = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');   // caractères interdits en XML 1.0
const date102 = ms => { const d = new Date(ms); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const pct = t => String(Math.round(t * 1000) / 10);

const tauxDeLigne = (c, l) => typeof l.tauxTva === 'number' ? l.tauxTva : typeof c.tauxTva === 'number' ? c.tauxTva : 0;

/* Ventilation TTC par taux : même calcul que la facture imprimée (js/modules.js, tva()). */
function ventiler(c) {
  const ttc = c.total, base = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1;
  const groupes = {};
  for (const l of c.lignes) { const t = tauxDeLigne(c, l); groupes[t] = (groupes[t] || 0) + ttc * (l.prix * l.qte) / base; }
  if (!c.lignes.length) groupes[typeof c.tauxTva === 'number' ? c.tauxTva : 0] = ttc;
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

const MOTIF_EXONERATION = {
  fr: 'TVA non applicable, art. 293 B du CGI (franchise en base)',
  be: 'Régime particulier de franchise des petites entreprises (art. 56bis du Code de la TVA)',
  ch: 'Entreprise non assujettie à la TVA (art. 10 LTVA)'
};

/* Contrôles avant production : ce qui manque pour un fichier recevable. Renvoie une liste de messages. */
function manques(c, config) {
  const e = config.entreprise || {}, out = [];
  const assujetti = c.lignes.some(l => tauxDeLigne(c, l) > 0);
  if (!e.raison) out.push('raison sociale du vendeur');
  if (!decouperAdresse(e.adresse).npa) out.push('adresse complète du vendeur (rue, code postal et localité)');
  if (assujetti && !e.tvaIntra) out.push('numéro de TVA du vendeur');
  // Ventes exonérées (franchise) : la norme demande un identifiant fiscal du vendeur (BR-E-02) ; le SIRET, l'IDE ou le numéro d'entreprise en tient lieu.
  if (!assujetti && !e.tvaIntra && !e.siret) out.push('identifiant de l’entreprise (SIRET, IDE ou numéro d’entreprise)');
  if (!c.facture) out.push('numéro de facture (commande pas encore facturée)');
  return out;
}

function partie(balise, { nom, idLegal, schemaLegal, adresse, pays, email, tva, fiscal }) {
  const a = decouperAdresse(adresse);
  return `<ram:${balise}><ram:Name>${x(nom)}</ram:Name>`
    + (idLegal ? `<ram:SpecifiedLegalOrganization><ram:ID${schemaLegal ? ` schemeID="${schemaLegal}"` : ''}>${x(idLegal)}</ram:ID></ram:SpecifiedLegalOrganization>` : '')
    + `<ram:PostalTradeAddress>${a.npa ? `<ram:PostcodeCode>${x(a.npa)}</ram:PostcodeCode>` : ''}${a.rue ? `<ram:LineOne>${x(a.rue)}</ram:LineOne>` : ''}${a.ville ? `<ram:CityName>${x(a.ville)}</ram:CityName>` : ''}<ram:CountryID>${x(pays)}</ram:CountryID></ram:PostalTradeAddress>`
    + (email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(email)}</ram:URIID></ram:URIUniversalCommunication>` : '')
    + (tva ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(tva)}</ram:ID></ram:SpecifiedTaxRegistration>` : '')
    + (!tva && fiscal ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(fiscal)}</ram:ID></ram:SpecifiedTaxRegistration>` : '')
    + `</ram:${balise}>`;
}

/* Produit le XML. avoir = true : note de crédit (type 381) qui renvoie à la facture d'origine. */
function produire(c, config, { avoir = false, devise = 'EUR' } = {}) {
  const e = config.entreprise || {}, pays = String(config.boutique.pays || 'fr').toUpperCase();
  const parTaux = ventiler(c);
  const categorie = t => t > 0 ? 'S' : 'E';
  const motif = MOTIF_EXONERATION[config.boutique.pays] || MOTIF_EXONERATION.fr;

  // Lignes HT : prix unitaire HT (4 décimales), montant de ligne arrondi au centime.
  const lignes = c.lignes.map((l, i) => {
    const t = tauxDeLigne(c, l), pu = Math.round(l.prix / (1 + t) * 10000) / 10000;
    return { id: i + 1, nom: l.nom, qte: l.qte, pu, net: r2(pu * l.qte), taux: t };
  });
  // Par taux : base imprimée = lignes + frais de port − remise (les arrondis de conversion vont dans l'une ou l'autre).
  const ttcArticles = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1;
  const frais = [], remises = [];
  for (const v of parTaux) {
    const lignesHt = r2(lignes.filter(l => l.taux === v.taux).reduce((a, l) => a + l.net, 0));
    const partArticles = c.lignes.filter(l => tauxDeLigne(c, l) === v.taux).reduce((a, l) => a + l.prix * l.qte, 0) / ttcArticles;
    let port = c.port ? r2(c.port * partArticles / (1 + v.taux)) : 0;
    let remise = r2(lignesHt + port - v.ht);
    if (remise < 0) { port = r2(port - remise); remise = 0; }   // arrondi de conversion : ajouté aux frais
    if (port > 0) frais.push({ montant: port, taux: v.taux, motif: c.port ? 'Livraison' : 'Arrondi' });
    if (remise > 0) remises.push({ montant: remise, taux: v.taux, motif: c.remise ? `Remise${c.motifRemise ? ` (${String(c.motifRemise).slice(0, 60)})` : ''}` : 'Arrondi' });
  }
  const totalLignes = r2(lignes.reduce((a, l) => a + l.net, 0));
  const totalFrais = r2(frais.reduce((a, f) => a + f.montant, 0)), totalRemises = r2(remises.reduce((a, f) => a + f.montant, 0));
  const base = r2(parTaux.reduce((a, v) => a + v.ht, 0)), tva = r2(parTaux.reduce((a, v) => a + v.tva, 0)), ttc = r2(base + tva);
  const paye = avoir || !['attente'].includes(c.statut);
  const numero = avoir ? c.avoir.numero : c.facture;
  const dateDoc = avoir ? c.avoir.date : (c.dateFacture || c.date);
  const taxe = t => `<ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${categorie(t)}</ram:CategoryCode><ram:RateApplicablePercent>${pct(t)}</ram:RateApplicablePercent>`;
  const client = c.client || {};

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>${x(numero)}</ram:ID><ram:TypeCode>${avoir ? 381 : 380}</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${date102(dateDoc)}</udt:DateTimeString></ram:IssueDateTime>${avoir ? `<ram:IncludedNote><ram:Content>Avoir annulant la facture ${x(c.facture)} (commande remboursée ou annulée).</ram:Content></ram:IncludedNote>` : ''}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lignes.map(l => `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>${x(l.nom)}</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.pu.toFixed(4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.qte}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax>${taxe(l.taux)}</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${m(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`).join('\n')}
<ram:ApplicableHeaderTradeAgreement>${c.numero ? `<ram:BuyerReference>${x(`Commande ${c.numero}`)}</ram:BuyerReference>` : ''}${partie('SellerTradeParty', { nom: e.raison || config.boutique.nom, idLegal: e.siret, schemaLegal: pays === 'FR' && /^\d{14}$/.test(String(e.siret || '').replace(/\s/g, '')) ? '0002' : '', adresse: e.adresse, pays, email: e.email, tva: e.tvaIntra, fiscal: e.siret })}${partie('BuyerTradeParty', { nom: client.nom || 'Client', adresse: [client.adresse, [client.npa, client.ville].filter(Boolean).join(' ')].filter(Boolean).join(', '), pays: String(client.pays || pays).toUpperCase(), email: client.email })}</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(c.date)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>${c.referenceQr ? `<ram:PaymentReference>${x(c.referenceQr)}</ram:PaymentReference>` : ''}<ram:InvoiceCurrencyCode>${x(devise)}</ram:InvoiceCurrencyCode>${!paye && e.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>30</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(String(e.iban).replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
${parTaux.map(v => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${m(v.tva)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${v.taux > 0 ? '' : `<ram:ExemptionReason>${x(motif)}</ram:ExemptionReason>`}<ram:BasisAmount>${m(v.ht)}</ram:BasisAmount><ram:CategoryCode>${categorie(v.taux)}</ram:CategoryCode><ram:RateApplicablePercent>${pct(v.taux)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('\n')}
${[...frais.map(f => ({ ...f, charge: true })), ...remises.map(f => ({ ...f, charge: false }))].map(f => `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>${f.charge}</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${m(f.montant)}</ram:ActualAmount><ram:Reason>${x(f.motif)}</ram:Reason><ram:CategoryTradeTax>${taxe(f.taux)}</ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`).join('\n')}
${!paye && c.echeance ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${date102(c.echeance)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${m(totalLignes)}</ram:LineTotalAmount>${totalFrais ? `<ram:ChargeTotalAmount>${m(totalFrais)}</ram:ChargeTotalAmount>` : ''}${totalRemises ? `<ram:AllowanceTotalAmount>${m(totalRemises)}</ram:AllowanceTotalAmount>` : ''}<ram:TaxBasisTotalAmount>${m(base)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${x(devise)}">${m(tva)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${m(ttc)}</ram:GrandTotalAmount>${paye ? `<ram:TotalPrepaidAmount>${m(ttc)}</ram:TotalPrepaidAmount>` : ''}<ram:DuePayableAmount>${m(paye ? 0 : ttc)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${avoir ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(c.facture)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${date102(c.dateFacture || c.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/* Contrôle arithmétique des règles EN 16931 (BR-CO-10, 13, 15, 16, BR-S-08, BR-CO-17) sur le XML produit :
   sert aux tests et à refuser un fichier incohérent avant de le remettre au marchand. */
function verifier(xml) {
  const nombres = (re) => [...xml.matchAll(re)].map(v => Number(v[1]));
  const somme = (h, deb, fin) => { const s = h.indexOf(deb), e = h.indexOf(fin, s); return s < 0 ? '' : h.slice(s, e); };
  const erreurs = [];
  const tete = somme(xml, '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>', '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>');
  const T = b => { const v = new RegExp(`<ram:${b}(?: [^>]*)?>([-\\d.]+)</ram:${b}>`).exec(tete); return v ? Number(v[1]) : 0; };
  const lignes = nombres(/<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>([-\d.]+)</g);
  const ac = [...xml.matchAll(/<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>(true|false)<\/udt:Indicator><\/ram:ChargeIndicator><ram:ActualAmount>([-\d.]+)<\/ram:ActualAmount>.*?<ram:RateApplicablePercent>([\d.]+)<\/ram:RateApplicablePercent>/g)].map(v => ({ charge: v[1] === 'true', montant: Number(v[2]), taux: Number(v[3]) }));
  const egal = (a, b) => Math.abs(a - b) < 0.005;
  if (!egal(r2(lignes.reduce((a, v) => a + v, 0)), T('LineTotalAmount'))) erreurs.push('BR-CO-10');
  const frais = r2(ac.filter(v => v.charge).reduce((a, v) => a + v.montant, 0)), rem = r2(ac.filter(v => !v.charge).reduce((a, v) => a + v.montant, 0));
  if (!egal(T('ChargeTotalAmount'), frais) || !egal(T('AllowanceTotalAmount'), rem)) erreurs.push('BR-CO-11/12');
  if (!egal(r2(T('LineTotalAmount') - rem + frais), T('TaxBasisTotalAmount'))) erreurs.push('BR-CO-13');
  if (!egal(r2(T('TaxBasisTotalAmount') + T('TaxTotalAmount')), T('GrandTotalAmount'))) erreurs.push('BR-CO-15');
  if (!egal(r2(T('GrandTotalAmount') - T('TotalPrepaidAmount')), T('DuePayableAmount'))) erreurs.push('BR-CO-16');
  // Par taux : base = lignes du taux + frais − remises ; TVA = base × taux (tolérance d'une unité, comme la norme).
  const lignesTaux = [...xml.matchAll(/<ram:RateApplicablePercent>([\d.]+)<\/ram:RateApplicablePercent><\/ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>([-\d.]+)</g)].map(v => ({ taux: Number(v[1]), net: Number(v[2]) }));
  for (const v of xml.matchAll(/<ram:ApplicableTradeTax><ram:CalculatedAmount>([-\d.]+)<\/ram:CalculatedAmount>.*?<ram:BasisAmount>([-\d.]+)<\/ram:BasisAmount>.*?<ram:RateApplicablePercent>([\d.]+)</g)) {
    const tva = Number(v[1]), b = Number(v[2]), t = Number(v[3]);
    const attendu = r2(lignesTaux.filter(l => l.taux === t).reduce((a, l) => a + l.net, 0) + ac.filter(a => a.taux === t).reduce((a, f) => a + (f.charge ? f.montant : -f.montant), 0));
    if (!egal(attendu, b)) erreurs.push(`BR-S-08 (${t} %)`);
    if (Math.abs(tva - r2(b * t / 100)) > 1) erreurs.push(`BR-CO-17 (${t} %)`);
  }
  return erreurs;
}

module.exports = { produire, verifier, manques, ventiler, decouperAdresse };
