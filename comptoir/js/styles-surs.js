/* Comptoir — styles dynamiques sans attribut « style ».
   La politique de sécurité (CSP) interdit les styles en ligne : une injection de HTML ne peut donc pas restyler une page
   (faux bouton, texte masqué, superposition). Les rares valeurs calculées (largeur d'une barre, couleurs d'un thème)
   passent par des attributs typés, appliqués ici par le CSSOM, que la politique autorise :
   - data-largeur / data-hauteur : pourcentage (nombre borné entre 0 et 100) ;
   - data-largeur-px : largeur en pixels (nombre borné) ;
   - data-vars : une liste fermée de propriétés personnalisées (couleurs et polices des thèmes, teinte), chacune avec son type.
   Même injecté par erreur, un de ces attributs ne peut changer qu'une barre ou une couleur de thème : pas de CSS libre,
   pas de propriété de mise en page, pas d'adresse externe. */
const StylesSurs = (() => {
  const nombre = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  // Propriétés personnalisées permises, chacune avec son type : rien d'autre (pas de propriété de mise en page, pas de mot-clé libre).
  const COULEUR = v => /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%]+\))$/i.test(v);
  const LONGUEUR = v => /^\d{1,3}(\.\d+)?px$/.test(v);
  const POLICE = v => v.length <= 120 && /^[\w\s"',.-]+$/.test(v) && !/\b(inherit|initial|unset|revert)\b/i.test(v);
  const NOMBRE = v => /^-?\d{1,4}(\.\d+)?$/.test(v);
  const TYPES = {
    '--sf-bg': COULEUR, '--sf-surface': COULEUR, '--sf-text': COULEUR, '--sf-muted': COULEUR, '--sf-primary': COULEUR, '--sf-on-primary': COULEUR,
    '--sf-font': POLICE, '--sf-body': POLICE, '--sf-radius': LONGUEUR,
    '--ap-bg': COULEUR, '--ap-text': COULEUR, '--ap-muted': COULEUR, '--ap-primary': COULEUR, '--ap-font': POLICE, '--ap-body': POLICE, '--ap-r': LONGUEUR,
    '--teinte': NOMBRE
  };
  const valeurSure = (nom, v) => { const t = String(v).trim(); return !!TYPES[nom] && TYPES[nom](t); };
  const lirePaires = texte => String(texte || '').split(';').map(p => { const i = p.indexOf(':'); return i < 0 ? null : [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }).filter(Boolean);
  function appliquer(el, ancienVars) {
    const d = el.dataset;
    const pourcent = (attr, prop) => { const n = nombre(d[attr]); el.style[prop] = d[attr] !== undefined && n !== null ? `${Math.max(0, Math.min(100, n))}%` : ''; };
    if (d.largeur !== undefined) pourcent('largeur', 'width');
    if (d.hauteur !== undefined) pourcent('hauteur', 'height');
    if (d.largeurPx !== undefined) { const n = nombre(d.largeurPx); el.style.width = n !== null ? `${Math.max(0, Math.min(2000, n))}px` : ''; }
    // Valeurs posées précédemment et absentes maintenant : retirées (pas de couleur ou de largeur périmée).
    if (ancienVars !== undefined) for (const [nom] of lirePaires(ancienVars)) if (TYPES[nom]) el.style.removeProperty(nom);
    if (d.vars !== undefined) for (const [nom, valeur] of lirePaires(d.vars)) if (valeurSure(nom, valeur)) el.style.setProperty(nom, valeur);
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
      if (m.type === 'attributes') {
        const el = m.target;
        // Attribut retiré : la valeur qu'il avait posée est retirée aussi.
        if (m.attributeName === 'data-largeur' && el.dataset.largeur === undefined) el.style.width = '';
        if (m.attributeName === 'data-hauteur' && el.dataset.hauteur === undefined) el.style.height = '';
        if (m.attributeName === 'data-largeur-px' && el.dataset.largeurPx === undefined) el.style.width = '';
        appliquer(el, m.attributeName === 'data-vars' ? (m.oldValue || '') : undefined);
      } else for (const n of m.addedNodes) parcourir(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-largeur', 'data-hauteur', 'data-largeur-px', 'data-vars'] });
  if (document.body) parcourir(document.body);
  else document.addEventListener('DOMContentLoaded', () => parcourir(document.body));
  return { appliquer, parcourir, valeurSure };
})();
