# Journal de la deuxième nuit (11 au 12 novembre 2026)

Demande : jusqu'à 7 h 00 (heure de Lausanne), pousser le code, renforcer la sécurité et ajouter des fonctions technologiques qui démarquent Comptoir. Chaque chantier est implémenté avec ses tests, vérifié par les simulations, relu par une relecture indépendante, puis commité et poussé.

## Chantiers prévus

1. **Sécurité des comptes marchands** : double authentification (TOTP, codes de secours), appareils connectés révocables, journal d'activité, alerte de nouvelle connexion.
2. **QR-facture suisse** sur les factures des boutiques suisses (norme SIX), avec l'IBAN ou le QR-IBAN du marchand.
3. **API et webhooks pour les marchands** : clés d'API à portée limitée et webhooks sortants signés (intégrations, Zapier, comptabilité).
4. **Tableau de bord en temps réel** (nouvelles commandes sans recharger) et application installable (PWA).
5. **Performance** : mise en cache HTTP (ETag), compression, images optimisées dès l'envoi.
6. **Renforcement** : en-têtes de sécurité, politique de mots de passe (mots de passe compromis), audit des points d'entrée.

## Cycles

### Cycle 1 — Sécurité des comptes marchands (23 h 35 – 23 h 48)

- **Double authentification (TOTP)**, codée sans aucune bibliothèque (RFC 6238, vérifiée par les vecteurs de test officiels). Elle fonctionne avec Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden et Proton Pass.
  - Mise en place par QR code ; le mot de passe et un premier code sont exigés.
  - Le secret est chiffré en base (AES-256-GCM). La clé peut être gardée hors de la base (`SECRET_CHIFFREMENT`).
  - Un code déjà utilisé ne peut pas resservir.
  - Après 5 codes faux, le compte est bloqué 15 minutes.
  - La connexion se fait en deux temps : le mot de passe donne un « défi » signé, valable 5 minutes et lié au mot de passe actuel, et aucune session n'est ouverte avant le second facteur.
- **10 codes de secours** à usage unique, gardés en empreinte seulement, affichés une seule fois et téléchargeables.
- **Appareils connectés** : navigateur, système, réseau et dernière activité. Chaque appareil peut être déconnecté à distance.
- **Journal d'activité du compte** : connexions, codes refusés, codes de secours utilisés, activation ou désactivation, mot de passe, déconnexions.
- **Alerte e-mail** à chaque connexion depuis un nouvel appareil, et à chaque activation ou désactivation de la double authentification.
- **Faille fermée en passant** : un lien de réinitialisation du mot de passe connectait directement le marchand. Avec la double authentification, un accès à sa boîte e-mail aurait donc suffi. Ce n'est plus le cas.
- **Interface** : nouvelle section Paramètres > Sécurité, et étape « code de vérification » à la connexion.
- **Vérifié** : tests `totp.test.js` (RFC) et `securite.test.js` (parcours complet), plus un parcours dans un vrai navigateur (QR scanné, codes de secours, connexion depuis un autre appareil avec le code). 72 tests.

**Relecture indépendante du cycle 1.** Aucun contournement possible de la double authentification. Neuf faiblesses ont été trouvées et corrigées :
1. **Blocage du propriétaire.** Quelqu'un qui connaît le mot de passe pouvait bloquer le vrai propriétaire en ratant volontairement le code. Les limites comptent maintenant par réseau, avec une limite globale qui ne s'applique pas à un appareil déjà connu. Le propriétaire est prévenu par e-mail quand des codes sont refusés (son mot de passe a fuité).
2. **Désactivation.** Les essais de code y sont maintenant comptés (une session volée ne peut plus deviner le code).
3. **Codes de secours.**
   - Ils sont acceptés pour désactiver.
   - On peut en obtenir de nouveaux, mot de passe et code exigés ; les anciens cessent alors de fonctionner.
4. **Autres appareils.** L'activation de la double authentification déconnecte les autres appareils.
5. **Bibliothèque QR.** Celle chargée depuis un CDN externe est remplacée par une copie locale (licence MIT), plus aucun code externe sur la page qui montre le secret.
6. **Écran de code.**
   - Les lettres sont maintenant possibles (codes de secours).
   - Un défi expiré ramène au mot de passe.
   - Le curseur revient dans le champ après une erreur.
7. **Erreur de chargement.** Elle n'entraîne plus de boucle de requêtes ; un bouton « Réessayer » s'affiche.
8. **Journal d'activité.** Il est conservé 12 mois.

### Cycle 2 — QR-facture suisse et rapprochement bancaire automatique (23 h 48 – 23 h 56)

En Suisse, le paiement sur facture est très répandu. Comptoir le propose maintenant aux boutiques suisses, de bout en bout :
- **QR-facture conforme à la norme SIX** (Swiss Payment Standards, QR-bill 2.3) : récépissé et section paiement au format A4 (62 mm + 148 mm), QR code avec la croix suisse, adresses structurées.
  - Avec un QR-IBAN, la référence est une **référence QR** (QRR, modulo 10 récursif).
  - Avec un IBAN ordinaire, c'est une **référence créancier ISO 11649** (RF…).
  - Les deux algorithmes sont vérifiés par les exemples officiels de la norme et de l'ISO, et l'IBAN est contrôlé (modulo 97).
- **Côté client** : à la caisse, le choix « Facture QR, payable sous N jours ». La facture s'ouvre tout de suite, imprimable en PDF, et arrive aussi par e-mail. La commande part dès réception du paiement.
- **Côté marchand** (Paramètres > Paiements) : IBAN ou QR-IBAN contrôlé, délai de paiement de 10 à 60 jours, activation. Chaque commande concernée affiche sa référence, son échéance et un lien vers sa facture.
- **Rapprochement bancaire automatique** : le marchand importe le relevé **camt.054** (format ISO 20022 de toutes les banques suisses), et chaque paiement reconnu passe la commande en « payée ».
  - Le stock est retiré et le client est prévenu.
  - Le rapport distingue les factures payées, les paiements déjà enregistrés, les montants insuffisants et les paiements inconnus.
  - Importer deux fois le même relevé ne double rien.
- **Facturation**
  - La facture est numérotée dès l'émission.
  - Une commande facturée puis annulée reçoit un avoir.
  - Ces commandes ne reçoivent pas les relances de « panier abandonné ».
- **Sécurité au passage**
  - La bibliothèque QR est maintenant locale, ce qui permet de retirer le CDN externe de la politique de sécurité (`script-src 'self'` seulement).
  - La page de facture ne contient aucun script.
