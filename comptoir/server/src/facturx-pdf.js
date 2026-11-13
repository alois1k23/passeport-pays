/* Factur-X : facture PDF/A-3 (niveau B) qui contient la facture électronique structurée (factur-x.xml, CII, profil EN 16931).
   Le même fichier est lisible par une personne (la page) et par un logiciel comptable (le XML joint).
   Le PDF est écrit ici, sans dépendance :
   - polices DejaVu intégrées en sous-ensemble (Type0, Identity-H) avec table ToUnicode : texte copiable et cherchable ;
   - profil de couleur sRGB (OutputIntent), couleurs en RVB uniquement ;
   - métadonnées XMP : identification PDF/A-3B et schéma d'extension Factur-X (type, nom du fichier, version, profil) ;
   - XML joint avec la relation « Data » (AFRelationship), référencé par le catalogue (AF) et l'arbre des fichiers joints ;
   - dictionnaire Info identique aux métadonnées XMP, identifiant de fichier, table des références exacte.
   Les montants sont ceux du XML (même ventilation par taux), donc ceux de la facture imprimée.
   Limite connue : la conformité PDF/A n'a pas été contrôlée par veraPDF (outil absent de l'environnement de développement). */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const Police = require('./police-ttf');
const FactureElectronique = require('./facture-electronique');
const prix = require('./prix');

const RESSOURCES = path.join(__dirname, '..', 'ressources');
const POLICES = { r: path.join(RESSOURCES, 'DejaVuSans.ttf'), b: path.join(RESSOURCES, 'DejaVuSans-Bold.ttf') };
let icc = null;
const profilIcc = () => icc || (icc = fs.readFileSync(path.join(RESSOURCES, 'sRGB.icc')));

const L = 595.28, H = 841.89, MARGE = 48;   // A4, en points

/* ---------- Texte ---------- */
// Espaces insécables et fines (formats monétaires) : espace simple ; caractères de contrôle retirés.
const normaliser = t => String(t ?? '').replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '');

class Texte {
  constructor() { this.polices = { r: Police.charger(POLICES.r), b: Police.charger(POLICES.b) }; this.utilises = { r: new Map(), b: new Map() }; }
  /* Glyphes d'un texte ; un caractère absent de la police devient « ? » (jamais le glyphe .notdef, interdit en PDF/A). */
  glyphes(t, s) {
    const p = this.polices[s], out = [];
    for (const car of normaliser(t)) {
      const c = car.codePointAt(0);
      let g = p.correspondance.get(c), u = car;
      if (!g) { g = p.correspondance.get(63); u = '?'; }
      this.utilises[s].set(g, this.utilises[s].get(g) || u);
      out.push(g);
    }
    return out;
  }
  largeur(t, taille, s = 'r') {
    const p = this.polices[s];
    let l = 0; for (const car of normaliser(t)) { const g = p.correspondance.get(car.codePointAt(0)) || p.correspondance.get(63); l += p.avance[g]; }
    return l * taille / p.unites;
  }
  /* Coupe un texte en lignes d'au plus « max » points (mots entiers ; un mot trop long est coupé entre deux caractères).
     Temps linéaire : largeurs cumulées caractère par caractère, texte borné, arrêt dès que les lignes permises sont remplies. */
  couper(t, taille, max, s = 'r', lignesMax = 3) {
    const p = this.polices[s], k = taille / p.unites;
    const larg = car => p.avance[p.correspondance.get(car.codePointAt(0)) || p.correspondance.get(63)] * k;
    const cars = [...normaliser(t).slice(0, 2000)];
    const lignes = []; let cour = [], lc = 0, coupe = false;
    const pousser = () => { lignes.push(cour.join('').trim()); cour = []; lc = 0; return lignes.length >= lignesMax; };
    for (let i = 0; i < cars.length; i++) {
      const car = /\s/.test(cars[i]) ? ' ' : cars[i];
      if (car === ' ' && !cour.length) continue;
      if (car === ' ') {   // mot suivant : tient-il sur la ligne ?
        let j = i + 1, lm = larg(' '); while (j < cars.length && !/\s/.test(cars[j])) lm += larg(cars[j++]);
        if (lc + lm > max && lm - larg(' ') <= max) { if (pousser()) { coupe = j < cars.length || i + 1 < cars.length; break; } continue; }
      }
      const l = larg(car);
      if (lc + l > max && cour.length) { if (pousser()) { coupe = true; break; } if (car === ' ') continue; }
      cour.push(car); lc += l;
    }
    if (!coupe && cour.length) lignes.push(cour.join('').trim());
    if (coupe) { let d = [...lignes[lignes.length - 1]]; let ld = d.reduce((a, c) => a + larg(c), 0); while (d.length && ld + larg('…') > max) ld -= larg(d.pop()); lignes[lignes.length - 1] = `${d.join('')}…`; }
    return lignes.length ? lignes : [''];
  }
}

