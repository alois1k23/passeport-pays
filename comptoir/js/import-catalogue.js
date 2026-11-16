/* Comptoir — import d'un catalogue existant (export CSV de Shopify, WooCommerce, PrestaShop, ou tableur simple).
   Module pur : lit le texte, reconnaît le format, renvoie des produits au format de Comptoir et les erreurs ligne
   par ligne. Rien n'est écrit ici ; l'enregistrement passe ensuite par la même validation que la saisie à la main.
   Les descriptions HTML deviennent du texte : les balises sont retirées ; ce qui ressemble encore à une balise (entités
   décodées) reste du texte, toujours échappé à l'affichage. */
(function (racine) {
'use strict';

const MAX_LIGNES = 20000, MAX_PRODUITS = 2000, MAX_CHAMP = 20000;

/* CSV selon la RFC 4180 : guillemets, guillemets doublés, retours à la ligne dans un champ, BOM, séparateur , ; ou tab. */
function lireCsv(texte) {
  const t = String(texte || '').replace(/^﻿/, '');
  const premiere = t.slice(0, t.search(/\r?\n/) === -1 ? t.length : t.search(/\r?\n/));
  const compte = c => (premiere.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) || []).length;
  const sep = [',', ';', '\t'].sort((a, b) => compte(b) - compte(a))[0];
  const lignes = []; let ligne = [], champ = '', guillemets = false, i = 0;
  const finChamp = () => { if (champ.length > MAX_CHAMP) champ = champ.slice(0, MAX_CHAMP); ligne.push(champ); champ = ''; };
  const finLigne = () => { finChamp(); if (ligne.length > 1 || ligne[0] !== '') lignes.push(ligne); ligne = []; if (lignes.length > MAX_LIGNES) throw Object.assign(new Error(`Fichier trop long : ${MAX_LIGNES} lignes au plus. Importez-le en plusieurs fois.`), { code: 'trop_de_lignes' }); };
  while (i < t.length) {
    const c = t[i];
    if (guillemets) {
      if (c === '"') { if (t[i + 1] === '"') { champ += '"'; i += 2; continue; } guillemets = false; i++; continue; }
      champ += c; i++; continue;
    }
    if (c === '"' && champ === '') { guillemets = true; i++; continue; }
    if (c === sep) { finChamp(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { finLigne(); i++; continue; }
    champ += c; i++;
  }
  if (champ !== '' || ligne.length) finLigne();
  return { separateur: sep, lignes };
}

/* HTML d'une description → texte : balises de bloc en retours à la ligne, entités décodées, rien d'autre ne passe. */
const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—', euro: '€', laquo: '«', raquo: '»' };
// Temps linéaire : texte borné avant toute expression, et aucune répétition qui puisse repartir de chaque « < »
// (un champ de 20 000 « < » sans « > » coûtait 175 ms avec <[^>]*> ; un fichier entier, 12 secondes).
function texteDepuisHtml(html) {
  return String(html || '').slice(0, 12000)
    .replace(/<(script|style|iframe|object|template)\b[^<>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^<>]*>/gi, '• ')
    .replace(/<[^<>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' '; }
      return ENTITES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* Nombre écrit à la suisse, à la française ou à l'anglaise : « 1'290.50 », « 1 290,50 », « 1,290.50 », « 29,9 ». */
function lireNombre(v) {
  let s = String(v ?? '').replace(/[\s  '’]|CHF|EUR|€|Fr\.?/gi, '').replace(/[.,][-–—]+$/, '').replace(/\.$/, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{3}$/.test(s) && !/^0,/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}
const oui = v => /^(true|vrai|oui|yes|1|active|publish|published|actif)$/i.test(String(v || '').trim());

/* Formats reconnus par leurs en-têtes (tels que les plateformes les écrivent dans leurs exports). */
const norm = h => String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*\*$/, '').replace(/\s+/g, ' ').trim();
function detecterFormat(entetes) {
  const h = new Set(entetes.map(norm));
  if (h.has('handle') && (h.has('title') || h.has('variant price'))) return 'shopify';
  if ((h.has('type') && h.has('regular price')) || (h.has('parent') && h.has('attribute 1 name'))) return 'woocommerce';
  if ([...h].some(x => x.startsWith('price tax')) || [...h].some(x => x.startsWith('categories (x'))) return 'prestashop';
  if ([...h].some(x => ['nom', 'name', 'produit', 'titre', 'title'].includes(x)) && [...h].some(x => ['prix', 'price', 'prix ttc'].includes(x))) return 'simple';
  return null;
}
const NOMS = { shopify: 'Shopify', woocommerce: 'WooCommerce', prestashop: 'PrestaShop', simple: 'tableur' };

function convertir(texte) {
  const { lignes } = lireCsv(texte);
  if (lignes.length < 2) return { format: null, produits: [], erreurs: [{ ligne: 1, message: 'Fichier vide ou sans ligne de produit.' }] };
  const entetes = lignes[0], format = detecterFormat(entetes);
  if (!format) return { format: null, produits: [], erreurs: [{ ligne: 1, message: 'Format non reconnu : utilisez l’export CSV de Shopify, WooCommerce ou PrestaShop, ou un tableur avec au moins les colonnes « nom » et « prix ».' }] };
  const idx = {}; entetes.forEach((e, i) => { const k = norm(e); if (!(k in idx)) idx[k] = i; });
  // Apostrophe de tête ajoutée par un export (le nôtre, ou un tableur) pour neutraliser une formule : retirée à la lecture.
  const sansApostrophe = t => t.replace(/^'(?=\s*[=@\uFF1D\uFF20+\-\uFF0B\uFF0D\t\r])/, '');
  const col = (r, ...noms) => { for (const n of noms) { const i = idx[norm(n)]; if (i !== undefined && r[i] !== undefined && String(r[i]).trim() !== '') return sansApostrophe(String(r[i]).trim()); } return ''; };
  const colDebut = (r, debut) => { const k = Object.keys(idx).find(x => x.startsWith(debut)); return k ? String(r[idx[k]] || '').trim() : ''; };
  const erreurs = [], produits = [];
  // Code-barres : gardé seulement s'il est valide (chiffre de contrôle) et pas déjà pris par un autre produit importé.
  const G = typeof module !== 'undefined' && module.exports ? require('./gtin.js') : racine.Gtin, eansVus = new Set();
  const eanVariante = (p, v) => {   // code d'une variante : mêmes règles, avertissement une seule fois
    if (v._ean !== undefined) return v._ean;
    v._ean = '';
    if (!v.ean || !G) return '';
    const e = G.canonique(v.ean);
    if (!G.valide(e)) erreurs.push({ ligne: v.ligne, avertissement: true, message: `« ${p.nom.slice(0, 40)} » (${v.valeurs.join(' / ')}) : code-barres invalide, ignoré.` });
    else if (eansVus.has(e)) erreurs.push({ ligne: v.ligne, avertissement: true, message: `« ${p.nom.slice(0, 40)} » (${v.valeurs.join(' / ')}) : code-barres ${e} déjà utilisé, ignoré.` });
    else { eansVus.add(e); v._ean = e; }
    return v._ean;
  };
  const ajouter = (p, ligne, eanBrut, marque) => {
    if (marque && String(marque).trim()) p.marque = String(marque).replace(/\s+/g, ' ').trim().slice(0, 70);
    if (eanBrut && G) {
      const e = G.canonique(eanBrut);
      if (!G.valide(e)) erreurs.push({ ligne, avertissement: true, message: `« ${p.nom.slice(0, 40)} » : code-barres « ${String(eanBrut).slice(0, 20)} » invalide, ignoré.` });
      else if (eansVus.has(e)) erreurs.push({ ligne, avertissement: true, message: `« ${p.nom.slice(0, 40)} » : code-barres ${e} déjà utilisé plus haut, ignoré.` });
      else { eansVus.add(e); p.ean = e; }
    } if (produits.length >= MAX_PRODUITS) { if (!erreurs.some(e => e.code === 'trop_de_produits')) erreurs.push({ ligne, code: 'trop_de_produits', message: `${MAX_PRODUITS} produits au plus par import : le reste est ignoré, importez-le ensuite.` }); return; } produits.push(p); };
  const prixOk = (v, ligne, quoi) => { const n = lireNombre(v); if (n === null) return null; if (!Number.isFinite(n) || n < 0 || n > 100000) { erreurs.push({ ligne, message: `${quoi} illisible : « ${String(v).slice(0, 30)} ».` }); return NaN; } return Math.round(n * 100) / 100; };
  const stockOk = v => { const n = lireNombre(v); return n === null || !Number.isFinite(n) ? 0 : Math.max(0, Math.min(1e6, Math.floor(n))); };
  const imagesDe = v => String(v || '').split(/[,|\s]+/).map(x => x.trim()).filter(x => /^https:\/\/[^\s]{3,1500}$/i.test(x));
  const corps = lignes.slice(1).map((r, i) => ({ r, ligne: i + 2 }));

  if (format === 'shopify') {
    // Un produit = toutes les lignes du même « Handle » ; la première porte le titre, les suivantes des variantes ou des photos.
    const groupes = new Map();
    for (const x of corps) { const h = col(x.r, 'Handle'); if (!h) { erreurs.push({ ligne: x.ligne, message: 'Ligne sans « Handle » ignorée.' }); continue; } if (!groupes.has(h)) groupes.set(h, []); groupes.get(h).push(x); }
    for (const [handle, ls] of groupes) {
      const t = ls[0], nom = col(t.r, 'Title');
      if (!nom) { erreurs.push({ ligne: t.ligne, message: `Produit « ${handle.slice(0, 40)} » sans titre ignoré.` }); continue; }
      const optNoms = [col(t.r, 'Option1 Name'), col(t.r, 'Option2 Name')].filter(n => n && n !== 'Title');
      const variantes = ls.filter(x => col(x.r, 'Variant Price') !== '').map(x => ({ valeurs: [col(x.r, 'Option1 Value'), col(x.r, 'Option2 Value')].slice(0, optNoms.length), prix: prixOk(col(x.r, 'Variant Price'), x.ligne, 'Prix'), barre: prixOk(col(x.r, 'Variant Compare At Price'), x.ligne, 'Prix barré'), stock: stockOk(col(x.r, 'Variant Inventory Qty')), ean: col(x.r, 'Variant Barcode'), ligne: x.ligne }));
      if (variantes.some(v => Number.isNaN(v.prix))) continue;
      const base = variantes[0] || { prix: null };
      if (base.prix === null) { erreurs.push({ ligne: t.ligne, message: `« ${nom.slice(0, 40)} » sans prix ignoré.` }); continue; }
      const p = { refImport: `shopify:${handle}`.slice(0, 80), nom, description: texteDepuisHtml(col(t.r, 'Body (HTML)')), categorie: col(t.r, 'Product Category', 'Type').split('>').pop().trim(), prix: base.prix, stock: variantes.reduce((a, v) => a + v.stock, 0), actif: col(t.r, 'Status') ? /^active$/i.test(col(t.r, 'Status')) : (col(t.r, 'Published') ? oui(col(t.r, 'Published')) : true), images: [...new Set(ls.flatMap(x => imagesDe(col(x.r, 'Image Src'))))].slice(0, 1) };
      if (base.barre && base.barre > base.prix) p.prixReference = base.barre;
      if (optNoms.length && variantes.length >= 1 && variantes.some(v => v.valeurs.some(Boolean))) {
        p.options = optNoms.map((n, k) => ({ nom: n, valeurs: [...new Set(variantes.map(v => v.valeurs[k]).filter(Boolean))] }));
        p.variantes = variantes.map(v => ({ id: v.valeurs.join('/'), valeurs: v.valeurs, stock: v.stock, ...(v.prix !== base.prix ? { prix: v.prix } : {}), ...(eanVariante(p, v) ? { ean: eanVariante(p, v) } : {}), stockSaisi: true }));
      }
      ajouter(p, t.ligne, p.variantes ? '' : col(t.r, 'Variant Barcode'), col(t.r, 'Vendor'));
    }
  } else if (format === 'woocommerce') {
    // Produits « simple » et « variable » ; les « variation » se rattachent à leur parent (par identifiant ou référence).
    const parents = new Map();
    for (const x of corps) {
      const type = col(x.r, 'Type').toLowerCase();
      if (/variation/.test(type)) continue;
      if (type && !/simple|variable/.test(type)) { erreurs.push({ ligne: x.ligne, message: `Type « ${type.slice(0, 20)} » non importé (produits simples et variables seulement).` }); continue; }
      const nom = col(x.r, 'Name');
      if (!nom) { erreurs.push({ ligne: x.ligne, message: 'Produit sans nom ignoré.' }); continue; }
      const prixN = prixOk(col(x.r, 'Sale price') || col(x.r, 'Regular price'), x.ligne, 'Prix'), barre = col(x.r, 'Sale price') ? prixOk(col(x.r, 'Regular price'), x.ligne, 'Prix barré') : null;
      if (Number.isNaN(prixN) || Number.isNaN(barre)) continue;
      const p = { refImport: `woo:${col(x.r, 'SKU') || col(x.r, 'ID') || nom}`.slice(0, 80), nom, description: texteDepuisHtml(col(x.r, 'Description') || col(x.r, 'Short description')), categorie: col(x.r, 'Categories').split(',')[0].split('>').pop().trim(), prix: prixN, stock: stockOk(col(x.r, 'Stock')), actif: col(x.r, 'Published') === '' ? true : oui(col(x.r, 'Published')), images: imagesDe(col(x.r, 'Images')).slice(0, 1), _variable: /variable/.test(type), _ligne: x.ligne };
      if (barre && prixN !== null && barre > prixN) p.prixReference = barre;
      for (const cle of [col(x.r, 'ID') && `id:${col(x.r, 'ID')}`, col(x.r, 'SKU')].filter(Boolean)) parents.set(cle, p);
      ajouter(p, x.ligne, col(x.r, 'GTIN, UPC, EAN, or ISBN', 'GTIN', 'EAN'), col(x.r, 'Brands', 'Brand'));
    }
    for (const x of corps) {
      if (!/variation/.test(col(x.r, 'Type').toLowerCase())) continue;
      const parentRef = col(x.r, 'Parent'), p = parents.get(parentRef);
      if (!p) { erreurs.push({ ligne: x.ligne, message: `Variante sans produit parent (« ${parentRef.slice(0, 30)} ») ignorée.` }); continue; }
      const vals = [col(x.r, 'Attribute 1 value(s)'), col(x.r, 'Attribute 2 value(s)')].filter(Boolean).map(v => v.split(',')[0].trim());
      const noms = [col(x.r, 'Attribute 1 name'), col(x.r, 'Attribute 2 name')].filter(Boolean).slice(0, vals.length);
      const prixV = prixOk(col(x.r, 'Sale price') || col(x.r, 'Regular price'), x.ligne, 'Prix');
      if (Number.isNaN(prixV) || !vals.length) continue;
      p._vars = p._vars || []; p._noms = p._noms || noms;
      p._vars.push({ valeurs: vals.slice(0, p._noms.length), prix: prixV, stock: stockOk(col(x.r, 'Stock')), ean: col(x.r, 'GTIN, UPC, EAN, or ISBN', 'GTIN', 'EAN'), ligne: x.ligne });
    }
    for (const p of produits) {
      if (p._vars && p._vars.length) {
        if (p.prix === null) p.prix = p._vars[0].prix;
        p.options = p._noms.map((n, k) => ({ nom: n, valeurs: [...new Set(p._vars.map(v => v.valeurs[k]).filter(Boolean))] }));
        p.variantes = p._vars.map(v => ({ id: v.valeurs.join('/'), valeurs: v.valeurs, stock: v.stock, ...(v.prix !== null && v.prix !== p.prix ? { prix: v.prix } : {}), ...(eanVariante(p, v) ? { ean: eanVariante(p, v) } : {}), stockSaisi: true }));
        p.stock = p._vars.reduce((a, v) => a + v.stock, 0);
      }
      if (p.prix === null) erreurs.push({ ligne: p._ligne, message: `« ${p.nom.slice(0, 40)} » sans prix ignoré.` });
      delete p._vars; delete p._noms; delete p._variable;
    }
    for (let k = produits.length - 1; k >= 0; k--) { if (produits[k].prix === null) produits.splice(k, 1); else delete produits[k]._ligne; }
  } else {
    // PrestaShop et tableur simple : une ligne = un produit. Prix TTC de préférence ; un prix hors taxes seul est signalé.
    for (const x of corps) {
      const nom = format === 'prestashop' ? col(x.r, 'Name') : col(x.r, 'nom', 'name', 'produit', 'titre', 'title');
      if (!nom) { erreurs.push({ ligne: x.ligne, message: 'Produit sans nom ignoré.' }); continue; }
      const ttc = format === 'prestashop' ? colDebut(x.r, 'price tax incl') : col(x.r, 'prix ttc', 'prix', 'price');
      const ht = format === 'prestashop' ? colDebut(x.r, 'price tax excl') : '';
      const prixN = prixOk(ttc || ht, x.ligne, 'Prix');
      if (Number.isNaN(prixN)) continue;
      if (prixN === null) { erreurs.push({ ligne: x.ligne, message: `« ${nom.slice(0, 40)} » sans prix ignoré.` }); continue; }
      if (!ttc && ht) erreurs.push({ ligne: x.ligne, avertissement: true, message: `« ${nom.slice(0, 40)} » : seul le prix hors taxes est connu ; le produit est importé masqué, « à vérifier », jusqu’à ce que vous confirmiez son prix de vente.` });
      const barre = prixOk(col(x.r, 'prix barre', 'prix barré', 'compare at price', 'prix de reference', 'prix de référence'), x.ligne, 'Prix barré');
      const p = { refImport: `${format === 'prestashop' ? 'presta' : 'csv'}:${col(x.r, 'Reference #', 'Reference', 'référence', 'reference', 'sku', 'ref') || nom}`.slice(0, 80), nom, description: texteDepuisHtml(col(x.r, 'Description', 'description') || col(x.r, 'Short description', 'resume', 'résumé')), categorie: (format === 'prestashop' ? colDebut(x.r, 'categories (x') : col(x.r, 'categorie', 'catégorie', 'category')).split(',')[0].trim(), prix: prixN, stock: stockOk(format === 'prestashop' ? col(x.r, 'Quantity') : col(x.r, 'stock', 'quantite', 'quantité', 'quantity')), actif: format === 'prestashop' && col(x.r, 'Active (0/1)') !== '' ? oui(col(x.r, 'Active (0/1)')) : true, images: imagesDe(format === 'prestashop' ? colDebut(x.r, 'image urls (x') : col(x.r, 'image', 'images', 'photo', 'image url')).slice(0, 1) };
      if (barre && barre > prixN) p.prixReference = barre;
      if (!ttc && ht) p.aVerifier = true;
      ajouter(p, x.ligne, col(x.r, 'EAN13', 'ean', 'gtin', 'code-barres', 'code barres', 'barcode', 'UPC'), col(x.r, 'Manufacturer', 'marque', 'brand', 'fabricant'));
    }
  }
  // Libellés propres : une ligne, longueur bornée ; la validation finale reste celle de la fiche produit.
  // Valeurs d'options écrites comme la fiche produit les range (« / » et « | » interdits, 30 caractères) : sinon une
  // variante ne retrouverait pas son stock ni son prix.
  const valeurOpt = v => String(v).replace(/[\/|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 30);
  for (const p of produits) if (p.options) {
    for (const o of p.options) o.valeurs = [...new Set(o.valeurs.map(valeurOpt).filter(Boolean))];
    for (const v of p.variantes) { v.valeurs = v.valeurs.map(valeurOpt); v.id = v.valeurs.join('/'); }
  }
  // Même référence deux fois dans le fichier (tableur sans colonne de référence : même nom) : le premier est gardé.
  const vus = new Set();
  for (let k = 0; k < produits.length; k++) {
    if (!vus.has(produits[k].refImport)) { vus.add(produits[k].refImport); continue; }
    erreurs.push({ message: `« ${produits[k].nom.slice(0, 40)} » apparaît deux fois dans le fichier : seul le premier est importé.` });
    produits.splice(k--, 1);
  }
  for (const p of produits) {
    p.nom = p.nom.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    p.categorie = String(p.categorie || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    p.description = p.description.slice(0, 3000);
    if (p.options) for (const o of p.options) { o.nom = o.nom.slice(0, 30); o.valeurs = o.valeurs.slice(0, 20); }
  }
  return { format, nomFormat: NOMS[format], produits, erreurs };
}

const api = { lireCsv, texteDepuisHtml, lireNombre, detecterFormat, convertir, MAX_PRODUITS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.ImportCatalogue = api;
})(typeof window !== 'undefined' ? window : globalThis);
