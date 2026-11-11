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
  ['f18', 'Tapis de yoga en liège', 'sport', 'Matériel', 28, 7, 'CH', 2, 3, 79, 55, 40, 4.8, 'Fournisseur Lémanique (démo)'],
  ['f19', 'Vase en céramique ondulé', 'deco', 'Vases', 11, 6, 'UE', 4, 7, 45, 66, 48, 4.6, 'Casa Lisboa (démo)'],
  ['f20', 'Miroir rond en rotin', 'deco', 'Miroirs', 16, 8, 'UE', 5, 8, 69, 62, 55, 4.5, 'Casa Lisboa (démo)'],
  ['f21', 'Cadre photo en chêne', 'deco', 'Cadres', 7, 4.5, 'CH', 2, 3, 32, 48, 38, 4.7, 'Atelier Jura Bois (démo)'],
  ['f22', 'Guirlande lumineuse en papier', 'deco', 'Luminaires', 5, 4, 'CN', 10, 18, 24, 58, 86, 4.1, 'Yiwu Decor (démo)'],
  ['f23', 'Écharpe en laine mérinos', 'mode', 'Accessoires', 17, 5, 'UE', 4, 7, 59, 70, 52, 4.6, 'Lana Biella (démo)'],
  ['f24', 'Sac banane en toile recyclée', 'mode', 'Sacs', 9, 4.5, 'UE', 4, 6, 39, 74, 64, 4.4, 'ReWear Amsterdam (démo)'],
  ['f25', 'Chaussettes en coton bio (lot de 3)', 'mode', 'Chaussettes', 6, 3.5, 'CH', 2, 3, 29, 52, 44, 4.8, 'Tricot Romand (démo)'],
  ['f26', 'Casquette brodée', 'mode', 'Accessoires', 4, 3.5, 'CN', 10, 20, 25, 60, 90, 3.9, 'Guangzhou Apparel (démo)'],
  ['f27', 'Coffret de thés en vrac', 'epicerie', 'Thés', 12, 5, 'CH', 1, 3, 42, 64, 40, 4.8, 'Herboristerie du Valais (démo)'],
  ['f28', 'Miel de montagne suisse', 'epicerie', 'Miels', 9, 5, 'CH', 1, 3, 28, 55, 35, 4.9, 'Rucher des Alpes (démo)'],
  ['f29', 'Coffret d’épices du monde', 'epicerie', 'Épices', 10, 5, 'UE', 4, 7, 39, 61, 50, 4.6, 'Spezie Milano (démo)'],
  ['f30', 'Huile d’olive vierge extra (50 cl)', 'epicerie', 'Huiles', 11, 6, 'UE', 4, 7, 35, 58, 62, 4.7, 'Spezie Milano (démo)'],
  ['f31', 'Bague fine en argent 925', 'bijoux', 'Bagues', 8, 3.5, 'UE', 4, 6, 49, 72, 70, 4.5, 'Argento Firenze (démo)'],
  ['f32', 'Collier perle d’eau douce', 'bijoux', 'Colliers', 10, 3.5, 'UE', 4, 6, 59, 66, 64, 4.6, 'Argento Firenze (démo)'],
  ['f33', 'Boucles d’oreilles créoles dorées', 'bijoux', 'Boucles', 3, 3, 'CN', 10, 18, 29, 70, 92, 4.0, 'Yiwu Jewelry (démo)'],
  ['f34', 'Bracelet jonc gravé', 'bijoux', 'Bracelets', 9, 3.5, 'CH', 2, 3, 45, 54, 42, 4.8, 'Atelier Genevois (démo)'],
  ['f35', 'Gourde isotherme 750 ml', 'sport', 'Hydratation', 9, 5, 'UE', 3, 6, 35, 63, 70, 4.6, 'FitStock Berlin (démo)'],
  ['f36', 'Bandes de résistance (lot de 5)', 'sport', 'Matériel', 6, 4, 'CN', 10, 18, 29, 58, 88, 4.1, 'Ningbo Sport (démo)'],
  ['f37', 'Griffoir en carton pour chat', 'animaux', 'Jouets', 6, 5, 'CH', 2, 3, 29, 52, 40, 4.7, 'Fournisseur Lémanique (démo)'],
  ['f38', 'Lampe de bureau sans fil', 'tech', 'Éclairage', 15, 5, 'UE', 4, 6, 59, 64, 58, 4.5, 'TechHub Rotterdam (démo)'],
  ['f39', 'Sérum à la vitamine C', 'beaute', 'Visage', 7, 3.5, 'CH', 2, 3, 39, 68, 66, 4.6, 'Laboratoire Léman (démo)']
].map(([id, nom, niche, categorie, cout, portF, entrepot, dmin, dmax, prix, tendance, concurrence, note, fournisseur]) =>
  ({ id, nom, niche, categorie, cout, portF, entrepot, delai: [dmin, dmax], prix, tendance, concurrence, note, fournisseur }));