- **Tests :** `qrfacture.test.js` couvre la norme, la commande, la facture protégée par jeton, et le relevé camt.054 (paiement reconnu, inconnu, débit ignoré, import en double). Le parcours a aussi été joué dans un vrai navigateur. 76 tests.
- **Limite honnête :** je n'ai pas pu faire lire le QR code par une application bancaire ni par un lecteur indépendant (l'outil de décodage téléchargé a été refusé, car c'est du code externe). À faire avec une vraie application bancaire avant d'ouvrir.

## Cycle 3 (00 h 00) : corrections de la revue QR-facture

La revue indépendante a relevé 10 points. Tous sont corrigés :
- Import du relevé bancaire réécrit : lecture linéaire du fichier (un fichier piégé ne bloque plus le serveur), préfixes d'espace de noms acceptés, camt.053 aussi.
- Seules les écritures comptabilisées (BOOK), au crédit, non contrepassées et en CHF comptent.
- Chaque transaction est mémorisée. Un relevé importé deux fois ne double rien, et un vrai second versement est signalé « à rembourser ». Un trop-perçu est signalé aussi.
- Un paiement reçu par le relevé déclenche désormais tout ce que déclenche un paiement en ligne : facture, stock, alerte de rupture, e-mails au client et au marchand, transmission au fournisseur. Le code est partagé (`marquerPayee` et `apresPaiement`).
- Adresse : la rue est retrouvée même quand le nom de l'entreprise précède l'adresse. NPA et localité sont exigés avant d'activer la facture QR.
- La boutique ne propose plus « Carte » quand les paiements en ligne ne sont pas activés.
- Une facture annulée ou remboursée affiche « Annulée : avoir AV-… » au lieu de « Payée ».
- QR code limité à la version 25, comme le veut la norme. Montant hors bornes laissé vide.
- Mise en page plus fidèle à la norme : tailles de police, mention « À détacher », cadre « Payable par » quand l'adresse manque.
- Limite : le QR code n'a pas été relu par un lecteur indépendant. Le décodeur externe a été refusé par la politique de sécurité de la session. À tester avec une application bancaire avant la mise en production.

## Cycle 4 (00 h 10) : écran Intégrations, documentation de l'API

- Nouvel écran **Paramètres > Intégrations**, pour la formule Croissance :
  - créer une clé d'API avec ses permissions (clé affichée une seule fois, bouton Copier) et la révoquer ;
  - ajouter un webhook en choisissant ses événements, voir les 5 derniers envois (reçu, nouvel essai, abandonné, code HTTP), envoyer un test, réactiver un webhook en pause, le supprimer.
- Vérifié dans un vrai navigateur : la clé créée à l'écran fonctionne sur `/api/v1`, et une adresse interne est refusée.
- `docs/API.md`, servi à `/docs/API.md` : authentification, permissions, points d'accès, format des commandes, webhooks, vérification de la signature (exemple Node), nouveaux essais, données personnelles.
- Tarifs (accueil, parcours) : « API et webhooks » ajouté à Croissance.
- Honnêteté : le badge « Le plus choisi » devient « Conseillé pour démarrer ». Il n'y a encore aucun client, donc l'affirmation était fausse.
- Le message après l'import d'un relevé bancaire signale les doublons à rembourser, les trop-perçus et les versements dans une autre devise.

## Cycle 5 (00 h 15) : politique de mot de passe

- Les mots de passe trop courants sont refusés, à l'inscription, à la réinitialisation et au changement de mot de passe. Sont concernés :
  - les mots de passe des listes de fuites publiques, avec leurs variantes (« Lausanne2024 », « azerty123! ») ;
  - les suites et les répétitions ;
  - les mots de passe qui reprennent l'e-mail ou le nom de la boutique.
- Les messages en français expliquent pourquoi et conseillent une phrase de quelques mots (recommandation NIST SP 800-63B).
- En production, les mots de passe déjà parus dans une fuite de données sont refusés (Have I Been Pwned). Seuls 5 caractères de l'empreinte SHA-1 quittent le serveur (anonymat k), jamais le mot de passe. Si le service ne répond pas, l'inscription n'est pas bloquée. Réglage : `VERIFIER_FUITES`.
- En-tête `Cross-Origin-Opener-Policy: same-origin` ajouté.
- Tests : 80 sur 80.

## Cycle 6 (00 h 20) : corrections de la revue API et webhooks

La revue indépendante a relevé 11 points. Tous sont corrigés :
1. **File des webhooks partagée** (critique) : 30 envois en attente vers un webhook en pause bloquaient tous les webhooks de toutes les boutiques. Désormais :
   - la file est lue webhook par webhook, 5 envois au plus par passage ;
   - 10 adresses sont traitées en parallèle ;
   - l'envoi s'arrête au premier échec d'une adresse ;
   - un webhook en pause est exclu de l'envoi.
2. **Pause trop rapide et événements perdus** : la pause n'intervient plus qu'après 3 jours sans aucune réponse réussie. Pendant la pause, les événements restent en file et repartent à la réactivation. La file est bornée à 5000 envois par webhook. Les nouveaux essais durent environ 40 heures, et la documentation dit maintenant la vérité.
3. **DNS rebinding** : la connexion part vers l'adresse vérifiée. La résolution DNS se fait une seule fois, contrôle compris (`lookup` contrôlé). Un test le prouve.
4. **Formes d'adresses** : IPv4 dans IPv6 (`::ffff:7f00:1`), NAT64, 6to4, Teredo, `fec0::/10` et `198.18/15` sont refusés. Les adresses IPv6 entre crochets sont acceptées.
5. **Pagination** : curseur `apres` = (date, numéro), sans commande sautée à la même milliseconde. Avec `tri=modification`, une intégration voit passer chaque changement de statut (nouvelle colonne `maj_le`).
6. **Changement de formule ou fin d'abonnement** : plus aucun événement ne sort. Le marchand peut toujours révoquer ses clés et supprimer ses webhooks, même en lecture seule.
7. **Données personnelles** :
   - nom, e-mail et adresse du client sont masqués sans la permission `clients:lecture` ;
   - les paniers abandonnés ne sont plus listés par défaut ;
   - effacer un client (RGPD) purge aussi les envois gardés en file.
8. **Bouton de test** : l'envoi est immédiat, vers la boutique seulement, hors file et hors compteur. Il est limité à 5 par minute et affiche la réponse reçue.
9. **Événements manquants** : `commande.retiree` est émis pour les ventes à la caisse, et `produit.rupture` pour tout passage du stock à zéro (caisse, paiement manuel, API).
10. **Validation** : `actif` doit être un vrai booléen, le stock un entier, le prix un nombre positif.
11. **Divers** :
    - la réponse du point d'arrivée est lue et limitée à 64 Ko ;
    - limite de 600 requêtes par minute par boutique ;
    - les clés refusées sont limitées par adresse IP ;
    - une URL trop longue est refusée au lieu d'être tronquée ;
    - la documentation précise les doublons et l'ordre des événements.

