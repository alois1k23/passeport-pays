/* Comptoir — application : routage, interface d’administration, éditeur, commandes. */

const CLE = 'comptoir-etat-v4';
let etat = charger();
const ui = {
  route: 'tableau',
  commande: null,
  filtre: 'tous',
  recherche: '',
  section: null,
  ongletEditeur: 'sections',
  appareil: 'ordinateur',
  panier: [],
  panierOuvert: false,
  confirmation: null,
  produitEdite: null,
  dom: { mois: new Date().getMonth(), motsCles: '', marque: null },
  assistant: { etape: 1, nom: '', secteur: 'maison', pays: 'ch', modele: 'drop', theme: 'leman', exemples: true, domaine: null },
  sourcing: { niche: '', entrepots: ['CH', 'UE'], delaiMax: 10 },
  confirmerReset: false,
  campagne: null,
  caisse: [],
  modal: null,
  livraison: 'colissimo'
};

/* ---------- Persistance ---------- */
function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (brut) { const e = JSON.parse(brut); if (e && e.version === 2) return completerEtat(e); }
  } catch (e) { /* stockage indisponible : on repart de la démo */ }
  return boutiqueDemoLausanne();
}
function sauver() {
  // Compte connecté : les données vivent sur le serveur. Aucune copie locale (données des clients, photos) :
  // le navigateur garde sa place pour la file de la caisse hors ligne.
  if (typeof SERVEUR !== 'undefined' && SERVEUR.connecte) { try { localStorage.removeItem(CLE); } catch { /* ignoré */ } return; }
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) { /* ignoré */ }
}

/* ---------- Utilitaires ---------- */
const $ = s => document.querySelector(s);
const JOUR = 86400000;
function dateCourte(t) { const d = new Date(t); return d.toLocaleDateString('fr-FR', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); }
function dateHeure(t) { return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function pct(n) { return (n > 0 ? '+' : '') + Math.round(n * 100) + ' %'; }
function pill(statut) { const s = STATUTS[statut]; return `<span class="pill ${s.ton}">${s.nom}</span>`; }
/* Montant conservé d'une vente : total moins les retours partiels remboursés (avoirs partiels). */
function netVente(c) { return c.total - (c.retoursPartiels || []).reduce((a, p) => a + p.montant, 0) / 100; }
/* Unités conservées d'une ligne (moins celles rendues lors de retours partiels). */
function qteGardee(c, i) { return c.lignes[i].qte - (c.retoursPartiels || []).reduce((a, p) => a + p.lignes.filter(x => x.index === i).reduce((b, x) => b + x.qte, 0), 0); }
function compteVentes(c) { return !['annulee', 'remboursee', 'attente'].includes(c.statut) && c.canal !== 'carte'; }   // carte cadeau vendue : comptée quand elle sert, pas deux fois
function toast(msg, lien) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (lien ? ` <a href="#${lien[0]}">${esc(lien[1])}</a>` : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4200);
}
function nouvelId(prefixe) { return prefixe + Math.random().toString(36).slice(2, 8); }

/* ---------- Graphique en barres (SVG, à l’échelle) ---------- */
function graphBarres(donnees, { hauteur = 180, format = v => v, surligne = -1, labelsTous = false } = {}) {
  const L = 640, H = hauteur, mg = { g: 44, d: 8, h: 10, b: 24 };
  const max = Math.max(1, ...donnees.map(d => d.v));
  const pas = Math.pow(10, Math.floor(Math.log10(max)));
  const haut = Math.ceil(max / pas) * pas;
  const y = v => mg.h + (H - mg.h - mg.b) * (1 - v / haut);
  const bande = (L - mg.g - mg.d) / donnees.length;
  const larg = Math.max(2, bande - 2);
  const ticks = [0, haut / 2, haut];
  let svg = `<svg viewBox="0 0 ${L} ${H}" class="graph" role="img">`;
  for (const t of ticks) {
    svg += `<line x1="${mg.g}" x2="${L - mg.d}" y1="${y(t)}" y2="${y(t)}" class="grille"/>`;
    svg += `<text x="${mg.g - 6}" y="${y(t) + 4}" text-anchor="end" class="axe">${esc(format(t))}</text>`;
  }
  donnees.forEach((d, i) => {
    const x = mg.g + i * bande + 1;
    const top = y(d.v), bas = y(0), h = bas - top, r = Math.min(4, larg / 2, h);
    const chemin = h <= 0 ? '' : `M${x},${bas} V${top + r} Q${x},${top} ${x + r},${top} H${x + larg - r} Q${x + larg},${top} ${x + larg},${top + r} V${bas} Z`;
    svg += `<path d="${chemin}" class="barre${i === surligne ? ' fort' : ''}"/>`;
    svg += `<rect x="${x - 1}" y="${mg.h}" width="${bande}" height="${H - mg.h - mg.b}" class="cible" data-tip="${esc(d.tip || d.label + ' : ' + format(d.v))}"/>`;
    if (labelsTous || i % Math.ceil(donnees.length / 6) === 0 || i === donnees.length - 1)
      svg += `<text x="${x + larg / 2}" y="${H - 6}" text-anchor="middle" class="axe${i === surligne ? ' fort' : ''}">${esc(d.label)}</text>`;
  });
  return svg + '</svg>';
}

/* ---------- Coque de l’application ---------- */
/* Icônes au trait (24 × 24), dessinées pour Comptoir. */
const ICONES = {
  tableau: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  analyse: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  copilote: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m10 15 1.5 1.5L15 13"/>',
  commandes: '<path d="M6 3h12l1 18-3.5-2-3 2-3-2L6 21Z"/><path d="M9 8h6M9 12h6"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  magasin: '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z"/><path d="M5 13v8h14v-8M10 21v-5h4v5"/>',
  produits: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9Z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
  stars: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
  sourcing: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  tests: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  parametres: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  fournisseurs: '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  conversion: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
  social: '<path d="M4 11v2a1 1 0 0 0 1 1h2l5 4V6L7 10H5a1 1 0 0 0-1 1Z"/><path d="M16 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  domaines: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  editeur: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  conformite: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  boutique: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lune: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  offre: '<path d="M20 12 12 20l-8-8V4h8Z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  devis: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/><path d="M4 7v14h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const icone = (nom, taille = 16) => `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom] || ''}</svg>`;

const NAV = [
  ['tableau', 'Vue d’ensemble', 'Pilotage'],
  ['analyse', 'Analyse', 'Pilotage'],
  ['copilote', 'Copilote de saison', 'Pilotage'],
  ['commandes', 'Commandes', 'Ventes'],
  ['clients', 'Clients', 'Ventes'],
  ['magasin', 'Magasin et caisse', 'Ventes'],
  ['devis', 'Devis', 'Ventes'],
  ['produits', 'Produits', 'Catalogue'],
  ['stars', 'Produits stars', 'Catalogue'],
  ['sourcing', 'Trouver des produits', 'Catalogue'],
  ['tests', 'Tests produits', 'Catalogue'],
  ['fournisseurs', 'Fournisseurs', 'Catalogue'],
  ['social', 'Réseaux sociaux', 'Marketing'],
  ['conversion', 'Conversion et e-mails', 'Marketing'],
  ['editeur', 'Éditeur du site', 'Boutique'],
  ['domaines', 'Domaines', 'Boutique'],
  ['conformite', 'Conformité', 'Boutique'],
  ['boutique', 'Voir la boutique', 'Boutique'],
  ['parametres', 'Paramètres', 'Compte']
];
const TITRES_HORS_NAV = { creer: ['Boutique', 'Nouvelle boutique'], offre: ['Compte', 'Offre et tarifs'] };

/* Thème : système, clair ou sombre (mémorisé dans ce navigateur). */
function appliquerTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('comptoir-theme') || 'auto'; } catch { /* ignoré */ }
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const b = document.getElementById('theme-btn');
  if (b) { b.innerHTML = icone(t === 'dark' ? 'lune' : t === 'light' ? 'soleil' : 'auto', 15); b.title = `Thème : ${{ auto: 'système', light: 'clair', dark: 'sombre' }[t]}`; }
}
appliquerTheme();

let dernierTab = null;
document.addEventListener('keydown', e => { if (e.key === 'Tab') dernierTab = { id: e.target.id || '', arriere: e.shiftKey, t: Date.now() }; }, true);

function rendre() {
  const route = ui.route;
  document.body.dataset.route = route;
  document.body.dataset.connecte = typeof SERVEUR !== 'undefined' && SERVEUR.connecte ? '1' : '';   // l'aperçu pleine largeur n'existe qu'en démonstration
  const aTraiter = etat.commandes.filter(c => c.statut === 'payee' || c.statut === 'preparation').length;
  const aValider = prochainsTempsForts(2).filter(e => !etat.campagnes[e.cle]).length;
  let groupe = '';
  // Membre de l'équipe avec le rôle « commandes » : seulement ce qui sert à préparer et expédier.
  const roleCommandes = typeof SERVEUR !== 'undefined' && SERVEUR.role === 'commandes';
  const navVisible = roleCommandes ? NAV.filter(([id]) => ['tableau', 'commandes', 'clients', 'magasin', 'parametres'].includes(id)) : NAV;
  $('#nav').innerHTML = navVisible.map(([id, nom, g]) => {
    const tete = g !== groupe ? `<div class="nav-groupe">${(groupe = g)}</div>` : '';
    const verrouille = !fonctionIncluse(id);
    return `${tete}<a href="#${id}" class="${route === id ? 'actif' : ''}${verrouille ? ' verrouille' : ''}" ${route === id ? 'aria-current="page"' : ''} ${verrouille ? `title="Formule ${Formules.FORMULES[Formules.FONCTIONS[id]].nom}"` : ''}>${icone(id)}<span>${nom}</span>${verrouille ? '<i class="cadenas" aria-label="Non inclus dans votre formule">🔒</i>' : ''}${id === 'commandes' && aTraiter ? `<b class="badge">${aTraiter}</b>` : ''}${id === 'copilote' && aValider && !verrouille ? `<b class="badge">${aValider}</b>` : ''}</a>`;
  }).join('');
  const n = NAV.find(x => x[0] === route);
  const [g, t] = n ? [n[2], n[1]] : (TITRES_HORS_NAV[route] || ['Comptoir', '']);
  // Menu horizontal (tablette, mobile) : l’onglet actif est ramené au centre, sans faire défiler la page.
  requestAnimationFrame(() => { const nav = document.getElementById('nav'), a = nav && nav.querySelector('a.actif'); if (a && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += a.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - a.offsetWidth) / 2; });
  $('#fil').innerHTML = `<i>${esc(etat.boutique.nom)}</i><i>/</i><span>${esc(g)}</span><i>/</i><b>${esc(t)}</b>`;
  const enLigne = typeof SERVEUR !== 'undefined' && SERVEUR.connecte;
  // « En ligne » seulement si la boutique peut vendre : adresse du vendeur saisie (sinon le serveur refuse les commandes).
  const vend = enLigne && String((etat.entreprise || {}).adresse || '').trim() && !/compléter/.test((etat.entreprise || {}).adresse || '') && !(SERVEUR.paiementsBoutique && !SERVEUR.paiementsBoutique.pret);
  $('#mode-badge').textContent = enLigne ? (vend ? 'En ligne' : 'À compléter') : 'Démo';
  $('#mode-badge').classList.toggle('reel', enLigne);
  document.title = `${t || 'Comptoir'} · ${etat.boutique.nom}`;
  $('#nom-boutique').textContent = etat.boutique.nom;
  $('#domaine-actuel').textContent = adresseBoutique();
  const vues = { stars: vueStars, tableau: vueTableau, commandes: vueCommandes, produits: vueProduits, clients: vueClients, editeur: vueEditeur, domaines: vueDomaines, boutique: vueBoutique, creer: vueAssistant, copilote: vueCopilote, sourcing: vueSourcing, social: vueSocial, tests: vueTests, analyse: vueAnalyse, parametres: vueParametres, fournisseurs: vueFournisseurs, conversion: vueConversion, magasin: vueMagasin, devis: vueDevis, conformite: vueConformite, offre: vueOffre };
  // Le champ actif (par son id) retrouve le focus après le rendu : Tab après une modification ne renvoie plus au début de la page.
  // Si l'on quitte un champ avec Tab, son « change » redessine la vue avant que le focus n'arrive au champ suivant : on l'y amène.
  const actif = document.activeElement, surCorps = !actif || actif === document.body;
  const idActif = actif && actif.id && actif.closest && actif.closest('#vue') ? actif.id : '';
  // Sans id : bouton ou bloc retrouvé par ses attributs (Monter/Descendre, sections de l'aperçu).
  const selActif = !idActif && actif && actif.closest && actif.closest('#vue') ? ['data-action', 'data-id', 'data-section', 'data-v'].filter(k => actif.hasAttribute(k)).map(k => `[${k}="${CSS.escape(actif.getAttribute(k))}"]`).join('') : '';
  const tab = surCorps && dernierTab && Date.now() - dernierTab.t < 300 ? dernierTab : null;
  $('#vue').innerHTML = (vues[route] || vueTableau)();
  if (idActif || selActif || (tab && tab.id)) setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    if (!idActif && selActif) { const x = $('#vue').querySelector(selActif); if (x) { x.focus({ preventScroll: true }); return; } }
    const el = document.getElementById(idActif || (tab && tab.id) || '');
    if (!el) return;
    if (idActif) return el.focus({ preventScroll: true });
    const ordre = [...$('#vue').querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent && x.type !== 'hidden');
    const i = ordre.indexOf(el), cible = ordre[i + (tab.arriere ? -1 : 1)] || el;
    cible.focus();
  }, 0);
  // Mode connecté : une fonction hors de la formule payée affiche une invitation (le serveur refuse aussi l'accès).
  const ab = abonnementCourant();
  if (ab && ab.obligatoire && Formules.FONCTIONS[route] && !Formules.permet(ab.formule, route)) $('#vue').innerHTML = vueFonctionVerrouillee(route, ab);
  apresRendu();
}

let minuterieRedim = null;
window.addEventListener('resize', () => { clearTimeout(minuterieRedim); minuterieRedim = setTimeout(() => { if (['tableau', 'analyse'].includes(ui.route)) rendre(); }, 200); });
function apresRendu() {
  if (ui.route === 'editeur') rendreApercu();
  if (ui.route === 'magasin') dessinerQR();
  // Fenêtre déjà affichée pour le même objet : on la laisse telle quelle (sinon la saisie en cours est effacée).
  const zone = $('#modal'), cle = ui.modal ? JSON.stringify(ui.modal) : '';
  // Même fenêtre déjà affichée : elle est redessinée (son contenu peut avoir changé) en gardant la saisie et le focus.
  const meme = cle && zone && !zone.hidden && zone.dataset.cle === cle;
  const champs = meme ? [...zone.querySelectorAll('input, textarea, select')].map((el, i) => [el.id || el.name || i, el.type === 'checkbox' ? el.checked : el.value]) : [];
  const focusCle = meme && zone.contains(document.activeElement) ? (document.activeElement.id || document.activeElement.name || [...zone.querySelectorAll('input, textarea, select, button')].indexOf(document.activeElement)) : null;
  rendreModal();
  if (meme) {
    const liste = [...zone.querySelectorAll('input, textarea, select')];
    for (const [k, v] of champs) { const el = typeof k === 'number' ? liste[k] : liste.find(x => (x.id || x.name) === k); if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } }
    if (focusCle !== null) { const el = typeof focusCle === 'number' ? [...zone.querySelectorAll('input, textarea, select, button')][focusCle] : liste.find(x => (x.id || x.name) === focusCle); if (el) el.focus({ preventScroll: true }); }
  }
}

/* État vide commun : icône, titre, explication, action. */
function etatVide(ico, titre, texte, action = '') {
  return `<div class="vide-etat">${icone(ico, 22)}<strong>${esc(titre)}</strong><span>${esc(texte)}</span>${action}</div>`;
}

/* ---------- Tableau de bord ---------- */
/* Pied de tableau paginé générique : « 1–25 sur 427 », boutons Précédente / Suivante (data-action, data-d). */
function pagination(total, page, parPage, action) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  if (pages <= 1) return '';
  const debut = (page - 1) * parPage;
  return `<div class="pagination"><span class="sous">${debut + 1}–${Math.min(debut + parPage, total)} sur ${total.toLocaleString('fr-FR')}</span>
    <div class="rangee"><button class="btn petit fantome" data-action="${action}" data-d="-1" ${page <= 1 ? 'disabled' : ''}>Précédente</button><span class="sous">Page ${page} / ${pages}</span><button class="btn petit fantome" data-action="${action}" data-d="1" ${page >= pages ? 'disabled' : ''}>Suivante</button></div></div>`;
}

function caDouzeMois() { const d = Date.now() - 365 * JOUR; return etat.commandes.filter(c => c.date >= d && compteVentes(c)).reduce((s, c) => s + c.total, 0); }
function connecteAuServeur() { return typeof SERVEUR !== 'undefined' && !!SERVEUR.connecte; }

function vueFonctionVerrouillee(route, ab) {
  const min = Formules.FONCTIONS[route], f = Formules.FORMULES[min];
  return `<div class="tete"><div><h1>${esc(Formules.NOMS_FONCTIONS[route])}</h1><p class="sous">Disponible avec la formule ${esc(f.nom)}.</p></div></div>
  <section class="carte verrou-formule"><div class="carte-tete"><h2>Passer à ${esc(f.nom)} : ${esc(Formules.prixTexte(min, ab.devise))} par mois</h2><span class="pill muted">Votre formule : ${esc(Formules.FORMULES[ab.formule] ? Formules.FORMULES[ab.formule].nom : '—')}</span></div>
    <ul>${f.inclus.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="rangee"><button class="btn" data-action="abo-changer" data-v="${min}">Passer à ${esc(f.nom)}</button><a class="btn fantome" href="#offre">Comparer les formules</a></div>
    <p class="sous">Changement immédiat, sans frais ; la différence est prise en compte dès le prochain prélèvement.</p></section>`;
}

function statsPeriode(debut, fin) {
  const cs = etat.commandes.filter(c => c.date >= debut && c.date < fin && compteVentes(c));
  const ca = cs.reduce((a, c) => a + netVente(c), 0);
  return { ca, n: cs.length, panier: cs.length ? ca / cs.length : 0 };
}

