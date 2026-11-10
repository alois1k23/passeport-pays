# Recherche : tests publicitaires, scaling et contenu court pour petites boutiques e-commerce

Recherche web du 10.11.2026. Légende de fiabilité : **[OFF]** = source officielle de la plateforme ou d'un régulateur ; **[PRA]** = praticien reconnu, publication propre ; **[BLOG]** = agrégateur, vendeur ou résumé de seconde main, à vérifier. Quand un chiffre n'a pas pu être confirmé à la source, c'est indiqué.

Note préalable : le « Power 5 » (2019) est un cadre **de Facebook** : simplification du compte, CBO, placements automatiques, Auto Advanced Matching, Dynamic Ads. Il n'est pas de Foxwell. Je n'ai trouvé aucun texte publié de Charley Tichenor sur ce sujet. [BLOG] https://disruptiveadvertising.com/ppc/facebook-power-5/ ; https://www.socialmediaexaminer.com/facebook-power-5-ad-tools-what-marketers-need-to-know/

## 1. Structure du compte et tests

- **Phase d'apprentissage Meta.** Un ensemble de publicités passe en « Learning limited » s'il ne reçoit probablement pas **environ 50 événements d'optimisation dans la semaine qui suit la dernière modification importante**. Sont des modifications importantes : le ciblage, la créa, l'événement d'optimisation et une mise en pause. Un changement de budget ou d'enchère n'en est une que s'il est « assez grand ». Meta ne publie **aucun pourcentage**. Pour sortir de « Learning limited », Meta conseille d'augmenter le budget ou l'enchère. [OFF] https://www.facebook.com/business/help/112167992830700 ; https://en-gb.facebook.com/business/help/269269737396981 ; https://developers.meta.com/vr/resources/optimize-ad-campaign/ (2024-2026)
- **Juger après environ 50 événements.** Meta conseille d'attendre la fin de l'apprentissage avant d'analyser le coût par résultat. [OFF] https://www.facebook.com/business/help/137367863615674
- **TikTok.** Le signe le plus fiable de sortie d'apprentissage est **50 conversions en une semaine**. Une page d'aide recommande de ne rien modifier avant **20 conversions**. Les règles de budget se contredisent selon les pages : budget quotidien ≥ **10× le CPA visé** dans l'aide en ligne, ≥ **50× le CPA** dans le guide PDF « Web Auction ». [OFF] https://ads.tiktok.com/help/article/learning-phase ; https://ads.tiktok.com/resources/help/article/learning-phase-faq ; https://ads.tiktok.com/business/library/Web_Auction_Best_Practices_Guide.pdf
- **TikTok, nombre de créas.** **3 à 5 créas par groupe d'annonces** et **3 à 5 groupes d'annonces par campagne**. Les créas testées doivent être très différentes les unes des autres. On ajoute les nouvelles créas dans le groupe existant plutôt que d'en créer un nouveau. [OFF] https://ads.tiktok.com/help/article/creative-best-practices
- **Meta Advantage+ sales**, ex-« Advantage+ shopping ». La campagne teste jusqu'à **150 combinaisons de créas**, contre 50 en configuration manuelle. Meta recommande d'importer toutes les publicités existantes éligibles. [OFF] https://developers.facebook.com/documentation/ads-commerce/marketing-api/advantage-shopping-campaigns ; https://www.facebook.com/business/ads/meta-advantage/advantage-plus-shopping-ads
- **Andromeda et la diversité des créas.** D'après Meta, ajouter des créas variées aide son moteur de sélection des publicités à associer la bonne créa à chaque personne. Meta conseille de « tester autant de concepts que possible ». Aucun minimum chiffré n'est publié. [OFF] https://www.facebook.com/business/news/ai-innovation-in-metas-ads-ranking-driving-advertiser-performance ; https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/
- **Ben Heath : 2 à 5 publicités par ensemble, 4 idéalement.** Il garde la meilleure publicité, coupe les plus faibles et ajoute les nouvelles créas à côté de la gagnante. [PRA] https://heathmedia.co.uk/how-many-facebook-ads/ (articles anciens)
- **Common Thread Collective (CTC) : pas de budget de test dédié.** Toutes les publicités se disputent chaque franc supplémentaire. Les ensembles « Evergreen » contiennent jusqu'à 50 publicités. CTC ne coupe pas une publicité sur la base de son seul ROAS passé. [PRA] https://commonthreadco.com/pages/methodology-meta (2026)
- **Foxwell.** 10 à 20 % des dépenses consacrés aux tests. [BLOG, non vérifié chez Foxwell] https://segwise.ai/blog/creative-volume-to-scale-meta-ads.md
- **Motion (devenu Runneth), benchmark 2026.** Données : 1,29 Md$ de dépenses Meta, environ 579 000 créas, 6 015 comptes. Une créa « gagnante » dépense au moins 10× la médiane du compte, avec un plancher de 500 $. Environ **5 %** des créas sont gagnantes : **3,7 %** pour les comptes Micro (< 10 k$), **6,2 %** pour les Small (10-50 k$). Environ **50 % de perdantes** est normal. Les comptes Micro testent **environ 3 publicités par semaine**, les comptes Enterprise environ 18. Le quart supérieur des comptes teste 1,5 à 3× plus de créas. [PRA/données] https://runneth.com/library/research/creative-benchmarks-2026/portfolio-breakdown-by-tier ; https://motionapp.com/library/research/creative-benchmarks-2026/top-25-percent

