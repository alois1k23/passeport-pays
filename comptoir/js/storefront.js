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
  if (p.image) return `<div class="sf-visuel photo${grand ? ' grand' : ''}"><img src="${/^data:image\/(jpeg|png|webp);base64,/.test(p.image) || /^\/api\/public\/[\w-]+\/image\/[\w-]+$/.test(p.image) ? esc(p.image) : ''}" loading="lazy" alt="${esc(p.nom)}"></div>`;
  const h = p.teinte ?? 30;
  // Sans photo : fond uni teinté et pictogramme de la catégorie (plus sobre que des initiales).
  return `<div class="sf-visuel sans-photo${grand ? ' grand' : ''}" data-vars="--teinte:${Number(h) || 0}" role="img" aria-label="${esc(p.nom)}">${pictoProduit(p)}</div>`;
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
// Même délai que l'envoi standard proposé par défaut dans le panier (la fiche ne promet pas plus vite que le panier).
function delaiProduit(p) { return p && p.type === 'drop' && p.delai ? p.delai : [2, 3]; }

function varsTheme(t) {
  // Chaque valeur est échappée : le thème vient de la configuration du marchand.
  const v = x => esc(String(x ?? '').replace(/[;{}<>]/g, ''));
  return `--sf-bg:${v(t.bg)};--sf-surface:${v(t.surface)};--sf-text:${v(t.text)};--sf-muted:${v(t.muted)};--sf-primary:${v(t.primary)};--sf-on-primary:${v(t.onPrimary)};--sf-font:${v(t.font)};--sf-body:${v(t.body)};--sf-radius:${Number(t.radius) || 0}px`;
}

/* Prix barré affiché : vérifié à chaque rendu (côté marchand, depuis le prix de référence ; côté public, le serveur l'a déjà vérifié). */
function prixBarreAffiche(p, etat) {
  // Variantes à prix différents : pas de prix barré (il serait comparé au mauvais prix)
  if (Array.isArray(p.variantes) && p.variantes.some(v => typeof v.prix === 'number' && v.prix !== p.prix)) return 0;
  if (!('prixReference' in p)) return p.prixBarre || 0;
  return p.prixReference && typeof PrixBarres !== 'undefined' && PrixBarres.verifier(p, etat.boutique.pays === 'ch' ? 'ch' : 'ue').ok ? p.prixReference : 0;
}
/* Affichage de la vitrine (pas enregistré avec la boutique) : « Voir tous les produits » et catégorie choisie. */
const vueVitrine = { tout: null, cat: '', q: '' };
/* Recherche instantanée : sans accents ni majuscules, chaque mot cherché doit commencer un mot du produit
   (nom, catégorie, description), avec une faute de frappe tolérée pour les mots de 4 lettres et plus. */