function vueTableau() {
  const now = Date.now();
  // Même découpage que la page Analyse : 30 jours calendaires se terminant ce soir à minuit.
  const finJ = new Date(); finJ.setHours(24, 0, 0, 0);
  const fin = finJ.getTime(), debut = fin - 30 * JOUR;
  const cur = statsPeriode(debut, fin);
  const benef = (d, f) => etat.commandes.filter(c => c.date >= d && c.date < f && compteVentes(c)).reduce((a, c) => a + beneficeCommande(c), 0);
  const bCur = benef(debut, fin), bPrev = benef(debut - 30 * JOUR, debut);
  const prev = statsPeriode(debut - 30 * JOUR, debut);
  const conv = cur.n / etat.visites30j;
  const aExpedier = etat.commandes.filter(c => c.statut === 'payee');
  const attente = etat.commandes.filter(c => c.statut === 'attente').length;
  const jours = [], joursPrec = [];
  for (let i = 29; i >= 0; i--) {
    const d0 = new Date(now - i * JOUR); d0.setHours(0, 0, 0, 0);
    const s = statsPeriode(d0.getTime(), d0.getTime() + JOUR), sp = statsPeriode(d0.getTime() - 30 * JOUR, d0.getTime() - 29 * JOUR);
    jours.push({ label: dateCourte(d0), v: s.ca, n: s.n, panier: s.panier, net: etat.commandes.filter(c => c.date >= d0.getTime() && c.date < d0.getTime() + JOUR).reduce((a, c) => a + beneficeCommande(c), 0) });
    joursPrec.push(sp.ca);
  }
  const mois = new Date().getMonth();
  const saison = saisonDuMois(mois);
  const secteur = SECTEURS[etat.boutique.secteur];
  const indice = secteur.courbe[mois];
  const stockBas = etat.produits.filter(p => p.actif && p.stock <= 5);
  // Rupture prévue sous 14 jours au rythme actuel (et pas déjà signalée en stock bas).
  const ruptures = etat.produits.filter(p => p.actif && p.stock > 5).map(p => ({ p, f: previsionStock(p) })).filter(x => x.f && x.f.jours <= 14).sort((a, b) => a.f.jours - b.f.jours).slice(0, 5);
  const prochain = prochainsTempsForts(1)[0];
  const campProchain = genererCampagne(etat, prochain);
  const retraits = etat.commandes.filter(c => c.livraison === 'retrait' && c.canal === 'web' && ['payee', 'preparation', 'prete'].includes(c.statut)).length;
  const recentes = [...etat.commandes].sort((a, b) => b.date - a.date).slice(0, 6);
  const evol = (a, b) => b ? `<span class="evol ${a >= b ? 'up' : 'down'}">${pct(a / b - 1)} vs 30 j préc.</span>` : '';

  return `
  <div class="tete"><div><h1>Vue d’ensemble</h1><p class="sous">Activité de ${esc(etat.boutique.nom)} sur les 30 derniers jours, comparée aux 30 jours précédents.</p></div>
    <div class="rangee"><a class="btn fantome" href="#analyse">Analyse détaillée</a><a class="btn" href="#boutique">Voir la boutique</a></div></div>
  ${blocLancement()}
  <div class="kpis">
    ${tuile({ nom: 'Chiffre d’affaires', valeur: euros(cur.ca), actuel: cur.ca, precedent: prev.ca, tendance: jours.map(j => j.v) })}
    ${tuile({ nom: 'Bénéfice avant publicité (estimé)', valeur: euros(bCur), actuel: bCur, precedent: bPrev, tendance: jours.map(j => j.net) })}
    ${tuile({ nom: 'Commandes', valeur: cur.n.toLocaleString('fr-FR'), actuel: cur.n, precedent: prev.n, tendance: jours.map(j => j.n) })}
    ${tuile({ nom: 'Panier moyen', valeur: euros(cur.panier), actuel: cur.panier, precedent: prev.panier, tendance: jours.map(j => j.panier) })}
  </div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Chiffre d’affaires par jour</h2><a class="lien" href="#analyse">Détails</a></div>
      ${courbe({ fraction: 0.6, unite: devise(), labels: jours.map(j => j.label), series: [{ nom: '30 derniers jours', valeurs: jours.map(j => j.v), classe: 's1', aire: true }, { nom: '30 jours précédents', valeurs: joursPrec, classe: 'gris', pointille: true }], format: compact, formatTip: v => euros(v), hauteur: 230 })}
    </section>
    <section class="carte saison-carte">
      <span class="eyebrow">Copilote · prochain temps fort</span>
      <h2>${esc(prochain.nom)}, ${prochain.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</h2>
      <p>${dansJours(prochain.date)}. ${!fonctionIncluse('copilote') ? 'Avec la formule Croissance, le copilote prépare la campagne (offre, code, bannière, publications).' : etat.campagnes[prochain.cle] ? 'Votre campagne est programmée.' : `Campagne prête${campProchain.caPrevu === null ? ' (prévision de ventes dès vos premières commandes)' : ` : ${euros(campProchain.caPrevu)} de ventes prévues`}${campProchain.ruptures.length ? `, ${campProchain.ruptures.length} produit${campProchain.ruptures.length > 1 ? 's' : ''} à réassortir` : ''}.`}</p>
      <div class="jauge"><div data-largeur="${Math.min(100, indice / 1.8)}"></div></div>
      <p class="sous">Demande « ${esc(secteur.nom)} » : indice ${indice} (100 = mois moyen)</p>
      <div class="rangee">${fonctionIncluse('copilote') ? `<a class="btn" href="#copilote">${etat.campagnes[prochain.cle] ? 'Voir la campagne' : 'Relire et valider'}</a>` : '<a class="btn" href="#offre">Voir les formules</a>'}<a class="btn fantome" href="#domaines">Domaine de campagne</a></div>
    </section>
  </div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Dernières commandes</h2><a href="#commandes" class="lien">Toutes les commandes</a></div>
      ${recentes.length ? `<div class="table-wrap"><table class="table compacte"><thead><tr><th>N°</th><th>Client</th><th class="num">Total</th><th>Statut</th></tr></thead><tbody>${recentes.map(c => `
        <tr data-action="ouvrir-commande" data-id="${c.id}" tabindex="0"><td class="mono">#${c.numero}</td><td>${esc(c.client.nom)}<div class="sous">${dateCourte(c.date)} · ${esc(c.client.ville || '')}</div></td><td class="num">${euros(c.total)}</td><td>${pill(c.statut)}</td></tr>`).join('')}
      </tbody></table></div>` : etatVide('commandes', 'Pas encore de commande', fonctionIncluse('social') ? 'Partagez le lien de votre boutique ou lancez le pilote des réseaux sociaux pour obtenir vos premières visites.' : 'Partagez le lien de votre boutique (réseaux, messagerie, QR code) pour obtenir vos premières visites.', fonctionIncluse('social') ? '<a class="btn petit" href="#social">Préparer mes publications</a>' : '<a class="btn petit" href="#boutique">Voir ma boutique</a>')}
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>À faire</h2></div>
      ${(() => {
        const nFour = etat.commandes.filter(c => c.statut === 'fournisseur').length;
        // « texte » est inséré tel quel (HTML) : toute donnée venue d'un client ou de l'équipe doit passer par esc() avant.
        const item = (n, texte, lien, { alerte = false, filtre = '', section = '' } = {}) => `<li class="${alerte ? 'alerte' : ''}"><a href="#${lien}" ${filtre ? `data-action="filtre-lien" data-filtre="${filtre}"` : section ? `data-action="section-param" data-v="${section}"` : ''}><span class="todo-n">${n === null ? '<i></i>' : n}</span><span class="todo-t">${texte}</span><span class="todo-fl" aria-hidden="true">›</span></a></li>`;
        const pb = typeof SERVEUR !== 'undefined' && SERVEUR.connecte ? SERVEUR.paiementsBoutique : null;
        const items = [
          ...etat.commandes.filter(c => c.litige && c.litige.statut !== 'won' && c.litige.statut !== 'lost').map(c => item('!', `Litige bancaire sur la commande n° ${c.numero} : répondez dans Stripe${c.litige.echeance ? ` avant le ${new Date(c.litige.echeance).toLocaleDateString('fr-FR')}` : ''}`, 'commandes', { alerte: true })),
          ...(pb && pb.mode === 'stripe' && !pb.pret ? [item(null, 'Activez vos paiements : sans cela, la boutique n’accepte aucune commande', 'parametres', { alerte: true, section: 'paiements' })] : []),
          ...(typeof SERVEUR !== 'undefined' && SERVEUR.connecte && SERVEUR.recuperationEnAttente ? [item('!', `Récupération de votre compte demandée par e-mail : elle s’appliquera le ${new Date(SERVEUR.recuperationEnAttente).toLocaleString('fr-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Ce n’est pas vous ? Annulez-la`, 'parametres', { alerte: true, section: 'securite' })] : []),
          ...(typeof SERVEUR !== 'undefined' && SERVEUR.connecte && SERVEUR.compteProtege === false ? [item('!', 'Protégez votre compte : activez la double authentification (2 minutes)', 'parametres', { alerte: true, section: 'securite' })] : []),
          item(aExpedier.length, `commande${aExpedier.length > 1 ? 's' : ''} à préparer et expédier`, 'commandes', { alerte: aExpedier.length > 0, filtre: 'payee' }),
          item(attente, `paiement${attente > 1 ? 's' : ''} en attente`, 'commandes', { alerte: attente > 0, filtre: 'attente' }),
          ...stockBas.map(p => item(p.stock, `Stock bas : ${esc(p.nom)}`, 'produits', { alerte: true })),
          ...ruptures.map(({ p, f }) => item(`${f.jours} j`, `Rupture prévue : ${esc(p.nom)} (au rythme de ${f.parJour >= 1 ? Math.round(f.parJour) : f.parJour.toFixed(1).replace('.', ',')} par jour ; commandez-en ${f.aCommander} pour tenir 30 jours)`, 'produits', { alerte: f.jours <= 7 })),
          ...etat.produits.filter(p => p.actif !== false && typeof margeProduit === 'function' && margeProduit(p).nette < 0).slice(0, 3).map(p => item('!', `Vendu à perte : ${esc(p.nom)} (${euros(margeProduit(p).nette)} par vente)`, 'produits', { alerte: true })),
          nFour ? item(nFour, `commande${nFour > 1 ? 's' : ''} chez le fournisseur (suivi automatique)`, 'commandes', { filtre: 'fournisseur' }) : '',
          retraits ? item(retraits, `retrait${retraits > 1 ? 's' : ''} en magasin en cours`, 'magasin', { alerte: true }) : '',
          etat.boutique.domaine ? '' : item(null, 'Choisir un domaine personnalisé', 'domaines', { alerte: true }),
          etat.entreprise.mediateur || estSuisse() ? '' : item(null, 'Indiquer votre médiateur de la consommation (obligatoire)', 'conformite', { alerte: true }),
          etat.entreprise.adresse ? '' : item(null, `Indiquer l’adresse de l’entreprise (${estSuisse() ? 'Impressum' : 'mentions légales'}, obligatoire : sans elle, votre boutique n’accepte pas de commandes)`, 'conformite', { alerte: true }),
          estSuisse() && etat.entreprise.regime !== 'ch-assujetti' && caDouzeMois() >= 80000 ? item(null, `Chiffre d’affaires sur 12 mois : ${euros(caDouzeMois())}, plus de 80 % du seuil de CHF 100 000 : préparez votre inscription à la TVA auprès de l’AFC`, 'conformite', { alerte: true }) : '',
          (() => { if (!connecteAuServeur() || SERVEUR.fournisseurDemoVendable !== false) return ''; const n = etat.produits.filter(p => p.actif && p.codeFournisseur === 'demo').length; return n ? item(n, `produit${n > 1 ? 's' : ''} du fournisseur de démonstration, invisible${n > 1 ? 's' : ''} pour vos clients : il n’expédie rien réellement. Remplacez-le${n > 1 ? 's' : ''} par un fournisseur réel ou vos propres produits`, 'produits', { alerte: true }) : ''; })(),
          (() => { const t = JSON.stringify((etat.boutique.sections || []).map(x => x.props)); const anciens = ['Fabriqué en France', 'Expédié sous 48 h', 'expédiés depuis notre atelier', 'Retours gratuits 30 jours', 'Produit superbe et livraison rapide', 'Livraison offerte dès 60', '48 à 72 h en France']; const trouves = anciens.filter(x => t.includes(x)); return trouves.length ? item(null, `Vérifier les textes d’exemple de votre page d’accueil (« ${esc(trouves[0])} »…) : chaque promesse doit être vraie pour votre boutique`, 'editeur', { alerte: true }) : ''; })(),
          (() => { const n = etat.produits.filter(p => p.aVerifier).length; return n ? item(n, `produit${n > 1 ? 's' : ''} d’exemple à vérifier avant la mise en ligne`, 'produits', { alerte: true }) : ''; })(),
          (() => { const n = etat.produits.filter(p => p.actif !== false && !p.aVerifier && !p.image).length; return n ? item(n, `produit${n > 1 ? 's' : ''} sans photo (une vraie photo rassure et convertit mieux)`, 'produits') : ''; })()
        ];
        return `<ul class="todo">${items.join('')}
        <li>${etat.rdv ? `<a href="#tableau"><span class="todo-n"><i></i></span><span class="todo-t">Session de lancement le <strong>${dateHeure(etat.rdv)}</strong></span></a>` : '<button class="todo-btn" data-action="rdv"><span class="todo-n"><i></i></span><span class="todo-t">Réserver la session de lancement offerte (30 min en visio)</span><span class="todo-fl" aria-hidden="true">›</span></button>'}</li>
      </ul>`;
      })()}
    </section>
  </div>`;
}

/* ---------- Commandes ---------- */
function fluxPour(c) {
  if (estDropship(c) && c.canal !== 'magasin') {
    if (c.statut === 'payee') return [['fournisseur', 'Transmettre au fournisseur'], ['remboursee', 'Annuler et rembourser']];
    if (c.statut === 'fournisseur') return [['expediee', 'Simuler l’expédition par le fournisseur']];
  }
  if (c.livraison === 'retrait') {
    if (c.statut === 'preparation') return [['prete', 'Prête : prévenir le client']];
    if (c.statut === 'prete') return [['retiree', 'Remise au client']];
    if (c.statut === 'retiree') return [['remboursee', 'Rembourser']];
  }
  return FLUX[c.statut] || [];
}
const FLUX = {
  attente: [['payee', 'Marquer comme payée'], ['annulee', 'Annuler la commande']],
  payee: [['preparation', 'Commencer la préparation'], ['remboursee', 'Annuler et rembourser']],
  preparation: [['expediee', 'Marquer comme expédiée'], ['remboursee', 'Annuler et rembourser']],
  expediee: [['livree', 'Marquer comme livrée']],
  livree: [['remboursee', 'Rembourser']],
  remboursee: [], annulee: []
};

/* Commandes filtrées selon l’onglet, la période, le canal et la recherche. */
const PAR_PAGE = 50;
function commandesFiltrees() {
  const q = ui.recherche.trim().toLowerCase().replace(/^#\s*/, '').replace(/^n°\s*/, '');   // « #1006 » et « n° 1006 » comme la liste les affiche
  // Périodes en jours du calendrier : « Aujourd'hui » part de minuit, pas des dernières 24 heures.
  const depuis = ui.periodeCmd && ui.periodeCmd !== 'tout' ? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (Number(ui.periodeCmd) - 1)); return d.getTime(); })() : 0;
  return [...etat.commandes].sort((a, b) => b.date - a.date)
    .filter(c => ui.filtre === 'tous' || c.statut === ui.filtre || (ui.filtre === 'payee' && c.statut === 'preparation' && false))
    .filter(c => c.date >= depuis)
    .filter(c => !ui.canalCmd || ui.canalCmd === 'tous' || c.canal === ui.canalCmd)
    .filter(c => !q || String(c.numero).includes(q) || c.client.nom.toLowerCase().includes(q) || (c.client.email || '').toLowerCase().includes(q) || (c.client.ville || '').toLowerCase().includes(q));
}

function vueCommandes() {
  ui.selection = ui.selection || new Set();
  const filtres = [['tous', 'Toutes'], ['attente', 'Paiement en attente'], ['payee', 'À préparer'], ['preparation', 'En préparation'], ['fournisseur', 'Chez le fournisseur'], ['prete', 'À retirer'], ['expediee', 'Expédiées'], ['livree', 'Livrées'], ['remboursee', 'Remboursées']];
  const liste = commandesFiltrees();
  const pages = Math.max(1, Math.ceil(liste.length / PAR_PAGE));
  ui.pageCmd = Math.min(ui.pageCmd || 1, pages);
  const debut = (ui.pageCmd - 1) * PAR_PAGE;
  const page = liste.slice(debut, debut + PAR_PAGE);
  const ouverte = etat.commandes.find(c => c.id === ui.commande);
  // La sélection ne garde que les commandes de la liste affichée : une commande cachée par un filtre n'est jamais modifiée à l'aveugle.
  { const visibles = new Set(liste.map(c => c.id)); for (const id of [...ui.selection]) if (!visibles.has(id)) ui.selection.delete(id); }
  const sel = [...ui.selection];
  const toutCoche = page.length && page.every(c => ui.selection.has(c.id));
  const ca = liste.filter(compteVentes).reduce((a, c) => a + netVente(c), 0);
  return `
  <div class="tete"><div><h1>Commandes</h1><p class="sous">${liste.length.toLocaleString('fr-FR')} commande${liste.length > 1 ? 's' : ''} · ${euros(ca)} encaissés sur la sélection</p></div>
    <div class="rangee"><button class="btn fantome" data-action="export-commandes">Exporter CSV</button></div></div>
  <div class="onglets onglets-defilants" role="tablist" aria-label="Statut">${filtres.map(([id, nom]) => {
    const n = id === 'tous' ? etat.commandes.length : etat.commandes.filter(c => c.statut === id).length;
    return n || id === 'tous' || ui.filtre === id ? `<button role="tab" aria-selected="${ui.filtre === id}" class="${ui.filtre === id ? 'actif' : ''}" data-action="filtre" data-filtre="${id}">${nom} <span>${n}</span></button>` : '';
  }).join('')}</div>
  <div class="barre-filtres">
    <input id="recherche-commandes" type="search" placeholder="Rechercher un n°, un client, une ville…" value="${esc(ui.recherche)}" data-champ="recherche" aria-label="Rechercher une commande">
    <select data-cmd="periodeCmd" aria-label="Période">${[['tout', 'Toute la période'], ['1', 'Aujourd’hui'], ['7', '7 derniers jours'], ['30', '30 derniers jours'], ['90', '90 derniers jours']].map(([v, n]) => `<option value="${v}" ${(ui.periodeCmd || 'tout') === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <select data-cmd="canalCmd" aria-label="Canal">${[['tous', 'Tous les canaux'], ['web', 'En ligne'], ['magasin', 'En personne'], ['devis', 'Devis']].map(([v, n]) => `<option value="${v}" ${(ui.canalCmd || 'tous') === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
  </div>
  ${sel.length ? `<div class="barre-groupee" role="region" aria-label="Actions groupées"><b>${sel.length} sélectionnée${sel.length > 1 ? 's' : ''}</b>
    <button class="btn petit fantome" data-action="groupe-statut" data-statut="preparation">Mettre en préparation</button>
    <button class="btn petit fantome" data-action="groupe-statut" data-statut="expediee">Marquer expédiées</button>
    <button class="btn petit fantome" data-action="groupe-bons">Bons de préparation</button>
    <button class="btn petit fantome" data-action="export-commandes" data-selection="1">Exporter</button>
    <button class="bouton-lien" data-action="groupe-vider">Tout désélectionner</button></div>` : ''}
  <div class="maitre-detail ${ouverte ? 'ouvert' : ''}">
    <section class="carte sans-pad">
      ${page.length ? `<div class="table-wrap"><table class="table table-commandes table-cartes">
        <thead><tr><th class="col-case"><input type="checkbox" data-action="cocher-page" ${toutCoche ? 'checked' : ''} aria-label="Sélectionner les commandes de la page"></th><th>N°</th><th>Date</th><th>Client</th><th>Livraison</th><th class="num">Articles</th><th class="num">Total</th><th>Statut</th></tr></thead>
        <tbody>${page.map(c => `
          <tr data-action="ouvrir-commande" data-id="${c.id}" tabindex="0" class="${c.id === ui.commande ? 'choisi' : ''}">
            <td class="col-case"><input type="checkbox" data-action="cocher" data-id="${c.id}" ${ui.selection.has(c.id) ? 'checked' : ''} aria-label="Sélectionner la commande ${c.numero}"></td>
            <td class="mono carte-titre" data-label="N°">#${c.numero}</td><td data-label="Date">${dateCourte(c.date)}<div class="sous">${new Date(c.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div></td>
            <td data-label="Client"><div>${esc(c.client.nom)}</div><div class="sous">${esc(c.client.ville || '')}</div></td>
            <td class="sous" data-label="Livraison">${c.canal === 'magasin' ? 'En personne' : esc((TOUTES_LIVRAISONS[c.livraison] || { court: '' }).court)}</td>
            <td class="num" data-label="Articles">${c.lignes.reduce((a, l) => a + l.qte, 0)}</td><td class="num" data-label="Total">${euros(c.total)}${c.remise ? `<div class="sous">−${euros(c.remise)}</div>` : ''}</td><td data-label="Statut">${pill(c.statut)}${c.risque && c.risque.niveau === 'eleve' ? ' <span class="pill bad" title="Risque de fraude élevé">Risque</span>' : ''}${c.retour && c.retour.statut === 'demande' ? ' <span class="pill warn">Retour</span>' : ''}</td>
          </tr>`).join('')}
        </tbody></table></div>
        <div class="pagination"><span class="sous">${debut + 1}–${Math.min(debut + PAR_PAGE, liste.length)} sur ${liste.length.toLocaleString('fr-FR')}</span>
          <div class="rangee"><button class="btn petit fantome" data-action="page-cmd" data-d="-1" ${ui.pageCmd <= 1 ? 'disabled' : ''}>Précédente</button><span class="sous">Page ${ui.pageCmd} / ${pages}</span><button class="btn petit fantome" data-action="page-cmd" data-d="1" ${ui.pageCmd >= pages ? 'disabled' : ''}>Suivante</button></div></div>`
      : etatVide('commandes', filtresCmdActifs() ? 'Aucune commande ne correspond' : 'Pas encore de commande', filtresCmdActifs() ? 'Modifiez la recherche ou les filtres.' : 'Les commandes de votre boutique en ligne et de la caisse apparaîtront ici.')}
    </section>
    ${ouverte ? detailCommande(ouverte) : ''}
  </div>`;
}

/* Bon de préparation : une page par commande, articles à cocher, adresse. */
function bonsPreparation(ids) {
  const cs = ids.map(id => etat.commandes.find(c => c.id === id)).filter(Boolean);
  const imprimable = typeof SERVEUR !== 'undefined' && SERVEUR.actif;
  return `<div class="bons">${cs.map(c => `<article class="bon">
      <header><div><strong>${esc(etat.boutique.nom)}</strong><div class="sous">Bon de préparation</div></div><div class="num"><b class="mono">#${c.numero}</b><div class="sous">${new Date(c.date).toLocaleDateString('fr-FR')}</div></div></header>
      <div class="bon-adresse"><span class="sous">Livrer à</span><b>${esc(c.client.nom)}</b><span>${esc(c.client.adresse || '')}</span><span>${esc([c.client.npa, c.client.ville].filter(Boolean).join(' '))}</span><span class="sous">${c.canal === 'magasin' ? 'Vente en personne' : esc((TOUTES_LIVRAISONS[c.livraison] || { nom: '' }).nom)}</span></div>
      <table class="table compacte"><thead><tr><th></th><th>Article</th><th class="num">Qté</th></tr></thead><tbody>${c.lignes.map(l => `<tr><td class="col-case">☐</td><td>${esc(l.nom)}${(etat.produits.find(p => p.id === l.produitId) || {}).type === 'drop' ? ' <span class="sous">(expédié par le fournisseur)</span>' : ''}</td><td class="num">${l.qte}</td></tr>`).join('')}</tbody></table>
      ${(() => { const comp = etat.commandes.filter(x => x.parent === c.id && compteVentes(x)); return comp.length ? `<p><b>À joindre au même colis</b> (complément${comp.length > 1 ? 's' : ''} n° ${comp.map(x => x.numero).join(', ')}) :</p><table class="table compacte"><tbody>${comp.flatMap(x => x.lignes).map(l => `<tr><td class="col-case">☐</td><td>${esc(l.nom)}</td><td class="num">${l.qte}</td></tr>`).join('')}</tbody></table>` : ''; })()}
      ${c.note ? `<p class="sous">Note : ${esc(c.note)}</p>` : ''}
    </article>`).join('')}</div>
    <div class="rangee">${imprimable ? '<button class="btn" data-action="imprimer">Imprimer</button>' : '<span class="sous">L’impression est disponible dans l’application installée.</span>'}</div>`;
}

function filtresCmdActifs() { return !!(ui.recherche || ui.filtre !== 'tous' || (ui.periodeCmd && ui.periodeCmd !== 'tout') || (ui.canalCmd && ui.canalCmd !== 'tous')); }
/* Valeurs CSV lisibles par un Excel en français : virgule décimale, dates locales, texte entre guillemets. */
function csvMontant(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ','); }
function csvDate(t) { if (!t) return ''; const d = new Date(t), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; }
function csvTexte(v) { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;   // un nom « =HYPERLINK(...) » ne devient pas une formule dans Excel
  return `"${t.replace(/"/g, '""')}"`; }
/* Export pour la fiduciaire : une ligne par facture, et une ligne négative par avoir. */
/* Fermeture de la fiche d'une commande : le focus revient sur sa ligne dans la liste (clavier, lecteur d'écran). */
function fermerCommande() {
  const id = ui.commande; ui.commande = null; rendre();
  const ligne = id && document.querySelector(`tr[data-action="ouvrir-commande"][data-id="${CSS.escape(id)}"]`);
  if (ligne) ligne.focus();
}
function exporterCommandesCsv(liste) {
  const champs = ['document', 'date_document', 'commande', 'date_commande', 'statut', 'client', 'email', 'ville', 'canal', 'livraison', 'articles', 'remise', 'port', 'total_ht', 'tva', 'total_ttc', 'detail_tva', 'moyen', 'suivi', 'carte_cadeau', 'points_fidelite', 'devis'];
  const lignes = [];
  // Seulement des documents comptables : commandes facturées (les commandes en attente ou annulées n'ont pas de facture).
  for (const c of [...liste].filter(x => x.facture).sort((a, b) => (a.dateFacture || a.date) - (b.dateFacture || b.date))) {
    const t = tva(c);
    const base = (signe, doc, date) => [csvTexte(doc), csvTexte(csvDate(date)), String(c.numero), csvTexte(csvDate(c.date)), csvTexte(STATUTS[c.statut] ? STATUTS[c.statut].nom : c.statut), csvTexte(c.client.nom), csvTexte(c.client.email), csvTexte(c.client.ville), csvTexte(c.canal), csvTexte(c.livraison),
      csvTexte(c.lignes.map(l => `${l.qte}× ${l.nom}`).join(' | ')), csvMontant(signe * (c.remise || 0)), csvMontant(signe * (c.port || 0)), csvMontant(signe * t.ht), csvMontant(signe * t.tva), csvMontant(signe * t.ttc),
      csvTexte(t.parTaux.map(x => `${pctTva(x.taux)} : ${csvMontant(signe * x.tva)}`).join(' | ')), csvTexte(c.moyen || ''), csvTexte(c.suivi || ''),
      // Part payée par carte cadeau (moyen de paiement, à rapprocher de la caisse), points utilisés, devis d'origine.
      csvMontant(signe * (c.carteCadeau && !c.carteCadeau.liberee ? c.carteCadeau.montant || 0 : 0)), String(c.fidelite && c.fidelite.debite && !c.fidelite.liberee ? signe * c.fidelite.debite : 0), csvTexte(c.devis ? c.devis.numero : '')].join(';');
    lignes.push(base(1, c.facture || '', c.dateFacture || c.date));
    if (c.avoir) lignes.push(base(-1, c.avoir.numero, c.avoir.date));
    else if (c.statut === 'remboursee') lignes.push(base(-1, 'avoir à émettre', c.date));
  }
  telechargerTexte(`comptoir-commandes-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + champs.join(';') + '\n' + lignes.join('\n'), 'text/csv;charset=utf-8', `${liste.length} commande${liste.length > 1 ? 's' : ''} exportée${liste.length > 1 ? 's' : ''}.`);
}
function telechargerTexte(nom, contenu, type, message) {
  try {
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(message);
  } catch { toast('Téléchargement impossible dans cet aperçu. Il fonctionne dans l’application installée.'); }
}

/* Changement de statut groupé : seules les commandes pour qui l’étape est possible changent. */
async function changerStatutGroupe(ids, statut) {
  const possibles = ids.map(id => etat.commandes.find(c => c.id === id)).filter(c => c && fluxPour(c).some(([s]) => s === statut));
  if (!possibles.length) { toast('Aucune des commandes sélectionnées ne peut passer à cette étape.'); return; }
  if (typeof SERVEUR !== 'undefined' && SERVEUR.connecte) {
    // Expédition groupée : pas de numéro de suivi par colis ; le marchand le sait avant (les clients reçoivent un e-mail sans suivi).
    if (statut === 'expediee' && !confirm(`Marquer ${possibles.length} commande${possibles.length > 1 ? 's' : ''} comme expédiée${possibles.length > 1 ? 's' : ''}, sans numéro de suivi ? Les clients reçoivent l’e-mail d’expédition sans suivi. Pour ajouter un numéro, expédiez chaque commande depuis sa fiche.`)) return;
    // Réussites et refus comptés à part : on n'annonce pas un succès que le serveur a refusé.
    let ok = 0; const refus = [];
    for (const c of possibles) { try { await api('POST', `/api/admin/commandes/${encodeURIComponent(c.id)}/statut`, { statut }); ok++; } catch (e) { refus.push(`n° ${c.numero} : ${e.message}`); } }
    await rechargerEtat();
    ui.selection.clear();
    toast(`${ok} commande${ok > 1 ? 's' : ''} : ${STATUTS[statut].nom.toLowerCase()}.${refus.length ? ` Refusé : ${refus.slice(0, 2).join(' ; ')}${refus.length > 2 ? '…' : ''}` : ''}${possibles.length < ids.length ? ` ${ids.length - possibles.length} ignorée${ids.length - possibles.length > 1 ? 's' : ''}.` : ''}`);
    rendre(); return;
  } else for (const c of possibles) changerStatut(c.id, statut, { silencieux: true });
  sauver();
  ui.selection.clear();
  toast(`${possibles.length} commande${possibles.length > 1 ? 's' : ''} : ${STATUTS[statut].nom.toLowerCase()}${possibles.length < ids.length ? ` (${ids.length - possibles.length} ignorée${ids.length - possibles.length > 1 ? 's' : ''} : étape impossible)` : ''}.`);
  rendre();
}

function detailCommande(c) {
  return `<aside class="carte detail" aria-label="Commande ${c.numero}">
    <div class="carte-tete"><h2 class="mono">#${c.numero}</h2><button class="icone" data-action="fermer-commande" aria-label="Fermer">Fermer</button></div>
    <div class="rangee">${pill(c.statut)}<span class="sous">${dateHeure(c.date)}</span></div>
    <div class="bloc"><h3>${c.canal === 'magasin' ? 'Vente en boutique' : 'Livraison'}</h3><p>${c.canal === 'magasin' ? 'Encaissée au comptoir' : esc(TOUTES_LIVRAISONS[c.livraison].nom)}</p></div>
    ${estDropship(c) || c.refFournisseur ? `<div class="bloc encart-fournisseur"><h3>Dropshipping</h3><p>${[...new Set(c.lignes.map(l => (etat.produits.find(p => p.id === l.produitId) || {}).fournisseur).filter(Boolean))].map(esc).join(', ')}</p>
      <p class="sous">${c.refFournisseur ? 'Commande fournisseur <span class="mono">' + esc(c.refFournisseur) + '</span>' : 'Pas encore transmise'} · bénéfice estimé <b>${euros(beneficeCommande(c))}</b></p></div>` : `<div class="bloc"><h3>Bénéfice estimé</h3><p>${euros(beneficeCommande(c))}</p></div>`}
    <div class="bloc"><h3>Client</h3><p>${esc(c.client.nom)}<br><span class="sous">${esc(c.client.email)} · ${esc(c.client.ville)}</span></p></div>
    <div class="bloc"><h3>Articles</h3>
      <table class="table compacte"><tbody>${c.lignes.map(l => `<tr><td>${l.qte} ×</td><td>${esc(l.nom)}</td><td class="num">${euros(l.prix * l.qte)}</td></tr>`).join('')}
      <tr><td></td><td class="sous">Livraison</td><td class="num">${c.port ? euros(c.port) : 'Offerte'}</td></tr>
      <tr class="total"><td></td><td>Total</td><td class="num">${euros(c.total)}</td></tr>${c.canal === 'carte' && c.carteRetenue && !c.carteEmise ? `<tr><td></td><td colspan="2"><span class="alerte-texte">Carte cadeau retenue (risque élevé).</span> <button class="btn petit" data-action="liberer-carte" data-id="${esc(c.id)}">Libérer et envoyer la carte</button></td></tr>` : ''}${c.carteCadeau && c.carteCadeau.montant ? `<tr><td></td><td>Payé par carte cadeau ····${esc(c.carteCadeau.fin)}${c.carteCadeau.liberee ? ' (recrédité : paiement non terminé)' : c.carteCadeau.rendue ? ' (recrédité sur la carte)' : ''}</td><td class="num">${euros(c.carteCadeau.montant)}</td></tr><tr><td></td><td>${c.statut === 'attente' ? 'Reste à payer' : 'Payé autrement'}</td><td class="num">${euros(Math.max(0, c.total - c.carteCadeau.montant))}</td></tr>` : ''}</tbody></table>
    </div>
    ${c.suivi ? `<div class="bloc"><h3>Suivi ${esc(TOUTES_LIVRAISONS[c.livraison].transporteur || '')}</h3><p class="mono">${esc(c.suivi)}</p></div>` : ''}
    <div class="rangee">${c.facture ? `<button class="btn petit fantome" data-action="facture" data-id="${esc(c.id)}">Facture ${esc(c.facture)}</button>` : ''}${c.avoir ? `<button class="btn petit fantome" data-action="avoir" data-id="${esc(c.id)}">Avoir ${esc(c.avoir.numero)}</button>` : ''}${c.facture && typeof SERVEUR !== 'undefined' && SERVEUR.connecte ? `<button class="btn petit fantome" data-action="facture-xml" data-id="${esc(c.id)}" title="Facture électronique structurée (XML CII, norme européenne EN 16931, format de Factur-X) : pour votre logiciel comptable ou votre plateforme de facturation">XML EN 16931</button><button class="btn petit fantome" data-action="facture-xml" data-format="pdf" data-id="${esc(c.id)}" title="Facture Factur-X : PDF/A-3 lisible par votre client, avec le XML EN 16931 joint pour les logiciels comptables (format de la facture électronique en France)">PDF Factur-X</button>${c.avoir ? `<button class="btn petit fantome" data-action="facture-xml" data-id="${esc(c.id)}" data-avoir="1" title="Avoir au format XML EN 16931">Avoir XML</button><button class="btn petit fantome" data-action="facture-xml" data-format="pdf" data-id="${esc(c.id)}" data-avoir="1" title="Avoir Factur-X : PDF/A-3 avec le XML EN 16931 joint">Avoir Factur-X</button>` : ''}` : ''}${c.suivi && !estDropship(c) && TOUTES_LIVRAISONS[c.livraison].transporteur ? `<button class="btn petit fantome" data-action="etiquette" data-id="${c.id}">Étiquette d’envoi</button>` : ''}</div>
    ${(() => { const comp = etat.commandes.filter(x => x.parent === c.id && compteVentes(x)); return comp.length ? `<div class="bloc"><p class="encart">Complément${comp.length > 1 ? 's' : ''} payé${comp.length > 1 ? 's' : ''} à joindre au même colis : n° ${comp.map(x => x.numero).join(', ')}.</p></div>` : ''; })()}
    ${partieFournisseurATransmettre(c) ? `<div class="bloc"><p class="sous">Commande mixte : les articles du fournisseur ne lui sont pas encore transmis.</p><button class="btn petit" data-action="transmettre-partie" data-id="${c.id}">Transmettre la partie fournisseur</button></div>` : ''}
    ${c.retour ? `<div class="bloc encart ${c.retour.statut === 'demande' ? 'alerte-encart' : ''}" role="note"><span class="pill ${c.retour.statut === 'demande' ? 'warn' : 'good'}">${c.retour.statut === 'demande' ? 'Retour demandé' : 'Retour remboursé'}</span> <span class="sous">le ${new Date(c.retour.date).toLocaleDateString('fr-CH')} · ${euros(c.retour.montant)}</span>
      <ul class="sous">${c.retour.lignes.map(l => `<li>${l.qte} × ${esc(l.nom)}</li>`).join('')}</ul>${c.retour.motif ? `<p class="sous">Motif : ${esc(c.retour.motif)}</p>` : ''}
      ${c.retour.statut === 'demande' ? '<p class="sous">À réception des articles : retour de tous les articles, bouton « Rembourser » ; retour d’une partie, « Rembourser les articles retournés » (avoir partiel).</p>' : ''}</div>` : ''}
    ${c.risque && c.risque.niveau !== 'faible' ? `<div class="bloc encart ${c.risque.niveau === 'eleve' ? 'alerte-encart' : ''}" role="note"><span class="pill ${c.risque.niveau === 'eleve' ? 'bad' : 'warn'}">Risque ${c.risque.niveau === 'eleve' ? 'élevé' : 'moyen'} · ${c.risque.score}/100</span>
      <ul class="sous">${c.risque.raisons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="sous">${c.risque.niveau === 'eleve' ? 'Vérifiez avant d’expédier ou de transmettre au fournisseur : en cas de carte volée, le paiement est annulé par la banque des semaines plus tard (litige). Un e-mail ou un appel au client lève souvent le doute.' : 'Quelques signaux inhabituels : un coup d’œil suffit.'}</p></div>` : ''}
    ${c.moyen === 'facture' ? `<div class="bloc"><span class="pill info">Facture QR</span> <span class="sous">Référence ${esc(c.referenceQr || '')}${c.echeance ? ` · échéance ${new Date(c.echeance).toLocaleDateString('fr-CH')}` : ''}</span>${typeof SERVEUR !== 'undefined' && SERVEUR.connecte ? ` <a class="lien" href="/api/admin/commandes/${encodeURIComponent(c.id)}/facture-qr" target="_blank" rel="noopener">Voir la facture QR</a>` : ''}</div>` : ''}
    ${typeof blocRetoursPartiels === 'function' ? blocRetoursPartiels(c) : ''}
    <div class="bloc actions">${fluxPour(c).map(([s, nom], i) => `<button class="btn ${i ? 'fantome' : ''} ${s === 'annulee' || s === 'remboursee' ? 'danger' : ''}" data-action="statut" data-id="${c.id}" data-statut="${s}">${nom}</button>`).join('') || '<p class="sous">Aucune action possible : commande clôturée.</p>'}</div>
    <div class="bloc"><h3>Historique</h3><ol class="frise">${[...c.historique].reverse().map(h => `<li><span>${esc(h.texte)}</span><time>${dateHeure(h.date)}</time></li>`).join('')}</ol></div>
    <div class="bloc"><label for="note-${c.id}"><h3>Note interne</h3></label><textarea id="note-${c.id}" rows="2" data-champ="note" data-id="${c.id}" placeholder="Visible uniquement par vous">${esc(c.note)}</textarea></div>
  </aside>`;
}

function changerStatut(id, statut, { silencieux = false } = {}) {
  const c = etat.commandes.find(x => x.id === id);
  if (!c) return;
  c.statut = statut;
  if (statut === 'fournisseur') { transmettre(c, false); sauver(); rendre(); return; }
  if (statut === 'expediee' && !c.suivi) c.suivi = TOUTES_LIVRAISONS[c.livraison].transporteur === 'La Poste' ? '99.60.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7) : ({ relais: 'MR', chronopost: 'XY' }[c.livraison] || '6A') + Math.floor(1e10 + Math.random() * 9e10);
  if (statut === 'payee' && !c.facture) { c.facture = numeroFactureSuivant(etat, Date.now()); c.dateFacture = Date.now(); }
  if (statut === 'remboursee' && c.facture && !c.avoir) c.avoir = { numero: numeroFactureSuivant(etat, Date.now(), 'AV'), date: Date.now(), montant: c.total };
  if (statut === 'remboursee' || statut === 'annulee') {
    for (const l of c.lignes) { const p = etat.produits.find(x => x.id === l.produitId); if (p && p.type !== 'drop') { p.stock += typeof l.retireStock === 'number' ? l.retireStock : l.qte; l.retireStock = 0; } }
  }
  const textes = { payee: 'Paiement reçu', preparation: 'Préparation commencée', expediee: estDropship(c) ? `Expédiée par le fournisseur, suivi ${c.suivi} transmis au client` : `Expédiée, suivi ${c.suivi}`, livree: 'Livrée', remboursee: `Remboursée (${euros(c.total)}), avoir émis, stock remis`, annulee: 'Annulée, stock remis', prete: 'Prête à retirer, SMS envoyé au client (simulé)', retiree: 'Remise au client en boutique' };
  c.historique.push({ date: Date.now(), texte: textes[statut] });
  if (silencieux) return;
  sauver();
  toast(`Commande #${c.numero} : ${STATUTS[statut].nom.toLowerCase()}. Le client a reçu un e-mail (simulé).`);
  rendre();
}

/* ---------- Produits ---------- */
const FILTRES_PRODUITS = [['tous', 'Tous'], ['ligne', 'En ligne'], ['masque', 'Masqués'], ['drop', 'Dropshipping'], ['stock', 'Mon stock'], ['bas', 'Stock bas']];
const FILTRES_FN = { tous: () => true, ligne: p => p.actif && !p.aVerifier, masque: p => !p.actif || p.aVerifier, drop: p => p.type === 'drop', stock: p => p.type !== 'drop', bas: p => p.type !== 'drop' && p.stock <= 5 };
function produitsFiltres() {
  const q = (ui.rechercheProduit || '').trim().toLowerCase();
  return etat.produits.filter(FILTRES_FN[ui.filtreProduit || 'tous']).filter(p => !q || p.nom.toLowerCase().includes(q) || (p.categorie || '').toLowerCase().includes(q));
}
async function dupliquerProduit(id) {
  const p = etat.produits.find(x => x.id === id);
  const { id: _, historiquePrix, ...copie } = { ...p, nom: `${p.nom} (copie)`, actif: false, aVerifier: true };
  if (typeof SERVEUR !== 'undefined' && SERVEUR.connecte) { await api('POST', '/api/admin/produits', { produit: copie }); await rechargerEtat(); }
  else { etat.produits.push({ ...copie, id: nouvelId('p'), historiquePrix: [{ date: Date.now(), prix: copie.prix }] }); sauver(); }
  ui.produitEdite = { ...etat.produits[etat.produits.length - 1] };
  toast('Produit dupliqué, masqué en attendant votre vérification.');
  rendre();
}
function vueProduits() {
  const p = ui.produitEdite;
  const cats = SECTEURS[etat.boutique.secteur].categories;
  return `
  <div class="tete"><div><h1>Produits</h1><p class="sous">${etat.produits.length} produits · ${etat.produits.filter(x => x.actif && !x.aVerifier && (typeof SERVEUR === 'undefined' || SERVEUR.fournisseurDemoVendable !== false || x.codeFournisseur !== 'demo')).length} en ligne</p></div>
    <div class="rangee"><button class="btn fantome" data-action="reassort">Réassort</button><button class="btn fantome" data-action="lien-panier">Lien de panier</button><button class="btn fantome" data-action="photos">Ajouter par photo</button><button class="btn" data-action="nouveau-produit">Ajouter un produit</button></div>
    <input type="file" id="photo-input" accept="image/*" multiple hidden></div>
  <p class="astuce">Ajoutez des produits du <a class="lien" href="#sourcing">catalogue fournisseurs</a> (dropshipping) ou prenez vos propres produits en photo : Comptoir crée les fiches (nom, catégorie, prix conseillé, description). Vous n’avez plus qu’à vérifier.</p>
  ${ui.lienPanier && typeof vueLienPanier === 'function' ? vueLienPanier() : ''}
  ${ui.reassort && typeof vueReassort === 'function' ? vueReassort() : ''}
  <div class="barre-filtres">
    <input id="recherche-produits" type="search" placeholder="Rechercher un produit…" value="${esc(ui.rechercheProduit || '')}" data-champ="recherche-produit" aria-label="Rechercher un produit">
    <div class="segment" role="group" aria-label="Filtrer les produits">${FILTRES_PRODUITS.map(([k, n]) => `<button class="${(ui.filtreProduit || 'tous') === k ? 'actif' : ''}" data-action="filtre-produit" data-v="${k}">${n} <span class="sous">${etat.produits.filter(FILTRES_FN[k]).length}</span></button>`).join('')}</div>
  </div>
  <div class="maitre-detail ${p ? 'ouvert' : ''}">
    <section class="carte sans-pad"><div class="table-wrap"><table class="table table-cartes">
      <thead><tr><th></th><th>Produit</th><th>Approvisionnement</th><th class="num">Prix</th><th class="num">Marge nette</th><th class="num">Stock</th><th>Statut</th></tr></thead>
      <tbody>${produitsFiltres().map(x => `
        <tr data-action="editer-produit" data-id="${x.id}" tabindex="0" class="${p && p.id === x.id ? 'choisi' : ''}">
          <td class="vignette">${visuelProduit(x)}</td><td class="carte-titre" data-label="Produit">${esc(x.nom)}<div class="sous">${esc(x.categorie)}</div></td>
          <td data-label="Approvisionnement">${x.type === 'drop' ? `<span class="pill ${ENTREPOTS[x.entrepot] ? ENTREPOTS[x.entrepot].ton : 'info'}">Dropshipping ${x.entrepot || ''}</span>` : '<span class="pill muted">Mon stock</span>'}</td>
          <td class="num" data-label="Prix">${euros(x.prix)}</td>
          <td class="num ${margeProduit(x).nette < 0 ? 'neg' : ''}" data-label="Marge nette">${euros(margeProduit(x).nette)}</td>
          <td class="num" data-label="Stock">${x.type === 'drop' ? '<span class="sous" title="Stock géré par le fournisseur">—</span>' : x.stock <= 5 ? `<span class="stock-bas ${x.stock <= 0 ? 'rupture' : ''}" title="${x.stock <= 0 ? 'Rupture de stock' : 'Stock bas'}">${x.stock}</span>` : x.stock}${(n => n ? `<div class="sous" title="Clients qui attendent le retour en stock">${n} en attente</div>` : '')(Object.entries(etat.attentesStock || {}).filter(([k]) => k.startsWith(x.id + '|')).reduce((a, [, n]) => a + n, 0))}${(f => f && x.stock > 0 && f.jours <= 30 ? `<div class="sous" title="Au rythme des 28 derniers jours">≈ ${f.jours} j</div>` : '')(previsionStock(x))}</td>
          <td data-label="Statut">${x.aVerifier ? '<span class="pill warn">À vérifier</span>' : x.actif ? '<span class="pill good">En ligne</span>' : '<span class="pill muted">Masqué</span>'}</td></tr>`).join('')}
      </tbody></table></div>${produitsFiltres().length ? '' : etatVide('produits', etat.produits.length ? 'Aucun produit ne correspond' : 'Aucun produit', etat.produits.length ? 'Modifiez la recherche ou le filtre.' : 'Importez un produit du catalogue fournisseurs ou créez le vôtre.', '<a class="btn petit" href="#sourcing">Trouver des produits</a>')}</section>
    ${p ? `<aside class="carte detail"><form data-form="produit">
      <div class="carte-tete"><h2>${etat.produits.find(x => x.id === p.id) ? 'Modifier le produit' : 'Nouveau produit'}</h2><button type="button" class="icone" data-action="fermer-produit">Fermer</button></div>
      ${visuelProduit(p, true)}
      <div class="rangee"><button type="button" id="pf-photo-btn" class="btn petit fantome" data-action="choisir-photo">${p.image ? 'Changer la photo' : 'Ajouter une photo'}</button><input id="pf-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden>${p.image ? '<button type="button" class="btn petit fantome danger-doux" data-action="retirer-photo">Retirer la photo</button>' : ''}<span class="sous">JPEG, PNG ou WebP, réduite automatiquement.</span></div>
      <label class="champ"><span>Nom</span><input id="pf-nom" name="nom" required value="${esc(p.nom)}"></label>
      <label class="champ"><span>Description <button type="button" class="lien bouton-lien" data-action="rediger">Rédiger pour moi</button></span><textarea id="pf-desc" name="description" rows="4">${esc(p.description)}</textarea></label>
      <div class="deux"><label class="champ"><span>Prix TTC (${devise()})</span><input id="pf-prix" name="prix" type="number" min="0" step="0.01" required value="${p.prix}"></label>
      ${p.type === 'drop' ? '<input type="hidden" name="stock" value="999">' : aVariantesEdit(p) ? `<label class="champ"><span>Stock (somme des variantes)</span><input id="pf-stock" name="stock" type="number" readonly value="${p.variantes.reduce((a, v) => a + (Number(v.stock) || 0), 0)}"></label>` : `<label class="champ"><span>Stock</span><input id="pf-stock" name="stock" type="number" min="0" step="1" required value="${p.stock}"></label>`}</div>
      ${editeurVariantes(p)}
      ${p.type === 'drop' ? `<p class="sous">Fournisseur : ${esc(p.fournisseur || '—')} · entrepôt ${ENTREPOTS[p.entrepot] ? ENTREPOTS[p.entrepot].nom : '—'} · ${p.delai ? p.delai[0] + '–' + p.delai[1] + ' jours' : ''}</p>
      <label class="champ"><span>Coût fournisseur (${devise()})</span><input id="pf-cout" name="cout" type="number" min="0" step="0.01" value="${p.cout}"></label>`
      : `<label class="champ"><span>Coût d’achat unitaire (${devise()})</span><input id="pf-cout" name="cout" type="number" min="0" step="0.01" value="${p.cout ?? ''}" placeholder="Pour calculer votre marge"></label>`}
      ${blocMarge(p)}
      <label class="champ"><span>Prix barré (facultatif, ${devise()})</span><input id="pf-ref" name="prixReference" type="number" min="0" step="0.01" value="${p.prixReference ?? ''}" placeholder="Prix avant réduction" data-prix-ref></label>
      <div id="verdict-ref">${verdictPrixBarre(p)}</div>
      <label class="champ"><span>Catégorie</span><select id="pf-cat" name="categorie">${[...new Set([p.categorie, ...cats])].map(c => `<option ${c === p.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="case"><input id="pf-actif" type="checkbox" name="actif" ${p.actif ? 'checked' : ''}> Visible dans la boutique</label>
      <label class="case"><input id="pf-taux" type="checkbox" name="tauxReduit" ${p.tauxReduit ? 'checked' : ''}> TVA à taux réduit (denrées alimentaires : ${estSuisse() ? '2,6 %' : etat.boutique.pays === 'be' ? '6 %' : '5,5 %'})</label>
      <div class="rangee"><button class="btn">Enregistrer</button>${etat.produits.find(x => x.id === p.id) ? `<button type="button" class="btn fantome" data-action="dupliquer-produit" data-id="${p.id}">Dupliquer</button>` : ''}${etat.produits.find(x => x.id === p.id) ? `<button type="button" class="btn fantome danger" data-action="supprimer-produit" data-id="${p.id}">Supprimer</button>` : ''}</div>
    </form></aside>` : ''}
  </div>`;
}

/* ---------- Clients ---------- */
/* Clients regroupés par e-mail (ou nom pour les ventes en personne sans e-mail). */
function listeClients() {
  const par = {};
  for (const c of etat.commandes) {
    if (c.canal === 'magasin' && !c.client.email) continue;
    if (!c.client.email && c.client.nom === 'Client effacé') continue;   // données effacées à la demande du client
    const k = (c.client.email || c.client.nom).toLowerCase();
    const x = par[k] = par[k] || { cle: k, nom: c.client.nom, email: c.client.email, ville: c.client.ville, commandes: [], total: 0, premiere: Infinity, derniere: 0, consentement: false };
    x.commandes.push(c);
    if (compteVentes(c)) { x.total += c.total; x.premiere = Math.min(x.premiere, c.date); x.derniere = Math.max(x.derniere, c.date); }
    if (c.client.consentement) x.consentement = true;
  }
  // Un client est quelqu'un qui a acheté : une commande seulement annulée ou impayée ne compte pas.
  // Une adresse désinscrite n'accepte plus les e-mails, quel que soit son accord d'origine.
  const desinscrits = new Set((etat.desinscrits || []).map(e => String(e).toLowerCase()));
  const l = Object.values(par).filter(x => x.commandes.some(compteVentes));
  for (const x of l) if (x.email && desinscrits.has(x.email.toLowerCase())) x.consentement = false;
  const seuilTop = [...l].sort((a, b) => b.total - a.total)[Math.max(0, Math.floor(l.length * 0.1) - 1)];
  for (const x of l) {
    x.n = x.commandes.filter(compteVentes).length;
    x.panier = x.n ? x.total / x.n : 0;
    x.segments = [];
    if (Date.now() - x.premiere < 30 * JOUR) x.segments.push('nouveaux');
    if (x.n >= 2) x.segments.push('fideles');
    if (seuilTop && x.total >= seuilTop.total && x.total > 0) x.segments.push('meilleurs');
    if (Date.now() - x.derniere > 90 * JOUR) x.segments.push('inactifs');
    if (x.consentement) x.segments.push('abonnes');
  }
  return l;
}
const SEGMENTS = [['tous', 'Tous'], ['meilleurs', 'Meilleurs clients'], ['fideles', 'Fidèles'], ['nouveaux', 'Nouveaux (30 j)'], ['inactifs', 'Inactifs (90 j)'], ['abonnes', 'Acceptent les e-mails']];

function vueClients() {
  const tous = listeClients();
  const seg = ui.segment || 'tous';
  const q = (ui.rechercheClient || '').trim().toLowerCase();
  const liste = tous.filter(c => seg === 'tous' || c.segments.includes(seg))
    .filter(c => !q || c.nom.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.ville || '').toLowerCase().includes(q))
    .sort((a, b) => b.total - a.total);
  const pages = Math.max(1, Math.ceil(liste.length / PAR_PAGE));
  ui.pageClient = Math.min(ui.pageClient || 1, pages);
  const debut = (ui.pageClient - 1) * PAR_PAGE;
  const ouvert = tous.find(c => c.cle === ui.client);
  const fideles = tous.filter(c => c.n > 1).length;
  const ca = tous.reduce((a, c) => a + c.total, 0);
  return `
  <div class="tete"><div><h1>Clients</h1><p class="sous">${tous.length.toLocaleString('fr-FR')} clients · ${fideles} ont commandé plusieurs fois · valeur moyenne ${euros(tous.length ? ca / tous.length : 0)}</p></div>
    <div class="rangee"><button class="btn fantome" data-action="export-clients" data-filtre="1">Exporter CSV</button></div></div>
  ${typeof carteFidelite === 'function' ? carteFidelite() : ''}
  <div class="onglets onglets-defilants" role="tablist" aria-label="Segments">${SEGMENTS.map(([k, n]) => `<button role="tab" aria-selected="${seg === k}" class="${seg === k ? 'actif' : ''}" data-action="segment" data-v="${k}">${n} <span>${k === 'tous' ? tous.length : tous.filter(c => c.segments.includes(k)).length}</span></button>`).join('')}</div>
  <div class="barre-filtres"><input id="recherche-clients" type="search" placeholder="Rechercher un nom, un e-mail, une ville…" value="${esc(ui.rechercheClient || '')}" data-champ="recherche-client" aria-label="Rechercher un client"></div>
  <div class="maitre-detail ${ouvert ? 'ouvert' : ''}">
    <section class="carte sans-pad">
      ${liste.length ? `<div class="table-wrap"><table class="table table-cartes">
        <thead><tr><th>Client</th><th>Ville</th><th class="num">Commandes</th><th class="num">Total dépensé</th><th class="num">Panier moyen</th><th>Dernière commande</th></tr></thead>
        <tbody>${liste.slice(debut, debut + PAR_PAGE).map(c => `<tr data-action="ouvrir-client" data-id="${esc(c.cle)}" tabindex="0" class="${c.cle === ui.client ? 'choisi' : ''}">
          <td data-label="Client"><div>${esc(c.nom)}${c.segments.includes('meilleurs') ? ' <span class="tag">Top 10 %</span>' : ''}</div><div class="sous">${esc(c.email || 'Sans e-mail')}</div></td>
          <td data-label="Ville">${esc(c.ville || '—')}</td><td data-label="Commandes" class="num">${c.n}${c.n === 0 ? `<div class="sous">${c.commandes.some(x => x.statut === 'remboursee') ? 'remboursée' : c.commandes.some(x => x.statut === 'attente') ? 'non payée' : 'annulée'}</div>` : ''}</td><td data-label="Total" class="num">${c.n ? euros(c.total) : '—'}</td><td data-label="Panier moyen" class="num">${c.n ? euros(c.panier) : '—'}</td>
          <td data-label="Dernière">${dateCourte(c.derniere)}${c.segments.includes('inactifs') ? '<div class="sous">inactif</div>' : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      ${pages > 1 ? `<div class="pagination"><span class="sous">${debut + 1}–${Math.min(debut + PAR_PAGE, liste.length)} sur ${liste.length}</span><div class="rangee"><button class="btn petit fantome" data-action="page-client" data-d="-1" ${ui.pageClient <= 1 ? 'disabled' : ''}>Précédente</button><span class="sous">Page ${ui.pageClient} / ${pages}</span><button class="btn petit fantome" data-action="page-client" data-d="1" ${ui.pageClient >= pages ? 'disabled' : ''}>Suivante</button></div></div>` : ''}`
      : etatVide('clients', tous.length ? 'Aucun client ne correspond' : 'Pas encore de client', tous.length ? 'Modifiez la recherche ou le segment.' : 'Vos clients apparaîtront ici dès la première commande.')}
    </section>
    ${ouvert ? ficheClient(ouvert) : ''}
  </div>`;
}

/* Export (droit d'accès) et effacement (droit à l'effacement) des données d'un client. */
function telechargerJson(nom, donnees) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }));
  a.download = nom; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function exporterClient(email) {
  const cle = email.toLowerCase();
  try {
    const donnees = connecteAuServeur() ? await api('GET', `/api/admin/clients/export?email=${encodeURIComponent(email)}`)
      : { exporteLe: new Date().toISOString(), boutique: etat.boutique.nom, email, commandes: etat.commandes.filter(c => (c.client.email || '').toLowerCase() === cle).map(c => ({ numero: c.numero, date: new Date(c.date).toISOString(), statut: c.statut, client: c.client, lignes: c.lignes.map(l => ({ nom: l.nom, qte: l.qte, prix: l.prix })), total: c.total })) };
    telechargerJson(`donnees-client-${cle.replace(/[^a-z0-9]+/g, '-')}.json`, donnees);
    toast('Export téléchargé : transmettez-le au client.');
  } catch (e) { toast(e.message); }
}
async function effacerClient(email) {
  if (ui.confirmerEffacer !== email) { ui.confirmerEffacer = email; rendre(); setTimeout(() => { if (ui.confirmerEffacer === email) { ui.confirmerEffacer = null; rendre(); } }, 5000); return; }
  ui.confirmerEffacer = null;
  const cle = email.toLowerCase();
  try {
    if (connecteAuServeur()) { await api('POST', '/api/admin/clients/effacer', { email }); location.reload(); return; }
    const ouverte = etat.commandes.find(c => (c.client.email || '').toLowerCase() === cle && ['attente', 'payee', 'preparation', 'fournisseur', 'prete'].includes(c.statut));
    if (ouverte) { toast(`Commande n° ${ouverte.numero} encore en cours : effacez les données une fois qu’elle est expédiée.`); rendre(); return; }
    for (const c of etat.commandes) if ((c.client.email || '').toLowerCase() === cle) { c.client = { nom: 'Client effacé', email: '', adresse: '', npa: '', ville: '', consentement: null }; (c.historique = c.historique || []).push({ date: Date.now(), texte: 'Données personnelles du client effacées à sa demande' }); }
    ui.client = null; sauver(); toast('Données du client effacées.'); rendre();
  } catch (e) { toast(e.message); rendre(); }
}

function ficheClient(c) {
  const segs = { meilleurs: 'Meilleur client', fideles: 'Fidèle', nouveaux: 'Nouveau', inactifs: 'Inactif', abonnes: 'Accepte les e-mails' };
  const delai = c.n > 1 ? (c.derniere - c.premiere) / JOUR / (c.n - 1) : null;
  return `<aside class="carte detail" aria-label="Fiche client ${esc(c.nom)}">
    <div class="carte-tete"><h2>${esc(c.nom)}</h2><button class="icone" data-action="fermer-client">Fermer</button></div>
    <div class="rangee">${c.segments.map(s => `<span class="pill ${s === 'inactifs' ? 'muted' : s === 'meilleurs' ? 'good' : 'info'}">${segs[s]}</span>`).join('') || '<span class="sous">Aucun segment</span>'}</div>
    <div class="bloc"><h3>Contact</h3><p>${c.email ? `<span class="mono">${esc(c.email)}</span> <button class="bouton-lien" data-action="copier" data-texte="${esc(c.email)}">Copier</button>` : 'Pas d’e-mail (vente en personne)'}<br><span class="sous">${esc(c.ville || '')}</span></p>
      <p class="sous">${c.consentement ? 'A accepté les e-mails marketing.' : 'N’a pas accepté les e-mails marketing : seuls les e-mails liés à ses commandes lui sont envoyés.'}</p></div>
    <div class="chiffres">
      <div><span class="sous">Total dépensé</span><strong>${euros(c.total)}</strong></div>
      <div><span class="sous">Commandes</span><strong>${c.n}</strong></div>
      <div><span class="sous">Panier moyen</span><strong>${euros(c.panier)}</strong></div>
    </div>
    <p class="sous">Client depuis le ${new Date(c.premiere).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${delai ? ` · une commande tous les ${Math.round(delai)} jours en moyenne` : ''}.</p>
    ${c.email ? `<div class="bloc"><h3>Données personnelles</h3><p class="sous">À la demande du client (droit d’accès et d’effacement) : l’export contient ses commandes et ses avis ; l’effacement anonymise ses commandes, garde les montants pour la comptabilité et le retire de la newsletter.</p>
      <div class="rangee"><button id="exp-client" class="btn petit fantome" data-action="exporter-client" data-email="${esc(c.email)}">Exporter ses données</button><button id="eff-client" class="btn petit fantome danger-doux" data-action="effacer-client" data-email="${esc(c.email)}">${ui.confirmerEffacer === c.email ? 'Confirmer l’effacement' : 'Effacer ses données'}</button></div></div>` : ''}
    <div class="bloc"><h3>Commandes</h3><table class="table compacte"><tbody>${[...c.commandes].sort((a, b) => b.date - a.date).map(o => `<tr data-action="ouvrir-commande" data-id="${o.id}" tabindex="0"><td class="mono">#${o.numero}</td><td class="sous">${dateCourte(o.date)}</td><td class="num">${euros(o.total)}</td><td>${pill(o.statut)}</td></tr>`).join('')}</tbody></table></div>
  </aside>`;
}

/* Écran Clients : la liste affichée (segment et recherche du moment) ; Paramètres › Données : tous les clients. */
function clientsFiltres() {
  const seg = ui.segment || 'tous', q = (ui.rechercheClient || '').trim().toLowerCase();
  return listeClients().filter(c => seg === 'tous' || c.segments.includes(seg))
    .filter(c => !q || c.nom.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.ville || '').toLowerCase().includes(q))
    .sort((a, b) => b.total - a.total);
}
function exporterClientsCsv(l = listeClients()) {
  const lignes = l.map(c => [csvTexte(c.nom), csvTexte(c.email || ''), csvTexte(c.ville || ''), String(c.n), csvMontant(c.total), csvMontant(c.panier), csvTexte(csvDate(c.premiere).slice(0, 10)), csvTexte(csvDate(c.derniere).slice(0, 10)), csvTexte(c.consentement ? 'oui' : 'non')].join(';'));
  telechargerTexte(`comptoir-clients-${new Date().toISOString().slice(0, 10)}.csv`, '﻿nom;email;ville;commandes;total;panier_moyen;premiere_commande;derniere_commande;accepte_emails\n' + lignes.join('\n'), 'text/csv;charset=utf-8', `${l.length} clients exportés.`);
}

/* ---------- Éditeur ---------- */
function vueEditeur() {
  const b = etat.boutique;
  const onglets = [['sections', 'Sections'], ['style', 'Style'], ['infos', 'Infos']];
  let panneau = '';
  if (ui.ongletEditeur === 'sections') {
    panneau = `<ol class="liste-sections">${b.sections.map((s, i) => `
      <li class="${ui.section === s.id ? 'ouvert' : ''}">
        <div class="ls-tete">
          <button class="ls-nom" data-action="choisir-section" data-id="${s.id}" aria-expanded="${ui.section === s.id}">${esc(TYPES_SECTIONS[s.type].nom)}</button>
          <button class="icone ls-btn" data-action="monter" data-id="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Monter" title="Monter"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg></button>
          <button class="icone ls-btn" data-action="descendre" data-id="${s.id}" ${i === b.sections.length - 1 ? 'disabled' : ''} aria-label="Descendre" title="Descendre"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
          <button class="icone ls-btn danger-doux" data-action="supprimer-section" data-id="${s.id}" aria-label="Supprimer la section" title="Supprimer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
        </div>
        ${ui.section === s.id ? champsSection(s) : ''}
      </li>`).join('')}</ol>
      <div class="ajout"><label for="type-ajout" class="sous">Ajouter une section</label>
        <div class="rangee"><select id="type-ajout">${Object.entries(TYPES_SECTIONS).map(([k, v]) => `<option value="${k}">${esc(v.nom)}</option>`).join('')}</select>
        <button class="btn" data-action="ajouter-section">Ajouter</button></div></div>`;
  } else if (ui.ongletEditeur === 'style') {
    const t = b.theme;
    panneau = `<div class="themes">${Object.entries(THEMES).map(([id, th]) => `
        <button class="theme-choix ${t.id === id ? 'actif' : ''}" data-action="theme" data-id="${id}" data-vars="--ap-bg:${esc(th.bg)};--ap-text:${esc(th.text)};--ap-r:${Math.min(Number(th.radius) || 0, 12)}px;--ap-font:${esc(th.font)};--ap-primary:${esc(th.primary)}">
          <span class="ap-titre">${th.nom}</span><i class="ap-pastille"></i></button>`).join('')}</div>
      <div class="deux">
        <label class="champ"><span>Couleur principale</span><input id="st-primary" type="color" value="${t.primary}" data-theme="primary"></label>
        <label class="champ"><span>Fond</span><input id="st-bg" type="color" value="${t.bg}" data-theme="bg"></label>
        <label class="champ"><span>Texte</span><input id="st-text" type="color" value="${t.text}" data-theme="text"></label>
        <label class="champ"><span>Cartes</span><input id="st-surface" type="color" value="${t.surface}" data-theme="surface"></label>
      </div>
      ${avisContraste(t)}
      <label class="champ"><span>Police des titres</span><select id="st-font" data-theme="font">${POLICES.map(([v, n]) => `<option value="${esc(v)}" ${t.font === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="champ"><span>Arrondi des angles : <b id="rayon-val">${t.radius}</b> px</span><input id="st-radius" type="range" min="0" max="24" value="${t.radius}" data-theme="radius"></label>`;
  } else {
    panneau = `<label class="champ"><span>Nom de la boutique</span><input id="in-nom" value="${esc(b.nom)}" data-boutique="nom"></label>
      <label class="champ"><span>Slogan</span><input id="in-slogan" value="${esc(b.slogan)}" data-boutique="slogan"></label>
      <label class="champ"><span>Secteur</span><select id="in-secteur" data-boutique="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${b.secteur === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
      <fieldset class="champ"><legend>Langues de la boutique</legend><div class="rangee">${[['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['en', 'English']].map(([k, n]) => `<label class="case"><input type="checkbox" data-langue="${k}" ${b.langues.includes(k) ? 'checked' : ''} ${k === 'fr' ? 'disabled' : ''}> ${n}</label>`).join('')}</div>
      <p class="sous">Vos clients voient la boutique dans leur langue (selon leur navigateur, avec un choix de langue en haut de page) : boutons, panier, commande, paiement et suivi. Vos textes, noms et descriptions de produits restent tels que vous les écrivez ; les conditions générales restent en français, version qui fait foi.</p>
        <span class="sous">Traduction automatique des pages et fiches produits (simulée), relisible avant publication.</span></fieldset>
      <div class="bloc"><h3>Adresse</h3><p class="mono">${esc(adresseBoutique())}</p><a href="#domaines" class="lien">Changer de domaine</a></div>`;
  }
  return `
  <div class="tete"><div><h1>Éditeur du site</h1><p class="sous">Choisissez une section à modifier (dans l’aperçu ou la liste) ; l’aperçu montre le résultat.</p></div>
    <div class="rangee">
      <div class="segment" role="group" aria-label="Appareil">
        <button class="${ui.appareil === 'ordinateur' ? 'actif' : ''}" data-action="appareil" data-id="ordinateur">Ordinateur</button>
        <button class="${ui.appareil === 'mobile' ? 'actif' : ''}" data-action="appareil" data-id="mobile">Mobile</button>
      </div>
      ${connecteAuServeur() ? '<span class="etat-publication" title="Chaque modification est enregistrée et visible par vos clients aussitôt.">✓ Enregistré, en ligne</span>' : b.modifie ? '<button class="btn" data-action="publier">Publier les modifications</button>' : '<span class="etat-publication">✓ En ligne, à jour</span>'}
    </div></div>
  <div class="segment bascule-editeur" role="group" aria-label="Affichage de l’éditeur">
    <button class="${ui.vueEdMobile !== 'apercu' ? 'actif' : ''}" data-action="vue-ed-mobile" data-id="modifier">Modifier</button>
    <button class="${ui.vueEdMobile === 'apercu' ? 'actif' : ''}" data-action="vue-ed-mobile" data-id="apercu">Aperçu</button>
  </div>
  <div class="editeur ${ui.vueEdMobile === 'apercu' ? 'mobile-apercu' : 'mobile-modifier'}">
    <aside class="carte panneau">
      <div class="onglets plein">${onglets.map(([id, n]) => `<button class="${ui.ongletEditeur === id ? 'actif' : ''}" data-action="onglet-editeur" data-id="${id}">${n}</button>`).join('')}</div>
      <div class="panneau-corps">${panneau}</div>
    </aside>
    <div class="scene"><div class="appareil ${ui.appareil}"><div class="barre-url"><span></span><span></span><span></span><em class="mono">${esc(adresseBoutique())}</em></div><div id="apercu"></div></div></div>
  </div>`;
}

function champsSection(s) {
  const cats = SECTEURS[etat.boutique.secteur].categories;
  return `<div class="ls-champs">${TYPES_SECTIONS[s.type].champs.map(([cle, label, type]) => {
    const id = `f-${s.id}-${cle}`;
    const v = s.props[cle] ?? '';
    let input;
    if (type === 'textarea') input = `<textarea id="${id}" rows="2" data-prop="${cle}" data-id="${s.id}">${esc(v)}</textarea>`;
    else if (type.startsWith('select:')) input = `<select id="${id}" data-prop="${cle}" data-id="${s.id}">${type.slice(7).split(',').map(o => `<option ${o === String(v) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (type === 'categorie') input = `<select id="${id}" data-prop="${cle}" data-id="${s.id}"><option value="">Toutes</option>${cats.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else input = `<input id="${id}" value="${esc(v)}" data-prop="${cle}" data-id="${s.id}">`;
    return `<label class="champ" for="${id}"><span>${label}</span>${input}</label>`;
  }).join('')}</div>`;
}

function rendreApercu() {
  const a = $('#apercu');
  if (a) a.innerHTML = renduBoutique(etat, { mode: 'edition', selection: ui.section });
}
function modifie() { if (connecteAuServeur()) { sauver(); return; }   // mode connecté : enregistré et en ligne aussitôt, pas de brouillon
  etat.boutique.modifie = true; sauver(); const b = document.querySelector('[data-action="publier"]'); if (b) b.textContent = 'Publier les modifications'; else { const e = document.querySelector('.etat-publication'); if (e) e.outerHTML = '<button class="btn" data-action="publier">Publier les modifications</button>'; } }

/* ---------- Domaines ---------- */
function vueDomaines() {
  const b = etat.boutique;
  const marque = ui.dom.marque ?? b.nom;
  const res = suggererDomaines({ marque, secteurId: b.secteur, motsCles: ui.dom.motsCles.split(','), pays: b.pays, mois: ui.dom.mois, etat });
  const secteur = SECTEURS[b.secteur];
  const courbe = secteur.courbe.map((v, i) => ({ label: MOIS[i], v, tip: `${MOIS_LONG[i]} : indice ${v} · ${saisonDuMois(i).nom}` }));
  const ligne = r => `
    <tr class="${r.disponible ? '' : 'indispo'}">
      <td><div class="mono dom">${esc(r.domaine)}</div><div class="sous">${esc(r.raisons.slice(0, 2).join(' · '))}</div></td>
      <td><span class="tag">${esc(r.genre)}</span></td>
      <td><div class="score"><div class="score-barre"><i data-largeur="${r.score}"></i></div><b>${r.score}</b></div></td>
      <td>${connecteAuServeur() ? `<span class="pill muted" data-dispo="${esc(r.domaine)}">À vérifier</span> <button class="btn petit fantome" data-srv="dispo" data-d="${esc(r.domaine)}">Vérifier</button>` : r.disponible ? '<span class="pill good">Disponible</span>' : r.prime ? '<span class="pill warn">Premium</span>' : '<span class="pill muted">Déjà pris</span>'}</td>
      <td class="num">${connecteAuServeur() ? `≈ ${euros(EXTENSIONS[r.ext] ? EXTENSIONS[r.ext].prix : r.prix)}<div class="sous">1re année, puis ≈ ${euros(EXTENSIONS[r.ext] ? EXTENSIONS[r.ext].renouv : r.renouv)}/an (indicatif)</div>` : r.disponible || r.prime ? euros(r.prix) + '<div class="sous">puis ' + euros(r.renouv) + '/an</div>' : '—'}</td>
      <td>${r.disponible || connecteAuServeur() ? `<button class="btn petit fantome" data-action="choisir-domaine" data-domaine="${esc(r.domaine)}" data-prix="${r.prix}" data-genre="${esc(r.genre)}">${b.domaine && b.domaine.domaine === r.domaine ? 'Choisi' : 'Choisir'}</button>` : ''}</td>
    </tr>`;
  const reco = (r, titre, texte) => r ? `<div class="reco"><span class="eyebrow">${titre}</span><div class="mono dom grand">${esc(r.domaine)}</div>
      <div class="detail-score">${Object.entries({ Demande: r.detail.demande, Saison: r.detail.saison, Brièveté: r.detail.court, Mémorisation: r.detail.memo, Extension: r.detail.extension }).map(([k, v]) => `<div><span>${k}</span><div class="score-barre"><i data-largeur="${v}"></i></div><b>${v}</b></div>`).join('')}</div>
      <p class="sous">${texte}</p>
      <button class="btn" data-action="choisir-domaine" data-domaine="${esc(r.domaine)}" data-prix="${r.prix}" data-genre="${esc(r.genre)}">${connecteAuServeur() ? 'Choisir ce nom' : `Réserver pour ${euros(r.prix)}`}</button></div>` : '';
  return `
  <div class="tete"><div><h1>Domaines</h1><p class="sous">Suggestions calculées à partir de la demande du marché, des ventes de vos clients et de la saison.</p></div></div>
  <section class="carte filtres-domaine">
    <label class="champ"><span>Nom de marque</span><input id="dom-marque" value="${esc(marque)}" data-champ="dom-marque"></label>
    <label class="champ"><span>Mots-clés en plus (séparés par des virgules)</span><input id="dom-kw" value="${esc(ui.dom.motsCles)}" placeholder="ex. artisanal, vegan" data-champ="dom-kw"></label>
    <label class="champ"><span>Simuler le mois</span><select id="dom-mois" data-champ="dom-mois">${MOIS_LONG.map((m, i) => `<option value="${i}" ${i === ui.dom.mois ? 'selected' : ''}>${m}${i === new Date().getMonth() ? ' (actuel)' : ''}</option>`).join('')}</select></label>
    <label class="champ"><span>Pays principal</span><select id="dom-pays" data-boutique-dom="pays">${[['fr', 'France'], ['be', 'Belgique'], ['ch', 'Suisse'], ['ca', 'Canada']].map(([k, v]) => `<option value="${k}" ${b.pays === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  </section>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Demande « ${esc(secteur.nom)} » sur l’année</h2><span class="sous">Indice saisonnier, 100 = mois moyen</span></div>
      <div class="graph-wrap">${graphBarres(courbe, { surligne: ui.dom.mois, labelsTous: true, hauteur: 170 })}</div>
      <p class="sous">${MOIS_LONG[ui.dom.mois][0].toUpperCase() + MOIS_LONG[ui.dom.mois].slice(1)} : ${esc(res.saison.nom)}. ${esc(res.saison.conseil)}</p>
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>Ce que vos clients achètent</h2><span class="sous">Part du CA, 90 jours</span></div>
      ${res.signal.length ? `<ul class="parts">${res.signal.map(s => `<li><span>${esc(s.cat)}</span><div class="score-barre"><i data-largeur="${Math.round(s.part * 100)}"></i></div><b>${Math.round(s.part * 100)} %</b></li>`).join('')}</ul>
      <p class="sous">Les mots-clés liés à vos meilleures catégories reçoivent un bonus : ${res.topKws.map(k => `« ${esc(k.kw)} »`).join(', ')}.</p>`
      : '<p class="sous">Pas encore de ventes : les suggestions s’appuient sur la demande du marché. Le signal clients apparaîtra avec vos premières commandes.</p>'}
    </section>
  </div>
  <div class="recos">
    ${reco(res.principal, 'Domaine principal recommandé', 'À garder toute l’année : c’est l’adresse de votre boutique.')}
    ${reco(res.campagne, 'Domaine de campagne', `Redirigé vers votre boutique le temps de « ${esc(res.campagne ? res.campagne.saison.nom : '')} » : utile pour la publicité et les réseaux sociaux.`)}
  </div>
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>Toutes les suggestions</h2><span class="sous">${connecteAuServeur() ? `${res.resultats.length} suggestions` : `${res.resultats.filter(r => r.disponible).length} disponibles sur ${res.resultats.length}`}</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Domaine</th><th>Type</th><th>Score</th><th>Disponibilité</th><th class="num">Première année</th><th></th></tr></thead>
    <tbody>${res.resultats.map(ligne).join('')}</tbody></table></div>
  </section>
  <p class="note">${connecteAuServeur() ? 'Volumes de recherche estimés. « Vérifier » interroge le registre officiel du domaine (RDAP) ; les prix sont indicatifs : la réservation se fait chez le registrar de votre choix.' : 'Démo : volumes de recherche, disponibilité et prix sont simulés. En production, ils viennent de l’API d’un registrar et de Google Trends.'}</p>`;
}

/* ---------- Boutique en ligne (vue client) ---------- */
/* Verdict sur le prix barré : affiché seulement s’il respecte la règle suisse (OIP) ou européenne (Omnibus). */
function verdictPrixBarre(p) {
  if (!p.prixReference) return '<p class="sous">Laissez vide s’il n’y a pas de réduction. Comptoir n’affiche un prix barré que s’il est licite.</p>';
  const v = PrixBarres.verifier(p, estSuisse() ? 'ch' : 'ue');
  return v.ok ? `<p class="encart"><span class="pill good">Affiché</span> ${esc(v.regle)}.</p>` : `<p class="encart alerte-encart"><span class="pill warn">Non affiché</span> ${esc(v.raison)}</p>`;
}

function vueBoutique() {
  etatConversion();
  if (!etat.avis && !connecteServeur()) semerAvis();
  const notes = statsAvisProduits();
  etat.produits.forEach(p => { p.avis = notes[p.id] || null; });
  etat.avisRecents = (etat.avis || []).filter(a => a.texte).slice(0, 6);
  etat.produits.forEach(p => { p.prixBarre = p.prixReference && PrixBarres.verifier(p, estSuisse() ? 'ch' : 'ue').ok ? p.prixReference : undefined; });
  const calc = Remises.appliquer(ui.panier, etatVente(), ui.codePromo || '');   // comme la vraie boutique : selon la formule
  const total = calc.apresRemise;
  const modes = Object.entries(livraisonsPays(etat.boutique.pays)).filter(([k]) => k !== 'retrait' || retraitPossible());
  if (!modes.find(([k]) => k === ui.livraison)) ui.livraison = modes[0][0];
  const delaisDrop = ui.panier.map(l => etat.produits.find(p => p.id === l.produitId)).filter(p => p && p.type === 'drop' && p.delai);
  const delaiMax = delaisDrop.length ? [Math.max(...delaisDrop.map(p => p.delai[0])), Math.max(...delaisDrop.map(p => p.delai[1]))] : null;
  const ch = etat.boutique.pays === 'ch';
  const port = total ? fraisPort(ui.livraison, total) : 0;
  return `
  <div class="bandeau-client"><span>Vous voyez <b class="mono">${esc(adresseBoutique())}</b> comme un client. Passez une commande : elle apparaîtra dans l’admin.</span><a href="#tableau" class="btn petit">Retour à l’admin</a></div>
  <div class="boutique-live">${renduBoutique(etat, { mode: 'live', panier: ui.panier, fiche: ui.fiche })}</div>
  ${etat.cookies ? '' : `<div class="cookies" role="region" aria-label="Cookies"><p>${esc(etat.boutique.nom)} utilise des cookies de mesure d’audience pour améliorer le site. Vous pouvez les accepter ou les refuser.</p><div class="rangee"><button class="btn petit fantome" data-action="cookies" data-choix="refus">Refuser</button><button class="btn petit fantome" data-action="cookies" data-choix="accord">Accepter</button></div></div>`}
  <div class="tiroir ${ui.panierOuvert ? 'ouvert' : ''}" aria-hidden="${!ui.panierOuvert}">
    <div class="tiroir-fond" data-action="fermer-panier" aria-hidden="true"></div>
    <aside class="tiroir-corps" data-vars="${varsTheme(etat.boutique.theme)}">
      <div class="carte-tete"><h2>Panier</h2><button class="icone" data-action="fermer-panier">Fermer</button></div>
      ${ui.confirmation ? `<div class="confirm"><h3>Merci pour votre commande</h3><p>Commande <b class="mono">#${ui.confirmation}</b> confirmée.</p><a class="sf-btn" href="#commandes" data-action="voir-commande" data-num="${ui.confirmation}">Voir la commande dans l’admin</a></div>` :
      ui.panier.length ? `
        <ul class="lignes-panier">${ui.panier.map(l => `<li><span>${esc(l.nom)}</span>
          <div class="qte"><button data-action="qte" data-id="${l.produitId}" data-d="-1" aria-label="Retirer un">−</button><b>${l.qte}</b><button data-action="qte" data-id="${l.produitId}" data-d="1" aria-label="Ajouter un">+</button></div>
          <span class="num">${euros(l.prix * l.qte)}</span></li>`).join('')}</ul>
        ${etat.offres.barrePort && ui.livraison !== 'retrait' ? `<div class="barre-port"><p>${total >= seuilPort() ? 'Livraison offerte' : `Plus que <b>${euros(seuilPort() - total)}</b> pour la livraison offerte`}</p><span><i data-largeur="${Math.min(100, total / seuilPort() * 100)}"></i></span></div>` : ''}
        ${calc.prochainPalier ? `<p class="palier">Ajoutez ${calc.prochainPalier.manque} article${calc.prochainPalier.manque > 1 ? 's' : ''} : <b>−${calc.prochainPalier.remise} %</b> sur toute la commande.</p>` : ''}
        ${(() => { const r = ui.panier.length ? Remises.regleApplicable(etatVente(), ui.panier, 'panier') : null; const p = r && etat.produits.find(x => x.id === r.alors); return p ? `<label class="offre-panier">${visuelProduit(p)}<span><input type="checkbox" data-offre-demo="${esc(r.id)}" data-id="${esc(p.id)}"> <strong>Ajouter ${esc(p.nom)}</strong><br><s>${euros(p.prix)}</s> <b>${euros(p.prix * (1 - r.remise / 100))}</b> · −${r.remise} % seulement avec cette commande</span></label>` : ''; })()}
        <form class="code-promo" data-form="code-demo"><input name="code" placeholder="Code promo" aria-label="Code promo" value="${esc(ui.codePromo || '')}"><button class="sf-btn sf-btn-ligne">Appliquer</button></form>
        ${calc.codeValide === false ? '<p class="mini">Ce code n’existe pas ou a expiré.</p>' : calc.codeMoinsBon ? '<p class="mini">Code valable, mais la remise par quantité est plus avantageuse (non cumulable).</p>' : ''}
        <div class="totaux"><div><span>Sous-total</span><span>${euros(calc.sousTotal)}</span></div>${calc.remise ? `<div class="remise"><span>Remise · ${esc(calc.motif.libelle)}</span><span>−${euros(calc.remise)}</span></div>` : ''}<div><span>Livraison</span><span>${port ? euros(port) : 'Offerte'}</span></div><div class="total"><span>Total</span><span>${euros(total + port)}</span></div></div>
        <fieldset class="modes-livraison"><legend>Livraison</legend>${modes.map(([k, l]) => `<label class="${ui.livraison === k ? 'actif' : ''}"><input type="radio" name="livraison" value="${k}" data-livraison ${ui.livraison === k ? 'checked' : ''}><span>${esc(l.nom)}<small>${k === 'retrait' ? esc(etat.magasin.adresse) + ' · prêt en ' + l.delai : delaiMax ? `${delaiMax[0]} à ${delaiMax[1]} jours (expédié par notre partenaire)` : l.delai}</small></span><b>${fraisPort(k, total) ? euros(fraisPort(k, total)) : 'Offert'}</b></label>`).join('')}</fieldset>
        <form data-form="paiement">
          <label class="champ"><span>Nom</span><input id="pay-nom" name="nom" required value="Alex Morel"></label>
          <label class="champ"><span>E-mail</span><input id="pay-email" name="email" type="email" required value="${ch ? 'alex.morel@exemple.ch' : 'alex.morel@exemple.fr'}"></label>
          <label class="champ"><span>Ville</span><input id="pay-ville" name="ville" required value="${ch ? 'Lausanne' : 'Bordeaux'}"></label>
          <button class="sf-btn plein">Payer ${euros(total + port)} (simulation)</button>
          <p class="mini">${ch ? 'TWINT ou carte. Prix en CHF, aucun frais de douane à la livraison.' : 'Carte, paiement en 3 fois ou Wero.'} En validant, vous acceptez les <button type="button" class="bouton-lien" data-action="doc" data-id="cgv">CGV</button>. ${ch ? 'Retour gratuit sous 30 jours.' : 'Rétractation sous 14 jours.'}</p>
        </form>` : '<p>Votre panier est vide.</p>'}
    </aside>
  </div>`;
}

function passerCommande(form) {
  const d = new FormData(form);
  const calc = Remises.appliquer(ui.panier, etatVente(), ui.codePromo || '');   // comme la vraie boutique : selon la formule
  const sousTotal = calc.apresRemise;
  const port = fraisPort(ui.livraison, sousTotal);
  const numero = Math.max(1000, ...etat.commandes.map(c => c.numero)) + 1;
  const now = Date.now();
  etat.commandes.push({
    livraison: ui.livraison, canal: 'web', facture: numeroFactureSuivant(etat, now),
    id: 'c' + numero, numero, date: now,
    client: { nom: d.get('nom'), email: d.get('email'), ville: d.get('ville') },
    lignes: calc.lignes.map(({ prixInitial, ...l }) => l), sousTotal, remise: calc.remise, motifRemise: calc.motif ? calc.motif.libelle : null, port, total: Math.round((sousTotal + port) * 100) / 100,
    statut: 'payee', suivi: '', note: '',
    historique: [{ date: now, texte: 'Commande passée en ligne' }, { date: now, texte: `Paiement ${etat.boutique.pays === 'ch' ? 'TWINT' : 'par carte'} accepté (simulé)` }]
  });
  const nouvelle = etat.commandes[etat.commandes.length - 1];
  if (estDropship(nouvelle) && reglages().autoTransmission) transmettre(nouvelle, true);
  // Quantité réellement retirée du stock, notée sur la ligne : un remboursement ne remet que celle-ci.
  for (const l of nouvelle.lignes) { const p = etat.produits.find(x => x.id === l.produitId); l.type = l.type || (p ? p.type : undefined); if (p && p.type !== 'drop') { l.retireStock = Math.min(l.qte, Math.max(0, p.stock)); p.stock -= l.retireStock; } }
  ui.panier = [];
  ui.confirmation = numero;
  sauver();
  rendre();
}

/* ---------- Assistant de création ---------- */
function vueAssistant() {
  const a = ui.assistant;
  const etapes = ['Votre activité', 'Le style', 'Le domaine'];
  let corps = '';
  if (a.etape === 1) {
    corps = `<label class="champ"><span>Nom de la boutique</span><input id="as-nom" value="${esc(a.nom)}" placeholder="ex. Atelier Sauge" data-assistant="nom" required></label>
      <label class="champ"><span>Que vendez-vous ?</span><select id="as-secteur" data-assistant="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${a.secteur === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
      <label class="champ"><span>Où sont vos clients ?</span><select id="as-pays" data-assistant="pays">${[['fr', 'France'], ['be', 'Belgique'], ['ch', 'Suisse'], ['ca', 'Canada']].map(([k, v]) => `<option value="${k}" ${a.pays === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <fieldset class="champ"><legend>Comment vendez-vous ?</legend><div class="choix-modele">${[['drop', 'Dropshipping', 'Les fournisseurs stockent et expédient. Vous gérez le site et la pub.'], ['stock', 'Mes propres produits', 'Vous fabriquez ou achetez, stockez et expédiez.'], ['mixte', 'Les deux', 'Dropshipping et produits à vous, dans la même boutique.']].map(([k, n, d]) => `<label class="${a.modele === k ? 'actif' : ''}"><input type="radio" name="as-modele" value="${k}" data-assistant="modele" ${a.modele === k ? 'checked' : ''}><strong>${n}</strong><span class="sous">${d}</span></label>`).join('')}</div></fieldset>
      <label class="case"><input id="as-ex" type="checkbox" data-assistant="exemples" ${a.exemples ? 'checked' : ''}> ${a.modele === 'stock' ? 'Ajouter 6 produits d’exemple à modifier ensuite' : 'Importer les meilleurs produits du catalogue fournisseurs pour cette niche'}</label>`;
  } else if (a.etape === 2) {
    corps = `<div class="themes grands">${Object.entries(THEMES).map(([id, th]) => `
      <button class="theme-choix ${a.theme === id ? 'actif' : ''}" data-action="as-theme" data-id="${id}" data-vars="--ap-bg:${esc(th.bg)};--ap-text:${esc(th.text)};--ap-r:${Math.min(Number(th.radius) || 0, 14)}px;--ap-font:${esc(th.font)};--ap-body:${esc(th.body)};--ap-muted:${esc(th.muted)};--ap-primary:${esc(th.primary)}">
        <span class="ap-titre ap-grand">${esc(a.nom || 'Ma boutique')}</span><small class="ap-sous">Thème ${th.nom}</small><i class="ap-pastille"></i></button>`).join('')}</div>`;
  } else {
    const res = suggererDomaines({ marque: a.nom || 'ma boutique', secteurId: a.secteur, pays: a.pays, mois: new Date().getMonth() });
    const top = res.resultats.filter(r => r.disponible && r.genre !== 'campagne').slice(0, 4);
    if (!a.domaine && top[0]) a.domaine = top[0].domaine;
    corps = `<p class="sous">Classés selon la demande « ${esc(SECTEURS[a.secteur].nom)} » en ${MOIS_LONG[new Date().getMonth()]} et la facilité à retenir le nom.</p>
      <div class="choix-domaines">${top.map(r => `<label class="choix-dom ${a.domaine === r.domaine ? 'actif' : ''}"><input type="radio" name="as-dom" value="${esc(r.domaine)}" data-assistant="domaine" ${a.domaine === r.domaine ? 'checked' : ''}>
        <span class="mono">${esc(r.domaine)}</span><b>${r.score}</b><span class="sous">${connecteAuServeur() ? `≈ ${euros(r.prix)} la 1re année, puis ≈ ${euros(r.renouv)}/an, à vérifier chez le registrar` : `${euros(r.prix)} la première année`}</span></label>`).join('')}
      <label class="choix-dom ${a.domaine === '' ? 'actif' : ''}"><input type="radio" name="as-dom" value="" data-assistant="domaine" ${a.domaine === '' ? 'checked' : ''}><span>Plus tard, garder l’adresse gratuite</span></label></div>`;
  }
  return `<div class="assistant carte">
    <div class="assistant-tete"><h1>Créer une boutique</h1><a href="#tableau" class="btn petit fantome">Annuler</a></div>
    ${connecteAuServeur() ? '<p class="encart alerte">Attention : le design et les produits actuels de votre boutique seront remplacés. Vos commandes, clients et factures sont conservés.</p>' : '<p class="encart">La boutique de démonstration de ce navigateur sera remplacée. Vous pourrez la retrouver avec « Réinitialiser la démo » dans Paramètres.</p>'}
    <ol class="etapes">${etapes.map((e, i) => `<li class="${i + 1 === a.etape ? 'actif' : i + 1 < a.etape ? 'fait' : ''}">${e}</li>`).join('')}</ol>
    <div class="assistant-corps">${corps}</div>
    <div class="rangee fin">${a.etape > 1 ? '<button class="btn fantome" data-action="as-prec">Retour</button>' : ''}
      <button class="btn" data-action="${a.etape < 3 ? 'as-suiv' : 'as-creer'}">${a.etape < 3 ? 'Continuer' : 'Créer ma boutique'}</button></div>
    ${connecteAuServeur() ? '' : '<div class="rangee"><span class="sous">Ou ouvrir une démo toute prête :</span><button class="btn petit fantome" data-action="demo" data-id="lausanne">Dropshipping à Lausanne</button><button class="btn petit fantome" data-action="demo" data-id="lyon">Artisan à Lyon</button></div>'}
  </div>`;
}

function creerBoutique() {
  const a = ui.assistant;
  const nom = a.nom.trim() || 'Ma boutique';
  const res = suggererDomaines({ marque: nom, secteurId: a.secteur, pays: a.pays });
  const dom = res.resultats.find(r => r.domaine === a.domaine);
  etat = {
    version: 2,
    boutique: { nom, secteur: a.secteur, slogan: '', theme: { ...THEMES[a.theme], id: a.theme }, sections: sectionsParDefaut(nom, a.secteur, a.pays), domaine: dom ? { domaine: dom.domaine, prix: dom.prix, date: Date.now() } : null, publiee: true, pays: a.pays, devise: a.pays === 'ch' ? 'CHF' : 'EUR', modele: a.modele },
    produits: [],
    commandes: [], visites30j: 0
  };
  completerEtat(etat);
  etat.entreprise.raison = nom;
  etat.entreprise.regime = a.pays === 'ch' ? 'ch-non' : 'franchise';
  etat.entreprise.forme = a.pays === 'ch' ? 'Raison individuelle' : 'Micro-entreprise';
  if (a.exemples) {
    const drops = CATALOGUE.filter(f => f.niche === a.secteur).map(f => ({ f, s: potentielProduit(f).score })).sort((x, y) => y.s - x.s).map(x => x.f)
      .filter((f, i, arr) => arr.findIndex(g => g.nom === f.nom) === i);
    const propres = produitsDepuisSecteur(a.secteur);
    if (a.modele === 'stock' || !drops.length) etat.produits = propres;
    else if (a.modele === 'drop') etat.produits = drops.slice(0, 6).map(produitDepuisCatalogue);
    else etat.produits = [...drops.slice(0, 4).map(produitDepuisCatalogue), ...propres.slice(0, 2)];
  }
  sauver();
  ui.assistant = { etape: 1, nom: '', secteur: 'maison', pays: 'ch', modele: 'drop', theme: 'leman', exemples: true, domaine: null };
  if (typeof finParcoursCreation === 'function') finParcoursCreation();   // démonstration : parcours d'entrée terminé
  toast(`${nom} est en ligne. Personnalisez maintenant chaque section.`);
  location.hash = 'editeur';
}

/* Aperçu de la boutique : redessine sans effacer ce que le visiteur a déjà tapé dans le formulaire de paiement. */
/* Fiche produit : la photo change sans perdre ce qui est déjà tapé dans le formulaire. */
/* Contraste (WCAG) : texte du bouton calculé selon la couleur principale, gris secondaire dérivé du texte et du fond. */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function melange(a, b, t) {
  const c = h => [0, 2, 4].map(i => parseInt(String(h).replace('#', '').slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return '#' + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('');
}
function ajusterTheme(th) {
  th.onPrimary = contraste('#ffffff', th.primary) >= contraste('#111111', th.primary) ? '#FFFFFF' : '#111111';
  // Gris secondaire : le plus clair possible tout en restant lisible (4,5:1) sur le fond.
  for (const t of [0.42, 0.36, 0.3, 0.24, 0.18, 0.12, 0]) { const m = melange(th.text, th.bg, t); if (contraste(m, th.bg) >= 4.5 || t === 0) { th.muted = m; break; } }
  return th;
}
function avisContraste(th) {
  const pb = [];
  if (contraste(th.text, th.bg) < 4.5) pb.push(`texte sur fond (${contraste(th.text, th.bg).toFixed(1).replace('.', ',')}:1)`);
  if (th.surface && contraste(th.text, th.surface) < 4.5) pb.push('texte sur les cartes');
  if (contraste(th.onPrimary || '#ffffff', th.primary) < 4.5) pb.push('texte des boutons');
  return pb.length ? `<p id="avis-contraste" class="encart alerte-encart">Peu lisible : ${pb.join(', ')}. Les visiteurs malvoyants ou en plein soleil auront du mal à lire. Visez un contraste d’au moins 4,5:1.</p>` : '<p id="avis-contraste" hidden></p>';
}
function rendreEnGardantProduit() {
  const f = document.querySelector('[data-form="produit"]');
  const v = f ? [...f.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value]) : [];
  rendre();
  const nf = document.querySelector('[data-form="produit"]');
  if (nf) for (const [k, val] of v) { const el = nf.elements[k]; if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } }
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'pf-photo' || !ui.produitEdite) return;
  const f = e.target.files[0];
  if (!f) return;
  try { ui.produitEdite.image = await reduireImage(f); rendreEnGardantProduit(); setTimeout(() => document.getElementById('pf-photo-btn')?.focus(), 0); toast('Photo prête : enregistrez le produit pour la publier.'); }
  catch { toast(`${f.name} : format non lisible. Exportez la photo en JPEG ou PNG.`); }
});
function rendreEnGardantSaisie() {
  const f = document.querySelector('[data-form="paiement"]');
  const v = f ? [...f.elements].filter(e => e.name && e.type !== 'radio' && e.type !== 'submit').map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value]) : [];
  rendre();
  const nf = document.querySelector('[data-form="paiement"]');
  if (nf) for (const [k, val] of v) { const el = nf.elements[k]; if (el && el.type !== 'radio') { if (el.type === 'checkbox') el.checked = val; else el.value = val; } }
}

/* ---------- Événements ---------- */
document.addEventListener('click', e => {
  // Clic dans l’aperçu de l’éditeur : sélectionne la section
  const bloc = e.target.closest('[data-section]');
  if (bloc && ui.route === 'editeur') {
    e.preventDefault();
    ui.section = bloc.dataset.section; ui.ongletEditeur = 'sections';
    // Téléphone : l'aperçu et le panneau ne tiennent pas ensemble ; toucher une section ouvre son panneau.
    if (window.matchMedia && matchMedia('(max-width: 900px)').matches) ui.vueEdMobile = 'modifier';
    rendre();
    document.querySelector('.liste-sections li.ouvert')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const sf = e.target.closest('[data-sf]');
  if (sf && ui.route === 'boutique') {
    const a = sf.dataset.sf;
    if (a === 'ajouter') {
      const p = etat.produits.find(x => x.id === sf.dataset.id);
      // Variantes (aperçu) : la fiche s'ouvre pour choisir ; dans la fiche, la variante choisie est ajoutée.
      const choix = [...document.querySelectorAll('[data-sf-option]')].map(x => x.value);
      const v = Array.isArray(p.variantes) && p.variantes.length && ui.fiche === p.id && choix.length ? p.variantes.find(x => x.id === choix.join('/')) : null;
      if (Array.isArray(p.variantes) && p.variantes.length && !v) { ui.fiche = p.id; rendre(); return; }
      const stockMax = v ? v.stock : p.stock;
      const l = ui.panier.find(x => x.produitId === p.id && (x.varianteId || null) === (v ? v.id : null));
      if (l) l.qte = Math.min(stockMax, l.qte + 1); else ui.panier.push(v ? { produitId: p.id, varianteId: v.id, nom: `${p.nom} (${v.valeurs.join(' / ')})`, prix: typeof v.prix === 'number' ? v.prix : p.prix, qte: 1 } : { produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 });
      const q = Math.max(1, Number(document.querySelector('[data-sf-qte]')?.value) || 1);
      if (l) l.qte = Math.min(p.type === 'drop' ? 99 : stockMax, l.qte + q - 1);
      else ui.panier[ui.panier.length - 1].qte = Math.min(p.type === 'drop' ? 99 : Math.max(1, stockMax), q);
      ui.fiche = null; ui.confirmation = null; ui.panierOuvert = true; rendre();
    } else if (a === 'panier') { ui.panierOuvert = true; rendre(); }
    else if (a === 'fiche') { ui.fiche = sf.dataset.id; rendre(); }
    else if (a === 'fermer-fiche') { ui.fiche = null; rendre(); }
    else if (a === 'nav') allerSection(document, sf.dataset.v);
    else if (a === 'defiler') { document.getElementById('sf-collection')?.scrollIntoView({ behavior: 'smooth' }); }
    else if (a === 'tout-voir') { vueVitrine.tout = vueVitrine.tout === sf.dataset.id ? null : sf.dataset.id; vueVitrine.cat = ''; rendre(); }
    else if (a === 'cat') { vueVitrine.cat = sf.dataset.v; rendre(); }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const s = id && etat.boutique.sections.find(x => x.id === id);
  const idx = s ? etat.boutique.sections.indexOf(s) : -1;
  switch (action) {
    case 'cocher': e.stopPropagation(); break;
    case 'cocher-page': break;
    case 'ouvrir-commande': if (e.target.closest('.col-case')) break; ui.commande = id; if (ui.route !== 'commandes') location.hash = 'commandes'; else rendre();
      // Sur téléphone, la fiche s'affiche au-dessus de la liste : on la ramène à l'écran.
      requestAnimationFrame(() => {
        const f = document.querySelector('[data-action="fermer-commande"]'); if (f && matchMedia('(max-width: 900px)').matches) f.closest('section, .carte, aside').scrollIntoView({ block: 'start', behavior: 'smooth' });
        // Clavier et lecteur d'écran : le focus entre dans la fiche ouverte (Échap le rend à la ligne).
        const h = document.querySelector('aside.detail h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      });
      break;
    case 'fermer-commande': fermerCommande(); break;
    case 'filtre': ui.filtre = el.dataset.filtre; ui.pageCmd = 1; rendre(); break;
    case 'vue-ed-mobile': ui.vueEdMobile = el.dataset.id; rendre(); break;
    case 'page-facture': ui.pageFacture = Math.max(1, (ui.pageFacture || 1) + Number(el.dataset.d)); rendre(); break;
    case 'completer-fiche': { const c = el.dataset.champ ? document.getElementById(el.dataset.champ) : null; if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.focus(); } else location.hash = 'produits'; break; }
    case 'page-cmd': ui.pageCmd = (ui.pageCmd || 1) + Number(el.dataset.d); rendre(); document.querySelector('.table-commandes')?.scrollIntoView({ block: 'start' }); break;
    case 'export-commandes': exporterCommandesCsv(el.dataset.selection ? commandesFiltrees().filter(c => ui.selection.has(c.id)) : commandesFiltrees()); break;
    case 'groupe-statut': changerStatutGroupe([...ui.selection], el.dataset.statut); break;
    case 'groupe-bons': ui.modal = { type: 'html', html: `<h2>Bons de préparation</h2>${bonsPreparation([...ui.selection])}` }; rendreModal(); break;
    case 'bon-un': ui.modal = { type: 'html', html: `<h2>Bon de préparation</h2>${bonsPreparation([id])}` }; rendreModal(); break;
    case 'groupe-vider': ui.selection.clear(); rendre(); break;
    case 'filtre-produit': ui.filtreProduit = el.dataset.v; rendreEnGardantProduit(); break;
    case 'dupliquer-produit': dupliquerProduit(id).catch(err => toast(err.message)); break;
    case 'segment': ui.segment = el.dataset.v; ui.pageClient = 1; rendre(); break;
    case 'page-client': ui.pageClient = (ui.pageClient || 1) + Number(el.dataset.d); rendre(); break;
    case 'ouvrir-client': ui.client = id; rendre(); break;
    case 'fermer-client': ui.client = null; rendre(); break;
    case 'choisir-photo': document.getElementById('pf-photo')?.click(); break;
    case 'retirer-photo': if (ui.produitEdite) { ui.produitEdite.image = undefined; rendreEnGardantProduit(); setTimeout(() => document.getElementById('pf-photo-btn')?.focus(), 0); } break;
    case 'exporter-client': exporterClient(el.dataset.email); break;
    case 'effacer-client': effacerClient(el.dataset.email); break;
    case 'export-clients': exporterClientsCsv(el.dataset.filtre ? clientsFiltres() : listeClients()); break;
    case 'copier': try { navigator.clipboard.writeText(el.dataset.texte).then(() => toast('Copié.'), () => toast(el.dataset.texte)); } catch { toast(el.dataset.texte); } break;
    case 'imprimer': window.print(); break;
    case 'filtre-lien': ui.filtre = el.dataset.filtre; ui.pageCmd = 1; ui.canalCmd = 'tous'; ui.periodeCmd = 'tout'; ui.recherche = ''; break;
    case 'statut': if (confirmerAction(el)) changerStatut(id, el.dataset.statut); break;
    case 'transmettre-partie': { const c = etat.commandes.find(x => x.id === id); if (c) { transmettre(c, false); sauver(); rendre(); } break; }
    case 'nouveau-produit': ui.produitEdite = { id: nouvelId('p'), nom: '', description: '', prix: 20, stock: 10, categorie: SECTEURS[etat.boutique.secteur].categories[0], teinte: Math.floor(Math.random() * 360), actif: true }; rendre(); break;
    case 'editer-produit': ui.produitEdite = { ...etat.produits.find(x => x.id === id) }; rendre(); break;
    case 'fermer-produit': ui.produitEdite = null; ui.variantesOuvert = false; ui.brouillonOptions = null; rendre(); break;
    case 'supprimer-produit': if (!confirmerAction(el)) break; etat.produits = etat.produits.filter(x => x.id !== id); ui.produitEdite = null; sauver(); toast('Produit supprimé.'); rendre(); break;
    case 'choisir-section': ui.section = ui.section === id ? null : id; rendre(); break;
    case 'monter': if (idx > 0) { etat.boutique.sections.splice(idx - 1, 0, ...etat.boutique.sections.splice(idx, 1)); modifie(); rendre(); } break;
    case 'descendre': if (idx >= 0 && idx < etat.boutique.sections.length - 1) { etat.boutique.sections.splice(idx + 1, 0, ...etat.boutique.sections.splice(idx, 1)); modifie(); rendre(); } break;
    case 'supprimer-section': etat.boutique.sections.splice(idx, 1); if (ui.section === id) ui.section = null; modifie(); rendre(); break;
    case 'ajouter-section': {
      const type = $('#type-ajout').value;
      const n = { id: nouvelId('s'), type, props: { ...TYPES_SECTIONS[type].defaut } };
      const piedIdx = etat.boutique.sections.findIndex(x => x.type === 'pied');
      etat.boutique.sections.splice(piedIdx >= 0 ? piedIdx : etat.boutique.sections.length, 0, n);
      ui.section = n.id; modifie(); rendre(); break;
    }
    case 'onglet-editeur': ui.ongletEditeur = id; rendre(); break;
    case 'appareil': ui.appareil = id; rendre(); break;
    case 'theme': if (THEMES[id]) { etat.boutique.theme = { ...THEMES[id], id }; modifie(); rendre(); } break;   // tuiles de l'éditeur seulement
    case 'publier': etat.boutique.modifie = false; sauver(); toast('Modifications publiées.', ['boutique', 'Voir la boutique']); rendre(); break;
    case 'choisir-domaine':
      etat.boutique.domaine = { domaine: el.dataset.domaine, prix: Number(el.dataset.prix), genre: el.dataset.genre, date: Date.now() };
      sauver();
      toast(connecteAuServeur() ? `${el.dataset.domaine} retenu : réservez-le chez un registrar, puis suivez les étapes en haut de cette page.` : `${el.dataset.domaine} réservé (simulation). Votre boutique y est accessible.`);
      rendre(); if (connecteAuServeur()) window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'fermer-panier': ui.panierOuvert = false; ui.confirmation = null; rendre(); break;
    case 'qte': {
      const l = ui.panier.find(x => x.produitId === id);
      const p = etat.produits.find(x => x.id === id);
      l.qte = Math.min(p.stock, l.qte + Number(el.dataset.d));
      if (l.qte <= 0) ui.panier = ui.panier.filter(x => x !== l);
      rendre(); break;
    }
    case 'voir-commande': ui.commande = 'c' + el.dataset.num; ui.filtre = 'tous'; ui.panierOuvert = false; ui.confirmation = null; break;
    case 'as-theme': ui.assistant.theme = id; rendre(); break;
    case 'as-prec': ui.assistant.etape--; rendre(); break;
    case 'as-suiv':
      if (ui.assistant.etape === 1 && !ui.assistant.nom.trim()) { $('#as-nom').focus(); toast('Donnez un nom à votre boutique pour continuer.'); break; }
      ui.assistant.etape++; ui.assistant.domaine = null; rendre(); break;
    case 'as-creer': creerBoutique(); break;
    case 'reset':
      if (!ui.confirmerReset) { ui.confirmerReset = true; el.textContent = 'Confirmer la réinitialisation'; setTimeout(() => { ui.confirmerReset = false; el.textContent = 'Réinitialiser la démo'; }, 4000); break; }
      ui.confirmerReset = false; etat = boutiqueDemoLausanne(); sauver(); ui.commande = null; ui.section = null; toast('Démo Lacustre (Lausanne) restaurée.'); location.hash = 'tableau'; rendre(); break;
  }
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-action], [data-section], [data-action][tabindex="0"]:not(button):not(a)')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && !ui.modal && !e.defaultPrevented) { if (ui.route === 'boutique' && ui.panierOuvert) { ui.panierOuvert = false; rendre(); } else if (ui.route === 'boutique' && ui.fiche) { ui.fiche = null; rendre(); } else if (ui.commande) { fermerCommande(); } }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.prixRef !== undefined && ui.produitEdite) {
    const f = t.form;
    const essai = { ...ui.produitEdite, prix: Number(f.elements.prix.value), prixReference: Number(t.value) || undefined };
    essai.historiquePrix = PrixBarres.noterPrix(ui.produitEdite.historiquePrix, essai.prix);
    $('#verdict-ref').innerHTML = verdictPrixBarre(essai);
    return;
  }
  if (t.dataset.prop) {
    const s = etat.boutique.sections.find(x => x.id === t.dataset.id);
    s.props[t.dataset.prop] = t.value; modifie(); rendreApercu();
  } else if (t.dataset.theme) {
    const k = t.dataset.theme;
    etat.boutique.theme[k] = k === 'radius' ? Number(t.value) : t.value;
    if (k === 'radius') $('#rayon-val').textContent = t.value;
    if (['primary', 'bg', 'text', 'surface'].includes(k)) ajusterTheme(etat.boutique.theme);
    modifie(); rendreApercu();
    const av = document.getElementById('avis-contraste'); if (av) av.outerHTML = avisContraste(etat.boutique.theme);
  } else if (t.dataset.boutique) {
    etat.boutique[t.dataset.boutique] = t.value; modifie(); rendreApercu();
    if (t.dataset.boutique === 'nom') $('#nom-boutique').textContent = t.value;
  } else if (t.dataset.champ === 'recherche-produit') {
    ui.rechercheProduit = t.value; rendreEnGardantProduit(); const r = $('#recherche-produits'); r.focus(); r.setSelectionRange(r.value.length, r.value.length);
  } else if (t.dataset.champ === 'recherche-client') {
    ui.rechercheClient = t.value; ui.pageClient = 1; rendre(); const r = $('#recherche-clients'); r.focus(); r.setSelectionRange(r.value.length, r.value.length);
  } else if (t.dataset.champ === 'recherche') {
    ui.recherche = t.value; ui.pageCmd = 1; rendre(); const r = $('#recherche-commandes'); r.focus(); r.setSelectionRange(r.value.length, r.value.length);
  } else if (t.dataset.champ === 'note') {
    const c = etat.commandes.find(x => x.id === t.dataset.id); c.note = t.value; sauver();
  } else if (t.dataset.assistant && t.type !== 'radio' && t.type !== 'checkbox') {
    ui.assistant[t.dataset.assistant] = t.value;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.action === 'cocher') { ui.selection = ui.selection || new Set(); t.checked ? ui.selection.add(t.dataset.id) : ui.selection.delete(t.dataset.id); rendre(); return; }
  if (t.dataset && t.dataset.action === 'cocher-page') {
    ui.selection = ui.selection || new Set();
    const debut = ((ui.pageCmd || 1) - 1) * PAR_PAGE;
    commandesFiltrees().slice(debut, debut + PAR_PAGE).forEach(c => t.checked ? ui.selection.add(c.id) : ui.selection.delete(c.id));
    rendre(); return;
  }
  if (t.dataset && t.dataset.cmd) { ui[t.dataset.cmd] = t.value; ui.pageCmd = 1; rendre(); return; }
  if (t.dataset && t.dataset.offreDemo && t.checked) {
    const p = etat.produits.find(x => x.id === t.dataset.id);
    ui.panier.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1, offre: t.dataset.offreDemo });
    rendreEnGardantSaisie(); return;
  }
  if (t.dataset.champ === 'dom-marque') { ui.dom.marque = t.value; rendre(); }
  else if (t.dataset.champ === 'dom-kw') { ui.dom.motsCles = t.value; rendre(); }
  else if (t.dataset.champ === 'dom-mois') { ui.dom.mois = Number(t.value); rendre(); }
  else if (t.dataset.boutiqueDom === 'pays') { etat.boutique.pays = t.value; etat.boutique.devise = t.value === 'ch' ? 'CHF' : t.value === 'ca' ? 'CAD' : 'EUR'; sauver(); rendre(); }
  else if (t.dataset.boutique === 'secteur') { rendre(); }
  else if (t.dataset.livraison !== undefined) { ui.livraison = t.value; rendreEnGardantSaisie(); }
  else if (t.dataset.assistant === 'exemples') ui.assistant.exemples = t.checked;
  else if (t.dataset.assistant === 'domaine') { ui.assistant.domaine = t.value; rendre(); }
  else if (t.dataset.assistant === 'modele') { ui.assistant.modele = t.value; rendre(); }
  else if (t.dataset.assistant === 'secteur' || t.dataset.assistant === 'pays') ui.assistant[t.dataset.assistant] = t.value;
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === 'produit') {
    const d = new FormData(f);
    const p = { ...ui.produitEdite, nom: d.get('nom'), description: d.get('description'), prix: Number(d.get('prix')), stock: Number(d.get('stock')), cout: d.get('cout') === '' || d.get('cout') === null ? undefined : Number(d.get('cout')), categorie: d.get('categorie'), actif: d.get('actif') === 'on', aVerifier: false, prixReference: Number(d.get('prixReference')) || undefined, tauxReduit: d.get('tauxReduit') === 'on' };
    p.historiquePrix = PrixBarres.noterPrix(ui.produitEdite.historiquePrix, p.prix);
    const i = etat.produits.findIndex(x => x.id === p.id);
    if (i >= 0) etat.produits[i] = p; else etat.produits.push(p);
    ui.produitEdite = null; sauver(); toast(`« ${p.nom} » enregistré.`); rendre();
  } else if (f.dataset.form === 'code-demo') {
    ui.codePromo = String(new FormData(f).get('code') || '').trim(); rendreEnGardantSaisie();
  } else if (f.dataset.form === 'paiement') {
    passerCommande(f);
  } else if (f.dataset.sf === 'newsletter') {
    f.innerHTML = '<p>Merci, vous êtes inscrit.</p>';
  }
});

