# Journal de la nuit du 10 au 11 novembre 2026

Boucle demandée : tester, analyser et améliorer Comptoir sans relâche jusqu'à 7 h 00 (heure de Lausanne), sans rien laisser passer.
Chaque cycle : un domaine, des tests réels (navigateur, serveur, scripts), les corrections, `npm test`, puis commit et push.

## Synthèse de la nuit (0 h 10 – 6 h 50)

47 cycles, environ 65 commits poussés sur `claude/nice-mccarthy-59mfb5`. Tests du serveur : 64, tous verts.

À chaque cycle : un domaine testé pour de vrai (navigateur, serveur, scripts de simulation), les corrections, puis une relecture indépendante des corrections elles-mêmes. Ces relectures ont trouvé plusieurs régressions introduites pendant la nuit ; elles sont toutes corrigées et décrites dans leur cycle.

**Les défauts les plus graves trouvés et corrigés**
- **Argent des ventes** (cycles 43 à 46). Toutes les ventes de toutes les boutiques arrivaient sur l'unique compte Stripe de la plateforme. L'exploitant serait devenu intermédiaire de paiement, ce qui demande une autorisation. Désormais, chaque boutique encaisse sur son propre compte Stripe (Stripe Connect), sans commission.
- **Abonnements des marchands avec le vrai Stripe** (cycles 45 et 46).
  - Renouvellements ignorés : chaque client payant aurait été bloqué au bout d'environ 33 jours.
  - Double paiement possible au retour de Stripe.
  - Impayés gardant un mois d'accès en plus.
  - Webhook en échec jamais retraité.
- **Détournement de domaine à l'inscription** (cycle 40) : on pouvait déclarer comme actif le domaine d'un autre marchand.
- **Fonctions payantes non appliquées par le serveur** (cycles 40 à 42) : codes promo, remises, campagnes et e-mails automatiques marchaient même avec la formule Lancement.
- **Limites d'essais de mot de passe contournables** (cycles 40 et 41) : en parallèle, ou par adresses IPv6.
- **Colis fictifs** (cycles 20 et 47) : de l'argent réel était encaissé pour un fournisseur de démonstration, et de faux numéros de suivi étaient envoyés aux clients.
- **Promesses non tenues**, retirées de l'application et de l'accueil :
  - remises annoncées, délais de livraison plus rapides que la réalité ;
  - publication automatique sur les réseaux sociaux ;
  - éléments de tarifs inexistants (« assistance prioritaire », « fiche Google ») ;
  - « Essayer 30 jours » alors qu'aucun essai gratuit n'existe.

**Contrôles finaux sur le code de la fin de nuit**
- 100 boutiques de dropshipping : aucune anomalie.
- 100 utilisateurs dans un vrai navigateur (40 marchands, 46 commandes payées) : aucune anomalie.
- API, pannes et doubles clics, XSS, accessibilité : propres.
- Parcours d'un nouveau marchand sur téléphone (iPhone, Pixel, 360 px) et contrôle de chaque formule dans le navigateur : corrections faites aux cycles 42 et 47.

**À faire par l'exploitant avant la mise en ligne** (impossible ici sans ses comptes ni ses décisions)
1. **Identité légale** : renseigner `EXPLOITANT_NOM`, `EXPLOITANT_ADRESSE`, `EXPLOITANT_EMAIL`, `EXPLOITANT_IDE` et `HEBERGEUR` (mentions légales, confidentialité, conditions).
2. **Stripe**
   - Compte de la plateforme avec Connect (comptes Express), TWINT et Bancontact activés pour les comptes connectés.
   - Deux webhooks : plateforme et Connect, avec `STRIPE_WEBHOOK_SECRET` et `STRIPE_CONNECT_WEBHOOK_SECRET`.
   - Version d'API du webhook : `2024-06-20`.
   - Un essai complet en mode test.
3. **Un vrai fournisseur** branché selon le contrat décrit dans `server/README.md`. Tant qu'il n'y en a pas, les produits du fournisseur de démonstration ne sont ni affichés ni vendus avec une clé Stripe réelle.
4. **Envoi des e-mails** : brancher Brevo ou Postmark. Sans cela, les e-mails restent en file d'attente.
5. **Réseaux sociaux** : connecter les API officielles. En attendant, la publication reste manuelle (texte préparé, copié par le marchand).
6. **Décisions à prendre**
   - Prix des abonnements affichés hors taxes ou TTC, et collecte des numéros de TVA.
   - Durée de conservation des données des comptes fermés.
   - Accès en lecture seule aux commandes après la fin d'un abonnement.

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

### Cycle 31 — Éditeur, photos, compte marchand et référencement

Une septième relecture a relevé 14 défauts. Tous sont corrigés.

**Graves**

1. **Une seule personne pouvait bloquer la connexion de tous les marchands.** Derrière le proxy (Caddy) prévu pour la mise en ligne, toutes les requêtes arrivaient avec la même adresse, et chaque connexion, même réussie, comptait comme un essai. Désormais :
   - l'adresse réelle est lue dans l'en-tête ajouté par le proxy de confiance (une adresse forgée par le client est ignorée) ;
   - seuls les échecs comptent, par adresse et par compte visé ;
   - les liens « mot de passe oublié » sont limités par adresse e-mail.

   Test ajouté : 12 connexions réussies jamais bloquées, l'attaquant seul bloqué.
2. **Changer de formule ne changeait rien avec Stripe** : le marchand passé à Pro gardait les droits de Lancement, et celui qui descendait gardait Pro. La souscription Stripe change maintenant de prix (au prorata, sur la prochaine facture), les droits suivent aussitôt, et un changement fait dans le tableau de bord Stripe est repris. Le nouveau prix et la règle du prorata sont annoncés avant la confirmation. Test ajouté.

**Moyens**

