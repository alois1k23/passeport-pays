# Comptoir face aux plateformes connues

Relevé du 15 novembre 2026, fait sur les pages officielles citées. Les offres changent souvent : avant de reprendre un chiffre (dans une publicité, sur la page d'accueil), vérifiez la source le jour même. « Non vérifié » veut dire que nous n'avons pas trouvé de page officielle qui confirme le point. Cela ne veut pas dire que la fonction manque.

Il s'agit d'une comparaison des fonctions écrites. Elle ne dit rien de la maturité. Shopify, Wix, WooCommerce et PrestaShop servent des millions de boutiques, et chacun a une place de marché d'extensions et de thèmes. Comptoir n'a encore aucune boutique en production. Sa QR-facture n'a pas été relue par une application bancaire indépendante (voir `FONCTIONNALITES.md`, section « À vérifier »).

## Tableau

| | Comptoir | Shopify | Wix | WooCommerce | PrestaShop | Infomaniak (Site Creator) |
|---|---|---|---|---|---|---|
| Prix | 29 / 59 / 119 CHF par mois, sans commission | Basic 29 CHF par mois (21 CHF en annuel), Grow 79 CHF, Advanced 359 CHF | Core 29,77 USD, Business 39,77 USD par mois en annuel (prix en CHF non vérifié) | Extension gratuite, hébergement en plus | Logiciel gratuit, hébergement en plus | Dès 1,95 CHF par mois (prix d'appel ; la formule qui contient la boutique n'est pas vérifiée) |
| Frais avec un prestataire de paiement tiers | Aucun | 2 % (Basic) à 0,2 % (Plus) | Aucun selon Wix | Aucun connu | Non vérifié | Seulement les frais du prestataire |
| TWINT | Natif (Stripe) | Natif (Shopify Payments) ou par app | Par prestataires connectés | Par extensions tierces | Par modules tiers | Natif (Stripe ou Mollie) |
| QR-facture suisse | Native, avec rapprochement camt.053 et camt.054 | Par app | Non vérifié | Par extensions tierces | Aucun module trouvé | Non vérifié |
| B2B | Comptes pro : remise par client, facture QR et plafond, connexion par code | Bases sur Basic, Grow et Advanced depuis avril 2026 ; prix par entreprise sur Plus seulement | Par app (SparkLayer…) | Par extensions | Prix par groupe ; B2B amélioré en bêta (9.2) | Non vérifié |
| Produits numériques | Natifs (liens personnels : 5 téléchargements en 30 jours), aussi vendus en caisse | App gratuite « Digital Products » | Non vérifié | Natifs | Natifs (produit virtuel) | Natifs |
| Précommandes | Natives (date d'expédition annoncée) | Par app | Natives | Extension payante (179 USD par an) | Non vérifié | Non vérifié |
| Lots | Natifs (stock tiré des composants) | App gratuite « Shopify Bundles » | Par app | Extension payante (79 USD) | Natifs (pack) | Non vérifié |
| Journal (blog) | Natif, rendu par le serveur | Natif (non vérifié page par page) | Non vérifié | WordPress | Non vérifié | Non vérifié |
| Import CSV | Shopify, WooCommerce, PrestaShop, tableur | Natif (non vérifié page par page) | Natif | Natif | Natif | Export seulement documenté |
| Caisse et stock unique | Natifs (formule Pro), avec vente hors ligne | Shopify POS (non vérifié ici) | Non vérifié | Par extensions | Par modules | Non vérifié |
| Hébergement des données | Là où l'exploitant installe Comptoir (serveur en Suisse conseillé) | Europe par défaut pour les nouveaux marchands européens, avec transferts internationaux | Amérique du Nord et Europe (AWS, GCP) | Hébergeur choisi | Hébergeur choisi | En Suisse (source tierce) |

## Ce que le tableau montre

- **Avantages écrits de Comptoir :**
  - QR-facture native, reliée au paiement sur facture et au relevé bancaire ;
  - B2B avec prix par client dès la première formule ;
  - aucun frais de plateforme, quel que soit le prestataire ;
  - précommandes, lots et produits numériques sans extension payante.
  
  Selon les sources relevées, aucune autre plateforme du tableau ne réunit ces quatre points en natif.
- **Points forts des autres :**
  - Shopify a TWINT dans son propre paiement, une caisse (Shopify POS) et un écosystème sans comparaison.
  - WooCommerce et PrestaShop sont libres et modifiables à volonté.
  - Infomaniak est la seule offre hébergée en Suisse qui soit prête à l'emploi, pour un prix d'entrée très bas.
- **Ce qui manque à Comptoir :**
  - pas de place de marché d'extensions ;
  - pas de catalogue de thèmes ;
  - pas d'application mobile native ;
  - pas de TVA européenne pour les produits numériques (guichet OSS) ;
  - aucun recul en production.

## Sources

- Shopify :
  - [prix](https://www.shopify.com/ch-fr/pricing)
  - [TWINT](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods)
  - [QR-facture (app)](https://apps.shopify.com/swiss-invoice)
  - B2B : [fonctions par formule](https://help.shopify.com/en/manual/b2b/getting-started/plan-features), [annonce](https://www.shopify.com/news/b2b-for-all)
  - [produits numériques](https://help.shopify.com/en/manual/products/digital-service-product/digital-downloads)
  - [précommandes](https://help.shopify.com/en/manual/products/purchase-options/pre-orders/setup)
  - [lots](https://apps.shopify.com/shopify-bundles)
  - [sous-traitants et données](https://help.shopify.com/en/manual/privacy-and-security/privacy/subprocessors)
- Wix :
  - [prix](https://www.wix.com/upgrade/website)
  - [frais](https://support.wix.com/en/article/pricing-plans-about-the-transaction-fee)
  - [TWINT](https://support.wix.com/en/article/connecting-twint-provided-by-tftw-as-a-payment-provider)
  - [vente en gros](https://support.wix.com/en/article/wix-stores-selling-wholesale-with-sparklayer)
  - [précommandes](https://support.wix.com/en/article/wix-stores-allowing-customers-to-pre-order-products)
  - [lots](https://support.wix.com/en/article/wix-stores-request-ability-to-sell-products-bundled-together)
  - [import](https://support.wix.com/en/article/importing-products-to-wix-stores)
  - [sécurité et hébergement](https://www.wix.com/website-security/whitepaper)
- WooCommerce :
  - [TWINT (demande ouverte)](https://woocommerce.com/feature-request/accept-twint-as-a-payment-method-in-the-woocommerce-stripe-payment-gateway/)
  - [QR-facture (extension)](https://wordpress.org/plugins/tellbill-for-woocommerce)
  - [produits](https://woocommerce.com/document/managing-products/)
  - [précommandes](https://woocommerce.com/products/woocommerce-pre-orders/)
  - [lots](https://woocommerce.com/products/product-bundles/)
  - [import CSV](https://woocommerce.com/document/product-csv-importer-exporter/)
- PrestaShop :
  - [B2B (9.2)](https://devdocs.prestashop-project.org/9/modules/core-updates/9.2/)
  - [produits](https://docs.prestashop-project.org/v.9-documentation/user-guide/selling/managing-catalog/managing-products)
  - [import](https://docs.prestashop-project.org/v.9-documentation/user-guide/configuring-shop/advanced-parameters/import)
  - [TWINT (module)](https://saldia.ch/en/apps/prestashop/)
- Infomaniak :
  - [prix](https://www.infomaniak.com/en/create-a-website/site-creator/prices)
  - [boutique](https://www.infomaniak.com/fr/support/faq/2842/configurer-la-boutique-site-creator)
