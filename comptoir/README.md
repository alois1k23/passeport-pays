# Comptoir : créateur de boutiques en ligne (démo)

Prototype d'une plateforme pour créer une boutique en ligne de A à Z, la modifier ensuite et la gérer au quotidien.

## Lancer la démo

Ouvrir `comptoir/index.html` dans un navigateur. Rien à installer : HTML, CSS et JavaScript, sans serveur. Les données sont gardées dans le navigateur (localStorage). Le bouton « Réinitialiser la démo » remet la boutique d'exemple.

## Ce que fait la démo

| Écran | Fonctions |
|---|---|
| **Créer une boutique** (`#creer`) | Assistant en 3 étapes : activité (nom, secteur, pays), style (4 thèmes), domaine suggéré. Génère le site, les sections et 6 produits d'exemple. |
| **Éditeur du site** (`#editeur`) | Aperçu en direct ordinateur / mobile. Clic sur une section pour la modifier ; ajout, suppression et réordonnancement de 10 types de sections ; couleurs, police, arrondis ; nom et secteur. Bouton « Publier ». |
| **Domaines** (`#domaines`) | Suggestions notées selon la demande du marché, ce que les clients achètent (90 jours de ventes), la saison (Black Friday, Noël, fête des mères…) et la qualité du nom. Domaine principal + domaine de campagne saisonnier. On peut simuler un autre mois. |
| **Tableau de bord** (`#tableau`) | CA, commandes, panier moyen, conversion sur 30 jours, CA par jour, conseil de saison, tâches (commandes à expédier, stock bas…). |
| **Commandes** (`#commandes`) | Filtres par statut, recherche, fiche commande, flux de statuts (en attente → à préparer → en préparation → expédiée → livrée → remboursée / annulée), numéro de suivi, historique, note interne. |
| **Produits / Clients** | Ajout et modification de produits (prix, stock, catégorie, visibilité), liste des clients avec total dépensé. |
| **Voir la boutique** (`#boutique`) | La boutique côté client : panier, paiement simulé. La commande arrive dans l'admin. |

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
  js/storefront.js     rendu de la boutique (aperçu et version client)
  js/app.js            routage, admin, éditeur, commandes, panier
```

## Pour passer en production

1. **Back-end + base de données** (ex. Node/NestJS ou Django + PostgreSQL) : comptes marchands, boutiques multi-locataires, produits, commandes, clients.
2. **Paiement** : Stripe Connect (chaque marchand encaisse sur son compte, la plateforme prend une commission).
3. **Domaines** : API d'un registrar (OVH, Gandi ou Namecheap) pour vérifier la disponibilité, réserver et configurer le DNS ; certificats HTTPS automatiques.
4. **Données de demande** : Google Trends / Keyword Planner, Search Console, historique réel de ventes.
5. **Hébergement des boutiques** : rendu des pages à partir du JSON des sections (le même que l'éditeur), servi derrière un CDN.
6. **E-mails transactionnels et expédition** : confirmation, suivi Colissimo / Mondial Relay, étiquettes.
