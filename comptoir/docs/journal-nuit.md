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

### Cycle 1 — Sécurité (0 h 10 – 0 h 20)

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

### Cycle 2 — Accessibilité (0 h 20 – 0 h 25)

Outil ajouté : `outils/simulation/accessibilite.js` (règles WCAG 2.2 AA : étiquettes, noms des boutons, textes alternatifs, éléments cliquables au clavier, focus visible, langue, titres, contrastes calculés), sur les 20 écrans de l'admin, la fiche produit, l'accueil et l'inscription, en clair et en sombre.

**Défauts trouvés et corrigés**

1. **118 textes au contraste insuffisant** (minimum WCAG 4,5:1). Trois couleurs étaient en cause :
   - le gris « discret » des en-têtes de tableaux, sources et fils d'Ariane (3,2:1) passe à 4,9:1 en clair et 5,8:1 en sombre ;
   - les titres de groupes du menu (3,1:1) passent à 5,2:1 ;
   - le texte blanc des boutons bleus en sombre (3,3:1) devient foncé : 6,0:1.
2. **Étoiles des avis** : l'or sur fond blanc (2,3:1) passe à un or foncé lisible. Les étoiles vides sont marquées décoratives, la note étant donnée en toutes lettres. Dans les boutiques, les étoiles prennent la couleur du texte du thème.
3. **Bandeau de saison** : le sous-texte prend la couleur du texte du thème.
4. **QR code de vitrine sans texte alternatif** : ajouté, avec l'adresse de la boutique.
5. **Fond cliquable du panier** : marqué décoratif, la fermeture se faisant par le bouton « Fermer ».
6. **Page d'accueil** : même correction du gris discret.

Contrôles sans défaut : focus clavier visible sur les 25 premiers éléments de chaque écran, aucun champ sans étiquette, aucun bouton sans nom, langue et titre présents.

Faux positifs de l'outil corrigés au passage : étiquettes dans un bloc « Réglages » replié, couleurs au format `color(srgb …)`.

Résultat final de l'audit : aucun problème. Tests : 26.

### Cycle 3 — Volume et performance (0 h 23 – 0 h 25)

Outil ajouté : `outils/simulation/volume.js` : une boutique de 500 produits et 10 000 commandes sur 13 mois (2 500 clients, 10 villes, tous les statuts), puis mesures.

