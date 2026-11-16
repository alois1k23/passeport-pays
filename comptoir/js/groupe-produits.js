/* Comptoir — modification groupée des produits : cases à cocher dans la liste, puis une action sur la sélection
   (prix en pourcentage ou fixé, avec ou sans ancien prix barré ; catégorie ; mise en ligne ; masquage).
   En ligne : une seule requête, tout ou rien, validée par le serveur comme la fiche. En démonstration : appliqué ici. */
'use strict';

const GROUPE = { ids: new Set(), action: 'pourcent', valeur: '', barrer: false };
const ACTIONS_GROUPE = [['pourcent', 'Changer les prix de… %'], ['prix', 'Fixer le prix à…'], ['categorie', 'Changer la catégorie'], ['activer', 'Mettre en ligne'], ['masquer', 'Masquer']];

// Même calcul que le serveur (démonstration hors ligne).
function appliquerGroupeLocal(p, action, valeur, barrer) {
  const n = Number(valeur), arr = x => Math.round(Math.max(0.01, x) * 100) / 100;
  const nouveau = x => (action === 'pourcent' && Number(x) === 0 ? 0 : arr(action === 'pourcent' ? x * (1 + n / 100) : n));
  const q = { ...p };
  if (action === 'pourcent' || action === 'prix') {
    q.prix = nouveau(p.prix);
    if (Array.isArray(p.variantes)) q.variantes = p.variantes.map(v => typeof v.prix === 'number' ? (action === 'pourcent' ? { ...v, prix: nouveau(v.prix) } : (({ prix: _p, ...r }) => r)(v)) : v);
    const ue = typeof estSuisse === 'function' ? !estSuisse() : false;
    if (barrer && q.prix < p.prix) q.prixReference = ue ? p.prix : Math.max(p.prix, p.prixReference || 0);
    else delete q.prixReference;
    if (q.prix > 100000 || (q.variantes || []).some(v => v.prix > 100000)) throw new Error(`« ${p.nom} » : le prix doit être un nombre entre 0 et 100000.`);
    if (typeof PrixBarres !== 'undefined') q.historiquePrix = PrixBarres.noterPrix(p.historiquePrix, q.prix);
  } else if (action === 'categorie') q.categorie = String(valeur || '').trim().slice(0, 60);
  else q.actif = action === 'activer';
  return q;
}

