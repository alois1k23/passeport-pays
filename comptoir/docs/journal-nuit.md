# Journal de la nuit du 10 au 11 novembre 2026

Boucle demandée : tester, analyser et améliorer Comptoir sans relâche jusqu'à 7 h 00 (heure de Lausanne), sans rien laisser passer.
Chaque cycle : un domaine, des tests réels (navigateur, serveur, scripts), les corrections, `npm test`, puis commit et push.

## Domaines prévus

1. Sécurité : XSS stockée, en-têtes HTTP, cookies, fichiers statiques, saisies extrêmes de l'API
2. Accessibilité : étiquettes, clavier, focus, contrastes, rôles
3. Volume et performance : milliers de commandes et de produits
4. Calculs : TVA, marges, remises, arrondis, cohérence navigateur et serveur
5. Boutique publique : référencement (titre, description, partage, sitemap), parcours mobile
6. E-mails : contenu, liens, mentions
7. Résistance aux pannes : serveur indisponible, réseau lent, doubles clics
8. Relecture du code module par module
9. Nouvelle série de 100 boutiques pour valider l'ensemble

## Cycles

### Cycle 1 — Sécurité (0 h 15 – 1 h 00)

Outils ajoutés : `outils/simulation/securite-xss.js` (pièges dans tous les champs d'un marchand et d'un acheteur, exécution vérifiée dans le navigateur) et `outils/simulation/securite-api.js` (requêtes hostiles ou malformées).

| Contrôle | Résultat |
|---|---|
| 8 types de pièges XSS dans le nom, le slogan, les sections, l'entreprise, le magasin, les produits, et dans le nom et l'adresse d'un acheteur | Aucune exécution : boutique, fiche produit, mentions, paiement, confirmation, 15 écrans d'admin, fiche commande, facture, fiche client |
| E-mails | Envoyés en texte brut : une balise reste du texte (pas de faille) |
| Fichiers internes (code, base, .env, .git, remontée de dossiers encodée) | Jamais servis |
| Webhooks sans signature, faux jeton de réinitialisation, session après déconnexion, CSRF par formulaire | Tous refusés |
| Énumération des comptes (connexion, mot de passe oublié) | Réponses identiques |

**Défauts trouvés et corrigés**

1. **Aucun en-tête de sécurité.** Ajout sur toutes les réponses : politique de contenu (scripts du site et de cdnjs seulement, aucun cadre étranger, formulaires vers le site ou Stripe), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS en HTTPS. Vérifié : aucune violation sur 5 parcours complets, QR code et polices chargés.
2. **Erreur 500 sur une inscription mal formée** (thème envoyé comme un nombre). Chaque partie de la configuration, les sections et les produits sont désormais vérifiés comme objets ; une valeur d'un autre type est remplacée.
3. **Requête de plus de 2 Mo : connexion coupée** au lieu d'une réponse. Réponse 413 propre.
4. **Aucune limite de débit sur les routes publiques** : 60 commandes acceptées d'affilée depuis la même adresse (risque d'inondation de fausses commandes et de devinette des codes promo). Limites par adresse et par quart d'heure : 30 commandes, 40 vérifications de code, 20 inscriptions à la newsletter, 20 avis (`LIMITES_FACTEUR` pour les tests de charge).

Tests : 26 (dont 2 nouveaux : saisies malformées et en-têtes, limite de commandes).
