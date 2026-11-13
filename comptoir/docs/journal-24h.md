# Journal du marathon de 24 heures (12 au 13 novembre 2026)

Demande : pendant 24 heures, du 12 novembre 22 h 30 au 13 novembre 22 h 30 (heure de Lausanne), produire le code le plus poussé et le plus sécurisé possible pour Comptoir.

Méthode, la même que les nuits précédentes. Chaque chantier passe par ces étapes :
1. Implémentation complète.
2. Tests automatiques.
3. Parcours de bout en bout dans un vrai navigateur, et simulation de 60 jours si le chantier touche les commandes.
4. Relecture indépendante, puis correction de chaque constat.
5. Note dans ce journal, commit et push.

Une relance automatique reprend le travail toutes les heures.

## Feuille de route

Ordre de priorité : la sécurité d'abord, puis ce qui démarque Comptoir des autres plateformes.

1. **Limites de débit persistantes** : les compteurs anti-abus (connexions, formulaires publics) survivent au redémarrage du serveur. Aujourd'hui, un redémarrage les remet à zéro.
2. **Politique de sécurité sans `unsafe-inline`** pour les styles : plus aucun style en ligne, ce qui ferme la dernière porte aux injections CSS.
3. **Factur-X complet** : facture PDF/A-3 avec le XML EN 16931 intégré, lisible par un humain et par un logiciel.
4. **Cartes cadeaux** : vente en ligne, utilisation au paiement et à la caisse, solde, registre, sans double dépense.
5. **Devis pour les clients professionnels** : devis envoyé par lien, accepté en ligne, transformé en commande payable.
6. **Programme de fidélité** : points gagnés à l'achat et utilisés comme remise, sans compte client obligatoire.
7. **Chiffrement au repos des données personnelles des clients** (adresses, téléphones) avec index aveugle pour la recherche.
8. **Stock sur plusieurs emplacements** (magasin, entrepôt), avec transferts.
9. **Test de charge** : 1000 boutiques, et les optimisations qui en découlent.
10. **Parcours d'achat entièrement au clavier et au lecteur d'écran**, de la boutique au paiement.

La feuille de route peut évoluer selon les constats des relectures.

**Deuxième phase** (la première feuille de route est terminée le 13 novembre vers 1 h 50) :

11. **Chiffrement des autres données personnelles** : coordonnées des clients professionnels dans les devis, file d'envoi des webhooks.
12. **Audit de sécurité global** : relecture adversariale de tout le serveur (comptes et sessions, en-têtes, entrées, accès entre boutiques, intégrations), puis corrections.
13. **Vente de cartes cadeaux en ligne**, par le client lui-même, dans la boutique.
14. **Espace marchand au clavier** : caisse, commandes, devis.
15. **E-mails des nouveautés dans les langues de la boutique** (fidélité, cartes cadeaux, devis).

**Troisième phase** (la deuxième est terminée le 13 novembre vers 2 h 40) :

16. **Export complet de la boutique** : ajouter les emplacements, cartes cadeaux, devis, programme de fidélité et registres (portabilité des données, reprise).
17. **Retours partiels** : remettre en stock seulement les articles retournés.
18. **Inscription sans énumération des comptes** : même réponse que l'adresse soit connue ou non.
19. **Webhooks des nouveautés** : devis accepté, carte cadeau émise, transfert de stock.
20. **Une seule commande de vérification** : tests, bout en bout, simulations et audits clavier enchaînés (`npm run verifier`).

**Quatrième phase** (la troisième est terminée le 13 novembre vers 3 h 35) :

21. **Cartes cadeaux et fidélité dans les langues de la boutique** : formulaire d'achat, paiement, messages, e-mail de la carte.
22. **Avoir partiel téléchargeable par le client**, depuis sa page de commande.
23. **Geste commercial** : avoir de remise sans retour d'article, avec sa propre ligne.
24. **Fidélité** : expiration des points prise en compte dans les statistiques et le solde affiché.
25. **Relecture adversariale des nouveautés** (retours partiels, cartes cadeaux, devis, fidélité, emplacements), puis corrections.

## Cycles

### Cycle 1 (22 h 35) : compteurs anti-abus persistants, arrêt propre du serveur

- Les compteurs anti-abus restaient en mémoire seulement : essais de connexion, échecs de mot de passe, limites des formulaires publics. Un redémarrage du serveur, même provoqué par un attaquant, les remettait à zéro. Ils sont désormais recopiés en base toutes les 2 secondes et à l'arrêt, puis rechargés au démarrage.
- Les clés contiennent des adresses IP ou des e-mails : seule leur empreinte (SHA-256) est écrite, jamais la valeur en clair. Les compteurs expirés sont purgés.
- **Arrêt propre** (SIGTERM, SIGINT) : plus de nouvelles requêtes, celles en cours se terminent, les flux en direct sont fermés après 2 secondes, les compteurs sont écrits et la base est fermée proprement. Avant, le serveur n'avait aucun arrêt propre.
- Test en conditions réelles (`limites-persistantes.test.js`) : 10 mauvais mots de passe, blocage, arrêt par SIGTERM, redémarrage, toujours bloqué. Aucune adresse ni e-mail en clair dans la table. 120 tests sur 120, bout en bout 51 sur 51.

### Cycle 2 (22 h 40) : corrections de la relecture du cycle 1