## 2. Règles pour couper, itérer ou scaler

- **Aucune source officielle ne donne la règle « +20 % ».** Meta dit seulement qu'une forte variation de budget *peut* relancer l'apprentissage. Les « 20 % » sont une règle empirique de blogs. [OFF] https://www.facebook.com/business/help/112167992830700 ; [BLOG] https://admanage.ai/blog/facebook-ads-learning-phase-guide
- **Ben Heath : pas de pourcentage fixe.** Il passe sans problème de 10 à 20 £/jour, voire à 30 £ pour une campagne très performante. Il ne passerait jamais de 1 000 à 2 000 £ d'un coup. Plus la dépense est faible, plus le pourcentage d'augmentation peut être grand. Il attend **environ une semaine** entre deux hausses. [PRA] https://heathmedia.co.uk/?p=544687 (résumé via recherche)
- **Jon Loomer, « Slow Burn ».** Une règle automatique augmente le budget de **1 % par jour**, une fois par jour, seulement si le coût par résultat de la veille (ou des 3 ou 7 derniers jours) reste sous un seuil. Un budget maximum plafonne la règle. [PRA] https://www.jonloomer.com/slow-burn-a-strategy-for-scaling-facebook-ads/ (2023, mis à jour en 2025)
- **CTC, scaling en quatre phases, dans l'ordre :**
  1. ajouter des créas diverses ;
  2. dupliquer en enchère plafonnée, avec CPA cible = AOV / ROAS cible ;
  3. lancer une campagne ASC pour les publicités qui dépensent moins de 3× le CPA cible ;
  4. assouplir les contraintes, uniquement si la marge de contribution atteint au moins la prévision. On ne descend **jamais sous le seuil de marge de contribution à l'équilibre**.

  Pour l'acquisition, CTC applique un facteur d'incrémentalité de **1,14×** au ROAS « 7 jours clic » (médiane de 45 tests géographiques). [PRA] https://commonthreadco.com/pages/methodology-meta
- **Couper une publicité.** La règle la plus répandue est **« 3× le CPA cible dépensé sans aucun achat → couper »**. Selon les sources, la variante va de 2× à 5×. Ce n'est pas une règle officielle, et je ne l'ai trouvée chez aucun praticien nommé. [BLOG] https://coinis.com/blog/when-to-kill-meta-ads-decision-framework ; https://27five-website.pages.dev/blog/meta-ads-creative-testing-system-ecommerce
- **Fatigue créative.** Meta la définit comme une surexposition, sans seuil de fréquence officiel. Le seuil « fréquence > 3-4 » vient d'un post non officiel. [OFF] https://www.facebook.com/business/help/1346816142327858 ; [BLOG] https://www.facebook.com/fb-answers/what-creative-refresh-strategies-work-best-for-fashion-brands-running-meta-catalog-ads-continuously-for-more-than-60-days/
- **Diagnostics de pertinence Meta** (classements qualité, engagement et conversion). Ils ne sont disponibles qu'à partir de **500 impressions**. [OFF] https://en-gb.facebook.com/business/help/403110480493160
- **TikTok.** Rafraîchir les créas quand la tendance baisse de façon constante. TikTok ne donne pas de fréquence fixe. [OFF] https://ads.tiktok.com/help/article/creative-best-practices

