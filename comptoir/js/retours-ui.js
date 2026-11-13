/* Comptoir — retours partiels (fiche commande) : rembourser une partie des articles, avec un avoir partiel.
   Deux temps : « Calculer » demande au serveur le montant exact (part de remise, carte cadeau, livraison), puis
   « Rembourser » le confirme. Rien n'est calculé côté navigateur : le montant affiché est celui que le serveur remboursera. */
function rembourseePossible(c) { return c.facture && !c.avoir && c.canal !== 'carte' && !c.litige && fluxPour(c).some(([s]) => s === 'remboursee'); }

function blocRetoursPartiels(c) {
  if (typeof connecteAuServeur !== 'function' || !connecteAuServeur()) return '';
  const pieces = c.retoursPartiels || [];
  const peut = rembourseePossible(c) && !(typeof SERVEUR !== 'undefined' && SERVEUR.role === 'commandes');
  if (!pieces.length && !peut) return '';
  const deja = c.lignes.map((l, i) => pieces.reduce((a, p) => a + p.lignes.filter(x => x.index === i).reduce((b, x) => b + x.qte, 0), 0));
  const portRendu = pieces.some(p => p.port);
  const r = ui.retourPartiel && ui.retourPartiel.id === c.id ? ui.retourPartiel : null;
  // Demande de retour du client : quantités proposées d'office (le marchand ajuste à réception du colis).
  const propose = i => r && !r.initial ? (r.saisie.lignes.find(x => x.index === i) || { qte: 0 }).qte
    : c.retour && c.retour.statut === 'demande' ? Math.min(c.lignes[i].qte - deja[i], ((c.retour.lignes || []).find(x => x.ligne === i) || { qte: 0 }).qte) : 0;
  const total = pieces.reduce((a, p) => a + p.montant, 0) / 100;
  return `<div class="bloc retours-partiels"><h3>Retours partiels</h3>
    ${pieces.length ? `<ul class="sous">${pieces.map(p => `<li><b>${esc(p.numero)}</b> · ${new Date(p.date).toLocaleDateString('fr-CH')} · ${euros(p.montant / 100)} : ${p.lignes.map(x => `${x.qte} × ${esc(c.lignes[x.index].nom)}`).join(', ')}${p.port ? `${p.lignes.length ? ', ' : ''}livraison` : ''}${p.carte ? ` (dont ${euros(p.carte / 100)} sur la carte cadeau)` : ''}${p.mode === 'manuel' && p.argent ? ' · à rendre par vos soins' : ''}${p.stock ? '' : ' · non remis en stock'}
      <button class="btn petit fantome" data-action="facture-xml" data-format="pdf" data-id="${esc(c.id)}" data-avoir="${esc(p.numero)}" aria-label="Avoir ${esc(p.numero)} en PDF Factur-X">PDF</button><button class="btn petit fantome" data-action="facture-xml" data-id="${esc(c.id)}" data-avoir="${esc(p.numero)}" aria-label="Avoir ${esc(p.numero)} en XML EN 16931">XML</button></li>`).join('')}</ul>
      <p class="sous">Total remboursé : ${euros(total)} sur ${euros(c.total)}.</p>` : ''}
    ${peut && !r ? `<button class="btn petit fantome" data-action="retour-partiel-ouvrir" data-id="${esc(c.id)}">${c.retour && c.retour.statut === 'demande' ? 'Rembourser les articles retournés…' : 'Retour partiel…'}</button>` : ''}
    ${peut && r ? `<form data-form="retour-partiel" data-id="${esc(c.id)}">
      <table class="table compacte"><caption class="sous">Quantité retournée par article</caption><tbody>
      ${c.lignes.map((l, i) => { const reste = l.qte - deja[i]; return `<tr><td><label for="rp-${esc(c.id)}-${i}">${esc(l.nom)}</label><div class="sous">${l.qte} acheté${l.qte > 1 ? 's' : ''}${deja[i] ? `, ${deja[i]} déjà rendu${deja[i] > 1 ? 's' : ''}` : ''}</div></td>
        <td class="num"><input id="rp-${esc(c.id)}-${i}" name="q-${i}" type="number" min="0" max="${reste}" step="1" value="${Math.max(0, propose(i))}" ${reste ? '' : 'disabled'} class="champ-court"></td></tr>`; }).join('')}
      </tbody></table>
      ${c.port && !portRendu ? `<label class="case"><input type="checkbox" name="port" ${r.saisie.port ? 'checked' : ''}> Rembourser aussi la livraison (${euros(c.port)})</label>` : ''}
      <label class="case"><input type="checkbox" name="stock" ${r.saisie.remettreEnStock !== false ? 'checked' : ''}> Remettre les articles en stock (décochez s’ils sont abîmés)</label>
      <label class="champ"><span>Motif (interne, facultatif)</span><input name="motif" maxlength="200" value="${esc(r.saisie.motif || '')}"></label>
      ${r.apercu ? `<p class="encart" role="status">À rembourser : <b>${euros(r.apercu.montant / 100)}</b>${r.apercu.carte ? `, dont ${euros(r.apercu.carte / 100)} recrédités sur la carte cadeau` : ''}${r.apercu.argent ? `${r.apercu.carte ? ' et ' : ', '}${euros(r.apercu.argent / 100)} ${r.apercu.mode === 'stripe' ? 'remboursés automatiquement sur le moyen de paiement du client' : r.apercu.mode === 'manuel' ? 'à rendre au client par vos soins (virement, espèces)' : 'remboursés (simulation)'}` : ''}. Un avoir partiel sera émis et le client prévenu par e-mail.</p>` : '<p class="sous">La part de remise des articles est déduite automatiquement. Calculez le montant avant de confirmer.</p>'}
      ${r.erreur ? `<p class="alerte-texte" role="alert" tabindex="-1">${esc(r.erreur)}</p>` : ''}
      <div class="rangee"><button class="btn fantome" name="action" value="apercu">Calculer le montant</button>${r.apercu ? `<button class="btn danger" name="action" value="confirmer">Rembourser ${euros(r.apercu.montant / 100)}</button>` : ''}<button type="button" class="btn fantome" data-action="retour-partiel-fermer">Annuler</button></div>
    </form>` : ''}
  </div>`;
}

