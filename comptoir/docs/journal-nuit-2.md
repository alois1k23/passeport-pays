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

## Cycle 14 (01 h 15) : rapport du lundi

- Chaque lundi dès 7 h, heure de la boutique, le marchand reçoit un e-mail qui résume sa semaine :
  - chiffre d'affaires, comparé à la semaine d'avant ;
  - nombre de commandes et panier moyen ;
  - trois meilleurs produits ;
  - à faire : commandes à expédier, factures QR échues non payées (avec les numéros), commandes à risque de fraude à vérifier, ruptures prévues sous 14 jours.
- Pas d'e-mail vide : rien ne part à une boutique sans commande depuis deux semaines.
- Un seul envoi par semaine (table `rapports_hebdo`). Le rapport se désactive dans Paramètres > E-mails (« Rapport du lundi »).
- Test : 3 commandes la semaine passée, rapport envoyé une seule fois avec les bons chiffres, sans « undefined » ni « NaN ». 90 tests sur 90.
