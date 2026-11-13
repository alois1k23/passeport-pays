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
| `clients:lecture` | Données personnelles des clients : nom, e-mail, adresse (dans les commandes et dans `/clients`) |

Chaque appel envoie la clé dans l'en-tête `Authorization` :

```
Authorization: Bearer cpt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Une clé est limitée à 300 requêtes par minute, et une boutique à 600 requêtes par minute toutes clés confondues. Au-delà, l'API répond `429`.

Sans la permission `clients:lecture`, une commande ne contient que le pays de livraison du client : ni nom, ni e-mail, ni adresse. Un entrepôt qui expédie a donc besoin de cette permission ; un outil de statistiques, non.

Une clé révoquée cesse de fonctionner immédiatement. L'API répond aussi `402` quand l'abonnement est inactif ou que la formule n'inclut plus l'API.

Les erreurs sont renvoyées en JSON, sous la forme `{ "erreur": "message", "code": "…" }`.

## Points d'accès

L'adresse de base est `https://<votre-instance>/api/v1`. Elle s'affiche aussi dans Paramètres > Intégrations.

### Commandes

`GET /commandes` liste les commandes. Paramètres :

- `tri` : `creation` (par défaut, de la plus ancienne à la plus récente) ou `modification` (ordre de dernière modification, pour une synchronisation incrémentale : une commande qui passe de payée à expédiée réapparaît) ;
- `depuis` : une date ISO 8601, incluse ;
- `apres` : le curseur `suite` reçu à la page précédente ;
- `statut` : par exemple `payee`. Sans ce paramètre, les commandes en attente de paiement (paniers abandonnés) ne sont pas listées ;
- `limite` : entre 1 et 100, 50 par défaut.

La réponse a la forme `{ "donnees": [...], "suite": "<curseur>" | null }`. Pour lire la page suivante, rappelez avec `apres=<suite>` et le même `tri`. Aucune commande n'est sautée ni répétée, même si plusieurs ont été créées à la même milliseconde. Chaque commande porte aussi `modifiee`, la date de sa dernière modification.

`GET /commandes/:numero` renvoie une commande.

Chaque commande indique aussi :
- `rembourse` : argent réellement rendu, avoirs compris (une facture QR annulée avant paiement donne 0) ;
- par ligne, `rendu` : unités déjà rendues (retours partiels) ;
- `avoirs` : la liste des avoirs émis, avec pour chacun `numero`, `date`, `type` et `montant`. `type` vaut `partiel` (retour d'une partie des articles), `geste` (geste commercial, sans retour d'article), `final` (remboursement du reste) ou `annulation` (facture annulée avant tout paiement : rien n'est remboursé). Chaque avoir a aussi `lignes` et `livraison` : pour un avoir partiel, `lignes` détaille les articles (`nom`, `qte`, `montant`) ; pour un geste, `lignes` est vide ; pour un avoir final ou une annulation, `lignes` et `livraison` valent `null` (l'avoir porte tout ce qui restait).

La somme des avoirs ne dépasse jamais le total de la facture. Elle l'égale exactement quand la commande est entièrement remboursée.

`POST /commandes/:numero/expedier` marque une commande payée comme expédiée et envoie l'e-mail d'expédition au client. Le corps est `{ "suivi": "99.00.123456.12345678", "transporteur": "Poste" }`. Une commande en dropshipping ou en retrait en magasin ne s'expédie pas par l'API : l'API répond `409`.