Tests : 83 sur 83, dont 4 nouveaux (isolation de la file, pause, DNS rebinding, formes IPv6). Écran Intégrations ajusté : état « ne répond plus depuis… », réactivation avec le nombre d'événements en attente, intégrations inactives encore supprimables.

## Cycle 7 (00 h 25) : tableau de bord en direct

- Flux en direct (Server-Sent Events, `/api/admin/flux`). Le serveur compare l'état de chaque boutique suivie toutes les 2 secondes et prévient l'onglet dès qu'une commande arrive ou change.
- Avant, l'onglet interrogeait le serveur toutes les 15 secondes. Cette interrogation reste en secours si un proxy coupe le flux.
- Côté marchand, à chaque nouvelle commande payée :
  - un message « Nouvelle commande n° 1001 : CHF 47.00 » ;
  - le compteur dans le titre de l'onglet, « (2) Comptoir », si l'onglet est en arrière-plan ;
  - une notification du navigateur, si elle est autorisée.
- Pas de rechargement pendant une saisie (fiche produit, éditeur) : la mise à jour attend la fin.
- Sécurité :
  - le flux exige une session ;
  - il est contrôlé toutes les 30 secondes et se ferme si l'appareil est déconnecté à distance ;
  - 8 onglets en direct au plus par compte.
- Vérifié dans un vrai navigateur : une commande payée sur la boutique s'affiche chez le marchand en 1,5 seconde. Test automatique ajouté : 84 tests sur 84.

## Cycle 8 (00 h 35) : application installable, notifications, performance

- **Application installable (PWA)** :
  - manifeste, icônes (dont une icône « masquable » pour Android), raccourcis Commandes et Produits ;
  - service worker limité à `/app`, qui prend toujours le réseau d'abord : la dernière version en ligne est servie. La copie locale ne sert qu'hors connexion : l'application s'ouvre au lieu d'une page d'erreur.
  - Les appels à l'API ne sont jamais mis en cache : aucune donnée de la boutique ne reste sur l'appareil.
- **Notifications** : nouvelle carte « Notifications sur cet appareil » dans Paramètres > E-mails. L'autorisation n'est demandée qu'au clic. La notification passe par le service worker, ce qui la fait marcher sur Android, et un clic ramène sur les commandes.
- **Performance des fichiers statiques** :
  - ETag par fichier : un rechargement reçoit 304 et ne retélécharge rien qui n'ait changé ;
  - compression Brotli, sinon gzip, faite une seule fois et gardée en mémoire. Avant, gzip était recalculé à chaque requête.
- Vérifié dans un vrai navigateur : service worker actif, manifeste lu, application ouverte hors connexion, 304 sur un fichier inchangé, Brotli servi.

## Cycle 9 (00 h 35) : clés d'accès (passkeys)

- Connexion **sans mot de passe** avec une clé d'accès : visage, empreinte ou code de l'appareil (Face ID, Touch ID, Windows Hello, Android). La norme est W3C WebAuthn, implémentée sans dépendance dans `server/src/webauthn.js` :
  - lecture CBOR bornée ;
  - clés ES256 et RS256 ;
  - vérification du domaine, de l'origine (un faux site ne peut rien en faire), de la présence et de la vérification de l'utilisateur ;
  - défi à usage unique, valable 5 minutes ;
  - détection d'une clé clonée par le compteur.
- Paramètres > Sécurité, nouvelle carte « Clés d'accès » : ajouter une clé (mot de passe exigé), la nommer, voir sa dernière utilisation, la supprimer (mot de passe exigé). Un e-mail prévient à chaque ajout, et le journal du compte garde la trace.
- Écran de connexion : bouton « Se connecter avec une clé d'accès », sans saisir d'e-mail (clé découvrable).
- Tests :
  - automatiques, avec un authentificateur logiciel : enregistrement, connexion, rejeu refusé, faux site refusé, mauvaise clé refusée, clé clonée refusée, entrées CBOR piégées ;
  - dans un vrai Chromium, avec l'authentificateur virtuel du navigateur : clé créée depuis Paramètres, puis connexion sans mot de passe réussie.
- Tests : 86 sur 86.

## Cycle 10 (00 h 40) : corrections de la seconde revue (relevé bancaire, direct, PWA)

Une revue indépendante des cycles 3 à 8 a relevé 15 points. Tous sont corrigés :
- **Relevé bancaire** :
  - Clé de déduplication : identifiant bancaire de la transaction (`NOTPROVIDED` ignoré), plus la référence et le montant. Sans cela, deux paiements sans identifiant se confondaient et le second était perdu.
  - Les frais (`Chrgs`), le détail des montants et les parties sont mis de côté. Avant, un crédit avec frais était lu comme un débit.
  - Le montant est lu dans `AmtDtls/TxAmt` (camt.054 version 2). Avant, il valait 0. Un montant illisible n'est plus mémorisé, et un import suivant peut le reprendre.
  - Les commandes sont lues une seule fois par import. Avant, la base entière était parcourue à chaque écriture, ce qui pouvait bloquer le serveur plusieurs minutes.
  - Les versements partiels s'additionnent.
  - La même transaction importée en camt.053 puis en camt.054 n'est plus signalée comme un doublon à rembourser.
  - Les commentaires XML et les balises auto-fermantes sont ignorés.
  - Une erreur d'envoi d'e-mail ou de transmission sur une commande n'arrête plus les autres.
- **Tableau de bord en direct** :
  - Au repos, rien n'est lu (compteur d'écritures de la base). Sinon, la signature n'est lue que dans les index, sans JSON ni regroupement : le coût ne grandit plus avec le nombre de commandes.
  - Plus de fausse alerte « Nouvelle commande » quand une commande est retirée ou modifiée : seul un paiement client (`payeLe`) déclenche la notification, et les numéros déjà notifiés sont gardés hors de l'état rechargé.
  - Si un proxy retient le flux, l'onglet revient à l'interrogation régulière après 10 secondes.
  - Le flux se ferme aussi quand l'abonnement prend fin.
- **Application installée hors connexion** : un message « Pas de connexion » s'affiche, avec rechargement automatique au retour du réseau. Avant, elle affichait la démo ou l'inscription.
- **ETag** : une étiquette distincte par encodage (Brotli, gzip, sans compression).
- **Réinitialisation du mot de passe** : la même politique qu'ailleurs s'applique, y compris le refus d'un mot de passe qui reprend l'e-mail.
- Tests : 86 sur 86. Le test du relevé couvre maintenant tous les cas de la revue.

## Cycle 11 (00 h 45) : score de risque des commandes (anti-fraude)

