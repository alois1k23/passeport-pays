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
    o.paliers = (Array.isArray(o.paliers) ? o.paliers : []).filter(x => x && typeof x === 'object')
      .map(p => ({ qte: Math.max(2, Math.min(20, Math.round(Number(p.qte) || 0))), remise: Math.max(0, Math.min(50, Number(p.remise) || 0)) }))
      .filter(p => p.remise > 0).sort((a, b) => a.qte - b.qte).slice(0, 4);
    // Offres complémentaires : « si le panier contient X, proposer Y à −N % » (dans le panier ou après l’achat).
    o.regles = (Array.isArray(o.regles) ? o.regles : []).filter(x => x && typeof x === 'object').slice(0, 10).map((r, i) => ({
      id: String(r.id || 'r' + i).replace(/[^\w-]/g, '').slice(0, 20) || 'r' + i,
      si: String(r.si || '*').slice(0, 40), alors: String(r.alors || '').slice(0, 40),
      remise: Math.max(0, Math.min(50, Number(r.remise) || 0)), type: r.type === 'apres' ? 'apres' : 'panier', actif: r.actif !== false
    })).filter(r => r.alors && r.si !== r.alors);
    o.codes = (Array.isArray(o.codes) ? o.codes : []).filter(x => x && typeof x === 'object').slice(0, 50).map(c => ({ code: String(c.code || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), remise: Math.max(1, Math.min(70, Number(c.remise) || 0)), expire: Number(c.expire) || null,
      // Limites facultatives : nombre total d'utilisations, une fois par client (adresse e-mail), montant minimum du panier.
      max: Number.isInteger(Number(c.max)) && Number(c.max) > 0 ? Math.min(100000, Number(c.max)) : null, unParClient: c.unParClient === true,
      minimum: Number(c.minimum) > 0 ? Math.min(100000, Math.round(Number(c.minimum) * 100) / 100) : null,
      // Date de création : les utilisations se comptent à partir d'elle (un code supprimé puis recréé repart de zéro).
      cree: Number.isFinite(Number(c.cree)) && Number(c.cree) > 0 ? Number(c.cree) : null })).filter(c => c.code);
    return o;
  }

  /* Tous les codes valables : manuels, campagnes du copilote validées, e-mails automatiques. */
  /* Campagne liée à un code et hors de sa période (pas encore lancée, ou terminée) : sa bannière ne doit pas s'afficher. */
  function periodeCampagne(config, code, maintenant) {
    const t = maintenant || Date.now();
    // Le même code revient chaque année (BLACKFRIDAY20) : on retient la campagne en cours, sinon la prochaine, sinon la dernière.
    const liste = Object.values((config && config.campagnes) || {}).filter(x => x && x.code && String(x.code).toUpperCase() === String(code || '').toUpperCase());
    if (!liste.length) return null;
    const c = liste.find(x => (!x.debut || x.debut <= t) && (!x.expire || x.expire > t))
      || liste.filter(x => x.debut && x.debut > t).sort((a, b) => a.debut - b.debut)[0]
      || liste.sort((a, b) => (b.expire || 0) - (a.expire || 0))[0];
    return { debut: c.debut || null, expire: c.expire || null, avant: !!(c.debut && c.debut > t), apres: !!(c.expire && c.expire <= t) };
  }
  /* Bannière de saison visible maintenant ? Celle d'une campagne suit la période de sa campagne (avec ou sans code) ;
     la bannière générique s'efface pendant qu'une bannière de campagne est affichée. */
  /* Bannières écrites avant le rattachement aux campagnes : rattachées par leur code, ou par leur titre (« Noël » → noel-2026). */
  function migrerBannieres(config) {
    const camps = (config && config.campagnes) || {}, cles = Object.keys(camps);
    const sections = (config && config.boutique && config.boutique.sections) || [];
    const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const plusRecente = liste => liste.sort((a, b) => ((camps[b] || {}).debut || 0) - ((camps[a] || {}).debut || 0))[0];
    for (const s of sections) {
      if (s.type !== 'saison' || !s.props || s.props.campagne) continue;
      const parCode = s.props.code ? cles.filter(k => camps[k] && camps[k].code && String(camps[k].code).toUpperCase() === String(s.props.code).toUpperCase()) : [];
      const parTitre = !parCode.length && s.props.titre ? cles.filter(k => k.replace(/-\d{4}$/, '') === slug(s.props.titre)) : [];
      const k = plusRecente(parCode.length ? parCode : parTitre);
      if (k) s.props.campagne = k;
    }
    return config;
  }
  function banniereVisible(config, props, maintenant) {
    const t = maintenant || Date.now();
    const camps = (config && config.campagnes) || {};
    const dansPeriode = c => c && (!c.debut || c.debut <= t) && (!c.expire || c.expire > t);
    if (props && props.campagne) return dansPeriode(camps[props.campagne]);
    if (props && props.code) {
      const per = periodeCampagne(config, props.code, t);
      if (per && (per.avant || per.apres)) return false;
      // Code qui n'existe plus (campagne annulée, code supprimé) : la remise annoncée serait impossible à obtenir.
      if (!per && !codesValables(config, t).some(c => c.code === String(props.code).toUpperCase())) return false;
    }
    const sections = (config && config.boutique && config.boutique.sections) || [];
    return !sections.some(s => s.type === 'saison' && s.props && s.props.campagne && dansPeriode(camps[s.props.campagne]));
  }
  function codesValables(config, maintenant) {
    const t = maintenant || Date.now();
    const o = offresDe(config);
    const codes = o.codes.filter(c => !c.expire || c.expire > t).map(c => ({ ...c, source: 'Code manuel' }));
    for (const [cle, c] of Object.entries((config && config.campagnes) || {})) {
      if (!c || !c.code) continue;
      const m = /(\d{1,2})$/.exec(c.code);
      if (m && (!c.debut || c.debut <= t) && (!c.expire || c.expire > t)) codes.push({ code: c.code.toUpperCase(), remise: Number(m[1]), source: 'Campagne ' + cle.replace(/-\d{4}$/, '').replace(/-/g, ' ') });
    }
    const a = (config && config.automatisations) || {};
    // Remise saisie : 0 reste 0 (le code n'est alors pas proposé), bornée à 50 % ; absente : valeur par défaut.
    const taux = (v, defaut) => v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? defaut : Math.max(0, Math.min(50, Number(v)));
    for (const [cle, defaut, source, max] of [['bienvenue', 10, 'E-mail de bienvenue', 50], ['reconquete', 15, 'E-mail de reconquête', 50], ['paiement', 10, 'Relance de paiement', 30]]) {
      const x = a[cle];
      const r = Math.min(max, taux(x && x.remise, defaut));   // mêmes plafonds que le serveur (relances.js)
      if (x && x.actif && x.code && r > 0) codes.push({ code: x.code, remise: r, source });
    }
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
    const saisi = String(code || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const valable = saisi ? codesValables(config, maintenant).find(c => c.code === saisi) : null;
    // Code avec un montant minimum : pas appliqué en dessous (le panier dit combien il manque).
    const baseMinimum = arrondi(lignes.reduce((a, l) => a + (l.prixOffre || l.prix) * l.qte, 0));   // lignes d'offre à leur prix d'offre
    const sousMinimum = !!(valable && valable.minimum && baseMinimum < valable.minimum);
    const trouve = sousMinimum ? null : valable;
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
      codeSaisi: saisi || null, codeValide: saisi ? !!valable : null, codeMinimum: sousMinimum ? valable.minimum : null, codeMoinsBon: !!(trouve && palier && trouve.remise <= palier.remise),
      prochainPalier: prochain ? { manque: prochain.qte - qte, remise: prochain.remise } : null
    };
  }

  const api = { OFFRES_DEFAUT, offresDe, codesValables, periodeCampagne, banniereVisible, migrerBannieres, appliquer, regleApplicable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.Remises = api;
})(typeof window !== 'undefined' ? window : globalThis);
