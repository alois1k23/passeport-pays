/* Comptoir — données de référence : secteurs, saisonnalité, thèmes, jeu de démo.
   Toutes les courbes de demande sont des indices simulés (100 = mois moyen)
   destinés à la démo. En production : Google Trends, Search Console,
   données marketplace et historique de ventes réel. */

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* Temps forts du commerce en France, mois par mois.
   kw : mot-clé de campagne utilisé pour les domaines saisonniers. */
const SAISONS = [
  { mois: 0, nom: 'Soldes d’hiver', kw: 'soldes', force: 0.75, conseil: 'Les soldes démarrent le 2e mercredi de janvier (le 1er si le 2e tombe après le 12) : préparez une collection « dernières pièces ».' },
  { mois: 1, nom: 'Saint-Valentin', kw: 'saint-valentin', force: 0.85, conseil: 'Coffrets duo et cartes cadeaux : la demande culmine la semaine du 7 au 14 février.' },
  { mois: 2, nom: 'Printemps', kw: 'printemps', force: 0.5, conseil: 'Renouvelez les visuels : couleurs claires, nouveautés, grand ménage de printemps.' },
  { mois: 3, nom: 'Pâques', kw: 'paques', force: 0.55, conseil: 'Petits cadeaux et décoration de table : une bannière Pâques suffit.' },
  { mois: 4, nom: 'Fête des mères', kw: 'fete-des-meres', force: 0.95, conseil: 'Fête des mères le dernier dimanche de mai (le 1er dimanche de juin quand il coïncide avec la Pentecôte) : la meilleure période du printemps pour le cadeau.' },
  { mois: 5, nom: 'Fête des pères et soldes d’été', kw: 'fete-des-peres', force: 0.7, conseil: 'Fête des pères le 3e dimanche de juin, puis soldes d’été fin juin.' },
  { mois: 6, nom: 'Vacances d’été', kw: 'ete', force: 0.45, conseil: 'Trafic plus faible : idéal pour tester de nouveaux produits et préparer la rentrée.' },
  { mois: 7, nom: 'Préparation rentrée', kw: 'rentree', force: 0.5, conseil: 'Préparez les campagnes de septembre et les stocks de fin d’année.' },
  { mois: 8, nom: 'Rentrée', kw: 'rentree', force: 0.65, conseil: 'Nouvelle saison : les clients reviennent, relancez votre newsletter.' },
  { mois: 9, nom: 'Halloween et premiers cadeaux', kw: 'halloween', force: 0.6, conseil: 'Les premiers achats de Noël commencent : publiez vos coffrets dès la mi-octobre.' },
  { mois: 10, nom: 'Black Friday', kw: 'black-friday', force: 1, conseil: 'Fin novembre, suivi du Cyber Monday le lundi : la plus grosse semaine de ventes en ligne de l’année. Réservez un domaine de campagne et préparez vos offres.' },
  { mois: 11, nom: 'Noël', kw: 'noel', force: 1, conseil: 'Pic de l’année : mettez en avant les cartes cadeaux et la date limite de livraison avant le 24.' }
];
/* Suisse : dates et temps forts propres (fête des mères le 2e dimanche de mai, 1er Août…). */
const SAISONS_CH = {
  0: { conseil: 'Les soldes commencent juste après Noël et durent tout janvier : préparez une sélection « dernières pièces ».' },
  4: { conseil: 'Fête des mères le 2e dimanche de mai en Suisse : la meilleure période du printemps pour le cadeau.' },
  5: { nom: 'Fête des pères et soldes d’été', conseil: 'Fête des pères le 1er dimanche de juin en Suisse, puis soldes d’été dès fin juin.' },
  7: { nom: '1er Août et préparation de la rentrée', kw: 'rentree', conseil: 'Fête nationale le 1er août : une sélection rouge et blanc suffit. Préparez ensuite la rentrée.' },
  9: { nom: 'Halloween et premiers cadeaux' }
};
/* Belgique : soldes le 3 janvier et le 1er juillet, fêtes des mères et des pères le 2e dimanche de mai et de juin, Saint-Nicolas. */
const SAISONS_BE = {
  0: { conseil: 'Soldes d’hiver dès le 3 janvier en Belgique (le 2 si c’est un dimanche) : préparez une sélection « dernières pièces ».' },
  4: { conseil: 'Fête des mères le 2e dimanche de mai en Belgique : la meilleure période du printemps pour le cadeau.' },
  5: { nom: 'Fête des pères et soldes d’été', conseil: 'Fête des pères le 2e dimanche de juin en Belgique, puis soldes d’été dès le 1er juillet.' },
  10: { conseil: 'Black Friday fin novembre, puis Saint-Nicolas le 6 décembre : deux temps forts à préparer dès maintenant.' }
};
function saisonDuMois(mois) {
  const base = SAISONS[mois];
  let pays = 'fr';
  try { pays = (etat && etat.boutique && etat.boutique.pays) || 'fr'; } catch { /* état pas encore chargé */ }
  const propre = pays === 'ch' ? SAISONS_CH[mois] : pays === 'be' ? SAISONS_BE[mois] : null;
  return propre ? { ...base, ...propre } : base;
}

