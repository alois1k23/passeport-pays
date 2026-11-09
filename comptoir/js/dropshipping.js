/* Comptoir — dropshipping et Suisse.
   - Catalogue de fournisseurs (entrepôts en Suisse, en Europe ou en Chine)
   - Calcul de la marge nette réelle : prix de vente, TVA, coût fournisseur,
     port, TVA d’importation et frais de dédouanement estimés, frais de paiement,
     coût publicitaire par vente
   - Score « potentiel » d’un produit : marge, tendance de saison, concurrence, délai
   - Boutique de démonstration à Lausanne (CHF, La Poste, TWINT)
   Fournisseurs, coûts et délais sont fictifs ; en production : API fournisseurs
   (entrepôts européens et suisses), Swiss Post, TWINT/Stripe. */

const TVA_CH = 0.081;
const ENTREPOTS = {
  CH: { nom: 'Suisse', court: 'CH', ton: 'good', fraisDouane: 0 },
  UE: { nom: 'Europe', court: 'UE', ton: 'info', fraisDouane: 3.5 },
  CN: { nom: 'Chine', court: 'CN', ton: 'warn', fraisDouane: 6 }
};

/* [id, nom, niche, catégorie, coût, port fournisseur, entrepôt, délai min, délai max, prix conseillé, tendance, concurrence, note, fournisseur] */
const CATALOGUE = [
  ['f01', 'Lampe coucher de soleil', 'maison', 'Luminaires', 9.5, 4.5, 'CN', 9, 16, 39, 72, 88, 4.3, 'Shenzhen Home Supply (démo)'],
  ['f02', 'Lampe coucher de soleil', 'maison', 'Luminaires', 12.9, 5.9, 'UE', 4, 7, 39, 72, 88, 4.6, 'EuroDepot Lyon (démo)'],
  ['f03', 'Humidificateur effet flamme', 'maison', 'Diffuseurs', 14, 5, 'UE', 3, 6, 54, 80, 55, 4.7, 'EuroDepot Lyon (démo)'],
  ['f04', 'Veilleuse lune 3D', 'maison', 'Luminaires', 7, 4, 'CN', 10, 18, 29, 45, 92, 4.1, 'Shenzhen Home Supply (démo)'],
  ['f05', 'Plaid gaufré coton bio', 'maison', 'Textile', 24, 6.9, 'UE', 4, 7, 79, 68, 40, 4.8, 'Textil Porto (démo)'],
  ['f06', 'Organiseur de tiroir en bambou', 'maison', 'Rangement', 8, 5.5, 'CH', 2, 3, 34, 50, 35, 4.5, 'Fournisseur Lémanique (démo)'],
  ['f07', 'Bougie au bois de cèdre', 'maison', 'Bougies', 11, 6, 'CH', 1, 3, 36, 64, 30, 4.9, 'Fournisseur Lémanique (démo)'],
  ['f08', 'Fontaine à eau pour chat', 'animaux', 'Accessoires', 13, 5, 'UE', 4, 7, 49, 75, 60, 4.5, 'PetDepot Milano (démo)'],
  ['f09', 'Panier apaisant pour chien', 'animaux', 'Couchage', 18, 8, 'UE', 5, 8, 69, 70, 66, 4.4, 'PetDepot Milano (démo)'],
  ['f10', 'Balle interactive pour chat', 'animaux', 'Jouets', 5, 4, 'CN', 10, 20, 24, 55, 90, 3.9, 'Ningbo Pets (démo)'],
  ['f11', 'Chargeur 3-en-1 pliable', 'tech', 'Recharge', 17, 5, 'UE', 4, 6, 69, 78, 72, 4.6, 'TechHub Rotterdam (démo)'],
  ['f12', 'Support voiture magnétique', 'tech', 'Accessoires', 9, 4, 'CN', 9, 16, 35, 60, 82, 4.2, 'Shenzhen Mobile (démo)'],
  ['f13', 'Traceur d’objets Bluetooth', 'tech', 'Accessoires', 8, 4, 'CN', 10, 18, 29, 85, 94, 4.0, 'Shenzhen Mobile (démo)'],
  ['f14', 'Masque LED visage', 'beaute', 'Visage', 39, 7, 'UE', 4, 7, 149, 70, 60, 4.4, 'BeautyLab Barcelona (démo)'],
  ['f15', 'Brosse soufflante', 'beaute', 'Cheveux', 24, 6, 'UE', 4, 6, 89, 74, 72, 4.5, 'BeautyLab Barcelona (démo)'],
  ['f16', 'Rouleau quartz rose', 'beaute', 'Visage', 4, 3.5, 'CN', 10, 20, 25, 40, 95, 4.0, 'Guangzhou Beauty (démo)'],
  ['f17', 'Pistolet de massage compact', 'sport', 'Matériel', 22, 6, 'UE', 3, 6, 89, 66, 76, 4.5, 'FitStock Berlin (démo)'],
  ['f18', 'Tapis de yoga en liège', 'sport', 'Matériel', 28, 7, 'CH', 2, 3, 79, 55, 40, 4.8, 'Fournisseur Lémanique (démo)']
].map(([id, nom, niche, categorie, cout, portF, entrepot, dmin, dmax, prix, tendance, concurrence, note, fournisseur]) =>
  ({ id, nom, niche, categorie, cout, portF, entrepot, delai: [dmin, dmax], prix, tendance, concurrence, note, fournisseur }));

