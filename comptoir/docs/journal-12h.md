# Journal du marathon de 12 heures (15 au 16 novembre 2026)

Demande : pendant 12 heures, du 15 novembre 21 h 30 au 16 novembre 9 h 30 (heure de Lausanne), rendre Comptoir mieux et plus complet que les plateformes comparables (Shopify, Wix, WooCommerce, PrestaShop…).

Méthode, la même que pour le marathon de 24 heures (voir `journal-24h.md`). Chaque chantier passe par ces étapes :
1. Implémentation complète, sans rien céder sur la sécurité.
2. Tests automatiques.
3. Parcours de bout en bout, vérification de l'interface dans un vrai navigateur (bureau et mobile), et simulation de 60 jours si le chantier touche les commandes.
4. Relecture indépendante, puis correction de chaque constat.
5. Note dans ce journal, commit et push.

Une relance automatique reprend le travail toutes les heures ; un rapport final est prévu le 16 novembre à 9 h 25.

## Point de départ

Comptoir couvre déjà beaucoup de choses : boutique en quatre langues, variantes, caisse, TWINT et QR-facture, cartes cadeaux, fidélité, devis, retours partiels, codes promo, stock multi-emplacements, API et webhooks, factures électroniques, chiffrement des données des clients, sécurité des comptes très poussée.

Ce qui manquait encore face aux plateformes comparables, d'après une recherche dans le code le 15 novembre à 21 h 30 :

- aucun moyen d'importer un catalogue existant depuis Shopify, WooCommerce ou PrestaShop : changer de plateforme demandait de tout ressaisir ;
- pas de produits numériques (fichiers à télécharger après l'achat) ;
- pas de précommandes ;
- pas de lots ni de coffrets composés d'autres produits ;
- pas de tarifs pour les clients professionnels ;
- pas de blog ni de pages de contenu.

## Feuille de route

Ordre de priorité : ce qui fait venir un marchand d'une autre plateforme, puis ce qui lui fait vendre plus.

70. **Import du catalogue** depuis un export CSV de Shopify, WooCommerce, PrestaShop ou un tableur simple : détection du format, aperçu ligne par ligne avant l'import, variantes et prix barrés repris, photos récupérées sans ouvrir le réseau interne du serveur, réimport sans doublon.
71. **Produits numériques** : fichier livré après paiement confirmé, lien personnel limité en durée et en nombre de téléchargements, révocable par le marchand.
72. **Précommandes** : vendre un article épuisé ou pas encore sorti, avec date d'expédition annoncée, plafond, et mention sur la facture et dans les e-mails.
73. **Lots et coffrets** : un produit composé de plusieurs autres, qui puise dans leur stock.
74. **Clients professionnels** : comptes pro avec remise, prix hors taxes, paiement sur facture avec plafond.
75. **Blog et pages de contenu** : articles en texte enrichi sûr (sans HTML libre), référencement (plan du site, données structurées).
76. **Comparaison honnête** avec les plateformes comparables, avec ses sources.

## Cycles

### Cycle 1 (21 h 40) : import du catalogue depuis une autre plateforme (chantier 70)

Changer de plateforme demandait jusqu'ici de ressaisir chaque produit à la main ; c'est le premier frein quand un marchand compare. Désormais, dans Produits, « Importer un catalogue » lit l'export CSV de Shopify, WooCommerce, PrestaShop ou d'un simple tableur.

- **Lecture du fichier** (module partagé `js/import-catalogue.js`, utilisé par le serveur et par la démonstration) :
  - CSV selon la norme RFC 4180 : guillemets, retours à la ligne dans un champ, marque BOM, séparateur virgule, point-virgule ou tabulation détecté ;
  - nombres à la suisse, à la française ou à l'anglaise (« 1'290.50 », « 1 290,50 », « CHF 12.– ») ;
  - format reconnu d'après les en-têtes que chaque plateforme écrit dans ses exports.
- **Ce qui est repris** :
  - Shopify : un produit par « Handle », ses variantes (deux options au plus), le prix barré (« Compare At »), le stock, le statut (brouillon importé masqué), la catégorie, la première photo ;
  - WooCommerce : produits simples et variables avec leurs variations rattachées au parent, prix promotionnel (le prix normal devient le prix barré) ;
  - PrestaShop et tableur : une ligne par produit ; le prix TTC est pris de préférence. Un produit dont seul le prix hors taxes est connu est importé masqué, « à vérifier », jusqu'à ce que le marchand confirme son prix de vente.