/* Secteurs : mots-clés (volume de recherche mensuel simulé) + courbe saisonnière. */
const SECTEURS = {
  maison: {
    nom: 'Maison & lifestyle',
    courbe: [80, 72, 78, 80, 86, 74, 70, 72, 88, 100, 138, 150],
    kws: [['lampe', 90500], ['deco', 90500], ['maison', 60500], ['cadeau', 49500], ['ambiance', 12100], ['cosy', 8100]],
    categories: ['Luminaires', 'Diffuseurs', 'Textile', 'Rangement', 'Bougies'],
    produits: [
      ['Lampe d’ambiance', 'Luminaires', 39, 'Lumière douce, câble USB-C.'],
      ['Diffuseur ultrasonique', 'Diffuseurs', 49, 'Silencieux, arrêt automatique.'],
      ['Plaid gaufré', 'Textile', 79, 'Coton bio, 130 × 170 cm.'],
      ['Organiseur bambou', 'Rangement', 34, 'Modulable, 6 compartiments.'],
      ['Bougie au bois de cèdre', 'Bougies', 36, 'Cire végétale, 50 h.'],
      ['Coffret cosy', 'Bougies', 69, 'Bougie, plaid mini et carte.']
    ]
  },
  animaux: {
    nom: 'Animaux',
    courbe: [96, 88, 98, 102, 104, 100, 98, 96, 100, 98, 120, 132],
    kws: [['chien', 135000], ['chat', 110000], ['animaux', 60500], ['jouet', 40500], ['accessoires', 22200], ['croquettes', 49500]],
    categories: ['Accessoires', 'Couchage', 'Jouets', 'Hygiène'],
    produits: [
      ['Fontaine à eau', 'Accessoires', 49, 'Filtre charbon, 2 litres.'],
      ['Panier apaisant', 'Couchage', 69, 'Lavable en machine.'],
      ['Balle interactive', 'Jouets', 24, 'Rechargeable USB.'],
      ['Brosse autonettoyante', 'Hygiène', 19, 'Pour poils courts et longs.']
    ]
  },
  tech: {
    nom: 'Accessoires tech',
    courbe: [92, 84, 86, 88, 90, 92, 96, 94, 104, 98, 142, 150],
    kws: [['chargeur', 74000], ['coque', 90500], ['gadget', 33100], ['tech', 27100], ['accessoires', 22200], ['iphone', 201000]],
    categories: ['Recharge', 'Accessoires', 'Audio', 'Protection'],
    produits: [
      ['Chargeur 3-en-1', 'Recharge', 69, 'Pliable, 15 W.'],
      ['Support voiture magnétique', 'Accessoires', 35, 'Fixation grille d’aération.'],
      ['Écouteurs sans fil', 'Audio', 59, 'Réduction de bruit.'],
      ['Coque antichoc', 'Protection', 29, 'Coins renforcés.']
    ]
  },
  deco: {
    nom: 'Décoration & bougies',
    courbe: [70, 62, 68, 72, 88, 66, 58, 60, 78, 96, 132, 150],
    kws: [['bougies', 74000], ['deco', 90500], ['maison', 60500], ['parfum', 33100], ['cadeau', 49500], ['cosy', 8100]],
    categories: ['Bougies', 'Diffuseurs', 'Céramique', 'Textile'],
    produits: [
      ['Bougie Brume de figuier', 'Bougies', 32, 'Cire de colza, mèche coton, 45 h de combustion.'],
      ['Bougie Feu de bois', 'Bougies', 34, 'Notes boisées et fumées pour l’hiver.'],
      ['Diffuseur Linge blanc', 'Diffuseurs', 39, 'Bâtonnets en rotin, 100 ml.'],
      ['Vase grès sable', 'Céramique', 48, 'Tourné à la main, émail mat.'],
      ['Plaid laine & lin', 'Textile', 89, '130 × 170 cm, tissé au Portugal.'],
      ['Coffret trio bougies', 'Bougies', 79, 'Trois parfums de saison, emballage cadeau.']
    ]
  },
  mode: {
    nom: 'Mode & accessoires',
    courbe: [118, 84, 92, 96, 98, 112, 104, 76, 102, 94, 128, 120],
    kws: [['vetements', 110000], ['mode', 135000], ['robe', 90500], ['pull', 40500], ['sac', 60500], ['ethique', 9900]],
    categories: ['Hauts', 'Bas', 'Maille', 'Accessoires'],
    produits: [
      ['Pull col rond mérinos', 'Maille', 95, 'Laine mérinos extra-fine.'],
      ['Chemise lin lavé', 'Hauts', 69, 'Lin européen, coupe droite.'],
      ['Pantalon large velours', 'Bas', 85, 'Velours côtelé fin.'],
      ['Écharpe alpaga', 'Accessoires', 59, '200 × 30 cm.'],
      ['Tote bag toile épaisse', 'Accessoires', 29, 'Coton bio 400 g/m².'],
      ['Cardigan torsadé', 'Maille', 119, 'Maille épaisse, boutons corozo.']
    ]
  },
  beaute: {
    nom: 'Cosmétique naturelle',
    courbe: [92, 96, 98, 94, 112, 104, 96, 82, 90, 94, 124, 138],
    kws: [['cosmetique', 49500], ['bio', 74000], ['soin', 40500], ['savon', 33100], ['naturel', 27100], ['beaute', 90500]],
    categories: ['Visage', 'Corps', 'Cheveux', 'Coffrets'],
    produits: [
      ['Sérum éclat vitamine C', 'Visage', 36, '30 ml, 98 % d’origine naturelle.'],
      ['Savon surgras avoine', 'Corps', 9, 'Saponifié à froid.'],
      ['Baume lèvres karité', 'Visage', 8, 'Tube carton, 15 g.'],
      ['Shampooing solide ortie', 'Cheveux', 12, 'Équivaut à 2 flacons.'],
      ['Huile corps sèche', 'Corps', 28, 'Pépins de raisin et amande.'],
      ['Coffret rituel hiver', 'Coffrets', 59, 'Sérum, baume et huile.']
    ]
  },
  epicerie: {
    nom: 'Épicerie fine',
    courbe: [78, 80, 84, 98, 90, 86, 74, 72, 86, 94, 128, 172],
    kws: [['epicerie', 40500], ['chocolat', 74000], ['the', 60500], ['miel', 33100], ['gourmand', 12100], ['terroir', 9900]],
    categories: ['Thés & cafés', 'Sucré', 'Salé', 'Coffrets'],
    produits: [
      ['Thé noir épices d’hiver', 'Thés & cafés', 14, 'Vrac, 100 g.'],
      ['Miel de lavande', 'Sucré', 12, 'Récolte Drôme, 250 g.'],
      ['Tablette chocolat 72 %', 'Sucré', 7, 'Pérou, torréfaction lente.'],
      ['Tapenade olives noires', 'Salé', 9, 'Bocal 180 g.'],
      ['Café grains Éthiopie', 'Thés & cafés', 16, 'Torréfié à Lyon, 250 g.'],
      ['Coffret apéritif', 'Coffrets', 49, 'Six spécialités du Sud.']
    ]
  },
  sport: {
    nom: 'Sport & outdoor',
    courbe: [124, 98, 104, 110, 116, 112, 104, 92, 108, 88, 96, 82],
    kws: [['running', 49500], ['randonnee', 60500], ['yoga', 74000], ['velo', 110000], ['outdoor', 18100], ['sport', 135000]],
    categories: ['Textile', 'Accessoires', 'Nutrition', 'Matériel'],
    produits: [
      ['Tapis de yoga liège', 'Matériel', 69, 'Antidérapant, 4 mm.'],
      ['Gourde isotherme 750 ml', 'Accessoires', 29, 'Inox, 24 h froid.'],
      ['T-shirt technique mérinos', 'Textile', 55, 'Respirant, anti-odeurs.'],
      ['Barres énergie (x12)', 'Nutrition', 24, 'Dattes et amandes.'],
      ['Frontale rechargeable', 'Matériel', 45, '400 lumens, USB-C.'],
      ['Chaussettes trail', 'Textile', 16, 'Renforts talon et pointe.']
    ]
  },
  bijoux: {
    nom: 'Bijoux',
    courbe: [76, 118, 82, 84, 122, 80, 74, 70, 82, 90, 126, 176],
    kws: [['bijoux', 135000], ['collier', 49500], ['bague', 60500], ['boucles', 40500], ['or', 22200], ['createur', 12100]],
    categories: ['Colliers', 'Bagues', 'Boucles', 'Bracelets'],
    produits: [
      ['Collier perle d’eau douce', 'Colliers', 59, 'Plaqué or 18 carats.'],
      ['Bague jonc martelé', 'Bagues', 45, 'Argent 925.'],
      ['Créoles fines', 'Boucles', 39, 'Diamètre 20 mm.'],
      ['Bracelet cordon & médaille', 'Bracelets', 29, 'Gravure offerte.'],
      ['Chevalière ovale', 'Bagues', 69, 'Plaqué or, gravable.'],
      ['Puces étoile', 'Boucles', 25, 'Hypoallergéniques.']
    ]
  }
};

