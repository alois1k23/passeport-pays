/* Comptoir — copilote de saison.
   Calcule les vraies dates des temps forts du commerce en France, puis prépare pour
   chacun une campagne complète à partir de l’historique de la boutique :
   produits à pousser, prévision de ventes et alertes de stock, code promo,
   bannière, e-mail, publication Instagram, domaine de campagne et planning. */

function paques(annee) { // algorithme de Meeus/Jones/Butcher
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
}
function nieme(annee, mois, jourSemaine, n) { // n-ième jourSemaine du mois (n = -1 : dernier)
  if (n > 0) {
    const d = new Date(annee, mois, 1);
    d.setDate(1 + ((jourSemaine - d.getDay() + 7) % 7) + (n - 1) * 7);
    return d;
  }
  const d = new Date(annee, mois + 1, 0);
  d.setDate(d.getDate() - ((d.getDay() - jourSemaine + 7) % 7));
  return d;
}
function ajouterJours(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/* duree : jours de campagne ; cadeau : l’offre met en avant les coffrets / cartes cadeaux */
function tempsFortsAnnee(an, pays = (typeof etat !== 'undefined' && etat ? etat.boutique.pays : 'fr')) {
  if (pays === 'ch') return tempsFortsSuisse(an);
  const p = paques(an);
  const pentecote = ajouterJours(p, 49);
  let fdm = nieme(an, 4, 0, -1);
  if (fdm.toDateString() === pentecote.toDateString()) fdm = nieme(an, 5, 0, 1);
  const thanksgiving = nieme(an, 10, 4, 4);
  // Soldes : 2e mercredi de janvier (1er s'il tombe après le 12), dernier mercredi de juin (avant-dernier s'il tombe après le 28)
  const s2 = nieme(an, 0, 3, 2), soldesHiver = s2.getDate() > 12 ? nieme(an, 0, 3, 1) : s2;
  const se = nieme(an, 5, 3, -1);
  let soldesEte = se.getDate() > 28 ? ajouterJours(se, -7) : se, soldesH = soldesHiver, fdp = nieme(an, 5, 0, 3);
  // Belgique : soldes le 3 janvier et le 1er juillet, fête des mères et des pères le 2e dimanche de mai et de juin, Saint-Nicolas.
  const be = pays === 'be';
  // Un dimanche, les soldes belges commencent la veille (2 janvier, 30 juin).
  const veilleSiDimanche = d => d.getDay() === 0 ? ajouterJours(d, -1) : d;
  if (be) { soldesH = veilleSiDimanche(new Date(an, 0, 3)); soldesEte = veilleSiDimanche(new Date(an, 6, 1)); fdm = nieme(an, 4, 0, 2); fdp = nieme(an, 5, 0, 2); }
  return [
    { id: 'soldes-hiver', nom: 'Soldes d’hiver', kw: 'soldes', date: soldesH, duree: 28, remise: 30, cadeau: false, angle: 'Dernières pièces de la saison à prix doux' },
    { id: 'saint-valentin', nom: 'Saint-Valentin', kw: 'saint-valentin', date: new Date(an, 1, 14), duree: 10, remise: 10, cadeau: true, angle: 'Le cadeau à offrir à deux' },
    { id: 'paques', nom: 'Pâques', kw: 'paques', date: p, duree: 10, remise: 10, cadeau: true, angle: 'Petites attentions de printemps' },
    { id: 'fete-des-meres', nom: 'Fête des mères', kw: 'fete-des-meres', date: fdm, duree: 14, remise: 10, cadeau: true, angle: 'Pour celle qui a tout, un cadeau fait main' },
    { id: 'fete-des-peres', nom: 'Fête des pères', kw: 'fete-des-peres', date: fdp, duree: 12, remise: 10, cadeau: true, angle: 'Le cadeau qu’il n’achèterait pas lui-même' },
    { id: 'soldes-ete', nom: 'Soldes d’été', kw: 'soldes', date: soldesEte, duree: 28, remise: 30, cadeau: false, angle: 'Faites de la place pour la rentrée' },
    { id: 'rentree', nom: 'Rentrée', kw: 'rentree', date: new Date(an, 8, 1), duree: 14, remise: 10, cadeau: false, angle: 'Nouvelle saison, nouvelles envies' },
    { id: 'halloween', nom: 'Halloween', kw: 'halloween', date: new Date(an, 9, 31), duree: 10, remise: 10, cadeau: false, angle: 'Soirées d’automne' },
    { id: 'black-friday', nom: 'Black Friday', kw: 'black-friday', date: ajouterJours(thanksgiving, 1), duree: 4, remise: 20, cadeau: false, angle: 'Notre plus belle remise de l’automne' },
    ...(be ? [{ id: 'saint-nicolas', nom: 'Saint-Nicolas', kw: 'saint-nicolas', date: new Date(an, 11, 6), duree: 14, remise: 0, cadeau: true, angle: 'Les petits cadeaux du 6 décembre' }] : []),
    { id: 'noel', nom: 'Noël', kw: 'noel', date: new Date(an, 11, 25), duree: 24, remise: 0, cadeau: true, angle: 'Des cadeaux qui ont une histoire' }
  ].sort((x, y) => x.date - y.date).map(e => ({ ...e, cle: `${e.id}-${an}`, debut: ajouterJours(e.date, -e.duree), annee: an }));
}

/* Suisse : pas de dates légales de soldes, fêtes des mères et des pères plus tôt, 1er Août, Singles Day très suivi. */
function tempsFortsSuisse(an) {
  const p = paques(an);
  const thanksgiving = nieme(an, 10, 4, 4);
  return [
    { id: 'saint-valentin', nom: 'Saint-Valentin', kw: 'saint-valentin', date: new Date(an, 1, 14), duree: 10, remise: 10, cadeau: true, angle: 'Le cadeau à offrir à deux' },
    { id: 'paques', nom: 'Pâques', kw: 'paques', date: p, duree: 10, remise: 10, cadeau: true, angle: 'Petites attentions de printemps' },
    { id: 'fete-des-meres', nom: 'Fête des mères', kw: 'fete-des-meres', date: nieme(an, 4, 0, 2), duree: 14, remise: 10, cadeau: true, angle: 'Pour celle qui a tout' },
    { id: 'fete-des-peres', nom: 'Fête des pères', kw: 'fete-des-peres', date: nieme(an, 5, 0, 1), duree: 12, remise: 10, cadeau: true, angle: 'Le cadeau qu’il n’achèterait pas lui-même' },
    { id: 'soldes-ete', nom: 'Soldes d’été', kw: 'soldes', date: new Date(an, 5, 29), duree: 21, remise: 30, cadeau: false, angle: 'Faites de la place pour la rentrée' },
    { id: '1er-aout', nom: 'Fête nationale', kw: '1er-aout', date: new Date(an, 7, 1), duree: 7, remise: 10, cadeau: false, angle: 'Les soirées d’été au bord du lac' },
    { id: 'rentree', nom: 'Rentrée scolaire (Vaud)', kw: 'rentree', date: nieme(an, 7, 1, 4), duree: 14, remise: 10, cadeau: false, angle: 'Nouvelle saison, nouvelles envies' },
    { id: 'halloween', nom: 'Halloween', kw: 'halloween', date: new Date(an, 9, 31), duree: 10, remise: 10, cadeau: false, angle: 'Soirées d’automne' },
    { id: 'singles-day', nom: 'Singles Day', kw: 'singles-day', date: new Date(an, 10, 11), duree: 3, remise: 15, cadeau: false, angle: 'Faites-vous plaisir, rien que pour vous' },
    { id: 'black-friday', nom: 'Black Friday', kw: 'black-friday', date: ajouterJours(thanksgiving, 1), duree: 4, remise: 20, cadeau: false, angle: 'Notre plus belle remise de l’automne' },
    { id: 'noel', nom: 'Noël', kw: 'noel', date: new Date(an, 11, 25), duree: 24, remise: 0, cadeau: true, angle: 'Des cadeaux livrés à temps' },
    { id: 'soldes-hiver', nom: 'Soldes d’après-Noël', kw: 'soldes', date: new Date(an, 11, 26), duree: 21, remise: 30, cadeau: false, angle: 'Dernières pièces de la saison à prix doux' }
  ].map(e => ({ ...e, cle: `${e.id}-${an}`, debut: ajouterJours(e.date, -e.duree), annee: an }));
}

function prochainsTempsForts(n = 4, depuis = new Date()) {
  const an = depuis.getFullYear();
  const auj = new Date(depuis); auj.setHours(0, 0, 0, 0);
  return [...tempsFortsAnnee(an), ...tempsFortsAnnee(an + 1)]
    .filter(e => e.date >= auj)
    .sort((a, b) => a.date - b.date)
    .slice(0, n);
}
function dernierTempsFort(depuis = new Date()) {
  const an = depuis.getFullYear();
  return [...tempsFortsAnnee(an - 1), ...tempsFortsAnnee(an)].filter(e => e.date < depuis).sort((a, b) => b.date - a.date)[0];
}

/* Ventes par produit sur une période. */
function ventesParProduit(etat, depuis, jusqua = Date.now()) {
  const v = {};
  for (const c of etat.commandes) {
    if (c.date < depuis || c.date > jusqua || ['annulee', 'remboursee', 'attente'].includes(c.statut)) continue;
    for (const l of c.lignes) v[l.produitId] = (v[l.produitId] || 0) + l.qte;
  }
  return v;
}

function genererCampagne(etat, evt) {
  const b = etat.boutique;
  const secteur = SECTEURS[b.secteur];
  const now = Date.now();
  const v30 = ventesParProduit(etat, now - 30 * 86400000);
  const v90 = ventesParProduit(etat, now - 90 * 86400000);
  const moisEvt = evt.date.getMonth();
  const ratio = secteur.courbe[moisEvt] / secteur.courbe[new Date().getMonth()];
  // Pic de demande concentré pendant la campagne : facteur d’intensité selon l’événement
  const intensite = { 'black-friday': 2.6, noel: 1.5, 'fete-des-meres': 1.6, 'saint-valentin': 1.4 }[evt.id] || 1.1;

  // Sans aucune vente sur 30 jours, pas de prévision chiffrée (elle serait inventée) : la campagne reste utilisable.
  const sansHistorique = !Object.values(v30).some(v => v > 0);
  const produits = etat.produits.filter(p => p.actif).map(p => {
    const parJour = (v30[p.id] || 0) / 30;
    const prevision = sansHistorique ? 0 : Math.max(1, Math.round(parJour * ratio * intensite * evt.duree));
    const estCoffret = /coffret|carte/i.test(p.nom + p.categorie);
    return { p, ventes90: v90[p.id] || 0, prevision, manque: p.type === 'drop' ? 0 : Math.max(0, prevision - p.stock), score: (v90[p.id] || 0) + (evt.cadeau && estCoffret ? 25 : 0) };
  }).sort((a, b) => b.score - a.score);
  const vedettes = produits.slice(0, 3);
  const ruptures = produits.filter(x => x.manque > 0);
  const caPrevu = sansHistorique ? null : produits.reduce((a, x) => a + Math.min(x.prevision, x.p.stock + x.manque) * x.p.prix * (1 - evt.remise / 100), 0);

  // Dropshipping : date limite de commande pour que le client reçoive à temps
  const drops = vedettesDrop(produits);
  // Date limite : sur le délai le plus long de tous les produits de la campagne expédiés par un fournisseur (pas seulement les vedettes).
  const tousDrops = produits.filter(x => x.p.type === 'drop' && x.p.delai);
  const delaiMax = tousDrops.length ? Math.max(...tousDrops.map(x => x.p.delai[1])) : 0;
  const dateLimite = delaiMax && (evt.cadeau || evt.id === 'noel') ? ajouterJours(evt.date, -(delaiMax + 1)) : null;
  const racines = { soldes: 'SOLDES', 'saint-valentin': 'VALENTIN', paques: 'PAQUES', 'fete-des-meres': 'MAMAN', 'fete-des-peres': 'PAPA', rentree: 'RENTREE', halloween: 'HALLOWEEN', 'black-friday': 'BLACKFRIDAY', noel: 'NOEL', 'singles-day': 'SINGLES', '1er-aout': 'AOUT' };
  const code = evt.remise ? (racines[evt.kw] || racines[evt.id] || evt.kw.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 12)) + evt.remise : '';
  const offre = evt.remise ? `-${evt.remise} % avec le code ${code}` : evt.id === 'noel' ? 'Emballage cadeau offert, livraison prévue avant Noël pour toute commande passée à temps' : 'Emballage cadeau offert';
  const delaiLong = produits.filter(x => x.p.type === 'drop' && x.p.delai && x.p.delai[1] > 10).map(x => x.p);
  const dateTxt = evt.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const finCampagne = evt.id === 'noel' ? (dateLimite || ajouterJours(evt.date, -5)) : ['soldes-hiver', 'soldes-ete'].includes(evt.id) ? ajouterJours(evt.date, evt.duree) : evt.id === 'black-friday' ? ajouterJours(evt.date, 3) : evt.date;
  const fmt = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const lancement = ['soldes-hiver', 'soldes-ete', 'black-friday'].includes(evt.id) ? evt.date : evt.debut;

  return {
    evt, vedettes, ruptures, caPrevu, code, offre, dateLimite, delaiLong, lancement, finCampagne,
    banniere: { titre: evt.nom, texte: `${evt.angle}. ${offre}.` },
    email: {
      objet: evt.remise ? `${evt.nom} : -${evt.remise} % chez ${b.nom}` : `${evt.nom} : nos idées cadeaux`,
      corps: `Bonjour,\n\n${evt.angle}. Pour ${evt.nom.toLowerCase().startsWith('soldes') ? 'les ' : ''}${evt.nom}, nous avons sélectionné pour vous :\n${vedettes.map(x => `• ${x.p.nom} (${euros(x.p.prix)})`).join('\n')}\n\n${offre}.\n\nÀ très vite,\nL’équipe ${b.nom}`
    },
    post: `${evt.angle}\n${vedettes.map(x => x.p.nom).join(' · ')}\n${offre}\n#${evt.kw.replace(/-/g, '')} #${slugifier(b.nom).replace(/-/g, '')} #${secteur.kws[0][0]} #faitmain #commercelocal`,
    domaine: `${evt.kw}-${slugifier(b.nom)}.${b.pays || 'fr'}`,
    planning: [
      { date: ajouterJours(lancement, -21), texte: drops.length ? 'Vérification des stocks et délais fournisseurs, préparation des visuels' : 'Réassort des produits en rupture, préparation des visuels' },
      { date: ajouterJours(lancement, -7), texte: 'E-mail d’annonce aux clients et publication Instagram' },
      { date: lancement, texte: 'Lancement : bannière et code promo activés' },
      { date: finCampagne, texte: evt.id === 'noel' ? 'Date limite de commande pour une livraison avant Noël' : 'Fin de la campagne, retour automatique à la bannière normale' }
    ].map(x => ({ ...x, passe: x.date < new Date(), label: fmt(x.date) })),
    dateTxt
  };
}

