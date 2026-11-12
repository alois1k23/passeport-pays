// Calculs de prix côté serveur. Le serveur ne fait jamais confiance aux prix
// envoyés par le navigateur : tout est recalculé à partir de la base.
'use strict';
const { erreur } = require('./http');

// Mêmes tarifs que l'interface (js/data.js). Montants TTC dans la devise de la boutique.
const LIVRAISONS = {
  fr: {
    colissimo: { nom: 'Colissimo à domicile', prix: 5.9, transporteur: 'Colissimo' },
    relais: { nom: 'Mondial Relay en point relais', prix: 3.9, transporteur: 'Mondial Relay' },
    chronopost: { nom: 'Chronopost express', prix: 12.9, transporteur: 'Chronopost', jamaisOffert: true },
    retrait: { nom: 'Retrait en boutique', prix: 0, transporteur: null }
  },
  ch: {
    'poste-eco': { nom: 'La Poste Economy', prix: 7, transporteur: 'La Poste' },
    'poste-prio': { nom: 'La Poste Priority', prix: 9, transporteur: 'La Poste', jamaisOffert: true },
    pickpost: { nom: 'Retrait PickPost / My Post 24', prix: 6, transporteur: 'La Poste' },
    retrait: { nom: 'Retrait en boutique (click & collect)', prix: 0, transporteur: null }
  },
  // Belgique : bpost et Mondial Relay (Colissimo et Chronopost sont des services français).
  be: {
    bpost: { nom: 'bpost à domicile', prix: 6.5, transporteur: 'bpost' },
    'bpost-point': { nom: 'bpost en point d’enlèvement', prix: 5.5, transporteur: 'bpost' },
    'relais-be': { nom: 'Mondial Relay en point relais', prix: 4.2, transporteur: 'Mondial Relay' },
    retrait: { nom: 'Retrait en boutique', prix: 0, transporteur: null }
  }
};
const SEUIL_PORT_OFFERT = 60;

function modesLivraison(config) {
  const pays = config.boutique.pays === 'ch' ? 'ch' : config.boutique.pays === 'be' ? 'be' : 'fr';
  // Objet sans prototype : une clé comme « toString » ou « __proto__ » envoyée par un client n'est jamais un mode.
  const modes = Object.assign(Object.create(null), LIVRAISONS[pays]);
  // Retrait proposé seulement avec une adresse de magasin (sinon le client ne saurait pas où aller).
  if (!config.magasin || !config.magasin.clickCollect || !String(config.magasin.adresse || '').trim()) delete modes.retrait;
  return modes;
}

function fraisPort(mode, sousTotal, seuil = SEUIL_PORT_OFFERT) {
  if (!mode || mode.prix === 0) return 0;
  if (seuil > 0 && !mode.jamaisOffert && sousTotal >= seuil) return 0;
  return mode.prix;
}

const arrondi = n => Math.round(n * 100) / 100;

/* Taux réduit (denrées alimentaires) : Suisse 2,6 %, France 5,5 %, Belgique 6 %. 0 sans assujettissement. */
function tauxReduit(config) {
  const r = config.entreprise && config.entreprise.regime;
  const pays = config.boutique && config.boutique.pays;
  return r === 'ch-assujetti' ? 0.026 : r === 'normal' ? (pays === 'be' ? 0.06 : 0.055) : 0;
}
/* Taux figé sur chaque ligne au moment de la vente (une facture peut mêler deux taux). */
function figerTaux(c, config) {
  const normal = tauxTva(config), reduit = tauxReduit(config);
  c.tauxTva = normal;
  for (const l of c.lignes) l.tauxTva = l.tauxReduit ? reduit : normal;
  return c;
}
function tauxTva(config) {
  const r = config.entreprise && config.entreprise.regime;
  const pays = config.boutique && config.boutique.pays;
  return r === 'ch-assujetti' ? 0.081 : r === 'normal' ? (pays === 'be' ? 0.21 : 0.2) : 0;
}