/* Thèmes de boutique (l’apparence de la boutique du marchand, pas de l’admin). */
const THEMES = {
  brume: { nom: 'Brume', bg: '#F3F1EC', surface: '#FFFFFF', text: '#23262B', muted: '#666A71', primary: '#4F6B5A', onPrimary: '#FFFFFF', font: "'Fraunces', Georgia, serif", body: "'Outfit', system-ui, sans-serif", radius: 4 },
  nocturne: { nom: 'Nocturne', bg: '#111317', surface: '#1B1E24', text: '#F2F0EA', muted: '#9AA0A8', primary: '#E7B75F', onPrimary: '#14161A', font: "'Syne', system-ui, sans-serif", body: "'Outfit', system-ui, sans-serif", radius: 0 },
  craie: { nom: 'Craie', bg: '#FFFFFF', surface: '#F5F6F8', text: '#101318', muted: '#5C6470', primary: '#1F3FD1', onPrimary: '#FFFFFF', font: "'DM Serif Display', Georgia, serif", body: "'IBM Plex Sans', system-ui, sans-serif", radius: 10 },
  leman: { nom: 'Léman', bg: '#EEF3F4', surface: '#FFFFFF', text: '#14242B', muted: '#566A72', primary: '#1D5C70', onPrimary: '#FFFFFF', font: "'Bricolage Grotesque', system-ui, sans-serif", body: "'Outfit', system-ui, sans-serif", radius: 12 },
  argile: { nom: 'Argile', bg: '#F6E9DC', surface: '#FFF7EF', text: '#3A2418', muted: '#80604E', primary: '#B4532A', onPrimary: '#FFFFFF', font: "'Bricolage Grotesque', system-ui, sans-serif", body: "'Outfit', system-ui, sans-serif", radius: 18 }
};

