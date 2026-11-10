#!/usr/bin/env python3
"""Génère le catalogue fournisseurs de démonstration (une seule source pour l'interface et le serveur).

Sorties :
  - server/data/catalogue-demo.json  (lu par le serveur et le faux fournisseur)
  - js/catalogue.js                  (lu par l'interface : CATALOGUE_DONNEES, PROFILS_SAISON)

Chaque produit a un profil saisonnier (12 indices mensuels, 100 = mois moyen) et des mots-clés
de recherche (utilisés pour Google Trends quand une clé SerpApi est configurée).
Lancer depuis la racine de comptoir/ : python3 outils/catalogue/generer.py
"""
import json, os

RACINE = os.path.join(os.path.dirname(__file__), '..', '..')

# Profils de demande mensuelle (janvier → décembre), 100 = mois moyen.
PROFILS = {
    'constant':   [100, 96, 98, 100, 100, 96, 92, 94, 102, 104, 108, 110],
    'hiver':      [130, 110, 85, 70, 60, 55, 55, 60, 85, 120, 150, 160],
    'ete':        [55, 60, 75, 95, 125, 150, 160, 140, 95, 70, 60, 65],
    'cadeau':     [70, 95, 80, 85, 120, 90, 75, 75, 85, 100, 145, 180],
    'noel':       [50, 50, 55, 60, 65, 60, 55, 60, 75, 110, 170, 230],
    'rentree':    [85, 80, 85, 90, 90, 85, 100, 145, 150, 100, 90, 100],
    'printemps':  [70, 85, 125, 140, 135, 110, 90, 85, 90, 85, 80, 85],
    'halloween':  [55, 50, 55, 60, 60, 60, 65, 75, 110, 210, 90, 70],
    'bonnes-resolutions': [175, 135, 115, 105, 100, 95, 85, 80, 100, 90, 80, 70],
    'saint-valentin': [95, 190, 85, 85, 110, 85, 80, 80, 85, 90, 115, 150],
}

F = {  # fournisseurs de démonstration par entrepôt
    'CH': ['Fournisseur Lémanique (démo)', 'Atelier Jura Bois (démo)', 'Tricot Romand (démo)', 'Herboristerie du Valais (démo)', 'Rucher des Alpes (démo)', 'Atelier Genevois (démo)', 'Laboratoire Léman (démo)', 'Swiss Outdoor Depot (démo)'],
    'UE': ['EuroDepot Lyon (démo)', 'Textil Porto (démo)', 'PetDepot Milano (démo)', 'TechHub Rotterdam (démo)', 'BeautyLab Barcelona (démo)', 'FitStock Berlin (démo)', 'Casa Lisboa (démo)', 'Lana Biella (démo)', 'Spezie Milano (démo)', 'Argento Firenze (démo)', 'ReWear Amsterdam (démo)'],
    'CN': ['Shenzhen Home Supply (démo)', 'Ningbo Pets (démo)', 'Shenzhen Mobile (démo)', 'Guangzhou Beauty (démo)', 'Yiwu Decor (démo)', 'Guangzhou Apparel (démo)', 'Yiwu Jewelry (démo)', 'Ningbo Sport (démo)'],
}
DELAIS = {'CH': (1, 3), 'UE': (4, 7), 'CN': (10, 18)}

