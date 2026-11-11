/* Comptoir — palette de commandes (Ctrl+K ou ⌘K) : aller à une page, lancer une action. */
const palette = { ouverte: false, filtre: '', index: 0 };

function entreesPalette() {
  const pages = NAV.filter(([id]) => fonctionIncluse(id)).map(([id, nom, g]) => ({ groupe: 'Pages', nom, sous: g, icone: id, faire: () => { location.hash = id; } }));
  const actions = [
    { nom: 'Nouveau produit', icone: 'plus', faire: () => { location.hash = 'produits'; setTimeout(() => document.querySelector('[data-action="nouveau-produit"]')?.click(), 50); } },
    { nom: 'Générer le calendrier des réseaux sociaux', icone: 'social', faire: () => { location.hash = 'social'; setTimeout(() => document.querySelector('[data-action="generer-planning"]')?.click(), 80); } },
    { nom: 'Lancer un test produit', icone: 'tests', faire: () => { location.hash = 'tests'; } },
    { nom: 'Commandes à préparer', icone: 'commandes', faire: () => { ui.filtre = 'payee'; ui.recherche = ''; ui.periodeCmd = 'tout'; ui.canalCmd = 'tous'; ui.pageCmd = 1; location.hash = 'commandes'; rendre(); } },
    { nom: 'Rentabilité sur 12 mois', icone: 'analyse', faire: () => { ui.analyse = { ...(ui.analyse || {}), onglet: 'rentabilite', periode: 365, canal: 'tous' }; location.hash = 'analyse'; rendre(); } },
    { nom: 'Exporter toutes les commandes (CSV)', icone: 'analyse', faire: () => exporterCommandesCsv(etat.commandes) },
    { nom: 'Changer de thème (clair, sombre, système)', icone: 'soleil', faire: changerTheme },
    { nom: 'Offre et tarifs', icone: 'offre', faire: () => { location.hash = 'offre'; } }
  ].filter(a => fonctionIncluse(a.icone)).map(a => ({ ...a, groupe: 'Actions' }));   // pas d'action vers un écran hors formule
  const commandes = [...etat.commandes].sort((a, b) => b.date - a.date).slice(0, 5000).map(c => ({ groupe: 'Commandes', nom: `Commande n° ${c.numero} · ${c.client.nom}`, sous: euros(c.total), icone: 'commandes', faire: () => { ui.commande = c.id; ui.filtre = 'tous'; location.hash = 'commandes'; rendre(); } }));
  const produits = etat.produits.map(p => ({ groupe: 'Produits', nom: p.nom, sous: euros(p.prix), icone: 'produits', faire: () => { ui.produitEdite = { ...p }; location.hash = 'produits'; rendre(); } }));
  return [...pages, ...actions, ...produits, ...commandes];
}

function normaliser(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function resultatsPalette() {
  const f = normaliser(palette.filtre.trim());
  const tout = entreesPalette();
  const r = f ? tout.filter(e => normaliser(e.nom + ' ' + (e.sous || '')).includes(f)) : tout.filter(e => e.groupe === 'Pages' || e.groupe === 'Actions');
  return r.slice(0, 40);
}

function rendrePalette() {
  let z = document.getElementById('palette');
  if (!palette.ouverte) { if (z) z.remove(); return; }
  if (!z) {
    z = document.createElement('div'); z.id = 'palette'; z.className = 'palette';
    z.innerHTML = `<div class="palette-fond" data-pal="fermer"></div><div class="palette-boite" role="dialog" aria-modal="true" aria-label="Rechercher"><input id="palette-saisie" placeholder="Aller à une page, un produit, une commande, une action…" autocomplete="off"><ul class="palette-liste" id="palette-liste"></ul></div>`;
    document.body.appendChild(z);
    const champ = z.querySelector('input');
    champ.addEventListener('input', () => { palette.filtre = champ.value; palette.index = 0; listerPalette(); });
    champ.focus();
  }
  listerPalette();
}
function listerPalette() {
  const r = resultatsPalette();
  palette.index = Math.max(0, Math.min(palette.index, r.length - 1));
  let groupe = '';
  document.getElementById('palette-liste').innerHTML = r.map((e, i) => `${e.groupe !== groupe ? `<li class="groupe">${(groupe = e.groupe)}</li>` : ''}<li><button class="${i === palette.index ? 'actif' : ''}" data-pal="choisir" data-i="${i}">${icone(e.icone)}<span>${esc(e.nom)}</span>${e.sous ? `<span class="sous">${esc(e.sous)}</span>` : ''}</button></li>`).join('') || '<li class="groupe">Aucun résultat</li>';
  document.querySelector('#palette-liste .actif')?.scrollIntoView({ block: 'nearest' });
}
function ouvrirPalette() { palette.ouverte = true; palette.filtre = ''; palette.index = 0; rendrePalette(); }
function fermerPalette() { palette.ouverte = false; rendrePalette(); }
function choisirPalette(i) { const e = resultatsPalette()[i]; fermerPalette(); if (e) e.faire(); }

function changerTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('comptoir-theme') || 'auto'; } catch { /* ignoré */ }
  const suivant = { auto: 'light', light: 'dark', dark: 'auto' }[t];
  try { localStorage.setItem('comptoir-theme', suivant); } catch { /* ignoré */ }
  appliquerTheme();
  toast(`Thème : ${{ auto: 'celui du système', light: 'clair', dark: 'sombre' }[suivant]}.`);
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette.ouverte ? fermerPalette() : ouvrirPalette(); return; }
  if (!palette.ouverte) return;
  const n = resultatsPalette().length;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fermerPalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); palette.index = (palette.index + 1) % Math.max(1, n); listerPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palette.index = (palette.index - 1 + n) % Math.max(1, n); listerPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); choisirPalette(palette.index); }
}, true);
document.addEventListener('click', e => {
  const p = e.target.closest('[data-pal]');
  if (p) { if (p.dataset.pal === 'fermer') fermerPalette(); else choisirPalette(Number(p.dataset.i)); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'palette') ouvrirPalette();
  else if (el.dataset.action === 'theme-interface') changerTheme();
  else if (el.dataset.action === 'editer-produit' && ui.route === 'analyse') location.hash = 'produits';
});