- Chaque commande en ligne reçoit un score de risque de 0 à 100 (`server/src/risque.js`). Les règles sont explicables : chaque point vient avec sa raison, en clair. Signaux pris en compte :
  - adresse e-mail jetable ou générée ;
  - nom incohérent ;
  - rafale de commandes depuis le même réseau ou la même adresse (cartes testées l'une après l'autre) ;
  - quantités de revente ;
  - montant très supérieur au panier moyen de la boutique ;
  - premier achat d'un montant élevé ;
  - livraison hors du pays.
- Un client ayant déjà payé atténue le score.
- Le score ne bloque jamais une vente. Quand il est **élevé** :
  - la transmission automatique au fournisseur (dropshipping) est retenue : le marchand ne paie pas un fournisseur avant un litige bancaire possible ;
  - l'e-mail « Nouvelle commande » l'explique ;
  - la commande porte la mention « Risque » dans la liste, et un encadré dans le détail donne les raisons et ce qu'il faut faire.
- Protection des données : aucune adresse IP n'est gardée dans la commande. Les compteurs de rafale restent en mémoire, sur 24 heures au plus.
- Tests : règles, et parcours complet (commande suspecte payée, transmission retenue, marchand prévenu). 88 tests sur 88.
- Simulation de 30 marchands sur 20 jours : 0 anomalie, aucune fausse alerte bloquante. Une simulation complète est en cours. Le simulateur gardait les connexions inactives trop peu longtemps lors de ses longues vérifications : corrigé.

## Cycle 12 (01 h 00) : audit de sécurité (clés d'accès et surface publique), prévision de rupture

Un audit indépendant a examiné les clés d'accès et toutes les routes publiques. Ses 7 points sont corrigés :
1. **Grave : mode de livraison pris dans le prototype.** Une commande envoyée avec `livraison: "toString"` passait le contrôle, et son montant devenait vide. Sur facture QR, un virement de CHF 0.01 suffisait alors à la marquer payée. Corrections :
   - modes de livraison sans prototype, et `Object.hasOwn` ;
   - total refusé s'il n'est pas un nombre positif ;
   - l'import du relevé refuse une commande au montant invalide.
2. **Clés d'accès** :
   - avec la double authentification active, ajouter une clé exige aussi le code ;
   - une réinitialisation du mot de passe par e-mail retire toutes les clés d'accès : une clé ajoutée par un tiers ne survit pas ;
   - supprimer une clé déconnecte les appareils connectés avec elle.
3. **Newsletter** : la confirmation d'inscription utilise désormais son propre jeton, aléatoire, à usage unique, valable 7 jours et gardé en empreinte. Avant, le jeton de désinscription servait aussi, si bien que le marchand pouvait inscrire ou réinscrire n'importe qui. Les liens personnels sont aussi masqués dans la liste des e-mails visible par le marchand.
4. **Commandes sur facture** : limites plus serrées, car un numéro de facture et un e-mail partent tout de suite. Il y en a trois : 5 par heure et par réseau, 3 par jour et par adresse, 200 par jour et par boutique.
5. **Nom de boutique contenant `$'`** : la page de la boutique n'est plus corrompue (remplacement par fonction).
6. **Webhook fournisseur** : il ne peut plus agir que sur les commandes transmises à ce même fournisseur.
7. **Divers** : clé de démonstration comparée en temps constant, et plafond quotidien des événements statistiques par boutique.

Le reste a été vérifié et jugé solide : WebAuthn conforme, signatures Stripe, jetons des factures et du suivi, prix recalculés côté serveur, fichiers statiques, protection contre le CSRF.

**Prévision de rupture** : le rythme de vente des 28 derniers jours donne le nombre de jours de stock restant (« ≈ 12 j » dans Produits). Le tableau de bord signale les ruptures prévues sous 14 jours, avec la quantité à commander pour tenir 30 jours. Aucune prévision n'est faite sous 2 ventes, pour rester honnête.

Simulation complète (100 marchands, 60 jours) avec le score de risque : 0 anomalie. Tests : 88 sur 88.

## Cycle 13 (01 h 05) : boutique en allemand, italien et anglais

- Constat honnête : le marchand pouvait cocher « Deutsch », « Italiano » et « English » dans l'éditeur, mais la boutique les ignorait. C'est corrigé.
- `js/traductions.js` traduit l'interface de la boutique : en-tête, boutons, panier, barre de livraison offerte, offres, modes de livraison et dates (« Lieferung zwischen Mo. 16. Nov. und Di. 17. Nov. »), formulaire de commande, paiement, facture QR, suivi de commande, avis, newsletter, bandeau cookies et messages d'erreur.
- **Choix de la langue** : paramètre `?lang=`, sinon choix mémorisé, sinon langue du navigateur parmi celles cochées, sinon français. Un sélecteur apparaît dans l'en-tête dès que la boutique propose plusieurs langues. L'attribut `lang` de la page est mis à jour, ce qui compte pour l'accessibilité et le référencement.
- **Jamais traduits** : le nom de la boutique, les noms et descriptions des produits, et les noms des transporteurs.
- **Conditions générales et mentions légales** : elles restent en français, avec une note dans la langue du client (« la version française fait foi »).
- **Principe** : correspondance exacte, puis modèles pour les phrases avec montants et dates. Un texte inconnu reste en français : rien n'est inventé.
- L'éditeur explique précisément ce qui est traduit et ce qui ne l'est pas.
- Vérifié dans un vrai navigateur, en allemand (navigateur `de-CH`) puis en italien (sélecteur) : panier et commande entièrement traduits. Restent en français les noms de transporteurs « La Poste », ce qui est voulu.
- **E-mails aux clients** : la commande garde la langue dans laquelle elle a été passée. Les e-mails de confirmation, d'expédition (avec le lien de suivi) et de facture QR partent dans cette langue (`server/src/emails-clients.js`). Le droit de rétractation (France, Belgique) reste en français, annoncé dans la langue du client. Une langue que la boutique ne propose pas retombe sur le français. Testé.
- **Limites** : la page sans JavaScript, les relances et les e-mails marketing restent en français.

## Cycle 14 (01 h 10) : rapport du lundi

- Chaque lundi dès 7 h, heure de la boutique, le marchand reçoit un e-mail qui résume sa semaine :
  - chiffre d'affaires, comparé à la semaine d'avant ;
  - nombre de commandes et panier moyen ;
  - trois meilleurs produits ;
  - à faire : commandes à expédier, factures QR échues non payées (avec les numéros), commandes à risque de fraude à vérifier, ruptures prévues sous 14 jours.
- Pas d'e-mail vide : rien ne part à une boutique sans commande depuis deux semaines.
- Un seul envoi par semaine (table `rapports_hebdo`). Le rapport se désactive dans Paramètres > E-mails (« Rapport du lundi »).
- Test : 3 commandes la semaine passée, rapport envoyé une seule fois avec les bons chiffres, sans « undefined » ni « NaN ». 90 tests sur 90.

