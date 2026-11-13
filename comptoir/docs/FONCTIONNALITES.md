# Comptoir : fonctionnalités

Comptoir est une plateforme de boutique en ligne pour la Suisse, la France et la Belgique, pensée pour un commerçant seul ou une petite équipe, en dropshipping comme avec un stock propre.

Ce document décrit ce qui existe et a été testé. Les limites connues sont indiquées.

## Vendre

### Boutique et catalogue

- Boutique prête en une soirée : modèles, sections, éditeur visuel, domaine personnalisé vérifié (DNS et TXT).
- **Variantes** : tailles et couleurs (2 options), avec stock et prix par variante. En dropshipping, chaque variante a sa référence chez le fournisseur, transmise avec la commande.
- **Boutique en quatre langues** : français, allemand, italien et anglais. Les e-mails de commande, d'inscription, de bienvenue et de relance partent dans la langue du client, et chaque version est référencée (`hreflang`).
- **Recherche instantanée** : sans accents, et tolérante aux fautes de frappe.
- **Lien de panier** : un panier prêt à envoyer par WhatsApp, e-mail ou QR code.

### Paiement

- Paiement par TWINT, carte ou Bancontact (Stripe Connect). Chaque boutique encaisse sur son propre compte.
- **QR-facture suisse** (norme SIX). L'import du relevé bancaire camt.053 ou camt.054 marque les commandes payées. Les versements partiels s'additionnent, et les doublons et trop-perçus sont signalés.

### En boutique physique

- **Caisse** (marchés, pop-up, magasin), avec un stock unique pour la caisse et le site.
- Retrait en magasin.

### Après la vente

- Retours : demande du client depuis le suivi de commande, dans le délai légal ou celui du marchand.
- Relances de paiement, demandes d'avis vérifiés, e-mail de bienvenue.
- Codes promo, remises par quantité, offres dans le panier et après l'achat. Un code peut avoir une date de fin, un montant minimum, un nombre maximum d'utilisations et la règle « une fois par client » ; l'espace marchand montre combien de fois il a servi. Une commande abandonnée rend son utilisation.

## Piloter

- **Tableau de bord en direct** : chaque commande s'affiche à l'instant. **Notifications sur le téléphone**, même Comptoir fermé, chiffrées de bout en bout.
- **Application installable** (PWA).
- **Rapport du lundi** par e-mail : ventes, remboursements de la semaine (avoirs, gestes commerciaux), meilleurs produits, choses à faire, ruptures prévues, empreinte du journal des ventes.
- **Prévision de rupture** : jours de stock restants et quantité à recommander.
- **Marge réelle** : coût fournisseur, port, TVA d'importation, frais de paiement et publicité.
- **Décompte de TVA** par trimestre, semestre ou année, avec export CSV pour la fiduciaire et suivi du seuil suisse.
- **Écritures de ventes** pour le comptable : format FEC en France, CSV en Belgique et en Suisse, chaque écriture contrôlée équilibrée (journal des ventes, sans les encaissements).
- Analyse : ventes, produits, clients, marketing, rentabilité.
- **Équipe** : jusqu'à 5 collaborateurs, avec les rôles « Commandes » ou « Gestion complète ». Leurs actions sont tracées à leur nom.
- **API et webhooks signés** (formule Croissance) : comptabilité, entrepôt, Zapier, Make.

## Protéger

### Comptes

