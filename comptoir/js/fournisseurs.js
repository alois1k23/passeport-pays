/* Comptoir — fournisseurs : fiche par fournisseur, délais annoncés et mesurés,
   remboursements, liste de contrôle (échantillon, réactivité, délai tenu) et
   routage vers l’entrepôt le plus proche du client (fait automatiquement par le serveur). */

function etatSuiviFournisseurs() { etat.fournisseursSuivi = etat.fournisseursSuivi || {}; return etat.fournisseursSuivi; }

function fichesFournisseurs() {
  const parNom = {};
  for (const p of etat.produits.filter(x => x.type === 'drop' && x.fournisseur)) {
    const f = parNom[p.fournisseur] = parNom[p.fournisseur] || { nom: p.fournisseur, produits: [], entrepots: new Set(), delais: [], note: null };
    f.produits.push(p); f.entrepots.add(p.entrepot); if (p.delai) f.delais.push(p.delai);
    const cat = CATALOGUE.find(c => c.id === p.source);
    if (cat) f.note = cat.note;
  }
  return Object.values(parNom).map(f => {
    const ids = new Set(f.produits.map(p => p.id));
    const commandes = etat.commandes.filter(c => c.lignes.some(l => ids.has(l.produitId)) && c.statut !== 'attente');
    const remb = commandes.filter(c => c.statut === 'remboursee').length;
    // Délai réel : de la transmission au fournisseur à l’expédition (historique des commandes)
    const mesures = [];
    for (const c of commandes) {
      const t = c.historique.find(h => /^Transmise/.test(h.texte)), x = c.historique.find(h => /^Expédiée/.test(h.texte));
      if (t && x && x.date > t.date) mesures.push((x.date - t.date) / 86400000);
    }
    const annonce = f.delais.length ? [Math.min(...f.delais.map(d => d[0])), Math.max(...f.delais.map(d => d[1]))] : null;
    return { ...f, entrepots: [...f.entrepots], annonce, commandes: commandes.length, tauxRemb: commandes.length ? remb / commandes.length : 0, expeditionMoy: mesures.length ? mesures.reduce((a, b) => a + b, 0) / mesures.length : null, nMesures: mesures.length };
  }).sort((a, b) => b.commandes - a.commandes);
}

/* Produits pour lesquels le même article existe dans un entrepôt plus proche. */
function alternativesProches() {
  const rang = e => (estSuisse() ? { CH: 0, UE: 1, CN: 2 } : { UE: 0, CH: 1, CN: 2 })[e] ?? 3;
  return etat.produits.filter(p => p.type === 'drop' && p.source).map(p => {
    const actuel = CATALOGUE.find(c => c.id === p.source);
    if (!actuel) return null;
    const mieux = CATALOGUE.filter(c => c.nom === actuel.nom && rang(c.entrepot) < rang(actuel.entrepot)).sort((a, b) => rang(a.entrepot) - rang(b.entrepot))[0];
    return mieux ? { p, actuel, mieux } : null;
  }).filter(Boolean);
}

