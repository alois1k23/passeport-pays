# Journal du marathon de 24 heures (12 au 13 novembre 2026)

Demande : pendant 24 heures, du 12 novembre 22 h 30 au 13 novembre 22 h 30 (heure de Lausanne), produire le code le plus poussé et le plus sécurisé possible pour Comptoir.

Méthode, la même que les nuits précédentes. Chaque chantier passe par ces étapes :
1. Implémentation complète.
2. Tests automatiques.
3. Parcours de bout en bout dans un vrai navigateur, et simulation de 60 jours si le chantier touche les commandes.
4. Relecture indépendante, puis correction de chaque constat.
5. Note dans ce journal, commit et push.

Une relance automatique reprend le travail toutes les heures.

## Feuille de route

Ordre de priorité : la sécurité d'abord, puis ce qui démarque Comptoir des autres plateformes.

1. **Limites de débit persistantes** : les compteurs anti-abus (connexions, formulaires publics) survivent au redémarrage du serveur. Aujourd'hui, un redémarrage les remet à zéro.
2. **Politique de sécurité sans `unsafe-inline`** pour les styles : plus aucun style en ligne, ce qui ferme la dernière porte aux injections CSS.
3. **Factur-X complet** : facture PDF/A-3 avec le XML EN 16931 intégré, lisible par un humain et par un logiciel.
4. **Cartes cadeaux** : vente en ligne, utilisation au paiement et à la caisse, solde, registre, sans double dépense.
5. **Devis pour les clients professionnels** : devis envoyé par lien, accepté en ligne, transformé en commande payable.
6. **Programme de fidélité** : points gagnés à l'achat et utilisés comme remise, sans compte client obligatoire.
7. **Chiffrement au repos des données personnelles des clients** (adresses, téléphones) avec index aveugle pour la recherche.
8. **Stock sur plusieurs emplacements** (magasin, entrepôt), avec transferts.
9. **Test de charge** : 1000 boutiques, et les optimisations qui en découlent.
10. **Parcours d'achat entièrement au clavier et au lecteur d'écran**, de la boutique au paiement.

La feuille de route peut évoluer selon les constats des relectures.

## Cycles

### Cycle 1 (22 h 35) : compteurs anti-abus persistants, arrêt propre du serveur

- Les compteurs anti-abus restaient en mémoire seulement : essais de connexion, échecs de mot de passe, limites des formulaires publics. Un redémarrage du serveur, même provoqué par un attaquant, les remettait à zéro. Ils sont désormais recopiés en base toutes les 2 secondes et à l'arrêt, puis rechargés au démarrage.
- Les clés contiennent des adresses IP ou des e-mails : seule leur empreinte (SHA-256) est écrite, jamais la valeur en clair. Les compteurs expirés sont purgés.
- **Arrêt propre** (SIGTERM, SIGINT) : plus de nouvelles requêtes, celles en cours se terminent, les flux en direct sont fermés après 2 secondes, les compteurs sont écrits et la base est fermée proprement. Avant, le serveur n'avait aucun arrêt propre.
- Test en conditions réelles (`limites-persistantes.test.js`) : 10 mauvais mots de passe, blocage, arrêt par SIGTERM, redémarrage, toujours bloqué. Aucune adresse ni e-mail en clair dans la table. 120 tests sur 120, bout en bout 51 sur 51.

### Cycle 2 (22 h 40) : corrections de la relecture du cycle 1

