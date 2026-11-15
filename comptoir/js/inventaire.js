/* Comptoir — inventaire : compter ses articles (au lecteur de codes-barres ou à la main), voir les écarts, appliquer.
   Le stock vu au début du comptage accompagne chaque ligne : si une vente l'a changé entre-temps, le serveur refuse la
   ligne (conflit) et le marchand recompte ou applique quand même. Le comptage en cours est gardé sur l'appareil (une
   page rechargée ne fait pas tout recommencer). */
const INV = (() => { try { const v = JSON.parse(localStorage.getItem('comptoir-inventaire') || 'null'); if (v && typeof v === 'object' && v.comptes && v.vus) return v; } catch { /* ignoré */ } return { comptes: {}, vus: {}, debut: 0 }; })();
let INV_CONFLITS = null;
function garderInventaire() { try { localStorage.setItem('comptoir-inventaire', JSON.stringify(INV)); } catch { /* ignoré */ } }
// Articles qui ont un stock propre : produits simples et variantes (ni lot, ni dropshipping, ni numérique).
function articlesInventaire() {
  return etat.produits.filter(p => p.type !== 'drop' && !p.numerique && !(Array.isArray(p.composants) && p.composants.length)).flatMap(p => Array.isArray(p.variantes) && p.variantes.length
    ? p.variantes.map(v => ({ cle: `${p.id}|${v.id}`, produitId: p.id, varianteId: v.id, nom: `${p.nom} (${v.valeurs.join(' / ')})`, stock: v.stock, ean: v.ean || '' }))
    : [{ cle: `${p.id}|`, produitId: p.id, varianteId: null, nom: p.nom, stock: p.stock, ean: p.ean || '' }]);
}
function vueInventaire() {
  const arts = articlesInventaire();
  const comptes = INV.comptes, n = Object.keys(comptes).length;
  const ecarts = arts.filter(a => comptes[a.cle] !== undefined && comptes[a.cle] !== (INV.vus[a.cle] ?? a.stock));
  const lignes = arts.map(a => { const c = comptes[a.cle], vu = INV.vus[a.cle] ?? a.stock, ec = c === undefined ? null : c - vu;
    return `<tr${c !== undefined ? ' class="choisi"' : ''}><td class="carte-titre">${esc(a.nom)}${a.ean ? `<br><span class="sous mono">${esc(a.ean)}</span>` : ''}</td><td class="num" data-label="Stock">${vu}</td>
      <td class="num" data-label="Compté"><input type="number" min="0" step="1" inputmode="numeric" value="${c ?? ''}" data-inv-compte="${esc(a.cle)}" aria-label="Quantité comptée : ${esc(a.nom)}" placeholder="—" class="qte-lien"></td>
      <td class="num" data-label="Écart">${ec === null ? '' : ec === 0 ? '<span class="sous">=</span>' : `<b class="${ec < 0 ? 'down' : 'up'}">${ec > 0 ? '+' : ''}${ec}</b>`}</td></tr>`; }).join('');
  const conflits = INV_CONFLITS ? `<div class="encart alerte-encart" role="alert"><b>Des ventes ont eu lieu pendant le comptage.</b> Pour ces articles, le stock a changé depuis le début : recomptez-les, ou appliquez quand même votre comptage.
      <ul>${INV_CONFLITS.map(x => `<li>${esc(x.nom)} : stock ${x.stockVu} au début, ${x.actuel} maintenant, ${x.compte} compté</li>`).join('')}</ul>
      <div class="rangee"><button class="btn petit" data-action="inventaire-forcer">Appliquer quand même</button><button class="btn petit fantome" data-action="inventaire-recompter">Recompter ces articles</button></div></div>` : '';
  return `<section class="carte"><div class="carte-tete"><h2>Inventaire</h2><button class="btn petit fantome" data-action="inventaire-fermer">Fermer</button></div>
    <p class="sous">Lisez les codes-barres (chaque lecture ajoute 1) ou saisissez les quantités. Seuls les articles comptés sont modifiés. ${INV.debut ? `Comptage commencé le ${new Date(INV.debut).toLocaleString('fr-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
    <label class="champ"><span>Code-barres (lecteur, puis Entrée)</span><input id="inv-scan" data-inventaire-scan inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="20" enterkeyhint="done"></label>
    ${conflits}
    <div class="table-wrap"><table class="table compacte table-cartes"><thead><tr><th>Article</th><th class="num">Stock</th><th class="num">Compté</th><th class="num">Écart</th></tr></thead><tbody>${lignes}</tbody></table></div>
    <p class="sous" role="status">${n} article${n > 1 ? 's' : ''} compté${n > 1 ? 's' : ''}, ${ecarts.length} écart${ecarts.length > 1 ? 's' : ''}.</p>
    <div class="rangee"><button class="btn" data-action="inventaire-appliquer" ${n ? '' : 'disabled'}>Appliquer l’inventaire</button><button class="btn fantome" data-action="inventaire-recommencer" ${n ? '' : 'disabled'}>Recommencer</button></div></section>`;
}
// Première quantité comptée : le stock vu à cet instant est retenu pour cet article (contrôle des ventes pendant le comptage).
function compter(a, qte) {
  if (!INV.debut) INV.debut = Date.now();
  if (INV.vus[a.cle] === undefined) INV.vus[a.cle] = a.stock;
  INV.comptes[a.cle] = qte; garderInventaire();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('[data-inventaire-scan]')) return;
  e.preventDefault();
  const code = Gtin.canonique(e.target.value); e.target.value = '';
  if (!code) return;
  const a = articlesInventaire().find(x => x.ean && Gtin.canonique(x.ean) === code);
  if (!a) { toast(`Code-barres inconnu : ${code}.`); return; }
  compter(a, (INV.comptes[a.cle] || 0) + 1);
  rendre(); document.getElementById('inv-scan')?.focus();
  if (typeof annoncerEcran === 'function') annoncerEcran(`${a.nom} : ${INV.comptes[a.cle]}`);
});
document.addEventListener('change', e => {
  const i = e.target.closest && e.target.closest('[data-inv-compte]'); if (!i) return;
  const a = articlesInventaire().find(x => x.cle === i.dataset.invCompte); if (!a) return;
  if (i.value === '') { delete INV.comptes[a.cle]; delete INV.vus[a.cle]; garderInventaire(); }
  else compter(a, Math.max(0, Math.min(1e6, parseInt(i.value, 10) || 0)));
  rendre(); document.querySelector(`[data-inv-compte="${CSS.escape(a.cle)}"]`)?.focus();
});
async function appliquerInventaire(forcer) {
  const arts = articlesInventaire();
  const lignes = Object.entries(INV.comptes).map(([cle, compte]) => { const a = arts.find(x => x.cle === cle); return a && { produitId: a.produitId, varianteId: a.varianteId, compte, stockVu: INV.vus[cle] ?? a.stock }; }).filter(Boolean);
  try {
    const r = await api('POST', '/api/admin/inventaire', { lignes, ...(forcer ? { forcer: true } : {}) });
    INV.comptes = {}; INV.vus = {}; INV.debut = 0; INV_CONFLITS = null; garderInventaire();
    await rafraichir(`Inventaire appliqué : ${r.appliques} article${r.appliques > 1 ? 's' : ''}, ${r.ecarts.length} écart${r.ecarts.length > 1 ? 's' : ''} corrigé${r.ecarts.length > 1 ? 's' : ''}.`);
  } catch (err) {
    if (err.code === 'inventaire_conflit' && err.donnees) { INV_CONFLITS = err.donnees.conflits; rendre(); document.querySelector('[data-action="inventaire-forcer"]')?.focus(); return; }
    toast(err.message);
  }
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action^="inventaire"]'); if (!el) return;
  const a = el.dataset.action;
  if (a === 'inventaire') { ui.inventaire = !ui.inventaire; rendre(); if (ui.inventaire) setTimeout(() => document.getElementById('inv-scan')?.focus(), 0); }
  else if (a === 'inventaire-fermer') { ui.inventaire = false; rendre(); }
  else if (a === 'inventaire-recommencer') { if (!confirm('Effacer le comptage en cours ?')) return; INV.comptes = {}; INV.vus = {}; INV.debut = 0; INV_CONFLITS = null; garderInventaire(); rendre(); }
  else if (a === 'inventaire-appliquer') appliquerInventaire(false);
  else if (a === 'inventaire-forcer') appliquerInventaire(true);
  else if (a === 'inventaire-recompter') { for (const x of INV_CONFLITS || []) { const cle = `${x.produitId}|${x.varianteId || ''}`; delete INV.comptes[cle]; delete INV.vus[cle]; } INV_CONFLITS = null; garderInventaire(); rendre(); document.getElementById('inv-scan')?.focus(); }
});