const POLICES = [
  ["'Fraunces', Georgia, serif", 'Fraunces (sérif doux)'],
  ["'DM Serif Display', Georgia, serif", 'DM Serif (élégant)'],
  ["'Syne', system-ui, sans-serif", 'Syne (affirmé)'],
  ["'Bricolage Grotesque', system-ui, sans-serif", 'Bricolage (artisanal)'],
  ["'Outfit', system-ui, sans-serif", 'Outfit (neutre)']
];

/* Types de sections disponibles dans l’éditeur et leurs champs. */
const TYPES_SECTIONS = {
  annonce: { nom: 'Barre d’annonce', champs: [['texte', 'Texte', 'text']], defaut: { texte: 'Paiement sécurisé · Livraison suivie' } },
  hero: { nom: 'Bannière d’accueil', champs: [['titre', 'Titre', 'text'], ['sousTitre', 'Sous-titre', 'textarea'], ['bouton', 'Texte du bouton', 'text'], ['align', 'Alignement', 'select:gauche,centre']], defaut: { titre: 'Votre nouvelle collection', sousTitre: 'Une phrase qui donne envie de découvrir vos produits.', bouton: 'Découvrir', align: 'gauche' } },
  saison: { nom: 'Bannière saisonnière', champs: [['titre', 'Titre', 'text'], ['texte', 'Texte', 'textarea'], ['code', 'Code promo', 'text']], defaut: { titre: 'Offre de saison', texte: '-15 % sur toute la boutique', code: 'SAISON15' } },
  produits: { nom: 'Grille de produits', champs: [['titre', 'Titre', 'text'], ['nombre', 'Nombre de produits', 'select:3,4,6,8'], ['categorie', 'Catégorie', 'categorie']], defaut: { titre: 'Nos meilleures ventes', nombre: '4', categorie: '' } },
  arguments: { nom: 'Arguments clés', champs: [['a1', 'Argument 1', 'text'], ['a2', 'Argument 2', 'text'], ['a3', 'Argument 3', 'text']], defaut: { a1: 'Paiement sécurisé', a2: 'Livraison suivie', a3: 'Service client par e-mail' } },
  texte: { nom: 'Bloc texte', champs: [['titre', 'Titre', 'text'], ['texte', 'Texte', 'textarea']], defaut: { titre: 'Notre histoire', texte: 'Racontez qui vous êtes, comment vous fabriquez et pourquoi.' } },
  avis: { nom: 'Avis clients', champs: [['a1', 'Avis 1', 'textarea'], ['n1', 'Auteur 1', 'text'], ['a2', 'Avis 2', 'textarea'], ['n2', 'Auteur 2', 'text']], defaut: { a1: '', n1: '', a2: '', n2: '' } },
  newsletter: { nom: 'Inscription newsletter', champs: [['titre', 'Titre', 'text'], ['texte', 'Texte', 'text']], defaut: { titre: 'Restons en contact', texte: '-10 % sur votre première commande.' } },
  faq: { nom: 'Questions fréquentes', champs: [['q1', 'Question 1', 'text'], ['r1', 'Réponse 1', 'textarea'], ['q2', 'Question 2', 'text'], ['r2', 'Réponse 2', 'textarea']], defaut: { q1: 'Quels sont les délais de livraison ?', r1: 'Le délai de livraison est indiqué sur chaque fiche produit.', q2: 'Puis-je retourner un produit ?', r2: 'Oui : la procédure est décrite dans nos conditions générales de vente.' } },
  pied: { nom: 'Pied de page', champs: [['texte', 'Texte', 'text'], ['contact', 'Contact', 'text']], defaut: { texte: 'Fait avec soin.', contact: '' } }
};