- **Sécurité** :
  - les descriptions HTML deviennent du texte : balises et scripts retirés, entités décodées, caractères de contrôle et d'inversion du sens d'écriture supprimés ;
  - noms, catégories et options sont bornés, et chaque produit repasse par la validation de la fiche produit ;
  - seules les photos en `https://` sont retenues ; elles sont téléchargées par le serveur avec les protections des webhooks : adresse résolue et vérifiée au moment de la connexion, aucune redirection suivie, 300 Ko au plus, et le contenu doit réellement être un JPEG, un PNG ou un WebP (signature des premiers octets) ;
  - limites : 2 Mo par requête, 20 000 lignes, 2 000 produits par import, 5 000 par boutique, 30 aperçus et 10 imports par heure ;
  - l'import est noté dans le journal du compte.
- **Aperçu avant tout** : format reconnu, nombre de produits à créer et déjà importés, tableau des 50 premiers, lignes ignorées avec leur numéro et leur raison, points à vérifier. Rien n'est écrit avant « Importer ».
- **Sans doublon** : chaque produit garde sa référence d'origine (« shopify:t-shirt-bio »), et un nouvel import du même fichier ne le recrée pas. Dans un même fichier, une référence répétée (dans un tableur sans colonne de référence : le même nom) n'est importée qu'une fois.
- **Limite, notée** : Comptoir garde toutes les combinaisons d'options (3 tailles × 2 couleurs = 6 variantes). Celles qu'un export Shopify n'avait pas sont créées avec un stock de 0, donc affichées épuisées.
- **Démonstration** : l'import marche aussi hors ligne, dans le navigateur, sans les photos.
- **Tests** :
  - lecture CSV et nombres ;
  - un export de chaque plateforme, avec HTML piégé, prix illisibles, types non gérés et variations orphelines ;
  - aperçu sans écriture, import, réimport sans doublon, fichiers refusés ;
  - téléchargement des photos : vraie image acceptée ; faux PNG, image trop lourde, redirection, adresse interne et nom qui pointe vers une adresse interne refusés.
- **Vérifié dans Chromium**, bureau et mobile :
  - aperçu, focus sur « Importer », produits créés ;
  - un nom piégé (`<img onerror>`) reste du texte ;
  - la capture mobile a fait revoir le tableau de l'aperçu (colonnes collées), corrigé.
- 237 tests sur 237, parcours de bout en bout 57/57, fuzzing sans constat.
- **Relecture indépendante** : tiennent la protection des téléchargements (hôtes en décimal ou octal normalisés, adresses mappées refusées, aucune fenêtre de re-résolution DNS), l'échappement de l'aperçu et de la boutique, l'autorisation (le rôle « Commandes » ne peut pas importer), la neutralisation des formules dans les exports CSV, et le non-écrasement d'une photo ajoutée à la main. Constats corrigés :
  - **Grave : blocage du serveur par un fichier piégé.** Les expressions qui retiraient les balises repartaient de chaque « < » : un champ de 20 000 « < » sans « > » coûtait 175 ms, et un fichier de 1,7 Mo bloquait le serveur 12 secondes à chaque aperçu. Le texte est maintenant borné à 12 000 caractères avant traitement, et les expressions ne peuvent plus repartir en arrière : moins d'une milliseconde pour les mêmes champs (testé).
  - **Moyen : amplification.** « Importer, tout supprimer, réimporter » pouvait se répéter et stocker chaque fois 2 000 photos et lancer 2 000 requêtes sortantes. Il y a maintenant un quota de 5 000 produits importés et de 5 000 photos téléchargées par boutique et par 24 heures.
  - **Bas** : une erreur pendant le téléchargement d'une photo arrêtait un des quatre téléchargements parallèles. Chaque photo est maintenant isolée, et l'erreur est notée.
  - **Bas** : doublons dans un même fichier, voir plus haut.
  - **Bas** : les valeurs d'options contenant « / » ou de plus de 30 caractères perdaient leur stock. Elles sont rangées comme la fiche produit le fait (testé).
  - **Documentation** : le prix hors taxes seul est désormais vraiment « à vérifier » (produit masqué), comme le journal le disait.
- Après corrections : 237 tests sur 237, parcours de bout en bout 57/57.

### Cycle 2 (21 h 55) : produits numériques (chantier 71)

