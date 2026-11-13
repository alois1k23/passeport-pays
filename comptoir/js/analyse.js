/* Comptoir — analyse : ventes, produits, clients, marketing, rentabilité.
   Toutes les mesures sont calculées à partir des commandes, produits, tests
   et publications de la boutique. Les visites ne sont pas encore mesurées :
   elles sont estimées et signalées comme telles. */

const PERIODES = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']];
const ONGLETS_ANALYSE = [['ventes', 'Ventes'], ['produits', 'Produits'], ['clients', 'Clients'], ['marketing', 'Marketing'], ['rentabilite', 'Rentabilité'], ['tva', 'TVA']];
const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const TAUX_CONVERSION_ESTIME = 0.018;

let comparaisonPossible = true;
function etatAnalyse() { ui.analyse = ui.analyse || { onglet: 'ventes', periode: 30, canal: 'tous' }; return ui.analyse; }

/* Découpe une période en tranches : jours (≤ 30 j), semaines (90 j) ou mois (12 mois). */
function tranches(periode, decalage = 0) {
  const fin = new Date(); fin.setHours(24, 0, 0, 0);
  const out = [];
  if (periode >= 365) {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(fin.getFullYear(), fin.getMonth() - i - decalage * 12, 1), f = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      out.push({ debut: d.getTime(), fin: f.getTime(), label: MOIS[d.getMonth()] + (d.getMonth() === 0 || i === 11 ? ' ' + String(d.getFullYear()).slice(2) : '') });
    }
  } else {
    const pas = periode > 30 ? 7 : 1, n = Math.ceil(periode / pas);
    // Bornes en jours du calendrier (et non en pas de 24 h), pour rester à minuit au changement d'heure.
    const jour = k => new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - k).getTime();
    for (let i = n - 1; i >= 0; i--) {
      const kf = decalage * periode + i * pas, f = jour(kf), d = jour(kf + pas);
      out.push({ debut: d, fin: f, label: dateCourte(d) });
    }
  }
  return out;
}
function bornes(t) { return [t[0].debut, t[t.length - 1].fin]; }

function vendues(debut, fin) {
  const canal = etatAnalyse().canal;
  return etat.commandes.filter(c => c.date >= debut && c.date < fin && compteVentes(c) && (canal === 'tous' || c.canal === canal));
}

/* Décompose une commande : TVA, achat, import/douane, paiement, port, bénéfice. */
function decomposer(c) {
  // Taux figé sur la commande (celui de la facture) ; à défaut, le taux actuel.
  // Retours partiels : seul le montant conservé compte (TVA au prorata), et les unités rendues ne coûtent rien.
  const ttc = netVente(c), tva0 = window.tva ? window.tva(c).tva : c.total - c.total / (1 + (typeof c.tauxTva === 'number' ? c.tauxTva : tauxTvaVente()));   // par taux (normal et réduit)
  const tva = c.total ? tva0 * ttc / c.total : 0;
  let achat = 0, douane = 0;
  c.lignes.forEach((l, i) => {
    const q = qteGardee(c, i), p = etat.produits.find(x => x.id === l.produitId);
    if (!p) { achat += l.prix * 0.4 * q; return; }
    const m = margeProduit(p, { prix: l.prix, cpa: 0 });
    achat += m.achat * q; douane += (m.importTva + m.douane) * q;
  });
  // Frais de paiement estimés : aucun en espèces, terminal ou TWINT en boutique 1,7 %, en ligne 2,5 % + 0.30.
  // Part payée par carte cadeau : aucun frais (déjà encaissée à la vente de la carte).
  const reste = Math.max(0, ttc - (c.carteCadeau ? c.carteCadeau.montant || 0 : 0));
  const paiement = c.moyen === 'especes' || c.moyen === 'carte-cadeau' || !reste ? 0 : c.canal === 'magasin' ? reste * 0.017 : reste * 0.025 + 0.3;
  const port = c.canal === 'magasin' || c.livraison === 'retrait' || estDropship(c) ? 0 : 7;
  return { ttc, tva, achat, douane, paiement, port, net: ttc - tva - achat - douane - paiement - port };
}

/* Part de chaque ligne dans le bénéfice avant publicité de sa commande : la somme par produit retombe exactement sur le compte de résultat. */
function contributionsLignes(c) {
  const d = decomposer(c);
  const base = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1;
  return c.lignes.map(l => {
    const p = etat.produits.find(x => x.id === l.produitId);
    const cout = p ? (() => { const m = margeProduit(p, { prix: l.prix, cpa: 0 }); return (m.achat + m.importTva + m.douane) * l.qte; })() : l.prix * 0.4 * l.qte;
    const part = l.prix * l.qte / base;
    return { produitId: l.produitId, qte: l.qte, v: part * (d.ttc - d.tva - d.paiement - d.port) - cout };
  });
}
function contributionPeriode(liste, id) {
  let v = 0, u = 0;
  for (const c of liste) for (const x of contributionsLignes(c)) if (x.produitId === id) { v += x.v; u += x.qte; }
  return { v, u };
}

function mesures(liste) {
  const ca = liste.reduce((a, c) => a + netVente(c), 0);
  const net = liste.reduce((a, c) => a + decomposer(c).net, 0);
  return { ca, net, n: liste.length, panier: liste.length ? ca / liste.length : 0, visites: liste.length / TAUX_CONVERSION_ESTIME };
}

function depensePub(debut, fin) {
  let total = 0;
  for (const t of etat.tests || []) t.resultats.forEach((r, i) => { const d = t.debut + i * JOUR; if (d >= debut && d < fin) total += r.depense || 0; });
  return total;
}