- **Arrêt vraiment propre** : l'arrêt coupait toutes les connexions au bout de 2 secondes, y compris une requête encore en cours vers Stripe ou un fournisseur (l'effet externe avait lieu, mais l'enregistrement en base était perdu). Désormais, le serveur compte les requêtes en cours et attend qu'elles finissent (10 secondes au plus). Les flux en direct sont fermés tout de suite, et le navigateur se reconnecte seul. Un second signal force l'arrêt immédiat.
- **Empreintes non réversibles** : avec un SHA-256 simple, on retrouvait une adresse IP par force brute en quelques secondes. Les empreintes utilisent maintenant un HMAC avec une clé dérivée de `SECRET_CHIFFREMENT`, absente de la base et des sauvegardes.
- **Écriture en échec** : le lot est remis en attente et réessayé au passage suivant (rien n'est perdu), avec un message dans les journaux du serveur.
- **Performance** : écriture par lots de 2000, expiration sur une colonne indexée une fois par minute (au lieu d'un parcours complet de la table toutes les 2 secondes).
- **Test plus solide** : port libre choisi par le système, serveur toujours arrêté même en cas d'échec, et nouveau cas d'arrêt rapide malgré un flux en direct ouvert.

### Cycle 3 (22 h 45) : politique de sécurité sans styles en ligne

- La politique de sécurité (CSP) acceptait les styles en ligne (`'unsafe-inline'`). Une injection de HTML, même sans script, pouvait donc restyler une page : faux bouton, texte masqué, superposition. Les styles en ligne sont désormais refusés partout.
- Les 33 attributs `style` de l'interface sont remplacés par des attributs typés (`data-largeur`, `data-hauteur`, `data-largeur-px`, `data-vars`), appliqués par un petit module (`js/styles-surs.js`). Ce module n'accepte que des nombres bornés, ou des propriétés personnalisées (`--nom`) aux valeurs vérifiées (couleur, nombre, police) : même injecté, un de ces attributs ne permet pas de CSS libre ni d'adresse externe.
- Les feuilles de style des pages produites par le serveur (factures, pages simples, paiement de test) et des pages statiques (accueil, boutique) sont autorisées une à une par leur empreinte SHA-256.
- Vérifié dans un vrai navigateur : accueil, 13 écrans de l'espace marchand, boutique, pages légales et de désinscription. **Aucune violation**, aucune erreur ; barres, thème de la boutique et aperçus de thème s'affichent comme avant.
- 120 tests sur 120, bout en bout 51 sur 51.

### Cycle 4 (23 h 00) : corrections de la relecture du cycle 3

Relecture indépendante de la politique sans styles en ligne. Elle a comparé les styles calculés d'environ 480 éléments avant et après la modification : tous identiques. Aucune violation sur l'ensemble des pages, démo comprise. Points corrigés :
- **Liste fermée** : `data-vars` acceptait n'importe quelle propriété personnalisée, par exemple `--control-h`, qui règle la hauteur des boutons, ou un mot-clé comme `transparent`. Désormais, seules les couleurs et polices des thèmes et la teinte des visuels sont acceptées, chacune avec son type : couleur hexadécimale ou rgb/hsl, longueur en px, liste de polices, nombre.
- **Valeurs périmées** : une valeur retirée ou devenue invalide est maintenant effacée. Avant, l'ancienne couleur ou largeur restait.
- La lecture des blocs `<style>` des pages statiques accepte les attributs (`<style media=…>`).
- **Nouveau test serveur** (`csp-styles.test.js`) : sur 8 pages, pas de `'unsafe-inline'`, aucun attribut `style`, et chaque bloc `<style>` est autorisé par son empreinte.
- Vérifié dans un vrai navigateur : propriétés refusées, valeurs retirées, barres et thèmes intacts. 121 tests sur 121, bout en bout 51 sur 51.

### Cycle 5 (23 h 10) : Factur-X complet (PDF/A-3 avec le XML EN 16931 joint)

- Chaque facture et chaque avoir se téléchargent en **PDF Factur-X** (bouton « PDF Factur-X » dans la fiche commande). Le client lit le PDF ; son logiciel comptable lit le fichier `factur-x.xml` joint, celui de la norme européenne EN 16931. C'est le format de la facture électronique en France.
- Le PDF est écrit par Comptoir, sans bibliothèque externe :
  - polices DejaVu intégrées en sous-ensemble (seuls les caractères utilisés), texte copiable et cherchable ;
  - profil de couleur sRGB, métadonnées PDF/A-3B et schéma d'extension Factur-X ;
  - fichier XML joint et déclaré comme données de la facture.
- Mêmes contrôles que le XML seul : s'il manque une mention obligatoire, ou si les montants sont incohérents, rien n'est produit. Les montants sont ceux du XML et de la facture imprimée. Les longues commandes passent sur plusieurs pages.
- Vérifié avec les outils poppler : le XML extrait du PDF est identique et valide selon le schéma officiel Factur-X, les polices sont intégrées avec leur table Unicode, et le texte s'extrait. Téléchargement vérifié dans un vrai navigateur.
- **Limite** : la conformité PDF/A n'a pas été contrôlée par un validateur officiel (veraPDF, absent de l'environnement). Les caractères absents de la police (emoji, idéogrammes) s'affichent « ? ».

### Cycle 6 (23 h 20) : corrections de la relecture du cycle 5

Une relecture indépendante a vérifié la structure du PDF octet par octet, le sous-ensemble de police, l'échappement de chaque texte et les montants. Points corrigés :
- **Blocage du serveur** : la coupure des lignes pouvait prendre beaucoup trop de temps avec un mot très long (41 secondes pour 8 000 caractères dans l'adresse du vendeur). Elle se fait désormais en temps linéaire, sur un texte borné : 300 000 caractères passent en quelques millisecondes.
- **Métadonnées identiques** : un caractère de contrôle dans la raison sociale apparaissait dans les propriétés du PDF mais pas dans les métadonnées XMP, ce que PDF/A interdit. Le même texte nettoyé sert maintenant aux deux.
- **Mise en page** :
  - les noms très longs (vendeur, client) passent à la ligne au lieu de sortir de la page ;
  - une page suivante n'a plus d'en-tête de tableau vide ;
  - les mentions de paiement (montant, IBAN) restent ensemble sur une même page.
- **Cohérence** :
  - montants en francs au format habituel de Comptoir (CHF 1’234.50) ;
  - arrondi des espèces affiché dans les mêmes conditions que dans le XML ;
  - dates calculées dans le même fuseau horaire que le XML ;
  - une devise invalide n'interrompt plus la production du PDF.
- **Restent tels quels** :
  - la relation du fichier joint (« Data ») est l'une des valeurs que permet la spécification Factur-X ;
  - l'IBAN visible par le rôle « commandes » l'est déjà sur la facture QR.
- Nouveau test de régression. 126 tests sur 126, bout en bout 51 sur 51.

### Cycle 7 (23 h 40) : cartes cadeaux

- Le marchand émet une carte depuis « Magasin et caisse » : montant, validité (sans limite, 1, 2 ou 3 ans) et destinataire. Il peut l'imprimer et la désactiver.
- **Code secret** :
  - 16 caractères (80 bits d'aléa), sans caractères ambigus, montrés une seule fois ;
  - la base n'en garde qu'une empreinte HMAC et les 4 derniers caractères ;
  - à la saisie, minuscules, tirets et O à la place de 0 sont acceptés ;
  - les essais sont limités par adresse et par boutique.
- **Utilisation** :
  - en ligne, la carte paie tout ou partie de la commande, et le reste se paie par carte bancaire ou TWINT ;
  - à la caisse, la carte passe en premier, le reste s'encaisse en espèces (arrondi à 5 centimes en Suisse), par carte ou par TWINT ;
  - la carte est refusée pour une vente hors ligne (son solde doit être vérifié) et pour le paiement sur facture.
- **Argent juste** :
  - les montants sont gardés en centimes entiers ;
  - le débit est une instruction conditionnelle unique, donc deux paiements simultanés ne dépensent jamais deux fois le même solde ;
  - en cas de commande annulée ou remboursée, la part payée par la carte revient sur la carte (le reste est remboursé par le moyen d'origine) ;
  - si le reste n'est pas payé après 2 heures, le lien de paiement est fermé et la carte recréditée ; si le client reprend son paiement, la carte est débitée à nouveau ;
  - si un paiement arrive malgré tout alors que la carte a été vidée entre-temps, l'argent est marqué « à rendre » et la commande n'est jamais payée à moitié.
- **Registre** : chaque mouvement est inscrit avec le solde qui en résulte. Un contrôle vérifie que le solde est égal à la somme des mouvements.
- Fiscalité : une carte valable pour tout le catalogue est un bon à usages multiples. Elle est traitée comme un moyen de paiement : la TVA porte sur les articles achetés avec elle, pas sur la vente de la carte. Les factures (imprimée et Factur-X) mentionnent la part réglée par carte.
- Vérifié dans un vrai navigateur : émission, code masqué après lecture, ticket de caisse entièrement payé par la carte, panier de la boutique avec carte et reste payé en ligne. Aucune erreur.
- 4 nouveaux tests : 130 tests sur 130, bout en bout 51 sur 51. Une relecture indépendante est en cours.
- Pas encore fait : la vente de cartes cadeaux en ligne par le client lui-même. Elle viendra dans un prochain cycle.

### Cycle 8 (23 h 50) : devis pour les clients professionnels

- Nouvel écran « Devis » (Ventes). Le marchand rédige un devis : client professionnel (raison sociale, contact, e-mail, adresse, numéro de TVA), articles du catalogue ou lignes libres en prix HT (prestation, article sur mesure), remise globale, livraison, validité, objet et conditions.
- **Envoi par lien personnel** : jeton aléatoire de 256 bits, dont la base ne garde que l'empreinte. Le client reçoit le lien par e-mail. Modifier un devis envoyé le repasse en brouillon et coupe l'ancien lien ; l'annuler le coupe aussi.
- **Page du devis**, sans compte ni script : détail HT/TTC par taux, conditions, validité. Le client l'accepte (« bon pour accord » et nom du signataire) ou la refuse. Le premier affichage est noté (« consulté par le client »).
- **Acceptation unique et prouvée** : relue dans une transaction, si bien que deux clics simultanés ne créent qu'une seule commande (vérifié). Sont conservés la date, le signataire, l'empreinte HMAC du réseau (jamais l'adresse en clair) et l'empreinte SHA-256 du contenu accepté. Un devis accepté, refusé ou expiré ne change plus.
- **Devis accepté, commande créée** : avec exactement les montants du devis (prix nets par ligne, taux de TVA figés). Elle se paie en ligne depuis la page du devis ou par virement (IBAN et référence affichés). Le marchand et le client sont prévenus. Facture et facture électronique reprennent les mêmes montants ; le numéro de TVA du client figure désormais dans le XML (BT-48).
- Duplication d'un devis : nouvelle numérotation (DE-2026-0002…), prix du catalogue du jour.
- Vérifié dans un vrai navigateur : rédaction, envoi, page publique, acceptation, paiement, suivi dans la liste. Aucune erreur.
- 4 nouveaux tests (calcul, parcours complet, double acceptation simultanée, refus, expiration, modification après envoi, annulation, droits) : 134 tests sur 134.

### Cycle 9 (23 h 55) : corrections de la relecture des cartes cadeaux

Relecture indépendante des cartes cadeaux : scénarios rejoués sur une copie du code, argent suivi au centime. Points corrigés :
- **Grave, factures PDF** : depuis l'ajout de la mention « carte cadeau », une facture déjà payée (et chaque avoir) affichait « Montant à payer » avec l'IBAN. Le client risquait de payer deux fois. Corrigé, avec un test qui vérifie qu'une facture payée ne demande jamais de paiement.
- **Paiement repris** : la libération automatique (2 heures) comptait depuis la date de la commande. Après une reprise, la carte était donc recréditée 5 minutes plus tard et le nouveau lien de paiement fermé. Le délai compte désormais depuis la dernière réservation.
- **Commande marquée payée à la main** après la libération : la carte n'était pas débitée à nouveau, et sa part était donc offerte. Elle est maintenant débitée ; si le solde ne suffit plus, le changement est refusé avec une explication.
- **Paiement annulé par le client** : la carte restait bloquée 2 heures et le message était trompeur. Elle est rendue dès le retour sur la boutique. Une carte réservée par une commande en cours affiche maintenant un message distinct.
- **Minimum du prestataire** (0,50) : un petit reste à payer faisait échouer le paiement. La carte laisse désormais au moins 0,50 à payer en ligne ; le serveur et la boutique calculent la même chose.
- **Caisse** :
  - le solde de la carte est vérifié avant d'encaisser, et la monnaie à rendre comme l'arrondi portent sur le reste ;
  - après une coupure réseau, une vente avec carte n'est jamais mise en file hors ligne, et un nouveau ticket sans la carte demande une confirmation (pas de double paiement) ;
  - la carte du client précédent n'est plus préremplie.
- **Traçabilité** :
  - la part payée par carte est scellée dans le journal des ventes, affichée dans la fiche commande et dans les e-mails ;
  - les frais de paiement estimés ne portent que sur le reste ;
  - l'émission d'une carte est notée dans le journal d'activité, et le propriétaire est prévenu quand un membre de l'équipe émet une carte.
- **Sécurité** :
  - les empreintes des codes utilisent une sous-clé dédiée (HKDF) ;
  - seuls les essais en échec sont limités (par boutique en ligne, par vendeur en caisse), si bien qu'un tiers ne peut plus bloquer les cartes des clients ;
  - la liste des cartes reste consultable abonnement terminé.
- **Règles** : en Belgique, une carte est valable au moins 2 ans (loi du 22 avril 2019). Le texte sur la TVA est nuancé : bon à usage unique ou multiple selon les cas, à voir avec la fiduciaire.
- **Restent ouverts** :
  - un crédit sur une carte expirée ou désactivée (après annulation) reste bloqué : le marchand émet une nouvelle carte ;
  - l'export CSV n'a pas encore de colonne « carte cadeau ».
- 3 nouveaux tests ; vérifié dans un vrai navigateur (caisse : carte vérifiée, 50 € sur la carte, 30 € en espèces, 20 € rendus). 137 tests sur 137.

### Cycle 10 (00 h 05) : programme de fidélité sans compte client

- Le marchand active le programme dans la page Clients et règle cinq paramètres :
  - les points gagnés par franc ou euro dépensé ;
  - la valeur de 100 points ;
  - le minimum de points pour les utiliser ;
  - la part maximale d'une commande payée en points ;
  - l'expiration après une période d'inactivité.
  
  Un exemple chiffré s'affiche, ainsi que les points en circulation et leur valeur.
- **Sans compte client** : le client est reconnu par son e-mail, dont la base ne garde qu'une empreinte HMAC (sous-clé dédiée). Aucun fichier de clients supplémentaire n'est créé.
- **Utiliser ses points demande un code à usage unique** envoyé par e-mail (6 chiffres, valable 15 minutes, 5 essais). Connaître l'adresse de quelqu'un ne suffit pas. La réponse est la même que l'adresse ait des points ou non, et aucun e-mail ne part vers une adresse sans points : ni énumération ni envoi de pourriel. Les demandes sont limitées par adresse et par réseau.
- **Les points sont une remise, pas un moyen de paiement** : ils baissent les prix des articles du même facteur, si bien que factures, TVA et facture électronique restent justes (vérifié). La remise est plafonnée, le seuil de livraison offerte est calculé avant les points, et les points engagés par une autre commande en attente ne sont pas comptés deux fois.
- **Gain au paiement**, sur le prix réellement payé (après remises). Le remboursement retire les points gagnés et rend les points utilisés, une seule fois. Registre des mouvements vérifiable.
- **Boutique** : « Cette commande vous rapporte N points », puis « Utiliser mes points de fidélité » (e-mail, code, case à cocher). La remise s'affiche dans les totaux et l'e-mail est prérempli dans la commande.
- Vérifié dans un vrai navigateur : activation, 1re commande (100 points), code reçu, 2e commande à 95 € au lieu de 100 €. Aucune erreur.
- 2 nouveaux tests (module et parcours complet) : 139 tests sur 139.

### Cycle 11 (00 h 15) : corrections de la relecture des devis

Relecture indépendante des devis : 5000 devis aléatoires contrôlés par les règles EN 16931, parcours complet rejoué. Points corrigés :
- **Grave, fournisseur** : une commande issue d'un devis avec un article en dropshipping perdait l'identifiant du fournisseur. Elle aurait été transmise au fournisseur de démonstration au lieu du vrai. L'identifiant est désormais repris, et seuls les produits vendables (visibles, vérifiés) peuvent figurer dans un devis.
- **Grave, relances** : le client professionnel qui avait accepté un devis recevait les relances de « panier abandonné ». Les commandes issues d'un devis en sont exclues.
- **Grave, arrondis** : le calcul se faisait par unité. Pour 9,99 HT × 1000, le devis affichait 9 991,67 HT au lieu de 9 990,00, et une remise sur des prix très bas pouvait doubler. Le calcul se fait maintenant par ligne : total HT saisi × quantité, puis TTC. Le prix HT saisi est conservé (modification, duplication), et le paiement en ligne porte sur le montant exact.
- **Grave, droit de rétractation** : il était annoncé à des professionnels, avec le parcours de retour des particuliers. Une commande issue d'un devis n'en a pas.
- **Page du devis** : une erreur (double clic, devis expiré, trop d'essais) réaffiche la page avec le message, au lieu d'une réponse technique.
- **Liens personnels** : ils sont masqués dans la liste des e-mails de l'espace marchand.
- **Facture électronique** : le numéro de TVA du client n'est repris que s'il est valide et que le vendeur est assujetti (règles BR-O-02 et BR-CO-09).
- **Client d'un autre pays** : la TVA intracommunautaire n'est pas encore gérée. Un tel devis est donc refusé avec une explication, au lieu d'appliquer à tort la TVA du pays de la boutique.
- **Stock** : un manque est signalé dès l'acceptation (historique et e-mail au marchand). Le stock est réservé 7 jours pour une commande issue d'un devis, le temps d'un virement.
- **Écran Devis** :
  - pays du client ;
  - une ligne sans prix n'est plus enregistrée à 0 ;
  - le formulaire n'est plus redessiné pendant la saisie, et la liste se met à jour quand un client accepte ;
  - confirmation avant de fermer sans enregistrer ;
  - message clair si l'envoi échoue ;
  - filtre « Devis » dans les commandes.
- Les lignes libres (prestations) ne donnent plus lieu à une demande d'avis.
- Un devis expiré qu'on renvoie retrouve sa durée de validité.
- **Restent ouverts** : un instantané de la page acceptée (preuve plus complète), et les mentions B2B françaises (pénalités de retard, indemnité de 40 €) sur la facture.
- Tests renforcés : la facture électronique d'une commande issue d'un devis est vérifiée. Grande quantité, client d'un autre pays : 139 tests sur 139. Vérifié dans un vrai navigateur.

### Cycle 12 (00 h 30) : corrections de la relecture de la fidélité

Relecture indépendante du programme de fidélité : 200 000 paniers aléatoires, scénarios rejoués. Points corrigés :
- **Grave, double utilisation des points** :
  - une commande marquée payée à la main (virement) ne débitait jamais ses points ;
  - les points n'étaient bloqués que 2 heures alors qu'une commande peut être payée plus tard.

  Un client pouvait donc obtenir plusieurs remises avec les mêmes points. Les points sont désormais **débités dès la commande**, comme une carte cadeau. Ils sont rendus si le paiement n'aboutit pas (abandon, 2 heures sans paiement, annulation, échec d'ouverture du paiement) et repris si le client paie quand même. Si les points ont été dépensés entre-temps, le paiement est refusé ou marqué « à rendre ». La carte cadeau et les points passent par les mêmes fonctions (réservation, libération, reprise, tout ou rien).
- **Remboursement** : les points gagnés déjà dépensés ne peuvent pas être repris. L'écart et sa valeur sont maintenant notés dans l'historique de la commande, au lieu de disparaître.
- **Force brute sur le code** : un nouveau code remettait le compteur d'erreurs à zéro. Les échecs sont maintenant comptés par adresse sur 24 heures (10 au plus), même en redemandant des codes. Les échecs sont aussi limités par boutique.
- **Droit à l'effacement** : effacer un client efface aussi ses points, son code et ses mouvements.
- **Garde-fou** : un programme qui rendrait plus de 30 % du prix en points est refusé (une faute de frappe ne ruine plus la boutique). Une mise à jour partielle des réglages garde les autres valeurs.
- **Arrondi** : la remise est arrondie au centime supérieur des prix, donc elle ne dépasse jamais la valeur des points.
- **Boutique** : un code expiré ou déjà utilisé ramène à la demande d'un nouveau code, et on peut changer d'adresse.
- Les commandes issues d'un devis (clients professionnels) ne rapportent plus de points.
- **Restent ouverts** : l'expiration des points se calcule à la lecture du compte (statistiques un peu hautes pour les comptes inactifs jamais relus), et l'e-mail du code n'existe qu'en français.
- 1 nouveau test de régression (réservation, paiement manuel, abandon, reprise refusée, annulation, force brute, effacement, générosité) : 140 tests sur 140. Bout en bout 51 sur 51, vérifié dans un vrai navigateur.

### Cycle 13 (00 h 45) : test de charge sur 1000 boutiques, optimisations

- Nouvel outil, `outils/simulation/charge.js`. Il fait tourner le vrai serveur dans son propre processus :
  - 1000 boutiques créées par l'API (en 11 secondes) ;
  - 200 000 commandes d'historique sur 13 mois (base de 111 Mo) ;
  - 60 secondes de trafic mêlé avec 50 clients simultanés : vitrines, pages de boutique, commandes et paiements, espace marchand, devis, cartes cadeaux.
- **Premier résultat** : 705 requêtes par seconde, aucune erreur, 136 Mo de mémoire. Mesuré requête par requête, sans concurrence : vitrine 1,5 ms, espace marchand complet 4,6 ms, commande payée de bout en bout 6 ms. Les latences sous charge (63 ms médianes partout) venaient donc de la file d'attente devant un seul processeur.
- **Profilage du serveur sous charge** (profil CPU de Node, analysé fonction par fonction) : la compression gzip synchrone des réponses prenait environ 11 % du temps du fil principal, et le formatage des montants environ 5 % (un formateur `Intl` recréé à chaque appel).
- **Optimisations** :
  - les grandes réponses sont compressées hors du fil principal (pool de threads de Node) ;
  - le formateur de montants est gardé par devise.

  Résultat : **859 requêtes par seconde (+22 %)**, et la médiane des petites requêtes passe de 63 à 30 ms. Toujours aucune erreur.
- **Essayé puis retiré** : un cache des réponses compressées. Avec 1000 boutiques visitées au hasard, il ne servait presque jamais et ne gagnait rien.
- **Limite honnête** : un seul processus Node, dont les compteurs anti-abus et les flux en direct sont en mémoire. Au-delà d'environ 800 requêtes par seconde soutenues, il faudrait plusieurs processus, avec ces états partagés (base ou Redis). C'est une étape d'architecture, pas un réglage.
- Simulation de 60 jours (100 marchands) relancée après les chantiers des cartes cadeaux, des devis et de la fidélité : 68 335 requêtes, médiane 2 ms, **0 anomalie**. 140 tests sur 140, bout en bout 51 sur 51.

### Cycle 14 (00 h 55) : données personnelles des clients chiffrées au repos

- Dans chaque commande, les données du client (nom, e-mail, adresse, code postal, ville, téléphone, numéro de TVA) sont désormais **chiffrées en AES-256-GCM**. Ce chiffrement authentifié détecte une donnée modifiée ou recopiée ailleurs dans la base. La clé est dérivée (HKDF) de `SECRET_CHIFFREMENT`.
- **Index aveugle** : une nouvelle colonne contient une empreinte HMAC de l'e-mail (avec une clé distincte), indexée. Elle sert à retrouver les commandes d'un client : « mes commandes », client de confiance pour le score de risque, code de bienvenue réservé à une première commande. L'adresse n'est jamais stockée en clair, et l'index ne permet pas de la retrouver.
- **Transparent pour le reste du code** : déchiffrement à la lecture, chiffrement à chaque écriture. Les recherches qui lisaient l'e-mail en clair dans la base passent par l'index. Les commandes anciennes, ou importées en clair, sont chiffrées une fois au démarrage, par lots.
- **Vérifié** :
  - après une commande, ni le nom, ni l'e-mail, ni la rue, ni le code postal n'apparaissent dans la base ;
  - une donnée falsifiée ou lue avec une autre clé est refusée ;
  - la migration d'une commande en clair se fait sans perte ;
  - l'effacement d'un client fonctionne.
  
  Simulation de 60 jours (100 marchands) : 0 anomalie, l'audit déchiffrant avec la clé comme le serveur. Test de charge sur 1000 boutiques : aucune erreur, environ 700 requêtes par seconde (le déchiffrement coûte un peu à l'espace marchand).
- **Limites honnêtes** :
  - sans `SECRET_CHIFFREMENT`, la clé est dans la base : le chiffrement ne protège alors pas d'une copie complète. Le démarrage le signale déjà ;
  - la file des e-mails (destinataire, contenu) et les comptes marchands restent en clair : ce sont des données d'exploitation, à purger selon la durée de conservation ;
  - changer `SECRET_CHIFFREMENT` rend les données existantes illisibles (documenté dans MISE-EN-LIGNE.md).
- 2 nouveaux tests : 142 tests sur 142, bout en bout 51 sur 51.

### Cycle 15 (01 h 00) : parcours d'achat entièrement au clavier et au lecteur d'écran

- Nouvel outil, `outils/simulation/clavier.js`. Il fait un achat complet sans souris dans un vrai navigateur :
  - refus des cookies ;
  - ajout au panier ;
  - quantité ;
  - livraison aux flèches ;
  - envoi du formulaire vide ;
  - saisie des coordonnées ;
  - paiement, confirmation, fermeture avec Échap.
  
  À chaque tabulation, il vérifie que le focus est visible. Il vérifie aussi que le focus reste dans la fenêtre ouverte (40 tabulations), qu'il va au bon endroit à l'ouverture comme à la fermeture, et que les changements sont annoncés.
- **Ce qui marchait déjà** : focus visible partout, piège du focus dans le panier, Échap, focus sur le premier champ requis, passage au paiement et confirmation.
- **Corrigé** :
  - l'ajout au panier n'était annoncé à aucun lecteur d'écran. Une zone d'annonce permanente (« status », hors de l'application redessinée) dit maintenant « Vase bleu ajouté au panier. 1 article dans le panier. » ;
  - les changements de quantité et les retraits sont annoncés de la même façon ;
  - à la fermeture du panier (bouton, fond ou Échap), le focus revenait sur la page entière. Il revient désormais sur le bouton qui avait ouvert le panier ;
  - les erreurs de commande (stock, code, paiement indisponible) sont annoncées tout de suite (« alert »).
- Résultat de l'outil : **aucun problème, aucune erreur JavaScript**. 142 tests sur 142, bout en bout 51 sur 51.

### Cycle 16 (01 h 10) : mentions des factures entre professionnels

- Point resté ouvert dans la relecture des devis. Une commande issue d'un devis reçoit maintenant une **échéance de paiement** à l'acceptation : le délai réglé dans la boutique, 30 jours par défaut. L'échéance figure aussi dans la facture électronique.
- La facture imprimée et la facture Factur-X d'une vente entre professionnels indiquent désormais :
  - le **numéro de TVA du client** ;
  - le devis d'origine ;
  - l'échéance, si la facture n'est pas payée.
  
  En France, elles indiquent aussi **les mentions de l'art. L441-10 du Code de commerce** : pas d'escompte pour paiement anticipé, pénalités de retard à trois fois le taux d'intérêt légal, indemnité forfaitaire de 40 € pour frais de recouvrement.
- Test vérifiant le texte du PDF (numéro de TVA, mentions, devis d'origine) : 142 tests sur 142.

### Cycle 17 (01 h 40) : corrections de la relecture du chiffrement

Relecture indépendante du chiffrement des données clients : changement de clé, données falsifiées, copie d'une commande à l'autre, migration de 200 000 commandes, résidus dans le fichier. Points corrigés :
- **Grave, changement de clé** : un exploitant qui définissait `SECRET_CHIFFREMENT` après l'ouverture (comme le démarrage le lui conseille) rendait toutes les boutiques inutilisables, sans aucun message. Comptoir utilise désormais un **trousseau** : la clé courante chiffre, et l'ancienne clé, gardée dans la base, déchiffre encore. Au démarrage, tout est rechiffré avec la clé courante (repère d'empreinte de clé dans la base). Une donnée illisible avec toutes les clés connues est signalée clairement dans les journaux du serveur.
- **Grave, une seule ligne abîmée bloquait tout** : l'espace marchand, les nouvelles commandes et les tâches de fond. La lecture est désormais tolérante : le client s'affiche « (données client illisibles) », la boutique continue de fonctionner, et le chiffré d'origine est **conservé tel quel** à la prochaine écriture (jamais écrasé).
- **Liaison à la commande** : le chiffré inclut désormais la boutique et la commande dans ses données authentifiées. Recopié dans une autre commande ou une autre boutique, il est refusé. « Mes commandes » vérifie en plus l'adresse déchiffrée, pas seulement l'index.
- **Index aveugle propre à chaque boutique** : un même client n'est plus reliable d'une boutique à l'autre. L'adresse est normalisée (Unicode NFC, espaces, casse). L'étiquette d'authentification fait obligatoirement 16 octets.
- **Migration robuste** : par pages, ligne par ligne. Une ligne au JSON abîmé ou un client vide ne bloque plus le démarrage et ne le fait plus tourner en boucle. Après conversion, le fichier est compacté, et les pages libérées pendant la migration et l'effacement d'un client sont remises à zéro (`secure_delete`). Mesure de la relecture : avant, 8 529 clients restaient lisibles dans le fichier après migration.
- **Performance** :
  - recherche des réservations de stock et des commandes d'un client par l'index, sans rien déchiffrer ;
  - cache borné des données déchiffrées, clé couvrant tout le chiffré (un premier essai avec une clé tronquée laissait passer une falsification : le test l'a attrapé, c'est corrigé) ;
  - pas de rechiffrement d'un client inchangé.
  
  Test de charge (1000 boutiques) : 605 requêtes par seconde, contre 690 avant ces protections, sans erreur.
- **Documentation corrigée** : la liste de ce qui reste en clair a été complétée (file des e-mails, envois de webhooks, devis, avis, newsletter, alertes de stock).
- 143 tests sur 143, bout en bout 51 sur 51, simulation de 60 jours : 0 anomalie.

### Cycle 18 (01 h 50) : stock sur plusieurs emplacements

- Nouvelle section « Emplacements de stock » dans Magasin et caisse : magasins, entrepôts et dépôts (20 au plus), transferts, tableau de répartition par article et par variante.
- **Le total ne change pas de rôle** : le stock de la fiche produit reste celui de la boutique, de la caisse et des réservations. Les emplacements en donnent la répartition, et la somme des emplacements est toujours égale au total, ce que vérifie un contrôle.
  - Le premier emplacement créé reçoit tout le stock actuel et devient l'emplacement principal.
  - Une vente en caisse prend d'abord dans un magasin, une vente en ligne (ou issue d'un devis) d'abord dans un entrepôt.
  - Une annulation ou un remboursement remet les articles là d'où ils venaient (la répartition est notée sur la ligne de commande).
  - Un stock corrigé dans la fiche produit (inventaire, API) : l'écart va à l'emplacement principal ; une baisse prend ensuite ailleurs.
  - Un transfert ne change pas le total et refuse de prendre plus que l'emplacement n'en contient.
  - Un emplacement ne se supprime que vide, et le principal en dernier.
- Registre des mouvements (stock initial, vente, retour, correction, transfert) et entrée dans le journal d'activité. Sans emplacement déclaré, rien ne change.
- Vérifié dans un vrai navigateur (deux emplacements, transfert de 5 articles, répartition affichée). 2 tests : module et parcours complet (transfert, caisse au magasin, vente en ligne à l'entrepôt, remboursement, correction de fiche). 144 tests sur 144, bout en bout 51 sur 51, simulation de 60 jours : 0 anomalie.
- **Toute la feuille de route du marathon est réalisée.** Chaque chantier a été relu, sauf celui-ci, dont la relecture est en cours.

### Cycle 19 (01 h 55) : chiffrement des devis et de la file des webhooks

- Premier chantier de la deuxième phase. Les **coordonnées des clients professionnels dans les devis** (raison sociale, contact, e-mail, adresse, numéro de TVA) sont désormais chiffrées au repos, comme les clients des commandes : AES-256-GCM, lié à la boutique et au devis.
- **Nom du signataire** : il apparaissait en clair dans l'historique du devis et dans celui de la commande. Il est maintenant rangé avec les coordonnées chiffrées et présenté comme avant dans l'acceptation, mais il n'est jamais écrit en clair. L'historique ne contient plus non plus l'e-mail du client (« Envoyé au client par e-mail »).
- **File d'envoi des webhooks** : chaque événement en attente (commande payée, expédiée…) contenait le nom, l'e-mail et l'adresse du client pendant 30 jours. Il est désormais chiffré, lié à la boutique et à l'envoi, et déchiffré seulement au moment de l'envoi. L'effacement d'un client (RGPD) le retrouve par un index aveugle. Un envoi illisible (clé changée) est marqué en échec, sans bloquer la file.
- Les devis et envois existants sont chiffrés une fois au démarrage.
- Tests : rien de lisible en base pour le devis, le signataire et l'envoi de webhook. 144 tests sur 144, bout en bout 51 sur 51.

### Cycle 20 (02 h 00) : e-mails des nouveautés dans la langue du client

- Le récapitulatif des e-mails de commande en allemand, en italien et en anglais indique maintenant la part payée par carte cadeau (avec le reste) et les points de fidélité gagnés, comme en français.
- L'e-mail du code de fidélité part dans la langue où le client navigue dans la boutique, si la boutique propose cette langue.
- Les devis restent en français (rédigés par le marchand pour des clients professionnels).
- 1 nouveau test : 145 tests sur 145.

### Cycle 21 (02 h 05) : corrections de la relecture des emplacements

Relecture indépendante du stock sur plusieurs emplacements, six scénarios rejoués sur un vrai serveur. Points corrigés :
- **Ticket de caisse remboursé** : la vente était enregistrée avant le prélèvement, donc la ligne ne gardait pas d'où venaient les articles. Un remboursement les remettait à l'entrepôt principal au lieu du magasin. Le prélèvement se fait maintenant avant l'enregistrement.
- **Lignes orphelines** : une variante renommée ou retirée, ou des options ajoutées à un produit, laissaient d'anciennes lignes invisibles, ce qui comptait des articles en double. Elles sont retirées à chaque enregistrement de la fiche, avec une écriture au registre, et le contrôle les signale désormais.
- **Produit supprimé ou boutique réinitialisée** : ses articles bloquaient la suppression de l'emplacement, sans aucun moyen de les déplacer. Ses lignes sont maintenant retirées à la suppression. Les restes des suppressions antérieures sont nettoyés à l'ouverture de l'écran.
- **Retrait en boutique (click & collect)** : la commande prélevait d'abord à l'entrepôt. Elle prélève maintenant d'abord au magasin, où le client vient chercher l'article.
- **Atomicité** : la fiche produit et sa répartition sont écrites dans la même transaction, et une erreur n'est plus avalée.
- **Écran** :
  - produits masqués compris ;
  - recherche d'un article au-delà de 20 ;
  - au-delà de 100 lignes, un message invite à préciser la recherche ;
  - la section reste ouverte après une action ;
  - « Supprimer » ne s'affiche que pour un emplacement vraiment vide d'après le serveur.
- **Restent ouverts** :
  - un retour partiel remet en stock toute la commande (comportement antérieur à ce chantier) ;
  - l'export complet de la boutique ne contient pas encore la répartition.
- 1 nouveau test de régression : 146 tests sur 146, bout en bout 51 sur 51, vérifié dans un vrai navigateur.

### Cycle 22 (02 h 25) : audit de sécurité global et corrections

Chantier 12 de la deuxième phase. Un relecteur indépendant a audité tout le serveur, pas fonctionnalité par fonctionnalité mais sur l'ensemble de la surface d'attaque : comptes et sessions, rôles de l'équipe (chaque route essayée avec chaque rôle), CSRF, isolation entre boutiques, injections, SSRF des webhooks, fuites d'informations, déni de service. Il n'a trouvé **aucune faille critique**. Points corrigés :
- **E-mails gardés en base** : la copie de chaque e-mail contenait en clair les liens de réinitialisation de mot de passe, d'invitation, de devis et de suivi, ainsi que les codes de fidélité. Une copie de la base permettait donc de prendre un compte (démontré par le relecteur). Dès l'envoi, la copie gardée a désormais ses secrets masqués, et la liste des e-mails de l'espace marchand les masque aussi. Le nom du signataire ne figure plus dans l'e-mail au marchand.
- **Double authentification** : avec le mot de passe, environ 35 % de chances de deviner un code en un mois. Les limites sont maintenant de 10 erreurs par quart d'heure et 30 essais par jour pour le compte (hors appareil connu), comptées aussi par bloc d'adresses IPv4 (/24).
- **Stock bloqué par des commandes jamais payées** : au plus 3 commandes impayées en cours par adresse e-mail et par réseau. Le réseau est noté par empreinte HMAC, jamais en clair. Les commandes payées ne comptent pas (un premier essai qui les comptait bloquait un vrai client ; le parcours de bout en bout l'a révélé).
- **Domaine personnalisé d'un marchand** : l'espace marchand, la connexion et la console y étaient servis, et un cookie de session pouvait être posé pour ce domaine. Sur ce domaine, seule la boutique est maintenant servie.
- **Énumération des comptes par le temps de réponse** : la connexion fait le même calcul scrypt, que le compte existe ou non. L'inscription répond toujours « adresse déjà utilisée » (limite connue, à revoir dans le parcours d'inscription).
- **Droit à l'effacement** : les devis du client sont désormais anonymisés (montants gardés pour la comptabilité) et leur lien est coupé.
- **Empreinte du devis accepté** : elle se recalcule de nouveau à l'identique, car le signataire n'en fait plus partie.
- **Vérifié correct par l'audit** :
  - rôles et mode lecture seule ;
  - sessions (jeton de 256 bits haché, `__Host-`, révocations) ;
  - CSRF ;
  - absence de pollution de prototype ;
  - isolation entre boutiques sur toutes les tables ;
  - requêtes SQL paramétrées ;
  - échappement HTML ;
  - SSRF des webhooks (adresses privées sous toutes leurs formes, DNS épinglé) ;
  - aucun prix d'achat dans les données publiques.
- **Restent ouverts** : l'historique en clair de quelques commandes et devis créés avant le chiffrement (données de développement), et le motif de retour saisi par le client.
- 4 nouveaux tests : 150 tests sur 150, bout en bout 51 sur 51, simulation de 60 jours : 0 anomalie.

### Cycle 23 (02 h 35) : vente de cartes cadeaux en ligne

- Chantier 13 de la deuxième phase. Dans « Magasin et caisse », le marchand active la vente en ligne et choisit les montants proposés (8 au plus, de 5 à 1000) et la validité (2 ans au moins en Belgique).
- Dans la boutique, « Offrir une carte cadeau » apparaît en pied de page. Le client choisit le montant et indique son nom, son e-mail et, s'il le souhaite, l'e-mail et le prénom de la personne à qui il l'offre, ainsi qu'un message. Il paie en ligne, et la carte est émise au paiement puis envoyée par e-mail (« Léa vous offre une carte cadeau… »). La page de confirmation l'annonce, sans étapes de livraison.
- **Bon à usages multiples** : pas de facture ni de numéro de facture (la TVA porte sur les articles achetés avec la carte), pas de points de fidélité, pas de relance de panier abandonné. Le code de la carte n'est gardé nulle part en clair : la copie de l'e-mail est masquée dès l'envoi. Le destinataire et le message sont chiffrés avec le client.
- **Remboursement** : une carte non utilisée est désactivée. Une carte déjà utilisée ne se rembourse plus en entier (refus expliqué).
- Vérifié dans un vrai navigateur (activation, achat, paiement, e-mail au destinataire). 1 nouveau test : 151 tests sur 151, bout en bout 51 sur 51, parcours au clavier sans problème.

### Cycle 24 (02 h 40) : espace marchand au clavier

- Chantier 14 de la deuxième phase. Nouvel outil, `outils/simulation/clavier-marchand.js` : dans un vrai navigateur et sans souris, il passe une vente en caisse, ouvre une commande, la referme avec Échap, puis commence un devis. Il vérifie que le focus est visible à chaque tabulation et qu'il va au bon endroit.
- **Ce qui marchait déjà** :
  - focus visible partout ;
  - produits de la caisse et bouton d'encaissement utilisables au clavier ;
  - message de confirmation annoncé ;
  - lignes de commandes atteignables et ouvertes avec Entrée ;
  - focus sur le premier champ d'un nouveau devis.
- **Corrigé** :
  - après un encaissement, le focus revenait sur la page entière. Il va maintenant sur le premier produit de la caisse, prêt pour la vente suivante ;
  - à l'ouverture d'une commande, le focus restait sur la ligne. Il entre maintenant dans la fiche (son titre), ce que le lecteur d'écran annonce ;
  - à la fermeture (bouton ou Échap), le focus revient sur la ligne de cette commande.
- Résultat de l'outil : aucun problème, aucune erreur JavaScript. 151 tests sur 151, bout en bout 51 sur 51.

### Cycle 25 (02 h 45) : export complet avec les nouveautés

- Chantier 16. L'export complet de la boutique (portabilité, reprise ; propriétaire seulement, mot de passe et code redemandés) contient désormais aussi :
  - les **devis**, déchiffrés et avec leur historique ;
  - les **cartes cadeaux**, avec leurs réglages de vente, leurs soldes et le registre des mouvements, mais jamais le code des cartes, que seul le client connaît ;
  - les **emplacements de stock**, avec la répartition et les mouvements ;
  - le **programme de fidélité** : réglages et soldes, anonymes, car seule une empreinte de l'e-mail est connue.
- Test étendu (vérifie notamment que le code d'une carte n'apparaît pas dans le fichier) : 151 tests sur 151.

### Cycle 26 (02 h 45) : inscription et webhooks des nouveautés

- **Chantier 18, inscription** : un refus « adresse déjà utilisée » révèle qu'un compte existe. Une réponse identique dans tous les cas casserait l'inscription immédiate. Ces refus sont donc bornés à 10 par heure et par réseau, et le titulaire de l'adresse est prévenu (une fois par jour) qu'on a essayé de s'inscrire avec elle. Repérer les adresses clientes de Comptoir devient lent et visible. Avec le temps de connexion constant (cycle 22), c'est la limite raisonnable sans changer le parcours.
- **Chantier 19, webhooks** : trois nouveaux événements, documentés dans `docs/API.md` et proposés dans l'écran des intégrations :
  - `devis.accepte` ;
  - `carte.emise` (jamais le code de la carte : vérifié par un test sur la file chiffrée) ;
  - `stock.transfert`.
- **Chantier 17 (retours partiels), différé** : remettre en stock seulement les articles retournés n'a de sens qu'avec un remboursement partiel et un avoir partiel, cohérents avec le journal scellé. C'est un chantier comptable à part entière, traité plus tard avec sa propre relecture.
- 2 nouveaux tests : 153 tests sur 153.

### Cycle 27 (02 h 55) : corrections de la relecture de la vente de cartes

Relecture indépendante de la vente de cartes cadeaux en ligne, scénarios rejoués. Points corrigés :
- **Grave, remboursement** : pour une carte déjà utilisée, l'argent était rendu au client, puis le remboursement refusé. Le client gardait la carte et l'argent. Le contrôle se fait maintenant **avant** tout mouvement d'argent, et la carte inutilisée est désactivée avant le remboursement.
- **Grave, fraude** (carte bancaire volée, achat puis contestation) :
  - l'achat d'une carte passe désormais par le score de risque ;
  - en risque élevé, la carte est **retenue** : le marchand est prévenu, puis la libère depuis la commande ou rembourse ;
  - un litige ouvert auprès de la banque **bloque** la carte ;
  - 5 achats au plus par adresse et par jour.
- **Paiement à la main** : une commande de carte cadeau marquée « payée » recevait une facture et jamais sa carte. Ce passage est refusé : une carte se paie en ligne.
- **Pas d'expédition** pour une carte cadeau :
  - plus d'étapes « préparation », « expédiée » ni « livrée » ;
  - plus de droit de retour ni d'offre « avec votre commande » ;
  - un e-mail au marchand propre aux cartes (« rien à expédier »), qui ne compte plus parmi les commandes à expédier.
- **Chiffre d'affaires compté une seule fois** : la vente d'une carte n'entre plus dans les ventes et statistiques. Elle est comptée quand la carte sert.
- **Hameçonnage** : le nom et le message de l'acheteur pouvaient faire passer un faux texte (« votre compte est suspendu », lien) au nom de la boutique. Le nom n'est plus dans le sujet. Le message est mis sur une ligne, sans liens ni caractères invisibles, et présenté comme « texte libre, non vérifié par la boutique », après le code. L'e-mail précise que la boutique ne demande jamais le code.
- **Remise de la carte** :
  - si l'e-mail ne peut pas partir (adresse refusée, panne), le marchand est prévenu et la copie est masquée ;
  - l'acheteur qui offre une carte reçoit un avis d'envoi, qui ne contient pas le code ;
  - l'historique dit « envoi en file » au lieu d'« envoyée ».
- **Divers** : montants comme 19,99 acceptés, virgule décimale reconnue, adresse légale de la boutique exigée comme pour toute vente, devise fixée à l'achat, réglages consultables abonnement terminé, langue du client gardée.
- **Restent ouverts** : traduction du formulaire d'achat et de l'e-mail de la carte (français seulement), et un export des cartes vendues pour le comptable (elles figurent déjà dans l'export complet).
- 1 nouveau test : 154 tests sur 154, bout en bout 51 sur 51, simulation de 60 jours : 0 anomalie, vérifié dans un vrai navigateur.

### Cycle 28 (03 h 07) : une seule commande de vérification

- **Chantier 20** : `npm run verifier` (`outils/verifier.js`) lance à la suite les tests automatiques, le parcours de bout en bout, les audits au clavier de la boutique et de l'espace marchand, la simulation de 60 jours (100 marchands) et un test de charge réduit (100 boutiques, 15 s). Chaque étape a un délai maximum, son verdict est lu dans sa sortie (« 0 anomalie », aucune erreur de charge), et un bilan final sort avec un code d'erreur si une étape échoue : prêt pour une intégration continue le jour où elle sera activée.
- Premier passage complet : 6 étapes sur 6 réussies.
- Mentionné dans le `README.md`.

### Cycle 29 (03 h 35) : retours partiels (chantier 17)

- **Retour d'une partie des articles** depuis la fiche commande. Le serveur calcule le montant au centime, et le marchand le voit avant de confirmer. Un avoir partiel numéroté est émis dans la suite des factures, en XML EN 16931 et en PDF Factur-X, et scellé au journal inaltérable (type « avoir-partiel »).
  - L'argent revient d'abord sur le paiement d'origine (remboursement Stripe partiel, avec une clé d'idempotence), puis sur la carte cadeau utilisée.
  - Les articles reviennent en stock à leur emplacement d'origine, sauf s'ils sont abîmés.
  - Les points de fidélité gagnés sont repris au prorata des articles rendus.
  - Le client reçoit un e-mail dans sa langue, et le webhook `commande.remboursement_partiel` est émis.
  - Le remboursement complet qui suit ne porte que sur le reste. Les avoirs partiels et l'avoir final font exactement la facture : propriété vérifiée sur 1 000 commandes tirées au hasard.
  - Chiffre d'affaires, marges, rapport du lundi et statistiques de la plateforme déduisent les retours partiels.
- **Défaut trouvé dans le vrai navigateur, avant publication** : les prix des lignes sont déjà remisés (`remise` n'est qu'informatif), et le premier calcul déduisait la remise une seconde fois. Un vase payé CHF 36.00 aurait été remboursé CHF 32.00. Le montant de chaque ligne est désormais la part exacte de ce qui a été payé pour les articles (méthode du plus fort reste, prix à fractions de centime compris).
- **Relecture indépendante**, constats corrigés :
  - Stripe a remboursé, puis la commande change (litige ouvert pendant l'appel) : l'avoir n'était jamais créé. Un marqueur « retour en cours » est maintenant écrit avant l'appel. Une fois l'argent parti, l'avoir est toujours créé. Si l'enregistrement échoue, « Terminer le retour en cours » le reprend à l'identique, avec la même clé Stripe. Le remboursement complet attend que ce retour soit terminé.
  - Une confirmation rejouée (réponse perdue, second onglet) refaisait un remboursement. La confirmation porte maintenant le rang et le montant vus à l'aperçu ; tout écart est refusé.
  - Des articles en dropshipping remboursés avant leur transmission étaient quand même commandés au fournisseur. Seules les unités non remboursées partent désormais.
  - Un avoir portant seulement sur la livraison ne pouvait pas produire de facture électronique (EN 16931 exige une ligne). Il est refusé : la livraison se rembourse avec un article.
  - Clé Stripe du remboursement complet : renouvelée toutes les 10 minutes, pour qu'un nouvel essai après correction ne rejoue pas une erreur gardée en cache.
  - Points déjà dépensés : l'écart est noté dans l'historique. La livraison n'entre plus dans le prorata des points.
  - Entrées malformées : réponse 400, plus 500.
  - Focus après une erreur gardé dans le formulaire.
  - E-mail : libellé de la livraison, et numéro de l'avoir au lieu de « joint ».
  - Demande de retour du client : plafonnée aux unités pas encore rendues ; une nouvelle demande est possible après un retour remboursé ; les avoirs partiels sont visibles sur la page de commande.
- 6 nouveaux tests : 160 tests sur 160. Bout en bout : 51 sur 51. `npm run verifier` complet : 6 étapes sur 6, lancé avant les corrections de la relecture. Parcours vérifié dans un vrai navigateur après les corrections : aperçu, confirmation, liste des avoirs, PDF.
- **Reste ouvert** : la page de commande du client ne propose pas encore le PDF de l'avoir partiel (le numéro y figure). Pas de geste commercial sans article (remise après coup) : à traiter comme un avoir de remise, avec sa propre ligne.

### Cycle 30 (03 h 48) : cartes cadeaux et fidélité en allemand, italien et anglais (chantier 21)

- **Audit dans un vrai navigateur**, boutique en allemand, italien puis anglais : achat d'une carte, panier, carte refusée puis acceptée, code de fidélité. Tous les textes restés en français ont été relevés, puis traduits :
  - formulaire d'achat de la carte ;
  - champ et messages de la carte au paiement ;
  - bloc de fidélité ;
  - messages d'erreur du serveur (carte inconnue, solde réservé, trop d'essais, code expiré) ;
  - annonces pour lecteur d'écran (« ajouté au panier »).
- **E-mails de la carte cadeau** dans la langue de l'acheteur : le code envoyé au destinataire et l'avis d'envoi à l'acheteur. Les protections restent :
  - nom et message de l'acheteur nettoyés (`texteSur`) ;
  - mention « texte libre, non vérifié par la boutique » ;
  - « la boutique ne vous demandera jamais ce code » ;
  - code masqué dans la copie gardée, vérifié pour les trois langues.
- **Défaut de conformité trouvé pendant l'audit** : une boutique dont le marchand a supprimé la section « Pied de page » n'affichait plus aucun lien vers les mentions légales, les CGV, « Mes commandes » ni la carte cadeau. En ligne, un pied minimal les affiche désormais toujours.
- 4 nouveaux tests : 164 tests sur 164. Bout en bout : 51 sur 51. Audit au clavier de la boutique : aucun problème.
- **Relecture indépendante**, constats corrigés :
  - Les modèles « ajouté au panier », « retiré du panier » et « quantité » s'appliquaient à tout le texte de la page. Ils pouvaient donc réécrire du texte du marchand (réponse à un avis, texte de la lettre d'information). Ils ne servent plus qu'aux annonces pour lecteur d'écran, et la zone d'annonces est exclue du passage global.
  - Le champ « Son prénom », traduit « Ihr Vorname », invitait l'acheteur à saisir son propre prénom. Il devient « Vorname der beschenkten Person » (et l'équivalent en italien et en anglais).
  - Singulier pour 1 point (« 1 Treuepunkt », « 1 punto fedeltà »).
  - Sujet anglais : « A gift card from … », au lieu d'un article faux devant un nom en voyelle.
  - Tournures revues, et terminologie allemande unifiée (« Geschenkgutschein »).
  - Lien retiré d'un message d'acheteur : marqué « […] », neutre dans toutes les langues.
  - Pied de secours : le nom de la boutique ne s'affiche plus deux fois.

### Cycle 31 (03 h 51) : facture et avoirs téléchargeables par le client (chantier 22)

- **Page de suivi de la commande** : le client télécharge sa facture et chacun de ses avoirs (partiels et final) en PDF Factur-X, avec le jeton personnel de sa commande. Jusqu'ici, il ne pouvait télécharger que la facture QR.
  - Même contrôle que côté marchand : XML EN 16931 vérifié avant d'être servi.
  - Rien pour une carte cadeau vendue (pas de facture).
  - Téléchargements limités par adresse IP.
  - Si la boutique n'a pas fini de saisir ses mentions, un message neutre s'affiche, sans détail interne.
- **Demande de retour** : la liste propose seulement les unités pas encore remboursées. Le client peut faire une nouvelle demande après un retour remboursé.
- Liens et messages traduits en allemand, italien et anglais.
- 1 nouveau test : 165 tests sur 165. Vérifié dans un vrai navigateur : liens affichés, PDF de l'avoir téléchargé.
- **Relecture indépendante**, constats corrigés :
  - **Facture QR annulée avant paiement** : son PDF demandait encore le montant avec l'IBAN et la référence, sans parler de l'annulation, et le client risquait de payer une commande annulée. Le PDF indique désormais « Facture annulée par l'avoir … : ne la payez pas », sans IBAN.
  - Une facture remboursée cite son avoir, et une facture qui a des avoirs partiels les liste.
  - Un refus (boutique incomplète, trop de demandes) s'affiche maintenant au client, au lieu d'un fichier JSON enregistré par le navigateur.
  - Les liens n'apparaissent que si le document peut être produit.
  - Le message d'erreur interne destiné au marchand est remplacé par un message neutre.
  - Les unités déjà rendues sont calculées une seule fois.
  - 1 test de plus : 166 tests sur 166.

### Cycle 32 (03 h 59) : expiration des points de fidélité appliquée en lot (chantier 24)

- **Défaut corrigé** : l'expiration des points (compte sans achat depuis la durée choisie) ne s'appliquait qu'au moment où le solde du client était consulté. Les « points en circulation » affichés au marchand comptaient donc des points déjà expirés, et l'engagement envers les clients était surestimé.
- **Correctif** :
  - les comptes inactifs sont remis à zéro par la maintenance quotidienne et avant chaque calcul des statistiques, chaque expiration étant inscrite au registre ;
  - un index rend ce passage léger ;
  - la mise à zéro est conditionnelle : un achat arrivé entre-temps n'est pas effacé.
- **Nouveau** : la valeur des points en circulation, et les points qui expirent dans les 30 jours sans nouvel achat (nombre de clients et valeur), affichés dans la carte Fidélité.
- 1 nouveau test : 167 tests sur 167.
