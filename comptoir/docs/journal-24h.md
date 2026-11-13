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

**Cinquième phase** (la quatrième est terminée le 13 novembre vers 4 h 35) :

26. **Comptabilité des avoirs partiels** : export pour la fiduciaire et décompte de TVA avec chaque avoir tel qu'émis, ventilé taux par taux.
27. **API publique** : avoirs et retours partiels lisibles par les intégrations (`/api/v1`).
28. **Export des cartes cadeaux vendues et utilisées** pour la fiduciaire (bons à usages multiples : encours, utilisations).
29. **Audit au clavier** des nouveaux formulaires du marchand (retour partiel, geste commercial).
30. **Démonstration publiée** mise à jour avec les nouveautés.

**Sixième phase** (la cinquième est terminée le 13 novembre vers 5 h 05) :

31. **Sauvegarde et restauration** : toutes les nouvelles tables survivent, et le journal reste vérifiable après restauration.
32. **Ménage planifié** des données temporaires (codes, échecs, réseaux sûrs, demandes).
33. **Rapport du lundi** : retours partiels et gestes de la semaine.
34. **Simulation de 60 jours avec retours partiels et gestes** : invariants comptables et journal à grande échelle.
35. **Documentation relue** contre le code (fonctionnalités, API, mise en ligne).

**Septième phase** (la sixième est terminée le 13 novembre vers 5 h 40) :

36. **Fuzzing HTTP** de toutes les routes (publiques, marchand, API) : corps aléatoires et hostiles, jamais d'erreur 500, de pile exposée ni d'exception non gérée.
37. **Routes coûteuses** (PDF, exports) limitées par compte.
38. **Journaux du serveur sans données personnelles** (adresses e-mail, noms, adresses).
39. **Performance de l'espace marchand** avec des milliers de commandes, retours compris.

**Huitième phase** (la septième est terminée le 13 novembre vers 6 h 35) :

40. **Création de commande à grande échelle** : son coût augmente avec l'historique de la boutique (4,4 ms à 3 000 commandes, 6 ms à 10 000) ; trouver ce qui grandit et l'indexer.
41. **Relecture adversariale de l'authentification** : inscription, connexion, double authentification, clés d'accès, réinitialisation, sessions, équipe.
42. **Test de charge à grande échelle** après les changements de la nuit.