| Mesure | Résultat |
|---|---|
| Rendu de chaque écran (15 écrans) | 2 à 44 ms (Vue d'ensemble 43 ms, Analyse 38 ms, Commandes 12 ms) |
| Chargement de l'application | 0,7 s |
| Recherche dans 10 000 commandes | 52 ms ; export CSV : 30 ms |
| Mémoire JavaScript | 13 Mo |
| Boutique publique sur mobile (500 produits) | 0,2 s |
| Erreurs | aucune |

**Défauts trouvés et corrigés**

1. **6,8 Mo rechargés toutes les 15 secondes.** Pour afficher les nouvelles commandes, l'interface relisait l'état complet en boucle : environ 27 Mo par minute et par onglet ouvert. Une signature légère (`/api/admin/signature`, 0,2 Ko : nombre de commandes, dernière date, répartition des statuts, avis) est maintenant interrogée ; l'état complet n'est relu que si elle change.
2. **Aucune compression des réponses.** Gzip pour le JSON, le HTML, le CSS et le JavaScript au-delà de 1 Ko. L'état de la grande boutique passe de 6,8 Mo à 872 Ko transférés ; `app.js` : 28 Ko.

À surveiller au-delà de 50 000 commandes : charger les commandes par pages côté serveur plutôt qu'en une fois.

Tests : 26.

### Cycle 4 — Calculs (0 h 25 – 0 h 35)

Nouveau test serveur `server/test/calculs.test.js` : 300 paniers aléatoires reproductibles (prix à 0,05 ou à trois décimales, 1 à 4 produits, quantités 1 à 5, paliers 5 % et 12 %, codes en minuscules ou entourés d'espaces, seuil de port, offre complémentaire) envoyés au vrai serveur et comparés au calcul de l'interface.

Résultat : 0 écart au centime sur toutes les commandes créées, aucun montant à plus de 2 décimales.

**Défauts trouvés et corrigés**

1. **TVA des factures recalculée avec le taux du jour.** Si le marchand changeait de régime (non assujetti puis assujetti), toutes ses anciennes factures changeaient de montant HT et de TVA, alors qu'une facture émise ne doit jamais changer. Le taux est désormais figé dans chaque commande (en ligne, caisse, complément après achat) ; la facture l'utilise. Testé.
2. **Prix à trois décimales enregistrés tels quels** (12,345 affiché 12.35, mais les lignes de facture gardaient la fraction). Prix et coûts sont arrondis au centime à l'enregistrement, et aussi à la commande pour les produits déjà enregistrés.
3. **Caisse en Suisse** : le ticket indique le montant à encaisser en espèces, arrondi aux 5 centimes.

Vérifié identique dans les deux calculs : seuil de livraison offerte, modes jamais offerts, remise la plus avantageuse entre palier et code, offres complémentaires.

Tests : 28.

### Cycle 5 — Boutique publique : référencement et partage (0 h 27 – 0 h 40)

**Défaut trouvé et corrigé**

Un moteur de recherche ou un aperçu de lien (WhatsApp, Instagram, Facebook) ne voyait qu'une page vide titrée « Boutique » : le contenu n'était produit que par le JavaScript, et les fiches produits n'avaient pas d'adresse propre (`#produit-…`). Les boutiques étaient donc presque invisibles sur Google et sans aperçu au partage.

Le serveur génère désormais, pour la boutique et pour chaque produit :
- le titre, la description, l'adresse de référence et la langue du pays ;
- les balises de partage (titre, description, image du produit servie en fichier, prix et devise) ;
- les données structurées schema.org (`OnlineStore`, et `Product` avec prix, devise et disponibilité) ;
- une version lisible sans JavaScript (liste des produits avec liens) ;
- un plan du site (`/s/<boutique>/sitemap.xml`, ou `/sitemap.xml` sur un domaine personnalisé) et un `robots.txt`.

Les fiches ont une vraie adresse, `/s/<boutique>/p/<produit>` (ou `/p/<produit>` sur un domaine personnalisé) :
- le titre de l'onglet suit le produit ouvert ;
- le bouton retour du navigateur ferme la fiche, le bouton suivant la rouvre ;
- l'adresse ouvre la fiche directement.

Les anciens liens `#produit-` restent reconnus. Une boutique non payée, ou un produit inexistant, est marqué « ne pas indexer ».

Vérifié :
- sur iPhone : ouverture d'une fiche, rechargement, retour arrière, retour avant, Échap, panier, sans aucune erreur ;
- les pièges XSS ne s'exécutent pas non plus dans les balises générées (noms échappés) ;
- nouveau test serveur.

Tests : 29.

### Cycle 6 — E-mails (0 h 35 – 0 h 55)

Chaque type d'e-mail a été déclenché sur un serveur de test et relu.

**Défauts trouvés et corrigés**

1. **Aucune désinscription possible** sur les e-mails commerciaux (bienvenue avec code, reconquête), obligatoire en Suisse (LCD art. 3 al. 1 let. o) comme dans l'UE.
   - Chaque e-mail commercial porte un lien personnel signé (HMAC) et l'en-tête `List-Unsubscribe` (désinscription en un clic dans Gmail et Outlook).
   - La page demande une confirmation : les logiciels qui ouvrent les liens tout seuls ne désinscrivent personne.
   - Une adresse désinscrite ne reçoit plus aucun e-mail commercial de la boutique et sort des abonnés. Une nouvelle inscription volontaire rétablit l'envoi.
2. **Aucune identité de l'expéditeur dans les e-mails.** Tous les e-mails d'une boutique se terminent par sa raison sociale, son adresse et son contact (Impressum).
3. **Bug latent dans l'e-mail de bienvenue** : `const base = urlBoutique || \`${base}\`` faisait référence à la variable en cours de définition et plantait sans adresse de boutique.
4. **Confirmation de commande trop maigre** (un total, rien d'autre). Elle contient maintenant :
   - le détail des articles, la remise et la livraison ;
   - le lien personnel de suivi de la commande ;
   - le contact de la boutique.
5. **Expédition sans lien de suivi** : lien direct chez le transporteur (La Poste suisse, Colissimo, Chronopost, Mondial Relay) et lien vers la commande. Retrait en magasin : horaires et numéro à présenter.
6. **« Répondez à cet e-mail » renvoyait vers l'adresse d'envoi de Comptoir** : `Reply-To` vers l'e-mail du marchand, chez Brevo et chez Postmark.
7. **Le marchand ne recevait aucun e-mail sur son abonnement.** Il est désormais prévenu :
   - à l'activation, avec le lien de sa boutique et la date de renouvellement ;
   - quand un paiement échoue (boutique fermée tant que ce n'est pas réglé) ;
   - à la résiliation, avec la date de fin d'accès ;
   - à la fin de l'abonnement.
8. Libellé « click & collect » restant côté serveur remplacé par « Retrait en boutique ».

Vérifié : e-mails toujours en texte brut, sans HTML ; balises saisies inoffensives.

Tests : 32, dont 3 nouveaux (désinscription et pied légal, Brevo, Postmark).

### Cycle 7 — Pannes, réseau lent et doubles clics

Outil ajouté : `outils/simulation/pannes.js` : 1,5 s de latence sur chaque appel, doubles clics sur les boutons sensibles, puis serveur injoignable pendant l'utilisation et retour du serveur.

Sans problème dès le départ :
- inscription en double clic : un seul compte, pas de faux message « compte existe déjà » ;
- paiement de l'abonnement ;
- import du catalogue (déjà dédoublonné par le serveur) ;
- « Payer » en boutique (bouton désactivé pendant l'envoi) ;
- message d'erreur quand une action échoue hors ligne.

**Défauts trouvés et corrigés**

1. **Double clic sur « Encaisser » : la vente était enregistrée deux fois** (caisse, stock et comptabilité faussés).
   - Interface : verrou sur les actions qui écrivent (encaisser, importer, changer un statut, supprimer, recréer).
   - Serveur : chaque ticket porte une clé unique, et la même clé ne crée qu'une vente, même envoyée deux fois en parallèle (testé).
2. **Double clic sur « Enregistrer » un produit : le produit était créé deux fois.** Formulaire verrouillé pendant l'envoi.
3. **Modification perdue pendant une coupure.** L'échec était signalé, puis plus rien n'était tenté. Désormais :
   - nouvel essai automatique après 5 s, 15 s, puis 30 s ;
   - renvoi immédiat dès que le serveur répond de nouveau (n'importe quelle requête réussie) ou que le réseau revient ;
   - message « Connexion rétablie : vos modifications sont enregistrées » ;
   - avertissement du navigateur si l'on ferme la page avec une modification en attente.

Résultat final de l'outil : aucun problème. Tests : 33.

### Cycle 8 — Boutique sur petits téléphones (320 et 360 px)

Parcours regardé capture par capture : accueil, fiche produit, panier, formulaire, sur iPhone SE (320 px) et petit Android (360 px).

**Défauts trouvés et corrigés**

1. **Zoom automatique sur iPhone à chaque champ touché** : tous les champs (boutique, panier, inscription) faisaient 13 px, et Safari zoome sous 16 px, au moment même où le client tape son adresse. Champs à 16 px sur les écrans tactiles et étroits.
2. **Panier plus large que l'écran** (369 px de contenu sur 320 et 360 px) : la grille du tiroir prenait la largeur de son élément le plus large. Contenue à l'écran, code promo et modes de livraison compris.
3. **Boutique illisible avec une configuration sans thème** : le serveur remplaçait chaque couleur manquante par le même gris `#333333`, texte compris (gris sur gris). Les couleurs manquantes viennent désormais d'un thème lisible par défaut.
4. **Bouton vide sous le titre** quand le bandeau principal n'a pas de texte de bouton ; même chose pour une annonce ou un texte « À propos » vides. Ces éléments ne s'affichent plus (dans l'éditeur, une annonce vide le signale).

Tests : 33.
