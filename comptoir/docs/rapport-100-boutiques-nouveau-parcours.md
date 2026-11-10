# Rapport : 100 boutiques avec le nouveau parcours (achat avant accès)

Date : 10 novembre 2026. Simulation réelle dans un vrai navigateur (Chromium), sur un serveur Comptoir neuf avec une base vide : 100 clients achètent leur boutique de dropshipping depuis la page d'accueil, puis un acheteur commande sur chaque boutique. Durée : 22 minutes.

## Le parcours testé pour chaque client

1. **Page d'accueil** : clic sur une formule (Lancement, Croissance ou Pro, un tiers chacune).
2. **Inscription** : la formule choisie doit être rappelée ; nom, niche, modèle, pays, e-mail, mot de passe.
3. **Avant le paiement** : l'espace doit être fermé (402) et la boutique invisible pour les clients (404) ; la formule de la page d'accueil doit être présélectionnée ; pas de badge « Démo ».
4. **Paiement de l'abonnement** : montant vérifié selon la formule et le pays (CHF 29.– / 59.– / 119.–, ou 29 / 59 / 119 €). **10 clients annulent d'abord**, puis reviennent et paient.
5. **Accès à son espace**, puis selon le niveau (simple, standard, avancé, très complexe, 25 chacun) : import de produits, édition de produits, éditeur du site, codes promo, offres, réseaux sociaux, tests publicitaires, campagne du copilote, domaine, conformité.
6. **Produits stars** : au moins 5 produits pour la niche, scores entre 0 et 100, ordre décroissant, explications présentes, niche de la boutique présélectionnée, pas d'entrepôt Chine par défaut en Suisse, import en un clic.
7. **Paramètres > Abonnement** : formule payée affichée, statut « Actif ».
8. **Tour des 19 écrans** à la recherche d'erreurs, de textes techniques et de défilement horizontal, sur 5 tailles d'écran, dont un tiers en sombre.
9. **Achat par un client** sur un autre appareil, paiement, puis côté marchand : transmission au fournisseur, expédition avec suivi, facture et total identique.
10. **Isolation** : chaque marchand tente de modifier, supprimer ou annuler le produit et la commande d'un autre marchand (4 tentatives × 99 marchands).
11. **Résiliation** pour 12 boutiques : l'accès doit rester ouvert jusqu'à la fin du mois payé.

## Résultats

| Contrôle | Résultat |
|---|---|
| Achats de boutique depuis la page d'accueil | **100 / 100** (34 Lancement, 33 Croissance, 33 Pro ; 70 en CHF, 30 en EUR) |
| Espace fermé et boutique invisible avant le paiement | **100 / 100** |
| Paiement annulé puis repris | **10 / 10** : message d'annulation, espace toujours fermé, paiement repris ensuite |
| Montant de l'abonnement selon la formule et le pays | **100 / 100** corrects |
| Abonnements actifs en base après le test | **100**, dont 12 avec résiliation programmée (accès conservé) |
| Produits stars cohérents et importables | **100 / 100** |
| Écrans d'administration sans erreur | **1 900 affichages** (100 × 19), aucune erreur JavaScript ni texte technique |
| Commandes clients payées, transmises et expédiées avec suivi | **100 / 100**, factures sans trou, 200 e-mails (confirmation et « en route ») |
| Tentatives sur les données d'un autre marchand | **396 / 396 refusées**, aucune donnée étrangère visible |

**Aucune anomalie dans le parcours.**

## Ce qui n'allait pas, et ce qui a été modifié

| # | Problème constaté | Modification |
|---|---|---|
| 1 | **Ventes Comptoir absentes des Produits stars pendant le test.** La collecte des signaux tournait au démarrage puis toutes les 6 heures : au premier passage, aucune vente n'existait encore, et les 100 commandes suivantes n'ont été prises en compte par aucun classement. En vérifiant après coup, la même collecte trouvait 52 produits vendus par au moins 2 boutiques (dont l'humidificateur, l'écharpe en mérinos et le panier pour chien, vendus chacun par 8 à 9 boutiques). | Les ventes observées sur Comptoir (calcul local, sans coût) sont recalculées **toutes les 15 minutes et à chaque consultation** si elles datent de plus de 15 minutes. Google Trends reste à 6 heures (requêtes payantes). Nouveau test : une vente faite après une première consultation apparaît à la suivante. Vérifié sur un nouvel essai de 15 boutiques : signal alimenté pendant le parcours. |

## Constats attendus, laissés tels quels

- **Produits sans photo (100 boutiques)** : le catalogue de démonstration n'a pas de photos ; un vrai fournisseur les fournit par son API. La Vue d'ensemble le rappelle au marchand.
- **Adresse légale absente (25 boutiques, niveau « simple »)** : ces clients n'ont rien rempli. La Vue d'ensemble affiche « Indiquer l'adresse de l'entreprise (obligatoire pour vendre en ligne) ».
- **Faux positif corrigé dans le simulateur** : une boutique « très complexe » avait elle-même coché l'entrepôt Chine dans « Trouver des produits », et Produits stars reprend ce choix. Ce n'est pas un défaut.

## Limites honnêtes

- Paiements (abonnement et commandes), e-mails, réseaux sociaux et fournisseur sont simulés : aucun appel à Stripe, Brevo ou à un vrai fournisseur.
- Google Trends n'a pas été interrogé (pas de clé SerpApi dans le test) ; son connecteur est vérifié par un test avec une réponse simulée.
- Un script vérifie le fonctionnement et la cohérence, pas le ressenti d'un vrai client.

## Relancer

```
cd comptoir/server && DEMO_DELAI_EXPEDITION_MS=3000 LIMITE_ESSAIS=1000 BASE_DE_DONNEES=/tmp/sim.db npm start
node ../outils/simulation/boutiques-drop.js http://localhost:3000 /tmp/captures 100 > drop.json   # nécessite Playwright
node ../outils/simulation/resume.js ./drop.json
node ../outils/simulation/audit-boutiques.js http://localhost:3000 /tmp/sim.db
```