const sansAccents = t => String(t || '').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function procheDe(a, b) {   // distance d'édition ≤ 1 (une lettre en trop, en moins ou différente)
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, ecarts = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++ecarts > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return ecarts + (a.length - i) + (b.length - j) <= 1;
}
const motsProduit = new WeakMap();   // mots normalisés, calculés une fois par produit (500 produits : frappe fluide)
function correspondRecherche(x, q) {
  let mots = motsProduit.get(x);
  if (!mots) { mots = sansAccents(`${x.nom} ${x.categorie || ''} ${x.description || ''}`).split(/[^a-z0-9]+/).filter(Boolean); motsProduit.set(x, mots); }
  // Début de mot, ou une faute de frappe (lettre en trop, en moins ou différente) dans le début ou le mot entier
  return sansAccents(q).split(/[^a-z0-9]+/).filter(Boolean).every(m => mots.some(w => w.startsWith(m) || (m.length >= 4 && (procheDe(m, w.slice(0, m.length)) || procheDe(m, w.slice(0, m.length + 1)) || procheDe(m, w)))));
}
function renduSection(s, etat, mode) {
  const p = s.props;
  const prods = etat.produits.filter(x => x.actif);
  switch (s.type) {
    case 'annonce':
      return p.texte ? `<div class="sf-annonce" data-sans-traduction>${esc(p.texte)}</div>` : (mode === 'edition' ? '<div class="sf-annonce">Annonce vide : écrivez votre message</div>' : '');
    case 'hero': {
      const vedette = prods[0];
      return `<section class="sf-hero ${p.align === 'centre' ? 'centre' : ''}">
        <div class="sf-hero-texte">
          <h1 data-sans-traduction>${esc(p.titre)}</h1>
          ${p.sousTitre ? `<p data-sans-traduction>${esc(p.sousTitre)}</p>` : ''}
          ${p.bouton ? `<button class="sf-btn" data-sf="defiler" data-sans-traduction>${esc(p.bouton)}</button>` : ''}
        </div>
        ${p.align === 'centre' || !vedette ? '' : visuelProduit(vedette, true)}
      </section>`;
    }
    case 'saison': {
      const vente = typeof etatVente === 'function' ? etatVente() : etat;   // codes et campagnes selon la formule, comme en ligne
      // Bannière hors de sa période : invisible en ligne (une remise ne s'annonce pas avant que son code marche, et s'efface après).
      // Côté public, le serveur a déjà retiré les bannières hors période (l'état public ne contient pas les campagnes).
      if (typeof etat.campagnes !== 'undefined' && typeof Remises !== 'undefined' && Remises.banniereVisible && !Remises.banniereVisible(vente, p)) {
        if (mode !== 'edition') return '';
        const c = p.campagne ? etat.campagnes[p.campagne] : null;
        const per = !c && p.code ? Remises.periodeCampagne(vente, p.code) : null;
        const debut = c ? c.debut : per && per.debut, avant = debut && debut > Date.now();
        const horsFormule = typeof fonctionIncluse === 'function' && !fonctionIncluse('conversion') && p.campagne;   // campagne éteinte par la formule (Lancement)
        const quoi = horsFormule ? 'Non affichée : les campagnes viennent avec la formule Croissance.' : avant ? `Programmée : visible à partir du ${new Date(debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.` : p.campagne || p.code ? 'Campagne terminée : cette bannière n’est plus affichée.' : 'Masquée pendant qu’une bannière de campagne est affichée.';
        return `<section class="sf-saison"><div><strong>${esc(p.titre)}</strong><span>${quoi}</span></div></section>`;
      }
      // Côté admin, on vérifie que le code existe vraiment (Conversion ou campagne) ; côté public, le serveur a déjà retiré les codes inconnus.
      const connu = !p.code || typeof etat.campagnes === 'undefined' || typeof Remises === 'undefined' || Remises.codesValables(vente).some(c => c.code === String(p.code).toUpperCase());
      const code = p.code && connu ? `<code>${esc(p.code)}</code>` : p.code && mode === 'edition' ? `<code class="sf-code-inconnu" title="Ce code n’existe pas : créez-le dans Conversion, sinon il n’est pas affiché aux clients">${esc(p.code)} · inconnu</code>` : '';
      return `<section class="sf-saison"><div data-sans-traduction><strong>${esc(p.titre)}</strong><span>${esc(p.texte)}</span></div>${code}</section>`;
    }
    case 'produits': {
      // « Voir tous les produits » : sans lui, les produits au-delà des 4 à 8 de la vitrine seraient introuvables.
      const tout = mode !== 'edition' && vueVitrine.tout === s.id;
      const dispo = prods.filter(x => !p.categorie || x.categorie === p.categorie);
      const cats = [...new Set(dispo.map(x => x.categorie).filter(Boolean))];
      const filtres = tout ? dispo.filter(x => !vueVitrine.cat || x.categorie === vueVitrine.cat) : dispo;
      const recherche = mode !== 'edition' && dispo.length >= 8, q = recherche ? vueVitrine.q.trim() : '';
      const liste = q ? dispo.filter(x => correspondRecherche(x, q)) : tout ? filtres : dispo.slice(0, Number(p.nombre) || 4);
      const premiere = (etat.boutique.sections || []).find(x => x.type === 'produits');
      return `<section class="sf-produits" id="${!premiere || premiere.id === s.id ? 'sf-collection' : 'sf-collection-' + esc(s.id)}">
        <h2>${esc(tout ? 'Tous nos produits' : p.titre)}</h2>
        ${recherche ? `<div class="sf-recherche"><input type="search" data-sf-recherche="${esc(s.id)}" value="${esc(vueVitrine.q)}" placeholder="Rechercher un produit" aria-label="Rechercher un produit" autocomplete="off">${q ? `<span class="sf-nb" role="status">${liste.length} résultat${liste.length > 1 ? 's' : ''}</span>` : ''}</div>` : ''}
        ${tout && cats.length > 1 ? `<div class="sf-cats" role="group" aria-label="Catégories"><button type="button" class="${!vueVitrine.cat ? 'actif' : ''}" data-sf="cat" data-v="" aria-pressed="${!vueVitrine.cat}">Tout (${dispo.length})</button>${cats.map(c => `<button type="button" class="${vueVitrine.cat === c ? 'actif' : ''}" data-sf="cat" data-v="${esc(c)}" aria-pressed="${vueVitrine.cat === c}">${esc(c)}</button>`).join('')}</div>` : ''}
        <div class="sf-grille">${liste.map(x => `
          <article class="sf-carte">
            <button type="button" class="sf-carte-lien" data-sf="fiche" data-id="${esc(x.id)}" aria-label="Voir ${esc(x.nom)}">${visuelProduit(x)}</button>
            <div class="sf-carte-infos"><h3 data-sans-traduction><button type="button" class="sf-titre-lien" data-sf="fiche" data-id="${esc(x.id)}">${esc(x.nom)}</button></h3><span>${prixBarreAffiche(x, etat) ? `<s class="sf-barre">${euros(prixBarreAffiche(x, etat))}</s> ` : ''}${(pv => pv.length && Math.min(...pv) !== Math.max(...pv) ? `dès ${euros(Math.min(...pv))}` : euros(pv.length ? pv[0] : x.prix))(Array.isArray(x.variantes) ? x.variantes.map(v => typeof v.prix === 'number' ? v.prix : x.prix) : [])}</span></div>
            ${x.avis && x.avis.n ? `<small class="sf-note" aria-label="Note ${x.avis.moyenne.toFixed(1)} sur 5">★ ${x.avis.moyenne.toFixed(1).replace('.', ',')} · ${x.avis.n} avis vérifiés</small>` : ''}<small class="sf-delai">${esc(fenetreLivraison(delaiProduit(x)))}</small>
            ${Array.isArray(x.variantes) && x.variantes.length ? `<button class="sf-btn sf-btn-ligne" data-sf="fiche" data-id="${esc(x.id)}" ${x.stock <= 0 ? 'disabled' : ''}>${x.stock <= 0 ? 'Épuisé' : 'Choisir'}</button>` : `<button class="sf-btn sf-btn-ligne" data-sf="ajouter" data-id="${x.id}" ${x.stock <= 0 ? 'disabled' : ''}>${x.stock <= 0 ? 'Épuisé' : 'Ajouter au panier'}</button>`}
          </article>`).join('') || (q ? `<p class="sf-vide">Aucun produit ne correspond à « ${esc(q)} ».</p>` : prods.length ? '<p class="sf-vide">Aucun produit dans cette catégorie.</p>' : '<p class="sf-vide">Nos produits arrivent très bientôt.</p>')}
        </div>${mode !== 'edition' && !q && dispo.length > (Number(p.nombre) || 4) ? `<p class="sf-tout"><button type="button" class="sf-btn" data-sf="tout-voir" data-id="${esc(s.id)}">${tout ? 'Voir moins' : `Voir tous les produits (${dispo.length})`}</button></p>` : ''}</section>`;
    }
    case 'arguments':
      return `<section class="sf-arguments" data-sans-traduction>${[p.a1, p.a2, p.a3].filter(Boolean).map(a => `<div>${esc(a)}</div>`).join('')}</section>`;
    case 'texte':
      if (!p.titre && !p.texte && mode !== 'edition') return '';
      return `<section class="sf-texte" data-ancre="apropos" data-sans-traduction>${p.titre ? `<h2>${esc(p.titre)}</h2>` : ''}${p.texte ? `<p>${esc(p.texte)}</p>` : ''}</section>`;
    case 'avis': {
      // Avis vérifiés réels s’il y en a ; sinon les textes saisis dans l’éditeur.
      const reels = (etat.avisRecents || []).slice(0, 4);
      const etoiles = n => '★★★★★'.slice(0, n) + `<span aria-hidden="true" class="sf-etoiles-vides">${'☆☆☆☆☆'.slice(0, 5 - n)}</span>`;
      if (reels.length) return `<section class="sf-avis"><h2 class="sf-avis-titre">${esc(p.titre || 'Ce qu’en disent nos clients')}</h2>${reels.map(a => `
        <figure><div class="sf-etoiles" aria-label="${a.note} étoiles sur 5">${etoiles(a.note)}</div><blockquote data-sans-traduction>${esc(a.texte)}</blockquote><figcaption>${esc(a.prenom)}${a.ville ? ', ' + esc(a.ville) : ''} · achat vérifié</figcaption>${a.reponse ? `<p class="sf-reponse"><b>Réponse de la boutique :</b> ${esc(a.reponse)}</p>` : ''}</figure>`).join('')}
        <p class="sf-methode">Avis vérifiés : seuls les clients dont la commande a été expédiée peuvent noter, via un lien personnel envoyé par e-mail. Tous les avis sont publiés, positifs comme négatifs.</p></section>`;
      // Sans avis vérifiés : rien en ligne (un témoignage saisi à la main n'a pas d'étoiles et ne passe pas pour un avis client).
      const temoignages = [[p.a1, p.n1], [p.a2, p.n2]].filter(a => a[0] && String(a[0]).trim());
      if (!temoignages.length) return mode === 'edition' ? '<section class="sf-avis"><p class="sf-methode">Les avis vérifiés de vos clients s’afficheront ici dès les premières notes. Rien n’est affiché en ligne d’ici là.</p></section>' : '';
      return `<section class="sf-avis"><h2 class="sf-avis-titre">${esc(p.titre || 'Témoignages')}</h2>${temoignages.map(([a, n]) => `
        <figure data-sans-traduction><blockquote>${esc(a)}</blockquote>${n ? `<figcaption>${esc(n)}</figcaption>` : ''}</figure>`).join('')}</section>`;
    }
    case 'newsletter': {
      // Ancien texte par défaut (« -10 % ») : il ne promet que la remise réellement envoyée par l'e-mail de bienvenue.
      const bv = (((typeof etatVente === 'function' ? etatVente() : etat).automatisations || {}).bienvenue) || etat.newsletter || null;
      const r = bv && bv.actif && bv.code ? Number(bv.remise ?? 10) : 0;
      const texte = p.texte === '-10 % sur votre première commande.' ? (r > 0 ? `-${r} % sur votre première commande.` : 'Les nouveautés de la boutique, quelques fois par mois.') : p.texte;
      return `<section class="sf-newsletter"><h2 data-sans-traduction>${esc(p.titre)}</h2><p>${esc(texte)}</p>
        <form data-sf="newsletter"><input type="email" placeholder="Votre e-mail" aria-label="Votre e-mail" required><button class="sf-btn">S’inscrire</button></form></section>`;
    }
    case 'faq':
      return `<section class="sf-faq"><h2>Questions fréquentes</h2>${[[p.q1, p.r1], [p.q2, p.r2]].filter(q => q[0]).map(([q, r]) => `<details><summary data-sans-traduction>${esc(q)}</summary><p data-sans-traduction>${esc(r)}</p></details>`).join('')}</section>`;
    case 'pied':
      return `<footer class="sf-pied" data-ancre="contact"><strong data-sans-traduction>${esc(etat.boutique.nom)}</strong><span data-sans-traduction>${esc(p.texte)}</span><span>${esc(p.contact && !/@exemple\./i.test(p.contact) ? p.contact : (etat.entreprise && etat.entreprise.email) || '')}</span>
        <span class="sf-legal">${mode === 'edition' ? '' : '<button type="button" data-action="doc" data-id="commandes">Mes commandes</button>'}<button type="button" data-action="doc" data-id="mentions">Mentions légales</button><button type="button" data-action="doc" data-id="cgv">CGV</button></span></footer>`;
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
  const max = p.type === 'drop' || (Array.isArray(p.variantes) && p.variantes.length) ? 10 : Math.max(1, Math.min(10, p.stock));   // variante : bornée à son stock à l'ajout
  return `<div class="sf-fiche-fond" data-sf="fermer-fiche"></div>
  <div class="sf-fiche" role="dialog" aria-modal="true" aria-label="${esc(p.nom)}">
    <button type="button" class="sf-fiche-fermer" data-sf="fermer-fiche" aria-label="Fermer">×</button>
    <div class="sf-fiche-visuel">${visuelProduit(p)}</div>
    <div class="sf-fiche-infos">
      ${p.categorie ? `<small class="sf-fiche-cat">${esc(p.categorie)}</small>` : ''}
      <h2 data-sans-traduction>${esc(p.nom)}</h2>
      <p class="sf-fiche-prix">${prixBarreAffiche(p, etat) ? `<s class="sf-barre">${euros(prixBarreAffiche(p, etat))}</s> ` : ''}<strong data-sf-prix>${euros(Array.isArray(p.variantes) && p.variantes.length ? ((p.variantes.find(v => v.stock > 0) || p.variantes[0]).prix ?? p.prix) : p.prix)}</strong> <small>${esc(mentionTva((etat.entreprise || {}).regime, etat.boutique.pays))}</small></p>
      ${prixBarreAffiche(p, etat) ? `<p class="sf-fiche-note">Prix barré : prix pratiqué pendant au moins 30 jours avant la baisse.</p>` : ''}
      ${p.avis && p.avis.n ? `<p class="sf-note">★ ${p.avis.moyenne.toFixed(1).replace('.', ',')} sur 5 · ${p.avis.n} avis vérifiés</p>` : ''}
      ${p.description ? `<p class="sf-fiche-desc" data-sans-traduction>${esc(p.description)}</p>` : ''}
      <p class="sf-fiche-delai">${esc(fenetreLivraison(delaiProduit(p)))}</p>
      ${(() => {
        // Pays d'expédition (les CGV y renvoient) et, hors du pays du client, frais d'importation possibles.
        if (p.type !== 'drop' || !p.entrepot) return '';
        const ch = etat.boutique.pays === 'ch', nom = { CH: 'Suisse', UE: 'Union européenne', CN: 'Chine' }[p.entrepot] || p.entrepot;
        const etranger = ch ? p.entrepot !== 'CH' : p.entrepot !== 'UE';
        return `<p class="sf-fiche-note">Expédié depuis : ${esc(nom)}.${etranger ? (ch ? ' TVA d’importation et frais de dédouanement possibles à la livraison (au-delà de CHF 5 de TVA par envoi).' : ' Envoi de l’extérieur de l’UE : TVA d’importation et frais du transporteur possibles à la livraison.') : ''}</p>`;
      })()}
      ${Array.isArray(p.options) && Array.isArray(p.variantes) && p.variantes.length ? `<div class="sf-options" data-sans-traduction>${p.options.map((o, i) => {
        const premier = (p.variantes.find(v => v.stock > 0) || p.variantes[0]).valeurs[i];
        return `<label class="sf-qte"><span>${esc(o.nom)}</span><select data-sf-option="${i}" aria-label="${esc(o.nom)}">${o.valeurs.map(v => `<option value="${esc(v)}" ${v === premier ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
      }).join('')}</div>` : ''}
      <div class="sf-fiche-achat">
        <label class="sf-qte"><span>Quantité</span><select data-sf-qte aria-label="Quantité">${Array.from({ length: max }, (_, i) => `<option ${i + 1 === qte ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <button class="sf-btn" data-sf="ajouter" data-id="${esc(p.id)}" ${epuise ? 'disabled' : ''}>${epuise ? 'Épuisé' : 'Ajouter au panier'}</button>
      </div>
      ${p.type !== 'drop' ? `<form class="sf-alerte" data-alerte-stock="${esc(p.id)}" ${epuise ? '' : 'hidden'}><p><strong>Épuisé pour l’instant.</strong> Laissez votre e-mail : nous vous écrivons une seule fois, dès le retour en stock.</p><div class="sf-alerte-ligne"><input type="email" name="email" required placeholder="Votre e-mail" aria-label="Votre e-mail" autocomplete="email"><button class="sf-btn">Prévenez-moi</button></div></form>` : ''}
      ${reassurance.length ? `<ul class="sf-fiche-plus">${reassurance.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      ${avis.length ? `<div class="sf-fiche-avis"><h3>Avis sur ce produit</h3>${avis.map(a => `<figure><div class="sf-etoiles" aria-label="${a.note} étoiles sur 5">${'★★★★★'.slice(0, a.note)}<span aria-hidden="true" class="sf-etoiles-vides">${'☆☆☆☆☆'.slice(0, 5 - a.note)}</span></div><blockquote data-sans-traduction>${esc(a.texte)}</blockquote><figcaption>${esc(a.prenom || '')}${a.ville ? ', ' + esc(a.ville) : ''}</figcaption>${a.reponse ? `<p class="sf-reponse"><b>Réponse de la boutique :</b> ${esc(a.reponse)}</p>` : ''}</figure>`).join('')}</div>` : ''}
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
  // Aucune section (configuration vide ou abîmée) : en ligne, la boutique montre au moins ses produits au lieu d'une page blanche.
  const listeSections = (b.sections || []).length || mode === 'edition' ? (b.sections || []) : [{ id: 'secours', type: 'produits', props: { titre: 'Nos produits', nombre: '8', categorie: '' } }];
  const sections = listeSections.map(s => {
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
    return `<div class="sf" data-vars="${varsTheme(b.theme)}">${premierHtml}${entete}${resteHtml}${ficheHtml}</div>`;
  }
  // Sans section d'en-tête (qui porte le titre principal), le nom de la boutique sert de titre principal, pour les lecteurs d'écran et les moteurs de recherche.
  const titrePrincipal = listeSections.some(x => x.type === 'hero') ? '' : `<h1 class="sf-masque" data-sans-traduction>${esc(b.nom)}</h1>`;
  return `<div class="sf" data-vars="${varsTheme(b.theme)}">${entete}${titrePrincipal}${sections}${ficheHtml}</div>`;
}

/* Navigation de la boutique : défile jusqu’à la collection, au texte de présentation ou au pied de page. */
function allerSection(racine, cle) {
  const cible = racine.querySelector(cle === 'collection' ? '#sf-collection' : `[data-ancre="${cle}"]`) || racine.querySelector('[data-ancre="contact"]');
  cible?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