# Nouveaux produits : niche → [(nom, catégorie, coût, port, entrepôt, prix, tendance, concurrence, note, profil, mots-clés)]
NOUVEAUX = {
  'maison': [
    ('Couverture chauffante douce', 'Textile', 24, 7, 'UE', 89, 82, 58, 4.6, 'hiver', 'couverture chauffante'),
    ('Bouillotte en laine', 'Textile', 7, 4, 'CH', 32, 60, 40, 4.8, 'hiver', 'bouillotte'),
    ('Diffuseur d’huiles essentielles en bois', 'Diffuseurs', 12, 5, 'UE', 49, 70, 66, 4.5, 'constant', 'diffuseur huiles essentielles'),
    ('Lampe de chevet tactile', 'Luminaires', 11, 5, 'UE', 45, 64, 60, 4.5, 'constant', 'lampe tactile'),
    ('Set de draps en lin lavé', 'Textile', 38, 8, 'UE', 139, 66, 44, 4.7, 'printemps', 'draps lin'),
    ('Ventilateur de table silencieux', 'Climatisation', 18, 6, 'UE', 69, 88, 70, 4.4, 'ete', 'ventilateur silencieux'),
    ('Calendrier de l’Avent à remplir', 'Fêtes', 9, 5, 'UE', 39, 85, 52, 4.6, 'noel', 'calendrier de l avent'),
    ('Boîtes de rangement sous vide', 'Rangement', 8, 5, 'UE', 34, 58, 72, 4.4, 'printemps', 'sac sous vide'),
    ('Projecteur ciel étoilé', 'Luminaires', 10, 4.5, 'CN', 42, 80, 86, 4.2, 'noel', 'projecteur ciel etoile'),
    ('Moustiquaire magnétique de porte', 'Été', 6, 4, 'UE', 29, 76, 64, 4.3, 'ete', 'moustiquaire porte'),
    ('Mug isotherme en céramique', 'Cuisine', 7, 4.5, 'CH', 34, 55, 46, 4.7, 'cadeau', 'mug isotherme'),
    ('Planche à découper en olivier', 'Cuisine', 13, 6, 'UE', 49, 52, 40, 4.8, 'cadeau', 'planche a decouper bois'),
    ('Pantoufles en feutre', 'Textile', 12, 5, 'UE', 49, 68, 50, 4.6, 'hiver', 'pantoufles feutre'),
  ],
  'animaux': [
    ('Manteau imperméable pour chien', 'Vêtements', 9, 5, 'UE', 39, 72, 58, 4.5, 'hiver', 'manteau chien'),
    ('Tapis de léchage anti-stress', 'Accessoires', 4, 3.5, 'UE', 22, 78, 66, 4.5, 'constant', 'tapis de lechage'),
    ('Fontaine filtrante en inox', 'Accessoires', 16, 6, 'UE', 59, 70, 62, 4.6, 'ete', 'fontaine chat inox'),
    ('Harnais anti-traction réglable', 'Promenade', 8, 4, 'CH', 39, 66, 60, 4.7, 'printemps', 'harnais chien'),
    ('Arbre à chat compact', 'Couchage', 28, 12, 'UE', 99, 64, 70, 4.4, 'constant', 'arbre a chat'),
    ('Brosse autonettoyante', 'Soin', 5, 3.5, 'CN', 24, 60, 88, 4.2, 'printemps', 'brosse chat'),
    ('Tapis rafraîchissant', 'Couchage', 10, 5, 'UE', 39, 84, 60, 4.3, 'ete', 'tapis rafraichissant chien'),
    ('Distributeur de croquettes connecté', 'Tech', 34, 8, 'UE', 129, 74, 56, 4.4, 'rentree', 'distributeur croquettes'),
    ('Coussin orthopédique pour vieux chien', 'Couchage', 22, 9, 'UE', 79, 58, 46, 4.7, 'hiver', 'coussin orthopedique chien'),
    ('Jouet puzzle à friandises', 'Jouets', 6, 4, 'CH', 29, 62, 50, 4.6, 'noel', 'jouet intelligent chien'),
    ('Sac de transport ventilé', 'Promenade', 14, 6, 'UE', 59, 56, 54, 4.5, 'ete', 'sac transport chat'),
    ('Médaille gravée personnalisée', 'Accessoires', 3, 3, 'CH', 19, 54, 42, 4.9, 'cadeau', 'medaille chien gravee'),
  ],
  'tech': [
    ('Batterie externe magnétique 10 000 mAh', 'Recharge', 14, 4, 'UE', 49, 80, 74, 4.5, 'ete', 'batterie externe magnetique'),
    ('Écouteurs à conduction osseuse', 'Audio', 22, 5, 'UE', 79, 72, 64, 4.4, 'printemps', 'ecouteurs conduction osseuse'),
    ('Clavier mécanique compact', 'Bureau', 28, 6, 'UE', 99, 68, 70, 4.6, 'rentree', 'clavier mecanique'),
    ('Support d’ordinateur pliable', 'Bureau', 9, 4.5, 'CH', 39, 60, 62, 4.6, 'rentree', 'support ordinateur portable'),
    ('Caméra de surveillance Wi-Fi', 'Maison connectée', 19, 5, 'UE', 69, 70, 78, 4.3, 'constant', 'camera surveillance wifi'),
    ('Mini projecteur portable', 'Image', 39, 7, 'UE', 149, 78, 72, 4.2, 'noel', 'mini projecteur'),
    ('Station de charge en bois', 'Recharge', 15, 5, 'UE', 59, 58, 52, 4.6, 'cadeau', 'station de charge bois'),
    ('Ampoule connectée couleur', 'Maison connectée', 6, 3.5, 'CN', 25, 64, 86, 4.1, 'hiver', 'ampoule connectee'),
    ('Enceinte de douche étanche', 'Audio', 9, 4, 'CN', 32, 62, 84, 4.1, 'ete', 'enceinte douche'),
    ('Hub USB-C 7 en 1', 'Bureau', 13, 4, 'UE', 49, 66, 76, 4.5, 'rentree', 'hub usb c'),
    ('Thermomètre de cuisine connecté', 'Cuisine', 16, 5, 'UE', 59, 60, 50, 4.5, 'ete', 'thermometre connecte'),
    ('Ring light pour visioconférence', 'Image', 11, 5, 'CN', 39, 56, 82, 4.2, 'bonnes-resolutions', 'ring light'),
  ],
  'deco': [
    ('Bougeoirs en laiton', 'Bougeoirs', 12, 5, 'UE', 49, 62, 46, 4.7, 'noel', 'bougeoir laiton'),
    ('Affiche d’art minimaliste', 'Affiches', 5, 4, 'CH', 35, 66, 58, 4.6, 'constant', 'affiche minimaliste'),
    ('Plaid en fausse fourrure', 'Textile', 19, 7, 'UE', 69, 72, 54, 4.5, 'hiver', 'plaid fausse fourrure'),
    ('Pot de fleurs autoarrosant', 'Plantes', 8, 5, 'UE', 34, 70, 58, 4.4, 'printemps', 'pot autoarrosant'),
    ('Plante artificielle en pot', 'Plantes', 14, 7, 'UE', 59, 60, 64, 4.3, 'constant', 'plante artificielle'),
    ('Horloge murale scandinave', 'Horloges', 15, 6, 'UE', 59, 54, 52, 4.5, 'rentree', 'horloge murale scandinave'),
    ('Coussin bouclette', 'Textile', 9, 5, 'UE', 39, 74, 56, 4.6, 'hiver', 'coussin bouclette'),
    ('Étoile lumineuse en papier', 'Fêtes', 7, 4.5, 'UE', 32, 80, 50, 4.6, 'noel', 'etoile lumineuse papier'),
    ('Lanterne solaire de jardin', 'Extérieur', 9, 5, 'CN', 35, 78, 80, 4.2, 'ete', 'lanterne solaire'),
    ('Panier en jonc de mer', 'Rangement', 11, 6, 'UE', 45, 58, 44, 4.7, 'printemps', 'panier jonc de mer'),
    ('Décoration d’Halloween lumineuse', 'Fêtes', 6, 4, 'CN', 25, 74, 78, 4.1, 'halloween', 'decoration halloween'),
    ('Diffuseur à bâtonnets parfumés', 'Parfums', 8, 4.5, 'CH', 39, 62, 48, 4.7, 'cadeau', 'diffuseur batons'),
  ],
  'mode': [
    ('Bonnet en cachemire', 'Accessoires', 19, 4.5, 'UE', 69, 70, 54, 4.6, 'hiver', 'bonnet cachemire'),
    ('Gants tactiles en laine', 'Accessoires', 7, 3.5, 'CH', 32, 66, 52, 4.6, 'hiver', 'gants tactiles'),
    ('Lunettes de soleil polarisées', 'Accessoires', 8, 3.5, 'UE', 49, 80, 72, 4.4, 'ete', 'lunettes polarisees'),
    ('Kimono de plage en coton', 'Plage', 11, 4.5, 'UE', 49, 72, 56, 4.5, 'ete', 'kimono plage'),
    ('Sac cabas en cuir végétal', 'Sacs', 18, 5, 'UE', 79, 68, 58, 4.5, 'rentree', 'sac cabas'),
    ('Pyjama en satin', 'Nuit', 14, 4.5, 'UE', 55, 70, 60, 4.5, 'saint-valentin', 'pyjama satin'),
    ('Chaussettes de Noël (lot de 2)', 'Chaussettes', 4, 3, 'CH', 19, 76, 48, 4.7, 'noel', 'chaussettes noel'),
    ('Ceinture en cuir réversible', 'Accessoires', 10, 4, 'UE', 45, 54, 56, 4.5, 'cadeau', 'ceinture reversible'),
    ('Imperméable pliable', 'Vestes', 16, 5, 'UE', 69, 64, 52, 4.4, 'printemps', 'impermeable pliable'),
    ('Chouchous en soie (lot de 3)', 'Cheveux', 5, 3, 'CN', 22, 70, 84, 4.2, 'constant', 'chouchou soie'),
    ('Porte-cartes RFID', 'Petite maroquinerie', 6, 3.5, 'UE', 29, 58, 70, 4.5, 'cadeau', 'porte carte rfid'),
    ('Legging de sport taille haute', 'Sport', 9, 4, 'UE', 45, 72, 74, 4.4, 'bonnes-resolutions', 'legging taille haute'),
  ],
  'beaute': [
    ('Brosse nettoyante visage', 'Visage', 9, 4, 'UE', 45, 70, 68, 4.4, 'constant', 'brosse nettoyante visage'),
    ('Kit gua sha en jade', 'Visage', 6, 3.5, 'UE', 32, 66, 72, 4.4, 'bonnes-resolutions', 'gua sha'),
    ('Lisseur sans fil', 'Cheveux', 22, 5, 'UE', 79, 72, 66, 4.3, 'ete', 'lisseur sans fil'),
    ('Coffret soins de Noël', 'Coffrets', 14, 5, 'CH', 59, 82, 48, 4.7, 'noel', 'coffret soin'),
    ('Crème solaire minérale SPF 50', 'Solaire', 7, 4, 'CH', 29, 76, 60, 4.6, 'ete', 'creme solaire minerale'),
    ('Masque de nuit en soie', 'Sommeil', 6, 3.5, 'UE', 29, 64, 62, 4.6, 'cadeau', 'masque de nuit soie'),
    ('Baume à lèvres bio (lot de 3)', 'Lèvres', 4, 3, 'CH', 19, 60, 50, 4.8, 'hiver', 'baume levres bio'),
    ('Épilateur à lumière pulsée', 'Corps', 45, 7, 'UE', 169, 78, 70, 4.2, 'printemps', 'epilateur lumiere pulsee'),
    ('Diffuseur de cheveux bouclés', 'Cheveux', 8, 4, 'CN', 29, 60, 76, 4.2, 'constant', 'diffuseur cheveux boucles'),
    ('Huile de soin pour barbe', 'Homme', 6, 3.5, 'CH', 29, 56, 52, 4.7, 'cadeau', 'huile barbe'),
    ('Miroir lumineux grossissant', 'Accessoires', 12, 5, 'UE', 49, 58, 64, 4.4, 'noel', 'miroir lumineux'),
    ('Patchs contour des yeux', 'Visage', 4, 3, 'CN', 19, 68, 86, 4.1, 'constant', 'patch yeux'),
  ],
  'epicerie': [
    ('Chocolat noir suisse grand cru', 'Chocolat', 8, 5, 'CH', 29, 74, 46, 4.9, 'noel', 'chocolat noir suisse'),
    ('Fondue moitié-moitié prête à l’emploi', 'Fromage', 9, 6, 'CH', 25, 82, 40, 4.8, 'hiver', 'fondue moitie moitie'),
    ('Coffret de vins doux de fête', 'Coffrets', 22, 9, 'UE', 69, 68, 50, 4.6, 'noel', 'coffret vin'),
    ('Granola artisanal aux noix', 'Petit-déjeuner', 5, 4, 'CH', 18, 60, 44, 4.7, 'bonnes-resolutions', 'granola artisanal'),
    ('Sirop d’érable pur', 'Sucré', 7, 5, 'UE', 24, 54, 48, 4.7, 'hiver', 'sirop erable'),
    ('Thé glacé maison (kit)', 'Thés', 6, 4, 'CH', 24, 66, 40, 4.6, 'ete', 'the glace'),
    ('Pâtes artisanales au blé dur', 'Épicerie salée', 5, 4.5, 'UE', 19, 52, 46, 4.7, 'constant', 'pates artisanales'),
    ('Sauce piquante fermentée', 'Épicerie salée', 4, 4, 'UE', 16, 70, 52, 4.6, 'ete', 'sauce piquante'),
    ('Truffes au chocolat (boîte de 16)', 'Chocolat', 9, 5, 'CH', 32, 80, 46, 4.8, 'saint-valentin', 'truffes chocolat'),
    ('Café de spécialité en grains', 'Cafés', 9, 4.5, 'CH', 29, 70, 54, 4.8, 'constant', 'cafe de specialite'),
    ('Pain d’épices au miel', 'Sucré', 5, 4, 'CH', 18, 72, 40, 4.7, 'noel', 'pain d epices'),
    ('Coffret de fêtes gourmand', 'Coffrets', 24, 8, 'CH', 79, 84, 44, 4.7, 'noel', 'coffret gourmand'),
  ],
  'sport': [
    ('Kettlebell réglable', 'Musculation', 26, 9, 'UE', 89, 70, 58, 4.5, 'bonnes-resolutions', 'kettlebell reglable'),
    ('Corde à sauter lestée', 'Cardio', 6, 4, 'UE', 29, 66, 68, 4.4, 'bonnes-resolutions', 'corde a sauter'),
    ('Rouleau de massage vibrant', 'Récupération', 19, 5, 'UE', 69, 64, 60, 4.5, 'constant', 'rouleau massage'),
    ('Sac étanche de randonnée 20 L', 'Outdoor', 9, 4.5, 'CH', 39, 70, 52, 4.6, 'ete', 'sac etanche'),
    ('Bâtons de marche pliables', 'Outdoor', 14, 6, 'CH', 59, 64, 54, 4.6, 'printemps', 'batons de marche'),
    ('Gants de ski chauffants', 'Hiver', 34, 6, 'UE', 129, 76, 50, 4.3, 'hiver', 'gants chauffants'),
    ('Bouteille shaker avec compartiment', 'Nutrition', 4, 3.5, 'CN', 19, 58, 84, 4.2, 'bonnes-resolutions', 'shaker proteine'),
    ('Tapis de pilates épais', 'Yoga', 12, 6, 'UE', 49, 66, 62, 4.5, 'bonnes-resolutions', 'tapis pilates'),
    ('Lampe frontale rechargeable', 'Outdoor', 9, 4, 'UE', 39, 68, 64, 4.6, 'hiver', 'lampe frontale'),
    ('Serviette microfibre de sport', 'Accessoires', 4, 3, 'CN', 18, 56, 82, 4.3, 'ete', 'serviette microfibre'),
    ('Ceinture de course pour téléphone', 'Running', 5, 3.5, 'UE', 25, 62, 66, 4.4, 'printemps', 'ceinture running'),
    ('Mini stepper silencieux', 'Cardio', 28, 10, 'UE', 99, 68, 56, 4.3, 'bonnes-resolutions', 'mini stepper'),
  ],
  'bijoux': [
    ('Collier prénom personnalisé', 'Colliers', 9, 3.5, 'UE', 49, 78, 66, 4.6, 'cadeau', 'collier prenom'),
    ('Bracelet en pierres naturelles', 'Bracelets', 4, 3, 'CH', 29, 64, 58, 4.6, 'constant', 'bracelet pierre naturelle'),
    ('Boucles d’oreilles perles baroques', 'Boucles', 7, 3, 'UE', 39, 66, 54, 4.6, 'saint-valentin', 'boucles perles'),
    ('Bague ajustable en or vermeil', 'Bagues', 9, 3, 'UE', 45, 70, 60, 4.5, 'cadeau', 'bague ajustable'),
    ('Chaîne de cheville dorée', 'Chevilles', 3, 3, 'CN', 19, 72, 86, 4.1, 'ete', 'chaine cheville'),
    ('Pendentif initiale en argent', 'Colliers', 8, 3, 'CH', 45, 68, 52, 4.8, 'noel', 'pendentif initiale'),
    ('Montre minimaliste en acier', 'Montres', 18, 4, 'UE', 89, 62, 64, 4.4, 'cadeau', 'montre minimaliste'),
    ('Boîte à bijoux de voyage', 'Rangement', 6, 4, 'UE', 29, 58, 56, 4.6, 'noel', 'boite a bijoux'),
    ('Bracelet duo pour couple', 'Bracelets', 5, 3, 'CN', 25, 74, 80, 4.2, 'saint-valentin', 'bracelet couple'),
    ('Créoles en acier inoxydable', 'Boucles', 4, 3, 'UE', 25, 60, 70, 4.5, 'constant', 'creoles acier'),
    ('Bague gravée message secret', 'Bagues', 10, 3.5, 'CH', 55, 66, 46, 4.8, 'saint-valentin', 'bague gravee'),
    ('Collier coquillage d’été', 'Colliers', 3, 3, 'CN', 19, 64, 78, 4.2, 'ete', 'collier coquillage'),
  ],
}

