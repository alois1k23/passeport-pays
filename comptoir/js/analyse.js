/* Comptoir — analyse : ventes, produits, clients, marketing, rentabilité.
   Toutes les mesures sont calculées à partir des commandes, produits, tests
   et publications de la boutique. Les visites ne sont pas encore mesurées :
   elles sont estimées et signalées comme telles. */

const PERIODES = [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']];
const ONGLETS_ANALYSE = [['ventes', 'Ventes'], ['produits', 'Produits'], ['clients', 'Clients'], ['marketing', 'Marketing'], ['rentabilite', 'Rentabilité']];
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
  const ttc = c.total, tva = window.tva ? window.tva(c).tva : ttc - ttc / (1 + (typeof c.tauxTva === 'number' ? c.tauxTva : tauxTvaVente()));   // par taux (normal et réduit)
  let achat = 0, douane = 0;
  for (const l of c.lignes) {
    const p = etat.produits.find(x => x.id === l.produitId);
    if (!p) { achat += l.prix * 0.4 * l.qte; continue; }
    const m = margeProduit(p, { prix: l.prix, cpa: 0 });
    achat += m.achat * l.qte; douane += (m.importTva + m.douane) * l.qte;
  }
  // Frais de paiement estimés : aucun en espèces, terminal ou TWINT en boutique 1,7 %, en ligne 2,5 % + 0.30.
  const paiement = c.moyen === 'especes' ? 0 : c.canal === 'magasin' ? ttc * 0.017 : ttc * 0.025 + 0.3;
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
  const ca = liste.reduce((a, c) => a + c.total, 0);
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
  const contenu = { ventes: ongletVentes, produits: ongletProduits, clients: ongletClients, marketing: ongletMarketing, rentabilite: ongletRentabilite }[a.onglet](t, tp, d0, f0, d1, f1);
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
  const grouper = (cle, nommer) => { const o = {}; for (const c of liste) { const k = cle(c); o[k] = (o[k] || 0) + c.total; } return Object.entries(o).map(([k, v]) => ({ nom: nommer(k), v })).sort((x, y) => y.v - x.v); };
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
        <td><span class="part"><i style="width:${l.ca / total * 100}%"></i></span><span class="sous mono"> ${fmtPct(l.ca / total)}</span></td>
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
    return { clients: clients.size, nouveaux, recurrents: clients.size - nouveaux, ca: l.reduce((s, c) => s + c.total, 0) };
  };
  const cur = stats(d0, f0), prev = stats(d1, f1);
  const parT = t.map(x => stats(x.debut, x.fin));
  const nbCmd = {}; web.forEach(c => { nbCmd[c.client.email] = (nbCmd[c.client.email] || 0) + 1; });
  const tousClients = Object.keys(nbCmd).length || 1;
  const reachat = Object.values(nbCmd).filter(n => n > 1).length / tousClients;
  const ltv = web.reduce((s, c) => s + c.total, 0) / tousClients;
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
      ${estSuisse() ? `<h3>Seuil d’assujettissement à la TVA</h3><div class="jauge"><div style="width:${Math.min(100, ca12 / 1000)}%"></div></div><p class="sous">${euros(ca12)} sur 12 mois, soit ${fmtPct(ca12 / 100000)} de CHF 100 000. Comptoir vous prévient à 80 %.</p>` : ''}</section>
  </div>`;
}

/* Entonnoir : mesure réelle (sessions sans cookie) si disponible, sinon estimation signalée. */
function audienceReelle(d0, f0) {
  const a = (etat.audience || []).filter(x => { const t = new Date(x.jour + 'T12:00:00').getTime(); return t >= d0 && t < f0; });
  if (!a.length) return null;
  const n = type => a.filter(x => x.type === type).reduce((s, x) => s + x.n, 0);
  return { vue: n('vue'), panier: n('panier'), livraison: n('livraison'), paiement: n('paiement') };
}
function blocEntonnoir(d0, f0, cur, visites) {
  const r = audienceReelle(d0, f0);
  const etapes = r
    ? [{ nom: 'Visites', v: r.vue }, { nom: 'Ajout au panier', v: r.panier }, { nom: 'Saisie de la livraison', v: r.livraison }, { nom: 'Paiement commencé', v: r.paiement }, { nom: 'Commande payée', v: cur.n }]
    : [{ nom: 'Visites', v: visites, estime: true }, { nom: 'Ajout au panier', v: visites * 0.072, estime: true }, { nom: 'Saisie de la livraison', v: visites * 0.045, estime: true }, { nom: 'Paiement commencé', v: Math.max(cur.n, visites * 0.031), estime: true }, { nom: 'Commande payée', v: cur.n }];
  const pertes = etapes.slice(1).map((e, i) => ({ de: etapes[i].nom, vers: e.nom, perdus: Math.max(0, etapes[i].v - e.v), taux: etapes[i].v ? 1 - e.v / etapes[i].v : 0 }));
  const pire = pertes.slice(1).sort((a, b) => b.taux - a.taux)[0];
  const conseils = {
    'Saisie de la livraison': 'Beaucoup quittent le panier : affichez plus tôt le coût total et la date de livraison. Les frais imprévus sont la première cause d’abandon citée par les acheteurs (Baymard Institute).',
    'Paiement commencé': `Le formulaire de livraison freine : gardez 7 à 8 champs au plus, pas de compte obligatoire (Baymard Institute).${estSuisse() ? ' Le NPA remplit déjà la localité.' : ''}`,
    'Commande payée': `Des paiements sont abandonnés : la relance automatique en récupère une partie.${estSuisse() ? ' Vérifiez que TWINT est bien proposé : c’est le moyen de paiement mobile le plus utilisé en Suisse.' : ' Vérifiez que les moyens de paiement habituels de vos clients sont proposés (Bancontact est activé pour les boutiques belges).'}`
  };
  return `${entonnoir(etapes)}
    <table class="table compacte abandons"><thead><tr><th>Abandon entre</th><th class="num">Perdus</th><th class="num">Taux</th></tr></thead><tbody>${pertes.map(p => `<tr><td>${esc(p.de)} → ${esc(p.vers)}</td><td class="num">${Math.round(p.perdus).toLocaleString('fr-FR')}</td><td class="num">${fmtPct(p.taux)}</td></tr>`).join('')}</tbody></table>
    ${r && pire && conseils[pire.vers] ? `<p class="encart"><b>Fuite principale : ${esc(pire.de.toLowerCase())} → ${esc(pire.vers.toLowerCase())}.</b> ${conseils[pire.vers]}</p>` : ''}
    <p class="sous">${r ? 'Mesure réelle, sans cookie ni adresse IP : une session par onglet, comptée une fois par jour et par étape.' : 'Estimation : la mesure réelle démarre dès que la boutique est en ligne sur le serveur Comptoir (sans cookie). Seules les commandes sont réelles ici.'} Abandons par moyen de paiement : disponibles quand le prestataire de paiement est branché.</p>`;
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
document.addEventListener('change', e => { if (e.target.dataset.analyse === 'canal') { etatAnalyse().canal = e.target.value; rendre(); } });