- **Clés d'accès** (Face ID, Touch ID, Windows Hello) et **double authentification**, avec codes de secours. Option **« Exiger la clé d'accès »** : le mot de passe seul ne suffit plus, et une tentative avec le bon mot de passe est signalée.
- **Adresse e-mail confirmée** : un lien (valable 7 jours, à usage unique) est envoyé à l'inscription. Sans confirmation, le marchand prépare sa boutique mais ne peut ni inviter son équipe, ni envoyer de devis, ni activer les versements. Quelqu'un qui ouvre un compte avec l'adresse d'autrui ne peut donc écrire à personne en son nom, et la vraie titulaire reprend le compte par « mot de passe oublié ».
- **Appareils reconnus révocables** et **requêtes d'autres sites refusées** : chaque appareil a son propre jeton, révoqué avec sa session, à l'activation de la double authentification ou au changement de mot de passe. Toute action venue d'un autre site est refusée, même sans corps de requête.
- **Mode sécurisé** : créer une clé d'API ou un webhook, renouveler un secret ou inviter l'équipe demande une identité confirmée depuis moins de 15 minutes (mot de passe, et code si la double authentification est active ; pour un compte « clé d'accès seule », la connexion par clé d'accès compte comme confirmation). Une session dure au plus 90 jours, même utilisée chaque jour.
- **Changement de l'adresse e-mail du compte** : mot de passe redemandé, lien de confirmation (24 heures) envoyé à la nouvelle adresse, avertissement à l'ancienne. Pendant 7 jours, l'ancienne adresse peut tout annuler : elle reste réservée, tous les appareils sont déconnectés, le mot de passe actuel cesse de fonctionner (un nouveau se choisit par lien), « Exiger la clé d'accès » revient à son état d'avant la demande, et ce qui a été installé depuis la demande (ou depuis la connexion, si elle date de moins de 24 heures) est retiré : double authentification, clés d'accès, clés d'API, webhooks, membres et invitations d'équipe, ces derniers listés dans l'e-mail. Une adresse déjà prise reçoit la même réponse qu'une libre.
- **Rotation des clés de chiffrement** sans interruption : l'ancienne clé passe dans `SECRET_CHIFFREMENT_ANCIENNES`, tout est rechiffré au démarrage, le journal des ventes reste vérifiable.
- **Webhooks** : secret chiffré en base et renouvelable (24 heures de double signature) ; un paiement qui ne correspond pas à la commande (montant, devise) est remboursé automatiquement.
- Alerte à chaque nouvel appareil, déconnexion à distance, journal d'activité.
- **Bilan de sécurité** : ce qui protège le compte et ce qui reste à faire (tentatives suspectes, appareils oubliés, équipe sans protection, clés d'API dormantes).
- Mots de passe courants ou parus dans des fuites de données refusés (anonymat k).

### Fraude

- **Score de risque explicable** pour chaque commande.
- Transmission au fournisseur retenue quand le risque est élevé.

### Stock

- **Réservation de stock** pendant le paiement : pas de double vente du dernier exemplaire.

### Données

- Sauvegardes quotidiennes, avec contrôle d'intégrité SQLite. Elles sont **chiffrées** (AES-256-GCM) seulement si `SAUVEGARDE_CLE` est définie ; sinon, ce sont des copies en clair. Une copie restaurée se vérifie de bout en bout (test automatique).
- **Export complet** des données de la boutique (JSON) : le marchand peut partir avec tout, même abonnement terminé.
- Aucune ressource tierce dans les boutiques : ni traceur, ni police Google.
- En-têtes de sécurité stricts (CSP sans script externe), cookie de session `__Host-`. Les navigateurs signalent ce qu'ils bloquent (tentative d'injection), sans donnée personnelle.

### Conformité

- Mentions légales, CGV, factures et avoirs numérotés sans trou.
- **Retours partiels** : rembourser une partie des articles (et, au choix, la livraison) depuis la fiche commande. Le montant est calculé au centime par le serveur (prix payés, remise comprise) et affiché avant confirmation. Un avoir partiel numéroté est émis (PDF Factur-X et XML EN 16931), scellé au journal, et le client est prévenu dans sa langue. L'argent revient d'abord sur le moyen de paiement d'origine (remboursement Stripe partiel), puis sur la carte cadeau utilisée. Les articles reviennent en stock, à leur emplacement d'origine, sauf s'ils sont abîmés. La demande de retour du client préremplit les quantités. Retourner tous les articles restants passe par le remboursement complet, livraison comprise. L'avoir final ne couvre alors que le reste.
- **Geste commercial** : avoir d'un montant libre, sans retour d'article (retard, petit défaut accepté par le client), remboursé comme un retour partiel. Un article retourné ensuite est remboursé de sa valeur restante. La confirmation reprend le montant affiché : un double clic ou un second onglet ne rembourse pas deux fois. Si l'argent est parti chez Stripe sans que l'avoir ait pu être créé, la fiche propose « Terminer le retour en cours », à l'identique.
- **Journal inaltérable des ventes** : factures, tickets et avoirs scellés dans une chaîne signée par le serveur, clôture journalière avec grand total perpétuel, vérification chaque nuit (alerte par e-mail), empreintes envoyées au marchand, export. Aide à la traçabilité, non certifiée NF 525.
- **Facture électronique** : chaque facture et chaque avoir au format XML de la norme européenne EN 16931 (celui de Factur-X), valide selon le schéma officiel.
- **Factur-X** : chaque facture et chaque avoir en PDF/A-3. Votre client lit le PDF, et son logiciel comptable lit le XML EN 16931 joint (`factur-x.xml`). Les polices sont intégrées, le texte est copiable et cherchable, et les montants sont identiques à ceux du XML et de la facture imprimée. Le format suit la spécification PDF/A-3 ; il n'a pas encore été contrôlé par un validateur PDF/A (veraPDF).
- **Cartes cadeaux** : émises depuis « Magasin et caisse », utilisables en ligne et à la caisse, seules ou avec un autre moyen de paiement. Le code n'est affiché qu'une fois et la base n'en garde qu'une empreinte. Le solde ne peut pas être dépensé deux fois. Si la commande est annulée, remboursée ou si son paiement n'aboutit pas, le montant revient sur la carte. Un registre des mouvements par carte permet de vérifier chaque solde. Le marchand peut aussi les **vendre en ligne** : le client choisit un montant dans la boutique (« Offrir une carte cadeau »), paie, et la carte part par e-mail, à lui ou à la personne à qui il l'offre, avec un message. Pas de facture, car c'est un bon d'achat ; une carte non utilisée se rembourse et se désactive.
- **Devis pour les professionnels** : articles du catalogue ou lignes libres (prix HT), remise, livraison, validité. Le client reçoit un lien personnel ; il consulte le devis et l'accepte en ligne (« bon pour accord » et nom du signataire) ou le refuse. Le devis accepté devient une commande, payable en ligne ou par virement, avec les mêmes montants jusqu'à la facture et la facture électronique (où figure le numéro de TVA du client). Un devis modifié après envoi coupe l'ancien lien, et un devis accepté ne change plus : la date, le signataire et l'empreinte du contenu accepté sont conservés.
- **Programme de fidélité sans compte client** : points gagnés à chaque commande payée en ligne (pas à la caisse), utilisés comme remise sur une prochaine commande, avec seuil, plafond par commande et expiration après inactivité, réglables dans la page Clients. Pour utiliser ses points, le client reçoit un code à usage unique par e-mail : connaître son adresse ne suffit pas. Les adresses ne sont pas stockées en clair. Les points sont une remise qui baisse les prix ; factures et TVA restent justes. Une commande remboursée rend les points utilisés et retire les points gagnés. Un retour partiel retire les points gagnés au prorata des articles rendus ; un geste commercial n'en retire pas. Un programme en pause ne fait expirer aucun point.
- **Stock sur plusieurs emplacements** : magasins, entrepôts et dépôts, avec transferts entre eux et un registre des mouvements. Le stock affiché en boutique reste le total. Une vente en caisse prend d'abord dans un magasin, une vente en ligne d'abord dans un entrepôt, et un retour remet les articles là d'où ils venaient. Un contrôle vérifie que la somme des emplacements est égale au stock de chaque produit.
- Droit de rétractation (France, Belgique), effacement des données d'un client sur demande.

