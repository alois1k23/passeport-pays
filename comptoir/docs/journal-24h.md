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

### Cycle 1 (22 h 45) : compteurs anti-abus persistants, arrêt propre du serveur

- Les compteurs anti-abus restaient en mémoire seulement : essais de connexion, échecs de mot de passe, limites des formulaires publics. Un redémarrage du serveur, même provoqué par un attaquant, les remettait à zéro. Ils sont désormais recopiés en base toutes les 2 secondes et à l'arrêt, puis rechargés au démarrage.
- Les clés contiennent des adresses IP ou des e-mails : seule leur empreinte (SHA-256) est écrite, jamais la valeur en clair. Les compteurs expirés sont purgés.
- **Arrêt propre** (SIGTERM, SIGINT) : plus de nouvelles requêtes, celles en cours se terminent, les flux en direct sont fermés après 2 secondes, les compteurs sont écrits et la base est fermée proprement. Avant, le serveur n'avait aucun arrêt propre.
- Test en conditions réelles (`limites-persistantes.test.js`) : 10 mauvais mots de passe, blocage, arrêt par SIGTERM, redémarrage, toujours bloqué. Aucune adresse ni e-mail en clair dans la table. 120 tests sur 120, bout en bout 51 sur 51.
