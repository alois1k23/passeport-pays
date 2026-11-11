/* Comptoir — rendu de la boutique du marchand (aperçu de l’éditeur et boutique en ligne). */

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function devise() {
  return (typeof etat !== 'undefined' && etat && etat.boutique && etat.boutique.devise) || 'EUR';
}
/* Montants : usage suisse « CHF 3’026.00 » (apostrophe pour les milliers, point décimal) ;
   euro au format français « 3 026,00 € ». */
function montantCHF(n) {
  const v = Math.round(Math.abs(Number(n) || 0) * 100) / 100;
  const [e, c] = v.toFixed(2).split('.');
  return `${Number(n) < -0.004 ? '−' : ''}CHF ${e.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}.${c}`;
}
function euros(n) {
  const d = devise();
  if (d === 'CHF') return montantCHF(n);
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: d });
}

function visuelProduit(p, grand = false) {
  if (p.image) return `<div class="sf-visuel photo${grand ? ' grand' : ''}"><img src="${/^data:image\/(jpeg|png|webp);base64,/.test(p.image) ? esc(p.image) : ''}" alt="${esc(p.nom)}"></div>`;
  const h = p.teinte ?? 30;
  // Sans photo : fond uni teinté et pictogramme de la catégorie (plus sobre que des initiales).
  return `<div class="sf-visuel sans-photo${grand ? ' grand' : ''}" style="--teinte:${Number(h) || 0}" role="img" aria-label="${esc(p.nom)}">${pictoProduit(p)}</div>`;
}

