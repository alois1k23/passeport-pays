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

### Cycle 9 — Administration sur téléphone

Captures sur 360 px : liste et fiche des commandes, vue d'ensemble, produits stars, caisse, éditeur. Aucune erreur ni défilement horizontal.

**Défauts trouvés et corrigés**

1. **Fiche de commande hors de l'écran** : en ouvrant une commande plus bas dans la liste, la fiche s'affichait au-dessus, hors de vue, et rien ne semblait se passer. La page défile maintenant jusqu'à la fiche (vérifié sur la 13e commande).
2. **Produits stars** : les trois encadrés des sources occupaient un écran entier avant le premier produit ; ils deviennent une rangée compacte sur téléphone.

### Cycle 10 — Formules et promesses commerciales

**Défauts trouvés et corrigés**

1. **Promesses fausses sur les pages de tarifs** : « 3 boutiques, 5 comptes équipe » (un compte n'a qu'une boutique et un utilisateur), « Boutique en FR, DE et IT » (traduction seulement simulée), « Domaine .ch offert la 1re année » (achat de domaine non disponible). Retirées partout. Les formules n'annoncent plus que ce qui existe.
2. **Trois listes de formules différentes** (page d'accueil, page « Offre et tarifs », écran de paiement). Pour la France et la Belgique, l'application affichait même d'autres formules (Atelier 19 €, Commerce 39 €, Maison 79 €) que celles réellement facturées (29, 59, 119 €). Une seule définition, `js/formules.js`, partagée par le serveur, l'application et la page de tarifs (alignée).
3. **Aucune différence réelle entre les formules** : un client Lancement avait accès à tout. Désormais :
   - Réseaux sociaux, Copilote, Tests produits et Conversion sont réservés à Croissance ; Magasin et caisse à Pro.
   - Le menu affiche un cadenas, l'écran propose de changer de formule en un clic, et le serveur refuse les routes concernées (403).
   - Vérifié dans le navigateur : passage de Lancement à Croissance, fonctions ouvertes aussitôt. La démo garde tout.
4. **FAQ de la page d'accueil** : « Pour tester, non » alors que l'accès est payant. Corrigé : la démo est libre, l'ouverture d'une boutique demande une formule.

Tests : 33 (refus 403 des fonctions non incluses ajouté).

### Cycle 11 — Relecture complète du serveur (argent, stock, comptes)

Une relecture ligne à ligne du serveur a relevé 18 points ; chacun a été vérifié puis corrigé.

**Argent et commandes**

1. **Paiement encaissé deux fois** : relancer le paiement d'une commande laissait l'ancienne session ouverte. Les anciens paiements sont annulés (et les sessions Stripe expirées).
2. **Commande annulée puis payée** : un paiement arrivant après l'annulation passait la commande en « payée ». Il est maintenant marqué « à rembourser » (remboursement automatique avec Stripe).
3. **Annulation sans remboursement** : une commande payée ne peut plus être « annulée » ; elle passe par « remboursée ».
4. **Stock contrôlé ligne par ligne** : deux lignes du même produit pouvaient dépasser le stock. Le total par produit est vérifié.
5. **Offres illimitées** : une règle « 1 acheté = 1 offert » pouvait s'appliquer sans article payant. Une ligne d'offre par règle, et seulement s'il y a un article normal.
6. **Paiement TWINT différé** (`async_payment_succeeded`) ignoré, et webhook Stripe sans métadonnées en erreur 500 : traités.

**Comptes et abonnements**

7. **Compte supprimé mais toujours prélevé** : la souscription Stripe est résiliée avant la suppression (refus si Stripe ne confirme pas).
8. **Deuxième souscription Stripe** pour un compte impayé : le marchand est envoyé au portail pour régulariser la première.
9. **Domaine revendiqué par un autre marchand** : un domaine qui pointait déjà vers Comptoir pouvait être pris par n'importe quel compte. Il faut désormais un enregistrement TXT `_comptoir.<domaine>` avec le code propre à la boutique (affiché dans Domaines).

**Fournisseur, e-mails, confidentialité**

10. **Commande transmise deux fois au fournisseur** (deux clics, ou clic pendant l'envoi automatique) : verrou par commande.
11. **Commande mixte** : le suivi du fournisseur remplaçait celui du marchand et le client recevait « commande expédiée » alors qu'une partie restait à envoyer. E-mail « une partie est en route », suivi séparé.
12. **File d'e-mails** : deux envois simultanés pouvaient envoyer deux fois le même message. Verrou.
13. **Réinscription forcée** : n'importe qui pouvait réinscrire une adresse désinscrite en tapant l'adresse. Il faut maintenant cliquer dans l'e-mail de confirmation.
14. **Boutique fermée** : sa page HTML listait encore ses produits. Plus rien n'est exposé.
15. **Tendances** : avec 2 boutiques seulement, chacune pouvait déduire les ventes de l'autre. Minimum 3.
16. **Requêtes malformées** (`null`, tableau, nombre au lieu d'un objet) : erreur 500. Refus propre (400).

Tests : 40.

### Cycle 12 — Relecture complète de l'administration et de la boutique

Une relecture de l'interface a relevé 20 défauts. Chacun a été reproduit puis corrigé, et vérifié dans le navigateur (démo et compte réel).

**Graves**

1. **« Essayer 30 jours » effaçait la boutique d'un vrai client** : le bouton de la page Offre menait à l'assistant de création, qui remplaçait sans avertissement tous les produits et le design. En compte réel, il mène maintenant à l'abonnement (« Choisir Croissance »), et l'assistant affiche un avertissement clair ; les boutons de démo inertes ont disparu.
2. **Prix barré jamais enregistré** sur un compte réel (saisi, affiché « licite », puis perdu au rechargement ; impossible aussi de l'effacer). Corrigé et vérifié : 55 enregistré, puis effacé.
3. **« Ajouter par photo » plantait** pour les secteurs Maison, Animaux et Tech (la démo par défaut). Noms proposés pour tous les secteurs.
4. **Script exécuté sur la page Réseaux sociaux** si le nom de la boutique ou d'un produit contenait du HTML. Échappé ; vérifié avec `<img onerror>`.

**Moyens**

5. **Passer de la Suisse à la France gardait les francs suisses** (et les CGV annonçaient des euros). La devise suit le pays ; Paramètres affiche le nom du pays.
6. **« Publier les modifications » trompeur en compte réel** : tout est déjà en ligne à chaque frappe. Remplacé par « Enregistré, en ligne ».
7. **Échap fermait la facture et la commande en même temps**, focus perdu. Une fenêtre à la fois, focus rendu.
8. **« Ajouter une offre » plantait** avec moins de deux produits en ligne : bouton désactivé avec explication.
9. **Calendrier social : erreur JavaScript** quand aucun type de contenu n'est possible. Message clair.
10. **Saisie effacée dans une fenêtre ouverte** (accroche d'une publication) à chaque rafraîchissement automatique. Saisie et focus conservés.
11. **Tab renvoyait au début de la page** après la modification d'un champ (Conformité, Domaines, Conversion). Le focus passe au champ suivant.
12. **Évolution des chiffres inversée** quand la période précédente était négative (bénéfice de −50 à +100 affiché « ▼ 300 % » en rouge).
13. **« Livraison offerte dès CHF 0.00 »** dans les CGV alors que 0 signifie « jamais ». Texte juste partout.
14. **Prix barré périmé** dans l'aperçu de l'éditeur : il est maintenant vérifié à chaque affichage.

**Mineurs**

15. Cartes du calendrier social inaccessibles au clavier.
16. Échap ne fermait pas la fiche produit de la démo.
17. Le compteur « commandes à préparer » ne correspondait pas à la liste ouverte (les filtres précédents restaient actifs).
18. « Pas encore de commande » affiché avec un filtre de canal actif.
19. Boutique publique : le bouton « + » du panier dépassait le stock (refus seulement au paiement). Borné, et désactivé au maximum.
20. Palette (Ctrl+K) : « Exporter les commandes » n'exportait que 30 jours de ventes. Exporte bien toutes les commandes.

Tests : 40 ; audits accessibilité et XSS propres.

### Cycle 13 — Saisons des produits stars, téléphone, rapidité

**Contrôles**

- **Produits stars mois par mois** (Suisse et France, 12 mois, 148 produits) : le classement suit bien les saisons (résolutions en janvier, Saint-Valentin en février, printemps, été, rentrée, Noël d'octobre à décembre). Le chocolat qui reste dans le haut du classement à Pâques et en mai (fête des mères) est cohérent.
- **Rapidité** : chaque écran de l'administration se redessine en moins de 15 ms avec la démo complète (plus de 1 000 commandes).

**Défauts trouvés et corrigés**

1. **Coffrets de Noël en tête dès septembre sans explication** (« hors saison » apparent). La fiche indique désormais : « Grand pic en décembre : testez dès maintenant (fiches, photos et publicités se préparent 2 à 3 mois avant) ».
2. **Contenu coupé sur téléphone (360 px)** :
   - fiches fournisseurs : les quatre chiffres restaient sur une ligne et le dernier sortait de l'écran (deux par ligne maintenant) ;
   - Réseaux sociaux : le tableau « Ce que le pilote a appris » élargissait toute la carte, coupée à droite (le tableau défile maintenant seul).
   - Correction générale : une carte ne peut plus être élargie par son contenu. Vérifié sans changement sur ordinateur.

### Cycle 14 — Les chiffres concordent-ils d'un écran à l'autre ?

**Défauts trouvés et corrigés**

1. **Deux bénéfices différents pour la même période** : le tableau de bord et la page Analyse calculaient le bénéfice net avec deux formules (frais de paiement de 2,5 % + 0.30 partout d'un côté, 1,7 % en boutique de l'autre). Une seule formule désormais ; vérifié : CHF 2’335.65 sur les deux écrans pour 30 jours.
2. **Ventes en espèces chargées de frais de carte** : le moyen de paiement est enregistré sur chaque vente en caisse (démo et serveur), et les espèces n'ont plus de frais.
3. **Retrait en magasin compté avec 7 de frais d'envoi** dans le bénéfice : plus de port quand le client vient chercher sa commande.
4. **Bénéfice recalculé avec le taux de TVA actuel** au lieu de celui de la commande (après un changement de régime, les anciens mois changeaient). Le taux figé sur la commande, celui de sa facture, est utilisé.

### Cycle 15 — Calendrier commercial, pays par pays

Dates calculées comparées aux règles officielles pour 2026 à 2032 : soldes français (7 janvier et 24 juin 2026, 6 janvier 2027 car le 2e mercredi tombe après le 12), fête des mères française décalée quand elle tombe à la Pentecôte (prochains cas : 4 juin 2034, 5 juin 2039, tous deux bien calculés), Pâques (5 avril 2026, 28 mars 2027, 16 avril 2028), Black Friday, fêtes suisses et belges. Tout est juste, sauf :

1. **Soldes belges un dimanche** : quand le 3 janvier ou le 1er juillet tombe un dimanche, les soldes commencent la veille (2 janvier 2027, 30 juin 2029). Le copilote annonçait le dimanche.
2. **Conseils du mois faux pour la Belgique** : « fête des mères le dernier dimanche de mai », « soldes le 2e mercredi de janvier » (règles françaises). Conseils belges ajoutés (2e dimanche de mai et de juin, soldes du 3 janvier et du 1er juillet, Saint-Nicolas).
3. **Conseils français incomplets** : les exceptions (1er mercredi de janvier, fête des mères en juin les années de Pentecôte) sont précisées.

### Cycle 16 — Relecture du parcours public, de la boutique et des e-mails (1/2)

Une troisième relecture, centrée sur ce que voient les acheteurs, a relevé 20 points. Première série, la plus grave :

1. **Fausses promesses dans toute boutique neuve** : « Fabriqué en France », « Expédié sous 48 h », « expédiés depuis notre atelier », « Retours gratuits 30 jours », pour du dropshipping livré en une à trois semaines. C'est une pratique trompeuse (LCD art. 3, directive 2005/29). Textes par défaut neutres et vrais (paiement sécurisé, livraison suivie, service client) ; FAQ par défaut renvoyant aux délais des fiches et aux CGV.
2. **Faux avis clients affichés** (« ★★★★★ Produit superbe… Camille, Lyon ») tant qu'il n'y avait pas d'avis réels : interdit (directive Omnibus). Plus rien n'est affiché sans avis vérifiés ; un témoignage saisi à la main n'a plus d'étoiles.
3. **Vente possible sans adresse du vendeur** : interdit en Suisse, en France et en Belgique. Les commandes sont refusées tant que l'adresse manque, avec un message clair pour l'acheteur (bouton « Payer » désactivé) et une alerte pour le marchand.
4. **CGV publiques non conformes** :
   - Belgique : article de loi français cité au lieu du Code de droit économique (art. VI.47) ;
   - régime de franchise : « TVA comprise » au lieu de « TVA non applicable, art. 293 B du CGI » (même correction sur les fiches produits, qui affichaient « TTC ») ;
   - médiateur de la consommation, numéro de TVA et hébergeur absents (hébergeur réglable avec `HEBERGEUR`).
5. **Confirmation de commande sans information de rétractation** : en France et en Belgique, elle doit l'inclure, avec le formulaire type, sur un support durable. Ajoutés à l'e-mail.
6. **E-mail de commande : remise comptée deux fois en apparence** (articles déjà remisés, puis « Remise : −10,80 € », total inchangé). La remise est indiquée pour information.
7. **Mesure d'audience avant tout accord**, et même après « Refuser », alors que le bandeau promettait le contraire. Rien n'est mesuré sans « Accepter ».
8. **Trois relances de paiement envoyées d'un coup** après une interruption du serveur : une seule par passage.
9. **Code de bienvenue « sur votre première commande »** utilisable sans limite : refusé à une adresse qui a déjà commandé.
10. **E-mails** : « répondez STOP pour ne plus en recevoir » (personne ne traite ces réponses ; le vrai lien de désinscription figure déjà en pied), « votre panier est encore réservé » (faux : le stock n'est pas bloqué), et un plantage latent de l'e-mail de bienvenue.

Tests : 41 (refus de commande sans adresse ajouté).

### Cycle 16 — (2/2)

11. **Inscription : tout était effacé à la moindre erreur** (e-mail déjà utilisé, réseau) : nom de boutique, pays, e-mail et mot de passe sont conservés. Vérifié dans le navigateur.
12. **Choix de la formule au clavier** : chaque flèche faisait perdre le focus. Il reste sur la formule choisie.
13. **Panier au clavier et au lecteur d'écran** :
    - le focus est gardé après « + », « − », le choix de livraison ou le code promo, et il va au titre du panier à l'ouverture ;
    - le panier fermé n'est plus atteignable avec Tab (il contenait des champs invisibles) ;
    - panier, fiche produit et conditions de vente gardent le focus à l'intérieur tant qu'ils sont ouverts.
14. **Échap fermait deux fenêtres à la fois** (conditions de vente et fiche produit) : seulement celle du dessus.
15. **Bouton « Retour » du navigateur** : après la fermeture d'une fiche produit, il la rouvrait. La fiche se ferme maintenant comme une page qu'on quitte, et l'ajout au panier depuis la fiche remet l'adresse de la boutique.
16. **Formulaire d'avis effacé en cas d'erreur** : l'erreur s'affiche dans le formulaire, notes et commentaires gardés. Les étoiles sont annoncées (« 4 étoiles ») aux lecteurs d'écran.
17. **Messages inexacts** :
    - « un e-mail de confirmation vous a été envoyé » alors que le paiement n'était pas encore confirmé ;
    - attente infinie sur « Paiement en cours de confirmation… » ;
    - « Merci, vous êtes inscrit » pour une adresse désinscrite, qui doit d'abord confirmer par e-mail ;
    - « seuls les clients ayant reçu leur commande peuvent noter » (en réalité, dès l'expédition).
18. **Politique de retour suisse inventée** : les CGV annonçaient des retours sous 30 jours que le marchand n'avait jamais choisis. C'est un réglage dans Conformité (aucun, 14 ou 30 jours).
19. **Page d'accueil de Comptoir** : liens Impressum, Protection des données et Conditions d'utilisation inexistants. Les trois pages existent, alimentées par l'identité de l'exploitant (`EXPLOITANT_*`), avec un avertissement visible tant qu'elle n'est pas renseignée. Les prix en euros pour la France et la Belgique sont indiqués.
20. **Détails serveur** : les requêtes HEAD (robots, vérificateurs de liens) recevaient 404 sur les boutiques ; une boutique « Lumière & <b>Co</b> » avait des balises dans son adresse (`lumiere-b-co-b`, désormais `lumiere-co`).

**À faire par l'exploitant avant l'ouverture** : renseigner `EXPLOITANT_NOM`, `EXPLOITANT_ADRESSE`, `EXPLOITANT_EMAIL` (et `HEBERGEUR`). Je ne peux pas inventer ces informations.

### Cycle 17 — Belgique et boutiques déjà créées

1. **Transporteurs français proposés aux boutiques belges** (Colissimo, Chronopost : services français). Une boutique belge propose désormais bpost à domicile, bpost en point d'enlèvement et Mondial Relay ; le lien de suivi bpost est envoyé au client.
2. **Boutiques créées avant le cycle 16** : elles gardent les anciens textes d'exemple (« Fabriqué en France », « Expédié sous 48 h »…). Je ne modifie pas le contenu d'un marchand à sa place : une alerte « à vérifier » apparaît dans sa liste de tâches, avec un lien vers l'éditeur.

Contrôles de non-régression sur la démo : aucune erreur, aucun débordement à 360 px, audit d'accessibilité propre (clair et sombre). Tests : 41.

### Cycle 18 — Charge, pannes, sécurité, e-mails

**Contrôles**

- **Gros volume** (500 produits, 10 000 commandes sur 13 mois) : chaque écran se dessine en moins de 65 ms, la boutique publique répond en 8 ms, l'export CSV prend 40 ms ; aucune erreur.
- **Pannes et doubles clics** (inscription, import, enregistrement, caisse, paiement) : aucun problème. Le scénario a été mis à jour : il saisit l'adresse de l'entreprise et choisit la formule Pro (la caisse en dépend).
- **Injections** dans tous les champs : aucune exécutée.
- **API hostile** : rien à signaler (l'absence de limite relevée vient du réglage de test `LIMITES_FACTEUR=1000`, pas du serveur réel).

**Défaut trouvé et corrigé**

- **Expéditeur des e-mails cassé** si le nom de la boutique contient une virgule (« Lumière, Co » était lu comme deux adresses) ou des balises. Le nom est nettoyé et mis entre guillemets.

### Cycle 19 — Noms de domaine : disponibilité réelle

**Défaut** : sur un compte réel, la page Domaines affichait « Disponible » ou « Déjà pris » et des prix, alors que tout était simulé (et la note disait « Démo »). Un client pouvait choisir un nom déjà pris.

**Correction** :
- en compte réel, chaque suggestion porte « À vérifier » et un bouton « Vérifier », qui interroge le registre officiel du domaine (protocole RDAP) : SWITCH pour .ch et .li, AFNIC pour .fr, Verisign pour .com et .net, l'annuaire rdap.org pour les autres ;
- piège évité : rdap.org répond « introuvable » même pour google.ch, parce qu'il ne connaît pas le registre suisse. Interrogé naïvement, il aurait affiché « Libre » pour un domaine pris. Un « introuvable » ne compte donc comme « libre » que s'il vient du registre lui-même ; sinon, l'écran affiche « Registre injoignable » ;
- vérifié en direct : google.ch, google.fr et google.com sont pris ; un nom inventé est libre en .ch, .fr et .com ;
- les prix sont marqués « indicatifs » et la réservation se fait chez le registrar choisi ; la démo garde ses données simulées, signalées comme telles.

Tests : 42 (registre simulé : libre, pris, injoignable, saisie invalide, cache).

### Cycle 20 — Argent réel, colis fictif : le risque le plus grave de la nuit

**Défaut** : le seul fournisseur de dropshipping branché est un fournisseur de démonstration. Il « expédie » tout seul au bout de deux minutes, avec un faux numéro de suivi. Avec de vrais paiements Stripe, un acheteur réel aurait payé un produit qui ne serait jamais parti, et reçu un e-mail « commande expédiée » avec un suivi inventé.

**Correction** :
- dès que les paiements sont réels (clé Stripe de production), les produits du fournisseur de démonstration ne sont plus affichés : ni dans la boutique, ni dans la page vue par les moteurs de recherche, ni dans le plan du site ;
- ils ne peuvent pas être commandés (« produit plus disponible »), ni proposés en offre complémentaire ;
- le marchand voit une alerte : ces produits sont invisibles pour ses clients et doivent être remplacés par un fournisseur réel ou par ses propres produits ;
- en paiement simulé et avec une clé Stripe de test, tout reste utilisable pour essayer le parcours.

Tests : 43 (boutique avec une clé de production : produit du marchand visible, produit de démonstration masqué et refusé à la commande).

**À faire avant l'ouverture** : brancher au moins un vrai fournisseur. Le contrat d'API est décrit dans `server/src/fournisseurs.js`.

### Cycle 21 — Réseaux sociaux : ne pas faire croire qu'on publie

**Défaut** : aucune API de réseau social n'est branchée (Meta, TikTok et Pinterest exigent une application validée). Pourtant, sur un compte réel :
- « Connecter Instagram » affichait « Connecté » sans rien connecter ;
- « Publier maintenant », comme la publication programmée, marquait la publication « publiée » alors que rien ne partait ;
- des vues, des clics et des ventes inventés s'affichaient ;
- la formule Croissance promettait les « réseaux sociaux en pilote automatique ».

**Correction**, sur un compte réel :
- les réseaux s'« activent » (publication manuelle) ;
- le pilote prépare toujours le calendrier, les accroches, les légendes et les scripts vidéo ;
- le marchand publie lui-même, avec un bouton « Copier le texte », puis « Marquer comme publiée » ;
- rien ne part tout seul et aucune statistique n'est inventée ;
- tarifs et page d'accueil : « Calendrier et textes des réseaux sociaux préparés pour vous ».

La démo garde la simulation, signalée comme telle.

### Cycle 22 — Simulation des 100 boutiques, puis relecture des calculs métier

**Simulation complète des 100 boutiques sur le code à jour** (adresse obligatoire, consentement, nouveaux textes) : 100 boutiques créées, 100 commandes payées et expédiées, aucune anomalie, en 22 minutes.

**Relecture des calculs** : 15 points relevés et corrigés.

1. **Test produit à dépense nulle avec une vente** : plantage de trois écrans (Tests, tableau de bord, Analyse › Marketing). Pas de verdict « Augmenter » sans dépense, et affichage protégé.
2. **Codes promo de campagne actifs dès la validation et pour toujours**. En France, des soldes hors des périodes légales sont interdites. Chaque code n'est valable que du lancement à la fin de la campagne : vérifié avant, pendant et après le Black Friday.
3. **Remise de bienvenue mise à 0 % qui accordait 10 %** (côté serveur aussi), et remise de 120 % qui donnait un prix négatif. 0 désactive le code, et toute remise est plafonnée à 50 %.
4. **Douane suisse fausse** : franchise appliquée article par article, frais de La Poste sous-estimés (3.50 au lieu de 13 dès l'UE), frais retirés de la marge du marchand, et CGV affirmant « aucun frais de douane à la livraison ». En dropshipping, le fournisseur envoie au client droits non payés :
   - la marge du marchand n'est plus amputée ;
   - ce que le client paiera est estimé et affiché au marchand (fiche produit, sourcing) ;
   - l'acheteur en est informé (fiche produit, CGV), avec le pays d'expédition.
5. **France et Belgique : importations de Chine ignorées**. Depuis juillet 2021, la TVA est due dès le premier euro, et le client la paie sans le guichet IOSS du fournisseur. Ajouté partout : avertissement de sourcing, fiche, CGV, et pénalité dans le classement des produits stars.
6. **Deux « bénéfices nets » différents** pour la même période (l'écart était la publicité). La tuile s'appelle « Bénéfice avant publicité ».
7. **La marge par produit ne retombait pas sur le compte de résultat** (2’098 contre 2’385). Elle est répartie depuis le calcul de chaque commande ; vérifié : la somme est égale au centime.
8. **Entonnoir estimé** : il donnait la même « fuite principale » partout, avec un conseil TWINT pour une boutique française. Pas de diagnostic sans mesure réelle, et des conseils adaptés au pays.
9. **« 100 % des commandes ont la livraison offerte »** affiché avec un seuil à 0 (jamais).
10. **Noël** : deux dates limites de commande différentes sur le même écran. Une seule, calculée sur le délai le plus long de tous les produits. « Livraison garantie avant le 24 » s'affichait même pour la Saint-Nicolas : remplacé par « prévue », et seulement pour Noël.
11. **Jauge du seuil de TVA suisse** faussée par le filtre de canal ; l'alerte promise à 80 % n'existait pas. Elle existe désormais dans la liste de tâches.
12. **Produit à prix 0** : « −Infinity % ».
13. **Bilan des campagnes passées** mesuré sur la mauvaise période (les jours avant les soldes) ; et le slogan « notre seule grosse remise de l'année » côtoyait des soldes à −30 %.
14. **Graphiques jour par jour décalés d'une heure** avant le passage à l'heure d'hiver : les jours suivent le calendrier.
15. Conseils d'abandon de panier : chiffres non vérifiables retirés, sources citées sans pourcentage inventé.

Tests : 43 ; démo sans erreur ni débordement.

### Cycle 23 — Droits des acheteurs sur leurs données

**Manque** : un acheteur peut exiger une copie de ses données ou leur effacement (RGPD art. 15 et 17 ; nLPD art. 25 et 32). Les mentions légales le promettaient, mais le marchand n'avait aucun moyen de le faire.

**Ajouté** dans la fiche client :
- **Exporter ses données** : un fichier JSON avec ses commandes, ses avis et son inscription à la newsletter ;
- **Effacer ses données**, avec confirmation en deux clics :
  - nom, e-mail et adresse sont remplacés par « Client effacé » ;
  - montants, numéros et factures restent pour la comptabilité (conservation légale) ;
  - ses avis deviennent anonymes et il est retiré de la newsletter ;
  - les e-mails enregistrés à son nom sont supprimés ;
  - son adresse reste seulement dans la liste de désinscription, qui sert à ne plus lui écrire ;
- refus tant qu'une commande est en cours, car l'adresse sert à la livraison ;
- un marchand ne peut agir que sur les clients de sa boutique.

Vérifié dans la démo (export téléchargé ; 7 commandes anonymisées) et par un test serveur. Tests : 44.

### Cycle 24 — Contrôle visuel des nouveautés (compte réel)

Captures d'une boutique réelle (formule Croissance, Suisse) : Domaines, Réseaux sociaux, tableau de bord, fiche produit sur téléphone.

1. **« Réserver pour CHF 12.99 »** sur les domaines recommandés d'un compte réel, avec le message « réservé, votre boutique y est accessible » : faux, rien n'est réservé. Le bouton devient « Choisir ce nom », qui renvoie aux étapes du registrar et du DNS.
2. **Boutique sans aucune section** (configuration vide ou abîmée) : page publique entièrement blanche. Elle affiche maintenant au moins ses produits.
3. Vérifié : la fiche produit indique le pays d'expédition (« Chine ») et l'avertissement d'importation ; pour une entreprise non assujettie, elle n'affiche plus « TTC ».
4. **Prévision inventée pour une boutique neuve** : « Campagne prête : CHF 166.60 de ventes prévues » sans aucune vente (le calcul comptait au moins une vente par produit). Sans historique, plus de chiffre : « prévision dès vos premières commandes ».
5. **Graphique vide** : l'axe affichait « 0, 0, 1, 1, 1 ». Deux graduations nettes, 0 et 1.
6. Réseaux sociaux en publication manuelle : le sous-titre ne dit plus « prépare et publie ».

### Cycle 25 — Compte neuf, écran par écran (Suisse puis France)

Chaque écran d'un compte réel tout neuf a été parcouru, à la recherche de chiffres inventés et de termes d'un autre pays.

1. **« Votre stock couvre la demande prévue »** sans aucune prévision : « la demande sera prévue à partir de vos premières ventes ».
2. **« 1,0 pour 1000 vues »** affiché avec zéro vue : « pas encore de vues mesurées ».
3. **« Les chiffres de démo sont fictifs »** sur la page Tests d'un compte réel : retiré hors de la démo.
4. **Boutique française** :
   - « Impressum » (terme suisse) dans le plan de lancement : « mentions légales » ;
   - les produits d'entrepôts suisses étaient mis en tête avec « expédié depuis la Suisse » comme un atout. Or la Suisse est hors de l'UE : TVA d'importation pour l'acheteur. Ils sont désormais pénalisés dans le sourcing et les produits stars, avec l'explication, et les entrepôts européens sont signalés « sans formalité ».
5. **Boutique belge** : le balayage ne trouve plus de terme français ou suisse déplacé, sauf le conseil sur les influenceurs, qui citait la loi française du 9 juin 2023. Il cite désormais le droit belge (Code de droit économique, livre VI) et la directive européenne.

### Cycle 26 — Bancontact pour les boutiques belges

**Manque** : le paiement ne proposait que la carte en Belgique, alors que Bancontact est le moyen de paiement le plus utilisé du pays (TWINT l'était déjà en Suisse). La page de paiement Stripe d'une boutique belge propose désormais Bancontact et la carte, et la boutique l'annonce. Test ajouté : Bancontact en Belgique, carte seule en France. Tests : 45.

### Cycle 27 — Factures, avoirs, caisse, export comptable et conformité

Une cinquième relecture (factures et obligations légales) a relevé 15 points. Tous ont été traités, puis vérifiés à l'écran et par les tests.

**Factures**

1. **Changer de régime de TVA réécrivait les factures déjà émises** (CHF 36.00 « TVA 0 » devenait « TVA 2.70 »). Le taux est figé sur chaque facture ; vérifié : une ancienne facture reste identique après le changement.
2. **Un seul taux de TVA pour toute la boutique** : thé, miel ou chocolat étaient facturés à 8,1 %, 20 % ou 21 %. Chaque produit peut porter le taux réduit des denrées alimentaires (2,6 % en Suisse, 5,5 % en France, 6 % en Belgique) ; il est activé d'office pour les produits d'épicerie importés. La facture détaille la base HT et la TVA par taux.
3. **Facture d'un assujetti sans numéro de TVA**, et Conformité « En règle » quand même. Une alerte s'affiche sur la facture, et le contrôle passe à « À compléter » (format suisse `CHE-xxx.xxx.xxx TVA` vérifié).
4. **Remboursement sans avoir** : la facture restait seule, et la démo affichait « avoir émis » sans document. Un remboursement crée maintenant un avoir numéroté, dans la même suite que les factures, qui référence la facture d'origine (montants négatifs par taux).
5. **Date de la facture** : c'était la date de commande, alors que le numéro était attribué au paiement (numéros hors de l'ordre chronologique). La facture porte sa propre date, celle de la commande est indiquée à part.
6. **Contenu des factures** :
   - adresse complète du client ;
   - prix unitaire HT et taux par ligne pour un assujetti ;
   - mention « EI » pour un entrepreneur individuel en France ;
   - pour un non-assujetti ou une franchise, plus de « HT », « TVA 0.00 » ni « TTC » (interdit en Suisse pour un non-assujetti) : un total et la mention légale ;
   - mention de franchise belge mise à jour (« Régime particulier de franchise des petites entreprises »).

**Caisse**

7. **Espèces en francs** : le client payait le montant arrondi à 5 centimes, mais le ticket gardait le montant exact sans trace de l'écart. Le ticket affiche l'arrondi et le montant encaissé (vérifié : CHF 66.33, arrondi 0.02, encaissé 66.35).
8. L'adresse du magasin apparaissait comme adresse du client sur les tickets de caisse.

**Export pour la fiduciaire**

9. L'export était illisible dans un Excel en français : point décimal (« 7.00 » lu comme une date), numéros « 1426.00 », dates en heure UTC. Il est réécrit :
   - virgule décimale et dates locales ;
   - colonnes HT, TVA, TTC et détail par taux, moyen de paiement ;
   - une ligne par facture et une ligne négative par avoir.

**Conformité**

10. France : le téléphone de l'éditeur est demandé (obligatoire dans les mentions légales) ; l'hébergeur est indiqué.
11. Suisse (nLPD) : la déclaration nomme désormais les pays où partent les données (Union européenne, Chine), avec la base légale pour un pays sans protection adéquate : l'exécution de la commande.
12. France : « facture électronique conforme à la réforme (simulé) » était trompeur. La ligne passe à « À préparer », avec le calendrier (réception dès septembre 2026, émission et e-reporting en septembre 2027) et l'action à faire.
13. Belgique : le médiateur est indiqué comme facultatif. La facture électronique Peppol entre entreprises (obligatoire depuis 2026) est mentionnée, ainsi que le seuil de franchise de 25 000 €.
14. Suisse : la page annonçait « retours 30 jours » en dur ; elle reprend le réglage du marchand.

Tests : 46 (taux réduit par ligne, avoir dans la suite continue, arrondi en espèces).

### Cycle 28 — Promesses glissées dans les contenus générés

Les textes que Comptoir rédige pour le marchand (campagnes, publications) engagent le marchand vis-à-vis de ses clients. Trois promesses intenables ont été retirées :

1. **« Emballage cadeau offert »**, offre par défaut des campagnes sans remise : un fournisseur de dropshipping n'emballe pas en cadeau. Remplacé par « Notre sélection pour l'occasion » ; pour Noël, « livraison prévue avant Noël pour toute commande passée avant le … » (date calculée).
2. **« Un cadeau fait main »** (fête des mères) et les mots-clés `#faitmain #commercelocal` ajoutés à toutes les publications : réservés aux boutiques qui vendent leurs propres produits.
3. **Vidéos « coulisses »** (« vos mains qui emballent une commande ») proposées à des boutiques entièrement en dropshipping, où le marchand n'expédie rien lui-même : plus proposées dans ce cas. L'accroche « on en refuse 9 sur 10 », chiffre inventé, est retirée.

### Cycle 29 — Les deux simulations de 100 utilisateurs, sur le code de la nuit

Les simulateurs dataient d'avant l'abonnement obligatoire et l'adresse exigée du vendeur : leurs marchands ne payaient pas leur formule. Ils suivent désormais le vrai parcours (formule payée, adresse saisie dans Conformité). Résultats :
- **100 utilisateurs par l'API** (40 marchands, 60 acheteurs, entrées hostiles comprises) : aucune anomalie. Le nom de boutique de 106 caractères est refusé avec un message clair (limite de 80), comme prévu.
- **100 utilisateurs dans un navigateur** (bureau, portable, tablette, téléphones) :
  - 40 marchands inscrits, chacun a parcouru tous les écrans, ajouté un produit, créé un code promo, modifié une section et préparé le calendrier social ;
  - 60 acheteurs : 46 commandes payées, 10 paniers abandonnés, 4 paiements annulés ;
  - aucune anomalie.
- Contrôles complémentaires : audit d'accessibilité propre (clair et sombre) ; page d'accueil sans débordement à 360 px ; liens Impressum, Protection des données et Conditions en 200.

### Cycle 30 — Relecture des modifications de la nuit : 14 régressions corrigées

Une relecture indépendante de tout ce qui a été modifié depuis minuit a trouvé 14 défauts introduits par les corrections elles-mêmes. Tous sont corrigés.

**Graves**

1. **Bannière de remise affichée avant que son code fonctionne** : en validant le Black Friday le 11 novembre, la boutique annonçait aussitôt « −20 % », sans code valable avant le 27. Pour des soldes françaises, c'était une annonce hors période légale. La bannière d'une campagne reste invisible avant son lancement et après sa fin, côté navigateur comme côté serveur. L'éditeur affiche « Programmée : visible à partir du 27 novembre » au lieu de « code inconnu ».
2. **Effacement des données d'un client qui touchait d'autres clients** : les caractères « _ » et « % » d'une adresse e-mail servaient de jokers dans la recherche. Effacer a_b@x.ch effaçait aussi la trace de axb@x.ch, qui recevait alors un second e-mail de bienvenue. La comparaison est désormais exacte (test ajouté).

**Moyens**

3. Focus clavier perdu après « Ajouter au panier » depuis une fiche produit.
4. « Effacer ses données » impossible à confirmer au clavier (le bouton perdait le focus).
5. **Entonnoir « mesure réelle » faux** : les visiteurs étaient comptés seulement avec leur accord, mais les commandes payées l'étaient toutes, ce qui donnait des taux d'abandon négatifs. La commande payée est mesurée dans la même session, et le texte précise la population mesurée.
6. Copilote : il annonçait « vos fournisseurs livrent en 7 jours au plus », alors que la date limite affichée venait d'un produit livré en 18 jours. Le délai affiché est celui du calcul.
7. **Export comptable** : des commandes en attente ou annulées y figuraient en recettes, et les remboursements antérieurs aux avoirs n'avaient pas de ligne négative. L'export ne contient que des factures et des avoirs ; les anciens remboursements reçoivent leur avoir, numéroté dans la même suite.

**Mineurs**

8. Fiche marge d'un produit à taux réduit : « TVA 8,1 % » affiché pour un calcul à 2,6 %.
9. Code de bienvenue : il était accepté dans le panier puis refusé au paiement pour un client ayant déjà commandé. La condition « valable sur une première commande » s'affiche dès la saisie.
10. Effacement des données possible alors qu'une commande attendait encore son retrait en magasin.
11. Conformité : le texte parlait encore de mesure d'audience « par défaut », alors qu'elle n'a lieu qu'après accord.
12. Domaines : prix de la première année présenté comme prix annuel (.shop à 2,99 puis 34,99 par an). Les deux prix sont affichés.
13. Échap dans l'administration fermait d'abord une fiche produit invisible.
14. Canada : devise EUR dans le navigateur contre CAD sur le serveur ; alignée sur CAD.

Tests : 48.
