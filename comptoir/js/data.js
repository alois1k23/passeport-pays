/* Comptoir — données de référence : secteurs, saisonnalité, thèmes, jeu de démo.
   Toutes les courbes de demande sont des indices simulés (100 = mois moyen)
   destinés à la démo. En production : Google Trends, Search Console,
   données marketplace et historique de ventes réel. */

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* Temps forts du commerce en France, mois par mois.
   kw : mot-clé de campagne utilisé pour les domaines saisonniers. */
const SAISONS = [
  { mois: 0, nom: 'Soldes d’hiver', kw: 'soldes', force: 0.75, conseil: 'Les soldes démarrent le 2e mercredi de janvier : préparez une collection « dernières pièces ».' },
  { mois: 1, nom: 'Saint-Valentin', kw: 'saint-valentin', force: 0.85, conseil: 'Coffrets duo et cartes cadeaux : la demande culmine la semaine du 7 au 14 février.' },
  { mois: 2, nom: 'Printemps', kw: 'printemps', force: 0.5, conseil: 'Renouvelez les visuels : couleurs claires, nouveautés, grand ménage de printemps.' },
  { mois: 3, nom: 'Pâques', kw: 'paques', force: 0.55, conseil: 'Petits cadeaux et décoration de table : une bannière Pâques suffit.' },
  { mois: 4, nom: 'Fête des mères', kw: 'fete-des-meres', force: 0.95, conseil: 'Fête des mères le dernier dimanche de mai : la meilleure période du printemps pour le cadeau.' },
  { mois: 5, nom: 'Fête des pères & soldes d’été', kw: 'fete-des-peres', force: 0.7, conseil: 'Fête des pères le 3e dimanche de juin, puis soldes d’été fin juin.' },
  { mois: 6, nom: 'Vacances d’été', kw: 'ete', force: 0.45, conseil: 'Trafic plus faible : idéal pour tester de nouveaux produits et préparer la rentrée.' },
  { mois: 7, nom: 'Préparation rentrée', kw: 'rentree', force: 0.5, conseil: 'Préparez les campagnes de septembre et les stocks de fin d’année.' },
  { mois: 8, nom: 'Rentrée', kw: 'rentree', force: 0.65, conseil: 'Nouvelle saison : les clients reviennent, relancez votre newsletter.' },
  { mois: 9, nom: 'Halloween & premiers cadeaux', kw: 'halloween', force: 0.6, conseil: 'Les premiers achats de Noël commencent : publiez vos coffrets dès la mi-octobre.' },
  { mois: 10, nom: 'Black Friday', kw: 'black-friday', force: 1, conseil: 'Black Friday le vendredi après Thanksgiving, puis Cyber Monday. Réservez un domaine de campagne et préparez vos offres.' },
  { mois: 11, nom: 'Noël', kw: 'noel', force: 1, conseil: 'Pic de l’année : mettez en avant les cartes cadeaux et la date limite de livraison avant le 24.' }
];

/* Secteurs : mots-clés (volume de recherche mensuel simulé) + courbe saisonnière. */
const SECTEURS = {
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
  brume: { nom: 'Brume', bg: '#F3F1EC', surface: '#FFFFFF', text: '#23262B', muted: '#6B6F76', primary: '#4F6B5A', onPrimary: '#FFFFFF', font: "'Fraunces', Georgia, serif", body: "'Outfit', system-ui, sans-serif", radius: 4 },
  nocturne: { nom: 'Nocturne', bg: '#111317', surface: '#1B1E24', text: '#F2F0EA', muted: '#9AA0A8', primary: '#E7B75F', onPrimary: '#14161A', font: "'Syne', system-ui, sans-serif", body: "'Outfit', system-ui, sans-serif", radius: 0 },
  craie: { nom: 'Craie', bg: '#FFFFFF', surface: '#F5F6F8', text: '#101318', muted: '#5C6470', primary: '#1F3FD1', onPrimary: '#FFFFFF', font: "'DM Serif Display', Georgia, serif", body: "'IBM Plex Sans', system-ui, sans-serif", radius: 10 },
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
  annonce: { nom: 'Barre d’annonce', champs: [['texte', 'Texte', 'text']], defaut: { texte: 'Livraison offerte dès 60 € d’achat' } },
  hero: { nom: 'Bannière d’accueil', champs: [['titre', 'Titre', 'text'], ['sousTitre', 'Sous-titre', 'textarea'], ['bouton', 'Texte du bouton', 'text'], ['align', 'Alignement', 'select:gauche,centre']], defaut: { titre: 'Votre nouvelle collection', sousTitre: 'Une phrase qui donne envie de découvrir vos produits.', bouton: 'Découvrir', align: 'gauche' } },
  saison: { nom: 'Bannière saisonnière', champs: [['titre', 'Titre', 'text'], ['texte', 'Texte', 'textarea'], ['code', 'Code promo', 'text']], defaut: { titre: 'Offre de saison', texte: '-15 % sur toute la boutique', code: 'SAISON15' } },
  produits: { nom: 'Grille de produits', champs: [['titre', 'Titre', 'text'], ['nombre', 'Nombre de produits', 'select:3,4,6,8'], ['categorie', 'Catégorie', 'categorie']], defaut: { titre: 'Nos best-sellers', nombre: '4', categorie: '' } },
  arguments: { nom: 'Arguments clés', champs: [['a1', 'Argument 1', 'text'], ['a2', 'Argument 2', 'text'], ['a3', 'Argument 3', 'text']], defaut: { a1: 'Fabriqué en France', a2: 'Expédié sous 48 h', a3: 'Retours gratuits 30 jours' } },
  texte: { nom: 'Bloc texte', champs: [['titre', 'Titre', 'text'], ['texte', 'Texte', 'textarea']], defaut: { titre: 'Notre histoire', texte: 'Racontez qui vous êtes, comment vous fabriquez et pourquoi.' } },
  avis: { nom: 'Avis clients', champs: [['a1', 'Avis 1', 'textarea'], ['n1', 'Auteur 1', 'text'], ['a2', 'Avis 2', 'textarea'], ['n2', 'Auteur 2', 'text']], defaut: { a1: 'Produit superbe et livraison rapide.', n1: 'Camille, Lyon', a2: 'Je recommande les yeux fermés.', n2: 'Hugo, Nantes' } },
  newsletter: { nom: 'Inscription newsletter', champs: [['titre', 'Titre', 'text'], ['texte', 'Texte', 'text']], defaut: { titre: 'Restons en contact', texte: '-10 % sur votre première commande.' } },
  faq: { nom: 'Questions fréquentes', champs: [['q1', 'Question 1', 'text'], ['r1', 'Réponse 1', 'textarea'], ['q2', 'Question 2', 'text'], ['r2', 'Réponse 2', 'textarea']], defaut: { q1: 'Quels sont les délais de livraison ?', r1: '48 à 72 h en France métropolitaine.', q2: 'Puis-je retourner un produit ?', r2: 'Oui, sous 30 jours, retour gratuit.' } },
  pied: { nom: 'Pied de page', champs: [['texte', 'Texte', 'text'], ['contact', 'Contact', 'text']], defaut: { texte: 'Fait avec soin.', contact: 'bonjour@exemple.fr' } }
};

