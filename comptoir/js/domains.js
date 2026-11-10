/* Comptoir — moteur de suggestion de noms de domaine.
   Combine quatre signaux :
   1. la demande du marché  (volume des mots-clés du secteur × courbe saisonnière du mois)
   2. la demande des clients (part de chaque catégorie dans les ventes des 90 derniers jours)
   3. la saison             (temps fort commercial du mois : Black Friday, Noël…)
   4. la qualité du nom     (longueur, tiret, extension adaptée au pays)
   Disponibilité et prix sont simulés de façon déterministe pour la démo.
   En production : API d’un registrar (OVH, Gandi, Namecheap) + Google Trends. */

const EXTENSIONS = {
  fr: { prix: 7.99, renouv: 9.99, pays: 'fr' },
  be: { prix: 8.99, renouv: 10.99, pays: 'be' },
  ch: { prix: 12.99, renouv: 14.99, pays: 'ch' },
  ca: { prix: 13.99, renouv: 15.99, pays: 'ca' },
  com: { prix: 11.99, renouv: 14.99 },
  shop: { prix: 2.99, renouv: 34.99 },
  store: { prix: 4.99, renouv: 49.99 },
  boutique: { prix: 24.99, renouv: 29.99 },
  co: { prix: 9.99, renouv: 29.99 }
};

