# Rapport : 100 boutiques de dropshipping créées et contrôlées

Date : 10 novembre 2026. Simulation réelle : un script a joué 100 clients qui créent leur boutique de dropshipping de A à Z dans un vrai navigateur (Chromium), sur un vrai serveur Comptoir, puis un acheteur a commandé sur chaque boutique. Deux passages complets ont été faits : le premier pour trouver les erreurs, le second pour vérifier les corrections.

## Les 100 boutiques

- **Pays** : 70 en Suisse (CHF), 20 en France, 10 en Belgique (EUR).
- **Niches** : les 9 proposées à l'inscription, à parts égales (maison, animaux, tech, déco, mode, beauté, épicerie, sport, bijoux).
- **Écrans** : ordinateur, portable, tablette, iPhone, petit Android ; un tiers en mode sombre.
- **4 niveaux de complexité, 25 boutiques chacun** :

| Niveau | Ce que fait le client | Produits en moyenne |
|---|---|---|
| Simple | Inscription, et c'est tout | 3 |
| Standard | + 3 produits importés du catalogue fournisseurs, thème et section FAQ, domaine, adresse et e-mail de l'entreprise | 6 |
| Avancée | + 6 produits, prix barré, 3 sections ajoutées, section déplacée et section supprimée, code promo, offre complémentaire, compte TikTok et planning de publications | 9 |
| Très complexe | + 12 produits (entrepôts de Chine compris), produit vendu sous son coût, produit personnel à 1 234,50 avec une description de 2 000 caractères, 7 sections, titre de 250 caractères avec émoji et balises, Instagram et TikTok, test publicitaire avec résultats, campagne du copilote validée, modèle « mixte » pour certaines | 16 |

**Contrôles pour chaque boutique** :
- **Administration** : les 18 écrans, à la recherche d'erreurs JavaScript, de textes techniques (undefined, NaN), de pages vides ou de défilement horizontal.
- **Boutique publique** : la vitrine et la fiche produit.
- **Achat de bout en bout** : un acheteur sur un autre appareil remplit son panier, choisit une livraison, applique un code promo et paie.
- **Après l'achat, côté marchand** : transmission au fournisseur, expédition, numéro de suivi, facture, e-mails, et total identique à celui payé.
- **Contenu de la boutique en ligne** : informations légales, contact, doublons, descriptions, délais, et validité des codes promo affichés.

## Ce qui fonctionne bien

- **100 inscriptions sur 100**, devise correcte selon le pays.
- **Aucune erreur JavaScript** et aucun texte technique sur 1 800 affichages d'écrans d'administration (100 boutiques × 18 écrans), toutes tailles d'écran confondues, y compris avec des textes extrêmes.
- **100 commandes payées sur 100**. Le total affiché au client est identique au total enregistré, remises (paliers, codes, offres) comprises.
- **Dropshipping de bout en bout** (second passage) :
  - toutes les commandes de produits fournisseurs sont transmises automatiquement ;
  - 100 sur 100 sont expédiées, avec un numéro de suivi La Poste ;
  - 100 factures numérotées sans trou ;
  - e-mails « confirmée » et « en route » envoyés.
- **Commandes « mixtes »** : les produits en stock propre restent « à préparer » par le marchand, sans être envoyés au fournisseur à tort.
- **Saisies du client conservées** dans le panier (changement de livraison, code promo), date de livraison estimée sur la confirmation.

## Ce qui n'allait pas, et ce qui a été modifié