function reglages() {
  etat.reglages = etat.reglages || { autoTransmission: true, cpa: 8 };
  return etat.reglages;
}
function estSuisse() { return etat.boutique.pays === 'ch'; }
function tauxTvaVente() {
  const r = etat.entreprise.regime;
  return r === 'ch-assujetti' ? TVA_CH : r === 'normal' ? 0.2 : 0;
}

/* Marge nette par vente. Toutes les valeurs sont dans la devise de la boutique (estimations). */
function margeProduit(p, { prix = p.prix, cpa = reglages().cpa } = {}) {
  const ht = prix / (1 + tauxTvaVente());
  const achat = p.type === 'drop' ? p.cout + (p.portF || 0) : (p.cout || prix * 0.35);
  let importTva = 0, douane = 0;
  if (p.type === 'drop' && estSuisse() && p.entrepot && p.entrepot !== 'CH') {
    importTva = (p.cout + p.portF) * TVA_CH;
    if (importTva <= 5) importTva = 0; // montant d’impôt de CHF 5 ou moins : pas perçu
    douane = ENTREPOTS[p.entrepot].fraisDouane;
  }
  const paiement = prix * 0.025 + 0.3;
  const avantPub = ht - achat - importTva - douane - paiement;
  const nette = avantPub - cpa;
  return {
    ht, achat, importTva, douane, paiement, cpa, avantPub, nette,
    taux: nette / prix,
    roasSeuil: avantPub > 0 ? prix / avantPub : Infinity
  };
}

function potentielProduit(f) {
  const p = { ...f, type: 'drop' };
  const m = margeProduit(p);
  const mois = new Date().getMonth();
  const indice = (SECTEURS[f.niche] ? SECTEURS[f.niche].courbe[mois] : 100) / 100;
  const sMarge = Math.max(0, Math.min(100, m.taux * 250));
  const sTendance = Math.min(100, f.tendance * indice);
  const sConcurrence = 100 - f.concurrence;
  const sDelai = Math.max(0, 100 - (f.delai[1] - 2) * 6);
  const score = Math.round(sMarge * 0.35 + sTendance * 0.25 + sConcurrence * 0.2 + sDelai * 0.2);
  const raisons = [];
  if (m.taux >= 0.25) raisons.push(`marge nette ${Math.round(m.taux * 100)} %`);
  if (m.nette < 0) raisons.push('perte après publicité');
  if (indice >= 1.2) raisons.push(`demande +${Math.round((indice - 1) * 100)} % en ${MOIS_LONG[mois]}`);
  if (f.concurrence >= 85) raisons.push('marché saturé');
  if (f.entrepot === 'CN') raisons.push(`livraison lente (${f.delai[0]}–${f.delai[1]} j) et frais de douane pour le client`);
  if (f.entrepot === 'CH') raisons.push('expédié depuis la Suisse');
  return { score, marge: m, raisons };
}