/* ---------- Page ---------- */
class Page {
  constructor(texte) { this.t = texte; this.ops = []; }
  ecrire(x, y, chaine, { taille = 9, s = 'r', couleur = [0.12, 0.12, 0.14], aligne = 'g' } = {}) {
    const lg = this.t.largeur(chaine, taille, s);
    const x0 = aligne === 'd' ? x - lg : aligne === 'c' ? x - lg / 2 : x;
    const hex = this.t.glyphes(chaine, s).map(g => g.toString(16).padStart(4, '0')).join('');
    this.ops.push(`BT ${couleur.map(n => n.toFixed(3)).join(' ')} rg /F${s} ${taille} Tf ${x0.toFixed(2)} ${y.toFixed(2)} Td <${hex}> Tj ET`);
    return lg;
  }
  trait(x1, y1, x2, y2, { epaisseur = 0.5, couleur = [0.8, 0.8, 0.82] } = {}) {
    this.ops.push(`${couleur.map(n => n.toFixed(3)).join(' ')} RG ${epaisseur} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  rectangle(x, y, l, h, couleur) { this.ops.push(`${couleur.map(n => n.toFixed(3)).join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${l.toFixed(2)} ${h.toFixed(2)} re f`); }
}

/* Texte des métadonnées : identique dans Info et dans XMP (PDF/A 6.6.2.3). Retire ce que XML 1.0 refuse ou normalise
   (contrôles, retours chariot, U+FFFE/U+FFFF, demi-paires UTF-16 isolées), borné à 200 caractères. */
const propre0 = t => normaliser(t).replace(/[\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/\s+/g, ' ').trim();
const propre = t => [...propre0(t)].slice(0, 200).join('') || 'Facture';

/* ---------- Mise en page de la facture ---------- */
const dateFr = ms => new Date(ms).toLocaleDateString('fr-FR');   // fuseau du processus, comme les dates du XML (TZ=Europe/Zurich en production)
const pctTva = t => `${(Math.round(t * 1000) / 10).toString().replace('.', ',')} %`;

function composer(c, config, { avoir, devise }) {
  const e = config.entreprise || {}, pays = config.boutique.pays, ch = pays === 'ch';
  const defaut = prix.tauxTva(config);
  const parTaux = FactureElectronique.ventiler(c, defaut);
  const sansTva = parTaux.every(v => !v.taux);
  const signe = avoir ? -1 : 1;
  // Même format que le reste de Comptoir : « 1 234,50 € », « CHF 1’234.50 ».
  if (!/^[A-Z]{3}$/.test(devise)) devise = 'EUR';
  const brut = n => { n = Math.round(n * 100) / 100 + 0; if (devise !== 'CHF') return normaliser(n.toLocaleString('fr-FR', { style: 'currency', currency: devise })).replace('-', '−'); const [ent, dec] = Math.abs(n).toFixed(2).split('.'); return `${n < 0 ? '−' : ''}CHF ${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}.${dec}`; };
  const format = { format: brut };
  const argent = n => brut(signe * n);
  const tauxLigne = l => typeof l.tauxTva === 'number' ? l.tauxTva : typeof c.tauxTva === 'number' ? c.tauxTva : defaut;
  const client = c.client || {};
  const numero = avoir ? c.avoir.numero : c.facture;
  const dateDoc = avoir ? c.avoir.date : (c.dateFacture || c.date);
  const paye = FactureElectronique.estPayee(c);

  const t = new Texte(), pages = [];
  let p, y;
  const gris = [0.42, 0.42, 0.46];
  const nouvellePage = () => { p = new Page(t); pages.push(p); y = H - MARGE; };
  nouvellePage();

  // En-tête : vendeur à gauche, type et numéro à droite.
  const ei = !ch && /micro|^ei$|entrepreneur individuel/i.test(e.forme || '') ? ' EI' : '';
  let yv = y - 4;
  for (const morceau of t.couper(`${e.raison || config.boutique.nom}${ei}`, 14, 300, 'b', 2)) { p.ecrire(MARGE, yv, morceau, { taille: 14, s: 'b' }); yv -= 17; }
  yv -= 1;
  const idLegal = ch ? 'IDE' : pays === 'be' ? 'N° d’entreprise' : 'SIRET';
  for (const ligne of [[e.forme, e.siret ? `${idLegal} ${e.siret}` : ''].filter(Boolean).join(' · '), e.tvaIntra ? `N° TVA ${e.tvaIntra}` : '', e.adresse, e.email].filter(Boolean)) {
    for (const morceau of t.couper(ligne, 8.5, 280)) { p.ecrire(MARGE, yv, morceau, { taille: 8.5, couleur: gris }); yv -= 12; }
  }
  p.ecrire(L - MARGE, y - 4, avoir ? 'AVOIR' : 'FACTURE', { taille: 9, s: 'b', couleur: gris, aligne: 'd' });
  p.ecrire(L - MARGE, y - 22, String(numero), { taille: 13, s: 'b', aligne: 'd' });
  p.ecrire(L - MARGE, y - 38, dateFr(dateDoc), { taille: 9, aligne: 'd' });
  y = Math.min(yv, y - 50) - 14;

  if (avoir) {
    p.rectangle(MARGE, y - 8, L - 2 * MARGE, 22, [0.96, 0.96, 0.97]);
    p.ecrire(MARGE + 8, y, t.couper(c.avoir.libelle ? `${c.avoir.libelle.replace(/\.$/, '')} (facture du ${dateFr(c.dateFacture || c.date)}).` : `Avoir annulant la facture ${c.facture} du ${dateFr(c.dateFacture || c.date)} (commande ${c.statut === 'remboursee' ? 'remboursée' : 'annulée'}).`, 9, L - 2 * MARGE - 16, 'r', 1)[0], { taille: 9 });
    y -= 30;
  }

  // Client
  p.ecrire(MARGE, y, avoir ? 'Client' : 'Facturé à', { taille: 8.5, couleur: gris }); y -= 14;
  for (const morceau of t.couper(client.nom || 'Client', 10, 300, 'b', 2)) { p.ecrire(MARGE, y, morceau, { taille: 10, s: 'b' }); y -= 13; }
  for (const ligne of [client.adresse, [client.npa, client.ville].filter(Boolean).join(' '), client.email, client.tva ? `N° TVA ${client.tva}` : ''].filter(Boolean)) {
    for (const morceau of t.couper(ligne, 9, 300, 'r', 2)) { p.ecrire(MARGE, y, morceau, { taille: 9, couleur: gris }); y -= 12; }
  }
  if (c.numero) { p.ecrire(MARGE, y, `Commande n° ${c.numero} du ${dateFr(c.date)}`, { taille: 9, couleur: gris }); y -= 12; }
  y -= 14;

  // Tableau des lignes
  const col = sansTva
    ? { nom: MARGE, qte: 360, pu: 450, total: L - MARGE }
    : { nom: MARGE, qte: 300, pu: 380, tva: 440, total: L - MARGE };
  const largeurNom = (sansTva ? 360 : 300) - 30 - MARGE;
  const enteteTableau = () => {
    p.rectangle(MARGE, y - 5, L - 2 * MARGE, 18, [0.95, 0.95, 0.96]);
    p.ecrire(col.nom + 6, y, 'Désignation', { taille: 8.5, s: 'b' });
    p.ecrire(col.qte, y, 'Qté', { taille: 8.5, s: 'b', aligne: 'd' });
    p.ecrire(col.pu, y, sansTva ? 'Prix unitaire' : 'PU HT', { taille: 8.5, s: 'b', aligne: 'd' });
    if (!sansTva) p.ecrire(col.tva, y, 'TVA', { taille: 8.5, s: 'b', aligne: 'd' });
    p.ecrire(col.total - 6, y, sansTva ? 'Total' : 'Total TTC', { taille: 8.5, s: 'b', aligne: 'd' });
    y -= 20;
  };
  let dansTableau = true;   // l'en-tête du tableau n'est répété que pour des lignes d'articles
  const place = h => { if (y - h < MARGE + 40) { nouvellePage(); if (dansTableau) enteteTableau(); } };
  enteteTableau();
  const rangee = (libelle, qte, pu, tva, total, { s = 'r', couleur } = {}) => {
    const morceaux = t.couper(libelle, 9, largeurNom, s);
    place(morceaux.length * 12 + 6);
    morceaux.forEach((m, i) => p.ecrire(col.nom + 6, y - i * 12, m, { taille: 9, s, couleur }));
    if (qte !== '') p.ecrire(col.qte, y, String(qte), { taille: 9, aligne: 'd', couleur });
    if (pu !== '') p.ecrire(col.pu, y, pu, { taille: 9, aligne: 'd', couleur });
    if (!sansTva && tva !== '') p.ecrire(col.tva, y, tva, { taille: 9, aligne: 'd', couleur });
    p.ecrire(col.total - 6, y, total, { taille: 9, aligne: 'd', couleur });
    y -= morceaux.length * 12 + 2;
    p.trait(MARGE, y + 6, L - MARGE, y + 6, { epaisseur: 0.3 });
    y -= 6;
  };
  for (const l of c.lignes) {
    const tl = tauxLigne(l);
    rangee(l.nom, l.qte, sansTva ? argent(l.prix) : argent(l.prix / (1 + tl)), pctTva(tl), argent(l.prix * l.qte));
  }
  if (c.remise) rangee(`Remise${c.motifRemise ? ` (${String(c.motifRemise).slice(0, 60)})` : ''}, déjà déduite des prix`, '', '', '', normaliser(format.format(c.remise)), { couleur: gris });
  if (c.port) rangee('Livraison', 1, sansTva ? argent(c.port) : '—', sansTva ? '' : 'au prorata', argent(c.port));

  // Totaux
  const lignesTotaux = sansTva ? [] : parTaux.flatMap(v => [[`Base HT ${pctTva(v.taux)}`, argent(v.ht)], [`TVA ${pctTva(v.taux)}`, argent(v.tva)]]);
  const ht = parTaux.reduce((a, v) => a + v.ht, 0), tva = parTaux.reduce((a, v) => a + v.tva, 0), ttc = parTaux.reduce((a, v) => a + v.ttc, 0);
  if (!sansTva) lignesTotaux.push(['Total HT', argent(ht)], ['Total TVA', argent(tva)]);
  dansTableau = false;
  const arrondiEspeces = !avoir && FactureElectronique.estPayee(c) && typeof c.arrondi === 'number' && c.arrondi && typeof c.encaisse === 'number';   // même condition que le XML
  place(lignesTotaux.length * 14 + 40 + (arrondiEspeces ? 28 : 0));
  y -= 6;
  const xLib = L - MARGE - 210;
  for (const [lib, val] of lignesTotaux) { p.ecrire(xLib, y, lib, { taille: 9, couleur: gris }); p.ecrire(L - MARGE - 6, y, val, { taille: 9, aligne: 'd' }); y -= 14; }
  p.trait(xLib, y + 9, L - MARGE, y + 9, { epaisseur: 0.8, couleur: [0.2, 0.2, 0.22] });
  y -= 6;
  p.ecrire(xLib, y, sansTva ? 'Total' : 'Total TTC', { taille: 11, s: 'b' });
  p.ecrire(L - MARGE - 6, y, argent(ttc), { taille: 11, s: 'b', aligne: 'd' });
  y -= 16;
  if (arrondiEspeces) {
    for (const [lib, val] of [['Arrondi espèces', normaliser(format.format(c.arrondi))], ['Encaissé', normaliser(format.format(c.encaisse))]]) { p.ecrire(xLib, y, lib, { taille: 9, couleur: gris }); p.ecrire(L - MARGE - 6, y, val, { taille: 9, aligne: 'd' }); y -= 14; }
  }
  y -= 18;

  // Mentions : régime de TVA, paiement, et présence des données structurées.
  const franchise = { fr: 'TVA non applicable, art. 293 B du CGI', be: 'Régime particulier de franchise des petites entreprises (art. 56bis du Code de la TVA)', ch: 'Entreprise non assujettie à la TVA' }[pays] || 'TVA non applicable';
  const mentions = [];
  if (sansTva) mentions.push(`${franchise}.`);
  if (avoir) mentions.push(paye ? 'Montant remboursé.' : 'Cet avoir solde la facture, qui n’a pas été payée.');
  else if (paye) mentions.push(ch ? 'Paiement reçu. Merci pour votre achat.' : 'Paiement reçu.');
  else {
    mentions.push(`Montant à payer : ${argent(ttc)}${c.echeance ? `, au plus tard le ${dateFr(c.echeance)}` : ''}.`);
    if (e.iban) mentions.push(`IBAN : ${String(e.iban).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()}${c.referenceQr ? ` · Référence : ${c.referenceQr}` : ''}`);
  }
  if (avoir && c.carteCadeau && c.carteCadeau.montant > 0 && c.avoir && c.avoir.libelle) mentions.push(`Dont ${brut(c.carteCadeau.montant)} recrédités sur la carte cadeau ····${c.carteCadeau.fin}.`);
  if (!avoir && c.carteCadeau && c.carteCadeau.montant > 0) mentions.push(`Dont ${brut(c.carteCadeau.montant)} réglés par carte cadeau ····${c.carteCadeau.fin}.`);
  // Vente entre professionnels (commande issue d'un devis) : mentions de l'art. L441-9 du Code de commerce (France).
  if (!avoir && c.canal === 'devis') {
    if (c.devis) mentions.push(`Selon le devis ${c.devis.numero} accepté.`);
    if (!paye && c.echeance) mentions.push(`Échéance de paiement : ${dateFr(c.echeance)}.`);
    if (pays === 'fr') mentions.push('Pas d’escompte pour paiement anticipé. En cas de retard de paiement, pénalités au taux de trois fois le taux d’intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce).');
  }
  mentions.push('Ce PDF/A-3 contient la facture électronique structurée (fichier joint factur-x.xml, norme européenne EN 16931).');
  const morceauxMentions = mentions.map(m => t.couper(m, 8.5, L - 2 * MARGE, 'r', 4));
  place(morceauxMentions.reduce((a, m) => a + m.length * 12, 0));   // les mentions restent ensemble
  for (const morceaux of morceauxMentions) for (const morceau of morceaux) { p.ecrire(MARGE, y, morceau, { taille: 8.5, couleur: gris }); y -= 12; }

  // Pied de page : numéro et pagination.
  pages.forEach((pg, i) => {
    pg.trait(MARGE, MARGE - 8, L - MARGE, MARGE - 8, { epaisseur: 0.3 });
    pg.ecrire(MARGE, MARGE - 22, `${avoir ? 'Avoir' : 'Facture'} ${numero}`, { taille: 7.5, couleur: gris });
    pg.ecrire(L - MARGE, MARGE - 22, `Page ${i + 1} sur ${pages.length}`, { taille: 7.5, couleur: gris, aligne: 'd' });
  });
  return { texte: t, pages, numero, titre: propre(`${avoir ? 'Avoir' : 'Facture'} ${numero}`), auteur: propre(e.raison || config.boutique.nom) };
}

/* ---------- Écriture du PDF ---------- */
// Chaîne PDF en UTF-16BE (texte quelconque dans Info et Filespec).
const chaineUtf16 = t => `<FEFF${Buffer.from(String(t), 'utf16le').swap16().toString('hex').toUpperCase()}>`;
const chaineAscii = t => `(${String(t).replace(/[\\()]/g, m => `\\${m}`)})`;
const xmlEchap = t => String(t ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function dates(ms) {
  const d = new Date(Math.floor(ms / 1000) * 1000), z = n => String(n).padStart(2, '0');
  const [a, mo, j, h, mi, s] = [d.getUTCFullYear(), z(d.getUTCMonth() + 1), z(d.getUTCDate()), z(d.getUTCHours()), z(d.getUTCMinutes()), z(d.getUTCSeconds())];
  return { pdf: `D:${a}${mo}${j}${h}${mi}${s}+00'00'`, xmp: `${a}-${mo}-${j}T${h}:${mi}:${s}+00:00` };
}

function xmp({ titre, auteur, producteur, date }) {
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<pdfaid:part>3</pdfaid:part>
<pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEchap(titre)}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${xmlEchap(auteur)}</rdf:li></rdf:Seq></dc:creator>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdf:Producer>${xmlEchap(producteur)}</pdf:Producer>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<xmp:CreatorTool>${xmlEchap(producteur)}</xmp:CreatorTool>
<xmp:CreateDate>${date}</xmp:CreateDate>
<xmp:ModifyDate>${date}</xmp:ModifyDate>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas>
<rdf:Bag>
<rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property>
<rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
</rdf:Seq>
</pdfaSchema:property>
</rdf:li>
</rdf:Bag>
</pdfaExtension:schemas>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
<fx:DocumentType>INVOICE</fx:DocumentType>
<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
<fx:Version>1.0</fx:Version>
<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/* Polices : Type0 (Identity-H) → CIDFontType2 → descripteur → fichier réduit ; ToUnicode pour l'extraction du texte. */
function objetsPolice(pdf, police, utilises, prefixe) {
  const gids = [...utilises.keys()].sort((a, b) => a - b);
  const etiquette = crypto.createHash('sha256').update(`${prefixe}${gids.join(',')}`).digest().subarray(0, 6).map(o => 65 + (o % 26)).toString('latin1');
  const nom = `${etiquette}+${police.nomPostScript}`;
  const fichier = Police.sousEnsemble(police, gids);
  const k = 1000 / police.unites, e = n => Math.round(n * k);
  const refFichier = pdf.flux(`/Length1 ${fichier.length}`, fichier);
  const descripteur = pdf.objet(`<< /Type /FontDescriptor /FontName /${nom} /Flags 32 /FontBBox [${police.bbox.map(e).join(' ')}] /ItalicAngle ${police.angle} /Ascent ${e(police.ascendante)} /Descent ${e(police.descendante)} /CapHeight ${e(police.hauteurCapitales)} /StemV ${police.graisse >= 600 ? 120 : 80} /FontFile2 ${refFichier} >>`);
  const largeurs = gids.map(g => `${g} [${e(police.avance[g])}]`).join(' ');
  const cid = pdf.objet(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${nom} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descripteur} /CIDToGIDMap /Identity /DW 1000 /W [${largeurs}] >>`);
  const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase();
  const blocs = [];
  for (let i = 0; i < gids.length; i += 100) {
    const tranche = gids.slice(i, i + 100);
    blocs.push(`${tranche.length} beginbfchar\n${tranche.map(g => `<${hex4(g)}> <${Buffer.from(utilises.get(g), 'utf16le').swap16().toString('hex').toUpperCase()}>`).join('\n')}\nendbfchar`);
  }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocs.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const versUnicode = pdf.flux('', Buffer.from(cmap, 'latin1'));
  return pdf.objet(`<< /Type /Font /Subtype /Type0 /BaseFont /${nom} /Encoding /Identity-H /DescendantFonts [${cid}] /ToUnicode ${versUnicode} >>`);
}

class EcrivainPdf {
  constructor() { this.objets = []; }
  reserver() { this.objets.push(null); return this.objets.length; }
  definir(n, corps) { this.objets[n - 1] = Buffer.isBuffer(corps) ? corps : Buffer.from(corps, 'latin1'); return `${n} 0 R`; }
  objet(corps) { return this.definir(this.reserver(), corps); }
  /* Flux compressé (Flate). « brut » : flux non compressé (métadonnées XMP, lisibles par les outils d'archivage). */
  flux(dico, donnees, { brut = false } = {}) {
    const d = brut ? donnees : zlib.deflateSync(donnees, { level: 9 });
    return this.objet(Buffer.concat([Buffer.from(`<< ${dico}${brut ? '' : ' /Filter /FlateDecode'} /Length ${d.length} >>\nstream\n`, 'latin1'), d, Buffer.from('\nendstream', 'latin1')]));
  }
  produire(racine, info, id) {
    const morceaux = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let pos = morceaux[0].length; const decalages = [];
    this.objets.forEach((corps, i) => {
      decalages.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), corps, Buffer.from('\nendobj\n', 'latin1')]);
      morceaux.push(b); pos += b.length;
    });
    const n = this.objets.length + 1;
    const xref = `xref\n0 ${n}\n0000000000 65535 f\r\n${decalages.map(o => `${String(o).padStart(10, '0')} 00000 n\r\n`).join('')}`;
    morceaux.push(Buffer.from(`${xref}trailer\n<< /Size ${n} /Root ${racine} /Info ${info} /ID [<${id}> <${id}>] >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(morceaux);
  }
}

/* Produit le PDF Factur-X. Les contrôles (manques, cohérence du XML) sont faits par l'appelant, comme pour le XML seul. */
function produire(c, config, { avoir = false, devise = 'EUR', xml, maintenant = Date.now() } = {}) {
  const doc = composer(c, config, { avoir, devise });
  const pdf = new EcrivainPdf();
  const { pdf: datePdf, xmp: dateXmp } = dates(maintenant);
  const producteur = 'Comptoir, Factur-X EN 16931';

  const catalogue = pdf.reserver(), arbre = pdf.reserver();
  // Une police jamais utilisée n'est pas intégrée.
  const ressources = `<< /Font << ${['r', 'b'].filter(s => doc.texte.utilises[s].size).map(s => `/F${s} ${objetsPolice(pdf, doc.texte.polices[s], doc.texte.utilises[s], s)}`).join(' ')} >> >>`;
  const refsPages = doc.pages.map(pg => {
    const contenu = pdf.flux('', Buffer.from(pg.ops.join('\n'), 'latin1'));
    return pdf.objet(`<< /Type /Page /Parent ${arbre} 0 R /MediaBox [0 0 ${L} ${H}] /Resources ${ressources} /Contents ${contenu} >>`);
  });
  pdf.definir(arbre, `<< /Type /Pages /Kids [${refsPages.join(' ')}] /Count ${refsPages.length} >>`);

  const metadonnees = pdf.flux('/Type /Metadata /Subtype /XML', Buffer.from(xmp({ titre: doc.titre, auteur: doc.auteur, producteur, date: dateXmp }), 'utf8'), { brut: true });
  const profil = pdf.flux('/N 3', profilIcc());
  const intention = pdf.objet(`<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /RegistryName (http://www.color.org) /DestOutputProfile ${profil} >>`);
  const donneesXml = Buffer.from(xml, 'utf8');
  const fichierXml = pdf.flux(`/Type /EmbeddedFile /Subtype /text#2Fxml /Params << /ModDate (${datePdf}) /Size ${donneesXml.length} /CheckSum <${crypto.createHash('md5').update(donneesXml).digest('hex')}> >>`, donneesXml);
  const specification = pdf.objet(`<< /Type /Filespec /F (factur-x.xml) /UF ${chaineUtf16('factur-x.xml')} /Desc ${chaineUtf16(`Facture électronique structurée (EN 16931) : ${doc.titre}`)} /AFRelationship /Data /EF << /F ${fichierXml} /UF ${fichierXml} >> >>`);
  pdf.definir(catalogue, `<< /Type /Catalog /Pages ${arbre} 0 R /Metadata ${metadonnees} /OutputIntents [${intention}] /AF [${specification}] /Names << /EmbeddedFiles << /Names [(factur-x.xml) ${specification}] >> >> /Lang (fr-FR) /ViewerPreferences << /DisplayDocTitle true >> /PageMode /UseAttachments >>`);
  const info = pdf.objet(`<< /Title ${chaineUtf16(doc.titre)} /Author ${chaineUtf16(doc.auteur)} /Creator ${chaineAscii(producteur)} /Producer ${chaineAscii(producteur)} /CreationDate (${datePdf}) /ModDate (${datePdf}) >>`);
  const id = crypto.createHash('md5').update(`${c.id}|${doc.numero}|${maintenant}`).digest('hex').toUpperCase();
  return pdf.produire(`${catalogue} 0 R`, info, id);
}

module.exports = { produire };