3. **Thème personnalisé illisible sans avertissement** (bouton blanc sur jaune à 1,4:1, texte blanc sur blanc). Le texte des boutons et le gris secondaire se recalculent selon les couleurs choisies, et un encart avertit si un contraste reste trop faible. Thème Brume : gris secondaire légèrement assombri (4,47 → 4,81:1).
4. Aperçu « Mobile » de l'éditeur coupé sur téléphone ; cartes et newsletter qui débordaient du cadre.
5. Sur téléphone, toucher une section de l'aperçu n'ouvrait pas son panneau.
6. **Impossible d'ajouter ou de changer la photo d'un produit existant.** La fiche produit propose « Ajouter, changer ou retirer la photo ».
7. **« Ajouter par photo »** :
   - la description générée promettait « expédié sous 48 h, retours gratuits 30 jours », publiée telle quelle. Elle n'invente plus rien ;
   - les photos HEIC illisibles étaient ignorées en silence (« 0 fiche créée »). Elles sont nommées, avec la marche à suivre.
8. Un compte jamais payé ne pouvait pas être supprimé depuis l'interface, alors que la page de confidentialité le promet : bouton ajouté sur l'écran des formules.

**Mineurs**

9. Changement du mot de passe (l'ancien est exigé) et « Déconnecter les autres appareils » ajoutés dans Paramètres (test ajouté).
10. E-mails de compte (réinitialisation, abonnement) conservés après la suppression du compte : effacés.
11. Photos des produits interdites aux robots (aperçus de partage et Google Images sans image) : autorisées.
12. La photo d'un produit pas encore publié était accessible publiquement.
13. Produit absent ou retiré : la page répond 404 au lieu de 200 ; le titre de page est le même que celui rendu par le serveur ; le plan du site est signalé.
14. Éditeur au clavier : le focus revient sur la section ou sur le bouton « Monter/Descendre » après l'action.

Tests : 51 ; démo sans erreur ni débordement ; audit d'accessibilité propre.

### Cycle 32 — Le marchand est prévenu de ce qui demande une action

**Manque** : le marchand n'était prévenu de rien. Il devait ouvrir son tableau de bord pour découvrir une commande à expédier, et un échec de transmission au fournisseur n'était visible que dans l'historique de la commande. Désormais, il reçoit un e-mail :
- **à chaque commande payée** : récapitulatif, client et ce qu'il doit faire (« à préparer et expédier », « à transmettre au fournisseur », « rien à faire : la commande part automatiquement chez le fournisseur », « à préparer pour un retrait ») ;
- **si la transmission automatique au fournisseur échoue** : alerte « action requise », avec la cause et le lien (sans elle, le premier e-mail l'aurait laissé croire qu'il n'avait rien à faire) ;
- **quand un produit tombe à zéro** après une vente (il s'affiche alors « Épuisé »).

Tests : 53 (e-mail de commande, alerte de stock).

**Contrôles sur le code à jour (après le cycle 32)** :
- 100 boutiques en dropshipping : 100 commandes, aucune anomalie ;
- 100 utilisateurs par l'API : aucune anomalie ;
- injections : aucune exécutée ;
- pannes et doubles clics : aucun problème.

### Cycle 33 — Relecture des cycles 30 à 32 : 11 défauts corrigés

**Graves**

1. **N'importe qui pouvait verrouiller le compte d'un marchand** : dix mauvais mots de passe, envoyés depuis dix adresses, bloquaient sa connexion (et même le changement de son mot de passe) pour un quart d'heure, renouvelable à volonté. Désormais :
   - le blocage vaut par compte *et* par adresse ; le compte seul n'est bloqué qu'à un seuil vingt fois plus haut ;
   - une connexion réussie remet le compteur à zéro ;
   - le changement de mot de passe a sa propre limite.

   Test ajouté : le marchand se connecte malgré l'attaque.
2. **La bannière d'une campagne disparaissait dès sa deuxième année** : le même code (BLACKFRIDAY20) revient chaque année et l'ancienne campagne, terminée, était retenue. C'est la campagne en cours (sinon la prochaine) qui compte.

**Moyens**

3. Changer de formule après avoir demandé la résiliation : Stripe résiliait quand même, et le marchand recevait un nouvel e-mail « résiliation enregistrée ». La résiliation est annulée chez Stripe aussi, et l'e-mail ne part que lorsque la résiliation vient d'être demandée.
4. Supprimer son compte effaçait aussi les e-mails reçus comme client d'autres boutiques, y compris une confirmation de commande en attente d'envoi.
5. Alerte « stock épuisé » envoyée en double, et « à préparer et expédier » pour une commande en rupture : une seule alerte, et l'e-mail dit « rupture : réapprovisionnez ou remboursez ».
6. La table des échecs de connexion n'était jamais purgée (mémoire sans limite).

**Mineurs**

7. Factures Stripe au nom de l'ancienne formule après un changement : elles portent le nom de la nouvelle.
8. Complément ajouté après achat : l'e-mail au marchand le présente comme complément de la commande d'origine, « à joindre au même colis ».
9. L'e-mail au marchand recopiait le nom du client, qui restait après un effacement de ses données : seule la ville de livraison y figure.
10. Entonnoir : « commande payée » recomptée à chaque ouverture du lien de suivi. Elle est comptée une fois, dans l'onglet du paiement.
11. Photo de la fiche produit inaccessible au clavier : vrai bouton, et le focus revient après l'ajout ou le retrait.

Tests : 55.

### Cycle 34 — Retrait en magasin de bout en bout

Parcours complet testé sur le serveur : commande en retrait, paiement, « en préparation », « prête » (e-mail au client avec l'adresse et les horaires du magasin), « remise au client ». Tout fonctionne. Deux textes corrigés :
- le récapitulatif des e-mails affichait « Livraison (Retrait en boutique (click & collect)) : offerte » ; il affiche maintenant « Retrait en boutique : gratuit » ;
- l'e-mail au marchand indiquait « Livraison : Lausanne » pour un retrait.

### Cycle 35 — Produits introuvables dans la boutique

1. **Les produits au-delà de la vitrine étaient introuvables** : la grille montre 4 à 8 produits, et rien ne menait aux autres (une boutique de 12 produits en cachait 8 aux acheteurs). Un bouton « Voir tous les produits (12) » affiche tout le catalogue, avec un filtre par catégorie. Vérifié sur téléphone : 4, puis 12 produits, 10 catégories, aucun débordement.
2. **Le bandeau des cookies recouvrait la fin de la page** (et le nouveau bouton) tant que le visiteur n'avait pas répondu : la page garde maintenant un espace sous son contenu.

### Cycle 36 — Commandes, clients et produits : 15 défauts corrigés

Une relecture des modules de gestion quotidienne a relevé 15 défauts.

**Graves**

1. **Activé au clavier, le bouton clair/sombre de l'interface effaçait le thème de la boutique publique** (couleurs vides, rayon 0, enregistré sur le serveur en compte réel). Il partageait son nom d'action avec les tuiles de thème de l'éditeur. Les deux sont séparés, et un thème inconnu est ignoré.
2. **Stock fantôme** : une commande payée en rupture puis remboursée rendait au stock un article qui n'avait jamais existé. Chaque ligne garde la quantité réellement retirée, et seule celle-ci revient (serveur et démo, test ajouté).
3. **Remboursement, annulation et suppression de produit en un seul clic**, sans confirmation, alors qu'un remboursement Stripe est irréversible. Une confirmation explicite est demandée.
4. **Note interne perdue** si l'on cliquait une action pendant la frappe (la relecture de l'état écrasait la note pas encore envoyée). Les notes en attente partent avant toute relecture.

**Moyens**

5. Une commande cochée puis cachée par un changement de filtre restait sélectionnée : elle était modifiée à l'aveugle par une action groupée. La sélection ne garde que les commandes affichées.
6. L'action groupée annonçait « 1 commande : en préparation » même quand le serveur avait refusé : réussites et refus sont annoncés séparément.
7. Boutons de statut calculés d'après le produit actuel (supprimé ou modifié) et non d'après la commande, comme le fait le serveur.
8. **Commande mixte impossible à transmettre à la main au fournisseur**, alors que l'e-mail d'échec le demandait. Un bouton « Transmettre la partie fournisseur » le fait, sans changer le statut (test ajouté).
9. Un client désinscrit restait dans le segment « acceptent les e-mails » et dans l'export.
10. Étiquette d'envoi sans rue ni code postal.
11. Fiche produit en cours de modification remise à zéro par une recherche ou un filtre.
12. Bon de préparation sans les compléments achetés après coup, « à joindre au même colis » : ils y figurent, et la commande les signale.

**Mineurs**

13. Export des clients :
    - montants avec point décimal et dates en UTC ;
    - la liste exportée ignorait le segment et la recherche ;
    - un nom commençant par « = » devenait une formule dans Excel (corrigé dans tous les exports).
14. Recherche « #1006 » sans résultat ; palette limitée aux 60 dernières commandes ; « Aujourd'hui » couvrait les 24 dernières heures ; « Commandes à préparer » gardait les anciens filtres.
15. Clients sans aucune vente valide comptés comme clients ; produits « à vérifier » comptés « en ligne » ; fournisseurs crédités de commandes jamais transmises.

Tests : 57.

### Cycle 37 — Conversion, caisse, paramètres et copilote : 15 défauts corrigés

**Graves**

1. **Le QR code de vitrine menait à une adresse inexistante** (`<nom>.comptoir.shop`, ou un domaine pas encore vérifié). Une seule règle donne désormais l'adresse réelle, la même que celle du serveur : le domaine s'il est vérifié, sinon `/s/<boutique>`. Elle sert au QR code, à l'éditeur, au bandeau « vous voyez la boutique » et au menu.
2. **Valider une deuxième campagne effaçait la bannière de la première**, alors que son code restait valable. Chaque campagne a sa propre bannière, affichée pendant sa période ; la bannière générique s'efface pendant ce temps.
3. **Une campagne sans code (Noël, Saint-Nicolas) s'affichait aussitôt et ne disparaissait jamais.** Sa bannière suit maintenant la période de la campagne. Vérifié : Singles Day visible, Black Friday et Noël masqués avant leur début, Noël masqué en janvier.
4. **Caisse** : au-delà de 20 unités d'un même produit, le ticket s'affichait mais l'encaissement échouait. Les ventes en magasin acceptent jusqu'à 999 unités par article.

**Moyens**

5. **Réglages hors limites** (remise de 100 %, délai de 0 jour, seuil de 5000) affichés tels quels, puis corrigés en silence par le serveur. L'écran applique les mêmes limites et prévient quand une valeur est ramenée. Les plafonds du navigateur et du serveur sont alignés (relance de paiement : 30 %).
6. **Relances de paiement saisies dans le désordre** (72 h, 24 h, 1 h) : une seule partait. Elles sont triées dans l'ordre chronologique, à l'écran comme sur le serveur.
7. **Paliers de quantité incohérents** (2 articles à −10 %, 3 articles à −5 % : acheter plus coûtait plus cher). Le second palier doit demander plus d'articles et donner plus de remise.
8. **Campagne impossible à annuler**, et message trompeur (« e-mail et publication planifiés » : rien n'est envoyé automatiquement). Bouton « Annuler la campagne » (bannière retirée, code désactivé) ; le message dit ce qui est réellement fait, les dates et « prêt à copier ».
9. « Contenus modifiables avant envoi » : faux, ils sont à copier ; le texte le dit.
10. **Codes promo** :
    - « été 20 » devenait « T20 » ;
    - un code vide ne disait rien ;
    - un code manuel pouvait écraser en silence le code de bienvenue ;
    - aucune date d'expiration possible.

    Désormais, les accents sont retirés (ETE20), un message s'affiche, un code déjà utilisé est refusé, et une date d'expiration peut être saisie.
11. **Retrait en boutique proposé sans adresse de magasin** : refusé à l'écran, et non proposé par le serveur.
12. Offre complémentaire dont le produit est hors ligne : la liste affichait un autre produit ; elle indique « (hors ligne) » et l'offre est signalée inopérante.

**Mineurs**

13. Une campagne en cours (soldes, Black Friday) disparaissait du copilote dès le jour de l'événement ; elle reste visible jusqu'à sa fin.
14. Restauration d'un fichier incomplet acceptée (« données restaurées »), puis l'éditeur plantait : le fichier est vérifié et complété.
15. Caisse :
    - rendu de monnaie ajouté (« espèces reçues », « à rendre ») ;
    - « Fiche Google synchronisée » ne s'affiche plus sur un compte réel, où rien n'est synchronisé (annoncée « bientôt disponible »).

Tests : 57 ; démo sans erreur.

### Cycle 38 — Relecture des cycles 33 à 36 : 6 défauts corrigés

1. **Verrouillage d'un compte encore possible** avec une attaque répartie sur une vingtaine d'adresses (le seuil global du compte, 20 fois plus haut, finissait par être atteint). Désormais :
   - un appareil où le marchand s'est déjà connecté reçoit un cookie signé (valable un an), et le seuil global ne s'applique jamais à cet appareil ;
   - les adresses IPv6 sont comptées par réseau (/64), car une seule personne en détient des milliards.

   Test ajouté : 25 adresses attaquent ; un appareil inconnu est bloqué, celui du marchand se connecte.
2. **L'export « Clients » des Paramètres** reprenait la liste filtrée du dernier passage sur l'écran Clients : il exporte tous les clients. L'écran Clients, lui, exporte sa liste filtrée.
3. **Commande mixte remboursée alors que sa partie fournisseur était déjà commandée** : le fournisseur aurait expédié et facturé quand même. Le remboursement demande de confirmer l'annulation chez le fournisseur (refusé par le serveur sans cette confirmation), et l'historique le note.
4. Un produit Stripe était créé à chaque changement de formule : il est retrouvé et réutilisé.
5. « Voir tous les produits » d'une deuxième section faisait défiler la page vers la première.
6. Fournisseurs : le taux de remboursement et les délais sont calculés sur les seules commandes transmises, comme le nombre affiché.

Tests : 58.

### Cycle 39 — Relecture des cycles 37 et 38 : 11 défauts corrigés

**Graves**

1. **Caisse, « Espèces reçues » : les chiffres s'inscrivaient à l'envers** (« 100 » devenait « 001 », la monnaie à rendre était fausse). Chaque frappe redessinait la page et replaçait le curseur au début. Seule la ligne « À rendre » se met à jour désormais.
2. **Annuler une campagne validée avant cette nuit laissait en ligne une bannière « −20 % » sans code valable.** Les anciennes bannières sont rattachées à leur campagne (par leur code, ou par leur titre pour celles sans code), côté navigateur comme côté serveur. L'annulation les retire, et une bannière dont le code n'existe plus n'est jamais affichée.

**Moyens**

3. Anciennes bannières sans code (Noël) toujours visibles hors saison, et doublon quand on revalidait la campagne : réglé par le même rattachement.
4. **QR code** : son adresse dépendait de celle utilisée pour ouvrir l'administration (adresse IP locale, alias) et imposait https. L'adresse publique vient maintenant du serveur, qui la connaît exactement. Paramètres l'affiche aussi et signale un domaine en attente de vérification.

**Mineurs**

5. Palier à « dès 25 articles » accepté puis appliqué dès 20 : l'écran plafonne à 20.
6. Code « ÉTÉ20 » tapé par un client refusé alors que l'administration l'avait enregistré en ETE20 : les accents sont retirés partout où un code est lu.
7. Codes promo :
   - un code manuel pouvait reprendre le code d'une campagne programmée (non encore lancée) ;
   - les codes expirés disparaissaient sans pouvoir être retirés ;
   - la date d'expiration n'était affichée nulle part.
8. Retrait en boutique : la même règle (activé et adresse renseignée) partout, avec un avertissement si l'adresse manque.
9. **Cookie d'appareil reconnu** : il restait valable pour toujours. Il est lié au mot de passe actuel (un changement ou une réinitialisation révoque les autres appareils) et effacé à la suppression du compte.
10. Adresses IPv6 en majuscules (`::FFFF:1.2.3.4`) : toutes les adresses IPv4 auraient partagé un même compteur d'essais.
11. La restauration d'une sauvegarde ajoutait un faux code « SAISON15 » à la bannière saisonnière.

Le client utilisé par les tests garde désormais chaque cookie sous son nom, comme un navigateur. Tests : 58.

**Contrôles sur le code du cycle 38** :
- 100 boutiques : 100 commandes, aucune anomalie ;
- 100 utilisateurs dans un navigateur : 40 marchands sur tous les écrans, 46 commandes payées, 10 paniers abandonnés, 4 paiements annulés, aucune anomalie ;
- pannes et doubles clics : aucun problème.

### Cycle 40 — Relecture de sécurité du serveur (04 h 10 – 04 h 35)

Une relecture indépendante du serveur a relevé 8 problèmes. Tous sont corrigés.

**Grave**

1. **Détournement de domaine à l'inscription.** Le formulaire d'inscription acceptait un domaine déjà « actif », sans aucune vérification. Un tiers pouvait ainsi se faire servir le domaine d'un autre marchand, y compris en HTTPS, et bloquer son vrai propriétaire.
   - Le domaine passe désormais par la même règle que les réglages : il n'est actif qu'après la vérification DNS et TXT.
   - Au démarrage, les boutiques déjà enregistrées avec un domaine actif jamais vérifié sont corrigées.

**Moyens**

2. **Fonctions payantes appliquées par le serveur.** Avec la formule Lancement, l'interface masquait les codes promo, paliers, offres, campagnes et e-mails automatiques, mais le serveur les appliquait quand même. Le retrait en magasin (Pro) était dans le même cas.
   - Le serveur les éteint désormais à la vente.
   - Les réglages restent enregistrés et reviennent si le marchand passe à une formule qui les inclut.
3. **Tendances faussables.** Une boutique pouvait déclarer elle-même l'origine fournisseur de ses produits, et une commande marquée « payée » à la main comptait comme une vente.
   - L'origine fournisseur n'est retenue que si le produit existe au catalogue.
   - Seules les commandes réellement payées en ligne comptent.
4. **Limites d'essais et IPv6.** Un seul abonné IPv6 dispose de milliards d'adresses, ce qui lui permettait de contourner les limites.
   - Toutes les limites comptent maintenant par réseau /64.
   - Le compteur des essais de connexion est purgé, pour ne plus grossir sans fin.
   - Le hachage des mots de passe (scrypt) est asynchrone : il n'immobilise plus le serveur.

**Mineurs**

5. **Newsletter.** N'importe qui pouvait inscrire l'adresse d'un tiers. L'inscription passe maintenant par une double confirmation : un lien est envoyé, et l'adresse n'est inscrite (avec son e-mail de bienvenue) qu'au clic.
6. **Suppression du compte.** Les essais de mot de passe n'étaient pas limités. Ils partagent maintenant le compteur du changement de mot de passe.
7. **Entrées malformées.** Un cookie ou une adresse mal encodés, ou un jeton avec des accents, provoquaient une erreur 500. Ils reçoivent maintenant une réponse propre (400 ou 404). Toutes les comparaisons de jetons se font sur leur longueur en octets.
8. **Contournement de « vendable ».** Un code fournisseur déclaré librement contournait la règle « vendable ». Il est désormais toujours fixé par le serveur.

Tests : 60 (2 nouveaux, et le test de la newsletter suit le lien de confirmation).

### Cycle 41 — Relecture des corrections du cycle 40 (04 h 35 – 04 h 50)

Une relecture indépendante des corrections du cycle 40 a trouvé une régression que j'avais introduite, et six points à compléter.

1. **Grave (régression du cycle 40) : limite d'essais contournable en parallèle.** Avec le hachage asynchrone, 60 essais de mot de passe lancés en même temps passaient tous la limite (10) avant qu'un seul échec soit noté.
   - Chaque essai est maintenant compté avant le calcul, puis décompté s'il réussit. Cela vaut pour la connexion, le changement de mot de passe et la suppression du compte.
   - Test ajouté : 40 essais en rafale donnent au plus 5 réponses « mot de passe incorrect », tout le reste est refusé (429).
2. **Connexion avec l'ancien mot de passe pendant une réinitialisation.** Une connexion encore en cours de vérification pouvait ouvrir une session juste après une réinitialisation.
   - Le mot de passe est relu après le calcul ; s'il a changé entre-temps, la connexion est refusée.
   - Même contrôle pour le changement de mot de passe.
3. **Domaines déjà enregistrés.** Un domaine squatté avec une fausse date de vérification échappait à la correction du cycle 40. Une migration unique désactive maintenant tous les domaines actifs : chaque marchand clique à nouveau sur « Vérifier » (DNS et TXT), et le vrai propriétaire peut revendiquer le sien.
4. **Newsletter.** La limite par adresse révélait si une adresse était déjà inscrite (le 4ᵉ essai répondait différemment) et pouvait bloquer une personne. La réponse est maintenant identique dans tous les cas.
5. **Interface du marchand alignée sur sa formule.** Une seule règle, `Formules.configVente`, sert désormais au serveur et à l'interface. Avec Lancement :
   - l'aperçu de la boutique n'applique plus de palier ni de code ;
   - les bannières de campagne suivent la même règle qu'en ligne ;
   - la liste de lancement ne coche plus « E-mails automatiques actifs » ;
   - les Paramètres précisent que relances, avis et bienvenue viennent avec Croissance.
6. **E-mails automatiques.** Une ancienne configuration à laquelle manquait une clé pouvait réactiver un e-mail automatique sous Lancement. Les quatre e-mails sont maintenant toujours éteints explicitement.
7. **Base de données.** Ajout d'un index `paiements(commande_id, statut)`, utilisé par le calcul des tendances et par la mise à jour des paiements d'une commande.

Tests : 61.

### Cycle 42 — Chaque formule dans un vrai navigateur (04 h 50 – 05 h 10)

Les trois formules (Lancement, Croissance, Pro) ont été parcourues de bout en bout dans Chromium : inscription, paiement simulé, les 19 écrans, l'éditeur, la boutique publique, le panier et la page de paiement, plus des changements de formule à la hausse et à la baisse.

**Ce qui fonctionne :** les montants payés suivent exactement la formule.
- Lancement : CHF 162.00, sans remise.
- Croissance et Pro : CHF 145.80 avec la remise par quantité, et CHF 129.60 avec un code.
- Le retrait en magasin disparaît et revient avec la formule Pro.
- La caisse est refusée sous Croissance.

14 défauts trouvés, tous corrigés :

1. **Après un passage à Lancement, les publications programmées partaient quand même, et l'écran verrouillé empêchait de les annuler.** Elles redeviennent maintenant des brouillons (test ajouté).
2. **La livraison offerte n'était réglable que dans Conversion, verrouillé sous Lancement.** Le seuil se règle maintenant aussi dans Paramètres > Livraison.
3. **La boutique promettait « -10 % sur votre première commande » sans e-mail de bienvenue actif.** Le texte n'annonce plus que la remise réellement envoyée, sinon il reste neutre. Le nouveau texte par défaut ne promet rien.
4. **La vue d'ensemble poussait des fonctions hors formule** (copilote, pilote des réseaux sociaux). Elle renvoie maintenant vers les formules.
5. **Le plan de lancement comptait des étapes impossibles avec Lancement.** Elles sont affichées à part, avec un cadenas et la formule nécessaire.
6. **Une bannière de campagne restait « programmée » alors qu'elle ne sera jamais affichée.** Elle indique maintenant que les campagnes viennent avec Croissance.
7. **Descendre de formule se faisait sans avertissement.** La confirmation liste maintenant ce qui s'arrête tout de suite, et précise que les réglages sont gardés.
8. **Paramètres > E-mails** renvoyait vers un écran verrouillé, et annonçait l'e-mail « prête à retirer » sans retrait en magasin. Les deux textes suivent maintenant la formule.
9. **Tarifs honnêtes.**
   - Retiré de Pro : « Export pour votre fiduciaire » (déjà inclus dès Lancement) et « Assistance prioritaire » (rien ne la distinguait).
   - Retiré de Croissance : « Tendances en continu » (même rythme pour tous).
   - Retirée : la « fiche Google », pas encore disponible.
   - Ajoutés à la place, uniquement des éléments qui existent.
   - Même correction sur l'accueil public.
10. **Page Offre et tarifs.** La formule actuelle est marquée, et les boutons disent « Passer à … ».
11. **Menu.**
    - Plus de badge « 2 à valider » sur le copilote verrouillé.
    - Le groupe de menu nommé « Croissance » (comme la formule) devient « Marketing ».
    - Les Domaines, inclus partout, passent sous « Boutique ».
12. **La palette de commandes (Ctrl+K)** ne propose plus d'action vers un écran hors formule.
13. **« Voir la boutique » en mode connecté** n'est plus collé à la barre latérale : la mise en page pleine largeur ne vaut que pour l'aperçu de démonstration.
14. **Jargon de développeur visible des marchands** (SERPAPI_KEY, TENDANCES_FICHIER, server/README.md). Remplacé par des phrases claires.

Le code promo faux renvoie toujours une erreur 404. Le message affiché au client est juste ; ce n'est qu'une ligne dans la console du navigateur, laissée telle quelle.

Tests : 62.

### Cycle 43 — Chaque boutique encaisse sur son propre compte Stripe (05 h 10 – 05 h 20)

**Défaut d'architecture.** Avec une clé Stripe, toutes les ventes de toutes les boutiques arrivaient sur l'unique compte Stripe de la plateforme. L'exploitant aurait détenu l'argent des marchands, puis aurait dû le leur reverser. C'est une activité d'intermédiaire de paiement : elle demande une autorisation (FINMA en Suisse, DSP2 dans l'Union européenne) et une comptabilité de tiers, et rien de cela n'existait.

**Correction : Stripe Connect, paiement direct.**
- Chaque boutique a son compte Stripe (Express). La session Checkout, l'annulation d'un lien et le remboursement passent tous par ce compte (en-tête `Stripe-Account`).
- La plateforme ne touche jamais l'argent des ventes et ne prend aucune commission, comme annoncé. Son propre compte ne reçoit que les abonnements Comptoir.
- Le marchand active ses paiements dans Paramètres > Paiements : Stripe vérifie son identité et son IBAN. Tant que ce n'est pas fait, la boutique reste visible mais refuse les commandes, avant toute écriture en base. Une alerte s'affiche aussi dans « À faire ».
- Le compte encaisseur est enregistré sur chaque paiement. Un remboursement passe toujours par le compte qui a encaissé, même si la boutique change de compte plus tard.
- Les webhooks des comptes connectés ont leur propre secret (`STRIPE_CONNECT_WEBHOOK_SECRET`).
  - Une vente n'est confirmée que si l'événement vient du compte de cette boutique.
  - `account.updated` ouvre ou ferme les commandes.
  - Un événement d'un compte connecté n'est jamais lu comme un abonnement Comptoir.
- La suppression du compte efface aussi la liaison Stripe.
- Le mode simulation est inchangé.

Nouveau test `connect.test.js`, avec un faux Stripe local. Il vérifie :
- les commandes refusées avant l'activation ;
- un seul compte créé, même si l'activation est demandée deux fois ;
- la vente sur le compte de la boutique ;
- le refus d'une confirmation venant d'un autre compte ;
- le remboursement sur le bon compte ;
- la fermeture après désactivation par Stripe.

README et `.env.example` sont à jour (étape « webhook Connect »). Tests : 63.

À faire par l'exploitant avant la mise en ligne, et non vérifiable ici sans vrai compte : activer Connect dans le tableau de bord Stripe, déclarer le webhook Connect, puis faire un essai réel en mode test de Stripe.

### Cycle 44 — Relecture des cycles 42 et 43 : 11 défauts corrigés (05 h 15 – 05 h 30)

**Graves**

1. **Webhook Connect manquant.** Si l'exploitant oubliait de le déclarer, les commandes payées restaient « en attente » : pas de baisse de stock, pas d'e-mail au marchand, et des relances « paiement abandonné » envoyées à des clients qui avaient déjà payé.
   - Le serveur affiche maintenant une alerte au démarrage s'il manque un secret.
   - Surtout, quand le client revient sur la boutique, la page de sa commande demande directement à Stripe si le paiement est passé (au plus une fois toutes les 10 secondes par paiement).
2. **TWINT ou Bancontact proposés avant leur activation par Stripe.** TWINT demande une validation à part. Tant qu'elle n'était pas faite, Stripe refusait toute la session de paiement, et chaque commande en CHF échouait en laissant une commande fantôme.
   - Ces moyens ne sont proposés qu'une fois actifs pour la boutique (suivi par `account.updated`).
   - Si Stripe refuse quand même la session, la commande est effacée.
   - La boutique n'annonce TWINT que s'il est vraiment actif.

**Moyens**

3. **Passage des clés de test aux clés réelles.** Les comptes créés en mode test n'étaient pas reconnus comme tels, et la boutique restait bloquée sans issue.
   - Chaque compte est maintenant enregistré avec son mode (test ou réel) ; un compte de l'autre mode est ignoré.
   - Un compte supprimé chez Stripe est recréé.
   - L'état du compte est relu chez Stripe toutes les heures.
4. **Boutiques pas encore activées.** Les clients remplissaient tout le panier avant d'être refusés.
   - La boutique annonce maintenant que les paiements arrivent, et le bouton Payer est désactivé.
   - Ces boutiques ne reçoivent pas de relances automatiques.
5. **« Avec la formule Croissance » affiché aux clients Croissance et Pro.** La vérification de formule comparait deux objets, toujours différents. Elle passe maintenant par `fonctionIncluse('conversion')`.
6. **Remise de bienvenue invisible sur la boutique publique.** Elle n'apparaissait que dans l'aperçu. La boutique en ligne reçoit maintenant l'état de la newsletter.

**Mineurs**

7. **Retour d'activation Stripe.** Le retour ouvre maintenant directement Paramètres > Paiements, et un lien expiré en redemande un nouveau automatiquement.
8. **Paramètres > Paiements.** « Stripe actif » et « Proposé » ne s'affichent qu'une fois le compte de la boutique actif. TWINT indique « En cours de validation par Stripe » tant qu'il n'est pas actif.
9. **Deux activations simultanées** (deux onglets) créaient deux comptes Stripe. Elles sont maintenant verrouillées par boutique, avec une clé d'idempotence.
10. **Avertissement de changement de formule.** Chaque fonction perdue a maintenant sa propre explication, et les publications ne repassent en brouillon qu'« à leur date ».
11. **Compte déconnecté de la plateforme** (`account.application.deauthorized`) : la boutique ferme ses commandes.

Le test Connect couvre aussi :
- TWINT absent puis présent ;
- la commande effacée quand Stripe refuse la session ;
- la confirmation au retour du client sans webhook ;
- les deux activations simultanées.

Tests : 63.

### Cycle 45 — L'abonnement Comptoir du marchand avec le vrai Stripe (05 h 25 – 05 h 40)

Une relecture du cycle de vie de l'abonnement a trouvé 12 problèmes, et la plupart sont corrigés. Le parcours a aussi été joué en simulation dans le navigateur : inscription, paiement, résiliation, reprise, changement de formule à la baisse puis à la hausse. Il était propre.

**Graves (avec une vraie clé Stripe)**

1. **Renouvellements ignorés.** Les versions récentes de l'API Stripe placent la souscription ailleurs dans la facture. Le paiement mensuel n'était alors plus reconnu, et chaque marchand payant aurait été bloqué au bout d'environ 33 jours.
   - La version d'API est maintenant figée (`2024-06-20`) sur tous les appels.
   - Les deux emplacements de la souscription sont lus.
2. **Fin de période fausse après un changement de formule.** Elle était lue sur la première ligne de la facture, qui peut être une ligne de prorata. Après un changement de formule, le marchand aurait été bloqué 3 jours après avoir payé.
   - Chaque événement relit maintenant la souscription chez Stripe (statut, fin de période, résiliation demandée, formule). L'ordre des événements, leurs doublons et leur version n'ont plus d'importance.
3. **Double paiement possible.** Au retour de Stripe, avant l'arrivée du webhook, l'écran proposait de payer à nouveau, ce qui créait une seconde souscription facturée en silence.
   - Le retour (`?abonnement=ok`) vérifie maintenant le paiement auprès de Stripe, en réessayant quelques secondes. Sinon il affiche « paiement en cours de confirmation, inutile de payer une seconde fois ».
   - Une nouvelle demande de paiement vérifie d'abord la précédente : déjà payée, elle est enregistrée ; encore ouverte, elle est annulée.
   - Le même client Stripe est réutilisé.

**Moyens**

4. **Boutiques fermées encore actives.** Après une fin ou un impayé, les publications et e-mails automatiques continuaient, avec des liens vers une boutique fermée (404). Ils s'arrêtent maintenant.
5. **Paiement refusé.** Le marchand était bloqué immédiatement, alors que Stripe réessaie pendant des jours. Il garde maintenant l'accès 7 jours pour régulariser.
6. **Hausse de formule jamais payée.** Le supplément était reporté à la facture suivante, qu'une résiliation effaçait. Désormais, il est facturé tout de suite, et une baisse s'applique à l'échéance, sans avoir.
7. **Événements en double.** Stripe renvoie parfois deux fois le même événement, ce qui provoquait des e-mails en double ou un statut remis à « actif ». Chaque événement n'est plus traité qu'une fois (identifiant gardé 30 jours).
8. **Résilier et reprendre** passaient par le portail Stripe, qui peut être réglé pour une résiliation immédiate. Ces actions passent maintenant par l'API (fin à l'échéance), comme le promettent l'écran et l'e-mail.
9. **« Essayer 30 jours »** alors qu'aucun essai gratuit n'existe : le bouton dit maintenant « Créer une boutique de démonstration ».

**Restent pour l'exploitant** (décisions de sa part, voir le rapport du matin) :
- choisir si les prix sont affichés hors taxes ou TTC, et collecter les numéros de TVA ;
- fixer une durée de conservation des données des comptes fermés ;
- prévoir un accès en lecture seule aux commandes après la fin d'un abonnement.

Tests : 63. Le test d'abonnement Stripe couvre aussi :
- la facture au nouveau format ;
- la ligne de prorata ;
- l'impayé avec un seul e-mail ;
- la résiliation par l'API.

### Cycle 46 — Relecture des cycles 44 et 45 : 9 défauts corrigés (05 h 40 – 05 h 45)

**Graves (introduits au cycle 45)**

1. **Webhook en échec jamais retraité.** L'événement était marqué « traité » avant son traitement. Si Stripe était injoignable à ce moment, sa nouvelle tentative était ignorée et le renouvellement perdu. La marque est maintenant retirée en cas d'échec : Stripe réessaie, et l'événement passe.
2. **Impayé gardé un mois entier.** Stripe passe déjà à la période suivante quand un renouvellement échoue, donc un impayé recevait un mois d'accès en plus, voire indéfiniment.
   - La fin de période n'avance plus que pour une période réellement payée ; l'impayé garde l'ancienne, plus 7 jours de grâce.
   - Une hausse de formule dont le paiement échoue ne change plus rien (`payment_behavior=error_if_incomplete`).

**Moyens et mineurs**

3. **E-mail « votre boutique est en ligne » perdu.** Il disparaissait quand le retour du client arrivait avant le webhook, ce qui est désormais le cas habituel. Il part maintenant à la première activation, quelle qu'en soit la source, et une seule fois.
4. **Clé d'idempotence de création de compte rejouée** après une suppression. Elle change maintenant toutes les 10 minutes.
5. **Liaison Stripe d'une boutique effacée sur une simple erreur de droits.** Seul un compte réellement inexistant est maintenant oublié.
6. **Souscription impayée ou suspendue laissée vivante chez Stripe.** Elle est maintenant arrêtée avant d'en créer une nouvelle, et à la suppression du compte.
7. **`?relancer=1` resté dans l'adresse.** Chaque rechargement renvoyait vers Stripe. Le paramètre est maintenant retiré après usage.
8. **Textes faux.**
   - La confirmation de changement de formule dit maintenant « facturé maintenant » pour une hausse, « dès la prochaine échéance » pour une baisse.
   - L'e-mail d'impayé annonce les 7 jours avant fermeture.
9. **TWINT proposé par le serveur pour un ancien compte** dont l'état était inconnu. Le serveur applique maintenant la même règle que la boutique : seulement si TWINT est connu comme actif.

Tests : 63 (le test Connect vérifie aussi qu’un webhook en échec est bien retraité à la tentative suivante).

### Cycle 47 — Nouveau marchand sur téléphone, en mode connecté (05 h 50 – 06 h 05)

Parcours complet sur iPhone 13, Pixel 7 et un écran de 360 × 640 :
- accueil, choix de formule, inscription, paiement, fiche entreprise, premier produit ;
- les 19 écrans et les 9 sections des Paramètres, puis l'éditeur ;
- la boutique publique : fiche produit, panier, paiement ;
- la commande reçue, puis expédiée.

**Ce qui fonctionne :** aucune erreur, rien ne déborde de l'écran sur l'application et la boutique. Les champs sont en 16 px, donc l'iPhone ne zoome pas à la saisie. Un écran s'ouvre en 1,5 s environ.

**Corrigé**

1. **Faux numéro de suivi envoyé au client.** « Expédier (générer le suivi) » inventait un numéro La Poste, même pour une vraie commande, et l'envoyait au client.
   - Le marchand saisit maintenant le numéro reçu du transporteur (facultatif).
   - Sans numéro, l'e-mail ne promet aucun suivi.
   - Seul le mode simulation fabrique encore un numéro, pour la démonstration.
   - Test ajouté.
2. **« Votre boutique est en ligne » annoncé trop tôt.** Après le paiement, le message et le badge l'annonçaient alors que l'adresse du vendeur manquait, et le serveur refusait donc les commandes. Le message indique maintenant la dernière étape, et le badge affiche « À compléter » tant que la boutique ne peut pas vendre.
3. **Adresse incomplète acceptée.** « Rue du Lac 12 », sans code postal ni localité, passait pour une adresse complète. La Conformité exige maintenant code postal et localité ; le champ montre un exemple et explique pourquoi.
4. **« Rédiger pour moi »** laissait « Décrivez ici sa matière… » dans la description, visible des clients. Ce texte n'est plus généré.
5. **Accueil sur téléphone.** « Se connecter » y était masqué ; il reste maintenant visible.
6. **Promesse sur les réseaux sociaux.** L'accueil disait « publie sur vos réseaux sociaux à votre place ». Il dit maintenant ce qui existe : publications préparées avec la formule Croissance, publication automatique dès que les API des réseaux sont branchées.
7. **Contenu sous le menu collant.** Le détail d'une commande et les bulles d'erreur passaient sous le menu ; ils restent maintenant visibles.
8. **Cibles tactiles agrandies** (40 px) : boutons − et + du panier, Fermer, menu, cases à cocher et boutons radio.
9. **Pages de paiement simulé** : un débordement de 14 px est corrigé.
10. « 1 étapes » devient « 1 étape ».
11. **Délai de livraison.** La fiche produit promettait une livraison plus rapide que l'envoi standard proposé dans le panier. Elle annonce maintenant le même délai.
12. **Encadré de marge.** Sans coût d'achat saisi, la marge reposait sur une estimation non signalée. L'encadré indique maintenant « estimé à 35 % du prix : saisissez le vôtre ».

13. **Éditeur sur téléphone.** Le choix Ordinateur / Mobile de l'aperçu, sans effet sur un téléphone, y est masqué, et la consigne est réécrite.

**Non traité cette nuit** (pour la suite) :
- fournisseurs du catalogue de démonstration marqués « (démo) » : ils disparaissent avec un vrai fournisseur.

Tests : 64.

### Cycle 48 — Relecture du cycle 47 : 2 régressions et 3 détails corrigés (06 h 05 – 06 h 10)

1. **Régression : « Annuler » expédiait quand même.** Annuler la question du numéro de suivi laissait le clic passer à la logique de démonstration : la commande s'affichait expédiée, avec un numéro inventé, jusqu'au rechargement. L'annulation arrête maintenant tout.
2. **Régression : interrupteurs déformés.** Sur téléphone et tablette, la nouvelle taille des cases à cocher (20 px) écrasait aussi les interrupteurs, devenus carrés. Les interrupteurs sont maintenant exclus de la règle.
3. **Commande expédiée par le fournisseur.** Le marchand n'a plus à donner de numéro de suivi : c'est le fournisseur qui le transmet.
4. **Lien de suivi La Poste suisse.** Pour une boutique suisse, tout numéro (par exemple un recommandé RR…CH) mène au suivi de La Poste suisse, et non plus au site de La Poste française.
5. **Une seule règle pour « adresse renseignée »**, la même pour le serveur, la boutique, le badge et le message de bienvenue. Le modèle « (adresse à compléter) » ne compte plus comme une adresse.
6. **Expédition groupée.** Elle prévient maintenant que les colis partent sans numéro de suivi, et indique comment en ajouter un.

Vérifié dans un vrai navigateur, en mode connecté : « Annuler » laisse la commande en préparation, et un numéro saisi est bien celui enregistré et envoyé au client.

Tests : 64.
