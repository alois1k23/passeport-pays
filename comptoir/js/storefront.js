/* Comptoir — rendu de la boutique du marchand (aperçu de l’éditeur et boutique en ligne). */

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function devise() {
  return (typeof etat !== 'undefined' && etat && etat.boutique && etat.boutique.devise) || 'EUR';
}
function euros(n) {
  const d = devise();
  return Number(n).toLocaleString(d === 'CHF' ? 'fr-CH' : 'fr-FR', { style: 'currency', currency: d });
}

function visuelProduit(p, grand = false) {
  if (p.image) return `<div class="sf-visuel photo${grand ? ' grand' : ''}"><img src="${/^data:image\/(jpeg|png|webp);base64,/.test(p.image) ? esc(p.image) : ''}" alt="${esc(p.nom)}"></div>`;
  const h = p.teinte ?? 30;
  const initiales = p.nom.split(/\s+/).filter(m => m.length > 2).slice(0, 2).map(m => m[0]).join('');
  return `<div class="sf-visuel${grand ? ' grand' : ''}" style="background:
    radial-gradient(circle at 30% 25%, hsl(${h} 45% 88%), transparent 60%),
    linear-gradient(150deg, hsl(${h} 32% 76%), hsl(${(h + 30) % 360} 28% 58%))">
    <span>${esc(initiales)}</span></div>`;
}

/* Date de livraison estimée : jours ouvrables (sans week-ends ni jours fériés nationaux suisses).
   Baymard recommande une date plutôt qu’un délai « 3–5 jours », dans une fenêtre courte. */
function joursFeriesCH(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const paques = new Date(an, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  const plus = n => { const x = new Date(paques); x.setDate(x.getDate() + n); return x; };
  return [new Date(an, 0, 1), new Date(an, 0, 2), plus(-2), plus(1), plus(39), plus(50), new Date(an, 7, 1), new Date(an, 11, 25), new Date(an, 11, 26)].map(x => x.toDateString());
}
function ajouterJoursOuvrables(depart, n) {
  const d = new Date(depart);
  while (n > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6 && !joursFeriesCH(d.getFullYear()).includes(d.toDateString())) n--;
  }
  return d;
}
/* delai : [min, max] en jours ouvrables. Commande après 14 h : expédiée le jour ouvrable suivant. */
function fenetreLivraison(delai, maintenant = new Date()) {
  const depart = new Date(maintenant);
  if (depart.getHours() >= 14) depart.setDate(depart.getDate() + 1);
  const fmt = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const a = ajouterJoursOuvrables(depart, Math.max(1, delai[0])), b = ajouterJoursOuvrables(depart, Math.max(1, delai[1]));
  return a.toDateString() === b.toDateString() ? `Livré le ${fmt(a)}` : `Livré entre le ${fmt(a)} et le ${fmt(b)}`;
}
function delaiProduit(p) { return p && p.type === 'drop' && p.delai ? p.delai : [1, 2]; }

function varsTheme(t) {
  // Chaque valeur est échappée : le thème vient de la configuration du marchand.
  const v = x => esc(String(x ?? '').replace(/[;{}<>]/g, ''));
  return `--sf-bg:${v(t.bg)};--sf-surface:${v(t.surface)};--sf-text:${v(t.text)};--sf-muted:${v(t.muted)};--sf-primary:${v(t.primary)};--sf-on-primary:${v(t.onPrimary)};--sf-font:${v(t.font)};--sf-body:${v(t.body)};--sf-radius:${Number(t.radius) || 0}px`;
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
            <small class="sf-delai">${esc(fenetreLivraison(delaiProduit(x)))}${x.avis && x.avis.n ? ` · <span class="sf-note" aria-label="Note ${x.avis.moyenne.toFixed(1)} sur 5">★ ${x.avis.moyenne.toFixed(1).replace('.', ',')} (${x.avis.n} avis vérifiés)</span>` : ''}</small>
            <button class="sf-btn sf-btn-ligne" data-sf="ajouter" data-id="${x.id}" ${x.stock <= 0 ? 'disabled' : ''}>${x.stock <= 0 ? 'Épuisé' : 'Ajouter au panier'}</button>
          </article>`).join('') || '<p class="sf-vide">Aucun produit dans cette catégorie.</p>'}
        </div></section>`;
    }
    case 'arguments':
      return `<section class="sf-arguments">${[p.a1, p.a2, p.a3].filter(Boolean).map(a => `<div>${esc(a)}</div>`).join('')}</section>`;
    case 'texte':
      return `<section class="sf-texte"><h2>${esc(p.titre)}</h2><p>${esc(p.texte)}</p></section>`;
    case 'avis': {
      // Avis vérifiés réels s’il y en a ; sinon les textes saisis dans l’éditeur.
      const reels = (etat.avisRecents || []).slice(0, 4);
      const etoiles = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
      if (reels.length) return `<section class="sf-avis">${reels.map(a => `
        <figure><div class="sf-etoiles" aria-label="${a.note} étoiles sur 5">${etoiles(a.note)}</div><blockquote>${esc(a.texte)}</blockquote><figcaption>${esc(a.prenom)}${a.ville ? ', ' + esc(a.ville) : ''} · achat vérifié</figcaption>${a.reponse ? `<p class="sf-reponse"><b>Réponse de la boutique :</b> ${esc(a.reponse)}</p>` : ''}</figure>`).join('')}
        <p class="sf-methode">Avis vérifiés : seuls les clients ayant reçu leur commande peuvent noter, via un lien personnel envoyé par e-mail. Tous les avis sont publiés, positifs comme négatifs.</p></section>`;
      return `<section class="sf-avis">${[[p.a1, p.n1], [p.a2, p.n2]].filter(a => a[0]).map(([a, n]) => `
        <figure><div class="sf-etoiles" aria-label="5 étoiles sur 5">★★★★★</div><blockquote>${esc(a)}</blockquote><figcaption>${esc(n)}</figcaption></figure>`).join('')}</section>`;
    }
    case 'newsletter':
      return `<section class="sf-newsletter"><h2>${esc(p.titre)}</h2><p>${esc(p.texte)}</p>
        <form data-sf="newsletter"><input type="email" placeholder="Votre e-mail" aria-label="Votre e-mail" required><button class="sf-btn">S’inscrire</button></form></section>`;
    case 'faq':
      return `<section class="sf-faq"><h2>Questions fréquentes</h2>${[[p.q1, p.r1], [p.q2, p.r2]].filter(q => q[0]).map(([q, r]) => `<details><summary>${esc(q)}</summary><p>${esc(r)}</p></details>`).join('')}</section>`;
    case 'pied':
      return `<footer class="sf-pied"><strong>${esc(etat.boutique.nom)}</strong><span>${esc(p.texte)}</span><span>${esc(p.contact)}</span>
        <span class="sf-legal"><button type="button" data-action="doc" data-id="mentions">Mentions légales</button><button type="button" data-action="doc" data-id="cgv">CGV</button></span></footer>`;
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