## Exploiter la plateforme

- **Console de l'exploitant** (`/operateur`) :
  - marchands, abonnements, revenu mensuel récurrent ;
  - files d'e-mails et de webhooks ;
  - dernière sauvegarde ;
  - état des journaux des ventes de toutes les boutiques, violations de la politique de sécurité (CSP) signalées par les navigateurs ;
  - **bilan de sécurité** : clé de chiffrement hors de la base ou non, rotations, données illisibles, comptes protégés, adresses non confirmées, codes refusés, paiements à rembourser.
  Accès : adresse dans `OPERATEUR_EMAILS`, double authentification active, et lien de confirmation à la première ouverture.
- Point de santé `/sante` pour la surveillance.
- Vérification avant la mise en ligne : `node server/server.js --verifier`.
- Tests automatiques, simulation de 100 marchands sur 60 jours, et essai de bout en bout avec un vrai navigateur.

## Limites connues

- **QR-facture** : à vérifier avec une vraie application bancaire avant d'ouvrir. Le QR code n'a pas été relu par un lecteur indépendant pendant les tests.
- **Notifications push** : à vérifier sur un vrai téléphone. Sur iPhone, Comptoir doit d'abord être ajouté à l'écran d'accueil.
- **Traductions** : les noms et descriptions des produits restent ceux saisis par le marchand. La page sans JavaScript reste en français.
- **Facture électronique** : XML EN 16931 et PDF Factur-X (PDF/A-3 avec XML joint), non contrôlé par un validateur PDF/A (veraPDF), sans transmission à une plateforme agréée. Les règles détaillées de la norme (schematron) restent à vérifier avec le validateur public.
- **Journal inaltérable** : aide à la traçabilité, **non certifié NF 525** (certification exigée en France pour un logiciel de caisse). Sa force dépend de `SECRET_CHIFFREMENT` gardé hors de la base et des empreintes conservées par le marchand.
- **Données des clients chiffrées au repos** : nom, e-mail, adresse et téléphone des clients sont chiffrés dans chaque commande (AES-256-GCM authentifié, lié à la boutique et à la commande). Un index aveugle (HMAC, propre à chaque boutique) retrouve les commandes d'un client sans stocker son e-mail en clair. Avec `SECRET_CHIFFREMENT` défini dans l'environnement du serveur (et non dans la base), une copie de la base seule ne révèle pas les clients des commandes. Sans lui, la clé est gardée dans la base : la protection est nulle face à une copie volée. Les coordonnées des clients professionnels dans les devis (et le nom du signataire) et la file des envois de webhooks sont chiffrées de la même façon. Restent en clair, par nature ou pour l'instant : la file des e-mails, les avis publiés, les inscriptions à la newsletter et aux alertes de stock. Définir `SECRET_CHIFFREMENT` après l'ouverture est pris en charge : tout est rechiffré au démarrage.
- **Journal des ventes (format FEC)** : ventes seulement, sans les encaissements ; comptes usuels à adapter par le comptable ; pas encore passé par l'outil de contrôle de la DGFiP (Test Compta Demat) ; encodage admis à confirmer.
- **Signalement CSP** : seul `report-uri` est utilisé (la Reporting API n'a pas pu être vérifiée).
- **Export complet** : un compte qui n'utilise que sa clé d'accès doit aussi connaître son mot de passe pour exporter.
- **Publication sur les réseaux sociaux** : préparée par Comptoir, mais publiée par copier-coller, en attendant les connexions officielles des réseaux.