## 3. Créa : hooks, formats, itération

- **Meta, règle des 3 secondes.** Le message clé ou la marque doit apparaître dans les 3 premières secondes. D'après Meta, 65 % des personnes qui regardent 3 secondes vont jusqu'à au moins 10 secondes. La vidéo doit être compréhensible sans le son. Les annonceurs les plus performants tiennent en moins de 15 secondes. [OFF] https://www.facebook.com/business/news/want-to-better-video-ads-for-mobile-well-show-you-how
- **Meta Reels.** Sur 15 tests A/B, une vidéo 9:16 avec son et éléments clés dans la zone de sécurité a obtenu un coût par résultat **inférieur de 34,5 %** à celui d'une image. Zone de sécurité : laisser libres environ **14 % en haut, 35 % en bas et 6 % sur chaque côté**. [OFF] https://www.facebook.com/business/ads/facebook-instagram-reels-ads ; https://developers.facebook.com/blog/post/2024/11/07/unlock-the-power-of-reel-ads/
- **TikTok :**
  - format 9:16, au moins 720p, son ou musique, contenu dans la zone de sécurité ;
  - **proposition de valeur dans les 3 premières secondes**, hook dans les 6 premières ;
  - texte affiché à **5 à 10 mots par seconde** ;
  - sous-titres et CTA final ;
  - style « DIY / pas trop léché » avec créateurs, employés ou clients ;
  - suivre les tendances.

  [OFF] https://ads.tiktok.com/help/article/creative-best-practices
- **Spark Ads.** Elles diffusent un post organique, le vôtre ou celui d'un créateur, comme publicité. Le créateur génère un code d'autorisation valable **7, 30, 60 ou 365 jours**. On peut saisir jusqu'à 20 codes par lot. [OFF] https://ads.tiktok.com/help/article/spark-ads-creation-guide ; https://ads.tiktok.com/help/article/spark-ads-faq
- **Formats gagnants, Motion 2026** (taux de gagnantes sur Meta) : **Unboxing 9,8 %**, Offer-first banner 8,6 %, **Démo 8,1 %**, Témoignage 6,5 %. Ces données de septembre 2025 à janvier 2026 incluent le Black Friday, ce qui gonfle les formats « offre ». [PRA/données] https://runneth.com/library/research/creative-benchmarks-2026/top-visual-formats
- **Savannah Sanchez :**
  - le hook est le principal levier ;
  - tenir une liste de tous les hooks testés et une liste séparée des meilleurs ;
  - itérer environ 2 nouveaux hooks par mois sur les gagnantes ;
  - texte à l'écran obligatoire, car les vidéos sont souvent regardées sans son ;
  - ne pas envoyer aux créateurs des scripts IA bruts, qui sonnent « robotiques ».

  [PRA, résumés de talks] https://motionapp.com/library/talk/15-proven-ugc-ad-hooks-that-are-working-right-now-savannah-sanchez/ ; https://motionapp.com/library/expert/savannah-sanchez/
- **Barry Hott, « Make ugly ads ».** Ce qui compte est la première réaction : relatabilité, pertinence, authenticité, plutôt qu'une créa léchée. [PRA] https://www.practicalecommerce.com/ugly-ads-perform-best-marketer-says

## 4. Indicateurs et formules