// Catalogue élargi et profils saisonniers (js/catalogue.js, généré par outils/catalogue/generer.py).
if (typeof CATALOGUE_EXTRA !== 'undefined') {
  for (const f of CATALOGUE) Object.assign(f, CATALOGUE_EXTRA[f.id] || {});
  for (const n of CATALOGUE_NOUVEAUX) if (!CATALOGUE.some(f => f.id === n.id)) CATALOGUE.push(n);
}

function reglages() {
  etat.reglages = etat.reglages || { autoTransmission: true, cpa: 8 };
  return etat.reglages;
}
function estSuisse() { return etat.boutique.pays === 'ch'; }
/* Estimation de ce que le client paie à la livraison pour un article envoyé seul depuis l'étranger.
   Suisse : TVA d'importation 8,1 % perçue seulement au-delà de CHF 5 d'impôt par envoi (≈ CHF 62 de marchandise), plus les frais
   de dédouanement de La Poste (dès CHF 13 depuis l'UE, CHF 16 d'ailleurs). UE : depuis juillet 2021, TVA due dès le premier euro
   sur les envois venant de hors UE, plus des frais du transporteur, sauf si le fournisseur la perçoit à la vente (guichet IOSS). */
function fraisImportClient(p, prix = p.prix) {
  if (!p.entrepot) return null;
  if (estSuisse()) {
    if (p.entrepot === 'CH') return null;
    const tva = prix * TVA_CH;
    if (tva <= 5) return null;
    const frais = p.entrepot === 'UE' ? 13 : 16;
    return { montant: tva + frais, texte: `TVA d’importation (≈ ${euros(tva)}) et frais de dédouanement de La Poste (dès ${euros(frais)}) réclamés au client à la livraison.` };
  }
  if (p.entrepot === 'UE') return null;
  const tva = prix * droitPays().tva;
  return { montant: tva, texte: `Envoi depuis l’extérieur de l’UE : TVA d’importation (≈ ${euros(tva)}) et frais du transporteur réclamés au client à la livraison, sauf si le fournisseur utilise le guichet IOSS.` };
}

function tauxTvaVente() {
  const r = etat.entreprise.regime;
  return r === 'ch-assujetti' ? TVA_CH : r === 'normal' ? droitPays().tva : 0;
}

/* Marge nette par vente. Toutes les valeurs sont dans la devise de la boutique (estimations). */
function margeProduit(p, { prix = p.prix, cpa = reglages().cpa } = {}) {
  const ht = prix / (1 + tauxTvaVente());
  const achat = p.type === 'drop' ? p.cout + (p.portF || 0) : (p.cout || prix * 0.35);
  // Envoi direct du fournisseur au client, droits non payés (le cas habituel du dropshipping) : la TVA d'importation et les frais
  // de dédouanement sont réclamés au CLIENT à la livraison, pas au marchand. Ils ne sortent donc pas de la marge, mais ils
  // pèsent sur la vente : ils sont estimés (fraisClient) et signalés au marchand comme au client.
  const importTva = 0, douane = 0;
  const fraisClient = p.type === 'drop' ? fraisImportClient(p, prix) : null;
  const paiement = prix * 0.025 + 0.3;
  const avantPub = ht - achat - importTva - douane - paiement;
  const nette = avantPub - cpa;
  return {
    ht, achat, importTva, douane, paiement, cpa, avantPub, nette, fraisClient,
    taux: prix > 0 ? nette / prix : null,
    roasSeuil: avantPub > 0 ? prix / avantPub : Infinity
  };
}

