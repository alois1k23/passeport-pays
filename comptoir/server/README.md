# Serveur Comptoir

Serveur Node.js **sans aucune dépendance** : HTTP, base SQLite et chiffrement viennent de Node (version 22.13 ou plus récente).

```bash
cd comptoir
npm start          # http://localhost:3000
npm test           # 11 tests de bout en bout
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

## Mise en ligne

- **Docker** : `docker build -t comptoir . && docker run -p 3000:3000 -v comptoir-data:/data --env-file .env comptoir`
- Hébergement en Suisse possible chez Infomaniak, Exoscale ou un VPS. Placez la base sur un disque persistant et sauvegardez-la chaque jour.
- HTTPS obligatoire. Le cookie passe automatiquement en `Secure` quand `URL_PUBLIQUE` commence par `https://`.
- En production (`NODE_ENV=production`), la page de paiement simulé est désactivée.

## Limites actuelles (prochaines étapes)

- Les boutiques sont servies sur le même domaine que l'admin (`/s/<slug>`). Pour les domaines personnalisés (`.ch`), il faut servir chaque boutique sur son propre domaine : c'est aussi plus sûr.
- Les e-mails ne sont pas encore envoyés : il faut brancher un service d'envoi (Postmark, Brevo, Infomaniak).
- La réservation des domaines (API d'un registrar) et l'API La Poste pour les étiquettes ne sont pas encore branchées.
- Pas encore de réinitialisation de mot de passe ni de double authentification.
