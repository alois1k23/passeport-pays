// Audit du contenu de toutes les boutiques publiques d'un serveur Comptoir (lecture seule, par l'API publique).
// Usage : node audit-boutiques.js http://localhost:3000 chemin/vers/base.db
const { DatabaseSync } = require('node:sqlite');
const base = process.argv[2] || 'http://localhost:3000';
const db = new DatabaseSync(process.argv[3]);
const slugs = db.prepare('SELECT slug FROM boutiques').all().map(r => r.slug);
const constats = {};
const noter = (type, slug, detail = '') => (constats[type] = constats[type] || []).push(`${slug}${detail ? ' : ' + String(detail).slice(0, 120) : ''}`);
(async () => {
  for (const slug of slugs) {
    const r = await fetch(`${base}/api/public/${slug}`);
    if (!r.ok) { noter('boutique inaccessible', slug, r.status); continue; }
    const d = await r.json();
    const e = d.entreprise || {}, b = d.boutique;
    if (!e.adresse) noter('adresse légale absente (Impressum / mentions)', slug);
    if (!e.email) noter('e-mail de contact absent', slug);
    if (!d.produits.length) noter('aucun produit', slug);
    const noms = d.produits.map(p => p.nom.toLowerCase());
    const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
    if (doublons.length) noter('produits en double (même nom)', slug, [...new Set(doublons)].join(', '));
    for (const p of d.produits) {
      if (p.type === 'drop' && (!p.delai || p.delai[1] > 20)) noter('délai fournisseur absent ou > 20 jours', slug, p.nom);
      if (p.type === 'drop' && p.delai && p.delai[1] > 10 && b.pays === 'ch') noter('produit expédié de loin (> 10 jours) vendu en Suisse', slug, `${p.nom} (${p.delai.join('–')} j)`);
      if (!p.description || p.description.length < 30) noter('description produit absente ou trop courte', slug, p.nom);
      if (p.prix <= 0) noter('prix nul', slug, p.nom);
      if (p.prixBarre && p.prixBarre <= p.prix) noter('prix barré incohérent', slug, p.nom);
      if (!p.image) noter('produit sans photo', slug, p.nom);
    }
    const types = (b.sections || []).map(s => s.type);
    if (!types.includes('produits')) noter('aucune section produits sur la page', slug);
    if (!types.includes('pied')) noter('pas de pied de page (mentions et contact)', slug);
    for (const s of b.sections || []) {
      for (const [k, v] of Object.entries(s.props || {})) if (typeof v === 'string' && /bonjour@exemple\.|lorem|à compléter/i.test(v)) noter('texte d’exemple resté sur la boutique', slug, `${s.type}.${k} = ${v}`);
      if (s.type === 'saison' && s.props && s.props.code && !(d.offres && (d.offres.codes || []).length) ) { /* code de saison : vérifié côté commande */ }
    }
    const modes = Object.keys(d.livraisons || {});
    if (!modes.length) noter('aucun mode de livraison', slug);
    if (b.pays === 'be' && modes.some(m => /pickpost|poste-/.test(m))) noter('modes de livraison suisses sur une boutique belge', slug, modes.join(', '));
    if (b.pays !== 'ch' && modes.some(m => /pickpost/.test(m))) noter('PickPost hors de Suisse', slug);
    // Code promo affiché dans la bannière de saison : est-il vraiment accepté ?
    const saison = (b.sections || []).find(s => s.type === 'saison' && s.props && s.props.code);
    if (saison) {
      const c = await fetch(`${base}/api/public/${slug}/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: saison.props.code }) });
      if (!c.ok) noter('code promo affiché sur la boutique mais refusé au paiement', slug, saison.props.code);
    }
  }
  const total = slugs.length;
  console.log(`${total} boutiques auditées`);
  for (const [k, v] of Object.entries(constats).sort((a, b) => new Set(b[1].map(x => x.split(' :')[0])).size - new Set(a[1].map(x => x.split(' :')[0])).size)) {
    const nb = new Set(v.map(x => x.split(' :')[0])).size;
    console.log(`\n[${nb} boutiques · ${v.length} cas] ${k}\n  ${v.slice(0, 3).join('\n  ')}`);
  }
})();