function caseGroupe(x) {
  return `<td class="col-case" data-label=""><input type="checkbox" data-groupe-case data-id="${esc(x.id)}" ${GROUPE.ids.has(x.id) ? 'checked' : ''} aria-label="Sélectionner ${esc(x.nom)}"></td>`;
}
function enteteGroupe(visibles) {
  const tout = visibles.length && visibles.every(x => GROUPE.ids.has(x.id));
  const partiel = !tout && visibles.some(x => GROUPE.ids.has(x.id));
  return `<th class="col-case"><input type="checkbox" data-groupe-tout ${tout ? 'checked' : ''} ${partiel ? 'data-partiel' : ''} aria-label="Sélectionner tous les produits affichés"></th>`;
}
function barreGroupe(visibles) {
  const ids = new Set(visibles.map(x => x.id));
  for (const id of [...GROUPE.ids]) if (!etat.produits.some(x => x.id === id)) GROUPE.ids.delete(id);
  const n = GROUPE.ids.size;
  if (!n) return '';
  const caches = [...GROUPE.ids].filter(id => !ids.has(id)).length;
  const prixAction = GROUPE.action === 'pourcent' || GROUPE.action === 'prix';
  const valeur = GROUPE.action === 'pourcent' ? `<label class="champ"><span>Variation (%)</span><input type="number" step="1" min="-90" max="500" data-groupe-valeur id="groupe-valeur" value="${esc(GROUPE.valeur)}" placeholder="ex. -20" inputmode="decimal"></label>`
    : GROUPE.action === 'prix' ? `<label class="champ"><span>Nouveau prix (${devise()})</span><input type="number" step="0.01" min="0.01" data-groupe-valeur id="groupe-valeur" value="${esc(GROUPE.valeur)}" inputmode="decimal"></label>`
    : GROUPE.action === 'categorie' ? `<label class="champ"><span>Catégorie</span><input data-groupe-valeur id="groupe-valeur" maxlength="60" value="${esc(GROUPE.valeur)}" list="groupe-categories"><datalist id="groupe-categories">${[...new Set(etat.produits.map(x => x.categorie).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>` : '';
  return `<div class="barre-groupe carte" role="region" aria-label="Modification groupée">
    <p><b>${n} produit${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}</b>${caches ? ` <span class="sous">(dont ${caches} hors du filtre)</span>` : ''}</p>
    <div class="barre-groupe-champs">
      <label class="champ"><span>Action</span><select data-groupe-action>${ACTIONS_GROUPE.map(([k, t]) => `<option value="${k}" ${GROUPE.action === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${valeur}
      ${prixAction ? `<label class="case"><input type="checkbox" data-groupe-barrer ${GROUPE.barrer ? 'checked' : ''}> Afficher l’ancien prix barré en cas de baisse (sinon, le prix barré actuel est retiré)</label>` : ''}
      <button class="btn petit" data-action="groupe-produits-appliquer">Appliquer</button>
      ${visibles.some(x => !GROUPE.ids.has(x.id)) ? `<button class="bouton-lien" data-action="groupe-produits-tout">Sélectionner les ${visibles.length} affichés</button>` : ''}
      <button class="bouton-lien" data-action="groupe-produits-vider">Tout désélectionner</button>
    </div>
    ${prixAction && GROUPE.barrer ? '<p class="sous">Le prix barré n’apparaît dans la boutique que si l’ancien prix a été pratiqué au moins 30 jours (règles sur l’indication des prix).</p>' : ''}
  </div>`;
}

let GROUPE_EN_COURS = false;
async function appliquerGroupe() {
  const ids = [...GROUPE.ids], { action, barrer } = GROUPE, valeur = GROUPE.valeur;
  if (!ids.length || GROUPE_EN_COURS) return;   // double clic : une seule application (le pourcentage n'est pas idempotent)
  if (action === 'categorie' && !String(valeur).trim()) { toast('Indiquez une catégorie.'); document.getElementById('groupe-valeur')?.focus(); return; }
  if (action === 'prix' && !(Number(valeur) >= 0.01 && Number(valeur) <= 100000)) { toast('Prix : entre 0,01 et 100 000.'); document.getElementById('groupe-valeur')?.focus(); return; }
  if ((action === 'pourcent' || action === 'prix') && (valeur === '' || !Number.isFinite(Number(valeur)))) { toast('Indiquez une valeur.'); document.querySelector('[data-groupe-valeur]')?.focus(); return; }
  const libelle = (ACTIONS_GROUPE.find(a => a[0] === action) || [])[1] || action;
  if (!confirm(`${libelle.replace('…', '')}${valeur !== '' && action !== 'activer' && action !== 'masquer' ? ` ${valeur}${action === 'pourcent' ? ' %' : ''}` : ''} pour ${ids.length} produit${ids.length > 1 ? 's' : ''} ?`)) return;
  GROUPE_EN_COURS = true;
  const bouton = document.querySelector('[data-action="groupe-produits-appliquer"]'); if (bouton) bouton.disabled = true;
  // Fiche ouverte d'un produit modifié : fermée (l'enregistrer ensuite annulerait la modification groupée).
  if (ui.produitEdite && GROUPE.ids.has(ui.produitEdite.id)) ui.produitEdite = null;
  try {
    if (typeof enLigne === 'function' && enLigne()) {
      const r = await api('POST', '/api/admin/produits/groupe', { ids, action, valeur: action === 'categorie' ? String(valeur) : Number(valeur), barrer });
      GROUPE.ids.clear();
      await rafraichir(`${r.modifies} produit${r.modifies > 1 ? 's' : ''} modifié${r.modifies > 1 ? 's' : ''}.`);
    } else {
      if (action === 'pourcent' && (Number(valeur) < -90 || Number(valeur) > 500 || Number(valeur) === 0)) { toast('Variation de prix : entre -90 % et +500 %, et pas 0.'); return; }
      const nouveaux = etat.produits.map(p => GROUPE.ids.has(p.id) ? appliquerGroupeLocal(p, action, valeur, barrer) : p);   // tout ou rien
      etat.produits = nouveaux;
      GROUPE.ids.clear(); sauver(); rendre(); toast(`${ids.length} produit${ids.length > 1 ? 's' : ''} modifié${ids.length > 1 ? 's' : ''}.`);
    }
  } catch (err) { toast(err.message); }
  finally { GROUPE_EN_COURS = false; const b = document.querySelector('[data-action="groupe-produits-appliquer"]'); if (b) b.disabled = false; }
}

document.addEventListener('change', e => {
  const t = e.target;
  if (!t.matches) return;
  if (t.matches('[data-groupe-case]')) { t.checked ? GROUPE.ids.add(t.dataset.id) : GROUPE.ids.delete(t.dataset.id); rendre(); document.querySelector(`[data-groupe-case][data-id="${CSS.escape(t.dataset.id)}"]`)?.focus(); }
  else if (t.matches('[data-groupe-tout]')) { produitsFiltres().forEach(x => t.checked ? GROUPE.ids.add(x.id) : GROUPE.ids.delete(x.id)); rendre(); document.querySelector('[data-groupe-tout]')?.focus(); }
  else if (t.matches('[data-groupe-action]')) { GROUPE.action = t.value; GROUPE.valeur = ''; rendre(); document.querySelector('[data-groupe-action]')?.focus(); }
  else if (t.matches('[data-groupe-barrer]')) { GROUPE.barrer = t.checked; rendre(); document.querySelector('[data-groupe-barrer]')?.focus(); }
});
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('[data-groupe-valeur]')) GROUPE.valeur = e.target.value; });
document.addEventListener('click', e => {
  // Une case dans une ligne cliquable n'ouvre pas la fiche.
  if (e.target.closest && e.target.closest('[data-groupe-case], [data-groupe-tout], td.col-case:has([data-groupe-case])')) { e.stopPropagation(); return; }
  const el = e.target.closest && e.target.closest('[data-action^="groupe-produits"]'); if (!el) return;
  if (el.dataset.action === 'groupe-produits-appliquer') appliquerGroupe();
  else if (el.dataset.action === 'groupe-produits-vider') { GROUPE.ids.clear(); rendre(); }
  else if (el.dataset.action === 'groupe-produits-tout') { produitsFiltres().forEach(x => GROUPE.ids.add(x.id)); rendre(); document.querySelector('[data-action="groupe-produits-appliquer"]')?.focus(); }
}, true);
// Case « tout sélectionner » : état intermédiaire quand une partie seulement est cochée.
new MutationObserver(() => { const t = document.querySelector('[data-groupe-tout]'); if (t) t.indeterminate = t.hasAttribute('data-partiel'); }).observe(document.body, { childList: true, subtree: true });