const STATUTS = {
  attente: { nom: 'Paiement en attente', ton: 'muted' },
  payee: { nom: 'À préparer', ton: 'warn' },
  preparation: { nom: 'En préparation', ton: 'info' },
  fournisseur: { nom: 'Chez le fournisseur', ton: 'violet' },
  expediee: { nom: 'Expédiée', ton: 'accent' },
  livree: { nom: 'Livrée', ton: 'good' },
  prete: { nom: 'Prête à retirer', ton: 'accent' },
  retiree: { nom: 'Retirée', ton: 'good' },
  remboursee: { nom: 'Remboursée', ton: 'muted' },
  annulee: { nom: 'Annulée', ton: 'bad' }
};

/* Modes de livraison proposés au client (prix TTC, offerts dès 60 € sauf retrait gratuit). */
const LIVRAISONS = {
  colissimo: { nom: 'Colissimo à domicile', court: 'Colissimo', prix: 5.9, delai: '48 h', transporteur: 'Colissimo' },
  relais: { nom: 'Mondial Relay en point relais', court: 'Point relais', prix: 3.9, delai: '3 à 5 jours', transporteur: 'Mondial Relay' },
  chronopost: { nom: 'Chronopost express', court: 'Express', prix: 12.9, delai: '24 h', transporteur: 'Chronopost' },
  retrait: { nom: 'Retrait en boutique', court: 'Retrait', prix: 0, delai: '2 h', transporteur: null }
};
/* Suisse : La Poste et retrait PickPost / My Post 24 (tarifs indicatifs de la démo). */
const LIVRAISONS_CH = {
  'poste-eco': { nom: 'La Poste Economy', court: 'Economy', prix: 7, delai: '2 à 3 jours ouvrables', transporteur: 'La Poste' },
  'poste-prio': { nom: 'La Poste Priority', court: 'Priority', prix: 9, delai: '1 jour ouvrable', transporteur: 'La Poste' },
  pickpost: { nom: 'Retrait PickPost / My Post 24', court: 'PickPost', prix: 6, delai: '2 à 3 jours ouvrables', transporteur: 'La Poste' },
  retrait: LIVRAISONS.retrait
};
/* Belgique : bpost et Mondial Relay (tarifs indicatifs). */
const LIVRAISONS_BE = {
  bpost: { nom: 'bpost à domicile', court: 'bpost', prix: 6.5, delai: '1 à 2 jours ouvrables', transporteur: 'bpost' },
  'bpost-point': { nom: 'bpost en point d’enlèvement', court: 'Point bpost', prix: 5.5, delai: '1 à 2 jours ouvrables', transporteur: 'bpost' },
  'relais-be': { nom: 'Mondial Relay en point relais', court: 'Point relais', prix: 4.2, delai: '3 à 5 jours', transporteur: 'Mondial Relay' },
  retrait: LIVRAISONS.retrait
};
const TOUTES_LIVRAISONS = { ...LIVRAISONS, ...LIVRAISONS_CH, ...LIVRAISONS_BE };
function livraisonsPays(pays) { return pays === 'ch' ? LIVRAISONS_CH : pays === 'be' ? LIVRAISONS_BE : LIVRAISONS; }
const SEUIL_PORT_DEFAUT = 60;
/* Seuil de livraison offerte de la boutique (réglable dans Conversion ; 0 = jamais offerte). */
function seuilPort() { try { return etat && etat.offres && etat.offres.seuilPort !== undefined ? Number(etat.offres.seuilPort) : SEUIL_PORT_DEFAUT; } catch { return SEUIL_PORT_DEFAUT; } }
function fraisPort(mode, sousTotal) {
  const l = TOUTES_LIVRAISONS[mode] || LIVRAISONS.colissimo;
  if (mode === 'retrait') return 0;
  const seuil = seuilPort();
  if (seuil > 0 && mode !== 'chronopost' && mode !== 'poste-prio' && sousTotal >= seuil) return 0;
  return l.prix;
}