Shopify, Wix ou WooCommerce vendent des fichiers à télécharger (livres, musique, patrons de couture, modèles, logiciels) ; Comptoir ne savait vendre que des objets. Désormais :

- **Côté marchand** :
  - la fiche produit a une case « Produit numérique » ;
  - une fois le produit enregistré, on y ajoute le fichier (PDF, EPUB, ZIP, MP3, MP4, images, documents… 25 Mo au plus, 200 Mo par boutique), avec une barre de progression ;
  - le stock reste un plafond facultatif (édition limitée) ;
  - un produit numérique sans fichier n'est pas mis en vente ;
  - dans une commande, « Renvoyer de nouveaux liens » révoque les anciens et en envoie de nouveaux.
- **Envoi du fichier** : en morceaux d'1 Mo, si bien que la limite de 2 Mo par requête reste la même partout (le serveur lit toujours jusqu'à 2 Mo avant d'authentifier, comme avant ce chantier). L'empreinte SHA-256 est calculée dans le navigateur et contrôlée par le serveur à la fin : un fichier tronqué, mélangé ou altéré n'est jamais enregistré. Les envois abandonnés sont effacés après une heure.
- **Côté client** :
  - un panier entièrement numérique remplace le choix de livraison par « envoi par e-mail », sans adresse ni frais de port ;
  - une case obligatoire fait accepter la livraison immédiate et la perte du droit de rétractation (directive 2011/83 art. 16 m ; Code de la consommation L221-28 13° ; CDE VI.53 13°), et sa date est gardée avec la commande ;
  - après le paiement, la page de confirmation l'annonce et l'e-mail contient les liens.
- **Liens de téléchargement** :
  - un par fichier, personnel, valable 30 jours et 5 téléchargements, décompté de façon atomique ;
  - seule l'empreinte du jeton est gardée dans la table des liens, et le lien est masqué dans le journal des e-mails dès l'envoi (voir la relecture) ;
  - une commande remboursée ou annulée ne télécharge plus rien ;
  - le fichier part toujours en pièce jointe (`application/octet-stream`, `Content-Disposition: attachment` avec nom nettoyé, CSP `sandbox`, pas de cache), si bien qu'un PDF ou un SVG piégé ne s'exécute jamais sur le domaine de Comptoir ;
  - limite de 60 téléchargements par heure et par réseau.
- **Commande entièrement numérique** : marquée livrée dès l'envoi des liens. Une commande mixte suit le chemin habituel ; ses fichiers partent tout de suite.
- **Limites, notées** :
  - l'e-mail des liens est en français seulement (pas encore dans la langue du client) ;
  - une vente à la caisse n'envoie pas de lien ;
  - la TVA des services numériques vendus à des particuliers de l'UE (taux du pays du client, guichet OSS) n'est pas encore calculée : le taux de la boutique s'applique.