- **Hook rate (thumbstop)** = vues de 3 secondes / impressions. Cible Motion/Runneth : **30-40 %**. Moins de 25 % est faible, plus de 35 % est fort. [PRA] https://runneth.com/blog/key-creative-performance-metrics ; https://motionapp.com/library/glossary/thumbstop-rate
- **Hold rate.** Il n'y a pas de définition unique. Runneth le calcule comme vues de 15 secondes / vues de 3 secondes (moyenne 40-50 %, plus de 60 % est fort). La même page cite aussi une cible de « 25 %+ ». La définition « ThruPlays / vues de 3 s » est courante ailleurs. **Il faut fixer la formule avant de comparer.** [PRA] https://runneth.com/blog/key-creative-performance-metrics ; [BLOG] https://jetfuel.agency/creative-performance-metrics-for-dtc-video-ads-hold-rate-thumbstop-and-thruplay-benchmarks-2026/
- **CTR (moyennes indicatives) :** Meta 0,9-1,5 % tous secteurs confondus, 1,5-2,5 % en e-commerce ; TikTok environ 0,84 %, plus de 1 % est bon. [PRA, sources secondaires] https://runneth.com/blog/key-creative-performance-metrics. Je n'ai pas trouvé de fourchette de CPM fiable.
- **ROAS d'équilibre** = 1 / marge de contribution, en excluant les dépenses pub de la marge. Exemple : avec une marge de 40 %, le ROAS d'équilibre est de 2,5. Calculer avec la **marge brute** sous-estime le seuil. [BLOG cohérent] https://eightx.co/blog/blended-roas-vs-breakeven-mer ; https://sherocommerce.com/blogs/insights/break-even-roas-margin
- **MER** = chiffre d'affaires total / dépenses marketing totales. MER d'équilibre = 1 / taux de marge de contribution. [BLOG] https://www.polaranalytics.com/post/mer-marketing-efficiency-ratio
- **Approche CTC.** Les cibles se calculent par SKU, à partir de la marge et de la valeur vie client (LTV), puis sont ajustées par l'incrémentalité. CTC vise l'équilibre ou mieux dès la première commande, sauf si la marge des clients récurrents finance l'acquisition. L'objectif reste la **marge de contribution incrémentale**, pas le ROAS de la plateforme. [PRA] https://commonthreadco.com/blogs/ecommerce-playbook/spend-vs-amer-spending-power ; https://commonthreadco.com/pages/methodology-meta
- **Remises.** Elles font exploser le ROAS d'équilibre. Exemple : 2,5 à prix plein, 4,0 avec 20 % de remise, 7,0 avec 30 %. [BLOG] https://eightx.co/blog/blended-roas-vs-breakeven-mer

## 5. Contenu court organique

- **Fréquence TikTok (Buffer).** Étude de 11,4 M de posts. Passer de 1 à **2-5 posts par semaine** donne jusqu'à **+17 % de vues par post**. Au-delà, les gains diminuent. [BLOG/données, 2025] https://buffer.com/resources/how-often-should-you-post-on-tiktok/
- **Fréquence recommandée par Hootsuite :** TikTok 3-5 par semaine, Instagram 3-5 par semaine (en mélangeant les formats), Facebook 1-2 par jour, Pinterest au moins 1 par semaine. [BLOG] https://blog.hootsuite.com/how-often-to-post-on-social-media/
- **Horaires (Sprout Social 2026, heure locale) :** tous réseaux mardi-mercredi 11h-18h ; TikTok mardi-jeudi 14h-18h. Les autres études se contredisent. **Ce sont des moyennes génériques (surtout US) : il vaut mieux apprendre les horaires sur les données du compte.** [BLOG] https://sproutsocial.com/best-times-to-post ; https://sproutsocial.com/insights/best-times-to-post-on-TikTok/
- **Durée :**
  - YouTube Shorts : jusqu'à **3 minutes** depuis le 15.10.2024, en format carré ou vertical. [OFF] https://blog.youtube/news-and-events/tall-updates-coming-to-shorts/ ; https://support.google.com/youtube/answer/15424877
  - Pinterest : vidéo 9:16 en 1080×1920, image 2:3 en 1000×1500. Les 10 premières secondes comptent. Texte en surimpression plutôt que cartons-titres. Créer du contenu original **chaque semaine** et éviter les doublons. La durée vidéo recommandée varie selon les pages (15 s-1 min ou 45-90 s). [OFF] https://business.pinterest.com/creative-best-practices/ ; https://create.pinterest.com/fundamentals/ ; https://help.pinterest.com/en/business/article/pin-performance-and-distribution
- **Instagram et l'originalité.** Les reposts sont classés sous les originaux, et l'original remplace le repost dans les recommandations (2024). Un résumé secondaire indique qu'il faut un contenu **sans filigrane**, ce que je n'ai pas vérifié chez Instagram. En 2026, un compte publiant majoritairement du contenu reposté deviendrait quasi invisible dans Explore. [BLOG/presse] https://www.engadget.com/instagram-ranking-algorithm-original-content-200028046.html ; https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/
- **Hashtags et légendes.** Il n'y a pas de preuve solide. La règle des « 3-5 hashtags » est souvent attribuée à Instagram sans confirmation officielle trouvée. Petit test Hootsuite : la légende sert de complément, elle ne doit pas porter toute l'histoire. [BLOG] https://blog.hootsuite.com/experiment-what-reels-caption-length-gets-the-best-engagement

