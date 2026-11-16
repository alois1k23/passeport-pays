/* Comptoir — export du catalogue au format CSV de Shopify (largement repris : WooCommerce et d'autres l'importent, et
   l'import de Comptoir le relit). Le marchand garde une copie de ses produits, ou les emporte ailleurs.
   Module pur : produits → texte CSV (RFC 4180). Les cellules de texte qui commencent par = + - @ sont neutralisées (une
   apostrophe devant), pour qu'un tableur n'exécute pas une formule cachée dans un nom de produit. */
(function (racine) {
'use strict';

const COLONNES = ['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Variant Price', 'Variant Compare At Price', 'Variant Inventory Qty', 'Variant Barcode', 'Image Src', 'Status'];
const echapperHtml = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function cellule(v, texte = true) {
  let s = v === null || v === undefined ? '' : String(v);
  if (texte && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // injection de formule dans un tableur
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const slug = (t, id) => `${String(t || 'produit').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'produit'}-${String(id || '').slice(-6).toLowerCase()}`;
const prix = n => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '');

/* produits : ceux de l'état du marchand ; urlImage(p) : adresse publique de sa photo (ou '') ; marqueParDefaut : nom de la boutique. */
function versShopify(produits, { urlImage = () => '', marqueParDefaut = '' } = {}) {
  const lignes = [COLONNES.join(',')];
  for (const p of produits || []) {
    if (!p || !p.nom) continue;
    const h = slug(p.nom, p.id);
    const corps = p.description ? `<p>${echapperHtml(p.description).replace(/\n/g, '<br>')}</p>` : '';
    const communs = { Title: p.nom, 'Body (HTML)': corps, Vendor: p.marque || marqueParDefaut, Type: p.categorie || '', 'Image Src': urlImage(p) || '', Status: p.actif === false ? 'draft' : 'active' };
    const variantes = Array.isArray(p.variantes) && p.variantes.length ? p.variantes : null;
    const opts = variantes ? (p.options || []).slice(0, 2) : [];
    const rangs = variantes ? variantes.map(v => ({ valeurs: v.valeurs || [], prix: typeof v.prix === 'number' ? v.prix : p.prix, stock: v.stock, ean: v.ean })) : [{ valeurs: ['Default Title'], prix: p.prix, stock: p.stock, ean: p.ean }];
    rangs.forEach((v, i) => {
      const r = { Handle: h, ...(i === 0 ? communs : {}),
        'Option1 Name': i === 0 ? (opts[0] ? opts[0].nom : 'Title') : '', 'Option1 Value': v.valeurs[0] || '',
        'Option2 Name': i === 0 && opts[1] ? opts[1].nom : '', 'Option2 Value': opts[1] ? v.valeurs[1] || '' : '',
        'Variant Price': prix(v.prix), 'Variant Compare At Price': p.prixReference && p.prixReference > v.prix ? prix(p.prixReference) : '',
        'Variant Inventory Qty': p.type === 'drop' ? '' : String(Math.max(0, Math.floor(Number(v.stock) || 0))), 'Variant Barcode': v.ean || '' };
      lignes.push(COLONNES.map(c => cellule(r[c] ?? '', !['Variant Price', 'Variant Compare At Price', 'Variant Inventory Qty', 'Variant Barcode'].includes(c))).join(','));
    });
  }
  return '﻿' + lignes.join('\r\n') + '\r\n';
}

const api = { versShopify, COLONNES };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.ExportCatalogue = api;
})(typeof window !== 'undefined' ? window : globalThis);