- **Arrêt vraiment propre** : l'arrêt coupait toutes les connexions au bout de 2 secondes, y compris une requête encore en cours vers Stripe ou un fournisseur (l'effet externe avait lieu, mais l'enregistrement en base était perdu). Désormais, le serveur compte les requêtes en cours et attend qu'elles finissent (10 secondes au plus). Les flux en direct sont fermés tout de suite, et le navigateur se reconnecte seul. Un second signal force l'arrêt immédiat.
- **Empreintes non réversibles** : avec un SHA-256 simple, on retrouvait une adresse IP par force brute en quelques secondes. Les empreintes utilisent maintenant un HMAC avec une clé dérivée de `SECRET_CHIFFREMENT`, absente de la base et des sauvegardes.
- **Écriture en échec** : le lot est remis en attente et réessayé au passage suivant (rien n'est perdu), avec un message dans les journaux du serveur.
- **Performance** : écriture par lots de 2000, expiration sur une colonne indexée une fois par minute (au lieu d'un parcours complet de la table toutes les 2 secondes).
- **Test plus solide** : port libre choisi par le système, serveur toujours arrêté même en cas d'échec, et nouveau cas d'arrêt rapide malgré un flux en direct ouvert.

### Cycle 3 (22 h 45) : politique de sécurité sans styles en ligne

- La politique de sécurité (CSP) acceptait les styles en ligne (`'unsafe-inline'`). Une injection de HTML, même sans script, pouvait donc restyler une page : faux bouton, texte masqué, superposition. Les styles en ligne sont désormais refusés partout.
- Les 33 attributs `style` de l'interface sont remplacés par des attributs typés (`data-largeur`, `data-hauteur`, `data-largeur-px`, `data-vars`), appliqués par un petit module (`js/styles-surs.js`). Ce module n'accepte que des nombres bornés, ou des propriétés personnalisées (`--nom`) aux valeurs vérifiées (couleur, nombre, police) : même injecté, un de ces attributs ne permet pas de CSS libre ni d'adresse externe.
- Les feuilles de style des pages produites par le serveur (factures, pages simples, paiement de test) et des pages statiques (accueil, boutique) sont autorisées une à une par leur empreinte SHA-256.
- Vérifié dans un vrai navigateur : accueil, 13 écrans de l'espace marchand, boutique, pages légales et de désinscription. **Aucune violation**, aucune erreur ; barres, thème de la boutique et aperçus de thème s'affichent comme avant.
- 120 tests sur 120, bout en bout 51 sur 51.

### Cycle 4 (23 h 00) : corrections de la relecture du cycle 3

Relecture indépendante de la politique sans styles en ligne. Elle a comparé les styles calculés d'environ 480 éléments avant et après la modification : tous identiques. Aucune violation sur l'ensemble des pages, démo comprise. Points corrigés :
- **Liste fermée** : `data-vars` acceptait n'importe quelle propriété personnalisée, par exemple `--control-h`, qui règle la hauteur des boutons, ou un mot-clé comme `transparent`. Désormais, seules les couleurs et polices des thèmes et la teinte des visuels sont acceptées, chacune avec son type : couleur hexadécimale ou rgb/hsl, longueur en px, liste de polices, nombre.
- **Valeurs périmées** : une valeur retirée ou devenue invalide est maintenant effacée. Avant, l'ancienne couleur ou largeur restait.
- La lecture des blocs `<style>` des pages statiques accepte les attributs (`<style media=…>`).
- **Nouveau test serveur** (`csp-styles.test.js`) : sur 8 pages, pas de `'unsafe-inline'`, aucun attribut `style`, et chaque bloc `<style>` est autorisé par son empreinte.
- Vérifié dans un vrai navigateur : propriétés refusées, valeurs retirées, barres et thèmes intacts. 121 tests sur 121, bout en bout 51 sur 51.

### Cycle 5 (23 h 10) : Factur-X complet (PDF/A-3 avec le XML EN 16931 joint)

- Chaque facture et chaque avoir se téléchargent en **PDF Factur-X** (bouton « PDF Factur-X » dans la fiche commande). Le client lit le PDF ; son logiciel comptable lit le fichier `factur-x.xml` joint, celui de la norme européenne EN 16931. C'est le format de la facture électronique en France.
- Le PDF est écrit par Comptoir, sans bibliothèque externe :
  - polices DejaVu intégrées en sous-ensemble (seuls les caractères utilisés), texte copiable et cherchable ;
  - profil de couleur sRGB, métadonnées PDF/A-3B et schéma d'extension Factur-X ;
  - fichier XML joint et déclaré comme données de la facture.
- Mêmes contrôles que le XML seul : s'il manque une mention obligatoire, ou si les montants sont incohérents, rien n'est produit. Les montants sont ceux du XML et de la facture imprimée. Les longues commandes passent sur plusieurs pages.
- Vérifié avec les outils poppler : le XML extrait du PDF est identique et valide selon le schéma officiel Factur-X, les polices sont intégrées avec leur table Unicode, et le texte s'extrait. Téléchargement vérifié dans un vrai navigateur.
- **Limite** : la conformité PDF/A n'a pas été contrôlée par un validateur officiel (veraPDF, absent de l'environnement). Les caractères absents de la police (emoji, idéogrammes) s'affichent « ? ».

### Cycle 6 (23 h 20) : corrections de la relecture du cycle 5

Une relecture indépendante a vérifié la structure du PDF octet par octet, le sous-ensemble de police, l'échappement de chaque texte et les montants. Points corrigés :
- **Blocage du serveur** : la coupure des lignes pouvait prendre beaucoup trop de temps avec un mot très long (41 secondes pour 8 000 caractères dans l'adresse du vendeur). Elle se fait désormais en temps linéaire, sur un texte borné : 300 000 caractères passent en quelques millisecondes.
- **Métadonnées identiques** : un caractère de contrôle dans la raison sociale apparaissait dans les propriétés du PDF mais pas dans les métadonnées XMP, ce que PDF/A interdit. Le même texte nettoyé sert maintenant aux deux.
- **Mise en page** :
  - les noms très longs (vendeur, client) passent à la ligne au lieu de sortir de la page ;
  - une page suivante n'a plus d'en-tête de tableau vide ;
  - les mentions de paiement (montant, IBAN) restent ensemble sur une même page.
- **Cohérence** :
  - montants en francs au format habituel de Comptoir (CHF 1’234.50) ;
  - arrondi des espèces affiché dans les mêmes conditions que dans le XML ;
  - dates calculées dans le même fuseau horaire que le XML ;
  - une devise invalide n'interrompt plus la production du PDF.
- **Restent tels quels** :
  - la relation du fichier joint (« Data ») est l'une des valeurs que permet la spécification Factur-X ;
  - l'IBAN visible par le rôle « commandes » l'est déjà sur la facture QR.
- Nouveau test de régression. 126 tests sur 126, bout en bout 51 sur 51.
