# Comptoir : créateur de boutiques en ligne (démo)

Prototype d'une plateforme pour créer une boutique en ligne de A à Z, la modifier ensuite et la gérer au quotidien. Point de départ : **le dropshipping en Suisse (Lausanne)**, avec la possibilité de tout faire ensuite (produits à soi, marchés, magasin). Le mode France reste disponible.

Deux démos sont incluses : **Lacustre**, une boutique de dropshipping à Lausanne (par défaut, en CHF), et **Maison Brume**, un artisan à Lyon (en euros). On passe de l'une à l'autre depuis « Créer une nouvelle boutique ».

## Lancer

**Version réelle (serveur)** : `cd comptoir && npm start`, puis ouvrir http://localhost:3000. On y crée un compte et une boutique publique (`/s/<nom>`). Les commandes, paiements (TWINT/cartes via Stripe, ou simulation), fournisseurs et factures sont gérés en base. Il faut Node 22.13 ou plus récent ; rien d'autre à installer. Détails dans [`server/README.md`](server/README.md).

**Démo sans serveur** : ouvrir `comptoir/index.html` dans un navigateur. Les données restent dans le navigateur (localStorage). Le bouton « Réinitialiser la démo » remet la boutique d'exemple.

## Ce que fait la démo

| Écran | Fonctions |
|---|---|
| **Créer une boutique** (`#creer`) | Assistant en 3 étapes : activité (nom, secteur, pays), style (4 thèmes), domaine suggéré. Génère le site, les sections et 6 produits d'exemple. |
| **Éditeur du site** (`#editeur`) | Aperçu en direct ordinateur / mobile. Clic sur une section pour la modifier ; ajout, suppression et réordonnancement de 10 types de sections ; couleurs, police, arrondis ; nom et secteur. Bouton « Publier ». |
| **Domaines** (`#domaines`) | Suggestions notées selon la demande du marché, ce que les clients achètent (90 jours de ventes), la saison (Black Friday, Noël, fête des mères…) et la qualité du nom. Domaine principal + domaine de campagne saisonnier. On peut simuler un autre mois. |
| **Tableau de bord** (`#tableau`) | CA, commandes, panier moyen, conversion sur 30 jours, CA par jour, conseil de saison, tâches (commandes à expédier, stock bas…). |
| **Commandes** (`#commandes`) | Filtres par statut, recherche, fiche commande, flux de statuts (en attente → à préparer → en préparation → expédiée → livrée → remboursée / annulée), numéro de suivi, historique, note interne. |
| **Produits / Clients** | Ajout et modification de produits (prix, stock, catégorie, visibilité), liste des clients avec total dépensé. |
| **Trouver des produits** (`#sourcing`) | Catalogue de fournisseurs (entrepôts Suisse, Europe, Chine) classé par potentiel : marge nette réelle (TVA, port, TVA d'import et dédouanement, frais de paiement, pub), tendance de saison, concurrence, délai. Import en un clic. |
| **Copilote de saison** (`#copilote`) | Les vraies dates des prochains temps forts (Black Friday, Noël, soldes, fête des mères…). Pour chacun, une campagne prête calculée sur les ventes : produits à pousser, prévision et alertes de stock, bannière, code promo, e-mail, post Instagram, domaine et planning. Validation en un clic. Bilan du dernier temps fort. |
| **Magasin** (`#magasin`) | Caisse au comptoir avec stock unique site + boutique, retraits click & collect, QR code de vitrine, fiche Google synchronisée (simulée). |
| **Conformité** (`#conformite`) | Fiche entreprise, factures numérotées en continu (TVA 20 % ou franchise en base), CGV et mentions légales générées, points de contrôle (médiateur, RGPD, facture électronique). |
| **Offre** (`#offre`) | Formules et tarifs, ce qui distingue Comptoir. |
| **Voir la boutique** (`#boutique`) | La boutique côté client : bandeau cookies, panier, choix Colissimo / Mondial Relay / Chronopost / retrait en boutique, paiement simulé. La commande et sa facture arrivent dans l'admin. |

Dropshipping : transmission automatique des commandes au fournisseur, statut « chez le fournisseur », bénéfice par commande et sur 30 jours, marge nette et seuil de rentabilité publicitaire (ROAS) sur chaque fiche, délais affichés au client, date limite de commande avant Noël.

Suisse : CHF, TWINT, La Poste (Economy, Priority, PickPost), Impressum, protection des données (nLPD), TVA à 8,1 % ou non-assujetti avec suivi du seuil de CHF 100 000, calendrier suisse (Singles Day, fête des mères le 2e dimanche de mai, 1er Août…), boutique en FR/DE/IT (traduction simulée).

Autres fonctions : ajout de produits **par photo** (fiches créées automatiquement), rédaction de description, étiquettes d'envoi, session d'accompagnement à réserver.

La stratégie (cible, différenciation, prix, conquête, feuille de route) est dans [`STRATEGIE.md`](STRATEGIE.md).

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

1. ~~Back-end et base de données~~ : **fait**. Voir `server/` (comptes, boutiques, commandes, paiements, fournisseurs, webhooks, 11 tests).
2. ~~Paiement TWINT et cartes~~ : **fait** via Stripe Checkout. Il reste à ouvrir le compte Stripe et à configurer les clés. Pour encaisser au nom de chaque marchand, il faudra passer à Stripe Connect.
3. **Domaines** : API d'un registrar (OVH, Gandi ou Namecheap) pour vérifier la disponibilité, réserver et configurer le DNS ; certificats HTTPS automatiques.
4. **Données de demande** : Google Trends / Keyword Planner, Search Console, historique réel de ventes.
5. **Hébergement des boutiques** : rendu des pages à partir du JSON des sections (le même que l'éditeur), servi derrière un CDN.
6. **E-mails transactionnels et expédition** : confirmation, suivi Colissimo / Mondial Relay, étiquettes.