| # | Problème constaté | Boutiques touchées | Modification |
|---|---|---|---|
| 1 | **Boutiques vides.** Les niches déco, mode, épicerie et bijoux n'avaient aucun produit dans le catalogue fournisseurs : une boutique de dropshipping créée dans ces niches démarrait sans rien à vendre. | 4 niches sur 9 (≈ 44 % des inscriptions) | 21 produits ajoutés au catalogue (interface et serveur, mêmes références pour la transmission). Chaque niche a désormais au moins 4 produits, d'entrepôts suisses, européens et chinois. Vérifié : écharpes, thés, bijoux… transmis et expédiés au second passage. |
| 2 | **Code promo affiché mais refusé.** La bannière de saison créée par défaut montrait « BLACKFRIDAY15 », un code qui n'existait pas : refusé au paiement. Promesse non tenue envers les clients. | 75 sur 100 | Plus de code inventé par défaut. Un code inconnu n'est jamais affiché aux clients (le serveur le retire), et l'éditeur prévient le marchand (« inconnu : créez-le dans Conversion »). Le code apparaît quand une campagne du copilote est validée. Vérifié : 0 cas au second passage. |
| 3 | **Contact d'exemple en ligne.** Le pied de page de chaque boutique affichait `bonjour@exemple.ch`. | 100 sur 100 | Le pied de page utilise l'e-mail de l'entreprise (celui de l'inscription), y compris pour les boutiques déjà créées. |
| 4 | **Produits fictifs mis en vente.** En modèle « stock » ou « mixte », les produits d'exemple (pull, bougie, lampe…) étaient en ligne d'emblée, avec une description d'une ligne, alors que le marchand ne les possède pas forcément. Certains avaient le même nom qu'un produit fournisseur (doublons). | Toutes les boutiques mixtes ; 2 doublons | Produits d'exemple masqués et marqués « À vérifier », refusés à la commande, description explicite (« remplacez ce texte, la photo, le prix et le stock »), jamais le même nom qu'un produit du catalogue. Rappel dans la Vue d'ensemble. Vérifié : 0 doublon, 0 description trop courte au second passage. |
| 5 | **Belgique traitée comme la France.** TVA à 20 % au lieu de 21 %, « SIRET », mention « art. 293 B du CGI » sur les factures, formes juridiques françaises, calendrier commercial français. | 10 sur 100 | Règles par pays : TVA 21 %, numéro d'entreprise (BCE), franchise des petites entreprises, formes belges (SRL, SA…), indemnité de recouvrement française retirée. Calendrier : soldes le 3 janvier et le 1er juillet, fêtes des mères et des pères le 2e dimanche, Saint-Nicolas. Serveur aligné (TVA 21 %). |
| 6 | **Vente à perte peu visible.** Un produit vendu sous son coût n'apparaissait qu'en rouge dans la liste des produits. | 25 (niveau très complexe) | La Vue d'ensemble affiche « Vendu à perte : nom (perte par vente) » dans « À faire ». |
| 7 | **Boutique en ligne sans adresse légale**, sans que le marchand soit prévenu clairement. | 25 (niveau simple) | Rappel dans « À faire » : « Indiquer l'adresse de l'entreprise (Impressum / mentions légales, obligatoire pour vendre en ligne) ». |
| 8 | **Produits sans photo.** | 100 sur 100 | Le catalogue de démonstration n'a pas de photos (limite de la démo) ; rappel « N produits sans photo » dans « À faire ». Un vrai fournisseur les fournira par son API. |

## Points vérifiés et laissés tels quels

- Les commandes de boutiques « mixtes » qui restent « à préparer » : correct, ce sont des produits du stock du marchand, qu'il expédie lui-même.
- Le fournisseur de démonstration expédie 2 minutes après la commande (pour imiter un vrai délai) ; au premier passage, les 80 commandes de plus de 2 minutes étaient bien expédiées, les autres sont parties ensuite.
- Les produits venant de Chine (10 à 20 jours) restent proposés à ceux qui cochent l'entrepôt Chine ; « Trouver des produits » prévient qu'en Suisse le client peut payer la TVA et le dédouanement.

## Limites honnêtes

- Paiement, e-mails, réseaux sociaux et fournisseur sont simulés (aucun appel à Stripe, TWINT, Brevo ou à un vrai fournisseur).
- Un script détecte les erreurs, les incohérences et les textes problématiques ; il ne juge pas le ressenti d'un vrai client. Quelques tests avec de vrais marchands restent indispensables.
- Les deux passages ont utilisé des bases séparées dans un dossier temporaire ; rien n'a été écrit dans la base du projet.

## Relancer

```
cd comptoir/server && DEMO_DELAI_EXPEDITION_MS=3000 LIMITE_ESSAIS=1000 BASE_DE_DONNEES=/tmp/sim.db npm start
node ../outils/simulation/boutiques-drop.js http://localhost:3000 /tmp/captures 100 > drop.json   # nécessite Playwright
node ../outils/simulation/resume.js ./drop.json
node ../outils/simulation/audit-boutiques.js http://localhost:3000 /tmp/sim.db
```