# Profils et mots-clés des 39 produits existants (identifiants f01 à f39 inchangés).
EXISTANTS = {
  'f01': ('cadeau', 'lampe coucher de soleil'), 'f02': ('cadeau', 'lampe coucher de soleil'), 'f03': ('hiver', 'humidificateur'),
  'f04': ('noel', 'veilleuse lune'), 'f05': ('hiver', 'plaid coton'), 'f06': ('printemps', 'organiseur tiroir'), 'f07': ('noel', 'bougie bois de cedre'),
  'f08': ('ete', 'fontaine chat'), 'f09': ('hiver', 'panier apaisant chien'), 'f10': ('noel', 'jouet chat'),
  'f11': ('noel', 'chargeur 3 en 1'), 'f12': ('ete', 'support telephone voiture'), 'f13': ('rentree', 'traceur bluetooth'),
  'f14': ('noel', 'masque led'), 'f15': ('cadeau', 'brosse soufflante'), 'f16': ('constant', 'rouleau quartz'),
  'f17': ('constant', 'pistolet de massage'), 'f18': ('bonnes-resolutions', 'tapis yoga liege'),
  'f19': ('printemps', 'vase ceramique'), 'f20': ('constant', 'miroir rotin'), 'f21': ('cadeau', 'cadre photo bois'), 'f22': ('noel', 'guirlande lumineuse'),
  'f23': ('hiver', 'echarpe merinos'), 'f24': ('ete', 'sac banane'), 'f25': ('hiver', 'chaussettes coton bio'), 'f26': ('ete', 'casquette brodee'),
  'f27': ('hiver', 'coffret the'), 'f28': ('hiver', 'miel de montagne'), 'f29': ('noel', 'coffret epices'), 'f30': ('constant', 'huile d olive'),
  'f31': ('saint-valentin', 'bague argent'), 'f32': ('cadeau', 'collier perle'), 'f33': ('ete', 'creoles dorees'), 'f34': ('cadeau', 'bracelet jonc grave'),
  'f35': ('ete', 'gourde isotherme'), 'f36': ('bonnes-resolutions', 'bandes de resistance'), 'f37': ('constant', 'griffoir chat'),
  'f38': ('rentree', 'lampe de bureau'), 'f39': ('bonnes-resolutions', 'serum vitamine c'),
}