## Cycle 15 (01 h 15) : sauvegardes chiffrées, vérification d'accessibilité

- **Sauvegardes chiffrées** (`server/src/sauvegarde.js`) : avec `SAUVEGARDE_CLE`, chaque copie quotidienne est chiffrée en flux (AES-256-GCM), puis la version en clair est effacée. Une copie envoyée hors du serveur est illisible sans la clé ; une copie modifiée ou abîmée est refusée.
- Restauration : `node server/server.js --restaurer fichier.db.enc nouvelle.db`. Elle n'écrase jamais un fichier existant et ne laisse rien derrière elle en cas d'échec.
- Testé : aller-retour, mauvaise clé, octet modifié, restauration par la commande.
- La vérification de mise en ligne signale l'absence de `SAUVEGARDE_CLE`, et le guide l'explique.
- **Accessibilité** : vérification automatique sur 6 écrans de l'espace marchand, la boutique et le panier (images sans texte, boutons ou liens sans nom, champs sans étiquette, identifiants en double, langue de la page) : aucun problème trouvé.

## Cycle 16 (01 h 25) : recherche instantanée dans la boutique

- Dès 8 produits, la vitrine propose un champ « Rechercher un produit ». Les résultats s'affichent pendant la frappe, avec le nombre trouvé, et le champ garde le curseur.
- La recherche ignore les accents et les majuscules : « gres » trouve « Vase en grès ». Elle tolère une faute de frappe dans les mots de 4 lettres ou plus. Elle porte sur le nom, la catégorie et la description.
- La recherche est traduite (allemand, italien, anglais), et le message « Aucun produit ne correspond à … » l'est aussi.
- Vérifié dans un vrai navigateur avec 10 produits.

## Cycle 17 (01 h 20) : corrections de la troisième revue (score de risque, prévision, traductions)