- **Tests** :
  - noms de fichiers piégés (chemin, `.exe`, inversion du sens d'écriture) et en-tête de pièce jointe ;
  - envoi en 3 morceaux, morceau de mauvaise taille, empreinte fausse ;
  - produit sans fichier absent de la boutique ;
  - commande sans consentement refusée, sans adresse acceptée ; panier mixte sans livraison refusé ;
  - paiement, commande livrée, fichier téléchargé identique, en-têtes, 5 téléchargements puis refus ;
  - renvoi (ancien lien révoqué), remboursement (refus 410) ;
  - un autre marchand ne touche pas au fichier.
- **Vérifié dans Chromium**, bureau et mobile : création du produit, envoi d'un fichier de 1,6 Mo depuis la fiche, achat sans adresse avec consentement, paiement, lien reçu, fichier identique. La vérification a fait corriger trois défauts :
  - cocher « numérique » effaçait ce qui venait d'être tapé dans la fiche (le formulaire était redessiné) ;
  - un produit sans fichier restait en vente ;
  - la barre « livraison offerte » s'affichait pour un panier numérique.
- 239 tests sur 239, parcours de bout en bout 57/57.
- **Relecture indépendante** : rien de critique. Tiennent l'autorisation (le rôle « Commandes » ne peut ni envoyer, ni retirer, ni renvoyer), l'isolement entre boutiques, le calcul du panier (le caractère numérique vient du produit en base, jamais du client), le consentement exigé par le serveur, les en-têtes du téléchargement et les factures sans adresse. Constats corrigés :
  - **Moyen : quota contournable.** Il n'était vérifié qu'au début d'un envoi : 60 envois commencés ensemble pouvaient stocker 1,5 Go par heure. Les envois en cours comptent maintenant, et le quota est revérifié à la fin.
  - **Moyen : lien de téléchargement lisible dans le journal des e-mails.** Il restait en clair dans le contenu gardé et dans la liste des e-mails de l'espace marchand. Le masquage s'applique désormais à ces liens. Il couvrait en outre mal, depuis le chantier 62, les liens de changement d'adresse, d'annulation et de vérification d'e-mail : corrigé aussi (testé).
  - **Moyen : une requête HEAD consommait un téléchargement.** C'est ce que font les aperçus de lien et certains antivirus de messagerie. HEAD répond désormais sans rien décompter (testé). Un antivirus qui fait un vrai GET consomme encore un essai, et un téléchargement interrompu aussi : d'où les 5 essais et le renvoi par le marchand.
  - **Moyen : fichiers jamais effacés.** La suppression d'un compte efface maintenant ses fichiers, liens et envois. Le fichier d'un produit supprimé est retirable, et effacé automatiquement quand plus aucun lien payé n'est valable.
  - **Bas** :
    - une ligne numérique ne peut plus faire l'objet d'une demande de retour (rétractation renoncée) ;
    - si le fichier a été retiré entre la commande et le paiement, la commande le note et le marchand reçoit une alerte, au lieu d'un échec silencieux ;
    - le bouton de renvoi n'est plus affiché au rôle « Commandes » ;
    - retirer le fichier d'un produit d'une autre boutique répond 404.
- **Défaut découvert par le parcours de bout en bout** (en préparant le chantier 72) : une fonction de la boutique portait le même nom qu'une fonction de l'espace marchand. Les deux fichiers se chargent ensemble, et le second plantait au chargement. Renommée ; le parcours repasse.
- Après corrections : 240 tests sur 240, parcours de bout en bout 57/57, simulation de 100 marchands sur 60 jours sans anomalie (9 053 commandes).

### Cycle 3 (22 h 05) : précommandes (chantier 72)

Vendre un article avant qu'il arrive (nouvelle collection, livre à paraître, réassort) est courant sur les autres plateformes, souvent par une extension payante. Le modèle choisi ne change aucune règle de stock, et ne fait donc courir aucun risque de vente en double :

- **Fiche produit** : case « Précommande » et date d'expédition prévue, de demain à un an (jour de Lausanne, vérifié par le serveur). Le stock indique combien d'exemplaires peuvent être précommandés. Un produit numérique n'est jamais en précommande.
- **Boutique** :
  - la carte et la fiche du produit affichent « Précommande · expédition prévue le … » au lieu du délai habituel ;
  - le bouton devient « Précommander », puis « Précommandes complètes » quand le plafond est atteint ;
  - le panier annonce la date d'expédition (la plus tardive si plusieurs articles), toute la commande partant en une fois, et le choix de livraison montre cette date au lieu du délai habituel.
- **Commande** : chaque ligne précommandée garde sa date. Elle figure dans l'e-mail de confirmation, en français, allemand, italien et anglais : la date de livraison doit être annoncée (France, Code de la consommation L111-1 3°). Elle figure aussi dans le détail de la commande côté marchand, et la liste des produits porte un badge.
- **Date dépassée** (fiche non mise à jour) : plus annoncée, plus reportée sur les nouvelles commandes ; l'article se vend normalement.
- **Au passage** : le récapitulatif des e-mails nommait le mode « numérique » par son code ; il dit maintenant « envoi par e-mail ».
- **Limites, notées** :
  - pas de rappel automatique au marchand à l'approche de la date ;
  - pas de paiement différé (le client paie à la commande, comme chez la plupart des plateformes).
- **Tests** :
  - date exigée, passée ou à plus d'un an : refusée ;
  - produit numérique jamais en précommande ;
  - vitrine publique, ligne de commande et e-mail avec la date ;
  - date dépassée : plus reportée.
- **Vérifié dans Chromium**, bureau et mobile :
  - fiche marchand, badge, carte, fiche produit, bouton « Précommander », note du panier ;
  - aucune erreur de page.
- 240 tests sur 240, parcours de bout en bout 57/57.
- **Relecture indépendante** : pas de faille d'injection (chaque chemin d'écriture réécrit la date au format AAAA-MM-JJ, et chaque affichage l'échappe) ; variantes cohérentes. Constats corrigés :
  - **Grave : produit bloqué après sa date.** Une fois la date passée, le serveur refusait tout enregistrement du produit : fiche (même pour changer le prix), synchronisation par l'API (qui renvoie la fiche entière), et même la restauration complète de la boutique, faite d'un seul bloc. Une date passée retire maintenant simplement la précommande, sans erreur, comme le journal l'annonçait (testé : prix modifié après la date). Le champ de date n'a plus de minimum qui bloquait le formulaire.
  - **Moyen** : « à partir de demain » était vérifié sur l'heure UTC (la date du jour passait jusqu'à midi UTC). C'est désormais le jour de Lausanne.
  - **Moyen** : au passage en caisse, le choix de livraison affichait encore « 2 à 3 jours » à côté de la précommande. Il affiche la date d'expédition prévue.
  - **Bas** : le panier et l'e-mail emploient la même formulation (« expédition prévue le … ») ; la référence juridique est corrigée (L111-1 3°, et non L216-1).

