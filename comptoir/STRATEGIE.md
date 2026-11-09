# Comptoir : plan stratégique

*Rédigé du point de vue de la direction. Les chiffres marqués « hypothèse » sont à valider sur le terrain avant toute levée de fonds ou tout recrutement.*

## 1. La conviction

Les grandes plateformes de boutique en ligne sont faites pour le monde entier. Elles donnent des outils et laissent le marchand se débrouiller. Le petit commerçant français y perd sur trois points :

1. **Le temps.** Il rate les temps forts (Black Friday, Noël, fête des mères), faute d'avoir préparé sa campagne à l'avance.
2. **La paperasse.** Factures, CGV, mentions légales, TVA, RGPD, et bientôt la facture électronique obligatoire.
3. **La boutique physique.** Le site et le magasin vivent séparés : deux stocks, et une fiche Google à jour à la main.

**Comptoir veut être la plateforme du commerce indépendant français, en ligne et en boutique, et faire le travail à la place du marchand.**

On ne cherche pas à être « Shopify en moins cher ». On veut être la plateforme qui prépare votre Noël pendant que vous servez vos clients.

## 2. Le client cible (la tête de pont)

| | |
|---|---|
| **Qui** | Artisans, créateurs et commerces de proximité indépendants, de 0 à 5 salariés, qui ont **une boutique physique ou des marchés** et veulent vendre aussi en ligne |
| **Secteurs de départ** | Décoration et bougies, épicerie fine, cosmétique naturelle, bijoux créateurs, mode indépendante |
| **Leur problème** | « Je n'ai pas le temps », « Je ne suis pas informaticien », « J'ai peur de ne pas être en règle » |
| **Pourquoi eux** | Fort besoin de saisonnalité, besoin de la boutique physique, sensibles au service en français, et faciles à atteindre par des réseaux locaux |

Les autres segments (pur e-commerce, dropshipping, grandes marques) viennent plus tard, ou jamais.

## 3. Ce qui nous distingue (déjà dans la démo)

| Atout | Ce que voit le marchand | Pourquoi c'est difficile à copier |
|---|---|---|
| **Copilote de saison** | Chaque temps fort arrive avec une campagne prête : produits, prévision de ventes, alertes de stock, bannière, code promo, e-mail, post Instagram, domaine de campagne et planning. Il valide en un clic. Un bilan suit chaque temps fort. | Il faut le calendrier commercial français, les données de chaque boutique et une conception pensée pour l'action, pas pour le tableau de bord |
| **Conformité française incluse** | Factures numérotées sans rupture, TVA ou franchise en base, CGV et mentions légales générées, bandeau cookies conforme, préparation à la facture électronique | Les plateformes mondiales ajoutent la France par extensions tierces |
| **Boutique + magasin** | Caisse, stock unique, click & collect, QR code de vitrine, fiche Google synchronisée | Un vrai produit à part, souvent vendu en option ailleurs |
| **Création par photo** | Le marchand photographie ses produits, les fiches s'écrivent toutes seules | Indispensable, mais pas différenciant à lui seul |
| **Domaines intelligents** | Domaine choisi selon la demande, la saison et les ventes | Petit atout, mais très démonstratif |
| **Un humain au démarrage** | 30 minutes en visio pour lancer la boutique | Ne passe pas à l'échelle chez les géants. Pour nous, c'est un avantage au début |

## 4. Modèle économique

| Formule | Prix (HT/mois) | Pour qui |
|---|---|---|
| Atelier | 19 € | Créateur seul, vente en ligne |
| **Commerce** | **39 €** | Boutique physique + en ligne (cœur de cible) |
| Maison | 79 € | Plusieurs points de vente, équipe |

- **0 % de commission Comptoir** sur les ventes. Les revenus de paiement viennent d'une petite marge sur les frais bancaires (via Stripe Connect), affichée clairement.
- Revenus annexes : domaines (marge registrar), étiquettes d'envoi, terminal de paiement en boutique.
- **Hypothèses à valider** : un revenu moyen d'environ 40 € par marchand et par mois, moins de 3 % de désabonnements mensuels, un coût d'acquisition qui ne dépasse pas 6 mois d'abonnement.