def main():
    chemin_json = os.path.join(RACINE, 'server', 'data', 'catalogue-demo.json')
    base = json.load(open(chemin_json, encoding='utf-8'))
    base = [p for p in base if int(p['id'][1:]) <= 39]
    # Les champs tendance, concurrence et note des 39 premiers viennent de l'interface historique (js/dropshipping.js).
    for p in base:
        prof, mots = EXISTANTS[p['id']]
        p['profil'], p['mots'] = prof, mots
    n = 40
    for niche, liste in NOUVEAUX.items():
        for i, (nom, cat, cout, port, ent, prix, tend, conc, note, prof, mots) in enumerate(liste):
            fournisseurs = F[ent]
            dmin, dmax = DELAIS[ent]
            base.append({'id': f'f{n:03d}' if n >= 100 else f'f{n}', 'nom': nom, 'niche': niche, 'categorie': cat, 'cout': cout, 'portF': port,
                         'entrepot': ent, 'delai': [dmin + (i % 2), dmax + (i % 3 == 0)], 'prix': prix, 'fournisseur': fournisseurs[(i + n) % len(fournisseurs)],
                         'tendance': tend, 'concurrence': conc, 'note': note, 'profil': prof, 'mots': mots})
            n += 1
    with open(chemin_json, 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join('  ' + json.dumps(p, ensure_ascii=False, separators=(', ', ': ')) for p in base) + '\n]\n')
    with open(os.path.join(RACINE, 'js', 'catalogue.js'), 'w', encoding='utf-8') as f:
        f.write('/* Catalogue fournisseurs de démonstration et profils saisonniers.\n   Fichier généré par outils/catalogue/generer.py : ne pas modifier à la main. */\n')
        f.write('const PROFILS_SAISON = ' + json.dumps(PROFILS, ensure_ascii=False) + ';\n')
        f.write('const CATALOGUE_EXTRA = ' + json.dumps({p['id']: {k: p[k] for k in ('profil', 'mots')} for p in base}, ensure_ascii=False) + ';\n')
        f.write('const CATALOGUE_NOUVEAUX = ' + json.dumps([p for p in base if int(p['id'][1:]) >= 40], ensure_ascii=False) + ';\n')
        f.write("if (typeof module !== 'undefined') module.exports = { PROFILS_SAISON, CATALOGUE_EXTRA, CATALOGUE_NOUVEAUX };\n")
    print(len(base), 'produits')

if __name__ == '__main__':
    main()
