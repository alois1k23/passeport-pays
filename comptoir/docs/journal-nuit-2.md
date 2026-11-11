# Journal de la deuxième nuit (11 au 12 novembre 2026)

Demande : jusqu'à 7 h 00 (heure de Lausanne), pousser le code, renforcer la sécurité et ajouter des fonctions technologiques qui démarquent Comptoir. Chaque chantier est implémenté avec ses tests, vérifié par les simulations, relu par une relecture indépendante, puis commité et poussé.

## Chantiers prévus

1. **Sécurité des comptes marchands** : double authentification (TOTP, codes de secours), appareils connectés révocables, journal d'activité, alerte de nouvelle connexion.
2. **QR-facture suisse** sur les factures des boutiques suisses (norme SIX), avec l'IBAN ou le QR-IBAN du marchand.
3. **API et webhooks pour les marchands** : clés d'API à portée limitée et webhooks sortants signés (intégrations, Zapier, comptabilité).
4. **Tableau de bord en temps réel** (nouvelles commandes sans recharger) et application installable (PWA).
5. **Performance** : mise en cache HTTP (ETag), compression, images optimisées dès l'envoi.
6. **Renforcement** : en-têtes de sécurité, politique de mots de passe (mots de passe compromis), audit des points d'entrée.

## Cycles

### Cycle 1 — Sécurité des comptes marchands (23 h 35 – 00 h 05)

- **Double authentification (TOTP)**, codée sans aucune bibliothèque (RFC 6238, vérifiée par les vecteurs de test officiels). Elle fonctionne avec Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden et Proton Pass.
  - Mise en place par QR code ; le mot de passe et un premier code sont exigés.
  - Le secret est chiffré en base (AES-256-GCM). La clé peut être gardée hors de la base (`SECRET_CHIFFREMENT`).
  - Un code déjà utilisé ne peut pas resservir.
  - Après 5 codes faux, le compte est bloqué 15 minutes.
  - La connexion se fait en deux temps : le mot de passe donne un « défi » signé, valable 5 minutes et lié au mot de passe actuel, et aucune session n'est ouverte avant le second facteur.
- **10 codes de secours** à usage unique, gardés en empreinte seulement, affichés une seule fois et téléchargeables.
- **Appareils connectés** : navigateur, système, réseau et dernière activité. Chaque appareil peut être déconnecté à distance.
- **Journal d'activité du compte** : connexions, codes refusés, codes de secours utilisés, activation ou désactivation, mot de passe, déconnexions.
- **Alerte e-mail** à chaque connexion depuis un nouvel appareil, et à chaque activation ou désactivation de la double authentification.
- **Faille fermée en passant** : un lien de réinitialisation du mot de passe connectait directement le marchand. Avec la double authentification, un accès à sa boîte e-mail aurait donc suffi. Ce n'est plus le cas.
- **Interface** : nouvelle section Paramètres > Sécurité, et étape « code de vérification » à la connexion.
- **Vérifié** : tests `totp.test.js` (RFC) et `securite.test.js` (parcours complet), plus un parcours dans un vrai navigateur (QR scanné, codes de secours, connexion depuis un autre appareil avec le code). 72 tests.

**Relecture indépendante du cycle 1.** Aucun contournement possible de la double authentification. Neuf faiblesses ont été trouvées et corrigées :
1. **Blocage du propriétaire.** Quelqu'un qui connaît le mot de passe pouvait bloquer le vrai propriétaire en ratant volontairement le code. Les limites comptent maintenant par réseau, avec une limite globale qui ne s'applique pas à un appareil déjà connu. Le propriétaire est prévenu par e-mail quand des codes sont refusés (son mot de passe a fuité).
2. **Désactivation.** Les essais de code y sont maintenant comptés (une session volée ne peut plus deviner le code).
3. **Codes de secours.**
   - Ils sont acceptés pour désactiver.
   - On peut en obtenir de nouveaux, mot de passe et code exigés ; les anciens cessent alors de fonctionner.
4. **Autres appareils.** L'activation de la double authentification déconnecte les autres appareils.
5. **Bibliothèque QR.** Celle chargée depuis un CDN externe est remplacée par une copie locale (licence MIT), plus aucun code externe sur la page qui montre le secret.
6. **Écran de code.**
   - Les lettres sont maintenant possibles (codes de secours).
   - Un défi expiré ramène au mot de passe.
   - Le curseur revient dans le champ après une erreur.
7. **Erreur de chargement.** Elle n'entraîne plus de boucle de requêtes ; un bouton « Réessayer » s'affiche.
8. **Journal d'activité.** Il est conservé 12 mois.

### Cycle 2 — QR-facture suisse et rapprochement bancaire automatique (23 h 50 – 00 h 20)

En Suisse, le paiement sur facture est très répandu. Comptoir le propose maintenant aux boutiques suisses, de bout en bout :
- **QR-facture conforme à la norme SIX** (Swiss Payment Standards, QR-bill 2.3) : récépissé et section paiement au format A4 (62 mm + 148 mm), QR code avec la croix suisse, adresses structurées.
  - Avec un QR-IBAN, la référence est une **référence QR** (QRR, modulo 10 récursif).
  - Avec un IBAN ordinaire, c'est une **référence créancier ISO 11649** (RF…).
  - Les deux algorithmes sont vérifiés par les exemples officiels de la norme et de l'ISO, et l'IBAN est contrôlé (modulo 97).
- **Côté client** : à la caisse, le choix « Facture QR, payable sous N jours ». La facture s'ouvre tout de suite, imprimable en PDF, et arrive aussi par e-mail. La commande part dès réception du paiement.
- **Côté marchand** (Paramètres > Paiements) : IBAN ou QR-IBAN contrôlé, délai de paiement de 10 à 60 jours, activation. Chaque commande concernée affiche sa référence, son échéance et un lien vers sa facture.
- **Rapprochement bancaire automatique** : le marchand importe le relevé **camt.054** (format ISO 20022 de toutes les banques suisses), et chaque paiement reconnu passe la commande en « payée ».
  - Le stock est retiré et le client est prévenu.
  - Le rapport distingue les factures payées, les paiements déjà enregistrés, les montants insuffisants et les paiements inconnus.
  - Importer deux fois le même relevé ne double rien.
- **Facturation**
  - La facture est numérotée dès l'émission.
  - Une commande facturée puis annulée reçoit un avoir.
  - Ces commandes ne reçoivent pas les relances de « panier abandonné ».
- **Sécurité au passage**
  - La bibliothèque QR est maintenant locale, ce qui permet de retirer le CDN externe de la politique de sécurité (`script-src 'self'` seulement).
  - La page de facture ne contient aucun script.
- **Tests :** `qrfacture.test.js` couvre la norme, la commande, la facture protégée par jeton, et le relevé camt.054 (paiement reconnu, inconnu, débit ignoré, import en double). Le parcours a aussi été joué dans un vrai navigateur. 76 tests.
- **Limite honnête :** je n'ai pas pu faire lire le QR code par une application bancaire ni par un lecteur indépendant (l'outil de décodage téléchargé a été refusé, car c'est du code externe). À faire avec une vraie application bancaire avant d'ouvrir.
