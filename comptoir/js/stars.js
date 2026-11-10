/* Comptoir — Produits stars : les produits du catalogue classés selon la saison, la demande observée et la marge.
   Mode connecté : signaux du serveur (ventes Comptoir agrégées, Google Trends, fichier importé), rafraîchis toutes les 6 heures.
   Démo : signaux simulés de façon déterministe, signalés comme tels. */

const ETAT_STARS = { signaux: null, charge: 0, chargement: false };
const HORIZONS = [[0, 'Ce mois-ci'], [1, 'Le mois prochain'], [2, 'Dans 2 mois']];

function signauxDemo(pays) {
  const ventes = {}, trends = {};
  const mois = new Date().getMonth();
  for (const p of CATALOGUE) {
    const h = hacheTexte(p.id + pays + mois), idx = (PROFILS_SAISON[p.profil] || PROFILS_SAISON.constant)[mois] / 100;
    if (h < 0.55) { const n28 = Math.round(idx * (4 + h * 60)); ventes[p.id] = { n28, n7: Math.round(n28 / 4 * (0.6 + hacheTexte(p.id + 's') * 1.1)), boutiques: 2 + Math.round(h * 30) }; }
    if (hacheTexte(p.id + 'g') < 0.7) trends[p.id] = { evolution: Math.round(((PROFILS_SAISON[p.profil] || PROFILS_SAISON.constant)[(mois + 1) % 12] / ((PROFILS_SAISON[p.profil] || PROFILS_SAISON.constant)[mois] || 1) - 1 + (hacheTexte(p.id + 'e') - 0.5) * 0.3) * 100) / 100, niveau: Math.round(30 + h * 60), source: 'google' };
  }
  return { majLe: Date.now() - 2 * 3600000, demo: true, ventes, trends, sources: {
    ventes: { actif: true, detail: 'Démo : ventes simulées' }, trends: { actif: true, detail: 'Démo : recherches simulées' }, fichier: { actif: false, detail: 'Aucun fichier importé' } } };
}

async function chargerSignaux(forcer = false) {
  const enLigne = typeof SERVEUR !== 'undefined' && SERVEUR.connecte;
  if (!enLigne) { ETAT_STARS.signaux = signauxDemo(etat.boutique.pays); return; }
  if (!forcer && ETAT_STARS.signaux && Date.now() - ETAT_STARS.charge < 10 * 60000) return;
  ETAT_STARS.chargement = true;
  try { ETAT_STARS.signaux = await api('GET', '/api/admin/tendances'); ETAT_STARS.charge = Date.now(); }
  catch (e) { ETAT_STARS.signaux = { erreur: e.message, ventes: {}, trends: {}, sources: {} }; }
  ETAT_STARS.chargement = false;
}

function ilYa(t) {
  if (!t) return 'jamais';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 2 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
}

