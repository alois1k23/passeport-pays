# Mettre Comptoir en ligne : ce qu'il reste à faire (environ 2 heures)

Tout le logiciel est prêt et testé : 68 tests ; 100 marchands simulés sur 60 jours ; un essai de bout en bout avec de faux services Stripe, e-mails et fournisseur. Il reste les étapes qui exigent **votre identité** ou **vos comptes**. Après chaque étape, lancez la vérification :

```
node server/server.js --verifier
```

Elle liste ce qui manque (✗) et ce qui est prêt (✓).

## 1. Stripe : d'abord en mode test, gratuit et sans argent réel

1. Créez un compte sur stripe.com, au nom de l'entreprise qui exploite Comptoir.
2. Dans le tableau de bord, restez en **mode test** (interrupteur en haut).
3. **Connect** :
   - menu *Connect* > *Commencer*, choisir le type de comptes **Express** ;
   - dans les réglages de Connect, activez les moyens de paiement des comptes connectés : **cartes**, **TWINT** (CHF) et **Bancontact** (EUR, Belgique).
4. **Clés** : menu *Développeurs* > *Clés API*. Copiez la clé secrète (`sk_test_…`) dans `STRIPE_SECRET_KEY`.
5. **Webhooks** : menu *Développeurs* > *Webhooks*. Créez-en **deux**, tous les deux vers `https://<votre-domaine>/api/webhooks/stripe` et en version d'API **2024-06-20** :
   - **Votre compte**, avec les événements `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` et `customer.subscription.deleted`. Son secret va dans `STRIPE_WEBHOOK_SECRET`.
   - **Comptes connectés**, avec les événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`, `account.application.deauthorized`, `charge.dispute.created`, `charge.dispute.updated` et `charge.dispute.closed`. Son secret va dans `STRIPE_CONNECT_WEBHOOK_SECRET`.
6. Lancez `node server/server.js --verifier`. Elle contrôle aussi que la clé est acceptée et que Connect est activé.
7. **Essai complet en mode test** :
   - créez un compte marchand et payez la formule avec la carte de test `4242 4242 4242 4242` ;
   - activez les paiements de la boutique (Stripe propose des données d'identité de test) ;
   - passez une commande, puis remboursez-la.
8. Quand tout est bon, passez Stripe en **mode réel** et reprenez les étapes 4 et 5 avec les clés réelles (`sk_live_…`).

Si vous êtes assujetti à la TVA, indiquez votre numéro dans `EXPLOITANT_TVA` : les conditions annoncent alors des prix hors TVA. Activez aussi *Stripe Tax* sur les abonnements.

## 2. E-mails (Brevo, hébergé en Europe)

1. Créez un compte sur brevo.com et choisissez une **offre payante**, d'environ 20 000 e-mails par mois pour 100 boutiques. L'offre gratuite (300 par jour) ne suffit pas.
2. Validez votre domaine d'envoi : Brevo indique les enregistrements DNS à ajouter (SPF, DKIM).
3. Renseignez la clé API dans `BREVO_API_KEY`, et l'adresse d'envoi dans `EMAIL_EXPEDITEUR` (par exemple `Comptoir <envoi@votre-domaine.ch>`).

## 3. Fournisseur

Signez avec un grossiste ou une plateforme de dropshipping qui accepte le contrat décrit dans `server/README.md` (catalogue, commandes, webhook d'expédition signé). Ce contrat peut aussi passer par un petit adaptateur devant leur API.

Renseignez ensuite `FOURNISSEUR_URL_API`, `FOURNISSEUR_CLE_API` et `FOURNISSEUR_SECRET_WEBHOOK`.

## 4. Serveur et domaine

1. Louez un serveur en Suisse (Infomaniak, Exoscale) et un nom de domaine.
2. Installez Docker et Caddy (il fournit le HTTPS automatiquement). Les commandes sont dans `server/README.md`.
3. Copiez `.env.example` en `.env`, puis remplissez-le avec :
   - `URL_PUBLIQUE` en https ;
   - `NODE_ENV=production` ;
   - l'identité de l'exploitant : `EXPLOITANT_NOM`, `EXPLOITANT_ADRESSE`, `EXPLOITANT_EMAIL`, `EXPLOITANT_IDE` ;
   - `HEBERGEUR` ;
   - `SECRET_CHIFFREMENT` : générez-le avec `openssl rand -hex 32` et gardez-en une copie hors du serveur (gestionnaire de mots de passe). **À fixer avant d'ouvrir et à ne plus changer.** Il chiffre les secrets de double authentification des marchands : s'il change, leurs codes ne marchent plus ;
   - `WEBAUTHN_RP_ID` : laissez vide pour utiliser le domaine de `URL_PUBLIQUE`. Ne le changez plus une fois que des marchands ont créé des clés d'accès.
4. Lancez `node server/server.js --verifier` : chaque ligne marquée ✗ dit quoi corriger.
5. Les sauvegardes sont automatiques et quotidiennes, dans `/data/sauvegardes`. **Copiez ce dossier ailleurs** (stockage objet, autre serveur) et faites une fois l'essai de restauration.

## 5. Documents à faire relire

Faites relire par un juriste, une fois, les pages générées par Comptoir :
- `/conditions` (conditions pour les marchands) ;
- `/confidentialite` (durées de conservation : 12 mois après la fin d'un abonnement, 90 jours pour une inscription jamais payée) ;
- `/mentions-legales`.

## Réglages déjà décidés (modifiables)

- **Fin d'abonnement :** la boutique est fermée aux clients. Le marchand garde 12 mois un accès en **lecture seule** pour consulter et exporter ses commandes, factures et clients. Il peut aussi encore expédier ou rembourser les commandes déjà payées. Il reçoit un avertissement 30 jours avant l'effacement.
- **Impayé :** 7 jours de grâce pendant que Stripe réessaie.
- **Prix des formules :** affichés partout de la même façon (« par mois »). Si `EXPLOITANT_TVA` est renseignée, les conditions précisent qu'ils sont hors TVA.
