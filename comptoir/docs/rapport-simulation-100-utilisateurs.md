# Rapport : 100 utilisateurs simulés sur Comptoir

Date : 10 novembre 2026. Simulation réelle (pas un jeu de rôle) : des scripts automatisés ont joué 100 personnes différentes sur un vrai serveur Comptoir, en deux couches.

- **Couche serveur (API)** : 40 marchands et 60 acheteurs, avec des saisies volontairement piégées (prix négatif ou texte, nom vide ou de 300 caractères, image piégée, code promo en minuscules, quantité négative, produit inexistant, e-mail invalide, mode de livraison inventé, prix modifié par le navigateur, tentative d'activer un domaine sans DNS, remise de 95 %).
- **Couche navigateur (Chromium)** : 40 marchands passent par le vrai formulaire d'inscription, parcourent les 19 écrans dans un ordre différent, ajoutent un produit, créent un code promo, modifient et publient le site, génèrent un planning de réseaux sociaux, ouvrent les 9 sections des Paramètres, utilisent la recherche Ctrl+K et rechargent la page. 60 acheteurs visitent les boutiques créées, utilisent la navigation, ouvrent la fiche produit, choisissent une quantité, remplissent le formulaire, changent de livraison, appliquent un code, paient, annulent ou abandonnent.
- **Écrans** : ordinateur 1440 px, portable 1280 px, tablette 820 px, iPhone 13, petit Android 360 px, en clair et en sombre.
- **Contrôles automatiques** : erreurs JavaScript, erreurs console, erreurs serveur 5xx, statuts inattendus, totaux incohérents, textes « undefined / NaN / [object Object] », défilement horizontal, fuite de données, saisies perdues.

Les scripts sont dans `outils/simulation/` (relançables à chaque évolution).

## Ce qui fonctionne bien

| Domaine | Résultat |
|---|---|
| Inscription | 40 / 40 par le formulaire (noms accentués, apostrophes, émoji, `<b>`, `<script>`) ; le code n'est jamais interprété. Nom de plus de 80 caractères : refusé avec un message clair. |
| Validation des produits | 38 / 38 : prix négatif, texte, supérieur à 100 000, nom vide ou trop long, stock négatif, image piégée refusés ; prix décimaux et prix barrés acceptés. |
| Sécurité | Prix envoyé par le navigateur ignoré, coût fournisseur jamais visible publiquement, commande illisible sans son jeton, domaine impossible à activer sans vérification DNS, remise plafonnée, mauvais mot de passe refusé, connexion avec l'e-mail en majuscules acceptée. |
| Écrans | 40 marchands × 19 écrans × 5 tailles d'écran : aucune erreur JavaScript, aucun texte technique visible. |
| Actions marchand | Ajout de produit, code promo, édition et publication du site, Paramètres, persistance après rechargement : 40 / 40. Recherche Ctrl+K : 24 / 24 (sur ordinateur et tablette). |
| Achat | 46 commandes payées, 4 paiements annulés avec un message clair, 10 paniers abandonnés puis repris ; codes faux refusés ; numérotation des factures continue chez tous les marchands. |
| Newsletter | Double inscription (même e-mail, casse différente) sans doublon ni erreur. |

## Ce qui n'allait pas, et ce qui a été modifié

| # | Problème constaté | Gravité | Modification |
|---|---|---|---|
| 1 | **Panier : les saisies s'effaçaient.** Chez les 60 acheteurs, nom, e-mail et adresse disparaissaient dès qu'on changeait de mode de livraison ou qu'on appliquait un code promo (le panier se redessine entièrement). | Haute : cause directe d'abandon de panier | `js/boutique-client.js` : la saisie, le champ actif, la position du curseur et le défilement du panier sont conservés à chaque mise à jour. Même correction dans l'aperçu de boutique de l'admin (`rendreEnGardantSaisie` dans `js/app.js`). Vérifié : 0 cas sur 60 après correction. |
| 2 | **Réglages perdus sans prévenir.** En mode connecté, le rechargement automatique (toutes les 15 s, pour afficher les nouvelles commandes) écrasait une modification faite moins de 0,6 s avant, pas encore enregistrée. Le cas observé : un compte Instagram connecté juste avant redevenait « déconnecté ». | Haute : perte de données silencieuse | `js/serveur.js` : toute modification en attente est envoyée avant chaque rechargement ; un rechargement qui croise une modification est ignoré ; une modification faite juste avant de fermer l'onglet est envoyée quand même. Vérifié : 40 / 40 plannings générés après correction (0 avant). |
| 3 | **Réseaux sociaux : « Générer » ne faisait rien** pour un nouveau marchand, hormis un message bref (aucun réseau connecté). | Moyenne | `js/social.js` : bouton désactivé tant qu'aucun réseau n'est connecté, avec une explication, et le calendrier vide indique la première étape à faire. |
| 4 | **Ville non remplie depuis le NPA** pour Genève (1201), Sion (1950), Zurich (8001)… Seules quelques localités étaient connues, et 1009 donnait Lausanne au lieu de Pully. | Moyenne | `js/boutique-client.js` : environ 130 localités suisses ; la plage la plus précise l'emporte. |
| 5 | **Confirmation de commande pauvre** sur mobile : pas de date de livraison, pas d'étapes, pas de retour à la boutique. | Moyenne | Confirmation enrichie : « Merci Léa ! », barre d'étapes (reçue, préparation, expédiée, livrée), date de livraison estimée ou disponibilité au point de retrait, frais de port, bouton « Continuer mes achats ». Le serveur renvoie le mode de livraison, la ville et le prénom (`/api/public/:slug/commandes/:id`, protégé par le jeton). |
| 6 | **Défilement horizontal intermittent sur tablette** (menu horizontal qui dépassait de l'écran, 3 cas sur 8 tablettes). | Basse | Menu contenu dans sa barre, onglet actif centré sans faire défiler la page, garde-fou `overflow-x: clip` sur la page. |
| 7 | **Onglets de filtres trop larges** sur petit Android (page Produits, 429 px pour 360 px). | Basse | Les contrôles segmentés défilent horizontalement au lieu de pousser la page. |

## Limites honnêtes de cette simulation

- Les paiements sont en **mode simulé** : Stripe, TWINT et les vrais e-mails (Brevo, Postmark) ne sont pas appelés.
- Les « clients » sont des scripts : ils détectent les erreurs, les pertes de données et les problèmes d'affichage mesurables, pas le ressenti (clarté des textes, confiance). Pour cela, il faut des tests avec de vraies personnes (5 marchands suffisent à trouver la plupart des problèmes d'usage).
- Les réseaux sociaux et les fournisseurs sont simulés (API officielles non branchées).
- La simulation a tourné sur le serveur local : la base `server/donnees/comptoir.db` (ignorée par git) contient désormais les comptes de test, et peut être supprimée sans risque.

## Relancer la simulation

```
cd comptoir/server && npm start            # dans un premier terminal (LIMITE_ESSAIS=1000 pour lever la limite de connexion)
node ../outils/simulation/api.js http://localhost:3000 > api.json && node ../outils/simulation/resume.js ./api.json
node ../outils/simulation/navigateur.js http://localhost:3000 > nav.json && node ../outils/simulation/resume.js ./nav.json   # nécessite Playwright
```