function produitDepuisCatalogue(f) {
  return {
    id: nouvelId('p'), nom: f.nom, categorie: f.categorie, prix: f.prix,
    description: redigerDescription(f.nom, f.categorie),
    stock: 999, teinte: (f.id.charCodeAt(2) * 47) % 360, actif: true,
    type: 'drop', cout: f.cout, portF: f.portF, entrepot: f.entrepot, delai: f.delai,
    fournisseur: f.fournisseur, source: f.id
  };
}

/* ---------- Vue : trouver des produits ---------- */
function vueSourcing() {
  const s = ui.sourcing;
  const niches = [...new Set(CATALOGUE.map(f => f.niche))];
  const importes = new Set(etat.produits.map(p => p.source).filter(Boolean));
  const liste = CATALOGUE
    .filter(f => !s.niche || f.niche === s.niche)
    .filter(f => s.entrepots.includes(f.entrepot))
    .filter(f => f.delai[1] <= s.delaiMax)
    .map(f => ({ f, ...potentielProduit(f) }))
    .sort((a, b) => b.score - a.score);
  return `
  <div class="tete"><div><h1>Trouver des produits</h1><p class="sous">Catalogue fournisseurs classé selon votre marge nette réelle, la saison, la concurrence et le délai de livraison.</p></div></div>
  ${estSuisse() ? `<p class="encart">Pour vendre en Suisse, privilégiez les entrepôts suisses et européens. Vos clients attendent un colis en 2 à 7 jours. Avec un envoi de Chine, ils risquent de payer eux-mêmes la TVA d’importation et des frais de dédouanement à la livraison : c’est la première cause de mauvais avis.</p>` : ''}
  <section class="carte filtres-domaine">
    <label class="champ"><span>Niche</span><select id="sc-niche" data-sourcing="niche"><option value="">Toutes</option>${niches.map(n => `<option value="${n}" ${s.niche === n ? 'selected' : ''}>${esc(SECTEURS[n].nom)}</option>`).join('')}</select></label>
    <fieldset class="champ cases-ligne"><legend>Entrepôt</legend>${Object.entries(ENTREPOTS).map(([k, e]) => `<label class="case"><input type="checkbox" data-entrepot="${k}" ${s.entrepots.includes(k) ? 'checked' : ''}> ${e.nom}</label>`).join('')}</fieldset>
    <label class="champ"><span>Délai maximum</span><select id="sc-delai" data-sourcing="delaiMax">${[[7, '7 jours'], [10, '10 jours'], [20, '20 jours']].map(([v, n]) => `<option value="${v}" ${s.delaiMax === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="champ"><span>Coût pub par vente (estimé)</span><input id="sc-cpa" type="number" min="0" step="0.5" value="${reglages().cpa}" data-reglage="cpa"></label>
  </section>
  <div class="catalogue">${liste.map(({ f, score, marge, raisons }) => `
    <article class="carte produit-cat">
      <div class="pc-tete">${visuelProduit({ nom: f.nom, teinte: (f.id.charCodeAt(2) * 47) % 360 })}
        <div><h2>${esc(f.nom)}</h2><div class="sous">${esc(f.fournisseur)} · note ${f.note.toFixed(1).replace('.', ',')}</div>
        <div class="rangee"><span class="pill ${ENTREPOTS[f.entrepot].ton}">Entrepôt ${ENTREPOTS[f.entrepot].nom}</span><span class="tag">${f.delai[0]}–${f.delai[1]} j</span></div></div>
        <div class="potentiel" title="Score de potentiel sur 100"><b>${score}</b><span>potentiel</span></div></div>
      <dl class="marge">
        <div><dt>Prix conseillé</dt><dd>${euros(f.prix)}</dd></div>
        <div><dt>Coût + port fournisseur</dt><dd>${euros(f.cout + f.portF)}</dd></div>
        <div><dt>Douane et TVA import</dt><dd>${marge.importTva + marge.douane ? euros(marge.importTva + marge.douane) : '—'}</dd></div>
        <div><dt>Marge nette après pub</dt><dd class="${marge.nette >= 0 ? 'up' : 'down'}">${euros(marge.nette)} · ${Math.round(marge.taux * 100)} %</dd></div>
      </dl>
      ${blocCriteres(f)}
      <p class="sous">${esc(raisons.join(' · '))}</p>
      ${importes.has(f.id) ? '<span class="pill good">Dans votre boutique</span>' : `<button class="btn" data-action="importer-produit" data-id="${f.id}">Importer dans ma boutique</button>`}
    </article>`).join('') || '<p class="sous">Aucun produit ne correspond à ces filtres.</p>'}</div>
  <p class="note">Démo : fournisseurs, coûts et délais fictifs. Frais de paiement estimés à 2,5 % + 0,30 ; frais de dédouanement transporteur estimés.</p>`;
}

/* Bloc « marge » affiché dans la fiche produit. */
function blocMarge(p) {
  const m = margeProduit(p);
  const ligne = (n, v, neg = true) => `<div><span>${n}</span><span>${neg && v ? '−' : ''}${euros(v)}</span></div>`;
  return `<div class="bloc calcul-marge"><h3>Marge nette par vente</h3>
    ${ligne('Prix de vente TTC', p.prix, false)}
    ${tauxTvaVente() ? ligne(`TVA ${Math.round(tauxTvaVente() * 1000) / 10} %`, p.prix - m.ht) : ''}
    ${ligne(p.type === 'drop' ? 'Fournisseur + port' : 'Coût d’achat', m.achat)}
    ${m.importTva || m.douane ? ligne('TVA import + dédouanement', m.importTva + m.douane) : ''}
    ${ligne('Frais de paiement', m.paiement)}
    ${ligne('Publicité par vente', m.cpa)}
    <div class="total ${m.nette >= 0 ? 'up' : 'down'}"><span>Marge nette</span><span>${euros(m.nette)} (${Math.round(m.taux * 100)} %)</span></div>
    <p class="sous">Seuil de rentabilité publicitaire : ROAS ${isFinite(m.roasSeuil) ? m.roasSeuil.toFixed(1).replace('.', ',') : '∞'}. En dessous, chaque vente issue de la pub vous coûte de l’argent.</p></div>`;
}

/* Bénéfice estimé d’une commande. */
function beneficeCommande(c) {
  if (['annulee', 'remboursee', 'attente'].includes(c.statut)) return 0;
  const taux = tauxTvaVente();
  let cout = 0;
  for (const l of c.lignes) {
    const p = etat.produits.find(x => x.id === l.produitId);
    if (!p) { cout += l.prix * 0.4 * l.qte; continue; }
    const m = margeProduit(p, { prix: l.prix, cpa: 0 });
    cout += (m.achat + m.importTva + m.douane) * l.qte;
  }
  const portReel = c.canal === 'magasin' ? 0 : c.lignes.every(l => (etat.produits.find(x => x.id === l.produitId) || {}).type === 'drop') ? 0 : 7;
  return c.total / (1 + taux) - cout - (c.total * 0.025 + 0.3) - portReel;
}

function estDropship(c) {
  return c.lignes.length > 0 && c.lignes.every(l => (etat.produits.find(x => x.id === l.produitId) || {}).type === 'drop');
}

/* ---------- Démo : Lacustre, boutique de dropshipping à Lausanne ---------- */
const VILLES_CH = ['Lausanne', 'Lausanne', 'Genève', 'Genève', 'Fribourg', 'Neuchâtel', 'Sion', 'Montreux', 'Vevey', 'Morges', 'Nyon', 'Yverdon-les-Bains', 'Berne', 'Zurich', 'Renens', 'Pully'];
function boutiqueDemoLausanne() {
  const rand = prng(10031003);
  const nom = 'Lacustre';
  const depuis = ['f02', 'f03', 'f05', 'f06', 'f07', 'f04'].map(id => CATALOGUE.find(f => f.id === id));
  const produits = depuis.map((f, i) => ({
    id: 'p' + (i + 1), nom: f.nom, categorie: f.categorie, prix: f.prix, description: `${f.nom}, sélectionné par Lacustre. Expédié depuis notre entrepôt partenaire (${ENTREPOTS[f.entrepot].nom}), livré en ${f.delai[0]} à ${f.delai[1]} jours, retours gratuits 30 jours.`,
    stock: 999, teinte: (f.id.charCodeAt(2) * 47) % 360, actif: true,
    type: 'drop', cout: f.cout, portF: f.portF, entrepot: f.entrepot, delai: f.delai, fournisseur: f.fournisseur, source: f.id
  }));
  produits.push({ id: 'p7', nom: 'Coffret Léman fait main', categorie: 'Bougies', prix: 59, description: 'Bougie, savon et carte postale du lac, assemblés à Lausanne.', stock: 4, teinte: 195, actif: true, type: 'stock', cout: 21 });
  const now = Date.now(), jour = 86400000;
  const commandes = [];
  for (let d = 75; d >= 0; d--) {
    const n = Math.floor(rand() * (d < 20 ? 3.4 : d < 45 ? 2.2 : 1.3));
    for (let k = 0; k < n; k++) {
      const date = now - d * jour - Math.floor(rand() * jour * 0.8);
      const lignes = [];
      const nb = 1 + Math.floor(rand() * 1.8);
      for (let j = 0; j < nb; j++) {
        const p = produits[Math.floor(Math.pow(rand(), 1.3) * produits.length)];
        const ex = lignes.find(l => l.produitId === p.id);
        if (ex) ex.qte++; else lignes.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 });
      }
      const sousTotal = lignes.reduce((a, l) => a + l.prix * l.qte, 0);
      const r = rand();
      const livraison = r < 0.65 ? 'poste-eco' : r < 0.85 ? 'poste-prio' : 'pickpost';
      const port = fraisPort(livraison, sousTotal);
      const drop = lignes.every(l => produits.find(p => p.id === l.produitId).type === 'drop');
      let statut;
      if (d > 9) statut = rand() < 0.04 ? 'remboursee' : 'livree';
      else if (d > 3) statut = rand() < 0.5 ? 'livree' : 'expediee';
      else if (d > 0) statut = drop ? (rand() < 0.5 ? 'expediee' : 'fournisseur') : 'preparation';
      else statut = rand() < 0.12 ? 'attente' : 'payee';
      const prenom = PRENOMS[Math.floor(rand() * PRENOMS.length)];
      const nomF = NOMS[Math.floor(rand() * NOMS.length)];
      const hist = [{ date, texte: 'Commande passée (TWINT)' }];
      if (drop && !['attente', 'payee'].includes(statut)) hist.push({ date: date + 600000, texte: 'Transmise automatiquement au fournisseur' });
      commandes.push({
        id: '', numero: 0, date,
        client: { nom: `${prenom} ${nomF}`, email: `${prenom}.${nomF}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@exemple.ch', ville: VILLES_CH[Math.floor(rand() * VILLES_CH.length)] },
        lignes, sousTotal, port, total: Math.round((sousTotal + port) * 100) / 100,
        statut, livraison, canal: 'web',
        suivi: ['expediee', 'livree'].includes(statut) ? '99.60.' + Math.floor(100000 + rand() * 899999) + '.' + Math.floor(10000000 + rand() * 89999999) : '',
        refFournisseur: drop && !['attente', 'payee'].includes(statut) ? 'FO-' + Math.floor(100000 + rand() * 899999) : '',
        historique: hist, note: ''
      });
    }
  }
  commandes.sort((a, b) => a.date - b.date).forEach((c, i) => { c.numero = 1001 + i; c.id = 'c' + c.numero; });
  return completerEtat({
    version: 2,
    boutique: {
      nom, secteur: 'maison', slogan: 'Objets doux pour la maison, livrés en Suisse romande',
      theme: { ...THEMES.leman, id: 'leman' },
      sections: sectionsParDefaut(nom, 'maison', 'ch'),
      domaine: null, publiee: true, pays: 'ch', devise: 'CHF', modele: 'mixte', langues: ['fr']
    },
    produits, commandes, visites30j: 6240,
    entreprise: { raison: 'Lacustre', forme: 'Raison individuelle', siret: 'CHE-000.000.000 (démo)', tvaIntra: '', adresse: 'Lausanne (adresse à compléter)', email: 'bonjour@lacustre.ch', regime: 'ch-non', mediateur: '' },
    magasin: { actif: false, adresse: 'Marché de Noël, place de la Riponne (pop-up)', horaires: 'Décembre, jeu.–dim.', clickCollect: false, googleSync: false },
    reglages: { autoTransmission: true, cpa: 8 }
  });
}

