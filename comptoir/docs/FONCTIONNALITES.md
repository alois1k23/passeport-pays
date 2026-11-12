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
- Codes promo, remises par quantité, offres dans le panier et après l'achat.

## Piloter

- **Tableau de bord en direct** : chaque commande s'affiche à l'instant. **Notifications sur le téléphone**, même Comptoir fermé, chiffrées de bout en bout.
- **Application installable** (PWA).
- **Rapport du lundi** par e-mail : ventes, meilleurs produits, choses à faire, ruptures prévues.
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
- Alerte à chaque nouvel appareil, déconnexion à distance, journal d'activité.
- **Bilan de sécurité** : ce qui protège le compte et ce qui reste à faire (tentatives suspectes, appareils oubliés, équipe sans protection, clés d'API dormantes).
- Mots de passe courants ou parus dans des fuites de données refusés (anonymat k).

### Fraude

- **Score de risque explicable** pour chaque commande.
- Transmission au fournisseur retenue quand le risque est élevé.

### Stock

- **Réservation de stock** pendant le paiement : pas de double vente du dernier exemplaire.

### Données

- Sauvegardes quotidiennes vérifiées et **chiffrées** (AES-256-GCM).
- **Export complet** des données de la boutique (JSON) : le marchand peut partir avec tout, même abonnement terminé.
- Aucune ressource tierce dans les boutiques : ni traceur, ni police Google.
- En-têtes de sécurité stricts (CSP sans script externe), cookie de session `__Host-`. Les navigateurs signalent ce qu'ils bloquent (tentative d'injection), sans donnée personnelle.

### Conformité

- Mentions légales, CGV, factures et avoirs numérotés sans trou.
- **Journal inaltérable des ventes** : factures, tickets et avoirs scellés dans une chaîne signée par le serveur, clôture journalière avec grand total perpétuel, vérification chaque nuit (alerte par e-mail), empreintes envoyées au marchand, export. Aide à la traçabilité, non certifiée NF 525.
- **Facture électronique** : chaque facture et chaque avoir au format XML de la norme européenne EN 16931 (celui de Factur-X), valide selon le schéma officiel.
- **Factur-X** : chaque facture et chaque avoir en PDF/A-3. Votre client lit le PDF, et son logiciel comptable lit le XML EN 16931 joint (`factur-x.xml`). Les polices sont intégrées, le texte est copiable et cherchable, et les montants sont identiques à ceux du XML et de la facture imprimée. Le format suit la spécification PDF/A-3 ; il n'a pas encore été contrôlé par un validateur PDF/A (veraPDF).
- Droit de rétractation (France, Belgique), effacement des données d'un client sur demande.

## Exploiter la plateforme

- **Console de l'exploitant** (`/operateur`) :
  - marchands, abonnements, revenu mensuel récurrent ;
  - files d'e-mails et de webhooks ;
  - dernière sauvegarde.
- Point de santé `/sante` pour la surveillance.
- Vérification avant la mise en ligne : `node server/server.js --verifier`.
- Tests automatiques, simulation de 100 marchands sur 60 jours, et essai de bout en bout avec un vrai navigateur.

## Limites connues

- **QR-facture** : à vérifier avec une vraie application bancaire avant d'ouvrir. Le QR code n'a pas été relu par un lecteur indépendant pendant les tests.
- **Notifications push** : à vérifier sur un vrai téléphone. Sur iPhone, Comptoir doit d'abord être ajouté à l'écran d'accueil.
- **Traductions** : les noms et descriptions des produits restent ceux saisis par le marchand. La page sans JavaScript reste en français.
- **Facture électronique** : XML seul (pas encore le PDF Factur-X avec XML intégré), sans transmission à une plateforme agréée. Les règles détaillées de la norme (schematron) restent à vérifier avec le validateur public.
- **Journal inaltérable** : aide à la traçabilité, **non certifié NF 525** (certification exigée en France pour un logiciel de caisse). Sa force dépend de `SECRET_CHIFFREMENT` gardé hors de la base et des empreintes conservées par le marchand.
- **Journal des ventes (format FEC)** : ventes seulement, sans les encaissements ; comptes usuels à adapter par le comptable ; pas encore passé par l'outil de contrôle de la DGFiP (Test Compta Demat) ; encodage admis à confirmer.
- **Signalement CSP** : seul `report-uri` est utilisé (la Reporting API n'a pas pu être vérifiée).
- **Export complet** : un compte qui n'utilise que sa clé d'accès doit aussi connaître son mot de passe pour exporter.
- **Publication sur les réseaux sociaux** : préparée par Comptoir, mais publiée par copier-coller, en attendant les connexions officielles des réseaux.