## 6. Influenceurs et créateurs UGC

- **Prix (Collabstr 2026, données de sa place de marché en 2025) :** prix demandé moyen **180 $**, prix payé moyen **154 $** par collaboration UGC. 80 % des collaborations coûtent moins de 300 $. Les campagnes qui incluent des droits d'usage coûtent **39 % de plus**. [BLOG/données] https://collabstr.com/2026-influencer-marketing-report
- **Droits d'usage et whitelisting / Spark.** Les suppléments annoncés vont de +30 % à +100 %, parfois par mois. Les chiffres varient beaucoup selon les vendeurs. [BLOG] https://influee.co/blog/ugc-price ; https://billo.app/blog/ugc-rates/
- **Brief.** Ne pas envoyer de scripts IA bruts. Choisir des créateurs du même âge que la cible. Exiger le texte à l'écran (Sanchez, voir §3). La durée de l'autorisation Spark Ads (7 à 365 jours) est à inscrire au contrat. [OFF] https://ads.tiktok.com/help/article/spark-ads-creation-guide

## 7. Conformité

- **Meta :**
  - La politique autonome « Unacceptable Business Practices » a été retirée en 2026 et intégrée aux « Prohibited Commercial Practices ». [OFF] https://transparency.meta.com/policies/ad-standards/fraud-scams/unacceptable-business-practices/
  - Le produit de l'annonce doit correspondre à celui de la page de destination. Pas d'effets perturbants (écrans clignotants). Les publicités de moindre qualité peuvent être moins diffusées. [OFF] https://transparency.meta.com/policies/ad-standards/
  - Restrictions santé et « avant/après » : https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/
- **Meta, score de feedback client.** Il repose sur des sondages auprès des acheteurs : produit reçu, qualité, **délai de livraison**, service client. Un score faible réduit la diffusion des publicités et peut aller jusqu'à une interdiction (2018). Les seuils chiffrés (< 2 et < 1) ne sont pas confirmés officiellement. **Point critique pour le dropshipping.** [OFF] https://about.fb.com/news/2018/06/improving-customer-service/ ; [BLOG] https://bir.ch/blog/facebook-feedback-score
- **TikTok :** sont interdites les attentes irréalistes sur l'efficacité d'un produit et les informations fausses sur la livraison ou les retours. TikTok Shop interdit le dropshipping au sens de son règlement « Platform Abuse » (page régionale). [OFF] https://ads.tiktok.com/help/article/tiktok-ads-policy-deceptive-practices ; https://seller-us.tiktok.com/university/essay?knowledge_id=4984474064766737&lang=en
- **Délais de livraison.** L'autorité britannique de la publicité (ASA) a sanctionné une bannière « 1-7 jours » alors que la page annonçait « jusqu'à 25 jours ouvrés ». Le délai affiché doit correspondre aux données réelles. [OFF/régulateur UK] https://asa.org.uk/rulings/ellanoir-luxury-ltd-a21-1114046-ellanoir-luxury-ltd.html
- **Mention des partenariats :**
  - TikTok : activer l'option « Commercial content disclosure », qui affiche « Promotional content » ou « Paid partnership ». **Les guidelines de l'API Content Posting imposent aux applications tierces d'exposer cette option** ; un contenu de marque ne peut pas être privé. [OFF] https://www.tiktok.com/legal/page/global/bc-policy/en ; https://developers.tiktok.com/doc/content-sharing-guidelines
  - FTC (US) : la mention doit être dans la vidéo elle-même, pas seulement dans la description ; « ad » ou « sponsored » conviennent. [OFF] https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers
  - Suisse : la Commission suisse pour la loyauté (CSL/SLK) exige que la communication commerciale soit identifiable. Un #Werbung noyé parmi d'autres hashtags ne suffit pas. Il s'agit d'autorégulation, sans pouvoir de sanction. [Guide basé sur SLK] https://swissolympic.ch/dam/jcr:f31b09cc-e931-4b7d-8ee2-d0c222462630/Q-A_Influencer_Marketing_DE_highres.pdf