function saisieRetour(form) {
  const c = etat.commandes.find(x => x.id === form.dataset.id), f = new FormData(form);
  return { lignes: c.lignes.map((l, i) => ({ index: i, qte: Number(f.get(`q-${i}`)) || 0 })).filter(x => x.qte > 0), port: f.get('port') === 'on', remettreEnStock: f.get('stock') === 'on', motif: String(f.get('motif') || '') };
}

document.addEventListener('click', e => {
  const o = e.target.closest('[data-action="retour-partiel-ouvrir"]');
  if (o) { ui.retourPartiel = { id: o.dataset.id, saisie: { lignes: [], remettreEnStock: true }, apercu: null, initial: true }; rendre(); const champ = document.querySelector('[data-form="retour-partiel"] input:not([disabled])'); if (champ) champ.focus(); return; }
  const f = e.target.closest('[data-action="retour-partiel-fermer"]');
  if (f) { ui.retourPartiel = null; rendre(); const b = document.querySelector('[data-action="retour-partiel-ouvrir"]'); if (b) b.focus(); }
});
// Une quantité changée rend l'aperçu caduc : il faut recalculer avant de confirmer.
document.addEventListener('input', e => {
  const form = e.target.closest('[data-form="retour-partiel"]'); if (!form || !ui.retourPartiel || !ui.retourPartiel.apercu) return;
  const bouton = form.querySelector('button[value="confirmer"]'); if (bouton) { bouton.disabled = true; bouton.textContent = 'Recalculez le montant'; }
  ui.retourPartiel.apercu = null;
});
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form="retour-partiel"]'); if (!form) return;
  e.preventDefault();
  const action = e.submitter && e.submitter.value === 'confirmer' ? 'confirmer' : 'apercu';
  const saisie = saisieRetour(form), id = form.dataset.id;
  ui.retourPartiel = { id, saisie, apercu: null, initial: false };
  for (const b of form.querySelectorAll('button')) b.disabled = true;
  try {
    if (action === 'apercu') {
      ui.retourPartiel.apercu = (await api('POST', `/api/admin/commandes/${encodeURIComponent(id)}/retour-partiel`, { ...saisie, apercu: true })).apercu;
    } else {
      const r = await api('POST', `/api/admin/commandes/${encodeURIComponent(id)}/retour-partiel`, saisie);
      ui.retourPartiel = null;
      await rafraichir(`Retour partiel remboursé : avoir ${r.avoir} émis, client prévenu.`);
      return;
    }
  } catch (err) { ui.retourPartiel.erreur = err.message; }
  rendre();
  const cible = document.querySelector(`[data-form="retour-partiel"] ${ui.retourPartiel && ui.retourPartiel.apercu ? 'button[value="confirmer"]' : '[role="alert"], input:not([disabled])'}`);
  if (cible) cible.focus();
});