/* Construit les lignes d'une commande à partir des produits en base. */
function construireLignes(produits, demandes, { qteMax = 20 } = {}) {
  if (!Array.isArray(demandes) || !demandes.length || demandes.length > 50) throw erreur(400, 'Le panier est vide ou invalide.', 'panier_invalide');
  const lignes = [];
  for (const d of demandes) {
    if (!d || typeof d !== 'object') throw erreur(400, 'Le panier est vide ou invalide.', 'panier_invalide');
    const p = produits.find(x => x.id === d.produitId);
    if (!p || !p.actif || p.aVerifier) throw erreur(400, 'Un produit du panier n’est plus disponible.', 'produit_indisponible');
    const qte = Number(d.qte);
    if (!Number.isInteger(qte) || qte < 1 || qte > qteMax) throw erreur(400, `Quantité invalide (${qteMax} au maximum par article).`, 'quantite_invalide');
    // Produit à variantes : la variante est obligatoire ; stock et prix sont les siens.
    const v = Array.isArray(p.variantes) && p.variantes.length ? p.variantes.find(x => x.id === d.varianteId) : null;
    if (Array.isArray(p.variantes) && p.variantes.length && !v) throw erreur(400, `Choisissez une variante pour « ${p.nom} ».`, 'variante_requise');
    if (p.type !== 'drop' && (v ? v.stock : p.stock) < qte) throw erreur(409, `Stock insuffisant pour « ${v ? `${p.nom} (${v.valeurs.join(' / ')})` : p.nom} ».`, 'stock_insuffisant');
    const offre = typeof d.offre === 'string' ? d.offre.slice(0, 20) : undefined;
    const ex = !offre && lignes.find(l => l.produitId === p.id && !l.offre && (l.varianteId || null) === (v ? v.id : null));
    const prixLigne = v && typeof v.prix === 'number' ? v.prix : p.prix;
    if (ex) ex.qte += qte; else lignes.push({ tauxReduit: !!p.tauxReduit, produitId: p.id, ...(v ? { varianteId: v.id } : {}), nom: v ? `${p.nom} (${v.valeurs.join(' / ')})` : p.nom, prix: Math.round(prixLigne * 100) / 100, qte, type: p.type || 'stock', source: p.source || null, fournisseur: p.fournisseur || null, ...(offre ? { offre } : {}) });
  }
  // Contrôle par variante (plusieurs lignes de la même variante, offres comprises)
  const parVariante = {};
  for (const l of lignes) if (l.varianteId) parVariante[`${l.produitId}:${l.varianteId}`] = (parVariante[`${l.produitId}:${l.varianteId}`] || 0) + l.qte;
  for (const [cle, qte] of Object.entries(parVariante)) {
    const [pid, vid] = [cle.slice(0, cle.indexOf(':')), cle.slice(cle.indexOf(':') + 1)];
    const v = produits.find(x => x.id === pid).variantes.find(x => x.id === vid);
    if (v.stock < qte) throw erreur(409, `Stock insuffisant pour « ${produits.find(x => x.id === pid).nom} (${v.valeurs.join(' / ')}) ».`, 'stock_insuffisant');
  }
  // Contrôle sur la quantité totale par produit (plusieurs lignes du même produit, offres comprises).
  const totaux = {};
  for (const l of lignes) totaux[l.produitId] = (totaux[l.produitId] || 0) + l.qte;
  for (const [id, qte] of Object.entries(totaux)) {
    const p = produits.find(x => x.id === id);
    if (qte > qteMax) throw erreur(400, `Quantité invalide (${qteMax} au maximum par article).`, 'quantite_invalide');
    if (p.type !== 'drop' && p.stock < qte) throw erreur(409, `Stock insuffisant pour « ${p.nom} ».`, 'stock_insuffisant');
  }
  return lignes;
}

module.exports = { LIVRAISONS, modesLivraison, fraisPort, tauxTva, tauxReduit, figerTaux, construireLignes, arrondi, SEUIL_PORT_OFFERT };