Une revue indépendante des cycles 11 à 14 a relevé 16 points. Corrigés :
- **Score de risque** :
  - Un vrai client qui réessayait son paiement 4 fois passait en « risque élevé ». Les compteurs comptent désormais des clients et des réseaux **distincts**, propres à chaque boutique (avant, ils étaient partagés entre toutes les boutiques, d'où de fausses alertes sur les réseaux partagés : opérateurs mobiles, bureaux, écoles).
  - Les signaux de volume (quantité, montant, premier gros achat) sont plafonnés ensemble : un client professionnel n'est jamais en « risque élevé » pour le seul volume.
  - Le panier moyen ne compte que les ventes en ligne non remboursées.
  - Le bonus « client connu » est réservé à une commande déjà expédiée, livrée ou retirée.
  - Les noms nordiques (å, æ, ø, œ) ne sont plus jugés incohérents.
  - Les adresses formées d'un numéro de téléphone ne sont plus signalées.
  - La règle « hors du pays », qui ne servait jamais, est retirée.
  - Les compteurs ne gardent que des empreintes (HMAC), effacées après 24 heures.
  - L'e-mail au marchand est exact pour une commande mixte (seule la partie fournisseur est retenue).
- **Prévision de rupture** : le rythme est calculé sur la vraie période de vente, de la première vente des 28 derniers jours à aujourd'hui, et sur 7 jours au moins. Un produit lancé il y a 5 jours n'est plus sous-estimé.
- **Traductions** :
  - Les modèles trop larges (« Voir … », « Payer … ») traduisaient à moitié les textes du marchand. Ils sont restreints : « Payer » seulement devant un montant, « Voir » seulement dans les étiquettes d'accessibilité.
  - Les textes du marchand (bannière, accroche, arguments, à propos, questions fréquentes, témoignages, avis, noms et descriptions des produits, pied de page) sont marqués « ne pas traduire ».
  - Un produit nommé « Panier » ne bloque plus la traduction du panier, et le texte n'est plus déformé par `$&`.
  - Nouveaux textes traduits : étapes du suivi de commande, « Merci Anna ! », notes en étoiles, « Épuisé », newsletter, « Tout (6) », « Voir tous les produits (12) », retrait au point de collecte.
  - Formulations corrigées. En allemand : « Oft zusammen gekauft », « Menge erhöhen », « Transportunternehmen ». En italien : « Contatti », « Spesso acquistati insieme », « marzo » en toutes lettres. En anglais : « Estimated delivery », « away from free shipping ».
- **E-mails** : ceux de retrait prêt, d'expédition partielle, de relance de paiement et de demande d'avis partent aussi dans la langue de la commande. Les liens qu'ils contiennent (suivi, reprise, avis) ouvrent la boutique dans cette même langue (`&lang=de`).
- **Restent en français** : les messages d'erreur renvoyés par le serveur au moment de commander, et l'e-mail « vous nous manquez » (il n'est pas lié à une commande).
- Vérifié dans un vrai navigateur. Tests : 91 sur 91.

## Cycle 18 (01 h 25) : notifications push, même Comptoir fermé

- **Web Push** (`server/src/webpush.js`, sans dépendance) : le marchand reçoit une notification sur son téléphone ou son ordinateur à chaque commande payée, même quand Comptoir est fermé. Exemple : « Nouvelle commande n° 1042 · CHF 89.90 · Lausanne », avec la mention « risque de fraude élevé » s'il y a lieu.
- **Chiffrement de bout en bout** (RFC 8291 : ECDH P-256, HKDF, AES-128-GCM) : le service push (Google, Mozilla, Apple, Microsoft) ne lit pas le message. Le chiffrement reproduit **à l'octet près le vecteur de test officiel de la RFC 8291**.
- **Identification du serveur** : VAPID (RFC 8292), jeton ES256. Ses clés sont créées une fois et gardées dans la base.
- **Sécurité** :
  - seuls les services push connus sont contactés (pas d'adresse interne) ;
  - un abonnement expiré (404/410) est supprimé ;
  - 10 appareils au plus par compte ;
  - le bouton de test est limité.
- **Interface** : Paramètres > E-mails > « Notifications sur cet appareil ». Boutons : activer, « recevoir même Comptoir fermé », envoyer un test, arrêter sur cet appareil. Le service worker affiche la notification, et un clic ouvre les commandes.
- Tests : vecteur RFC, abonnement refusé vers un service inconnu, commande payée → message chiffré envoyé, signature VAPID vérifiée, message déchiffré comme par le téléphone. 93 tests sur 93.
- **Limite honnête** : l'envoi vers un vrai service push (Google ou Apple) n'a pas pu être essayé ici, faute d'accès réseau à ces services. À vérifier avec un vrai téléphone après la mise en ligne. Sur iPhone, Comptoir doit d'abord être ajouté à l'écran d'accueil.

## Cycle 19 (01 h 30) : lien de panier (vente par WhatsApp, Instagram, SMS)

- Nouveau bouton « Lien de panier » dans Produits. Le marchand choisit les produits, les quantités et éventuellement un code promo. Il obtient un lien à copier, à envoyer par WhatsApp ou par e-mail, ou à montrer en QR code (au marché, en vitrine).
- Le client arrive sur la boutique avec ce panier prêt, le code appliqué et le tiroir ouvert, puis paie comme d'habitude. L'adresse est nettoyée après lecture.
- Le lien ne fixe aucun prix : prix, stock (quantité limitée au stock disponible), remises et score de risque sont ceux de la boutique au moment de l'ouverture.
- Vérifié dans un vrai navigateur : lien créé dans l'espace marchand, ouvert par un client. Le panier est correct, et la lampe est limitée aux 2 en stock.
- Essai de bout en bout « comme en production » relancé après tous les changements de la nuit : 51 contrôles sur 51.

## Cycle 20 (01 h 35) : page d'accueil, section « Technologie et sécurité »

- Nouvelle section sur la page d'accueil (lien « Sécurité » dans le menu). Six cartes, chacune décrivant uniquement ce qui a été construit et testé cette nuit :
  - connexion sans mot de passe et double authentification ;
  - QR-facture suisse ;
  - tableau de bord en direct et notifications ;
  - boutique en quatre langues ;
  - fraude expliquée ;
  - données protégées.
- Formulations vérifiées pour ne rien promettre de plus. Seuls les e-mails de commande sont traduits, pas les newsletters. Les sauvegardes chiffrées supposent que `SAUVEGARDE_CLE` soit réglée à la mise en ligne.
- Mise en page vérifiée sur ordinateur et sur téléphone, sans débordement.

## Cycle 21 (01 h 40) : réservation de stock, corrections de la quatrième revue

- **Réservation de stock** : une commande en attente de paiement garde ses articles pendant 30 minutes, ou jusqu'à l'échéance pour une facture QR. Plusieurs clients ne peuvent plus payer le même dernier exemplaire. Un client qui réessaie son propre paiement n'est pas bloqué par son essai précédent. Testé (second client refusé, puis accepté une fois la réservation échue).
- **Sauvegardes**, fiabilisées (revue : une copie en clair pouvait rester sur le disque après un échec, et un disque plein pouvait laisser des sauvegardes vides prendre la place des bonnes) :
  - fichier temporaire caché créé en 0600 (lisible par le seul propriétaire) ;
  - copie vérifiée (`PRAGMA quick_check`), chiffrée, puis renommée ;
  - en cas d'échec, rien ne reste ;
  - les restes d'un essai interrompu sont effacés ;
  - d'anciennes copies en clair sont chiffrées dès qu'une clé est fournie ;
  - la rétention ne compte que les sauvegardes valides et garde toujours la plus récente.
  - Testé.
- **Notifications push** :
  - liées à la session : un appareil déconnecté (déconnexion, appareil révoqué, session échue) ne reçoit plus rien, et un second compte sur le même navigateur n'est plus trompé par l'abonnement du premier ;
  - seuls les codes 404 et 410 suppriment un abonnement (un 400 passager ne les efface plus tous) ;
  - plus de ville du client sur l'écran verrouillé.
- **Recherche** :
  - une faute de frappe dans un mot à moitié tapé est tolérée (« chamise » trouve « Chemises ») ;
  - « coeur » trouve « cœur », et « strasse » trouve « Straße » ;
  - les mots sont calculés une fois par produit ;
  - pas de nouvel affichage pendant une saisie composée (claviers asiatiques, Gboard), et 120 ms d'attente entre deux frappes.
- **E-mails traduits** : le pied de page (contact, désinscription) est aussi dans la langue du client.
- Tests : 94 sur 94. Recherche revérifiée dans un vrai navigateur.

## Cycle 22 (01 h 40) : plus aucune requête vers Google (polices hébergées)

- Toutes les pages chargeaient les polices depuis Google Fonts : l'adresse IP de chaque visiteur, y compris les clients des boutiques, partait chez Google. Un tribunal allemand (LG München, janvier 2022) a jugé cette pratique contraire au RGPD.
- Les 22 fichiers de police (woff2, sous-ensembles latin et latin étendu, environ 600 Ko, licence SIL Open Font License) sont maintenant servis par Comptoir (`fonts/`, `css/polices.css`), avec ETag et cache du service worker.
- La politique de sécurité du contenu (CSP) se resserre : `style-src` et `font-src` n'autorisent plus que Comptoir.
- Vérifié dans un vrai navigateur, sur l'accueil, l'espace marchand et une boutique : polices chargées, aucune requête externe, aucun refus CSP.
- À la republication de l'artifact, il faut inclure `css/polices.css` et le dossier `fonts/`.

## Cycle 23 (01 h 45) : décompte de TVA

- Nouvel onglet **Analyse > TVA**, pour une période au choix : trimestre, semestre (décompte suisse) ou année.
  - Ventes ventilées par taux (normal, réduit, sans TVA) : chiffre d'affaires TTC, base hors taxe et TVA due.
  - Ventes à la date de facture, et avoirs (remboursements, annulations) déduits à leur date.
  - Export du détail en CSV pour la fiduciaire.
- **Entreprise non assujettie** : l'onglet le dit (rien à déclarer). En Suisse, il suit le **seuil d'assujettissement** de CHF 100'000 par an (LTVA art. 10) et alerte à partir de CHF 80'000.
- **Honnêteté** : présenté comme une aide au remplissage, à faire vérifier par la fiduciaire. La TVA payée sur les achats (impôt préalable) n'est pas incluse.
- Simulation complète (100 marchands, 60 jours) avec la réservation de stock : 0 anomalie, 68'245 requêtes, médiane 1 ms, 95 % sous 6 ms.

## Cycle 24 (01 h 50) : référencement des boutiques multilingues

- Une boutique proposée en plusieurs langues annonce chaque version aux moteurs de recherche : balises `hreflang` (fr, de, it, en, plus `x-default`).
- Chaque version (`?lang=de`) est sa propre page canonique, comme le demande Google pour que `hreflang` soit pris en compte.
- Vérifié : la page de la boutique contient les bonnes balises. Tests : 94 sur 94.

## Cycle 25 (01 h 55) : équipe (comptes collaborateurs)

- Le propriétaire invite jusqu'à 5 collaborateurs par e-mail (Paramètres > Équipe), avec l'un de deux rôles :
  - **Commandes** : voir et préparer les commandes, les expédier, les transmettre au fournisseur, encaisser à la caisse. Ni remboursement, ni annulation, ni modification de la boutique. Son menu ne montre que Vue d'ensemble, Commandes, Clients, Magasin et Paramètres (E-mails, Sécurité).
  - **Gestion complète** : tout, sauf l'abonnement, l'équipe, l'activation des paiements, les intégrations et la remise à zéro.
- Chaque membre a **son propre compte** : mot de passe soumis à la même politique, double authentification, clés d'accès, appareils, notifications.
- **Traçabilité** : chaque action d'un membre sur une commande est inscrite dans l'historique avec son nom (« … (par leo@…) »), grâce au contexte de requête (AsyncLocalStorage), ce qui couvre toutes les actions sans en oublier.
- **Invitation** :
  - lien valable 7 jours, à usage unique, gardé en empreinte ;
  - écran « Rejoindre la boutique » ;
  - une adresse qui a déjà un compte est refusée (un compte sert une seule boutique) ;
  - le propriétaire est prévenu par e-mail de chaque arrivée, et son journal garde les invitations, arrivées et retraits.
- **Retrait** : l'accès est coupé immédiatement. Le compte du membre est supprimé, avec ses sessions, ses clés d'accès et ses notifications.
- **Abonnement** : l'équipe utilise celui du propriétaire. S'il est inactif, le membre voit « Boutique en pause », sans écran de paiement.
- La suppression du compte du propriétaire supprime aussi les comptes de son équipe. L'effacement des inscriptions jamais payées épargne les membres d'équipe.
- Testé : parcours complet automatique (invitation, acceptation, permissions des deux rôles, traçabilité, retrait, suppression), puis dans un vrai navigateur (invitation envoyée, écran d'acceptation, menu réduit du rôle « Commandes »). 95 tests sur 95.

## Cycle 26 (02 h 00) : demandes de retour

- Sur la page de suivi de sa commande, le client peut **demander un retour** : articles et quantités, motif facultatif. C'est possible pendant le délai légal (14 jours en France et en Belgique, droit de rétractation) ou, en Suisse, pendant le délai de retour choisi par le marchand (aucun par défaut, le droit suisse n'imposant pas de rétractation). Le délai court depuis la livraison ou le retrait.
- Le client reçoit par e-mail l'adresse de retour. Le marchand est prévenu par e-mail et par notification. La commande porte la mention « Retour » dans la liste, et un encadré détaille les articles, le montant au prix réellement payé et le motif. Le remboursement clôt le retour.
- Une seule demande par commande, et le jeton de la commande est exigé. Les nouveaux textes sont traduits (allemand, italien, anglais).
- Testé :
  - France : retour possible, demande enregistrée, e-mails envoyés, remboursement qui clôt le retour ;
  - Suisse sans politique de retour : aucune demande possible ;
  - mauvais jeton refusé, deuxième demande refusée.
- 96 tests sur 96.

## Cycle 27 (02 h 00) : démo mise à jour, rappel de sécurité

- Démo en ligne (artifact) republiée, version 19 : tous les ajouts de la nuit visibles sans serveur. On y trouve notamment :
  - une commande suspecte de démonstration, avec son score de risque et la transmission retenue ;
  - la prévision de rupture, le décompte de TVA, le lien de panier et la recherche ;
  - les polices locales (`css/polices.css`, `fonts/`), publiées avec la démo.
- Le tableau de bord rappelle de protéger le compte (clé d'accès ou double authentification) tant qu'aucune des deux n'est active. Le rappel disparaît dès l'activation.
- Essai de bout en bout 51 sur 51, et simulation complète 0 anomalie, après l'ajout de l'équipe.

## Cycle 28 (02 h 05) : console de l'exploitant, corrections de l'audit de l'équipe

- **Console de l'exploitant** (`/operateur`), pour la personne qui gère la plateforme :
  - comptes marchands, membres d'équipe, inscriptions de la semaine ;
  - abonnements actifs par formule, revenu mensuel récurrent, impayés ;
  - commandes sur 24 heures, 7 jours et 30 jours, volume vendu ;
  - e-mails et webhooks en file, appareils notifiés ;
  - dernière sauvegarde (avec la mention « chiffrée » ou « NON chiffrée ») ;
  - durée de marche.
  - Accès réservé aux adresses de `OPERATEUR_EMAILS`, avec un compte protégé par double authentification ou clé d'accès. Pour tout autre visiteur, la page n'existe pas (404). Aucune donnée de client final n'y figure.
- **Santé** : `/sante` répond `{ ok, depuis }` pour un service de surveillance externe.
- **Audit de l'équipe**, corrections :
  1. **Grave** : un membre en gestion complète pouvait changer l'IBAN et détourner les paiements des factures QR. Désormais l'identité de l'entreprise, l'IBAN et le paiement sur facture restent ceux du propriétaire. L'import bancaire, l'activation des paiements et le domaine sont réservés au propriétaire.
  2. Un membre « Commandes » ne peut plus marquer « payée » une commande impayée.
  3. Une commande sur facture QR ne réserve plus le stock jusqu'à l'échéance, seulement 48 heures. Une commande fictive ne bloque donc plus un produit pendant un mois.
  4. L'équipe utilise partout l'abonnement du propriétaire : état de l'application, flux en direct (qui se fermait pour les membres), fonctions de la formule. Les notifications des commandes vont aussi aux membres. L'import bancaire est noté au journal du propriétaire. Les routes d'abonnement sont réservées au propriétaire.
  5. Inviter demande un abonnement actif, avec une limite par réseau, pour éviter qu'une inscription gratuite serve à envoyer des e-mails.
  6. Le rôle « Commandes » ne reçoit plus l'IBAN ni les listes marketing.
  7. Les e-mails de compte d'un membre retiré ou supprimé sont effacés.
  8. L'attribut `lang` de la page suit la langue demandée.
- Tests de non-régression ajoutés (IBAN inchangé, import bancaire refusé, « payée » refusé, pas d'IBAN pour le rôle « Commandes »). 97 tests sur 97.

## Cycle 29 (02 h 20) : variantes de produits (tailles, couleurs)

- Un produit en stock peut avoir **jusqu'à 2 options**, par exemple Taille × Couleur : 20 valeurs par option et 60 combinaisons au plus. Chaque combinaison a **son stock** et, si besoin, **son prix**. Le stock du produit est la somme des variantes.
- **Éditeur de produit** : bloc « Variantes » avec les options, les valeurs séparées par des virgules, et un tableau des combinaisons (stock, prix). La saisie en cours est gardée d'un affichage à l'autre, et le curseur suit la tabulation.
- **Boutique** :
  - la carte du produit affiche « Choisir » ;
  - la fiche propose une liste par option, et le prix comme la disponibilité suivent le choix ;
  - le panier distingue les variantes (« T-shirt (M / Noir) »).
- **Serveur** :
  - variante obligatoire, stock et prix contrôlés par variante ;
  - stock retiré puis rendu (remboursement) sur la variante ;
  - réservation de stock par variante ;
  - alerte « épuisé » quand le total tombe à zéro.
- **Caisse** : un bouton par variante, avec son prix et son stock.
- **Démo** : un « Plaid en laine du Jura » (2 tailles × 2 couleurs, prix selon la taille).
- **Limites** : pas de variantes pour les produits en dropshipping (codes fournisseur par variante à prévoir). Les offres en un clic et le lien de panier ne proposent pas les produits à variantes, le client les choisit sur la fiche.
- Testé : test serveur (variante obligatoire, inconnue, sans stock, prix, stock retiré puis rendu), puis parcours complet dans un vrai navigateur (éditeur, boutique, panier, paiement) et caisse de la démo. 98 tests sur 98.

## Cycle 30 (02 h 25) : bon de réassort, variantes dans l'API

- **Bon de réassort** (Produits > « Réassort ») :
  - pour les produits en stock, et par variante, Comptoir conseille la quantité à recommander pour tenir 30 jours, au rythme des 28 derniers jours (même calcul que la prévision de rupture) ;
  - le marchand ajuste ; le coût d'achat estimé suit ;
  - « Copier le texte pour le fournisseur » prépare un e-mail tout prêt ; export CSV ;
  - rien n'est envoyé automatiquement.
- **API v1 et variantes** :
  - les produits exposent `options` et `variantes` ;
  - le stock et le prix se mettent à jour variante par variante ;
  - le stock global seul est refusé pour un produit à variantes, pour que le total reste la somme des variantes ;
  - les lignes de commande portent `varianteId` ;
  - documentation mise à jour, testé.
- **Référencement** : un produit à variantes annonce sa fourchette de prix (`AggregateOffer`).
- **Fiche des fonctionnalités** : `docs/FONCTIONNALITES.md`, limites connues comprises.

## Cycle 31 (02 h 30) : « Mes commandes »

- Nouveau lien « Mes commandes » au pied de chaque boutique. Le client saisit son e-mail et reçoit les liens de suivi de ses commandes des 12 derniers mois.
- Pas de compte à créer. La réponse est identique que l'adresse soit connue ou non, donc personne ne peut savoir qui est client. Les liens ne partent qu'à l'adresse elle-même. Limite de 3 demandes par jour et par adresse, et de 10 par heure et par réseau.
- Traduit (allemand, italien, anglais). Testé. 99 tests sur 99.

## Cycle 32 (02 h 30) : corrections de la revue des variantes, des retours et de la console

- **Complément après achat** : il ne propose plus un produit à variantes. Avant, il l'ajoutait sans taille, au prix de base, et faussait le stock.
- **Demande de retour** : les lignes sont repérées par leur position. Deux tailles du même produit ne se confondent plus (avant, retourner un S retournait aussi le L).
- **Rupture au paiement** : la vérification se fait par variante. Le dernier M vendu deux fois est signalé.
- **Variante supprimée** : un remboursement ultérieur ne fausse plus le stock total. Une valeur renommée (« Noir » devient « Noir mat ») garde son stock.
- **Modification d'une fiche** : le stock enregistré entre-temps (ventes faites pendant l'édition) n'est plus écrasé. Seul un stock saisi à la main remplace celui en base. Cela concerne aussi les produits sans variantes.
- **Éditeur** : valeurs coupées à 30 caractères et espaces normalisés, comme sur le serveur. Avant, le stock d'une valeur trop longue tombait à zéro.
- **Boutique** :
  - les listes de choix portent une valeur exacte (une valeur avec double espace s'achète) ;
  - pas de prix barré quand les variantes ont leur propre prix ;
  - les cartes affichent « dès CHF … » ;
  - le bouton « + » du panier tient compte du stock de la variante.
- **Console de l'exploitant** :
  - double authentification (application de codes) exigée ;
  - l'adresse doit être prouvée par un lien unique reçu par e-mail : quelqu'un qui aurait inscrit l'adresse de l'exploitant avant lui n'obtient rien ;
  - le volume vendu est donné par devise, hors remboursements.
- Tests ajoutés (stock préservé à la modification, stock saisi pris en compte, preuve d'adresse). 99 tests sur 99. Parcours des variantes revérifié dans un vrai navigateur.

## Cycle 33 (02 h 35) : photos plus nettes et plus légères

- Les photos produits étaient réduites à 480 pixels (640 dans la fiche) : floues sur la page produit d'un téléphone récent. Elles passent à 1000 pixels.
- Format WebP quand le navigateur sait l'encoder (environ 30 % plus léger que le JPEG à qualité égale), sinon JPEG. La qualité baisse par paliers pour rester sous la limite de 300 Ko.
- Vérifié : une photo très chargée de 3000 × 2000 pixels donne un WebP de 1000 × 667 pixels et 145 Ko. Le type est conservé quand l'image est servie.

## Cycle 34 (02 h 35) : « Prévenez-moi » au retour en stock

- Sur un produit épuisé, ou une variante épuisée, la fiche propose de laisser son e-mail. Au retour en stock (vente, caisse, saisie, API), le client reçoit **un seul e-mail** avec le lien du produit, dans sa langue. Son adresse est ensuite effacée ; sans retour en stock, elle l'est après 90 jours. Effacer un client (RGPD) supprime aussi ses demandes.
- Le marchand voit « N en attente » dans la liste des produits. Le bon de réassort compte ces clients dans les quantités conseillées.
- Testé : deux demandes, dont une en allemand. Rien n'est envoyé tant que le stock est vide ; au retour, un e-mail chacun dans sa langue, adresses effacées, aucun second envoi. 100 tests sur 100.

## Cycle 35 (02 h 40) : caisse hors ligne

- Au marché ou en sous-sol, la connexion tombe souvent. Une vente à la caisse sans réseau (ou serveur indisponible) n'échoue plus : elle est gardée sur l'appareil, avec sa clé unique, puis envoyée automatiquement au retour du réseau (événement `online`, puis toutes les 30 secondes). Le bouton « Envoyer maintenant » force l'envoi.
- La clé du ticket empêche tout doublon. Une vente faite hors ligne n'est jamais refusée pour le stock, puisque l'argent est déjà encaissé : une éventuelle rupture est signalée dans l'historique (« Vente encaissée hors ligne à 14 h 32 … stock insuffisant pour … »). Une vente refusée pour une autre raison reste dans la file, signalée, et ne se perd jamais en silence.
- La caisse affiche les ventes en attente (heure, articles, montant).
- Vérifié dans un vrai navigateur : réseau coupé, vente gardée ; réseau rétabli, vente envoyée une seule fois, stock à jour, historique complet.
- **Limite** : la caisse doit avoir été ouverte avec du réseau. Ouverte hors connexion, l'application affiche « Pas de connexion ».
