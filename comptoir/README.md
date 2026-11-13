# Comptoir : créateur de boutiques en ligne (démo)

Prototype d'une plateforme pour créer une boutique en ligne de A à Z, la modifier ensuite et la gérer au quotidien. Point de départ : **le dropshipping en Suisse (Lausanne)**, avec la possibilité de tout faire ensuite (produits à soi, marchés, magasin). Le mode France reste disponible.

Deux démos sont incluses : **Lacustre**, une boutique de dropshipping à Lausanne (par défaut, en CHF), et **Maison Brume**, un artisan à Lyon (en euros). On passe de l'une à l'autre depuis « Créer une nouvelle boutique ».

## Lancer

**Version réelle (serveur)** : `cd comptoir && npm start`, puis ouvrir http://localhost:3000. On y crée un compte et une boutique publique (`/s/<nom>`). Les commandes, paiements (TWINT/cartes via Stripe, ou simulation), fournisseurs et factures sont gérés en base. Il faut Node 22.13 ou plus récent ; rien d'autre à installer. Détails dans [`server/README.md`](server/README.md). API publique et webhooks pour les intégrations : [`docs/API.md`](docs/API.md).

**Tout vérifier d'un coup** : `npm run verifier` enchaîne les tests automatiques, le parcours de bout en bout, les deux audits au clavier (boutique et espace marchand), la simulation de 60 jours sur 100 marchands, un fuzzing HTTP de toutes les routes et un test de charge réduit, puis affiche un bilan. Compter une dizaine de minutes. `npm run verifier -- --rapide` s'arrête après le parcours de bout en bout. Les étapes qui ouvrent un navigateur (bout en bout, clavier) demandent Playwright ; sans lui, elles sont sautées et signalées.

**Site public** : avec le serveur, `/` affiche la page d'accueil commerciale (`accueil.html`) avec les formules. Le client choisit sa formule, crée son compte, paie l'abonnement, puis accède à `/app` : son site, ses modifications, ses commandes et son tableau de bord, uniquement les siens. `/demo` montre une boutique fictive, sans accès à aucun compte.

**Démo sans serveur** : ouvrir `comptoir/index.html` dans un navigateur. Les données restent dans le navigateur (localStorage). Le bouton « Réinitialiser la démo » remet la boutique d'exemple.

## Ce que fait la démo