## 5. Conquête du marché

**Principe : gagner une ville et un secteur, puis répliquer.** On ne se bat pas en publicité contre des budgets mondiaux.

1. **Phase pilote (mois 0 à 6)** : 30 boutiques à Lyon (hypothèse de ville de départ), accompagnées à la main et gratuitement contre des retours chaque semaine. Objectif : prouver que le copilote augmente le CA des temps forts.
2. **Réseaux de confiance** : chambres de métiers et de l'artisanat, CCI, unions commerciales de quartier, associations de créateurs, marchés de Noël. Ateliers « Préparez votre Noël en 1 h ».
3. **Experts-comptables** : programme partenaire (factures et export comptable propres = moins de travail pour eux). Chaque cabinet a des dizaines de commerçants.
4. **Parrainage** : 1 mois offert au parrain et au filleul. Les commerçants d'une même rue se parlent.
5. **Contenu saisonnier** : un calendrier commercial français gratuit et des modèles de campagne. Cela attire du trafic de recherche toute l'année, avec un pic avant chaque temps fort.
6. **Lancements calés sur la saison** : les grosses campagnes d'acquisition en septembre et octobre, quand les commerçants pensent à Noël.

## 6. Feuille de route produit

| Période | Livrables |
|---|---|
| **0–3 mois** | Back-end (comptes, multi-boutiques, base PostgreSQL), paiement Stripe Connect, vrai domaine via l'API d'un registrar, hébergement des boutiques derrière un CDN, e-mails transactionnels |
| **3–6 mois** | Copilote branché sur de vraies données (Search Console, tendances de recherche), envoi réel des e-mails et publications Instagram, étiquettes Colissimo / Mondial Relay via leurs API, factures Factur-X |
| **6–12 mois** | Application caisse sur tablette et terminal de paiement, synchronisation Google Business Profile, fiches produits par photo avec un modèle de vision, raccordement à une plateforme agréée pour la facture électronique |
| **12–18 mois** | Application mobile marchand, Belgique et Suisse, programme partenaires comptables, place de marché locale « commerces de ma ville » |

## 7. Indicateurs suivis chaque semaine

- **Activation** : part des boutiques qui font une première vente sous 14 jours
- **Copilote** : part des campagnes validées et CA des temps forts comparé à l'année précédente
- **Rétention** : désabonnements mensuels, en cible sous 3 %
- **Satisfaction** : NPS et délai de réponse du support
- **Économie** : coût d'acquisition, revenu moyen par marchand, délai de rentabilité d'un client

## 8. Équipe et moyens

- **Départ (fondateurs + 3)** : 2 développeurs full-stack, 1 responsable succès client (accompagnement, ateliers).
- **Après la phase pilote** : produit et design, commercial terrain, partenariats.
- **Financement** : *love money* ou bourse French Tech pour la phase pilote, puis levée d'amorçage sur la base des résultats des 30 premières boutiques.

## 9. Risques et réponses

| Risque | Réponse |
|---|---|
| Une grande plateforme copie le copilote | Avance sur les données locales, la conformité et le service humain ; vitesse d'exécution sur une niche |
| Coût d'accompagnement trop élevé | Accompagnement humain limité à 30 min, puis contenus et ateliers collectifs |
| Évolution du calendrier de la facture électronique | Passer par une plateforme agréée partenaire plutôt que le faire nous-mêmes |
| Petits commerçants peu solvables | Essai gratuit court, formule d'entrée à 19 €, valeur visible dès le premier temps fort |

## 10. Les prochaines décisions

1. Choisir la ville et les 2 secteurs pilotes.
2. Faire 20 entretiens de commerçants avec la démo. Questions clés : quel temps fort ils ont raté, combien de temps ils passent sur la paperasse, combien ils paieraient.
3. Signer 2 partenariats locaux (CMA, union commerciale ou cabinet comptable).
4. Lancer le back-end et le paiement réel.
