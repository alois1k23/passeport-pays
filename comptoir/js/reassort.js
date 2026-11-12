/* Comptoir — bon de réassort : à partir de la prévision de rupture (rythme des 28 derniers jours), les quantités à
   recommander pour tenir 30 jours, par produit et par variante. Le marchand ajuste, puis copie le texte pour son
   fournisseur ou exporte un CSV. Rien n'est envoyé automatiquement. */
const REASSORT = { qte: {}, jours: 30 };
function besoinsReassort(jours = REASSORT.jours) {
  const depuis = Date.now() - 28 * 86400000, out = [];
  for (const p of etat.produits.filter(x => x.actif !== false && x.type !== 'drop')) {
    const vendus = {};
    let premiere = Date.now();
    for (const c of etat.commandes) {
      if (c.date < depuis || ['annulee', 'remboursee', 'attente'].includes(c.statut)) continue;
      for (const l of c.lignes || []) if (l.produitId === p.id) { const k = l.varianteId || ''; vendus[k] = (vendus[k] || 0) + (l.qte || 0); premiere = Math.min(premiere, c.date); }
    }
    const periode = Math.max(7, Math.min(28, (Date.now() - premiere) / 86400000));
    const lignes = Array.isArray(p.variantes) && p.variantes.length ? p.variantes.map(v => ({ cle: `${p.id}|${v.id}`, nom: `${p.nom} (${v.valeurs.join(' / ')})`, stock: v.stock, vendus: vendus[v.id] || 0 })) : [{ cle: `${p.id}|`, nom: p.nom, stock: p.stock, vendus: Object.values(vendus).reduce((a, x) => a + x, 0) }];
    for (const l of lignes) {
      const parJour = l.vendus / periode, conseil = l.vendus >= 2 ? Math.max(0, Math.ceil(parJour * jours) - l.stock) : 0;
      if (conseil > 0 || l.stock <= 2) out.push({ ...l, parJour, conseil, cout: p.cout });
    }
  }
  return out.sort((a, b) => b.conseil - a.conseil);
}
function vueReassort() {
  const lignes = besoinsReassort();
  const q = l => REASSORT.qte[l.cle] ?? l.conseil;
  const total = lignes.reduce((a, l) => a + q(l) * (Number(l.cout) || 0), 0);
  return `<section class="carte"><div class="carte-tete"><h2>Bon de réassort</h2><button class="btn petit fantome" data-action="reassort-fermer">Fermer</button></div>
    <p class="sous">Quantités conseillées pour tenir ${REASSORT.jours} jours au rythme des 28 derniers jours (produits en stock, par variante). Ajustez, puis copiez le texte pour votre fournisseur ou exportez le tableau.</p>
    ${lignes.length ? `<div class="table-wrap"><table class="table compacte"><thead><tr><th>Produit</th><th class="num">Stock</th><th class="num">Vendus 28 j</th><th class="num">À commander</th></tr></thead><tbody>
      ${lignes.map(l => `<tr><td>${esc(l.nom)}</td><td class="num">${l.stock}</td><td class="num">${l.vendus}</td><td class="num"><input type="number" min="0" step="1" value="${q(l)}" data-reassort="${esc(l.cle)}" aria-label="Quantité à commander : ${esc(l.nom)}" class="qte-lien"></td></tr>`).join('')}
    </tbody></table></div>
    ${total > 0 ? `<p class="sous">Coût d’achat estimé : <b>${euros(total)}</b> (d’après les coûts saisis dans vos fiches).</p>` : ''}
    <div class="rangee"><button class="btn" data-action="reassort-copier">Copier le texte pour le fournisseur</button><button class="btn fantome" data-action="reassort-csv">Exporter (CSV)</button></div>`
    : '<p class="sous">Rien à recommander pour l’instant : aucun produit en stock ne risque de manquer.</p>'}</section>`;
}
const texteReassort = () => {
  const lignes = besoinsReassort().map(l => ({ ...l, q: REASSORT.qte[l.cle] ?? l.conseil })).filter(l => l.q > 0);
  return `Bonjour,\n\nPourriez-vous me confirmer la disponibilité et le délai pour la commande suivante :\n${lignes.map(l => `- ${l.q} × ${l.nom}`).join('\n')}\n\nMerci,\n${(etat.entreprise && etat.entreprise.raison) || etat.boutique.nom}`;
};
document.addEventListener('input', e => {
  const i = e.target.closest('[data-reassort]'); if (!i) return;
  REASSORT.qte[i.dataset.reassort] = Math.max(0, parseInt(i.value, 10) || 0);
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action^="reassort"]'); if (!el) return;
  const a = el.dataset.action;
  if (a === 'reassort') { ui.reassort = !ui.reassort; rendre(); return; }
  if (a === 'reassort-fermer') { ui.reassort = false; rendre(); return; }
  if (a === 'reassort-copier') { try { await navigator.clipboard.writeText(texteReassort()); toast('Texte copié : collez-le dans un e-mail à votre fournisseur.'); } catch { toast('Copie impossible dans ce navigateur.'); } return; }
  if (a === 'reassort-csv') {
    const lignes = besoinsReassort().map(l => ({ ...l, q: REASSORT.qte[l.cle] ?? l.conseil })).filter(l => l.q > 0);
    const csv = '\ufeff' + ['produit', 'stock', 'vendus_28j', 'a_commander'].join(';') + '\n' + lignes.map(l => [csvTexte(l.nom), l.stock, l.vendus, l.q].join(';')).join('\n');
    try { const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const lien = Object.assign(document.createElement('a'), { href: url, download: `comptoir-reassort-${new Date().toISOString().slice(0, 10)}.csv` }); document.body.appendChild(lien); lien.click(); lien.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    catch { toast('Export impossible dans cet aperçu.'); }
  }
});
