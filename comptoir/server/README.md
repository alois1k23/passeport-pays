# Serveur Comptoir

Serveur Node.js **sans aucune dépendance** : HTTP, base SQLite et chiffrement viennent de Node (version 22.13 ou plus récente).

```bash
cd comptoir
npm start          # http://localhost:3000
npm test           # 19 tests de bout en bout
```

Ouvrez `http://localhost:3000`, créez un compte, puis ouvrez votre boutique publique (`/s/<nom-de-la-boutique>`) et passez une commande. Sans clé Stripe, le paiement est simulé et le fournisseur de démonstration expédie au bout de 2 minutes.

## Ce que fait le serveur

| Domaine | Détail |
|---|---|
| **Comptes** | Inscription et connexion. Mots de passe hachés avec scrypt. Session dans un cookie HttpOnly et SameSite=Lax ; la base ne stocke que l'empreinte du jeton. Calcul scrypt asynchrone (n'immobilise pas le serveur). Limites d'essais par adresse IPv4 ou par réseau IPv6 /64 ; changement de mot de passe et suppression du compte limités par compte. Un domaine personnalisé n'est actif qu'après vérification DNS et TXT. |
| **Boutiques** | Plusieurs boutiques dans une seule base. Chaque requête d'administration est limitée à la boutique du marchand connecté (testé). |
| **Boutique publique** | `/s/<slug>` : catalogue, panier, livraison, paiement. Le coût fournisseur n'est jamais exposé. |
| **Prix** | Tout est recalculé côté serveur (produits, livraison, seuil de port offert). Un prix envoyé par le navigateur est ignoré (testé). |
| **Paiements** | `simulation` par défaut. **Stripe Checkout avec TWINT et cartes** en CHF si `STRIPE_SECRET_KEY` est défini ; confirmation par webhook signé (`/api/webhooks/stripe`), remboursement depuis l'admin. |
| **Dropshipping** | Après paiement, les articles du fournisseur lui sont transmis automatiquement. Son webhook signé (HMAC) renvoie le suivi, la commande passe à « Expédiée » et le client reçoit un e-mail. |
| **Commandes** | Mêmes règles d'étapes que l'interface (une transition interdite est refusée). Factures numérotées sans rupture, stock retiré au paiement et remis en cas d'annulation ou de remboursement, caisse pour les ventes en personne. |
| **E-mails** | Confirmation, expédition, retrait : placés dans une file (table `emails`, consultable via `/api/admin/emails`). À brancher sur un service d'envoi. |
| **Sécurité** | L'API n'accepte que du JSON (protection CSRF). Thème, images et textes sont validés avant enregistrement (testé avec une tentative d'injection). Le dossier `server/` et la base ne sont jamais servis (testé). |

## Nouveautés (novembre 2026)

| Domaine | Détail |
|---|---|
| **Offres complémentaires** | Règles « si le panier contient X, proposer Y à −N % ». Dans le panier (case à cocher) ou après l'achat : complément livré dans le même colis, sans port, proposé pendant 2 h et une seule fois. Prix recalculés côté serveur ; une offre dont la condition n'est pas remplie repasse au prix normal (testé). |
| **Prix barrés** | L'historique des prix est tenu par le serveur seul. Un prix barré n'est publié que s'il est licite : règle suisse (prix pratiqué 30 jours consécutifs, OIP) ou européenne (prix le plus bas des 30 jours précédents). Testé, y compris contre un historique falsifié par le navigateur. |
| **Mesure d'audience** | Sans cookie ni adresse IP : identifiant aléatoire par onglet. Étapes : visite, panier, livraison, paiement, offre vue. L'Analyse affiche l'entonnoir réel et les abandons par étape. |
| **Routage fournisseur** | Si le même produit existe dans un entrepôt plus proche du client (Suisse, puis UE, puis Chine), la commande y est envoyée et l'historique le note. |
| **E-mails** | File envoyée toutes les 30 s par Brevo ou Postmark (`BREVO_API_KEY` ou `POSTMARK_TOKEN` + `EMAIL_EXPEDITEUR`), 5 tentatives par e-mail. |
| **Mot de passe oublié** | Lien valable 1 heure, à usage unique ; toutes les sessions sont fermées après le changement. Réponse identique que le compte existe ou non. |
| **Domaines personnalisés** | Le marchand pointe son domaine (CNAME) vers Comptoir, puis clique « Vérifier ». Le serveur contrôle le DNS ; seul ce contrôle peut rendre un domaine « actif ». La boutique est alors servie à la racine du domaine. |
| **Suppression du compte** | `POST /api/admin/compte/supprimer` avec le mot de passe : efface la boutique, les produits, les commandes, les factures, les clients, les avis, les publications, les e-mails et les mesures, puis ferme la session (testé). L'interface rappelle d'exporter les données avant. |
| **Session** | `/api/session` et l'état d'administration indiquent le service de paiement, le service d'e-mails et la date de création du compte (page Paramètres). |

## Abonnement et accès (novembre 2026)

| Domaine | Détail |
|---|---|
| **Parcours** | Page d'accueil `/` (formules) → `/app?formule=…` : création du compte et de la boutique → choix de la formule et paiement → accès à l'espace. Avant le paiement, toute route d'administration répond 402 et la boutique publique est fermée (404 « pas encore ouverte ») ; le suivi des commandes déjà passées reste accessible. |
| **Isolation** | Chaque route d'administration ne lit et n'écrit que la boutique du compte connecté (`boutique_id` tiré de la session, jamais de la requête). Testé : un marchand ne voit ni ne modifie les données d'un autre. |
| **Newsletter** | Double confirmation : le formulaire envoie un lien ; l'adresse n'est inscrite (et l'e-mail de bienvenue envoyé) qu'après le clic. |
| **Formules** | Le serveur applique la formule : sans Croissance, codes, paliers, offres, campagnes et e-mails automatiques sont éteints à la vente ; sans Pro, le retrait en magasin aussi (les réglages restent enregistrés). |
| **Paiement** | Sans clé : page `/abonnement-simule/<ref>` (refusée en production). Avec `STRIPE_SECRET_KEY` : Checkout en mode abonnement (cartes), portail client Stripe pour changer de carte, de formule ou résilier. Webhooks : `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`. |
| **Résiliation** | Effet à la fin du mois payé ; accès conservé jusque-là, puis boutique fermée aux clients, données conservées. Délai de grâce de 3 jours après une échéance non confirmée. |
| **Routes** | `GET /api/abonnement`, `POST /api/abonnement/commencer` `{ formule }`, `POST /api/abonnement/changer`, `/resilier`, `/reprendre`. |

## Produits stars et tendances

`GET /api/admin/tendances` renvoie, pour le pays de la boutique, les signaux de demande par produit du catalogue ; le classement (`js/tendances.js`, partagé navigateur et serveur) combine saison (profil mensuel par produit), demande, marge nette, concurrence, délai et note.

| Source | Détail |
|---|---|
| **Ventes Comptoir** | Commandes payées des 28 derniers jours de toutes les boutiques, agrégées par produit du catalogue. Exposées seulement si au moins `TENDANCES_MIN_BOUTIQUES` boutiques (2) vendent le produit : aucune boutique ne peut déduire les ventes d'une autre (testé). |
| **Google Trends** | Via l'API SerpApi (`SERPAPI_KEY`), par pays des boutiques ; rotation de `TENDANCES_REQUETES_MAX` produits par passage, les plus anciennement mis à jour d'abord. |
| **Fichier** | `TENDANCES_FICHIER` : export JSON d'un outil d'analyse ou relevés de meilleures ventes. Les pages des places de marché (Amazon, Galaxus, AliExpress…) ne sont pas aspirées : leurs conditions d'utilisation l'interdisent. |

Rafraîchissement : Google Trends et fichier au démarrage puis toutes les 6 heures (`TENDANCES_INTERVALLE_MS`) ; ventes Comptoir toutes les 15 minutes et à la consultation si elles datent de plus de 15 minutes (`TENDANCES_VENTES_INTERVALLE_MS`, `TENDANCES_VENTES_AGE_MS`). Catalogue de démonstration : 148 produits sur 9 niches, généré par `outils/catalogue/generer.py` (une seule source pour `server/data/catalogue-demo.json` et `js/catalogue.js`).

## Brancher les vrais services

### Paiement TWINT et cartes (Stripe)
1. Créez un compte Stripe au nom de l'entreprise suisse et activez TWINT dans les moyens de paiement (CHF uniquement).
2. Définissez `STRIPE_SECRET_KEY` et `URL_PUBLIQUE`.
3. Dans Stripe, ajoutez un webhook vers `https://<votre-domaine>/api/webhooks/stripe` pour les événements `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` et `customer.subscription.deleted` (commandes et abonnements), puis copiez son secret dans `STRIPE_WEBHOOK_SECRET`. Activez le portail client Stripe (changement de carte, de formule, résiliation).

### Un vrai fournisseur
Tout fournisseur qui respecte ce contrat (ou un petit adaptateur devant son API) se branche sans changer le reste :

```
GET  {url_api}/catalogue            → [{ id, nom, categorie, cout, portF, entrepot, delai, prix, fournisseur }]
POST {url_api}/commandes            → { ref, statut }
     { referenceMarchand, lignes: [{ produitId, qte }], livraison: { nom, adresse, npa, ville, pays } }
Webhook vers Comptoir à l'expédition :
POST /api/webhooks/fournisseurs/{code}   en-tête X-Signature = HMAC-SHA256(corps, secret_webhook)
     { ref, statut: "expediee", suivi, transporteur }
```

Ajoutez une ligne dans la table `fournisseurs` (code, nom, url_api, cle_api, secret_webhook). Le fournisseur `demo` sert d'exemple : il est servi par ce même serveur sous `/demo-fournisseur`.

### Domaines des marchands et HTTPS
Chaque boutique peut avoir son domaine. Le plus simple : placer [Caddy](https://caddyserver.com) devant Comptoir avec le HTTPS « à la demande ». Il obtient un certificat pour chaque domaine dès qu'il est vérifié :

```
{
  on_demand_tls {
    ask http://localhost:3000/api/tls/autoriser
  }
}
https:// {
  tls { on_demand }
  reverse_proxy localhost:3000
}
```

La route `/api/tls/autoriser` ne répond « oui » que pour le domaine principal et les domaines vérifiés : un domaine quelconque pointé vers le serveur n'obtient pas de certificat (testé).

## Mise en ligne

- **Docker** : `docker build -t comptoir . && docker run -p 3000:3000 -v comptoir-data:/data --env-file .env comptoir`
- Hébergement en Suisse possible chez Infomaniak, Exoscale ou un VPS. Placez la base sur un disque persistant et sauvegardez-la chaque jour.
- HTTPS obligatoire. Le cookie passe automatiquement en `Secure` quand `URL_PUBLIQUE` commence par `https://`.
- En production (`NODE_ENV=production`), la page de paiement simulé est désactivée.

## Avant l'ouverture au public (obligatoire)

- **Identité de l'exploitant** : `EXPLOITANT_NOM`, `EXPLOITANT_ADRESSE`, `EXPLOITANT_EMAIL`, `EXPLOITANT_IDE` (pages `/mentions-legales`, `/confidentialite`, `/conditions`), et `HEBERGEUR` (nom, adresse et téléphone de l'hébergeur, repris dans les mentions légales des boutiques). Tant qu'ils manquent, les pages légales l'affichent.
- **Un vrai fournisseur** : avec une clé Stripe de production, les produits du fournisseur de démonstration sont masqués et refusés à la commande (il n'expédie rien). Branchez au moins un fournisseur réel (contrat d'API dans `src/fournisseurs.js`).
- **Réseaux sociaux** : sans application validée par Meta, TikTok et Pinterest, la publication est manuelle (le pilote prépare les textes, le marchand les publie). `SOCIAL_SIMULATION=1` réactive la simulation pour une démonstration.
- **Adresse du vendeur** : une boutique n'accepte aucune commande tant que son adresse n'est pas renseignée (Conformité).

## Réglages ajoutés en novembre 2026

| Variable | Rôle |
|---|---|
| `RDAP_URL` | Registre interrogé pour la disponibilité des domaines (tests). Par défaut : SWITCH (.ch, .li), AFNIC (.fr), Verisign (.com, .net), rdap.org pour les autres. |
| `HEBERGEUR`, `EXPLOITANT_*` | Voir ci-dessus. |
| `SOCIAL_SIMULATION` | `1` : publication et statistiques des réseaux simulées. |

Paiement : la carte partout, TWINT en CHF, Bancontact pour les boutiques belges (Stripe Checkout).

## Limites actuelles (prochaines étapes)

- Sans domaine personnalisé, les boutiques restent servies sur le domaine de l'admin (`/s/<slug>`). Pour plus de sûreté, servez l'admin et les boutiques sur des domaines différents.
- La réservation des domaines (API d'un registrar) et l'API La Poste pour les étiquettes ne sont pas encore branchées ; la disponibilité d'un nom est, elle, vérifiée auprès du registre (RDAP).
- Pas encore de double authentification.
- Abandons par moyen de paiement : à brancher sur les événements du prestataire de paiement.
