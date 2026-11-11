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