const PRENOMS = ['Camille', 'Léa', 'Hugo', 'Manon', 'Lucas', 'Chloé', 'Nathan', 'Inès', 'Louis', 'Jade', 'Gabriel', 'Zoé', 'Arthur', 'Lina', 'Jules', 'Emma', 'Tom', 'Sarah', 'Noah', 'Alice', 'Paul', 'Clara', 'Adam', 'Romane'];
const NOMS = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'Roux', 'Fournier', 'Girard', 'Bonnet', 'Lambert'];
const VILLES = ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nantes', 'Bordeaux', 'Lille', 'Rennes', 'Strasbourg', 'Montpellier', 'Grenoble', 'Dijon', 'Bruxelles', 'Genève', 'Annecy', 'Tours'];

/* Générateur pseudo-aléatoire déterministe (la démo est identique à chaque chargement). */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sectionsParDefaut(nom, secteurId, pays = 'fr') {
  const s = SECTEURS[secteurId];
  const saison = SAISONS[new Date().getMonth()];
  const mk = (type, props) => ({ id: 's' + Math.random().toString(36).slice(2, 9), type, props: { ...TYPES_SECTIONS[type].defaut, ...props } });
  return [
    mk('annonce', pays === 'ch' ? { texte: 'Paiement TWINT ou carte · Livraison suivie' } : {}),
    mk('hero', { titre: nom, sousTitre: `${s.nom} choisis avec soin.`, bouton: 'Voir la collection' }),
    // Pas de code promo par défaut : il n'existerait pas au paiement. Le copilote en crée un quand le marchand valide une campagne.
    mk('saison', { titre: saison.nom, texte: 'Découvrez notre sélection du moment.', code: '' }),
    mk('produits', { titre: 'Nos meilleures ventes', nombre: '4' }),
    mk('arguments', pays === 'ch' ? { a1: 'Livraison suivie jusqu’à votre porte', a2: 'Paiement TWINT ou carte', a3: 'Service client en français' } : {}),
    mk('avis', {}),
    mk('newsletter', {}),
    mk('pied', { texte: `© ${new Date().getFullYear()} ${nom}` })
  ];
}

function produitsDepuisSecteur(secteurId, rand = Math.random) {
  return SECTEURS[secteurId].produits.map(([nom, cat, prix, desc], i) => ({
    id: 'p' + (i + 1),
    nom, categorie: cat, prix, description: desc,
    stock: Math.round(8 + rand() * 60),
    teinte: Math.round((i * 57 + secteurId.length * 31) % 360),
    actif: true
  }));
}

