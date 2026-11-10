/* Comptoir — remises et codes promo.
   Un seul calcul, partagé par le navigateur (boutique, aperçu) et le serveur
   (qui recalcule tout au moment de payer). Règles :
   - remise par quantité (paliers) ou code promo, non cumulables : la plus
     avantageuse pour le client s’applique ;
   - la remise est un pourcentage appliqué au prix unitaire de chaque ligne,
     arrondi au centime (le même montant part chez le prestataire de paiement) ;
   - la livraison offerte se calcule sur le sous-total après remise. */
(function (racine) {
  const OFFRES_DEFAUT = { seuilPort: 60, paliersActifs: true, paliers: [{ qte: 2, remise: 5 }, { qte: 3, remise: 10 }], suggestions: true, barrePort: true, codes: [] };
  const arrondi = n => Math.round(n * 100) / 100;

  function offresDe(config) {
    const o = Object.assign({}, OFFRES_DEFAUT, (config && config.offres) || {});
    o.seuilPort = Math.max(0, Math.min(1000, Number(o.seuilPort) || 0));
    o.paliers = (Array.isArray(o.paliers) ? o.paliers : [])
      .map(p => ({ qte: Math.max(2, Math.min(20, Math.round(Number(p.qte) || 0))), remise: Math.max(0, Math.min(50, Number(p.remise) || 0)) }))
      .filter(p => p.remise > 0).sort((a, b) => a.qte - b.qte).slice(0, 4);
    // Offres complémentaires : « si le panier contient X, proposer Y à −N % » (dans le panier ou après l’achat).
    o.regles = (Array.isArray(o.regles) ? o.regles : []).slice(0, 10).map((r, i) => ({
      id: String(r.id || 'r' + i).replace(/[^\w-]/g, '').slice(0, 20) || 'r' + i,
      si: String(r.si || '*').slice(0, 40), alors: String(r.alors || '').slice(0, 40),
      remise: Math.max(0, Math.min(50, Number(r.remise) || 0)), type: r.type === 'apres' ? 'apres' : 'panier', actif: r.actif !== false
    })).filter(r => r.alors && r.si !== r.alors);
    o.codes = (Array.isArray(o.codes) ? o.codes : []).slice(0, 50).map(c => ({ code: String(c.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), remise: Math.max(1, Math.min(70, Number(c.remise) || 0)), expire: Number(c.expire) || null })).filter(c => c.code);
    return o;
  }

  /* Tous les codes valables : manuels, campagnes du copilote validées, e-mails automatiques. */
  function codesValables(config, maintenant) {
    const t = maintenant || Date.now();
    const o = offresDe(config);
    const codes = o.codes.filter(c => !c.expire || c.expire > t).map(c => ({ ...c, source: 'Code manuel' }));
    for (const [cle, c] of Object.entries((config && config.campagnes) || {})) {
      if (!c || !c.code) continue;
      const m = /(\d{1,2})$/.exec(c.code);
      if (m && (!c.expire || c.expire > t)) codes.push({ code: c.code.toUpperCase(), remise: Number(m[1]), source: 'Campagne ' + cle.replace(/-\d{4}$/, '').replace(/-/g, ' ') });
    }
    const a = (config && config.automatisations) || {};
    if (a.bienvenue && a.bienvenue.actif && a.bienvenue.code) codes.push({ code: a.bienvenue.code, remise: Number(a.bienvenue.remise) || 10, source: 'E-mail de bienvenue' });
    if (a.reconquete && a.reconquete.actif && a.reconquete.code) codes.push({ code: a.reconquete.code, remise: Number(a.reconquete.remise) || 15, source: 'E-mail de reconquête' });
    if (a.paiement && a.paiement.actif && a.paiement.code) codes.push({ code: a.paiement.code, remise: Number(a.paiement.remise) || 10, source: 'Relance de paiement' });
    return codes;
  }

  /* Règle d’offre applicable à un panier (première règle active dont la condition est remplie). */
  function regleApplicable(config, lignes, type) {
    const o = offresDe(config);
    const ids = lignes.filter(l => !l.offre).map(l => l.produitId);
    return o.regles.find(r => r.actif && r.type === type && (r.si === '*' || ids.includes(r.si)) && !lignes.some(l => l.produitId === r.alors)) || null;
  }

  /* lignes : [{ produitId, prix, qte, offre? }] ; renvoie les lignes remisées et le détail.
     Une ligne « offre » (ajoutée via une règle) garde son prix spécial et n’entre pas dans les paliers ni les codes. */
  function appliquer(lignesEntree, config, code, maintenant) {
    const o = offresDe(config);
    const normales = lignesEntree.filter(l => !l.offre);
    // Une seule ligne au prix de l'offre par règle, et seulement s'il y a un achat normal dans le panier.
    const reglesUtilisees = new Set();
    const lignes = lignesEntree.map(l => {
      if (!l.offre) return l;
      const r = normales.length && !reglesUtilisees.has(l.offre) && o.regles.find(x => x.id === l.offre && x.actif && x.type === 'panier' && x.alors === l.produitId && (x.si === '*' || normales.some(n => n.produitId === x.si)));
      if (r) reglesUtilisees.add(r.id);
      return r ? { ...l, qte: 1, prixOffre: arrondi(l.prix * (1 - r.remise / 100)), libelleOffre: `Offre −${r.remise} %` } : { ...l, offre: undefined };
    });
    const base = lignes.filter(l => !l.prixOffre);
    const qte = base.reduce((a, l) => a + l.qte, 0);
    const sousTotal = arrondi(lignes.reduce((a, l) => a + l.prix * l.qte, 0));
    const palier = o.paliersActifs ? o.paliers.filter(p => qte >= p.qte).pop() : null;
    const saisi = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const trouve = saisi ? codesValables(config, maintenant).find(c => c.code === saisi) : null;
    let taux = 0, motif = null;
    if (palier) { taux = palier.remise; motif = { type: 'palier', libelle: `${palier.remise} % dès ${palier.qte} articles` }; }
    if (trouve && trouve.remise > taux) { taux = trouve.remise; motif = { type: 'code', libelle: `Code ${trouve.code} (−${trouve.remise} %)`, code: trouve.code }; }
    const remisees = lignes.map(l => l.prixOffre ? { ...l, prixInitial: l.prix, prix: l.prixOffre } : { ...l, prixInitial: l.prix, prix: taux ? arrondi(l.prix * (1 - taux / 100)) : l.prix });
    const apres = arrondi(remisees.reduce((a, l) => a + l.prix * l.qte, 0));
    if (!motif && lignes.some(l => l.prixOffre)) motif = { type: 'offre', libelle: lignes.find(l => l.prixOffre).libelleOffre };
    else if (motif && lignes.some(l => l.prixOffre)) motif = { ...motif, libelle: motif.libelle + ' + offre complémentaire' };
    const prochain = o.paliersActifs ? o.paliers.find(p => qte < p.qte) : null;
    return {
      lignes: remisees, sousTotal, remise: arrondi(sousTotal - apres), apresRemise: apres, taux, motif,
      codeSaisi: saisi || null, codeValide: saisi ? !!trouve : null, codeMoinsBon: !!(trouve && palier && trouve.remise <= palier.remise),
      prochainPalier: prochain ? { manque: prochain.qte - qte, remise: prochain.remise } : null
    };
  }

  const api = { OFFRES_DEFAUT, offresDe, codesValables, appliquer, regleApplicable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.Remises = api;
})(typeof window !== 'undefined' ? window : globalThis);
