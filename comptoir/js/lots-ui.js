/* Comptoir — lots et coffrets dans la fiche produit : un produit composé d'autres produits en stock.
   Le stock du lot est calculé (le nombre de lots que permettent ses composants) ; à la vente, les composants baissent. */
function composantsPossibles(p) {
  return etat.produits.filter(x => x.id !== p.id && x.type !== 'drop' && !x.numerique && !(Array.isArray(x.composants) && x.composants.length) && !(Array.isArray(x.variantes) && x.variantes.length));
}
function blocLot(p) {
  if (p.type === 'drop' || p.numerique) return '';
  const actif = Array.isArray(p.composants);
  return `<label class="case case-longue"><input id="pf-lot" type="checkbox" name="lot" ${actif ? 'checked' : ''} data-lot> Lot ou coffret : composé d’autres produits de la boutique (leur stock baisse à chaque vente)</label>
    <div id="pf-lot-zone">${zoneLot(p)}</div>`;
}
function zoneLot(p) {
  if (!Array.isArray(p.composants)) return '';
  const possibles = composantsPossibles(p);
  if (possibles.length < 2) return '<p class="encart sous">Il faut au moins deux produits en stock simples (sans variantes) pour composer un lot.</p>';
  const lignes = p.composants.length ? p.composants : [{ produitId: possibles[0].id, qte: 1 }, { produitId: possibles[1].id, qte: 1 }];
  return `<fieldset class="encart lot-composants"><legend>Contenu du lot</legend>
    ${lignes.map((c, i) => `<div class="rangee lot-ligne">
      <label class="champ"><span>Produit ${i + 1}</span><select name="composant_id">${possibles.map(x => `<option value="${esc(x.id)}" ${x.id === c.produitId ? 'selected' : ''}>${esc(x.nom)} (stock ${x.stock})</option>`).join('')}</select></label>
      <label class="champ lot-qte"><span>Quantité</span><input name="composant_qte" type="number" min="1" max="20" step="1" value="${Number(c.qte) || 1}"></label>
      ${lignes.length > 2 ? `<button type="button" class="btn petit fantome" data-action="lot-retirer" data-i="${i}" aria-label="Retirer le produit ${i + 1}">Retirer</button>` : ''}
    </div>`).join('')}
    ${lignes.length < 10 ? '<button type="button" class="btn petit fantome" data-action="lot-ajouter">Ajouter un produit au lot</button>' : ''}
    <p class="sous">Le stock du lot se calcule tout seul : c’est le nombre de lots complets que permet le stock de ses composants. Un composant peut être masqué de la boutique (vendu seulement dans le lot).</p>
  </fieldset>`;
}
// Lecture du formulaire (commune à la démonstration et à la version en ligne).
function lireComposants(d) {
  if (d.get('lot') !== 'on') return undefined;
  const ids = d.getAll('composant_id'), qtes = d.getAll('composant_qte');
  return ids.map((id, i) => ({ produitId: id, qte: Math.max(1, Math.min(20, parseInt(qtes[i], 10) || 1)) }));
}
// Garde ce qui a été tapé dans la zone avant de la redessiner (ajout, retrait d'une ligne).
function majZoneLot(modifier) {
  const f = document.querySelector('form[data-form="produit"]'); if (!f || !ui.produitEdite) return;
  const d = new FormData(f);
  ui.produitEdite.composants = lireComposants(d) || [];
  modifier(ui.produitEdite.composants);
  const z = document.getElementById('pf-lot-zone'); if (z) z.innerHTML = zoneLot(ui.produitEdite);
}
document.addEventListener('change', e => {
  if (!(e.target.matches && e.target.matches('[data-lot]')) || !ui.produitEdite) return;
  ui.produitEdite.composants = e.target.checked ? [] : undefined;
  const z = document.getElementById('pf-lot-zone'); if (z) z.innerHTML = zoneLot(ui.produitEdite);
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action="lot-ajouter"], [data-action="lot-retirer"]'); if (!b) return;
  if (b.dataset.action === 'lot-ajouter') majZoneLot(c => { const p = composantsPossibles(ui.produitEdite).find(x => !c.some(y => y.produitId === x.id)); if (p && c.length < 10) c.push({ produitId: p.id, qte: 1 }); });
  else majZoneLot(c => { c.splice(Number(b.dataset.i), 1); });
  const premier = document.querySelector('#pf-lot-zone select'); if (premier) premier.focus();
});