/* ---------- Événements ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'importer-produit') {
    const f = CATALOGUE.find(x => x.id === id);
    etat.produits.push(produitDepuisCatalogue(f));
    sauver();
    toast(`« ${f.nom} » ajouté à votre boutique. Les commandes seront transmises à ${f.fournisseur}.`, ['produits', 'Voir les produits']);
    rendre();
  } else if (action === 'transmettre-fournisseur') {
    const c = etat.commandes.find(x => x.id === id);
    transmettre(c, false);
    sauver(); rendre();
  } else if (action === 'demo') {
    etat = id === 'lyon' ? boutiqueDemo() : boutiqueDemoLausanne();
    sauver(); ui.commande = null; ui.section = null;
    toast(id === 'lyon' ? 'Démo artisan (Lyon) chargée.' : 'Démo dropshipping (Lausanne) chargée.');
    location.hash = 'tableau'; rendre();
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.sourcing) { ui.sourcing[t.dataset.sourcing] = t.dataset.sourcing === 'delaiMax' ? Number(t.value) : t.value; rendre(); }
  else if (t.dataset.entrepot) {
    const k = t.dataset.entrepot;
    ui.sourcing.entrepots = t.checked ? [...ui.sourcing.entrepots, k] : ui.sourcing.entrepots.filter(x => x !== k);
    rendre();
  } else if (t.dataset.langue) {
    const l = etat.boutique.langues;
    etat.boutique.langues = t.checked ? [...new Set([...l, t.dataset.langue])] : l.filter(x => x !== t.dataset.langue);
    sauver(); toast(t.checked ? 'Langue ajoutée : pages et fiches traduites automatiquement (simulé), à relire.' : 'Langue retirée.');
  } else if (t.dataset.reglage) {
    reglages()[t.dataset.reglage] = t.type === 'checkbox' ? t.checked : Number(t.value); sauver(); rendre();
  }
});

/* Transmission d’une commande au fournisseur (automatique au paiement si activée). */
function transmettre(c, auto) {
  c.statut = 'fournisseur';
  c.refFournisseur = 'FO-' + Math.floor(100000 + Math.random() * 899999);
  const fournisseurs = [...new Set(c.lignes.map(l => (etat.produits.find(p => p.id === l.produitId) || {}).fournisseur).filter(Boolean))];
  c.historique.push({ date: Date.now(), texte: `${auto ? 'Transmise automatiquement' : 'Transmise'} à ${fournisseurs.join(', ')} (${c.refFournisseur})` });
  if (!auto) toast(`Commande #${c.numero} transmise au fournisseur. Le suivi arrivera dès l’expédition.`);
}
