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
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) { /* ignoré */ }
}

/* ---------- Utilitaires ---------- */
const $ = s => document.querySelector(s);
const JOUR = 86400000;
function dateCourte(t) { const d = new Date(t); return d.toLocaleDateString('fr-FR', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); }
function dateHeure(t) { return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function pct(n) { return (n > 0 ? '+' : '') + Math.round(n * 100) + ' %'; }
function pill(statut) { const s = STATUTS[statut]; return `<span class="pill ${s.ton}">${s.nom}</span>`; }
function compteVentes(c) { return !['annulee', 'remboursee', 'attente'].includes(c.statut); }
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
  ['produits', 'Produits', 'Catalogue'],
  ['stars', 'Produits stars', 'Catalogue'],
  ['sourcing', 'Trouver des produits', 'Catalogue'],
  ['tests', 'Tests produits', 'Catalogue'],
  ['fournisseurs', 'Fournisseurs', 'Catalogue'],
  ['social', 'Réseaux sociaux', 'Croissance'],
  ['conversion', 'Conversion et e-mails', 'Croissance'],
  ['domaines', 'Domaines', 'Croissance'],
  ['editeur', 'Éditeur du site', 'Boutique'],
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
  const aTraiter = etat.commandes.filter(c => c.statut === 'payee' || c.statut === 'preparation').length;
  const aValider = prochainsTempsForts(2).filter(e => !etat.campagnes[e.cle]).length;
  let groupe = '';
  $('#nav').innerHTML = NAV.map(([id, nom, g]) => {
    const tete = g !== groupe ? `<div class="nav-groupe">${(groupe = g)}</div>` : '';
    const verrouille = typeof SERVEUR !== 'undefined' && SERVEUR.connecte && SERVEUR.abonnement && SERVEUR.abonnement.obligatoire && Formules.FONCTIONS[id] && !Formules.permet(SERVEUR.abonnement.formule, id);
    return `${tete}<a href="#${id}" class="${route === id ? 'actif' : ''}${verrouille ? ' verrouille' : ''}" ${route === id ? 'aria-current="page"' : ''} ${verrouille ? `title="Formule ${Formules.FORMULES[Formules.FONCTIONS[id]].nom}"` : ''}>${icone(id)}<span>${nom}</span>${verrouille ? '<i class="cadenas" aria-label="Non inclus dans votre formule">🔒</i>' : ''}${id === 'commandes' && aTraiter ? `<b class="badge">${aTraiter}</b>` : ''}${id === 'copilote' && aValider ? `<b class="badge">${aValider}</b>` : ''}</a>`;
  }).join('');
  const n = NAV.find(x => x[0] === route);
  const [g, t] = n ? [n[2], n[1]] : (TITRES_HORS_NAV[route] || ['Comptoir', '']);
  // Menu horizontal (tablette, mobile) : l’onglet actif est ramené au centre, sans faire défiler la page.
  requestAnimationFrame(() => { const nav = document.getElementById('nav'), a = nav && nav.querySelector('a.actif'); if (a && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += a.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - a.offsetWidth) / 2; });
  $('#fil').innerHTML = `<i>${esc(etat.boutique.nom)}</i><i>/</i><span>${esc(g)}</span><i>/</i><b>${esc(t)}</b>`;
  const enLigne = typeof SERVEUR !== 'undefined' && SERVEUR.connecte;
  $('#mode-badge').textContent = enLigne ? 'En ligne' : 'Démo';
  $('#mode-badge').classList.toggle('reel', enLigne);
  document.title = `${t || 'Comptoir'} · ${etat.boutique.nom}`;
  $('#nom-boutique').textContent = etat.boutique.nom;
  $('#domaine-actuel').textContent = etat.boutique.domaine ? etat.boutique.domaine.domaine : (typeof SERVEUR !== 'undefined' && SERVEUR.connecte ? location.host + '/s/' + SERVEUR.slug : slugifier(etat.boutique.nom) + '.comptoir.shop');
  const vues = { stars: vueStars, tableau: vueTableau, commandes: vueCommandes, produits: vueProduits, clients: vueClients, editeur: vueEditeur, domaines: vueDomaines, boutique: vueBoutique, creer: vueAssistant, copilote: vueCopilote, sourcing: vueSourcing, social: vueSocial, tests: vueTests, analyse: vueAnalyse, parametres: vueParametres, fournisseurs: vueFournisseurs, conversion: vueConversion, magasin: vueMagasin, conformite: vueConformite, offre: vueOffre };
  // Le champ actif (par son id) retrouve le focus après le rendu : Tab après une modification ne renvoie plus au début de la page.
  // Si l'on quitte un champ avec Tab, son « change » redessine la vue avant que le focus n'arrive au champ suivant : on l'y amène.
  const actif = document.activeElement, surCorps = !actif || actif === document.body;
  const idActif = actif && actif.id && actif.closest && actif.closest('#vue') ? actif.id : '';
  const tab = surCorps && dernierTab && Date.now() - dernierTab.t < 300 ? dernierTab : null;
  $('#vue').innerHTML = (vues[route] || vueTableau)();
  if (idActif || (tab && tab.id)) setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const el = document.getElementById(idActif || tab.id);
    if (!el) return;
    if (idActif) return el.focus({ preventScroll: true });
    const ordre = [...$('#vue').querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent && x.type !== 'hidden');
    const i = ordre.indexOf(el), cible = ordre[i + (tab.arriere ? -1 : 1)] || el;
    cible.focus();
  }, 0);
  // Mode connecté : une fonction hors de la formule payée affiche une invitation (le serveur refuse aussi l'accès).
  const ab = typeof SERVEUR !== 'undefined' && SERVEUR.connecte && SERVEUR.abonnement;
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
  const ca = cs.reduce((a, c) => a + c.total, 0);
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
    ${tuile({ nom: 'Bénéfice net (estimé)', valeur: euros(bCur), actuel: bCur, precedent: bPrev, tendance: jours.map(j => j.net) })}
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
      <p>${dansJours(prochain.date)}. ${etat.campagnes[prochain.cle] ? 'Votre campagne est programmée.' : `Campagne prête : ${euros(campProchain.caPrevu)} de ventes prévues${campProchain.ruptures.length ? `, ${campProchain.ruptures.length} produit${campProchain.ruptures.length > 1 ? 's' : ''} à réassortir` : ''}.`}</p>
      <div class="jauge"><div style="width:${Math.min(100, indice / 1.8)}%"></div></div>
      <p class="sous">Demande « ${esc(secteur.nom)} » : indice ${indice} (100 = mois moyen)</p>
      <div class="rangee"><a class="btn" href="#copilote">${etat.campagnes[prochain.cle] ? 'Voir la campagne' : 'Relire et valider'}</a><a class="btn fantome" href="#domaines">Domaine de campagne</a></div>
    </section>
  </div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Dernières commandes</h2><a href="#commandes" class="lien">Toutes les commandes</a></div>
      ${recentes.length ? `<div class="table-wrap"><table class="table compacte"><thead><tr><th>N°</th><th>Client</th><th class="num">Total</th><th>Statut</th></tr></thead><tbody>${recentes.map(c => `
        <tr data-action="ouvrir-commande" data-id="${c.id}" tabindex="0"><td class="mono">#${c.numero}</td><td>${esc(c.client.nom)}<div class="sous">${dateCourte(c.date)} · ${esc(c.client.ville || '')}</div></td><td class="num">${euros(c.total)}</td><td>${pill(c.statut)}</td></tr>`).join('')}
      </tbody></table></div>` : etatVide('commandes', 'Pas encore de commande', 'Partagez le lien de votre boutique ou lancez le pilote des réseaux sociaux pour obtenir vos premières visites.', '<a class="btn petit" href="#social">Préparer mes publications</a>')}
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>À faire</h2></div>
      ${(() => {
        const nFour = etat.commandes.filter(c => c.statut === 'fournisseur').length;
        const item = (n, texte, lien, { alerte = false, filtre = '' } = {}) => `<li class="${alerte ? 'alerte' : ''}"><a href="#${lien}" ${filtre ? `data-action="filtre-lien" data-filtre="${filtre}"` : ''}><span class="todo-n">${n === null ? '<i></i>' : n}</span><span class="todo-t">${texte}</span><span class="todo-fl" aria-hidden="true">›</span></a></li>`;
        const items = [
          item(aExpedier.length, `commande${aExpedier.length > 1 ? 's' : ''} à préparer et expédier`, 'commandes', { alerte: aExpedier.length > 0, filtre: 'payee' }),
          item(attente, `paiement${attente > 1 ? 's' : ''} en attente`, 'commandes', { alerte: attente > 0, filtre: 'attente' }),
          ...stockBas.map(p => item(p.stock, `Stock bas : ${esc(p.nom)}`, 'produits', { alerte: true })),
          ...etat.produits.filter(p => p.actif !== false && typeof margeProduit === 'function' && margeProduit(p).nette < 0).slice(0, 3).map(p => item('!', `Vendu à perte : ${esc(p.nom)} (${euros(margeProduit(p).nette)} par vente)`, 'produits', { alerte: true })),
          nFour ? item(nFour, `commande${nFour > 1 ? 's' : ''} chez le fournisseur (suivi automatique)`, 'commandes', { filtre: 'fournisseur' }) : '',
          retraits ? item(retraits, `retrait${retraits > 1 ? 's' : ''} en magasin en cours`, 'magasin', { alerte: true }) : '',
          etat.boutique.domaine ? '' : item(null, 'Choisir un domaine personnalisé', 'domaines', { alerte: true }),
          etat.entreprise.mediateur || estSuisse() ? '' : item(null, 'Indiquer votre médiateur de la consommation (obligatoire)', 'conformite', { alerte: true }),
          etat.entreprise.adresse ? '' : item(null, `Indiquer l’adresse de l’entreprise (${estSuisse() ? 'Impressum' : 'mentions légales'}, obligatoire : sans elle, votre boutique n’accepte pas de commandes)`, 'conformite', { alerte: true }),
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
  preparation: [['expediee', 'Expédier (générer le suivi)'], ['remboursee', 'Annuler et rembourser']],
  expediee: [['livree', 'Marquer comme livrée']],
  livree: [['remboursee', 'Rembourser']],
  remboursee: [], annulee: []
};

/* Commandes filtrées selon l’onglet, la période, le canal et la recherche. */
const PAR_PAGE = 50;
function commandesFiltrees() {
  const q = ui.recherche.trim().toLowerCase();
  const depuis = ui.periodeCmd && ui.periodeCmd !== 'tout' ? Date.now() - Number(ui.periodeCmd) * JOUR : 0;
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
  const sel = [...ui.selection].filter(id => etat.commandes.some(c => c.id === id));
  const toutCoche = page.length && page.every(c => ui.selection.has(c.id));
  const ca = liste.filter(compteVentes).reduce((a, c) => a + c.total, 0);
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
    <select data-cmd="canalCmd" aria-label="Canal">${[['tous', 'Tous les canaux'], ['web', 'En ligne'], ['magasin', 'En personne']].map(([v, n]) => `<option value="${v}" ${(ui.canalCmd || 'tous') === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
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
            <td class="num" data-label="Articles">${c.lignes.reduce((a, l) => a + l.qte, 0)}</td><td class="num" data-label="Total">${euros(c.total)}${c.remise ? `<div class="sous">−${euros(c.remise)}</div>` : ''}</td><td data-label="Statut">${pill(c.statut)}</td>
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
      ${c.note ? `<p class="sous">Note : ${esc(c.note)}</p>` : ''}
    </article>`).join('')}</div>
    <div class="rangee">${imprimable ? '<button class="btn" data-action="imprimer">Imprimer</button>' : '<span class="sous">L’impression est disponible dans l’application installée.</span>'}</div>`;
}

function filtresCmdActifs() { return !!(ui.recherche || ui.filtre !== 'tous' || (ui.periodeCmd && ui.periodeCmd !== 'tout') || (ui.canalCmd && ui.canalCmd !== 'tous')); }
function exporterCommandesCsv(liste) {
  const champs = ['numero', 'date', 'statut', 'client', 'email', 'ville', 'canal', 'livraison', 'articles', 'remise', 'port', 'total', 'facture', 'suivi'];
  const lignes = liste.map(c => [c.numero, new Date(c.date).toISOString(), STATUTS[c.statut] ? STATUTS[c.statut].nom : c.statut, c.client.nom, c.client.email, c.client.ville, c.canal, c.livraison, c.lignes.map(l => `${l.qte}× ${l.nom}`).join(' | '), c.remise || 0, c.port || 0, c.total, c.facture || '', c.suivi || '']
    .map(v => typeof v === 'number' ? v.toFixed(2) : `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
  telechargerTexte(`comptoir-commandes-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + champs.join(';') + '\n' + lignes.join('\n'), 'text/csv;charset=utf-8', `${liste.length} commande${liste.length > 1 ? 's' : ''} exportée${liste.length > 1 ? 's' : ''}.`);
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
    for (const c of possibles) { try { await api('POST', `/api/admin/commandes/${encodeURIComponent(c.id)}/statut`, { statut }); } catch (e) { toast(e.message); } }
    await rechargerEtat();
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
      <tr class="total"><td></td><td>Total</td><td class="num">${euros(c.total)}</td></tr></tbody></table>
    </div>
    ${c.suivi ? `<div class="bloc"><h3>Suivi ${esc(TOUTES_LIVRAISONS[c.livraison].transporteur || '')}</h3><p class="mono">${esc(c.suivi)}</p></div>` : ''}
    <div class="rangee">${c.facture ? `<button class="btn petit fantome" data-action="facture" data-id="${c.id}">Facture ${c.facture}</button>` : ''}${c.suivi && !estDropship(c) && TOUTES_LIVRAISONS[c.livraison].transporteur ? `<button class="btn petit fantome" data-action="etiquette" data-id="${c.id}">Étiquette d’envoi</button>` : ''}</div>
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
  if (statut === 'payee' && !c.facture) c.facture = numeroFactureSuivant(etat, Date.now());
  if (statut === 'remboursee' || statut === 'annulee') {
    for (const l of c.lignes) { const p = etat.produits.find(x => x.id === l.produitId); if (p) p.stock += l.qte; }
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
  <div class="tete"><div><h1>Produits</h1><p class="sous">${etat.produits.length} produits · ${etat.produits.filter(x => x.actif).length} en ligne</p></div>
    <div class="rangee"><button class="btn fantome" data-action="photos">Ajouter par photo</button><button class="btn" data-action="nouveau-produit">Ajouter un produit</button></div>
    <input type="file" id="photo-input" accept="image/*" multiple hidden></div>
  <p class="astuce">Ajoutez des produits du <a class="lien" href="#sourcing">catalogue fournisseurs</a> (dropshipping) ou prenez vos propres produits en photo : Comptoir crée les fiches (nom, catégorie, prix conseillé, description). Vous n’avez plus qu’à vérifier.</p>
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
          <td class="num" data-label="Stock">${x.type === 'drop' ? '<span class="sous" title="Stock géré par le fournisseur">—</span>' : x.stock <= 5 ? `<span class="stock-bas ${x.stock <= 0 ? 'rupture' : ''}" title="${x.stock <= 0 ? 'Rupture de stock' : 'Stock bas'}">${x.stock}</span>` : x.stock}</td>
          <td data-label="Statut">${x.aVerifier ? '<span class="pill warn">À vérifier</span>' : x.actif ? '<span class="pill good">En ligne</span>' : '<span class="pill muted">Masqué</span>'}</td></tr>`).join('')}
      </tbody></table></div>${produitsFiltres().length ? '' : etatVide('produits', etat.produits.length ? 'Aucun produit ne correspond' : 'Aucun produit', etat.produits.length ? 'Modifiez la recherche ou le filtre.' : 'Importez un produit du catalogue fournisseurs ou créez le vôtre.', '<a class="btn petit" href="#sourcing">Trouver des produits</a>')}</section>
    ${p ? `<aside class="carte detail"><form data-form="produit">
      <div class="carte-tete"><h2>${etat.produits.find(x => x.id === p.id) ? 'Modifier le produit' : 'Nouveau produit'}</h2><button type="button" class="icone" data-action="fermer-produit">Fermer</button></div>
      ${visuelProduit(p, true)}
      <label class="champ"><span>Nom</span><input id="pf-nom" name="nom" required value="${esc(p.nom)}"></label>
      <label class="champ"><span>Description <button type="button" class="lien bouton-lien" data-action="rediger">Rédiger pour moi</button></span><textarea id="pf-desc" name="description" rows="4">${esc(p.description)}</textarea></label>
      <div class="deux"><label class="champ"><span>Prix TTC (${devise()})</span><input id="pf-prix" name="prix" type="number" min="0" step="0.01" required value="${p.prix}"></label>
      ${p.type === 'drop' ? '<input type="hidden" name="stock" value="999">' : `<label class="champ"><span>Stock</span><input id="pf-stock" name="stock" type="number" min="0" step="1" required value="${p.stock}"></label>`}</div>
      ${p.type === 'drop' ? `<p class="sous">Fournisseur : ${esc(p.fournisseur || '—')} · entrepôt ${ENTREPOTS[p.entrepot] ? ENTREPOTS[p.entrepot].nom : '—'} · ${p.delai ? p.delai[0] + '–' + p.delai[1] + ' jours' : ''}</p>
      <label class="champ"><span>Coût fournisseur (${devise()})</span><input id="pf-cout" name="cout" type="number" min="0" step="0.01" value="${p.cout}"></label>`
      : `<label class="champ"><span>Coût d’achat unitaire (${devise()})</span><input id="pf-cout" name="cout" type="number" min="0" step="0.01" value="${p.cout ?? ''}" placeholder="Pour calculer votre marge"></label>`}
      ${blocMarge(p)}
      <label class="champ"><span>Prix barré (facultatif, ${devise()})</span><input id="pf-ref" name="prixReference" type="number" min="0" step="0.01" value="${p.prixReference ?? ''}" placeholder="Prix avant réduction" data-prix-ref></label>
      <div id="verdict-ref">${verdictPrixBarre(p)}</div>
      <label class="champ"><span>Catégorie</span><select id="pf-cat" name="categorie">${[...new Set([p.categorie, ...cats])].map(c => `<option ${c === p.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="case"><input id="pf-actif" type="checkbox" name="actif" ${p.actif ? 'checked' : ''}> Visible dans la boutique</label>
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
    const k = (c.client.email || c.client.nom).toLowerCase();
    const x = par[k] = par[k] || { cle: k, nom: c.client.nom, email: c.client.email, ville: c.client.ville, commandes: [], total: 0, premiere: c.date, derniere: 0, consentement: false };
    x.commandes.push(c);
    if (compteVentes(c)) x.total += c.total;
    x.premiere = Math.min(x.premiere, c.date); x.derniere = Math.max(x.derniere, c.date);
    if (c.client.consentement) x.consentement = true;
  }
  const l = Object.values(par);
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
    <div class="rangee"><button class="btn fantome" data-action="export-clients">Exporter CSV</button></div></div>
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
    <div class="bloc"><h3>Commandes</h3><table class="table compacte"><tbody>${[...c.commandes].sort((a, b) => b.date - a.date).map(o => `<tr data-action="ouvrir-commande" data-id="${o.id}" tabindex="0"><td class="mono">#${o.numero}</td><td class="sous">${dateCourte(o.date)}</td><td class="num">${euros(o.total)}</td><td>${pill(o.statut)}</td></tr>`).join('')}</tbody></table></div>
  </aside>`;
}

function exporterClientsCsv() {
  const l = listeClients();
  const lignes = l.map(c => [c.nom, c.email || '', c.ville || '', c.n, c.total, c.panier, new Date(c.premiere).toISOString().slice(0, 10), new Date(c.derniere).toISOString().slice(0, 10), c.consentement ? 'oui' : 'non']
    .map(v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : `"${String(v).replace(/"/g, '""')}"`).join(';'));
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
        <button class="theme-choix ${t.id === id ? 'actif' : ''}" data-action="theme" data-id="${id}" style="background:${th.bg};color:${th.text};border-radius:${Math.min(th.radius, 12)}px">
          <span style="font-family:${th.font}">${th.nom}</span><i style="background:${th.primary}"></i></button>`).join('')}</div>
      <div class="deux">
        <label class="champ"><span>Couleur principale</span><input id="st-primary" type="color" value="${t.primary}" data-theme="primary"></label>
        <label class="champ"><span>Fond</span><input id="st-bg" type="color" value="${t.bg}" data-theme="bg"></label>
        <label class="champ"><span>Texte</span><input id="st-text" type="color" value="${t.text}" data-theme="text"></label>
        <label class="champ"><span>Cartes</span><input id="st-surface" type="color" value="${t.surface}" data-theme="surface"></label>
      </div>
      <label class="champ"><span>Police des titres</span><select id="st-font" data-theme="font">${POLICES.map(([v, n]) => `<option value="${esc(v)}" ${t.font === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="champ"><span>Arrondi des angles : <b id="rayon-val">${t.radius}</b> px</span><input id="st-radius" type="range" min="0" max="24" value="${t.radius}" data-theme="radius"></label>`;
  } else {
    panneau = `<label class="champ"><span>Nom de la boutique</span><input id="in-nom" value="${esc(b.nom)}" data-boutique="nom"></label>
      <label class="champ"><span>Slogan</span><input id="in-slogan" value="${esc(b.slogan)}" data-boutique="slogan"></label>
      <label class="champ"><span>Secteur</span><select id="in-secteur" data-boutique="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${b.secteur === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
      <fieldset class="champ"><legend>Langues de la boutique</legend><div class="rangee">${[['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['en', 'English']].map(([k, n]) => `<label class="case"><input type="checkbox" data-langue="${k}" ${b.langues.includes(k) ? 'checked' : ''} ${k === 'fr' ? 'disabled' : ''}> ${n}</label>`).join('')}</div>
        <span class="sous">Traduction automatique des pages et fiches produits (simulée), relisible avant publication.</span></fieldset>
      <div class="bloc"><h3>Adresse</h3><p class="mono">${esc(b.domaine ? b.domaine.domaine : slugifier(b.nom) + '.comptoir.shop')}</p><a href="#domaines" class="lien">Changer de domaine</a></div>`;
  }
  return `
  <div class="tete"><div><h1>Éditeur du site</h1><p class="sous">Cliquez sur une section de l’aperçu pour la modifier.</p></div>
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
    <div class="scene"><div class="appareil ${ui.appareil}"><div class="barre-url"><span></span><span></span><span></span><em class="mono">${esc(b.domaine ? b.domaine.domaine : slugifier(b.nom) + '.comptoir.shop')}</em></div><div id="apercu"></div></div></div>
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
      <td><div class="score"><div class="score-barre"><i style="width:${r.score}%"></i></div><b>${r.score}</b></div></td>
      <td>${r.disponible ? '<span class="pill good">Disponible</span>' : r.prime ? '<span class="pill warn">Premium</span>' : '<span class="pill muted">Déjà pris</span>'}</td>
      <td class="num">${r.disponible || r.prime ? euros(r.prix) + '<div class="sous">puis ' + euros(r.renouv) + '/an</div>' : '—'}</td>
      <td>${r.disponible ? `<button class="btn petit fantome" data-action="choisir-domaine" data-domaine="${esc(r.domaine)}" data-prix="${r.prix}" data-genre="${esc(r.genre)}">${b.domaine && b.domaine.domaine === r.domaine ? 'Choisi' : 'Choisir'}</button>` : ''}</td>
    </tr>`;
  const reco = (r, titre, texte) => r ? `<div class="reco"><span class="eyebrow">${titre}</span><div class="mono dom grand">${esc(r.domaine)}</div>
      <div class="detail-score">${Object.entries({ Demande: r.detail.demande, Saison: r.detail.saison, Brièveté: r.detail.court, Mémorisation: r.detail.memo, Extension: r.detail.extension }).map(([k, v]) => `<div><span>${k}</span><div class="score-barre"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}</div>
      <p class="sous">${texte}</p>
      <button class="btn" data-action="choisir-domaine" data-domaine="${esc(r.domaine)}" data-prix="${r.prix}" data-genre="${esc(r.genre)}">Réserver pour ${euros(r.prix)}</button></div>` : '';
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
      ${res.signal.length ? `<ul class="parts">${res.signal.map(s => `<li><span>${esc(s.cat)}</span><div class="score-barre"><i style="width:${Math.round(s.part * 100)}%"></i></div><b>${Math.round(s.part * 100)} %</b></li>`).join('')}</ul>
      <p class="sous">Les mots-clés liés à vos meilleures catégories reçoivent un bonus : ${res.topKws.map(k => `« ${esc(k.kw)} »`).join(', ')}.</p>`
      : '<p class="sous">Pas encore de ventes : les suggestions s’appuient sur la demande du marché. Le signal clients apparaîtra avec vos premières commandes.</p>'}
    </section>
  </div>
  <div class="recos">
    ${reco(res.principal, 'Domaine principal recommandé', 'À garder toute l’année : c’est l’adresse de votre boutique.')}
    ${reco(res.campagne, 'Domaine de campagne', `Redirigé vers votre boutique le temps de « ${esc(res.campagne ? res.campagne.saison.nom : '')} » : utile pour la publicité et les réseaux sociaux.`)}
  </div>
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>Toutes les suggestions</h2><span class="sous">${res.resultats.filter(r => r.disponible).length} disponibles sur ${res.resultats.length}</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Domaine</th><th>Type</th><th>Score</th><th>Disponibilité</th><th class="num">Première année</th><th></th></tr></thead>
    <tbody>${res.resultats.map(ligne).join('')}</tbody></table></div>
  </section>
  <p class="note">Démo : volumes de recherche, disponibilité et prix sont simulés. En production, ils viennent de l’API d’un registrar et de Google Trends.</p>`;
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
  const calc = Remises.appliquer(ui.panier, etat, ui.codePromo || '');
  const total = calc.apresRemise;
  const modes = Object.entries(livraisonsPays(etat.boutique.pays)).filter(([k]) => k !== 'retrait' || etat.magasin.clickCollect);
  if (!modes.find(([k]) => k === ui.livraison)) ui.livraison = modes[0][0];
  const delaisDrop = ui.panier.map(l => etat.produits.find(p => p.id === l.produitId)).filter(p => p && p.type === 'drop' && p.delai);
  const delaiMax = delaisDrop.length ? [Math.max(...delaisDrop.map(p => p.delai[0])), Math.max(...delaisDrop.map(p => p.delai[1]))] : null;
  const ch = etat.boutique.pays === 'ch';
  const port = total ? fraisPort(ui.livraison, total) : 0;
  return `
  <div class="bandeau-client"><span>Vous voyez <b class="mono">${esc(etat.boutique.domaine ? etat.boutique.domaine.domaine : slugifier(etat.boutique.nom) + '.comptoir.shop')}</b> comme un client. Passez une commande : elle apparaîtra dans l’admin.</span><a href="#tableau" class="btn petit">Retour à l’admin</a></div>
  <div class="boutique-live">${renduBoutique(etat, { mode: 'live', panier: ui.panier, fiche: ui.fiche })}</div>
  ${etat.cookies ? '' : `<div class="cookies" role="region" aria-label="Cookies"><p>${esc(etat.boutique.nom)} utilise des cookies de mesure d’audience pour améliorer le site. Vous pouvez les accepter ou les refuser.</p><div class="rangee"><button class="btn petit fantome" data-action="cookies" data-choix="refus">Refuser</button><button class="btn petit fantome" data-action="cookies" data-choix="accord">Accepter</button></div></div>`}
  <div class="tiroir ${ui.panierOuvert ? 'ouvert' : ''}" aria-hidden="${!ui.panierOuvert}">
    <div class="tiroir-fond" data-action="fermer-panier" aria-hidden="true"></div>
    <aside class="tiroir-corps" style="${varsTheme(etat.boutique.theme)}">
      <div class="carte-tete"><h2>Panier</h2><button class="icone" data-action="fermer-panier">Fermer</button></div>
      ${ui.confirmation ? `<div class="confirm"><h3>Merci pour votre commande</h3><p>Commande <b class="mono">#${ui.confirmation}</b> confirmée.</p><a class="sf-btn" href="#commandes" data-action="voir-commande" data-num="${ui.confirmation}">Voir la commande dans l’admin</a></div>` :
      ui.panier.length ? `
        <ul class="lignes-panier">${ui.panier.map(l => `<li><span>${esc(l.nom)}</span>
          <div class="qte"><button data-action="qte" data-id="${l.produitId}" data-d="-1" aria-label="Retirer un">−</button><b>${l.qte}</b><button data-action="qte" data-id="${l.produitId}" data-d="1" aria-label="Ajouter un">+</button></div>
          <span class="num">${euros(l.prix * l.qte)}</span></li>`).join('')}</ul>
        ${etat.offres.barrePort && ui.livraison !== 'retrait' ? `<div class="barre-port"><p>${total >= seuilPort() ? 'Livraison offerte' : `Plus que <b>${euros(seuilPort() - total)}</b> pour la livraison offerte`}</p><span><i style="width:${Math.min(100, total / seuilPort() * 100)}%"></i></span></div>` : ''}
        ${calc.prochainPalier ? `<p class="palier">Ajoutez ${calc.prochainPalier.manque} article${calc.prochainPalier.manque > 1 ? 's' : ''} : <b>−${calc.prochainPalier.remise} %</b> sur toute la commande.</p>` : ''}
        ${(() => { const r = ui.panier.length ? Remises.regleApplicable(etat, ui.panier, 'panier') : null; const p = r && etat.produits.find(x => x.id === r.alors); return p ? `<label class="offre-panier">${visuelProduit(p)}<span><input type="checkbox" data-offre-demo="${esc(r.id)}" data-id="${esc(p.id)}"> <strong>Ajouter ${esc(p.nom)}</strong><br><s>${euros(p.prix)}</s> <b>${euros(p.prix * (1 - r.remise / 100))}</b> · −${r.remise} % seulement avec cette commande</span></label>` : ''; })()}
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
  const calc = Remises.appliquer(ui.panier, etat, ui.codePromo || '');
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
  for (const l of ui.panier) { const p = etat.produits.find(x => x.id === l.produitId); if (p) p.stock = Math.max(0, p.stock - l.qte); }
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
      <button class="theme-choix ${a.theme === id ? 'actif' : ''}" data-action="as-theme" data-id="${id}" style="background:${th.bg};color:${th.text};border-radius:${Math.min(th.radius, 14)}px">
        <span style="font-family:${th.font};font-size:1.4rem">${esc(a.nom || 'Ma boutique')}</span><small style="font-family:${th.body};color:${th.muted}">Thème ${th.nom}</small><i style="background:${th.primary}"></i></button>`).join('')}</div>`;
  } else {
    const res = suggererDomaines({ marque: a.nom || 'ma boutique', secteurId: a.secteur, pays: a.pays, mois: new Date().getMonth() });
    const top = res.resultats.filter(r => r.disponible && r.genre !== 'campagne').slice(0, 4);
    if (!a.domaine && top[0]) a.domaine = top[0].domaine;
    corps = `<p class="sous">Classés selon la demande « ${esc(SECTEURS[a.secteur].nom)} » en ${MOIS_LONG[new Date().getMonth()]} et la facilité à retenir le nom.</p>
      <div class="choix-domaines">${top.map(r => `<label class="choix-dom ${a.domaine === r.domaine ? 'actif' : ''}"><input type="radio" name="as-dom" value="${esc(r.domaine)}" data-assistant="domaine" ${a.domaine === r.domaine ? 'checked' : ''}>
        <span class="mono">${esc(r.domaine)}</span><b>${r.score}</b><span class="sous">${euros(r.prix)} la première année</span></label>`).join('')}
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
  toast(`${nom} est en ligne. Personnalisez maintenant chaque section.`);
  location.hash = 'editeur';
}

/* Aperçu de la boutique : redessine sans effacer ce que le visiteur a déjà tapé dans le formulaire de paiement. */
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
    ui.section = bloc.dataset.section; ui.ongletEditeur = 'sections'; rendre();
    document.querySelector('.liste-sections li.ouvert')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const sf = e.target.closest('[data-sf]');
  if (sf && ui.route === 'boutique') {
    const a = sf.dataset.sf;
    if (a === 'ajouter') {
      const p = etat.produits.find(x => x.id === sf.dataset.id);
      const l = ui.panier.find(x => x.produitId === p.id);
      if (l) l.qte = Math.min(p.stock, l.qte + 1); else ui.panier.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 });
      const q = Math.max(1, Number(document.querySelector('[data-sf-qte]')?.value) || 1);
      if (l) l.qte = Math.min(p.type === 'drop' ? 99 : p.stock, l.qte + q - 1);
      else ui.panier[ui.panier.length - 1].qte = Math.min(p.type === 'drop' ? 99 : Math.max(1, p.stock), q);
      ui.fiche = null; ui.confirmation = null; ui.panierOuvert = true; rendre();
    } else if (a === 'panier') { ui.panierOuvert = true; rendre(); }
    else if (a === 'fiche') { ui.fiche = sf.dataset.id; rendre(); }
    else if (a === 'fermer-fiche') { ui.fiche = null; rendre(); }
    else if (a === 'nav') allerSection(document, sf.dataset.v);
    else if (a === 'defiler') { document.getElementById('sf-collection')?.scrollIntoView({ behavior: 'smooth' }); }
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
      requestAnimationFrame(() => { const f = document.querySelector('[data-action="fermer-commande"]'); if (f && matchMedia('(max-width: 900px)').matches) f.closest('section, .carte, aside').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      break;
    case 'fermer-commande': ui.commande = null; rendre(); break;
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
    case 'filtre-produit': ui.filtreProduit = el.dataset.v; rendre(); break;
    case 'dupliquer-produit': dupliquerProduit(id).catch(err => toast(err.message)); break;
    case 'segment': ui.segment = el.dataset.v; ui.pageClient = 1; rendre(); break;
    case 'page-client': ui.pageClient = (ui.pageClient || 1) + Number(el.dataset.d); rendre(); break;
    case 'ouvrir-client': ui.client = id; rendre(); break;
    case 'fermer-client': ui.client = null; rendre(); break;
    case 'export-clients': exporterClientsCsv(); break;
    case 'copier': try { navigator.clipboard.writeText(el.dataset.texte).then(() => toast('Copié.'), () => toast(el.dataset.texte)); } catch { toast(el.dataset.texte); } break;
    case 'imprimer': window.print(); break;
    case 'filtre-lien': ui.filtre = el.dataset.filtre; ui.pageCmd = 1; ui.canalCmd = 'tous'; ui.periodeCmd = 'tout'; ui.recherche = ''; break;
    case 'statut': changerStatut(id, el.dataset.statut); break;
    case 'nouveau-produit': ui.produitEdite = { id: nouvelId('p'), nom: '', description: '', prix: 20, stock: 10, categorie: SECTEURS[etat.boutique.secteur].categories[0], teinte: Math.floor(Math.random() * 360), actif: true }; rendre(); break;
    case 'editer-produit': ui.produitEdite = { ...etat.produits.find(x => x.id === id) }; rendre(); break;
    case 'fermer-produit': ui.produitEdite = null; rendre(); break;
    case 'supprimer-produit': etat.produits = etat.produits.filter(x => x.id !== id); ui.produitEdite = null; sauver(); toast('Produit supprimé.'); rendre(); break;
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
    case 'theme': etat.boutique.theme = { ...THEMES[id], id }; modifie(); rendre(); break;
    case 'publier': etat.boutique.modifie = false; sauver(); toast('Modifications publiées.', ['boutique', 'Voir la boutique']); rendre(); break;
    case 'choisir-domaine':
      etat.boutique.domaine = { domaine: el.dataset.domaine, prix: Number(el.dataset.prix), genre: el.dataset.genre, date: Date.now() };
      sauver(); toast(`${el.dataset.domaine} réservé (simulation). Votre boutique y est accessible.`); rendre(); break;
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
  if (e.key === 'Escape' && !ui.modal && !e.defaultPrevented) { if (ui.panierOuvert) { ui.panierOuvert = false; rendre(); } else if (ui.fiche) { ui.fiche = null; rendre(); } else if (ui.commande) { ui.commande = null; rendre(); } }
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
    modifie(); rendreApercu();
  } else if (t.dataset.boutique) {
    etat.boutique[t.dataset.boutique] = t.value; modifie(); rendreApercu();
    if (t.dataset.boutique === 'nom') $('#nom-boutique').textContent = t.value;
  } else if (t.dataset.champ === 'recherche-produit') {
    ui.rechercheProduit = t.value; rendre(); const r = $('#recherche-produits'); r.focus(); r.setSelectionRange(r.value.length, r.value.length);
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
  else if (t.dataset.boutiqueDom === 'pays') { etat.boutique.pays = t.value; etat.boutique.devise = t.value === 'ch' ? 'CHF' : 'EUR'; sauver(); rendre(); }
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
    const p = { ...ui.produitEdite, nom: d.get('nom'), description: d.get('description'), prix: Number(d.get('prix')), stock: Number(d.get('stock')), cout: d.get('cout') === '' || d.get('cout') === null ? undefined : Number(d.get('cout')), categorie: d.get('categorie'), actif: d.get('actif') === 'on', aVerifier: false, prixReference: Number(d.get('prixReference')) || undefined };
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
