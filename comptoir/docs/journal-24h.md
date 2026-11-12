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