function vueFournisseurs() {
  const fiches = fichesFournisseurs();
  const suivi = etatSuiviFournisseurs();
  const alt = alternativesProches();
  const controle = (f, cle, libelle) => `<label class="case"><input type="checkbox" data-fsuivi="${esc(f.nom)}|${cle}" ${suivi[f.nom] && suivi[f.nom][cle] ? 'checked' : ''}> ${libelle}</label>`;
  return `
  <div class="tete"><div><h1>Fournisseurs</h1><p class="sous">Un bon fournisseur fait les bons avis : délais tenus, peu de retours, réponses rapides. Le serveur transmet chaque commande à l’entrepôt le plus proche du client quand le même produit existe ailleurs.</p></div>
    <a class="btn" href="#sourcing">Trouver des produits</a></div>
  ${alt.length ? `<section class="carte"><div class="carte-tete"><h2>Entrepôts plus proches disponibles</h2><span class="sous">routage automatique à la transmission</span></div>
    <ul class="appris">${alt.map(a => `<li><b>${esc(a.p.nom)}</b> : votre source est en ${ENTREPOTS[a.actuel.entrepot].nom.toLowerCase()} (${a.actuel.delai[0]}–${a.actuel.delai[1]} j). Le même article existe en ${ENTREPOTS[a.mieux.entrepot].nom.toLowerCase()} (${a.mieux.delai[0]}–${a.mieux.delai[1]} j, ${esc(a.mieux.fournisseur)}). Les commandes y sont envoyées automatiquement ; pensez à mettre à jour le délai affiché en important cette source.</li>`).join('')}</ul></section>` : ''}
  <div class="fiches">${fiches.map(f => `
    <article class="carte fiche">
      <div class="carte-tete"><div><h2>${esc(f.nom)}</h2><span class="sous">${f.produits.length} produit${f.produits.length > 1 ? 's' : ''} · ${f.commandes} commande${f.commandes > 1 ? 's' : ''} transmise${f.commandes > 1 ? 's' : ''}</span></div>
        <div class="rangee">${f.entrepots.map(e => `<span class="pill ${ENTREPOTS[e] ? ENTREPOTS[e].ton : 'muted'}">${ENTREPOTS[e] ? ENTREPOTS[e].nom : e}</span>`).join('')}</div></div>
      <div class="chiffres">
        <div><span class="sous">Note</span><strong>${f.note ? f.note.toFixed(1).replace('.', ',') + ' / 5' : '—'}</strong></div>
        <div><span class="sous">Délai annoncé</span><strong>${f.annonce ? `${f.annonce[0]}–${f.annonce[1]} j` : '—'}</strong></div>
        <div><span class="sous">Expédition mesurée</span><strong>${f.expeditionMoy === null ? '—' : `${f.expeditionMoy.toFixed(1).replace('.', ',')} j`}</strong></div>
        <div><span class="sous">Remboursements</span><strong class="${f.tauxRemb > 0.05 ? 'down' : ''}">${fmtPct(f.tauxRemb)}</strong></div>
      </div>
      ${f.expeditionMoy === null ? '<p class="sous">Le délai réel se mesure automatiquement entre la transmission et l’expédition, dès les premières commandes passées par le serveur.</p>' : `<p class="sous">Mesuré sur ${f.nMesures} commande${f.nMesures > 1 ? 's' : ''}.</p>`}
      ${f.tauxRemb > 0.05 ? '<p class="encart alerte-encart">Plus de 5 % de remboursements : vérifiez la qualité et l’emballage, ou changez de source.</p>' : ''}
      <div class="controles-f">
        ${controle(f, 'echantillon', 'Échantillon commandé et reçu, au prix normal (pas un exemplaire choisi par le fournisseur)')}
        ${controle(f, 'reponse', 'Répond en moins de 24 heures')}
        ${controle(f, 'delai', 'Délai annoncé tenu sur les dernières commandes')}
        ${controle(f, 'douane', 'Envoi sans frais de douane pour le client (dédouanement prépayé)')}
      </div>
      <p class="sous">Produits : ${f.produits.map(p => esc(p.nom)).join(', ')}</p>
    </article>`).join('') || '<section class="carte"><p class="sous">Aucun fournisseur pour l’instant. Importez un produit du catalogue pour commencer.</p></section>'}</div>
  <section class="carte"><div class="carte-tete"><h2>Ce que recommandent ceux qui ont réussi</h2></div>
    <ul class="appris">
      <li>Commandez un échantillon au prix normal, comme un client : vous voyez la vraie qualité et le vrai délai (Wholesale Ted).</li>
      <li>Préférez un fournisseur qui stocke lui-même ses produits : environ 10 jours de livraison gagnés, sans intermédiaire (Kamil Sattar).</li>
      <li>Visez des fournisseurs très bien notés et qui répondent en moins de 24 heures (créateurs interrogés par Oberlo).</li>
      <li>Quand un produit se vend bien, passez-le en stock propre : meilleure marge et délai plus court (Sebastian Ghiorghiu, Lucas Bivert).</li>
    </ul>
    <p class="sous"><button class="lien-bouton" data-action="sources">Sources</button></p></section>`;
}

document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.fsuivi;
  if (!k) return;
  const [nom, cle] = k.split('|');
  const s = etatSuiviFournisseurs();
  s[nom] = { ...(s[nom] || {}), [cle]: e.target.checked };
  sauver();
});