| Écran | Fonctions |
|---|---|
| **Créer une boutique** (`#creer`) | Assistant en 3 étapes : activité (nom, secteur, pays), style (4 thèmes), domaine suggéré. Génère le site, les sections et 6 produits d'exemple. |
| **Éditeur du site** (`#editeur`) | Aperçu en direct ordinateur / mobile. Clic sur une section pour la modifier ; ajout, suppression et réordonnancement de 10 types de sections ; couleurs, police, arrondis ; nom et secteur. Bouton « Publier ». |
| **Domaines** (`#domaines`) | Suggestions notées selon la demande du marché, ce que les clients achètent (90 jours de ventes), la saison (Black Friday, Noël, fête des mères…) et la qualité du nom. Domaine principal + domaine de campagne saisonnier. On peut simuler un autre mois. |
| **Tableau de bord** (`#tableau`) | CA, commandes, panier moyen, conversion sur 30 jours, CA par jour, conseil de saison, tâches (commandes à expédier, stock bas…). |
| **Commandes** (`#commandes`) | Onglets par statut avec compteurs, recherche, filtres par période et par canal, pagination (50 par page), sélection multiple et actions groupées (changement de statut, bons de préparation imprimables, export CSV), fiche commande, flux de statuts (en attente → à préparer → en préparation → expédiée → livrée → remboursée / annulée), numéro de suivi, historique, note interne. |
| **Produits** (`#produits`) | Recherche, filtres (actifs, stock bas, dropshipping, masqués), duplication, prix barré contrôlé (prix pratiqué 30 jours, OIP / Omnibus). |
| **Clients** (`#clients`) | Segments (meilleurs, fidèles, nouveaux, inactifs, abonnés), recherche, pagination, fiche client avec historique, export CSV. |
| **Paramètres** (`#parametres`) | Général, apparence (clair, sombre, système), état des paiements (Stripe TWINT et cartes ou simulation), livraison, service d'envoi des e-mails et derniers e-mails, domaine, abonnement, export complet JSON, restauration d'une démo, suppression du compte (mode connecté). |
| **Produits stars** (`#stars`) | 148 produits classés pour le pays de la boutique et le mois visé (ce mois, le mois prochain, dans 2 mois) : saison propre à chaque produit, ventes observées sur Comptoir, recherches Google (SerpApi), fichier importé, marge nette, concurrence, délai. Raisons affichées, courbe saisonnière, import en un clic. Mis à jour toutes les 6 heures. |
| **Trouver des produits** (`#sourcing`) | Catalogue de fournisseurs (entrepôts Suisse, Europe, Chine) classé par potentiel : marge nette réelle (TVA, port, TVA d'import et dédouanement, frais de paiement, pub), tendance de saison, concurrence, délai. Import en un clic. |
| **Analyse** (`#analyse`) | 5 onglets sur 7 jours, 30 jours, 90 jours ou 12 mois, comparés à la période précédente, avec filtre par canal et export CSV. Ventes : chiffres clés et mini-courbes, courbe comparée, carte des heures d'achat, livraison, villes, constats automatiques. Produits : classement, part, évolution, marge, tendance. Clients : nouveaux et revenus, taux de réachat, valeur client, rétention par cohorte, montant des paniers. Marketing : entonnoir, réseaux, tests, temps forts. Rentabilité : cascade du chiffre d'affaires au bénéfice, compte de résultat, seuil de TVA. |
| **Réseaux sociaux** (`#social`) | Pilote automatique : calendrier de publications Instagram, TikTok, Facebook, Pinterest généré à partir des produits, ventes, marges et temps forts. Pour chaque publication : accroche des 3 premières secondes, légende, hashtags et script vidéo plan par plan. Validation ou publication automatique, statistiques, et le pilote programme davantage ce qui convertit. Lancement intensif TikTok, micro-influenceurs. |
| **Fournisseurs** (`#fournisseurs`) | Fiche par fournisseur : note, entrepôts, délai annoncé et délai mesuré, commandes transmises, remboursements. Liste de contrôle (échantillon au prix normal, réponse en moins de 24 h, délai tenu, dédouanement prépayé). Signale les entrepôts plus proches ; le serveur y route les commandes. |
| **Tests produits** (`#tests`) | Plans de test (publicités Meta, publicités TikTok, TikTok organique), saisie des résultats du jour, verdict automatique : couper, attendre, garder ou augmenter le budget, selon la marge brute. Objectif de 3 à 5 produits testés par semaine. |
| **Copilote de saison** (`#copilote`) | Les vraies dates des prochains temps forts (Black Friday, Noël, soldes, fête des mères…). Pour chacun, une campagne prête calculée sur les ventes : produits à pousser, prévision et alertes de stock, bannière, code promo, e-mail, post Instagram, domaine et planning. Validation en un clic. Bilan du dernier temps fort. |
| **Magasin et caisse** (`#magasin`) | Caisse au comptoir avec stock unique site + boutique, retraits en magasin, QR code de vitrine, fiche Google synchronisée (simulée). |
| **Conformité** (`#conformite`) | Fiche entreprise, factures numérotées en continu (TVA 20 % ou franchise en base), CGV et mentions légales générées, points de contrôle (médiateur, RGPD, facture électronique). |
| **Offre** (`#offre`) | Formules et tarifs, ce qui distingue Comptoir. |
| **Voir la boutique** (`#boutique`) | La boutique côté client : navigation (collection, à propos, contact), fiche produit (description, délai de livraison en jours ouvrables suisses, avis du produit, quantité, réassurance), bandeau cookies, panier, choix Colissimo / Mondial Relay / Chronopost / retrait en boutique, paiement simulé. La commande et sa facture arrivent dans l'admin. |

Dropshipping : transmission automatique des commandes au fournisseur, statut « chez le fournisseur », bénéfice par commande et sur 30 jours, marge nette et seuil de rentabilité publicitaire (ROAS) sur chaque fiche, délais affichés au client, date limite de commande avant Noël.

Suisse : CHF, TWINT, La Poste (Economy, Priority, PickPost), Impressum, protection des données (nLPD), TVA à 8,1 % ou non-assujetti avec suivi du seuil de CHF 100 000, calendrier suisse (Singles Day, fête des mères le 2e dimanche de mai, 1er Août…), boutique en FR/DE/IT/EN.

Autres fonctions : ajout de produits **par photo** (fiches créées automatiquement), rédaction de description, étiquettes d'envoi, session d'accompagnement à réserver.

La stratégie (cible, différenciation, prix, conquête, feuille de route) est dans [`STRATEGIE.md`](STRATEGIE.md). Les règles de la méthode de lancement (grille produit gagnant, tests, réseaux sociaux), leurs sources et leurs limites sont dans [`METHODE.md`](METHODE.md) ; l'application les résume dans une fenêtre « Sources ».

## Moteur de domaines (`js/domains.js`)

Score sur 100 = 32 % demande + 18 % saison + 18 % brièveté + 14 % mémorisation + 18 % extension.

- **Demande** : volume de recherche des mots-clés du secteur × indice saisonnier du mois, avec un bonus pour les catégories qui pèsent le plus dans vos ventes.
- **Saison** : temps fort commercial du mois et du mois suivant ; génère des domaines de campagne (ex. `black-friday-maison-brume.fr`) à rediriger vers la boutique.
- **Nom** : longueur, tirets, chiffres ; extension adaptée au pays (.fr, .be, .ch, .ca), .com, .shop, etc., avec le prix de renouvellement.

Dans la démo, volumes, disponibilité et prix sont simulés de façon déterministe.

## Structure

```
comptoir/
  index.html           coque de l'application
  css/app.css          admin + thèmes de boutique
  js/data.js           secteurs, saisonnalité, thèmes, sections, boutique d'exemple
  js/domains.js        moteur de suggestion de domaines
  js/copilote.js       calendriers commerciaux France et Suisse, génération des campagnes
  js/graphiques.js     graphiques SVG (courbes, cascade, cartes de chaleur, entonnoir, barres)
  js/analyse.js        module Analyse et export CSV
  js/catalogue.js      catalogue fournisseurs et profils saisonniers (généré par outils/catalogue/generer.py)
  js/tendances.js      moteur des produits stars (navigateur et serveur)
  js/stars.js          écran Produits stars
  js/palette.js        palette de commandes (Ctrl+K) et thème clair/sombre
  js/parametres.js     page Paramètres (paiements, e-mails, abonnement, export, suppression du compte)
  accueil.html         page d'accueil commerciale
  js/social.js         pilote automatique des réseaux sociaux
  js/methode.js        grille produit gagnant, tests produits, micro-influenceurs
  js/dropshipping.js   catalogue fournisseurs, marge nette, transmission des commandes, démo Lausanne
  js/modules.js        copilote, magasin, conformité, photos, offre, fenêtres
  js/storefront.js     rendu de la boutique (aperçu et version client)
  js/app.js            routage, admin, éditeur, commandes, panier
  js/serveur.js        mode connecté : compte, synchronisation avec l'API
  js/boutique-client.js  boutique publique servie par le serveur (/s/<slug>)
  boutique.html        page de la boutique publique
  server/              serveur Node sans dépendance (API, base SQLite, paiements, fournisseurs, tests)
```

## Pour passer en production

1. ~~Back-end et base de données~~ : **fait**. Voir `server/` (comptes, boutiques, commandes, paiements, fournisseurs, webhooks, tests de bout en bout).
2. ~~Paiement TWINT et cartes~~ : **fait** via Stripe Checkout et **Stripe Connect** : chaque marchand encaisse sur son propre compte Stripe, sans commission. Il reste à ouvrir le compte Stripe de la plateforme, activer Connect et configurer les deux webhooks (voir `server/README.md`).
3. **Domaines** : réservation par l'API d'un registrar (OVH, Gandi ou Namecheap) à brancher. La vérification de disponibilité (RDAP) et les certificats HTTPS automatiques (Caddy à la demande) sont faits.
4. **Données de demande** : Google Trends / Keyword Planner, Search Console, historique réel de ventes.
5. **Hébergement des boutiques** : rendu des pages à partir du JSON des sections (le même que l'éditeur), servi derrière un CDN.
6. **Expédition** : suivi Colissimo / Mondial Relay et étiquettes. Les e-mails transactionnels (Brevo ou Postmark) sont faits.
