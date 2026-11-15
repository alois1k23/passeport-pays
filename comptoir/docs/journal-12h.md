# Journal du marathon de 12 heures (15 au 16 novembre 2026)

Demande : pendant 12 heures, du 15 novembre 21 h 30 au 16 novembre 9 h 30 (heure de Lausanne), rendre Comptoir mieux et plus complet que les plateformes comparables (Shopify, Wix, WooCommerce, PrestaShop…).

Méthode, la même que pour le marathon de 24 heures (voir `journal-24h.md`). Chaque chantier passe par ces étapes :
1. Implémentation complète, sans rien céder sur la sécurité.
2. Tests automatiques.
3. Parcours de bout en bout, vérification de l'interface dans un vrai navigateur (bureau et mobile), et simulation de 60 jours si le chantier touche les commandes.
4. Relecture indépendante, puis correction de chaque constat.
5. Note dans ce journal, commit et push.

Une relance automatique reprend le travail toutes les heures ; un rapport final est prévu le 16 novembre à 9 h 25.

## Point de départ

Comptoir couvre déjà beaucoup de choses : boutique en quatre langues, variantes, caisse, TWINT et QR-facture, cartes cadeaux, fidélité, devis, retours partiels, codes promo, stock multi-emplacements, API et webhooks, factures électroniques, chiffrement des données des clients, sécurité des comptes très poussée.

Ce qui manquait encore face aux plateformes comparables, d'après une recherche dans le code le 15 novembre à 21 h 30 :

- aucun moyen d'importer un catalogue existant depuis Shopify, WooCommerce ou PrestaShop : changer de plateforme demandait de tout ressaisir ;
- pas de produits numériques (fichiers à télécharger après l'achat) ;
- pas de précommandes ;
- pas de lots ni de coffrets composés d'autres produits ;
- pas de tarifs pour les clients professionnels ;
- pas de blog ni de pages de contenu.

## Feuille de route

Ordre de priorité : ce qui fait venir un marchand d'une autre plateforme, puis ce qui lui fait vendre plus.

70. **Import du catalogue** depuis un export CSV de Shopify, WooCommerce, PrestaShop ou un tableur simple : détection du format, aperçu ligne par ligne avant l'import, variantes et prix barrés repris, photos récupérées sans ouvrir le réseau interne du serveur, réimport sans doublon.
71. **Produits numériques** : fichier livré après paiement confirmé, lien personnel limité en durée et en nombre de téléchargements, révocable par le marchand.
72. **Précommandes** : vendre un article épuisé ou pas encore sorti, avec date d'expédition annoncée, plafond, et mention sur la facture et dans les e-mails.
73. **Lots et coffrets** : un produit composé de plusieurs autres, qui puise dans leur stock.
74. **Clients professionnels** : comptes pro avec remise, prix hors taxes, paiement sur facture avec plafond.
75. **Blog et pages de contenu** : articles en texte enrichi sûr (sans HTML libre), référencement (plan du site, données structurées).
76. **Comparaison honnête** avec les plateformes comparables, avec ses sources.

## Cycles

### Cycle 1 (21 h 40) : import du catalogue depuis une autre plateforme (chantier 70)

Changer de plateforme demandait jusqu'ici de ressaisir chaque produit à la main ; c'est le premier frein quand un marchand compare. Désormais, dans Produits, « Importer un catalogue » lit l'export CSV de Shopify, WooCommerce, PrestaShop ou d'un simple tableur.

- **Lecture du fichier** (module partagé `js/import-catalogue.js`, utilisé par le serveur et par la démonstration) :
  - CSV selon la norme RFC 4180 : guillemets, retours à la ligne dans un champ, marque BOM, séparateur virgule, point-virgule ou tabulation détecté ;
  - nombres à la suisse, à la française ou à l'anglaise (« 1'290.50 », « 1 290,50 », « CHF 12.– ») ;
  - format reconnu d'après les en-têtes que chaque plateforme écrit dans ses exports.
- **Ce qui est repris** :
  - Shopify : un produit par « Handle », ses variantes (deux options au plus), le prix barré (« Compare At »), le stock, le statut (brouillon importé masqué), la catégorie, la première photo ;
  - WooCommerce : produits simples et variables avec leurs variations rattachées au parent, prix promotionnel (le prix normal devient le prix barré) ;
  - PrestaShop et tableur : une ligne par produit ; le prix TTC est pris de préférence, et un prix hors taxes seul est signalé « à vérifier ».
- **Sécurité** :
  - les descriptions HTML deviennent du texte : balises et scripts retirés, entités décodées, caractères de contrôle et d'inversion du sens d'écriture supprimés ;
  - noms, catégories et options sont bornés, et chaque produit repasse par la validation de la fiche produit ;
  - seules les photos en `https://` sont retenues ; elles sont téléchargées par le serveur avec les protections des webhooks : adresse résolue et vérifiée au moment de la connexion, aucune redirection suivie, 300 Ko au plus, et le contenu doit réellement être un JPEG, un PNG ou un WebP (signature des premiers octets) ;
  - limites : 2 Mo par requête, 20 000 lignes, 2 000 produits par import, 5 000 par boutique, 30 aperçus et 10 imports par heure ;
  - l'import est noté dans le journal du compte.
- **Aperçu avant tout** : format reconnu, nombre de produits à créer et déjà importés, tableau des 50 premiers, lignes ignorées avec leur numéro et leur raison, points à vérifier. Rien n'est écrit avant « Importer ».
- **Sans doublon** : chaque produit garde sa référence d'origine (« shopify:t-shirt-bio »), et un nouvel import du même fichier ne le recrée pas.
- **Limite, notée** : Comptoir garde toutes les combinaisons d'options (3 tailles × 2 couleurs = 6 variantes). Celles qu'un export Shopify n'avait pas sont créées avec un stock de 0, donc affichées épuisées.
- **Démonstration** : l'import marche aussi hors ligne, dans le navigateur, sans les photos.
- **Tests** :
  - lecture CSV et nombres ;
  - un export de chaque plateforme, avec HTML piégé, prix illisibles, types non gérés et variations orphelines ;
  - aperçu sans écriture, import, réimport sans doublon, fichiers refusés ;
  - téléchargement des photos : vraie image acceptée ; faux PNG, image trop lourde, redirection, adresse interne et nom qui pointe vers une adresse interne refusés.
- **Vérifié dans Chromium**, bureau et mobile :
  - aperçu, focus sur « Importer », produits créés ;
  - un nom piégé (`<img onerror>`) reste du texte ;
  - la capture mobile a fait revoir le tableau de l'aperçu (colonnes collées), corrigé.
- 237 tests sur 237, parcours de bout en bout 57/57, fuzzing sans constat.

