/* Comptoir — graphiques (SVG et HTML, sans bibliothèque).
   Règles : marques fines, grille discrète, une seule échelle par graphique,
   couleurs par rôle (série 1 = période ou mesure principale, gris pointillé =
   période précédente, série 2 = déduction ou seconde mesure), infobulle au survol
   de chaque point ou barre, légende dès qu’il y a deux séries. */

/* Largeur réelle disponible : le texte des axes garde sa taille à l’écran. */
function largeurDispo(fraction = 1) {
  const main = document.querySelector('main');
  const w = main ? main.clientWidth - 64 : 900;
  const col = window.innerWidth > 1180 || fraction === 1 ? w * fraction - (fraction < 1 ? 48 : 0) : w;
  return Math.round(Math.max(320, Math.min(1500, col)));
}

function pasLisible(max, cible = 4) {
  if (max <= 0) return 1;
  const brut = max / cible, p = Math.pow(10, Math.floor(Math.log10(brut))), n = brut / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e3) return (v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: a >= 1e4 ? 0 : 1 }) + ' k';
  return Math.round(v).toLocaleString('fr-FR');
}
const fmtArgent = v => euros(v);
const fmtArgentCompact = v => compact(v) + (devise() === 'CHF' ? ' CHF' : ' €');
const fmtPct = v => (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %';

function legendeGraph(items) {
  return `<div class="legende">${items.map(i => `<span><i class="cle ${i.classe}${i.pointille ? ' pointille' : ''}"></i>${esc(i.nom)}</span>`).join('')}</div>`;
}

/* Courbe(s) dans le temps. series : [{ nom, valeurs, classe: 's1' | 's2' | 's3' | 'gris', pointille, aire }] */
function courbe({ labels, series, format = compact, formatTip = format, hauteur = 220, fraction = 1 }) {
  const L = largeurDispo(fraction), H = hauteur, m = { g: 56, d: 14, h: 12, b: 26 };
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap(s => s.valeurs));
  const pas = pasLisible(max), haut = Math.ceil(max / pas) * pas;
  const x = i => m.g + (n <= 1 ? 0 : i * (L - m.g - m.d) / (n - 1));
  const y = v => m.h + (H - m.h - m.b) * (1 - v / haut);
  let svg = `<svg viewBox="0 0 ${L} ${H}" class="graph courbe" role="img" aria-label="${esc(series.map(s => s.nom).join(', '))}">`;
  for (let t = 0; t <= haut + 1e-9; t += pas) svg += `<line x1="${m.g}" x2="${L - m.d}" y1="${y(t)}" y2="${y(t)}" class="grille"/><text x="${m.g - 8}" y="${y(t) + 3.5}" text-anchor="end" class="axe">${esc(format(t))}</text>`;
  const tous = Math.max(1, Math.ceil(n / 7));
  labels.forEach((l, i) => { if (i % tous === 0 || i === n - 1) svg += `<text x="${x(i)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="axe">${esc(l)}</text>`; });
  [...series].reverse().forEach(s => {
    const pts = s.valeurs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (s.aire) svg += `<path d="M${x(0)},${y(0)} L${pts.join(' L')} L${x(n - 1)},${y(0)} Z" class="aire ${s.classe}"/>`;
    svg += `<polyline points="${pts.join(' ')}" class="trait ${s.classe}${s.pointille ? ' pointille' : ''}"/>`;
  });
  const s1 = series[0];
  if (s1 && n) svg += `<circle cx="${x(n - 1)}" cy="${y(s1.valeurs[n - 1])}" r="4" class="point ${s1.classe}"/>`;
  const largeur = (L - m.g - m.d) / Math.max(1, n - 1);
  labels.forEach((l, i) => {
    const tip = `${l}\n` + series.map(s => `${s.nom} : ${formatTip(s.valeurs[i] || 0)}`).join('\n');
    svg += `<g class="col"><line x1="${x(i)}" x2="${x(i)}" y1="${m.h}" y2="${H - m.b}" class="guide"/>${series.map(s => `<circle cx="${x(i)}" cy="${y(s.valeurs[i] || 0)}" r="3.5" class="repere ${s.classe}"/>`).join('')}<rect x="${x(i) - largeur / 2}" y="${m.h}" width="${largeur}" height="${H - m.h - m.b}" class="cible" data-tip="${esc(tip)}"/></g>`;
  });
  return svg + '</svg>' + (series.length > 1 ? legendeGraph(series) : '');
}

