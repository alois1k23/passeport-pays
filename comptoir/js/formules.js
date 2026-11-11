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
      inclus: ['Boutique complète et éditeur', 'Catalogue fournisseurs et produits stars', 'Transmission automatique des commandes', 'Marge nette réelle par produit', 'Exports CSV et export pour votre fiduciaire', 'Paiement par carte, et TWINT en Suisse', '0 % de commission Comptoir'] },
    croissance: { nom: 'Croissance', prix: 59, resume: 'Pour vendre plus et fidéliser',
      inclus: ['Tout Lancement, plus :', 'Calendrier et textes des réseaux sociaux préparés pour vous', 'Copilote de saison et tests produits', 'E-mails automatiques, codes promo et offres', 'Remises par quantité et campagnes de saison'] },
    pro: { nom: 'Pro', prix: 119, resume: 'Boutique en ligne et vente en personne',
      inclus: ['Tout Croissance, plus :', 'Caisse et stock unique (marchés, pop-up, magasin)', 'Retrait en magasin et QR code de vitrine', 'Ventes en ligne et en magasin dans les mêmes analyses'] }
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
  /* Réglages tels qu'ils s'appliquent aux ventes : sans Croissance, ni codes, ni paliers, ni offres, ni campagnes,
     ni e-mails automatiques ; sans Pro, pas de retrait en magasin. Les réglages enregistrés ne sont pas modifiés
     (copie), ils reviennent si le marchand change de formule. Même règle pour le serveur et l'interface. */
  function configVente(config, formule) {
    const c = Object.assign({}, config);
    if (!permet(formule, 'conversion')) {
      c.offres = Object.assign({}, c.offres || {}, { paliersActifs: false, paliers: [], regles: [], codes: [] });
      c.campagnes = {};
      const a = Object.assign({}, c.automatisations || {});
      // Toutes les clés, même absentes : une clé manquante reprendrait sinon sa valeur par défaut (active).
      for (const k of ['bienvenue', 'paiement', 'avis', 'reconquete']) a[k] = Object.assign({}, a[k] || {}, { actif: false });
      c.automatisations = a;
    }
    if (!permet(formule, 'magasin') && c.magasin) c.magasin = Object.assign({}, c.magasin, { clickCollect: false });
    return c;
  }
  function prixTexte(id, devise) { const f = FORMULES[id]; return devise === 'CHF' ? `CHF ${f.prix}.–` : `${f.prix} €`; }
  return { ORDRE, FORMULES, FONCTIONS, NOMS_FONCTIONS, permet, configVente, prixTexte };
});