/* ---------- Vue ---------- */
function vueAnalyse() {
  const a = etatAnalyse();
  if (!connecteServeur()) {
    if (!etat.social) { semerHistoriqueSocial(etat); sauver(); }
    if (!etat.tests) { semerTests(); sauver(); }
  }
  const t = tranches(a.periode), tp = tranches(a.periode, 1);
  const [d0, f0] = bornes(t), [d1, f1] = bornes(tp);
  // Pas de comparaison si la boutique n’existait pas encore au début de la période précédente.
  const premiere = Math.min(...etat.commandes.map(c => c.date), Date.now());
  comparaisonPossible = premiere <= d1 + 7 * JOUR;
  const contenu = { ventes: ongletVentes, produits: ongletProduits, clients: ongletClients, marketing: ongletMarketing, rentabilite: ongletRentabilite, tva: ongletTva }[a.onglet](t, tp, d0, f0, d1, f1);
  return `
  <div class="tete"><div><h1>Analyse</h1><p class="sous">${new Date(d0).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(f0 - 1).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}, comparé à la période précédente de même durée.</p></div>
    <div class="rangee">
      <div class="segment" role="group" aria-label="Période">${PERIODES.map(([v, n]) => `<button class="${a.periode === v ? 'actif' : ''}" data-action="periode" data-v="${v}">${n}</button>`).join('')}</div>
      <select id="an-canal" data-analyse="canal" aria-label="Canal de vente"><option value="tous" ${a.canal === 'tous' ? 'selected' : ''}>Tous les canaux</option><option value="web" ${a.canal === 'web' ? 'selected' : ''}>En ligne</option><option value="magasin" ${a.canal === 'magasin' ? 'selected' : ''}>En personne</option></select>
      <button class="btn fantome" data-action="export-csv">Exporter CSV</button>
    </div></div>
  <div class="onglets onglets-page" role="tablist">${ONGLETS_ANALYSE.map(([k, n]) => `<button role="tab" aria-selected="${a.onglet === k}" class="${a.onglet === k ? 'actif' : ''}" data-action="onglet-analyse" data-v="${k}">${n}</button>`).join('')}</div>
  ${contenu}`;
}

function ongletVentes(t, tp, d0, f0, d1, f1) {
  const cur = mesures(vendues(d0, f0)), prev = mesures(vendues(d1, f1));
  const parT = t.map(x => mesures(vendues(x.debut, x.fin))), parTp = tp.map(x => mesures(vendues(x.debut, x.fin)));
  const liste = vendues(d0, f0);
  // Jour × heure
  const grille = JOURS_SEMAINE.map(() => Array(12).fill(0));
  for (const c of liste) { const d = new Date(c.date); grille[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 2)]++; }
  let pic = [0, 0]; grille.forEach((l, i) => l.forEach((v, j) => { if (v > grille[pic[0]][pic[1]]) pic = [i, j]; }));
  // Répartitions
  const grouper = (cle, nommer) => { const o = {}; for (const c of liste) { const k = cle(c); o[k] = (o[k] || 0) + netVente(c); } return Object.entries(o).map(([k, v]) => ({ nom: nommer(k), v })).sort((x, y) => y.v - x.v); };
  const villes = grouper(c => c.client.ville || 'En boutique', k => k).slice(0, 8);
  const livraisons = grouper(c => c.canal === 'magasin' ? 'magasin' : c.livraison, k => k === 'magasin' ? 'Vente en personne' : (TOUTES_LIVRAISONS[k] || { nom: k }).nom);
  const ev = (x, y) => y ? x / y - 1 : null;
  const constats = [];
  if (comparaisonPossible && ev(cur.ca, prev.ca) !== null) constats.push(`Chiffre d’affaires <b>${ev(cur.ca, prev.ca) >= 0 ? 'en hausse' : 'en baisse'} de ${fmtPct(Math.abs(ev(cur.ca, prev.ca)))}</b> par rapport à la période précédente.`);
  if (liste.length >= 10) constats.push(`Créneau le plus actif : <b>${JOURS_SEMAINE[pic[0]].toLowerCase()} entre ${pic[1] * 2} h et ${pic[1] * 2 + 2} h</b>. Programmez vos publications et vos fins d’offres juste avant.`);
  if (villes[0]) constats.push(`<b>${esc(villes[0].nom)}</b> pèse ${fmtPct(villes[0].v / (cur.ca || 1))} du chiffre d’affaires.`);
  constats.push(`Marge nette moyenne : <b>${fmtPct(cur.ca ? cur.net / cur.ca : 0)}</b> du chiffre d’affaires, avant publicité.`);
  return `
  <div class="kpis">
    ${tuile({ nom: 'Chiffre d’affaires', valeur: euros(cur.ca), actuel: cur.ca, precedent: comparaisonPossible ? prev.ca : null, tendance: parT.map(x => x.ca) })}
    ${tuile({ nom: 'Bénéfice avant publicité (estimé)', valeur: euros(cur.net), actuel: cur.net, precedent: comparaisonPossible ? prev.net : null, tendance: parT.map(x => x.net) })}
    ${tuile({ nom: 'Commandes', valeur: cur.n.toLocaleString('fr-FR'), actuel: cur.n, precedent: comparaisonPossible ? prev.n : null, tendance: parT.map(x => x.n) })}
    ${tuile({ nom: 'Panier moyen', valeur: euros(cur.panier), actuel: cur.panier, precedent: comparaisonPossible ? prev.panier : null, tendance: parT.map(x => x.panier) })}
    ${tuile({ nom: 'Visites', valeur: compact(cur.visites), actuel: cur.visites, precedent: comparaisonPossible ? prev.visites : null, tendance: parT.map(x => x.visites), note: 'estimées' })}
  </div>
  <section class="carte constats"><h2>À retenir</h2><ul>${constats.map(c => `<li>${c}</li>`).join('')}</ul></section>
  <section class="carte">
    <div class="carte-tete"><h2>Chiffre d’affaires</h2><span class="sous">par ${t.length > 31 || t.length === 12 ? (t.length === 12 ? 'mois' : 'semaine') : 'jour'}</span></div>
    ${courbe({ unite: devise(), labels: t.map(x => x.label), series: [{ nom: 'Période actuelle', valeurs: parT.map(x => x.ca), classe: 's1', aire: true }, { nom: 'Période précédente', valeurs: parTp.map(x => x.ca), classe: 'gris', pointille: true }], format: compact, formatTip: fmtArgent })}
  </section>
  <section class="carte"><div class="carte-tete"><h2>Quand vos clients achètent</h2><span class="sous">commandes par jour et tranche de 2 heures</span></div>
      ${chaleur({ lignes: JOURS_SEMAINE, colonnes: Array.from({ length: 12 }, (_, i) => `${i * 2}h`), valeurs: grille, tip: (l, c, v) => `${l} ${c} : ${v} commande${v > 1 ? 's' : ''}` })}</section>
  <div class="grille-2">
    <section class="carte"><div class="carte-tete"><h2>Livraison et canal</h2><span class="sous">part du chiffre d’affaires</span></div>
      ${barresH(livraisons, { format: v => fmtPct(v / (cur.ca || 1)) })}</section>
    <section class="carte"><div class="carte-tete"><h2>Villes</h2><span class="sous">chiffre d’affaires</span></div>${barresH(villes, { format: fmtArgent })}</section>
  </div>`;
}