function vedettesDrop(produits) { return produits.slice(0, 3).filter(x => x.p.type === 'drop' && x.p.delai); }

/* Bilan d’un temps fort passé : CA des N jours avant l’événement vs les N jours précédents. */
function bilanCampagne(etat, evt) {
  // Fenêtre mesurée : celle de la campagne (soldes : les semaines qui suivent l'ouverture ; Black Friday : jusqu'au Cyber Monday).
  const apres = ['soldes-hiver', 'soldes-ete'].includes(evt.id) ? Math.min(evt.duree, 14) : evt.id === 'black-friday' ? 4 : 1;
  const fin = evt.date.getTime() + apres * 86400000, n = (['soldes-hiver', 'soldes-ete', 'black-friday'].includes(evt.id) ? apres : Math.min(evt.duree, 14)) * 86400000;
  const ca = (d, f) => etat.commandes.filter(c => c.date >= d && c.date < f && !['annulee', 'remboursee', 'attente'].includes(c.statut)).reduce((a, c) => a + c.total, 0);
  const pendant = ca(fin - n, fin), avant = ca(fin - 2 * n, fin - n);
  const v = ventesParProduit(etat, fin - n, fin);
  const top = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
  const prod = top && etat.produits.find(p => p.id === top[0]);
  return { pendant, avant, evolution: avant ? pendant / avant - 1 : null, top: prod ? `${prod.nom} (${top[1]} ventes)` : null };
}

/* Applique une campagne validée à la boutique : bannière saisonnière mise à jour ou créée. */
function appliquerCampagne(etat, camp) {
  const b = etat.boutique;
  let s = b.sections.find(x => x.type === 'saison');
  if (!s) {
    s = { id: 's' + Math.random().toString(36).slice(2, 9), type: 'saison', props: {} };
    const iHero = b.sections.findIndex(x => x.type === 'hero');
    b.sections.splice(iHero >= 0 ? iHero + 1 : 0, 0, s);
  }
  s.props = { titre: camp.banniere.titre, texte: camp.banniere.texte.replace(/ avec le code \w+/, ''), code: camp.code };
  // Le code ne vaut que pendant la campagne : pas avant le lancement (en France, des soldes hors période légale sont interdites), plus après la fin.
  const debut = new Date(camp.lancement); debut.setHours(0, 0, 0, 0);
  const fin = new Date(camp.finCampagne); fin.setHours(24, 0, 0, 0);
  etat.campagnes[camp.evt.cle] = { statut: 'programmee', le: Date.now(), code: camp.code, domaine: camp.domaine, debut: debut.getTime(), expire: fin.getTime() };
}
