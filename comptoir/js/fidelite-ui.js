/* Comptoir — programme de fidélité (espace marchand, page Clients) : réglages et état des points en circulation. */
function carteFidelite() {
  if (!connecteAuServeur() || (typeof SERVEUR !== 'undefined' && SERVEUR.role === 'commandes')) return '';
  if (!ui.fidelite && !ui.fideliteEnCours) setTimeout(chargerFidelite, 0);
  const f = ui.fidelite; if (!f) return '';
  const r = f.reglages, valeur = n => euros(Math.floor(n * r.valeurPour100 / 100) / 100);
  return `<details class="carte fidelite" ${r.actif ? '' : 'open'}><summary><h2>Programme de fidélité</h2><span class="sous">${r.actif ? `Actif · ${f.stats.membres} client${f.stats.membres > 1 ? 's' : ''} avec des points · ${f.stats.points.toLocaleString('fr-FR')} points en circulation (${valeur(f.stats.points)})` : 'Inactif'}</span></summary>
    ${r.actif && f.stats.bientot && f.stats.bientot.points ? `<p class="sous">${f.stats.bientot.points.toLocaleString('fr-FR')} points (${valeur(f.stats.bientot.points)}, ${f.stats.bientot.comptes} client${f.stats.bientot.comptes > 1 ? 's' : ''}) expirent dans les 30 jours sans nouvel achat. Vous pouvez le rappeler aux clients qui ont accepté vos e-mails.</p>` : ''}
    <p class="sous">Sans compte client : vos clients gagnent des points à chaque commande payée en ligne et les utilisent comme remise. Pour les utiliser, ils reçoivent un code par e-mail : connaître leur adresse ne suffit pas. Les adresses ne sont pas stockées en clair.</p>
    <form data-form="fidelite">
      <label class="case"><input type="checkbox" name="actif" ${r.actif ? 'checked' : ''}> Activer le programme</label>
      <div class="grille-2">
        <label class="champ"><span>Points gagnés par ${estSuisse() ? 'franc' : 'euro'} dépensé</span><input name="pointsParUnite" type="number" min="1" max="100" step="1" value="${r.pointsParUnite}" required></label>
        <label class="champ"><span>Valeur de 100 points (${estSuisse() ? 'centimes' : 'centimes d’euro'})</span><input name="valeurPour100" type="number" min="10" max="5000" step="1" value="${r.valeurPour100}" required></label>
        <label class="champ"><span>Points minimum pour les utiliser</span><input name="seuil" type="number" min="10" max="100000" step="1" value="${r.seuil}" required></label>
        <label class="champ"><span>Part maximale d’une commande payée en points (%)</span><input name="plafondPct" type="number" min="5" max="90" step="1" value="${r.plafondPct}" required></label>
        <label class="champ"><span>Expiration après inactivité (mois)</span><input name="expirationMois" type="number" min="6" max="120" step="1" value="${r.expirationMois}" required></label>
      </div>
      <p class="sous" id="fid-exemple">Exemple : une commande de ${euros(100)} rapporte ${100 * r.pointsParUnite} points, soit ${valeur(100 * r.pointsParUnite)} de remise sur une prochaine commande (${(r.pointsParUnite * r.valeurPour100 / 100).toLocaleString('fr-FR')} % reversés).</p>
      ${f.registreCoherent ? '' : '<p class="alerte-texte" role="alert">Registre des points incohérent : contactez le support.</p>'}
      <button class="btn">Enregistrer</button>
    </form></details>`;
}
async function chargerFidelite() {
  ui.fideliteEnCours = true;
  try { ui.fidelite = await api('GET', '/api/admin/fidelite'); } catch { ui.fidelite = null; }
  finally { ui.fideliteEnCours = false; }
  if (location.hash.startsWith('#clients') && ui.fidelite) rendre();
}
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'fidelite') return;
  e.preventDefault();
  const d = new FormData(e.target), b = e.target.querySelector('button');
  // Durée raccourcie : les points des clients inactifs depuis plus longtemps expirent aussitôt, sans retour possible.
  const avant = ui.fidelite && ui.fidelite.reglages ? ui.fidelite.reglages.expirationMois : null, apres = Number(d.get('expirationMois'));
  if (avant && apres < avant && !confirm(`Passer l’expiration de ${avant} à ${apres} mois ? Les points des clients sans achat depuis plus de ${apres} mois expireront dans les prochaines minutes, sans retour possible.`)) return;
  b.disabled = true;
  try {
    const r = await api('PUT', '/api/admin/fidelite', { actif: d.get('actif') === 'on', ...Object.fromEntries(['pointsParUnite', 'valeurPour100', 'seuil', 'plafondPct', 'expirationMois'].map(k => [k, Number(d.get(k))])) });
    ui.fidelite = { ...ui.fidelite, reglages: r.reglages }; toast(r.reglages.actif ? 'Programme de fidélité enregistré.' : 'Programme de fidélité désactivé.'); rendre();
  } catch (err) { toast(err.message); b.disabled = false; }
});