/* Infobulles des graphiques */
document.addEventListener('pointerover', e => {
  const c = e.target.closest('[data-tip]');
  const tip = $('#tip');
  if (!c) { tip.hidden = true; return; }
  tip.textContent = c.dataset.tip; tip.hidden = false;
});
document.addEventListener('pointermove', e => {
  const tip = $('#tip');
  if (tip.hidden) return;
  const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  tip.style.transform = `translate(${x}px, ${e.clientY - 36}px)`;
});

/* Routage par ancre (#commandes, #editeur…) */
function surHash() {
  const r = location.hash.slice(1);
  ui.route = [...NAV.map(n => n[0]), 'creer', 'offre'].includes(r) ? r : 'tableau';
  if (ui.route !== 'boutique') { ui.panierOuvert = false; }
  ui.modal = null;
  rendre();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', surHash);
demarrer();

/* ---------- Variantes d'un produit en stock (tailles, couleurs…) ----------
   2 options au plus ; chaque combinaison a son stock et, si besoin, son propre prix (sinon le prix du produit). */
const aVariantesEdit = p => !!(p && Array.isArray(p.variantes) && p.variantes.length);
function combinaisons(options) {
  const opts = (options || []).filter(o => o.nom && o.valeurs.length);
  return opts.length ? opts.reduce((acc, o) => acc.flatMap(a => o.valeurs.map(v => [...a, v])), [[]]) : [];
}
function editeurVariantes(p) {
  // Saisie en cours (une option sans valeur encore) gardée telle quelle d'un affichage à l'autre
  const brouillon = ui.brouillonOptions && ui.brouillonOptions.id === p.id ? ui.brouillonOptions.o : null;
  const o = [0, 1].map(i => brouillon ? brouillon[i] : ((p.options || [])[i] ? { nom: p.options[i].nom, valeurs: p.options[i].valeurs.join(', ') } : { nom: '', valeurs: '' }));
  return `<details class="variantes-edit" ${aVariantesEdit(p) || ui.variantesOuvert ? 'open' : ''}><summary>Variantes (tailles, couleurs…)</summary>
    <p class="sous">Une ou deux options, valeurs séparées par des virgules. ${p.type === 'drop' ? 'Chaque combinaison peut avoir sa référence chez le fournisseur (transmise avec la commande) et un prix différent.' : 'Chaque combinaison a son stock, et un prix différent si besoin.'}</p>
    ${o.map((x, i) => `<div class="deux"><label class="champ"><span>Option ${i + 1}</span><input data-opt-nom="${i}" value="${esc(x.nom)}" placeholder="${i ? 'ex. Couleur' : 'ex. Taille'}" maxlength="30"></label>
      <label class="champ"><span>Valeurs</span><input data-opt-valeurs="${i}" value="${esc(x.valeurs)}" placeholder="${i ? 'Bleu, Sable' : 'S, M, L'}"></label></div>`).join('')}
    ${aVariantesEdit(p) ? `<div class="table-wrap"><table class="table compacte"><thead><tr><th>Variante</th><th class="num">${p.type === 'drop' ? 'Réf. fournisseur' : 'Stock'}</th><th class="num" title="Vide : prix du produit (${euros(p.prix)})">Prix</th></tr></thead><tbody>
      ${p.variantes.map(v => `<tr><td>${esc(v.valeurs.join(' / '))}</td><td class="num">${p.type === 'drop' ? `<input value="${esc(v.ref || '')}" maxlength="60" data-var-ref="${esc(v.id)}" aria-label="Référence fournisseur ${esc(v.valeurs.join(' / '))}" placeholder="facultatif">` : `<input type="number" min="0" step="1" value="${Number(v.stock) || 0}" data-var-stock="${esc(v.id)}" aria-label="Stock ${esc(v.valeurs.join(' / '))}" class="qte-lien">`}</td><td class="num"><input type="number" min="0" step="0.01" value="${v.prix ?? ''}" data-var-prix="${esc(v.id)}" aria-label="Prix ${esc(v.valeurs.join(' / '))}" placeholder="${esc(String(p.prix))}" class="qte-lien"></td></tr>`).join('')}
    </tbody></table></div>` : ''}</details>`;
}
document.addEventListener('change', e => {
  const n = e.target.closest('[data-opt-nom], [data-opt-valeurs]'); if (!n || !ui.produitEdite) return;
  const p = ui.produitEdite;
  ui.variantesOuvert = true;
  ui.brouillonOptions = { id: p.id, o: [0, 1].map(i => ({ nom: document.querySelector(`[data-opt-nom="${i}"]`)?.value || '', valeurs: document.querySelector(`[data-opt-valeurs="${i}"]`)?.value || '' })) };

  const options = [0, 1].map(i => ({ nom: (document.querySelector(`[data-opt-nom="${i}"]`)?.value || '').trim().slice(0, 30), valeurs: [...new Set((document.querySelector(`[data-opt-valeurs="${i}"]`)?.value || '').split(',').map(v => v.replace(/[\/|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean))].slice(0, 20) })).filter(o => o.nom && o.valeurs.length);
  const combis = combinaisons(options);
  if (combis.length > 60) { toast('60 variantes au plus par produit.'); return; }
  const avant = p.variantes || [];
  p.options = options;
  // Valeur renommée (même nombre de combinaisons) : stock et prix repris à la même position
  const ids = combis.map(c => c.join('/'));
  p.variantes = combis.map((valeurs, i) => { const id = valeurs.join('/'); const v = avant.find(x => x.id === id) || (avant.length === combis.length && avant[i] && !ids.includes(avant[i].id) ? { ...avant[i], stockSaisi: true } : null); return { id, valeurs, stock: p.type === 'drop' ? 999 : v ? v.stock : 0, ...(v && v.ref ? { ref: v.ref } : {}), ...(v && v.stockSaisi ? { stockSaisi: true } : {}), ...(v && v.prix !== undefined && v.prix !== null && v.prix !== '' ? { prix: v.prix } : {}) }; });
  if (!p.variantes.length) { delete p.options; delete p.variantes; }
  else if (p.type !== 'drop') p.stock = p.variantes.reduce((a, v) => a + (Number(v.stock) || 0), 0);
  // Ce qui est déjà saisi dans la fiche (nom, prix…) est gardé avant le nouvel affichage
  const f = document.querySelector('[data-form="produit"]');
  if (f) { const d = new FormData(f); for (const k of ['nom', 'description', 'categorie']) if (d.has(k)) p[k] = d.get(k); for (const k of ['prix', 'cout', 'prixReference']) if (d.has(k) && d.get(k) !== '') p[k] = Number(d.get(k)); p.actif = d.has('actif'); p.tauxReduit = d.has('tauxReduit'); }
  // Nouvel affichage après le déplacement du curseur (tabulation, clic) : le marchand le retrouve dans le champ où il est allé
  setTimeout(() => {
    const actif = document.activeElement, suite = actif && actif.matches && actif.matches('[data-opt-nom], [data-opt-valeurs], [data-var-stock], [data-var-prix], [data-var-ref]') ? [...actif.attributes].find(a => a.name.startsWith('data-')) : null;
    rendre();
    if (suite) document.querySelector(`[${suite.name}="${CSS.escape(suite.value)}"]`)?.focus();
  }, 0);
});
document.addEventListener('input', e => {
  const rf = e.target.closest('[data-var-ref]');
  if (rf && ui.produitEdite) { const v = (ui.produitEdite.variantes || []).find(x => x.id === rf.dataset.varRef); if (v) { if (rf.value.trim()) v.ref = rf.value.trim().slice(0, 60); else delete v.ref; } return; }
  const s = e.target.closest('[data-var-stock]'), pr = e.target.closest('[data-var-prix]'); if ((!s && !pr) || !ui.produitEdite) return;
  const p = ui.produitEdite, v = (p.variantes || []).find(x => x.id === (s ? s.dataset.varStock : pr.dataset.varPrix)); if (!v) return;
  if (s) { v.stock = Math.max(0, parseInt(s.value, 10) || 0); v.stockSaisi = true; }   // saisi par le marchand : remplace le stock en base
  else if (pr.value === '') delete v.prix; else v.prix = Math.max(0, Number(pr.value) || 0);
  if (p.type !== 'drop') p.stock = p.variantes.reduce((a, x) => a + (Number(x.stock) || 0), 0);
  const total = document.getElementById('pf-stock'); if (total) total.value = p.stock;
});

// Stock saisi à la main dans la fiche : seul ce cas remplace le stock en base (les ventes faites pendant l'édition restent comptées).
document.addEventListener('input', e => { if (e.target.id === 'pf-stock' && ui.produitEdite && !e.target.readOnly) ui.produitEdite.stockSaisi = true; });