function potentielProduit(f) {
  const p = { ...f, type: 'drop' };
  const m = margeProduit(p);
  const mois = new Date().getMonth();
  // Saisonnalité propre au produit si elle est connue, sinon celle de sa niche.
  const indice = (typeof PROFILS_SAISON !== 'undefined' && PROFILS_SAISON[f.profil] ? PROFILS_SAISON[f.profil][mois] : SECTEURS[f.niche] ? SECTEURS[f.niche].courbe[mois] : 100) / 100;
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
  if (f.entrepot === 'CN') raisons.push(`livraison lente (${f.delai[0]}–${f.delai[1]} j) et TVA d’importation à la charge du client`);
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
  ${estSuisse() ? `<p class="encart">Pour vendre en Suisse, privilégiez les entrepôts suisses et européens. Vos clients attendent un colis en 2 à 7 jours. Avec un envoi de Chine, ils risquent de payer eux-mêmes la TVA d’importation et des frais de dédouanement à la livraison : c’est la première cause de mauvais avis.</p>` : '<p class="encart">Privilégiez les entrepôts européens : livraison en quelques jours et aucune formalité. Depuis juillet 2021, les envois venant de l’extérieur de l’UE paient la TVA dès le premier euro ; si le fournisseur n’utilise pas le guichet IOSS, c’est votre client qui la paie à la livraison, avec des frais du transporteur.</p>'}
  <section class="carte barre-sourcing">
    <label class="champ"><span>Niche</span><select id="sc-niche" data-sourcing="niche"><option value="">Toutes</option>${niches.map(n => `<option value="${n}" ${s.niche === n ? 'selected' : ''}>${esc(SECTEURS[n].nom)}</option>`).join('')}</select></label>
    <fieldset class="champ"><legend>Entrepôt</legend><div class="puces">${Object.entries(ENTREPOTS).map(([k, e]) => `<label class="puce"><input type="checkbox" data-entrepot="${k}" ${s.entrepots.includes(k) ? 'checked' : ''}><span>${e.nom}</span></label>`).join('')}</div></fieldset>
    <label class="champ"><span>Délai maximum</span><select id="sc-delai" data-sourcing="delaiMax">${[[7, '7 jours'], [10, '10 jours'], [20, '20 jours']].map(([v, n]) => `<option value="${v}" ${s.delaiMax === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="champ"><span>Coût pub par vente (estimé)</span><span class="avec-unite"><input id="sc-cpa" type="number" min="0" step="0.5" value="${reglages().cpa}" data-reglage="cpa"><i>${devise()}</i></span></label>
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
        <div><dt>À payer par le client à la livraison</dt><dd>${marge.fraisClient ? '≈ ' + euros(marge.fraisClient.montant) : '—'}</dd></div>
        <div><dt>Marge nette après pub</dt><dd class="${marge.nette >= 0 ? 'up' : 'down'}">${euros(marge.nette)} · ${Math.round(marge.taux * 100)} %</dd></div>
      </dl>
      ${blocCriteres(f)}
      <p class="sous">${esc(raisons.join(' · '))}</p>
      <div class="pc-pied">${importes.has(f.id) ? '<span class="pc-importe">✓ Dans votre boutique</span><a class="btn fantome" href="#produits">Voir le produit</a>' : `<button class="btn" data-action="importer-produit" data-id="${f.id}">Importer dans ma boutique</button>`}</div>
    </article>`).join('') || '<p class="sous">Aucun produit ne correspond à ces filtres.</p>'}</div>
  <p class="note">Démo : fournisseurs, coûts et délais fictifs. Frais de paiement estimés à 2,5 % + ${euros(0.3)} par vente ; frais de dédouanement transporteur estimés.</p>`;
}

/* Bloc « marge » affiché dans la fiche produit. */
function blocMarge(p) {
  const m = margeProduit(p);
  const ligne = (n, v, neg = true) => `<div><span>${n}</span><span>${neg && v ? '−' : ''}${euros(v)}</span></div>`;
  return `<div class="bloc calcul-marge"><h3>Marge nette par vente</h3>
    ${ligne('Prix de vente TTC', p.prix, false)}
    ${tauxTvaVente() ? ligne(`TVA ${Math.round(tauxTvaVente() * 1000) / 10} %`, p.prix - m.ht) : ''}
    ${ligne(p.type === 'drop' ? 'Fournisseur + port' : 'Coût d’achat', m.achat)}
    ${m.fraisClient ? `<p class="encart">${esc(m.fraisClient.texte)} Cela freine l’achat : préférez un entrepôt ${estSuisse() ? 'suisse' : 'européen'} ou un fournisseur qui livre droits payés.</p>` : ''}
    ${ligne('Frais de paiement', m.paiement)}
    ${ligne('Publicité par vente', m.cpa)}
    <div class="total ${m.nette >= 0 ? 'up' : 'down'}"><span>Marge nette</span><span>${euros(m.nette)}${m.taux === null ? '' : ` (${Math.round(m.taux * 100)} %)`}</span></div>
    <p class="sous">Seuil de rentabilité publicitaire (ROAS) : ${isFinite(m.roasSeuil) ? m.roasSeuil.toFixed(1).replace('.', ',') : '∞'}. En dessous, chaque vente issue de la pub vous coûte de l’argent.</p></div>`;
}

/* Bénéfice estimé d’une commande. */
function beneficeCommande(c) {
  if (['annulee', 'remboursee', 'attente'].includes(c.statut)) return 0;
  return decomposer(c).net;   // une seule formule pour le tableau de bord, l'analyse et les fiches
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
    id: 'p' + (i + 1), nom: f.nom, categorie: f.categorie, prix: f.prix, description: `Sélection Lacustre. Expédié depuis notre entrepôt partenaire (${ENTREPOTS[f.entrepot].nom}), livré en ${f.delai[0]} à ${f.delai[1]} jours, retours gratuits 30 jours.`,
    stock: 999, teinte: (f.id.charCodeAt(2) * 47) % 360, actif: true,
    type: 'drop', cout: f.cout, portF: f.portF, entrepot: f.entrepot, delai: f.delai, fournisseur: f.fournisseur, source: f.id
  }));
  // Démo : l’humidificateur était à 59 pendant 3 mois, réduit à 54 depuis 3 semaines (prix barré licite).
  produits[1].prixReference = 59;
  produits[1].historiquePrix = [{ date: Date.now() - 120 * 86400000, prix: 59 }, { date: Date.now() - 21 * 86400000, prix: 54 }];
  produits.push({ id: 'p7', nom: 'Coffret Léman fait main', categorie: 'Coffrets cadeaux', prix: 59, description: 'Bougie, savon et carte postale du lac, assemblés à Lausanne.', stock: 4, teinte: 195, actif: true, type: 'stock', cout: 21 });
  const now = Date.now(), jour = 86400000;
  const commandes = [];
  // 13 mois d’historique : croissance progressive, saisonnalité du secteur, pics le soir et le week-end.
  const HEURES = [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 4, 5, 8, 7, 5, 4, 4, 5, 7, 10, 12, 11, 8, 3];
  const totalH = HEURES.reduce((a, b) => a + b, 0);
  const tirerHeure = () => { let v = rand() * totalH; for (let h = 0; h < 24; h++) { v -= HEURES[h]; if (v <= 0) return h; } return 20; };
  const minuit = new Date(); minuit.setHours(0, 0, 0, 0);
  const clientsFideles = [];
  for (let d = 395; d >= 0; d--) {
    const jourDate = new Date(minuit.getTime() - d * jour);
    const saison = SECTEURS.maison.courbe[jourDate.getMonth()] / 100;
    const croissance = 0.35 + 0.65 * Math.pow(1 - d / 395, 1.4);
    const weekend = [0, 6].includes(jourDate.getDay()) ? 1.25 : 1;
    const n = Math.floor(rand() * 4.6 * saison * croissance * weekend + rand() * 0.6);
    for (let k = 0; k < n; k++) {
      let date = jourDate.getTime() + tirerHeure() * 3600000 + Math.floor(rand() * 3600000);
      if (date > now) date = now - Math.floor(rand() * 3600000);
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
      let prenom = PRENOMS[Math.floor(rand() * PRENOMS.length)];
      let nomF = NOMS[Math.floor(rand() * NOMS.length)];
      let villeF = VILLES_CH[Math.floor(rand() * VILLES_CH.length)];
      if (clientsFideles.length > 20 && rand() < 0.22) { [prenom, nomF, villeF] = clientsFideles[Math.floor(rand() * clientsFideles.length)]; }
      else if (rand() < 0.35) clientsFideles.push([prenom, nomF, villeF]);
      const hist = [{ date, texte: 'Commande passée (TWINT)' }];
      if (drop && !['attente', 'payee'].includes(statut)) hist.push({ date: date + 600000, texte: 'Transmise automatiquement au fournisseur' });
      commandes.push({
        id: '', numero: 0, date,
        client: { nom: `${prenom} ${nomF}`, email: `${prenom}.${nomF}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@exemple.ch', ville: villeF },
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
    entreprise: { raison: 'Lacustre', retoursJours: '30', forme: 'Raison individuelle', siret: 'CHE-000.000.000 (démo)', tvaIntra: '', adresse: 'Lausanne (adresse à compléter)', email: 'bonjour@lacustre.ch', regime: 'ch-non', mediateur: '' },
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
