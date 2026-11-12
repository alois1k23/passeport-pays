/* Comptoir — styles dynamiques sans attribut « style ».
   La politique de sécurité (CSP) interdit les styles en ligne : une injection de HTML ne peut donc pas restyler une page
   (faux bouton, texte masqué, superposition). Les rares valeurs calculées (largeur d'une barre, couleurs d'un thème)
   passent par des attributs typés, appliqués ici par le CSSOM, que la politique autorise :
   - data-largeur / data-hauteur : pourcentage (nombre borné entre 0 et 100) ;
   - data-largeur-px : largeur en pixels (nombre borné) ;
   - data-vars : propriétés personnalisées seulement (« --nom:valeur; … »), valeurs vérifiées (couleur, nombre, police).
   Même injecté par erreur, un de ces attributs ne peut rien faire d'autre : pas de CSS libre, pas d'adresse externe. */
const StylesSurs = (() => {
  const nombre = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  // Valeur d'une propriété personnalisée : couleur, nombre (avec unité), nom de police. Pas d'url(), pas de fonction exotique.
  const valeurSure = v => {
    const t = String(v).trim();
    if (!t || t.length > 120) return false;
    if (/url\(|image|expression|@|\\|\/\*|[;{}<>]/i.test(t)) return false;
    return /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%]+\)|-?[\d.]+(px|%|rem|em|deg)?|[\w\s"',.-]+)$/i.test(t);
  };
  function appliquer(el) {
    const d = el.dataset;
    if (d.largeur !== undefined) { const n = nombre(d.largeur); if (n !== null) el.style.width = `${Math.max(0, Math.min(100, n))}%`; }
    if (d.hauteur !== undefined) { const n = nombre(d.hauteur); if (n !== null) el.style.height = `${Math.max(0, Math.min(100, n))}%`; }
    if (d.largeurPx !== undefined) { const n = nombre(d.largeurPx); if (n !== null) el.style.width = `${Math.max(0, Math.min(2000, n))}px`; }
    if (d.vars !== undefined) {
      for (const paire of String(d.vars).split(';')) {
        const i = paire.indexOf(':'); if (i < 0) continue;
        const nom = paire.slice(0, i).trim(), valeur = paire.slice(i + 1).trim();
        if (/^--[a-z][a-z0-9-]{0,30}$/.test(nom) && valeurSure(valeur)) el.style.setProperty(nom, valeur);
      }
    }
  }
  const SELECTEUR = '[data-largeur],[data-hauteur],[data-largeur-px],[data-vars]';
  function parcourir(racine) {
    if (racine.nodeType !== 1) return;
    if (racine.matches(SELECTEUR)) appliquer(racine);
    for (const el of racine.querySelectorAll(SELECTEUR)) appliquer(el);
  }
  // Chaque ajout au document (affichage d'une vue, d'une fenêtre) est traité avant l'affichage à l'écran.
  new MutationObserver(liste => {
    for (const m of liste) {
      if (m.type === 'attributes') appliquer(m.target);
      else for (const n of m.addedNodes) parcourir(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-largeur', 'data-hauteur', 'data-largeur-px', 'data-vars'] });
  if (document.body) parcourir(document.body);
  else document.addEventListener('DOMContentLoaded', () => parcourir(document.body));
  return { appliquer, parcourir, valeurSure };
})();