const STATUTS = {
  attente: { nom: 'Paiement en attente', ton: 'warn' },
  payee: { nom: 'À préparer', ton: 'info' },
  preparation: { nom: 'En préparation', ton: 'info' },
  expediee: { nom: 'Expédiée', ton: 'accent' },
  livree: { nom: 'Livrée', ton: 'good' },
  remboursee: { nom: 'Remboursée', ton: 'muted' },
  annulee: { nom: 'Annulée', ton: 'bad' }
};

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

function sectionsParDefaut(nom, secteurId) {
  const s = SECTEURS[secteurId];
  const saison = SAISONS[new Date().getMonth()];
  const mk = (type, props) => ({ id: 's' + Math.random().toString(36).slice(2, 9), type, props: { ...TYPES_SECTIONS[type].defaut, ...props } });
  return [
    mk('annonce', {}),
    mk('hero', { titre: nom, sousTitre: `${s.nom} choisis avec soin, expédiés depuis notre atelier.`, bouton: 'Voir la collection' }),
    mk('saison', { titre: saison.nom, texte: '-15 % sur une sélection jusqu’à la fin du mois', code: saison.kw.replace(/-/g, '').toUpperCase().slice(0, 10) + '15' }),
    mk('produits', { titre: 'Nos best-sellers', nombre: '4' }),
    mk('arguments', {}),
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
      const port = sousTotal >= 60 ? 0 : 5.9;
      let statut;
      if (d > 10) statut = rand() < 0.05 ? 'remboursee' : 'livree';
      else if (d > 4) statut = rand() < 0.5 ? 'livree' : 'expediee';
      else if (d > 1) statut = rand() < 0.6 ? 'expediee' : 'preparation';
      else statut = rand() < 0.15 ? 'attente' : 'payee';
      const prenom = PRENOMS[Math.floor(rand() * PRENOMS.length)];
      const nomF = NOMS[Math.floor(rand() * NOMS.length)];
      commandes.push({
        id: 'c' + numero, numero: numero++, date,
        client: { nom: `${prenom} ${nomF}`, email: `${prenom}.${nomF}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@exemple.fr', ville: VILLES[Math.floor(rand() * VILLES.length)] },
        lignes, sousTotal, port, total: Math.round((sousTotal + port) * 100) / 100,
        statut, suivi: ['expediee', 'livree'].includes(statut) ? 'LA' + Math.floor(100000000 + rand() * 899999999) + 'FR' : '',
        historique: [{ date, texte: 'Commande passée' }],
        note: ''
      });
    }
  }
  // Numéros dans l’ordre chronologique
  commandes.sort((a, b) => a.date - b.date).forEach((c, i) => { c.numero = 1001 + i; c.id = 'c' + c.numero; });
  return {
    version: 1,
    boutique: {
      nom, secteur: 'deco', slogan: 'Bougies et objets pour les soirs d’hiver',
      theme: { ...THEMES.brume, id: 'brume' },
      sections: sectionsParDefaut(nom, 'deco'),
      domaine: null, publiee: true, pays: 'fr'
    },
    produits, commandes,
    visites30j: 4180
  };
}
