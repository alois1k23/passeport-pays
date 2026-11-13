# Mettre Comptoir en ligne : ce qu'il reste à faire (environ 2 heures)

Tout le logiciel est prêt et testé : plus de 200 tests automatiques (`npm test`) ; 100 marchands simulés sur 60 jours ; un essai de bout en bout avec de faux services Stripe, e-mails et fournisseur. Il reste les étapes qui exigent **votre identité** ou **vos comptes**. Après chaque étape, lancez la vérification :

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
   - **Votre compte**, avec les événements `checkout.session.completed`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` et `customer.subscription.deleted`. Son secret va dans `STRIPE_WEBHOOK_SECRET`.
   - **Comptes connectés**, avec les événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`, `charge.refunded`, `account.application.deauthorized`, `charge.dispute.created`, `charge.dispute.updated` et `charge.dispute.closed`. Son secret va dans `STRIPE_CONNECT_WEBHOOK_SECRET`.
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
   - l'identité de l'exploitant : `EXPLOITANT_NOM`, `EXPLOITANT_ADRESSE`, `EXPLOITANT_EMAIL` (contrôlés par `--verifier`), `EXPLOITANT_IDE` (numéro IDE, à renseigner vous-même : il n'est pas contrôlé) ;
   - `HEBERGEUR` ;
   - `SECRET_CHIFFREMENT` : générez-le avec `openssl rand -hex 32` et gardez-en une copie hors du serveur (gestionnaire de mots de passe). **À fixer avant d'ouvrir ; pour le changer, suivez la rotation décrite plus bas, jamais un simple remplacement.** Il chiffre les secrets de double authentification des marchands et les données personnelles des clients dans les commandes (nom, e-mail, adresse), protège les codes des cartes cadeaux et les comptes de fidélité, et signe le journal inaltérable des ventes : s'il change, les codes de double authentification ne marchent plus, les données des clients et les cartes cadeaux deviennent illisibles et les journaux existants ne peuvent plus être vérifiés (Comptoir le signale au démarrage et dans Conformité). Sans lui, la clé est gardée dans la base : une copie volée de la base permettrait alors de lire les données des clients et les secrets de double authentification, et de recalculer le journal ;
   - **Rotation de `SECRET_CHIFFREMENT`** (clé exposée, départ d'un administrateur, règle interne) :
     1. générez la nouvelle clé (`openssl rand -hex 32`) et gardez-en une copie hors du serveur ;
     2. mettez la nouvelle dans `SECRET_CHIFFREMENT` et l'ancienne dans `SECRET_CHIFFREMENT_ANCIENNES` (plusieurs : séparées par des virgules, la plus récente d'abord) ;
     3. redémarrez. Au démarrage, Comptoir rechiffre avec la nouvelle clé les données des clients (et refait leur index de recherche), les devis, les envois de webhook en attente, les secrets des webhooks et les secrets de double authentification. Les cartes cadeaux et les comptes de fidélité, dont seule une empreinte est gardée, sont repris à leur première utilisation. Le journal inaltérable note la rotation ;
     4. **gardez l'ancienne clé dans `SECRET_CHIFFREMENT_ANCIENNES`** : le journal inaltérable reste signé avec elle pour ses pièces d'avant la rotation (il ne se re-signe pas, sinon il ne prouverait plus rien), comme les cartes et les comptes de fidélité pas encore utilisés depuis. L'ordre dans lequel vous listez les anciennes clés n'a pas d'importance. Une entrée du journal signée avec une clé déjà remplacée plus haut dans la chaîne, ou datée d'après la rotation de sa clé, est signalée comme suspecte. **Limite, si la rotation fait suite à une fuite** : quelqu'un qui détient l'ancienne clé *et* peut écrire dans la base pourrait re-signer tout le journal avec elle. Seules les empreintes envoyées chaque semaine aux marchands (rapport du lundi) le révèlent : ce sont elles qui font foi pour la période d'avant la rotation ;
     5. les compteurs anti-abus (essais de connexion) repartent de zéro, et les codes de fidélité en cours (15 minutes) sont à redemander.
     Testé de bout en bout (`server/test/rotation-cles.test.js`). Si une ancienne clé manque, rien n'est écrasé : Comptoir le signale au démarrage.
   - `SAUVEGARDE_CLE` : générée de la même façon, définie sur le serveur, avec une copie gardée ailleurs (gestionnaire de mots de passe). Les sauvegardes quotidiennes sont alors chiffrées : vous pouvez les copier sur un stockage externe sans risque. Pour restaurer : `SAUVEGARDE_CLE=… node server/server.js --restaurer comptoir-AAAA-MM-JJ.db.enc nouvelle.db` ;
   - `WEBAUTHN_RP_ID` : laissez vide pour utiliser le domaine de `URL_PUBLIQUE`. Ne le changez plus une fois que des marchands ont créé des clés d'accès.
4. Lancez `node server/server.js --verifier` : chaque ligne marquée ✗ dit quoi corriger.
5. Les sauvegardes sont automatiques et quotidiennes, dans `/data/sauvegardes`. Avec `SAUVEGARDE_CLE`, chacune est restaurée à l'essai (déchiffrée en mémoire et comparée octet par octet) avant d'être gardée ; sans clé, elle n'est vérifiée que par `quick_check`. La console `/operateur` (section Sécurité) dit quand la dernière a réussi et signale un échec ou plus de 30 heures sans sauvegarde. **Copiez ce dossier ailleurs** (stockage objet, autre serveur) et faites une fois l'essai de restauration. Pour restaurer : arrêtez le serveur, restaurez vers un fichier qui n'existe pas encore (`--restaurer`), puis pointez `BASE_DE_DONNEES` vers ce fichier. La copie ne se lit qu'avec le **même** `SECRET_CHIFFREMENT`, ou avec la clé de l'époque gardée dans `SECRET_CHIFFREMENT_ANCIENNES` (clients, cartes cadeaux, journal) : avec une autre clé, Comptoir le signale au démarrage et dans Conformité.

6. **À savoir avant d'ouvrir (ajouts de la nuit du 12 novembre)** :
   - en HTTPS, la session utilise le cookie `__Host-comptoir_session` : les marchands déjà connectés en test devront se reconnecter une fois ;
   - le journal inaltérable des ventes est signé avec une clé dérivée de `SECRET_CHIFFREMENT`. Si cette variable change sans que l'ancienne valeur soit gardée dans `SECRET_CHIFFREMENT_ANCIENNES`, les journaux existants ne peuvent plus être vérifiés : Comptoir le signale au démarrage, dans la console `/operateur` et dans Conformité ;
   - la console `/operateur` montre aussi l'état des journaux de toutes les boutiques et les violations de sécurité (CSP) signalées par les navigateurs ;
   - le proxy (Caddy) doit transmettre aussi les requêtes `POST /csp-rapport` à Comptoir (c'est le cas avec la configuration ci-dessus, qui transmet tout) ;
   - avant d'annoncer la facture électronique et le journal des ventes au format FEC, faites valider un fichier de chacun : validateur public Factur-X (règles schematron) et outil Test Compta Demat de la DGFiP.

7. **À savoir avant d'ouvrir (ajouts du 13 novembre)** :
   - **adresse e-mail confirmée** : un nouveau marchand reçoit un lien de confirmation. Tant qu'il ne l'a pas ouvert, il ne peut ni inviter d'équipe, ni envoyer de devis, ni activer les versements. Les comptes créés avant cette règle sont considérés comme confirmés ;
   - le proxy doit transmettre l'en-tête `Host` d'origine (Caddy le fait par défaut ; avec nginx, `proxy_set_header Host $host;`). Sinon, les actions de l'espace marchand sont refusées comme venant d'un autre site (`403 autre_site`), sauf depuis l'adresse de `URL_PUBLIQUE` ;
   - **rotation de `SECRET_CHIFFREMENT`** : voir « Rotation de `SECRET_CHIFFREMENT` » plus haut dans cette section, avec `SECRET_CHIFFREMENT_ANCIENNES` ;
   - la console `/operateur` s'ouvre avec une adresse listée dans `OPERATEUR_EMAILS`, la double authentification active et un lien de confirmation à la première ouverture. Elle a une section **Sécurité** : clé hors de la base ou non, rotations, données illisibles, comptes protégés, paiements à rembourser. Une ligne en rouge demande une action, décrite sur la ligne ;
   - les webhooks Stripe incluent maintenant `charge.refunded` (ajouté aux deux listes de la section 1, point 5) : un remboursement fait à la main dans Stripe solde un paiement « à rembourser » ;
   - les marchands peuvent renouveler le secret d'un webhook : l'ancien reste valable 24 heures (double signature, voir `API.md`).
   - **mode sécurisé** : créer une clé d'API ou un webhook, renouveler un secret ou inviter l'équipe redemande le mot de passe (et le code) si la dernière connexion date de plus de 15 minutes. Les sessions durent au plus 90 jours : chaque marchand se reconnecte au moins une fois par trimestre.

## 5. Documents à faire relire

Faites relire par un juriste, une fois, les pages générées par Comptoir :
- `/conditions` (conditions pour les marchands) ;
- `/confidentialite` (durées de conservation : 12 mois après la fin d'un abonnement, 90 jours pour une inscription jamais payée) ;
- `/mentions-legales`.

## Réglages déjà décidés (modifiables)

- **Fin d'abonnement :** la boutique est fermée aux clients. Le marchand garde 12 mois un accès en **lecture seule** pour consulter et exporter ses commandes, factures et clients. Il peut aussi encore expédier ou rembourser les commandes déjà payées. Il reçoit un avertissement 30 jours avant l'effacement.
- **Impayé :** 7 jours de grâce pendant que Stripe réessaie.
- **Prix des formules :** affichés partout de la même façon (« par mois »). Si `EXPLOITANT_TVA` est renseignée, les conditions précisent qu'ils sont hors TVA.
