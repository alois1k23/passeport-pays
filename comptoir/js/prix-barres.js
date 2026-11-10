/* Comptoir — prix barrés : un prix de comparaison n’est affiché que s’il est licite.
   Partagé par le navigateur et le serveur.
   - Suisse (OIP, révisée au 1er janvier 2025) : le prix de référence doit avoir été réellement
     pratiqué pendant au moins 30 jours consécutifs avant la réduction.
   - Union européenne (directive Omnibus) : le prix de référence est le prix le plus bas
     pratiqué pendant les 30 jours précédant la réduction.
   Règles simplifiées à faire valider par un juriste ; Comptoir refuse d’afficher en cas de doute.
   historique : [{ date, prix }] trié par date (chaque entrée = changement de prix). */
(function (racine) {
  const JOUR = 86400000;

  /* Périodes [début, fin, prix] reconstituées à partir de l’historique. */
  function periodes(historique, maintenant) {
    const h = (historique || []).filter(x => Number.isFinite(Number(x.prix)) && Number.isFinite(Number(x.date))).sort((a, b) => a.date - b.date);
    return h.map((x, i) => [x.date, i + 1 < h.length ? h[i + 1].date : maintenant, Number(x.prix)]);
  }

  function verifier(produit, regime, maintenant) {
    const t = maintenant || Date.now();
    const ref = Number(produit.prixReference);
    const prix = Number(produit.prix);
    if (!ref) return { ok: false, vide: true };
    if (!(ref > prix)) return { ok: false, raison: 'Le prix barré doit être supérieur au prix de vente.' };
    const ps = periodes(produit.historiquePrix, t);
    const actuel = ps.length ? ps[ps.length - 1] : null;
    if (!actuel || actuel[2] !== prix) return { ok: false, raison: 'Historique des prix incomplet : enregistrez le produit pour démarrer l’historique.' };
    const debutReduction = actuel[0];
    if (regime === 'ue') {
      const fenetre = ps.filter(p => p[1] > debutReduction - 30 * JOUR && p[0] < debutReduction);
      if (!fenetre.length) return { ok: false, raison: 'Aucun prix connu sur les 30 jours précédant la réduction.' };
      const plusBas = Math.min(...fenetre.map(p => p[2]));
      return plusBas === ref ? { ok: true, regle: 'Prix le plus bas des 30 jours précédant la réduction (UE)' } : { ok: false, raison: `Dans l’UE, le prix barré doit être le prix le plus bas des 30 derniers jours : ${plusBas.toFixed(2)}.` };
    }
    // Suisse : une période au prix de référence d’au moins 30 jours consécutifs, avant la réduction
    const pratique = ps.some(p => p[2] === ref && p[1] <= debutReduction && p[1] - p[0] >= 30 * JOUR);
    return pratique ? { ok: true, regle: 'Prix pratiqué au moins 30 jours consécutifs (OIP)' } : { ok: false, raison: 'Ce prix n’a pas été pratiqué pendant 30 jours consécutifs avant la réduction (OIP) : le prix barré ne sera pas affiché.' };
  }

  /* Ajoute une entrée d’historique si le prix change. */
  function noterPrix(historique, prix, maintenant) {
    const h = Array.isArray(historique) ? historique.slice(-60) : [];
    const dernier = h[h.length - 1];
    if (!dernier || Number(dernier.prix) !== Number(prix)) h.push({ date: maintenant || Date.now(), prix: Number(prix) });
    return h;
  }

  const api = { verifier, noterPrix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.PrixBarres = api;
})(typeof window !== 'undefined' ? window : globalThis);
