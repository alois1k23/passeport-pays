# API Comptoir (v1)

Avec l'API, un outil peut lire vos commandes, vos produits et vos clients. Il peut aussi marquer une commande comme expédiée et mettre à jour un prix ou un stock. C'est utile pour une comptabilité (Bexio, Abacus, Pennylane), un entrepôt, ou des automatisations Zapier et Make.

Les webhooks font l'inverse : Comptoir prévient votre outil dès qu'il se passe quelque chose, par exemple une commande payée ou un produit épuisé.

L'API et les webhooks sont inclus dans la formule **Croissance**.

## Clés d'API

Vous créez les clés dans **Paramètres > Intégrations**. Une clé n'est affichée qu'une fois, au moment où vous la créez : copiez-la tout de suite. Vous pouvez avoir 10 clés actives au plus.

Chaque clé n'a que les permissions que vous lui donnez :

| Permission | Ce qu'elle autorise |
|---|---|
| `commandes:lecture` | Lire les commandes |
| `commandes:ecriture` | Marquer une commande comme expédiée |
| `produits:lecture` | Lire les produits |
| `produits:ecriture` | Modifier un prix, un stock ou la visibilité d'un produit |
| `clients:lecture` | Lire les clients (nom, e-mail, nombre de commandes, total) |

Chaque appel envoie la clé dans l'en-tête `Authorization` :

```
Authorization: Bearer cpt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Une clé est limitée à 300 requêtes par minute. Au-delà, l'API répond `429`.

Une clé révoquée cesse de fonctionner immédiatement. L'API répond aussi `402` quand l'abonnement est inactif ou que la formule n'inclut plus l'API.

Les erreurs sont renvoyées en JSON, sous la forme `{ "erreur": "message", "code": "…" }`.

## Points d'accès

L'adresse de base est `https://<votre-instance>/api/v1`. Elle s'affiche aussi dans Paramètres > Intégrations.

### Commandes

`GET /commandes` liste les commandes, de la plus ancienne à la plus récente. Paramètres :

- `depuis` : une date ISO 8601 ;
- `statut` : par exemple `payee` ;
- `limite` : entre 1 et 100, 50 par défaut.

La réponse a la forme `{ "donnees": [...], "suite": "<date>" | null }`. Pour lire la page suivante, rappelez avec `depuis=<suite>`.

`GET /commandes/:numero` renvoie une commande.

`POST /commandes/:numero/expedier` marque une commande payée comme expédiée et envoie l'e-mail d'expédition au client. Le corps est `{ "suivi": "99.00.123456.12345678", "transporteur": "Poste" }`. Une commande en dropshipping ou en retrait en magasin ne s'expédie pas par l'API : l'API répond `409`.

Exemple de commande :

```json
{
  "id": "…", "numero": 1042, "date": "2026-11-12T09:14:03.000Z", "statut": "payee",
  "total": 89.9, "sousTotal": 82.9, "remise": 0, "port": 7, "devise": "CHF",
  "livraison": "poste-eco", "canal": "web", "moyen": "en_ligne", "facture": "FA-2026-0042",
  "suivi": null, "transporteur": null,
  "client": { "nom": "Pia Muster", "email": "pia@exemple.ch", "adresse": "Marktgasse 28", "npa": "9400", "ville": "Rorschach" },
  "lignes": [{ "produitId": "…", "nom": "Vase en grès", "qte": 1, "prix": 82.9, "type": "stock" }]
}
```

Les statuts possibles :

- `attente` : en attente de paiement ;
- `payee` ;
- `preparation` ;
- `fournisseur` : transmise au fournisseur ;
- `expediee` ;
- `livree` ;
- `retiree` : retirée en magasin ;
- `remboursee` ;
- `annulee`.

### Produits

`GET /produits` liste les produits.

`PATCH /produits/:id` modifie un produit. Le corps contient un ou plusieurs de ces champs : `{ "prix": 39.9, "stock": 12, "actif": true }`. Le stock d'un produit en dropshipping vient du fournisseur et ne se modifie pas.

### Clients

`GET /clients` liste les clients qui ont au moins une commande payée : e-mail, nom, nombre de commandes, total dépensé et date de la dernière commande.

## Webhooks

Ajoutez une adresse `https://` dans **Paramètres > Intégrations** et choisissez les événements à recevoir :

- `commande.payee`
- `commande.expediee`
- `commande.livree`
- `commande.remboursee`
- `commande.annulee`
- `commande.retiree`
- `produit.rupture`

Pour chaque événement, Comptoir envoie une requête `POST` en JSON :

```json
{ "id": "evt_…", "type": "commande.payee", "cree": "2026-11-12T09:14:05.120Z", "donnees": { "…": "la commande, au même format que l'API" } }
```

Ces en-têtes accompagnent chaque envoi :

- `Comptoir-Evenement` : le type d'événement ;
- `Comptoir-Id` : l'identifiant de l'événement, à mémoriser pour ignorer un éventuel double envoi ;
- `Comptoir-Signature` : `t=<horodatage>,v1=<signature>`.

**Vérifier la signature.** La signature `v1` est un HMAC-SHA256, en hexadécimal, de la chaîne `<t>.<corps brut>`. La clé de calcul est le secret `whsec_…` affiché une seule fois quand vous créez le webhook. Refusez un appel si la signature ne correspond pas ou si `t` date de plus de 5 minutes.

```js
const crypto = require('crypto');
function verifier(corpsBrut, entete, secret) {
  const { t, v1 } = Object.fromEntries(entete.split(',').map(x => x.split('=')));
  const attendu = crypto.createHmac('sha256', secret).update(`${t}.${corpsBrut}`).digest('hex');
  const ok = v1 && v1.length === attendu.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(attendu));
  return ok && Math.abs(Date.now() / 1000 - Number(t)) < 300;
}
```

**Réponses et nouveaux essais.** Votre outil doit répondre par un code `2xx` en moins de 10 secondes. Les redirections ne sont pas suivies.

Si votre outil ne répond pas correctement, Comptoir réessaie 10 fois, à intervalles croissants, pendant environ 8 heures. Après 50 échecs de suite, le webhook est mis en pause. Vous le réactivez depuis Paramètres > Intégrations, où s'affichent aussi les derniers envois.

Les envois sont gardés en file d'attente : un redémarrage du serveur ne fait perdre aucun événement.

**Sécurité.** Les adresses internes sont refusées, à l'enregistrement comme à chaque envoi. Cela comprend localhost, les réseaux privés et les adresses réservées.

## Données personnelles

L'API donne accès au nom, à l'e-mail et à l'adresse de vos clients. N'accordez la permission `clients:lecture`, et la lecture des commandes, qu'à des outils de confiance, liés à vous par un contrat de sous-traitance (RGPD, nLPD).