/* Barres horizontales (classements). items : [{ nom, v, detail? }] */
function barresH(items, { format = compact, max = null, classe = 's1' } = {}) {
  if (!items.length) return '<p class="sous">Pas encore de données sur la période.</p>';
  const m = max ?? Math.max(...items.map(i => Math.abs(i.v)), 1);
  return `<ul class="barres-h">${items.map(i => `<li data-tip="${esc(`${i.nom} : ${format(i.v)}${i.detail ? ' · ' + i.detail : ''}`)}">
    <span class="bh-nom">${esc(i.nom)}</span><span class="bh-piste"><i class="${i.v < 0 ? 'negatif' : classe}" style="width:${Math.max(1.5, Math.abs(i.v) / m * 100)}%"></i></span><span class="bh-val">${esc(format(i.v))}</span></li>`).join('')}</ul>`;
}

/* Entonnoir de conversion. etapes : [{ nom, v, estime? }] */
function entonnoir(etapes) {
  const max = etapes[0].v || 1;
  return `<ol class="entonnoir">${etapes.map((e, i) => {
    const conv = i ? (etapes[i - 1].v ? e.v / etapes[i - 1].v : 0) : null;
    return `<li data-tip="${esc(`${e.nom} : ${Math.round(e.v).toLocaleString('fr-FR')}${conv !== null ? ` (${fmtPct(conv)} de l’étape précédente)` : ''}`)}">
      <span class="en-nom">${esc(e.nom)}${e.estime ? ' <small>estimé</small>' : ''}</span>
      <span class="en-piste"><i style="width:${Math.max(1, e.v / max * 100)}%"></i></span>
      <span class="en-val">${Math.round(e.v).toLocaleString('fr-FR')}</span>
      <span class="en-conv">${conv === null ? '' : fmtPct(conv)}</span></li>`;
  }).join('')}</ol>`;
}

