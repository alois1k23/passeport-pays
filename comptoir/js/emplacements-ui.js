/* Comptoir — stock sur plusieurs emplacements (page Magasin et caisse) : emplacements, répartition, transferts. */
function carteEmplacements() {
  if (!connecteAuServeur() || (typeof SERVEUR !== 'undefined' && SERVEUR.role === 'commandes')) return '';
  if (!ui.emplacements && !ui.emplacementsEnCours) setTimeout(chargerEmplacements, 0);
  const d = ui.emplacements; if (!d) return '';
  const liste = d.emplacements, produits = etat.produits.filter(p => p.type !== 'drop');   // produits masqués compris : leur stock est aussi quelque part
  const unites = produits.flatMap(p => Array.isArray(p.variantes) && p.variantes.length ? p.variantes.map(v => ({ p, v })) : [{ p, v: null }]);
  const q = (p, v, e) => ((d.repartition[p.id] || {})[v ? v.id : ''] || {})[e.id] || 0;
  const types = d.types || { magasin: 'Magasin', entrepot: 'Entrepôt', depot: 'Dépôt' };
  // Contenu de chaque emplacement d'après la répartition du serveur (tous produits) : « vide » ne dépend pas de la liste locale.
  const contenu = e => Object.values(d.repartition).reduce((a, parV) => a + Object.values(parV).reduce((b, parE) => b + (parE[e.id] || 0), 0), 0);
  const filtre = String(ui.empFiltre || '').trim().toLowerCase();
  const visibles = unites.filter(({ p, v }) => !filtre || `${p.nom} ${v ? v.valeurs.join(' ') : ''}`.toLowerCase().includes(filtre));
  return `<details class="carte emplacements" ${ui.emplacementsOuvert ? 'open' : ''} data-emplacements><summary><h2>Emplacements de stock</h2><span class="sous">${liste.length ? `${liste.length} emplacement${liste.length > 1 ? 's' : ''}` : 'Un seul stock pour l’instant'}</span></summary>
    <p class="sous">Magasin, entrepôt, dépôt : le stock affiché en boutique reste le total. Une vente en caisse prend d’abord dans un magasin, une vente en ligne d’abord dans un entrepôt. Le premier emplacement créé reçoit tout le stock actuel et devient l’emplacement principal.</p>
    ${d.ecarts && d.ecarts.length ? `<p class="alerte-texte" role="alert">${d.ecarts.length} écart(s) entre la répartition et le stock : enregistrez à nouveau la fiche du produit concerné pour les corriger (l’écart va à l’emplacement principal).</p>` : ''}
    <form data-form="emplacement" class="rangee">
      <label class="champ"><span>Nouvel emplacement</span><input name="nom" maxlength="60" required placeholder="Entrepôt de Vevey"></label>
      <label class="champ"><span>Type</span><select name="type">${Object.entries(types).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <button class="btn">Ajouter</button>
    </form>
    ${liste.length >= 2 ? `<form data-form="transfert" class="rangee">
      <label class="champ"><span>Article</span><select name="unite" required>${visibles.slice(0, 300).map(({ p, v }) => `<option value="${esc(p.id)}|${esc(v ? v.id : '')}">${esc(p.nom)}${v ? ` (${esc(v.valeurs.join(' / '))})` : ''}</option>`).join('')}</select></label>
      <label class="champ"><span>De</span><select name="de">${liste.map(e => `<option value="${esc(e.id)}">${esc(e.nom)}</option>`).join('')}</select></label>
      <label class="champ"><span>Vers</span><select name="vers">${liste.map((e, i) => `<option value="${esc(e.id)}" ${i === 1 ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}</select></label>
      <label class="champ"><span>Quantité</span><input name="quantite" type="number" min="1" step="1" required class="champ-court"></label>
      <button class="btn">Transférer</button>
    </form>` : ''}
    ${liste.length && unites.length > 20 ? `<label class="champ"><span>Chercher un article</span><input type="search" data-emp-filtre value="${esc(ui.empFiltre || '')}" placeholder="Nom, taille, couleur…"></label>` : ''}
    ${liste.length ? `<div class="tableau-defilant"><table class="table compacte"><caption class="sous">Répartition du stock</caption><thead><tr><th>Article</th>${liste.map((e, i) => `<th class="num">${esc(e.nom)}<div class="sous">${types[e.type] || ''}${i === 0 ? ' · principal' : ''}</div></th>`).join('')}<th class="num">Total</th><th></th></tr></thead><tbody>
      ${visibles.slice(0, 100).map(({ p, v }) => `<tr><td>${esc(p.nom)}${v ? ` <span class="sous">${esc(v.valeurs.join(' / '))}</span>` : ''}</td>${liste.map(e => `<td class="num">${q(p, v, e)}</td>`).join('')}<td class="num"><b>${v ? v.stock : p.stock}</b></td><td></td></tr>`).join('')}
      ${visibles.length > 100 ? `<tr><td colspan="${liste.length + 3}" class="sous">${visibles.length - 100} autres articles : précisez la recherche.</td></tr>` : ''}
      <tr><td></td>${liste.map(e => `<td class="num">${contenu(e) > 0 || liste[0].id === e.id && liste.length > 1 ? '' : `<button class="btn petit fantome" data-action="emplacement-supprimer" data-id="${esc(e.id)}" aria-label="Supprimer l’emplacement ${esc(e.nom)}">Supprimer</button>`}</td>`).join('')}<td></td><td></td></tr>
    </tbody></table></div>` : ''}
  </details>`;
}
async function chargerEmplacements() {
  ui.emplacementsEnCours = true;
  try { ui.emplacements = await api('GET', '/api/admin/emplacements'); } catch { ui.emplacements = null; }
  finally { ui.emplacementsEnCours = false; }
  if (location.hash.startsWith('#magasin') && ui.emplacements) rendre();
}
document.addEventListener('submit', async e => {
  const f = e.target.dataset.form; if (f !== 'emplacement' && f !== 'transfert') return;
  e.preventDefault();
  const d = new FormData(e.target), b = e.target.querySelector('button'); b.disabled = true;
  try {
    if (f === 'emplacement') { const r = await api('POST', '/api/admin/emplacements', { nom: d.get('nom'), type: d.get('type') }); toast(`Emplacement « ${r.emplacement.nom} » ajouté.`); }
    else { const [produitId, varianteId] = String(d.get('unite')).split('|'); await api('POST', '/api/admin/emplacements/transferts', { produitId, varianteId: varianteId || undefined, de: d.get('de'), vers: d.get('vers'), quantite: Number(d.get('quantite')) }); toast('Transfert enregistré.'); }
    await chargerEmplacements(); rendre();
  } catch (err) { toast(err.message); b.disabled = false; }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action="emplacement-supprimer"]'); if (!el) return;
  if (!confirm('Supprimer cet emplacement vide ?')) return;
  try { await api('DELETE', `/api/admin/emplacements/${encodeURIComponent(el.dataset.id)}`); await chargerEmplacements(); rendre(); } catch (err) { toast(err.message); }
});
document.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('[data-emplacements]')) ui.emplacementsOuvert = e.target.open; }, true);
document.addEventListener('input', e => {
  if (!e.target.matches || !e.target.matches('[data-emp-filtre]')) return;
  ui.empFiltre = e.target.value; clearTimeout(ui.empMinuteur); ui.empMinuteur = setTimeout(() => { rendre(); const c = document.querySelector('[data-emp-filtre]'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); } }, 250);
});
