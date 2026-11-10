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
| **Comptes** | Inscription et connexion. Mots de passe hachés avec scrypt. Session dans un cookie HttpOnly et SameSite=Lax ; la base ne stocke que l'empreinte du jeton. 10 essais de connexion par quart d'heure et par IP. |
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

## Brancher les vrais services

### Paiement TWINT et cartes (Stripe)
1. Créez un compte Stripe au nom de l'entreprise suisse et activez TWINT dans les moyens de paiement (CHF uniquement).
2. Définissez `STRIPE_SECRET_KEY` et `URL_PUBLIQUE`.
3. Dans Stripe, ajoutez un webhook vers `https://<votre-domaine>/api/webhooks/stripe` pour l'événement `checkout.session.completed`, puis copiez son secret dans `STRIPE_WEBHOOK_SECRET`.

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

## Limites actuelles (prochaines étapes)

- Sans domaine personnalisé, les boutiques restent servies sur le domaine de l'admin (`/s/<slug>`). Pour plus de sûreté, servez l'admin et les boutiques sur des domaines différents.
- La réservation des domaines (API d'un registrar) et l'API La Poste pour les étiquettes ne sont pas encore branchées.
- Pas encore de double authentification.
- Abandons par moyen de paiement : à brancher sur les événements du prestataire de paiement.
