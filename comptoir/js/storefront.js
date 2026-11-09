/* Comptoir — rendu de la boutique du marchand (aperçu de l’éditeur et boutique en ligne). */

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function euros(n) {
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function visuelProduit(p, grand = false) {
  const h = p.teinte ?? 30;
  const initiales = p.nom.split(/\s+/).filter(m => m.length > 2).slice(0, 2).map(m => m[0]).join('');
  return `<div class="sf-visuel${grand ? ' grand' : ''}" style="background:
    radial-gradient(circle at 30% 25%, hsl(${h} 45% 88%), transparent 60%),
    linear-gradient(150deg, hsl(${h} 32% 76%), hsl(${(h + 30) % 360} 28% 58%))">
    <span>${esc(initiales)}</span></div>`;
}

function varsTheme(t) {
  return `--sf-bg:${t.bg};--sf-surface:${t.surface};--sf-text:${t.text};--sf-muted:${t.muted};--sf-primary:${t.primary};--sf-on-primary:${t.onPrimary};--sf-font:${t.font};--sf-body:${t.body};--sf-radius:${t.radius}px`;
}

function renduSection(s, etat, mode) {
  const p = s.props;
  const prods = etat.produits.filter(x => x.actif);
  switch (s.type) {
    case 'annonce':
      return `<div class="sf-annonce">${esc(p.texte)}</div>`;
    case 'hero': {
      const vedette = prods[0];
      return `<section class="sf-hero ${p.align === 'centre' ? 'centre' : ''}">
        <div class="sf-hero-texte">
          <h1>${esc(p.titre)}</h1>
          <p>${esc(p.sousTitre)}</p>
          <button class="sf-btn" data-sf="defiler">${esc(p.bouton)}</button>
        </div>
        ${p.align === 'centre' || !vedette ? '' : visuelProduit(vedette, true)}
      </section>`;
    }
    case 'saison':
      return `<section class="sf-saison"><div><strong>${esc(p.titre)}</strong><span>${esc(p.texte)}</span></div>${p.code ? `<code>${esc(p.code)}</code>` : ''}</section>`;
    case 'produits': {
      const liste = prods.filter(x => !p.categorie || x.categorie === p.categorie).slice(0, Number(p.nombre) || 4);
      return `<section class="sf-produits" id="sf-collection">
        <h2>${esc(p.titre)}</h2>
        <div class="sf-grille">${liste.map(x => `
          <article class="sf-carte">
            ${visuelProduit(x)}
            <div class="sf-carte-infos"><h3>${esc(x.nom)}</h3><span>${euros(x.prix)}</span></div>
            <button class="sf-btn sf-btn-ligne" data-sf="ajouter" data-id="${x.id}" ${x.stock <= 0 ? 'disabled' : ''}>${x.stock <= 0 ? 'Épuisé' : 'Ajouter au panier'}</button>
          </article>`).join('') || '<p class="sf-vide">Aucun produit dans cette catégorie.</p>'}
        </div></section>`;
    }
    case 'arguments':
      return `<section class="sf-arguments">${[p.a1, p.a2, p.a3].filter(Boolean).map(a => `<div>${esc(a)}</div>`).join('')}</section>`;
    case 'texte':
      return `<section class="sf-texte"><h2>${esc(p.titre)}</h2><p>${esc(p.texte)}</p></section>`;
    case 'avis':
      return `<section class="sf-avis">${[[p.a1, p.n1], [p.a2, p.n2]].filter(a => a[0]).map(([a, n]) => `
        <figure><div class="sf-etoiles" aria-label="5 étoiles sur 5">★★★★★</div><blockquote>${esc(a)}</blockquote><figcaption>${esc(n)}</figcaption></figure>`).join('')}</section>`;
    case 'newsletter':
      return `<section class="sf-newsletter"><h2>${esc(p.titre)}</h2><p>${esc(p.texte)}</p>
        <form data-sf="newsletter"><input type="email" placeholder="Votre e-mail" aria-label="Votre e-mail" required><button class="sf-btn">S’inscrire</button></form></section>`;
    case 'faq':
      return `<section class="sf-faq"><h2>Questions fréquentes</h2>${[[p.q1, p.r1], [p.q2, p.r2]].filter(q => q[0]).map(([q, r]) => `<details><summary>${esc(q)}</summary><p>${esc(r)}</p></details>`).join('')}</section>`;
    case 'pied':
      return `<footer class="sf-pied"><strong>${esc(etat.boutique.nom)}</strong><span>${esc(p.texte)}</span><span>${esc(p.contact)}</span></footer>`;
    default:
      return '';
  }
}

/* mode : 'edition' (sections sélectionnables) ou 'live' (boutique avec panier). */
function renduBoutique(etat, { mode = 'live', selection = null, panier = [] } = {}) {
  const b = etat.boutique;
  const nbPanier = panier.reduce((a, l) => a + l.qte, 0);
  const entete = `<header class="sf-entete">
      <span class="sf-logo">${esc(b.nom)}</span>
      <nav><span>Boutique</span><span>À propos</span><span>Contact</span></nav>
      <button class="sf-panier-btn" data-sf="panier" aria-label="Ouvrir le panier">Panier <b>${nbPanier}</b></button>
    </header>`;
  const sections = b.sections.map(s => {
    const html = renduSection(s, etat, mode);
    if (mode !== 'edition') return html;
    return `<div class="sf-bloc${selection === s.id ? ' choisi' : ''}" data-section="${s.id}" tabindex="0">
      <span class="sf-etiquette">${esc(TYPES_SECTIONS[s.type].nom)}</span>${html}</div>`;
  }).join('');
  // L’annonce reste au-dessus de l’en-tête si elle est en première position.
  const annonceEnTete = b.sections[0]?.type === 'annonce';
  if (annonceEnTete) {
    const [premier, ...reste] = b.sections;
    const premierHtml = mode === 'edition'
      ? `<div class="sf-bloc${selection === premier.id ? ' choisi' : ''}" data-section="${premier.id}" tabindex="0"><span class="sf-etiquette">${esc(TYPES_SECTIONS.annonce.nom)}</span>${renduSection(premier, etat, mode)}</div>`
      : renduSection(premier, etat, mode);
    const resteHtml = reste.map(s => {
      const html = renduSection(s, etat, mode);
      return mode !== 'edition' ? html : `<div class="sf-bloc${selection === s.id ? ' choisi' : ''}" data-section="${s.id}" tabindex="0"><span class="sf-etiquette">${esc(TYPES_SECTIONS[s.type].nom)}</span>${html}</div>`;
    }).join('');
    return `<div class="sf" style="${varsTheme(b.theme)}">${premierHtml}${entete}${resteHtml}</div>`;
  }
  return `<div class="sf" style="${varsTheme(b.theme)}">${entete}${sections}</div>`;
}