### Cycle 4 (22 h 10) : lots et coffrets (chantier 73)

Les coffrets cadeaux, les lots « 3 pour 2 » et les kits sont un classique du commerce de détail ; ailleurs, ils passent souvent par une extension payante qui synchronise mal le stock. Désormais :

- **Fiche produit** : case « Lot ou coffret », puis de 2 à 10 lignes produit et quantité, avec ajout et retrait. Ce qui a déjà été tapé dans la fiche n'est pas perdu.
- **Composants admis** : produits en stock simples de la même boutique. Le serveur refuse les produits à variantes, les produits numériques, ceux en dropshipping, un autre lot et le lot lui-même. Un produit déjà dans un lot ne peut pas devenir l'un d'eux tant qu'il y reste (voir la relecture).
- **Stock calculé** : nombre de lots complets que permettent les composants. Le stock saisi pour le lot est ignoré. Un composant peut être masqué de la boutique, pour n'être vendu que dans le lot.
- **Vente** :
  - ce sont les composants qui baissent, emplacements compris ;
  - la ligne du lot garde ce qui a été retiré de chacun ;
  - un retour partiel puis un remboursement rendent exactement ce qui a été pris, jamais deux fois (testé : 2 coffrets vendus, 1 rendu, puis remboursement du reste : stock revenu à l'identique).
- **Paiements en cours** :
  - un lot en attente de paiement retient ses composants ;
  - le stock des lots est recalculé après ces réservations, au moment de la commande comme de la reprise d'un paiement ;
  - un panier qui mêle lots et composants est contrôlé sur la somme de ce qu'il demande à chaque composant.
- **Boutique** : la fiche du lot affiche « Contient : 2 × Savon, 1 × Bougie ». Les identifiants et le stock des composants ne sont pas publiés.
- **Limite, notée** : en démonstration hors ligne, le stock d'un lot n'est pas recalculé.
- **Tests** :
  - compositions refusées ;
  - stock calculé avec un composant masqué ;
  - contenu publié sans identifiants ;
  - panier mixte au-delà du stock refusé ;
  - composants retenus pendant un paiement ;
  - vente, retour partiel, remboursement.
- **Défaut découvert par les tests** : une variable mal nommée dans le calcul des réservations faisait échouer toute reprise de paiement (erreur 500). Quatre tests existants l'ont signalée, et c'est corrigé avant commit.
- **Vérifié dans Chromium**, bureau et mobile :
  - composition dans la fiche (nom et quantités conservés à l'ajout et au retrait d'une ligne), stock calculé, contenu affiché dans la boutique ;
  - aucune erreur de page ;
  - au passage, les cases à long libellé de la fiche (numérique, lot, précommande) sont alignées en haut.
- 241 tests sur 241, parcours de bout en bout 57/57.
- **Relecture indépendante** : aucune fuite (identifiants et stock des composants non publiés), pas de boucle possible entre lots, dropshipping et « vendable » corrects. Constats corrigés :
  - **Grave : un composant pouvait changer après coup.** On pouvait lui ajouter des variantes, et ses ventes par le lot étaient alors effacées à la somme suivante des variantes. On pouvait le rendre numérique, et aucun lien n'était envoyé. On pouvait en faire un lot, ce qui imbriquait des lots mal réservés. Un produit utilisé dans un lot doit maintenant rester un produit en stock simple ; un changement de prix ou de stock reste possible (testé).
  - **Grave : remboursement d'un lot redevenu produit simple.** Le retour se basait sur la fiche actuelle et non sur ce que la ligne avait pris : les composants n'étaient pas rendus, et du stock fantôme apparaissait sur l'ancien lot. Il suit maintenant la ligne (testé).
  - **Moyen** : le contrôle « lots et composants dans le même panier » ne valait que pour la boutique en ligne. Il s'applique aussi à la caisse (hors ventes hors ligne, déjà encaissées) et à la reprise d'un paiement.
  - **Bas** :
    - à l'inscription avec des produits de démonstration (ou à une restauration), les lots gardent leurs composants : les identifiants sont repris, et un lot devenu invalide est gardé comme produit simple ;
    - la composition des lots est lue une seule fois par boucle de réservation au lieu d'une requête par ligne, et relue après toute écriture.
  - **Non corrigé, noté** : un retour d'articles abîmés (sortis du stock) ne réduit pas la trace des emplacements des composants. Le total rendu ensuite reste juste, mais pas forcément l'emplacement. Les lots n'émettent pas l'événement « rupture » propre.
  - **Défaut introduit par la correction et rattrapé avant commit** : à l'inscription, les produits sans identifiant recevaient tous le même nouvel identifiant, et le test des retours partiels restait bloqué. Corrigé : un identifiant par produit.
- Après corrections : 241 tests sur 241, parcours de bout en bout 57/57.

### Cycle 5 (22 h 35) : clients professionnels (chantier 74)

Vendre aux professionnels (hôtels, restaurants, revendeurs) avec leurs propres prix est réservé, chez Shopify, à la formule la plus chère (B2B de Shopify Plus) ; ailleurs, il faut une extension. Désormais :

- **Côté marchand, Paramètres > Clients pro** : ouverture de comptes pro avec raison sociale, e-mail de commande, numéro de TVA ou IDE, remise de 0 à 50 %, paiement sur facture QR et plafond des factures impayées.
  - E-mail et raison sociale sont chiffrés au repos, comme les données des clients des commandes.
  - On cherche un compte en déchiffrant la liste de la boutique (500 comptes au plus), pas par un index : une rotation des clés ne rend jamais un client pro introuvable.
  - La facture n'est proposable qu'avec un IBAN suisse valide et l'adresse complète de l'entreprise.
- **Côté client, « Espace pro » dans le pied de page** :
  - e-mail, puis code à 6 chiffres reçu par e-mail : 15 minutes, 5 essais, lié à la demande du navigateur qui l'a faite ;
  - même réponse qu'une adresse ait un compte pro ou non (aucun e-mail envoyé sinon) ;
  - au plus 5 codes par adresse et 10 par réseau et par heure, et 20 échecs de connexion par réseau ;
  - ensuite, un jeton de 30 jours, dont seule l'empreinte est gardée ;
  - le panier affiche « Tarif professionnel (−15 %) », masque le code promo et propose la facture si le compte y a droit.
- **Commande** : tout est relu par le serveur à partir du jeton.
  - La remise du compte remplace les paliers, avec les mêmes arrondis au centime que le panier.
  - Il faut commander avec l'adresse du compte pro. Aucun cumul avec un code promo ou des points.
  - La facture est possible même si la boutique ne la propose pas au public, et le plafond compte les factures pro encore impayées.
  - Le compte pro est gardé avec la commande. Un compte supprimé ferme sa session.
- **Limites, notées** :
  - la facture PDF n'affiche pas encore la raison sociale ni le numéro de TVA de l'acheteur (ils sont dans la commande) ;
  - pas d'autoliquidation de la TVA pour les clients professionnels de l'Union européenne ;
  - pas de prix par produit propres à un client (une remise globale par compte).
- **Tests** :
  - validation des comptes, doublon, chiffrement au repos ;
  - code : adresse inconnue sans e-mail, faux code, code d'une autre demande, usage unique ;
  - commande : remise appliquée (100 → 85), autre adresse, code promo, jeton inconnu refusés ;
  - facture pro alors que la boutique ne la propose pas au public, plafond atteint refusé, facture refusée sans compte pro ;
  - compte supprimé : session fermée.
- **Vérifié dans Chromium**, bureau et mobile :
  - ouverture du compte dans les Paramètres, puis connexion dans la boutique avec le code reçu ;
  - panier au tarif pro avec l'option facture, commande enregistrée à 85 ;
  - aucune erreur de page ;
  - la capture mobile a fait passer le tableau des comptes pro en cartes (colonnes qui se chevauchaient).
- 242 tests sur 242, parcours de bout en bout 57/57.