Les corps de requête sont des objets JSON. Les clés `__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `toJSON`, `toLocaleString` et `hasOwnProperty` y sont ignorées, à toute profondeur : n'en utilisez pas comme noms de champs.

Exemple de commande :

```json
{
  "id": "…", "numero": 1042, "date": "2026-11-12T09:14:03.000Z", "statut": "payee",
  "total": 89.9, "sousTotal": 82.9, "remise": 0, "port": 7, "devise": "CHF",
  "livraison": "poste-eco", "canal": "web", "moyen": "en_ligne", "facture": "FA-2026-0042",
  "suivi": null, "transporteur": null,
  "client": { "nom": "Pia Muster", "email": "pia@exemple.ch", "adresse": "Marktgasse 28", "npa": "9400", "ville": "Rorschach", "pays": "ch" },
  "lignes": [{ "produitId": "…", "nom": "Vase en grès", "qte": 1, "prix": 82.9, "type": "stock", "rendu": 0 }],
  "avoirs": [], "rembourse": 0
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

`PATCH /produits/:id` modifie un produit. Le corps contient un ou plusieurs de ces champs : `{ "prix": 39.9, "stock": 12, "actif": true }`. Le prix est un nombre positif, le stock un entier positif ou nul, `actif` un vrai booléen (`true` ou `false`, pas `"false"`). Un stock mis à zéro déclenche l'événement `produit.rupture`.

**Produits à variantes** (tailles, couleurs) : `GET /produits` renvoie `options` et `variantes` (`id` = combinaison, ex. `M/Noir` ; `valeurs`, `stock`, `prix`). Le stock se met à jour variante par variante : `{ "variantes": [{ "id": "M/Noir", "stock": 12 }, { "id": "L/Noir", "prix": 39.9 }] }` (`"prix": null` revient au prix du produit). Le champ `stock` seul est refusé pour un tel produit (le stock total est la somme des variantes). Les lignes de commande d'une variante portent `varianteId`. Le stock d'un produit en dropshipping vient du fournisseur et ne se modifie pas.

### Clients

`GET /clients` liste les clients qui ont au moins une commande payée : e-mail, nom, nombre de commandes, total dépensé et date de la dernière commande.

## Webhooks

Ajoutez une adresse `https://` dans **Paramètres > Intégrations** et choisissez les événements à recevoir :

- `commande.payee`
- `commande.expediee`
- `commande.livree`
- `commande.remboursee`
- `commande.remboursement_partiel` : une partie des articles a été remboursée (retour partiel). `donnees` contient la commande (sans données personnelles du client), plus `avoir` (numéro de l'avoir), `montant`, `geste` (`true` pour un geste commercial sans retour d'article) et `lignesRendues` (`nom`, `qte`, `montant`).
- `commande.annulee`
- `commande.retiree` : retrait en magasin et ventes à la caisse
- `produit.rupture` : stock tombé à zéro, quelle qu'en soit la cause (vente en ligne, caisse, API)
- `journal.cloture` : clôture quotidienne du journal inaltérable des ventes. `donnees` contient `jour`, `empreinte`, `pieces`, `totalJour`, `grandTotal` (en unités de la devise) et `devise`. Gardez ces empreintes : elles prouvent que vos ventes n'ont pas été réécrites depuis. Les clôtures faites pendant une période sans accès à l'API (formule sans API, abonnement terminé) ne sont pas renvoyées ensuite : l'export du journal dans Conformité les contient toutes.
- `devis.accepte` : un client professionnel a accepté un devis en ligne. `donnees` contient `id`, `numero`, `total`, `devise`, `accepteLe`, `commande` (`id`, `numero` de la commande créée) et `client` (`raison`, `email`).
- `carte.emise` : une carte cadeau a été émise (vendue en ligne ou créée par le marchand). `donnees` contient `id`, `fin` (4 derniers caractères), `montant`, `devise`, `expireLe`, `origine` (`vente` ou `manuelle`) et, pour une vente, `commande`. **Le code de la carte n'est jamais envoyé.**
- `stock.transfert` : des articles ont été déplacés d'un emplacement de stock à un autre. `donnees` contient `produit` (`id`, `nom`), `varianteId`, `de`, `vers` (identifiants d'emplacements) et `quantite`.

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

**Réponses et nouveaux essais.** Votre outil doit répondre par un code `2xx` en moins de 10 secondes. Les redirections ne sont pas suivies. Le bouton « Envoyer un test » envoie tout de suite un événement `test` et affiche la réponse reçue.

Si votre outil ne répond pas correctement, Comptoir réessaie 15 fois, à intervalles croissants, pendant environ 40 heures. Si aucune réponse réussie n'arrive pendant 3 jours, le webhook est mis en pause. Les événements continuent alors d'être gardés en file, jusqu'à 30 jours, et repartent dès que vous réactivez le webhook dans Paramètres > Intégrations, où s'affichent aussi les derniers envois.

Les envois sont gardés en file d'attente : un redémarrage du serveur ne fait perdre aucun événement.

**Doublons et ordre.** Un événement peut arriver deux fois, par exemple si votre réponse s'est perdue. Mémorisez `Comptoir-Id` et ignorez un identifiant déjà traité. L'ordre d'arrivée n'est pas garanti non plus : un `commande.payee` réessayé peut arriver après le `commande.expediee`. Fiez-vous au `statut` de la commande, ou relisez-la par l'API.

**Formule et abonnement.** Si la formule ne comprend plus l'API, ou si l'abonnement prend fin, plus aucun événement n'est envoyé et les clés cessent de fonctionner. Vous pouvez toujours révoquer les clés et supprimer les webhooks.

**Sécurité.** Les adresses internes sont refusées, à l'enregistrement comme à chaque envoi : localhost, les réseaux privés, les adresses réservées, ainsi que leurs formes IPv6. La connexion se fait vers l'adresse vérifiée, donc un DNS qui changerait de réponse entre le contrôle et l'envoi ne peut pas viser l'intérieur.

## Données personnelles

L'API donne accès au nom, à l'e-mail et à l'adresse de vos clients. N'accordez la permission `clients:lecture` qu'à des outils de confiance, liés à vous par un contrat de sous-traitance (RGPD, nLPD). Les webhooks contiennent ces données : n'enregistrez que des adresses de confiance. Quand vous effacez les données d'un client (Clients > Effacer), ses données disparaissent aussi des envois gardés en file.
