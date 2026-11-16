/* Comptoir — export du catalogue au format CSV de Shopify (largement repris : WooCommerce et d'autres l'importent, et
   l'import de Comptoir le relit). Le marchand garde une copie de ses produits, ou les emporte ailleurs.
   Module pur : produits → texte CSV (RFC 4180). Les cellules de texte qui commencent par = + - @ sont neutralisées (une
   apostrophe devant), pour qu'un tableur n'exécute pas une formule cachée dans un nom de produit. */
(function (racine) {
'use strict';

const COLONNES = ['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Variant Price', 'Variant Compare At Price', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Requires Shipping', 'Variant Barcode', 'Image Src', 'Status'];
const NUMERIQUES = new Set(['Variant Price', 'Variant Compare At Price', 'Variant Inventory Qty', 'Variant Barcode']);
const echapperHtml = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* Formule plausible pour un tableur : = ou @ (aussi en pleine chasse), tabulation ou retour chariot en tête, ou + / -
   suivi d'un chiffre, d'une parenthèse ou d'un nom de fonction ; espaces de tête ignorées. « + de goût » reste intact. */
const FORMULE = /^\s*(?:[=@\uFF1D\uFF20\t\r]|[+\-\uFF0B\uFF0D]\s*(?:[\d(.]|[A-Za-z_][\w.]*\s*\())/;
function cellule(v, texte = true) {
  let s = v === null || v === undefined ? '' : String(v);
  if (texte && FORMULE.test(s)) s = "'" + s;   // injection de formule dans un tableur (l'import de Comptoir retire l'apostrophe)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// Empreinte courte et stable de l'identifiant (lettres minuscules et chiffres seulement, comme l'exige Shopify).
const empreinte = id => { let h = 5381; for (const c of String(id || '')) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(36).padStart(6, '0').slice(-6); };
const slugTexte = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const prix = n => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '');

/* produits : ceux de l'état du marchand ; urlImage(p) : adresse publique de sa photo (ou '') ; marqueParDefaut : nom de la
   boutique ; prixBarre(p) : prix barré licite à exporter (ou null). Par défaut, le prix de référence du produit. */
function versShopify(produits, { urlImage = () => '', marqueParDefaut = '', prixBarre = p => p.prixReference } = {}) {
  const lignes = [COLONNES.join(',')], handles = new Set();
  for (const p of produits || []) {
    if (!p || !p.nom) continue;
    // Handle : celui d'origine pour un produit venu de Shopify (adresse et référencement retrouvés), sinon nom + empreinte.
    const origine = typeof p.refImport === 'string' && p.refImport.startsWith('shopify:') ? slugTexte(p.refImport.slice(8)) : '';
    let h = origine || `${slugTexte(p.nom) || 'produit'}-${empreinte(p.id || p.nom)}`;
    for (let k = 2; handles.has(h); k++) h = `${origine || slugTexte(p.nom) || 'produit'}-${empreinte(p.id || p.nom)}-${k}`;
    handles.add(h);
    const corps = p.description ? `<p>${echapperHtml(p.description).replace(/\n/g, '<br>')}</p>` : '';
    const tags = [Array.isArray(p.composants) && p.composants.length ? 'lot' : '', p.precommande ? 'précommande' : '', p.numerique ? 'numérique' : ''].filter(Boolean).join(', ');
    const communs = { Title: p.nom, 'Body (HTML)': corps, Vendor: p.marque || marqueParDefaut, Type: p.categorie || '', Tags: tags, 'Image Src': urlImage(p) || '', Status: p.actif === false || p.aVerifier ? 'draft' : 'active' };
    const variantes = Array.isArray(p.variantes) && p.variantes.length ? p.variantes : null;
    const opts = variantes ? (p.options || []).slice(0, 2) : [];
    let rangs = variantes ? variantes.map(v => ({ valeurs: v.valeurs || [], prix: typeof v.prix === 'number' ? v.prix : p.prix, stock: v.stock, ean: v.ean })) : [{ valeurs: ['Default Title'], prix: p.prix, stock: p.stock, ean: p.ean }];
    // Une variante au prix de base d'abord : l'import en reprend le prix du produit et le prix barré.
    const iBase = rangs.findIndex(v => v.prix === p.prix); if (iBase > 0) rangs = [rangs[iBase], ...rangs.slice(0, iBase), ...rangs.slice(iBase + 1)];
    const barre = Number(prixBarre(p)) || 0;
    const drop = p.type === 'drop', continuer = drop || !!p.precommande;
    rangs.forEach((v, i) => {
      const r = { Handle: h, ...(i === 0 ? communs : {}),
        'Option1 Name': i === 0 ? (opts[0] ? opts[0].nom : 'Title') : '', 'Option1 Value': v.valeurs[0] || '',
        'Option2 Name': i === 0 && opts[1] ? opts[1].nom : '', 'Option2 Value': opts[1] ? v.valeurs[1] || '' : '',
        'Variant Price': prix(v.prix),
        // Prix barré : seulement s'il est licite, et seulement sur les variantes au prix de base (jamais une baisse jamais annoncée).
        'Variant Compare At Price': barre > v.prix && v.prix === p.prix ? prix(barre) : '',
        'Variant Inventory Tracker': drop ? '' : 'shopify',
        'Variant Inventory Qty': drop ? '' : String(Math.max(0, Math.floor(Number(v.stock) || 0))),
        'Variant Inventory Policy': continuer ? 'continue' : 'deny',
        'Variant Requires Shipping': p.numerique ? 'FALSE' : 'TRUE',
        'Variant Barcode': /^\d{8,14}$/.test(String(v.ean || '')) ? v.ean : '' };
      lignes.push(COLONNES.map(c => cellule(r[c] ?? '', !NUMERIQUES.has(c))).join(','));
    });
  }
  return '\uFEFF' + lignes.join('\r\n') + '\r\n';
}

const api = { versShopify, COLONNES, FORMULE };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.ExportCatalogue = api;
})(typeof window !== 'undefined' ? window : globalThis);
