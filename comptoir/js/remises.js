/* Comptoir — remises et codes promo.
   Un seul calcul, partagé par le navigateur (boutique, aperçu) et le serveur
   (qui recalcule tout au moment de payer). Règles :
   - remise par quantité (paliers) ou code promo, non cumulables : la plus
     avantageuse pour le client s’applique ;
   - la remise est un pourcentage appliqué au prix unitaire de chaque ligne,
     arrondi au centime (le même montant part chez le prestataire de paiement) ;
   - la livraison offerte se calcule sur le sous-total après remise. */
(function (racine) {
  const OFFRES_DEFAUT = { paliersActifs: true, paliers: [{ qte: 2, remise: 5 }, { qte: 3, remise: 10 }], suggestions: true, barrePort: true, codes: [] };
  const arrondi = n => Math.round(n * 100) / 100;

  function offresDe(config) {
    const o = Object.assign({}, OFFRES_DEFAUT, (config && config.offres) || {});
    o.paliers = (Array.isArray(o.paliers) ? o.paliers : [])
      .map(p => ({ qte: Math.max(2, Math.min(20, Math.round(Number(p.qte) || 0))), remise: Math.max(0, Math.min(50, Number(p.remise) || 0)) }))
      .filter(p => p.remise > 0).sort((a, b) => a.qte - b.qte).slice(0, 4);
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

  /* lignes : [{ prix, qte }] ; renvoie les lignes remisées et le détail. */
  function appliquer(lignes, config, code, maintenant) {
    const o = offresDe(config);
    const qte = lignes.reduce((a, l) => a + l.qte, 0);
    const sousTotal = arrondi(lignes.reduce((a, l) => a + l.prix * l.qte, 0));
    const palier = o.paliersActifs ? o.paliers.filter(p => qte >= p.qte).pop() : null;
    const saisi = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const trouve = saisi ? codesValables(config, maintenant).find(c => c.code === saisi) : null;
    let taux = 0, motif = null;
    if (palier) { taux = palier.remise; motif = { type: 'palier', libelle: `${palier.remise} % dès ${palier.qte} articles` }; }
    if (trouve && trouve.remise > taux) { taux = trouve.remise; motif = { type: 'code', libelle: `Code ${trouve.code} (−${trouve.remise} %)`, code: trouve.code }; }
    const remisees = lignes.map(l => ({ ...l, prixInitial: l.prix, prix: taux ? arrondi(l.prix * (1 - taux / 100)) : l.prix }));
    const apres = arrondi(remisees.reduce((a, l) => a + l.prix * l.qte, 0));
    const prochain = o.paliersActifs ? o.paliers.find(p => qte < p.qte) : null;
    return {
      lignes: remisees, sousTotal, remise: arrondi(sousTotal - apres), apresRemise: apres, taux, motif,
      codeSaisi: saisi || null, codeValide: saisi ? !!trouve : null, codeMoinsBon: !!(trouve && palier && trouve.remise <= palier.remise),
      prochainPalier: prochain ? { manque: prochain.qte - qte, remise: prochain.remise } : null
    };
  }

  const api = { OFFRES_DEFAUT, offresDe, codesValables, appliquer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.Remises = api;
})(typeof window !== 'undefined' ? window : globalThis);
