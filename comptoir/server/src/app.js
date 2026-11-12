// Application Comptoir : routes de l'API, logique des commandes, paiements,
// transmission aux fournisseurs, e-mails, pages publiques.
'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const abonnements = require('./abonnements');
const Formules = require('../../js/formules.js');
const tendances = require('./tendances');
const MotDePasse = require('./motdepasse');
const WebAuthn = require('./webauthn');
const Risque = require('./risque');
const EmailsClients = require('./emails-clients');
const WebPush = require('./webpush');
const { creerRouteur, lireCorps, lireCookies, envoyerJson, envoyerHtml, servirStatique, erreur, ErreurHttp, valider } = require('./http');
const auth = require('./auth');
const totp = require('./totp');
const { transaction } = require('./db');
const prix = require('./prix');
const { choisirPrestataire, etatDepuisCompte } = require('./paiements');
const fournisseurs = require('./fournisseurs');
const social = require('./social');
const relances = require('./relances');
const Remises = require('../../js/remises.js');
const PrixBarres = require('../../js/prix-barres.js');
const QrFacture = require('../../js/qrfacture.js');
const { creerIntegrations } = require('./integrations');
const courriel = require('./courriel');

const RACINE_FRONT = path.resolve(__dirname, '..', '..');
const FICHIERS_PUBLICS = /^\/(index\.html|boutique\.html|accueil\.html|css\/[\w.-]+\.css|js\/(vendor\/)?[\w.-]+\.js|img\/[\w.-]+\.(jpg|png|svg)|docs\/API\.md|app\.webmanifest|sw\.js)$/;
const POLICES = ["'Fraunces', Georgia, serif", "'DM Serif Display', Georgia, serif", "'Syne', system-ui, sans-serif", "'Bricolage Grotesque', system-ui, sans-serif", "'Outfit', system-ui, sans-serif", "'IBM Plex Sans', system-ui, sans-serif"];
const COULEUR = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function creerApp({ db, env = {}, urlPublique, fetchImpl = fetch, journal = console }) {
  const r = creerRouteur();
  const securise = urlPublique.startsWith('https://');
  const paiement = choisirPrestataire(env, urlPublique, fetchImpl);
  const simulationAutorisee = paiement.nom === 'simulation' && env.NODE_ENV !== 'production';
  // Le fournisseur de démonstration n'expédie rien : ses produits ne se vendent jamais contre de l'argent réel
  // (seulement en paiement simulé ou avec une clé Stripe de test).
  const fournisseurDemoVendable = paiement.nom === 'simulation' || /^sk_test_/.test(env.STRIPE_SECRET_KEY || '');
  const socialSimule = paiement.nom === 'simulation' || env.SOCIAL_SIMULATION === '1';   // démo : publication et statistiques simulées
  /* Adresse du client : derrière un proxy de confiance (Caddy, par défaut sur la même machine), celle qu'il a ajoutée
     en dernier dans X-Forwarded-For ; sinon l'adresse de la connexion. Sans cela, tout le monde aurait l'adresse du proxy
     et une seule personne pourrait bloquer la connexion de tous les marchands. */
  const proxiesConfiance = new Set(String(env.PROXY_DE_CONFIANCE || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(x => x.trim()).filter(Boolean));
  const ipClient = req => {
    const pair = req.socket.remoteAddress || '';
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
    if (xff.length && !proxiesConfiance.has(pair) && !avertiProxy) {
      // Tout le trafic semble venir d'une seule adresse (le proxy) : les limites d'essais vaudraient pour tous les clients à la fois.
      avertiProxy = true;
      journal.error(`[réseau] En-tête X-Forwarded-For reçu de ${pair}, qui n'est pas un proxy de confiance : ajoutez cette adresse à PROXY_DE_CONFIANCE (voir README, Docker).`);
    }
    return proxiesConfiance.has(pair) && xff.length ? xff[xff.length - 1] : pair;
  };
  let avertiProxy = false;
  const vendable = p => p.actif && !p.aVerifier && (fournisseurDemoVendable || p.codeFournisseur !== 'demo');
  // Délai avant que le faux fournisseur expédie (2 min par défaut ; négatif = jamais, pour tester à la main).
  const delaiExpeditionDemo = env.DEMO_DELAI_EXPEDITION_MS === undefined ? 120000 : Number(env.DEMO_DELAI_EXPEDITION_MS);
  const secretsDemo = { cleApiDemo: crypto.randomBytes(24).toString('hex'), secretWebhookDemo: crypto.randomBytes(24).toString('hex') };
  fournisseurs.installerDemo(db, urlPublique, secretsDemo);
  // Vrai fournisseur (contrat décrit dans le README) : déclaré par l'exploitant, il remplace celui de démonstration
  // pour le catalogue et les imports. Les produits déjà importés gardent leur fournisseur d'origine.
  if (env.FOURNISSEUR_URL_API && env.FOURNISSEUR_CLE_API && env.FOURNISSEUR_SECRET_WEBHOOK) {
    db.prepare(`INSERT INTO fournisseurs (code, nom, url_api, cle_api, secret_webhook) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET nom = excluded.nom, url_api = excluded.url_api, cle_api = excluded.cle_api, secret_webhook = excluded.secret_webhook`)
      .run(env.FOURNISSEUR_CODE || 'principal', env.FOURNISSEUR_NOM || 'Fournisseur', env.FOURNISSEUR_URL_API.replace(/\/$/, ''), env.FOURNISSEUR_CLE_API, env.FOURNISSEUR_SECRET_WEBHOOK);
  }
  const fournisseurActif = () => db.prepare('SELECT * FROM fournisseurs WHERE code = ?').get(env.FOURNISSEUR_URL_API ? (env.FOURNISSEUR_CODE || 'principal') : 'demo');
  relances.creerTables(db);
  courriel.creerTables(db);
  const serviceEmail = courriel.prestataire(env, fetchImpl);
  // Mots de passe : politique locale toujours ; contrôle des fuites connues (anonymat k) en production ou si VERIFIER_FUITES=oui.
  const verifierFuites = (env.VERIFIER_FUITES === 'oui' || (env.NODE_ENV === 'production' && env.VERIFIER_FUITES !== 'non')) ? MotDePasse.creerVerificationFuites({ url: env.FUITES_API_URL || undefined, fetchImpl }) : null;
  async function exigerMotDePasseSolide(mdp, contexte) {
    const pb = MotDePasse.evaluer(mdp, contexte);
    if (pb) throw erreur(400, pb, 'mot_de_passe_faible');
    if (verifierFuites) {
      const n = await verifierFuites(mdp);
      if (n > 0) throw erreur(400, 'Ce mot de passe apparaît dans des fuites de données connues : des pirates l’essaient en premier. Choisissez-en un autre.', 'mot_de_passe_fuite');
    }
  }
  const hotePrincipal = new URL(urlPublique).hostname.toLowerCase();
  // Facteur des limites de débit publiques (1 en production ; plus élevé pour les tests et simulations depuis une seule adresse).
  const facteurLimites = Math.max(1, Number(env.LIMITES_FACTEUR) || 1);
  const abo = abonnements.creerGestion({ db, env, urlPublique, fetchImpl });
  const collecte = tendances.creerCollecte({ db, env, catalogue: fournisseurs.CATALOGUE_DEMO, fetchImpl, journal });
  const deviseDe = b => lireConfig(b).boutique.pays === 'ch' ? 'CHF' : 'EUR';

  /* ---------- Accès aux données ---------- */
  const lireConfig = b => JSON.parse(b.config);
  // Ancienne faille (avant le cycle 40) : un domaine pouvait être déclaré actif dès l'inscription, sans vérification,
  // y compris avec une fausse date de vérification. Une seule fois : tous les domaines actifs repassent par la
  // vérification DNS et TXT (le marchand clique à nouveau sur « Vérifier »), le vrai propriétaire peut le revendiquer.
  db.exec('CREATE TABLE IF NOT EXISTS cles (nom TEXT PRIMARY KEY, valeur TEXT NOT NULL);');
  if (!db.prepare("SELECT 1 FROM cles WHERE nom = 'migration-domaines-40'").get()) {
    transaction(db, () => {
      for (const b of db.prepare('SELECT id, config FROM boutiques').all()) {
        try {
          const conf = JSON.parse(b.config), d = conf.boutique && conf.boutique.domaine;
          if (d && d.actif) { d.actif = false; d.verifieLe = null; db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(conf), b.id); }
        } catch { /* configuration illisible : laissée telle quelle */ }
      }
      db.prepare("INSERT INTO cles (nom, valeur) VALUES ('migration-domaines-40', ?)").run(String(Date.now()));
    });
  }
  /* Configuration telle qu'elle s'applique aux ventes : les fonctions que la formule n'inclut pas sont éteintes
     (codes, paliers, offres, campagnes et e-mails automatiques : Croissance ; retrait en magasin : Pro).
     Les réglages du marchand restent enregistrés : ils reviennent s'il change de formule. */
  /* Stripe Connect : compte Stripe de chaque boutique (l'argent des ventes va directement au marchand). */
  db.exec('CREATE TABLE IF NOT EXISTS comptes_stripe (boutique_id TEXT PRIMARY KEY, compte TEXT NOT NULL, pret INTEGER NOT NULL DEFAULT 0, maj_le INTEGER NOT NULL);');
  try { db.exec('ALTER TABLE paiements ADD COLUMN compte TEXT'); } catch { /* colonne déjà présente */ }
  try { db.exec('ALTER TABLE paiements ADD COLUMN intent TEXT'); } catch { /* colonne déjà présente */ }   // payment_intent Stripe : retrouve la vente d'un litige
  for (const sql of ["ALTER TABLE comptes_stripe ADD COLUMN mode TEXT", "ALTER TABLE comptes_stripe ADD COLUMN moyens TEXT"]) { try { db.exec(sql); } catch { /* déjà présente */ } }
  // Un compte créé en mode test ne vaut rien avec une clé réelle (et inversement) : il est ignoré, la boutique en active un nouveau.
  const compteStripe = boutiqueId => {
    const c = db.prepare('SELECT * FROM comptes_stripe WHERE boutique_id = ?').get(boutiqueId);
    if (!c || (paiement.modeCle && c.mode && c.mode !== paiement.modeCle)) return null;
    return c;
  };
  const moyensDe = boutiqueId => { try { return JSON.parse((compteStripe(boutiqueId) || {}).moyens || 'null'); } catch { return null; } };
  const noterEtatCompte = (boutiqueId, e) => db.prepare('UPDATE comptes_stripe SET pret = ?, moyens = ?, maj_le = ? WHERE boutique_id = ?').run(e.pret ? 1 : 0, JSON.stringify(e.moyens || {}), Date.now(), boutiqueId);
  const paiementsActifs = b => paiement.nom !== 'stripe' || !!(compteStripe(b.id) || {}).pret;
  // Compte qui encaisse une vente : null en simulation ; en mode Stripe, la boutique doit avoir activé son compte.
  function compteVente(b) {
    if (paiement.nom !== 'stripe') return null;
    const c = compteStripe(b.id);
    if (!c || !c.pret) throw erreur(409, 'Cette boutique termine l’activation de ses paiements en ligne : les commandes ouvrent très bientôt.', 'paiements_inactifs');
    return c.compte;
  }
  /* Paiement sur facture QR (Suisse) : activé par le marchand, IBAN suisse valable, boutique en CHF. */
  const factureQrPossible = config => !!(config.reglages && config.reglages.factureQr && config.boutique.pays === 'ch' && QrFacture.ibanValide((config.entreprise || {}).iban)
    && QrFacture.adresseComplete({ nom: (config.entreprise || {}).raison || config.boutique.nom, ...QrFacture.decouperAdresse((config.entreprise || {}).adresse, 'CH') }));
  // Référence de paiement unique par commande : QRR avec un QR-IBAN, référence créancier (RF…) sinon.
  function referencePaiement(b, numero, iban) {
    if (QrFacture.estQrIban(iban)) return QrFacture.referenceQrr(`${parseInt(crypto.createHash('sha256').update(b.id).digest('hex').slice(0, 8), 16) % 1e9}`.padStart(9, '0') + String(numero).padStart(8, '0'));
    return QrFacture.referenceScor(`${numero}C${crypto.createHash('sha256').update(b.id).digest('hex').slice(0, 6)}`);
  }
  function donneesQr(b, c, config) {
    const e = config.entreprise || {};
    return { iban: e.iban, creancier: { nom: e.raison || config.boutique.nom, ...QrFacture.decouperAdresse(e.adresse, 'CH') }, montant: c.total, devise: 'CHF',
      debiteur: c.client.adresse ? { nom: c.client.nom, ...QrFacture.decouperAdresse(`${c.client.adresse}, ${c.client.npa} ${c.client.ville}`, 'CH') } : null,
      reference: c.referenceQr, message: `Commande n° ${c.numero}${c.facture ? ` · facture ${c.facture}` : ''}` };
  }
  function configVente(b) {
    const config = lireConfig(b);
    if (!b.marchand_id) return config;
    const e = abo.etat(b.marchand_id);
    if (!e.obligatoire) return config;
    return Formules.configVente(config, e.formule);
  }
  /* Adresse publique d’une boutique : son domaine personnalisé s’il est actif, sinon /s/<slug>. */
  const domaineDe = b => { const d = lireConfig(b).boutique.domaine; return d && d.actif && d.domaine ? String(d.domaine).toLowerCase() : null; };
  const urlBoutique = b => domaineDe(b) ? `https://${domaineDe(b)}/` : `${urlPublique}/s/${b.slug}`;
  const boutiqueDuMarchand = marchandId => {
    const b = db.prepare('SELECT * FROM boutiques WHERE marchand_id = ? ORDER BY cree_le LIMIT 1').get(marchandId);
    if (!b) throw erreur(404, 'Aucune boutique pour ce compte.', 'sans_boutique');
    return b;
  };
  const boutiqueParSlug = slug => {
    const b = db.prepare('SELECT * FROM boutiques WHERE slug = ?').get(slug);
    if (!b) throw erreur(404, 'Boutique introuvable.', 'boutique_introuvable');
    return b;
  };
  /* Vitrine et nouvelles commandes : seulement si l'abonnement du marchand est payé. Le suivi des commandes passées reste accessible. */
  const boutiqueOuverte = slug => {
    const b = boutiqueParSlug(slug);
    if (!abo.etat(b.marchand_id).actif) throw erreur(404, 'Cette boutique n’est pas encore ouverte.', 'boutique_fermee');
    return b;
  };
  /* Photos des produits dans leur propre table : les lectures courantes (paiement, stock, statistiques) ne chargent
     plus des centaines de Ko par produit. Dans la fiche, « image » vaut alors le repère IMG. */
  const IMG = '#image';
  db.exec('CREATE TABLE IF NOT EXISTS images_produits (produit_id TEXT PRIMARY KEY, donnees TEXT NOT NULL)');
  const imageDe = id => (db.prepare('SELECT donnees FROM images_produits WHERE produit_id = ?').get(id) || {}).donnees || null;
  function serialiserProduit(id, produit) {
    const p = { ...produit };
    if (typeof p.image === 'string' && p.image.startsWith('data:')) { db.prepare('INSERT OR REPLACE INTO images_produits (produit_id, donnees) VALUES (?, ?)').run(id, p.image); p.image = IMG; }
    else if (p.image !== IMG) { db.prepare('DELETE FROM images_produits WHERE produit_id = ?').run(id); delete p.image; }
    return JSON.stringify(p);
  }
  // Migration : images déjà enregistrées dans la fiche (une seule fois, par lots).
  for (const r of db.prepare(`SELECT id, donnees FROM produits WHERE donnees LIKE '%"image":"data:%'`).all()) {
    try { db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(serialiserProduit(r.id, JSON.parse(r.donnees)), r.id); } catch { /* fiche illisible : laissée */ }
  }
  const avecImage = p => p.image === IMG ? { ...p, image: imageDe(p.id) } : p;
  const listerProduits = (boutiqueId, avecSupprimes = false) =>
    db.prepare(`SELECT id, donnees FROM produits WHERE boutique_id = ? ${avecSupprimes ? '' : 'AND supprime = 0'} ORDER BY ordre, rowid`).all(boutiqueId)
      .map(p => ({ ...JSON.parse(p.donnees), id: p.id }));
  const lireCommande = row => row && ({ ...JSON.parse(row.donnees), id: row.id, numero: row.numero, date: row.date, statut: row.statut });
  const commandeDeBoutique = (boutiqueId, id) => {
    const c = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(id, boutiqueId));
    if (!c) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    return c;
  };
  // Webhooks et API : seulement avec un abonnement actif dont la formule inclut l'API (sinon plus aucune donnée ne sort).
  const apiPermise = boutiqueId => {
    const b = db.prepare('SELECT marchand_id FROM boutiques WHERE id = ?').get(boutiqueId);
    if (!b) return false;
    const e = abo.etat(b.marchand_id);
    return !!e.actif && (!e.obligatoire || Formules.permet(e.formule, 'api'));
  };
  const integ = creerIntegrations({ db, env, journal, permis: apiPermise });
  // Date de dernière modification des commandes (synchronisation incrémentale par l'API).
  try { db.exec('ALTER TABLE commandes ADD COLUMN maj_le INTEGER'); } catch { /* déjà là */ }
  db.exec('CREATE INDEX IF NOT EXISTS commandes_maj ON commandes(boutique_id, maj_le)');
  // Commande telle qu'envoyée aux intégrations du marchand (API, webhooks) : pas de jeton, pas de coûts internes.
  const commandeApi = (c, devise, { client = true } = {}) => ({ id: c.id, numero: c.numero, date: new Date(c.date).toISOString(), statut: c.statut, total: c.total, sousTotal: c.sousTotal, remise: c.remise || 0, port: c.port || 0, devise,
    livraison: c.livraison, canal: c.canal || 'web', moyen: c.moyen || 'en_ligne', facture: c.facture || null, suivi: c.suivi || null, transporteur: c.transporteur || null,
    // Données personnelles du client : seulement avec la permission clients:lecture (sinon le pays de livraison suffit).
    client: !c.client ? null : client ? { nom: c.client.nom, email: c.client.email, adresse: c.client.adresse, npa: c.client.npa, ville: c.client.ville, pays: c.client.pays || null } : { pays: c.client.pays || null },
    lignes: (c.lignes || []).map(l => ({ produitId: l.produitId, nom: l.nom, qte: l.qte, prix: l.prix, type: l.type || 'stock' })) });
  const enregistrerCommande = c => {
    const { id, numero, date, statut, ...donnees } = c;
    const avant = db.prepare('SELECT statut, boutique_id FROM commandes WHERE id = ?').get(id);
    db.prepare('UPDATE commandes SET statut = ?, donnees = ?, maj_le = ? WHERE id = ?').run(statut, JSON.stringify(donnees), Date.now(), id);
    // Changement de statut : les webhooks du marchand sont prévenus (commande.payee, .expediee, .remboursee…).
    if (avant && avant.statut !== statut) {
      try { const b = db.prepare('SELECT config FROM boutiques WHERE id = ?').get(avant.boutique_id); integ.emettre(avant.boutique_id, `commande.${statut}`, commandeApi({ ...c }, (JSON.parse(b.config).boutique || {}).devise || 'CHF')); }
      catch (e) { journal.error('[webhook]', e.message); }
    }
  };
  const historique = (c, texte) => c.historique.push({ date: Date.now(), texte });
  // Factures et avoirs partagent une seule suite de numéros, continue et sans trou.
  const prochaineFacture = (boutiqueId, date, prefixe = 'FA') => {
    const b = db.prepare('UPDATE boutiques SET compteur_facture = compteur_facture + 1 WHERE id = ? RETURNING compteur_facture').get(boutiqueId);
    return `${prefixe}-${new Date(date).getFullYear()}-${String(b.compteur_facture).padStart(4, '0')}`;
  };
  const ajusterStock = (boutiqueId, lignes, sens) => {
    for (const l of lignes) {
      if (l.type === 'drop') continue;
      const p = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ?').get(l.produitId, boutiqueId);
      if (!p) continue;
      const d = JSON.parse(p.donnees);
      // Stock jamais négatif : on note sur la ligne ce qui a vraiment été retiré, et seul ce nombre revient en cas
      // d'annulation ou de remboursement (sinon une commande vendue en rupture recréerait du stock fantôme).
      if (sens < 0) {
        const retire = Math.min(l.qte, Math.max(0, d.stock || 0)); l.retireStock = retire; d.stock = (d.stock || 0) - retire;
        if (retire > 0 && d.stock <= 0 && d.type !== 'drop') integ.emettre(boutiqueId, 'produit.rupture', { id: l.produitId, nom: d.nom, stock: 0 });   // passage à zéro (vente en ligne, caisse, paiement manuel)
      }
      else { const remis = typeof l.retireStock === 'number' ? l.retireStock : l.qte; d.stock = (d.stock || 0) + remis; l.retireStock = 0; }
      db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(JSON.stringify(d), l.produitId);
    }
  };
  /* E-mails : chaque e-mail d'une boutique se termine par son identité (raison sociale, adresse, contact).
     Les e-mails commerciaux (bienvenue, reconquête) ajoutent un lien de désinscription personnel et l'en-tête
     List-Unsubscribe ; une adresse désinscrite n'en reçoit plus (LCD art. 3 al. 1 let. o, RGPD). */
  db.exec(`CREATE TABLE IF NOT EXISTS desinscriptions (boutique_id TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE, cree_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, email));
    CREATE TABLE IF NOT EXISTS cles (nom TEXT PRIMARY KEY, valeur TEXT NOT NULL);`);
  if (!db.prepare("SELECT 1 FROM cles WHERE nom = 'desinscription'").get()) db.prepare("INSERT INTO cles (nom, valeur) VALUES ('desinscription', ?)").run(crypto.randomBytes(32).toString('hex'));
  const cleDesinscription = db.prepare("SELECT valeur FROM cles WHERE nom = 'desinscription'").get().valeur;
  const signerDesinscription = (boutiqueId, email) => crypto.createHmac('sha256', cleDesinscription).update(`${boutiqueId}|${String(email).toLowerCase()}`).digest('base64url').slice(0, 32);
  const jetonDesinscription = (boutiqueId, email) => `${Buffer.from(`${boutiqueId}|${String(email).toLowerCase()}`).toString('base64url')}.${signerDesinscription(boutiqueId, email)}`;
  const lireJetonDesinscription = j => {
    const [donnees, sig] = String(j || '').split('.');
    if (!donnees || !sig) return null;
    const [boutiqueId, email] = Buffer.from(donnees, 'base64url').toString('utf8').split('|');
    const attendu = signerDesinscription(boutiqueId, email);
    return auth.egal(sig, attendu) ? { boutiqueId, email } : null;
  };
  // Appareil où le marchand s'est connecté : cookie signé, valable un an, qui ne contient que l'empreinte de l'e-mail.
  // Lié à l'empreinte du mot de passe actuel : un changement ou une réinitialisation du mot de passe révoque tous les appareils.
  const jetonAppareil = email => { const m = db.prepare('SELECT mot_de_passe FROM marchands WHERE lower(email) = ?').get(email); return crypto.createHmac('sha256', cleDesinscription).update(`appareil|${email}|${m ? m.mot_de_passe : ''}`).digest('base64url').slice(0, 32); };
  /* ---------- Sécurité du compte : double authentification, appareils, journal d'activité ---------- */
  if (!db.prepare("SELECT 1 FROM cles WHERE nom = 'chiffrement'").get()) db.prepare("INSERT INTO cles (nom, valeur) VALUES ('chiffrement', ?)").run(crypto.randomBytes(32).toString('hex'));
  // Clé de chiffrement des secrets (TOTP) : SECRET_CHIFFREMENT (64 caractères hexadécimaux) si l'exploitant la garde hors de la base.
  const cleChiffrement = Buffer.from(/^[0-9a-f]{64}$/i.test(env.SECRET_CHIFFREMENT || '') ? env.SECRET_CHIFFREMENT : db.prepare("SELECT valeur FROM cles WHERE nom = 'chiffrement'").get().valeur, 'hex');
  db.exec(`CREATE TABLE IF NOT EXISTS deux_facteurs (marchand_id TEXT PRIMARY KEY REFERENCES marchands(id) ON DELETE CASCADE, secret TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 0, dernier_pas INTEGER NOT NULL DEFAULT -1, secours TEXT NOT NULL DEFAULT '[]', cree_le INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS journal_compte (id INTEGER PRIMARY KEY AUTOINCREMENT, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, date INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT, reseau TEXT);
    CREATE INDEX IF NOT EXISTS journal_compte_marchand ON journal_compte(marchand_id, date);`);
  for (const sql of ['ALTER TABLE sessions ADD COLUMN cree_le INTEGER', 'ALTER TABLE sessions ADD COLUMN vu_le INTEGER', 'ALTER TABLE sessions ADD COLUMN appareil TEXT', 'ALTER TABLE sessions ADD COLUMN reseau TEXT', 'ALTER TABLE sessions ADD COLUMN cle_acces TEXT']) { try { db.exec(sql); } catch { /* déjà là */ } }
  // Description sobre de l'appareil (navigateur et système), sans empreinte détaillée.
  const decrireAppareil = ua => {
    const u = String(ua || '');
    const nav = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Navigateur';
    const os = /iPhone|iPad/.test(u) ? 'iPhone / iPad' : /Android/.test(u) ? 'Android' : /Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'appareil';
    return `${nav} sur ${os}`;
  };
  const noterActivite = (marchandId, type, detail, ctx) => {
    db.prepare('INSERT INTO journal_compte (marchand_id, date, type, detail, reseau) VALUES (?, ?, ?, ?, ?)').run(marchandId, Date.now(), type, detail ? String(detail).slice(0, 200) : null, ctx ? reseauIp(ctx.ip) : null);
  };
  // Ouvre une session (cookie) et la décrit pour la liste des appareils connectés.
  function ouvrirSession(ctx, m, { nouvelAppareil = false } = {}) {
    const jeton = auth.creerSession(db, m.id), maintenant = Date.now(), appareil = decrireAppareil(ctx.req.headers['user-agent']);
    db.prepare('UPDATE sessions SET cree_le = ?, vu_le = ?, appareil = ?, reseau = ? WHERE jeton_hash = ?').run(maintenant, maintenant, appareil, reseauIp(ctx.ip), auth.sha256(jeton));
    ctx.entetes['Set-Cookie'] = [auth.cookieSession(jeton, securise), cookieAppareil(String(m.email).toLowerCase())];
    noterActivite(m.id, 'connexion', appareil, ctx);
    // Connexion depuis un appareil jamais vu : le marchand est prévenu (un mot de passe volé se voit tout de suite).
    if (nouvelAppareil) envoyerEmail(null, m.email, 'Nouvelle connexion à votre compte Comptoir',
      `Bonjour,\n\nUne connexion à votre compte vient d’avoir lieu depuis un nouvel appareil :\n- ${appareil}\n- le ${new Date(maintenant).toLocaleString('fr-CH')}\n\nC’était vous ? Rien à faire.\nSinon : changez votre mot de passe tout de suite et déconnectez les autres appareils (Paramètres > Sécurité), puis activez la double authentification.\n${urlPublique}/app\n\nL’équipe Comptoir`);
    return jeton;
  }
  // Défi de double authentification : signé, valable 5 minutes, lié au compte et à son mot de passe actuel.
  const signerDefi = (mid, expire) => crypto.createHmac('sha256', cleDesinscription).update(`2fa|${mid}|${expire}|${(db.prepare('SELECT mot_de_passe FROM marchands WHERE id = ?').get(mid) || {}).mot_de_passe}`).digest('base64url');
  const creerDefi = mid => { const expire = Date.now() + 5 * 60000; return `${mid}.${expire}.${signerDefi(mid, expire)}`; };
  const lireDefi = d => { const [mid, expire, sig] = String(d || '').split('.'); return mid && Number(expire) > Date.now() && auth.egal(sig, signerDefi(mid, Number(expire))) ? mid : null; };
  const deuxFacteursDe = mid => db.prepare('SELECT * FROM deux_facteurs WHERE marchand_id = ?').get(mid) || null;
  /* Vérifie un code de l'application ou un code de secours (consommé). Renvoie true/false ; met à jour le dernier pas. */
  function verifierSecondFacteur(df, saisi, ctx) {
    const s = String(saisi || '').trim();
    const pas = totp.verifier(totp.dechiffrer(cleChiffrement, df.secret), s, { dernierPas: df.dernier_pas });
    if (pas !== null) { db.prepare('UPDATE deux_facteurs SET dernier_pas = ? WHERE marchand_id = ?').run(pas, df.marchand_id); return true; }
    const secours = JSON.parse(df.secours), i = secours.indexOf(totp.empreinteSecours(s));
    if (i >= 0 && s.replace(/[^a-z0-9]/gi, '').length === 10) {
      secours.splice(i, 1); db.prepare('UPDATE deux_facteurs SET secours = ? WHERE marchand_id = ?').run(JSON.stringify(secours), df.marchand_id);
      noterActivite(df.marchand_id, 'code-secours', `${secours.length} code(s) de secours restant(s)`, ctx);
      return true;
    }
    return false;
  }
  // Codes refusés à répétition : le mot de passe est probablement connu d'un tiers ; le propriétaire est prévenu (au plus 1 fois par heure).
  function alerterEchecs2fa(m) {
    try { auth.limiter('alerte-2fa:' + m.id, 1, 3600000, ''); } catch { return; }
    envoyerEmail(null, m.email, 'Codes de vérification refusés sur votre compte Comptoir', `Bonjour,\n\nPlusieurs codes de vérification faux viennent d’être saisis après votre mot de passe. Votre mot de passe est probablement connu de quelqu’un d’autre : changez-le maintenant (Paramètres > Zone sensible) et vérifiez vos appareils connectés (Paramètres > Sécurité).\n${urlPublique}/app\n\nVotre double authentification a bloqué l’accès.\n\nL’équipe Comptoir`);
  }
  const cookieAppareil = email => `comptoir_appareil=${jetonAppareil(email)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${securise ? '; Secure' : ''}`;
  // IPv6 : une personne dispose d'un réseau /64 entier ; les limites comptent par réseau, pas par adresse.
  const reseauIp = ip => {
    const a = String(ip || '').toLowerCase().replace(/%.*$/, '').replace(/^::ffff:/, '');
    if (!a.includes(':')) return a;
    const [g, d] = a.split('::'), gauche = g ? g.split(':') : [], droite = d !== undefined && d ? d.split(':') : [];
    const groupes = d === undefined ? gauche : [...gauche, ...Array(Math.max(0, 8 - gauche.length - droite.length)).fill('0'), ...droite];
    return groupes.slice(0, 4).map(x => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
  };
  const jetonDomaine = boutiqueId => crypto.createHmac('sha256', cleDesinscription).update(`domaine|${boutiqueId}`).digest('hex').slice(0, 24);
  const estDesinscrit = (boutiqueId, email) => !!db.prepare('SELECT 1 FROM desinscriptions WHERE boutique_id = ? AND email = ?').get(boutiqueId, email);
  /* Contenu des e-mails de commande : récapitulatif, lien de suivi personnel, lien du transporteur. */
  const lienCommande = (b, id) => { const row = db.prepare('SELECT jeton_client, donnees FROM commandes WHERE id = ?').get(id); if (!row) return urlBoutique(b); const langue = (() => { try { return JSON.parse(row.donnees).langue; } catch { return null; } })(); return EmailsClients.avecLangue(`${urlBoutique(b)}?commande=${encodeURIComponent(id)}&jeton=${encodeURIComponent(row.jeton_client)}`, { langue }); };
  /* France et Belgique : l'information sur la rétractation et le formulaire type doivent figurer sur un support durable (directive 2011/83, art. 8.7). */
  const infoRetractation = (bq, c, config) => {
    const pays = config.boutique.pays;
    if (pays === 'ch' || c.canal === 'magasin') return '';
    const article = pays === 'be' ? 'art. VI.47 du Code de droit économique' : 'art. L221-18 du Code de la consommation';
    const e = config.entreprise || {};
    const vendeur = [e.raison || config.boutique.nom, e.adresse, e.email].filter(Boolean).join(', ');
    return `\n\nDroit de rétractation : vous disposez de 14 jours à compter de la réception pour vous rétracter, sans avoir à vous justifier (${article}). Il suffit de nous le dire, par exemple en répondant à cet e-mail ; le remboursement intervient au plus tard 14 jours après votre demande. Conditions générales de vente : ${urlBoutique(bq)} (bas de page).\n\nFormulaire de rétractation (à compléter et renvoyer si vous le souhaitez) :\nÀ l’attention de ${vendeur} :\nJe vous notifie par la présente ma rétractation du contrat portant sur la vente du bien ci-dessous : commande n° ${c.numero}, commandée le ${new Date(c.date).toLocaleDateString('fr-FR')}, reçue le : ....\nNom : ${c.client.nom}\nAdresse : ....\nDate et signature : ....`;
  };
  const recapitulatif = (c, config) => [
    ...c.lignes.map(l => `- ${l.qte} × ${l.nom} : ${formatMontant(l.prix * l.qte, config)}`),
    // Les prix des articles sont déjà remisés : la remise est indiquée pour information, pas soustraite une seconde fois.
    ...(c.remise ? [`  (prix après remise${c.motifRemise ? ` : ${c.motifRemise}` : ''}, soit ${formatMontant(c.remise, config)} d’économie)`] : []),
    c.livraison === 'retrait' ? '- Retrait en boutique : gratuit' : `- Livraison (${(prix.modesLivraison(config)[c.livraison] || { nom: c.livraison }).nom}) : ${c.port ? formatMontant(c.port, config) : 'offerte'}`,
    `Total payé : ${formatMontant(c.total, config)}`
  ].join('\n');
  const lienTransporteur = (transporteur, suivi, pays) => {
    const n = encodeURIComponent(String(suivi || '').replace(/\s/g, ''));
    // La Poste suisse : tout numéro pour une boutique suisse (colis 99.…, recommandés RR…CH, etc.)
    if (/la poste|post/i.test(transporteur || '') && (pays === 'ch' || /^99\.|^\d{2}\.\d{2}/.test(suivi || ''))) return `https://service.post.ch/ekp-web/ui/entry/shipping/0?formattedParcelCodes=${n}`;
    if (/colissimo|la poste/i.test(transporteur || '')) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
    if (/chronopost/i.test(transporteur || '')) return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
    if (/mondial/i.test(transporteur || '')) return `https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition=${n}`;
    if (/bpost/i.test(transporteur || '')) return `https://track.bpost.cloud/btr/web/#/search?itemCode=${n}&lang=fr`;
    return null;
  };
  const optionsEmail = (b, c, config) => ({ nomBoutique: config.boutique.nom, formatMontant: m => formatMontant(m, config), nomLivraison: (prix.modesLivraison(config)[c.livraison] || { nom: c.livraison }).nom, lienCommande: lienCommande(b, c.id), contact: config.entreprise && config.entreprise.email });
  const emailExpedition = (b, c, config) => {
    const lien = lienTransporteur(c.transporteur || (prix.modesLivraison(config)[c.livraison] || {}).transporteur, c.suivi, config.boutique.pays);
    if (EmailsClients.langueDe(c)) { const m = EmailsClients.expedition(c, { ...optionsEmail(b, c, config), lienSuivi: lien }); return envoyerEmail(b.id, c.client.email, m.sujet, m.corps, { langue: c.langue }); }
    envoyerEmail(b.id, c.client.email, `Votre commande n° ${c.numero} est en route`,
      `Bonjour ${c.client.nom},\n\nVotre colis est parti${c.transporteur ? ` avec ${c.transporteur}` : ''}.${c.suivi ? `\nNuméro de suivi : ${c.suivi}` : ''}${c.suivi && lien ? `\nSuivre le colis : ${lien}` : ''}\n\nVotre commande : ${lienCommande(b, c.id)}\n\nMerci et à bientôt,\n${config.boutique.nom}`);
  };
  const envoyerEmail = (boutiqueId, destinataire, sujet, corps, { marketing = false, motif = 'nouvelles', langue = null } = {}) => {
    if (!destinataire) return;
    if (marketing && boutiqueId && estDesinscrit(boutiqueId, destinataire)) return;
    let pied = '', lien = null;
    const b = boutiqueId ? db.prepare('SELECT config FROM boutiques WHERE id = ?').get(boutiqueId) : null;
    if (b) {
      const conf = JSON.parse(b.config), e = conf.entreprise || {};
      const tp = EmailsClients.textesPied(langue);   // pied dans la langue du client (e-mails traduits)
      const identite = [e.raison || conf.boutique.nom, e.adresse, e.email ? `${tp ? tp.contact : 'Contact'} : ${e.email}` : ''].filter(Boolean).join(' · ');
      if (marketing) lien = `${urlPublique}/desinscription?j=${jetonDesinscription(boutiqueId, destinataire)}`;
      pied = `\n\n—\n${identite}${lien ? `\n${tp ? (motif === 'commande' ? tp.commande : tp.nouvelles)(conf.boutique.nom) : motif === 'commande' ? `Vous recevez cet e-mail à la suite de votre commande chez ${conf.boutique.nom}. Pour ne plus recevoir ce type de message` : `Vous recevez cet e-mail car vous avez accepté les nouvelles de ${conf.boutique.nom}. Pour ne plus les recevoir`} : ${lien}` : ''}`;
    }
    db.prepare('INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le, desinscription) VALUES (?, ?, ?, ?, ?, ?)').run(boutiqueId, destinataire, sujet, corps.replace(/\s+$/, '') + pied, Date.now(), lien);
    if (env.LOG_EMAILS) journal.log(`[e-mail] à ${destinataire} : ${sujet}`);
  };
  const formatMontant = (n, config) => {
    if ((config.boutique.devise || 'EUR') !== 'CHF') return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: config.boutique.devise || 'EUR' });
    const [e, c] = (Math.round(Math.abs(n) * 100) / 100).toFixed(2).split('.');
    return `${n < 0 ? '−' : ''}CHF ${e.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}.${c}`;
  };

  /* ---------- Validation de la configuration envoyée par l'éditeur ---------- */
  function nettoyerConfig(config) {
    if (!config || typeof config !== 'object' || !config.boutique || typeof config.boutique !== 'object') throw erreur(400, 'Configuration de boutique invalide.', 'config_invalide');
    if (JSON.stringify(config).length > 300000) throw erreur(413, 'Configuration trop volumineuse.', 'trop_volumineux');
    const b = config.boutique;
    b.nom = valider.texte(b.nom, 'Le nom de la boutique', { max: 80 });
    b.pays = ['fr', 'be', 'ch', 'ca'].includes(b.pays) ? b.pays : 'ch';
    b.devise = b.pays === 'ch' ? 'CHF' : b.pays === 'ca' ? 'CAD' : 'EUR';
    const objet = x => x && typeof x === 'object' && !Array.isArray(x);
    // Chaque partie de la configuration doit être un objet : une valeur d'un autre type est remplacée, jamais acceptée telle quelle.
    for (const k of ['entreprise', 'magasin', 'reglages', 'campagnes', 'automatisations', 'offres', 'social']) if (config[k] !== undefined && !objet(config[k])) config[k] = {};
    const t = objet(b.theme) ? b.theme : {};
    // Couleur absente ou invalide : celle du thème Léman (lisible), jamais un gris unique qui rendrait le texte invisible.
    const THEME_DEFAUT = { bg: '#EEF3F4', surface: '#FFFFFF', text: '#14242B', muted: '#566A72', primary: '#1D5C70', onPrimary: '#FFFFFF' };
    const complet = ['bg', 'surface', 'text', 'muted', 'primary', 'onPrimary'].every(k => COULEUR.test(t[k] || ''));
    for (const k of Object.keys(THEME_DEFAUT)) if (!complet || !COULEUR.test(t[k] || '')) t[k] = THEME_DEFAUT[k];
    if (!POLICES.includes(t.font)) t.font = POLICES[4];
    if (!POLICES.includes(t.body)) t.body = POLICES[4];
    t.radius = Math.max(0, Math.min(24, Number(t.radius) || 0));
    b.theme = t;
    if (!Array.isArray(b.sections)) b.sections = [];
    b.sections = b.sections.filter(objet);
    b.sections = b.sections.slice(0, 40).map(s => ({ id: String(s.id).slice(0, 20), type: String(s.type).slice(0, 20), props: Object.fromEntries(Object.entries(s.props || {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 20), String(v ?? '').slice(0, 2000)])) }));
    return {
      boutique: b,
      entreprise: config.entreprise || {},
      magasin: config.magasin || {},
      reglages: { autoTransmission: config.reglages ? config.reglages.autoTransmission !== false : true, cpa: Number(config.reglages && config.reglages.cpa) || 8, factureQr: !!(config.reglages && config.reglages.factureQr), rapportHebdo: !(config.reglages && config.reglages.rapportHebdo === false), echeanceJours: Math.max(10, Math.min(60, Math.round(Number(config.reglages && config.reglages.echeanceJours) || 30))) },
      campagnes: config.campagnes || {},
      rdv: config.rdv || null,
      cookies: config.cookies || null,
      social: social.nettoyerReglages(config.social),
      automatisations: relances.nettoyer(config.automatisations),
      offres: Remises.offresDe(config),
      fournisseursSuivi: Object.fromEntries(Object.entries(config.fournisseursSuivi || {}).slice(0, 50).map(([k, v]) => [String(k).slice(0, 80), Object.fromEntries(['echantillon', 'reponse', 'delai', 'douane'].map(c => [c, !!(v && v[c])]))])),
      lancement: Object.fromEntries(Object.entries(config.lancement || {}).slice(0, 30).map(([k, v]) => [String(k).slice(0, 20), !!v])),
      tests: (Array.isArray(config.tests) ? config.tests : []).filter(x => x && typeof x === 'object').slice(-50).map(t => ({
        id: String(t.id).slice(0, 30), produitId: String(t.produitId).slice(0, 40), canal: ['meta', 'tiktok-ads', 'organique'].includes(t.canal) ? t.canal : 'meta',
        budgetJour: Math.max(0, Number(t.budgetJour) || 0), debut: Number(t.debut) || Date.now(),
        resultats: (Array.isArray(t.resultats) ? t.resultats : []).filter(x => x && typeof x === 'object').slice(0, 60).map(r => Object.fromEntries(['depense', 'vues', 'impressions', 'vues3s', 'clics', 'ventes'].map(k => [k, Math.max(0, Number(r[k]) || 0)])))
      }))
    };
  }
  function nettoyerProduit(p, historiqueAvant = []) {
    const type = p.type === 'drop' ? 'drop' : 'stock';
    const propre = {
      nom: valider.texte(p.nom, 'Le nom du produit', { max: 120 }),
      description: typeof p.description === 'string' ? p.description.slice(0, 3000) : '',
      categorie: typeof p.categorie === 'string' ? p.categorie.slice(0, 60) : '',
      prix: prix.arrondi(valider.nombre(p.prix, 'Le prix', { min: 0, max: 100000 })),   // au centime
      stock: type === 'drop' ? 999 : valider.entier(p.stock ?? 0, 'Le stock', { min: 0, max: 1e6 }),
      actif: p.actif !== false,
      teinte: Math.abs(Math.round(Number(p.teinte) || 0)) % 360,
      type,
      aVerifier: !!p.aVerifier,
      tauxReduit: !!p.tauxReduit   // denrées alimentaires : TVA à taux réduit
    };
    if (p.cout !== undefined && p.cout !== null && p.cout !== '') propre.cout = prix.arrondi(valider.nombre(p.cout, 'Le coût', { min: 0, max: 100000 }));
    if (p.image === '#image') propre.image = '#image';   // photo déjà rangée dans images_produits, inchangée
    else if (typeof p.image === 'string' && p.image) {
      if (!IMAGE.test(p.image) || p.image.length > 400000) throw erreur(400, 'Image invalide : JPEG, PNG ou WebP de moins de 300 Ko.', 'image_invalide');
      propre.image = p.image;
    }
    if (p.prixReference !== undefined && p.prixReference !== null && p.prixReference !== '' && Number(p.prixReference) > 0) propre.prixReference = valider.nombre(p.prixReference, 'Le prix barré', { min: 0, max: 100000 });
    // Historique des prix tenu par le serveur seul (sert à vérifier les prix barrés) : le navigateur ne peut pas le modifier.
    propre.historiquePrix = PrixBarres.noterPrix(historiqueAvant, propre.prix);
    if (type === 'drop') Object.assign(propre, { portF: Number(p.portF) || 0, entrepot: ['CH', 'UE', 'CN'].includes(p.entrepot) ? p.entrepot : 'UE', delai: Array.isArray(p.delai) ? p.delai.slice(0, 2).map(Number) : [3, 7], fournisseur: String(p.fournisseur || '').slice(0, 80), source: String(p.source || '').slice(0, 40), codeFournisseur: p.codeFournisseur || 'demo' });
    return propre;
  }
  /* Produit envoyé par le navigateur : l'origine fournisseur ne se déclare pas, elle vient du catalogue.
     Sans cela, un faux « source » gonflerait les tendances et un faux code fournisseur contournerait « vendable ». */
  function produitDuNavigateur(p, historiqueAvant) {
    // Produit d'un vrai fournisseur déclaré (restauration d'une sauvegarde) : il le garde ; sinon, catalogue de démonstration.
    const reel = p && p.type === 'drop' && p.codeFournisseur && p.codeFournisseur !== 'demo' && db.prepare('SELECT 1 FROM fournisseurs WHERE code = ?').get(String(p.codeFournisseur));
    if (reel) return nettoyerProduit({ ...p, source: String(p.source || '').slice(0, 40), codeFournisseur: String(p.codeFournisseur) }, historiqueAvant);
    const src = p && p.type === 'drop' && fournisseurs.CATALOGUE_DEMO.find(x => x.id === p.source);
    return nettoyerProduit({ ...p, source: src ? src.id : '', codeFournisseur: 'demo' }, historiqueAvant);
  }
  /* Ajoute un produit du catalogue fournisseur à une boutique (une seule fois par produit source). */
  function importerProduit(boutiqueId, src, codeFournisseur) {
    const deja = listerProduits(boutiqueId).find(p => p.source === src.id);
    if (deja) return { id: deja.id, deja: true };
    const id = auth.nouvelId('p_');
    const produit = nettoyerProduit({ ...src, type: 'drop', actif: true, tauxReduit: src.niche === 'epicerie', teinte: (src.id.charCodeAt(2) * 47) % 360, source: src.id, codeFournisseur, description: src.description || `${src.nom}. Expédié par notre partenaire, livré en ${src.delai[0]} à ${src.delai[1]} jours.` });
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, (SELECT COALESCE(MAX(ordre), 0) + 1 FROM produits WHERE boutique_id = ?))').run(id, boutiqueId, serialiserProduit(id, produit), boutiqueId);
    return { id };
  }
  function slugUnique(nom) {
    const base = nom.replace(/<[^>]*>/g, ' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'boutique';
    let slug = base, i = 2;
    while (db.prepare('SELECT 1 FROM boutiques WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
    return slug;
  }
  function insererProduits(boutiqueId, produits) {
    (Array.isArray(produits) ? produits : []).filter(p => p && typeof p === 'object').slice(0, 200).forEach((p, i) => {
      const id = auth.nouvelId('p_');
      db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, ?)').run(id, boutiqueId, serialiserProduit(id, produitDuNavigateur(p)), i);
    });
  }

  /* ---------- Flux des statuts (mêmes règles que l'interface) ---------- */
  const estDrop = c => c.lignes.length > 0 && c.lignes.every(l => l.type === 'drop');
  function transitionsPossibles(c) {
    if (estDrop(c) && c.canal !== 'magasin') {
      if (c.statut === 'payee') return ['fournisseur', 'remboursee'];
      if (c.statut === 'fournisseur') return ['expediee'];
    }
    if (c.livraison === 'retrait') {
      if (c.statut === 'preparation') return ['prete'];
      if (c.statut === 'prete') return ['retiree'];
      if (c.statut === 'retiree') return ['remboursee'];
    }
    return { attente: ['payee', 'annulee'], payee: ['preparation', 'remboursee'], preparation: ['expediee', 'remboursee'], expediee: ['livree'], livree: ['remboursee'] }[c.statut] || [];
  }

  /* Transmet au fournisseur les articles en dropshipping d'une commande payée. */
  const transmissionsEnCours = new Set();
  async function transmettreAuFournisseur(boutique, c, auto) {
    const lignesDrop = c.lignes.filter(l => l.type === 'drop');
    if (!lignesDrop.length || c.refFournisseur) return c;
    if (transmissionsEnCours.has(c.id)) throw erreur(409, 'Transmission déjà en cours pour cette commande.', 'transmission_en_cours');
    transmissionsEnCours.add(c.id);
    try { return await transmettre(boutique, c, auto, lignesDrop); } finally { transmissionsEnCours.delete(c.id); }
  }
  async function transmettre(boutique, c, auto, lignesDrop) {
    const f = db.prepare('SELECT * FROM fournisseurs WHERE code = ?').get(lignesDrop[0].codeFournisseur || 'demo');
    if (!f) throw erreur(500, 'Fournisseur non configuré.', 'fournisseur_absent');
    // Routage : le même produit existe-t-il dans un entrepôt plus proche du client ? (Suisse > UE > Chine)
    const pays = lireConfig(boutique).boutique.pays;
    const rang = e => (pays === 'ch' ? { CH: 0, UE: 1, CN: 2 } : { UE: 0, CH: 1, CN: 2 })[e] ?? 3;
    let catalogue = [];
    try { catalogue = await fournisseurs.client(f, fetchImpl).catalogue(); } catch { /* sans catalogue : source d’origine */ }
    const routes = [];
    const sources = lignesDrop.map(l => {
      const actuel = catalogue.find(x => x.id === l.source);
      if (!actuel) return l.source;
      const meilleur = catalogue.filter(x => x.nom === actuel.nom).sort((a, b) => rang(a.entrepot) - rang(b.entrepot) || a.delai[1] - b.delai[1])[0];
      if (meilleur && meilleur.id !== actuel.id && rang(meilleur.entrepot) < rang(actuel.entrepot)) { routes.push(`${l.nom} : entrepôt ${actuel.entrepot} → ${meilleur.entrepot}`); return meilleur.id; }
      return l.source;
    });
    const rep = await fournisseurs.client(f, fetchImpl).passerCommande({
      referenceMarchand: `${boutique.slug}-${c.numero}-${c.id.slice(-6)}`,   // unique même si un nom de boutique est réutilisé
      lignes: lignesDrop.map((l, i) => ({ produitId: sources[i], qte: l.qte })),
      livraison: { nom: c.client.nom, adresse: c.client.adresse || '', npa: c.client.npa || '', ville: c.client.ville, pays: lireConfig(boutique).boutique.pays.toUpperCase() }
    });
    const frais = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.id));
    if (frais.refFournisseur) { journal.error('[fournisseur] commande déjà transmise', c.id, frais.refFournisseur, rep.ref); return frais; }
    frais.refFournisseur = rep.ref;
    frais.codeFournisseur = f.code;
    if (estDrop(frais)) frais.statut = 'fournisseur';
    historique(frais, `${auto ? 'Transmise automatiquement' : 'Transmise'} à ${f.nom} (${rep.ref})`);
    if (routes.length) historique(frais, `Routée vers l’entrepôt le plus proche du client : ${routes.join(' ; ')}`);
    enregistrerCommande(frais);
    return frais;
  }

  /* Appelé une seule fois quand le paiement est confirmé (idempotent). */
  /* Commande payée (dans une transaction) : facture, complément rattaché, alerte de rupture, stock. */
  function marquerPayee(row, texte) {
    const c = lireCommande(row);
    c.statut = 'payee'; c.payeLe = Date.now();
    if (!c.facture) { c.facture = prochaineFacture(row.boutique_id, Date.now()); c.dateFacture = Date.now(); }   // facture QR : déjà émise
    if (c.relances) { c.recuperee = true; c.historique.push({ date: Date.now(), texte: 'Paiement récupéré après relance' }); }
    if (c.parent) {
      const pr = db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.parent);
      if (pr) { const parent = lireCommande(pr); parent.complements = [...(parent.complements || []), c.id]; historique(parent, `Complément n° ${c.numero} ajouté après l’achat : à expédier dans le même colis`); enregistrerCommande(parent); }
    }
    historique(c, texte);
    // Stock : la vente est faite (le client a payé), mais une rupture est signalée au lieu d'être cachée.
    const prods = listerProduits(row.boutique_id);
    const manques = c.lignes.filter(l => l.type !== 'drop').map(l => ({ l, p: prods.find(x => x.id === l.produitId) })).filter(x => x.p && x.p.type !== 'drop' && x.p.stock < c.lignes.filter(y => y.produitId === x.l.produitId).reduce((a, y) => a + y.qte, 0));
    if (manques.length) { c.alerteStock = true; historique(c, `Rupture de stock au paiement : ${[...new Set(manques.map(x => x.p.nom))].join(', ')}. Réapprovisionnez ou remboursez.`); }
    ajusterStock(row.boutique_id, c.lignes, -1);
    enregistrerCommande(c);
    return { c, boutique: db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id) };
  }
  /* Après un paiement (en ligne ou relevé bancaire) : e-mails au client et au marchand, transmission au fournisseur. */
  async function apresPaiement(res) {
    const config = lireConfig(res.boutique);
    if (EmailsClients.langueDe(res.c)) { const m = EmailsClients.confirmation(res.c, { ...optionsEmail(res.boutique, res.c, config), legal: infoRetractation(res.boutique, res.c, config) }); envoyerEmail(res.boutique.id, res.c.client.email, m.sujet, m.corps, { langue: res.c.langue }); }
    else envoyerEmail(res.boutique.id, res.c.client.email, `Commande n° ${res.c.numero} confirmée`,
      `Bonjour ${res.c.client.nom},\n\nMerci pour votre commande chez ${config.boutique.nom}.\n\n${recapitulatif(res.c, config)}\n\n${res.c.livraison === 'retrait' ? 'Nous vous écrivons dès que la commande est prête à retirer.' : 'Nous vous écrivons dès l’expédition, avec le numéro de suivi.'}\nSuivre votre commande : ${lienCommande(res.boutique, res.c.id)}\n\nUne question ? Répondez à cet e-mail${config.entreprise && config.entreprise.email ? ` ou écrivez à ${config.entreprise.email}` : ''}.${infoRetractation(res.boutique, res.c, config)}`);
    // Le marchand est prévenu de chaque commande payée (sans e-mail, une commande à expédier pourrait rester oubliée).
    {
      const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(res.boutique.marchand_id);
      const drop = res.c.lignes.every(l => l.type === 'drop'), auto = config.reglages.autoTransmission;
      const retenue = res.c.risque && res.c.risque.niveau === 'eleve';
      const quoiFaire = retenue ? `Attention : risque de fraude élevé (${res.c.risque.score}/100 : ${res.c.risque.raisons.join(' ; ')}). ${auto && res.c.lignes.some(l => l.type === 'drop') ? `La transmission automatique ${drop ? '' : 'de la partie fournisseur '}est retenue : vérifiez la commande, puis transmettez-la ou remboursez-la depuis Commandes.` : ''}${drop ? '' : ' Vérifiez-la avant d’expédier vos articles.'}${res.c.alerteStock ? ' Rupture de stock aussi sur cette commande.' : ''}` : res.c.alerteStock ? 'Attention : rupture de stock pour cette commande. Réapprovisionnez, ou remboursez le client depuis Commandes.' : res.c.parent ? `Complément de la commande n° ${(lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(res.c.parent)) || {}).numero || ''} : à joindre au même colis.` : res.c.livraison === 'retrait' ? 'À préparer pour un retrait en magasin.' : drop && auto ? 'Rien à faire : la commande part automatiquement chez le fournisseur.' : drop ? 'À transmettre au fournisseur depuis Commandes.' : 'À préparer et expédier.';
      // Produits en stock tombés à zéro avec cette vente : ils s'affichent « Épuisé » ; le marchand doit le savoir.
      // Une seule alerte, au passage à zéro : le stock d'avant cette vente était positif (pas de doublon à chaque vente suivante).
      const vendus = {}; for (const l of res.c.lignes) if (l.type !== 'drop') vendus[l.produitId] = (vendus[l.produitId] || 0) + l.qte;
      const epuises = res.c.alerteStock ? [] : listerProduits(res.boutique.id).filter(p => vendus[p.id] && p.type !== 'drop' && p.stock <= 0 && p.stock + vendus[p.id] > 0);   // en rupture, l'e-mail de commande le dit déjà
      if (mch && epuises.length) envoyerEmail(null, mch.email, `Stock épuisé : ${epuises.map(p => p.nom).join(', ').slice(0, 120)}`, `Bonjour,\n\nAprès la commande n° ${res.c.numero}, ces produits n'ont plus de stock et s'affichent « Épuisé » dans votre boutique :\n${epuises.map(p => `- ${p.nom}`).join('\n')}\n\nRéassort : ${urlPublique}/app#produits`);
      notifierPush(res.boutique.marchand_id, { titre: `${res.c.parent ? 'Complément' : 'Nouvelle commande'} n° ${res.c.numero}`, texte: `${formatMontant(res.c.total, config)}${res.c.risque && res.c.risque.niveau === 'eleve' ? ' · risque de fraude élevé, à vérifier' : ''}`, url: '/app#commandes' }).catch(() => {});
      if (mch) envoyerEmail(null, mch.email, `${res.c.parent ? 'Complément de commande' : 'Nouvelle commande'} n° ${res.c.numero} : ${formatMontant(res.c.total, config)}`,
        `Bonjour,\n\nNouvelle commande payée sur ${config.boutique.nom}.\n\n${recapitulatif(res.c, config)}\n\n${res.c.livraison !== 'retrait' && res.c.client.ville ? `Livraison : ${res.c.client.ville}\n` : ''}${quoiFaire}\n\nVoir la commande : ${urlPublique}/app#commandes`);
    }
    if (config.reglages.autoTransmission && res.c.lignes.some(l => l.type === 'drop') && res.c.risque && res.c.risque.niveau === 'eleve') {
      const c = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(res.c.id));
      historique(c, 'Transmission automatique au fournisseur retenue : risque de fraude élevé. Vérifiez puis transmettez à la main.'); enregistrerCommande(c);
    } else if (config.reglages.autoTransmission && res.c.lignes.some(l => l.type === 'drop')) {
      try { await transmettreAuFournisseur(res.boutique, res.c, true); } catch (e) {
        const c = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(res.c.id));
        historique(c, `Échec de la transmission automatique : ${e.message} Transmettez-la à la main.`);
        enregistrerCommande(c);
        journal.error('[fournisseur]', e.message);
        const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(res.boutique.marchand_id);
        if (mch) envoyerEmail(null, mch.email, `Action requise : commande n° ${c.numero} non transmise au fournisseur`, `Bonjour,\n\nLa commande n° ${c.numero} a été payée, mais sa transmission automatique au fournisseur a échoué : ${e.message}\n\nTransmettez-la à la main depuis Commandes : ${urlPublique}/app#commandes\n\nTant qu'elle n'est pas transmise, rien n'est expédié au client.`);
      }
    }
  }
  async function paiementConfirme(paiementId, refExterne) {
    const p0 = db.prepare('SELECT * FROM paiements WHERE id = ?').get(paiementId);
    if (!p0 || p0.statut === 'paye' || p0.statut === 'rembourse' || p0.statut === 'a_rembourser') return;
    const res = transaction(db, () => {
      const p = db.prepare('SELECT * FROM paiements WHERE id = ?').get(paiementId);   // relu dans la transaction
      if (!p || ['paye', 'rembourse', 'a_rembourser'].includes(p.statut)) return null;
      const row = db.prepare('SELECT * FROM commandes WHERE id = ?').get(p.commande_id);
      // Commande déjà payée (autre lien de paiement) ou annulée : l'argent reçu est à rendre, la commande ne change pas.
      if (row.statut !== 'attente') {
        db.prepare("UPDATE paiements SET statut = 'a_rembourser', ref_externe = COALESCE(?, ref_externe) WHERE id = ?").run(refExterne || null, p.id);
        const c0 = lireCommande(row);
        historique(c0, `Paiement reçu alors que la commande était « ${row.statut} » : ${formatMontant(p.montant_centimes / 100, lireConfig(db.prepare('SELECT config FROM boutiques WHERE id = ?').get(row.boutique_id)))} à rembourser`);
        enregistrerCommande(c0);
        return { aRembourser: { ...p, statut: 'a_rembourser', ref_externe: refExterne || p.ref_externe } };
      }
      db.prepare("UPDATE paiements SET statut = 'paye', ref_externe = COALESCE(?, ref_externe) WHERE id = ?").run(refExterne || null, p.id);
      // Les autres liens de paiement encore ouverts pour cette commande ne servent plus.
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE commande_id = ? AND id <> ? AND statut = 'cree'").run(p.commande_id, p.id);
      return marquerPayee(row, `Paiement ${p.fournisseur === 'stripe' ? 'en ligne' : 'simulé'} accepté (${formatMontant(p.montant_centimes / 100, lireConfig(db.prepare('SELECT config FROM boutiques WHERE id = ?').get(row.boutique_id)))})`);
    });
    if (!res) return;
    if (res.aRembourser) {
      // Remboursement automatique quand c'est possible (Stripe) ; sinon, il reste signalé au marchand.
      if (res.aRembourser.fournisseur === 'stripe') {
        try { await paiement.rembourser({ paiement: res.aRembourser }); db.prepare("UPDATE paiements SET statut = 'rembourse' WHERE id = ?").run(res.aRembourser.id); }
        catch (e) { journal.error('[paiement] remboursement automatique', e.message); }
      }
      return;
    }
    await apresPaiement(res);
  }

  /* Ajoute un cookie à la réponse sans effacer ceux déjà posés (session renouvelée, appareil reconnu…). */
  const ajouterCookie = (ctx, c) => { const v = ctx.entetes['Set-Cookie']; ctx.entetes['Set-Cookie'] = v ? [...(Array.isArray(v) ? v : [v]), c] : c; };
  // Session glissante : le cookie du navigateur repart pour 30 jours avec la session en base.
  const renouvelerCookie = (ctx, m) => { if (m && m.cookieRenouvele) { ajouterCookie(ctx, auth.cookieSession(m.cookieRenouvele, securise)); delete m.cookieRenouvele; } };
  /* ---------- Garde d'authentification ---------- */
  // Compte connecté (sans exiger l'abonnement) : paiement de l'abonnement, suppression du compte.
  const exigerCompte = ctx => {
    ctx.marchand = auth.marchandDepuisRequete(db, ctx.cookies);
    if (!ctx.marchand) throw erreur(401, 'Connectez-vous pour continuer.', 'non_connecte');
    renouvelerCookie(ctx, ctx.marchand);
    const h = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    db.prepare('UPDATE sessions SET vu_le = ? WHERE jeton_hash = ? AND (vu_le IS NULL OR vu_le < ?)').run(Date.now(), h, Date.now() - 300000);
    ctx.boutique = boutiqueDuMarchand(ctx.marchand.id);
  };
  // Espace marchand : uniquement sa propre boutique (boutique_id du compte), et seulement si l'abonnement est payé.
  // Abonnement terminé ou impayé, après au moins un paiement : consultation et export de ses données, suivi des commandes
  // déjà passées et effacement d'un client (obligation légale) restent possibles ; tout le reste attend un nouvel abonnement.
  const LECTURE_SEULE = new Set(['GET /api/admin/etat', 'GET /api/admin/clients/export', 'GET /api/admin/emails', 'POST /api/admin/clients/effacer', 'GET /api/admin/integrations']);
  const exigerMarchand = ctx => {
    exigerCompte(ctx);
    const e = abo.etat(ctx.marchand.id);
    if (e.actif) return;
    const route = `${ctx.req.method} ${new URL(ctx.req.url, 'http://x').pathname}`;
    // Les commandes déjà payées doivent pouvoir être expédiées, transmises ou remboursées : les clients ont payé.
    // Le marchand doit toujours pouvoir couper ses intégrations (clés, webhooks), même abonnement terminé.
    const suiviCommande = /^POST \/api\/admin\/commandes\/[\w-]+\/(statut|transmettre)$/.test(route) || /^POST \/api\/admin\/integrations\/(cles\/[\w-]+\/revoquer|webhooks\/[\w-]+\/supprimer)$/.test(route);
    if (['resilie', 'impaye'].includes(e.statut) && (LECTURE_SEULE.has(route) || suiviCommande)) { ctx.lectureSeule = true; return; }
    throw erreur(402, ['resilie', 'impaye'].includes(e.statut) ? 'Abonnement terminé : vos données restent consultables et exportables ; reprenez un abonnement pour modifier votre boutique.' : 'Choisissez une formule et réglez votre abonnement pour accéder à votre boutique.', 'abonnement_requis');
  };
  // Fonction réservée à une formule (réseaux sociaux : Croissance ; caisse : Pro). Sans abonnement obligatoire : tout est ouvert.
  const exigerFonction = fonction => ctx => {
    exigerMarchand(ctx);
    const e = abo.etat(ctx.marchand.id);
    if (e.obligatoire && !Formules.permet(e.formule, fonction)) throw erreur(403, `${Formules.NOMS_FONCTIONS[fonction]} : disponible avec la formule ${Formules.FORMULES[Formules.FONCTIONS[fonction]].nom}. Changez de formule dans Paramètres > Abonnement.`, 'formule_insuffisante');
  };

  /* ---------- Comptes ---------- */
  r.get('/api/session', ctx => {
    const m = auth.marchandDepuisRequete(db, ctx.cookies);
    renouvelerCookie(ctx, m);
    const b = m && db.prepare('SELECT slug FROM boutiques WHERE marchand_id = ?').get(m.id);
    return { connecte: !!m, email: m ? m.email : null, slug: b ? b.slug : null, paiement: paiement.nom, fournisseurDemoVendable, socialSimule, hebergeur: env.HEBERGEUR || null, emails: serviceEmail ? serviceEmail.nom : null, abonnement: m ? abo.etat(m.id) : null };
  });
  r.post('/api/auth/inscription', async ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const email = valider.email(ctx.corps.email);
    const mdp = valider.texte(ctx.corps.motDePasse, 'Le mot de passe', { min: 10, max: 200 });
    await exigerMotDePasseSolide(mdp, { email, noms: [((ctx.corps.config || {}).boutique || {}).nom || ''] });
    const hashMdp = await auth.hacherMotDePasse(mdp);
    // Un domaine choisi à l'inscription n'est jamais actif : il faut d'abord prouver qu'on le possède (DNS + TXT).
    const config = garderDomaine(nettoyerConfig(ctx.corps.config), { boutique: {} });
    if (db.prepare('SELECT 1 FROM marchands WHERE email = ?').get(email)) throw erreur(409, 'Un compte existe déjà avec cet e-mail. Connectez-vous.', 'email_pris');
    const marchandId = auth.nouvelId('m_');
    const boutiqueId = auth.nouvelId('b_');
    const slug = slugUnique(config.boutique.nom);
    transaction(db, () => {
      db.prepare('INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES (?, ?, ?, ?)').run(marchandId, email, hashMdp, Date.now());
      db.prepare('INSERT INTO boutiques (id, marchand_id, slug, config, cree_le) VALUES (?, ?, ?, ?, ?)').run(boutiqueId, marchandId, slug, JSON.stringify(config), Date.now());
      insererProduits(boutiqueId, ctx.corps.produits);
      // Produits fournisseurs choisis à l'inscription (préparés avant même le paiement de l'abonnement).
      const sources = Array.isArray(ctx.corps.importer) ? ctx.corps.importer.slice(0, 12).map(String) : [];
      for (const src of fournisseurs.CATALOGUE_DEMO.filter(x => sources.includes(x.id))) importerProduit(boutiqueId, src, 'demo');
    });
    ouvrirSession(ctx, { id: marchandId, email });
    return { statut: 201, corps: { ok: true, slug } };
  });
  r.post('/api/auth/connexion', async ctx => {
    const email = valider.email(ctx.corps.email);
    // Limites par adresse, et par compte depuis cette adresse : un tiers ne peut pas verrouiller le compte d'un marchand
    // depuis d'autres adresses. Le compte seul n'est bloqué qu'à un seuil très élevé (attaque distribuée massive).
    const max = Number(env.LIMITE_ESSAIS) || 10, e = email.toLowerCase(), reseau = reseauIp(ctx.ip);
    const parIp = ['ip:' + reseau, `compte-ip:${e}|${reseau}`];
    auth.verifierEchecs(parIp, max);
    auth.verifierEchecs(['ip-cours:' + reseau, `compte-ip-cours:${e}|${reseau}`], max);
    // Seuil global du compte (attaque répartie sur beaucoup d'adresses) : il ne s'applique jamais à un appareil où
    // le marchand s'est déjà connecté (cookie signé), donc personne ne peut l'empêcher de se connecter de chez lui.
    const appareilConnu = String(ctx.cookies.comptoir_appareil || '') === jetonAppareil(e);
    if (!appareilConnu) auth.verifierEchecs(['compte:' + e], max * 20);
    const m = db.prepare('SELECT * FROM marchands WHERE email = ?').get(email);
    // Compté avant le calcul : des essais lancés en parallèle ne contournent pas la limite.
    const enCours = ['ip-cours:' + reseau, `compte-ip-cours:${e}|${reseau}`];
    const ok = await auth.essayerMotDePasse(enCours, max, String(ctx.corps.motDePasse || ''), m && m.mot_de_passe);
    // Mot de passe changé ou réinitialisé pendant le calcul : l'ancien ne doit pas ouvrir de session.
    const actuel = m && db.prepare('SELECT mot_de_passe FROM marchands WHERE id = ?').get(m.id);
    if (!ok || !actuel || actuel.mot_de_passe !== m.mot_de_passe) { auth.noterEchec([...parIp, 'compte:' + e]); throw erreur(401, 'E-mail ou mot de passe incorrect.', 'identifiants'); }
    auth.oublierEchecs([`compte-ip:${e}|${reseau}`, `compte-ip-cours:${e}|${reseau}`]);
    const df = deuxFacteursDe(m.id);
    if (df && df.actif) return { deuxFacteurs: true, defi: creerDefi(m.id) };   // second facteur demandé, aucune session encore
    ouvrirSession(ctx, m, { nouvelAppareil: !appareilConnu });
    return { ok: true };
  });
  /* Second facteur : code de l'application (TOTP) ou code de secours (usage unique). */
  r.post('/api/auth/connexion/2fa', async ctx => {
    const mid = lireDefi(ctx.corps.defi);
    if (!mid) throw erreur(401, 'Délai dépassé : reconnectez-vous avec votre mot de passe.', 'defi_expire');
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(mid), df = deuxFacteursDe(mid);
    if (!m || !df || !df.actif) throw erreur(401, 'Reconnectez-vous avec votre mot de passe.', 'defi_expire');
    // Limites : par compte et par réseau (5), et globale par compte (50) sauf sur un appareil déjà connu :
    // quelqu'un qui connaît le mot de passe ne peut pas bloquer le vrai propriétaire chez lui.
    const appareilConnu = String(ctx.cookies.comptoir_appareil || '') === jetonAppareil(String(m.email).toLowerCase());
    const parReseau = [`2fa:${mid}|${reseauIp(ctx.ip)}`], global = ['2fa:' + mid];
    auth.verifierEchecs(parReseau, 5);
    if (!appareilConnu) auth.verifierEchecs(global, 50);
    auth.noterEchec([...parReseau, ...global]);   // compté avant la vérification (essais parallèles)
    if (!verifierSecondFacteur(df, ctx.corps.code, ctx)) { noterActivite(mid, 'echec-2fa', null, ctx); if (auth.compteEchecs && auth.compteEchecs(parReseau[0]) >= 3) alerterEchecs2fa(m); throw erreur(401, 'Code incorrect.', 'code_2fa'); }
    auth.oublierEchecs(parReseau);
    ouvrirSession(ctx, m, { nouvelAppareil: !appareilConnu });
    return { ok: true };
  });
  /* Mot de passe oublié : lien valable 1 heure, réponse identique que le compte existe ou non. */
  r.post('/api/auth/oubli', ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const email = valider.email(ctx.corps.email);
    auth.limiter('oubli:' + email.toLowerCase(), 3 * facteurLimites, 60 * 60000, 'Un lien vient déjà d’être envoyé à cette adresse. Vérifiez votre boîte de réception, ou réessayez dans une heure.');
    const m = db.prepare('SELECT id FROM marchands WHERE email = ?').get(email);
    if (m) {
      const jeton = crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO reinitialisations (jeton_hash, marchand_id, expire_le) VALUES (?, ?, ?)').run(auth.sha256(jeton), m.id, Date.now() + 3600 * 1000);
      envoyerEmail(null, email, 'Réinitialiser votre mot de passe Comptoir', `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${urlPublique}/app?reinitialiser=${jeton}\n\nSi vous n’avez rien demandé, ignorez cet e-mail : votre mot de passe actuel reste valable.`);
    }
    return { ok: true };
  });
  r.post('/api/auth/reinitialiser', async ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const mdp = valider.texte(ctx.corps.motDePasse, 'Le mot de passe', { min: 10, max: 200 });
    { const lr = db.prepare('SELECT m.email FROM reinitialisations r JOIN marchands m ON m.id = r.marchand_id WHERE r.jeton_hash = ?').get(auth.sha256(String(ctx.corps.jeton || ''))); await exigerMotDePasseSolide(mdp, { email: lr ? lr.email : '' }); }
    const hashMdp = await auth.hacherMotDePasse(mdp);   // avant la lecture du lien : rien ne s'intercale entre sa vérification et son usage
    const ligne = db.prepare('SELECT * FROM reinitialisations WHERE jeton_hash = ?').get(auth.sha256(String(ctx.corps.jeton || '')));
    if (!ligne || ligne.expire_le < Date.now()) throw erreur(400, 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.', 'lien_expire');
    transaction(db, () => {
      db.prepare('UPDATE marchands SET mot_de_passe = ? WHERE id = ?').run(hashMdp, ligne.marchand_id);
      db.prepare('DELETE FROM sessions WHERE marchand_id = ?').run(ligne.marchand_id);
      db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(ligne.marchand_id);
      // Compte peut-être compromis : une clé d'accès ajoutée par un tiers ne doit pas survivre à la réinitialisation.
      db.prepare('DELETE FROM cles_acces WHERE marchand_id = ?').run(ligne.marchand_id);
    });
    // Connexion directe après la réinitialisation, sauf double authentification : un accès à la boîte e-mail ne suffit pas.
    { const mr = db.prepare('SELECT id, email FROM marchands WHERE id = ?').get(ligne.marchand_id); const df = deuxFacteursDe(mr.id); if (!(df && df.actif)) ouvrirSession(ctx, mr); }
    noterActivite(ligne.marchand_id, 'mot-de-passe', 'réinitialisé par lien e-mail', ctx);
    return { ok: true };
  });

  /* Domaine personnalisé : actif quand le DNS pointe vers Comptoir (enregistrement CNAME ou même adresse IP). */
  // Disponibilité réelle d'un nom de domaine, d'après le registre (RDAP, protocole officiel des registres) :
  // 404 = aucun enregistrement, donc libre ; 200 = déjà enregistré. Toute autre réponse : inconnu.
  const cacheRdap = new Map();
  r.get('/api/admin/domaine/disponible', exigerMarchand, async ctx => {
    const d = String(ctx.query.get('d') || '').toLowerCase().trim();
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,24}$/.test(d)) throw erreur(400, 'Nom de domaine invalide.', 'domaine_invalide');
    auth.limiter('rdap:' + ctx.marchand.id, 60 * facteurLimites, 10 * 60000, 'Trop de vérifications en peu de temps. Réessayez dans quelques minutes.');
    const vu = cacheRdap.get(d);
    if (vu && Date.now() - vu.t < 10 * 60000) return vu.r;
    let resultat = { domaine: d, etat: 'inconnu' };
    // Registre interrogé directement quand on le connaît (rdap.org répond aussi 404 pour une extension qu'il ne connaît pas,
    // par exemple .ch : un 404 n'y prouve donc la disponibilité que s'il vient du registre, après redirection).
    const ext = d.split('.').pop();
    const REGISTRES = { ch: 'https://rdap.nic.ch', li: 'https://rdap.nic.ch', fr: 'https://rdap.nic.fr', com: 'https://rdap.verisign.com/com/v1', net: 'https://rdap.verisign.com/net/v1' };
    const direct = env.RDAP_URL || REGISTRES[ext];
    try {
      const rep = await fetchImpl(`${direct || 'https://rdap.org'}/domain/${encodeURIComponent(d)}`, { headers: { Accept: 'application/rdap+json' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      const libre = rep.status === 404 && (direct || rep.redirected);
      resultat = { domaine: d, etat: libre ? 'libre' : rep.ok ? 'pris' : 'inconnu' };
    } catch { /* registre injoignable : inconnu */ }
    if (resultat.etat !== 'inconnu') cacheRdap.set(d, { t: Date.now(), r: resultat });
    return resultat;
  });
  r.post('/api/admin/domaine/verifier', exigerMarchand, async ctx => {
    const config = lireConfig(ctx.boutique);
    const d = config.boutique.domaine;
    if (!d || !d.domaine) throw erreur(400, 'Choisissez d’abord un domaine.', 'sans_domaine');
    const domaine = String(d.domaine).toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domaine)) throw erreur(400, 'Nom de domaine invalide.', 'domaine_invalide');
    let ok = env.DOMAINES_SANS_VERIFICATION === '1';
    // Preuve de propriété : un enregistrement TXT « _comptoir.<domaine> » contenant le code de la boutique.
    // Sans elle, un autre marchand pourrait revendiquer un domaine qui pointe déjà vers Comptoir.
    if (!ok) {
      const txt = (await dns.resolveTxt(`_comptoir.${domaine}`).catch(() => [])).map(x => x.join(''));
      if (!txt.includes(`comptoir=${jetonDomaine(ctx.boutique.id)}`)) throw erreur(409, `Prouvez que ${domaine} vous appartient : ajoutez chez votre registrar un enregistrement TXT nommé _comptoir.${domaine} avec la valeur comptoir=${jetonDomaine(ctx.boutique.id)}, puis vérifiez à nouveau (la propagation peut prendre quelques minutes).`, 'domaine_preuve');
    }
    if (!ok) {
      try {
        const cname = await dns.resolveCname(domaine).catch(() => []);
        if (cname.map(x => x.toLowerCase()).includes(hotePrincipal)) ok = true;
        else {
          const [a, b] = await Promise.all([dns.resolve4(domaine).catch(() => []), dns.resolve4(hotePrincipal).catch(() => [])]);
          ok = a.length > 0 && a.some(ip => b.includes(ip));
        }
      } catch { ok = false; }
    }
    if (!ok) throw erreur(409, `Le DNS de ${domaine} ne pointe pas encore vers ${hotePrincipal}. Ajoutez un enregistrement CNAME vers ${hotePrincipal} chez votre registrar ; la propagation peut prendre quelques heures.`, 'dns_absent');
    const pris = db.prepare("SELECT id FROM boutiques WHERE id <> ? AND lower(json_extract(config, '$.boutique.domaine.domaine')) = ? AND json_extract(config, '$.boutique.domaine.actif') = 1").get(ctx.boutique.id, domaine);
    if (pris) throw erreur(409, 'Ce domaine est déjà utilisé par une autre boutique.', 'domaine_pris');
    config.boutique.domaine = { ...d, domaine, actif: true, verifieLe: Date.now() };
    db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(config), ctx.boutique.id);
    return { ok: true, url: `https://${domaine}/` };
  });

  /* Pour Caddy (HTTPS à la demande) : un certificat n’est demandé que pour un domaine vérifié. */
  r.get('/api/tls/autoriser', ctx => {
    const d = String(ctx.query.get('domain') || '').toLowerCase();
    const ok = d === hotePrincipal || !!db.prepare("SELECT 1 FROM boutiques WHERE lower(json_extract(config, '$.boutique.domaine.domaine')) = ? AND json_extract(config, '$.boutique.domaine.actif') = 1").get(d);
    if (!ok) throw erreur(404, 'Domaine inconnu.', 'domaine_inconnu');
    return { ok: true };
  });

  /* Suppression définitive du compte et de toutes ses données (mot de passe exigé). */
  /* Mot de passe : l'actuel est exigé ; les autres sessions sont fermées. */
  r.post('/api/admin/compte/mot-de-passe', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    const cles = ['mdp:' + m.id];   // clé propre : une attaque sur la page de connexion ne bloque pas un marchand déjà connecté
    if (!(await auth.essayerMotDePasse(cles, Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.actuel || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe actuel incorrect.', 'identifiants');
    const nouveau = valider.texte(ctx.corps.nouveau, 'Le nouveau mot de passe', { min: 10, max: 200 });
    { const b = db.prepare('SELECT config FROM boutiques WHERE marchand_id = ?').get(m.id); await exigerMotDePasseSolide(nouveau, { email: m.email, noms: [b ? (JSON.parse(b.config).boutique || {}).nom || '' : ''] }); }
    const actuelle = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    const hashMdp = await auth.hacherMotDePasse(nouveau);
    if (db.prepare('SELECT mot_de_passe FROM marchands WHERE id = ?').get(m.id).mot_de_passe !== m.mot_de_passe) throw erreur(409, 'Le mot de passe vient d’être modifié ailleurs. Rechargez la page et recommencez.', 'mdp_change');
    transaction(db, () => {
      db.prepare('UPDATE marchands SET mot_de_passe = ? WHERE id = ?').run(hashMdp, m.id);
      db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(m.id, actuelle);
      db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(m.id);
    });
    noterActivite(m.id, 'mot-de-passe', 'changé depuis l’espace', ctx);
    ajouterCookie(ctx, cookieAppareil(String(m.email).toLowerCase()));   // cet appareil reste reconnu ; les autres ne le sont plus
    return { ok: true };
  });
  /* Activation des paiements de la boutique (Stripe Connect) : la boutique encaisse sur son propre compte Stripe. */
  const activationsEnCours = new Set();
  r.post('/api/admin/paiements/activer', exigerMarchand, async ctx => {
    if (paiement.nom !== 'stripe') return { pret: true, simulation: true };
    const bid = ctx.boutique.id;
    if (activationsEnCours.has(bid)) throw erreur(409, 'Activation déjà en cours : patientez quelques secondes.', 'activation_en_cours');
    activationsEnCours.add(bid);
    try {
      let c = compteStripe(bid), etatC = c ? await paiement.etatCompte(c.compte) : null;
      // Pas de compte, compte de l'autre mode (test / réel), ou supprimé chez Stripe : un nouveau compte est créé.
      if (!c || etatC.introuvable) {
        const config = lireConfig(ctx.boutique);
        const compte = await paiement.creerCompte({ pays: config.boutique.pays, email: ctx.marchand.email, cleIdempotence: `compte-${bid}-${paiement.modeCle}-${c ? c.compte : 'nouveau'}-${Math.floor(Date.now() / 600000)}` });
        db.prepare('INSERT OR REPLACE INTO comptes_stripe (boutique_id, compte, pret, maj_le, mode, moyens) VALUES (?, ?, 0, ?, ?, NULL)').run(bid, compte, Date.now(), paiement.modeCle);
        c = compteStripe(bid); etatC = await paiement.etatCompte(c.compte);
      }
      noterEtatCompte(bid, etatC);
      if (etatC.pret) return { pret: true };
      // Retour (ou lien expiré) : Paramètres > Paiements ; un lien expiré en redemande un automatiquement.
      const url = await paiement.lienActivation({ compte: c.compte, urlRetour: `${urlPublique}/app?section=paiements#parametres`, urlRafraichir: `${urlPublique}/app?section=paiements&relancer=1#parametres` });
      return { pret: false, url };
    } finally { activationsEnCours.delete(bid); }
  });
  // Retour de Stripe : l'état du compte est relu (le webhook account.updated le met aussi à jour).
  r.get('/api/admin/paiements/etat', exigerMarchand, async ctx => {
    if (paiement.nom !== 'stripe') return { mode: paiement.nom, pret: true };
    const c = compteStripe(ctx.boutique.id);
    if (!c) return { mode: 'stripe', pret: false, compte: false };
    // Relu chez Stripe s'il n'est pas prêt, ou si le dernier contrôle date de plus d'une heure (compte suspendu entre-temps).
    if (!c.pret || Date.now() - c.maj_le > 3600000) {
      const e = await paiement.etatCompte(c.compte).catch(() => null);
      if (e && e.introuvable) { db.prepare('DELETE FROM comptes_stripe WHERE boutique_id = ?').run(ctx.boutique.id); return { mode: 'stripe', pret: false, compte: false }; }
      if (e) { noterEtatCompte(ctx.boutique.id, e); return { mode: 'stripe', pret: e.pret, compte: true }; }
    }
    return { mode: 'stripe', pret: !!c.pret, compte: true };
  });
  /* Sécurité du compte : état, appareils connectés, journal d'activité */
  r.get('/api/admin/compte/securite', exigerCompte, ctx => {
    const actuelle = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    const df = deuxFacteursDe(ctx.marchand.id);
    return {
      deuxFacteurs: !!(df && df.actif), codesSecoursRestants: df && df.actif ? JSON.parse(df.secours).length : 0,
      clesAcces: clesAccesDe(ctx.marchand.id).map(c => ({ id: c.id, nom: c.nom, creeLe: c.cree_le, utiliseeLe: c.utilisee_le })),
      sessions: db.prepare('SELECT jeton_hash, cree_le, vu_le, appareil, reseau FROM sessions WHERE marchand_id = ? AND expire_le > ? ORDER BY vu_le DESC').all(ctx.marchand.id, Date.now())
        .map(x => ({ id: x.jeton_hash.slice(0, 16), appareil: x.appareil || 'Appareil', reseau: x.reseau, creeLe: x.cree_le, vuLe: x.vu_le, actuelle: x.jeton_hash === actuelle })),
      journal: db.prepare('SELECT date, type, detail, reseau FROM journal_compte WHERE marchand_id = ? ORDER BY date DESC LIMIT 50').all(ctx.marchand.id)
    };
  });
  r.post('/api/admin/compte/sessions/:id/revoquer', exigerCompte, ctx => {
    const id = String(ctx.params.id).replace(/[^0-9a-f]/g, '').slice(0, 16);
    if (id.length !== 16) throw erreur(400, 'Session inconnue.', 'session');
    const n = db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND substr(jeton_hash, 1, 16) = ?').run(ctx.marchand.id, id).changes;
    if (!n) throw erreur(404, 'Session inconnue.', 'session');
    noterActivite(ctx.marchand.id, 'session-revoquee', null, ctx);
    return { ok: true };
  });
  /* ---------- Notifications push (Web Push) : une alerte sur le téléphone ou l'ordinateur du marchand à chaque
     commande payée, même application fermée. Le message est chiffré pour l'appareil (le service push ne le lit pas). ---------- */
  db.exec('CREATE TABLE IF NOT EXISTS abonnements_push (endpoint TEXT PRIMARY KEY, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, appareil TEXT, cree_le INTEGER NOT NULL)');
  try { db.exec('ALTER TABLE abonnements_push ADD COLUMN session TEXT'); } catch { /* déjà là */ }
  if (!db.prepare("SELECT 1 FROM cles WHERE nom = 'vapid'").get()) db.prepare("INSERT INTO cles (nom, valeur) VALUES ('vapid', ?)").run(JSON.stringify(WebPush.genererClesVapid()));
  const vapid = { ...JSON.parse(db.prepare("SELECT valeur FROM cles WHERE nom = 'vapid'").get().valeur), sujet: env.EXPLOITANT_EMAIL ? `mailto:${env.EXPLOITANT_EMAIL}` : urlPublique };
  async function notifierPush(marchandId, message) {
    // Appareil déconnecté (déconnexion, appareil révoqué, session expirée) : plus de notification, l'abonnement est retiré.
    db.prepare('DELETE FROM abonnements_push WHERE marchand_id = ? AND (session IS NULL OR session NOT IN (SELECT jeton_hash FROM sessions WHERE expire_le > ?))').run(marchandId, Date.now());
    for (const a of db.prepare('SELECT * FROM abonnements_push WHERE marchand_id = ?').all(marchandId)) {
      try {
        const code = await WebPush.envoyer(a, message, vapid, { fetchImpl });
        if (code === 404 || code === 410 || code === 'invalide') db.prepare('DELETE FROM abonnements_push WHERE endpoint = ?').run(a.endpoint);   // appareil désabonné
        else if (code >= 400) journal.error('[push]', new URL(a.endpoint).host, code);   // erreur passagère ou de format : gardé
      } catch (e) { journal.error('[push]', e.message); }
    }
  }
  r.get('/api/admin/push', exigerCompte, ctx => ({ cle: vapid.publique, endpoints: db.prepare('SELECT endpoint FROM abonnements_push WHERE marchand_id = ? AND session = ?').all(ctx.marchand.id, auth.sha256(String(ctx.cookies[auth.COOKIE] || ''))).map(x => x.endpoint) }));
  r.post('/api/admin/push/abonner', exigerCompte, ctx => {
    const a = ctx.corps.abonnement || {}, k = a.keys || {};
    if (!WebPush.endpointValide(a.endpoint) || !/^[\w-]{80,100}$/.test(String(k.p256dh || '')) || !/^[\w-]{16,32}$/.test(String(k.auth || ''))) throw erreur(400, 'Abonnement aux notifications invalide.', 'push_invalide');
    if (db.prepare('SELECT COUNT(*) n FROM abonnements_push WHERE marchand_id = ?').get(ctx.marchand.id).n >= 10) db.prepare('DELETE FROM abonnements_push WHERE endpoint = (SELECT endpoint FROM abonnements_push WHERE marchand_id = ? ORDER BY cree_le LIMIT 1)').run(ctx.marchand.id);
    db.prepare('INSERT OR REPLACE INTO abonnements_push (endpoint, marchand_id, p256dh, auth, appareil, cree_le, session) VALUES (?, ?, ?, ?, ?, ?, ?)').run(a.endpoint, ctx.marchand.id, k.p256dh, k.auth, decrireAppareil(ctx.req.headers['user-agent']), Date.now(), auth.sha256(String(ctx.cookies[auth.COOKIE] || '')));
    return { ok: true };
  });
  r.post('/api/admin/push/desabonner', exigerCompte, ctx => { db.prepare('DELETE FROM abonnements_push WHERE endpoint = ? AND marchand_id = ?').run(String(ctx.corps.endpoint || ''), ctx.marchand.id); return { ok: true }; });
  r.post('/api/admin/push/tester', exigerCompte, async ctx => {
    auth.limiter('push-test:' + ctx.marchand.id, 5, 60000, 'Trop d’essais : réessayez dans une minute.');
    await notifierPush(ctx.marchand.id, { titre: 'Comptoir', texte: 'Les notifications fonctionnent sur cet appareil.', url: '/app#tableau' });
    return { ok: true };
  });

  /* ---------- Clés d'accès (passkeys) : connexion sans mot de passe, par le visage, l'empreinte ou le code de l'appareil ---------- */
  db.exec(`CREATE TABLE IF NOT EXISTS cles_acces (id TEXT PRIMARY KEY, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, nom TEXT NOT NULL, cle TEXT NOT NULL, compteur INTEGER NOT NULL DEFAULT 0, cree_le INTEGER NOT NULL, utilisee_le INTEGER);
    CREATE INDEX IF NOT EXISTS cles_acces_marchand ON cles_acces(marchand_id);
    CREATE TABLE IF NOT EXISTS defis_webauthn (defi TEXT PRIMARY KEY, marchand_id TEXT, type TEXT NOT NULL, expire_le INTEGER NOT NULL);`);
  const rpUrl = new URL(urlPublique), rpId = env.WEBAUTHN_RP_ID || rpUrl.hostname, origineRp = rpUrl.origin;
  function nouveauDefi(type, marchandId = null) {
    db.prepare('DELETE FROM defis_webauthn WHERE expire_le < ?').run(Date.now());
    const defi = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO defis_webauthn (defi, marchand_id, type, expire_le) VALUES (?, ?, ?, ?)').run(defi, marchandId, type, Date.now() + 5 * 60000);
    return defi;
  }
  // Le défi est lu dans la réponse signée, puis consommé : une réponse ne sert qu'une fois.
  function consommerDefi(reponse, type) {
    let defi = '';
    try { defi = JSON.parse(WebAuthn.deB64u(reponse && reponse.clientDataJSON).toString('utf8')).challenge; } catch { /* invalide */ }
    const d = defi && db.prepare('DELETE FROM defis_webauthn WHERE defi = ? AND type = ? AND expire_le > ? RETURNING *').get(String(defi), type, Date.now());
    if (!d) throw erreur(400, 'Demande expirée : recommencez.', 'defi_expire');
    return d;
  }
  const clesAccesDe = mid => db.prepare('SELECT id, nom, cree_le, utilisee_le FROM cles_acces WHERE marchand_id = ? ORDER BY cree_le').all(mid);
  r.post('/api/admin/compte/cles-acces/options', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    // Double authentification active : une clé d'accès ne s'ajoute qu'avec le code (sinon mot de passe + session volée suffiraient).
    const df = deuxFacteursDe(m.id);
    if (df && df.actif) {
      auth.limiter('2fa-gestion:' + m.id, 5 * facteurLimites, 15 * 60000, 'Trop d’essais : réessayez dans 15 minutes.');
      if (!verifierSecondFacteur(df, String(ctx.corps.code || ''), ctx)) throw erreur(401, 'Code de vérification requis ou incorrect.', 'code_2fa');
    }
    if (clesAccesDe(m.id).length >= 10) throw erreur(409, '10 clés d’accès au plus : supprimez-en une.', 'trop_de_cles');
    return { publicKey: { challenge: nouveauDefi('create', m.id), rp: { id: rpId, name: 'Comptoir' }, user: { id: WebAuthn.b64u(m.id), name: m.email, displayName: m.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 300000, attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: clesAccesDe(m.id).map(c => ({ type: 'public-key', id: c.id })) } };
  });
  r.post('/api/admin/compte/cles-acces', exigerCompte, ctx => {
    const rep = ctx.corps.reponse || {};
    const d = consommerDefi(rep, 'create');
    if (d.marchand_id !== ctx.marchand.id) throw erreur(400, 'Demande expirée : recommencez.', 'defi_expire');
    let v;
    try { v = WebAuthn.verifierEnregistrement(rep, { defi: d.defi, origine: origineRp, rpId }); } catch (e) { throw erreur(400, `Clé d’accès refusée : ${e.message}.`, 'cle_acces_invalide'); }
    if (db.prepare('SELECT 1 FROM cles_acces WHERE id = ?').get(v.credId)) throw erreur(409, 'Cette clé d’accès est déjà enregistrée.', 'deja');
    const nom = String(ctx.corps.nom || '').trim().slice(0, 60) || decrireAppareil(ctx.req.headers['user-agent']);
    db.prepare('INSERT INTO cles_acces (id, marchand_id, nom, cle, compteur, cree_le) VALUES (?, ?, ?, ?, ?, ?)').run(v.credId, ctx.marchand.id, nom, JSON.stringify(v.cle), v.compteur, Date.now());
    noterActivite(ctx.marchand.id, 'cle-acces-ajoutee', nom, ctx);
    envoyerEmail(null, ctx.marchand.email, 'Clé d’accès ajoutée à votre compte Comptoir', `Bonjour,\n\nUne clé d’accès (« ${nom} ») vient d’être ajoutée à votre compte : elle permet de vous connecter sans mot de passe, avec le visage, l’empreinte ou le code de cet appareil.\n\nCe n’était pas vous ? Supprimez-la tout de suite dans Paramètres > Sécurité, et changez votre mot de passe.\n${urlPublique}/app\n\nL’équipe Comptoir`);
    return { statut: 201, corps: { id: v.credId, nom } };
  });
  r.post('/api/admin/compte/cles-acces/:id/supprimer', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    const c = db.prepare('DELETE FROM cles_acces WHERE id = ? AND marchand_id = ? RETURNING nom').get(String(ctx.params.id), m.id);
    if (!c) throw erreur(404, 'Clé d’accès inconnue.', 'introuvable');
    db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND cle_acces = ?').run(m.id, String(ctx.params.id));   // appareils connectés avec cette clé
    noterActivite(m.id, 'cle-acces-supprimee', c.nom, ctx);
    return { ok: true };
  });
  // Connexion : sans e-mail (clé « découvrable ») ; le navigateur propose les clés enregistrées pour Comptoir.
  r.post('/api/auth/cle-acces/options', ctx => {
    auth.limiter('cle-acces-options:' + reseauIp(ctx.ip), 30 * facteurLimites, 60000, 'Trop de demandes : réessayez dans une minute.');
    return { publicKey: { challenge: nouveauDefi('get'), rpId, userVerification: 'required', timeout: 300000, allowCredentials: [] } };
  });
  r.post('/api/auth/cle-acces/connexion', ctx => {
    const reseau = reseauIp(ctx.ip), max = Number(env.LIMITE_ESSAIS) || 10;
    auth.verifierEchecs(['cle-acces:' + reseau], max);
    const rep = ctx.corps.reponse || {};
    const d = consommerDefi(rep, 'get');
    const cred = db.prepare('SELECT * FROM cles_acces WHERE id = ?').get(String(rep.id || ''));
    const refus = msg => { auth.noterEchec(['cle-acces:' + reseau]); throw erreur(401, msg, 'cle_acces_refusee'); };
    if (!cred) refus('Clé d’accès inconnue : elle a peut-être été supprimée. Connectez-vous avec votre mot de passe.');
    if (rep.userHandle && WebAuthn.deB64u(rep.userHandle).toString('utf8') !== cred.marchand_id) refus('Clé d’accès refusée.');
    let v;
    try { v = WebAuthn.verifierConnexion(rep, { defi: d.defi, origine: origineRp, rpId, cle: JSON.parse(cred.cle), compteur: cred.compteur }); }
    catch (e) { journal.error('[cle-acces]', e.message); refus('Clé d’accès refusée.'); }
    db.prepare('UPDATE cles_acces SET compteur = ?, utilisee_le = ? WHERE id = ?').run(v.compteur, Date.now(), cred.id);
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(cred.marchand_id);
    if (!m) refus('Compte introuvable.');
    const appareilConnu = String(ctx.cookies.comptoir_appareil || '') === jetonAppareil(String(m.email).toLowerCase());
    const jeton = ouvrirSession(ctx, m, { nouvelAppareil: !appareilConnu });
    db.prepare('UPDATE sessions SET cle_acces = ? WHERE jeton_hash = ?').run(cred.id, auth.sha256(jeton));   // révoquée avec la clé
    noterActivite(m.id, 'cle-acces', cred.nom, ctx);
    return { ok: true };
  });
  /* Double authentification : préparation (secret en attente), activation avec un premier code, désactivation */
  r.post('/api/admin/compte/2fa/preparer', exigerCompte, ctx => {
    const df = deuxFacteursDe(ctx.marchand.id);
    if (df && df.actif) throw erreur(409, 'La double authentification est déjà active.', 'deja_actif');
    const secret = totp.nouveauSecret();
    db.prepare('INSERT OR REPLACE INTO deux_facteurs (marchand_id, secret, actif, dernier_pas, secours, cree_le) VALUES (?, ?, 0, -1, ?, ?)').run(ctx.marchand.id, totp.chiffrer(cleChiffrement, secret), '[]', Date.now());
    return { secret, uri: totp.uri(secret, ctx.marchand.email) };
  });
  r.post('/api/admin/compte/2fa/activer', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id), df = deuxFacteursDe(m.id);
    if (!df || df.actif) throw erreur(409, 'Recommencez la mise en place.', 'etat_2fa');
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    auth.verifierEchecs(['2fa-gestion:' + m.id], 5);
    const pas = totp.verifier(totp.dechiffrer(cleChiffrement, df.secret), ctx.corps.code);
    if (pas === null) { auth.noterEchec(['2fa-gestion:' + m.id]); throw erreur(400, 'Code incorrect : vérifiez l’heure de votre téléphone et saisissez le code affiché maintenant.', 'code_2fa'); }
    const { codes, empreintes } = totp.codesSecours();
    db.prepare('UPDATE deux_facteurs SET actif = 1, dernier_pas = ?, secours = ? WHERE marchand_id = ?').run(pas, JSON.stringify(empreintes), m.id);
    // Les autres appareils déjà connectés sont déconnectés : un intrus déjà entré ne reste pas.
    db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(m.id, auth.sha256(String(ctx.cookies[auth.COOKIE] || '')));
    noterActivite(m.id, '2fa-activee', null, ctx);
    envoyerEmail(null, m.email, 'Double authentification activée', `Bonjour,\n\nLa double authentification est maintenant active sur votre compte Comptoir. À chaque connexion, le code de votre application vous sera demandé.\n\nGardez vos codes de secours en lieu sûr : ils remplacent le téléphone en cas de perte.\n\nCe n’était pas vous ? Écrivez-nous immédiatement.\n\nL’équipe Comptoir`);
    return { ok: true, codesSecours: codes };
  });
  // Nouveaux codes de secours (les anciens cessent de fonctionner) : mot de passe et second facteur exigés.
  r.post('/api/admin/compte/2fa/codes', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id), df = deuxFacteursDe(m.id);
    if (!df || !df.actif) throw erreur(409, 'La double authentification n’est pas active.', 'etat_2fa');
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    auth.verifierEchecs(['2fa-gestion:' + m.id], 5);
    if (!verifierSecondFacteur(deuxFacteursDe(m.id), ctx.corps.code, ctx)) { auth.noterEchec(['2fa-gestion:' + m.id]); throw erreur(400, 'Code incorrect.', 'code_2fa'); }
    const { codes, empreintes } = totp.codesSecours();
    db.prepare('UPDATE deux_facteurs SET secours = ? WHERE marchand_id = ?').run(JSON.stringify(empreintes), m.id);
    noterActivite(m.id, 'codes-secours-renouveles', null, ctx);
    return { ok: true, codesSecours: codes };
  });
  r.post('/api/admin/compte/2fa/desactiver', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id), df = deuxFacteursDe(m.id);
    if (!df || !df.actif) return { ok: true };
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    auth.verifierEchecs(['2fa-gestion:' + m.id], 5);
    if (!verifierSecondFacteur(df, ctx.corps.code, ctx)) { auth.noterEchec(['2fa-gestion:' + m.id]); throw erreur(400, 'Code incorrect.', 'code_2fa'); }
    db.prepare('DELETE FROM deux_facteurs WHERE marchand_id = ?').run(m.id);
    noterActivite(m.id, '2fa-desactivee', null, ctx);
    envoyerEmail(null, m.email, 'Double authentification désactivée', `Bonjour,\n\nLa double authentification vient d’être désactivée sur votre compte Comptoir.\n\nCe n’était pas vous ? Changez votre mot de passe tout de suite et réactivez-la : ${urlPublique}/app\n\nL’équipe Comptoir`);
    return { ok: true };
  });
  r.post('/api/admin/compte/deconnecter-autres', exigerCompte, ctx => {
    const actuelle = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    noterActivite(ctx.marchand.id, 'autres-deconnectes', null, ctx);
    return { ok: true, n: db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(ctx.marchand.id, actuelle).changes };
  });
  /* Suppression définitive d'un compte marchand et de tout ce qui lui appartient (demande du marchand, ou fin de conservation). */
  async function supprimerCompte(m) {
    await abo.arreterDefinitivement(m.id);   // sinon Stripe continuerait de prélever un compte supprimé
    transaction(db, () => {
      for (const b of db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').all(m.id)) {
        db.prepare('DELETE FROM images_produits WHERE produit_id IN (SELECT id FROM produits WHERE boutique_id = ?)').run(b.id);
        for (const t of ['publications', 'evenements', 'avis', 'abonnes', 'envois_auto', 'emails', 'comptes_stripe']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(b.id);
      }
      db.prepare('DELETE FROM emails WHERE boutique_id IS NULL AND lower(destinataire) = ?').run(String(m.email).toLowerCase());   // seulement les e-mails de compte, pas ceux reçus comme client d'autres boutiques   // e-mails de compte (réinitialisation, abonnement)
      db.prepare('DELETE FROM marchands WHERE id = ?').run(m.id); // boutiques, produits, commandes, sessions : suppression en cascade
    });
  }
  /* Conservation limitée : 12 mois après la fin de l'abonnement (avertissement 30 jours avant), 90 jours pour une
     inscription jamais payée. Les pièces comptables du marchand lui appartiennent : il les exporte avant (lecture seule). */
  async function conservation(maintenant = Date.now()) {
    const JOUR = 86400000;
    for (const a of db.prepare("SELECT * FROM abonnements WHERE statut = 'resilie' AND periode_fin < ?").all(maintenant - 335 * JOUR)) {
      const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(a.marchand_id);
      if (!m) continue;
      if (a.periode_fin < maintenant - 365 * JOUR) { await supprimerCompte(m).catch(e => journal.error('[conservation]', e.message)); continue; }
      const b = db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').get(m.id);
      if (b && relances.reserverEnvoi(db, b.id, 'conservation-avis', maintenant)) envoyerEmail(null, m.email, 'Vos données Comptoir seront effacées dans 30 jours',
        `Bonjour,\n\nVotre abonnement Comptoir est terminé depuis bientôt un an. Sans nouvel abonnement, votre compte, votre boutique et ses données seront effacés définitivement le ${new Date(a.periode_fin + 365 * JOUR).toLocaleDateString('fr-FR')}.\n\nPensez à exporter vos commandes, factures et clients (conservation comptable obligatoire de votre côté) : ${urlPublique}/app\n\nL’équipe Comptoir`);
    }
    // Inscriptions jamais payées (aucune période payée) depuis plus de 90 jours
    for (const m of db.prepare('SELECT m.* FROM marchands m LEFT JOIN abonnements a ON a.marchand_id = m.id WHERE m.cree_le < ? AND (a.marchand_id IS NULL OR a.periode_fin IS NULL)').all(maintenant - 90 * JOUR)) {
      await supprimerCompte(m).catch(e => journal.error('[conservation]', e.message));
    }
  }
  r.post('/api/admin/compte/supprimer', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    const cles = ['mdp:' + m.id];   // même compteur que le changement de mot de passe : une session volée ne devine pas le mot de passe par essais
    if (!(await auth.essayerMotDePasse(cles, Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    await supprimerCompte(m);
    ctx.entetes['Set-Cookie'] = [auth.cookieSession(null, securise), `comptoir_appareil=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${securise ? '; Secure' : ''}`];
    return { ok: true };
  });

  r.post('/api/auth/deconnexion', ctx => {
    auth.supprimerSession(db, ctx.cookies);
    ctx.entetes['Set-Cookie'] = auth.cookieSession(null, securise);
    return { ok: true };
  });

  /* ---------- Administration ---------- */
  r.get('/api/admin/etat', exigerMarchand, ctx => {
    const config = lireConfig(ctx.boutique);
    const commandes = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? ORDER BY date').all(ctx.boutique.id).map(lireCommande);
    const publications = db.prepare('SELECT * FROM publications WHERE boutique_id = ? ORDER BY date').all(ctx.boutique.id).map(social.lire);
    const abonnes = db.prepare('SELECT COUNT(*) AS n FROM abonnes WHERE boutique_id = ?').get(ctx.boutique.id).n;
    const envois = Object.fromEntries(db.prepare("SELECT substr(cle, 1, instr(cle, ':') - 1) AS type, COUNT(*) AS n FROM envois_auto WHERE boutique_id = ? GROUP BY type").all(ctx.boutique.id).map(x => [x.type, x.n]));
    const avis = db.prepare('SELECT id, commande_id AS commandeId, produit_id AS produitId, note, texte, prenom, ville, cree_le AS date, reponse FROM avis WHERE boutique_id = ? ORDER BY cree_le DESC LIMIT 300').all(ctx.boutique.id);
    // Audience : sessions distinctes par jour et par étape (365 derniers jours)
    const audience = db.prepare("SELECT strftime('%Y-%m-%d', date / 1000, 'unixepoch', 'localtime') AS jour, type, COUNT(DISTINCT session) AS n FROM evenements WHERE boutique_id = ? AND date > ? GROUP BY jour, type").all(ctx.boutique.id, Date.now() - 366 * 86400000);
    const offresVues = Object.fromEntries(db.prepare("SELECT valeur, COUNT(DISTINCT session) AS n FROM evenements WHERE boutique_id = ? AND type = 'offre_vue' GROUP BY valeur").all(ctx.boutique.id).map(x => [x.valeur, x.n]));
    const desinscrits = db.prepare('SELECT email FROM desinscriptions WHERE boutique_id = ?').all(ctx.boutique.id).map(r => r.email);
    return { version: 2, ...config, desinscrits, produits: listerProduits(ctx.boutique.id).map(avecImage), commandes, publications, abonnes, envois, avis, audience, offresVues, visites30j: 0, compteurFacture: ctx.boutique.compteur_facture, serveur: { slug: ctx.boutique.slug, email: ctx.marchand.email, paiement: paiement.nom, emails: serviceEmail ? serviceEmail.nom : null, creeLe: ctx.boutique.cree_le , abonnement: abo.etat(ctx.marchand.id), jetonDomaine: jetonDomaine(ctx.boutique.id), lectureSeule: !!ctx.lectureSeule, paiementsBoutique: paiement.nom === 'stripe' ? { mode: 'stripe', pret: !!(compteStripe(ctx.boutique.id) || {}).pret, compte: !!compteStripe(ctx.boutique.id), twint: !!(moyensDe(ctx.boutique.id) || {}).twint, bancontact: !!(moyensDe(ctx.boutique.id) || {}).bancontact } : { mode: paiement.nom, pret: true }, urlBoutique: urlBoutique(ctx.boutique) } };
  });
  /* Le statut « actif » d’un domaine ne vient que de la vérification DNS du serveur. */
  function garderDomaine(config, ancienne) {
    const d = config.boutique.domaine, a = ancienne.boutique.domaine;
    if (!d || !d.domaine) { config.boutique.domaine = null; return config; }
    const meme = a && a.domaine && String(a.domaine).toLowerCase() === String(d.domaine).toLowerCase();
    config.boutique.domaine = { domaine: String(d.domaine).toLowerCase().slice(0, 100), prix: Number(d.prix) || null, genre: String(d.genre || '').slice(0, 30), date: Number(d.date) || Date.now(), actif: !!(meme && a.actif), verifieLe: meme ? a.verifieLe || null : null };
    return config;
  }
  r.put('/api/admin/config', exigerMarchand, ctx => {
    const config = garderDomaine(nettoyerConfig(ctx.corps.config), lireConfig(ctx.boutique));
    db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(config), ctx.boutique.id);
    return { ok: true };
  });
  r.post('/api/admin/reinitialiser', exigerMarchand, ctx => {
    const config = garderDomaine(nettoyerConfig(ctx.corps.config), lireConfig(ctx.boutique));
    transaction(db, () => {
      db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(config), ctx.boutique.id);
      db.prepare('UPDATE produits SET supprime = 1 WHERE boutique_id = ?').run(ctx.boutique.id);
      insererProduits(ctx.boutique.id, ctx.corps.produits);
    });
    return { ok: true };
  });
  r.post('/api/admin/produits', exigerMarchand, ctx => {
    const id = auth.nouvelId('p_');
    const ordre = db.prepare('SELECT COALESCE(MAX(ordre), 0) + 1 AS o FROM produits WHERE boutique_id = ?').get(ctx.boutique.id).o;
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, ?)').run(id, ctx.boutique.id, serialiserProduit(id, produitDuNavigateur(ctx.corps.produit || {})), ordre);
    return { statut: 201, corps: { id } };
  });
  r.put('/api/admin/produits/:id', exigerMarchand, ctx => {
    const ancien = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ? AND supprime = 0').get(ctx.params.id, ctx.boutique.id);
    if (!ancien) throw erreur(404, 'Produit introuvable.', 'produit_introuvable');
    const avant = JSON.parse(ancien.donnees);
    // Les données fournisseur ne se modifient pas depuis l'interface.
    const fusion = { ...ctx.corps.produit, type: avant.type, source: avant.source, fournisseur: avant.fournisseur, entrepot: avant.entrepot, delai: avant.delai, portF: avant.portF, codeFournisseur: avant.codeFournisseur };
    // Photo inchangée (renvoyée telle quelle par le navigateur) : celle enregistrée reste.
    if (avant.image === IMG && fusion.image === imageDe(ctx.params.id)) fusion.image = IMG;
    db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(serialiserProduit(ctx.params.id, nettoyerProduit(fusion, avant.historiquePrix || [])), ctx.params.id);
    return { ok: true };
  });
  r.delete('/api/admin/produits/:id', exigerMarchand, ctx => {
    const res = db.prepare('UPDATE produits SET supprime = 1 WHERE id = ? AND boutique_id = ?').run(ctx.params.id, ctx.boutique.id);
    if (!res.changes) throw erreur(404, 'Produit introuvable.', 'produit_introuvable');
    return { ok: true };
  });
  r.get('/api/admin/catalogue', exigerMarchand, async () => {
    const f = fournisseurActif();
    return { fournisseur: f.nom, produits: await fournisseurs.client(f, fetchImpl).catalogue() };
  });
  r.post('/api/admin/produits/import', exigerMarchand, async ctx => {
    const f = fournisseurActif();
    const cat = await fournisseurs.client(f, fetchImpl).catalogue();
    const src = cat.find(x => x.id === ctx.corps.source);
    if (!src) throw erreur(404, 'Produit absent du catalogue fournisseur.', 'catalogue_introuvable');
    const r2 = importerProduit(ctx.boutique.id, src, f.code);
    return r2.deja ? r2 : { statut: 201, corps: { id: r2.id } };
  });
  r.patch('/api/admin/commandes/:id', exigerMarchand, ctx => {
    const c = commandeDeBoutique(ctx.boutique.id, ctx.params.id);
    if (typeof ctx.corps.note === 'string') c.note = ctx.corps.note.slice(0, 2000);
    enregistrerCommande(c);
    return { ok: true };
  });
  /* Commande mixte (stock + dropshipping) : la partie fournisseur se transmet à la main sans changer le statut,
     par exemple quand la transmission automatique a échoué ou est désactivée. */
  r.post('/api/admin/commandes/:id/transmettre', exigerMarchand, async ctx => {
    const c = commandeDeBoutique(ctx.boutique.id, ctx.params.id);
    if (!['payee', 'preparation'].includes(c.statut)) throw erreur(409, 'Seule une commande payée, pas encore expédiée, peut être transmise.', 'statut');
    if (!c.lignes.some(l => l.type === 'drop')) throw erreur(409, 'Aucun article de cette commande ne vient d’un fournisseur.', 'sans_fournisseur');
    if (c.refFournisseur) throw erreur(409, 'La partie fournisseur est déjà transmise.', 'deja_transmise');
    return { commande: await transmettreAuFournisseur(ctx.boutique, c, false) };
  });
  r.post('/api/admin/commandes/:id/statut', exigerMarchand, async ctx => {
    const c = commandeDeBoutique(ctx.boutique.id, ctx.params.id);
    const cible = ctx.corps.statut;
    if (!transitionsPossibles(c).includes(cible)) throw erreur(409, `Impossible de passer de « ${c.statut} » à « ${cible} ».`, 'transition_invalide');
    const config = lireConfig(ctx.boutique);
    if (cible === 'fournisseur') return { commande: await transmettreAuFournisseur(ctx.boutique, c, false) };
    if (cible === 'expediee' && c.statut === 'fournisseur') {
      // L'expédition d'une commande en dropshipping vient du fournisseur (webhook).
      if (c.codeFournisseur !== 'demo') throw erreur(409, 'Le fournisseur enverra le suivi lui-même à l’expédition.', 'attente_fournisseur');
      const f = db.prepare("SELECT * FROM fournisseurs WHERE code = 'demo'").get();
      await fournisseurs.client(f, fetchImpl).forcerExpedition(c.refFournisseur);
      return { commande: commandeDeBoutique(ctx.boutique.id, c.id) };
    }
    if (cible === 'remboursee' && c.refFournisseur && !ctx.corps.fournisseurAnnule && ['payee', 'preparation'].includes(c.statut)) {
      throw erreur(409, `La partie fournisseur est déjà commandée (réf. ${c.refFournisseur}) : annulez-la d’abord chez le fournisseur, sinon il expédiera et facturera quand même. Ensuite, confirmez le remboursement.`, 'fournisseur_a_annuler');
    }
    if (cible === 'remboursee') {
      if (c.refFournisseur && ctx.corps.fournisseurAnnule) historique(c, `Remboursement après annulation déclarée chez le fournisseur (réf. ${c.refFournisseur})`);
      const p = db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'paye'").get(c.id);
      if (p && p.fournisseur === 'stripe') await paiement.rembourser({ paiement: p });
      if (p) db.prepare("UPDATE paiements SET statut = 'rembourse' WHERE id = ?").run(p.id);
    }
    const textes = { payee: 'Paiement reçu', preparation: 'Préparation commencée', expediee: 'Expédiée', livree: 'Livrée', prete: 'Prête à retirer, client prévenu', retiree: 'Remise au client', remboursee: `Remboursée (${formatMontant(c.total, config)})`, annulee: 'Annulée' };
    // Numéro de suivi : celui que le marchand a reçu du transporteur. Jamais inventé pour une vraie commande
    // (le client recevrait un faux numéro) ; seul le mode simulation en fabrique un, pour la démonstration.
    if (cible === 'expediee' && !c.suivi) {
      const saisi = String(ctx.corps.suivi || '').trim().slice(0, 60);
      if (saisi) c.suivi = saisi;
      else if (paiement.nom === 'simulation') c.suivi = '99.00.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7);
    }
    if (cible === 'payee' && !c.facture) { c.facture = prochaineFacture(ctx.boutique.id, Date.now()); c.dateFacture = Date.now(); }
    // Une facture émise ne s'efface pas : le remboursement produit un avoir numéroté qui la référence.
    if ((cible === 'remboursee' || cible === 'annulee') && c.facture && !c.avoir) c.avoir = { numero: prochaineFacture(ctx.boutique.id, Date.now(), 'AV'), date: Date.now(), montant: c.total };
    if (c.statut === 'attente' && (cible === 'payee' || cible === 'annulee')) {
      // Paiement reçu hors ligne (virement, espèces) ou commande annulée : les liens de paiement en ligne sont fermés.
      for (const p of db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id)) {
        db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(p.id);
        if (p.fournisseur === 'stripe' && paiement.expirer) await paiement.expirer(p).catch(e => journal.error('[paiement] expiration', e.message));
      }
      if (cible === 'payee') ajusterStock(ctx.boutique.id, c.lignes, -1);   // vendu : le stock baisse comme pour un paiement en ligne
    }
    if ((cible === 'remboursee' || cible === 'annulee') && c.statut !== 'attente') ajusterStock(ctx.boutique.id, c.lignes, +1);
    c.statut = cible;
    historique(c, textes[cible] + (cible === 'expediee' ? (c.suivi ? `, suivi ${c.suivi}` : ', sans numéro de suivi') : ''));
    enregistrerCommande(c);
    if (cible === 'expediee') emailExpedition(ctx.boutique, c, config);
    if (cible === 'prete' && EmailsClients.langueDe(c)) { const m = EmailsClients.pret(c, { ...optionsEmail(ctx.boutique, c, config), adresse: config.magasin.adresse || '', horaires: config.magasin.horaires }); envoyerEmail(ctx.boutique.id, c.client.email, m.sujet, m.corps, { langue: c.langue }); }
    else if (cible === 'prete') envoyerEmail(ctx.boutique.id, c.client.email, `Votre commande n° ${c.numero} est prête`, `Bonjour ${c.client.nom},\n\nVotre commande vous attend en boutique : ${config.magasin.adresse || ''}${config.magasin.horaires ? `\nHoraires : ${config.magasin.horaires}` : ''}.\nPrésentez ce numéro de commande : ${c.numero}.\n\nVotre commande : ${lienCommande(ctx.boutique, c.id)}\n\n${config.boutique.nom}`);
    return { commande: c };
  });
  // Idempotence de la caisse : une même clé de ticket n'enregistre qu'une vente (double clic, renvoi après coupure).
  const ticketsVus = new Map();
  db.exec('CREATE TABLE IF NOT EXISTS tickets_caisse (cle TEXT PRIMARY KEY, reponse TEXT NOT NULL, le INTEGER NOT NULL)');
  r.post('/api/admin/caisse', exigerFonction('magasin'), ctx => {
    const cleTicket = typeof ctx.corps.cle === 'string' ? `${ctx.boutique.id}:${ctx.corps.cle.slice(0, 60)}` : null;
    if (cleTicket && ticketsVus.has(cleTicket)) return ticketsVus.get(cleTicket);
    // Après un redémarrage, la mémoire est vide : la clé du ticket est aussi gardée en base (une vente renvoyée n'est pas comptée deux fois).
    const enBase = cleTicket && db.prepare('SELECT reponse FROM tickets_caisse WHERE cle = ?').get(cleTicket);
    if (enBase) return JSON.parse(enBase.reponse);
    for (const [k, v] of ticketsVus) if (Date.now() - v.le > 3600000) ticketsVus.delete(k);
    const reponse = encaisserCaisse(ctx);
    if (cleTicket) { ticketsVus.set(cleTicket, { ...reponse, le: Date.now() }); db.prepare('INSERT OR IGNORE INTO tickets_caisse (cle, reponse, le) VALUES (?, ?, ?)').run(cleTicket, JSON.stringify(reponse), Date.now()); }
    return reponse;
  });
  function encaisserCaisse(ctx) {
    const produits = listerProduits(ctx.boutique.id);
    const lignes = prix.construireLignes(produits, ctx.corps.lignes, { qteMax: 999 });   // vente en magasin : quantités de marché ou de gros
    if (lignes.some(l => l.type === 'drop')) throw erreur(400, 'La caisse n’accepte que les produits en stock.', 'caisse_drop');
    const total = prix.arrondi(lignes.reduce((a, l) => a + l.prix * l.qte, 0));
    const moyen = ctx.corps.moyen === 'especes' ? 'espèces' : ctx.corps.moyen === 'twint' ? 'TWINT' : 'carte';
    return transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(ctx.boutique.id).compteur_commande;
      const id = auth.nouvelId('c_');
      const now = Date.now();
      const config = lireConfig(ctx.boutique);
      const donnees = { client: { nom: 'Client en boutique', email: '', ville: '' }, lignes, sousTotal: total, port: 0, total, tauxTva: prix.tauxTva(config), livraison: 'retrait', canal: 'magasin', moyen: ['especes', 'twint', 'carte'].includes(ctx.corps.moyen) ? ctx.corps.moyen : 'carte', suivi: '', note: '', facture: prochaineFacture(ctx.boutique.id, now), dateFacture: now, historique: [{ date: now, texte: `Vente encaissée en boutique (${moyen})` }] };
      prix.figerTaux(donnees, config);
      // Espèces en francs : le client paie le montant arrondi à 5 centimes ; l'écart est noté sur le ticket.
      if (ctx.corps.moyen === 'especes' && config.boutique.pays === 'ch') { const enc = Math.round(total * 20) / 20; donnees.encaisse = prix.arrondi(enc); donnees.arrondi = prix.arrondi(enc - total); }
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ctx.boutique.id, numero, now, 'retiree', auth.nouvelId(), JSON.stringify(donnees));
      ajusterStock(ctx.boutique.id, lignes, -1);
      integ.emettre(ctx.boutique.id, 'commande.retiree', commandeApi({ id, numero, date: now, statut: 'retiree', ...donnees, canal: donnees.canal || 'caisse' }, config.boutique.devise || 'CHF'));
      return { statut: 201, corps: { id, numero, facture: donnees.facture, total: formatMontant(total, config) } };
    });
  }
  /* ---------- Réseaux sociaux ---------- */
  const publicationDeBoutique = (boutiqueId, id) => {
    const row = db.prepare('SELECT * FROM publications WHERE id = ? AND boutique_id = ?').get(id, boutiqueId);
    if (!row) throw erreur(404, 'Publication introuvable.', 'publication_introuvable');
    return social.lire(row);
  };
  r.post('/api/admin/publications', exigerFonction('social'), ctx => {
    const liste = Array.isArray(ctx.corps.publications) ? ctx.corps.publications : [];
    if (!liste.length || liste.length > 80) throw erreur(400, 'Entre 1 et 80 publications à la fois.', 'invalide');
    const propres = liste.map(social.nettoyerPublication);
    transaction(db, () => { for (const p of propres) social.enregistrer(db, ctx.boutique.id, { ...p, id: auth.nouvelId('pub_') }); });
    return { statut: 201, corps: { n: propres.length } };
  });
  r.put('/api/admin/publications/:id', exigerFonction('social'), ctx => {
    const avant = publicationDeBoutique(ctx.boutique.id, ctx.params.id);
    if (avant.statut === 'publiee') throw erreur(409, 'Une publication en ligne ne se modifie plus ici.', 'deja_publiee');
    social.enregistrer(db, ctx.boutique.id, { ...social.nettoyerPublication({ ...avant, ...ctx.corps.publication }), id: avant.id });
    return { ok: true };
  });
  r.delete('/api/admin/publications/:id', exigerMarchand, ctx => {
    publicationDeBoutique(ctx.boutique.id, ctx.params.id);
    db.prepare('DELETE FROM publications WHERE id = ?').run(ctx.params.id);
    return { ok: true };
  });
  r.post('/api/admin/publications/:id/publier', exigerFonction('social'), async ctx => {
    const p = publicationDeBoutique(ctx.boutique.id, ctx.params.id);
    const config = lireConfig(ctx.boutique);
    if (!config.social.comptes[p.reseau]) throw erreur(409, 'Connectez d’abord ce réseau.', 'compte_absent');
    return { publication: await social.publier(db, ctx.boutique.id, p, config, { simulation: socialSimule }) };
  });

  /* Publie les publications programmées arrivées à échéance (appelé chaque minute). */
  async function publierEcheances(maintenant = Date.now()) {
    const dues = db.prepare("SELECT p.*, b.config, b.marchand_id FROM publications p JOIN boutiques b ON b.id = p.boutique_id WHERE p.statut = 'programmee' AND p.date <= ? LIMIT 200").all(maintenant);
    let n = 0;
    for (const row of dues) {
      const config = JSON.parse(row.config);
      // Formule sans réseaux sociaux (après un changement de formule) : rien ne part ; la publication redevient un brouillon,
      // à revalider si le marchand reprend Croissance (l'écran est alors verrouillé : il ne pourrait pas l'annuler).
      const ab = abo.etat(row.marchand_id);
      if (!ab.actif) continue;   // abonnement terminé ou impayé : rien ne part au nom d'une boutique fermée
      if (ab.obligatoire && !Formules.permet(ab.formule, 'social')) {
        db.prepare("UPDATE publications SET statut = 'brouillon', donnees = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(row.donnees), statut: 'brouillon' }), row.id);
        continue;
      }
      if (!config.social || !config.social.comptes || !config.social.comptes[row.reseau]) continue;
      // Sans API de réseau branchée, rien ne part tout seul : la publication reste « à publier » par le marchand.
      if (!social.apiReseauxBranchee() && !socialSimule) continue;
      try { await social.publier(db, row.boutique_id, social.lire(row), config, { simulation: socialSimule }); n++; } catch (e) { journal.error('[social]', e.message); }
    }
    return n;
  }

  /* Droits des acheteurs (RGPD art. 15 et 17, nLPD art. 25 et 32) : le marchand exporte ou efface les données d'un client.
     L'effacement anonymise les commandes : montants, numéros et factures restent pour la comptabilité (conservation légale). */
  const commandesDuClient = (boutiqueId, email) => db.prepare('SELECT * FROM commandes WHERE boutique_id = ?').all(boutiqueId).map(lireCommande)
    .filter(c => String(c.client && c.client.email || '').toLowerCase() === email);
  r.get('/api/admin/clients/export', exigerMarchand, ctx => {
    const email = valider.email(ctx.query.get('email') || '').toLowerCase();
    const commandes = commandesDuClient(ctx.boutique.id, email);
    if (!commandes.length) throw erreur(404, 'Aucune commande avec cette adresse.', 'introuvable');
    const ids = new Set(commandes.map(c => c.id));
    return {
      exporteLe: new Date().toISOString(), boutique: lireConfig(ctx.boutique).boutique.nom, email,
      commandes: commandes.map(c => ({ numero: c.numero, date: new Date(c.date).toISOString(), statut: c.statut, client: c.client, lignes: c.lignes.map(l => ({ nom: l.nom, qte: l.qte, prix: l.prix })), total: c.total, livraison: c.livraison, suivi: c.suivi || null })),
      avis: db.prepare('SELECT commande_id, note, texte, prenom, ville, cree_le FROM avis WHERE boutique_id = ?').all(ctx.boutique.id).filter(a => ids.has(a.commande_id)),
      newsletter: !!db.prepare('SELECT 1 FROM abonnes WHERE boutique_id = ? AND email = ?').get(ctx.boutique.id, email)
    };
  });
  r.post('/api/admin/clients/effacer', exigerMarchand, ctx => {
    const email = valider.email(ctx.corps.email).toLowerCase();
    const commandes = commandesDuClient(ctx.boutique.id, email);
    const ouvertes = commandes.filter(c => ['attente', 'payee', 'preparation', 'fournisseur', 'prete'].includes(c.statut));
    if (ouvertes.length) throw erreur(409, `Commande n° ${ouvertes[0].numero} encore en cours : effacez les données une fois qu’elle est expédiée ou annulée (l’adresse sert à la livraison).`, 'commande_en_cours');
    transaction(db, () => {
      for (const c of commandes) {
        c.client = { nom: 'Client effacé', email: '', adresse: '', npa: '', ville: '', consentement: null };
        historique(c, 'Données personnelles du client effacées à sa demande');
        enregistrerCommande(c);
        db.prepare("UPDATE avis SET prenom = 'Client', ville = '' WHERE boutique_id = ? AND commande_id = ?").run(ctx.boutique.id, c.id);
      }
      db.prepare('DELETE FROM abonnes WHERE boutique_id = ? AND email = ?').run(ctx.boutique.id, email);
      db.prepare("DELETE FROM emails WHERE boutique_id = ? AND lower(destinataire) = ?").run(ctx.boutique.id, email);
      integ.effacerClient(ctx.boutique.id, email);   // envois de webhooks gardés
      // Clés exactes (« bienvenue:<email> », « reconquete:<email>:<commande> ») : pas de LIKE, dont « _ » et « % » sont des jokers.
      for (const { cle } of db.prepare('SELECT cle FROM envois_auto WHERE boutique_id = ?').all(ctx.boutique.id)) {
        const parts = String(cle).split(':');
        if (parts.length >= 2 && parts[1].toLowerCase() === email) db.prepare('DELETE FROM envois_auto WHERE boutique_id = ? AND cle = ?').run(ctx.boutique.id, cle);
      }
    });
    // La liste de désinscription garde l'adresse : elle sert justement à ne plus lui écrire.
    return { ok: true, commandes: commandes.length };
  });
  // Liens personnels des clients (confirmation d'inscription, désinscription) masqués : le marchand voit l'e-mail, pas le jeton.
  r.get('/api/admin/emails', exigerMarchand, ctx => db.prepare('SELECT destinataire, sujet, corps, cree_le FROM emails WHERE boutique_id = ? ORDER BY id DESC LIMIT 50').all(ctx.boutique.id)
    .map(e => ({ ...e, corps: String(e.corps || '').replace(/(\/(?:reinscription|desinscription)\?j=)[^\s"'<>]+/g, '$1…') })));

  /* ---------- Boutique publique ---------- */
  r.get('/api/public/:slug', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const config = configVente(b);
    const notes = statsAvis(b.id);
    const regime = config.boutique.pays === 'ch' ? 'ch' : 'ue';
    const produits = listerProduits(b.id).filter(vendable).map(({ cout, portF, codeFournisseur, fournisseur, source, aVerifier, historiquePrix, prixReference, ...p }) => {
      const pb = PrixBarres.verifier({ prix: p.prix, prixReference, historiquePrix }, regime);
      return { ...p, ...(p.image === IMG ? { image: `/api/public/${encodeURIComponent(b.slug)}/image/${encodeURIComponent(p.id)}` } : {}), avis: notes[p.id] || null, ...(pb.ok ? { prixBarre: prixReference } : {}) };   // photo chargée à part (mise en cache par le navigateur)
    });
    const avisRecents = db.prepare('SELECT a.note, a.texte, a.prenom, a.ville, a.cree_le, a.reponse, a.produit_id FROM avis a WHERE a.boutique_id = ? AND a.texte <> \'\' ORDER BY a.cree_le DESC LIMIT 6').all(b.id);
    // Un code promo affiché dans la bannière doit exister au paiement ; un contact d'exemple est remplacé par l'e-mail de l'entreprise.
    Remises.migrerBannieres(config);   // anciennes bannières de campagne (avant leur rattachement)
    const codesOk = new Set(Remises.codesValables(config).map(c => c.code.toUpperCase()));
    const sectionsPubliques = (config.boutique.sections || []).map(s => {
      if (s.type === 'saison' && !Remises.banniereVisible(config, s.props)) return null;   // campagne pas encore lancée ou terminée
      if (s.type === 'saison' && s.props && s.props.code && !codesOk.has(String(s.props.code).toUpperCase())) return { ...s, props: { ...s.props, code: '' } };
      if (s.type === 'pied' && s.props && (!s.props.contact || /@exemple\./i.test(s.props.contact))) return { ...s, props: { ...s.props, contact: config.entreprise.email || '' } };
      return s;
    }).filter(Boolean);
    return {
      boutique: { ...config.boutique, sections: sectionsPubliques },
      magasin: { clickCollect: !!config.magasin.clickCollect, adresse: config.magasin.adresse || '' },
      entreprise: { raison: config.entreprise.raison, adresse: config.entreprise.adresse, email: config.entreprise.email, forme: config.entreprise.forme, siret: config.entreprise.siret, regime: config.entreprise.regime, tvaIntra: config.entreprise.tvaIntra, mediateur: config.entreprise.mediateur, telephone: config.entreprise.telephone, retoursJours: Number(config.entreprise.retoursJours) || 0 },
      produits, avisRecents,
      livraisons: prix.modesLivraison(config),
      seuilPortOffert: Remises.offresDe(config).seuilPort,
      offres: (({ paliersActifs, paliers, suggestions, barrePort, seuilPort, regles }) => ({ paliersActifs, paliers, suggestions, barrePort, seuilPort, regles: regles.filter(r => r.actif && r.type === 'panier') }))(Remises.offresDe(config)),
      newsletter: relances.nettoyer(config.automatisations).bienvenue,
      paiement: paiement.nom,
      paiementsActifs: paiementsActifs(b) || factureQrPossible(config),
      factureQr: factureQrPossible(config) ? { echeanceJours: config.reglages.echeanceJours, enLigne: paiementsActifs(b) } : null,
      moyens: paiement.nom === 'stripe' ? (moyensDe(b.id) || {}) : null,   // TWINT ou Bancontact : annoncés seulement s'ils sont activés   // sinon la boutique prévient avant que le client remplisse le panier
      hebergeur: env.HEBERGEUR || null   // identité de l'hébergeur (obligatoire dans les mentions légales en France)
    };
  });
  const compteursRisque = Risque.creerCompteurs(), paniersMoyens = new Map();
  const panierMoyen = boutiqueId => {
    const m = paniersMoyens.get(boutiqueId);
    if (m && Date.now() - m.le < 600000) return m.v;
    // Panier moyen des ventes en ligne réellement conservées (pas la caisse, pas les remboursements).
    const v = db.prepare("SELECT AVG(json_extract(donnees, '$.total')) AS v FROM (SELECT donnees FROM commandes WHERE boutique_id = ? AND statut NOT IN ('attente', 'annulee', 'remboursee') AND COALESCE(json_extract(donnees, '$.canal'), 'web') = 'web' ORDER BY date DESC LIMIT 200)").get(boutiqueId).v || 0;
    paniersMoyens.set(boutiqueId, { v, le: Date.now() });
    return v;
  };
  r.post('/api/public/:slug/commandes', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    // Après la boutique (une adresse inventée ne crée pas de compteur) : par boutique et par adresse.
    auth.limiter(`commande:${b.id}:${ctx.ip}`, (Number(env.LIMITE_COMMANDES) || 30) * facteurLimites, 15 * 60000, 'Trop de commandes en peu de temps. Réessayez dans quelques minutes.');
    const config = configVente(b);
    // Vendre à distance sans adresse du vendeur est interdit (CH : LCD art. 3 s ; FR : LCEN art. 6 ; BE : CDE art. VI.45).
    const adr = String((config.entreprise || {}).adresse || '').trim();
    if (!adr || /compléter/i.test(adr)) throw erreur(409, 'Cette boutique termine la saisie de ses informations légales : les commandes ouvrent très bientôt.', 'boutique_incomplete');
    // Stock réservé par les commandes en attente de paiement d'AUTRES clients : 30 minutes pour un paiement en ligne,
    // jusqu'à l'échéance pour une facture QR. Sans cela, plusieurs clients pourraient payer le dernier exemplaire.
    const emailClient = String((ctx.corps.client || {}).email || '').trim().toLowerCase();
    const reserve = {};
    for (const r2 of db.prepare("SELECT date, donnees FROM commandes WHERE boutique_id = ? AND statut = 'attente' AND date > ?").all(b.id, Date.now() - 90 * 86400000)) {
      const d = JSON.parse(r2.donnees);
      const active = d.moyen === 'facture' ? (d.echeance || 0) > Date.now() : r2.date > Date.now() - 30 * 60000;
      if (!active || String((d.client || {}).email || '').toLowerCase() === emailClient) continue;   // son propre essai précédent ne bloque pas le client
      for (const l of d.lignes || []) if (l.type !== 'drop') reserve[l.produitId] = (reserve[l.produitId] || 0) + (l.qte || 0);
    }
    const produits = listerProduits(b.id).filter(vendable).map(p => reserve[p.id] && p.type !== 'drop' ? { ...p, stock: Math.max(0, p.stock - reserve[p.id]) } : p);   // produit masqué ou du fournisseur de démonstration : « plus disponible »
    const lignesBrutes = prix.construireLignes(produits, ctx.corps.lignes).map(l => ({ ...l, codeFournisseur: (produits.find(p => p.id === l.produitId) || {}).codeFournisseur }));
    const modes = prix.modesLivraison(config);
    const mode = typeof ctx.corps.livraison === 'string' && Object.hasOwn(modes, ctx.corps.livraison) ? modes[ctx.corps.livraison] : null;
    if (!mode) throw erreur(400, 'Mode de livraison indisponible.', 'livraison_invalide');
    const cl = ctx.corps.client || {};
    const client = {
      nom: valider.texte(cl.nom, 'Le nom', { max: 100 }),
      email: valider.email(cl.email),
      adresse: ctx.corps.livraison === 'retrait' ? '' : valider.texte(cl.adresse, 'L’adresse', { max: 200 }),
      npa: ctx.corps.livraison === 'retrait' ? '' : valider.texte(cl.npa, 'Le code postal', { min: 4, max: 10 }),
      ville: valider.texte(cl.ville, 'La ville', { max: 100 }),
      consentement: cl.consentement === true || cl.consentement === 'on' ? Date.now() : null
    };
    if (config.boutique.pays === 'ch' && client.npa && !/^\d{4}$/.test(client.npa)) throw erreur(400, 'Le NPA suisse compte 4 chiffres.', 'npa_invalide');
    const calcul = Remises.appliquer(lignesBrutes, config, ctx.corps.code);
    if (ctx.corps.code && calcul.codeValide === false) throw erreur(400, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    // Le code de bienvenue est annoncé « sur votre première commande » : refusé à une adresse qui a déjà commandé ici.
    const bienvenue = ((config.automatisations || {}).bienvenue || {});
    if (calcul.motif && calcul.motif.code && bienvenue.code && calcul.motif.code.toUpperCase() === String(bienvenue.code).toUpperCase()) {
      const deja = db.prepare("SELECT donnees FROM commandes WHERE boutique_id = ? AND statut NOT IN ('attente', 'annulee')").all(b.id)
        .some(r => { try { return String(JSON.parse(r.donnees).client.email || '').toLowerCase() === client.email.toLowerCase(); } catch { return false; } });
      if (deja) throw erreur(400, `Le code ${bienvenue.code} est réservé à une première commande.`, 'code_premiere_commande');
    }
    const lignes = calcul.lignes;
    const sousTotal = calcul.sousTotal, remise = calcul.remise;
    const port = prix.fraisPort(mode, calcul.apresRemise, Remises.offresDe(config).seuilPort);
    const total = prix.arrondi(calcul.apresRemise + port);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(port)) throw erreur(400, 'Montant de la commande invalide.', 'montant_invalide');
    const devise = config.boutique.devise || 'EUR';
    // Paiement sur facture QR : pas de paiement en ligne ; facture émise tout de suite, payable à l'échéance.
    const parFacture = ctx.corps.moyen === 'facture';
    if (parFacture && !factureQrPossible(config)) throw erreur(400, 'Le paiement sur facture n’est pas proposé par cette boutique.', 'moyen_invalide');
    // Facture QR : numéro de facture et e-mail envoyés tout de suite, d'où des limites plus serrées (comptabilité, e-mails à des tiers).
    if (parFacture) {
      auth.limiter(`facture-ip:${b.id}:${ctx.ip}`, 5 * facteurLimites, 3600000, 'Trop de commandes sur facture en peu de temps. Réessayez plus tard ou payez en ligne.');
      auth.limiter(`facture-email:${b.id}:${String(client.email || '').toLowerCase()}`, 3 * facteurLimites, 86400000, 'Trop de commandes sur facture pour cette adresse aujourd’hui.');
      auth.limiter(`facture-boutique:${b.id}`, 200 * facteurLimites, 86400000, 'Commandes sur facture momentanément indisponibles : payez en ligne.');
    }
    const compte = parFacture ? null : compteVente(b);   // avant toute écriture : sans compte de paiement actif, aucune commande n'est créée
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', client, lignes, sousTotal, remise, motifRemise: calcul.motif ? calcul.motif.libelle : null, port, total, tauxTva: prix.tauxTva(config), livraison: ctx.corps.livraison, canal: 'web', suivi: '', note: '', historique: [{ date: now, texte: 'Commande passée en ligne, paiement en attente' + (remise ? ` (remise : ${calcul.motif.libelle})` : '') }] };
      prix.figerTaux(c, config);   // taux de TVA figé par ligne (taux réduit des denrées alimentaires)
      // Langue dans laquelle le client a commandé (parmi celles de la boutique) : ses e-mails suivent.
      if (typeof ctx.corps.langue === 'string' && ctx.corps.langue !== 'fr' && EmailsClients.LANGUES.includes(ctx.corps.langue) && (config.boutique.langues || []).includes(ctx.corps.langue)) c.langue = ctx.corps.langue;
      // Score de risque (fraude, revente) : explicable, il ne bloque pas la vente.
      try {
        // Client de confiance : une commande déjà expédiée, livrée ou retirée (pas une commande remboursée).
        const clientConnu = !!db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND statut IN ('expediee', 'livree', 'retiree') AND lower(json_extract(donnees, '$.client.email')) = ? LIMIT 1").get(b.id, String(client.email || '').toLowerCase());
        c.risque = Risque.evaluer(c, { reseau: ctx.ip, compteurs: compteursRisque, panierMoyen: panierMoyen(b.id), clientConnu, boutique: b.id });
        if (c.risque.niveau !== 'faible') c.historique.push({ date: now, texte: `Risque ${c.risque.niveau === 'eleve' ? 'élevé' : 'moyen'} (${c.risque.score}/100) : ${c.risque.raisons.join(' ; ')}` });
      } catch (e) { journal.error('[risque]', e.message); }
      if (client.email) { const em = String(client.email).toLowerCase(); compteursRisque.ajouter(`r:${b.id}:${ctx.ip}`, em, now); compteursRisque.ajouter(`e:${b.id}:${em}`, ctx.ip, now); }
      if (parFacture) {
        c.moyen = 'facture'; c.facture = prochaineFacture(b.id, now); c.dateFacture = now;
        c.echeance = now + config.reglages.echeanceJours * 86400000; c.referenceQr = referencePaiement(b, numero, config.entreprise.iban);
        c.historique = [...(c.historique || []), { date: now, texte: `Facture QR ${c.facture} émise, payable jusqu’au ${new Date(c.echeance).toLocaleDateString('fr-CH')}` }];
      }
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, b.id, n, date, statut, jeton, JSON.stringify(donnees));
      if (parFacture) return { commande: { ...c, jeton }, pmt: null };
      const p = { id: auth.nouvelId('pay_'), commande_id: c.id };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, c.id, paiement.nom, Math.round(total * 100), devise, 'cree', now, compte);
      return { commande: { ...c, jeton }, pmt: p };
    });
    if (parFacture) {
      const factureUrl = `${urlPublique}/facture/${encodeURIComponent(b.slug)}/${commande.id}?jeton=${commande.jeton}`;
      if (EmailsClients.langueDe(commande)) { const m = EmailsClients.factureQr(commande, { ...optionsEmail(b, commande, config), factureUrl }); envoyerEmail(b.id, client.email, m.sujet, m.corps, { langue: commande.langue }); }
      else envoyerEmail(b.id, client.email, `Commande n° ${commande.numero} : votre facture QR`, `Bonjour ${client.nom},\n\nMerci pour votre commande chez ${config.boutique.nom}.\n\n${recapitulatif(commande, config)}\n\nVotre facture QR (à payer avec l’application de votre banque, en scannant le QR code) :\n${factureUrl}\n\nMontant : ${formatMontant(total, config)} · à payer jusqu’au ${new Date(commande.echeance).toLocaleDateString('fr-CH')}.\nVotre commande est préparée dès réception du paiement.\n\n${config.boutique.nom}`);
      const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
      if (mch) envoyerEmail(null, mch.email, `Nouvelle commande n° ${commande.numero} sur facture QR : ${formatMontant(total, config)}`, `Bonjour,\n\nNouvelle commande sur ${config.boutique.nom}, payable sur facture QR (référence ${commande.referenceQr}). Elle passe en « payée » quand vous importez votre relevé bancaire (Paramètres > Paiements) ou que vous la marquez payée.\n\n${recapitulatif(commande, config)}\n\nComptoir`);
      return { statut: 201, corps: { commandeId: commande.id, numero: commande.numero, jeton: commande.jeton, total, factureUrl } };
    }
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    let session;
    try { session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1`, compte, moyens: moyensDe(b.id) }); }
    catch (e) {
      // Paiement impossible à ouvrir : la commande n'a jamais existé pour le client (pas de relance, pas de commande fantôme).
      transaction(db, () => { db.prepare('DELETE FROM paiements WHERE commande_id = ?').run(commande.id); db.prepare('DELETE FROM commandes WHERE id = ?').run(commande.id); });
      throw e;
    }
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { statut: 201, corps: { commandeId: commande.id, numero: commande.numero, jeton: commande.jeton, total, paiementUrl: session.url } };
  });
  /* ---------- Facture QR : page imprimable (client, avec son jeton ; marchand, connecté) ---------- */
  function pageFactureQr(b, c, config) {
    const e = config.entreprise || {}, d = donneesQr(b, c, config);
    const lignes = c.lignes.map(l => `<tr><td>${escHtml(l.nom)}</td><td class="n">${l.qte}</td><td class="n">${formatMontant(l.prix, config)}</td><td class="n">${formatMontant(l.prix * l.qte, config)}</td></tr>`).join('');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Facture ${escHtml(c.facture || '')} · ${escHtml(config.boutique.nom)}</title>
<style>body{margin:0;background:#eee;font:10pt/1.45 Helvetica,Arial,sans-serif;color:#111}.page{background:#fff;width:210mm;min-height:297mm;margin:12px auto;box-sizing:border-box;position:relative;padding:18mm 18mm 112mm}
h1{font-size:16pt;margin:10mm 0 2mm}table{width:100%;border-collapse:collapse;margin:6mm 0}td,th{padding:2mm 1mm;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right;white-space:nowrap}.tot td{font-weight:700;border:0}
.haut{display:flex;justify-content:space-between;gap:10mm}.bas{position:absolute;left:0;bottom:0}.imp{position:fixed;top:8px;right:12px;margin:0;background:#fff;padding:6px 10px;border-radius:6px;font-size:9pt}
@media print{body{background:#fff}.page{margin:0;box-shadow:none}.imp{display:none}@page{size:A4;margin:0}}${QrFacture.CSS}</style></head><body>
<p class="imp">Imprimer ou enregistrer en PDF : Ctrl + P (⌘ + P sur Mac)</p>
<div class="page"><div class="haut"><div><b>${escHtml(e.raison || config.boutique.nom)}</b><br>${escHtml(e.adresse || '')}${e.email ? `<br>${escHtml(e.email)}` : ''}${e.siret ? `<br>IDE ${escHtml(e.siret)}` : ''}${e.tvaIntra ? `<br>TVA ${escHtml(e.tvaIntra)}` : ''}</div>
<div>${escHtml(c.client.nom)}<br>${escHtml(c.client.adresse || '')}<br>${escHtml(`${c.client.npa || ''} ${c.client.ville || ''}`)}</div></div>
<h1>Facture ${escHtml(c.facture || '')}</h1><p>Commande n° ${c.numero} du ${new Date(c.date).toLocaleDateString('fr-CH')} · payable jusqu’au <b>${new Date(c.echeance || c.date).toLocaleDateString('fr-CH')}</b></p>
<table><thead><tr><th>Article</th><th class="n">Qté</th><th class="n">Prix</th><th class="n">Total</th></tr></thead><tbody>${lignes}
${c.remise ? `<tr><td colspan="3">Remise</td><td class="n">−${formatMontant(c.remise, config)}</td></tr>` : ''}<tr><td colspan="3">Livraison</td><td class="n">${formatMontant(c.port || 0, config)}</td></tr>
<tr class="tot"><td colspan="3">Total</td><td class="n">${formatMontant(c.total, config)}</td></tr></tbody></table>
<p>${config.entreprise.regime === 'ch-non' ? 'Entreprise non assujettie à la TVA.' : 'TVA incluse selon le taux applicable.'} ${c.statut === 'attente' ? 'Merci de payer avec la section paiement ci-dessous (application bancaire : scanner le QR code).' : ['annulee', 'remboursee'].includes(c.statut) ? `<b>${c.statut === 'annulee' ? 'Annulée' : 'Remboursée'}${c.avoir ? ` : avoir ${escHtml(c.avoir.numero)}` : ''}.</b> Ne payez pas cette facture.` : `<b>Payée.</b>`}</p>
<div class="bas">${c.statut === 'attente' ? QrFacture.sectionPaiement(d) : ''}</div></div></body></html>`;
  }
  r.get('/facture/:slug/:id', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!row || !auth.egal(String(ctx.query.get('jeton') || ''), row.jeton_client)) throw erreur(404, 'Facture introuvable.', 'introuvable');
    const c = lireCommande(row);
    if (c.moyen !== 'facture') throw erreur(404, 'Facture introuvable.', 'introuvable');
    return { html: pageFactureQr(b, c, lireConfig(b)) };
  });
  r.get('/api/admin/commandes/:id/facture-qr', exigerMarchand, ctx => {
    const c = commandeDeBoutique(ctx.boutique.id, ctx.params.id);
    if (c.moyen !== 'facture') throw erreur(404, 'Cette commande n’a pas de facture QR.', 'introuvable');
    return { html: pageFactureQr(ctx.boutique, c, lireConfig(ctx.boutique)) };
  });
  /* Relevé bancaire ISO 20022 camt.054 / camt.053. Analyse linéaire (indexOf, aucune expression régulière sur
     l'ensemble du fichier), préfixes d'espace de noms tolérés. Une écriture n'est retenue que si elle est
     comptabilisée (BOOK), au crédit, non contrepassée et en CHF. Chaque transaction est mémorisée : un relevé importé
     deux fois ne double rien, et un vrai second versement pour la même facture est signalé. */
  db.exec('CREATE TABLE IF NOT EXISTS camt_ecritures (boutique_id TEXT NOT NULL, cle TEXT NOT NULL, numero INTEGER, le INTEGER NOT NULL, PRIMARY KEY (boutique_id, cle))');
  try { db.exec('ALTER TABLE camt_ecritures ADD COLUMN montant REAL'); } catch { /* déjà là */ }
  function lireCamt(xml) {
    // Commentaires et CDATA retirés (une écriture « en commentaire » ne compte pas), préfixes d'espace de noms enlevés.
    const propre = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1');
    // Blocs <nom …>…</nom> (pas <nomAutre>, pas <nom/>), en un seul passage.
    const blocs = (txt, nom) => { const out = []; const o = `<${nom}`, f = `</${nom}>`; let i = 0;
      for (;;) {
        const d = txt.indexOf(o, i); if (d < 0) break;
        const car = txt[d + o.length], finTete = txt.indexOf('>', d);
        if (finTete < 0) break;
        if (!(car === '>' || car === ' ' || car === '\t' || car === '\n' || car === '\r') || txt[finTete - 1] === '/') { i = finTete + 1; continue; }
        const e = txt.indexOf(f, finTete); if (e < 0) break;
        out.push(txt.slice(finTete + 1, e)); i = e + f.length;
      }
      return out; };
    const premier = (txt, nom) => { const b = blocs(txt, nom); return b.length ? b[0] : null; };
    const valeur = (txt, nom) => { const v = premier(txt || '', nom); return v == null ? '' : v.replace(/<[^>]*>/g, '').trim(); };
    // Retire des sous-blocs (frais, détail des montants, parties) pour ne lire que les éléments propres à la transaction.
    const sans = (txt, noms) => noms.reduce((t, n) => { let r = t; for (const b of blocs(t, n)) r = r.replace(b, ''); return r; }, txt);
    const montantDe = txt => { const v = premier(txt || '', 'Amt'); if (v == null) return null; const d = txt.indexOf('<Amt'); const tete = txt.slice(d, txt.indexOf('>', d));
      const n = Number(v.trim()); return Number.isFinite(n) && n > 0 ? { montant: n, devise: (/Ccy="([A-Z]{3})"/.exec(tete) || [])[1] || '' } : null; };
    const ecritures = [];
    for (const ntry of blocs(propre, 'Ntry')) {
      const tete = sans(ntry, ['NtryDtls', 'Chrgs', 'AmtDtls', 'Intrst']);
      const sts = valeur(premier(tete, 'Sts') || '', 'Cd') || valeur(tete, 'Sts');
      const sens = valeur(tete, 'CdtDbtInd'), contrepasse = valeur(tete, 'RvslInd') === 'true';
      const refEcriture = valeur(tete, 'AcctSvcrRef'), date = valeur(premier(tete, 'BookgDt') || '', 'Dt') || valeur(tete, 'BookgDt');
      const mNtry = montantDe(tete);
      const txs = blocs(ntry, 'TxDtls');
      for (const t of (txs.length ? txs : [null])) {
        const propreTx = t ? sans(t, ['Chrgs', 'AmtDtls', 'RltdPties', 'RltdAgts', 'Intrst', 'RmtInf']) : '';
        // Montant : celui de la transaction ; sinon le détail (camt.054 v2 : AmtDtls/TxAmt) ; sinon celui de l'écriture s'il n'y a qu'une transaction.
        const m = t ? (montantDe(propreTx) || montantDe(premier(premier(t, 'AmtDtls') || '', 'TxAmt') || '') || montantDe(premier(premier(t, 'AmtDtls') || '', 'InstdAmt') || '') || (txs.length === 1 ? mNtry : null)) : mNtry;
        const sensTx = (t && valeur(propreTx, 'CdtDbtInd')) || sens;
        const ref = valeur(premier(t || ntry, 'CdtrRefInf') || '', 'Ref').replace(/\s/g, '').toUpperCase();
        const refs = t ? premier(t, 'Refs') || '' : '';
        const e2e = valeur(refs, 'EndToEndId');
        const idTx = valeur(refs, 'AcctSvcrRef') || (e2e && e2e !== 'NOTPROVIDED' ? e2e : '');
        const centimes = m ? Math.round(m.montant * 100) : 0;
        // Clé de déduplication : identifiant bancaire de la transaction (identique en camt.053 et camt.054), sinon
        // celui de l'écriture et sa date ; toujours avec la référence et le montant (pas de collision entre paiements).
        const cle = `${idTx || `${refEcriture}@${date}`}|${ref}|${centimes}`;
        ecritures.push({ statut: sts, sens: sensTx, contrepasse, ref, montant: m ? m.montant : 0, devise: m ? m.devise : '', lisible: !!m, cle, sansDetail: !t });
      }
    }
    return ecritures;
  }
  r.post('/api/admin/paiements/camt', exigerMarchand, async ctx => {
    const xml = String(ctx.corps.xml || '');
    if (xml.length > 3 * 1024 * 1024 || !/<(?:[\w.-]+:)?Document[\s>]/.test(xml.slice(0, 4096)) || !/camt\.05[34]/.test(xml.slice(0, 4096))) throw erreur(400, 'Fichier non reconnu : importez un relevé camt.054 ou camt.053 (XML) de votre banque.', 'camt_invalide');
    const config = lireConfig(ctx.boutique), resultat = { payees: [], deja: [], inconnues: [], ecarts: [], doublons: [], ignorees: 0 };
    const ecritures = lireCamt(xml);
    if (ecritures.length > 20000) throw erreur(413, 'Relevé trop volumineux : importez-le par période.', 'camt_trop_grand');
    // Commandes sur facture lues une seule fois (et non une recherche par écriture).
    const parRef = new Map();
    for (const row of db.prepare("SELECT id, numero, statut, json_extract(donnees, '$.referenceQr') AS ref, json_extract(donnees, '$.total') AS total FROM commandes WHERE boutique_id = ? AND json_extract(donnees, '$.moyen') = 'facture'").all(ctx.boutique.id)) if (row.ref) parRef.set(String(row.ref).toUpperCase(), row);
    const vue = db.prepare('SELECT numero FROM camt_ecritures WHERE boutique_id = ? AND cle = ?');
    const noter = (cle, numero, montant) => db.prepare('INSERT OR IGNORE INTO camt_ecritures (boutique_id, cle, numero, le, montant) VALUES (?, ?, ?, ?, ?)').run(ctx.boutique.id, cle, numero || null, Date.now(), montant);
    const aTraiter = [];
    for (const e of ecritures) {
      if (e.statut && e.statut !== 'BOOK') { resultat.ignorees++; continue; }        // en attente / informatif : pas encore crédité
      if (e.sens !== 'CRDT' || e.contrepasse) { resultat.ignorees++; continue; }     // débit ou contrepassation
      if (!e.ref) { if (e.sansDetail) resultat.ignorees++; continue; }
      if (!e.lisible) { resultat.ecarts.push({ reference: e.ref, motif: 'montant-illisible' }); continue; }   // pas mémorisé : un prochain import pourra le lire
      if (e.devise && e.devise !== 'CHF') { resultat.ecarts.push({ reference: e.ref, recu: e.montant, devise: e.devise, motif: 'devise' }); continue; }
      const deja = vue.get(ctx.boutique.id, e.cle);
      if (deja) { if (deja.numero) resultat.deja.push(deja.numero); continue; }       // relevé (ou même transaction) déjà importé
      const row = parRef.get(e.ref);
      if (row && !(Number.isFinite(row.total) && row.total > 0)) { resultat.ecarts.push({ numero: row.numero, recu: e.montant, motif: 'commande-invalide' }); continue; }
      if (!row) { resultat.inconnues.push(e.ref); noter(e.cle, null, e.montant); continue; }
      const statut = db.prepare('SELECT statut FROM commandes WHERE id = ?').get(row.id).statut;
      if (statut !== 'attente') {
        resultat[statut === 'annulee' ? 'ecarts' : 'doublons'].push({ numero: row.numero, recu: e.montant, du: row.total, ...(statut === 'annulee' ? { annulee: true } : {}) });
        noter(e.cle, row.numero, e.montant); continue;
      }
      // Versements partiels : additionnés (le client complète un premier virement trop faible).
      const anterieur = db.prepare('SELECT COALESCE(SUM(montant), 0) AS s FROM camt_ecritures WHERE boutique_id = ? AND numero = ?').get(ctx.boutique.id, row.numero).s;
      const cumul = Math.round((anterieur + e.montant) * 100);
      if (cumul < Math.round(row.total * 100)) { noter(e.cle, row.numero, e.montant); resultat.ecarts.push({ numero: row.numero, recu: Math.round(cumul) / 100, du: row.total, motif: 'insuffisant' }); continue; }
      const res = transaction(db, () => {
        const frais = db.prepare('SELECT * FROM commandes WHERE id = ?').get(row.id);
        if (frais.statut !== 'attente') return null;
        noter(e.cle, row.numero, e.montant);
        return marquerPayee(frais, `Paiement de la facture QR reçu (${formatMontant(cumul / 100, config)}, relevé bancaire importé)`);
      });
      if (!res) continue;
      resultat.payees.push(row.numero);
      if (cumul > Math.round(row.total * 100)) resultat.ecarts.push({ numero: row.numero, recu: cumul / 100, du: row.total, motif: 'trop-percu' });
      aTraiter.push(res);
    }
    // Suite du paiement (e-mails, transmission au fournisseur) : une erreur sur une commande n'empêche pas les autres.
    for (const res of aTraiter) { try { await apresPaiement(res); } catch (err) { journal.error('[camt]', res.c.numero, err.message); } }
    if (resultat.payees.length || resultat.doublons.length) noterActivite(ctx.marchand.id, 'import-camt', `${resultat.payees.length} payée(s)`, ctx);
    return resultat;
  });
  /* ---------- Intégrations : gestion (espace marchand, formule Croissance) ---------- */
  r.get('/api/admin/integrations', exigerMarchand, ctx => ({ inclus: apiPermise(ctx.boutique.id), cles: integ.listerCles(ctx.boutique.id), webhooks: integ.listerWebhooks(ctx.boutique.id), portees: integ.PORTEES, evenements: integ.EVENEMENTS, base: `${urlPublique}/api/v1` }));
  r.post('/api/admin/integrations/cles', exigerFonction('api'), ctx => { const r2 = integ.creerCle(ctx.boutique.id, ctx.corps); noterActivite(ctx.marchand.id, 'cle-api', String(ctx.corps.nom || '').slice(0, 60), ctx); return { statut: 201, corps: r2 }; });
  r.post('/api/admin/integrations/cles/:id/revoquer', exigerMarchand, ctx => { if (!integ.revoquerCle(ctx.boutique.id, ctx.params.id)) throw erreur(404, 'Clé inconnue.', 'introuvable'); noterActivite(ctx.marchand.id, 'cle-api-revoquee', null, ctx); return { ok: true }; });
  r.post('/api/admin/integrations/webhooks', exigerFonction('api'), async ctx => ({ statut: 201, corps: await integ.creerWebhook(ctx.boutique.id, ctx.corps) }));
  r.post('/api/admin/integrations/webhooks/:id/supprimer', exigerMarchand, ctx => { if (!integ.supprimerWebhook(ctx.boutique.id, ctx.params.id)) throw erreur(404, 'Webhook inconnu.', 'introuvable'); return { ok: true }; });
  r.post('/api/admin/integrations/webhooks/:id/reactiver', exigerFonction('api'), ctx => { if (!integ.reactiverWebhook(ctx.boutique.id, ctx.params.id)) throw erreur(404, 'Webhook inconnu.', 'introuvable'); return { ok: true }; });
  r.post('/api/admin/integrations/webhooks/tester', exigerFonction('api'), async ctx => {
    auth.limiter('webhook-test:' + ctx.boutique.id, 5, 60000, 'Trop de tests : réessayez dans une minute.');
    return { resultats: await integ.tester(ctx.boutique.id) };
  });

  /* ---------- API publique v1 (clé d'API du marchand) ---------- */
  function exigerCle(portee) {
    return ctx => {
      let c;
      try { c = integ.authentifier(ctx.req.headers.authorization); }
      catch (e) { auth.limiter('api-refus:' + ctx.ip, 30 * facteurLimites, 60000, 'Trop de clés refusées : réessayez dans une minute.'); throw e; }
      auth.limiter('api:' + c.id, 300 * facteurLimites, 60000, 'Limite de 300 requêtes par minute dépassée.');
      auth.limiter('api-boutique:' + c.boutiqueId, 600 * facteurLimites, 60000, 'Limite de 600 requêtes par minute dépassée pour cette boutique.');
      if (!c.portees.includes(portee)) throw erreur(403, `Cette clé n’a pas la permission « ${portee} ».`, 'portee');
      if (!apiPermise(c.boutiqueId)) throw erreur(402, 'API indisponible : abonnement inactif ou formule sans API.', 'abonnement_requis');
      ctx.boutique = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(c.boutiqueId); ctx.cleApi = c;
    };
  }
  const deviseDeBoutique = b => lireConfig(b).boutique.devise || 'CHF';
  const avecClient = ctx => ctx.cleApi.portees.includes('clients:lecture');
  /* Liste paginée par curseur : (date de création, numéro) ou, avec tri=modification, (dernière modification, numéro).
     Le curseur « suite » est à repasser tel quel dans « apres » : aucune commande sautée ni répétée, même à la même milliseconde.
     Les commandes en attente de paiement (paniers abandonnés) ne sont listées que sur demande (statut=attente). */
  r.get('/api/v1/commandes', exigerCle('commandes:lecture'), ctx => {
    const q = ctx.query, modif = q.get('tri') === 'modification';
    const col = modif ? 'COALESCE(maj_le, date)' : 'date';
    let depuis = 0, apresNum = -1;
    if (q.get('apres')) { const m = /^(\d{1,15})_(\d{1,12})$/.exec(q.get('apres')); if (!m) throw erreur(400, 'Curseur « apres » invalide : repassez la valeur « suite » reçue.', 'curseur'); depuis = Number(m[1]); apresNum = Number(m[2]); }
    else if (q.get('depuis')) { const t = Date.parse(q.get('depuis')); if (Number.isNaN(t)) throw erreur(400, 'Date « depuis » invalide (format ISO 8601).', 'date'); depuis = t - 1; apresNum = Number.MAX_SAFE_INTEGER; }   // à partir de cette date incluse
    const limite = Math.max(1, Math.min(100, Number(q.get('limite')) || 50)), statut = q.get('statut');
    if (statut && !/^[a-z]{3,20}$/.test(statut)) throw erreur(400, 'Statut invalide.', 'statut');
    const filtreStatut = statut ? 'AND statut = ?' : "AND statut <> 'attente'";
    const rows = db.prepare(`SELECT *, ${col} AS curseur FROM commandes WHERE boutique_id = ? AND (${col} > ? OR (${col} = ? AND numero > ?)) ${filtreStatut} ORDER BY ${col} ASC, numero ASC LIMIT ?`)
      .all(...[ctx.boutique.id, depuis, depuis, apresNum, ...(statut ? [statut] : []), limite + 1]);
    const devise = deviseDeBoutique(ctx.boutique), page = rows.slice(0, limite), dernier = page[page.length - 1];
    return { donnees: page.map(r2 => ({ ...commandeApi(lireCommande(r2), devise, { client: avecClient(ctx) }), modifiee: new Date(r2.curseur).toISOString() })), suite: rows.length > limite ? `${dernier.curseur}_${dernier.numero}` : null };
  });
  r.get('/api/v1/commandes/:numero', exigerCle('commandes:lecture'), ctx => {
    const row = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND numero = ?').get(ctx.boutique.id, Number(ctx.params.numero));
    if (!row) throw erreur(404, 'Commande introuvable.', 'introuvable');
    return commandeApi(lireCommande(row), deviseDeBoutique(ctx.boutique), { client: avecClient(ctx) });
  });
  r.post('/api/v1/commandes/:numero/expedier', exigerCle('commandes:ecriture'), ctx => {
    const row = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND numero = ?').get(ctx.boutique.id, Number(ctx.params.numero));
    if (!row) throw erreur(404, 'Commande introuvable.', 'introuvable');
    const c = lireCommande(row);
    if (!['payee', 'preparation'].includes(c.statut) || c.livraison === 'retrait' || c.lignes.every(l => l.type === 'drop')) throw erreur(409, 'Seule une commande payée, à expédier par vous, peut être marquée expédiée.', 'statut');
    c.statut = 'expediee'; c.suivi = String(ctx.corps.suivi || '').trim().slice(0, 60); c.transporteur = String(ctx.corps.transporteur || '').trim().slice(0, 40) || null;
    historique(c, `Expédiée${c.suivi ? `, suivi ${c.suivi}` : ', sans numéro de suivi'} (API)`);
    enregistrerCommande(c);
    emailExpedition(ctx.boutique, c, lireConfig(ctx.boutique));
    return commandeApi(c, deviseDeBoutique(ctx.boutique), { client: avecClient(ctx) });
  });
  const produitApi = (p, slug) => ({ id: p.id, nom: p.nom, prix: p.prix, stock: p.type === 'drop' ? null : p.stock, type: p.type, actif: p.actif !== false, categorie: p.categorie || '', image: p.image ? `${urlPublique}/api/public/${encodeURIComponent(slug)}/image/${p.id}` : null });
  r.get('/api/v1/produits', exigerCle('produits:lecture'), ctx => ({ donnees: listerProduits(ctx.boutique.id).map(p => produitApi(p, ctx.boutique.slug)) }));
  r.patch('/api/v1/produits/:id', exigerCle('produits:ecriture'), ctx => {
    const ancien = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ? AND supprime = 0').get(ctx.params.id, ctx.boutique.id);
    if (!ancien) throw erreur(404, 'Produit introuvable.', 'introuvable');
    const avant = JSON.parse(ancien.donnees);
    const c = ctx.corps || {}, maj = { ...avant };
    if (c.prix !== undefined) maj.prix = c.prix;
    if (c.stock !== undefined && avant.type !== 'drop') maj.stock = c.stock;
    if (c.actif !== undefined) { if (typeof c.actif !== 'boolean') throw erreur(400, '« actif » doit valoir true ou false.', 'actif'); maj.actif = c.actif; }
    if (c.stock !== undefined && (!Number.isInteger(c.stock) || c.stock < 0 || c.stock > 1e6)) throw erreur(400, '« stock » doit être un entier positif.', 'stock');
    if (c.prix !== undefined && (typeof c.prix !== 'number' || !(c.prix > 0) || c.prix > 1e6)) throw erreur(400, '« prix » doit être un nombre positif.', 'prix');
    const propre = nettoyerProduit({ ...maj, type: avant.type, source: avant.source, codeFournisseur: avant.codeFournisseur, image: avant.image }, avant.historiquePrix || []);
    db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(serialiserProduit(ctx.params.id, propre), ctx.params.id);
    if (avant.type !== 'drop' && (avant.stock || 0) > 0 && propre.stock <= 0) integ.emettre(ctx.boutique.id, 'produit.rupture', { id: ctx.params.id, nom: propre.nom, stock: 0 });
    return produitApi({ ...propre, id: ctx.params.id }, ctx.boutique.slug);
  });
  r.get('/api/v1/clients', exigerCle('clients:lecture'), ctx => {
    const parEmail = new Map();
    for (const c of db.prepare("SELECT * FROM commandes WHERE boutique_id = ? AND statut NOT IN ('attente', 'annulee')").all(ctx.boutique.id).map(lireCommande)) {
      const e = String(c.client && c.client.email || '').toLowerCase(); if (!e) continue;
      const x = parEmail.get(e) || { email: e, nom: c.client.nom, commandes: 0, total: 0, derniere: null };
      x.commandes++; x.total = Math.round((x.total + c.total) * 100) / 100; x.derniere = new Date(Math.max(c.date, x.derniere ? Date.parse(x.derniere) : 0)).toISOString();
      parEmail.set(e, x);
    }
    return { donnees: [...parEmail.values()] };
  });

  /* Avis vérifiés : seul un client ayant reçu sa commande peut noter, une fois par produit. */
  const statsAvis = boutiqueId => Object.fromEntries(db.prepare('SELECT produit_id, AVG(note) AS m, COUNT(*) AS n FROM avis WHERE boutique_id = ? GROUP BY produit_id').all(boutiqueId).map(x => [x.produit_id, { moyenne: x.m, n: x.n }]));
  r.post('/api/public/:slug/avis', ctx => {
    auth.limiter('avis:' + ctx.ip, 20 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(String(ctx.corps.commandeId || ''), b.id);
    const jeton = String(ctx.corps.jeton || '');
    if (!row || !auth.egal(jeton, row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    if (!['expediee', 'livree', 'retiree'].includes(row.statut)) throw erreur(409, 'Vous pourrez donner votre avis après réception de la commande.', 'pas_encore');
    const c = lireCommande(row);
    const liste = Array.isArray(ctx.corps.avis) ? ctx.corps.avis.filter(x => x && typeof x === 'object').slice(0, 20) : [];
    let n = 0;
    for (const a of liste) {
      if (!c.lignes.some(l => l.produitId === a.produitId)) continue;
      const note = Math.round(Number(a.note));
      if (!(note >= 1 && note <= 5)) throw erreur(400, 'Note entre 1 et 5 étoiles.', 'note_invalide');
      n += db.prepare('INSERT OR IGNORE INTO avis (id, boutique_id, commande_id, produit_id, note, texte, prenom, ville, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(auth.nouvelId('av_'), b.id, c.id, a.produitId, note, String(a.texte || '').trim().slice(0, 1000), c.client.nom.split(' ')[0].slice(0, 40), (c.client.ville || '').slice(0, 60), Date.now()).changes;
    }
    if (!n) throw erreur(409, 'Avis déjà enregistré pour cette commande.', 'deja_note');
    return { statut: 201, corps: { n } };
  });
  r.get('/api/public/:slug/avis-a-donner', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(String(ctx.query.get('commande') || ''), b.id);
    const jeton = String(ctx.query.get('jeton') || '');
    if (!row || !auth.egal(jeton, row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const c = lireCommande(row);
    const deja = new Set(db.prepare('SELECT produit_id FROM avis WHERE commande_id = ?').all(c.id).map(x => x.produit_id));
    return { prenom: c.client.nom.split(' ')[0], produits: c.lignes.filter(l => !deja.has(l.produitId)).map(l => ({ produitId: l.produitId, nom: l.nom })) };
  });
  r.patch('/api/admin/avis/:id', exigerMarchand, ctx => {
    const res = db.prepare('UPDATE avis SET reponse = ? WHERE id = ? AND boutique_id = ?').run(String(ctx.corps.reponse || '').slice(0, 1000) || null, ctx.params.id, ctx.boutique.id);
    if (!res.changes) throw erreur(404, 'Avis introuvable.', 'avis_introuvable');
    return { ok: true };
  });

  /* Offre après l’achat : un complément à prix réduit, livré dans le même colis (2 heures après le paiement au plus). */
  const DELAI_COMPLEMENT = 2 * 3600 * 1000;
  function offreApres(b, c) {
    if (!['payee', 'fournisseur', 'preparation'].includes(c.statut) || c.parent || (c.complements || []).length) return null;
    const paye = (c.historique || []).find(h => /^Paiement/.test(h.texte));
    if (!paye || Date.now() - paye.date > DELAI_COMPLEMENT) return null;
    const config = configVente(b);
    const r = Remises.regleApplicable(config, c.lignes, 'apres');
    if (!r) return null;
    const p = listerProduits(b.id).find(x => x.id === r.alors && vendable(x) && (x.type === 'drop' || x.stock > 0));
    return p ? { regle: r.id, produitId: p.id, nom: p.nom, prix: p.prix, prixOffre: prix.arrondi(p.prix * (1 - r.remise / 100)), remise: r.remise, teinte: p.teinte, image: p.image === IMG ? `/api/public/${encodeURIComponent(b.slug)}/image/${encodeURIComponent(p.id)}` : p.image || null } : null;
  }
  const verifierJeton = (row, jeton) => row && auth.egal(jeton || '', row.jeton_client);
  r.post('/api/public/:slug/commandes/:id/complement', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!verifierJeton(row, ctx.corps.jeton)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const parent = lireCommande(row);
    const dejaLa = db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND statut NOT IN ('annulee') AND json_extract(donnees, '$.parent') = ?").get(b.id, parent.id);
    if (dejaLa) throw erreur(409, 'Le complément a déjà été ajouté à cette commande.', 'complement_existant');
    const o = offreApres(b, parent);
    if (!o || o.regle !== ctx.corps.regle) throw erreur(409, 'Cette offre n’est plus disponible.', 'offre_expiree');
    const config = configVente(b);
    const p = listerProduits(b.id).find(x => x.id === o.produitId);
    if (!p || !vendable(p)) throw erreur(409, 'Cette offre n’est plus disponible.', 'offre_expiree');
    const devise = config.boutique.devise || 'EUR';
    const compte = compteVente(b);
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const lignes = [{ tauxReduit: !!p.tauxReduit, produitId: p.id, nom: p.nom, prix: o.prixOffre, prixInitial: p.prix, qte: 1, type: p.type || 'stock', source: p.source || null, fournisseur: p.fournisseur || null, codeFournisseur: p.codeFournisseur, offre: o.regle, apres: true }];
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', client: parent.client, lignes, sousTotal: o.prixOffre, remise: 0, port: 0, total: o.prixOffre, tauxTva: prix.tauxTva(config), livraison: parent.livraison, canal: 'web', suivi: '', note: '', parent: parent.id, historique: [{ date: now, texte: `Complément à la commande n° ${parent.numero} (offre −${o.remise} %, même colis)` }] };
      prix.figerTaux(c, config);   // taux de TVA figé par ligne (taux réduit des denrées alimentaires)
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, b.id, n, date, statut, jeton, JSON.stringify(donnees));
      const pp = { id: auth.nouvelId('pay_'), commande_id: c.id };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(pp.id, c.id, paiement.nom, Math.round(c.total * 100), devise, 'cree', now, compte);
      return { commande: { ...c, jeton }, pmt: pp };
    });
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    const session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande, devise, urlRetour: retour, compte, moyens: moyensDe(b.id), urlAnnulation: `${urlBoutique(b)}?commande=${parent.id}&jeton=${row.jeton_client}` });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { statut: 201, corps: { paiementUrl: session.url } };
  });

  /* Mesure d’audience sans cookie : identifiant de session aléatoire (onglet), aucune adresse IP enregistrée. */
  const TYPES_EVENEMENTS = ['vue', 'produit', 'panier', 'livraison', 'paiement', 'payee', 'offre_vue'];
  r.post('/api/public/:slug/evenement', ctx => {
    auth.limiter('evenement:' + ctx.ip, 1500 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const type = String(ctx.corps.type || ''), session = String(ctx.corps.session || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!TYPES_EVENEMENTS.includes(type) || session.length < 8) throw erreur(400, 'Événement invalide.', 'invalide');
    const n = db.prepare('SELECT COUNT(*) AS n FROM evenements WHERE boutique_id = ? AND session = ?').get(b.id, session).n;
    // Plafond quotidien par boutique : un identifiant de session inventé à chaque appel ne remplit pas la base.
    try { auth.limiter('evenements-boutique:' + b.id, 50000 * facteurLimites, 86400000, ''); } catch { return { ok: true }; }
    if (n < 300) db.prepare('INSERT INTO evenements (boutique_id, type, session, produit_id, valeur, date) VALUES (?, ?, ?, ?, ?, ?)').run(b.id, type, session, String(ctx.corps.produitId || '').slice(0, 40) || null, String(ctx.corps.valeur || '').slice(0, 40) || null, Date.now());
    return { ok: true };
  });

  r.post('/api/public/:slug/code', ctx => {
    auth.limiter('code:' + ctx.ip, 40 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const saisi = String(ctx.corps.code || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = Remises.codesValables(configVente(b)).find(x => x.code === saisi);
    if (!c) throw erreur(404, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    // Le code de bienvenue ne vaut que pour une première commande : on le dit dès sa saisie (contrôlé au paiement avec l'e-mail).
    const bv = ((configVente(b).automatisations || {}).bienvenue || {});
    return { code: c.code, remise: c.remise, ...(bv.code && String(bv.code).toUpperCase() === c.code ? { condition: 'Valable sur une première commande.' } : {}) };
  });
  r.post('/api/public/:slug/newsletter', ctx => {
    auth.limiter('newsletter:' + ctx.ip, 20 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const email = valider.email(ctx.corps.email);
    // Double confirmation (opt-in) : n'importe qui pourrait saisir l'adresse d'un tiers ; seul un clic dans l'e-mail envoyé
    // à cette adresse l'inscrit (et déclenche l'e-mail de bienvenue). Une adresse déjà inscrite ne reçoit rien de plus.
    // Même réponse dans tous les cas (déjà inscrit, trop de demandes) : le formulaire ne révèle pas qui est abonné.
    try { auth.limiter(`newsletter-adresse:${b.id}|${email.toLowerCase()}`, 3, 24 * 3600000, ''); } catch { return { ok: true, confirmation: true }; }
    if (db.prepare('SELECT 1 FROM abonnes WHERE boutique_id = ? AND email = ?').get(b.id, email)) return { ok: true, confirmation: true };
    // Jeton propre à la confirmation : aléatoire, à usage unique, valable 7 jours, gardé en empreinte seulement.
    const jetonOptin = crypto.randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM optins WHERE expire_le < ?').run(Date.now());
    db.prepare('INSERT INTO optins (jeton_hash, boutique_id, email, expire_le) VALUES (?, ?, ?, ?)').run(auth.sha256(jetonOptin), b.id, email.toLowerCase(), Date.now() + 7 * 86400000);
    const nom = lireConfig(b).boutique.nom, lien = `${urlPublique}/reinscription?j=${jetonOptin}`;
    envoyerEmail(b.id, email, `Confirmez votre inscription chez ${nom}`, `Bonjour,\n\nVous (ou quelqu'un d'autre) avez demandé à recevoir les nouvelles et offres de ${nom}. Pour confirmer, cliquez ici :\n${lien}\n\nSi ce n'est pas vous, ignorez cet e-mail : vous ne recevrez rien d'autre.\n\n${nom}`);
    return { ok: true, confirmation: true };
  });
  r.post('/api/public/:slug/commandes/:id/reprendre', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    const jeton = String(ctx.corps.jeton || '');
    if (!row || !auth.egal(jeton, row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    if (row.statut !== 'attente') throw erreur(409, 'Cette commande est déjà payée ou annulée.', 'deja_traitee');
    const c = lireCommande(row);
    const devise = lireConfig(b).boutique.devise || 'EUR';
    const compte = compteVente(b);
    for (const ancien of db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id)) {
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(ancien.id);
      if (ancien.fournisseur === 'stripe' && paiement.expirer) await paiement.expirer(ancien).catch(e => journal.error('[paiement] expiration', e.message));
    }
    const pmt = { id: auth.nouvelId('pay_'), commande_id: c.id };
    db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(pmt.id, c.id, paiement.nom, Math.round(c.total * 100), devise, 'cree', Date.now(), compte);
    const retour = `${urlBoutique(b)}?commande=${c.id}&jeton=${row.jeton_client}`;
    const session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande: c, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1`, compte, moyens: moyensDe(b.id) });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { paiementUrl: session.url };
  });

  /* E-mails automatiques de toutes les boutiques (appelé régulièrement). */
  /* Entretien périodique : ce qui ne doit pas dépendre d'un minuteur en mémoire (perdu au redémarrage),
     les commandes restées bloquées chez le fournisseur, et la purge des tables qui grossiraient sans fin. */
  let dernierePurge = 0;
  function entretien(maintenant = Date.now()) {
    // Fournisseur de démonstration : expéditions en attente (redémarrage, webhook en échec)
    if (delaiExpeditionDemo >= 0) for (const r of db.prepare("SELECT ref FROM demo_fournisseur_commandes WHERE statut = 'recue' AND cree_le < ?").all(maintenant - delaiExpeditionDemo - 60000)) expedierDemo(r.ref).catch(e => journal.error('[demo-fournisseur]', e.message));
    if (maintenant - dernierePurge < 86400000) return;
    dernierePurge = maintenant;
    // Commande transmise, sans expédition depuis 7 jours : le marchand est prévenu (une fois), pour relancer le fournisseur
    for (const row of db.prepare("SELECT id, numero, boutique_id FROM commandes WHERE statut = 'fournisseur' AND date < ?").all(maintenant - 7 * 86400000)) {
      if (!relances.reserverEnvoi || !relances.reserverEnvoi(db, row.boutique_id, `bloquee:${row.id}`, maintenant)) continue;
      const b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id), mch = b && db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
      if (mch) envoyerEmail(null, mch.email, `Commande n° ${row.numero} : toujours pas expédiée par le fournisseur`, `Bonjour,\n\nLa commande n° ${row.numero} a été transmise au fournisseur il y a plus de 7 jours et n'a pas encore de numéro de suivi. Contactez le fournisseur, ou remboursez le client depuis Commandes si le colis ne part pas.\n\nComptoir`);
    }
    // Purge quotidienne
    db.prepare('DELETE FROM images_produits WHERE produit_id IN (SELECT id FROM produits WHERE supprime = 1)').run();   // photos des produits supprimés : sessions et liens expirés, mesures d'audience de plus de 400 jours, corps des e-mails envoyés de plus de 180 jours
    db.prepare('DELETE FROM sessions WHERE expire_le < ?').run(maintenant);
    try { db.prepare('DELETE FROM reinitialisations WHERE expire_le < ?').run(maintenant); } catch { /* table absente */ }
    try { db.prepare('DELETE FROM evenements WHERE date < ?').run(maintenant - 400 * 86400000); } catch { /* table absente */ }
    db.prepare("UPDATE emails SET corps = '(contenu effacé après 180 jours)' WHERE envoye = 1 AND cree_le < ? AND corps <> '(contenu effacé après 180 jours)'").run(maintenant - 180 * 86400000);
    db.prepare('DELETE FROM tickets_caisse WHERE le < ?').run(maintenant - 30 * 86400000);
    db.prepare('DELETE FROM journal_compte WHERE date < ?').run(maintenant - 365 * 86400000);   // activité du compte : 12 mois
    if (abo.obligatoire) conservation(maintenant).catch(e => journal.error('[conservation]', e.message));
  }
  /* Rapport hebdomadaire au marchand, le lundi dès 7 h (heure de la boutique) : ventes de la semaine passée comparées à
     la précédente, meilleurs produits, à expédier, factures QR échues, commandes à risque, ruptures prévues.
     Rien n'est envoyé à une boutique sans aucune commande depuis deux semaines (pas d'e-mail vide). */
  db.exec('CREATE TABLE IF NOT EXISTS rapports_hebdo (boutique_id TEXT NOT NULL, semaine TEXT NOT NULL, PRIMARY KEY (boutique_id, semaine))');
  function rapportsHebdo(maintenant = Date.now()) {
    const d = new Date(maintenant);
    if (d.getDay() !== 1 || d.getHours() < 7) return 0;
    const lundi = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), semaine = new Date(lundi).toLocaleDateString('sv-SE');
    let n = 0;
    for (const b of db.prepare('SELECT * FROM boutiques').all()) {
      if (db.prepare('SELECT 1 FROM rapports_hebdo WHERE boutique_id = ? AND semaine = ?').get(b.id, semaine)) continue;
      const config = lireConfig(b);
      const e = abo.etat(b.marchand_id);
      if (!e.actif || (config.reglages && config.reglages.rapportHebdo === false)) { db.prepare('INSERT OR IGNORE INTO rapports_hebdo VALUES (?, ?)').run(b.id, semaine); continue; }
      const cmds = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND date >= ?').all(b.id, lundi - 14 * 86400000).map(lireCommande);
      db.prepare('INSERT OR IGNORE INTO rapports_hebdo VALUES (?, ?)').run(b.id, semaine);
      if (!cmds.length) continue;
      const vendue = c => !['attente', 'annulee', 'remboursee'].includes(c.statut);
      const sem = cmds.filter(c => c.date >= lundi - 7 * 86400000 && c.date < lundi && vendue(c)), avant = cmds.filter(c => c.date < lundi - 7 * 86400000 && vendue(c));
      const ca = l => l.reduce((a, c) => a + c.total, 0), f = m => formatMontant(m, config);
      const evol = (x, y) => y ? `${x >= y ? '+' : '−'}${Math.abs(Math.round((x - y) / y * 100))} % par rapport à la semaine d’avant` : 'première semaine de ventes';
      const parProduit = {};
      for (const c of sem) for (const l of c.lignes || []) { const k = l.nom; parProduit[k] = parProduit[k] || { q: 0, m: 0 }; parProduit[k].q += l.qte; parProduit[k].m += l.prix * l.qte; }
      const tops = Object.entries(parProduit).sort((a, b2) => b2[1].m - a[1].m).slice(0, 3);
      const toutes = db.prepare("SELECT * FROM commandes WHERE boutique_id = ? AND statut IN ('payee', 'preparation', 'attente')").all(b.id).map(lireCommande);
      const aExpedier = toutes.filter(c => ['payee', 'preparation'].includes(c.statut) && c.livraison !== 'retrait' && !(c.lignes || []).every(l => l.type === 'drop'));
      const echues = toutes.filter(c => c.statut === 'attente' && c.moyen === 'facture' && c.echeance && c.echeance < maintenant);
      const risquees = toutes.filter(c => ['payee', 'preparation'].includes(c.statut) && c.risque && c.risque.niveau === 'eleve');
      // Ruptures prévues (même calcul que le tableau de bord : rythme des 28 derniers jours)
      const ventes28 = db.prepare("SELECT date, donnees FROM commandes WHERE boutique_id = ? AND date >= ? AND statut NOT IN ('attente', 'annulee', 'remboursee')").all(b.id, maintenant - 28 * 86400000).map(r2 => ({ ...JSON.parse(r2.donnees), date: r2.date }));
      const ruptures = listerProduits(b.id).filter(p => p.actif !== false && p.type !== 'drop' && p.stock > 0).map(p => {
        let v = 0, premiere = maintenant;
        for (const c of ventes28) { const q = (c.lignes || []).filter(l => l.produitId === p.id).reduce((x, l) => x + l.qte, 0); if (q) { v += q; premiere = Math.min(premiere, c.date || maintenant); } }
        const periode = Math.max(7, Math.min(28, (maintenant - premiere) / 86400000));   // même calcul que le tableau de bord
        return v >= 2 ? { p, jours: Math.floor(p.stock / (v / periode)) } : null;
      }).filter(x => x && x.jours <= 14).sort((a, b2) => a.jours - b2.jours).slice(0, 5);
      const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
      if (!mch) continue;
      const lignes = [
        `Bonjour,`, '', `Votre semaine sur ${config.boutique.nom} (du ${new Date(lundi - 7 * 86400000).toLocaleDateString('fr-CH')} au ${new Date(lundi - 86400000).toLocaleDateString('fr-CH')}) :`, '',
        `- Chiffre d’affaires : ${f(ca(sem))} (${evol(ca(sem), ca(avant))})`,
        `- Commandes : ${sem.length}${sem.length ? ` · panier moyen ${f(ca(sem) / sem.length)}` : ''}`,
        ...(tops.length ? ['', 'Meilleurs produits :', ...tops.map(([nom, x]) => `- ${nom} : ${x.q} vendu${x.q > 1 ? 's' : ''}, ${f(x.m)}`)] : []),
        '', 'À faire cette semaine :',
        aExpedier.length ? `- ${aExpedier.length} commande${aExpedier.length > 1 ? 's' : ''} à préparer et expédier` : '- Aucune commande en retard d’expédition',
        ...(echues.length ? [`- ${echues.length} facture${echues.length > 1 ? 's' : ''} QR échue${echues.length > 1 ? 's' : ''} non payée${echues.length > 1 ? 's' : ''} (n° ${echues.slice(0, 5).map(c => c.numero).join(', ')}) : importez votre relevé bancaire ou relancez le client`] : []),
        ...(risquees.length ? [`- ${risquees.length} commande${risquees.length > 1 ? 's' : ''} à risque de fraude à vérifier (n° ${risquees.slice(0, 5).map(c => c.numero).join(', ')})`] : []),
        ...ruptures.map(x => `- Rupture prévue dans ${x.jours} jour${x.jours > 1 ? 's' : ''} : ${x.p.nom} (stock ${x.p.stock})`),
        '', `Votre tableau de bord : ${urlPublique}/app#tableau`, '', 'Ce rapport arrive chaque lundi. Pour ne plus le recevoir : Paramètres > E-mails.', '', 'L’équipe Comptoir'
      ];
      envoyerEmail(null, mch.email, `Votre semaine : ${f(ca(sem))}, ${sem.length} commande${sem.length > 1 ? 's' : ''} (${config.boutique.nom})`, lignes.join('\n'));
      n++;
    }
    return n;
  }
  function automatisationsEcheances(maintenant = Date.now()) {
    let n = 0;
    entretien(maintenant);
    try { rapportsHebdo(maintenant); } catch (e) { journal.error('[rapport-hebdo]', e.message); }
    for (const b of db.prepare('SELECT * FROM boutiques').all()) {
      if (!paiementsActifs(b) || !abo.etat(b.marchand_id).actif) continue;   // vérifié avant de lire les commandes (coût)
      const commandes = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND date > ?').all(b.id, maintenant - 400 * 86400000).map(row => ({ ...lireCommande(row), jeton: row.jeton_client }));
      if (!paiementsActifs(b) || !abo.etat(b.marchand_id).actif) continue;   // boutique fermée (abonnement) : ses liens mèneraient à une page 404   // paiements non activés : une relance renverrait vers un lien qui refuse le paiement
      n += relances.executer({ db, boutique: b, config: configVente(b), commandes, maintenant, urlPublique, urlBoutique: urlBoutique(b), envoyerEmail, formatMontant,
        enregistrerCommande: c => { const { jeton, ...reste } = c; enregistrerCommande(reste); } });
    }
    return n;
  }

  const verifsSession = new Map();
  r.get('/api/public/:slug/commandes/:id', async ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    let row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    const jeton = String(ctx.query.get('jeton') || '');
    if (!row || !auth.egal(jeton, row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    // Retour du client après paiement : si le webhook n'est pas encore arrivé (ou manque), Stripe est interrogé directement.
    if (row.statut === 'attente' && paiement.sessionPayee) {
      for (const p of db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree' AND fournisseur = 'stripe'").all(row.id)) {
        if (Date.now() - (verifsSession.get(p.id) || 0) < 10000) continue;   // au plus une question à Stripe toutes les 10 s par paiement
        verifsSession.set(p.id, Date.now()); if (verifsSession.size > 5000) verifsSession.clear();
        const paye = await paiement.sessionPayee(p).catch(() => false);
        if (paye) { await paiementConfirme(p.id, p.ref_externe); if (typeof paye === 'string') db.prepare('UPDATE paiements SET intent = ? WHERE id = ?').run(paye, p.id); break; }
      }
      row = db.prepare('SELECT * FROM commandes WHERE id = ?').get(row.id);
    }
    const c = lireCommande(row);
    return { numero: c.numero, statut: c.statut, total: c.total, port: c.port || 0, livraison: c.livraison, date: c.date, prenom: String((c.client && c.client.nom) || '').split(' ')[0], ville: (c.client && c.client.ville) || '', suivi: c.suivi || null, lignes: c.lignes.map(l => ({ produitId: l.produitId, nom: l.nom, qte: l.qte, prix: l.prix })), offreApres: offreApres(b, c) };
  });

  /* ---------- Webhooks ---------- */
  r.post('/api/webhooks/stripe', async ctx => {
    if (paiement.nom !== 'stripe' || !paiement.verifierWebhook(ctx.corpsBrut, ctx.req.headers['stripe-signature'])) throw erreur(400, 'Signature invalide.', 'signature');
    const ev = JSON.parse(ctx.corpsBrut);
    // Stripe renvoie un même événement en cas de doute : il n'est traité qu'une fois (plus d'e-mail en double).
    if (ev.id) {
      db.exec('CREATE TABLE IF NOT EXISTS evenements_stripe (id TEXT PRIMARY KEY, recu_le INTEGER NOT NULL)');
      if (db.prepare('INSERT OR IGNORE INTO evenements_stripe (id, recu_le) VALUES (?, ?)').run(String(ev.id), Date.now()).changes === 0) return { recu: true, deja: true };
      db.prepare('DELETE FROM evenements_stripe WHERE recu_le < ?').run(Date.now() - 30 * 86400000);
    }
    try { return await traiterEvenementStripe(ev); }
    catch (e) { if (ev.id) db.prepare('DELETE FROM evenements_stripe WHERE id = ?').run(String(ev.id)); throw e; }   // échec (Stripe injoignable…) : Stripe réessaiera, l'événement n'est pas perdu
  });
  async function traiterEvenementStripe(ev) {
    // Événement d'un compte connecté (boutique) : jamais un abonnement Comptoir ; seuls l'état du compte et ses ventes comptent.
    if (ev.account) {
      const objet = (ev.data && ev.data.object) || {};
      if (ev.type === 'account.updated') { const e = etatDepuisCompte(objet); db.prepare('UPDATE comptes_stripe SET pret = ?, moyens = ?, maj_le = ? WHERE compte = ?').run(e.pret ? 1 : 0, JSON.stringify(e.moyens), Date.now(), ev.account); }
      if (ev.type === 'account.application.deauthorized') db.prepare('UPDATE comptes_stripe SET pret = 0, maj_le = ? WHERE compte = ?').run(Date.now(), ev.account);
      if (((ev.type === 'checkout.session.completed' && objet.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded') && objet.metadata && objet.metadata.paiement_id) {
        const p = db.prepare('SELECT compte FROM paiements WHERE id = ?').get(String(objet.metadata.paiement_id));
        if (p && p.compte === ev.account) {   // la vente doit venir du compte de la boutique
          await paiementConfirme(objet.metadata.paiement_id, objet.id);
          if (objet.payment_intent) db.prepare('UPDATE paiements SET intent = ? WHERE id = ?').run(String(objet.payment_intent), String(objet.metadata.paiement_id));
        }
      }
      // Litige (rétrofacturation) : le client conteste le paiement auprès de sa banque. Le marchand doit répondre dans Stripe
      // avant l'échéance, sinon il perd le montant et des frais : il est prévenu, et la commande le montre.
      if (/^charge\.dispute\.(created|updated|closed|funds_withdrawn)$/.test(ev.type) && objet.payment_intent) {
        const p = db.prepare('SELECT * FROM paiements WHERE intent = ? AND compte = ?').get(String(objet.payment_intent), ev.account);
        const row = p && db.prepare('SELECT * FROM commandes WHERE id = ?').get(p.commande_id);
        if (row) {
          const c = lireCommande(row), b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id), config = lireConfig(b);
          const echeance = objet.evidence_details && objet.evidence_details.due_by ? objet.evidence_details.due_by * 1000 : null;
          const nouveau = !c.litige;
          c.litige = { statut: String(objet.status || ''), montant: (Number(objet.amount) || 0) / 100, raison: String(objet.reason || ''), echeance, maj: Date.now() };
          historique(c, ev.type === 'charge.dispute.closed' ? `Litige clos : ${objet.status === 'won' ? 'gagné, le montant reste acquis' : 'perdu, le montant a été repris par la banque du client'}` : nouveau ? `Litige ouvert par le client auprès de sa banque (${c.litige.raison || 'motif non précisé'})` : 'Litige mis à jour');
          enregistrerCommande(c);
          const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
          if (mch && nouveau) envoyerEmail(null, mch.email, `Litige sur la commande n° ${c.numero} : répondez avant l’échéance`,
            `Bonjour,\n\nLe client de la commande n° ${c.numero} (${formatMontant(c.litige.montant, config)}) conteste le paiement auprès de sa banque (motif : ${c.litige.raison || 'non précisé'}).\n\nRépondez dans votre tableau de bord Stripe${echeance ? ` avant le ${new Date(echeance).toLocaleDateString('fr-FR')}` : ''} avec vos preuves : facture, suivi du colis, échanges avec le client. Sans réponse, la banque rend le montant au client et Stripe facture des frais de litige.\n\nComptoir`);
        }
      }
      return { recu: true };
    }
    const evAbo = await abo.evenementStripe(ev);
    if (evAbo) { if (evAbo.marchandId) emailAbonnement(evAbo.marchandId, evAbo.evenement); return { recu: true }; }
    const objet = (ev.data && ev.data.object) || {};
    if (((ev.type === 'checkout.session.completed' && objet.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded') && objet.metadata && objet.metadata.paiement_id) {
      await paiementConfirme(ev.data.object.metadata.paiement_id, ev.data.object.id);
    }
    return { recu: true };
  }
  r.post('/api/webhooks/fournisseurs/:code', ctx => {
    const f = db.prepare('SELECT * FROM fournisseurs WHERE code = ?').get(ctx.params.code);
    if (!f || !fournisseurs.verifierSignature(ctx.corpsBrut, ctx.req.headers['x-signature'], f.secret_webhook)) throw erreur(401, 'Signature invalide.', 'signature');
    const ev = JSON.parse(ctx.corpsBrut);
    // Seulement une commande transmise à CE fournisseur : un fournisseur ne peut pas agir sur les commandes d'un autre.
    const row = db.prepare("SELECT * FROM commandes WHERE json_extract(donnees, '$.refFournisseur') = ? AND json_extract(donnees, '$.codeFournisseur') = ?").get(String(ev.ref), f.code);
    if (!row) throw erreur(404, 'Commande inconnue.', 'commande_introuvable');
    const c = lireCommande(row);
    if (ev.statut === 'expediee' && estDrop(c) && !c.suivi) {
      c.suivi = String(ev.suivi || '').slice(0, 60);
      c.transporteur = String(ev.transporteur || '').slice(0, 40);
      c.statut = 'expediee';
      historique(c, `Expédiée par le fournisseur (${c.transporteur}), suivi ${c.suivi} envoyé au client`);
      enregistrerCommande(c);
      { const bq = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id); emailExpedition(bq, c, lireConfig(bq)); }
    } else if (ev.statut === 'expediee' && !estDrop(c) && !c.suiviFournisseur) {
      // Commande mixte : seule la partie du fournisseur est partie ; le marchand expédiera le reste avec son propre suivi.
      c.suiviFournisseur = String(ev.suivi || '').slice(0, 60);
      c.transporteurFournisseur = String(ev.transporteur || '').slice(0, 40);
      historique(c, `Partie fournisseur expédiée (${c.transporteurFournisseur}), suivi ${c.suiviFournisseur} ; le reste est à expédier par vous`);
      enregistrerCommande(c);
      const bq = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id), conf = lireConfig(bq);
      const parties = c.lignes.filter(l => l.type === 'drop').map(l => `- ${l.qte} × ${l.nom}`).join('\n');
      if (EmailsClients.langueDe(c)) { const m = EmailsClients.partiel(c, { ...optionsEmail(bq, c, conf), lignes: parties }); envoyerEmail(bq.id, c.client.email, m.sujet, m.corps, { langue: c.langue }); }
      else envoyerEmail(bq.id, c.client.email, `Une partie de votre commande n° ${c.numero} est en route`, `Bonjour ${c.client.nom},\n\nCes articles sont partis${c.transporteurFournisseur ? ` avec ${c.transporteurFournisseur}` : ''} :\n${parties}\nNuméro de suivi : ${c.suiviFournisseur}\n\nLe reste de votre commande suit séparément ; nous vous écrirons à son expédition.\n\nVotre commande : ${lienCommande(bq, c.id)}\n\n${conf.boutique.nom}`);
    }
    return { recu: true };
  });

  /* ---------- Paiement simulé (page de test, désactivée en production) ---------- */
  const pageSimulation = (p, c, config) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paiement (simulation)</title>
    <style>*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;background:#F3F4F7;color:#151821;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:1px solid #E0E3EA;border-radius:12px;padding:28px;max-width:420px;width:100%;display:grid;gap:14px}h1{font-size:1.3rem;margin:0}.total{font-size:1.8rem;font-weight:700}button{font:inherit;font-weight:600;padding:12px;border-radius:8px;border:1px solid #151821;width:100%;cursor:pointer}.payer{background:#151821;color:#fff}.annuler{background:#fff}.note{color:#5B6372;font-size:.85rem}</style></head>
    <body><main><p class="note">Page de paiement de test. Aucun argent n’est débité. Avec une clé Stripe, cette étape devient le vrai paiement TWINT ou carte.</p>
    <h1>${escHtml(config.boutique.nom)} · commande n° ${c.numero}</h1><div class="total">${formatMontant(p.montant_centimes / 100, config)}</div>
    <form method="post" action="/paiement-simule/${p.id}/confirmer"><button class="payer">Payer avec TWINT (simulation)</button></form>
    <form method="post" action="/paiement-simule/${p.id}/annuler"><button class="annuler">Annuler</button></form></main></body></html>`;
  const chargerPaiementSimule = id => {
    if (!simulationAutorisee) throw erreur(404, 'Introuvable.', 'introuvable');
    const p = db.prepare("SELECT * FROM paiements WHERE id = ? AND fournisseur = 'simulation'").get(id);
    if (!p) throw erreur(404, 'Paiement introuvable.', 'introuvable');
    const row = db.prepare('SELECT c.*, b.slug, b.config FROM commandes c JOIN boutiques b ON b.id = c.boutique_id WHERE c.id = ?').get(p.commande_id);
    return { p, row, c: lireCommande(row), config: JSON.parse(row.config) };
  };
  /* Signature légère de l'état (pour savoir s'il faut recharger) : quelques octets au lieu de plusieurs Mo. */
  const signatureDe = boutiqueId => {
    // Lu uniquement dans les index (boutique, date) et (boutique, maj_le) : toute modification de commande passe par
    // enregistrerCommande, qui date maj_le ; pas de lecture du JSON, pas de regroupement par statut.
    const c = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(date), 0) AS derniere FROM commandes WHERE boutique_id = ?').get(boutiqueId);
    const m = db.prepare('SELECT COALESCE(MAX(maj_le), 0) AS maj FROM commandes WHERE boutique_id = ?').get(boutiqueId);
    const a = db.prepare('SELECT COUNT(*) AS n FROM avis WHERE boutique_id = ?').get(boutiqueId);
    return { commandes: c.n, derniere: c.derniere, maj: m.maj, avis: a.n };
  };
  r.get('/api/admin/signature', exigerMarchand, ctx => signatureDe(ctx.boutique.id));

  /* Tableau de bord en direct (Server-Sent Events) : une connexion ouverte par onglet ; le serveur compare la signature
     de chaque boutique suivie toutes les 2 s et pousse « maj » quand elle change, avec les nouvelles commandes payées
     (numéro, total) pour la notification. Session révoquée ou expirée : le flux se ferme. */
  const flux = new Set();
  let minuterieFlux = null;
  const ecrire = (a, texte) => { try { a.res.write(texte); } catch { /* fermé */ } };
  let dernieresEcritures = -1;
  function tourDeFlux() {
    // Aucune écriture dans la base depuis le dernier tour : rien n'a pu changer, on ne lit rien (coût nul au repos).
    const ecritures = Number(db.prepare('SELECT total_changes() AS n').get().n);
    const calme = ecritures === dernieresEcritures;
    dernieresEcritures = ecritures;
    const parBoutique = new Map();
    for (const a of flux) { if (!parBoutique.has(a.boutiqueId)) parBoutique.set(a.boutiqueId, []); parBoutique.get(a.boutiqueId).push(a); }
    const maintenant = Date.now();
    for (const [boutiqueId, abonnes] of parBoutique) {
      let sig = null, cle = null;
      if (!calme) { try { sig = signatureDe(boutiqueId); cle = JSON.stringify(sig); } catch { continue; } }
      for (const a of abonnes) {
        // Session encore valable ? (contrôle toutes les 30 s : déconnexion à distance, mot de passe changé)
        if (maintenant - a.controle > (Number(env.FLUX_CONTROLE_MS) || 30000)) {
          a.controle = maintenant;
          const sess = db.prepare('SELECT marchand_id FROM sessions WHERE jeton_hash = ? AND expire_le > ?').get(a.session, maintenant);
          const e = sess && abo.etat(sess.marchand_id);
          if (!sess || (e.obligatoire && !e.actif)) {   /* session terminée ou abonnement échu */ ecrire(a, 'event: fin\ndata: {}\n\n'); a.res.end(); flux.delete(a); continue; }
        }
        if (cle !== null && a.signature !== cle) {
          // Seules les commandes payées par le client depuis le dernier envoi (pas une simple modification ni un retrait).
          const nouvelles = db.prepare("SELECT numero, json_extract(donnees, '$.total') AS total FROM commandes WHERE boutique_id = ? AND maj_le > ? AND json_extract(donnees, '$.payeLe') > ? ORDER BY date LIMIT 5").all(boutiqueId, a.depuis, a.depuis);
          if (a.signature !== null) ecrire(a, `event: maj\ndata: ${JSON.stringify({ ...sig, nouvelles })}\n\n`);
          a.signature = cle; a.depuis = maintenant;
        } else if (maintenant - a.ping > 25000) { ecrire(a, ': ping\n\n'); a.ping = maintenant; }   // garde la connexion ouverte (proxys)
      }
    }
    if (!flux.size) { clearInterval(minuterieFlux); minuterieFlux = null; }
  }
  r.get('/api/admin/flux', exigerMarchand, ctx => {
    const parMarchand = [...flux].filter(a => a.marchandId === ctx.marchand.id).length;
    if (parMarchand >= 8 || flux.size >= 5000) throw erreur(429, 'Trop d’onglets ouverts en direct.', 'trop_de_flux');
    const a = { res: ctx.res, boutiqueId: ctx.boutique.id, marchandId: ctx.marchand.id, session: auth.sha256(String(ctx.cookies[auth.COOKIE] || '')), signature: JSON.stringify(signatureDe(ctx.boutique.id)), depuis: Date.now(), ping: Date.now(), controle: Date.now() };
    ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive', ...ctx.entetes });
    ctx.res.write('retry: 5000\nevent: pret\ndata: {}\n\n');
    flux.add(a);
    ctx.req.on('close', () => flux.delete(a));
    if (!minuterieFlux) { minuterieFlux = setInterval(tourDeFlux, Number(env.FLUX_INTERVALLE_MS) || 2000); minuterieFlux.unref(); }
    return { diffusion: true };
  });

  /* ---------- Produits stars : signaux de demande pour le pays de la boutique ---------- */
  r.get('/api/admin/tendances', exigerMarchand, async ctx => {
    if (!collecte.signaux('ch').majLe) await collecte.rafraichir();
    else collecte.actualiserVentes(Number(env.TENDANCES_VENTES_AGE_MS || 15 * 60000));
    return collecte.signaux(lireConfig(ctx.boutique).boutique.pays || 'ch');
  });

  /* ---------- Boutique publique : page rendue par le serveur pour les moteurs de recherche et le partage ---------- */
  const produitVisible = (b, id) => abo.etat(b.marchand_id).actif && listerProduits(b.id).some(x => x.id === id && vendable(x));
  function pageBoutique(b, { racine, produitId = null }) {
    const config = configVente(b);
    const ouverte = abo.etat(b.marchand_id).actif;
    const produits = ouverte ? listerProduits(b.id).filter(vendable) : [];
    const p = produitId ? produits.find(x => x.id === produitId) : null;
    const nom = config.boutique.nom;
    const hero = (config.boutique.sections || []).find(s => s.type === 'hero');
    const devise = config.boutique.devise || 'EUR';
    const base = racine.replace(/\/$/, '');
    const urlProduit = x => `${base}/p/${encodeURIComponent(x.id)}`;
    const court = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 158);
    const titre = p ? `${p.nom} · ${nom}` : config.boutique.slogan ? `${nom} · ${config.boutique.slogan}` : nom;
    const description = court(p ? (p.description || `${p.nom}, ${formatMontant(p.prix, config)}`) : (config.boutique.slogan || (hero && hero.props && (hero.props.sousTitre || hero.props.texte)) || `Boutique en ligne ${nom} : ${produits.slice(0, 4).map(x => x.nom).join(', ')}`));
    const image = p && p.image ? `${urlPublique}/api/public/${encodeURIComponent(b.slug)}/image/${encodeURIComponent(p.id)}` : null;
    const canonique = p ? urlProduit(p) : base + '/';
    const ld = p ? { '@context': 'https://schema.org', '@type': 'Product', name: p.nom, description: court(p.description), ...(image ? { image } : {}), url: canonique, brand: { '@type': 'Brand', name: nom },
      offers: { '@type': 'Offer', price: Number(p.prix).toFixed(2), priceCurrency: devise, availability: p.type === 'drop' || p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: canonique } }
      : { '@context': 'https://schema.org', '@type': 'OnlineStore', name: nom, url: canonique, description, ...(config.entreprise && config.entreprise.email ? { email: config.entreprise.email } : {}) };
    const tete = [
      `<meta name="comptoir-slug" content="${escHtml(b.slug)}">`, `<meta name="comptoir-racine" content="${escHtml(new URL(base + '/').pathname)}">`,
      ...(p ? [`<meta name="comptoir-produit" content="${escHtml(p.id)}">`] : []),
      `<title>${escHtml(titre)}</title>`, `<meta name="description" content="${escHtml(description)}">`, `<link rel="canonical" href="${escHtml(canonique)}">`, `<link rel="sitemap" type="application/xml" href="${escHtml(base)}/sitemap.xml">`,
      ...(ouverte && !(produitId && !p) ? [] : ['<meta name="robots" content="noindex">']),
      `<meta property="og:type" content="${p ? 'product' : 'website'}">`, `<meta property="og:site_name" content="${escHtml(nom)}">`, `<meta property="og:title" content="${escHtml(p ? p.nom : nom)}">`,
      `<meta property="og:description" content="${escHtml(description)}">`, `<meta property="og:url" content="${escHtml(canonique)}">`, `<meta property="og:locale" content="fr_${config.boutique.pays === 'ch' ? 'CH' : config.boutique.pays === 'be' ? 'BE' : 'FR'}">`,
      ...(image ? [`<meta property="og:image" content="${escHtml(image)}">`, '<meta name="twitter:card" content="summary_large_image">'] : ['<meta name="twitter:card" content="summary">']),
      ...(p ? [`<meta property="product:price:amount" content="${Number(p.prix).toFixed(2)}">`, `<meta property="product:price:currency" content="${devise}">`] : []),
      `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
    ].join('\n');
    // Contenu lisible sans JavaScript (robots, aperçus) ; remplacé par la boutique interactive au chargement.
    const sansJs = `<noscript><main class="page-erreur"><h1>${escHtml(p ? p.nom : nom)}</h1>${p ? `<p>${escHtml(court(p.description))}</p><p><strong>${escHtml(formatMontant(p.prix, config))}</strong></p>` : `<p>${escHtml(description)}</p><ul>${produits.slice(0, 60).map(x => `<li><a href="${escHtml(urlProduit(x))}">${escHtml(x.nom)}</a> · ${escHtml(formatMontant(x.prix, config))}</li>`).join('')}</ul>`}<p>Activez JavaScript pour commander.</p></main></noscript>`;
    return fs.readFileSync(path.join(RACINE_FRONT, 'boutique.html'), 'utf8').replace(/<title>[^<]*<\/title>/, '').replace('<head>', () => `<head>\n${tete}`).replace('<div id="app"></div>', () => `<div id="app"></div>${sansJs}`);   // fonctions : « $' » ou « $& » dans un nom de boutique restent du texte
  }
  function planDuSite(b, racine) {
    const base = racine.replace(/\/$/, '');
    const produits = abo.etat(b.marchand_id).actif ? listerProduits(b.id).filter(vendable) : [];
    const urls = [`${base}/`, ...produits.map(p => `${base}/p/${encodeURIComponent(p.id)}`)];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${escHtml(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  }
  // Image d'un produit en fichier (pour l'aperçu de partage : og:image doit être une adresse, pas une image intégrée).
  r.get('/api/public/:slug/image/:id', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const p = listerProduits(b.id).find(x => x.id === ctx.params.id && vendable(x) && x.image);
    const m = p && /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(p.image === IMG ? imageDe(p.id) || '' : p.image);
    if (!m) throw erreur(404, 'Image introuvable.', 'introuvable');
    return { binaire: Buffer.from(m[3], 'base64'), type: m[1] };
  });

  /* ---------- Désinscription des e-mails commerciaux (lien personnel signé, confirmation par un clic) ---------- */
  const pageSimple = (titre, texte, formulaire = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(titre)}</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#F4F5F7;color:#151821;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{background:#fff;border:1px solid #E0E3EA;border-radius:14px;padding:28px;max-width:440px;display:grid;gap:12px}h1{font-size:1.2rem;margin:0}button{font:inherit;padding:11px 16px;border-radius:9px;border:1px solid #151821;background:#151821;color:#fff;font-weight:600;cursor:pointer}</style></head><body><main><h1>${escHtml(titre)}</h1><p>${escHtml(texte)}</p>${formulaire}</main></body></html>`;
  /* Pages légales de la plateforme elle-même (l'exploitant les complète avec EXPLOITANT_* dans l'environnement). */
  const exploitant = () => ({
    nom: env.EXPLOITANT_NOM || '', adresse: env.EXPLOITANT_ADRESSE || '', email: env.EXPLOITANT_EMAIL || '', ide: env.EXPLOITANT_IDE || '', hebergeur: env.HEBERGEUR || ''
  });
  const pageLegale = (titre, blocs) => {
    const x = exploitant(), manque = !x.nom || !x.adresse || !x.email;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(titre)} · Comptoir</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#F4F5F7;color:#151821;padding:16px}main{background:#fff;border:1px solid #E0E3EA;border-radius:14px;padding:24px;max-width:720px;margin:24px auto}h1{font-size:1.5rem;margin:0 0 8px}h2{font-size:1.05rem;margin:20px 0 4px}a{color:#1D5C70}.alerte{background:#FFF4E5;border:1px solid #F0C27B;border-radius:8px;padding:10px 12px}</style></head>
<body><main><p><a href="/">← Comptoir</a></p><h1>${escHtml(titre)}</h1>${manque ? '<p class="alerte">Identité de l’exploitant à compléter avant l’ouverture au public (variables EXPLOITANT_NOM, EXPLOITANT_ADRESSE, EXPLOITANT_EMAIL).</p>' : ''}${blocs.map(([t, h]) => `<h2>${escHtml(t)}</h2><p>${h}</p>`).join('')}
<p><a href="/mentions-legales">Impressum</a> · <a href="/confidentialite">Protection des données</a> · <a href="/conditions">Conditions d’utilisation</a></p></main></body></html>`;
  };
  r.get('/mentions-legales', () => {
    const x = exploitant();
    return { html: pageLegale('Impressum', [
      ['Exploitant', [x.nom, x.ide ? `IDE ${x.ide}` : '', x.adresse].filter(Boolean).map(escHtml).join(', ') || '—'],
      ['Contact', x.email ? `<a href="mailto:${escHtml(x.email)}">${escHtml(x.email)}</a>` : '—'],
      ['Hébergement', escHtml(x.hebergeur || '—')],
      ['Boutiques', 'Chaque boutique hébergée sur Comptoir est exploitée par son marchand, qui est le vendeur et publie ses propres mentions légales et conditions de vente.']
    ]) };
  });
  r.get('/confidentialite', () => {
    const x = exploitant();
    return { html: pageLegale('Protection des données', [
      ['Responsable', `${escHtml(x.nom || 'L’exploitant de Comptoir')}${x.email ? `, <a href="mailto:${escHtml(x.email)}">${escHtml(x.email)}</a>` : ''}. Cadre : loi fédérale sur la protection des données (nLPD) et, pour les personnes dans l’Union européenne, RGPD.`],
      ['Données des marchands', 'E-mail, mot de passe (stocké chiffré, jamais en clair), informations de la boutique et de l’entreprise, abonnement. Elles servent à fournir le service et à le facturer.'],
      ['Données des acheteurs', 'Nom, adresse de livraison, e-mail et commande, traités pour le compte du marchand (Comptoir agit comme sous-traitant). Elles sont transmises au prestataire de paiement, au transporteur et, pour le dropshipping, au fournisseur concerné.'],
      ['Prestataires', 'Paiement : Stripe (cartes, TWINT). Envoi des e-mails : le service configuré par l’exploitant. Aucune donnée n’est vendue ni utilisée à des fins publicitaires.'],
      ['Mesure d’audience', 'Uniquement après l’accord de l’acheteur dans la boutique, sans cookie publicitaire, avec un identifiant limité à l’onglet.'],
      ['Durée et droits', 'Les données du marchand sont conservées pendant l’abonnement, puis 12 mois après sa fin (consultation et export restent possibles), et effacées ensuite, après un avertissement 30 jours avant ; une inscription jamais payée est effacée après 90 jours. Les pièces comptables appartiennent au marchand, qui les exporte et les conserve (10 ans en Suisse et en France). Vous pouvez demander l’accès, la rectification ou l’effacement de vos données par e-mail. Un compte peut être supprimé à tout moment depuis ses paramètres.']
    ]) };
  });
  r.get('/conditions', () => ({ html: pageLegale('Conditions d’utilisation', [
    ['Service', 'Comptoir fournit un logiciel pour créer et gérer une boutique en ligne. Le marchand vend en son nom : il est responsable de ses produits, de ses prix, de ses textes et du respect du droit applicable à ses ventes.'],
    ['Abonnement', `Formules ${['lancement', 'croissance', 'pro'].map(f => `${escHtml(Formules.FORMULES[f].nom)} (CHF ${Formules.FORMULES[f].prix}.– ou ${Formules.FORMULES[f].prix} € par mois)`).join(', ')}, payées par mois et par carte. ${env.EXPLOITANT_TVA ? `Prix hors TVA : la TVA de l’exploitant (n° ${escHtml(env.EXPLOITANT_TVA)}) s’y ajoute selon les règles de votre pays (autoliquidation pour les entreprises de l’Union européenne).` : 'Prix finaux : l’exploitant n’est pas assujetti à la TVA, aucune taxe ne s’ajoute.'} Aucune commission sur les ventes ; seuls les frais du prestataire de paiement s’appliquent.`],
    ['Résiliation', 'À tout moment, depuis les paramètres. L’accès reste ouvert jusqu’à la fin du mois payé. En cas d’échec de paiement, la boutique est mise en pause jusqu’à régularisation ; le prestataire de paiement retente le prélèvement automatiquement.'],
    ['Données', 'Le marchand peut exporter ses commandes et supprimer son compte à tout moment. Voir la page Protection des données.'],
    ['Simulations', 'Les chiffres de démonstration, de tendance et de prévision sont des estimations et ne constituent pas une promesse de résultat.']
  ]) }));
  r.get('/desinscription', ctx => {
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) return { html: pageSimple('Lien invalide', 'Ce lien de désinscription est incomplet ou a été modifié.') };
    const b = db.prepare('SELECT config FROM boutiques WHERE id = ?').get(d.boutiqueId);
    const nom = b ? JSON.parse(b.config).boutique.nom : 'cette boutique';
    if (estDesinscrit(d.boutiqueId, d.email)) return { html: pageSimple('Vous êtes déjà désinscrit', `${d.email} ne reçoit plus les nouvelles et offres de ${nom}.`) };
    return { html: pageSimple(`Ne plus recevoir les e-mails de ${nom}`, `Confirmez pour ${d.email}. Vous recevrez toujours les e-mails liés à vos commandes (confirmation, expédition).`, `<form method="post" action="/desinscription?j=${encodeURIComponent(ctx.query.get('j'))}"><button>Me désinscrire</button></form>`) };
  });
  db.exec('CREATE TABLE IF NOT EXISTS optins (jeton_hash TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, email TEXT NOT NULL, expire_le INTEGER NOT NULL, utilise INTEGER NOT NULL DEFAULT 0)');
  const lireOptin = j => { const o = db.prepare('SELECT * FROM optins WHERE jeton_hash = ? AND expire_le > ?').get(auth.sha256(String(j || '')), Date.now()); return o ? { boutiqueId: o.boutique_id, email: o.email, utilise: !!o.utilise } : null; };
  r.get('/reinscription', ctx => {
    const d = lireOptin(ctx.query.get('j'));
    if (!d) return { html: pageSimple('Lien invalide', 'Ce lien est incomplet ou a été modifié.') };
    return { html: pageSimple('Recevoir les nouvelles de la boutique', `Confirmez l’inscription de ${d.email}.`, `<form method="post" action="/reinscription?j=${encodeURIComponent(ctx.query.get('j'))}"><button>Confirmer mon inscription</button></form>`) };
  });
  r.post('/reinscription', ctx => {
    const d = lireOptin(ctx.query.get('j'));
    if (!d) throw erreur(400, 'Lien invalide ou expiré.', 'invalide');
    // Usage unique : un second clic confirme sans rien refaire (le marchand ne peut pas réinscrire quelqu'un avec un vieux lien).
    if (d.utilise) return { html: pageSimple('Déjà confirmé', `${d.email} est déjà inscrit.`) };
    db.prepare('UPDATE optins SET utilise = 1 WHERE jeton_hash = ?').run(auth.sha256(String(ctx.query.get('j') || '')));
    db.prepare('DELETE FROM desinscriptions WHERE boutique_id = ? AND email = ?').run(d.boutiqueId, d.email);
    const nouveau = db.prepare('INSERT OR IGNORE INTO abonnes (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(d.boutiqueId, d.email, Date.now()).changes > 0;
    const bq = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(d.boutiqueId);
    // Inscription confirmée : l'e-mail de bienvenue (et son code) part maintenant, une seule fois par adresse.
    if (nouveau && bq) relances.emailBienvenue({ db, boutique: bq, config: configVente(bq), email: d.email, urlPublique, urlBoutique: urlBoutique(bq), envoyerEmail });
    return { html: pageSimple('C’est fait', `${d.email} recevra désormais les nouvelles de cette boutique. Vous pourrez vous désinscrire à tout moment depuis chaque e-mail.`) };
  });
  r.post('/desinscription', ctx => {
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) throw erreur(400, 'Lien de désinscription invalide.', 'invalide');
    db.prepare('INSERT OR IGNORE INTO desinscriptions (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(d.boutiqueId, d.email, Date.now());
    db.prepare('DELETE FROM abonnes WHERE boutique_id = ? AND email = ?').run(d.boutiqueId, d.email);
    return { html: pageSimple('C’est fait', `${d.email} ne recevra plus d’e-mails commerciaux de cette boutique.`) };
  });

  /* ---------- Abonnement Comptoir ---------- */
  r.get('/api/abonnement', exigerCompte, ctx => ({ ...abo.etat(ctx.marchand.id), formules: abo.formulesPour(deviseDe(ctx.boutique)), devise: deviseDe(ctx.boutique) }));
  // Retour de Stripe Checkout : paiement vérifié tout de suite, sans attendre le webhook.
  r.post('/api/abonnement/verifier', exigerCompte, async ctx => {
    const { etat: e, devenuActif } = await abo.verifierRetour(ctx.marchand.id);
    if (devenuActif) emailAbonnement(ctx.marchand.id, 'active');   // le webhook arrivera après : c'est ici que l'abonnement devient actif
    return e;
  });
  r.post('/api/abonnement/commencer', exigerCompte, async ctx => {
    if (abo.prestataire === 'simulation' && env.NODE_ENV === 'production' && abo.obligatoire) throw erreur(503, 'Le paiement des abonnements n’est pas encore configuré (clé Stripe manquante).', 'paiement_non_configure');
    return abo.commencer({ marchand: ctx.marchand, formule: String(ctx.corps.formule || ''), devise: deviseDe(ctx.boutique) });
  });
  r.post('/api/abonnement/changer', exigerMarchand, ctx => abo.changer({ marchand: ctx.marchand, formule: String(ctx.corps.formule || '') }));
  r.post('/api/abonnement/resilier', exigerMarchand, async ctx => { const r2 = await abo.resilier({ marchand: ctx.marchand }); if (!r2.url) emailAbonnement(ctx.marchand.id, 'resiliation'); return r2; });
  r.post('/api/abonnement/reprendre', exigerMarchand, ctx => abo.reprendre({ marchand: ctx.marchand }));
  /* E-mails de Comptoir au marchand sur son abonnement (activation, paiement en échec, résiliation, fin). */
  function emailAbonnement(marchandId, evenement) {
    const m = db.prepare('SELECT email FROM marchands WHERE id = ?').get(marchandId);
    const b = db.prepare('SELECT * FROM boutiques WHERE marchand_id = ? ORDER BY cree_le LIMIT 1').get(marchandId);
    if (!m || !b) return;
    const e = abo.etat(marchandId), noms = { lancement: 'Lancement', croissance: 'Croissance', pro: 'Pro' };
    const montant = e.prix ? (e.devise === 'CHF' ? `CHF ${e.prix}.–` : `${e.prix} €`) : '';
    const fin = e.periodeFin ? new Date(e.periodeFin).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const nom = lireConfig(b).boutique.nom;
    const textes = {
      active: [`Votre boutique ${nom} est en ligne`, `Bonjour,\n\nVotre abonnement Comptoir ${noms[e.formule] || ''} (${montant} par mois) est actif. Votre boutique est ouverte aux clients : ${urlBoutique(b)}\n\nVotre espace : ${urlPublique}/app\nProchain renouvellement : ${fin}. Résiliable à tout moment dans Paramètres > Abonnement.\n\nL’équipe Comptoir`],
      impaye: [`Paiement de votre abonnement en échec`, `Bonjour,\n\nLe dernier paiement de votre abonnement Comptoir n’est pas passé. Stripe va réessayer dans les prochains jours. Sans paiement d’ici 7 jours, votre boutique ${nom} sera fermée aux clients ; vos données sont conservées.\n\nMettez à jour votre moyen de paiement : ${urlPublique}/app\n\nL’équipe Comptoir`],
      resiliation: [`Résiliation enregistrée`, `Bonjour,\n\nLa résiliation de votre abonnement Comptoir est enregistrée. Votre boutique ${nom} et votre espace restent ouverts jusqu’au ${fin}. Rien ne sera prélevé ensuite.\n\nVous changez d’avis ? Paramètres > Abonnement > Garder mon abonnement : ${urlPublique}/app\n\nL’équipe Comptoir`],
      termine: [`Votre abonnement est terminé`, `Bonjour,\n\nVotre abonnement Comptoir est terminé : la boutique ${nom} est fermée aux clients. Vos données restent consultables et exportables pendant 12 mois (Paramètres, export complet) ; reprenez un abonnement quand vous voulez : ${urlPublique}/app\n\nL’équipe Comptoir`]
    };
    const t = textes[evenement];
    if (t) envoyerEmail(null, m.email, t[0], t[1]);
  }
  const abonnementSimule = ref => {
    if (abo.prestataire !== 'simulation' || env.NODE_ENV === 'production') throw erreur(404, 'Page introuvable.', 'introuvable');
    const a = abo.parRefSimulation(ref);
    if (!a) throw erreur(404, 'Paiement introuvable ou déjà effectué.', 'introuvable');
    return a;
  };
  r.get('/abonnement-simule/:ref', ctx => { const a = abonnementSimule(ctx.params.ref); const m = db.prepare('SELECT email FROM marchands WHERE id = ?').get(a.marchand_id); return { html: abonnements.pageAbonnementSimule(a, m.email) }; });
  r.post('/abonnement-simule/:ref/confirmer', ctx => { abonnementSimule(ctx.params.ref); const m = abo.confirmerSimulation(ctx.params.ref); emailAbonnement(m, 'active'); return { redirection: `${urlPublique}/app?abonnement=ok` }; });
  r.post('/abonnement-simule/:ref/annuler', ctx => { abonnementSimule(ctx.params.ref); return { redirection: `${urlPublique}/app?abonnement=annule` }; });

  r.get('/paiement-simule/:id', ctx => { const { p, c, config } = chargerPaiementSimule(ctx.params.id); return { html: pageSimulation(p, c, config) }; });
  r.post('/paiement-simule/:id/confirmer', async ctx => {
    const { p, row } = chargerPaiementSimule(ctx.params.id);
    // Lien fermé (nouveau lien créé, ou commande annulée) : comme une session Stripe expirée, il ne peut plus être payé.
    if (p.statut === 'annule') return { redirection: `${urlBoutique(row)}?commande=${row.id}&jeton=${row.jeton_client}&annule=1` };
    await paiementConfirme(p.id, p.id);
    return { redirection: `${urlBoutique(row)}?commande=${row.id}&jeton=${row.jeton_client}` };
  });
  r.post('/paiement-simule/:id/annuler', ctx => {
    const { p, row } = chargerPaiementSimule(ctx.params.id);
    if (p.statut === 'cree') db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(p.id);
    return { redirection: `${urlBoutique(row)}?commande=${row.id}&jeton=${row.jeton_client}&annule=1` };
  });

  /* ---------- Faux fournisseur de démonstration ---------- */
  const exigerCleDemo = ctx => {
    const f = db.prepare("SELECT cle_api FROM fournisseurs WHERE code = 'demo'").get();
    if (!auth.egal(String(ctx.req.headers.authorization || ''), `Bearer ${f.cle_api}`)) throw erreur(401, 'Clé API invalide.', 'cle_api');
  };
  async function expedierDemo(ref) {
    const cmd = db.prepare('SELECT * FROM demo_fournisseur_commandes WHERE ref = ?').get(ref);
    if (!cmd || cmd.statut === 'expediee') return;
    const f = db.prepare("SELECT * FROM fournisseurs WHERE code = 'demo'").get();
    const corps = JSON.stringify({ ref, statut: 'expediee', transporteur: 'La Poste', suivi: '99.60.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7) });
    const rep = await fetchImpl(`${urlPublique}/api/webhooks/fournisseurs/demo`, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-Signature': fournisseurs.signer(corps, f.secret_webhook) }, body: corps });
    if (rep && rep.ok) db.prepare("UPDATE demo_fournisseur_commandes SET statut = 'expediee' WHERE ref = ?").run(ref);
    else if (rep && rep.status >= 400 && rep.status < 500) db.prepare("UPDATE demo_fournisseur_commandes SET statut = 'abandonnee' WHERE ref = ?").run(ref);   // commande inconnue (compte supprimé) : on arrête   // sinon : nouvel essai au prochain passage
  }
  r.get('/demo-fournisseur/catalogue', exigerCleDemo, () => fournisseurs.CATALOGUE_DEMO);
  r.post('/demo-fournisseur/commandes', exigerCleDemo, ctx => {
    const lignes = ctx.corps.lignes;
    if (!Array.isArray(lignes) || !lignes.length || lignes.some(l => !fournisseurs.CATALOGUE_DEMO.find(p => p.id === l.produitId))) throw erreur(400, 'Produit inconnu du fournisseur.', 'produit_inconnu');
    // Référence unique (un tirage à 6 chiffres finissait par se répéter après quelques milliers de commandes).
    // Même commande renvoyée (réponse perdue) : la même référence revient, rien n'est expédié deux fois.
    const cle = String(ctx.req.headers['idempotency-key'] || '').slice(0, 120);
    const deja = cle && db.prepare("SELECT ref, statut FROM demo_fournisseur_commandes WHERE json_extract(donnees, '$.referenceMarchand') = ?").get(cle);
    if (deja) return { statut: 201, corps: { ref: deja.ref, statut: deja.statut } };
    const ref = 'FO-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    db.prepare('INSERT INTO demo_fournisseur_commandes (ref, donnees, statut, cree_le) VALUES (?, ?, ?, ?)').run(ref, JSON.stringify(ctx.corps), 'recue', Date.now());
    if (delaiExpeditionDemo >= 0) setTimeout(() => expedierDemo(ref).catch(e => journal.error('[demo-fournisseur]', e.message)), delaiExpeditionDemo).unref();
    return { statut: 201, corps: { ref, statut: 'recue' } };
  });
  r.post('/demo-fournisseur/commandes/:ref/expedier', exigerCleDemo, async ctx => { await expedierDemo(ctx.params.ref); return { ok: true }; });

  /* ---------- Gestionnaire HTTP ---------- */
  async function gerer(req, res) {
    // En-têtes de sécurité sur toutes les réponses : aucun script étranger (tout est servi par Comptoir),
    // pas d'affichage dans un cadre d'un autre site (clickjacking), pas de devinette du type de fichier.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');   // une page ouverte depuis un autre site ne garde pas la main sur la nôtre
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    if (securise) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // HEAD : même réponse que GET, sans corps (Node l'omet de lui-même ; la réponse a déjà noté la méthode d'origine).
    if (req.method === 'HEAD') req.method = 'GET';
    const url = new URL(req.url, 'http://local');
    const chemin = url.pathname;
    try {
      // Domaine personnalisé : la boutique est servie à la racine de son propre domaine.
      const hote = String(req.headers.host || '').split(':')[0].toLowerCase();
      if (hote && hote !== hotePrincipal && req.method === 'GET' && (chemin === '/' || chemin === '/index.html' || /^\/p\/[\w-]+$/.test(chemin) || chemin === '/sitemap.xml' || chemin === '/robots.txt')) {
        const b = db.prepare("SELECT * FROM boutiques WHERE lower(json_extract(config, '$.boutique.domaine.domaine')) = ? AND json_extract(config, '$.boutique.domaine.actif') = 1").get(hote);
        if (b) {
          const racine = `https://${hote}/`;
          if (chemin === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(planDuSite(b, racine)); }
          if (chemin === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(`User-agent: *\nAllow: /\nAllow: /api/public/*/image/\nDisallow: /api/\nSitemap: ${racine}sitemap.xml\n`); }
          const pid = chemin.startsWith('/p/') ? decodeURIComponent(chemin.slice(3)) : null;
          return envoyerHtml(res, pid && !produitVisible(b, pid) ? 404 : 200, pageBoutique(b, { racine, produitId: pid }));
        }
      }
      const route = r.trouver(req.method, chemin);
      if (!route) {
        if (req.method === 'GET') {
          if (chemin === '/' && servirStatique(res, RACINE_FRONT, 'accueil.html')) return;
          if ((chemin === '/app' || chemin === '/demo') && servirStatique(res, RACINE_FRONT, 'index.html')) return;
          const mBoutique = /^\/s\/([\w-]+)(?:\/p\/([\w-]+))?\/?$/.exec(chemin);
          if (mBoutique) {
            const b = db.prepare('SELECT * FROM boutiques WHERE slug = ?').get(mBoutique[1]);
            // Produit absent, masqué ou retiré : vrai 404 (la page reste utilisable : elle montre la boutique).
            if (b) return envoyerHtml(res, mBoutique[2] && !produitVisible(b, mBoutique[2]) ? 404 : 200, pageBoutique(b, { racine: domaineDe(b) ? `https://${domaineDe(b)}/` : `${urlPublique}/s/${b.slug}/`, produitId: mBoutique[2] || null }));
          }
          const mPlan = /^\/s\/([\w-]+)\/sitemap\.xml$/.exec(chemin);
          if (mPlan) { const b = db.prepare('SELECT * FROM boutiques WHERE slug = ?').get(mPlan[1]); if (b) { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(planDuSite(b, `${urlPublique}/s/${b.slug}/`)); } }
          if (chemin === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('User-agent: *\nAllow: /\nAllow: /s/\nDisallow: /app\nDisallow: /demo\nAllow: /api/public/*/image/\nDisallow: /api/\nDisallow: /paiement-simule/\nDisallow: /abonnement-simule/\n'); }
          if (FICHIERS_PUBLICS.test(chemin) && servirStatique(res, RACINE_FRONT, chemin.slice(1))) return;
        }
        throw erreur(404, 'Page introuvable.', 'introuvable');
      }
      const ctx = { req, res, params: route.params, query: url.searchParams, cookies: lireCookies(req), entetes: {}, ip: reseauIp(ipClient(req)), corps: {}, corpsBrut: '' };
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        ctx.corpsBrut = (await lireCorps(req)).toString('utf8');
        const type = req.headers['content-type'] || '';
        if (chemin.startsWith('/api/') && !chemin.startsWith('/api/webhooks/')) {
          // JSON obligatoire : un formulaire d'un autre site ne peut pas envoyer ce type sans CORS (protection CSRF).
          if (ctx.corpsBrut && !type.startsWith('application/json')) throw erreur(415, 'Envoyez du JSON.', 'type_contenu');
          ctx.corps = ctx.corpsBrut ? JSON.parse(ctx.corpsBrut) : {};
          if (!ctx.corps || typeof ctx.corps !== 'object' || Array.isArray(ctx.corps)) throw erreur(400, 'Requête invalide : un objet JSON est attendu.', 'corps_invalide');
        } else if (type.startsWith('application/json') && ctx.corpsBrut) ctx.corps = JSON.parse(ctx.corpsBrut);
      }
      let resultat;
      for (const g of route.gestionnaires) resultat = await g(ctx);
      if (resultat && resultat.diffusion) return;   // flux SSE : la réponse reste ouverte
      if (resultat && resultat.binaire) { res.writeHead(200, { 'Content-Type': resultat.type, 'Cache-Control': 'public, max-age=3600', ...ctx.entetes }); res.end(resultat.binaire); return; }
      if (resultat && resultat.redirection) { res.writeHead(303, { Location: resultat.redirection, ...ctx.entetes }); res.end(); return; }
      if (resultat && resultat.html) return envoyerHtml(res, 200, resultat.html);
      if (resultat && resultat.statut && 'corps' in resultat) return envoyerJson(res, resultat.statut, resultat.corps, ctx.entetes);
      envoyerJson(res, 200, resultat ?? { ok: true }, ctx.entetes);
    } catch (e) {
      if (e instanceof SyntaxError) e = erreur(400, 'JSON invalide.', 'json_invalide');
      if (!(e instanceof ErreurHttp)) { journal.error('[erreur]', e); e = erreur(500, 'Erreur interne. Réessayez dans un instant.', 'interne'); }
      if (res.headersSent) return res.end();
      envoyerJson(res, e.statut, { erreur: e.message, code: e.code });
    }
  }
  gerer.publierEcheances = publierEcheances;
  gerer.automatisationsEcheances = automatisationsEcheances;
  gerer.rafraichirTendances = () => collecte.rafraichir();
  gerer.actualiserVentesTendances = () => collecte.actualiserVentes(0);
  gerer.envoyerEmails = () => courriel.envoyerFile(db, serviceEmail, { journal });
  gerer.envoyerWebhooks = () => integ.envoyerFile();
  return gerer;
}

function escHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { creerApp };