function ongletProduits(t, tp, d0, f0, d1, f1) {
  const liste = vendues(d0, f0), prec = vendues(d1, f1);
  const agreg = l => { const o = {}; for (const c of l) for (const x of c.lignes) { o[x.produitId] = o[x.produitId] || { u: 0, ca: 0 }; o[x.produitId].u += x.qte; o[x.produitId].ca += x.prix * x.qte; } return o; };
  const a = agreg(liste), b = agreg(prec);
  const total = Object.values(a).reduce((s, x) => s + x.ca, 0) || 1;
  const lignes = etat.produits.map(p => {
    const v = a[p.id] || { u: 0, ca: 0 }, w = b[p.id] || { u: 0, ca: 0 };
    const m = margeProduit(p, { cpa: 0 }), contrib = contributionPeriode(liste, p.id);
    return { p, ...v, prec: w.ca, margeU: contrib.u ? contrib.v / contrib.u : m.avantPub, marge: contrib.v, tendance: t.map(x => vendues(x.debut, x.fin).reduce((s, c) => s + c.lignes.filter(l => l.produitId === p.id).reduce((q, l) => q + l.qte, 0), 0)) };
  }).sort((x, y) => y.ca - x.ca);
  const parCat = {}; lignes.forEach(l => { parCat[l.p.categorie] = (parCat[l.p.categorie] || 0) + l.ca; });
  const parType = { 'Dropshipping': 0, 'Mon stock': 0 }; lignes.forEach(l => { parType[l.p.type === 'drop' ? 'Dropshipping' : 'Mon stock'] += l.ca; });
  return `
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>Performance par produit</h2><span class="sous">marge brute : après TVA, achat, douane et frais de paiement</span></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Produit</th><th class="num">Unités</th><th class="num">Chiffre d’affaires</th><th>Part</th><th class="num">Évolution</th><th class="num">Marge brute</th><th>Tendance</th></tr></thead>
      <tbody>${lignes.map(l => `<tr data-action="editer-produit" data-id="${l.p.id}" tabindex="0">
        <td><div class="produit-cel">${visuelProduit(l.p)}<div><div>${esc(l.p.nom)}</div><div class="sous">${l.p.type === 'drop' ? 'Dropshipping · ' + (ENTREPOTS[l.p.entrepot] || { nom: '' }).nom : 'Mon stock'}</div></div></div></td>
        <td class="num">${l.u}</td><td class="num">${euros(l.ca)}</td>
        <td><span class="part"><i data-largeur="${l.ca / total * 100}"></i></span><span class="sous mono"> ${fmtPct(l.ca / total)}</span></td>
        <td class="num">${l.prec ? `<span class="evol ${l.ca >= l.prec ? 'up' : 'down'}">${l.ca >= l.prec ? '▲' : '▼'} ${fmtPct(Math.abs(l.ca / l.prec - 1))}</span>` : '<span class="sous">—</span>'}</td>
        <td class="num ${l.marge < 0 ? 'neg' : ''}">${euros(l.marge)}<div class="sous">${euros(l.margeU)} / unité</div></td>
        <td>${sparkline(l.tendance)}</td></tr>`).join('')}</tbody></table></div>
  </section>
  <div class="grille-2">
    <section class="carte"><div class="carte-tete"><h2>Catégories</h2><span class="sous">chiffre d’affaires</span></div>${barresH(Object.entries(parCat).map(([nom, v]) => ({ nom, v })).sort((x, y) => y.v - x.v), { format: fmtArgent })}</section>
    <section class="carte"><div class="carte-tete"><h2>Approvisionnement</h2><span class="sous">chiffre d’affaires</span></div>${barresH(Object.entries(parType).map(([nom, v]) => ({ nom, v })), { format: fmtArgent })}
      <p class="sous">Quand un produit en dropshipping se vend bien, passez-le en stock propre pour améliorer la marge et le délai (conseil de Sebastian Ghiorghiu). <button class="lien-bouton" data-action="sources">Sources</button></p></section>
  </div>`;
}

function ongletClients(t, tp, d0, f0, d1, f1) {
  const web = etat.commandes.filter(c => compteVentes(c) && c.client.email);
  const premiere = {};
  for (const c of [...web].sort((x, y) => x.date - y.date)) if (!premiere[c.client.email]) premiere[c.client.email] = c.date;
  const dans = (d, f) => web.filter(c => c.date >= d && c.date < f);
  const stats = (d, f) => {
    const l = dans(d, f), clients = new Set(l.map(c => c.client.email));
    const nouveaux = [...clients].filter(e => premiere[e] >= d).length;
    return { clients: clients.size, nouveaux, recurrents: clients.size - nouveaux, ca: l.reduce((s, c) => s + netVente(c), 0) };
  };
  const cur = stats(d0, f0), prev = stats(d1, f1);
  const parT = t.map(x => stats(x.debut, x.fin));
  const nbCmd = {}; web.forEach(c => { nbCmd[c.client.email] = (nbCmd[c.client.email] || 0) + 1; });
  const tousClients = Object.keys(nbCmd).length || 1;
  const reachat = Object.values(nbCmd).filter(n => n > 1).length / tousClients;
  const ltv = web.reduce((s, c) => s + netVente(c), 0) / tousClients;
  // Cohortes mensuelles (6 derniers mois)
  const maintenant = new Date();
  const cohortes = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1), f = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const membres = Object.entries(premiere).filter(([, t1]) => t1 >= d && t1 < f).map(([e]) => e);
    const vals = [1, 2, 3, 4, 5].map(k => {
      const md = new Date(d.getFullYear(), d.getMonth() + k, 1), mf = new Date(d.getFullYear(), d.getMonth() + k + 1, 1);
      if (md > maintenant) return null;
      if (!membres.length) return 0;
      return membres.filter(e => web.some(c => c.client.email === e && c.date >= md && c.date < mf)).length / membres.length;
    });
    cohortes.push({ label: `${MOIS[d.getMonth()]} ${String(d.getFullYear()).slice(2)} · ${membres.length}`, vals });
  }
  // Paniers
  const bornesP = [0, 25, 50, 75, 100, 150, 200];
  const hist = bornesP.map((b, i) => ({ label: i === bornesP.length - 1 ? `${b}+` : `${b}–${bornesP[i + 1]}`, v: dans(d0, f0).filter(c => c.total >= b && (i === bornesP.length - 1 || c.total < bornesP[i + 1])).length }));
  return `
  <div class="kpis">
    ${tuile({ nom: 'Clients actifs', valeur: cur.clients.toLocaleString('fr-FR'), actuel: cur.clients, precedent: comparaisonPossible ? prev.clients : null, tendance: parT.map(x => x.clients) })}
    ${tuile({ nom: 'Nouveaux clients', valeur: cur.nouveaux.toLocaleString('fr-FR'), actuel: cur.nouveaux, precedent: comparaisonPossible ? prev.nouveaux : null, tendance: parT.map(x => x.nouveaux) })}
    ${tuile({ nom: 'Clients revenus', valeur: cur.recurrents.toLocaleString('fr-FR'), actuel: cur.recurrents, precedent: comparaisonPossible ? prev.recurrents : null, tendance: parT.map(x => x.recurrents) })}
    <div class="kpi tuile"><span>Taux de réachat</span><div class="tuile-ligne"><strong>${fmtPct(reachat)}</strong></div><div class="tuile-pied"><span class="sous">clients avec 2 commandes ou plus</span></div></div>
    <div class="kpi tuile"><span>Valeur client moyenne</span><div class="tuile-ligne"><strong>${euros(ltv)}</strong></div><div class="tuile-pied"><span class="sous">chiffre d’affaires par client, depuis le début</span></div></div>
  </div>
  <section class="carte">
    <div class="carte-tete"><h2>Nouveaux clients et clients revenus</h2></div>
    ${courbe({ labels: t.map(x => x.label), series: [{ nom: 'Nouveaux', valeurs: parT.map(x => x.nouveaux), classe: 's1' }, { nom: 'Revenus', valeurs: parT.map(x => x.recurrents), classe: 's2' }], format: v => compact(v), formatTip: v => `${v} client${v > 1 ? 's' : ''}` })}
  </section>
  <div class="grille-2">
    <section class="carte"><div class="carte-tete"><h2>Rétention par cohorte</h2><span class="sous">part des clients qui recommandent, mois après la 1re commande</span></div>
      ${chaleur({ lignes: cohortes.map(c => c.label), colonnes: ['+1 mois', '+2', '+3', '+4', '+5'], valeurs: cohortes.map(c => c.vals), format: v => fmtPct(v), afficher: true, tip: (l, c, v) => `Cohorte ${l} clients · ${c} : ${fmtPct(v)} ont recommandé` })}
      <p class="sous">Lecture : chaque ligne regroupe les clients arrivés le même mois (avec leur nombre).</p></section>
    <section class="carte"><div class="carte-tete"><h2>Montant des paniers</h2><span class="sous">nombre de commandes par tranche (${devise()})</span></div>
      <div class="graph-wrap">${graphBarres(hist.map(h => ({ label: h.label, v: h.v, tip: `${h.label} ${devise()} : ${h.v} commande${h.v > 1 ? 's' : ''}` })), { labelsTous: true, hauteur: 200 })}</div>
      <p class="sous">${seuilPort() > 0 ? `La livraison est offerte dès ${euros(seuilPort())} : les paniers juste en dessous sont une cible pour une vente additionnelle.` : 'Aucune livraison offerte : un seuil (dans Conversion) incite souvent à compléter le panier.'}</p></section>
  </div>`;
}

