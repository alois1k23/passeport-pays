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

**Deuxième phase** (ajoutée le 15 novembre vers 22 h 50 : la première avance plus vite que prévu ; elle reprend d'abord les limites notées en chemin) :

77. **Facture d'un client pro** : l'entreprise et son numéro de TVA ou IDE sont l'acheteur, sur la facture QR, la facture électronique et le PDF.
78. **Produits numériques, suite** : e-mail des liens dans la langue du client, liens aussi après une vente en caisse.
79. **Précommandes, suite** : rappel au marchand avant la date d'expédition annoncée.
80. **Abonnements de produits** (livraison récurrente : café, cosmétiques, fleurs), sans extension.

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

Vendre aux professionnels (hôtels, restaurants, revendeurs) avec leurs propres prix demande souvent, sur les autres plateformes, une formule haut de gamme ou une extension (à vérifier plateforme par plateforme au chantier 76, sources à l'appui). Désormais :

- **Côté marchand, Paramètres > Clients pro** : ouverture de comptes pro avec raison sociale, e-mail de commande, numéro de TVA ou IDE, remise de 0 à 50 %, paiement sur facture QR et plafond des factures impayées.
  - E-mail et raison sociale sont chiffrés au repos, comme les données des clients des commandes.
  - On cherche un compte en déchiffrant la liste de la boutique (500 comptes au plus), pas par un index : une rotation des clés ne rend jamais un client pro introuvable.
  - La facture n'est proposable qu'avec un IBAN suisse valide et l'adresse complète de l'entreprise.
- **Côté client, « Espace pro » dans le pied de page** :
  - e-mail, puis code à 6 chiffres reçu par e-mail : 15 minutes, 5 essais, lié à la demande du navigateur qui l'a faite ;
  - même réponse qu'une adresse ait un compte pro ou non (aucun e-mail envoyé sinon) ;
  - au plus 5 codes par adresse et 10 par réseau et par heure ; 20 échecs de connexion par réseau, et 20 par compte sur 24 heures tous réseaux confondus (voir la relecture) ;
  - ensuite, un jeton de 30 jours, dont seule l'empreinte est gardée ;
  - le panier affiche « Tarif professionnel (−15 %) », masque le code promo et propose la facture si le compte y a droit.
- **Commande** : tout est relu par le serveur à partir du jeton.
  - La remise du compte remplace les paliers, avec les mêmes arrondis au centime que le panier.
  - Il faut commander avec l'adresse du compte pro. Aucun cumul avec un code promo ou des points.
  - La facture est possible même si la boutique ne la propose pas au public, et le plafond compte les factures pro encore impayées.
  - La raison sociale et le numéro de TVA sont gardés avec les données chiffrées du client de la commande, et affichés dans son détail côté marchand. Un compte supprimé ferme sa session.
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
- **Relecture indépendante** : rien de critique. Tiennent les réponses identiques (pas de repérage des comptes), le plafond face aux commandes simultanées, l'absence de CSRF (jeton dans le corps, pas de cookie), l'échappement de tout affichage, l'interdiction au rôle « Commandes », la reprise d'un paiement (montant déjà remisé), la TVA par ligne remisée. Constats corrigés :
  - **Moyen** : un pro sans droit à la facture, dans une boutique qui la propose au public, échappait à la limite de factures par adresse. Cette limite n'est maintenant levée que si le plafond pro a réellement été vérifié.
  - **Moyen** : avec le tarif pro, une ligne d'offre du panier gardait sa quantité brute, et la remise enregistrée devenait négative (le total restait juste). Les offres ne s'appliquent plus au tarif pro, et le sous-total est recalculé.
  - **Bas** :
    - force brute des codes : 25 essais par heure et par compte restaient possibles depuis plusieurs réseaux. Au 20e échec en 24 heures, le compte est bloqué (plus de code, plus de connexion) et le marchand est prévenu (testé) ;
    - la raison sociale et le numéro de TVA étaient en clair dans la commande ; ils rejoignent les données chiffrées du client (testé) ;
    - l'effacement d'un client (droit à l'effacement) supprime aussi son compte pro ;
    - l'en-tête du module annonçait des prix hors taxes : ce sont des prix TTC remisés.
  - **Noté** : le plafond ne compte que les factures encore en attente. Un marchand qui expédie à crédit en marquant la commande payée libère le plafond avant le paiement réel.
- Après corrections : 242 tests sur 242, parcours de bout en bout 57/57.

### Cycle 6 (22 h 45) : journal de la boutique (chantier 75)

Les autres plateformes ont un blog intégré ; c'est un levier de référencement pour une petite boutique (conseils, coulisses, nouveautés). Désormais :

- **Paramètres > Journal** : titre, résumé (repris dans la liste et par les moteurs de recherche), texte et case « Publié ». L'aperçu est rendu par le serveur, donc identique à la page publique, sans perdre la saisie.
- **Texte enrichi sûr** : « ## » et « ### » pour les intertitres, **gras**, *italique*, listes, et liens [texte](https://…).
  - Le texte est échappé d'abord, puis seuls ces motifs deviennent des balises : aucun HTML saisi ne passe, même maquillé.
  - Les liens ne sont que https, avec `rel="nofollow noopener"`.
  - Testé : `<script>`, `<img onerror>`, liens `javascript:` et `data:`, guillemets dans une adresse, balise dans du gras.
- **Pages publiques rendues par le serveur**, à `/s/<boutique>/journal` et `/journal/<article>`, et à `/journal` sur un domaine personnalisé :
  - HTML complet, lisible sans JavaScript ;
  - titre, description, adresse canonique, Open Graph, données structurées (Blog, BlogPosting) ;
  - feuille de style fixe autorisée par son empreinte (la politique de sécurité reste stricte) ;
  - un brouillon ou une adresse inconnue répond 404 ;
  - une boutique sans abonnement actif n'est pas indexée.
- **Plan du site** : le journal et chaque article publié y figurent.
- **Boutique** : lien « Journal » en bas de page dès le premier article publié.
- **Adresses** : tirées du titre, sans accents ; un -2, -3… s'ajoute si l'adresse est prise. Au plus 300 articles par boutique.
- **Défaut trouvé par les tests** : l'aperçu répondait en page HTML au lieu de JSON, parce que le routeur sert telle quelle toute réponse qui porte une clé `html`. La clé est renommée.
- **Limites, notées** :
  - pas d'image dans les articles ;
  - pas de version traduite des articles ;
  - pas de commentaires.
- **Tests** :
  - texte enrichi et injections ;
  - adresse unique, brouillon absent de la liste, de la page et du plan du site ;
  - article publié avec intertitre, gras, données structurées et adresse canonique ;
  - nom de boutique échappé ;
  - modification, suppression, aperçu.
- **Vérifié dans Chromium**, bureau et mobile :
  - écriture avec aperçu, publication, lien en pied de boutique, liste, article ;
  - lecture sans JavaScript ;
  - aucune erreur de page ni de console.
- 244 tests sur 244, parcours de bout en bout 57/57, fuzzing sans constat.

- **Relecture indépendante** : aucune injection possible (les balises ajoutées ne contiennent jamais de guillemet, et une adresse ne peut pas sortir de son attribut), aucun accès à l'article d'une autre boutique, aucun brouillon visible, rôle « Commandes » refusé, feuille de style bien autorisée. Constats corrigés :
  - **Moyen** : le résumé tiré du texte (quand le marchand n'en écrit pas) utilisait une expression coûteuse. Un texte piégé de 40 000 « [ » prenait 600 ms à chaque affichage de l'article, de quoi bloquer le serveur en le rechargeant. Calcul borné aux 2 000 premiers caractères avec une expression linéaire (testé).
  - **Moyen** : l'adresse d'un article changeait à chaque renommage, ce qui cassait les liens déjà partagés. Elle reste maintenant, sauf adresse demandée explicitement (testé).
  - **Moyen** : une boutique sans abonnement actif continuait de servir ses articles en entier : hébergement gratuit de textes et de liens sur le domaine de la plateforme, utile pour du hameçonnage. Son journal n'est plus servi (404, liste vide, testé).
  - **Bas** : les listes et le compteur public ne lisent plus le texte des articles ; l'éditeur du marchand reçoit les articles complets. Les liens de l'aperçu s'ouvrent dans un nouvel onglet, sans perdre la saisie.
- Après corrections : 244 tests sur 244.

### Cycle 7 (22 h 50) : facture d'un client pro (chantier 77)

La relecture du chantier 74 avait noté que la facture d'un client pro ne montrait que le nom de la personne. Désormais :

- **Facture QR imprimable** : l'entreprise en tête, son numéro de TVA ou IDE, puis « À l'attention de » la personne qui a commandé.
- **Facture électronique (XML EN 16931)** : l'entreprise est l'acheteur (BuyerTradeParty), avec son numéro de TVA s'il a la forme d'un numéro européen.
- **PDF Factur-X** : l'entreprise est l'acheteur, avec son numéro et la mention « À l'attention de ».
- **Tests** : la facture QR et le XML d'une commande pro portent la raison sociale et le numéro.
- **Non traité, noté** : l'autoliquidation de la TVA pour un client professionnel de l'Union européenne (mention et taux zéro). Elle demande de vérifier le numéro de TVA (VIES), ce que Comptoir ne fait pas encore.
- 244 tests sur 244.


### Cycle 8 (22 h 40) : produits numériques, suite (chantier 78)

- **Langue du client** : une commande passée en allemand, en italien ou en anglais reçoit ses liens de téléchargement dans sa langue.
- **Vente en caisse** :
  - un ticket qui contient un produit numérique affiche le champ « E-mail du client » ;
  - sans adresse, le serveur refuse la vente avec un message clair ;
  - les liens partent après l'enregistrement de la vente, jamais pour une vente annulée ;
  - un ticket renvoyé (même clé, réseau coupé) n'envoie pas un second e-mail.
- **Vente hors ligne sans e-mail** : la vente est acceptée, puisqu'elle est déjà encaissée. Dans la commande, « Envoyer les liens » demande l'adresse du client et la garde.
- **Défaut trouvé par le test** : un lien acheté en caisse (statut « retirée ») était refusé au téléchargement. Les statuts « prête » et « retirée » sont maintenant acceptés, pour le téléchargement comme pour le renvoi.
- **Vérifié dans Chromium**, bureau et mobile : champ affiché, refus sans adresse, vente encaissée, e-mail envoyé au client.
- 244 tests sur 244, parcours de bout en bout 57/57.

### Cycle 9 (22 h 50) : comparaison sourcée (chantier 76)

- **`docs/COMPARAISON.md`** compare Comptoir à Shopify, Wix, WooCommerce, PrestaShop et Infomaniak. Les données ont été relevées le 15 novembre 2026 sur les pages officielles, avec les liens. Ce qui n'a pas pu être confirmé est noté « non vérifié ».
- **Correction d'une affirmation du journal** : il était dit que le B2B de Shopify était réservé à Plus. C'est faux depuis avril 2026 : les bases du B2B existent dès Basic. Seuls les prix propres à chaque entreprise restent sur Plus.
- **Ce que la comparaison dit honnêtement** :
  - Comptoir réunit en natif la QR-facture, le B2B avec prix par client, l'absence de frais de plateforme, les précommandes, les lots et les produits numériques.
  - Les autres plateformes ont ce que Comptoir n'a pas : le recul, les extensions, les thèmes, et une offre hébergée en Suisse chez Infomaniak.

### Cycle 10 (22 h 55) : rappel des précommandes au marchand (chantier 79)

- **Trois jours avant la date d'expédition annoncée**, le marchand reçoit un e-mail si des commandes payées attendent ce produit. L'e-mail donne le nombre de commandes, le nombre d'articles et les numéros, avec le lien vers Commandes.
- **Si la date passe** et que des commandes restent à expédier, un second e-mail l'invite à prévenir les clients du nouveau délai, ou à rembourser ceux qui le souhaitent.
- **Un seul e-mail par produit et par date** (réservation d'envoi en base). Rien n'est envoyé une fois les commandes expédiées, ni à une boutique sans abonnement actif.
- **Calcul** : au plus une fois par heure, seulement sur les produits en précommande, avec les dates au jour de Lausanne.
- **Tests** : rien 10 jours avant, un rappel à J-2 même si le calcul repasse, un rappel de retard, rien après l'expédition.
- **Navigateur** : rien à vérifier, puisque la fonction ne touche pas l'interface (e-mail seulement).
- 244 tests sur 244.

### Cycle 11 (23 h 00) : relecture indépendante des chantiers 77 et 78

Aucune faille bloquante. Constats corrigés :

- **Moyen, e-mails vers des adresses saisies** : la caisse et le renvoi de liens envoyaient un e-mail de la boutique à n'importe quelle adresse tapée, même depuis un compte dont l'adresse n'était pas confirmée. Quelqu'un aurait pu s'en servir pour envoyer des messages à des inconnus. Corrigé :
  - adresse du compte confirmée exigée (comme pour les devis et les invitations) ;
  - 100 adresses saisies par jour et par boutique au plus (testé).
- **Moyen, vente hors ligne bloquée** : une vente faite hors ligne avec une adresse mal tapée (« jean@gmail ») était refusée au retour du réseau, et restait coincée dans la file. Désormais :
  - une vente hors ligne n'est jamais refusée pour l'adresse ;
  - la commande est signalée « envoyez les liens depuis la commande » (testé) ;
  - l'adresse n'est contrôlée que si le ticket contient un produit numérique.
- **Bas, caisse et produit sans fichier** : en caisse, un produit numérique sans fichier se vendait sans rien envoyer. Il est maintenant refusé en ligne et signalé hors ligne. L'envoi des liens est noté dans l'historique de la commande.
- **Bas, ticket compté deux fois** : une erreur après l'enregistrement de la vente, mais avant celui de la clé du ticket, pouvait faire compter la vente deux fois au renvoi. La clé est maintenant enregistrée dans la même transaction que la vente, et l'envoi de l'e-mail ne peut plus produire d'erreur 500.
- **Bas, données effacées** : une commande dont le client a été effacé ne peut plus recevoir une nouvelle adresse. Seule une vente en caisse sans adresse le peut (testé).
- **Bas, numéro du client pro** : le PDF, le XML et la facture QR appliquaient des règles différentes. Il n'y a plus qu'une règle :
  - une IDE suisse sans la mention TVA, MWST ou IVA n'est pas un numéro de TVA : elle est affichée « IDE » et n'est plus transmise comme numéro de TVA ;
  - les minuscules et la mention en fin de numéro sont gérées ;
  - « À l'attention de » a sa propre ligne sur le PDF (l'adresse n'est plus coupée).
- **Sans objet** :
  - une ligne numérique ne peut pas être retournée (exclue des retours depuis le chantier 71) ;
  - un lien reste donc valable tant que la commande n'est pas remboursée en entier.
- **Noté, non changé** :
  - les e-mails de caisse partent en français (la langue du client n'est pas connue au comptoir) ;
  - le lien de téléchargement figure dans le corps de l'e-mail gardé 7 jours, que le marchand voit déjà. Le commentaire « jamais gardé en clair » ne concerne que la table des liens.
- Après corrections : tests de la caisse, du numérique et des clients pro réussis, parcours de bout en bout 57/57, caisse revérifiée dans Chromium (bureau et mobile). Dans la suite complète, le test du flux en direct a échoué une fois (délai dépassé, machine chargée par d'autres tests). Relancé seul trois fois, il a réussi chaque fois : il ne touche à rien de ce qui a changé.

### Cycle 12 (23 h 05) : rappels de réassort (chantier 80)

Pour un produit qui s'épuise, le client peut demander à être prévenu au moment de recommander. Ce n'est pas un abonnement payant : un débit automatique demanderait de garder un moyen de paiement et un mandat, ce qui n'est pas fait ici.

- **Marchand** : sur la fiche produit, il indique un délai de 7 à 180 jours (produits sans variantes ni fichier).
- **Client** : la case « Me rappeler par e-mail de recommander dans N jours » n'est jamais cochée d'office. Le délai retenu est le plus court parmi les produits concernés.
- **Création** : la demande est enregistrée après le paiement, avec l'adresse chiffrée et un index pour l'effacement. Une nouvelle commande du même client pour les mêmes produits remplace l'ancienne demande.
- **Envoi** : au plus 12 rappels, calculés au plus une fois par heure.
  - L'e-mail est dans la langue de la commande (fr, de, it, en).
  - Le lien remplit le panier, avec seulement les produits encore en vente et en stock.
  - Rien ne part pour une boutique sans abonnement ou pour un client désinscrit des e-mails de la boutique.
- **Arrêt** : un lien signé (HMAC, rien de secret gardé) ouvre une page de confirmation. Un aperçu de lien n'arrête donc rien ; seul le bouton arrête les rappels.
- **Effacement** : les demandes disparaissent avec l'effacement des données du client et avec la suppression de la boutique.
- **Défaut trouvé par la vérification dans le navigateur** : la fiche produit en ligne passe par un second formulaire (serveur.js), qui n'envoyait pas le délai. Corrigé.
- **Tests** :
  - délai refusé hors limites ;
  - aucune demande sans la case ;
  - délai le plus court, produits sans rappel exclus du panier ;
  - adresse chiffrée ;
  - pas de doublon dans l'heure, deuxième rappel au délai suivant ;
  - page d'arrêt sans effet en GET, signature fausse refusée ;
  - rappel en allemand ;
  - effacement du client.
- **Vérifié dans Chromium**, bureau et mobile : champ de la fiche, case non cochée dans le panier, commande, rappel, lien du panier rempli, page d'arrêt. Aucune erreur.

### Cycle 13 (23 h 10) : produits sous les articles du journal (chantier 81)

Un article de conseils (« Entretenir le lin ») mène maintenant directement aux produits dont il parle.

- **Éditeur** : le marchand coche jusqu'à six produits ; une septième case est refusée avec un message.
- **Page de l'article** : une section « Dans la boutique », rendue par le serveur, avec photo, nom, prix et lien vers la page du produit. Elle est lisible sans JavaScript.
- **Contrôles** :
  - le serveur ne garde que des produits de la boutique, sans doublon, six au plus ;
  - un produit masqué, épuisé ou supprimé disparaît de la page sans toucher à l'article ;
  - les noms sont échappés.
- **Tests** : produit d'une autre boutique et doublon retirés, nom piégé échappé, prix affiché, produit masqué retiré, limite de six.
- **Vérifié dans Chromium**, bureau et mobile :
  - choix des produits dans l'éditeur ;
  - cartes affichées sous l'article, avec les photos chargées malgré la politique de sécurité du contenu ;
  - aucune erreur.

### Cycle 14 (23 h 15) : précommandes dans « À faire » (chantier 82)

- **Vue d'ensemble** : le bloc « À faire » liste les précommandes payées à expédier, regroupées par produit et par date annoncée (5 au plus, la plus proche d'abord). Ce rappel complète l'e-mail du chantier 79.
- **Signalement** : une date dans les 3 jours est marquée en alerte, une date passée est affichée « en retard ». Les dates sont celles du jour de Lausanne.
- **Vérifié dans Chromium**, bureau et mobile, avec deux produits en précommande (dans 2 jours et dans 20 jours) : le premier est en alerte, le second non. Aucune erreur.
- Rien ne change côté serveur, les tests existants couvrent les données utilisées.

### Cycle 15 (23 h 15) : relecture indépendante des chantiers 79 et 80

Aucune faille critique. La relecture a surtout trouvé des rappels qui continuaient alors qu'ils n'auraient pas dû. Corrigés et testés :

- **Moyen** : une commande remboursée ou annulée gardait son rappel de réassort. La demande retient maintenant sa commande d'origine et tombe au remboursement ou à l'annulation, quel que soit le chemin (testé).
- **Moyen** : un client qui recommandait sans recocher la case recevait quand même son ancien rappel, parfois quelques jours après. Toute commande payée remet à zéro ses rappels pour les mêmes produits (testé).
- **Moyen** : des demandes mortes restaient en base des années (produit supprimé, boutique réinitialisée). Elles sont supprimées au passage suivant, et aucune demande ne dure plus de deux ans (testé).
- **Moyen** : pour une précommande, le délai partait du paiement. Il part maintenant de la date d'expédition annoncée (testé).
- **Moyen** : les rappels n'avaient pas d'en-tête de désinscription. Chaque rappel porte maintenant l'en-tête List-Unsubscribe (arrêt en un clic, RFC 8058) vers son propre lien d'arrêt (testé).
- **Bas** :
  - une ligne illisible ne bloque plus tous les rappels (erreur isolée) ;
  - l'envoi se fait par lots jusqu'à épuisement (20 secondes au plus) ;
  - chaque rappel est réservé de façon atomique, donc pas de doublon si plusieurs processus tournent ;
  - une commande marquée payée à la main (facture QR, virement) crée sa demande comme un paiement en ligne (testé) ;
  - l'effacement d'un client se fait dans la même transaction que le reste ;
  - l'export des données d'un client indique ses rappels ;
  - une demande refusée à cause de la limite par boutique est journalisée ;
  - le rappel des précommandes ne relit plus les commandes d'un produit déjà rappelé.
- **Noté, non fait** :
  - (le suivi des rappels côté marchand et la mention dans la confirmation sont faits au cycle 17) ;
  - un produit réenregistré après sa date de précommande perd l'état « précommande », et son rappel de retard n'est alors pas envoyé.

### Cycle 16 (23 h 15) : audit d'accessibilité automatique de la boutique (chantier 83)

- **Audit** : le script `outils/simulation/accessibilite-boutique.js` complète `accessibilite.js`, qui couvre les écrans du marchand. Il contrôle quatre pages publiques (accueil, produit, panier ouvert, article du journal), sur bureau et sur mobile. Il vérifie :
  - la langue de la page et l'unicité des identifiants ;
  - les noms accessibles des boutons et des liens, les libellés des champs, le texte alternatif des images ;
  - l'ordre des titres (un seul h1, aucun niveau sauté) ;
  - les contrastes, selon les seuils WCAG AA ;
  - la taille des cibles tactiles sur mobile (24 px, WCAG 2.2 AA).
- **Résultat sur bureau** : aucun constat.
- **Résultat sur mobile** :
  - les titres des cartes produit (19 px de haut) et le lien « Tous les articles » du journal étaient trop petits. Ils sont corrigés et font maintenant 24 px au moins ;
  - restent des cases à cocher de 20 px placées dans leur libellé (toute la ligne est cliquable) et le lien « CGV » au milieu d'une phrase. Les deux relèvent des exceptions prévues par WCAG 2.2.
- **Limite** : cet audit automatique ne remplace pas un essai avec un lecteur d'écran.
- Après corrections : 245 tests sur 245, parcours de bout en bout 57/57.

### Cycle 17 (23 h 20) : rappels de réassort visibles et maîtrisés (chantier 84)

Suite des constats « non faits » de la relecture.

- **E-mail de confirmation de commande** : il annonce le rappel (« nous vous rappellerons de recommander dans 21 jours, rien n'est débité ») avec le lien d'arrêt, dans les quatre langues. Le client sait tout de suite qu'un e-mail viendra et peut le refuser avant même le premier rappel (testé en français et en allemand).
- **Détail de la commande, côté marchand** :
  - il indique si un rappel est demandé et s'il est encore actif ;
  - le bouton « Arrêter le rappel » répond à un client qui le demande par téléphone ou en boutique ;
  - l'arrêt est noté dans l'historique de la commande ;
  - le rôle « Commandes » n’a pas ce bouton, et le serveur le lui refuse aussi (la route est hors de sa liste blanche).
- **Vérifié dans Chromium**, bureau et mobile : affichage du rappel actif, arrêt, affichage « arrêté », ligne supprimée en base. Aucune erreur.

### Cycle 18 (23 h 20) : favoris dans la boutique (chantier 85)

- **Ce que voit le visiteur** :
  - un cœur sur chaque carte produit ;
  - un bouton « Mes favoris (N) » qui ne montre que ses favoris ;
  - « Voir tous les produits » pour revenir à la vitrine.
- **Vie privée** : les favoris restent dans le navigateur du visiteur (100 au plus, par boutique). Rien n'est envoyé au serveur, aucune mesure d'audience n'est faite (vérifié : aucun événement enregistré).
- **Accessibilité** :
  - le cœur est un vrai bouton à état (aria-pressed), avec un nom explicite (« Ajouter Nappe aux favoris ») ;
  - le focus reste sur le même cœur après le clic ;
  - la cible fait 36 px ;
  - l'audit de la boutique ne relève rien de nouveau.
- **Limites** : les favoris ne passent pas d'un appareil à l'autre (aucun compte client), et un produit retiré de la vente disparaît simplement de la liste.
- **Vérifié dans Chromium**, bureau et mobile : ajout à la souris et au clavier, retrait, filtre, conservation après rechargement. Aucune erreur.

### Cycle 19 (23 h 25) : codes-barres, de la fiche à la caisse (chantier 86)

- **Module partagé** `js/gtin.js` (serveur et navigateur) : il vérifie la forme des codes EAN-8, UPC-A, EAN-13 et GTIN-14 et le chiffre de contrôle GS1. Les espaces et les tirets sont ignorés.
- **Fiche produit** : champ « Code-barres EAN / GTIN ». Un code faux est refusé avec un message clair. Un code déjà porté par un autre produit de la boutique est refusé aussi. Un code vidé est retiré, ce qui libère ce code.
- **Caisse** : le champ « Code-barres » apparaît dès qu'un produit en a un.
  - Un lecteur de codes-barres (qui tape les chiffres puis Entrée) ajoute le produit au ticket, et le champ reste prêt pour l'article suivant.
  - Un code inconnu, un produit à variantes ou un produit épuisé donne un message, sans rien ajouter.
- **Import CSV** : les colonnes « Variant Barcode » (Shopify), « GTIN, UPC, EAN, or ISBN » (WooCommerce), « EAN13 » (PrestaShop) et « EAN / code-barres » (tableur) sont reprises. Un code invalide ou en double est ignoré, avec un avertissement. Un code déjà présent dans la boutique est retiré du produit importé, et l'import continue.
- **Page produit** : le code figure dans les données structurées (gtin8, gtin12, gtin13 ou gtin14), ce que demandent Google Shopping et les comparateurs.
- **Limite levée au cycle 21** : les variantes ont maintenant leur propre code.
- **Tests** :
  - chiffre de contrôle, valeurs justes et fausses ;
  - import (gardé, faux, en double, Shopify) ;
  - fiche (refus, normalisation, doublon, code libéré) ;
  - page produit (gtin13) ;
  - import face à un code déjà en boutique.
- **Vérifié dans Chromium**, bureau et mobile :
  - code faux refusé, puis code juste enregistré ;
  - deux lectures au scanner donnent 2 articles au ticket, avec le focus conservé ;
  - code inconnu signalé.
- **Simulation de 60 jours** (100 marchands, horloge virtuelle), refaite après les chantiers 79 à 85 : 9 216 commandes, 0 anomalie, 0 erreur dans le journal du serveur, temps médian 2 ms et 95e centile 8 ms.

### Cycle 20 (23 h 30) : relecture indépendante des chantiers 81 à 85

Pas d'injection, pas de fuite entre boutiques, et la politique de sécurité du contenu est respectée. Les images sous les articles s'affichent aussi sur un domaine personnalisé. Le désabonnement en un clic des messageries est compatible avec la route d'arrêt. La boucle des rappels ne peut pas tourner sans fin. Constats corrigés :

- **Moyen** : une erreur passagère après la réservation d'un rappel (base occupée au moment d'enregistrer l'e-mail) supprimait la demande du client. Une erreur ne supprime plus jamais une demande : elle est seulement reportée au rappel suivant.
- **Bas** :
  - **Détail de commande** : il affichait « rappel arrêté » pour une demande remplacée par une commande plus récente. Le texte dit maintenant exactement ce qu'il en est. Après « Arrêter le rappel », le focus va au texte mis à jour. L'arrêt reste possible pour une boutique en lecture seule (abonnement terminé).
  - **Éditeur du journal** : un produit choisi puis masqué disparaissait de la sélection à l'enregistrement suivant. Il reste coché, avec la mention « masqué ». Une modification par l'API qui n'envoie pas la liste des produits garde la sélection existante (testé).
  - **Favoris** :
    - le cœur annonçait son état deux fois aux lecteurs d'écran : il a maintenant un nom fixe (« Nappe en favori ») et l'état « enfoncé » ;
    - le filtre « Mes favoris » n'apparaît plus que dans la première section de produits ;
    - un cœur retiré dans la vue « Mes favoris » renvoie le focus au cœur suivant (vérifié dans Chromium), avec une annonce « Retiré des favoris » ;
    - le nombre de résultats d'une recherche n'est plus affiché par-dessus la vue des favoris.
  - **Confirmation d'une précommande** : elle dit maintenant « 30 jours après l'expédition », et non « dans 30 jours » (testé).
  - **« À faire »** : il compte des commandes, et non des lignes.
- **Sans objet** : le jeton d'arrêt était déjà masqué dans le journal des e-mails du marchand (le paramètre « j= » est masqué partout).
- **Noté** : une commande marquée payée à la main ne déclenche pas d'e-mail de confirmation, donc le client découvre son rappel au premier envoi. Ce comportement existe depuis le début pour ces commandes.
- Après corrections : 248 tests sur 248, parcours de bout en bout 57/57.

### Cycle 21 (23 h 30) : un code-barres par variante (chantier 87)

- **Fiche produit** : le tableau des variantes a une colonne « Code-barres » (produits en stock). Chaque taille ou couleur a son code, vérifié comme celui du produit.
- **Unicité** : les codes du produit et de ses variantes sont uniques entre eux et face à tous les autres produits de la boutique, variantes comprises (requête sur les variantes enregistrées).
- **Caisse** : le code d'une variante ajoute directement cette variante au ticket (« T-shirt (M) »). Le code du produit seul demande toujours de choisir la variante.
- **Import Shopify** : le code de chaque ligne de variante (« Variant Barcode ») est repris. Un code invalide, en double ou déjà présent dans la boutique est ignoré, avec un avertissement.
- **Mobile** : le champ est étroit. Le tableau défile dans son cadre, comme les autres tableaux de l'application.
- **Tests** : code faux refusé, deux codes identiques dans un même produit refusés, code enregistré, code d'une variante refusé pour un autre produit, import Shopify avec un code juste et un faux.
- **Vérifié dans Chromium**, bureau et mobile : saisie du code de la taille M, enregistrement, lecture au scanner. Le ticket donne « 1×T-shirt (M) ». Aucune erreur.

### Cycle 22 (23 h 35) : étiquettes code-barres et codes internes (chantier 88)

Pour les produits faits maison, sans code fabricant, qu'on veut quand même passer au scanner.

- **Code interne** : dans la fiche produit, « Créer un code interne » propose un EAN-13 qui commence par 20. Cette plage GS1 est réservée à l'usage en magasin, jamais attribuée à un fabricant. Le code est différent de ceux déjà pris, et son chiffre de contrôle est juste. Le serveur vérifie encore l'unicité à l'enregistrement.
- **Étiquettes** : le bouton « Étiquettes code-barres » de la page Produits prépare une planche, avec une étiquette par produit et par variante qui ont un code. Chaque étiquette porte le nom, la variante, le prix, le code-barres et les chiffres.
  - Le code est dessiné en SVG (barres pleines, aucune ressource externe), donc net à l'impression.
  - À l'impression, la planche passe en 3 colonnes A4.
  - Les EAN-13, UPC-A et EAN-8 sont dessinés. Un GTIN-14 (code de carton) n'est pas dessiné : il demande la symbologie ITF-14.
- **Contrôle du dessin** : un test relit les barres avec un décodeur écrit à part. Ce décodeur reconnaît chaque chiffre à la largeur de ses barres et de ses espaces, comme un lecteur, sans utiliser les tables d'encodage. Il retrouve le premier chiffre par la parité, et le test vérifie 50 codes internes.
- **Limite honnête** : aucune étiquette n'a été lue par un vrai scanner. Aucun décodeur n'est installé ici et je n'ai pas installé de code téléchargé. Un essai avec un lecteur réel reste à faire.
- **Vérifié dans Chromium**, bureau et mobile : code interne créé puis enregistré, trois étiquettes (deux variantes et un produit), aperçu d'impression A4 en PDF propre. Aucune erreur.

### Cycle 23 (23 h 40) : flux produits pour Google Shopping et Meta (chantier 89)

- **Adresse** : `/s/<boutique>/produits.xml`, et `/produits.xml` sur un domaine personnalisé. Le flux suit le format RSS 2.0 avec l'espace de noms Google, que Meta lit aussi. Il est mis en cache 15 minutes.
- **Contenu** :
  - un article par produit, ou par variante, regroupées par `item_group_id` ;
  - titre, description en texte, lien vers la page produit, photo, prix TTC dans la devise de la boutique, disponibilité, marque, catégorie ;
  - le code-barres (`gtin`) quand il existe, sinon `identifier_exists=no` ;
  - une précommande est marquée `preorder`, avec sa date.
- **Exclusions** :
  - les produits masqués et les produits numériques ne figurent pas dans le flux ;
  - une boutique sans abonnement actif publie un flux vide, ce qui évite une vitrine gratuite chez Google ;
  - les caractères de contrôle sont retirés et tout est échappé.
- **Interface** : le bouton « Google Shopping » de la page Produits donne l'adresse à copier (sélectionnée d'un clic) et les étapes. Il signale aussi les produits sans code-barres. Les noms de menus de Google et de Meta ne sont pas recopiés, car ils changent souvent.
- **Tests** : en-tête XML, échappement d'un nom piégé, caractère de contrôle, prix, gtin, variantes (épuisée, prix propre, sans code), précommande, exclusions, flux vide d'une boutique fermée.
- **Vérifié dans Chromium**, bureau et mobile : fenêtre, adresse sélectionnée d'un clic, flux relu par l'analyseur XML du navigateur (aucune erreur, noms piégés intacts). Aucune erreur.
- **Limite** : le flux n'a pas été soumis à Google Merchant Center, ce qui demande un compte. La conformité suit la spécification publiée, de mémoire, sans contrôle en ligne.

### Cycle 24 (23 h 40) : relecture indépendante des chantiers 86 à 88

La relecture a contrôlé les tables d'encodage EAN-13 et EAN-8 face à la norme GS1 : elles sont justes. Un code de référence publié (5901234123457) donne exactement les barres attendues. Le chiffre de contrôle, les marges de début, de milieu et de fin et l'échappement sont justes aussi, et il n'y a pas de course sur l'unicité. Constats corrigés :

- **Moyen, duplication** : « Dupliquer » échouait pour tout produit qui avait un code-barres (code déjà pris). La copie part maintenant sans code, ni pour le produit ni pour ses variantes (vérifié dans Chromium).
- **Moyen, même article sous trois formes** : un article en UPC-A (12 chiffres), en EAN-13 commençant par 0 ou en GTIN-14 était compté comme trois codes. L'unicité laissait passer les trois, et un lecteur réglé en EAN-13 ne retrouvait pas un produit enregistré en 12 chiffres.
  - Il existe maintenant une forme de référence (13 chiffres, 8 pour un EAN-8), utilisée pour l'enregistrement, l'unicité, l'import et la caisse (testé).
  - Un lecteur qui envoie « 0036000291452 » retrouve le produit saisi « 036000291452 » (vérifié dans Chromium).
- **Moyen, lecture juste après une vente** : le focus passait au premier bouton produit. Les chiffres du lecteur y étaient perdus, puis son « Entrée » ajoutait ce premier produit au lieu de l'article lu. Corrigé de deux façons :
  - après une vente, le focus revient au champ code-barres ;
  - sur la page Caisse, une suite rapide de chiffres terminée par Entrée, tapée hors d'un champ de saisie, est lue comme un code-barres, et l'Entrée ne déclenche plus le bouton qui a le focus (vérifié dans Chromium, le curseur étant sur un bouton produit).
- **Bas** :
  - **Stock** : un article lu au-delà du stock affiche « plus en stock » au lieu de ne rien faire en silence (vérifié).
  - **Réinitialisation et restauration** : une boutique réinitialisée ou restaurée avec deux fois le même code n'échappe plus au contrôle. Le second produit est gardé sans code, au lieu de partager le code ou de perdre sa composition de lot (testé).
  - **Import WooCommerce** : les variantes reprennent aussi leur propre code.
  - **Planche d'étiquettes** : cellules fixes de 70 × 37 mm (3 × 8 sur une planche A4), marges claires GS1 (11 et 7 modules), texte d'introduction retiré à l'impression. Les produits en dropshipping et les GTIN-14 sont exclus. Les bons de préparation gardent leurs marges d'impression (page nommée).
- **Noté** :
  - pas de bouton « code interne » pour une variante (le serveur contrôle de toute façon l'unicité) ;
  - un code UPC-E (8 chiffres compressés) est refusé, faute de conversion ;
  - en mode démonstration sans serveur, les codes ne sont pas contrôlés.
- Après corrections : 249 tests sur 250 dans la suite complète, parcours de bout en bout 57/57. L'échec est un test de connexion qui lance 12 essais simultanés (« au plus 5 mots de passe calculés ») et dépend de la charge de la machine. Relancé seul trois fois, il a réussi chaque fois, et il ne touche à rien de ce qui a changé. C'est le deuxième test sensible au temps relevé cette nuit (avec le flux en direct) : à rendre plus robuste.

### Cycle 25 (23 h 45) : deux tests sensibles à la charge rendus fiables (chantier 91)

- **Flux en direct** : le test prenait la première mise à jour reçue. Sous charge, ce pouvait être celle de la commande créée, et non celle de la commande payée. Il attend maintenant celle qui porte la commande payée, avec une marge de 10 secondes au lieu de 3. Le code du serveur n'a pas changé, il était juste.
- **Confirmation d'identité, 12 essais simultanés** : la règle vérifiée (au plus 5 mots de passe calculés) tenait toujours. Mais selon l'ordre d'arrivée, un essai refusé reçoit « session fermée » ou « non connecté » (session déjà supprimée), et le test n'acceptait que la première réponse. Il accepte maintenant les deux et affiche les codes reçus en cas d'échec. La règle de sécurité est inchangée.
- **Essai sous charge** : quatre exécutions simultanées de ces deux tests et de la suite de l'API, sans aucun échec.

### Cycle 26 (23 h 50) : emballage cadeau et message (chantier 90)

- **Réglage** : dans Paramètres > Livraison, « Proposer l'emballage cadeau ». L'emballage est offert : un supplément payant toucherait aux factures, à la TVA et aux écritures comptables, ce qui demande sa propre relecture.
- **Boutique** :
  - la case « C'est un cadeau : emballage offert » fait apparaître le champ du message (300 caractères), sans perdre ce qui est déjà saisi ;
  - le focus va au champ du message ;
  - la case n'existe pas pour un panier entièrement numérique.
- **Message** :
  - nettoyé (caractères de contrôle et d'inversion de sens retirés, lignes vides réduites), 300 caractères au plus ;
  - rangé avec les données chiffrées du client, il est effacé avec elles ;
  - une demande faite à une boutique qui ne propose pas l'emballage est ignorée.
- **Marchand** :
  - la commande affiche « Emballage cadeau demandé » et le message ;
  - le bon de préparation l'affiche dans un encadré, sans les prix ;
  - l'e-mail de nouvelle commande le signale, sans recopier le message (les e-mails sont gardés 7 jours).
- **Tests** : demande ignorée sans le réglage, réglage, message nettoyé et coupé à 300 caractères, chiffrement, e-mail au marchand, effacement.
- **Vérifié dans Chromium**, bureau et mobile : réglage, case et message dans le panier (saisie gardée), commande payée, détail de la commande, bon de préparation. Aucune erreur.
- 251 tests sur 251, parcours de bout en bout 57/57.

### Cycle 27 (23 h 55) : inventaire au lecteur de codes-barres (chantier 92)

- **Page Produits, « Inventaire »** :
  - le champ code-barres a le focus ; chaque lecture ajoute 1 à l'article (annoncé aux lecteurs d'écran) ;
  - la quantité se saisit aussi à la main ;
  - le tableau montre le stock, la quantité comptée et l'écart ;
  - seuls les articles comptés sont modifiés ;
  - le comptage en cours est gardé sur l'appareil, donc une page rechargée ne fait pas tout recommencer.
- **Ventes pendant le comptage** : chaque ligne envoie le stock vu au moment où l'article a été compté pour la première fois. Si une vente l'a changé entre-temps, le serveur n'applique rien (tout ou rien, dans une transaction) et liste les articles en conflit. Le marchand choisit alors :
  - « Recompter ces articles » : seuls ces articles sont remis à zéro ;
  - « Appliquer quand même » : le comptage fait foi.
- **Serveur** : nouvelle route `POST /api/admin/inventaire`.
  - Elle refuse les lots, le dropshipping et les produits numériques, une variante manquante et une quantité invalide.
  - Le total d'un produit à variantes suit la somme de ses variantes.
  - La répartition par emplacement est remise à jour.
  - L'inventaire est noté dans l'activité du compte.
- **Mobile** : la quantité comptée débordait de sa carte, et le tableau défilait de côté (vu à la vérification). Le champ est maintenant borné.
- **Tests** : refus (numérique, variante manquante, quantité négative), conflit après une vente avec rien d'appliqué, application forcée, total des variantes, application directe sans vente, activité notée.
- **Vérifié dans Chromium**, bureau et mobile : 3 lectures au lecteur, une saisie à la main, une vente en ligne pendant le comptage, le conflit affiché, « Appliquer quand même », les stocks justes. Aucune erreur.

### Cycle 28 (23 h 55) : relecture indépendante des chantiers 89 à 91

La relecture confirme plusieurs points :

- le flux n'expose ni coût, ni fournisseur, ni quantité en stock ;
- les produits masqués et numériques en sont exclus, et une boutique fermée publie un flux vide ;
- le message cadeau est chiffré, exporté et effacé avec les données du client, et il n'apparaît ni sur la page publique de suivi ni dans les e-mails au client ;
- les deux tests rendus fiables vérifient toujours la même chose.

Constats corrigés :

- **Élevé, flux** : un titre était coupé à 150 caractères après l'échappement. Une entité pouvait donc être coupée en deux (« &am »), ce qui rendait tout le flux illisible pour Google et Meta. Le texte est maintenant coupé avant l'échappement (testé avec un nom plein d'apostrophes et d'esperluettes).
- **Moyen, flux** : U+FFFE et U+FFFF passaient, alors que XML les interdit. À l'inverse, tous les émojis étaient supprimés. Seuls les caractères interdits et les demi-paires isolées sont maintenant retirés, et les émojis restent (testé).
- **Moyen, flux** : l'identifiant d'une variante pouvait dépasser 50 caractères (limite de Google) et changeait quand une valeur était renommée. Il est maintenant court et stable (identifiant du produit et empreinte de la variante), et le test vérifie la limite.
- **Moyen, flux** : rien ne disait ce qui distingue les variantes. Les options deviennent les attributs attendus (taille, couleur, matière, sinon motif) (testé : « g:size », « g:color »).
- **Moyen, emballage cadeau** : il était accepté pour une commande entièrement en dropshipping, alors que le fournisseur l'expédie sans emballage. Il demande maintenant au moins un article préparé par la boutique. Un panier qui mêle un produit numérique et un produit physique, refusé par le serveur alors que la case était affichée, est maintenant accepté des deux côtés.
- **Bas** :
  - **Flux** : une précommande sans stock n'est plus annoncée « preorder ».
  - **Lecteur de codes-barres** : avec une fenêtre ouverte, une lecture n'ajoute plus d'article au ticket caché derrière.
  - **Codes-barres** : un EAN-8 complété par des zéros (0000096385074) a maintenant la même forme de référence que l'EAN-8.
  - **Restauration** : seuls les codes en conflit sont retirés, et non tous les codes du produit. La réponse nomme les produits concernés et l'interface les signale (testé).
  - **Panier** : cocher « C'est un cadeau » ne décoche plus la case des nouveautés ni celle du rappel (vérifié dans Chromium).
  - **Intégrations** : l'API et les webhooks indiquent l'emballage cadeau et son message, pour un outil d'expédition.
- **Noté, non fait** :
  - (le stock du flux déduit les commandes en attente depuis le cycle 31) ;
  - (la marque par produit est faite au cycle 30) ;
  - (chaque variante a son lien depuis le cycle 39).
- 252 tests sur 252, parcours de bout en bout 57/57.

### Cycle 29 (00 h 05) : créneaux de retrait en magasin (chantier 93)

- **Réglage** (Magasin, quand le retrait en boutique est proposé) :
  - les plages de chaque jour de la semaine ;
  - la durée d'un créneau (15, 30 ou 60 minutes) et le nombre de retraits par créneau (1 à 50) ;
  - le délai de préparation (1 heure à 1 jour) et l'horizon de réservation (3 jours à 2 semaines).
  
  Le serveur relit toujours ces valeurs en les bornant, car elles arrivent du navigateur.
- **Module pur** `server/src/creneaux.js` :
  - les heures sont calculées à Lausanne, changement d'heure compris : une heure qui n'existe pas (le 28 mars à 2 h) ne donne aucun créneau fantôme (testé) ;
  - un créneau plein disparaît de la liste.
- **Boutique** :
  - avec le retrait en boutique, le client choisit un créneau dans une liste groupée par jour, lue au serveur à l'ouverture (toujours à jour) ;
  - le créneau est obligatoire ;
  - sans créneau libre, un message invite à choisir la livraison.
- **Commande** :
  - le créneau est revérifié dans la transaction, donc deux clients ne prennent pas la dernière place ;
  - une heure inventée est refusée ;
  - une commande en attente de paiement depuis moins d'une heure réserve sa place, et une commande annulée la libère.
- **Affichage** :
  - le créneau figure dans l'e-mail de confirmation, dans la langue du client (fr, de, it, en) ;
  - il figure dans l'e-mail au marchand, le détail de la commande et le bon de préparation ;
  - la liste « Retraits en magasin » est triée par créneau.
- **Tests** : génération (délai, nombre, capacité, changement d'heure, valeurs bornées), créneau obligatoire, heure inventée, dernière place, créneau dans la confirmation, place libérée par une annulation, livraison à domicile sans créneau.
- **Vérifié dans Chromium**, bureau et mobile : réglage des 7 jours, choix dans le panier (121 créneaux proposés), commande payée, créneau affiché dans les retraits. Aucune erreur.
- 254 tests sur 254, parcours de bout en bout 57/57.

### Cycle 30 (00 h 05) : marque du produit (chantier 94)

- **Fiche produit** : champ « Marque » (facultatif, 70 caractères, nettoyé). Il est repris dans le flux Google Shopping et Meta (`g:brand`) et dans les données structurées de la page produit. Sans marque, c'est le nom de la boutique, comme avant. Google rapproche la marque et le code-barres : la marque du fabricant évite qu'un produit revendu soit refusé.
- **Import CSV** : « Vendor » (Shopify), « Brands » (WooCommerce), « Manufacturer » (PrestaShop) et « marque » (tableur) sont repris.
- **Tests** : marque nettoyée (espaces, caractère de contrôle) dans le flux et dans les données structurées, import Shopify.
- **Vérifié dans Chromium**, bureau et mobile : saisie, enregistrement, réaffichage. Une marque vidée disparaît. Aucune erreur.

### Cycle 31 (00 h 05) : stock du flux aligné sur celui de la commande (chantier 95)

- **Flux produits** : le stock annoncé est celui qui reste une fois déduites les commandes en attente de paiement. C'est le même calcul que celui de la commande et de la reprise de paiement (y compris les composants des lots). Google n'annonce plus « en stock » un dernier exemplaire que la boutique refuserait de vendre.
- **Test** : pièce unique retenue par une commande non payée, annoncée « out of stock ».

### Cycle 32 (00 h 10) : relecture indépendante des chantiers 92 et 93

Constats corrigés :

- **Élevé, inventaire** : les articles payés mais pas encore expédiés ou retirés étaient comptés deux fois. Le stock les avait déjà déduits, alors qu'ils étaient encore sur l'étagère. Exemple : 10 en rayon dont 2 vendus à préparer donnait un stock de 10 au lieu de 8, d'où une survente.
  - Le serveur calcule maintenant ces articles (commandes payées, en préparation ou prêtes au retrait, composants des lots compris) et les retire du comptage à l'application.
  - L'écran affiche « En rayon attendu » (stock plus articles à remettre) et le détail « dont N vendus à remettre » (testé).
- **Moyen, inventaire** : au-delà de 2 000 lignes, le comptage était coupé sans le dire. Il est maintenant refusé avec un message (10 000 au plus, testé).
- **Moyen, créneaux** : la réservation d'un créneau impayé suivait une règle à part (1 heure).
  - Elle suit maintenant la même règle que le stock : 35 minutes depuis la commande ou sa reprise, 48 heures sur facture QR, 7 jours pour un devis, rien si le paiement est abandonné.
  - Un paiement repris pour un créneau donné entre-temps à un autre client est refusé (testé).
- **Moyen, créneaux** : un robot pouvait bloquer tous les créneaux avec des commandes impayées. Un même réseau ne retient plus que 2 créneaux sans payer (testé). La liste publique est limitée en fréquence.
- **Moyen, créneaux** : la veille d'un changement d'heure, un jour était sauté (le dimanche du passage à l'heure d'été) ou doublé (en automne). Les jours sont maintenant ceux du calendrier de Lausanne (testé pour le 28 mars 2027 et le 25 octobre 2026).
- **Bas** :
  - **Inventaire** :
    - la tabulation passe au champ suivant sans tout réafficher ;
    - le comptage est gardé par boutique ;
    - les valeurs relues sont contrôlées et les articles supprimés oubliés ;
    - le stock est rechargé au début du comptage, pour éviter des conflits fictifs.
  - **Créneaux** :
    - le message « créneau pris » reste affiché au-dessus de la liste rechargée ;
    - les places sont comptées par chevauchement (la durée d'un créneau a pu changer) ;
    - jusqu'à 600 créneaux sont proposés au lieu de 120 ;
    - une heure effacée est refusée ;
    - le réglage n'est plus montré au rôle « Commandes », qui ne peut pas l'enregistrer.
  - **Traductions** : les nouveaux textes de la boutique (créneau, emballage cadeau) sont traduits en allemand, italien et anglais.
- **Noté** :
  - (les jours des créneaux sont traduits depuis le cycle 33) ;
  - (l'inventaire par emplacement est fait au cycle 35) ;
  - (l'e-mail « commande prête » rappelle le créneau depuis le cycle 33).

### Cycle 33 (00 h 15) : créneaux dans la langue du client (chantier 96)

- **Boutique** : les jours et les heures de la liste des créneaux sont formés dans la langue affichée (fr, de, it, en), à l'heure de Lausanne. Vérifié dans Chromium en allemand : « Montag, 16. November », champ « Abholzeit », « Zeit wählen… ».
- **E-mail « commande prête »** : il rappelle le créneau choisi, dans la langue du client (testé).

### Cycle 34 (00 h 20) : vérification complète (npm run verifier)

Lancée après les chantiers 79 à 95 :

- tests automatiques et parcours de bout en bout ;
- achat au clavier dans la boutique et espace marchand au clavier ;
- simulation de 60 jours (100 marchands, 372 s) ;
- fuzzing HTTP de toutes les routes avec des corps hostiles ;
- charge réduite (100 boutiques, 15 s).

Les **7 étapes sont réussies**. Après les corrections de la relecture 92-93 et le chantier 96 : 254 tests sur 254, parcours de bout en bout 57/57.

### Cycle 35 (00 h 20) : inventaire par emplacement (chantier 97)

- **Écran d'inventaire** : avec plusieurs emplacements (magasin, entrepôt, dépôt), un choix « Emplacement compté » apparaît. On compte alors un seul emplacement :
  - le stock affiché est celui de cet emplacement ;
  - les articles vendus encore en rayon sont ceux qui ont été pris dans cet emplacement à la vente (répartition notée sur chaque ligne de commande) ;
  - changer d'emplacement efface le comptage en cours, après confirmation.
- **Serveur** :
  - la quantité comptée est posée dans l'emplacement, avec un mouvement « inventaire » au registre ;
  - le total de la fiche produit devient la somme des emplacements ;
  - un conflit (vente pendant le comptage) annule tout, emplacements compris, alors qu'avant les écritures déjà faites seraient restées ;
  - un emplacement inconnu est refusé.
- **Tests** : emplacement inconnu, conflit sans aucune écriture, quantité posée dans le bon emplacement, total égal à la somme, mouvement « inventaire » au registre.
- **Vérifié dans Chromium**, bureau et mobile : entrepôt choisi (stock 6), 5 lectures au lecteur, application. Résultat : entrepôt 5, magasin 4 inchangé, total 9. Aucune erreur.

### Cycle 36 (00 h 25) : mesure des performances de la boutique (chantier 98)

- **Outil** `outils/simulation/performance-boutique.js` : 24 produits avec une photo réaliste, mesurés comme sur un téléphone (processeur ralenti 4 fois, réseau 4G lente). Il relève le poids transféré, le nombre de requêtes, le plus grand affichage (LCP), les décalages de mise en page (CLS) et le temps de blocage.
- **Mesures avant correction** :
  - accueil et page produit : environ 172 Ko et 12 requêtes, LCP 1,25 s, blocage 104 à 112 ms ;
  - journal : 4 Ko et 1 requête, LCP 0,26 s ;
  - photos des cartes chargées à la demande ;
  - **mais** CLS de 0,11 sur la page produit, au-dessus du seuil de 0,1.
- **Cause, trouvée en observant les décalages** : sur téléphone, la fiche produit s'ouvre ancrée en bas de l'écran. Quand sa photo arrivait, la fiche grandissait de 80 px et tout remontait. En plus, cette photo principale était chargée « à la demande », comme celles des cartes.
- **Corrections** :
  - sur téléphone, la place de la photo est réservée (format carré) ;
  - la photo principale est chargée tout de suite, en priorité (`fetchpriority="high"`) ;
  - les images ont des dimensions déclarées.
- **Après** : CLS de 0,027 sur la page produit et 0 sur l'accueil, LCP 1,23 s, blocage 64 à 72 ms. La fiche a été revue en capture d'écran, sur bureau et sur téléphone.
- **Limite** : la mesure se fait en local, sans le temps de réponse d'un vrai serveur ni d'un CDN.
- 254 tests sur 254, parcours de bout en bout 57/57.

### Cycle 37 (00 h 30) : relecture indépendante des chantiers 94 à 97

Plusieurs points ont été confirmés :

- **Inventaire** : l'annulation par conflit défait bien tout ; les articles « en rayon » sont calculés juste (quantités réellement retirées, variantes, retours remis en stock, emplacements) ; un envoi ou une annulation ne fait jamais compter deux fois ; aucun stock négatif.
- **Créneaux** : même règle de réservation que le stock ; jours du calendrier et chevauchements justes ; formatage à l'heure de Lausanne quel que soit l'appareil.
- **Marque** : nettoyée et échappée partout.
- **E-mail « prête »** : le remplacement ne peut pas être détourné.

Constats corrigés :

- **Moyen, créneaux** : la limite de 2 créneaux retenus par réseau comptait aussi les commandes payées. Un client qui avait déjà deux retraits payés (ou un bureau derrière une seule adresse) se voyait refuser une troisième commande. Seules les commandes en attente de paiement comptent maintenant (testé).
- **Moyen, inventaire par emplacement** : après une première application, le choix de l'emplacement disparaissait alors que l'emplacement restait retenu. Le comptage suivant comparait au stock total et tombait en faux conflit. Les emplacements et les articles en rayon sont maintenant relus après chaque application. Vérifié dans Chromium : un deuxième comptage du même emplacement juste après passe sans conflit.
- **Bas** :
  - **Lot** : après un retour partiel non remis en stock, ses composants étaient encore comptés « en rayon ». Ils sont plafonnés à ce qui reste du lot.
  - **Liste des créneaux** : elle est construite sans recréer un formateur de date par créneau.
  - **Écran d'inventaire** : il dit quels statuts comptent comme « en rayon » (payée, en préparation, prête) et demande d'expédier ou de marquer « retirées » les commandes déjà emballées avant de compter.
- **Noté** :
  - le flux produits peut annoncer épuisé un article retenu 35 minutes par une commande non payée, avec un cache de 15 minutes ;
  - (le flux a sa limite de fréquence depuis le cycle 40) ;
  - la limite de créneaux par réseau se contourne en changeant d'adresse IP, comme toute limite par réseau.
- 254 tests sur 254, parcours de bout en bout 57/57.

### Cycle 38 (00 h 35) : carte « Nouveautés » (chantier 99)

- **Vue d'ensemble** : une carte liste les fonctions ajoutées cette nuit :
  - inventaire, codes-barres et étiquettes ;
  - Google Shopping et Meta ;
  - créneaux de retrait, emballage cadeau ;
  - rappels de réassort, produits sous les articles du journal.
  
  Chacune a une phrase d'explication, l'endroit où la trouver et un lien. Une fonction qui n'est pas connue ne sert à rien.
- **Masquer** : le choix est gardé sur l'appareil, et la carte revient à la prochaine série de nouveautés (numéro de version). Elle n'est pas montrée au rôle « Commandes ».
- **Vérifié dans Chromium**, bureau et mobile : 7 nouveautés, lien vers « Magasin et caisse », carte masquée après rechargement. Aucune erreur.

### Cycle 39 (00 h 35) : lien vers une variante (chantier 100)

- **Boutique** : l'adresse `…/p/<produit>?variante=M` ouvre la fiche avec la taille M choisie, et le prix affiché est celui de M (vérifié : 32 au lieu des 30 du produit). Sans paramètre, la première variante en stock est choisie, comme avant. Le choix est oublié à la fermeture de la fiche.
- **Défaut existant corrigé au passage** : à l'ouverture, la fiche affichait le prix de la première variante en stock, même quand une autre variante était choisie.
- **Flux Google et Meta** : chaque variante pointe vers sa propre adresse.
- **Données structurées** : sur cette adresse, la page déclare l'offre de la variante (prix, disponibilité, code-barres) au lieu d'une fourchette de prix. Google compare la page et le flux, et un écart de prix fait refuser l'article. La valeur n'est reprise que si elle correspond à une variante existante.
- **Tests** : lien de la variante dans le flux, offre de la variante (32.00 CHF) sur sa page.
- **Vérifié dans Chromium**, bureau et mobile : taille présélectionnée, prix juste, ajout au panier de la bonne variante, taille par défaut sans paramètre. Aucune erreur.
- 254 tests sur 254, parcours de bout en bout 57/57.

### Cycle 40 (00 h 35) : flux produits limité et gardé en mémoire (chantier 101)

- **Limite** : au plus 60 demandes du flux par 10 minutes et par adresse. Au-delà, le serveur répond 429 avec Retry-After. Le flux est public et chaque calcul parcourt les produits et les commandes en attente.
- **Mémoire** : le flux est gardé une minute par boutique. Les robots qui le relisent souvent ne le font plus recalculer à chaque fois, et le cache HTTP de 15 minutes reste en place.
- **Tests** : le flux reste le même pendant une minute après une modification, et la 61e demande reçoit 429.

### Cycle 41 (00 h 40) : relecture indépendante des chantiers 98 à 101, et audit des nouveaux écrans

La relecture a confirmé plusieurs points :

- la valeur `?variante=` n'est jamais recopiée telle quelle, elle est seulement comparée aux variantes existantes ;
- l'adresse canonique reste sans paramètre (pas de contenu en double pour les moteurs) ;
- l'adresse IP des clients ne peut pas être usurpée ;
- les dimensions déclarées n'étirent aucune image ;
- la carte « Nouveautés » est correcte.

Constats corrigés :

- **Moyen, flux** : la limite de fréquence portait sur l'adresse seule, toutes boutiques confondues. Or les robots de Google et Meta lisent les flux de nombreuses boutiques depuis peu d'adresses : ils auraient été refusés (429), et les produits retirés de Merchant Center.
  - La limite porte maintenant sur la boutique et l'adresse, et ne compte que les calculs. Une réponse gardée en mémoire n'est jamais refusée (testé : 70 lectures sans refus).
  - Une autre boutique n'est pas touchée par la limite d'une première (testé).
- **Moyen, données structurées** : sur une version linguistique, l'adresse de l'offre d'une variante était mal formée (`?lang=de?variante=M`). Elle est maintenant construite proprement (`?variante=M&lang=de`).
- **Moyen, boutique** : un lien vers une variante épuisée (que le flux annonce aussi) laissait « Ajouter au panier » actif. Le bouton est maintenant désactivé et l'alerte de retour en stock affichée. Vérifié dans Chromium.
- **Bas** :
  - **Page d'une variante** : son prix figure aussi dans les balises de partage, la description et la version sans JavaScript (testé).
  - **Adresse** : elle suit la variante choisie, donc un lien copié donne la bonne variante.
  - **Mémoire du flux** : les entrées échues sont retirées, et le total est borné à 50 Mo.
  - **Inventaire par emplacement** : le plafond des composants d'un lot après retour s'applique aussi.
  - **Carte « Nouveautés »** : après « Masquer », le focus va au titre de la page.
- **Audit d'accessibilité des écrans ajoutés cette nuit** (nouveautés, inventaire, étiquettes, flux, fiche produit, créneaux, livraison), sur bureau et sur téléphone, avec le même script que la boutique :
  - le champ « Description » de la fiche produit n'avait pas de nom accessible, parce que son libellé contient aussi un bouton ;
  - les liens de la carte « Nouveautés » étaient trop petits sur téléphone ;
  - les deux sont corrigés. L'audit des écrans du marchand en mode démonstration ne relève rien.
- 256 tests sur 256, parcours de bout en bout 57/57.