function vueStars() {
  if (!ETAT_STARS.signaux) { chargerSignaux().then(() => { if (ui.route === 'stars') rendre(); }); return `<div class="tete"><div><h1>Produits stars</h1></div></div><div class="chargement" role="status"><span class="spinner"></span>Analyse de la demande…</div>`; }
  const f = ui.stars = ui.stars || { niche: etat.boutique.secteur || 'tous', horizon: 1, entrepots: (ui.sourcing && ui.sourcing.entrepots ? ui.sourcing.entrepots : (etat.boutique.pays === 'ch' ? ['CH', 'UE'] : ['CH', 'UE', 'CN'])).slice(), tri: 'score' };
  const s = ETAT_STARS.signaux, b = etat.boutique;
  const mois = (new Date().getMonth() + f.horizon) % 12;
  const importes = new Set(etat.produits.map(p => p.source).filter(Boolean));
  const tous = Tendances.classer(CATALOGUE, { mois, pays: b.pays, profils: PROFILS_SAISON, ventes: s.ventes, trends: s.trends, marge: p => potentielProduit(p).marge });
  let liste = tous.filter(x => (f.niche === 'tous' || x.p.niche === f.niche) && f.entrepots.includes(x.p.entrepot));
  if (f.tri === 'hausse') liste = liste.slice().sort((a, b2) => b2.direction - a.direction);
  if (f.tri === 'marge') liste = liste.slice().sort((a, b2) => potentielProduit(b2.p).marge.taux - potentielProduit(a.p).marge.taux);
  const top = liste.slice(0, 3), reste = liste.slice(3, 60);
  const fleche = t => t === 'hausse' ? '<span class="st-fl up" title="Demande en hausse">▲</span>' : t === 'baisse' ? '<span class="st-fl down" title="Demande en baisse">▼</span>' : '<span class="st-fl" title="Demande stable">●</span>';
  const courbeMini = x => { const max = Math.max(...x.courbe); return `<span class="st-courbe" aria-label="Saisonnalité sur 12 mois">${x.courbe.map((v, i) => `<i class="${i === mois ? 'cur' : ''}" style="height:${Math.max(8, v / max * 100)}%" title="${Tendances.MOIS[i]} : ${v}"></i>`).join('')}</span>`; };
  const bouton = x => importes.has(x.p.id) ? '<span class="pc-importe">✓ Dans votre boutique</span>' : `<button class="btn petit" data-action="importer-produit" data-id="${x.p.id}">Importer</button>`;
  const sources = [['ventes', 'Ventes sur Comptoir'], ['trends', 'Recherches Google'], ['fichier', 'Fichier importé']];
  const niches = Object.keys(SECTEURS).filter(k => CATALOGUE.some(p => p.niche === k));
  return `
  <div class="tete"><div><h1>Produits stars</h1><p class="sous">${CATALOGUE.length} produits classés pour ${b.pays === 'ch' ? 'la Suisse' : b.pays === 'be' ? 'la Belgique' : 'la France'} selon la saison, la demande observée, votre marge nette, la concurrence et le délai. Mis à jour ${ilYa(s.majLe)}${s.demo ? ' (démo : signaux simulés)' : ', toutes les 6 heures'}.</p></div>
    <div class="rangee">${typeof SERVEUR !== 'undefined' && SERVEUR.connecte ? '<button class="btn fantome" data-action="stars-actualiser">Actualiser</button>' : ''}<a class="btn fantome" href="#sourcing">Catalogue complet</a></div></div>
  ${s.erreur ? `<p class="encart alerte-encart">${esc(s.erreur)}</p>` : ''}
  <div class="st-sources">${sources.map(([k, n]) => { const x = s.sources && s.sources[k]; return `<div class="st-source ${x && x.actif ? 'ok' : ''}"><span class="etat-compte ${x && x.actif ? 'ok' : ''}">${n}</span><span class="sous">${esc(x ? x.detail : 'Non configuré')}</span></div>`; }).join('')}</div>
  <section class="carte barre-sourcing">
    <label class="champ"><span>Niche</span><select data-stars="niche"><option value="tous">Toutes les niches</option>${niches.map(k => `<option value="${k}" ${f.niche === k ? 'selected' : ''}>${esc(SECTEURS[k].nom)}</option>`).join('')}</select></label>
    <div class="champ"><span>Pour vendre</span><div class="segment">${HORIZONS.map(([v, n]) => `<button class="${f.horizon === v ? 'actif' : ''}" data-action="stars-horizon" data-v="${v}">${n}</button>`).join('')}</div></div>
    <fieldset class="champ"><legend>Entrepôt</legend><div class="puces">${Object.entries(ENTREPOTS).map(([k, e]) => `<label class="puce"><input type="checkbox" data-stars-entrepot="${k}" ${f.entrepots.includes(k) ? 'checked' : ''}><span>${e.nom}</span></label>`).join('')}</div></fieldset>
    <label class="champ"><span>Trier par</span><select data-stars="tri">${[['score', 'Score global'], ['hausse', 'Plus forte hausse'], ['marge', 'Meilleure marge']].map(([v, n]) => `<option value="${v}" ${f.tri === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
  </section>
  ${liste.length ? `<div class="st-podium">${top.map((x, i) => `<article class="carte st-top">
    <div class="st-rang">${i + 1}</div>${visuelProduit({ nom: x.p.nom, categorie: x.p.categorie, teinte: (x.p.id.charCodeAt(2) * 47) % 360 })}
    <div class="st-corps"><h2>${esc(x.p.nom)}</h2><div class="sous">${esc(SECTEURS[x.p.niche] ? SECTEURS[x.p.niche].nom : x.p.niche)} · ${esc(x.p.categorie)} · ${euros(x.p.prix)}</div>
      <div class="st-score"><b>${x.score}</b><span>/ 100</span>${fleche(x.tendance)}</div>
      <ul class="st-raisons">${x.raisons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="st-pied">${courbeMini(x)}${bouton(x)}</div></div></article>`).join('')}</div>
  <section class="carte sans-pad"><div class="table-wrap"><table class="table table-cartes st-table"><thead><tr><th>#</th><th>Produit</th><th class="num">Score</th><th>Saison</th><th>Pourquoi</th><th class="num">Marge nette</th><th>Délai</th><th></th></tr></thead><tbody>
    ${reste.map((x, i) => { const m = potentielProduit(x.p).marge; return `<tr><td class="num sous" data-label="Rang">${i + 4}</td><td class="carte-titre" data-label="Produit">${esc(x.p.nom)}<div class="sous">${esc(x.p.categorie)} · ${euros(x.p.prix)}</div></td>
      <td class="num" data-label="Score"><b>${x.score}</b> ${fleche(x.tendance)}</td><td data-label="Saison">${courbeMini(x)}</td><td class="sous st-pourquoi" data-label="Pourquoi">${esc(x.raisons.slice(0, 2).join(' · '))}</td>
      <td class="num ${m.nette < 0 ? 'neg' : ''}" data-label="Marge">${Math.round(m.taux * 100)} %</td><td data-label="Délai"><span class="pill ${ENTREPOTS[x.p.entrepot].ton}">${x.p.delai[0]}–${x.p.delai[1]} j</span></td><td class="num" data-label="">${bouton(x)}</td></tr>`; }).join('')}
  </tbody></table></div></section>` : etatVide('sourcing', 'Aucun produit avec ces filtres', 'Élargissez la niche ou cochez d’autres entrepôts.')}
  <p class="note">Méthode : saison (26 %), demande observée (30 %), marge nette après TVA, port, frais et publicité (20 %), concurrence (10 %), délai (10 %), note du fournisseur (4 %). Les pages des places de marché ne sont pas aspirées (leurs conditions l’interdisent) : leurs classements peuvent être importés par fichier. Un score élevé est une piste à tester, pas une garantie de vente.</p>`;
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action^="stars-"]');
  if (!el) return;
  if (el.dataset.action === 'stars-horizon') { ui.stars.horizon = Number(el.dataset.v); rendre(); }
  else if (el.dataset.action === 'stars-actualiser') { el.disabled = true; await chargerSignaux(true); rendre(); toast('Classement actualisé.'); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.stars) { ui.stars[t.dataset.stars] = t.value; rendre(); }
  else if (t.dataset.starsEntrepot) {
    const s = new Set(ui.stars.entrepots); t.checked ? s.add(t.dataset.starsEntrepot) : s.delete(t.dataset.starsEntrepot);
    ui.stars.entrepots = [...s]; rendre();
  }
});