const PICTOS_PRODUIT = [
  [/lamp|lumin|éclair|veilleuse|guirlande/i, '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>'],
  [/bougie|parfum|encens/i, '<path d="M8 21h8V11H8v10ZM12 11V8M12 8c-1.4-1-1.6-2.6 0-5 1.6 2.4 1.4 4 0 5Z"/>'],
  [/diffus|humidif|huile/i, '<path d="M12 3s-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10Z"/>'],
  [/plaid|coussin|linge|textile|coton|couverture/i, '<path d="M4 6h16v12H4zM4 10h16M4 14h16M9 6v12M15 6v12"/>'],
  [/chargeur|câble|cable|tech|audio|écouteur|support|usb/i, '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'],
  [/organis|rangement|boîte|boite|panier|tiroir/i, '<path d="M3 8h18v12H3zM3 8l2-4h14l2 4M9 12h6"/>'],
  [/bijou|bague|collier|bracelet|boucle/i, '<path d="M6 3h12l3 6-9 12L3 9l3-6ZM3 9h18M9 3l3 18M15 3l-3 18"/>'],
  [/animal|chien|chat|laisse|gamelle/i, '<circle cx="7" cy="9" r="2"/><circle cx="17" cy="9" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="14" cy="5" r="2"/><path d="M12 12c-3 0-5 3-5 5.5S9 20 12 19c3 1 5 .5 5-1.5S15 12 12 12Z"/>'],
  [/sport|yoga|fitness|gourde|bouteille/i, '<path d="M9 3h6M10 3v3l-2 3v12h8V9l-2-3V3"/>'],
  [/beaut|soin|crème|creme|savon|cosm/i, '<path d="M9 2h6v4H9zM7 6h10l-1 16H8L7 6Z"/>'],
  [/café|cafe|thé|the|tasse|mug|épicerie|chocolat|miel/i, '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8ZM16 10h2a2 2 0 0 1 0 4h-2"/>'],
  [/vase|déco|deco|cadre|miroir|plante/i, '<path d="M9 3h6l-1 4c3 2 4 5 3 9-1 3-3 5-5 5s-4-2-5-5c-1-4 0-7 3-9L9 3Z"/>'],
  [/vêtement|vetement|mode|sac|t-shirt|pull|chaussette|écharpe/i, '<path d="M9 3 4 6l2 4 2-1v12h8V9l2 1 2-4-5-3a3 3 0 0 1-6 0Z"/>']
];
function pictoProduit(p) {
  const t = `${p.categorie || ''} ${p.nom || ''}`;
  const d = (PICTOS_PRODUIT.find(([re]) => re.test(t)) || [null, '<path d="M6 8h12l-1 12H7L6 8ZM9 8V6a3 3 0 0 1 6 0v2"/>'])[1];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
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

/* Prix barré affiché : vérifié à chaque rendu (côté marchand, depuis le prix de référence ; côté public, le serveur l'a déjà vérifié). */
function prixBarreAffiche(p, etat) {
  if (!('prixReference' in p)) return p.prixBarre || 0;
  return p.prixReference && typeof PrixBarres !== 'undefined' && PrixBarres.verifier(p, etat.boutique.pays === 'ch' ? 'ch' : 'ue').ok ? p.prixReference : 0;
}
function renduSection(s, etat, mode) {
  const p = s.props;
  const prods = etat.produits.filter(x => x.actif);
  switch (s.type) {
    case 'annonce':
      return p.texte ? `<div class="sf-annonce">${esc(p.texte)}</div>` : (mode === 'edition' ? '<div class="sf-annonce">Annonce vide : écrivez votre message</div>' : '');
    case 'hero': {
      const vedette = prods[0];
      return `<section class="sf-hero ${p.align === 'centre' ? 'centre' : ''}">
        <div class="sf-hero-texte">
          <h1>${esc(p.titre)}</h1>
          ${p.sousTitre ? `<p>${esc(p.sousTitre)}</p>` : ''}
          ${p.bouton ? `<button class="sf-btn" data-sf="defiler">${esc(p.bouton)}</button>` : ''}
        </div>
        ${p.align === 'centre' || !vedette ? '' : visuelProduit(vedette, true)}
      </section>`;
    }
    case 'saison': {
      // Côté admin, on vérifie que le code existe vraiment (Conversion ou campagne) ; côté public, le serveur a déjà retiré les codes inconnus.
      const connu = !p.code || typeof etat.campagnes === 'undefined' || typeof Remises === 'undefined' || Remises.codesValables(etat).some(c => c.code === String(p.code).toUpperCase());
      const code = p.code && connu ? `<code>${esc(p.code)}</code>` : p.code && mode === 'edition' ? `<code class="sf-code-inconnu" title="Ce code n’existe pas : créez-le dans Conversion, sinon il n’est pas affiché aux clients">${esc(p.code)} · inconnu</code>` : '';
      return `<section class="sf-saison"><div><strong>${esc(p.titre)}</strong><span>${esc(p.texte)}</span></div>${code}</section>`;
    }
    case 'produits': {
      const liste = prods.filter(x => !p.categorie || x.categorie === p.categorie).slice(0, Number(p.nombre) || 4);
      return `<section class="sf-produits" id="sf-collection">
        <h2>${esc(p.titre)}</h2>
        <div class="sf-grille">${liste.map(x => `
          <article class="sf-carte">
            <button type="button" class="sf-carte-lien" data-sf="fiche" data-id="${esc(x.id)}" aria-label="Voir ${esc(x.nom)}">${visuelProduit(x)}</button>
            <div class="sf-carte-infos"><h3><button type="button" class="sf-titre-lien" data-sf="fiche" data-id="${esc(x.id)}">${esc(x.nom)}</button></h3><span>${prixBarreAffiche(x, etat) ? `<s class="sf-barre">${euros(prixBarreAffiche(x, etat))}</s> ` : ''}${euros(x.prix)}</span></div>
            ${x.avis && x.avis.n ? `<small class="sf-note" aria-label="Note ${x.avis.moyenne.toFixed(1)} sur 5">★ ${x.avis.moyenne.toFixed(1).replace('.', ',')} · ${x.avis.n} avis vérifiés</small>` : ''}<small class="sf-delai">${esc(fenetreLivraison(delaiProduit(x)))}</small>
            <button class="sf-btn sf-btn-ligne" data-sf="ajouter" data-id="${x.id}" ${x.stock <= 0 ? 'disabled' : ''}>${x.stock <= 0 ? 'Épuisé' : 'Ajouter au panier'}</button>
          </article>`).join('') || (prods.length ? '<p class="sf-vide">Aucun produit dans cette catégorie.</p>' : '<p class="sf-vide">Nos produits arrivent très bientôt.</p>')}
        </div></section>`;
    }
    case 'arguments':
      return `<section class="sf-arguments">${[p.a1, p.a2, p.a3].filter(Boolean).map(a => `<div>${esc(a)}</div>`).join('')}</section>`;
    case 'texte':
      if (!p.titre && !p.texte && mode !== 'edition') return '';
      return `<section class="sf-texte" data-ancre="apropos">${p.titre ? `<h2>${esc(p.titre)}</h2>` : ''}${p.texte ? `<p>${esc(p.texte)}</p>` : ''}</section>`;
    case 'avis': {
      // Avis vérifiés réels s’il y en a ; sinon les textes saisis dans l’éditeur.
      const reels = (etat.avisRecents || []).slice(0, 4);
      const etoiles = n => '★★★★★'.slice(0, n) + `<span aria-hidden="true" class="sf-etoiles-vides">${'☆☆☆☆☆'.slice(0, 5 - n)}</span>`;
      if (reels.length) return `<section class="sf-avis"><h2 class="sf-avis-titre">${esc(p.titre || 'Ce qu’en disent nos clients')}</h2>${reels.map(a => `
        <figure><div class="sf-etoiles" aria-label="${a.note} étoiles sur 5">${etoiles(a.note)}</div><blockquote>${esc(a.texte)}</blockquote><figcaption>${esc(a.prenom)}${a.ville ? ', ' + esc(a.ville) : ''} · achat vérifié</figcaption>${a.reponse ? `<p class="sf-reponse"><b>Réponse de la boutique :</b> ${esc(a.reponse)}</p>` : ''}</figure>`).join('')}
        <p class="sf-methode">Avis vérifiés : seuls les clients dont la commande a été expédiée peuvent noter, via un lien personnel envoyé par e-mail. Tous les avis sont publiés, positifs comme négatifs.</p></section>`;
      // Sans avis vérifiés : rien en ligne (un témoignage saisi à la main n'a pas d'étoiles et ne passe pas pour un avis client).
      const temoignages = [[p.a1, p.n1], [p.a2, p.n2]].filter(a => a[0] && String(a[0]).trim());
      if (!temoignages.length) return mode === 'edition' ? '<section class="sf-avis"><p class="sf-methode">Les avis vérifiés de vos clients s’afficheront ici dès les premières notes. Rien n’est affiché en ligne d’ici là.</p></section>' : '';
      return `<section class="sf-avis"><h2 class="sf-avis-titre">${esc(p.titre || 'Témoignages')}</h2>${temoignages.map(([a, n]) => `
        <figure><blockquote>${esc(a)}</blockquote>${n ? `<figcaption>${esc(n)}</figcaption>` : ''}</figure>`).join('')}</section>`;
    }
    case 'newsletter':
      return `<section class="sf-newsletter"><h2>${esc(p.titre)}</h2><p>${esc(p.texte)}</p>
        <form data-sf="newsletter"><input type="email" placeholder="Votre e-mail" aria-label="Votre e-mail" required><button class="sf-btn">S’inscrire</button></form></section>`;
    case 'faq':
      return `<section class="sf-faq"><h2>Questions fréquentes</h2>${[[p.q1, p.r1], [p.q2, p.r2]].filter(q => q[0]).map(([q, r]) => `<details><summary>${esc(q)}</summary><p>${esc(r)}</p></details>`).join('')}</section>`;
    case 'pied':
      return `<footer class="sf-pied" data-ancre="contact"><strong>${esc(etat.boutique.nom)}</strong><span>${esc(p.texte)}</span><span>${esc(p.contact && !/@exemple\./i.test(p.contact) ? p.contact : (etat.entreprise && etat.entreprise.email) || '')}</span>
        <span class="sf-legal"><button type="button" data-action="doc" data-id="mentions">Mentions légales</button><button type="button" data-action="doc" data-id="cgv">CGV</button></span></footer>`;
    default:
      return '';
  }
}

/* mode : 'edition' (sections sélectionnables) ou 'live' (boutique avec panier). */
/* Fiche produit : grande photo, description, délai, avis du produit, quantité, réassurance. */
function renduFiche(etat, p, qte = 1) {
  if (!p) return '';
  const ch = etat.boutique.pays === 'ch';
  const avis = (etat.avisRecents || []).filter(a => (a.produitId || a.produit_id) === p.id).slice(0, 3);
  const args = (etat.boutique.sections.find(s => s.type === 'arguments') || {}).props || {};
  const reassurance = [args.a1, args.a2, args.a3].filter(Boolean);
  const epuise = p.type !== 'drop' && p.stock <= 0;
  const max = p.type === 'drop' ? 10 : Math.max(1, Math.min(10, p.stock));
  return `<div class="sf-fiche-fond" data-sf="fermer-fiche"></div>
  <div class="sf-fiche" role="dialog" aria-modal="true" aria-label="${esc(p.nom)}">
    <button type="button" class="sf-fiche-fermer" data-sf="fermer-fiche" aria-label="Fermer">×</button>
    <div class="sf-fiche-visuel">${visuelProduit(p)}</div>
    <div class="sf-fiche-infos">
      ${p.categorie ? `<small class="sf-fiche-cat">${esc(p.categorie)}</small>` : ''}
      <h2>${esc(p.nom)}</h2>
      <p class="sf-fiche-prix">${prixBarreAffiche(p, etat) ? `<s class="sf-barre">${euros(prixBarreAffiche(p, etat))}</s> ` : ''}<strong>${euros(p.prix)}</strong> <small>${esc(mentionTva((etat.entreprise || {}).regime, etat.boutique.pays))}</small></p>
      ${prixBarreAffiche(p, etat) ? `<p class="sf-fiche-note">Prix barré : prix pratiqué pendant au moins 30 jours avant la baisse.</p>` : ''}
      ${p.avis && p.avis.n ? `<p class="sf-note">★ ${p.avis.moyenne.toFixed(1).replace('.', ',')} sur 5 · ${p.avis.n} avis vérifiés</p>` : ''}
      ${p.description ? `<p class="sf-fiche-desc">${esc(p.description)}</p>` : ''}
      <p class="sf-fiche-delai">${esc(fenetreLivraison(delaiProduit(p)))}</p>
      ${(() => {
        // Pays d'expédition (les CGV y renvoient) et, hors du pays du client, frais d'importation possibles.
        if (p.type !== 'drop' || !p.entrepot) return '';
        const ch = etat.boutique.pays === 'ch', nom = { CH: 'Suisse', UE: 'Union européenne', CN: 'Chine' }[p.entrepot] || p.entrepot;
        const etranger = ch ? p.entrepot !== 'CH' : p.entrepot !== 'UE';
        return `<p class="sf-fiche-note">Expédié depuis : ${esc(nom)}.${etranger ? (ch ? ' TVA d’importation et frais de dédouanement possibles à la livraison (au-delà de CHF 5 de TVA par envoi).' : ' Envoi de l’extérieur de l’UE : TVA d’importation et frais du transporteur possibles à la livraison.') : ''}</p>`;
      })()}
      <div class="sf-fiche-achat">
        <label class="sf-qte"><span>Quantité</span><select data-sf-qte aria-label="Quantité">${Array.from({ length: max }, (_, i) => `<option ${i + 1 === qte ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <button class="sf-btn" data-sf="ajouter" data-id="${esc(p.id)}" ${epuise ? 'disabled' : ''}>${epuise ? 'Épuisé' : 'Ajouter au panier'}</button>
      </div>
      ${reassurance.length ? `<ul class="sf-fiche-plus">${reassurance.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${avis.length ? `<div class="sf-fiche-avis"><h3>Avis sur ce produit</h3>${avis.map(a => `<figure><div class="sf-etoiles" aria-label="${a.note} étoiles sur 5">${'★★★★★'.slice(0, a.note)}<span aria-hidden="true" class="sf-etoiles-vides">${'☆☆☆☆☆'.slice(0, 5 - a.note)}</span></div><blockquote>${esc(a.texte)}</blockquote><figcaption>${esc(a.prenom || '')}${a.ville ? ', ' + esc(a.ville) : ''}</figcaption>${a.reponse ? `<p class="sf-reponse"><b>Réponse de la boutique :</b> ${esc(a.reponse)}</p>` : ''}</figure>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

function renduBoutique(etat, { mode = 'live', selection = null, panier = [], fiche = null } = {}) {
  const b = etat.boutique;
  const nbPanier = panier.reduce((a, l) => a + l.qte, 0);
  const entete = `<header class="sf-entete">
      <span class="sf-logo">${esc(b.nom)}</span>
      <nav aria-label="Navigation de la boutique"><button type="button" data-sf="nav" data-v="collection">Boutique</button><button type="button" data-sf="nav" data-v="apropos">À propos</button><button type="button" data-sf="nav" data-v="contact">Contact</button></nav>
      <button class="sf-panier-btn" data-sf="panier" aria-label="Ouvrir le panier">Panier <b>${nbPanier}</b></button>
    </header>`;
  const sections = b.sections.map(s => {
    const html = renduSection(s, etat, mode);
    if (mode !== 'edition') return html;
    return `<div class="sf-bloc${selection === s.id ? ' choisi' : ''}" data-section="${s.id}" tabindex="0">
      <span class="sf-etiquette">${esc(TYPES_SECTIONS[s.type].nom)}</span>${html}</div>`;
  }).join('');
  // L’annonce reste au-dessus de l’en-tête si elle est en première position.
  const ficheHtml = fiche && mode !== 'edition' ? renduFiche(etat, etat.produits.find(x => x.id === fiche)) : '';
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
    return `<div class="sf" style="${varsTheme(b.theme)}">${premierHtml}${entete}${resteHtml}${ficheHtml}</div>`;
  }
  return `<div class="sf" style="${varsTheme(b.theme)}">${entete}${sections}${ficheHtml}</div>`;
}

/* Navigation de la boutique : défile jusqu’à la collection, au texte de présentation ou au pied de page. */
function allerSection(racine, cle) {
  const cible = racine.querySelector(cle === 'collection' ? '#sf-collection' : `[data-ancre="${cle}"]`) || racine.querySelector('[data-ancre="contact"]');
  cible?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
