/* Comptoir — formules d'abonnement : une seule définition pour le serveur, l'application et la page de tarifs.
   N'y figurent que des fonctions qui existent vraiment dans la plateforme. */
(function (racine, fabrique) {
  const m = fabrique();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else racine.Formules = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const ORDRE = ['lancement', 'croissance', 'pro'];
  const FORMULES = {
    lancement: { nom: 'Lancement', prix: 29, resume: 'Votre première boutique de dropshipping',
      inclus: ['Boutique complète et éditeur', 'Catalogue fournisseurs et produits stars', 'Transmission automatique des commandes', 'Marge nette réelle par produit', 'Paiement par carte, et TWINT en Suisse', '0 % de commission Comptoir'] },
    croissance: { nom: 'Croissance', prix: 59, resume: 'Pour vendre plus et fidéliser',
      inclus: ['Tout Lancement, plus :', 'Réseaux sociaux en pilote automatique', 'Copilote de saison et tests produits', 'E-mails automatiques, codes promo et offres', 'Tendances mises à jour en continu'] },
    pro: { nom: 'Pro', prix: 119, resume: 'Boutique en ligne et vente en personne',
      inclus: ['Tout Croissance, plus :', 'Caisse et stock unique (marchés, pop-up, magasin)', 'Retrait en magasin et QR code de vitrine', 'Export pour votre fiduciaire', 'Assistance prioritaire'] }
  };
  // Fonction → formule minimale. Ce qui n'est pas listé est inclus partout.
  const FONCTIONS = {
    social: 'croissance', copilote: 'croissance', tests: 'croissance', conversion: 'croissance',
    magasin: 'pro'
  };
  const NOMS_FONCTIONS = { social: 'Réseaux sociaux', copilote: 'Copilote de saison', tests: 'Tests produits', conversion: 'Conversion et e-mails', magasin: 'Magasin et caisse' };
  function permet(formule, fonction) {
    const min = FONCTIONS[fonction];
    if (!min) return true;
    return ORDRE.indexOf(formule) >= ORDRE.indexOf(min);
  }
  function prixTexte(id, devise) { const f = FORMULES[id]; return devise === 'CHF' ? `CHF ${f.prix}.–` : `${f.prix} €`; }
  return { ORDRE, FORMULES, FONCTIONS, NOMS_FONCTIONS, permet, prixTexte };
});