function ongletMarketing(t, tp, d0, f0) {
  const cur = mesures(vendues(d0, f0));
  const visites = cur.visites;
  const pubs = (etat.publications || []).filter(p => p.statut === 'publiee' && p.stats && p.date >= d0 && p.date < f0);
  const parReseau = {}; pubs.forEach(p => { const r = parReseau[p.reseau] = parReseau[p.reseau] || { vues: 0, clics: 0, ventes: 0 }; r.vues += p.stats.vues; r.clics += p.stats.clics; r.ventes += p.stats.ventes; });
  const parPilier = {}; pubs.forEach(p => { const r = parPilier[p.pilier] = parPilier[p.pilier] || { vues: 0, clics: 0 }; r.vues += p.stats.vues; r.clics += p.stats.clics; });
  const tests = (etat.tests || []).map(x => analyseTest(x)).filter(Boolean).filter(x => x.depense > 0);
  const passes = [];
  let ref = new Date();
  for (let i = 0; i < 4; i++) { const e = dernierTempsFort(ref); if (!e) break; passes.push({ e, b: bilanCampagne(etat, e) }); ref = new Date(e.date.getTime() - JOUR); }
  return `
  <div class="grille-2">
    <section class="carte"><div class="carte-tete"><h2>Entonnoir de conversion</h2><span class="sous">période sélectionnée</span></div>
      ${blocEntonnoir(d0, f0, cur, visites)}</section>
    <section class="carte"><div class="carte-tete"><h2>Réseaux sociaux</h2><span class="sous">${pubs.length} publications sur la période</span></div>
      ${barresH(Object.entries(parReseau).map(([k, v]) => ({ nom: RESEAUX[k].nom, v: v.clics, detail: `${compact(v.vues)} vues, ${v.ventes} ventes` })).sort((a, b) => b.v - a.v), { format: v => `${compact(v)} clics` })}
      <h3>Clics pour 1000 vues, par type de contenu</h3>
      ${barresH(Object.entries(parPilier).map(([k, v]) => ({ nom: PILIERS[k] ? PILIERS[k].nom : k, v: v.vues ? v.clics / v.vues * 1000 : 0 })).sort((a, b) => b.v - a.v), { format: v => v.toFixed(1).replace('.', ',') })}
      ${pubs.some(p => p.stats.simulees) ? '<p class="sous">Statistiques simulées tant que les comptes ne sont pas reliés par les API officielles.</p>' : ''}</section>
  </div>
  <div class="grille-2">
    <section class="carte sans-pad"><div class="carte-tete pad"><h2>Tests produits</h2><span class="sous">dépense publicitaire et retour</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Produit</th><th class="num">Dépense</th><th class="num">Ventes</th><th class="num">Coût par vente</th><th class="num" title="Chiffre d’affaires généré par franc dépensé en publicité (ROAS)">Rendement pub</th><th>Verdict</th></tr></thead>
      <tbody>${tests.map(x => `<tr><td>${esc(x.p.nom)}</td><td class="num">${euros(x.depense)}</td><td class="num">${x.ventes}</td><td class="num">${x.cpa === null ? '—' : euros(x.cpa)}</td><td class="num">${x.roas === null ? '—' : x.roas.toFixed(2).replace('.', ',')}</td><td><span class="pill ${x.ton}">${x.verdict}</span></td></tr>`).join('') || '<tr><td colspan="6" class="vide">Aucun test avec dépense.</td></tr>'}</tbody></table></div></section>
    <section class="carte"><div class="carte-tete"><h2>Temps forts passés</h2><span class="sous">chiffre d’affaires pendant, comparé à la période juste avant</span></div>
      ${barresH(passes.filter(x => x.b.evolution !== null).map(x => ({ nom: x.e.nom, v: x.b.evolution, detail: euros(x.b.pendant) })), { format: v => (v >= 0 ? '+' : '−') + fmtPct(Math.abs(v)) })}</section>
  </div>`;
}

