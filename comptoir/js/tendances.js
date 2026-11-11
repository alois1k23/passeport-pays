/* Comptoir — moteur des produits stars (partagé navigateur et serveur).
   Le score (0 à 100) combine, pour le pays de la boutique et le mois visé :
     - la saison : profil de demande mensuel du produit, avec une avance d'un mois (le temps de lancer) ;
     - la demande : ventes observées sur toutes les boutiques Comptoir (agrégées, anonymes),
       évolution des recherches Google Trends si une clé est configurée, fichiers d'outils importés,
       et à défaut la popularité de référence du catalogue ;
     - la marge nette réelle, la concurrence, le délai de livraison et la note du fournisseur.
   Chaque score s'accompagne de ses raisons, pour que le marchand puisse juger lui-même. */
(function (racine, fabrique) {
  const m = fabrique();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else racine.Tendances = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const borne = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const pct = x => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} %`;

  function indices(profils, p) { return (profils && profils[p.profil]) || (profils && profils.constant) || Array(12).fill(100); }

  /* p : produit du catalogue ; o : { mois, pays, profils, ventes: { n7, n28, boutiques }, trends: { evolution, niveau, source, majLe }, marge: { taux, nette } } */
  function analyser(p, o) {
    const idx = indices(o.profils, p);
    const m = ((o.mois % 12) + 12) % 12, suivant = (m + 1) % 12;
    const saisonBrute = 0.6 * idx[m] + 0.4 * idx[suivant];
    const saison = borne((saisonBrute - 50) / 150);
    const raisons = [], signaux = [];

    // Demande : chaque source disponible compte ; la popularité de référence sert de base.
    const demandes = [{ v: borne((p.tendance || 50) / 100), poids: 0.5 }];
    let direction = (idx[suivant] - idx[m]) / Math.max(idx[m], 1);
    if (o.ventes && o.ventes.n28 > 0) {
      const rythme = o.ventes.n7 / Math.max(o.ventes.n28 / 4, 0.25);
      const volume = borne(Math.log(1 + o.ventes.n28) / Math.log(60));
      demandes.push({ v: borne(0.55 * volume + 0.45 * borne(rythme / 2)), poids: 1.2 });
      direction = rythme - 1;
      signaux.push('ventes');
      raisons.push(`${o.ventes.n28} vente${o.ventes.n28 > 1 ? 's' : ''} sur Comptoir en 4 semaines${rythme > 1.2 ? `, en accélération (${pct(rythme - 1)} cette semaine)` : ''}`);
    }
    if (o.trends && typeof o.trends.evolution === 'number') {
      demandes.push({ v: borne(0.5 + o.trends.evolution * 0.6) * 0.6 + borne((o.trends.niveau || 50) / 100) * 0.4, poids: 1 });
      direction = o.trends.evolution;   // le signal le plus direct l’emporte (recherches, puis ventes, puis saison)
      signaux.push(o.trends.source || 'trends');
      raisons.push(`Recherches ${o.trends.source === 'fichier' ? '(fichier importé)' : 'Google'} ${pct(o.trends.evolution)} sur 4 semaines`);
    }
    const demande = demandes.reduce((a, d) => a + d.v * d.poids, 0) / demandes.reduce((a, d) => a + d.poids, 0);

    const marge = o.marge ? borne(o.marge.taux / 0.45) : 0.5;
    const concurrence = 1 - borne((p.concurrence || 50) / 100);
    const dmax = p.delai ? p.delai[1] : 7;
    // Chine : délai long et, en Suisse comme dans l'UE, TVA d'importation à la charge du client.
    const delai = p.entrepot === 'CN' ? (o.pays === 'ch' ? 0.25 : 0.35) : dmax <= 4 ? 1 : dmax <= 7 ? 0.85 : 0.45;
    const note = borne(((p.note || 4.3) - 3.8) / 1.1);
    const score = Math.round(100 * (0.26 * saison + 0.3 * demande + 0.2 * marge + 0.1 * concurrence + 0.1 * delai + 0.04 * note));

    // Pic de saison : le mois le plus fort dans les 12 prochains.
    let pic = m;
    for (let k = 0; k < 12; k++) if (idx[(m + k) % 12] > idx[pic]) pic = (m + k) % 12;
    const dansMois = (pic - m + 12) % 12;
    if (idx[m] >= 130) raisons.unshift(`En pleine saison (${Math.round(idx[m] - 100)} % au-dessus d’un mois moyen)`);
    else if (dansMois > 0 && dansMois <= 2 && idx[pic] >= 130) raisons.unshift(`Pic de demande en ${MOIS[pic]} : lancez maintenant`);
    else if (dansMois === 3 && idx[pic] >= 170) raisons.unshift(`Grand pic en ${MOIS[pic]} : testez dès maintenant (fiches, photos et publicités se préparent 2 à 3 mois avant)`);
    if (o.marge) raisons.push(o.marge.taux < 0.15 ? `Marge faible (${Math.round(o.marge.taux * 100)} %)` : `Marge nette ${Math.round(o.marge.taux * 100)} %`);
    if (p.entrepot === 'CN') raisons.push(o.pays === 'ch' ? 'Envoi de Chine : délai long, TVA d’importation et frais de dédouanement possibles pour le client' : 'Envoi de Chine : délai long et TVA d’importation à la charge du client (sauf IOSS)');
    else if (dmax <= 4) raisons.push(`Livré en ${p.delai[0]} à ${dmax} jours`);
    if ((p.concurrence || 0) >= 80) raisons.push('Marché très concurrentiel');

    const tendance = direction > 0.08 ? 'hausse' : direction < -0.08 ? 'baisse' : 'stable';
    return { score, tendance, direction, saison: Math.round(saison * 100), demande: Math.round(demande * 100), pic, picDans: dansMois, courbe: idx.slice(), raisons: raisons.slice(0, 4), signaux };
  }

  function classer(catalogue, o) {
    return catalogue.map(p => ({ p, ...analyser(p, { ...o, ventes: o.ventes && o.ventes[p.id], trends: o.trends && o.trends[p.id], marge: o.marge ? o.marge(p) : null }) }))
      .sort((a, b) => b.score - a.score);
  }

  return { analyser, classer, MOIS };
});