function slugifier(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'et').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function hachage(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* Parts de ventes par catégorie, traduites en poids de mots-clés. */
function signalClients(etat) {
  const limite = Date.now() - 90 * 86400000;
  const parCat = {};
  let total = 0;
  for (const c of etat.commandes) {
    if (c.date < limite || ['annulee', 'remboursee'].includes(c.statut)) continue;
    for (const l of c.lignes) {
      const p = etat.produits.find(x => x.id === l.produitId);
      const cat = p ? p.categorie : 'Autre';
      parCat[cat] = (parCat[cat] || 0) + l.prix * l.qte;
      total += l.prix * l.qte;
    }
  }
  return Object.entries(parCat).map(([cat, v]) => ({ cat, part: total ? v / total : 0 })).sort((a, b) => b.part - a.part);
}

function suggererDomaines({ marque, secteurId, motsCles = [], pays = 'fr', mois = new Date().getMonth(), etat }) {
  const secteur = SECTEURS[secteurId];
  const saison = saisonDuMois(mois);
  const base = slugifier(marque).replace(/-/g, '') || 'maboutique';
  const baseTiret = slugifier(marque) || 'ma-boutique';
  const indiceMois = secteur.courbe[mois] / 100;
  const maxVol = Math.max(...secteur.kws.map(k => k[1]));

  // Mots-clés : ceux du secteur, renforcés par les catégories qui se vendent le mieux.
  const signal = etat ? signalClients(etat) : [];
  const kws = secteur.kws.map(([kw, vol]) => {
    const cat = signal.find(s => slugifier(s.cat).startsWith(kw.slice(0, 5)) || kw.startsWith(slugifier(s.cat).slice(0, 5)));
    return { kw, vol, boost: cat ? 1 + cat.part : 1, cat: cat ? cat.cat : null };
  });
  for (const m of motsCles) {
    const s = slugifier(m).replace(/-/g, '');
    if (s && !kws.find(k => k.kw === s)) kws.push({ kw: s, vol: maxVol * 0.4, boost: 1.2, cat: null, perso: true });
  }
  kws.sort((a, b) => b.vol * b.boost - a.vol * a.boost);
  const topKws = kws.slice(0, 3);

  const extPays = EXTENSIONS[pays] ? pays : 'fr';
  const extensions = [extPays, 'com', 'shop', 'store', 'boutique', 'co'];

  const candidats = [];
  const ajouter = (nom, ext, meta) => {
    const domaine = `${nom}.${ext}`;
    if (!candidats.find(c => c.domaine === domaine)) candidats.push({ domaine, nom, ext, ...meta });
  };
  for (const ext of extensions) ajouter(base, ext, { genre: 'marque' });
  if (baseTiret !== base) ajouter(baseTiret, extPays, { genre: 'marque' });
  for (const k of topKws) {
    ajouter(base + k.kw, extPays, { genre: 'marque+mot-clé', kw: k });
    ajouter(`${baseTiret}-${k.kw}`, 'com', { genre: 'marque+mot-clé', kw: k });
    ajouter(`${k.kw}-${baseTiret}`, extPays, { genre: 'marque+mot-clé', kw: k });
  }
  ajouter('maison' + base.replace(/^maison/, ''), extPays, { genre: 'marque' });
  ajouter(base + 'shop', 'com', { genre: 'marque' });
  ajouter(`${topKws[0].kw}-${slugifier(secteur.kws[1][0])}`, extPays, { genre: 'générique', kw: topKws[0] });
  // Domaines de campagne : mot-clé de la saison en cours et de la suivante.
  const suivante = saisonDuMois((mois + 1) % 12);
  ajouter(`${saison.kw}-${baseTiret}`, extPays, { genre: 'campagne', saison });
  ajouter(`${saison.kw}-${topKws[0].kw}`, 'shop', { genre: 'campagne', saison });
  if (suivante.kw !== saison.kw) ajouter(`${suivante.kw}-${baseTiret}`, extPays, { genre: 'campagne', saison: suivante, anticipe: true });

  const resultats = candidats.map(c => {
    const raisons = [];
    // 1 + 2 : demande (marché × clients) — une marque seule hérite de la demande du secteur
    let demande;
    if (c.kw) {
      demande = Math.min(100, (c.kw.vol / maxVol) * 70 * c.kw.boost * indiceMois + 20);
      raisons.push(`« ${c.kw.kw} » : environ ${(Math.round(c.kw.vol * indiceMois / 100) * 100).toLocaleString('fr-FR')} recherches par mois en ${MOIS_LONG[mois]}`);
      if (c.kw.cat) raisons.push(`${c.kw.cat} pèse ${Math.round((c.kw.boost - 1) * 100)} % de vos ventes sur 90 jours`);
      if (c.kw.perso) raisons.push('Mot-clé ajouté par vous');
    } else if (c.genre === 'campagne') {
      demande = Math.min(100, 45 + c.saison.force * 50 * indiceMois);
    } else {
      demande = Math.min(100, 40 + indiceMois * 30);
    }
    // 3 : saison
    let saisonScore;
    if (c.genre === 'campagne') {
      saisonScore = c.anticipe ? Math.round(c.saison.force * 80) : Math.round(c.saison.force * 100);
      raisons.push(c.anticipe ? `Anticipe « ${c.saison.nom} » (${MOIS_LONG[c.saison.mois]})` : `Temps fort du mois : ${c.saison.nom}`);
    } else {
      saisonScore = Math.round(Math.min(100, indiceMois * 70));
      if (indiceMois >= 1.2) raisons.push(`Votre secteur est ${Math.round((indiceMois - 1) * 100)} % au-dessus de sa moyenne en ${MOIS_LONG[mois]}`);
    }
    // 4 : qualité du nom
    const longueur = c.nom.replace(/-/g, '').length;
    const court = Math.max(0, Math.min(100, 112 - longueur * 5));
    let memo = 100;
    const tirets = (c.nom.match(/-/g) || []).length;
    memo -= tirets * 14;
    if (/\d/.test(c.nom)) memo -= 25;
    if (/(.)\1\1/.test(c.nom)) memo -= 15;
    const extFit = { [extPays]: 100, com: 92, shop: 80, store: 70, boutique: 72, co: 55 }[c.ext] ?? 60;
    if (c.ext === extPays) raisons.push(`.${c.ext} inspire confiance aux clients locaux`);
    if (c.ext === 'shop' || c.ext === 'store') raisons.push(`.${c.ext} annonce une boutique, mais renouvellement à ${euros(EXTENSIONS[c.ext].renouv)}`);
    if (longueur <= 10) raisons.push('Court et facile à retenir');

    // Disponibilité simulée : les noms génériques et les .com courts sont plus souvent pris.
    const h = hachage(c.domaine) % 100;
    let seuil = c.genre === 'générique' ? 85 : c.genre === 'campagne' ? 30 : 22;
    if (c.ext === 'com' && longueur < 12) seuil += 35;
    const disponible = h >= seuil;
    const prime = !disponible && c.genre === 'générique' && h % 3 === 0;

    const score = Math.round(demande * 0.32 + saisonScore * 0.18 + court * 0.18 + memo * 0.14 + extFit * 0.18);
    return {
      ...c, disponible, prime,
      prix: prime ? 1450 + (h * 37) % 3000 : EXTENSIONS[c.ext].prix,
      renouv: EXTENSIONS[c.ext].renouv,
      score, detail: { demande: Math.round(demande), saison: saisonScore, court: Math.round(court), memo, extension: extFit },
      raisons
    };
  });

  resultats.sort((a, b) => (b.disponible - a.disponible) || (b.score - a.score));
  const principal = resultats.find(r => r.disponible && r.genre !== 'campagne');
  const campagne = resultats.find(r => r.disponible && r.genre === 'campagne' && !r.anticipe) || resultats.find(r => r.disponible && r.genre === 'campagne');
  return { resultats, principal, campagne, saison, signal, indiceMois, topKws };
}
