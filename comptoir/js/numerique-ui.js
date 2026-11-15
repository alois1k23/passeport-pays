/* Comptoir — produits numériques dans la fiche produit : le fichier livré par e-mail après paiement.
   Envoi en morceaux d'1 Mo avec l'empreinte SHA-256 du fichier, calculée ici et contrôlée par le serveur à la fin. */
const NUMERIQUE_UI = { envoi: null };

function blocFichierNumerique(p) {
  if (p.type === 'drop') return '';
  return `<label class="case case-longue"><input id="pf-numerique" type="checkbox" name="numerique" ${p.numerique ? 'checked' : ''} data-numerique> Produit numérique : fichier envoyé par e-mail après paiement, sans livraison</label>
    <div id="pf-fichier-zone">${zoneFichierNumerique(p)}</div>`;
}
function zoneFichierNumerique(p) {
  const enLigneOk = typeof enLigne === 'function' && enLigne(), existe = etat.produits.some(x => x.id === p.id);
  const f = p.fichier;
  const taille = n => n >= 1048576 ? `${(n / 1048576).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${p.numerique ? `<div class="encart" id="pf-fichier">
      ${!enLigneOk ? '<p class="sous">En démonstration, le fichier ne s’envoie pas : il le sera une fois la boutique en ligne.</p>'
        : !existe ? '<p class="sous">Enregistrez d’abord le produit, puis ajoutez son fichier.</p>'
        : `<p>${f ? `Fichier : <b>${esc(f.nom)}</b> <span class="sous">(${taille(f.taille)})</span>` : '<b>Aucun fichier pour l’instant</b> : le produit n’est pas proposé à la vente tant qu’il n’a pas son fichier.'}</p>
          <div class="rangee"><button type="button" class="btn petit" data-action="numerique-choisir" data-id="${esc(p.id)}">${f ? 'Remplacer le fichier' : 'Ajouter le fichier'}</button>${f ? `<button type="button" class="btn petit fantome danger" data-action="numerique-retirer" data-id="${esc(p.id)}">Retirer</button>` : ''}
          <input type="file" id="pf-fichier-input" data-id="${esc(p.id)}" hidden aria-label="Fichier à livrer"></div>
          <progress id="pf-fichier-progres" max="100" value="0" hidden></progress>
          <p class="sous">PDF, EPUB, ZIP, MP3, MP4, images… 25 Mo au plus. Chaque acheteur reçoit un lien personnel : 5 téléchargements pendant 30 jours.</p>`}
    </div>` : ''}`;
}

async function envoyerFichierNumerique(pid, fichier) {
  if (!fichier) return;
  if (fichier.size > 25 * 1024 * 1024) { toast('Fichier de 25 Mo au plus.'); return; }
  const progres = document.getElementById('pf-fichier-progres');
  try {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const empreinte = [...new Uint8Array(await crypto.subtle.digest('SHA-256', octets))].map(x => x.toString(16).padStart(2, '0')).join('');
    const d = await api('POST', `/api/admin/produits/${encodeURIComponent(pid)}/fichier/debut`, { nom: fichier.name, taille: fichier.size, empreinte });
    if (progres) { progres.hidden = false; progres.value = 0; }
    for (let i = 0; i < d.morceaux; i++) {
      const part = octets.subarray(i * d.morceau, (i + 1) * d.morceau);
      let bin = ''; for (let k = 0; k < part.length; k += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(k, k + 0x8000));
      await api('POST', `/api/admin/produits/${encodeURIComponent(pid)}/fichier/morceau`, { envoi: d.envoi, rang: i, donnees: btoa(bin) });
      if (progres) progres.value = Math.round((i + 1) / d.morceaux * 100);
    }
    const r = await api('POST', `/api/admin/produits/${encodeURIComponent(pid)}/fichier/fin`, { envoi: d.envoi });
    const prod = etat.produits.find(x => x.id === pid); if (prod) prod.fichier = r.fichier;
    if (ui.produitEdite && ui.produitEdite.id === pid) ui.produitEdite.fichier = r.fichier;
    toast(`Fichier « ${r.fichier.nom} » enregistré.`);
  } catch (e) { toast(e.message); }
  majZoneFichier();
}
function majZoneFichier() {
  const z = document.getElementById('pf-fichier-zone');
  if (z && ui.produitEdite) z.innerHTML = zoneFichierNumerique(ui.produitEdite); else rendre();
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action="numerique-choisir"], [data-action="numerique-retirer"]'); if (!b) return;
  if (b.dataset.action === 'numerique-choisir') { const i = document.getElementById('pf-fichier-input'); if (i) { i.dataset.id = b.dataset.id; i.value = ''; i.click(); } return; }
  if (!confirm('Retirer ce fichier ? Les acheteurs dont le lien est encore valable ne pourront plus le télécharger.')) return;
  try {
    await api('DELETE', `/api/admin/produits/${encodeURIComponent(b.dataset.id)}/fichier`);
    const prod = etat.produits.find(x => x.id === b.dataset.id); if (prod) prod.fichier = null;
    if (ui.produitEdite && ui.produitEdite.id === b.dataset.id) ui.produitEdite.fichier = null;
    toast('Fichier retiré.');
  } catch (err) { toast(err.message); }
  majZoneFichier();
});
document.addEventListener('change', e => {
  if (e.target.id === 'pf-fichier-input') envoyerFichierNumerique(e.target.dataset.id, e.target.files && e.target.files[0]);
  // Case « numérique » : seule la zone du fichier change (le reste du formulaire garde ce qui a été tapé).
  else if (e.target.matches && e.target.matches('[data-numerique]') && ui.produitEdite) {
    ui.produitEdite.numerique = e.target.checked;
    const z = document.getElementById('pf-fichier-zone'); if (z) z.innerHTML = zoneFichierNumerique(ui.produitEdite);
  }
});
// Commande : nouveaux liens de téléchargement (les anciens cessent de fonctionner).
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action="renvoyer-liens"]'); if (!b) return;
  if (!confirm('Envoyer de nouveaux liens au client ? Les anciens cesseront de fonctionner.')) return;
  b.disabled = true;
  try { const r = await api('POST', `/api/admin/commandes/${encodeURIComponent(b.dataset.id)}/telechargements`); toast(`${r.envoyes} lien${r.envoyes > 1 ? 's' : ''} envoyé${r.envoyes > 1 ? 's' : ''} au client.`); }
  catch (err) { toast(err.message); }
  b.disabled = false;
});

