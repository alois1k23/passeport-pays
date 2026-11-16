/* Comptoir — prix à l'unité de mesure (prix au kilo, au litre…), demandé pour de nombreuses marchandises préemballées
   (ordonnance suisse sur l'indication des prix, directive européenne) et accepté par Google Shopping.
   Module pur, partagé par le serveur (validation, flux produits) et la boutique (affichage). */
(function (racine) {
'use strict';

const UNITES = { g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'l', m: 'm', piece: 'pièce' };
// Unité de référence : petites quantités au 100 g / 100 ml, sinon au kilo / au litre ; au mètre ; à la pièce.
function base(contenance, unite) {
  if (unite === 'g') return contenance <= 250 ? { qte: 100, unite: 'g', facteur: 100 / contenance } : { qte: 1, unite: 'kg', facteur: 1000 / contenance };
  if (unite === 'kg') return { qte: 1, unite: 'kg', facteur: 1 / contenance };
  if (unite === 'ml') return contenance <= 250 ? { qte: 100, unite: 'ml', facteur: 100 / contenance } : { qte: 1, unite: 'l', facteur: 1000 / contenance };
  if (unite === 'cl') return contenance <= 25 ? { qte: 100, unite: 'ml', facteur: 10 / contenance } : { qte: 1, unite: 'l', facteur: 100 / contenance };
  if (unite === 'l') return { qte: 1, unite: 'l', facteur: 1 / contenance };
  if (unite === 'm') return { qte: 1, unite: 'm', facteur: 1 / contenance };
  if (unite === 'piece') return { qte: 1, unite: 'pièce', facteur: 1 / contenance };
  return null;
}
/* Prix unitaire d'un prix pour une contenance donnée, ou null (contenance absente ou invalide, lot d'une seule pièce). */
function prixUnitaire(prix, contenance, unite) {
  const c = Number(contenance);
  if (!UNITES[unite] || !Number.isFinite(c) || c <= 0 || !Number.isFinite(Number(prix))) return null;
  if (unite === 'piece' && c <= 1) return null;
  const b = base(c, unite);
  return { prix: Math.round(Number(prix) * b.facteur * 100) / 100, base: `${b.qte === 1 ? '' : b.qte + ' '}${b.unite}`.trim(), qte: b.qte, unite: b.unite };
}
// Contenance lisible (« 250 g », « 1,5 l », « 6 pièces »).
const libelle = (contenance, unite) => !UNITES[unite] ? '' : `${String(Number(contenance)).replace('.', ',')} ${unite === 'piece' ? (Number(contenance) > 1 ? 'pièces' : 'pièce') : UNITES[unite]}`;
// Unités de Google Shopping (unit_pricing_measure) : g, kg, ml, cl, l, m, ct.
const google = unite => ({ g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'l', m: 'm', piece: 'ct', 'pièce': 'ct' })[unite] || null;

/* Les 14 allergènes à déclarer (droit suisse et européen), dans l'ordre habituel. Partagé aussi par le serveur et la boutique. */
const ALLERGENES = { gluten: 'céréales contenant du gluten', crustaces: 'crustacés', oeufs: 'œufs', poissons: 'poissons', arachides: 'arachides', soja: 'soja', lait: 'lait (y compris lactose)', fruitsCoque: 'fruits à coque', celeri: 'céleri', moutarde: 'moutarde', sesame: 'graines de sésame', sulfites: 'anhydride sulfureux et sulfites', lupin: 'lupin', mollusques: 'mollusques' };

const api = { UNITES, ALLERGENES, prixUnitaire, libelle, google };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.Unites = api;
})(typeof window !== 'undefined' ? window : globalThis);