**Neuvième phase** (la huitième est terminée le 13 novembre vers 7 h 20, avec un chantier 43 ajouté en cours de route : adresse e-mail confirmée à l'inscription) :

44. **Rotation des clés de chiffrement** (données personnelles, index de recherche, secrets de double authentification) sans interruption de service ni perte de données.
45. **Relecture adversariale de la boutique publique et du paiement** : prix, stock, jetons de commande, documents, cartes cadeaux, fidélité, puis corrections.
46. **Démonstration publiée** mise à jour avec les nouveautés de la matinée.

**Dixième phase** (la neuvième est terminée le 13 novembre vers 8 h 45) :

47. **Codes promo avec limites** : nombre d'utilisations, une fois par client, montant minimum, sans dépassement même en parallèle (limite relevée par la relecture du chantier 45).
48. **Relecture adversariale de l'API publique et des webhooks sortants** (`/api/v1`, portées des clés, SSRF, signature, rejeu), puis corrections.
49. **Tableau de sécurité de l'exploitant** : état des clés, rotations, alertes, dans la console `/operateur`.

**Onzième phase** (la dixième est terminée le 13 novembre vers 9 h 20) :

50. **Reprise du journal des ventes au redémarrage** : trouver l'origine de l'erreur `UNIQUE` vue par le relecteur du chantier 48 et rendre la reprise sûre quoi qu'il arrive.
51. **Test de charge à grande échelle** après les changements de la matinée (1 000 boutiques).
52. **Audit au clavier et au lecteur d'écran** des nouveaux écrans : rappel de confirmation, codes promo, nouveau secret de webhook, console.
53. **Documentation relue contre le code** (fonctionnalités, API, mise en ligne, README).

**Douzième phase** (la onzième est terminée le 13 novembre vers 9 h 40) :

54. **Mode sécurisé et durée de vie des sessions** : identité confirmée récemment pour les actions qui ouvrent un accès durable aux données, sessions limitées à 90 jours.
55. **Sauvegardes vérifiées** : chaque sauvegarde est relue et contrôlée (intégrité, journal des ventes) automatiquement, et l'échec est signalé.
56. **Démonstration publiée** mise à jour.

**Treizième phase** (la douzième est terminée le 13 novembre vers 10 h) :

57. **Relecture adversariale transversale** des nouveautés de la matinée : ce qui casse quand elles se combinent (rotation des clés et données ajoutées après, réservations et codes, remboursements automatiques et états de paiement, mode sécurisé et enregistrement automatique), plus le vérificateur complet.

**Quatorzième phase** (la treizième est terminée le 13 novembre vers 10 h 30) :

58. **Mode sécurisé et enregistrement automatique** : une confirmation annulée remet les champs sensibles à leur valeur enregistrée (plus de fenêtre qui revient), et l'envoi de dernière seconde ne perd plus le reste des réglages.
59. **Webhooks sans données personnelles au choix** : chaque webhook peut recevoir les commandes sans nom, e-mail ni adresse du client (minimisation des données, comme l'API sans `clients:lecture`).
60. **Codes promo : comptage juste** : une commande remboursée rend son utilisation ; un code recréé repart de zéro.

**Quinzième phase** (la quatorzième est terminée le 13 novembre vers 10 h 45) :

61. **Minimisation des e-mails gardés** : le contenu des e-mails envoyés (noms et adresses des clients, en clair) effacé après 7 jours au lieu de 180, la trace entière (destinataire compris) supprimée après 180 jours.
62. **Changement de l'adresse e-mail du compte** : identité récente, confirmation par la nouvelle adresse, avertissement et annulation (7 jours) par l'ancienne, sans révéler les adresses déjà prises.

**Seizième phase** (la quinzième est terminée le 13 novembre vers 13 h) :

63. **Confirmation d'identité par clé d'accès** : les actions sensibles se confirment aussi avec une clé d'accès du compte (visage, empreinte), sans mot de passe ; c'est le seul moyen pour un compte « clé d'accès seule », qui devait jusqu'ici se déconnecter. Aucune connexion ne vaut plus confirmation.
64. **Essais refusés dans une session** : au 5e mot de passe (ou code, ou clé) refusé dans une même session, celle-ci est fermée et la titulaire prévenue ; un voleur de cookie ne peut plus bloquer les confirmations du compte.
65. **Session liée à son appareil** : un cookie rejoué depuis un autre navigateur ou système ferme la session et prévient la titulaire.
66. **Relecture adversariale croisée** des nouveautés de l'après-midi (changement d'adresse, confirmation par clé d'accès, essais refusés par session, session liée à l'appareil) : ce qui casse quand elles se combinent.

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
- **Relecture indépendante**, constats corrigés :
  - **Grave** : le passage d'expiration validait chaque écriture séparément. Sur une boutique de 20 000 comptes, le premier passage bloquait le serveur 5,4 s. Il travaille désormais par lots de 1 000 comptes, un lot par transaction et par passage de maintenance. L'expiration paresseuse du solde est atomique elle aussi (point de sauvegarde, utilisable dans une transaction en cours). L'index ne couvre que les comptes qui ont encore des points.
  - Un programme mis en pause faisait expirer les points de tous les clients, alors qu'ils ne pouvaient plus en gagner. En pause, plus rien n'expire, et les boutiques supprimées sont ignorées.
  - Les statistiques écrivaient au registre, y compris pour un compte en lecture seule. Elles sont maintenant en lecture seule : les comptes expirés en sont exclus par le calcul.
  - « Une bonne occasion de les relancer » invitait à écrire à des clients sans consentement. Le texte devient : « Vous pouvez le rappeler aux clients qui ont accepté vos e-mails ».
  - Raccourcir la durée d'expiration demande une confirmation, car les points concernés expirent sans retour possible.

### Cycle 33 (04 h 05) : geste commercial (chantier 23)

- **Geste commercial** depuis la fiche commande : rembourser un montant sans retour d'article (retard de livraison, petit défaut accepté par le client), avec un avoir numéroté et scellé, comme un retour partiel.
  - Le montant est réparti au plus fort reste sur la valeur restante des articles.
  - L'avoir porte une ligne « Geste commercial : article » par article, à son taux de TVA, et la facture électronique reste cohérente.
  - Argent puis carte cadeau, points de fidélité au prorata, e-mail traduit, même protection contre le double remboursement.
- **Calcul des retours unifié** : un article rendu est remboursé de sa valeur restante (sa part d'un geste déjà déduite), répartie sur les unités restantes ; la dernière unité reçoit exactement le reste. Les avoirs suivants présentent l'écart comme « Geste commercial déjà accordé », et non comme un arrondi.
- Un article dont toute la valeur a déjà été rendue par un geste ne peut plus être remboursé partiellement. Le message renvoie au remboursement complet.
- **Propriété vérifiée sur 1 000 commandes tirées au hasard**, gestes compris : avoirs partiels, gestes et avoir final font exactement la facture.
- 1 nouveau test, et le test de propriété étendu : 168 tests sur 168.
- **Relecture indépendante**, constats corrigés :
  - **Sceau** : la prise en compte d'un geste « antérieur » dépendait de l'heure des pièces. Avec deux pièces de la même milliseconde ou une horloge recalée, le contenu recalculé d'un avoir scellé pouvait changer, et la vérification aurait signalé une falsification. C'est maintenant l'ordre d'émission qui compte, avec un test pour la même milliseconde et pour une horloge recalée.
  - **PDF** : l'avoir qui suit un geste affichait « Remise, déjà déduite des prix », alors que les lignes sont au prix d'origine. Le geste apparaît désormais comme une déduction chiffrée.
  - **Fidélité** : un geste ne reprend plus de points ; c'est un dédommagement, pas une vente annulée.
  - **Article rendu après un geste qui avait couvert toute sa valeur** : le marchand était renvoyé au remboursement complet, qui remettait en stock tous les articles, même ceux gardés par le client. Ce retour est désormais enregistré sans remboursement ni avoir : stock remis, unités suivies. Il n'a pas de numéro de pièce, et le journal ne l'attend pas.
  - **Saisie** : un geste ne se combine plus avec un retour d'articles (refus explicite), et un montant vide est refusé.
  - **Webhook** : il indique `geste: true`.
  - **Focus** rendu au bon bouton.
- `npm run verifier` complet (lancé avant ces corrections) : 6 étapes sur 6. 169 tests sur 169, sur deux passages complets.

### Cycle 34 (04 h 33) : relecture adversariale des nouveautés (chantier 25)

Deux audits indépendants en parallèle : chemins d'argent (retours, gestes, cartes cadeaux, devis, webhooks de paiement), et surface publique et données (fidélité, routes client, emplacements, exports, rôles, XSS, limites). Chaque constat a été reproduit par script avant d'être corrigé.

- **Cartes cadeaux** :
  - Une carte retenue (risque élevé) pouvait être libérée pendant le remboursement de sa vente : la carte restait active et l'argent était rendu. La libération passe désormais par le même verrou que les remboursements. Elle est refusée en cas de litige, et le remboursement désactive vraiment une carte émise entre-temps.
  - Une carte dépensée puis bloquée par un litige (gagné ensuite) pouvait être remboursée en entier. Le contrôle « déjà utilisée » compare maintenant toujours le solde au montant initial, que la carte soit bloquée ou non.
  - Un litige bloque la carte à chaque événement, pas seulement au premier.
- **Remboursements** :
  - Réponse de Stripe perdue (coupure) sur un retour partiel : le marqueur « retour en cours » était effacé. Passé 24 h, un nouvel essai aurait remboursé deux fois. Le marqueur n'est plus effacé que sur un refus net de Stripe (réponse 4xx) ; sinon, « Terminer le retour en cours » reprend avec la même clé.
  - Un remboursement complet dont l'argent était parti pendant qu'un webhook changeait la commande (expédition) s'arrêtait sans avoir enregistré l'avoir, la carte ni le stock. L'avoir est maintenant enregistré quoi qu'il arrive, et l'historique le signale.
  - Remboursement complet refusé pendant un litige ouvert ou perdu ; Stripe le refuse aussi.
- **Fidélité** :
  - Toute personne connaissant l'adresse d'un client pouvait, avec 10 mauvais codes, l'empêcher d'utiliser ses points pendant 24 h, chaque jour. Chaque code est désormais lié à sa demande (identifiant aléatoire remis au seul navigateur qui l'a faite). Les échecs sont comptés par adresse et par réseau (10 par 24 h), avec un plafond de 100 par adresse tous réseaux confondus : la force brute reste impraticable. Les demandes de code sont limitées par réseau (3 par heure) et par adresse (10 par heure).
  - Le disjoncteur « 300 échecs par heure et par boutique », qui permettait de couper la vérification des codes pour tous les clients, a été retiré.
  - La réponse à une demande de code a la même forme, que l'adresse ait des points ou non.
  - Pause du programme : plus aucune expiration pendant la pause, ni au moment du solde. À la reprise, l'inactivité recommence à compter de ce jour.
- **Adresses e-mail** : forme Unicode unique (NFC) à la validation et dans la fidélité. « ü » composé ou décomposé ne contourne plus les limites, et ne crée plus deux comptes de points. Une adresse déjà saisie sous forme décomposée, cas rarissime, est désormais lue sous sa forme composée.
- **Test intermittent trouvé** : le test de rejeu du code de double authentification rejouait « le code du moment » au lieu de celui de l'activation. Au passage d'un pas de 30 s, c'était un nouveau code, légitimement accepté. Le test rejoue maintenant le code exact. Le serveur n'était pas en cause.
- **Vérifiés sains par les audits**, entre autres :
  - double dépense de carte ;
  - remboursement supérieur au payé ;
  - accès entre boutiques ;
  - rôles de l'équipe ;
  - rejeu de webhooks ;
  - énumération ;
  - XSS de la boutique ;
  - en-têtes et cache des nouvelles routes.
- 170 tests sur 170, bout en bout 51 sur 51. Parcours de fidélité vérifié dans un vrai navigateur : code demandé, code reçu saisi, points appliqués.
- **Relecture indépendante de ces corrections**, constats corrigés :
  - **Retour en suspens bloqué pour toujours** : si la reprise était refusée nettement par Stripe (litige ouvert entre-temps, clé expirée après 24 h), le marqueur restait et bloquait tout remboursement de la commande. Le marqueur est maintenant retiré sur un refus net, avec une trace dans l'historique, y compris quand l'erreur survient à la lecture préalable du paiement. Le marchand peut aussi l'abandonner lui-même après avoir vérifié dans Stripe, et le texte ne prétend plus que l'argent « a été remboursé » quand c'est incertain.
  - **Codes de fidélité** : les plafonds tous réseaux pouvaient encore servir à bloquer un client. Un réseau où le client a déjà saisi un code juste est désormais « sûr » pour son adresse, et ces plafonds ne s'y appliquent plus : un tiers ne peut pas l'exclure de chez lui.
  - **Force brute** : le plafond tous réseaux passe de 100 à 30 échecs par jour et par adresse. Les limites par adresse IP comptent par réseau (un /64 en IPv6 ne se contourne plus en changeant d'adresse). Le frein de la boutique revient, mais ne compte que les mauvais codes : un code juste passe toujours.
  - **Ménage** : échecs de plus de 24 h purgés, index sur l'expiration des codes.
  - **Litiges** : seuls les litiges ouverts (réponse attendue, en examen) ou perdus bloquent un remboursement ou la libération d'une carte. Une simple demande d'information ou un litige gagné ne bloque plus.
  - **Pause** : à la reprise, l'inactivité est décalée de la durée exacte de la pause (et non remise à zéro), et seulement pour les comptes encore valables au début de la pause.
  - **NFC** : les adresses déjà enregistrées (marchands, désinscriptions, invitations) sont normalisées au démarrage. Connexion et désinscriptions continuent de les trouver.
  - Remboursement complet pendant une expédition : l'historique dit explicitement que le stock a été remis et qu'il faut le corriger si les articles ne reviennent pas.
  - 2 tests de plus : 175 tests sur 175.

### Cycle 35 (04 h 39) : comptabilité des avoirs partiels (chantier 26)

- **Défaut trouvé en préparant la phase 5** : l'export pour la fiduciaire et le décompte de TVA ignoraient les avoirs partiels et les gestes. Ils comptaient l'avoir final pour la facture entière, au lieu du reste. Avec un retour partiel, le décompte de TVA surestimait donc les remboursements.
- **Calcul partagé** : les calculs des retours (`js/retours-calcul.js`) sont maintenant un module commun au serveur et à l'application, comme les remises et les formules. L'export et le décompte utilisent exactement les montants des documents émis et du journal scellé ; il n'existe plus de copie qui pourrait diverger.
- **Second défaut, trouvé par le nouveau test** : un avoir partiel qui rembourse la livraison la portait entièrement au taux de TVA de l'article rendu, alors que la facture la répartissait entre les taux. L'avoir final avait le même biais. Les totaux restaient justes, mais pas le décompte par taux (4,31 de travers au taux de 8,1 % dans le test).
- **Correctif** : chaque avoir porte désormais sa ventilation par taux :
  - articles rendus à leur taux ;
  - livraison répartie comme sur la facture ;
  - avoir final égal à exactement ce qui reste à chaque taux.

  La facture électronique, le PDF et l'application l'utilisent. Les avoirs compensent la facture taux par taux, et chaque facture électronique d'avoir reste conforme.
- **Vérifié dans l'application** : facture, avoir partiel, avoir de geste et avoir final se compensent au centime dans le décompte de TVA (total 0, TVA 0) et dans l'export CSV (4 lignes, somme 0).
- 1 nouveau test : 171 tests sur 171.

### Cycle 36 (04 h 41) : export des cartes cadeaux pour la fiduciaire (chantier 28)

- **Export CSV**, depuis la carte « Cartes cadeaux » (période au choix) :
  - chaque mouvement de la période : émission, utilisation, recrédit, désactivation, avec origine (vendue ou émise par la boutique), montant, solde après et numéro de commande ;
  - en fin de fichier, l'**encours** à la date de fin, c'est-à-dire les cartes actives non expirées, un engagement envers les clients ;
  - à part, les soldes de cartes expirées ou désactivées, à traiter avec la fiduciaire.
- Calculé depuis le registre des mouvements, donc juste aussi pour une date passée.
- Textes neutralisés pour les tableurs (pas de formule), en-têtes sans cache, une seule boutique.
- 1 nouveau test : 172 tests sur 172.

### Cycle 37 (04 h 42) : avoirs dans l'API publique (chantier 27)

- **`/api/v1/commandes`** et les webhooks donnent maintenant, pour chaque commande :
  - les avoirs émis, avec numéro, date, type (`partiel`, `geste` ou `final`), montant, et pour un avoir partiel ses lignes et la livraison ;
  - le total remboursé ;
  - les unités déjà rendues, par ligne.
- Un logiciel comptable ou un ERP peut ainsi rapprocher chaque remboursement de sa pièce. Documenté dans `docs/API.md`, y compris le champ `geste` du webhook `commande.remboursement_partiel`.
- 1 nouveau test, par une vraie clé d'API : 173 tests sur 173.
- **Relecture indépendante des chantiers 26 à 28**, constats corrigés :
  - **Grave (API)** : une facture QR annulée avant paiement apparaissait « remboursée » de tout son montant, ce qui aurait trompé un logiciel comptable. `rembourse` ne compte plus que l'argent réellement rendu, et cet avoir porte le type `annulation`.
  - **Export des cartes** :
    - une carte dont la vente avait été remboursée ou contestée était comptée comme « soldes non utilisables », donc gain possible ; elle a désormais sa propre ligne, « Cartes annulées ».
    - le solde en fin de période suit l'ordre d'inscription des mouvements, celui du cumul, et non leur date ;
    - deux requêtes au lieu de deux par carte, avec un index par période (20 000 cartes : environ 0,8 s de blocage avant) ;
    - jours civils à l'heure de Suisse et de France, au lieu d'UTC ;
    - date invalide refusée ;
    - virgule décimale pour les tableurs en français ;
    - export toujours accessible à une boutique en lecture seule.
  - **TVA des avoirs** :
    - dans la facture électronique, la livraison remboursée est répartie entre les taux comme la ventilation, et une remise « Arrondi » ne vient plus gonfler artificiellement la livraison ;
    - dans environ 2 % des commandes à plusieurs taux avec prix fractionnaires, l'avoir final perdait sa ventilation pour un centime : ce centime est maintenant repris sur le plus grand taux. Hasard vérifié sur 300 commandes : écart d'au plus 1 centime par taux ;
    - la ventilation est enregistrée sur chaque avoir à son émission, donc un document émis ne change plus ;
    - l'export et le décompte fonctionnent même sans le module partagé (démonstration incomplète) ;
    - la ligne « avoir à émettre » ne compte plus deux fois les retours partiels.
  - **API** : forme des avoirs uniforme et documentée ; unités rendues calculées une fois par commande.
  - 3 tests de plus : 176 tests sur 176. Vérifié dans l'application : décompte de TVA et export à zéro sur une commande entièrement remboursée.

### Cycle 38 (04 h 45) : retour partiel et geste commercial au clavier (chantier 29)

- L'audit au clavier de l'espace marchand (`outils/simulation/clavier-marchand.js`) couvre maintenant :
  - le retour partiel : ouverture, quantité, « Calculer », confirmation ;
  - le geste commercial : ouverture, puis « Annuler ».
- **Défaut trouvé** : après la confirmation d'un retour, le détail était redessiné et le focus perdu ; un utilisateur de lecteur d'écran repartait du haut de la page. Le focus va désormais au titre « Retours partiels », juste au-dessus du nouvel avoir, avec un contour visible.
- Audit : toutes les étapes passent, aucune erreur JavaScript. 173 tests sur 173.

### Cycle 39 (04 h 58) : démonstration publiée mise à jour (chantier 30)

- Démonstration (artefact) republiée en **version 24**. Elle contient le module de calcul partagé (`js/retours-calcul.js`), l'interface des retours partiels et du geste commercial, et les nouvelles traductions.
- Avant publication :
  - les fichiers déjà en ligne ont été relus et comparés à l'historique Git. Tous étaient d'anciennes versions du dépôt : rien d'extérieur n'a été écrasé ;
  - le paquet a été vérifié dans un vrai navigateur (servi en UTF-8). Écrans Tableau de bord, Commandes, Analyse (onglet TVA), Magasin, Clients et Produits parcourus, aucune erreur JavaScript. La seule réponse 404 est `/api/session`, normale sans serveur.
- Pas de relecture indépendante pour ce chantier : il republie du code déjà relu, et la vérification ci-dessus en tient lieu.

### Cycle 40 (04 h 59) : sauvegarde et restauration d'une boutique active (chantier 31)

- Les sauvegardes copient toute la base (`VACUUM INTO`) : les nouvelles tables y sont par construction. Le nouveau test vérifie surtout qu'une copie restaurée est **utilisable et vérifiable**, et pas seulement lisible.
- **Scénario** :
  1. Boutique active : carte cadeau utilisée au paiement, programme de fidélité, retour partiel, geste commercial.
  2. Sauvegarde du jour chiffrée, puis restauration par la commande du serveur (`--restaurer`).
  3. Application relancée sur la copie, avec la même clé du serveur.
- **Résultat sur la copie** :
  - connexion du marchand ;
  - journal scellé vérifié (facture et avoirs) ;
  - données du client déchiffrées ;
  - registres des cartes et de la fidélité cohérents ;
  - la boutique continue de vivre : remboursement du reste, journal toujours intact.
- 1 nouveau test.

### Cycle 41 (05 h 14) : ménage planifié et rapport du lundi (chantiers 32 et 33)

- **Ménage quotidien** des données temporaires de la fidélité :
  - codes expirés depuis un jour ;
  - échecs de plus de 24 h ;
  - réseaux sûrs inutilisés depuis un an ;
  - anciens codes.
  Jusqu'ici, ce ménage n'avait lieu qu'à la demande d'un nouveau code, et les réseaux sûrs n'étaient jamais effacés. Rien n'est gardé plus longtemps que nécessaire.
- **Rapport du lundi** : nouvelle ligne « Remboursements » avec les avoirs émis dans la semaine (retours partiels, gestes commerciaux, remboursements complets), quelle que soit la date de la commande, gestes à part. Les annulations de factures jamais payées n'y figurent pas, puisqu'aucun argent n'a été rendu.
- 2 tests de plus : 178 tests sur 178.

### Cycle 42 (05 h 29) : relecture des chantiers 31 à 33 et documentation relue contre le code (chantier 35)

- **Rapport du lundi** :
  - une boutique sans commande récente ne recevait aucun rapport, même si elle avait remboursé cette semaine une commande ancienne ; elle le reçoit désormais ;
  - la part recréditée sur des cartes cadeaux, qui n'est pas de l'argent rendu, est indiquée à part ;
  - le rapport précise que les retours des commandes de la période sont déjà déduits du chiffre d'affaires ;
  - les anciennes commandes sans date de modification sont prises en compte.
- **Test de restauration renforcé** : il prouve désormais ce que dit son titre.
  - Solde de la carte, points, pièces du journal et stock identiques avant et après.
  - La carte sert encore sur la copie.
  - Une copie relancée avec une autre clé du serveur est détectée comme telle (« clé changée »), sans que chaque pièce soit accusée de falsification.
- **`npm run verifier`** : le parcours de bout en bout ouvre aussi un navigateur ; sans Playwright, il est maintenant sauté et signalé au lieu d'échouer.
- **Documentation corrigée** :
  - `FONCTIONNALITES.md` : facture électronique (le PDF Factur-X existe, non contrôlé par veraPDF) ; sauvegardes en clair sans `SAUVEGARDE_CLE` ; protection réelle sans `SECRET_CHIFFREMENT` ; geste commercial ; points gagnés seulement en ligne ; règles des points lors des retours et des pauses ; contenu du rapport du lundi.
  - `MISE-EN-LIGNE.md` : ce que permet une copie volée sans `SECRET_CHIFFREMENT` ; procédure de restauration complète, avec la même clé ; `SAUVEGARDE_CLE` définie sur le serveur ; nombre de tests.
  - `server/README.md` : la phrase « pas encore de double authentification », devenue fausse, est retirée ; rythme et chiffrement des sauvegardes ; variables non documentées.
  - `.env.example` : rôle complet de `SECRET_CHIFFREMENT`.
  - `README.md` : langues de la boutique.
  - `API.md` : exemple de commande avec les nouveaux champs.

### Cycle 43 (05 h 38) : simulation de 60 jours avec retours partiels et gestes (chantier 34)

- **Gestion simulée** : après livraison ou retrait, les marchands simulés font des retours partiels (avec ou sans livraison, articles remis en stock ou abîmés), des gestes commerciaux et des remboursements du reste. Chaque fois, ils passent par l'aperçu puis la confirmation avec le montant vu, comme dans l'interface.
- **Nouveaux invariants vérifiés sur chaque commande** :
  - les avoirs ne dépassent jamais la facture et l'égalent exactement une fois la commande remboursée ;
  - aucun retour ne reste en suspens ;
  - la numérotation des pièces est continue, avoirs partiels compris ;
  - le stock est cohérent avec les ventes, articles abîmés compris ;
  - aucune vente à découvert n'échappe à l'alerte.
- **Premiers passages** : les 1 809 puis 1 540 anomalies relevées venaient toutes des contrôles de la simulation elle-même, qui ignoraient les avoirs partiels dans la numérotation, les articles abîmés dans le stock et les unités rendues dans l'alerte de rupture, ou qui retentaient un remboursement de livraison déjà fait. Aucune ne venait de la plateforme. Ces contrôles ont été corrigés un par un, et chaque type d'anomalie a été examiné avant d'être corrigé.
- **Résultat** :
  - 100 marchands sur 60 jours : **0 anomalie**, journal scellé vérifié pour chaque marchand ;
  - 40 marchands sur 45 jours, avec le décompte : **758 retours partiels, 1 835 gestes commerciaux et 314 remboursements du reste**, 0 anomalie.
- **Relecture indépendante des contrôles assouplis** : aucun des trois ne masque un défaut de stock ou de numérotation. En revanche, deux nouveaux contrôles ne pouvaient jamais échouer : « avoirs = facture » est vrai par construction, et aucun « retour en suspens » n'est possible avec le prestataire simulé. Ajoutés, sans dépendre des formules du serveur :
  - pour chaque avoir partiel : lignes + livraison = montant, et argent + carte = montant ;
  - un numéro présent si et seulement si le montant est positif ;
  - par ligne, jamais plus remboursé que le prix payé (recalculé), ni plus d'unités rendues que vendues ;
  - un compte « retiré du stock » jamais négatif ni supérieur aux unités encore vendues ;
  - un avoir final jamais négatif ;
  - de nouveaux parcours : confirmation rejouée (refusée) et geste mêlé à un retour (refusé).
- Nouveau passage (40 marchands, 45 jours) : 757 retours partiels, 1 913 gestes, 271 remboursements du reste, 504 confirmations rejouées toutes refusées, **0 anomalie**. Les retours en suspens, qui supposent des pannes de Stripe, restent couverts par les tests automatiques.

### Cycle 44 (05 h 53) : fuzzing HTTP et journaux sans données personnelles (chantiers 36 et 38)

- **Fuzzing HTTP** (`outils/simulation/fuzz-http.js`) : chacune des 157 routes du serveur (publiques, espace marchand, API avec clé) reçoit des corps et des paramètres aléatoires et hostiles :
  - types inattendus, chaînes énormes, caractères nuls ou de direction ;
  - clés `__proto__` et `constructor`, tableaux à la place d'objets ;
  - JSON cassé, corps de 2 Mo, identifiants absurdes ;
  - avec ou sans session.

  Règles : jamais d'erreur 500, jamais de pile ni de chemin de fichier dans une réponse, jamais d'exception non gérée côté serveur.
- **Résultat** : 6 280 requêtes, **0 constat**. Le détail des réponses montre que les traitements sont bien atteints (1 423 réponses 200, 1 597 refus de validation, 144 refus métier, 1 834 introuvables, 1 111 sans session, quelques limites de débit et de taille), et non arrêtés à l'entrée. Le flux en direct (connexion sans fin) est exclu. Un passage court fait désormais partie de `npm run verifier`.
- **Journaux du serveur** : l'échec d'envoi d'un e-mail inscrivait l'adresse du client et le sujet en clair, et le message du prestataire peut lui aussi répéter l'adresse. Les adresses y sont maintenant masquées (« l•••@exemple.fr », domaine gardé pour diagnostiquer un refus), avec le numéro de l'e-mail pour le retrouver dans la base. Même chose pour la trace de débogage `LOG_EMAILS`. Les autres journaux ont été relus : ils ne contiennent ni adresse, ni nom, ni adresse postale.
- 1 test de plus : 179 tests sur 179.

### Cycle 45 (05 h 56) : routes coûteuses limitées par boutique (chantier 37)

- **Quota par boutique**, équipe comprise, pour les routes qui coûtent au serveur :
  - génération de factures et d'avoirs en PDF Factur-X ou en XML : 300 par 10 minutes ;
  - exports (clients, journal des ventes, cartes cadeaux, export complet) : 30 par heure.

  C'est large pour un usage normal, une fiduciaire qui télécharge un trimestre par exemple, mais une session volée ou un script ne peut plus monopoliser le serveur. Le reste de l'espace marchand reste ouvert. La vérification complète du journal garde sa limite propre (6 par heure), et le téléchargement des pièces par le client garde la sienne (60 par heure et par réseau).
- 1 test de plus : 180 tests sur 180.

### Cycle 46 (06 h 05) : relecture adversariale du fuzzing et performance de l'espace marchand (chantiers 36, 38 et 39)

- **Grave, trouvé par la relecture adversariale** : une seule requête anonyme (`GET //`) **faisait tomber le serveur**. La lecture de l'adresse se trouvait hors du traitement d'erreur, et le processus s'arrêtait. Une adresse illisible reçoit désormais un 400, et un dernier filet journalise toute promesse rejetée sans gestionnaire sans arrêter le serveur. Un test envoie ces requêtes brutes et vérifie que le serveur répond encore.
- **Moyen** : un objet JSON avec ses propres clés `toString` ou `valueOf` provoquait une erreur 500 sur une trentaine de routes, dont des routes publiques sans compte. Le JSON reçu est maintenant lu sans ces clés, ni `__proto__`, `constructor` ou `prototype`. Hors de `/api/`, un corps qui n'est pas un objet est ramené à un objet, et les webhooks refusent un événement nul.
- Dates impossibles (13e mois, 30 février) refusées dans l'export des cartes.
- Un client parti en cours d'envoi donne une requête interrompue (400), et non plus une fausse erreur du serveur.
- **Journaux** : le masquage des adresses couvre les adresses Unicode, les parties entre guillemets et les adresses encodées dans une URL, et une adresse comme « lou;martin@… » est masquée en entier. La trace `LOG_EMAILS` ne contient plus le sujet, qui peut porter un prénom.
- Le fuzzer connaît maintenant ces pièges : 0 constat.
- **Performance de l'espace marchand** (chantier 39), mesurée avec 10 000 commandes réelles, dont 400 retours et gestes :
  - l'état complet prenait 0,7 s de calcul bloquant à chaque ouverture de l'espace. Le JSON de chaque commande est désormais gardé en mémoire, repéré par l'empreinte de sa ligne : une commande inchangée n'est ni relue, ni déchiffrée, ni resérialisée. La compression se fait hors du fil principal, et le cache est borné à 30 000 commandes ;
  - résultat : médiane de 0,3 s par ouverture, et blocage maximal du fil principal de 170 ms au lieu de 700 ms ;
  - les autres routes étaient déjà rapides : API (100 commandes) 6 ms, export des cartes 39 ms. La vérification complète du journal prend 0,8 s pour 10 000 commandes ; elle travaille par lots et rend la main entre deux lots.
- 2 tests de plus : 181 tests sur 181.
- **Relecture indépendante de ces changements**, constats corrigés :
  - **Collision reproduite** : l'état complet glissait les commandes à la place d'un marqueur dans le texte JSON. Un marchand qui écrivait ce marqueur dans un champ de configuration (son slogan, par exemple) y envoyait les commandes, et son espace devenait inutilisable. Il n'y a plus de recherche dans le texte : l'objet est sérialisé sans ses commandes, puis elles sont ajoutées comme dernier champ. Un test vérifie le cas avec le marqueur et avec un nom de boutique piégé.
  - **Données déchiffrées en mémoire** : le cache des commandes n'était purgé ni à l'effacement d'un client, ni à la suppression d'un compte, et il pouvait tourner à vide au-delà de 30 000 commandes. Il fonctionne maintenant par boutique, entier ou rien. Il est effacé avec les données (effacement d'un client, suppression du compte) et après 30 minutes sans ouverture de l'espace, contrôlées par la maintenance. Une boutique de plus de 30 000 commandes n'est pas mise en cache.
  - Un profil de performance commis par erreur a été retiré et les profils sont ignorés par Git.
  - La règle des clés ignorées dans les corps JSON est documentée dans `API.md`.
  - 1 test de plus : 182 tests sur 182. Audit au clavier de l'espace marchand : aucun problème.

### Cycle 47 (06 h 18) : création de commande à coût constant (chantier 40)

- **Mesure** : 10 000 vraies commandes créées puis payées. Le coût par commande croissait avec l'historique de la boutique : 4,1 ms pour les 2 000 premières, 6,7 ms pour les 2 000 dernières.
- **Cause, trouvée par profilage** : à chaque commande, deux requêtes cherchent les commandes en attente (stock réservé, plafond d'impayées). Avec le seul index par date, elles parcouraient toutes les commandes des 90 derniers jours pour n'en garder que quelques-unes. Un index (boutique, statut, date) les limite aux commandes en attente.
- **Second point** : les compteurs du score de risque gardaient toutes les entrées d'un même réseau sur 24 h, que chaque commande filtrait. Ils sont plafonnés aux 200 plus récentes, bien au-delà des seuils du score (2 ou 3 valeurs distinctes).
- **Résultat** : coût constant, 3,3 ms par commande de la première à la dix-millième. Ouverture de l'espace marchand à 10 000 commandes : médiane de 0,3 s.
- **Vérificateur** : l'échec de l'étape de fuzzing venait du fuzzer lui-même, qui ne savait pas écrire dans l'adresse ses nouvelles valeurs piégées (`{ toString: 1 }`). Il est corrigé : 3 graines, 3 768 requêtes, 0 constat.

### Cycle 48 (06 h 26) : test de charge à grande échelle (chantier 42)

- **1 000 boutiques**, 200 000 commandes d'historique (base de 126 Mo), 50 clients simultanés pendant 60 secondes, trafic mêlé : vitrines, commandes payées de bout en bout, espace marchand, devis, cartes cadeaux.
- **Constat** : le cache de l'état de l'espace marchand, ajouté au cycle 46, coûtait plus qu'il ne rapportait pour les boutiques de taille courante. Sur 200 commandes, calculer les empreintes revient plus cher que tout relire. Avec le cache : 589 requêtes par seconde et 288 Mo ; sans le cache : 623 et 197 Mo.
- **Correctif** : le cache ne sert plus qu'aux boutiques d'au moins 1 000 commandes, là où il fait gagner (10 000 commandes : 0,7 s ramenées à 0,3 s). Sa taille se règle par `CACHE_ETAT_MAX` (0 le désactive).
- **Résultat final** : 600 requêtes par seconde, 190 Mo, **aucune erreur** sur 35 000 actions, aucune erreur au journal du serveur. C'est le niveau mesuré avant les protections de la nuit (605), avec beaucoup plus de fonctions.

### Cycle 49 (06 h 30) : audit de l'authentification, corrections (chantier 41)

Un relecteur indépendant a audité la connexion des marchands : mot de passe, double authentification, appareils connus, limites d'essais, sessions. Constats corrigés :

- **Appareils connus** : l'ancien cookie « appareil connu » était une signature dérivée de l'e-mail, identique sur tous les appareils et impossible à révoquer un par un. Chaque appareil reçoit maintenant un jeton aléatoire, dont seule l'empreinte est en base (table `appareils_connus`). Il est révoqué :
  - à l'activation de la double authentification ;
  - avec « déconnecter les autres appareils » ;
  - au changement ou à la réinitialisation du mot de passe, et à la récupération du compte ;
  - à la révocation de la session ouverte depuis cet appareil.
  Les appareils sans connexion depuis un an sont oubliés.
- **Double authentification** : un appareil connu ne levait plus seulement le blocage du compte, mais aussi les limites d'essais de code. Il a désormais ses propres compteurs (par appareil et par jour), et un réseau IPv6 est compté par bloc /48.
- **Codes consommés une seule fois** : l'état de la double authentification est relu au moment du contrôle, et un code (pas de temps ou code de secours) n'est consommé que par une mise à jour conditionnelle. Le même code de secours envoyé deux fois en parallèle n'ouvre qu'une session (testé), et il ne sert plus ensuite à désactiver la double authentification.
- **Requêtes d'un autre site** : la règle « JSON obligatoire » ne couvrait pas les requêtes sans corps (déconnecter les autres appareils, par exemple). Toute requête qui modifie un état sous `/api/` est refusée (`403 autre_site`) quand le navigateur indique qu'elle vient d'un autre site. Le navigateur l'indique par `Sec-Fetch-Site` (refusé même pour un sous-domaine voisin) ou par `Origin` (refusé si l'origine n'est ni l'hôte demandé ni `URL_PUBLIQUE`). Les webhooks et l'API par clé n'y sont pas soumis.
- **Essais répartis sur des adresses voisines** : changer d'adresse dans un même /24 remettait le compteur à zéro. Les échecs sont maintenant aussi comptés par compte et par bloc (IPv4 /24, IPv6 /48), au triple du seuil par adresse. Ce compteur n'est jamais commun à tout le bloc, et ne s'applique pas à un appareil connu.
- **Seconde relecture de ces correctifs**, quatre défauts réels corrigés :
  - le cookie d'appareil, limité à `/api/auth`, n'atteignait pas les routes du compte (`/api/admin/compte/…`). Activer la double authentification oubliait donc aussi l'appareil du marchand. Le chemin est maintenant `/api` ;
  - un compteur commun au bloc aurait permis à un voisin de bureau ou d'opérateur de bloquer la connexion de tous. Il est remplacé par le compteur par compte et par bloc ;
  - le même problème touchait la réinitialisation, l'inscription et les invitations : le compteur de bloc en est retiré ;
  - révoquer une session laissait à l'appareil son statut d'appareil connu. Les deux sont maintenant liés.
- Le test d'attaque répartie a été ajusté : ses 25 adresses « réparties » étaient toutes dans un même /24, et elles sont maintenant bloquées plus tôt. Il utilise désormais 25 blocs différents.
- Le test du cookie `__Host-` a révélé qu'un proxy qui réécrit `Host` refuserait toutes les requêtes du site. L'origine de `URL_PUBLIQUE` est donc acceptée. Le README rappelle de transmettre `Host` (Caddy le fait par défaut ; avec nginx, `proxy_set_header Host $host;`).
- 3 tests de plus : 185 tests sur 185. Vérificateur complet : 7 étapes sur 7, fuzzing compris. La seconde relecture confirme les correctifs.
- **Limites connues** :
  - seule la dernière session d'un appareil lui est liée : révoquer une session plus ancienne du même appareil le laisse connu (« déconnecter les autres appareils » couvre ce cas) ;
  - un ancien cookie d'appareil (chemin `/api/auth`) reste dans le navigateur jusqu'à son expiration, sans effet.
- **Point ouvert** : l'inscription ne vérifie pas encore l'adresse e-mail avant d'ouvrir l'espace. Le paiement de l'abonnement fait office de filtre en production, mais une vérification par lien reste à ajouter.

### Cycle 50 (07 h 10) : adresse e-mail confirmée à l'inscription (chantier 43)

Le point ouvert du cycle 49 est fermé. Jusqu'ici, n'importe qui pouvait ouvrir un compte avec l'adresse d'autrui. La titulaire ne pouvait plus s'inscrire, et le compte servait à écrire à des tiers sous son nom.

- **Lien de confirmation** envoyé à l'inscription :
  - valable 7 jours, à usage unique ; seule son empreinte est en base ;
  - ouvert sans session (sur le téléphone, par exemple) ;
  - un renvoi remplace l'ancien lien (3 renvois par heure).
  Le lien est retiré au moment même où il est lu, si bien que deux requêtes simultanées n'aboutissent pas toutes les deux (testé).
- **Ce que la confirmation débloque** : inviter l'équipe, envoyer un devis (à une adresse saisie par le marchand) et activer les versements Stripe. Le reste de l'espace marche sans elle. Les autres e-mails partent vers des clients qui ont commandé, ou qui se sont inscrits eux-mêmes avec double confirmation.
- **Adresse prouvée autrement** :
  - une réinitialisation de mot de passe prouve l'adresse. Un compte ouvert par un tiers avec l'adresse d'autrui revient donc à sa titulaire par « mot de passe oublié », et le tiers est déconnecté (testé) ;
  - un membre qui accepte son invitation est confirmé par le lien d'invitation.
- **Comptes existants** : ils sont considérés comme confirmés. La colonne et cette reprise sont ajoutées d'un seul tenant, et un redémarrage ne confirme jamais un compte récent (testé).
- **Espace marchand** :
  - un rappel sous la barre du haut, avec « Renvoyer le lien » ;
  - il disparaît dès que l'état est relu, même si le lien a été ouvert sur un autre appareil ;
  - un lien déjà consommé par l'antivirus de la messagerie s'affiche comme une réussite si l'adresse est confirmée.
  Vérifié dans Chromium, sur bureau et sur mobile. La section Paiements indique aussi la marche à suivre avant le bouton d'activation.
- **Parcours de bout en bout** : il activait les versements sans confirmer l'adresse, et il a échoué dès la règle en place. Il suit maintenant le vrai parcours : refus avec la marche à suivre, e-mail reçu, lien ouvert, puis activation chez Stripe. 57 contrôles, 0 anomalie. Le vérificateur complet est vert pour le reste (simulation de 60 jours, fuzzing, charge, audits au clavier).
- **Défaut trouvé au passage** : une boutique créée par l'API sans secteur, ou avec un secteur inconnu, empêchait l'affichage du tableau de bord (erreur JavaScript). Elle prend désormais le secteur par défaut.
- **Relecture indépendante** : aucun défaut bloquant ; sept points corrigés :
  - l'envoi de devis n'était pas soumis à la règle ;
  - le rappel restait affiché jusqu'au rechargement de la page ;
  - le lien d'un autre compte, ouvert dans ce navigateur, marquait à tort le compte ouvert comme confirmé ;
  - un lien consommé par un antivirus donnait un message d'erreur ;
  - la reprise des comptes existants ne se faisait pas d'un seul tenant ;
  - deux requêtes simultanées avec le même lien aboutissaient toutes les deux ;
  - le lien consommait les essais de connexion du réseau.
- 4 tests de plus, et les tests de l'équipe, des devis et de Stripe Connect confirment l'adresse par le vrai lien : 189 tests sur 189.
- **Limite connue** : quand la titulaire reprend un compte ouvert par un tiers, elle reprend aussi la boutique qu'il y avait préparée. Rien n'a pu être envoyé en son nom, mais elle doit la vider ou supprimer le compte.

### Cycle 51 (07 h 40) : rotation des clés de chiffrement (chantier 44)

`SECRET_CHIFFREMENT` ne pouvait pas changer. Le remplacer rendait illisibles les données des clients, les secrets de double authentification, les cartes cadeaux et les comptes de fidélité, et invérifiable le journal des ventes. Il peut désormais tourner (clé exposée, départ d'un administrateur, règle interne), sans interruption ni perte :

- **Trousseau** : la nouvelle clé dans `SECRET_CHIFFREMENT`, les anciennes dans `SECRET_CHIFFREMENT_ANCIENNES` (contrôlé par `--verifier`). Chaque usage a sa sous-clé dérivée (HKDF) de chaque clé.
- **Au démarrage**, rechiffré avec la nouvelle clé :
  - les données des clients des commandes, avec leur index de recherche refait ;
  - les devis et les envois de webhook en attente, eux aussi réindexés : l'effacement des données d'un client les retrouve encore ;
  - les secrets de double authentification.
- **À la première utilisation**, empreinte refaite : les cartes cadeaux (seule une empreinte du code est gardée) et les comptes de fidélité (points, historique, réseaux de confiance).
- **Journal inaltérable** : il n'est jamais re-signé, sinon il ne prouverait plus rien. La vérification accepte les anciennes clés sous deux conditions : une clé remplacée ne revient jamais plus loin dans la chaîne, et une entrée d'une ancienne clé ne peut pas être datée d'après la rotation de celle-ci. La rotation est notée dans le journal.
- **Tests** : 6 tests, dont un parcours complet sur un vrai redémarrage. Les données sont créées sous K1, puis K2 prend la relève avec K1 en ancienne. Après le redémarrage :
  - connexion avec un code de l'application d'authentification ;
  - solde d'une carte cadeau ;
  - client retrouvé par son adresse ;
  - journal vérifié sans anomalie.
  Si l'ancienne clé est oubliée, l'exploitant est prévenu, et rien n'est écrasé.
- **Relecture indépendante**, constats corrigés :
  - **Grave** : si l'ancienne clé était oubliée au premier redémarrage, le repère de clé était quand même mis à jour. Remettre la clé ensuite ne rechiffrait plus ces commandes, et surtout ne refaisait plus leur index : l'effacement des données d'un client les aurait manquées en silence. Le repère n'est maintenant posé que si tout a été relu (testé, et le test échoue sans le correctif).
  - Un journal légitime était déclaré falsifié si les anciennes clés étaient listées de la plus ancienne à la plus récente. La règle ne dépend plus de l'ordre (testé avec deux rotations, dans les deux ordres).
  - **Documentation trop affirmative** : quelqu'un qui détient une ancienne clé et peut écrire dans la base pourrait re-signer tout le journal avec elle. Après une fuite, seules les empreintes envoyées chaque semaine aux marchands font foi. C'est maintenant dit dans `MISE-EN-LIGNE.md` et dans le code.
- **Limites connues** :
  - les compteurs anti-abus repartent de zéro à la rotation ;
  - les codes de fidélité en cours (15 minutes) sont à redemander ;
  - l'empreinte réseau d'une acceptation de devis ne se compare plus d'une clé à l'autre (simple élément de preuve).
- 195 tests sur 195 ; vérificateur complet 7 sur 7 (avant les derniers correctifs, puis parcours de bout en bout refait : 57 contrôles, 0 anomalie).

### Cycle 52 (07 h 45) : démonstration publiée, version 25 (chantier 46)

- **Démonstration mise à jour** : https://claude.ai/artifact/VVqm5yN2b2csXTiHAt6sM9. Seuls les fichiers modifiés depuis la version 24 sont republiés (`data.js`, `serveur.js`, `parametres.js`, `app.css`), avec le secteur par défaut qui empêche le tableau de bord de planter.
- Le rappel de confirmation de l'adresse et l'indication de la section Paiements n'apparaissent pas dans la démonstration : ils n'ont de sens qu'avec un serveur.
- **Vérifié dans Chromium** avec les fichiers publiés : tableau de bord, commandes, réglages, analyse et clients. Aucune erreur JavaScript.

### Cycle 53 (08 h 20) : relecture adversariale de la boutique publique et du paiement (chantier 45)

Un relecteur indépendant a attaqué la boutique publique et le paiement : prix, stock, codes, cartes cadeaux, points de fidélité, états de la commande, webhooks Stripe, accès aux commandes et aux documents. Chaque constat est prouvé par un script, sans faille critique.

**Ce qui tient** (vérifié par scripts, parfois sur 200 000 paniers au hasard) :
- prix toujours recalculés côté serveur ;
- aucun écart d'arrondi entre Stripe et la commande ;
- cartes cadeaux et points sans double dépense, même avec 5 commandes simultanées ;
- carte d'une autre boutique refusée ;
- commande d'une autre boutique introuvable ;
- jetons comparés en temps constant ;
- webhooks signés, datés et dédoublonnés ;
- pas d'énumération des adresses.

**Constats corrigés, en deux tours** (le second relecteur a trouvé les premiers correctifs incomplets) :
- **E-mails de la boutique détournés** : le nom saisi à la commande était repris tel quel dans la relance de paiement (« Bonjour … ») et dans l'e-mail de la facture QR. N'importe qui pouvait faire envoyer par la boutique un message de son choix, avec un lien, à l'adresse de son choix.
  - Correctif : nom, adresse et ville tiennent sur une ligne. Un lien ou une adresse de site, même maquillé (« exemple[.]com », adresse IP), est refusé avec un message clair, jamais réécrit en silence, puisque le nom figure sur la facture. « J. Dupont », « Müller & Co. » et « St.Gallen Sàrl » passent.
  - Les relances des commandes passées avant le correctif nettoient le nom au moment de l'envoi.
- **Stock retenu sans payer** : un même réseau pouvait bloquer tout le catalogue avec des commandes jamais payées, sous des adresses jetables.
  - Correctif : ses commandes impayées (la première comprise) retiennent au plus la moitié du stock d'un produit, au moins 3 et au plus 20. Le plancher était d'abord de 2 : la simulation de 60 jours a montré 4 vrais clients refusés (3 exemplaires des 3 derniers), d'où 3. Au-delà, il faut payer d'abord ou demander un devis.
  - Un client qui annule le paiement rend le stock tout de suite, au lieu d'attendre 35 minutes.
- **Vente en double** : la page de paiement Stripe restait ouverte 24 heures, et la réservation du stock seulement 30 minutes.
  - Correctif : la page se ferme à 31 minutes et la réservation dure 35 minutes.
  - Un paiement repris des heures plus tard par le lien de relance revérifie le stock (refusé si l'article a été vendu entre-temps) et le réserve de nouveau (testé).
- **Montant et devise contrôlés** à chaque confirmation Stripe (défense en profondeur ; aucune exploitation trouvée) :
  - une session qui ne correspond pas n'est jamais validée ; l'argent reçu est marqué à rembourser et noté dans la commande pour le marchand ;
  - le webhook de la plateforme ignore les ventes des boutiques connectées.
- **Code de bienvenue** :
  - il était publié dans la vitrine, ce qui contournait la double confirmation de l'inscription ; il ne l'est plus ;
  - deux commandes ouvertes ensemble en profitaient toutes les deux ; une seule le peut maintenant ;
  - un client qui annule son paiement recommence avec le code, mais l'ancienne commande ne repart plus avec lui (testé).
- **Tests** : 5 nouveaux tests de boutique durcie, plus 3 contrôles dans celui de Stripe Connect. Le test du contrôle de montant échoue si l'on retire le contrôle.

**Limites connues** :
- un client qui veut plus de la moitié du stock d'un produit (et plus de 3 exemplaires) en une commande non payée doit demander un devis (choix assumé contre le blocage du stock). Un même réseau peut encore retenir 3 exemplaires de chaque produit pendant 35 minutes sans payer ;
- avec le prestataire de paiement simulé (essais, hors production), les liens n'expirent pas ;
- les codes promo n'ont pas encore de limite d'usage par code ou par client.

200 tests sur 200. Vérificateur complet : 6 étapes sur 7, puis la simulation de 60 jours relancée seule après le correctif du plancher : 0 anomalie sur plus de 7 000 commandes.

### Cycle 54 (08 h 55) : codes promo avec limites (chantier 47)

- **Nouvelles règles pour un code manuel**, toutes facultatives et contrôlées par le serveur :
  - un montant minimum du panier, compté avec les prix d'offre ;
  - un nombre maximum d'utilisations ;
  - « une fois par adresse e-mail ».
- **Ce qui compte comme une utilisation** : une commande payée, une facture QR en attente, ou une commande en attente dont le lien de paiement a moins de 35 minutes. Une commande abandonnée ou annulée rend son utilisation.
- **Points de contrôle** :
  - dans la transaction qui crée la commande : deux clients simultanés ne prennent pas la même dernière utilisation (testé) ;
  - à la reprise d'un vieux lien de paiement ;
  - à la saisie du code, qui annonce ses conditions.
- **Espace marchand** : champs dans le formulaire des codes, et nombre d'utilisations calculé par le serveur. Vérifié dans Chromium, sur bureau et sur mobile ; la mise en page mobile a été corrigée (champs superposés).
- **Boutique** : sous le minimum, le panier dit combien il faut atteindre, et la commande reste possible sans le code.
- **Relecture indépendante**, constats corrigés :
  - **Paiement arrivé tard** (webhook retardé, lien payé après un abandon) alors que la dernière utilisation a été prise entre-temps : la limite pouvait être dépassée d'une utilisation, sans que personne le sache. Le client a payé, donc la vente est faite, mais le dépassement est maintenant signalé dans la commande (testé). Ce qui est garanti : deux commandes simultanées ne prennent pas la même dernière utilisation. Un paiement très tardif reste un cas signalé, pas bloqué.
  - Message de la boutique illisible en CHF : un texte était découpé au point décimal. Le serveur envoie maintenant les conditions en liste.
  - Commande impossible tant qu'un code restait sous son minimum : le code n'est plus envoyé dans ce cas.
  - Minimum calculé avec le prix plein des articles en offre.
  - Comptage des utilisations sur toute la boutique, sous le verrou d'écriture : 130 ms à 200 000 commandes. Il passe maintenant par une colonne calculée indexée (le plan de requête utilise l'index) ; une ligne au JSON abîmé ne bloque rien.
  - Compteur de l'espace marchand différent de celui du serveur : il vient maintenant du serveur.
- **Limites connues** :
  - « une fois par client » se juge par adresse e-mail (lou+1@… et lou@… sont deux adresses) ;
  - une commande remboursée compte encore comme une utilisation ;
  - recréer un code du même nom reprend ses utilisations passées.
- 202 tests sur 202 ; parcours de bout en bout : 57 contrôles, 0 anomalie.

### Cycle 55 (09 h 10) : relecture adversariale de l'API publique et des webhooks sortants (chantier 48)

Un relecteur indépendant a attaqué `/api/v1` et les webhooks avec deux boutiques et un récepteur local. Il a prouvé chaque constat par un script, sans faille critique.

**Ce qui tient** :
- clés de 192 bits, gardées en empreinte seulement, révoquées dès la requête suivante ;
- toutes les routes refusées sans la bonne portée ;
- aucune lecture ni écriture d'une autre boutique ;
- champs non prévus ignorés à l'écriture ;
- protection SSRF complète : formes IPv4, IPv6 et mappées, rebinding DNS, redirections non suivies ;
- signature, nouveaux essais, limites par clé et par boutique ;
- effacement d'un client jusque dans la file.

**Constats corrigés** :
- **Moyen** : la liste des clients de l'API déchiffrait toutes les commandes de la boutique à chaque appel (0,8 s de calcul bloquant à 20 000 commandes). Dix appels en parallèle bloquaient une autre boutique pendant 8 secondes.
  - Elle est maintenant regroupée par l'index aveugle, sans rien déchiffrer pour compter, et paginée (`limite`, `apres`, `suite`), avec 60 lectures par minute.
  - Seule la dernière commande de chaque client de la page est déchiffrée, par un index (boutique, client, date) qui remplace l'ancien.
- **Moyen** : la file des webhooks ne faisait que marquer les envois en trop. Une clé pouvait ajouter des millions de lignes par jour, gardées 30 jours.
  - Au plus 5 000 lignes par webhook, tous statuts confondus ; les plus anciennes sont supprimées.
  - Un envoi livré ne garde que ses métadonnées : les données du client sont effacées.
  - Une seule rupture de stock par produit toutes les 10 minutes.
- **Faible** : un prix de 0,004 était accepté puis arrondi à 0 (produit gratuit). Le prix est maintenant contrôlé après l'arrondi.
- **Faible** : le secret d'un webhook ne pouvait pas changer sans supprimer le webhook et sa file, et il était gardé en clair.
  - Il est maintenant chiffré comme les données des clients, et rechiffré à une rotation de clé du serveur.
  - Le bouton « Nouveau secret » garde l'ancien valable 24 heures, avec deux signatures : l'ancienne d'abord, la nouvelle en dernier, si bien qu'un vérificateur qui ne garde que la dernière marche dès qu'il a le nouveau secret.
  - L'exemple de `API.md` accepte l'une ou l'autre.
- **Info** : deux plages réseau mineures sont ajoutées aux adresses refusées (relais 6to4, NAT64 local).

**Seconde vérification** : les correctifs sont confirmés, avec une régression corrigée.
- Un seul secret illisible (clé du serveur changée sans l'ancienne) arrêtait l'envoi des webhooks de toutes les boutiques.
- Désormais, ce webhook seul n'envoie rien (aucun envoi sans signature valable), sa file est gardée, l'erreur est journalisée une fois, et chaque webhook est traité à part (testé).

**Limites et points ouverts** :
- le dédoublonnage des ruptures vit en mémoire (un redémarrage le remet à zéro), et une vraie deuxième rupture dans les 10 minutes n'est pas envoyée ;
- les webhooks portent toujours les données complètes du client, comme le documente `API.md` (seul le propriétaire en crée) ;
- le relecteur a vu une fois une erreur `UNIQUE` dans la reprise du journal au redémarrage, sur une base manipulée par ses scripts. Elle n'a pas été reproduite dans un parcours normal (ventes puis redémarrage) : à surveiller.

203 tests sur 203. Parcours de bout en bout : 57 contrôles, 0 anomalie. Fuzzing HTTP : 3 200 requêtes, 0 constat.

### Cycle 56 (09 h 20) : bilan de sécurité dans la console de l'exploitant (chantier 49)

La console `/operateur` (réservée à l'exploitant, double authentification et lien de confirmation exigés) a maintenant une section **Sécurité**. Chaque ligne dit si une action est nécessaire, et laquelle :
- clé de chiffrement hors de la base ou non ;
- anciennes clés gardées, rotations notées par le journal des ventes, alerte si sa clé a changé sans l'ancienne ;
- données illisibles avec les clés connues : commandes et secrets de double authentification comptés au démarrage, secrets de webhook à chaque ouverture ;
- part des comptes marchands protégés (double authentification ou clé d'accès exigée) ;
- adresses e-mail non confirmées depuis plus de 7 jours ;
- codes de vérification refusés en 24 heures (alerte à partir de 20) ;
- paiements reçus encore à rembourser.

Aucune donnée de client final ni aucun secret : seulement des comptes et des dates. Les lignes d'alerte sont vérifiées par les tests.

**Relecture indépendante**, constats corrigés :
- **Moyen** : le compteur « à rembourser » ne pouvait que monter. Rien ne sortait un paiement de cet état, et un paiement non conforme n'était jamais remboursé, donc l'exploitant aurait vite appris à ignorer la ligne.
  - Une session non conforme est maintenant remboursée automatiquement chez Stripe, sur le compte de la boutique.
  - Un remboursement fait à la main dans Stripe (événement `charge.refunded`) solde la ligne, et une autre boutique ne peut pas la solder à sa place (testé).
- Les comptes protégés comptaient les membres d'équipe et le compte de l'exploitant, en désaccord avec la ligne « Comptes marchands » : ils comptent maintenant les propriétaires seulement.
- Les secrets de double authentification illisibles n'étaient pas comptés quand la clé avait été retirée : ils sont contrôlés à chaque démarrage.
- La clé était annoncée « hors de la base » quand `SECRET_CHIFFREMENT` valait la clé de la base. C'est maintenant comparé aux octets près.
- Le libellé précise que les commandes et les secrets de double authentification sont comptés au démarrage.

203 tests sur 203 ; parcours de bout en bout : 57 contrôles, 0 anomalie.

### Cycle 57 (09 h 30) : reprise du journal des ventes au redémarrage (chantier 50)

- **Cause trouvée et reproduite** : une commande portant un numéro de facture (ou d'avoir) déjà scellé pour une autre commande faisait échouer l'insertion (contrainte `UNIQUE`). Cela arrive avec une base fusionnée, restaurée ou des données importées. Toute la reprise de la boutique était alors annulée, à chaque démarrage, et ses autres pièces, saines, ne se scellaient jamais.
- **Correctif** :
  - un numéro déjà scellé ailleurs est un conflit signalé, jamais une erreur ;
  - la reprise travaille commande par commande, avec un point de reprise pour chacune. Une commande en conflit est laissée entière à sceller : jamais d'avoir scellé sans sa facture ;
  - le conflit est journalisé à chaque démarrage, sans donnée de client ;
  - la vérification du journal continue de signaler la pièce au marchand ;
  - les autres pièces sont scellées.
- **Relecture indépendante**, constats corrigés :
  - un conflit sur un avoir partiel n'était signalé qu'une fois, puis disparaissait de la vérification : l'avoir partiel ne comptait comme scellé que pour sa propre commande ;
  - une erreur de la base elle-même (disque plein) aurait été masquée par l'annulation : l'erreur d'origine remonte maintenant.
  - Vérifié par le relecteur : la chaîne d'empreintes et la numérotation restent intactes quand une commande est laissée de côté.
- 2 tests de plus, dont un qui échoue sans le correctif de l'avoir partiel : 205 tests sur 205.

### Cycle 58 (09 h 35) : test de charge après les changements de la matinée (chantier 51)

- **1 000 boutiques**, 200 000 commandes d'historique, 50 clients simultanés : 472 actions par seconde sur 60 secondes, 197 Mo, **0 erreur** sur 28 331 actions.
- Le chiffre était plus bas que celui du cycle 48 (environ 583). Plutôt que de conclure, une comparaison directe a été faite sur la même machine et au même moment, avec les mêmes paramètres : code du cycle 48 contre code actuel, 522 contre 529 actions par seconde. **Pas de régression** : l'écart venait de la charge de la machine, pas du code.
- Latences au 95e centile : vitrine 183 ms, espace marchand 194 ms, commande payée de bout en bout 145 ms.
- Le profil du serveur montre que le temps se partage entre les lectures de la base et le chiffrement des données des clients ; rien ne se détache.

### Cycle 59 (09 h 35) : audit au clavier et au lecteur d'écran des nouveaux écrans (chantier 52)

Un auditeur indépendant a parcouru dans Chromium, au clavier, à 1 280 et 390 pixels de large, les écrans ajoutés depuis la nuit : rappel de confirmation de l'adresse, codes promo, nouveau secret de webhook, indication de la section Paiements, message du code promo dans la boutique.

**Ce qui allait** :
- ordre de tabulation logique ;
- focus visible, pas de piège ;
- champs nommés ;
- lignes de codes lues avec leurs limites ;
- copie du secret au clavier.

**Constats corrigés** (vérifiés dans Chromium après correction) :
- **« Retirer » retirait le code suivant au second appui** : après un retrait, le focus tombait sur le bouton « Retirer » du code suivant, sans message. Un second Entrée en effaçait un autre en silence.
  - Chaque bouton dit maintenant quel code il retire (« Retirer le code BBB »).
  - Un message confirme le retrait, et le focus revient au champ du code.
- **Focus perdu après l'ajout d'un code** : il revient au champ du code, pour en saisir plusieurs à la suite.
- **Messages pas toujours lus par les lecteurs d'écran** : la bulle apparaissait et se remplissait au même instant, ce que NVDA et JAWS manquent souvent avec Chrome. Les messages passent maintenant par une zone d'annonce toujours présente (jamais masquée), vidée puis remplie un instant après ; un même message est donc relu. Les messages longs restent affichés plus longtemps (jusqu'à 12 secondes). L'audit au clavier de l'espace marchand vérifie désormais cette zone.
- **Rappel de confirmation** :
  - après « Renvoyer le lien », le bouton restait grisé et le focus se perdait ; le bouton reste actif (« Renvoyer encore ») et garde le focus, et le rappel dit « Lien envoyé » ;
  - c'est une région nommée, et non plus une zone d'annonce qui contiendrait un bouton.
- **Nouveau secret de webhook** :
  - le focus va au titre de la carte qui montre le secret, amenée à l'écran ; « C'est copié » le rend au titre des webhooks ;
  - la confirmation et le bouton nomment l'adresse du webhook.
- **Noms accessibles** :
  - « Dès » et « Au plus » commencent par le mot affiché (commande vocale) ;
  - la colonne d'actions du tableau a un titre pour les lecteurs d'écran.
- **Section Paiements** : l'indication est reliée au bouton « Activer les paiements » (`aria-describedby`) et a son propre bouton « Renvoyer le lien », au lieu de renvoyer « en haut de page ».
- **Boutique** : les messages du code promo, de la carte cadeau et des points de fidélité passent par la zone d'annonce existante de la boutique.

**Non testé** : avec de vrais lecteurs d'écran (NVDA, VoiceOver). Les constats sur les annonces viennent de l'arbre d'accessibilité et du comportement connu des zones d'annonce.

205 tests sur 205 ; audits au clavier de la boutique et de l'espace marchand : 0 problème.

### Cycle 60 (09 h 40) : documentation relue contre le code (chantier 53)

Un relecteur indépendant a confronté les six documents (`API.md`, `FONCTIONNALITES.md`, `MISE-EN-LIGNE.md`, les deux README, `.env.example`) au code. `API.md` était pour l'essentiel exact ; les erreurs se concentraient dans le README du serveur et `.env.example`. Tout est corrigé :

- **Chiffres faux** :
  - le seuil du bloc d'adresses est trois fois (et non cinq fois) le seuil par adresse ;
  - une file d'e-mails tente 12 fois (et non 5) ;
  - `charge.refunded` manquait aux listes de webhooks Stripe du README du serveur ;
  - la console de l'exploitant exige la double authentification par application, pas une clé d'accès ;
  - les journaux d'e-mails montrent une adresse masquée, jamais le sujet.
- **Affirmations inexactes de `API.md`** :
  - `modifiee` n'est présent que dans la liste des commandes ;
  - une commande en préparation s'expédie aussi par l'API, et seule une commande entièrement en dropshipping est refusée ;
  - le prix va de 0,01 à 1 000 000, arrondi au centime ;
  - le total d'un client inclut les commandes remboursées ;
  - un webhook fait 15 tentatives en tout, pendant environ 38 heures.
- **Ajouts à `API.md`** :
  - limite de 10 webhooks ;
  - 30 clés refusées par minute et par adresse ;
  - code `403 portee` ;
  - bouton de test ;
  - forme de la réponse des produits ;
  - corps de requête limité à 2 Mo ;
  - identité confirmée pour créer une clé ou un webhook.
- **`.env.example`** : les variables qu'un exploitant doit connaître y sont maintenant (fournisseur réel, sauvegardes, fuseau horaire, `CACHE_ETAT_MAX`), avec la liste des variables réservées aux essais, à ne jamais définir en production.
- **Fonctionnalités et mise en ligne** :
  - console de l'exploitant complète (journaux, rapports CSP, bilan de sécurité) et comment l'ouvrir ;
  - rotation des clés, secrets de webhooks, mode sécurisé ;
  - le numéro IDE de l'exploitant n'est pas contrôlé par `--verifier`.
- **README** : il annonçait encore « à faire » la disponibilité des domaines, les certificats HTTPS automatiques et les e-mails transactionnels, qui sont faits. Il renvoie maintenant à `API.md`.

### Cycle 61 (09 h 45) : mode sécurisé et durée de vie des sessions (chantier 54)

Jusqu'ici, une session restait valable tant qu'elle servait, et un cookie copié (poste partagé, extension malveillante) suffisait à tout faire. Deux protections :

- **Durée de vie absolue de 90 jours** : une session se renouvelle tant qu'elle sert, mais jamais au-delà de 90 jours après la connexion. Les sessions plus anciennes que la règle comptent leurs 90 jours à partir du déploiement.
- **Identité confirmée récemment (mode sécurisé)** pour les actions qui ouvrent un accès durable aux données ou détournent l'argent :
  - créer une clé d'API ou un webhook, renouveler un secret ;
  - inviter un membre de l'équipe ;
  - changer l'IBAN qui reçoit les paiements par facture QR, ou activer la facture QR.
  Il faut une connexion de moins de 15 minutes, ou une confirmation du mot de passe, et du code si la double authentification est active.
  - L'espace marchand ouvre une fenêtre native (focus gardé, Échap annule, focus rendu), puis la requête repart d'elle-même.
  - Un compte « clé d'accès seule » se reconnecte avec sa clé, depuis un lien de la fenêtre.
  - Changer l'IBAN prévient aussi le propriétaire par e-mail.
  - L'export complet redemandait déjà mot de passe et code.

**Relecture indépendante** : aucun contournement des actions protégées. Constats corrigés :
- **Moyen** : l'IBAN de la boutique se changeait avec le seul cookie. Toutes les factures QR suivantes auraient été payées sur le compte d'un tiers. Il est maintenant protégé, avec alerte par e-mail (testé : refusé sans confirmation, rien n'est enregistré, puis accepté et signalé).
- L'état de la double authentification était lu au chargement de la page seulement. Après l'avoir activée, la fenêtre n'avait pas de champ de code, et la confirmation échouait jusqu'au rechargement. Il est relu à chaque ouverture.
- Au premier redémarrage, les anciennes sessions, volées comprises, auraient compté comme « confirmées » pendant 15 minutes. Elles sont maintenant datées d'il y a plus de 15 minutes (testé).
- Les échecs de confirmation ont un plafond quotidien (30) et sont notés au journal du compte.
- Fenêtre : explication reliée (`aria-describedby`), focus sur le champ en cause après une erreur, lien « Se reconnecter avec ma clé d'accès ».

Vérifié dans Chromium, sur bureau et sur mobile : la fenêtre s'ouvre, le focus est dans le mot de passe, et la clé d'API est créée après confirmation. 209 tests sur 209 ; parcours de bout en bout : 57 contrôles, 0 anomalie.

### Cycle 62 (09 h 55) : sauvegardes restaurées à l'essai (chantier 55)

Une sauvegarde chiffrée qu'on ne saurait pas restaurer ne vaut rien, et on ne le découvre que le jour où on en a besoin. Désormais :

- **Avec `SAUVEGARDE_CLE`**, chaque sauvegarde est restaurée à l'essai avant d'être gardée :
  - copie cohérente, contrôlée par `quick_check` ;
  - chiffrée, puis la copie en clair effacée aussitôt ;
  - déchiffrée en mémoire, en flux, sans rien écrire sur le disque, et comparée octet par octet (SHA-256) à la copie contrôlée ;
  - en cas d'écart, rien n'est gardé sous le nom final.
  Cela prouve que la clé actuelle la relit ; garder cette clé hors du serveur reste à la charge de l'exploitant. Les anciennes copies en clair chiffrées après l'ajout d'une clé passent le même contrôle avant d'être effacées.
- **Sans clé** : seulement `quick_check`, et c'est dit comme tel.
- **État de chaque tentative noté** (réussite, erreur, nombre de commandes, chiffrée ou non) et affiché dans la section Sécurité de la console de l'exploitant. Alerte en cas d'échec, de copies non chiffrées, de sauvegardes désactivées, ou après plus de 30 heures sans sauvegarde réussie (une par jour, essai toutes les 6 heures).
- **Une seule tentative à la fois** : une sauvegarde lente n'est plus doublée par la suivante.

**Relecture indépendante**, constats corrigés :
- la première version écrivait sur le disque une copie complète en clair pour l'essai de restauration (et trois copies à la fois). L'essai se fait maintenant en mémoire ;
- un disque plein pendant une restauration était annoncé comme « mauvaise clé » : l'erreur d'origine est maintenant transmise ;
- l'affichage disait « restaurée à l'essai » même sans clé : il dit maintenant « vérifiée (quick_check seulement) » ;
- les anciennes copies en clair étaient chiffrées puis effacées sans contrôle ;
- deux tentatives simultanées pouvaient effacer les fichiers l'une de l'autre.

Tests : une copie chiffrée altérée échoue à l'essai ; deux tentatives simultanées n'en font qu'une ; sans clé, la sauvegarde est dite non vérifiée par restauration ; la console affiche chaque état. 210 tests sur 210. Simulation de 60 jours (après le chantier 54) : 0 anomalie.

### Cycle 63 (10 h 00) : démonstration publiée, version 26 (chantier 56)

- Démonstration mise à jour (https://claude.ai/artifact/VVqm5yN2b2csXTiHAt6sM9), avec les nouveautés de la matinée qui vivent dans le navigateur :
  - codes promo avec limites (formulaire et compteurs) ;
  - zone d'annonce permanente pour les lecteurs d'écran ;
  - focus après l'ajout et le retrait d'un code ;
  - messages de la boutique annoncés.
- Le mode sécurisé, le rappel de confirmation de l'adresse et les secrets de webhook demandent un serveur : ils n'apparaissent pas dans la démonstration.
- Chargée dans Chromium avec les fichiers publiés : aucune erreur JavaScript.

### Cycle 64 (10 h 15) : relecture adversariale transversale des nouveautés de la matinée (chantier 57)

Chaque nouveauté de la matinée avait été relue seule. Un relecteur indépendant a cherché ce qui casse quand elles se combinent, preuves à l'appui (scripts). Le vérificateur complet est passé (7 étapes sur 7) avant les correctifs.

**Ce qui tient** :
- la rotation des clés couvre bien tout ce qui a été ajouté depuis : secrets des webhooks, file des webhooks et leur index, devis, double authentification, données des clients et leur index (utilisé par les codes « une fois par client » et la liste des clients de l'API) ;
- le remboursement automatique des sessions non conformes ne compte ni le stock ni les codes en double ;
- la règle contre les requêtes d'autres sites ne casse aucun parcours ;
- la console de l'exploitant n'expose rien ;
- fuzzing des 161 routes : 0 constat.

**Constats corrigés** :
- **Grave** : le mode sécurisé sur l'IBAN se contournait de deux façons :
  - par « réinitialiser la boutique », qui écrivait toute la configuration sans contrôle ni alerte, et sans même la protection des membres d'équipe ;
  - en posant un *premier* IBAN.
  Une seule règle s'applique maintenant aux deux enregistrements :
  - tout changement d'IBAN (premier compris), l'activation de la facture QR et le changement de l'e-mail de contact de l'entreprise (adresse de réponse des e-mails aux clients) demandent une identité récente ;
  - le propriétaire est prévenu par e-mail ;
  - la vérification d'un domaine aussi : un domaine reçoit les liens des e-mails et les retours de paiement.
- **Grave** : la clé gardée dans la base restait au trousseau même quand `SECRET_CHIFFREMENT` était défini dès le premier jour. Quiconque lisait la base (copie, sauvegarde) pouvait re-signer tout le journal des ventes, qui se vérifiait sans anomalie, ou fabriquer des cartes cadeaux acceptées.
  - Premier correctif : un historique des clés tenu en base. La vérification de ce correctif a montré qu'il se contournait en écrivant dans la base, et qu'il cassait les bases déjà passées à `SECRET_CHIFFREMENT`.
  - Correctif final : la clé de la base n'est acceptée que si elle est la clé courante, ou si l'exploitant la liste lui-même dans `SECRET_CHIFFREMENT_ANCIENNES`, hors de la base. Si elle a servi sans être listée, rien n'est effacé, et l'exploitant est prévenu au démarrage et dans la console avec la marche à suivre ; la nouvelle commande `node server/server.js --cle-base` l'affiche.
  - Le journal signale aussi une pièce signée avec une clé du trousseau qui n'a jamais été la sienne.
  - Testé : pièce et carte forgées avec la clé de la base refusées, et le test échoue sans le correctif.
- **Moyen** : le plafond de réservation par réseau se contournait avec la même adresse e-mail, ou en abandonnant puis reprenant des commandes. Toutes les commandes impayées du réseau comptent maintenant, et la reprise applique le plafond et la limite de commandes impayées (testé).
- **Moyen** : une reprise refusée (article vendu entre-temps) laissait la carte cadeau débitée jusqu'à 2 heures. La carte et les points ne sont repris qu'une fois tous les contrôles passés, dans la même transaction (testé, échoue sans le correctif). Les liens de paiement encore ouverts ne sont fermés qu'après une reprise acceptée.

**Changement pour l'exploitant** : un serveur qui a tourné sans `SECRET_CHIFFREMENT` doit lister la clé de la base dans `SECRET_CHIFFREMENT_ANCIENNES` en définissant la nouvelle clé. Ce n'est plus automatique, par sécurité ; c'est documenté dans `MISE-EN-LIGNE.md` et `.env.example`.

**Limites connues** :
- un IBAN saisi juste avant de quitter la page (envoi de dernière seconde) n'est pas enregistré si l'identité n'est pas confirmée ;
- annuler la fenêtre de confirmation la fait revenir au prochain enregistrement automatique, tant que l'IBAN modifié reste dans le formulaire.

213 tests sur 213 ; parcours de bout en bout : 57 contrôles, 0 anomalie ; audits au clavier : 0 problème ; simulation de 60 jours sur 100 marchands (après les premiers correctifs) : 0 anomalie.

### Cycle 65 (10 h 45) : mode sécurisé et enregistrement automatique, webhooks sans données personnelles, comptage des codes (chantiers 58 à 60)

- **Chantier 58, enregistrement automatique** :
  - si le marchand annule la confirmation d'identité, l'IBAN, l'e-mail de contact et la facture QR reprennent leur valeur enregistrée sur le serveur, relue au moment même : un autre onglet a pu la changer ;
  - le reste des réglages s'enregistre, et la fenêtre ne revient pas à chaque enregistrement ;
  - un second refus arrête les essais et le dit (aucune boucle de fenêtres) ;
  - l'envoi de dernière seconde (fermeture de la page) garde les valeurs sensibles enregistrées et n'en perd plus le reste.
  Vérifié dans Chromium.
- **Chantier 59, webhooks sans données personnelles par défaut** :
  - un nouveau webhook ne reçoit du client que son pays ; le marchand coche « Inclure les données personnelles des clients » si son outil en a besoin ;
  - le choix se change ensuite sans supprimer le webhook ni perdre sa file. Ajouter les données demande une identité récente, les retirer jamais ;
  - les webhooks existants gardent leur comportement ;
  - seuls les envois qui contiennent l'e-mail sont indexés pour l'effacement d'un client.
- **Chantier 60, comptage des codes promo** :
  - une commande entièrement remboursée rend son utilisation, code de bienvenue compris ;
  - un code supprimé puis recréé repart de zéro, grâce à sa date de création, posée par le serveur.
- **Relecture indépendante**, constats corrigés :
  - **Grave** : modifier un code d'avant cette règle lui donnait une date de création neuve, donc un compteur remis à zéro (un code « 100 utilisations » en offrait 100 de plus). La date vient maintenant du serveur, seulement pour un code nouveau ; un code modifié garde la sienne, même absente (testé) ;
  - **Grave** : la valeur « enregistrée » des champs sensibles n'était connue que de l'onglet. Un changement confirmé dans un autre onglet faisait revenir la fenêtre en boucle, ou risquait d'être écrasé. Elle est maintenant relue sur le serveur ;
  - pour un indépendant, la raison sociale d'un devis est son nom : elle est retirée aussi sans opt-in ;
  - un membre d'équipe ne fixe plus les valeurs « enregistrées » (le serveur garde celles du propriétaire) ;
  - l'horloge du navigateur ne compte plus ;
  - la documentation de l'API est alignée.
- 216 tests sur 216.

### Cycle 66 (11 h 35) : minimisation des e-mails gardés (chantier 61)

Les données des clients dans les commandes sont chiffrées, mais le journal des e-mails envoyés gardait en clair, 180 jours, le contenu des confirmations (nom, adresse, commande). Une copie volée de la base livrait donc six mois de données par ce biais. Désormais :

- **Durées de conservation** :
  - e-mail envoyé : contenu effacé 7 jours après l'envoi (assez pour le dépannage ; l'écran du marchand n'affiche de toute façon que sujet, destinataire et date) ;
  - e-mail qui n'a pas pu être remis : contenu effacé après 30 jours ;
  - ligne entière (destinataire, sujet, message d'erreur) : supprimée après 180 jours ;
  - trace des envois automatiques déjà faits (« bienvenue », relances), qui contient l'adresse du client : supprimée après 400 jours ;
  - e-mail en attente d'envoi : jamais touché.
- **Page Protection des données** : ces durées y sont, ainsi que la liste des désinscriptions, gardée pour ne plus écrire aux personnes désinscrites.
- **Console de l'exploitant** : une ligne « Envoi des e-mails » alerte s'il n'y a aucun service d'envoi. Rien ne part alors, et le contenu en attente resterait en clair jusqu'à 180 jours.
- **Relecture indépendante** :
  - aucun lecteur des e-mails cassé (écran du marchand, cartes cadeaux, effacement d'un client, compteurs) ;
  - **défaut plus ancien découvert au passage** : la recherche des cartes cadeaux dont l'e-mail n'a pas pu partir lisait les 100 premières commandes de cartes, sans ordre. Au-delà de 100 cartes bien reçues, un envoi abandonné pouvait ne jamais être repéré : l'acheteur a payé et n'a pas son code. Elle ne lit plus que les envois abandonnés (testé avec 120 cartes reçues ; le test échoue sans le correctif) ;
  - la page de confidentialité, d'abord incomplète, est complétée.
- 218 tests sur 218.

### Cycle 67 (12 h 50) : changement de l'adresse e-mail du compte (chantier 62)

Jusqu'ici, un marchand ne pouvait pas changer l'adresse de son compte. Et une session volée qui l'aurait pu aurait suffi à prendre le compte pour de bon, puisque « mot de passe oublié » passe par l'e-mail. Le changement est donc conçu contre ce cas :

- **Demande** : mot de passe (et code) redemandés même juste après la connexion. Le lien de confirmation part à la nouvelle adresse (24 heures, usage unique) et un avertissement à l'ancienne. Une adresse déjà prise reçoit la même réponse qu'une libre ; seule sa titulaire est prévenue.
- **Annulation par l'ancienne adresse, 7 jours** :
  - l'adresse est rendue, et elle reste réservée pendant ce délai (personne ne peut s'inscrire ni être invité avec) ;
  - un second changement est refusé tant que le premier peut être annulé ;
  - toutes les sessions et tous les appareils reconnus sont révoqués, et un lien de nouveau mot de passe part à l'ancienne adresse ;
  - ce que l'intrus a pu installer depuis sa demande est retiré : double authentification, clés d'accès, clés d'API, webhooks.
- **Trois rondes de relecture indépendante** :
  - **Première ronde**, corrigée : un second changement pouvait effacer la possibilité d'annuler le premier (désormais un seul à la fois) ; l'ancienne adresse pouvait être reprise par une inscription (désormais réservée) ; l'annulation laissait en place ce que l'intrus avait installé ; une session récente suffisait (mot de passe désormais redemandé) ; un changement en attente survivait à une révocation (changement de mot de passe, déconnexion des appareils).
  - **Seconde ronde** :
    - **Grave** : l'annulation retirait toujours « Exiger la clé d'accès ». Quiconque tenait l'ancienne boîte (boîte piratée, c'est justement le cas que cette option protège) obtenait un compte protégé par le seul mot de passe. L'option n'est plus retirée que si elle a été activée après la demande (date d'activation enregistrée ; testé dans les deux sens).
    - **Régression** : un compte « clé d'accès seule » ne pouvait plus confirmer son identité (le mot de passe est refusé), donc plus changer d'adresse. Une connexion par clé d'accès ou par double authentification vaut maintenant confirmation pendant 15 minutes (testé).
    - Les membres et invitations d'équipe ajoutés par l'intrus survivaient à l'annulation : ils sont retirés (comptes des membres compris, comme au retrait d'un membre ; testé).
  - **Troisième ronde**, corrigée :
    - **Moyen** : la connexion par code valait confirmation d'identité, donc un cookie volé juste après suffisait à demander le changement. Seule la connexion par clé d'accès d'un compte « clé d'accès seule » (où le mot de passe est refusé) en tient lieu désormais (testé).
    - **Moyen** : un intrus qui avait désactivé « Exiger la clé d'accès » la gardait désactivée après l'annulation, et son mot de passe restait valable. L'état d'avant la demande est enregistré et rétabli (s'il reste une clé de la titulaire), et le mot de passe actuel est invalidé : la titulaire en choisit un nouveau par le lien (testé).
    - **Bas à moyen** : un intrus pouvait installer, puis attendre quelques minutes avant de demander. Si la session date de moins de 24 heures, la période retirée part de son ouverture (testé avec une invitation faite 10 minutes avant la demande).
    - Membres : jugés par la date de leur invitation (un membre invité avant, arrivé pendant, reste) ; chaque retrait est noté dans le journal du compte, listé dans l'e-mail, et ses e-mails sont effacés comme au retrait d'un membre.
    - Non corrigé : une double authentification d'avant la demande que l'intrus aurait désactivée ne peut pas être rétablie (le secret est détruit). Le mot de passe invalidé et toutes les sessions fermées couvrent le risque ; la titulaire la réactive.
- Vérification complète (7 étapes) réussie après la troisième ronde, avec 224 tests sur 224 et le parcours de bout en bout à 57/57.

### Cycle 68 (13 h 50) : confirmation d'identité par clé d'accès (chantier 63)

La relecture du chantier 62 l'a montré : un compte « clé d'accès seule » ne pouvait confirmer son identité qu'en se déconnectant et en se reconnectant, et le correctif provisoire (la connexion par clé d'accès valait confirmation) ouvrait une fenêtre de 15 minutes à un cookie volé juste après. Désormais :

- **Deux nouvelles routes** :
  - la première délivre un défi propre à ce compte et à cet usage (type « identite »), avec la liste de ses seules clés et la vérification de l'utilisateur exigée ;
  - la seconde vérifie la signature : défi consommé une fois, clé qui appartient au compte, origine, compteur (une clé clonée est refusée).
  - Chaque échec compte dans la limite quotidienne des confirmations et va au journal du compte ; la réussite y est notée avec le nom de la clé.
- **Aucune connexion ne vaut plus confirmation explicite**, même par clé d'accès.
- **Fenêtre de confirmation** :
  - bouton « Confirmer avec ma clé d'accès » en premier quand le compte a une clé et que l'appareil sait l'utiliser ;
  - pour un compte « clé d'accès seule », plus de champ de mot de passe ;
  - sur un appareil sans clé utilisable, un message explique quoi faire.
- **Tests** :
  - clé d'un autre compte, défi de connexion, défi d'un autre compte : refusés ;
  - réponse rejouée : refusée ;
  - la connexion par clé ne suffit pas pour changer d'adresse ;
  - la confirmation par clé ouvre aussi l'action « explicite » (changement d'adresse) ;
  - compte « clé d'accès seule » : mot de passe refusé, clé acceptée.
- **Vérifié dans Chromium avec un authentificateur virtuel**, bureau et mobile : enregistrement d'une clé, puis fenêtre ouverte par la création d'une clé d'API. Le focus est sur le bouton de la clé, Entrée confirme et la clé d'API s'affiche. En mode « clé seule », aucun champ de mot de passe. Aucune erreur de page.
- 225 tests sur 225, parcours de bout en bout 57/57.
- **Relecture indépendante** : rien de grave (défis, rejeu, clé d'un autre compte, vérification de l'utilisateur, session visée : tenus). Constats mineurs, tous corrigés :
  - **Compteur des signatures** : deux vérifications simultanées pouvaient le faire reculer. Il n'avance plus que s'il progresse (mise à jour conditionnelle), à la connexion comme à la confirmation. Une signature dont le compteur recule (signe d'une clé copiée) est maintenant notée au journal du compte, et la titulaire est prévenue par e-mail, une fois par jour et par clé (testé).
  - **Limite du jour** : une réponse sans rapport (défi ou clé d'ailleurs) n'y compte plus. Un voleur de cookie ne peut donc plus bloquer les confirmations de la titulaire avec des réponses bidon. Seules les signatures fausses comptent (testé).
  - **Journal du serveur** : le message d'erreur, qui peut reprendre l'origine envoyée par le client, est nettoyé des caractères de contrôle.
  - **Fenêtre** :
    - Échap pendant l'invite de la clé ne peut plus fermer la fenêtre puis la « confirmer » ;
    - compte « clé d'accès seule » sur un appareil sans clé utilisable : ni champ de mot de passe ni bouton (le serveur le refuserait), focus sur « Se reconnecter » (vérifié dans Chromium) ;
    - le message « confirmez votre identité » mentionne la clé d'accès.
  - Non corrigé, noté : la confirmation par mot de passe partage toujours la limite du jour (30 échecs). Un voleur de cookie qui tape de faux mots de passe peut donc bloquer pour la journée la confirmation par mot de passe. La clé d'accès compte à part pour les réponses sans rapport.

### Cycle 69 (16 h 45) : session fermée après 5 essais refusés (chantier 64)

La relecture du chantier 63 laissait un défaut. Un voleur de cookie qui tapait de faux mots de passe dans les écrans qui les redemandent (confirmation d'identité, suppression du compte, export complet, gestion des clés d'accès et de la double authentification, changement de mot de passe) épuisait les compteurs du compte. Il bloquait ainsi la titulaire pendant un quart d'heure, et pouvait recommencer à volonté.

- **Correction d'un commentaire** : la limite de 30 confirmations refusées était dite « par jour ». Elle est en réalité par quart d'heure (le compteur des échecs repart après 15 minutes). Commentaire corrigé.
- **Compteur par session** : y sont comptés les mots de passe refusés dans les 10 écrans qui le redemandent, ainsi que les codes et signatures de clé d'accès refusés dans la confirmation d'identité. Les codes refusés sur les autres écrans (ajout d'une clé, désactivation de la double authentification, export) gardent leur propre limite et ne comptent pas ici. La page de connexion a son propre compteur.
- **Au 5e refus** :
  - la session est fermée ;
  - l'événement va au journal du compte ;
  - la titulaire reçoit un e-mail (« si c'était vous, reconnectez-vous ; sinon, changez votre mot de passe ») ;
  - la réponse porte le code `session_fermee`, et l'application renvoie à la connexion après 4 secondes, le message restant lisible.
- **Remise à zéro** : une confirmation réussie remet le compteur à zéro.
- **Effet visé** : un voleur n'a plus que 5 essais par cookie volé. Les réponses sans rapport à la confirmation par clé d'accès (défi ou clé d'ailleurs) ne comptent toujours pas.
- **Tests** :
  - essais répartis entre trois routes : comptés ensemble ;
  - une réussite remet le compteur à zéro ;
  - au 5e refus : session fermée, les autres sessions restent, e-mail et journal ;
  - l'ancien test de la suppression du compte (limite atteinte en moins de 1001 essais) vérifie maintenant la fermeture au 5e.
- 226 tests sur 226, parcours de bout en bout 57/57, fuzzing sans anomalie.
- **Relecture indépendante**, constats corrigés :
  - **Moyen** : le compteur ne montait qu'après le calcul du mot de passe (asynchrone). Des requêtes parallèles passaient donc toutes, environ 10 essais au lieu de 5, et la limite du compte (10 mots de passe par quart d'heure) restait atteignable avec un seul cookie. L'essai est maintenant réservé avant le calcul, par une mise à jour atomique qui refuse au-delà de 5, puis rendu si le mot de passe est juste. Testé avec 12 requêtes simultanées : au plus 5 calculées, les autres refusées d'emblée. Avec la limite du compte à 10, deux cookies volés restent nécessaires pour la bloquer un quart d'heure ; l'affirmation « 6 sessions volées » a été retirée.
  - **Moyen** : l'appareil de la session fermée restait « reconnu », donc soumis aux limites assouplies de connexion. Il est maintenant oublié, comme à une déconnexion à distance (testé).
  - **Bas à moyen** : en s'inscrivant avec l'adresse d'autrui, on pouvait lui envoyer environ 190 e-mails « session fermée » par jour. Il n'en part plus qu'un toutes les 6 heures, et seulement à une adresse confirmée (testé). Une seule fermeture par session, même si plusieurs requêtes échouent ensemble.
  - **Bas** : la documentation disait que tous les codes refusés comptaient ; elle est corrigée (voir plus haut).
  - **Bas** : l'export complet, qui n'utilise pas le client commun, renvoie maintenant aussi à la connexion.
- Après corrections : 227 tests sur 227, parcours de bout en bout 57/57.
- **Vérification complète** :
  - premier passage (avant corrections) : 7 étapes sur 7 ;
  - deuxième passage, sur le code final : 6 sur 7. Le parcours « espace marchand au clavier » a échoué une fois, sans que le vérificateur affiche la cause (il ne gardait que les lignes à mots-clés). Relancé seul trois fois, il réussit sans aucun problème. Échec intermittent, cause non établie ;
  - le vérificateur affiche désormais la liste complète des problèmes d'un parcours au clavier ;
  - troisième passage : 7 étapes sur 7.

### Cycle 70 (17 h 30) : session liée à son appareil (chantier 65)

Le vol de cookie de session (logiciel espion qui vide les profils de navigateur, ordinateur partagé) est aujourd'hui la manière la plus courante de prendre un compte protégé par double authentification : le cookie suffit, sans mot de passe ni code. Désormais :

- **Comparaison à chaque requête** : la session garde la description de l'appareil où elle a été ouverte (famille du navigateur et du système, déjà affichée dans la liste des appareils). À chaque requête authentifiée (espace marchand, état de session, console de l'exploitant), elle est comparée à l'appareil courant.
- **Si elle diffère** :
  - la session est fermée pour tout le monde, navigateur d'origine compris ;
  - l'appareil n'est plus « reconnu » ;
  - l'événement va au journal du compte ;
  - la titulaire est prévenue par e-mail : au plus un toutes les 6 heures, seulement à une adresse confirmée.
- **Faux positifs évités** :
  - les versions ne comptent pas (mise à jour du navigateur) ;
  - iPad et Mac sont confondus (Safari sur iPad se présente parfois comme un Mac) ;
  - les sessions d'avant la règle reçoivent leur appareil au premier passage.
- **Limite, écrite dans la documentation** : un voleur qui recopie aussi l'en-tête User-Agent passe. C'est une barrière contre le rejeu naïf, pas une preuve d'appareil. La liaison cryptographique de la session à l'appareil (DBSC) n'est pas encore disponible partout dans les navigateurs.
- **Tests** :
  - mise à jour de Chrome : la session continue ;
  - cookie rejoué sous Firefox/Windows : refusé, session fermée, e-mail et journal ;
  - iPad et Mac : tolérés ;
  - autre navigateur sur le même système : refusé, sans second e-mail ;
  - session ancienne : appareil noté au premier passage.
- 228 tests sur 228, parcours de bout en bout 57/57, parcours marchand au clavier sans problème.
- **Relecture indépendante** : rien ne contourne la vérification. Un tiers sans cookie ne peut ni fermer une session ni multiplier les e-mails, et l'ordre des contrôles est correct. Deux faux positifs graves ont été trouvés et corrigés :
  - **Grave** : l'app installée sur l'écran d'accueil d'un iPhone ou d'un iPad (mode autonome, nécessaire aux notifications sur iOS) n'annonce pas « Safari ». Un marchand connecté dans Safari, puis passé à l'app (iOS 17 y recopie les cookies), était déconnecté et recevait l'alerte « cookie copié ». Correction : entre deux appareils iOS, seul le système compte, puisque tous les navigateurs iOS reposent sur le même moteur. Entre un iPad et un « Mac » à moteur Safari (iPad en mode ordinateur), même tolérance. En revanche, une session d'iPad rejouée dans Chrome sur un vrai Mac reste refusée, et entre deux Mac le navigateur compte toujours (testé).
  - **Grave** : la « version pour ordinateur » des navigateurs Android, activée par défaut sur les tablettes, se présente comme Linux. Android et Linux sont maintenant confondus, le navigateur comptant toujours (testé : Chrome Android en mode ordinateur toléré, Firefox Android refusé).
  - **Bas, accepté et documenté** : l'émulation d'un téléphone dans les outils de développement ferme la session ; il suffit de se reconnecter.
- Après corrections : 228 tests sur 228, parcours de bout en bout 57/57.

### Cycle 71 (18 h 10) : relecture adversariale croisée des chantiers 62 à 65 (chantier 66)

Chaque nouveauté de l'après-midi avait été relue seule. Une relecture indépendante a cherché ce qui casse quand elles se combinent, et a trouvé un trou grave, reproduit avant correction :

- **Grave : l'intrus reprenait le compte après l'annulation.** Pendant la période où l'adresse du compte était la sienne, il demandait « mot de passe oublié » et recevait un lien. L'annulation ne supprimait pas ce lien. L'intrus choisissait alors un nouveau mot de passe, rouvrait une session, et pouvait même relancer un changement d'adresse, l'ancienne n'étant plus réservée. Corrections :
  - l'annulation supprime tous les liens de réinitialisation en cours avant d'envoyer celui de la titulaire ;
  - défense en profondeur : chaque lien garde l'adresse à laquelle il a été envoyé, et un lien dont l'adresse n'est plus celle du compte est refusé (anciens liens sans adresse : acceptés jusqu'à leur expiration, une heure).
  - Testé avec le scénario exact de la relecture.
- **Bas à moyen : compte « clé d'accès seule » sans clé.** Si l'intrus avait supprimé les clés de la titulaire, l'annulation pouvait laisser l'option active sans aucune clé : la titulaire passait alors par 72 heures de récupération différée. L'option est retirée quand il ne reste aucune clé. L'e-mail d'annulation d'un compte qui a encore ses clés dit maintenant de se reconnecter avec elles, et prévient que le lien de mot de passe lance la récupération différée qui les supprime (testé).
- **Bas à moyen : codes refusés hors confirmation.** Sur les écrans qui redemandent le code de double authentification (codes de secours, désactivation, ajout ou suppression de clé, « clé d'accès seule », export), les codes refusés comptaient dans une limite propre au compte, mais pas dans le compteur de session. Un voleur de cookie qui connaissait le mot de passe pouvait donc bloquer à volonté la confirmation par code de la titulaire. Corrections :
  - cette limite est désormais propre à chaque session ;
  - un code refusé (non vide) compte dans le compteur de session, qui ferme la session au 5e ;
  - testé : la session de l'intrus est fermée, celle de la titulaire n'est pas bloquée ;
  - l'ancien test de la désactivation, qui attendait le blocage au 6e code, attend maintenant la fermeture au 5e.
- **Vérifié sans problème par la relecture** :
  - l'annulation et la confirmation par lien n'exigent aucune session, donc ni les fermetures de session ni la liaison à l'appareil ne peuvent empêcher la titulaire d'annuler à temps ;
  - les limites des différentes fonctions ne se mélangent pas ;
  - les membres d'équipe ne sont pas touchés.
- **Risque résiduel, noté** : une clé d'accès ou une double authentification installée par l'intrus plus de 24 heures avant sa demande survit à l'annulation. L'e-mail d'annulation invite désormais à vérifier les clés d'accès, la double authentification, les clés d'API et les webhooks.
- 229 tests sur 229, parcours de bout en bout 57/57.

