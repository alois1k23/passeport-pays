/* Comptoir — Paramètres > Clients pro : comptes professionnels (remise, facture et plafond).
   Le client pro se connecte dans la boutique avec un code reçu par e-mail ; ses prix et sa facture sont appliqués par le
   serveur. */
const PRO_UI = { donnees: null, chargement: false, erreur: '', edite: null };

function chargerPro() {
  if (PRO_UI.chargement) return;
  PRO_UI.chargement = true;
  api('GET', '/api/admin/pro').then(d => { PRO_UI.donnees = d; PRO_UI.erreur = ''; }).catch(e => { PRO_UI.erreur = e.message; }).finally(() => { PRO_UI.chargement = false; rendre(); });
}
function vuePro() {
  const intro = `<section class="carte"><div class="carte-tete"><h2>Clients professionnels</h2></div>
    <p class="sous">Hôtels, restaurants, revendeurs : ouvrez-leur un compte pro. Dans votre boutique, ils se connectent avec un code reçu par e-mail (lien « Espace pro » en bas de page) et voient leurs prix remisés. S’ils y ont droit, ils paient sur facture QR, dans la limite d’un plafond d’impayés.</p></section>`;
  if (!(typeof enLigne === 'function' && enLigne())) return intro + '<section class="carte"><p class="sous">Disponible une fois votre boutique en ligne.</p></section>';
  const d = PRO_UI.donnees;
  if (!d && PRO_UI.erreur) return intro + `<section class="carte"><p class="encart alerte-encart" role="alert">${esc(PRO_UI.erreur)}</p></section>`;
  if (!d) { chargerPro(); return intro + '<section class="carte"><p class="sous">Chargement…</p></section>'; }
  const e = PRO_UI.edite || {};
  const liste = d.clients.length ? `<div class="table-wrap"><table class="table compacte table-cartes"><thead><tr><th>Entreprise</th><th>E-mail</th><th class="num">Remise</th><th>Facture</th><th></th></tr></thead><tbody>
    ${d.clients.map(c => c.illisible ? `<tr><td colspan="4" class="sous">Compte illisible avec les clés actuelles</td><td class="num"><button class="btn petit fantome danger" data-action="pro-supprimer" data-id="${esc(c.id)}">Supprimer</button></td></tr>` : `<tr><td class="carte-titre">${esc(c.raison)}${c.ide ? `<br><span class="sous mono">${esc(c.ide)}</span>` : ''}</td><td data-label="E-mail" class="carte-plein">${esc(c.email)}</td><td class="num" data-label="Remise">${c.remise ? `−${c.remise} %` : '—'}</td><td data-label="Facture">${c.facture ? `Oui, jusqu’à ${esc(euros(c.plafond))}` : 'Non'}</td>
      <td class="num carte-plein"><button class="btn petit fantome" data-action="pro-modifier" data-id="${esc(c.id)}">Modifier</button> <button class="btn petit fantome danger" data-action="pro-supprimer" data-id="${esc(c.id)}">Supprimer</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="sous">Aucun client pro pour l’instant.</p>';
  const form = `<form data-form="pro" class="grille-form">
    <h3 id="pro-form-titre" tabindex="-1">${e.id ? `Modifier ${esc(e.raison || '')}` : 'Nouveau client pro'}</h3>
    <label class="champ"><span>Raison sociale</span><input name="raison" required maxlength="120" value="${esc(e.raison || '')}"></label>
    <label class="champ"><span>E-mail de commande</span><input name="email" type="email" required value="${esc(e.email || '')}" autocomplete="off"></label>
    <label class="champ"><span>Numéro de TVA ou IDE (facultatif)</span><input name="ide" maxlength="30" value="${esc(e.ide || '')}" placeholder="CHE-123.456.789"></label>
    <label class="champ"><span>Remise (%)</span><input name="remise" type="number" min="0" max="50" step="0.5" value="${e.remise ?? 10}"></label>
    <label class="case case-longue"><input type="checkbox" name="facture" ${e.facture ? 'checked' : ''} ${d.factureDisponible ? '' : 'disabled'}> Peut payer sur facture QR${d.factureDisponible ? '' : ' (renseignez d’abord un IBAN suisse et l’adresse complète de l’entreprise)'}</label>
    <label class="champ"><span>Plafond des factures impayées (${devise()})</span><input name="plafond" type="number" min="0" step="1" value="${e.plafond ?? 1000}"></label>
    <div class="rangee"><button class="btn">${e.id ? 'Enregistrer' : 'Ouvrir le compte'}</button>${e.id ? '<button type="button" class="btn fantome" data-action="pro-annuler">Annuler</button>' : ''}</div>
  </form>`;
  return intro + `<section class="carte"><div class="carte-tete"><h2>Comptes pro</h2><span class="sous">${d.clients.length} / 500</span></div>${liste}</section><section class="carte">${form}</section>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action^="pro-"]'); if (!b) return;
  const a = b.dataset.action;
  if (a === 'pro-modifier') { PRO_UI.edite = { ...PRO_UI.donnees.clients.find(c => c.id === b.dataset.id) }; rendre(); const t = document.getElementById('pro-form-titre'); if (t) t.focus(); return; }
  if (a === 'pro-annuler') { PRO_UI.edite = null; rendre(); return; }
  if (a === 'pro-supprimer') {
    if (!confirm('Supprimer ce compte pro ? Le client perd ses prix professionnels et sa session est fermée.')) return;
    try { await api('DELETE', `/api/admin/pro/${encodeURIComponent(b.dataset.id)}`); toast('Compte pro supprimé.'); PRO_UI.donnees = null; } catch (err) { toast(err.message); }
    rendre();
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="pro"]'); if (!f) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const d = new FormData(f);
  const corps = { raison: d.get('raison'), email: d.get('email'), ide: d.get('ide'), remise: Number(d.get('remise')), facture: d.get('facture') === 'on', plafond: Number(d.get('plafond')) };
  try {
    if (PRO_UI.edite && PRO_UI.edite.id) await api('PUT', `/api/admin/pro/${encodeURIComponent(PRO_UI.edite.id)}`, corps);
    else await api('POST', '/api/admin/pro', corps);
    toast(PRO_UI.edite && PRO_UI.edite.id ? 'Compte pro enregistré.' : `Compte pro ouvert : ${corps.raison}.`);
    PRO_UI.edite = null; PRO_UI.donnees = null;
  } catch (err) { toast(err.message); }
  rendre();
}, true);