## Idées de fonctionnalités pour Comptoir

1. **Remplacer « marge brute » par « marge de contribution »** dans la règle de coupe. Il faut déduire des marges les frais de port, de paiement, de retours et le coût d'emballage. Ajouter un calcul de **ROAS d'équilibre = 1 / MC** et de **MER d'équilibre**, affichés par produit (SKU). Une alerte se déclenche quand une remise fait passer le ROAS d'équilibre au-dessus du ROAS observé.
2. **Règle de coupe « 3× le CPA d'équilibre dépensé sans achat »**, appliquée seulement après au moins 500 impressions. Elle remplace le simple « CPA > marge », trop bruité avec 1 ou 2 conversions. Mention dans l'interface : « règle empirique, non officielle ».
3. **Règle de scaling : abandonner le « +20 % tous les 2 jours », que personne ne publie.** Proposer trois modes :
   - « Prudent » façon Loomer : +1 à 5 %/jour sous condition de CPA sur 3 ou 7 jours ;
   - « Paliers » façon Heath : forte hausse possible quand le budget est petit, hausse plus faible quand il est grand, puis **attente de 7 jours** ;
   - « Horizontal » façon CTC : nouvelles créas d'abord, puis duplication en enchère plafonnée.

   Par défaut, ne jamais modifier un ensemble encore en apprentissage, c'est-à-dire avec moins de 50 conversions sur 7 jours sur Meta ou moins de 20 sur TikTok.
4. **Calculateur de budget de test.** Afficher les conversions par semaine nécessaires (50) et le budget quotidien minimum (CPA × 50 / 7). Avertir si la boutique ne peut pas l'atteindre et proposer alors d'optimiser sur un événement plus haut dans le tunnel, ou de consolider les ensembles. Pour TikTok, appliquer budget ≥ 10× le CPA.
5. **Nouveaux indicateurs créa :** hook rate (vues de 3 s / impressions, cible 30 %), hold rate (formule affichée), CTR sortant, CPM, puis CVR, AOV et MER dans l'onglet analytique. Signaler les créas à hook rate < 25 % en « hook à refaire », et celles qui ont un bon hook mais un CTR faible en « corps ou offre à revoir ».
6. **Bibliothèque de hooks.** Tenir une liste de tous les hooks testés, avec leurs scores, et une liste des meilleurs (Sanchez). L'autopilot génère 2 nouvelles variantes de hook par mois sur chaque gagnante. Ajouter un tag de format par créa (unboxing, démo, témoignage, offre, avant/après) et un tableau des taux de gagnantes par format.
7. **Volume de tests adapté au budget.** Objectif d'environ 3 créas par semaine pour moins de 10 k$/mois (repère Motion) et 3-5 créas très différentes par groupe d'annonces TikTok. Afficher le taux de gagnantes du compte face à la référence de sa catégorie (3,7 % pour Micro, 6,2 % pour Small).
8. **Contraintes vidéo intégrées aux scripts générés :**
   - 9:16 ;
   - proposition de valeur avant 3 s ;
   - durée cible 15 s ou moins pour la pub ;
   - sous-titres à 5-10 mots par seconde ;
   - lisible sans le son ;
   - repère de zone de sécurité (14 % / 35 % / 6 %) ;
   - CTA final.
9. **Planification organique.** Par défaut 3-5 posts par semaine sur TikTok et Instagram, au moins 1 par semaine sur Pinterest. Créneaux de départ Sprout, puis **apprentissage par compte** des horaires réels. Exporter un **fichier propre, sans filigrane**, par plateforme : pas de repost TikTok vers Reels avec logo.
10. **Conformité :**
    - option de mention commerciale TikTok exposée dans l'autopilot (exigée par l'API) ;
    - modèle de mention « Werbung/Publicité/Pubblicità » visible dans la vidéo ;
    - contrôle des allégations exagérées (santé, résultats) ;
    - **vérification que le délai de livraison annoncé dans la pub correspond à celui de la fiche produit** ;
    - alerte sur le score de feedback Meta.
11. **Module créateurs UGC.** Brief type, prix de référence (environ 150-200 $ par vidéo, plus 30-100 % pour les droits pub) et suivi des dates d'expiration des codes Spark (7 à 365 jours) et des droits d'usage.