function ongletRentabilite(t, tp, d0, f0, d1, f1) {
  const liste = vendues(d0, f0);
  const somme = k => liste.reduce((s, c) => s + decomposer(c)[k], 0);
  const ca = somme('ttc'), tva = somme('tva'), achat = somme('achat'), douane = somme('douane'), paiement = somme('paiement'), port = somme('port');
  const pub = depensePub(d0, f0);
  const net = ca - tva - achat - douane - paiement - port - pub;
  const prevListe = vendues(d1, f1);
  const netPrev = prevListe.reduce((s, c) => s + decomposer(c).net, 0) - depensePub(d1, f1);
  const lignesPL = [['Chiffre d’affaires TTC', ca], ['TVA', -tva], ['Coût des produits (fournisseur, port)', -achat], ['TVA d’import et dédouanement', -douane], ['Frais de paiement', -paiement], ['Envois de votre stock', -port], ['Publicité (tests)', -pub], ['Bénéfice net', net]];
  const parProduit = etat.produits.map(p => {
    return { nom: p.nom, v: contributionPeriode(liste, p.id).v };
  }).filter(x => x.v !== 0).sort((a, b) => b.v - a.v);
  // Seuil de TVA : tout le chiffre d'affaires, quel que soit le filtre de canal affiché.
  const ca12 = caDouzeMois();
  const etapes = [{ nom: 'Chiffre d’affaires', v: ca, total: true }, { nom: 'TVA', v: -tva }, { nom: 'Coût produits', v: -achat }, { nom: 'Import et douane', v: -douane }, { nom: 'Frais paiement', v: -paiement }, { nom: 'Envois', v: -port }, { nom: 'Publicité', v: -pub }, { nom: 'Bénéfice net', v: net, total: true }].filter(e => e.total || Math.abs(e.v) >= 0.01);
  return `
  <div class="kpis">
    ${tuile({ nom: 'Bénéfice net', valeur: euros(net), actuel: net, precedent: comparaisonPossible ? netPrev : null })}
    <div class="kpi tuile"><span>Marge nette</span><div class="tuile-ligne"><strong>${fmtPct(ca ? net / ca : 0)}</strong></div><div class="tuile-pied"><span class="sous">du chiffre d’affaires TTC</span></div></div>
    <div class="kpi tuile"><span>Coûts produits</span><div class="tuile-ligne"><strong>${fmtPct(ca ? (achat + douane) / ca : 0)}</strong></div><div class="tuile-pied"><span class="sous">du chiffre d’affaires</span></div></div>
    <div class="kpi tuile"><span>Publicité</span><div class="tuile-ligne"><strong>${euros(pub)}</strong></div><div class="tuile-pied"><span class="sous">${pub && ca ? `MER ${(ca / pub).toFixed(1).replace('.', ',')} (chiffre d’affaires ÷ dépenses marketing)` : 'dépense des tests'}</span></div></div>
  </div>
  <section class="carte"><div class="carte-tete"><h2>Du chiffre d’affaires au bénéfice</h2><span class="sous">où part chaque ${devise() === 'CHF' ? 'franc' : 'euro'}</span></div>
    ${cascade(etapes, { format: compact, formatTip: fmtArgent })}</section>
  <div class="grille-2">
    <section class="carte sans-pad"><div class="carte-tete pad"><h2>Compte de résultat</h2><span class="sous">estimé à partir des commandes et des coûts connus</span></div>
      <div class="table-wrap"><table class="table pl"><tbody>${lignesPL.filter(([, v], i) => i === 0 || i === lignesPL.length - 1 || Math.abs(v) >= 0.01).map(([n, v], i, arr) => `<tr class="${i === 0 || i === arr.length - 1 ? 'total' : ''}"><td>${n}</td><td class="num ${v < 0 ? '' : ''}">${euros(v)}</td><td class="num sous">${ca ? fmtPct(v / ca) : '—'}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="carte"><div class="carte-tete"><h2>Marge brute par produit</h2><span class="sous">sur la période</span></div>
      ${barresH(parProduit, { format: fmtArgent })}
      ${estSuisse() ? `<h3>Seuil d’assujettissement à la TVA</h3><div class="jauge"><div data-largeur="${Math.min(100, ca12 / 1000)}"></div></div><p class="sous">${euros(ca12)} sur 12 mois, soit ${fmtPct(ca12 / 100000)} de CHF 100 000. Comptoir vous prévient à 80 %.</p>` : ''}</section>
  </div>`;
}

/* Entonnoir : mesure réelle (sessions sans cookie) si disponible, sinon estimation signalée. */
function audienceReelle(d0, f0) {
  const a = (etat.audience || []).filter(x => { const t = new Date(x.jour + 'T12:00:00').getTime(); return t >= d0 && t < f0; });
  if (!a.length) return null;
  const n = type => a.filter(x => x.type === type).reduce((s, x) => s + x.n, 0);
  return { vue: n('vue'), panier: n('panier'), livraison: n('livraison'), paiement: n('paiement'), payee: n('payee') };
}
function blocEntonnoir(d0, f0, cur, visites) {
  const r = audienceReelle(d0, f0);
  const etapes = r
    ? [{ nom: 'Visites', v: r.vue }, { nom: 'Ajout au panier', v: r.panier }, { nom: 'Saisie de la livraison', v: r.livraison }, { nom: 'Paiement commencé', v: r.paiement }, { nom: 'Commande payée', v: r.payee }]
    : [{ nom: 'Visites', v: visites, estime: true }, { nom: 'Ajout au panier', v: visites * 0.072, estime: true }, { nom: 'Saisie de la livraison', v: visites * 0.045, estime: true }, { nom: 'Paiement commencé', v: Math.max(cur.n, visites * 0.031), estime: true }, { nom: 'Commande payée', v: cur.n }];
  const pertes = etapes.slice(1).map((e, i) => ({ de: etapes[i].nom, vers: e.nom, perdus: Math.max(0, etapes[i].v - e.v), taux: etapes[i].v ? Math.max(0, 1 - e.v / etapes[i].v) : 0 }));
  const pire = pertes.slice(1).sort((a, b) => b.taux - a.taux)[0];
  const conseils = {
    'Saisie de la livraison': 'Beaucoup quittent le panier : affichez plus tôt le coût total et la date de livraison. Les frais imprévus sont la première cause d’abandon citée par les acheteurs (Baymard Institute).',
    'Paiement commencé': `Le formulaire de livraison freine : gardez 7 à 8 champs au plus, pas de compte obligatoire (Baymard Institute).${estSuisse() ? ' Le NPA remplit déjà la localité.' : ''}`,
    'Commande payée': `Des paiements sont abandonnés : la relance automatique en récupère une partie.${estSuisse() ? ' Vérifiez que TWINT est bien proposé : c’est le moyen de paiement mobile le plus utilisé en Suisse.' : ' Vérifiez que les moyens de paiement habituels de vos clients sont proposés (Bancontact est activé pour les boutiques belges).'}`
  };
  return `${entonnoir(etapes)}
    <table class="table compacte abandons"><thead><tr><th>Abandon entre</th><th class="num">Perdus</th><th class="num">Taux</th></tr></thead><tbody>${pertes.map(p => `<tr><td>${esc(p.de)} → ${esc(p.vers)}</td><td class="num">${Math.round(p.perdus).toLocaleString('fr-FR')}</td><td class="num">${fmtPct(p.taux)}</td></tr>`).join('')}</tbody></table>
    ${r && pire && conseils[pire.vers] ? `<p class="encart"><b>Fuite principale : ${esc(pire.de.toLowerCase())} → ${esc(pire.vers.toLowerCase())}.</b> ${conseils[pire.vers]}</p>` : ''}
    <p class="sous">${r ? 'Mesure réelle, sans cookie ni adresse IP, sur les visiteurs qui ont accepté la mesure d’audience : une session par onglet, comptée une fois par jour et par étape (vos commandes totales sont dans les tuiles ci-dessus).' : 'Estimation : la mesure réelle démarre dès que la boutique est en ligne sur le serveur Comptoir (sans cookie). Seules les commandes sont réelles ici.'} Abandons par moyen de paiement : disponibles quand le prestataire de paiement est branché.</p>`;
}

/* ---------- Export CSV ---------- */
function exporterCsv() {
  const a = etatAnalyse();
  const [d0, f0] = bornes(tranches(a.periode));
  const champs = ['numero', 'date', 'client', 'ville', 'canal', 'livraison', 'statut', 'total_ttc', 'tva', 'cout_produits', 'douane', 'frais_paiement', 'benefice_estime'];
  const lignes = vendues(d0, f0).map(c => { const d = decomposer(c); return [String(c.numero), csvTexte(csvDate(c.date)), csvTexte(c.client.nom), csvTexte(c.client.ville), csvTexte(c.canal), csvTexte(c.livraison), csvTexte(c.statut), csvMontant(c.total), csvMontant(d.tva), csvMontant(d.achat), csvMontant(d.douane), csvMontant(d.paiement), csvMontant(d.net)].join(';'); });
  const csv = '﻿' + champs.join(';') + '\n' + lignes.join('\n');
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const lien = Object.assign(document.createElement('a'), { href: url, download: `comptoir-commandes-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(lien); lien.click(); lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${lignes.length} commandes exportées (séparateur point-virgule, lisible dans Excel).`);
  } catch { toast('Export impossible dans cet aperçu. Il fonctionne dans l’application installée.'); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = etatAnalyse();
  if (el.dataset.action === 'periode') { a.periode = Number(el.dataset.v); rendre(); }
  else if (el.dataset.action === 'onglet-analyse') { a.onglet = el.dataset.v; rendre(); }
  else if (el.dataset.action === 'export-csv') exporterCsv();
});
document.addEventListener('change', e => { if (e.target.dataset.analyse === 'canal') { etatAnalyse().canal = e.target.value; rendre(); } else if (e.target.dataset.analyse === 'periodeTva') { etatAnalyse().periodeTva = e.target.value; rendre(); } });

/* ---------- Décompte de TVA : aide au remplissage (trimestre, semestre ou année) ----------
   Ventes à la date de facture, avoirs (remboursements, annulations) à leur date, ventilés par taux figé à la vente.
   Ce n'est pas une déclaration officielle : à vérifier par la fiduciaire avant envoi. */
function periodesTva() {
  const out = [], d = new Date();
  for (let i = 0; i < 6; i++) { const q = Math.floor(d.getMonth() / 3) - i, an = d.getFullYear() + Math.floor(q / 4), t = ((q % 4) + 4) % 4; out.push({ id: `T${t + 1}-${an}`, nom: `${t + 1}${t ? 'e' : 'er'} trimestre ${an}`, debut: new Date(an, t * 3, 1).getTime(), fin: new Date(an, t * 3 + 3, 1).getTime() }); }
  for (let i = 0; i < 3; i++) { const s = Math.floor(d.getMonth() / 6) - i, an = d.getFullYear() + Math.floor(s / 2), h = ((s % 2) + 2) % 2; out.push({ id: `S${h + 1}-${an}`, nom: `${h + 1}${h ? 'e' : 'er'} semestre ${an}`, debut: new Date(an, h * 6, 1).getTime(), fin: new Date(an, h * 6 + 6, 1).getTime() }); }
  for (let i = 0; i < 2; i++) { const an = d.getFullYear() - i; out.push({ id: `A-${an}`, nom: `Année ${an}`, debut: new Date(an, 0, 1).getTime(), fin: new Date(an + 1, 0, 1).getTime() }); }
  return out;
}
function decompteTva(debut, fin) {
  const lignes = [], parTaux = {};
  const ajouter = (doc, numero, date, c, signe) => {
    for (const x of tva(c).parTaux) {
      const k = String(x.taux); parTaux[k] = parTaux[k] || { taux: x.taux, ttc: 0, ht: 0, tva: 0 };
      parTaux[k].ttc += signe * x.ttc; parTaux[k].ht += signe * x.ht; parTaux[k].tva += signe * x.tva;
      lignes.push({ doc, numero, date, commande: c.numero, taux: x.taux, ttc: signe * x.ttc, ht: signe * x.ht, tva: signe * x.tva });
    }
  };
  for (const c of etat.commandes) {
    const dateFacture = c.dateFacture || (c.facture ? c.date : null);
    if (c.facture && dateFacture >= debut && dateFacture < fin) ajouter('Facture', c.facture, dateFacture, c, 1);
    if (c.avoir && c.avoir.date >= debut && c.avoir.date < fin) ajouter('Avoir', c.avoir.numero, c.avoir.date, c, -1);
  }
  const r2 = n => Math.round(n * 100) / 100;
  const taux = Object.values(parTaux).map(x => ({ taux: x.taux, ttc: r2(x.ttc), ht: r2(x.ht), tva: r2(x.tva) })).sort((a, b) => b.taux - a.taux);
  return { lignes: lignes.sort((a, b) => a.date - b.date), taux, total: { ttc: r2(taux.reduce((a, x) => a + x.ttc, 0)), ht: r2(taux.reduce((a, x) => a + x.ht, 0)), tva: r2(taux.reduce((a, x) => a + x.tva, 0)) } };
}
function ongletTva() {
  const a = etatAnalyse(), periodes = periodesTva();
  const p = periodes.find(x => x.id === a.periodeTva) || periodes[0];
  const d = decompteTva(p.debut, p.fin);
  const ch = typeof estSuisse === 'function' && estSuisse();
  const assujetti = d.taux.some(x => x.taux > 0) || (etat.entreprise && /assujetti|normal/.test(etat.entreprise.regime || '') && etat.entreprise.regime !== 'ch-non');
  // Suisse : assujettissement obligatoire dès CHF 100 000 de chiffre d'affaires annuel (art. 10 LTVA)
  const an = new Date().getFullYear(), annee = decompteTva(new Date(an, 0, 1).getTime(), new Date(an + 1, 0, 1).getTime());
  const seuil = ch && !assujetti ? `<div class="encart ${annee.total.ttc >= 80000 ? 'alerte-encart' : ''}"><b>Seuil d’assujettissement</b> : CHF 100’000 de chiffre d’affaires par an. Cette année : <b>${euros(annee.total.ttc)}</b> (${Math.round(annee.total.ttc / 1000)} % du seuil).${annee.total.ttc >= 80000 ? ' Vous approchez du seuil : parlez-en à votre fiduciaire.' : ''}</div>` : '';
  return `<section class="carte"><div class="carte-tete"><h2>Décompte de TVA</h2><div class="rangee"><select data-analyse="periodeTva" aria-label="Période du décompte">${periodes.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${x.nom}</option>`).join('')}</select><button class="btn fantome petit" data-action="export-tva">Exporter le détail (CSV)</button><button class="btn fantome petit" data-action="export-ecritures" title="Journal des ventes pour votre comptable : une écriture équilibrée par facture et par avoir">${paysCompta() === 'fr' ? 'Journal des ventes (format FEC)' : 'Journal des ventes'}</button></div></div>
    ${assujetti ? '' : `<p class="encart">Votre entreprise n’est pas assujettie à la TVA (régime choisi dans Conformité) : rien à déclarer. Le tableau montre vos ventes facturées pour information.</p>`}${seuil}
    <div class="table-wrap"><table class="table"><thead><tr><th>Taux</th><th class="num">Ventes TTC</th><th class="num">Base HT</th><th class="num">TVA</th></tr></thead><tbody>
      ${d.taux.map(x => `<tr><td>${x.taux ? pctTva(x.taux) : 'Sans TVA'}</td><td class="num">${euros(x.ttc)}</td><td class="num">${euros(x.ht)}</td><td class="num">${euros(x.tva)}</td></tr>`).join('') || '<tr><td colspan="4" class="sous">Aucune facture ni avoir sur cette période.</td></tr>'}
      ${d.taux.length ? `<tr class="total"><td><b>Total</b></td><td class="num"><b>${euros(d.total.ttc)}</b></td><td class="num"><b>${euros(d.total.ht)}</b></td><td class="num"><b>${euros(d.total.tva)}</b></td></tr>` : ''}
    </tbody></table></div>
    <p class="sous">${d.lignes.filter(x => x.doc === 'Facture').length} ligne(s) de facture et ${d.lignes.filter(x => x.doc === 'Avoir').length} d’avoir, à la date du document. Les avoirs (remboursements, annulations) sont déduits. Frais de port et remises sont répartis au prorata des articles. ${ch && assujetti ? 'Méthode effective (taux réels). ' : ''}Aide au remplissage, à faire vérifier par votre fiduciaire : la TVA payée sur vos achats (impôt préalable) n’est pas incluse.</p></section>`;
}
function exporterTva() {
  const a = etatAnalyse(), p = periodesTva().find(x => x.id === a.periodeTva) || periodesTva()[0];
  const d = decompteTva(p.debut, p.fin), f = n => n.toFixed(2);
  const csv = '﻿' + ['document', 'numero', 'date', 'commande', 'taux', 'ttc', 'ht', 'tva'].join(';') + '\n' + d.lignes.map(x => [x.doc, csvTexte(x.numero), csvTexte(csvDate(x.date)), x.commande, (x.taux * 100).toFixed(1), f(x.ttc), f(x.ht), f(x.tva)].join(';')).join('\n');
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const lien = Object.assign(document.createElement('a'), { href: url, download: `comptoir-tva-${p.id}.csv` });
    document.body.appendChild(lien); lien.click(); lien.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Détail de la TVA exporté (${d.lignes.length} lignes).`);
  } catch { toast('Export impossible dans cet aperçu.'); }
}
/* Écritures de ventes pour le comptable : une écriture équilibrée par facture ou avoir (client au débit, ventes HT et TVA
   par taux au crédit ; l'inverse pour un avoir), avec les montants exacts des factures.
   France : format du fichier des écritures comptables (FEC, art. A47 A-1 du LPF), séparateur tabulation.
   Comptes usuels de chaque pays, à adapter par le comptable si son plan diffère. Journal des ventes seulement :
   les encaissements (banque) ne sont pas inclus. */
const COMPTES_VENTES = {
  fr: { client: ['411000', 'Clients'], vente: ['707000', 'Ventes de marchandises'], tva: ['445710', 'TVA collectée'], arrondi: ['758000', 'Produits divers de gestion courante'] },
  be: { client: ['400000', 'Clients'], vente: ['700000', 'Ventes de marchandises'], tva: ['451000', 'TVA à payer'], arrondi: ['743000', 'Produits d’exploitation divers'] },
  ch: { client: ['1100', 'Créances résultant de ventes'], vente: ['3200', 'Ventes de marchandises'], tva: ['2200', 'TVA due'], arrondi: ['3805', 'Différences d’arrondi'] }
};
const paysCompta = () => ((typeof etat !== 'undefined' && etat.boutique && etat.boutique.pays) || 'fr');
/* Numéro de compte auxiliaire stable par client (même client = même numéro d'un export à l'autre). */
function compteClient(c) {
  const cle = String((c.client && (c.client.email || c.client.nom)) || 'client').toLowerCase();
  let h = 5381; for (let i = 0; i < cle.length; i++) h = ((h << 5) + h + cle.charCodeAt(i)) >>> 0;
  return 'C' + h.toString(16).toUpperCase().padStart(8, '0');
}
/* Écritures de l'exercice (année civile) jusqu'à « fin », numérotées depuis le 1er janvier ; seules celles de la période sont gardées :
   un même document garde le même numéro dans l'export trimestriel et dans l'export annuel. */
function ecrituresVentes(debut, fin) {
  const pays = paysCompta(), cpt = COMPTES_VENTES[pays] || COMPTES_VENTES.fr;
  const debutExercice = new Date(new Date(debut).getFullYear(), 0, 1).getTime();
  const d = decompteTva(debutExercice, fin), parPiece = new Map();
  for (const x of d.lignes) { const k = `${x.doc}|${x.numero}`; if (!parPiece.has(k)) parPiece.set(k, []); parPiece.get(k).push(x); }
  const r2 = n => Math.round(n * 100) / 100, pct = t => (t * 100).toFixed(1).replace('.0', '').replace('.', ',');
  const lignes = [];
  let num = 0, pieces = 0;
  for (const [, l] of [...parPiece].sort((a, b) => a[1][0].date - b[1][0].date)) {
    const x0 = l[0], avoir = x0.doc === 'Avoir', c = etat.commandes.find(c2 => c2.numero === x0.commande) || { client: {} };
    const ttc = r2(Math.abs(l.reduce((a, x) => a + x.ttc, 0)));
    if (!ttc) continue;   // commande à 0 : aucune écriture (des lignes à zéro sont refusées par les logiciels comptables)
    num++;
    if (x0.date < debut) continue;
    pieces++;
    const lib = avoir ? `Avoir ${x0.numero} sur facture ${c.facture || '?'} - commande ${x0.commande}` : `Facture ${x0.numero} - commande ${x0.commande}`;
    const ecr = (compte, debit, credit, aux, detail = '') => { if (r2(debit) || r2(credit)) lignes.push({ num, date: x0.date, compte, debit: r2(debit), credit: r2(credit), piece: x0.numero, lib: lib + detail, aux }); };
    // Espèces en francs : le client a payé le montant arrondi ; l'écart va au compte d'arrondis (le compte client est soldé exactement).
    const arrondi = !avoir && typeof c.arrondi === 'number' && c.arrondi && typeof c.encaisse === 'number' ? r2(c.arrondi) : 0;
    const client = { num: compteClient(c), nom: (c.client && c.client.nom) || 'Client' };
    ecr(cpt.client, avoir ? 0 : ttc + arrondi, avoir ? ttc : 0, client);
    if (arrondi) ecr(cpt.arrondi, arrondi < 0 ? -arrondi : 0, arrondi > 0 ? arrondi : 0, null, ' - arrondi espèces');
    for (const x of l) {
      const ht = r2(Math.abs(x.ht)), tv = r2(Math.abs(x.tva)), taux = x.taux ? ` - TVA ${pct(x.taux)} %` : ' - sans TVA';
      ecr(cpt.vente, avoir ? ht : 0, avoir ? 0 : ht, null, taux);
      if (tv) ecr(cpt.tva, avoir ? tv : 0, avoir ? 0 : tv, null, taux);
    }
  }
  // Contrôle : chaque écriture est équilibrée (débit = crédit), sinon rien n'est exporté.
  const desequilibre = [...new Set(lignes.map(x => x.num))].some(n => { const e = lignes.filter(x => x.num === n); return Math.abs(e.reduce((a, x) => a + x.debit - x.credit, 0)) > 0.005; });
  return { lignes, pieces, desequilibre, pays };
}
function exporterEcritures() {
  const a = etatAnalyse(), p = periodesTva().find(x => x.id === a.periodeTva) || periodesTva()[0];
  const e = ecrituresVentes(p.debut, p.fin);
  if (e.desequilibre) { toast('Écritures déséquilibrées : export annulé. Signalez-le au support.'); return; }
  if (!e.pieces) { toast('Aucune facture ni avoir sur cette période.'); return; }
  const ymd = t => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  const fr = e.pays === 'fr', virgule = n => n.toFixed(2).replace('.', ',');
  // Texte sans séparateur ni saut de ligne, en caractères latins simples (lus par tous les logiciels comptables).
  const propre = t => String(t ?? '').replace(/[\t\r\n|;]/g, ' ').replace(/[·•]/g, '-').replace(/[’‘]/g, "'").replace(/[«»]/g, '"').replace(/[^\x20-\xFF€]/g, '').trim();
  const devise = (etat.boutique && etat.boutique.devise) || (e.pays === 'ch' ? 'CHF' : 'EUR');
  let contenu, nom;
  if (fr) {
    // Format FEC : 18 colonnes, tabulation, montants à virgule, dates AAAAMMJJ. Journal des ventes seulement.
    const tete = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
    const valide = ymd(Date.now());   // date de l'export, pas celle de la pièce
    contenu = tete.join('\t') + '\r\n' + e.lignes.map(x => ['VT', 'Ventes', `VT${String(x.num).padStart(6, '0')}`, ymd(x.date), x.compte[0], propre(x.compte[1]), x.aux ? x.aux.num : '', x.aux ? propre(x.aux.nom) : '', propre(x.piece), ymd(x.date), propre(x.lib), virgule(x.debit), virgule(x.credit), '', '', valide, '', ''].join('\t')).join('\r\n') + '\r\n';
    // Nom légal (SIREN + FEC + date de clôture) seulement pour l'année entière ; sinon un nom qui dit ce que c'est.
    const siren = String((etat.entreprise || {}).siret || '').replace(/\D/g, '').slice(0, 9);
    if (p.id.startsWith('A-')) {
      if (siren.length !== 9) { toast('Renseignez votre SIRET dans Conformité : il donne son nom au fichier.'); return; }
      nom = `${siren}FEC${ymd(p.fin - 86400000)}.txt`;
    } else nom = `journal-ventes-format-FEC-${p.id}.txt`;
  } else {
    const csv = t => { const v = propre(t); return /^[=+\-@]/.test(v) ? `"'${v.replace(/"/g, '""')}"` : `"${v.replace(/"/g, '""')}"`; };
    contenu = '﻿' + ['journal', 'ecriture', 'date', 'compte', 'libelle_compte', 'client', 'nom_client', 'piece', 'libelle', 'debit', 'credit', 'devise'].join(';') + '\n'
      + e.lignes.map(x => ['VT', x.num, csv(csvDate(x.date)), x.compte[0], csv(x.compte[1]), x.aux ? x.aux.num : '', csv(x.aux ? x.aux.nom : ''), csv(x.piece), csv(x.lib), virgule(x.debit), virgule(x.credit), devise].join(';')).join('\n');
    nom = `journal-ventes-${p.id}.csv`;
  }
  try {
    const url = URL.createObjectURL(new Blob([contenu], { type: fr ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' }));
    const lien = Object.assign(document.createElement('a'), { href: url, download: nom });
    document.body.appendChild(lien); lien.click(); lien.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${e.pieces} pièce${e.pieces > 1 ? 's' : ''} exportée${e.pieces > 1 ? 's' : ''} (${e.lignes.length} lignes d’écriture).`);
  } catch { toast('Export impossible dans cet aperçu.'); }
}
document.addEventListener('click', e => { if (e.target.closest('[data-action="export-tva"]')) exporterTva(); });
document.addEventListener('click', e => { if (e.target.closest('[data-action="export-ecritures"]')) exporterEcritures(); });
