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
    retrait: { nom: 'Retrait en boutique (click & collect)', prix: 0, transporteur: null }
  },
  ch: {
    'poste-eco': { nom: 'La Poste Economy', prix: 7, transporteur: 'La Poste' },
    'poste-prio': { nom: 'La Poste Priority', prix: 9, transporteur: 'La Poste', jamaisOffert: true },
    pickpost: { nom: 'Retrait PickPost / My Post 24', prix: 6, transporteur: 'La Poste' },
    retrait: { nom: 'Retrait en boutique (click & collect)', prix: 0, transporteur: null }
  }
};
const SEUIL_PORT_OFFERT = 60;

function modesLivraison(config) {
  const pays = config.boutique.pays === 'ch' ? 'ch' : 'fr';
  const modes = { ...LIVRAISONS[pays] };
  if (!config.magasin || !config.magasin.clickCollect) delete modes.retrait;
  return modes;
}

function fraisPort(mode, sousTotal, seuil = SEUIL_PORT_OFFERT) {
  if (!mode || mode.prix === 0) return 0;
  if (seuil > 0 && !mode.jamaisOffert && sousTotal >= seuil) return 0;
  return mode.prix;
}

const arrondi = n => Math.round(n * 100) / 100;

function tauxTva(config) {
  const r = config.entreprise && config.entreprise.regime;
  return r === 'ch-assujetti' ? 0.081 : r === 'normal' ? 0.2 : 0;
}

/* Construit les lignes d'une commande à partir des produits en base. */
function construireLignes(produits, demandes) {
  if (!Array.isArray(demandes) || !demandes.length || demandes.length > 50) throw erreur(400, 'Le panier est vide ou invalide.', 'panier_invalide');
  const lignes = [];
  for (const d of demandes) {
    const p = produits.find(x => x.id === d.produitId);
    if (!p || !p.actif) throw erreur(400, 'Un produit du panier n’est plus disponible.', 'produit_indisponible');
    const qte = Number(d.qte);
    if (!Number.isInteger(qte) || qte < 1 || qte > 20) throw erreur(400, 'Quantité invalide.', 'quantite_invalide');
    if (p.type !== 'drop' && p.stock < qte) throw erreur(409, `Stock insuffisant pour « ${p.nom} ».`, 'stock_insuffisant');
    const ex = lignes.find(l => l.produitId === p.id);
    if (ex) ex.qte += qte; else lignes.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte, type: p.type || 'stock', source: p.source || null, fournisseur: p.fournisseur || null });
  }
  return lignes;
}

module.exports = { LIVRAISONS, modesLivraison, fraisPort, tauxTva, construireLignes, arrondi, SEUIL_PORT_OFFERT };