/* Boutique de démonstration : « Maison Brume », bougies et déco, ~70 commandes sur 75 jours. */
function boutiqueDemo() {
  const rand = prng(20261109);
  const nom = 'Maison Brume';
  const produits = produitsDepuisSecteur('deco', rand);
  produits[1].stock = 3; // déclenche une alerte de stock bas
  const now = Date.now();
  const jour = 86400000;
  const commandes = [];
  let numero = 1001;
  for (let d = 75; d >= 0; d--) {
    // la demande monte à l’approche de novembre
    const n = Math.floor(rand() * (d < 20 ? 3.2 : d < 45 ? 2.1 : 1.4));
    for (let k = 0; k < n; k++) {
      const date = now - d * jour - Math.floor(rand() * jour * 0.8);
      const lignes = [];
      const nb = 1 + Math.floor(rand() * 2.4);
      for (let j = 0; j < nb; j++) {
        const p = produits[Math.floor(Math.pow(rand(), 1.4) * produits.length)];
        const ex = lignes.find(l => l.produitId === p.id);
        if (ex) ex.qte++; else lignes.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 });
      }
      const sousTotal = lignes.reduce((a, l) => a + l.prix * l.qte, 0);
      const r = rand();
      const enMagasin = r < 0.1;
      const livraison = enMagasin ? 'retrait' : r < 0.55 ? 'colissimo' : r < 0.85 ? 'relais' : r < 0.93 ? 'retrait' : 'chronopost';
      const port = enMagasin ? 0 : fraisPort(livraison, sousTotal);
      let statut;
      if (d > 10) statut = rand() < 0.05 ? 'remboursee' : 'livree';
      else if (d > 4) statut = rand() < 0.5 ? 'livree' : 'expediee';
      else if (d > 1) statut = rand() < 0.6 ? 'expediee' : 'preparation';
      else statut = rand() < 0.15 ? 'attente' : 'payee';
      if (livraison === 'retrait') statut = { livree: 'retiree', expediee: 'prete' }[statut] || statut;
      if (enMagasin) statut = 'retiree';
      const prenom = PRENOMS[Math.floor(rand() * PRENOMS.length)];
      const nomF = NOMS[Math.floor(rand() * NOMS.length)];
      commandes.push({
        id: 'c' + numero, numero: numero++, date,
        client: { nom: `${prenom} ${nomF}`, email: `${prenom}.${nomF}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@exemple.fr', ville: VILLES[Math.floor(rand() * VILLES.length)] },
        lignes, sousTotal, port, total: Math.round((sousTotal + port) * 100) / 100,
        statut, livraison, canal: enMagasin ? 'magasin' : 'web',
        suivi: ['expediee', 'livree'].includes(statut) ? 'LA' + Math.floor(100000000 + rand() * 899999999) + 'FR' : '',
        historique: [{ date, texte: enMagasin ? 'Vente encaissée en boutique' : 'Commande passée' }],
        note: ''
      });
    }
  }
  // Numéros dans l’ordre chronologique
  commandes.sort((a, b) => a.date - b.date).forEach((c, i) => { c.numero = 1001 + i; c.id = 'c' + c.numero; });
  return completerEtat({
    version: 1,
    boutique: {
      nom, secteur: 'deco', slogan: 'Bougies et objets pour les soirs d’hiver',
      theme: { ...THEMES.brume, id: 'brume' },
      sections: sectionsParDefaut(nom, 'deco'),
      domaine: null, publiee: true, pays: 'fr'
    },
    produits, commandes,
    visites30j: 4180,
    entreprise: {
      raison: 'Maison Brume', forme: 'Micro-entreprise', siret: '912 345 678 00017', tvaIntra: '',
      adresse: '14 rue des Tanneurs, 69001 Lyon', email: 'bonjour@maisonbrume.fr', regime: 'franchise', mediateur: ''
    },
    magasin: { actif: true, adresse: '14 rue des Tanneurs, 69001 Lyon', horaires: 'Mar.–sam. 10 h–19 h', clickCollect: true, googleSync: true }
  });
}

/* Ajoute les champs des versions récentes à un état plus ancien (migration douce). */
function completerEtat(e) {
  e.entreprise = e.entreprise || { raison: e.boutique.nom, forme: 'Micro-entreprise', siret: '', tvaIntra: '', adresse: '', email: '', regime: 'franchise', mediateur: '' };
  e.magasin = e.magasin || { actif: false, adresse: '', horaires: '', clickCollect: false, googleSync: false };
  e.campagnes = e.campagnes || {};
  e.version = 2;
  e.boutique.devise = e.boutique.devise || (e.boutique.pays === 'ch' ? 'CHF' : 'EUR');
  e.boutique.modele = e.boutique.modele || 'stock';
  e.boutique.langues = e.boutique.langues || ['fr'];
  e.reglages = e.reglages || { autoTransmission: true, cpa: 8 };
  for (const p of e.produits) { p.type = p.type || 'stock'; if (!p.historiquePrix) p.historiquePrix = [{ date: Date.now() - 120 * 86400000, prix: p.prix }]; }
  e.rdv = e.rdv || null;
  e.publications = e.publications || [];
  e.cookies = e.cookies ?? null;
  let n = 0;
  for (const c of [...e.commandes].sort((a, b) => a.date - b.date)) {
    c.livraison = c.livraison || 'colissimo';
    c.canal = c.canal || 'web';
    if (!c.facture && !['attente', 'annulee'].includes(c.statut)) c.facture = numeroFactureSuivant(e, c.date);
    // Facture déjà émise sans taux enregistré : figé une fois pour toutes (un changement de régime ne la réécrit plus).
    // Remboursement antérieur aux avoirs : l'avoir est émis maintenant, une fois, dans la même suite de numéros.
    if (c.facture && c.statut === 'remboursee' && !c.avoir) { const d = (c.historique || []).slice().reverse().find(h => /rembours/i.test(h.texte)); const quand = d ? d.date : c.date; c.avoir = { numero: numeroFactureSuivant(e, quand, 'AV'), date: quand, montant: c.total }; }
    if (c.facture && typeof c.tauxTva !== 'number') c.tauxTva = (e.entreprise && e.entreprise.regime === 'ch-assujetti') ? 0.081 : (e.entreprise && e.entreprise.regime === 'normal') ? (DROIT_PAYS[e.boutique.pays] || DROIT_PAYS.fr).tva : 0;
    n++;
  }
  return e;
}
/* Actions irréversibles (remboursement, annulation, suppression) : une confirmation explicite avant d'agir. */
function confirmerAction(el) {
  const { action, id, statut } = el.dataset;
  try {
    if (action === 'statut' && (statut === 'remboursee' || statut === 'annulee')) {
      const c = etat.commandes.find(x => x.id === id);
      return confirm(statut === 'remboursee'
        ? `Rembourser la commande n° ${c ? c.numero : ''} (${c ? euros(c.total) : ''}) ? Le client est remboursé et un avoir est émis : c’est irréversible.`
        : `Annuler la commande n° ${c ? c.numero : ''} ? Le lien de paiement envoyé au client ne fonctionnera plus.`);
    }
    if (action === 'supprimer-produit') {
      const p = etat.produits.find(x => x.id === id);
      return confirm(`Supprimer « ${p ? p.nom : 'ce produit'} » ? Il disparaît de la boutique ; les commandes passées le gardent. Pour le retirer temporairement, décochez plutôt « Visible dans la boutique ».`);
    }
  } catch { /* pas de boîte de dialogue disponible : on agit */ }
  return true;
}
function numeroFactureSuivant(e, date, prefixe = 'FA') {
  e.compteurFacture = (e.compteurFacture || 0) + 1;
  return `${prefixe}-${new Date(date).getFullYear()}-${String(e.compteurFacture).padStart(4, '0')}`;
}

function dansJours(date) {
  const n = Math.ceil((new Date(date) - new Date()) / JOUR);
  return n <= 0 ? 'Aujourd’hui' : n === 1 ? 'Demain' : `Dans ${n} jours`;
}
const SOURCES = [
  ['Sélection produit', 'Critères de marge, prix et délai issus des conseils publics de Yomi Denzel, Kamil Sattar, Minea et des guides Shopify.'],
  ['Tests publicitaires', 'Phase d’apprentissage Meta (environ 50 conversions), budget de test et seuil de coupe : documentation Meta Ads et conseils de Jordan Welch.'],
  ['Contenu organique', '3 à 5 vidéos courtes par jour pendant 30 jours, plusieurs accroches par vidéo : Kamil Sattar et études TikTok.'],
  ['Stock propre', 'Passer un gagnant en stock pour gagner en marge et en délai : Sebastian Ghiorghiu, Lucas Biver.'],
  ['Prix barrés', 'Ordonnance suisse sur l’indication des prix (OIP) et directive européenne Omnibus : prix de référence pratiqué pendant 30 jours.'],
  ['Limites', 'Ce sont des règles par défaut, pas des garanties de résultat. Aucun revenu n’est promis : ajustez les seuils à votre marché.']
];

/* Règles légales et fiscales par pays de l'entreprise (hors Suisse, gérée à part). */
const DROIT_PAYS = {
  fr: { id: 'SIRET', idCourt: 'SIRET', idExemple: '123 456 789 00012', tva: 0.2, tvaTexte: '20 %', franchise: 'TVA non applicable, art. 293 B du CGI', franchiseNom: 'Franchise en base', formes: ['Micro-entreprise', 'EI', 'EURL', 'SASU', 'SARL', 'SAS'], tvaExemple: 'FR12345678901', recouvrement: true, retractation: 'art. L221-18 du Code de la consommation' },
  be: { id: 'Numéro d’entreprise (BCE)', idCourt: 'BCE', idExemple: '0123.456.789', tva: 0.21, tvaTexte: '21 %', franchise: 'Régime particulier de franchise des petites entreprises', franchiseNom: 'Franchise des petites entreprises', formes: ['Personne physique', 'SRL', 'SA', 'SC'], tvaExemple: 'BE0123456789', recouvrement: false, retractation: 'art. VI.47 du Code de droit économique' }
};
/* Mention de prix selon le régime de TVA : « TTC » n'a de sens que si l'entreprise facture la TVA. */
function mentionTva(regime, pays) {
  if (regime === 'ch-non') return 'Entreprise non assujettie à la TVA';
  if (regime === 'franchise') return (DROIT_PAYS[pays] || DROIT_PAYS.fr).franchise;
  return pays === 'ch' ? 'TVA comprise' : 'TTC, TVA incluse';
}
function droitPays(pays) {
  let p = pays;
  if (!p) { try { p = etat.boutique.pays; } catch { p = 'fr'; } }
  return DROIT_PAYS[p] || DROIT_PAYS.fr;
}