/* Carte de chaleur (rampe séquentielle bleue). valeurs[ligne][colonne], null = sans donnée. */
function chaleur({ lignes, colonnes, valeurs, format = v => v, tip = (l, c, v) => `${l} · ${c} : ${format(v)}`, afficher = false }) {
  const toutes = valeurs.flat().filter(v => v !== null && v !== undefined);
  const max = Math.max(...toutes, 1e-9);
  const niveau = v => v === null || v === undefined ? 'vide' : v <= 0 ? 'n0' : 'n' + Math.min(6, 1 + Math.floor(v / max * 5.999));
  return `<div class="chaleur-wrap"><table class="chaleur"><thead><tr><th></th>${colonnes.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
    ${lignes.map((l, i) => `<tr><th>${esc(l)}</th>${colonnes.map((c, j) => { const v = valeurs[i][j]; return `<td class="${niveau(v)}" ${v === null || v === undefined ? '' : `data-tip="${esc(tip(l, c, v))}"`}>${afficher && v !== null && v !== undefined ? esc(format(v)) : ''}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table>
  <div class="echelle-chaleur"><span>Moins</span>${[0, 1, 2, 3, 4, 5, 6].map(n => `<i class="n${n}"></i>`).join('')}<span>Plus</span></div></div>`;
}

/* Cascade (du chiffre d’affaires au bénéfice). etapes : [{ nom, v, total? }] ; v négatif = déduction. */
function cascade(etapes, { format = compact, formatTip = format, hauteur = 260 } = {}) {
  const L = largeurDispo(1), H = hauteur, m = { g: 56, d: 10, h: 14, b: 44 };
  let cumul = 0;
  const barres = etapes.map(e => {
    if (e.total) { const b = { ...e, de: 0, a: e.v }; cumul = e.v; return b; }
    const b = { ...e, de: cumul, a: cumul + e.v }; cumul += e.v; return b;
  });
  const max = Math.max(1, ...barres.map(b => Math.max(b.de, b.a)));
  const min = Math.min(0, ...barres.map(b => Math.min(b.de, b.a)));
  const pas = pasLisible(max - min), haut = Math.ceil(max / pas) * pas, bas = Math.floor(min / pas) * pas;
  const y = v => m.h + (H - m.h - m.b) * (haut - v) / (haut - bas);
  const bande = (L - m.g - m.d) / barres.length, larg = Math.min(56, bande * 0.62);
  let svg = `<svg viewBox="0 0 ${L} ${H}" class="graph cascade" role="img" aria-label="Du chiffre d’affaires au bénéfice">`;
  for (let t = bas; t <= haut + 1e-9; t += pas) svg += `<line x1="${m.g}" x2="${L - m.d}" y1="${y(t)}" y2="${y(t)}" class="grille${t === 0 ? ' zero' : ''}"/><text x="${m.g - 8}" y="${y(t) + 3.5}" text-anchor="end" class="axe">${esc(format(t))}</text>`;
  barres.forEach((b, i) => {
    const x = m.g + i * bande + (bande - larg) / 2;
    const top = y(Math.max(b.de, b.a)), h = Math.max(1, Math.abs(y(b.de) - y(b.a)));
    const classe = b.total ? (b.v < 0 ? 'negatif' : 's1') : 's2';
    svg += `<rect x="${x}" y="${top}" width="${larg}" height="${h}" rx="2" class="cb ${classe}" data-tip="${esc(`${b.nom} : ${formatTip(b.v)}`)}"/>`;
    if (i < barres.length - 1) svg += `<line x1="${x + larg}" x2="${x + bande}" y1="${y(b.a)}" y2="${y(b.a)}" class="liaison"/>`;
    svg += `<text x="${x + larg / 2}" y="${top - 5}" text-anchor="middle" class="axe valeur">${esc(format(b.v))}</text>`;
    const mots = b.nom.split(' ');
    const coupe = mots.length > 1 && b.nom.length > 10;
    const l1 = coupe ? mots.slice(0, Math.ceil(mots.length / 2)).join(' ') : b.nom, l2 = coupe ? mots.slice(Math.ceil(mots.length / 2)).join(' ') : '';
    svg += `<text x="${x + larg / 2}" y="${H - m.b + 16}" text-anchor="middle" class="axe">${esc(l1)}</text>${l2 ? `<text x="${x + larg / 2}" y="${H - m.b + 29}" text-anchor="middle" class="axe">${esc(l2)}</text>` : ''}`;
  });
  return svg + '</svg>' + legendeGraph([{ nom: 'Totaux', classe: 's1' }, { nom: 'Déductions', classe: 's2' }]);
}

/* Petite courbe pour les tuiles de chiffres clés. */
function sparkline(valeurs, classe = 's1') {
  if (!valeurs.length) return '';
  const L = 96, H = 28, max = Math.max(...valeurs, 1e-9), min = Math.min(...valeurs, 0);
  const x = i => 2 + i * (L - 4) / Math.max(1, valeurs.length - 1), y = v => H - 3 - (H - 6) * (v - min) / (max - min || 1);
  const pts = valeurs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${L} ${H}" class="spark" aria-hidden="true"><polyline points="${pts}" class="trait ${classe}"/><circle cx="${x(valeurs.length - 1)}" cy="${y(valeurs[valeurs.length - 1])}" r="2.5" class="point ${classe}"/></svg>`;
}

/* Tuile de chiffre clé avec évolution et tendance. */
function tuile({ nom, valeur, actuel, precedent, tendance = [], inverse = false, note = '' }) {
  let evol = '';
  if (precedent === null && !note) note = 'pas assez d’historique pour comparer';
  if (precedent !== undefined && precedent !== null && precedent !== 0) {
    const d = actuel / precedent - 1;
    const bon = inverse ? d <= 0 : d >= 0;
    evol = `<span class="evol ${bon ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(d))}</span>`;
  } else if (precedent === 0 && actuel > 0) evol = '<span class="evol up">nouveau</span>';
  return `<div class="kpi tuile"><span>${esc(nom)}</span><div class="tuile-ligne"><strong>${valeur}</strong>${sparkline(tendance)}</div><div class="tuile-pied">${evol}<span class="sous">${note || 'vs période précédente'}</span></div></div>`;
}
