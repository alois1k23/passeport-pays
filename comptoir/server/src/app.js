// Application Comptoir : routes de l'API, logique des commandes, paiements,
// transmission aux fournisseurs, e-mails, pages publiques.
'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
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
const FactureElectronique = require('./facture-electronique');
const FacturxPdf = require('./facturx-pdf');
const CartesCadeaux = require('./cartes-cadeaux');
const Devis = require('./devis');
const Fidelite = require('./fidelite');
const Retours = require('./retours-partiels');
const Pii = require('./pii');
const Emplacements = require('./emplacements');
const JournalInalterable = require('./journal-inalterable');
const WebPush = require('./webpush');
const { AsyncLocalStorage } = require('node:async_hooks');
// Auteur de la requête en cours (membre de l'équipe) : l'historique des commandes porte son nom.
const requeteCourante = new AsyncLocalStorage();
const { creerRouteur, lireCorps, lireCookies, envoyerJson, envoyerHtml, servirStatique, erreur, ErreurHttp, valider } = require('./http');
const auth = require('./auth');
const totp = require('./totp');
const { transaction } = require('./db');
const prix = require('./prix');
const { choisirPrestataire, etatDepuisCompte, sessionConforme } = require('./paiements');
const fournisseurs = require('./fournisseurs');
const social = require('./social');
const relances = require('./relances');
const Remises = require('../../js/remises.js');
const PrixBarres = require('../../js/prix-barres.js');
const QrFacture = require('../../js/qrfacture.js');
const { creerIntegrations } = require('./integrations');
const courriel = require('./courriel');

const RACINE_FRONT = path.resolve(__dirname, '..', '..');
const FICHIERS_PUBLICS = /^\/(index\.html|boutique\.html|accueil\.html|css\/[\w.-]+\.css|js\/(vendor\/)?[\w.-]+\.js|img\/[\w.-]+\.(jpg|png|svg)|fonts\/[\w.-]+\.woff2|docs\/API\.md|app\.webmanifest|sw\.js)$/;
const POLICES = ["'Fraunces', Georgia, serif", "'DM Serif Display', Georgia, serif", "'Syne', system-ui, sans-serif", "'Bricolage Grotesque', system-ui, sans-serif", "'Outfit', system-ui, sans-serif", "'IBM Plex Sans', system-ui, sans-serif"];
const COULEUR = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function creerApp({ db, env = {}, urlPublique, fetchImpl = fetch, journal = console }) {
  const r = creerRouteur();
  const securise = urlPublique.startsWith('https://');
  /* Feuilles de style des pages produites par le serveur : constantes, autorisées une à une par leur empreinte dans la
     politique de sécurité (aucun style en ligne accepté sinon). */
  const empreintesStyles = new Set();
  const feuille = css => { empreintesStyles.add(`'sha256-${crypto.createHash('sha256').update(css).digest('base64')}'`); return `<style>${css}</style>`; };
  feuille(require('./abonnements').STYLE_PAGE_ABONNEMENT);   // page de paiement simulé de l'abonnement (feuille constante)
  // Pages statiques (accueil, boutique) : leur bloc <style> est autorisé par son empreinte, lue au démarrage.
  for (const f of ['accueil.html', 'boutique.html', 'index.html']) {
    try { for (const m of fs.readFileSync(path.join(RACINE_FRONT, f), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) feuille(m[1]); } catch { /* fichier absent */ }
  }
  const FEUILLE_1 = feuille(`body{margin:0;background:#eee;font:10pt/1.45 Helvetica,Arial,sans-serif;color:#111}.page{background:#fff;width:210mm;min-height:297mm;margin:12px auto;box-sizing:border-box;position:relative;padding:18mm 18mm 112mm}
h1{font-size:16pt;margin:10mm 0 2mm}table{width:100%;border-collapse:collapse;margin:6mm 0}td,th{padding:2mm 1mm;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right;white-space:nowrap}.tot td{font-weight:700;border:0}
.haut{display:flex;justify-content:space-between;gap:10mm}.bas{position:absolute;left:0;bottom:0}.imp{position:fixed;top:8px;right:12px;margin:0;background:#fff;padding:6px 10px;border-radius:6px;font-size:9pt}
@media print{body{background:#fff}.page{margin:0;box-shadow:none}.imp{display:none}@page{size:A4;margin:0}}${QrFacture.CSS}`);
  const FEUILLE_2 = feuille(`.tab-console{border-collapse:collapse;width:100%;margin-top:12px}.tab-console td{padding:8px;border-bottom:1px solid #ddd;color:#555}.tab-console td.d{text-align:right;color:inherit}.tab-console tr.alerte td{color:#b42318;background:#fff4f2}.tab-console td.d span{font-weight:400;font-size:.875em}*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;background:#F3F4F7;color:#151821;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:1px solid #E0E3EA;border-radius:12px;padding:28px;max-width:420px;width:100%;display:grid;gap:14px}h1{font-size:1.3rem;margin:0}.total{font-size:1.8rem;font-weight:700}button{font:inherit;font-weight:600;padding:12px;border-radius:8px;border:1px solid #151821;width:100%;cursor:pointer}.payer{background:#151821;color:#fff}.annuler{background:#fff}.note{color:#5B6372;font-size:.85rem}`);
  const FEUILLE_3 = feuille(`.tab-console{border-collapse:collapse;width:100%;margin-top:12px}.tab-console td{padding:8px;border-bottom:1px solid #ddd;color:#555}.tab-console td.d{text-align:right;color:inherit}.tab-console tr.alerte td{color:#b42318;background:#fff4f2}.tab-console td.d span{font-weight:400;font-size:.875em}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#F4F5F7;color:#151821;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{background:#fff;border:1px solid #E0E3EA;border-radius:14px;padding:28px;max-width:440px;display:grid;gap:12px}h1{font-size:1.2rem;margin:0}button{font:inherit;padding:11px 16px;border-radius:9px;border:1px solid #151821;background:#151821;color:#fff;font-weight:600;cursor:pointer}`);
  const FEUILLE_4 = feuille(`.tab-console{border-collapse:collapse;width:100%;margin-top:12px}.tab-console td{padding:8px;border-bottom:1px solid #ddd;color:#555}.tab-console td.d{text-align:right;color:inherit}.tab-console tr.alerte td{color:#b42318;background:#fff4f2}.tab-console td.d span{font-weight:400;font-size:.875em}body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#F4F5F7;color:#151821;padding:16px}main{background:#fff;border:1px solid #E0E3EA;border-radius:14px;padding:24px;max-width:720px;margin:24px auto}h1{font-size:1.5rem;margin:0 0 8px}h2{font-size:1.05rem;margin:20px 0 4px}a{color:#1D5C70}.alerte{background:#FFF4E5;border:1px solid #F0C27B;border-radius:8px;padding:10px 12px}`);
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
  const originePublique = new URL(urlPublique).origin;
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
  db.exec(`CREATE TABLE IF NOT EXISTS equipe (marchand_id TEXT PRIMARY KEY REFERENCES marchands(id) ON DELETE CASCADE, boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, role TEXT NOT NULL, cree_le INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, jeton_hash TEXT NOT NULL UNIQUE, boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, email TEXT NOT NULL, role TEXT NOT NULL, expire_le INTEGER NOT NULL, cree_le INTEGER NOT NULL);`);
  // Boutique d'un compte : celle qu'il possède, sinon celle dont il est membre de l'équipe (avec son rôle).
  const accesDe = marchandId => {
    const b = db.prepare('SELECT * FROM boutiques WHERE marchand_id = ? ORDER BY cree_le LIMIT 1').get(marchandId);
    if (b) return { boutique: b, role: 'proprietaire' };
    const e = db.prepare('SELECT b.*, e.role AS role_equipe FROM equipe e JOIN boutiques b ON b.id = e.boutique_id WHERE e.marchand_id = ?').get(marchandId);
    if (e) { const { role_equipe, ...boutique } = e; return { boutique, role: role_equipe }; }
    return null;
  };
  const boutiqueDuMarchand = marchandId => {
    const a = accesDe(marchandId);
    if (!a) throw erreur(404, 'Aucune boutique pour ce compte.', 'sans_boutique');
    return a.boutique;
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
  /* Données personnelles des clients chiffrées au repos (pii.js) : déchiffrées à la lecture, chiffrées à l'écriture,
     et un index aveugle de l'e-mail (colonne email_index) pour retrouver les commandes d'un client. */
  let PII = null;
  let illisiblesSignales = 0;
  const signalerIllisible = () => { if (illisiblesSignales++ < 5) journal.error('[donnees-clients] donnée client illisible (falsifiée, ou clé SECRET_CHIFFREMENT changée sans l’ancienne)'); };
  // Ligne : { id, boutique_id, donnees } (le chiffré est lié à sa boutique et à sa commande).
  const lireDonneesCommande = row => { const d = JSON.parse(row.donnees); return PII ? PII.depuisStockage(d, { boutique: row.boutique_id, commande: row.id }, { signaler: signalerIllisible }) : d; };
  const stockerDonneesCommande = (donnees, boutiqueId, id) => JSON.stringify(PII ? PII.versStockage(donnees, { boutique: boutiqueId, commande: id }) : donnees);
  const indexEmail = (donnees, boutiqueId) => PII && donnees && donnees.client && !donnees.client.illisible ? PII.index(boutiqueId, donnees.client.email) : undefined;
  const insererCommande = (id, boutiqueId, numero, date, statut, jeton, donnees) =>
    db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees, email_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, boutiqueId, numero, date, statut, jeton, stockerDonneesCommande(donnees, boutiqueId, id), indexEmail(donnees, boutiqueId) ?? null);
  const lireCommande = row => row && ({ ...lireDonneesCommande(row), id: row.id, numero: row.numero, date: row.date, statut: row.statut });
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
  const integ = creerIntegrations({ db, env, journal, permis: apiPermise, chiffrement: () => PII });
  // Date de dernière modification des commandes (synchronisation incrémentale par l'API).
  try { db.exec('ALTER TABLE commandes ADD COLUMN maj_le INTEGER'); } catch { /* déjà là */ }
  db.exec('CREATE INDEX IF NOT EXISTS commandes_maj ON commandes(boutique_id, maj_le)');
  // Commandes par statut (en attente surtout : stock réservé, plafond d'impayées) : sans cet index, chaque nouvelle commande
  // parcourait toutes les commandes des 90 derniers jours (coût qui croissait avec l'historique de la boutique).
  db.exec('CREATE INDEX IF NOT EXISTS commandes_statut ON commandes(boutique_id, statut, date)');
  // Commande telle qu'envoyée aux intégrations du marchand (API, webhooks) : pas de jeton, pas de coûts internes.
  const commandeApi = (c, devise, { client = true } = {}) => ({ id: c.id, numero: c.numero, date: new Date(c.date).toISOString(), statut: c.statut, total: c.total, sousTotal: c.sousTotal, remise: c.remise || 0, port: c.port || 0, devise,
    livraison: c.livraison, canal: c.canal || 'web', moyen: c.moyen || 'en_ligne', facture: c.facture || null, suivi: c.suivi || null, transporteur: c.transporteur || null,
    // Données personnelles du client : seulement avec la permission clients:lecture (sinon le pays de livraison suffit).
    client: !c.client ? null : client ? { nom: c.client.nom, email: c.client.email, adresse: c.client.adresse, npa: c.client.npa, ville: c.client.ville, pays: c.client.pays || null } : { pays: c.client.pays || null },
    ...(() => {
      // Avoirs émis (partiels, gestes, final ou annulation) et argent réellement rendu : de quoi rapprocher la comptabilité.
      // Une facture QR annulée avant paiement a un avoir « annulation » mais rien de remboursé.
      const d = Retours.deja(c), paye = !!(c.payeLe || c.payeManuelLe);
      const final = c.avoir && c.avoir.numero ? Math.round(Number(c.avoir.montant ?? c.total) * 100) : 0;
      return { lignes: (c.lignes || []).map((l, i) => ({ produitId: l.produitId, ...(l.varianteId ? { varianteId: l.varianteId } : {}), nom: l.nom, qte: l.qte, prix: l.prix, type: l.type || 'stock', rendu: d.qte[i] || 0 })),
        avoirs: avoirsApi(c, paye), rembourse: (d.total + (paye ? final : 0)) / 100 };
    })() });
  const avoirsApi = (c, paye) => [
    ...(c.retoursPartiels || []).filter(p => p.numero).map(p => ({ numero: p.numero, date: new Date(p.date).toISOString(), type: p.geste ? 'geste' : 'partiel', montant: p.montant / 100,
      livraison: (p.port || 0) / 100, lignes: p.geste ? [] : p.lignes.map(x => ({ nom: (c.lignes[x.index] || {}).nom, qte: x.qte, montant: x.montant / 100 })) })),
    ...(c.avoir && c.avoir.numero ? [{ numero: c.avoir.numero, date: new Date(c.avoir.date).toISOString(), type: paye ? 'final' : 'annulation', montant: Number(c.avoir.montant ?? c.total), livraison: null, lignes: null }] : [])];
  /* Journal inaltérable : chaque facture, ticket ou avoir est scellé dès qu'il existe (une seule fois). */
  // Clé de signature dérivée de la clé de chiffrement du serveur (SECRET_CHIFFREMENT) : créé à la première utilisation.
  let journalVentes = null;
  const JV = () => journalVentes || (journalVentes = JournalInalterable.creer(db, trousseau.map(k => sousCle(k, 'comptoir journal inalterable'))));
  const sceller = (boutiqueId, c) => {
    try { const r = JV().sceller(boutiqueId, c); if (r.conflits.length) journal.error('[journal-inalterable] second numéro refusé', c.id, r.conflits.join(', ')); }
    catch (e) { journal.error('[journal-inalterable]', c.id, e.message); }   // une pièce non scellée est signalée à la vérification et reprise au démarrage
  };
  const enregistrerCommande = c => {
    const { id, numero, date, statut, ...donnees } = c;
    const avant = db.prepare('SELECT statut, boutique_id FROM commandes WHERE id = ?').get(id);
    const ix = avant ? indexEmail(donnees, avant.boutique_id) : undefined;
    if (avant && ix !== undefined) db.prepare('UPDATE commandes SET statut = ?, donnees = ?, email_index = ?, maj_le = ? WHERE id = ?').run(statut, stockerDonneesCommande(donnees, avant.boutique_id, id), ix, Date.now(), id);
    else db.prepare('UPDATE commandes SET statut = ?, donnees = ?, maj_le = ? WHERE id = ?').run(statut, stockerDonneesCommande(donnees, avant ? avant.boutique_id : '', id), Date.now(), id);   // client illisible : index gardé
    if ((donnees.facture || donnees.avoir) && avant) sceller(avant.boutique_id, c);
    // Changement de statut : les webhooks du marchand sont prévenus (commande.payee, .expediee, .remboursee…).
    if (avant && avant.statut !== statut) {
      try { const b = db.prepare('SELECT config FROM boutiques WHERE id = ?').get(avant.boutique_id); integ.emettre(avant.boutique_id, `commande.${statut}`, commandeApi({ ...c }, (JSON.parse(b.config).boutique || {}).devise || 'CHF')); }
      catch (e) { journal.error('[webhook]', e.message); }
    }
  };
  const historique = (c, texte) => { const r0 = requeteCourante.getStore(); c.historique.push({ date: Date.now(), texte: r0 && r0.auteur ? `${texte} (par ${r0.auteur})` : texte }); };
  // Factures et avoirs partagent une seule suite de numéros, continue et sans trou.
  const prochaineFacture = (boutiqueId, date, prefixe = 'FA') => {
    const b = db.prepare('UPDATE boutiques SET compteur_facture = compteur_facture + 1 WHERE id = ? RETURNING compteur_facture').get(boutiqueId);
    return `${prefixe}-${new Date(date).getFullYear()}-${String(b.compteur_facture).padStart(4, '0')}`;
  };
  /* Stock sur plusieurs emplacements : chaque mouvement du total (vente, retour) est réparti ; canal 'magasin' (caisse)
     prend d'abord dans les magasins, la vente en ligne d'abord dans les entrepôts. */
  const EMP = Emplacements.creer(db);
  const reconcilierProduit = (boutiqueId, id) => { const r = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ?').get(id, boutiqueId); if (r) EMP.reconcilier(boutiqueId, { ...JSON.parse(r.donnees), id }); };
  // Canal de prélèvement : retrait en boutique (click & collect) ou caisse → magasin d'abord ; sinon entrepôt d'abord.
  const canalStock = c => c.canal === 'magasin' || c.livraison === 'retrait' ? 'magasin' : 'web';
  const ajusterStock = (boutiqueId, lignes, sens, canal = 'web') => {
    const emplacements = EMP.actif(boutiqueId);
    for (const l of lignes) {
      if (l.type === 'drop') continue;
      const p = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ?').get(l.produitId, boutiqueId);
      if (!p) continue;
      const d = JSON.parse(p.donnees);
      // Variante : son stock bouge, et le stock du produit reste la somme des variantes.
      const v = l.varianteId && Array.isArray(d.variantes) ? d.variantes.find(x => x.id === l.varianteId) : null;
      if (l.varianteId && Array.isArray(d.variantes) && !v) { if (sens < 0) l.retireStock = 0; continue; }   // variante supprimée depuis : rien à rendre ni à retirer, la somme reste juste
      if (v) {
        if (sens < 0) { const retire = Math.min(l.qte, Math.max(0, v.stock || 0)); l.retireStock = retire; v.stock = (v.stock || 0) - retire; if (emplacements) l.emplacements = EMP.retirer(boutiqueId, l.produitId, v.id, retire, { canal }); }
        else { const remis = typeof l.retireStock === 'number' ? l.retireStock : l.qte; v.stock = (v.stock || 0) + remis; l.retireStock = 0; if (emplacements) { l.emplacementsRepris = EMP.remettre(boutiqueId, l.produitId, v.id, remis, l.emplacements); delete l.emplacements; } }
        const avantTotal = d.stock || 0;
        d.stock = d.variantes.reduce((a, x) => a + (x.stock || 0), 0);
        if (sens < 0 && avantTotal > 0 && d.stock <= 0) integ.emettre(boutiqueId, 'produit.rupture', { id: l.produitId, nom: d.nom, stock: 0 });
        db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(JSON.stringify(d), l.produitId);
        continue;
      }
      // Stock jamais négatif : on note sur la ligne ce qui a vraiment été retiré, et seul ce nombre revient en cas
      // d'annulation ou de remboursement (sinon une commande vendue en rupture recréerait du stock fantôme).
      if (sens < 0) {
        const retire = Math.min(l.qte, Math.max(0, d.stock || 0)); l.retireStock = retire; d.stock = (d.stock || 0) - retire;
        if (emplacements) l.emplacements = EMP.retirer(boutiqueId, l.produitId, '', retire, { canal });
        if (retire > 0 && d.stock <= 0 && d.type !== 'drop') integ.emettre(boutiqueId, 'produit.rupture', { id: l.produitId, nom: d.nom, stock: 0 });   // passage à zéro (vente en ligne, caisse, paiement manuel)
      }
      else { const remis = typeof l.retireStock === 'number' ? l.retireStock : l.qte; d.stock = (d.stock || 0) + remis; l.retireStock = 0; if (emplacements) { l.emplacementsRepris = EMP.remettre(boutiqueId, l.produitId, '', remis, l.emplacements); delete l.emplacements; } }
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
  /* Appareil connu : jeton aléatoire propre à chaque appareil (cookie), dont seule l'empreinte est en base. Révocable : il
     disparaît à l'activation de la double authentification, avec « déconnecter les autres appareils », au changement ou à
     la réinitialisation du mot de passe. Il évite au marchand d'être bloqué chez lui par quelqu'un qui essaie son compte
     ailleurs, sans jamais lever les limites : il a seulement ses propres compteurs. Lié à la dernière session ouverte
     depuis cet appareil : révoquer cette session révoque aussi l'appareil. */
  db.exec('CREATE TABLE IF NOT EXISTS appareils_connus (empreinte TEXT PRIMARY KEY, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, cree_le INTEGER NOT NULL, vu_le INTEGER NOT NULL)');
  db.exec('CREATE INDEX IF NOT EXISTS appareils_connus_marchand ON appareils_connus (marchand_id)');
  if (!db.prepare('PRAGMA table_info(appareils_connus)').all().some(c => c.name === 'session')) db.exec('ALTER TABLE appareils_connus ADD COLUMN session TEXT');
  const appareilDe = ctx => {
    const j = String(ctx.cookies.comptoir_appareil || '');
    if (!/^[\w-]{30,64}$/.test(j)) return null;
    const r = db.prepare('SELECT * FROM appareils_connus WHERE empreinte = ?').get(auth.sha256(j));
    return r && r.vu_le > Date.now() - 365 * 86400000 ? r : null;
  };
  const appareilConnuPour = (ctx, marchandId) => { const a = appareilDe(ctx); return a && a.marchand_id === marchandId ? a : null; };
  const oublierAppareils = (marchandId, sauf = null) => db.prepare('DELETE FROM appareils_connus WHERE marchand_id = ? AND empreinte <> ?').run(marchandId, sauf || '');
  /* ---------- Sécurité du compte : double authentification, appareils, journal d'activité ---------- */
  if (!db.prepare("SELECT 1 FROM cles WHERE nom = 'chiffrement'").get()) db.prepare("INSERT INTO cles (nom, valeur) VALUES ('chiffrement', ?)").run(crypto.randomBytes(32).toString('hex'));
  // Clé de chiffrement des secrets (TOTP) : SECRET_CHIFFREMENT (64 caractères hexadécimaux) si l'exploitant la garde hors de la base.
  const cleChiffrement = Buffer.from(/^[0-9a-f]{64}$/i.test(env.SECRET_CHIFFREMENT || '') ? env.SECRET_CHIFFREMENT : db.prepare("SELECT valeur FROM cles WHERE nom = 'chiffrement'").get().valeur, 'hex');
  /* Trousseau : la clé courante chiffre et signe ; les anciennes déchiffrent et vérifient encore. Anciennes clés :
     SECRET_CHIFFREMENT_ANCIENNES (rotation : la clé remplacée y passe) et la clé gardée dans la base (avant que
     SECRET_CHIFFREMENT soit défini). Au démarrage, tout ce qui peut l'être est rechiffré avec la courante (données des
     clients, devis, webhooks en attente, secrets de double authentification) ; les empreintes des cartes cadeaux et de la
     fidélité, qu'on ne peut pas recalculer sans le code ou l'adresse, sont refaites à leur première utilisation. Le
     journal inaltérable garde ses signatures : ses anciennes clés restent nécessaires pour le vérifier. */
  const cleBase = Buffer.from(db.prepare("SELECT valeur FROM cles WHERE nom = 'chiffrement'").get().valeur, 'hex');
  const anciennesSaisies = String(env.SECRET_CHIFFREMENT_ANCIENNES || '').split(',').map(x => x.trim()).filter(Boolean);
  if (anciennesSaisies.some(x => !/^[0-9a-f]{64}$/i.test(x))) journal.error('[securite] SECRET_CHIFFREMENT_ANCIENNES : chaque clé doit faire 64 caractères hexadécimaux (séparées par des virgules) ; les autres sont ignorées.');
  const trousseau = [];
  for (const k of [cleChiffrement, ...anciennesSaisies.filter(x => /^[0-9a-f]{64}$/i.test(x)).map(x => Buffer.from(x, 'hex')), cleBase]) if (!trousseau.some(t => t.equals(k))) trousseau.push(k);
  // Sous-clés dédiées (HKDF) : chaque usage a la sienne, dérivée de chaque clé du trousseau.
  const sousCle = (k, etiquette) => Buffer.from(crypto.hkdfSync('sha256', k, Buffer.alloc(0), etiquette, 32));
  // Constats du démarrage, montrés dans la console de l'exploitant (données illisibles avec les clés connues).
  const etatSecurite = { commandesIllisibles: 0, secrets2faIllisibles: 0, cleHorsBase: !cleChiffrement.equals(cleBase), anciennesCles: trousseau.length - 1 - (cleBase.equals(cleChiffrement) ? 0 : 1) };
  const Cartes = CartesCadeaux.creer(db, trousseau.map(k => sousCle(k, 'comptoir:cartes-cadeaux')));
  const DV = Devis.creer(db, () => PII);
  const FID = Fidelite.creer(db, trousseau.map(k => sousCle(k, 'comptoir:fidelite')));   // fidélité : empreinte HMAC, jamais en clair
  PII = Pii.creer(trousseau);
  // Secrets de double authentification : déchiffrés avec la première clé du trousseau qui convient.
  const dechiffrerSecret2fa = enveloppe => { for (const k of trousseau) { try { return { secret: totp.dechiffrer(k, enveloppe), ancien: !k.equals(cleChiffrement) }; } catch { /* clé suivante */ } } throw new Error('secret de double authentification illisible'); };
  try { db.exec('ALTER TABLE commandes ADD COLUMN email_index TEXT'); } catch { /* déjà là */ }
  // Index du client avec la date : la dernière commande d'un client (liste des clients de l'API) sans parcourir la boutique.
  // Il remplace l'ancien index (boutique, client), dont il couvre aussi les recherches.
  db.exec('CREATE INDEX IF NOT EXISTS commandes_client_date ON commandes (boutique_id, email_index, date)');
  db.exec('DROP INDEX IF EXISTS commandes_email_index');
  // Utilisations d'un code promo (comptées à chaque commande qui en porte un, dans la transaction) : sans parcourir toute la boutique.
  // Colonne calculée (virtuelle, rien de stocké en double) : tolère une ligne au JSON abîmé, que l'index n'accepterait pas.
  if (!db.prepare('PRAGMA table_xinfo(commandes)').all().some(c => c.name === 'code_promo')) db.exec("ALTER TABLE commandes ADD COLUMN code_promo TEXT GENERATED ALWAYS AS (CASE WHEN json_valid(donnees) THEN json_extract(donnees, '$.codePromo') END) VIRTUAL");
  db.exec('CREATE INDEX IF NOT EXISTS commandes_code_promo ON commandes (boutique_id, code_promo) WHERE code_promo IS NOT NULL');
  // Adresses e-mail enregistrées avant la normalisation Unicode (NFC) : remises sous leur forme unique, pour que connexion
  // et désinscriptions continuent de les trouver (cas rares : adresses avec accents saisies sous forme décomposée).
  for (const [table, cle] of [['marchands', 'id'], ['desinscriptions', 'rowid'], ['invitations', 'id']]) {
    try {
      for (const r of db.prepare(`SELECT ${cle} AS k, email FROM ${table}`).all()) {
        const n = String(r.email || '').normalize('NFC');
        if (n !== r.email) db.prepare(`UPDATE OR IGNORE ${table} SET email = ? WHERE ${cle} = ?`).run(n, r.k);
      }
    } catch (e) { journal.error('[nfc]', table, e.message); }
  }
  /* Mise à niveau au démarrage, par pages (rowid), une transaction par page, ligne par ligne (une ligne abîmée est
     comptée et laissée telle quelle, sans bloquer le démarrage) :
     - commandes en clair (avant le chiffrement, ou importées) : chiffrées et indexées ;
     - si la clé courante a changé depuis le dernier passage (repère dans « cles ») : tout est rechiffré et réindexé. */
  {
    const repere = db.prepare("SELECT valeur FROM cles WHERE nom = 'pii-cle'").get();
    const complet = !repere || repere.valeur !== PII.empreinteCle;
    db.exec('PRAGMA secure_delete = ON');   // pendant la mise à niveau : les pages libérées (anciennes données en clair) sont remises à zéro
    const lire = db.prepare(`SELECT rowid, id, boutique_id, donnees FROM commandes WHERE rowid > ? ${complet ? '' : "AND (CASE WHEN json_valid(donnees) THEN json_extract(donnees, '$.client') END) IS NOT NULL"} ORDER BY rowid LIMIT 1000`);
    const ecrire = db.prepare('UPDATE commandes SET donnees = ?, email_index = ? WHERE rowid = ?');
    let dernier = 0, faits = 0, illisibles = 0, abimees = 0;
    for (;;) {
      const lot = lire.all(dernier); if (!lot.length) break;
      dernier = lot[lot.length - 1].rowid;
      transaction(db, () => {
        for (const r of lot) {
          let d; try { d = JSON.parse(r.donnees); } catch { abimees++; continue; }
          const ctx = { boutique: r.boutique_id, commande: r.id };
          if (d.clientChiffre) { try { if (!PII.aRenouveler(d.clientChiffre, ctx) && !complet) continue; } catch { illisibles++; continue; } d = PII.depuisStockage(d, ctx); }
          else if (!('client' in d)) continue;
          ecrire.run(stockerDonneesCommande(d, r.boutique_id, r.id), indexEmail(d, r.boutique_id) ?? null, r.rowid); faits++;
        }
      });
    }
    db.exec('PRAGMA secure_delete = OFF');
    // Repère posé seulement si tout a pu être relu : une commande illisible (ancienne clé oubliée dans
    // SECRET_CHIFFREMENT_ANCIENNES) sera rechiffrée et réindexée au prochain démarrage, une fois la clé remise.
    if (!illisibles) db.prepare("INSERT INTO cles (nom, valeur) VALUES ('pii-cle', ?) ON CONFLICT (nom) DO UPDATE SET valeur = excluded.valeur").run(PII.empreinteCle);
    if (faits) {
      journal.log(`[donnees-clients] ${faits} commande(s) chiffrée(s) ou rechiffrée(s)`);
      // Anciennes pages en clair effacées du fichier (SQLite réutilise les pages libérées sans les remettre à zéro).
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { journal.error('[donnees-clients] compactage', e.message); }
    }
    try { const n = DV.chiffrerAnciens() + integ.chiffrerFile() + integ.chiffrerSecrets(); if (n) journal.log(`[donnees-clients] ${n} devis ou envoi(s) de webhook chiffré(s)`); } catch (e) { journal.error('[donnees-clients] devis et webhooks', e.message); }
    if (trousseau.length > 1) try { const n = DV.renouvelerCle() + integ.renouvelerCleFile(); if (n) journal.log(`[donnees-clients] ${n} devis ou envoi(s) de webhook rechiffré(s) avec la clé courante`); } catch (e) { journal.error('[donnees-clients] rotation devis et webhooks', e.message); }
    etatSecurite.commandesIllisibles = illisibles;
    if (illisibles) journal.error(`[donnees-clients] ATTENTION : ${illisibles} commande(s) dont les données client sont illisibles avec les clés connues. SECRET_CHIFFREMENT a-t-il changé ? Remettez l'ancienne valeur.`);
    if (abimees) journal.error(`[donnees-clients] ${abimees} commande(s) aux données illisibles (JSON abîmé), laissées telles quelles`);
  }
  auth.persisterLimites(db, cleChiffrement);   // compteurs anti-abus rechargés (empreintes HMAC) : un redémarrage ne les remet pas à zéro
  db.exec(`CREATE TABLE IF NOT EXISTS deux_facteurs (marchand_id TEXT PRIMARY KEY REFERENCES marchands(id) ON DELETE CASCADE, secret TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 0, dernier_pas INTEGER NOT NULL DEFAULT -1, secours TEXT NOT NULL DEFAULT '[]', cree_le INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS journal_compte (id INTEGER PRIMARY KEY AUTOINCREMENT, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, date INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT, reseau TEXT);
    CREATE INDEX IF NOT EXISTS journal_compte_marchand ON journal_compte(marchand_id, date);`);
  // Rotation de clé : secrets de double authentification chiffrés avec une ancienne clé, rechiffrés avec la courante.
  // Un secret illisible avec toutes les clés connues est signalé (le marchand passera par ses codes de secours).
  {   // à chaque démarrage : aussi quand la clé a été retirée (secrets d'une clé disparue comptés, jamais écrasés)
    let n = 0, illisibles = 0;
    for (const r of db.prepare('SELECT marchand_id, secret FROM deux_facteurs').all()) {
      let lu; try { lu = dechiffrerSecret2fa(r.secret); } catch { illisibles++; continue; }
      if (lu.ancien) { db.prepare('UPDATE deux_facteurs SET secret = ? WHERE marchand_id = ? AND secret = ?').run(totp.chiffrer(cleChiffrement, lu.secret), r.marchand_id, r.secret); n++; }
    }
    if (n) journal.log(`[securite] ${n} secret(s) de double authentification rechiffré(s) avec la clé courante`);
    etatSecurite.secrets2faIllisibles = illisibles;
    if (illisibles) journal.error(`[securite] ATTENTION : ${illisibles} secret(s) de double authentification illisible(s) avec les clés connues. Une ancienne clé manque-t-elle dans SECRET_CHIFFREMENT_ANCIENNES ?`);
  }
  for (const sql of ['ALTER TABLE sessions ADD COLUMN cree_le INTEGER', 'ALTER TABLE sessions ADD COLUMN vu_le INTEGER', 'ALTER TABLE sessions ADD COLUMN appareil TEXT', 'ALTER TABLE sessions ADD COLUMN reseau TEXT', 'ALTER TABLE sessions ADD COLUMN cle_acces TEXT', 'ALTER TABLE sessions ADD COLUMN identite_le INTEGER']) { try { db.exec(sql); } catch { /* déjà là */ } }
  // Sessions d'avant la durée de vie absolue : elle court à partir d'aujourd'hui (pas de déconnexion surprise).
  // (créée « il y a un peu plus de 15 minutes » : elle ne compte pas comme une identité confirmée récemment).
  db.prepare('UPDATE sessions SET cree_le = ? WHERE cree_le IS NULL').run(Date.now() - 16 * 60000);
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
    ctx.entetes['Set-Cookie'] = [auth.cookieSession(jeton, securise), cookieAppareilPour(ctx, m.id, auth.sha256(jeton))];
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
  /* Chaque code ne sert qu'une fois, même envoyé deux fois en même temps : l'état est relu en base, et la consommation est
     conditionnelle (le pas TOTP doit être plus récent que le dernier accepté, la liste des codes de secours inchangée). */
  function verifierSecondFacteur(dfAncien, saisi, ctx) {
    const df = deuxFacteursDe(dfAncien.marchand_id);
    if (!df || !df.actif) return false;
    const s = String(saisi || '').trim();
    const pas = totp.verifier(dechiffrerSecret2fa(df.secret).secret, s, { dernierPas: df.dernier_pas });
    if (pas !== null) return db.prepare('UPDATE deux_facteurs SET dernier_pas = ? WHERE marchand_id = ? AND dernier_pas < ?').run(pas, df.marchand_id, pas).changes === 1;
    const secours = JSON.parse(df.secours), i = secours.indexOf(totp.empreinteSecours(s));
    if (i >= 0 && s.replace(/[^a-z0-9]/gi, '').length === 10) {
      secours.splice(i, 1);
      if (db.prepare('UPDATE deux_facteurs SET secours = ? WHERE marchand_id = ? AND secours = ?').run(JSON.stringify(secours), df.marchand_id, df.secours).changes !== 1) return false;
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
  const cookieAppareilPour = (ctx, marchandId, session) => {
    const a = appareilConnuPour(ctx, marchandId), maintenant = Date.now();
    let jeton = String(ctx.cookies.comptoir_appareil || '');
    if (a) db.prepare('UPDATE appareils_connus SET vu_le = ?, session = ? WHERE empreinte = ?').run(maintenant, session, a.empreinte);
    else { jeton = crypto.randomBytes(24).toString('base64url'); db.prepare('INSERT INTO appareils_connus (empreinte, marchand_id, cree_le, vu_le, session) VALUES (?, ?, ?, ?, ?)').run(auth.sha256(jeton), marchandId, maintenant, maintenant, session); }
    return `comptoir_appareil=${jeton}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${securise ? '; Secure' : ''}`;
  };
  // Un ancien cookie d'appareil (chemin /api/auth) peut rester dans le navigateur : il est envoyé avant celui de /api
  // (chemin plus précis d'abord) et lireCookies garde la dernière valeur, donc le nouveau jeton l'emporte.
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
    if (pays === 'ch' || c.canal === 'magasin' || c.canal === 'devis') return '';   // vente en personne ou à un professionnel : pas de droit de rétractation
    const article = pays === 'be' ? 'art. VI.47 du Code de droit économique' : 'art. L221-18 du Code de la consommation';
    const e = config.entreprise || {};
    const vendeur = [e.raison || config.boutique.nom, e.adresse, e.email].filter(Boolean).join(', ');
    return `\n\nDroit de rétractation : vous disposez de 14 jours à compter de la réception pour vous rétracter, sans avoir à vous justifier (${article}). Il suffit de nous le dire, par exemple en répondant à cet e-mail ; le remboursement intervient au plus tard 14 jours après votre demande. Conditions générales de vente : ${urlBoutique(bq)} (bas de page).\n\nFormulaire de rétractation (à compléter et renvoyer si vous le souhaitez) :\nÀ l’attention de ${vendeur} :\nJe vous notifie par la présente ma rétractation du contrat portant sur la vente du bien ci-dessous : commande n° ${c.numero}, commandée le ${new Date(c.date).toLocaleDateString('fr-FR')}, reçue le : ....\nNom : ${c.client.nom}\nAdresse : ....\nDate et signature : ....`;
  };
  const recapitulatif = (c, config) => [
    ...c.lignes.map(l => `- ${l.qte} × ${l.nom} : ${formatMontant(l.prix * l.qte, config)}`),
    // Les prix des articles sont déjà remisés : la remise est indiquée pour information, pas soustraite une seconde fois.
    ...(c.remise ? [`  (prix après remise${c.motifRemise ? ` : ${c.motifRemise}` : ''}, soit ${formatMontant(c.remise, config)} d’économie)`] : []),
    c.livraison === 'retrait' ? '- Retrait en boutique : gratuit' : `- Livraison (${(prix.modesLivraison(config)[c.livraison] || { nom: c.livraison === 'devis' ? 'selon le devis' : c.livraison === 'carte' ? 'envoi par e-mail' : c.livraison }).nom}) : ${c.port ? formatMontant(c.port, config) : 'offerte'}`,
    `Total payé : ${formatMontant(c.total, config)}`,
    ...(c.fidelite && c.fidelite.gagnes ? [`Points de fidélité gagnés : ${c.fidelite.gagnes}`] : []),
    ...(c.carteCadeau && c.carteCadeau.montant ? [`  dont ${formatMontant(c.carteCadeau.montant, config)} par carte cadeau ····${c.carteCadeau.fin}, reste ${formatMontant(Math.max(0, c.total - c.carteCadeau.montant), config)}`] : [])
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
  const optionsEmail = (b, c, config) => ({ nomBoutique: config.boutique.nom, formatMontant: m => formatMontant(m, config), nomLivraison: (prix.modesLivraison(config)[c.livraison] || { nom: c.livraison === 'devis' ? 'selon le devis' : c.livraison === 'carte' ? 'envoi par e-mail' : c.livraison }).nom, lienCommande: lienCommande(b, c.id), contact: config.entreprise && config.entreprise.email });
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
      if (marketing) lien = `${urlPublique}/desinscription?j=${jetonDesinscription(boutiqueId, destinataire)}${tp ? `&lang=${langue}` : ''}`;
      pied = `\n\n—\n${identite}${lien ? `\n${tp ? (motif === 'commande' ? tp.commande : tp.nouvelles)(conf.boutique.nom) : motif === 'commande' ? `Vous recevez cet e-mail à la suite de votre commande chez ${conf.boutique.nom}. Pour ne plus recevoir ce type de message` : `Vous recevez cet e-mail car vous avez accepté les nouvelles de ${conf.boutique.nom}. Pour ne plus les recevoir`} : ${lien}` : ''}`;
    }
    const insere = db.prepare('INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le, desinscription) VALUES (?, ?, ?, ?, ?, ?)').run(boutiqueId, destinataire, sujet, corps.replace(/\s+$/, '') + pied, Date.now(), lien);
    if (env.LOG_EMAILS) journal.log(`[e-mail] à ${courriel.masquerAdresses(destinataire)} (boutique ${boutiqueId || '-'})`);   // (débogage ; ni adresse en clair ni sujet, qui peut porter un prénom)
    return Number(insere.lastInsertRowid);
  };
  const formateurs = new Map();   // Intl.NumberFormat est coûteux à créer : un par devise, gardé
  const formatMontant = (n, config) => {
    const devise = config.boutique.devise || 'EUR';
    if (devise !== 'CHF') { let f = formateurs.get(devise); if (!f) { f = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: devise }); formateurs.set(devise, f); } return f.format(Number(n)); }
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
    // Variantes (produits en stock et en dropshipping) : 2 options au plus (ex. Taille × Couleur), 20 valeurs chacune, 60 combinaisons.
    // L'identifiant d'une variante est sa combinaison (« M/Bleu ») ; le stock du produit est la somme des variantes.
    // Dropshipping : pas de stock propre (celui du fournisseur), mais une référence fournisseur par variante, transmise avec la commande.
    if ((type === 'stock' || type === 'drop') && Array.isArray(p.options) && p.options.length) {
      const options = p.options.slice(0, 2).map(o => ({ nom: String(o && o.nom || '').trim().slice(0, 30), valeurs: [...new Set((Array.isArray(o && o.valeurs) ? o.valeurs : []).map(v => String(v).replace(/[\/|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean))].slice(0, 20) })).filter(o => o.nom && o.valeurs.length);
      if (options.length) {
        const combis = options.reduce((acc, o) => acc.flatMap(a => o.valeurs.map(v => [...a, v])), [[]]);
        if (combis.length > 60) throw erreur(400, '60 variantes au plus par produit.', 'trop_de_variantes');
        const avant = Array.isArray(p.variantes) ? p.variantes : [];
        propre.options = options;
        propre.variantes = combis.map(valeurs => {
          const id = valeurs.join('/'), memePosition = avant.length === combis.length ? avant[combis.indexOf(valeurs)] : null;
          const v = avant.find(x => x && x.id === id) || (memePosition && !combis.some(c2 => c2.join('/') === memePosition.id) ? memePosition : null) || {};   // valeur renommée : stock gardé
          const prixV = v.prix !== undefined && v.prix !== null && v.prix !== '' ? prix.arrondi(valider.nombre(v.prix, 'Le prix de la variante', { min: 0, max: 100000 })) : null;
          const ref = type === 'drop' && v.ref ? String(v.ref).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) : '';
          return { id, valeurs, stock: type === 'drop' ? 999 : valider.entier(v.stock ?? 0, 'Le stock de la variante', { min: 0, max: 1e6 }), ...(prixV !== null ? { prix: prixV } : {}), ...(ref ? { ref } : {}) };
        });
        if (type !== 'drop') propre.stock = propre.variantes.reduce((a, v) => a + v.stock, 0);
      }
    }
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
      reconcilierProduit(boutiqueId, id);
    });
  }

  /* ---------- Flux des statuts (mêmes règles que l'interface) ---------- */
  const estDrop = c => c.lignes.length > 0 && c.lignes.every(l => l.type === 'drop');
  function transitionsPossibles(c) {
    if (c.canal === 'carte') return c.statut === 'attente' ? ['annulee'] : c.statut === 'payee' ? ['remboursee'] : [];   // carte cadeau vendue : pas d'expédition
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
    // Unités déjà remboursées par un retour partiel avant la transmission : pas commandées au fournisseur.
    const rendues = Retours.deja(c).qte;
    const lignesDrop = c.lignes.map((l, i) => l.type === 'drop' && l.qte - rendues[i] > 0 ? { ...l, qte: l.qte - rendues[i] } : null).filter(Boolean);
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
      // Variante : identifiant, valeurs (« M / Bleu ») et référence du fournisseur si le marchand l'a saisie.
      lignes: lignesDrop.map((l, i) => {
        if (!l.varianteId) return { produitId: sources[i], qte: l.qte };
        const p = listerProduits(boutique.id).find(x => x.id === l.produitId), v = p && Array.isArray(p.variantes) ? p.variantes.find(x => x.id === l.varianteId) : null;
        return { produitId: sources[i], qte: l.qte, variante: { id: l.varianteId, valeurs: v ? v.valeurs : String(l.varianteId).split('/'), ...(v && v.ref ? { ref: v.ref } : {}) } };
      }),
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

  /* Réservations d'une commande en attente (part payée par carte cadeau, points de fidélité utilisés) : débitées à la
     commande, rendues si le paiement n'aboutit pas, débitées à nouveau si le client paie quand même. Toujours appelées
     dans une transaction. */
  function libererReservations(bid, c, texte, maintenant = Date.now()) {
    const faits = [];
    if (c.carteCadeau && !c.carteCadeau.liberee && !c.carteCadeau.rendue) { Cartes.crediter(c.carteCadeau.id, Math.round(c.carteCadeau.montant * 100), { commandeId: c.id, texte: `Commande n° ${c.numero} : ${texte}`, maintenant }); c.carteCadeau.liberee = maintenant; faits.push('carte cadeau'); }
    if (c.fidelite && c.fidelite.debite && !c.fidelite.liberee && !c.fidelite.annule && c.client && c.client.email) { FID.crediter(bid, c.client.email, c.fidelite.debite, { commandeId: c.id, type: 'liberation', maintenant }); c.fidelite.liberee = maintenant; faits.push('points de fidélité'); }
    if (faits.length) historique(c, `${texte[0].toUpperCase()}${texte.slice(1)} : ${faits.join(' et ')} rendus (repris si le paiement aboutit)`);
    return faits.length > 0;
  }
  // Les reprendre : tout ou rien (si l'un manque, rien n'est débité). Renvoie null, ou le motif du refus.
  function reprendreReservations(bid, c, maintenant = Date.now()) {
    const carte = c.carteCadeau && c.carteCadeau.liberee ? db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ?').get(c.carteCadeau.id) : null;
    if (carte && Cartes.disponible(carte, maintenant) < Math.round(c.carteCadeau.montant * 100)) return `la carte cadeau ····${c.carteCadeau.fin} n’a plus le solde réservé`;
    if (c.fidelite && c.fidelite.liberee && FID.solde(bid, c.client.email, maintenant) < c.fidelite.debite) return 'les points de fidélité utilisés ont été dépensés entre-temps';
    if (carte) { Cartes.debiter(carte.id, Math.round(c.carteCadeau.montant * 100), { commandeId: c.id, texte: `Commande n° ${c.numero} (reprise)`, maintenant }); delete c.carteCadeau.liberee; c.carteCadeau.reserveLe = maintenant; }
    if (c.fidelite && c.fidelite.liberee) { FID.debiter(bid, c.client.email, c.fidelite.debite, { commandeId: c.id, maintenant }); delete c.fidelite.liberee; c.fidelite.reserveLe = maintenant; }
    return null;
  }
  // Points gagnés sur une commande payée en ligne (prix réellement payés), une seule fois.
  function gagnerPoints(bid, c) {
    if (!c.client || !c.client.email || (c.canal || 'web') !== 'web' || (c.fidelite && c.fidelite.gagnes)) return;
    const reg = FID.reglages(bid); if (!reg.actif) return;
    const gagnes = FID.gagnes(reg, Math.round(c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) * 100));
    if (gagnes > 0) { FID.crediter(bid, c.client.email, gagnes, { commandeId: c.id }); c.fidelite = { ...(c.fidelite || {}), gagnes }; }
  }
  /* Carte cadeau achetée en ligne et payée : émise, et son code envoyé au destinataire (ou à l'acheteur). Le code n'est
     gardé nulle part en clair (la copie de l'e-mail est masquée dès l'envoi). */
  // Texte saisi par l'acheteur (nom, message) : une ligne, sans adresse web ni caractère invisible ou de direction,
  // pour qu'un e-mail de carte cadeau ne puisse pas servir d'hameçonnage au nom de la boutique.
  const texteSur = (t, max) => String(t || '').normalize('NFC').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[…]').replace(/\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b\S*/gi, '[…]')   /* tout ce qui ressemble à un nom de domaine */
    .replace(/\s+/g, ' ').trim().slice(0, max);
  const uneLigne = t => String(t || '').normalize('NFC').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
  // Texte qui contient un lien ou une adresse de site (y compris maquillée : « exemple[.]com », adresse IP) : refusé avec
  // un message clair, jamais réécrit en silence (le nom figure sur la facture).
  const LIEN = /(?:https?:|www\.|:\/\/|\[\.\]|\(\.\)|\b\d{1,3}(?:\.\d{1,3}){3}\b|\.(?:ch|com|fr|be|de|at|it|li|lu|nl|eu|net|org|info|biz|io|co|me|app|site|online|shop|store|link|click|xyz|top|ru|cn|tk|ml|ga|cf|gq|ws|cc|ly|gl|to|sh|page|dev)(?![\p{L}\d]))/iu;
  const sansLien = (t, quoi, code) => { if (LIEN.test(t)) throw erreur(400, `${quoi} ne peut pas contenir de lien ni d’adresse de site.`, code); return t; };
  const nomSur = t => { const n = uneLigne(t).slice(0, 70); if (!n) throw erreur(400, 'Indiquez votre nom.', 'nom_invalide'); return sansLien(n, 'Le nom', 'nom_invalide'); };
  function emettreCarteVendue(bid, c, { liberer = false } = {}) {
    if (c.carteEmise) return;
    const b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(bid), config = lireConfig(b), reg = Cartes.reglagesVente(bid);
    // Risque élevé (carte bancaire peut-être volée) : la carte n'est pas envoyée tout de suite, le marchand la libère.
    if (!liberer && c.risque && c.risque.niveau === 'eleve') {
      if (!c.carteRetenue) { c.carteRetenue = Date.now(); historique(c, 'Carte cadeau retenue : risque de fraude élevé. Vérifiez puis libérez-la depuis la commande (ou remboursez).'); const m = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id); if (m) envoyerEmail(null, m.email, `Carte cadeau retenue (commande n° ${c.numero})`, `Bonjour,\n\nLa carte cadeau de la commande n° ${c.numero} (${formatMontant(c.total, config)}) n'a pas été envoyée : risque de fraude élevé (${(c.risque.raisons || []).join(' ; ')}).\nVérifiez la commande, puis libérez la carte ou remboursez : ${urlPublique}/app#commandes\n\nComptoir`); }
      return;
    }
    const d = new Date(); d.setMonth(d.getMonth() + reg.validiteMois);
    const dest = (c.client && c.client.destinataire) || {};
    const { carte, code } = Cartes.emettre(bid, { montant: c.total, devise: c.devise || config.boutique.devise || 'EUR', expireLe: d.getTime(), destinataire: dest.nom ? texteSur(dest.nom, 100) : null, origine: 'vente', commandeId: c.id });
    c.carteEmise = { id: carte.id, fin: carte.fin }; delete c.carteRetenue;
    integ.emettre(bid, 'carte.emise', { id: carte.id, fin: carte.fin, montant: carte.initial, devise: carte.devise, expireLe: carte.expireLe ? new Date(carte.expireLe).toISOString() : null, origine: 'vente', commande: { id: c.id, numero: c.numero } });   // jamais le code
    const a = dest.email || c.client.email, offerte = !!dest.email && dest.email !== c.client.email;
    const acheteur = texteSur(c.client.nom, 60), message = c.client.message ? texteSur(c.client.message, 300) : '';
    // Dans la langue de l'acheteur (choisie à l'achat) ; en français sinon.
    const oCarte = { nomBoutique: config.boutique.nom, offerte, acheteur, montant: formatMontant(c.total, config), code, expireLe: carte.expireLe, url: urlBoutique(b), message, nomDest: dest.nom ? texteSur(dest.nom, 60) : '', email: dest.email, contact: config.entreprise && config.entreprise.email };
    const traduite = EmailsClients.carteCadeauCode(c.langue, oCarte), avisTraduit = offerte ? EmailsClients.carteCadeauAvis(c.langue, oCarte) : null;
    c.carteEmise.email = traduite ? envoyerEmail(bid, a, traduite.sujet, traduite.corps, { langue: c.langue }) : envoyerEmail(bid, a, offerte ? `Une carte cadeau ${config.boutique.nom} pour vous` : `Votre carte cadeau ${config.boutique.nom}`,
      `Bonjour${dest.nom ? ` ${texteSur(dest.nom, 60)}` : ''},\n\n${offerte ? `Vous recevez une carte cadeau de ${formatMontant(c.total, config)} chez ${config.boutique.nom}, offerte par ${acheteur}.` : `Voici votre carte cadeau de ${formatMontant(c.total, config)} chez ${config.boutique.nom}.`}\n\nCode : ${code}\nValable jusqu’au ${new Date(carte.expireLe).toLocaleDateString('fr-FR')}, en ligne (${urlBoutique(b)}) et en boutique.\nGardez ce code : il vaut de l’argent. ${config.boutique.nom} ne vous demandera jamais de le communiquer.${message ? `\n\n— Message de ${acheteur} (texte libre, non vérifié par la boutique) :\n${message}` : ''}\n\n${config.boutique.nom}`);
    if (avisTraduit) envoyerEmail(bid, c.client.email, avisTraduit.sujet, avisTraduit.corps, { langue: c.langue });
    else if (offerte) envoyerEmail(bid, c.client.email, `Votre carte cadeau ${config.boutique.nom} est partie`, `Bonjour ${acheteur},\n\nLa carte cadeau de ${formatMontant(c.total, config)} a été envoyée à ${dest.email}.\nSi cette adresse est erronée, contactez ${config.entreprise && config.entreprise.email ? config.entreprise.email : 'la boutique'} : la carte peut être annulée et renvoyée.\n\n${config.boutique.nom}`);
    historique(c, `Carte cadeau ····${carte.fin} émise, envoi par e-mail en file${offerte ? ' (au destinataire)' : ''}`);
  }
  /* Appelé une seule fois quand le paiement est confirmé (idempotent). */
  /* Commande payée (dans une transaction) : facture, complément rattaché, alerte de rupture, stock. */
  function marquerPayee(row, texte) {
    const c = lireCommande(row);
    c.statut = 'payee'; c.payeLe = Date.now();
    // Vente d'une carte cadeau (bon à usages multiples) : pas une livraison de biens, donc pas de facture ; un reçu.
    if (c.canal === 'carte') emettreCarteVendue(row.boutique_id, c);
    else if (!c.facture) { c.facture = prochaineFacture(row.boutique_id, Date.now()); c.dateFacture = Date.now(); }   // facture QR : déjà émise
    if (c.relances) { c.recuperee = true; c.historique.push({ date: Date.now(), texte: 'Paiement récupéré après relance' }); }
    if (c.parent) {
      const pr = db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.parent);
      if (pr) { const parent = lireCommande(pr); parent.complements = [...(parent.complements || []), c.id]; historique(parent, `Complément n° ${c.numero} ajouté après l’achat : à expédier dans le même colis`); enregistrerCommande(parent); }
    }
    historique(c, texte);
    // Fidélité : points gagnés sur les articles payés (les points utilisés ont été débités à la commande).
    gagnerPoints(row.boutique_id, c);
    // Stock : la vente est faite (le client a payé), mais une rupture est signalée au lieu d'être cachée.
    const prods = listerProduits(row.boutique_id);
    const manques = c.lignes.filter(l => l.type !== 'drop').map(l => ({ l, p: prods.find(x => x.id === l.produitId) })).filter(x => {
      if (!x.p || x.p.type === 'drop') return false;
      const v = x.l.varianteId && Array.isArray(x.p.variantes) ? x.p.variantes.find(y => y.id === x.l.varianteId) : null;   // variante : son propre stock
      return v ? v.stock < c.lignes.filter(y => y.produitId === x.l.produitId && y.varianteId === x.l.varianteId).reduce((a, y) => a + y.qte, 0)
        : x.p.stock < c.lignes.filter(y => y.produitId === x.l.produitId).reduce((a, y) => a + y.qte, 0);
    });
    if (manques.length) { c.alerteStock = true; historique(c, `Rupture de stock au paiement : ${[...new Set(manques.map(x => x.p.nom))].join(', ')}. Réapprovisionnez ou remboursez.`); }
    ajusterStock(row.boutique_id, c.lignes, -1, canalStock(c));
    enregistrerCommande(c);
    return { c, boutique: db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id) };
  }
  /* Après un paiement (en ligne ou relevé bancaire) : e-mails au client et au marchand, transmission au fournisseur. */
  async function apresPaiement(res) {
    const config = lireConfig(res.boutique);
    // Carte cadeau vendue : le client a reçu sa carte (ou son avis d'envoi) ; le marchand est simplement informé.
    if (res.c.canal === 'carte') {
      const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(res.boutique.marchand_id);
      if (mch) envoyerEmail(null, mch.email, `Carte cadeau vendue : ${formatMontant(res.c.total, config)}`, `Bonjour,\n\nUne carte cadeau de ${formatMontant(res.c.total, config)} a été vendue en ligne sur ${config.boutique.nom} (commande n° ${res.c.numero}).${res.c.carteRetenue ? '\n\nAttention : risque de fraude élevé, la carte est retenue. Vérifiez puis libérez-la ou remboursez depuis Commandes.' : ' Elle a été envoyée par e-mail ; rien à expédier.'}\n\n${urlPublique}/app#commandes\n\nComptoir`);
      return;
    }
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
      notifierEquipe(res.boutique, { titre: `${res.c.parent ? 'Complément' : 'Nouvelle commande'} n° ${res.c.numero}`, texte: `${formatMontant(res.c.total, config)}${res.c.risque && res.c.risque.niveau === 'eleve' ? ' · risque de fraude élevé, à vérifier' : ''}`, url: '/app#commandes' }).catch(() => {});
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
  // Session de paiement qui ne correspond pas au paiement attendu (montant, devise, référence) : jamais validée, signalée.
  const sessionNonConforme = (objet, p) => {
    if (sessionConforme(objet, p)) return false;
    // Le client a payé, mais pas ce qui était attendu : l'argent est à rendre, la commande n'est pas validée, le marchand le voit.
    if (objet.payment_status === 'paid' && ['cree', 'annule'].includes(p.statut)) transaction(db, () => {
      db.prepare("UPDATE paiements SET statut = 'a_rembourser', ref_externe = COALESCE(?, ref_externe), intent = COALESCE(?, intent) WHERE id = ?").run(objet.id ? String(objet.id) : null, objet.payment_intent ? String(objet.payment_intent) : null, p.id);
      const row = db.prepare('SELECT * FROM commandes WHERE id = ?').get(p.commande_id);
      if (row) { const c = lireCommande(row); historique(c, 'Paiement reçu qui ne correspond pas à la commande (montant ou devise) : à rembourser, commande non validée.'); enregistrerCommande(c); }
    });
    // Remboursement automatique (Stripe), comme pour un paiement reçu sur une commande annulée ; en cas d'échec, il reste signalé.
    const aRendre = db.prepare("SELECT * FROM paiements WHERE id = ? AND statut = 'a_rembourser'").get(p.id);
    if (aRendre && aRendre.fournisseur === 'stripe') paiement.rembourser({ paiement: aRendre }).then(() => db.prepare("UPDATE paiements SET statut = 'rembourse' WHERE id = ? AND statut = 'a_rembourser'").run(aRendre.id)).catch(e => journal.error('[paiement] remboursement automatique', e.message));
    journal.error(`[paiement] session ${String(objet.id || '').slice(0, 40)} non conforme au paiement ${p.id} (montant ${objet.amount_total} au lieu de ${p.montant_centimes}, devise ${objet.currency || '?'} au lieu de ${p.devise}) : ignorée`);
    return true;
  };
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
      // Carte cadeau ou points rendus entre-temps (paiement resté longtemps en suspens) : repris maintenant ; s'ils ne
      // sont plus disponibles, l'argent reçu est à rendre et la commande reste en attente (jamais payée à moitié).
      const c1 = lireCommande(row);
      if ((c1.carteCadeau && c1.carteCadeau.liberee) || (c1.fidelite && c1.fidelite.liberee)) {
        const refus = reprendreReservations(row.boutique_id, c1);
        if (refus) {
          db.prepare("UPDATE paiements SET statut = 'a_rembourser', ref_externe = COALESCE(?, ref_externe) WHERE id = ?").run(refExterne || null, p.id);
          historique(c1, `Paiement reçu, mais ${refus} : paiement à rembourser, commande non validée.`); enregistrerCommande(c1);
          return { aRembourser: { ...p, statut: 'a_rembourser', ref_externe: refExterne || p.ref_externe } };
        }
        historique(c1, 'Réservations reprises au paiement'); enregistrerCommande(c1);
      }
      // Paiement arrivé tard (webhook retardé, lien payé après l'abandon) alors que la dernière utilisation du code a été
      // prise entre-temps : la vente est faite et le client a payé ; le dépassement est signalé au marchand, pas caché.
      if (c1.codePromo) { const b1 = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id); const refus = limiteCode(row.boutique_id, configVente(b1), c1.codePromo, c1.client.email, c1.id);
        if (refus) { c1.codeDepasse = true; historique(c1, `Paiement reçu tard : ${refus.message} La remise est accordée quand même (le client a payé).`); enregistrerCommande(c1); } }
      db.prepare("UPDATE paiements SET statut = 'paye', ref_externe = COALESCE(?, ref_externe) WHERE id = ?").run(refExterne || null, p.id);
      // Les autres liens de paiement encore ouverts pour cette commande ne servent plus.
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE commande_id = ? AND id <> ? AND statut = 'cree'").run(p.commande_id, p.id);
      return marquerPayee(db.prepare('SELECT * FROM commandes WHERE id = ?').get(row.id), `Paiement ${p.fournisseur === 'stripe' ? 'en ligne' : 'simulé'} accepté (${formatMontant(p.montant_centimes / 100, lireConfig(db.prepare('SELECT config FROM boutiques WHERE id = ?').get(row.boutique_id)))})`);
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
    const acces = accesDe(ctx.marchand.id);
    if (!acces) throw erreur(404, 'Aucune boutique pour ce compte.', 'sans_boutique');
    ctx.boutique = acces.boutique; ctx.role = acces.role;
    const r0 = requeteCourante.getStore(); if (r0 && acces.role !== 'proprietaire') r0.auteur = ctx.marchand.email;
  };
  /* Rôles de l'équipe. « commandes » : préparer, expédier, transmettre, encaisser à la caisse (pas de remboursement,
     pas de réglages). « complet » : tout, sauf l'abonnement, l'équipe, les paiements, les intégrations et la remise à zéro. */
  const PERMIS_COMMANDES = /^(GET \/api\/admin\/(etat|signature|flux|commandes\/[\w-]+\/(facture-qr|facture-electronique|facture-pdf))|POST \/api\/admin\/commandes\/[\w-]+\/(statut|transmettre)|PATCH \/api\/admin\/commandes\/[\w-]+|POST \/api\/admin\/caisse(\/carte)?)$/;
  const INTERDIT_COMPLET = /^(\w+ \/api\/admin\/(integrations|equipe|paiements|domaine|reinitialiser)(\/.*)?)$/;
  const exigerProprietaire = ctx => { exigerCompte(ctx); if (ctx.role !== 'proprietaire') throw erreur(403, 'Seul le propriétaire de la boutique gère l’abonnement et l’équipe.', 'role'); };
  const verifierRole = ctx => {
    if (!ctx.role || ctx.role === 'proprietaire') return;
    const route = `${ctx.req.method} ${new URL(ctx.req.url, 'http://x').pathname}`;
    if (ctx.role === 'commandes' ? !PERMIS_COMMANDES.test(route) : INTERDIT_COMPLET.test(route)) throw erreur(403, 'Votre rôle dans l’équipe ne donne pas accès à cette action. Demandez au propriétaire de la boutique.', 'role');
  };
  // Espace marchand : uniquement sa propre boutique (boutique_id du compte), et seulement si l'abonnement est payé.
  // Abonnement terminé ou impayé, après au moins un paiement : consultation et export de ses données, suivi des commandes
  // déjà passées et effacement d'un client (obligation légale) restent possibles ; tout le reste attend un nouvel abonnement.
  const LECTURE_SEULE = new Set(['GET /api/admin/cartes-cadeaux/export', 'GET /api/admin/cartes-cadeaux/vente', 'GET /api/admin/emplacements', 'GET /api/admin/fidelite', 'GET /api/admin/cartes-cadeaux', 'GET /api/admin/devis', 'GET /api/admin/journal-inalterable', 'POST /api/admin/journal-inalterable/verifier', 'GET /api/admin/journal-inalterable/export', 'GET /api/admin/etat', 'GET /api/admin/clients/export', 'GET /api/admin/emails', 'POST /api/admin/clients/effacer', 'GET /api/admin/integrations']);
  // Routes coûteuses (génération de PDF et de XML, exports) : quota par boutique,
  // équipe comprise. Large pour un usage normal (une fiduciaire qui télécharge un trimestre), mais une session volée ou
  // un script ne peut pas monopoliser le serveur.
  const COUTEUSES = [
    [/^GET \/api\/admin\/commandes\/[^/]+\/(facture-pdf|facture-electronique)$/, 'documents', 300, 10 * 60000],
    [/^(GET|POST) \/api\/admin\/(export-complet|clients\/export|journal-inalterable\/export|cartes-cadeaux\/export)$/, 'exports', 30, 3600000]
  ];   // (vérification complète du journal : déjà limitée à 6 par heure dans sa route)
  const limiterCouteuse = ctx => {
    const route = `${ctx.req.method} ${new URL(ctx.req.url, 'http://x').pathname}`;
    for (const [motif, cle, n, duree] of COUTEUSES) if (motif.test(route)) auth.limiter(`couteux:${cle}:${ctx.boutique.id}`, n * facteurLimites, duree, 'Beaucoup de téléchargements en peu de temps : réessayez dans quelques minutes.');
  };
  const exigerMarchand = ctx => {
    exigerCompte(ctx);
    verifierRole(ctx);
    limiterCouteuse(ctx);
    const e = abo.etat(ctx.boutique.marchand_id);   // abonnement du propriétaire, aussi pour son équipe
    if (e.actif) return;
    const route = `${ctx.req.method} ${new URL(ctx.req.url, 'http://x').pathname}`;
    // Les commandes déjà payées doivent pouvoir être expédiées, transmises ou remboursées : les clients ont payé.
    // Le marchand doit toujours pouvoir couper ses intégrations (clés, webhooks), même abonnement terminé.
    // Factures (QR, électronique) : à conserver des années, donc toujours téléchargeables.
    const suiviCommande = /^POST \/api\/admin\/commandes\/[\w-]+\/(statut|transmettre)$/.test(route) || /^GET \/api\/admin\/commandes\/[\w-]+\/(facture-qr|facture-electronique|facture-pdf)$/.test(route) || /^POST \/api\/admin\/integrations\/(cles\/[\w-]+\/revoquer|webhooks\/[\w-]+\/supprimer)$/.test(route);
    if (['resilie', 'impaye'].includes(e.statut) && (LECTURE_SEULE.has(route) || suiviCommande)) { ctx.lectureSeule = true; return; }
    throw erreur(402, ['resilie', 'impaye'].includes(e.statut) ? 'Abonnement terminé : vos données restent consultables et exportables ; reprenez un abonnement pour modifier votre boutique.' : 'Choisissez une formule et réglez votre abonnement pour accéder à votre boutique.', 'abonnement_requis');
  };
  // Fonction réservée à une formule (réseaux sociaux : Croissance ; caisse : Pro). Sans abonnement obligatoire : tout est ouvert.
  const exigerFonction = fonction => ctx => {
    exigerMarchand(ctx);
    const e = abo.etat(ctx.boutique.marchand_id);
    if (e.obligatoire && !Formules.permet(e.formule, fonction)) throw erreur(403, `${Formules.NOMS_FONCTIONS[fonction]} : disponible avec la formule ${Formules.FORMULES[Formules.FONCTIONS[fonction]].nom}. Changez de formule dans Paramètres > Abonnement.`, 'formule_insuffisante');
  };

  /* ---------- Comptes ---------- */
  /* Vérification de l'adresse e-mail : un lien envoyé à l'inscription prouve que le marchand reçoit bien ses e-mails
     (réinitialisation, alertes de sécurité, commandes). Sans elle, quelqu'un pourrait ouvrir un compte au nom d'une
     adresse qui n'est pas la sienne et s'en servir pour écrire à des tiers. Les comptes antérieurs à cette règle
     (valeur 0) sont considérés comme vérifiés ; une réinitialisation de mot de passe ou une invitation acceptée prouve
     aussi l'adresse. L'exigent : inviter l'équipe, envoyer un devis (à une adresse saisie par le marchand) et activer
     les versements. Les autres e-mails partent vers des clients qui ont commandé ou se sont inscrits eux-mêmes. */
  // Ajout de la colonne et reprise des comptes existants d'un seul tenant : un arrêt entre les deux ne laisse pas tous
  // les comptes existants « non vérifiés » (la colonne serait là, la reprise jamais refaite).
  if (!db.prepare('PRAGMA table_info(marchands)').all().some(c => c.name === 'email_verifie_le')) transaction(db, () => {
    db.exec('ALTER TABLE marchands ADD COLUMN email_verifie_le INTEGER');
    db.exec('UPDATE marchands SET email_verifie_le = 0');
  });
  db.exec('CREATE TABLE IF NOT EXISTS verifications_email (jeton_hash TEXT PRIMARY KEY, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, email TEXT NOT NULL, expire_le INTEGER NOT NULL)');
  const emailVerifie = mid => { const r = db.prepare('SELECT email_verifie_le FROM marchands WHERE id = ?').get(mid); return !!r && r.email_verifie_le !== null; };
  const marquerEmailVerifie = mid => {
    db.prepare('UPDATE marchands SET email_verifie_le = ? WHERE id = ? AND email_verifie_le IS NULL').run(Date.now(), mid);
    db.prepare('DELETE FROM verifications_email WHERE marchand_id = ?').run(mid);
  };
  const envoyerVerificationEmail = (mid, email) => {
    const jeton = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM verifications_email WHERE marchand_id = ?').run(mid);   // un seul lien valable à la fois
    db.prepare('INSERT INTO verifications_email (jeton_hash, marchand_id, email, expire_le) VALUES (?, ?, ?, ?)').run(auth.sha256(jeton), mid, email, Date.now() + 7 * 86400000);
    envoyerEmail(null, email, 'Confirmez votre adresse e-mail Comptoir', `Bonjour,\n\nPour confirmer que cette adresse est bien la vôtre, ouvrez ce lien (valable 7 jours) :\n${urlPublique}/app?verifier-email=${jeton}\n\nTant qu’elle n’est pas confirmée, vous pouvez préparer votre boutique, mais pas inviter d’équipe ni activer les versements.\n\nSi vous n’avez pas créé de compte Comptoir, ignorez cet e-mail : sans confirmation, l’adresse ne sert à rien.\n\nL’équipe Comptoir`);
  };
  const exigerEmailVerifie = (ctx, quoi) => { if (!emailVerifie(ctx.marchand.id)) throw erreur(403, `Confirmez d’abord votre adresse e-mail (lien reçu à l’inscription) pour ${quoi}.`, 'email_non_verifie'); };
  // Lien du message : utilisable sans session (ouvert sur le téléphone, par exemple). Le lien prouve l'adresse à laquelle il a été envoyé.
  r.post('/api/auth/verifier-email', ctx => {
    // Compteur à part (pas celui des connexions : un réseau partagé ne perd pas ses essais de connexion).
    auth.limiter('verif-lien:' + reseauIp(ctx.ip), 30 * facteurLimites, 15 * 60000, 'Trop d’essais : réessayez dans quelques minutes.');
    // Lien retiré en le lisant : deux requêtes simultanées avec le même lien n'aboutissent pas toutes les deux.
    const v = transaction(db, () => {
      const l = db.prepare('DELETE FROM verifications_email WHERE jeton_hash = ? RETURNING *').get(auth.sha256(String(ctx.corps.jeton || '')));
      const m = l && db.prepare('SELECT email FROM marchands WHERE id = ?').get(l.marchand_id);
      if (!l || !m || l.expire_le < Date.now() || l.email.toLowerCase() !== m.email.toLowerCase()) return null;
      marquerEmailVerifie(l.marchand_id);
      return l;
    });
    if (!v) throw erreur(400, 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau depuis votre espace.', 'lien_expire');
    noterActivite(v.marchand_id, 'email-verifie', v.email, ctx);
    return { ok: true, email: v.email };
  });
  r.post('/api/admin/compte/verifier-email/renvoyer', exigerCompte, ctx => {
    if (emailVerifie(ctx.marchand.id)) return { ok: true, deja: true };
    auth.limiter('verif-email:' + ctx.marchand.id, 3 * facteurLimites, 3600000, 'Un lien vient déjà d’être envoyé. Vérifiez votre boîte de réception (et les indésirables), ou réessayez dans une heure.');
    envoyerVerificationEmail(ctx.marchand.id, ctx.marchand.email);
    return { ok: true };
  });
  r.get('/api/session', ctx => {
    const m = auth.marchandDepuisRequete(db, ctx.cookies);
    renouvelerCookie(ctx, m);
    const acces = m && accesDe(m.id), b = acces && acces.boutique;
    const df = m && deuxFacteursDe(m.id);
    const protege = !!m && (!!(df && df.actif) || cleSeule(m.id));   // une clé d'accès seule (sans « exiger ») laisse la connexion par mot de passe ouverte
    return { connecte: !!m, email: m ? m.email : null, emailVerifie: m ? emailVerifie(m.id) : null, deuxFacteurs: !!(df && df.actif), slug: b ? b.slug : null, role: acces ? acces.role : null, compteProtege: protege, recuperationEnAttente: m ? recuperationEnAttente(m.id) : null, paiement: paiement.nom, fournisseurDemoVendable, socialSimule, hebergeur: env.HEBERGEUR || null, emails: serviceEmail ? serviceEmail.nom : null, abonnement: m ? abo.etat(b ? b.marchand_id : m.id) : null };
  });
  r.post('/api/auth/inscription', async ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const email = valider.email(ctx.corps.email);
    const mdp = valider.texte(ctx.corps.motDePasse, 'Le mot de passe', { min: 10, max: 200 });
    await exigerMotDePasseSolide(mdp, { email, noms: [((ctx.corps.config || {}).boutique || {}).nom || ''] });
    const hashMdp = await auth.hacherMotDePasse(mdp);
    // Un domaine choisi à l'inscription n'est jamais actif : il faut d'abord prouver qu'on le possède (DNS + TXT).
    const config = garderDomaine(nettoyerConfig(ctx.corps.config), { boutique: {} });
    if (db.prepare('SELECT 1 FROM marchands WHERE email = ?').get(email)) {
      // Une inscription refusée révèle qu'un compte existe : ces refus sont bornés par réseau (10 par heure), ce qui rend
      // le repérage d'adresses clientes de Comptoir lent et visible. Le titulaire est prévenu (une fois par jour).
      auth.limiter(`inscription-existant:${reseauIp(ctx.ip)}`, 10 * facteurLimites, 3600000, 'Trop de tentatives d’inscription : réessayez plus tard, ou connectez-vous.');
      try { auth.limiter(`inscription-existant-avis:${email}`, 1, 86400000, ''); envoyerEmail(null, email, 'Tentative d’inscription avec votre adresse', `Bonjour,\n\nQuelqu’un a essayé de créer un compte Comptoir avec votre adresse, qui en a déjà un. Si c’était vous : connectez-vous, ou choisissez « Mot de passe oublié ».\nSinon, vous n’avez rien à faire : votre compte n’a pas été modifié.\n\nComptoir`); } catch { /* déjà prévenu aujourd'hui */ }
      throw erreur(409, 'Un compte existe déjà avec cet e-mail. Connectez-vous.', 'email_pris');
    }
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
    envoyerVerificationEmail(marchandId, email);
    return { statut: 201, corps: { ok: true, slug } };
  });
  r.post('/api/auth/connexion', async ctx => {
    const email = valider.email(ctx.corps.email);
    // Limites par adresse, et par compte depuis cette adresse : un tiers ne peut pas verrouiller le compte d'un marchand
    // depuis d'autres adresses. Le compte seul n'est bloqué qu'à un seuil très élevé (attaque distribuée massive).
    const max = Number(env.LIMITE_ESSAIS) || 10, e = email.toLowerCase(), reseau = reseauIp(ctx.ip);
    // Bloc réseau (IPv4 /24, IPv6 /48), par compte : changer d'adresse voisine ne multiplie pas les essais sur un compte.
    // Jamais un compteur commun au bloc (un voisin de bureau ou d'opérateur bloquerait tout le monde), et jamais pour un
    // appareil où le marchand s'est déjà connecté (vérifié plus bas).
    const blocReseau = auth.blocReseau(ctx.ip);
    const parIp = ['ip:' + reseau, `compte-ip:${e}|${reseau}`];
    auth.verifierEchecs(parIp, max);
    auth.verifierEchecs(['ip-cours:' + reseau, `compte-ip-cours:${e}|${reseau}`], max);
    // Seuil global du compte (attaque répartie sur beaucoup d'adresses) : il ne s'applique jamais à un appareil où
    // le marchand s'est déjà connecté (cookie signé), donc personne ne peut l'empêcher de se connecter de chez lui.
    const appareilLu = appareilDe(ctx), proprio = appareilLu && db.prepare('SELECT lower(email) AS e FROM marchands WHERE id = ?').get(appareilLu.marchand_id);
    const appareilConnu = !!(proprio && proprio.e === e);
    if (!appareilConnu) { auth.verifierEchecs(['compte:' + e], max * 20); auth.verifierEchecs([`compte-bloc:${e}|${blocReseau}`], max * 3); }
    const m = db.prepare('SELECT * FROM marchands WHERE email = ?').get(email);
    // Compté avant le calcul : des essais lancés en parallèle ne contournent pas la limite.
    const enCours = ['ip-cours:' + reseau, `compte-ip-cours:${e}|${reseau}`];
    const ok = await auth.essayerMotDePasse(enCours, max, String(ctx.corps.motDePasse || ''), m && m.mot_de_passe);
    // Mot de passe changé ou réinitialisé pendant le calcul : l'ancien ne doit pas ouvrir de session.
    const actuel = m && db.prepare('SELECT mot_de_passe FROM marchands WHERE id = ?').get(m.id);
    const actuelCle = m && db.prepare('SELECT cle_seule FROM marchands WHERE id = ?').get(m.id);   // relu après le calcul (option activée entre-temps)
    if (!ok || !actuel || actuel.mot_de_passe !== m.mot_de_passe) { auth.noterEchec([...parIp, 'compte:' + e, `compte-bloc:${e}|${blocReseau}`]); throw erreur(401, 'E-mail ou mot de passe incorrect. Si votre compte utilise une clé d’accès, connectez-vous avec elle.', 'identifiants'); }
    m.cle_seule = actuelCle ? actuelCle.cle_seule : m.cle_seule;
    if (m.cle_seule) {
      // Bon mot de passe, mais ce compte exige sa clé d'accès : refusé. Noté au journal du compte (une fois par heure),
      // compté dans le bilan de sécurité comme tentative suspecte.
      try { auth.limiter('alerte-cle-seule:' + m.id, 1, 3600000, ''); noterActivite(m.id, 'mdp-refuse-cle-seule', null, ctx); } catch { /* déjà noté cette heure */ }
      // Depuis un appareil inconnu : réponse identique à un mauvais mot de passe, sans e-mail ni limite propre
      // (rien ne confirme à un tiers qu'il a le bon mot de passe). L'essai est compté comme un échec.
      if (!appareilConnu) { auth.noterEchec([...parIp, 'compte:' + e]); throw erreur(401, 'E-mail ou mot de passe incorrect. Si votre compte utilise une clé d’accès, connectez-vous avec elle.', 'identifiants'); }
      auth.limiter('cle-seule-essais:' + m.id, 10, 15 * 60000, 'Trop d’essais : réessayez plus tard.');
      // Appareil habituel du propriétaire : message explicite.
      throw erreur(403, 'Ce compte se connecte uniquement avec sa clé d’accès : utilisez « Se connecter avec une clé d’accès ».', 'cle_requise');
    }
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
    const appareil = appareilConnuPour(ctx, mid), appareilConnu = !!appareil;
    // Réseau : l'adresse, et tout son bloc (IPv4 : /24 ; IPv6 : /48), pour qu'un attaquant ne multiplie pas les essais
    // en changeant d'adresse voisine.
    const ip = reseauIp(ctx.ip), bloc = /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.replace(/\.\d+$/, '.0/24') : ip.includes(':') ? `${ip.split(':').slice(0, 3).join(':')}::/48` : ip;
    const parReseau = [...new Set([`2fa:${mid}|${ip}`, `2fa:${mid}|${bloc}`])];
    // Compteurs globaux : ceux du compte, ou ceux de cet appareil connu (jamais aucun) : un tiers qui épuise les essais
    // du compte ne bloque pas le marchand chez lui, et ne peut pas lui-même dépasser ces plafonds.
    const global = [appareilConnu ? `2fa-appareil:${appareil.empreinte}` : '2fa:' + mid];
    auth.verifierEchecs(parReseau, 5);
    auth.verifierEchecs(global, 10);   // 10 erreurs par quart d'heure…
    auth.limiter(appareilConnu ? `2fa-jour-appareil:${appareil.empreinte}` : `2fa-jour:${mid}`, 30, 86400000, 'Trop d’essais de code aujourd’hui : réessayez demain, ou utilisez un code de secours depuis un appareil déjà connu.');   // …et 30 essais par jour
    auth.noterEchec([...parReseau, ...global]);   // compté avant la vérification (essais parallèles)
    if (!verifierSecondFacteur(df, ctx.corps.code, ctx)) { noterActivite(mid, 'echec-2fa', null, ctx); if (auth.compteEchecs && auth.compteEchecs(parReseau[0]) >= 3) alerterEchecs2fa(m); throw erreur(401, 'Code incorrect.', 'code_2fa'); }
    auth.oublierEchecs(parReseau);
    if (cleSeule(m.id)) throw erreur(403, 'Ce compte se connecte uniquement avec sa clé d’accès : utilisez « Se connecter avec une clé d’accès ».', 'cle_requise');   // option activée après l'envoi du mot de passe
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
    const avant = db.prepare('SELECT email, cle_seule, (SELECT COUNT(*) FROM cles_acces WHERE marchand_id = marchands.id) cles FROM marchands WHERE id = ?').get(ligne.marchand_id);
    // Compte qui exige sa clé d'accès, sans double authentification : la boîte e-mail seule ne doit pas suffire.
    // La récupération n'agit qu'après 72 heures ; d'ici là, le propriétaire peut l'annuler depuis une session ouverte avec sa clé.
    const dfAvant = deuxFacteursDe(ligne.marchand_id);
    if (avant && avant.cle_seule) {   // avec ou sans double authentification : la boîte e-mail seule ne supprime pas les clés
      const effectif = Date.now() + 72 * 3600000;
      transaction(db, () => {
        // Une nouvelle demande ne repousse pas l'échéance (et ne l'avance pas). Le mot de passe actuel est gardé : si le propriétaire le change
        // entre-temps, la récupération n'est pas appliquée.
        db.prepare('INSERT INTO recuperations_differees (marchand_id, mot_de_passe, effectif_le, cree_le, ancien) VALUES (?, ?, ?, ?, (SELECT mot_de_passe FROM marchands WHERE id = ?)) ON CONFLICT(marchand_id) DO UPDATE SET mot_de_passe = excluded.mot_de_passe').run(ligne.marchand_id, hashMdp, effectif, Date.now(), ligne.marchand_id);
        db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(ligne.marchand_id);
      });
      noterActivite(ligne.marchand_id, 'recuperation-demandee', 'par lien e-mail, effective dans 72 h', ctx);
      const effectifReel = db.prepare('SELECT effectif_le FROM recuperations_differees WHERE marchand_id = ?').get(ligne.marchand_id).effectif_le;
      const quand = new Date(effectifReel).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      envoyerEmail(null, avant.email, 'Récupération de votre compte Comptoir dans 72 heures', `Bonjour,\n\nUne récupération de votre compte a été demandée par le lien envoyé à cette adresse. Votre compte n’accepte que votre clé d’accès : pour vous protéger, le nouveau mot de passe ne prendra effet que le ${quand}. Vos clés d’accès seront alors supprimées.\n\nVous retrouvez votre clé d’accès, ou ce n’est pas vous ? Connectez-vous avec elle : la récupération est annulée automatiquement. Si ce n’est pas vous, sécurisez aussi votre boîte e-mail.\n\nL’équipe Comptoir`);
      return { ok: true, differe: effectifReel };
    }
    transaction(db, () => {
      db.prepare('UPDATE marchands SET mot_de_passe = ? WHERE id = ?').run(hashMdp, ligne.marchand_id);
      db.prepare('DELETE FROM sessions WHERE marchand_id = ?').run(ligne.marchand_id);
      oublierAppareils(ligne.marchand_id);
      marquerEmailVerifie(ligne.marchand_id);   // le lien reçu prouve l'adresse ; un compte ouvert par un tiers avec elle lui est repris
      db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(ligne.marchand_id);
      // Compte peut-être compromis : une clé d'accès ajoutée par un tiers ne doit pas survivre à la réinitialisation.
      db.prepare('DELETE FROM cles_acces WHERE marchand_id = ?').run(ligne.marchand_id);
      db.prepare('UPDATE marchands SET cle_seule = 0 WHERE id = ?').run(ligne.marchand_id);   // récupération : clés supprimées, mot de passe de nouveau accepté
    });
    // Connexion directe après la réinitialisation, sauf double authentification ou compte qui exigeait sa clé d'accès :
    // dans ces cas, un accès à la boîte e-mail ne suffit pas à ouvrir une session (il faut se reconnecter).
    { const mr = db.prepare('SELECT id, email FROM marchands WHERE id = ?').get(ligne.marchand_id); const df = deuxFacteursDe(mr.id); if (!(df && df.actif) && !(avant && avant.cle_seule)) ouvrirSession(ctx, mr); }
    noterActivite(ligne.marchand_id, 'mot-de-passe', 'réinitialisé par lien e-mail', ctx);
    if (avant) envoyerEmail(null, avant.email, 'Mot de passe réinitialisé sur votre compte Comptoir', `Bonjour,\n\nLe mot de passe de votre compte vient d’être réinitialisé par le lien envoyé à cette adresse${avant.cles ? ` ; vos ${avant.cles} clé${avant.cles > 1 ? 's' : ''} d’accès ${avant.cles > 1 ? 'ont été supprimées' : 'a été supprimée'}${avant.cle_seule ? ' et la connexion par mot de passe est de nouveau possible' : ''}` : ''}.\n\nCe n’est pas vous ? Quelqu’un a accès à votre boîte e-mail : sécurisez-la, puis réinitialisez à nouveau votre mot de passe et écrivez-nous.\n\nL’équipe Comptoir`);
    return { ok: true, reconnexion: !!(avant && avant.cle_seule) };
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
      annulerRecuperation(m.id, 'mot de passe changé', ctx);
      db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(m.id, actuelle);
      oublierAppareils(m.id, (appareilConnuPour(ctx, m.id) || {}).empreinte);
      db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(m.id);
    });
    noterActivite(m.id, 'mot-de-passe', 'changé depuis l’espace', ctx);
    ajouterCookie(ctx, cookieAppareilPour(ctx, m.id, actuelle));   // cet appareil reste reconnu ; les autres ne le sont plus
    return { ok: true };
  });
  /* Activation des paiements de la boutique (Stripe Connect) : la boutique encaisse sur son propre compte Stripe. */
  const activationsEnCours = new Set();
  r.post('/api/admin/paiements/activer', exigerMarchand, async ctx => {
    if (paiement.nom !== 'stripe') return { pret: true, simulation: true };
    exigerEmailVerifie(ctx, 'activer les versements');
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
      recuperationEnAttente: recuperationEnAttente(ctx.marchand.id), cleSeule: cleSeule(ctx.marchand.id), deuxFacteurs: !!(df && df.actif), codesSecoursRestants: df && df.actif ? JSON.parse(df.secours).length : 0,
      clesAcces: clesAccesDe(ctx.marchand.id).map(c => ({ id: c.id, nom: c.nom, creeLe: c.cree_le, utiliseeLe: c.utilisee_le })),
      sessions: db.prepare('SELECT jeton_hash, cree_le, vu_le, appareil, reseau FROM sessions WHERE marchand_id = ? AND expire_le > ? ORDER BY vu_le DESC').all(ctx.marchand.id, Date.now())
        .map(x => ({ id: x.jeton_hash.slice(0, 16), appareil: x.appareil || 'Appareil', reseau: x.reseau, creeLe: x.cree_le, vuLe: x.vu_le, actuelle: x.jeton_hash === actuelle })),
      journal: db.prepare('SELECT date, type, detail, reseau FROM journal_compte WHERE marchand_id = ? ORDER BY date DESC LIMIT 50').all(ctx.marchand.id),
      bilan: bilanSecurite(ctx)
    };
  });
  /* Bilan de sécurité : ce qui protège le compte et la boutique, et ce qui reste à faire (du plus important au conseil). */
  function bilanSecurite(ctx) {
    const mid = ctx.marchand.id, maintenant = Date.now(), JOUR = 86400000, out = [];
    const ajouter = (ok, niveau, titre, detail, cible = null) => out.push({ ok, niveau, titre, detail, cible });
    const df = deuxFacteursDe(mid), cles = clesAccesDe(mid);
    // Une clé d'accès n'empêche pas la connexion par mot de passe : seule la double authentification protège le mot de passe.
    const fort = !!(df && df.actif) || cleSeule(mid);
    ajouter(fort, 'important', 'Mot de passe complété par un second facteur', fort ? (cleSeule(mid) ? 'Votre compte n’accepte que la clé d’accès : un mot de passe volé ne suffit pas.' : 'Double authentification active : votre mot de passe seul ne suffit pas pour entrer.') : cles.length ? 'Votre clé d’accès protège vos propres connexions, mais quelqu’un qui connaît votre mot de passe peut encore entrer : activez aussi la double authentification.' : 'Avec votre seul mot de passe, quiconque le connaît entre dans votre boutique. Activez la double authentification.', fort ? null : '2fa');
    ajouter(cles.length > 0, 'conseil', 'Clé d’accès (résiste à l’hameçonnage)', cles.length ? `${cles.length} clé${cles.length > 1 ? 's' : ''} enregistrée${cles.length > 1 ? 's' : ''}.` : 'Une clé d’accès ne fonctionne que sur le vrai site de Comptoir : un faux site ne peut pas la voler.', cles.length ? null : 'cles');
    if (df && df.actif) { const n = JSON.parse(df.secours).length; ajouter(n >= 3, 'conseil', 'Codes de secours', n >= 3 ? `${n} codes restants.` : `Plus que ${n} code${n > 1 ? 's' : ''} de secours : renouvelez-les pour ne pas rester bloqué si vous perdez votre téléphone.`, n >= 3 ? null : '2fa'); }
    const echecs = db.prepare("SELECT COUNT(*) n FROM journal_compte WHERE marchand_id = ? AND type IN ('echec-2fa', 'mdp-refuse-cle-seule') AND date > ?").get(mid, maintenant - 7 * JOUR).n;
    ajouter(echecs < 2, 'important', 'Aucune tentative suspecte', echecs >= 2 ? `${echecs} tentative${echecs > 1 ? 's' : ''} avec votre bon mot de passe cette semaine (code faux, ou connexion refusée car votre compte exige sa clé) : quelqu’un connaît peut-être votre mot de passe. Changez-le.` : 'Aucune tentative avec votre mot de passe ces 7 derniers jours (code faux ou connexion refusée).', echecs ? 'mot-de-passe' : null);
    const inactives = db.prepare('SELECT COUNT(*) n FROM sessions WHERE marchand_id = ? AND expire_le > ? AND COALESCE(vu_le, cree_le, 0) < ?').get(mid, maintenant, maintenant - 30 * JOUR).n;
    ajouter(!inactives, 'conseil', 'Appareils inactifs déconnectés', inactives ? `${inactives} appareil${inactives > 1 ? 's' : ''} sans activité depuis plus de 30 jours ${inactives > 1 ? 'sont' : 'est'} encore connecté${inactives > 1 ? 's' : ''} : déconnectez ceux que vous n’utilisez plus.` : 'Aucun appareil connecté oublié.', inactives ? 'appareils' : null);
    if (ctx.role === 'proprietaire') {
      const b = ctx.boutique;
      const membres = db.prepare('SELECT m.id, m.email FROM equipe e JOIN marchands m ON m.id = e.marchand_id WHERE e.boutique_id = ?').all(b.id);
      const faibles = membres.filter(x => { const d = deuxFacteursDe(x.id); return !(d && d.actif) && !cleSeule(x.id); });
      if (membres.length) ajouter(!faibles.length, 'important', 'Équipe protégée', faibles.length ? `${faibles.map(x => x.email).join(', ')} se connecte${faibles.length > 1 ? 'nt' : ''} avec un simple mot de passe : demandez-leur d’activer la double authentification.` : `Les ${membres.length} membre${membres.length > 1 ? 's' : ''} de l’équipe ont une connexion protégée.`, faibles.length ? 'equipe' : null);
      const dormantes = db.prepare('SELECT nom FROM cles_api WHERE boutique_id = ? AND revoquee = 0 AND COALESCE(utilisee_le, cree_le) < ?').all(b.id, maintenant - 90 * JOUR);
      const actives = db.prepare('SELECT COUNT(*) n FROM cles_api WHERE boutique_id = ? AND revoquee = 0').get(b.id).n;
      if (actives) ajouter(!dormantes.length, 'conseil', 'Clés d’API utilisées', dormantes.length ? `${dormantes.length} clé${dormantes.length > 1 ? 's' : ''} d’API inutilisée${dormantes.length > 1 ? 's' : ''} depuis 90 jours (${dormantes.map(x => x.nom).slice(0, 3).join(', ')}) : révoquez-les si elles ne servent plus.` : `${actives} clé${actives > 1 ? 's' : ''} d’API active${actives > 1 ? 's' : ''}, toutes utilisées récemment.`, dormantes.length ? 'integrations' : null);
      const webhooks = db.prepare('SELECT url, actif, echecs_suite FROM webhooks WHERE boutique_id = ?').all(b.id), enPanne = webhooks.filter(w => !w.actif || w.echecs_suite > 0);
      if (webhooks.length) ajouter(!enPanne.length, 'conseil', 'Webhooks en état de marche', enPanne.length ? `${enPanne.length} webhook${enPanne.length > 1 ? 's' : ''} en échec ou en pause : vos outils ne reçoivent plus les commandes.` : 'Tous vos webhooks reçoivent les événements.', enPanne.length ? 'integrations' : null);
      const v = db.prepare('SELECT resultat FROM journal_verifications WHERE boutique_id = ?').get(b.id);
      if (v) { const r2 = JSON.parse(v.resultat); ajouter(r2.ok, 'important', 'Journal des ventes intact', r2.ok ? 'Dernière vérification sans anomalie.' : `${r2.nbAnomalies} anomalie${r2.nbAnomalies > 1 ? 's' : ''} dans le journal inaltérable des ventes.`, r2.ok ? null : 'conformite'); }
    }
    const ordre = { important: 0, conseil: 1 };
    return out.sort((a, b2) => (a.ok - b2.ok) || ordre[a.niveau] - ordre[b2.niveau]);
  }
  r.post('/api/admin/compte/sessions/:id/revoquer', exigerCompte, ctx => {
    const id = String(ctx.params.id).replace(/[^0-9a-f]/g, '').slice(0, 16);
    if (id.length !== 16) throw erreur(400, 'Session inconnue.', 'session');
    const cibles = db.prepare('SELECT jeton_hash FROM sessions WHERE marchand_id = ? AND substr(jeton_hash, 1, 16) = ?').all(ctx.marchand.id, id);
    // L'appareil de la session révoquée n'est plus « connu » : il retrouve les limites d'un inconnu.
    for (const c of cibles) db.prepare('DELETE FROM appareils_connus WHERE marchand_id = ? AND session = ?').run(ctx.marchand.id, c.jeton_hash);
    const n = db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND substr(jeton_hash, 1, 16) = ?').run(ctx.marchand.id, id).changes;
    if (!n) throw erreur(404, 'Session inconnue.', 'session');
    noterActivite(ctx.marchand.id, 'session-revoquee', null, ctx);
    return { ok: true };
  });
  /* ---------- Équipe : le propriétaire invite des collaborateurs (rôle « commandes » ou « complet »). Chacun a son propre
     compte (mot de passe, double authentification, clés d'accès) ; ses actions sur les commandes portent son nom. ---------- */
  const ROLES = { commandes: 'Commandes (préparer, expédier, caisse)', complet: 'Gestion complète (sauf abonnement, équipe, paiements)' };
  r.get('/api/admin/equipe', exigerProprietaire, ctx => ({
    membres: db.prepare('SELECT m.id, m.email, e.role, e.cree_le FROM equipe e JOIN marchands m ON m.id = e.marchand_id WHERE e.boutique_id = ? ORDER BY e.cree_le').all(ctx.boutique.id),
    invitations: db.prepare('SELECT id, email, role, expire_le FROM invitations WHERE boutique_id = ? AND expire_le > ? ORDER BY cree_le').all(ctx.boutique.id, Date.now()),
    roles: ROLES
  }));
  r.post('/api/admin/equipe/inviter', exigerProprietaire, ctx => {
    exigerIdentite(ctx);
    const email = valider.email(ctx.corps.email).toLowerCase(), role = String(ctx.corps.role || '');
    if (!ROLES[role]) throw erreur(400, 'Rôle inconnu.', 'role');
    exigerEmailVerifie(ctx, 'inviter votre équipe');
    { const e = abo.etat(ctx.marchand.id); if (e.obligatoire && !e.actif) throw erreur(402, 'Inviter une équipe demande un abonnement actif.', 'abonnement_requis'); }
    auth.limiter('invitation-ip:' + ctx.ip, 30 * facteurLimites, 86400000, 'Trop d’invitations aujourd’hui.');
    auth.limiter('invitation:' + ctx.boutique.id, 20, 86400000, 'Trop d’invitations aujourd’hui.');
    if (db.prepare('SELECT 1 FROM marchands WHERE email = ?').get(email)) throw erreur(409, 'Cette adresse a déjà un compte Comptoir : invitez une autre adresse (un compte ne sert qu’à une boutique).', 'email_pris');
    if (db.prepare('SELECT COUNT(*) n FROM equipe WHERE boutique_id = ?').get(ctx.boutique.id).n + db.prepare('SELECT COUNT(*) n FROM invitations WHERE boutique_id = ? AND expire_le > ?').get(ctx.boutique.id, Date.now()).n >= 5) throw erreur(409, '5 membres au plus dans l’équipe.', 'equipe_pleine');
    db.prepare('DELETE FROM invitations WHERE boutique_id = ? AND email = ?').run(ctx.boutique.id, email);
    const jeton = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO invitations (id, jeton_hash, boutique_id, email, role, expire_le, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(auth.nouvelId('inv_'), auth.sha256(jeton), ctx.boutique.id, email, role, Date.now() + 7 * 86400000, Date.now());
    const nom = lireConfig(ctx.boutique).boutique.nom;
    envoyerEmail(null, email, `Invitation à rejoindre ${nom} sur Comptoir`, `Bonjour,\n\n${ctx.marchand.email} vous invite à rejoindre l’équipe de la boutique ${nom} sur Comptoir, avec le rôle : ${ROLES[role]}.\n\nPour accepter, choisissez votre mot de passe ici (lien valable 7 jours) :\n${urlPublique}/app?invitation=${jeton}\n\nVous ne connaissez pas cette boutique ? Ignorez cet e-mail.\n\nL’équipe Comptoir`);
    noterActivite(ctx.marchand.id, 'membre-invite', `${email} (${role})`, ctx);
    return { statut: 201, corps: { ok: true } };
  });
  r.post('/api/admin/equipe/invitations/:id/annuler', exigerProprietaire, ctx => { db.prepare('DELETE FROM invitations WHERE id = ? AND boutique_id = ?').run(String(ctx.params.id), ctx.boutique.id); return { ok: true }; });
  r.post('/api/admin/equipe/:id/retirer', exigerProprietaire, ctx => {
    const m = db.prepare('SELECT m.email FROM equipe e JOIN marchands m ON m.id = e.marchand_id WHERE e.marchand_id = ? AND e.boutique_id = ?').get(String(ctx.params.id), ctx.boutique.id);
    if (!m) throw erreur(404, 'Membre inconnu.', 'introuvable');
    // Le compte du membre est supprimé (il ne servait qu'à cette boutique) : sessions, clés d'accès et notifications avec lui.
    db.prepare('DELETE FROM marchands WHERE id = ?').run(String(ctx.params.id));
    db.prepare('DELETE FROM emails WHERE boutique_id IS NULL AND lower(destinataire) = ?').run(String(m.email).toLowerCase());
    noterActivite(ctx.marchand.id, 'membre-retire', m.email, ctx);
    return { ok: true };
  });
  // Invitation : lecture (pour l'écran d'accueil) et acceptation (création du compte du membre)
  const invitationDe = jeton => db.prepare('SELECT i.*, b.config FROM invitations i JOIN boutiques b ON b.id = i.boutique_id WHERE i.jeton_hash = ? AND i.expire_le > ?').get(auth.sha256(String(jeton || '')), Date.now());
  r.get('/api/auth/invitation', ctx => {
    auth.limiter('invitation-lecture:' + ctx.ip, 30 * facteurLimites, 15 * 60000, 'Trop de requêtes.');
    const i = invitationDe(ctx.query.get('jeton'));
    if (!i) throw erreur(404, 'Invitation expirée ou déjà utilisée. Demandez-en une nouvelle au propriétaire de la boutique.', 'invitation');
    return { email: i.email, role: ROLES[i.role], boutique: JSON.parse(i.config).boutique.nom };
  });
  r.post('/api/auth/invitation', async ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const mdp = valider.texte(ctx.corps.motDePasse, 'Le mot de passe', { min: 10, max: 200 });
    const i = invitationDe(ctx.corps.jeton);
    if (!i) throw erreur(404, 'Invitation expirée ou déjà utilisée. Demandez-en une nouvelle au propriétaire de la boutique.', 'invitation');
    await exigerMotDePasseSolide(mdp, { email: i.email, noms: [JSON.parse(i.config).boutique.nom] });
    const hash = await auth.hacherMotDePasse(mdp);
    const id = auth.nouvelId('m_');
    transaction(db, () => {
      if (!db.prepare('DELETE FROM invitations WHERE id = ? RETURNING id').get(i.id)) throw erreur(404, 'Invitation déjà utilisée.', 'invitation');   // usage unique
      if (db.prepare('SELECT 1 FROM marchands WHERE email = ?').get(i.email)) throw erreur(409, 'Cette adresse a déjà un compte Comptoir.', 'email_pris');
      db.prepare('INSERT INTO marchands (id, email, mot_de_passe, cree_le, email_verifie_le) VALUES (?, ?, ?, ?, ?)').run(id, i.email, hash, Date.now(), Date.now());   // le lien d'invitation prouve l'adresse
      db.prepare('INSERT INTO equipe (marchand_id, boutique_id, role, cree_le) VALUES (?, ?, ?, ?)').run(id, i.boutique_id, i.role, Date.now());
    });
    const proprio = db.prepare('SELECT m.id, m.email FROM boutiques b JOIN marchands m ON m.id = b.marchand_id WHERE b.id = ?').get(i.boutique_id);
    if (proprio) { noterActivite(proprio.id, 'membre-arrive', i.email, ctx); envoyerEmail(null, proprio.email, `${i.email} a rejoint votre équipe`, `Bonjour,\n\n${i.email} a accepté votre invitation et rejoint l’équipe de ${JSON.parse(i.config).boutique.nom} (rôle : ${ROLES[i.role]}).\n\nVous pouvez retirer cet accès à tout moment dans Paramètres > Équipe.\n${urlPublique}/app\n\nL’équipe Comptoir`); }
    ouvrirSession(ctx, db.prepare('SELECT * FROM marchands WHERE id = ?').get(id));
    return { statut: 201, corps: { ok: true } };
  });

  /* ---------- Exploitant de la plateforme : santé (surveillance externe) et console privée ----------
     /sante : réponse minimale pour un service de surveillance (UptimeRobot, Better Stack…), sans donnée sensible.
     /operateur : réservé aux adresses de OPERATEUR_EMAILS, connectées ET protégées par double authentification ou
     clé d'accès ; chiffres agrégés seulement (aucune donnée de client final). */
  const demarreLe = Date.now();
  r.get('/sante', () => {
    let ok = true; try { db.prepare('SELECT 1').get(); } catch { ok = false; }
    return { statut: ok ? 200 : 503, corps: { ok, depuis: Math.round((Date.now() - demarreLe) / 1000) } };
  });
  const operateurs = String(env.OPERATEUR_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  /* Bilan de sécurité de la plateforme (console de l'exploitant) : chaque ligne dit si quelque chose demande une action,
     et laquelle. Aucune donnée de client final, aucun secret : seulement des comptes et des dates. */
  function bilanSecuriteExploitant(maintenant = Date.now()) {
    const n = (sql, ...a) => db.prepare(sql).get(...a).n, j = 86400000;
    const etatJ = JV().etat(''), rotations = (() => { try { return JSON.parse((db.prepare("SELECT valeur FROM journal_meta WHERE cle = 'rotations'").get() || {}).valeur || '[]'); } catch { return []; } })();
    // Comptes de propriétaires seulement (comme la ligne « Comptes marchands » au-dessus), comptes de l'exploitant exclus.
    const horsEquipe = `id NOT IN (SELECT marchand_id FROM equipe)${operateurs.length ? ` AND lower(email) NOT IN (${operateurs.map(() => '?').join(', ')})` : ''}`;
    const comptes = n(`SELECT COUNT(*) n FROM marchands WHERE ${horsEquipe}`, ...operateurs);
    const proteges = n(`SELECT COUNT(*) n FROM marchands m WHERE ${horsEquipe} AND (EXISTS (SELECT 1 FROM deux_facteurs d WHERE d.marchand_id = m.id AND d.actif = 1) OR m.cle_seule = 1)`, ...operateurs);
    const webhooksIllisibles = integ.secretsIllisibles();
    const illisibles = etatSecurite.commandesIllisibles + etatSecurite.secrets2faIllisibles + webhooksIllisibles;
    const aRembourser = n("SELECT COUNT(*) n FROM paiements WHERE statut = 'a_rembourser'");
    const nonConfirmees = n('SELECT COUNT(*) n FROM marchands WHERE email_verifie_le IS NULL AND cree_le < ?', maintenant - 7 * j);
    const echecs2fa = n("SELECT COUNT(*) n FROM journal_compte WHERE type = 'echec-2fa' AND date > ?", maintenant - j);
    return [
      { titre: 'Clé de chiffrement', valeur: etatSecurite.cleHorsBase ? 'hors de la base (SECRET_CHIFFREMENT)' : 'GARDÉE DANS LA BASE', alerte: !etatSecurite.cleHorsBase,
        conseil: etatSecurite.cleHorsBase ? '' : 'Une copie volée de la base suffirait à lire les données des clients : définissez SECRET_CHIFFREMENT (rotation décrite dans MISE-EN-LIGNE.md).' },
      { titre: 'Anciennes clés et rotations', valeur: `${etatSecurite.anciennesCles} ancienne${etatSecurite.anciennesCles > 1 ? 's' : ''} clé${etatSecurite.anciennesCles > 1 ? 's' : ''} · ${rotations.length} rotation${rotations.length > 1 ? 's' : ''}${rotations.length ? ` (dernière le ${new Date(rotations.at(-1).le).toLocaleDateString('fr-CH', { timeZone: 'Europe/Zurich' })})` : ''}`, alerte: etatJ.cleChangee,
        conseil: etatJ.cleChangee ? 'La clé qui signe les journaux des ventes a changé sans que l’ancienne soit gardée : remettez-la dans SECRET_CHIFFREMENT_ANCIENNES.' : '' },
      { titre: 'Données illisibles avec les clés connues (commandes et double authentification : au démarrage)', valeur: illisibles ? `${etatSecurite.commandesIllisibles} commande(s) · ${etatSecurite.secrets2faIllisibles} secret(s) de double authentification · ${webhooksIllisibles} secret(s) de webhook` : 'aucune', alerte: illisibles > 0,
        conseil: illisibles ? 'Une ancienne clé manque : ajoutez-la à SECRET_CHIFFREMENT_ANCIENNES et redémarrez (rien n’a été écrasé).' : '' },
      { titre: 'Comptes marchands protégés (double authentification ou clé d’accès exigée)', valeur: `${proteges} / ${comptes}${comptes ? ` (${Math.round(proteges / comptes * 100)} %)` : ''}`, alerte: false },
      { titre: 'Adresses e-mail non confirmées depuis plus de 7 jours', valeur: nonConfirmees, alerte: false },
      { titre: 'Codes de vérification refusés (24 h)', valeur: echecs2fa, alerte: echecs2fa >= 20, conseil: echecs2fa >= 20 ? 'Beaucoup de codes refusés : une attaque sur des mots de passe connus est possible (les marchands concernés sont prévenus par e-mail).' : '' },
      (() => {
        // Sauvegardes : chacune est restaurée à l'essai avant d'être gardée (voir sauvegarde.js) ; plus de 30 heures sans
        // sauvegarde vérifiée, ou une dernière tentative en échec, demandent une action.
        const e = (() => { try { return JSON.parse((db.prepare("SELECT valeur FROM cles WHERE nom = 'sauvegarde-etat'").get() || {}).valeur || '{}'); } catch { return {}; } })();
        if (env.SAUVEGARDE === 'non') return { titre: 'Sauvegardes', valeur: 'désactivées (SAUVEGARDE=non)', alerte: true, conseil: 'Sans sauvegarde, une panne de disque efface toutes les boutiques.' };
        const h = e.reussie ? Math.round((maintenant - e.reussie) / 3600000) : null;
        const alerte = e.ok === false || !e.reussie || maintenant - e.reussie > 30 * 3600000;
        return { titre: 'Sauvegardes (restaurées à l’essai)', valeur: e.reussie ? `dernière vérifiée il y a ${h} h · ${e.chiffree ? 'chiffrée' : 'NON chiffrée'}${typeof e.commandes === 'number' ? ` · ${e.commandes} commandes` : ''}${e.ok === false ? ' · DERNIÈRE TENTATIVE EN ÉCHEC' : ''}` : (e.ok === false ? 'ÉCHEC, aucune sauvegarde vérifiée' : 'aucune encore'), alerte: alerte || (e.reussie && !e.chiffree),
          conseil: e.ok === false ? `Dernière erreur : ${e.erreur}. Vérifiez l’espace disque et les droits du dossier des sauvegardes.` : !e.reussie ? 'La première sauvegarde a lieu une minute après le démarrage, puis toutes les 6 heures.' : maintenant - e.reussie > 30 * 3600000 ? 'Plus de 30 heures sans sauvegarde vérifiée : le serveur a-t-il redémarré, le disque est-il plein ?' : !e.chiffree ? 'Définissez SAUVEGARDE_CLE pour chiffrer les copies envoyées hors du serveur.' : '' };
      })(),
      { titre: 'Paiements reçus à rembourser', valeur: aRembourser, alerte: aRembourser > 0, conseil: aRembourser ? 'Paiements reçus pour une commande annulée, déjà payée ou non conforme : vérifiez qu’ils ont bien été rendus (Stripe).' : '' }
    ];
  }
  r.get('/operateur', ctx => {
    const m = auth.marchandDepuisRequete(db, ctx.cookies);
    const df = m && deuxFacteursDe(m.id);
    // Double authentification exigée (une clé d'accès seule laisserait la connexion par mot de passe sans second facteur)
    const fort = m && df && df.actif;
    if (!m || !operateurs.includes(String(m.email).toLowerCase())) throw erreur(404, 'Page introuvable.', 'introuvable');   // n'existe pas pour les autres
    if (!fort) return { html: pageSimple('Console de l’exploitant', 'Activez d’abord la double authentification (application de codes) sur ce compte, dans Paramètres > Sécurité : la console donne une vue sur toute la plateforme.') };
    // Preuve que l'adresse appartient bien à l'exploitant (l'inscription ne vérifie pas l'e-mail) : lien unique reçu par e-mail.
    const signature = crypto.createHmac('sha256', cleDesinscription).update(`operateur|${m.id}|${String(m.email).toLowerCase()}`).digest('base64url');
    const cleVerif = `operateur:${m.id}`;
    if (!db.prepare('SELECT 1 FROM cles WHERE nom = ? AND valeur = ?').get(cleVerif, String(m.email).toLowerCase())) {
      if (ctx.query.get('verifier') && auth.egal(String(ctx.query.get('verifier')), signature)) db.prepare('INSERT OR REPLACE INTO cles (nom, valeur) VALUES (?, ?)').run(cleVerif, String(m.email).toLowerCase());
      else {
        try { auth.limiter('operateur-lien:' + m.id, 1, 3600000, ''); envoyerEmail(null, m.email, 'Console Comptoir : confirmez votre adresse', `Bonjour,\n\nPour ouvrir la console de l'exploitant, confirmez que cette adresse est bien la vôtre (connecté sur le même navigateur) :\n${urlPublique}/operateur?verifier=${signature}\n\nVous n'avez rien demandé ? Changez le mot de passe de ce compte.\n\nComptoir`); } catch { /* lien déjà envoyé il y a moins d'une heure */ }
        return { html: pageSimple('Console de l’exploitant', 'Un lien de confirmation vient d’être envoyé à l’adresse de ce compte. Ouvrez-le dans ce navigateur pour accéder à la console.') };
      }
    }
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    const j = 86400000, maintenant = Date.now();
    const abos = db.prepare("SELECT formule, devise, COUNT(*) n FROM abonnements WHERE statut = 'actif' GROUP BY formule, devise").all();
    const mrr = {}; for (const a of abos) mrr[a.devise] = (mrr[a.devise] || 0) + a.n * ((Formules.FORMULES[a.formule] || {}).prix || 0);
    const ventes = d => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(json_extract(donnees, '$.total') - COALESCE((SELECT SUM(json_extract(r.value, '$.montant')) FROM json_each(donnees, '$.retoursPartiels') r), 0) / 100.0), 0) t FROM commandes WHERE date > ? AND statut NOT IN ('attente', 'annulee', 'remboursee')").get(maintenant - d * j);
    const volumeParDevise = db.prepare("SELECT COALESCE(json_extract(b.config, '$.boutique.devise'), 'EUR') AS devise, SUM(json_extract(c.donnees, '$.total') - COALESCE((SELECT SUM(json_extract(r.value, '$.montant')) FROM json_each(c.donnees, '$.retoursPartiels') r), 0) / 100.0) AS t FROM commandes c JOIN boutiques b ON b.id = c.boutique_id WHERE c.date > ? AND c.statut NOT IN ('attente', 'annulee', 'remboursee') GROUP BY devise").all(maintenant - 30 * j);
    const v1 = ventes(1), v7 = ventes(7), v30 = ventes(30);
    let sauvegarde = 'aucune';
    try {
      const dossier = env.SAUVEGARDE_DOSSIER || path.join(path.dirname(env.BASE_DE_DONNEES || path.join(__dirname, '..', 'donnees', 'comptoir.db')), 'sauvegardes');
      const f = fs.readdirSync(dossier).filter(x => /^comptoir-\d{4}-\d{2}-\d{2}\.db(\.enc)?$/.test(x)).sort().pop();
      if (f) { const st = fs.statSync(path.join(dossier, f)); sauvegarde = `${f} · ${Math.round(st.size / 1024)} Ko · il y a ${Math.round((maintenant - st.mtimeMs) / 3600000)} h${f.endsWith('.enc') ? ' · chiffrée' : ' · NON chiffrée'}`; }
    } catch { /* dossier absent */ }
    const lignes = [
      ['Comptes marchands', n('SELECT COUNT(*) n FROM marchands WHERE id NOT IN (SELECT marchand_id FROM equipe)')],
      ['Membres d’équipe', n('SELECT COUNT(*) n FROM equipe')],
      ['Inscriptions (7 derniers jours)', n('SELECT COUNT(*) n FROM marchands WHERE cree_le > ?', maintenant - 7 * j)],
      ['Abonnements actifs', abos.map(a => `${a.n} ${Formules.FORMULES[a.formule] ? Formules.FORMULES[a.formule].nom : a.formule} (${a.devise})`).join(' · ') || '0'],
      ['Revenu mensuel récurrent', Object.entries(mrr).map(([dv, x]) => `${dv} ${x.toLocaleString('fr-CH')}`).join(' · ') || '0'],
      ['Abonnements impayés', n("SELECT COUNT(*) n FROM abonnements WHERE statut = 'impaye'")],
      ['Commandes 24 h / 7 j / 30 j', `${v1.n} / ${v7.n} / ${v30.n}`],
      ['Volume vendu par les boutiques (30 j, hors remboursements)', volumeParDevise.map(x => `${x.devise} ${Math.round(x.t).toLocaleString('fr-CH')}`).join(' · ') || '0'],
      ['E-mails en file / abandonnés', `${n('SELECT COUNT(*) n FROM emails WHERE envoye = 0 AND tentatives < 12')} / ${n('SELECT COUNT(*) n FROM emails WHERE envoye = 0 AND tentatives >= 12')}`],
      ['Webhooks en attente / en pause', `${n("SELECT COUNT(*) n FROM webhook_envois WHERE statut = 'attente'")} / ${n('SELECT COUNT(*) n FROM webhooks WHERE actif = 0')}`],
      ['Appareils avec notifications', n('SELECT COUNT(*) n FROM abonnements_push')],
      ['Dernière sauvegarde', sauvegarde],
      ['Journaux des ventes', (() => {
        // Boutiques existantes seulement (une boutique supprimée garde son journal archivé, sans compter ici).
        const v = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(json_extract(v.resultat, '$.ok')), 0) ok FROM journal_verifications v JOIN boutiques b ON b.id = v.boutique_id").get();
        const etatJ = JV().etat('');
        return `${v.n} boutique${v.n > 1 ? 's' : ''} vérifiée${v.n > 1 ? 's' : ''} · ${v.ok} intacte${v.ok > 1 ? 's' : ''} · ${v.n - v.ok} avec anomalie${etatJ.cleChangee ? ' · CLÉ DE SIGNATURE CHANGÉE : remettez l’ancienne SECRET_CHIFFREMENT' : ''}${/^[0-9a-f]{64}$/i.test(env.SECRET_CHIFFREMENT || '') ? '' : ' · clé gardée dans la base (définissez SECRET_CHIFFREMENT)'}`;
      })()],
      ['Violations de sécurité signalées (7 j)', (() => {
        const t = db.prepare('SELECT directive, bloque, COUNT(DISTINCT reseau) n FROM csp_rapports WHERE le > ? GROUP BY directive, bloque ORDER BY n DESC LIMIT 3').all(maintenant - 7 * j);
        const total = n('SELECT COUNT(*) n FROM csp_rapports WHERE le > ?', maintenant - 7 * j);
        return total ? `${total} · ${t.map(x => `${x.directive} ← ${x.bloque} (${x.n} réseau${x.n > 1 ? 'x' : ''})`).join(' · ')}` : 'aucune';
      })()],
            ['En marche depuis', `${Math.round((maintenant - demarreLe) / 3600000)} h · Node ${process.version}`]
    ];
    noterActivite(m.id, 'console-operateur', null, ctx);
    const securite = bilanSecuriteExploitant(maintenant);
    const tableSecurite = `<h2>Sécurité</h2><table class="tab-console">${securite.map(x => `<tr${x.alerte ? ' class="alerte"' : ''}><td>${escHtml(x.titre)}</td><td class="d"><b>${escHtml(String(x.valeur))}</b>${x.conseil ? `<br><span>${escHtml(x.conseil)}</span>` : ''}</td></tr>`).join('')}</table>`;
    return { html: pageSimple('Console de l’exploitant', 'Chiffres agrégés de la plateforme, sans donnée de client final.', `<table class="tab-console">${lignes.map(([k, v]) => `<tr><td>${escHtml(k)}</td><td class="d"><b>${escHtml(String(v))}</b></td></tr>`).join('')}</table>${tableSecurite}`) };
  });

  /* ---------- Rapports de violation de la politique de sécurité (CSP) ----------
     Le navigateur signale chaque script, style ou ressource qu'il a bloqué : un pic révèle une tentative d'injection
     ou une extension qui modifie les pages. Rien de personnel n'est gardé : la page sans sa requête (« ?… »), l'origine
     de ce qui a été bloqué, la règle. 30 jours, 5000 rapports au plus. */
  db.exec('CREATE TABLE IF NOT EXISTS csp_rapports (le INTEGER NOT NULL, directive TEXT NOT NULL, bloque TEXT NOT NULL, page TEXT NOT NULL)');
  try { db.exec('ALTER TABLE csp_rapports ADD COLUMN reseau TEXT'); } catch { /* déjà là */ }
  // Règles connues seulement (un texte inventé n'entre pas dans la console de l'exploitant).
  const DIRECTIVES_CSP = new Set(['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'img-src', 'font-src', 'connect-src', 'media-src', 'object-src', 'frame-src', 'child-src', 'worker-src', 'manifest-src', 'form-action', 'frame-ancestors', 'base-uri', 'require-trusted-types-for', 'trusted-types']);
  const empreinteReseau = ip => crypto.createHmac('sha256', cleDesinscription).update('csp|' + ip).digest('hex').slice(0, 12);   // réseau compté, jamais gardé en clair
  // Page : origine et premier segment du chemin seulement (pas d'identifiant de commande ou de facture).
  const sansRequete = u => { try { const x = new URL(String(u)); if (!/^https?:$/.test(x.protocol)) return x.protocol.replace(':', ''); const seg = x.pathname.split('/').filter(Boolean); return `${x.origin}/${seg[0] || ''}${seg.length > 1 ? '/…' : ''}`.slice(0, 120); } catch { return 'invalide'; } };
  const origineSeule = u => { try { const x = new URL(String(u)); return (/^https?:$/.test(x.protocol) ? x.origin : x.protocol.replace(':', '')).slice(0, 100); } catch { return /^(inline|eval|wasm-eval|trusted-types-policy|trusted-types-sink)$/.test(String(u)) ? String(u) : 'invalide'; } };
  r.post('/csp-rapport', ctx => {
    try { auth.limiter('csp:' + reseauIp(ctx.ip), 30 * facteurLimites, 10 * 60000, ''); auth.limiter('csp-global', 2000 * facteurLimites, 3600000, ''); } catch { return { ok: true }; }   // au-delà (par réseau, ou 2000 par heure en tout) : ignorés
    let d; try { d = JSON.parse(ctx.corpsBrut || 'null'); } catch { return { ok: true }; }
    const rapports = Array.isArray(d) ? d.filter(x => x && x.type === 'csp-violation').map(x => x.body || {}) : d && d['csp-report'] ? [d['csp-report']] : [];
    const ins = db.prepare('INSERT INTO csp_rapports (le, directive, bloque, page, reseau) VALUES (?, ?, ?, ?, ?)');
    const reseau = empreinteReseau(reseauIp(ctx.ip));
    for (const x of rapports.slice(0, 10)) {
      const directive = String(x.effectiveDirective || x['effective-directive'] || x['violated-directive'] || '').split(' ')[0].slice(0, 40);
      if (!DIRECTIVES_CSP.has(directive)) continue;
      const bloque = origineSeule(x.blockedURL || x['blocked-uri'] || 'inline');
      // Une même violation (règle, origine) depuis un même réseau : comptée une fois par jour (un réseau ne gonfle pas les chiffres).
      if (db.prepare('SELECT 1 FROM csp_rapports WHERE reseau = ? AND directive = ? AND bloque = ? AND le > ?').get(reseau, directive, bloque, Date.now() - 86400000)) continue;
      ins.run(Date.now(), directive, bloque, sansRequete(x.documentURL || x['document-uri'] || ''), reseau);
    }
    if (Math.random() < 0.02) { db.prepare('DELETE FROM csp_rapports WHERE le < ?').run(Date.now() - 30 * 86400000); db.prepare('DELETE FROM csp_rapports WHERE rowid NOT IN (SELECT rowid FROM csp_rapports ORDER BY le DESC LIMIT 5000)').run(); }
    return { ok: true };
  });

  /* ---------- Notifications push (Web Push) : une alerte sur le téléphone ou l'ordinateur du marchand à chaque
     commande payée, même application fermée. Le message est chiffré pour l'appareil (le service push ne le lit pas). ---------- */
  db.exec('CREATE TABLE IF NOT EXISTS abonnements_push (endpoint TEXT PRIMARY KEY, marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, appareil TEXT, cree_le INTEGER NOT NULL)');
  try { db.exec('ALTER TABLE abonnements_push ADD COLUMN session TEXT'); } catch { /* déjà là */ }
  if (!db.prepare("SELECT 1 FROM cles WHERE nom = 'vapid'").get()) db.prepare("INSERT INTO cles (nom, valeur) VALUES ('vapid', ?)").run(JSON.stringify(WebPush.genererClesVapid()));
  const vapid = { ...JSON.parse(db.prepare("SELECT valeur FROM cles WHERE nom = 'vapid'").get().valeur), sujet: env.EXPLOITANT_EMAIL ? `mailto:${env.EXPLOITANT_EMAIL}` : urlPublique };
  // Propriétaire et membres de l'équipe (chacun sur ses appareils abonnés)
  const notifierEquipe = async (boutique, message) => { for (const id of [boutique.marchand_id, ...db.prepare('SELECT marchand_id FROM equipe WHERE boutique_id = ?').all(boutique.id).map(x => x.marchand_id)]) await notifierPush(id, message); };
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
  db.exec('CREATE TABLE IF NOT EXISTS recuperations_differees (marchand_id TEXT PRIMARY KEY REFERENCES marchands(id) ON DELETE CASCADE, mot_de_passe TEXT NOT NULL, effectif_le INTEGER NOT NULL, cree_le INTEGER NOT NULL)');
  try { db.exec('ALTER TABLE recuperations_differees ADD COLUMN ancien TEXT'); } catch { /* déjà là */ }
  // Le propriétaire a agi entre-temps (connexion avec sa clé, mot de passe changé, option ou double authentification modifiée) : la demande tombe.
  const annulerRecuperation = (mid, raison, ctx) => { if (db.prepare('DELETE FROM recuperations_differees WHERE marchand_id = ?').run(mid).changes) { noterActivite(mid, 'recuperation-annulee', raison, ctx); const m = db.prepare('SELECT email FROM marchands WHERE id = ?').get(mid); if (m) envoyerEmail(null, m.email, 'Récupération de votre compte annulée', `Bonjour,\n\nLa récupération de votre compte demandée par e-mail est annulée (${raison}) : rien n’a changé.\n\nSi vous n’aviez rien demandé, quelqu’un a accès à votre boîte e-mail : sécurisez-la.\n\nL’équipe Comptoir`); } };
  /* Récupérations différées arrivées à échéance : nouveau mot de passe, clés supprimées, option désactivée, sessions fermées. */
  function appliquerRecuperations(maintenant = Date.now()) {
    for (const r2 of db.prepare('SELECT * FROM recuperations_differees WHERE effectif_le <= ?').all(maintenant)) {
      const m = db.prepare('SELECT email, mot_de_passe, cle_seule FROM marchands WHERE id = ?').get(r2.marchand_id);
      // Situation changée depuis la demande : rien n'est appliqué.
      if (!m || !m.cle_seule || (r2.ancien && r2.ancien !== m.mot_de_passe)) { db.prepare('DELETE FROM recuperations_differees WHERE marchand_id = ?').run(r2.marchand_id); continue; }
      transaction(db, () => {
        db.prepare('UPDATE marchands SET mot_de_passe = ?, cle_seule = 0 WHERE id = ?').run(r2.mot_de_passe, r2.marchand_id);
        db.prepare('DELETE FROM cles_acces WHERE marchand_id = ?').run(r2.marchand_id);
        db.prepare('DELETE FROM sessions WHERE marchand_id = ?').run(r2.marchand_id);
        oublierAppareils(r2.marchand_id);
        db.prepare('DELETE FROM recuperations_differees WHERE marchand_id = ?').run(r2.marchand_id);
      });
      noterActivite(r2.marchand_id, 'recuperation-appliquee', null, null);
      if (m) envoyerEmail(null, m.email, 'Votre compte Comptoir a été récupéré', 'Bonjour,\n\nLa récupération demandée par e-mail est faite : votre nouveau mot de passe est actif, vos clés d’accès ont été supprimées et tous vos appareils déconnectés.\n\nCe n’est pas vous ? Écrivez-nous tout de suite.\n\nL’équipe Comptoir');
    }
  }
  const recuperationEnAttente = mid => (db.prepare('SELECT effectif_le FROM recuperations_differees WHERE marchand_id = ?').get(mid) || {}).effectif_le || null;
  r.post('/api/admin/compte/recuperation/annuler', exigerCompte, ctx => {
    const avant = !!recuperationEnAttente(ctx.marchand.id);
    annulerRecuperation(ctx.marchand.id, 'annulée par vous', ctx);
    return { annulee: avant };
  });
  /* « Exiger la clé d'accès » : la connexion par mot de passe est refusée ; seule une clé d'accès ouvre une session
     (résiste à l'hameçonnage : un mot de passe volé ne suffit plus). Récupération : le lien de réinitialisation par e-mail. */
  try { db.exec('ALTER TABLE marchands ADD COLUMN cle_seule INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
  const cleSeule = mid => !!(db.prepare('SELECT cle_seule FROM marchands WHERE id = ?').get(mid) || {}).cle_seule;
  r.post('/api/admin/compte/cle-seule', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    const df = deuxFacteursDe(m.id);
    if (df && df.actif) {
      auth.limiter('2fa-gestion:' + m.id, 5 * facteurLimites, 15 * 60000, 'Trop d’essais : réessayez dans 15 minutes.');
      if (!verifierSecondFacteur(df, String(ctx.corps.code || ''), ctx)) throw erreur(401, 'Code de vérification requis ou incorrect.', 'code_2fa');
    }
    const actif = !!ctx.corps.actif;
    if (actif && !clesAccesDe(m.id).length) throw erreur(409, 'Ajoutez d’abord une clé d’accès (de préférence deux, sur deux appareils).', 'sans_cle');
    db.prepare('UPDATE marchands SET cle_seule = ? WHERE id = ?').run(actif ? 1 : 0, m.id);
    annulerRecuperation(m.id, 'option « Exiger la clé d’accès » modifiée', ctx);
    // Activation : les sessions ouvertes par mot de passe sur d'autres appareils sont fermées (un tiers déjà connecté ne reste pas).
    const fermees = actif ? db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ? AND cle_acces IS NULL').run(m.id, auth.sha256(String(ctx.cookies[auth.COOKIE] || ''))).changes : 0;
    noterActivite(m.id, actif ? 'cle-seule-activee' : 'cle-seule-desactivee', null, ctx);
    envoyerEmail(null, m.email, actif ? 'Votre compte Comptoir n’accepte plus que la clé d’accès' : 'Connexion par mot de passe réactivée sur votre compte Comptoir',
      actif ? `Bonjour,\n\nVotre compte n’accepte plus la connexion par mot de passe : seule une clé d’accès ouvre une session.${fermees ? ` ${fermees} autre${fermees > 1 ? 's' : ''} appareil${fermees > 1 ? 's' : ''} connecté${fermees > 1 ? 's' : ''} par mot de passe ${fermees > 1 ? 'ont été déconnectés' : 'a été déconnecté'}.` : ''} Si vous perdez toutes vos clés, utilisez « Mot de passe oublié » : le lien reçu par e-mail rétablit l’accès après 72 heures (vos clés sont alors supprimées ; une connexion avec une clé annule la demande).\n\nCe n’est pas vous ? Changez votre mot de passe et écrivez-nous.\n\nL’équipe Comptoir`
        : 'Bonjour,\n\nLa connexion par mot de passe a été réactivée sur votre compte.\n\nCe n’est pas vous ? Changez votre mot de passe tout de suite et écrivez-nous.\n\nL’équipe Comptoir');
    return { cleSeule: actif };
  });
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
    // Mêmes exigences que pour désactiver « Exiger la clé d'accès » : code de double authentification, et pas la dernière clé tant que l'option est active.
    const df = deuxFacteursDe(m.id);
    if (df && df.actif) {
      auth.limiter('2fa-gestion:' + m.id, 5 * facteurLimites, 15 * 60000, 'Trop d’essais : réessayez dans 15 minutes.');
      if (!verifierSecondFacteur(df, String(ctx.corps.code || ''), ctx)) throw erreur(401, 'Code de vérification requis ou incorrect.', 'code_2fa');
    }
    if (cleSeule(m.id) && clesAccesDe(m.id).length <= 1) throw erreur(409, 'C’est votre dernière clé d’accès et votre compte l’exige : réactivez d’abord la connexion par mot de passe.', 'derniere_cle');
    const c = db.prepare('DELETE FROM cles_acces WHERE id = ? AND marchand_id = ? RETURNING nom').get(String(ctx.params.id), m.id);
    if (!c) throw erreur(404, 'Clé d’accès inconnue.', 'introuvable');
    db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND cle_acces = ?').run(m.id, String(ctx.params.id));   // appareils connectés avec cette clé
    noterActivite(m.id, 'cle-acces-supprimee', c.nom, ctx);
    envoyerEmail(null, m.email, 'Clé d’accès supprimée de votre compte Comptoir', `Bonjour,\n\nLa clé d’accès « ${c.nom} » vient d’être supprimée de votre compte.\n\nCe n’est pas vous ? Changez votre mot de passe tout de suite et écrivez-nous.\n\nL’équipe Comptoir`);
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
    const appareilConnu = !!appareilConnuPour(ctx, m.id);
    const jeton = ouvrirSession(ctx, m, { nouvelAppareil: !appareilConnu });
    db.prepare('UPDATE sessions SET cle_acces = ? WHERE jeton_hash = ?').run(cred.id, auth.sha256(jeton));   // révoquée avec la clé
    noterActivite(m.id, 'cle-acces', cred.nom, ctx);
    annulerRecuperation(m.id, 'connexion avec votre clé d’accès', ctx);
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
    const pas = totp.verifier(dechiffrerSecret2fa(df.secret).secret, ctx.corps.code);
    if (pas === null) { auth.noterEchec(['2fa-gestion:' + m.id]); throw erreur(400, 'Code incorrect : vérifiez l’heure de votre téléphone et saisissez le code affiché maintenant.', 'code_2fa'); }
    const { codes, empreintes } = totp.codesSecours();
    db.prepare('UPDATE deux_facteurs SET actif = 1, dernier_pas = ?, secours = ? WHERE marchand_id = ?').run(pas, JSON.stringify(empreintes), m.id);
    // Les autres appareils déjà connectés sont déconnectés : un intrus déjà entré ne reste pas.
    db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(m.id, auth.sha256(String(ctx.cookies[auth.COOKIE] || '')));
    oublierAppareils(m.id, (appareilConnuPour(ctx, m.id) || {}).empreinte);   // un appareil connu d'avant la 2FA ne garde aucun privilège
    annulerRecuperation(ctx.marchand.id, 'double authentification activée', ctx); noterActivite(m.id, '2fa-activee', null, ctx);
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
  /* Identité confirmée récemment (« mode sécurisé ») : les actions qui ouvrent un accès durable aux données (clé d'API,
     webhook, membre d'équipe) demandent une connexion ou une confirmation de moins de 15 minutes (l'export complet
     redemande déjà mot de passe et code à chaque fois). Une
     session volée (cookie copié) ne suffit donc pas à exfiltrer les données de la boutique sans le mot de passe. */
  const IDENTITE_DUREE = 15 * 60000;
  const sessionDe = ctx => db.prepare('SELECT cree_le, identite_le FROM sessions WHERE jeton_hash = ?').get(auth.sha256(String(ctx.cookies[auth.COOKIE] || ''))) || {};
  const identiteRecente = ctx => { const s0 = sessionDe(ctx); return Math.max(s0.cree_le || 0, s0.identite_le || 0) > Date.now() - IDENTITE_DUREE; };
  const exigerIdentite = ctx => { if (!identiteRecente(ctx)) throw erreur(403, 'Confirmez votre identité pour continuer (mot de passe, et code si la double authentification est active).', 'identite_a_confirmer'); };
  r.post('/api/admin/compte/confirmer-identite', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    // Compte qui n'accepte que sa clé d'accès : le mot de passe ne suffit pas ; il se reconnecte avec sa clé.
    if (m.cle_seule) throw erreur(403, 'Votre compte n’accepte que votre clé d’accès : reconnectez-vous avec elle pour continuer.', 'cle_seule');
    auth.verifierEchecs(['identite-jour:' + m.id], 30);   // au plus 30 échecs par jour, en plus de la limite par quart d'heure
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) {
      auth.noterEchec(['identite-jour:' + m.id]); noterActivite(m.id, 'echec-identite', 'mot de passe', ctx); throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    }
    const df = deuxFacteursDe(m.id);
    if (df && df.actif) {
      auth.verifierEchecs(['2fa-gestion:' + m.id], 5);
      if (!verifierSecondFacteur(df, ctx.corps.code, ctx)) { auth.noterEchec(['2fa-gestion:' + m.id, 'identite-jour:' + m.id]); noterActivite(m.id, 'echec-identite', 'code', ctx); throw erreur(400, ctx.corps.code ? 'Code incorrect.' : 'Saisissez le code de votre application d’authentification.', 'code_2fa'); }
    }
    db.prepare('UPDATE sessions SET identite_le = ? WHERE jeton_hash = ? AND marchand_id = ?').run(Date.now(), auth.sha256(String(ctx.cookies[auth.COOKIE] || '')), m.id);
    noterActivite(m.id, 'identite-confirmee', null, ctx);
    return { ok: true, valableJusqua: new Date(Date.now() + IDENTITE_DUREE).toISOString() };
  });
  r.post('/api/admin/compte/deconnecter-autres', exigerCompte, ctx => {
    const actuelle = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    noterActivite(ctx.marchand.id, 'autres-deconnectes', null, ctx);
    oublierAppareils(ctx.marchand.id, (appareilConnuPour(ctx, ctx.marchand.id) || {}).empreinte);
    return { ok: true, n: db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(ctx.marchand.id, actuelle).changes };
  });
  /* Suppression définitive d'un compte marchand et de tout ce qui lui appartient (demande du marchand, ou fin de conservation). */
  async function supprimerCompte(m) {
    for (const b of db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').all(m.id)) oublierCommandes(b.id);
    await abo.arreterDefinitivement(m.id);   // sinon Stripe continuerait de prélever un compte supprimé
    transaction(db, () => {
      for (const b of db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').all(m.id)) {
        db.prepare('DELETE FROM images_produits WHERE produit_id IN (SELECT id FROM produits WHERE boutique_id = ?)').run(b.id);
        for (const t of ['publications', 'evenements', 'avis', 'abonnes', 'envois_auto', 'emails', 'comptes_stripe']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(b.id);
      }
      db.prepare('DELETE FROM emails WHERE boutique_id IS NULL AND lower(destinataire) = ?').run(String(m.email).toLowerCase());   // seulement les e-mails de compte, pas ceux reçus comme client d'autres boutiques   // e-mails de compte (réinitialisation, abonnement)
      for (const b of db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').all(m.id)) {   // comptes de l'équipe, et leurs e-mails de compte
        db.prepare('DELETE FROM emails WHERE boutique_id IS NULL AND lower(destinataire) IN (SELECT lower(m2.email) FROM equipe e JOIN marchands m2 ON m2.id = e.marchand_id WHERE e.boutique_id = ?)').run(b.id);
        db.prepare('DELETE FROM marchands WHERE id IN (SELECT marchand_id FROM equipe WHERE boutique_id = ?)').run(b.id);
      }
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
    for (const m of db.prepare('SELECT m.* FROM marchands m LEFT JOIN abonnements a ON a.marchand_id = m.id WHERE m.cree_le < ? AND (a.marchand_id IS NULL OR a.periode_fin IS NULL) AND m.id NOT IN (SELECT marchand_id FROM equipe)').all(maintenant - 90 * JOUR)) {
      await supprimerCompte(m).catch(e => journal.error('[conservation]', e.message));
    }
  }
  r.post('/api/admin/compte/supprimer', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    const cles = ['mdp:' + m.id];   // même compteur que le changement de mot de passe : une session volée ne devine pas le mot de passe par essais
    if (!(await auth.essayerMotDePasse(cles, Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    await supprimerCompte(m);
    ctx.entetes['Set-Cookie'] = [auth.cookieSession(null, securise), `comptoir_appareil=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${securise ? '; Secure' : ''}`];
    return { ok: true };
  });

  r.post('/api/auth/deconnexion', ctx => {
    auth.supprimerSession(db, ctx.cookies);
    ctx.entetes['Set-Cookie'] = auth.cookieSession(null, securise);
    return { ok: true };
  });

  /* ---------- Administration ---------- */
  /* État complet de l'espace marchand. Les commandes en sont l'essentiel (des milliers) : le JSON de chacune est gardé en
     mémoire, repéré par l'empreinte de sa ligne en base. Une commande inchangée n'est ni relue, ni déchiffrée, ni
     resérialisée (10 000 commandes : environ 0,7 s de calcul bloquant auparavant, à chaque ouverture de l'espace). */
  // Un cache par boutique, entier ou rien : il contient des données de clients déchiffrées, donc il est effacé avec
  // les données (effacement d'un client, suppression du compte) et après 30 minutes sans ouverture de l'espace.
  // Au plus 30 000 commandes en tout ; une boutique plus grande n'est pas mise en cache (pas d'évictions en boucle).
  const JSON_COMMANDES = new Map(), JSON_COMMANDES_MAX = Number.isInteger(Number(env.CACHE_ETAT_MAX)) && env.CACHE_ETAT_MAX !== undefined && env.CACHE_ETAT_MAX !== '' ? Number(env.CACHE_ETAT_MAX) : 30000, JSON_COMMANDES_DUREE = 30 * 60000;   // CACHE_ETAT_MAX : 0 pour désactiver
  const oublierCommandes = boutiqueId => { JSON_COMMANDES.delete(boutiqueId); };
  const jsonCommandes = (boutiqueId, rows) => {
    // Petite boutique (moins de 1 000 commandes) : relire coûte moins que calculer les empreintes, et rien n'est gardé en
    // mémoire (mesuré : 1 000 boutiques de 200 commandes, 623 contre 589 requêtes par seconde, 197 contre 288 Mo).
    if (rows.length > JSON_COMMANDES_MAX || rows.length < 1000) { oublierCommandes(boutiqueId); return rows.map(r => JSON.stringify(lireCommande(r))); }
    const avant = JSON_COMMANDES.get(boutiqueId), ancien = avant ? avant.parId : new Map(), parId = new Map();
    const sortie = rows.map(row => {
      const cle = `${row.statut}|${row.numero}|${row.date}|${crypto.createHash('sha1').update(row.donnees).digest('base64')}`;
      const m = ancien.get(row.id);
      const e = m && m.cle === cle ? m : { cle, json: JSON.stringify(lireCommande(row)) };
      parId.set(row.id, e);   // commandes disparues : non reprises
      return e.json;
    });
    JSON_COMMANDES.delete(boutiqueId); JSON_COMMANDES.set(boutiqueId, { parId, le: Date.now() });   // boutique la plus récente en dernier
    // Budget total : les boutiques ouvertes le moins récemment sortent en premier ; expirées après 30 minutes.
    let total = 0; for (const v of JSON_COMMANDES.values()) total += v.parId.size;
    for (const [bid, v] of JSON_COMMANDES) { if (total <= JSON_COMMANDES_MAX && Date.now() - v.le < JSON_COMMANDES_DUREE) break; if (bid === boutiqueId) continue; total -= v.parId.size; JSON_COMMANDES.delete(bid); }
    return sortie;
  };
  r.get('/api/admin/etat', exigerMarchand, async ctx => {
    const config = lireConfig(ctx.boutique);
    const commandesJson = '[' + jsonCommandes(ctx.boutique.id, db.prepare('SELECT * FROM commandes WHERE boutique_id = ? ORDER BY date').all(ctx.boutique.id)).join(',') + ']';
    const commandes = [];   // ajoutées à la fin du JSON, depuis les fragments gardés
    const publications = db.prepare('SELECT * FROM publications WHERE boutique_id = ? ORDER BY date').all(ctx.boutique.id).map(social.lire);
    const abonnes = db.prepare('SELECT COUNT(*) AS n FROM abonnes WHERE boutique_id = ?').get(ctx.boutique.id).n;
    const envois = Object.fromEntries(db.prepare("SELECT substr(cle, 1, instr(cle, ':') - 1) AS type, COUNT(*) AS n FROM envois_auto WHERE boutique_id = ? GROUP BY type").all(ctx.boutique.id).map(x => [x.type, x.n]));
    const avis = db.prepare('SELECT id, commande_id AS commandeId, produit_id AS produitId, note, texte, prenom, ville, cree_le AS date, reponse FROM avis WHERE boutique_id = ? ORDER BY cree_le DESC LIMIT 300').all(ctx.boutique.id);
    // Audience : sessions distinctes par jour et par étape (365 derniers jours)
    const audience = db.prepare("SELECT strftime('%Y-%m-%d', date / 1000, 'unixepoch', 'localtime') AS jour, type, COUNT(DISTINCT session) AS n FROM evenements WHERE boutique_id = ? AND date > ? GROUP BY jour, type").all(ctx.boutique.id, Date.now() - 366 * 86400000);
    const offresVues = Object.fromEntries(db.prepare("SELECT valeur, COUNT(DISTINCT session) AS n FROM evenements WHERE boutique_id = ? AND type = 'offre_vue' GROUP BY valeur").all(ctx.boutique.id).map(x => [x.valeur, x.n]));
    const desinscrits = db.prepare('SELECT email FROM desinscriptions WHERE boutique_id = ?').all(ctx.boutique.id).map(r => r.email);
    const etatComplet = { version: 2, ...config, desinscrits, produits: listerProduits(ctx.boutique.id).map(avecImage), commandes, publications, abonnes, envois, avis, audience, offresVues, visites30j: 0, compteurFacture: ctx.boutique.compteur_facture, serveur: { slug: ctx.boutique.slug, email: ctx.marchand.email, emailVerifie: emailVerifie(ctx.marchand.id), paiement: paiement.nom, emails: serviceEmail ? serviceEmail.nom : null, creeLe: ctx.boutique.cree_le , abonnement: abo.etat(ctx.boutique.marchand_id), jetonDomaine: jetonDomaine(ctx.boutique.id), utilisationsCodes: Object.fromEntries(Remises.offresDe(config).codes.map(x => [x.code, utilisationsCode(ctx.boutique.id, x.code)])), lectureSeule: !!ctx.lectureSeule, paiementsBoutique: paiement.nom === 'stripe' ? { mode: 'stripe', pret: !!(compteStripe(ctx.boutique.id) || {}).pret, compte: !!compteStripe(ctx.boutique.id), twint: !!(moyensDe(ctx.boutique.id) || {}).twint, bancontact: !!(moyensDe(ctx.boutique.id) || {}).bancontact } : { mode: paiement.nom, pret: true }, urlBoutique: urlBoutique(ctx.boutique) } };
    etatComplet.attentesStock = Object.fromEntries(db.prepare("SELECT produit_id || '|' || variante_id AS k, COUNT(*) AS n FROM alertes_stock WHERE boutique_id = ? GROUP BY produit_id, variante_id").all(ctx.boutique.id).map(x => [x.k, x.n]));   // « clients en attente » par produit et variante
    // Rôle « commandes » : ni IBAN ni listes marketing (désinscrits, abonnés, envois) ; le reste sert à préparer et expédier.
    let final = etatComplet;
    if (ctx.role === 'commandes') { const { iban, ...entreprise } = etatComplet.entreprise || {}; final = { ...etatComplet, entreprise, desinscrits: [], abonnes: [], envois: [] }; }
    // Pas de recherche dans le texte (une valeur de configuration pourrait contenir n'importe quoi) : l'objet est sérialisé
    // sans ses commandes, puis elles sont ajoutées comme dernier champ.
    const { commandes: _c, ...sansCommandes } = final; void _c;
    const tete = JSON.stringify(sansCommandes);
    const texte = `${tete.slice(0, -1)}${tete.length > 2 ? ',' : ''}"commandes":${commandesJson}}`;
    ctx.entetes['Cache-Control'] = 'no-store';
    // Compression hors du fil principal, comme pour toute grande réponse JSON.
    if (/\bgzip\b/.test(ctx.req.headers['accept-encoding'] || '')) {
      const z = await new Promise((ok, ko) => zlib.gzip(Buffer.from(texte), { level: 5 }, (e, b) => e ? ko(e) : ok(b)));
      ctx.entetes['Content-Encoding'] = 'gzip'; ctx.entetes.Vary = 'Accept-Encoding';
      return { binaire: z, type: 'application/json; charset=utf-8' };
    }
    return { binaire: Buffer.from(texte), type: 'application/json; charset=utf-8' };
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
    const avant = lireConfig(ctx.boutique);
    const config = garderDomaine(nettoyerConfig(ctx.corps.config), avant);
    // Membre de l'équipe : l'identité de l'entreprise, l'IBAN et le paiement sur facture restent ceux du propriétaire
    // (sinon un membre pourrait faire verser les paiements des clients sur son propre compte).
    if (ctx.role !== 'proprietaire') {
      config.entreprise = { ...config.entreprise, ...Object.fromEntries(['iban', 'raison', 'adresse', 'siret', 'tvaIntra', 'regime', 'forme', 'email'].map(k => [k, (avant.entreprise || {})[k]])) };
      config.reglages = { ...config.reglages, factureQr: (avant.reglages || {}).factureQr, echeanceJours: (avant.reglages || {}).echeanceJours };
    }
    // Propriétaire : changer l'IBAN (où arrivent les paiements par facture QR) ou activer la facture QR demande une identité
    // confirmée récemment, et le propriétaire est prévenu par e-mail. Un cookie volé ne suffit pas à détourner les paiements.
    const ibanAvant = String((avant.entreprise || {}).iban || '').replace(/\s/g, '').toUpperCase(), ibanApres = String((config.entreprise || {}).iban || '').replace(/\s/g, '').toUpperCase();
    const qrActivee = !!(config.reglages && config.reglages.factureQr) && !(avant.reglages && avant.reglages.factureQr);
    if (ctx.role === 'proprietaire' && ((ibanAvant && ibanApres !== ibanAvant) || (qrActivee && ibanApres))) exigerIdentite(ctx);
    db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(config), ctx.boutique.id);
    if (ibanAvant && ibanApres !== ibanAvant) {
      noterActivite(ctx.marchand.id, 'iban-modifie', ibanApres ? `…${ibanApres.slice(-4)}` : 'retiré', ctx);
      envoyerEmail(null, ctx.marchand.email, 'IBAN de votre boutique modifié', `Bonjour,\n\nL’IBAN qui reçoit les paiements par facture QR de votre boutique vient d’être modifié (se termine maintenant par ${ibanApres ? ibanApres.slice(-4) : '— retiré'}).\n\nCe n’était pas vous ? Remettez votre IBAN dans Paramètres, changez votre mot de passe et déconnectez les autres appareils.\n\nL’équipe Comptoir`);
    }
    return { ok: true };
  });
  r.post('/api/admin/reinitialiser', exigerMarchand, ctx => {
    const config = garderDomaine(nettoyerConfig(ctx.corps.config), lireConfig(ctx.boutique));
    transaction(db, () => {
      db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(config), ctx.boutique.id);
      for (const r0 of db.prepare('SELECT id FROM produits WHERE boutique_id = ? AND supprime = 0').all(ctx.boutique.id)) EMP.purgerProduit(ctx.boutique.id, r0.id);
      db.prepare('UPDATE produits SET supprime = 1 WHERE boutique_id = ?').run(ctx.boutique.id);
      insererProduits(ctx.boutique.id, ctx.corps.produits);
    });
    return { ok: true };
  });
  r.post('/api/admin/produits', exigerMarchand, ctx => {
    const id = auth.nouvelId('p_');
    const ordre = db.prepare('SELECT COALESCE(MAX(ordre), 0) + 1 AS o FROM produits WHERE boutique_id = ?').get(ctx.boutique.id).o;
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, ?)').run(id, ctx.boutique.id, serialiserProduit(id, produitDuNavigateur(ctx.corps.produit || {})), ordre);
    reconcilierProduit(ctx.boutique.id, id);   // emplacements : le stock de départ va à l'emplacement principal
    return { statut: 201, corps: { id } };
  });
  r.put('/api/admin/produits/:id', exigerMarchand, ctx => {
    const ancien = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ? AND supprime = 0').get(ctx.params.id, ctx.boutique.id);
    if (!ancien) throw erreur(404, 'Produit introuvable.', 'produit_introuvable');
    const avant = JSON.parse(ancien.donnees);
    // Les données fournisseur ne se modifient pas depuis l'interface.
    const recu = ctx.corps.produit || {};
    // Stock : seul un stock saisi dans la fiche remplace celui en base (sinon les ventes faites pendant l'édition seraient effacées).
    if (!recu.stockSaisi) recu.stock = avant.stock;
    if (Array.isArray(recu.variantes) && Array.isArray(avant.variantes)) recu.variantes = recu.variantes.map(v => v && v.stockSaisi ? v : { ...v, stock: (avant.variantes.find(x => x.id === (v && v.id)) || v || {}).stock });
    const fusion = { ...recu, type: avant.type, source: avant.source, fournisseur: avant.fournisseur, entrepot: avant.entrepot, delai: avant.delai, portF: avant.portF, codeFournisseur: avant.codeFournisseur };
    // Photo inchangée (renvoyée telle quelle par le navigateur) : celle enregistrée reste.
    if (avant.image === IMG && fusion.image === imageDe(ctx.params.id)) fusion.image = IMG;
    transaction(db, () => { db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(serialiserProduit(ctx.params.id, nettoyerProduit(fusion, avant.historiquePrix || [])), ctx.params.id); reconcilierProduit(ctx.boutique.id, ctx.params.id); });   // fiche et emplacements ensemble
    return { ok: true };
  });
  r.delete('/api/admin/produits/:id', exigerMarchand, ctx => {
    const res = transaction(db, () => { const r0 = db.prepare('UPDATE produits SET supprime = 1 WHERE id = ? AND boutique_id = ?').run(ctx.params.id, ctx.boutique.id); if (r0.changes) EMP.purgerProduit(ctx.boutique.id, ctx.params.id); return r0; });
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
  // Litige qui interdit un remboursement ou la libération d'une carte : ouvert (réponse attendue, en examen) ou perdu.
  // Une simple demande d'information (« warning_* ») ou un litige gagné ne bloque pas.
  const litigeBloquant = c => !!c.litige && ['needs_response', 'under_review', 'lost'].includes(c.litige.statut);
  // Remboursements en cours, par commande : un remboursement (complet ou partiel) à la fois, jamais deux en parallèle.
  const remboursementsEnCours = new Set();
  const avecVerrou = async (id, fn) => {
    if (remboursementsEnCours.has(id)) throw erreur(409, 'Un remboursement de cette commande est déjà en cours : patientez quelques secondes.', 'remboursement_en_cours');
    remboursementsEnCours.add(id);
    try { return await fn(); } finally { remboursementsEnCours.delete(id); }
  };
  const changerStatut = async ctx => {
    const c = commandeDeBoutique(ctx.boutique.id, ctx.params.id);
    const cible = ctx.corps.statut;
    if (cible === 'remboursee' && c.retour && c.retour.statut === 'demande') c.retour.statut = 'rembourse';
    if (cible === 'payee' && c.canal === 'carte') throw erreur(409, 'Une carte cadeau se paie en ligne : elle est émise automatiquement au paiement.', 'carte_en_ligne');
    if (ctx.role === 'commandes' && cible === 'payee') throw erreur(403, 'Marquer une commande comme payée est réservé au propriétaire ou à la gestion complète.', 'role');
    if (ctx.role === 'commandes' && ['remboursee', 'annulee'].includes(cible)) throw erreur(403, 'Rembourser ou annuler une commande est réservé au propriétaire ou à la gestion complète.', 'role');
    if (!transitionsPossibles(c).includes(cible)) throw erreur(409, `Impossible de passer de « ${c.statut} » à « ${cible} ».`, 'transition_invalide');
    const config = lireConfig(ctx.boutique);
    if ((cible === 'remboursee' || cible === 'annulee') && c.retourEnCours) throw erreur(409, 'Un retour partiel remboursé chez Stripe attend son avoir : terminez-le d’abord (fiche de la commande, « Terminer le retour en cours »).', 'retour_en_cours');
    if (cible === 'remboursee' && litigeBloquant(c)) throw erreur(409, 'Un litige bancaire est ouvert ou perdu sur cette commande : le remboursement passe par la banque du client.', 'litige');
    // Carte cadeau vendue déjà utilisée : refus AVANT tout remboursement (l'argent ne part pas si la carte reste valable).
    // (même si la carte a été bloquée entre-temps, par exemple par un litige : une carte dépensée n'est jamais remboursée)
    if ((cible === 'remboursee' || cible === 'annulee') && c.carteEmise) {
      const k = db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ?').get(c.carteEmise.id);
      if (k && k.solde < k.initial) throw erreur(409, `La carte cadeau ····${c.carteEmise.fin} a déjà servi (solde ${formatMontant(k.solde / 100, config)}) : elle ne peut plus être remboursée en entier.`, 'carte_utilisee');
      if (k && k.statut === 'active') Cartes.desactiver(ctx.boutique.id, k.id);   // désactivée tout de suite : plus utilisable pendant le remboursement
    }
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
      const p = db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'paye'").get(c.id);
      // Après des retours partiels, Stripe rembourse ce qui reste du paiement (rien à appeler s'il a déjà tout rendu).
      if (p && p.fournisseur === 'stripe' && Retours.deja(c).argent < p.montant_centimes) await paiement.rembourser({ paiement: p, cle: `remb-${p.id}-${Math.floor(Date.now() / 600000)}` });   // clé par tranche de 10 min : un double clic n'est pas rejoué, un nouvel essai plus tard (erreur corrigée) l'est
      if (p) db.prepare("UPDATE paiements SET statut = 'rembourse' WHERE id = ?").run(p.id);
      // Pendant le remboursement, un webhook a pu modifier la commande (litige, préparation) : on repart de la version à jour.
      const frais = commandeDeBoutique(ctx.boutique.id, c.id);
      // L'argent est parti : l'avoir, la carte cadeau, les points et le stock sont enregistrés quoi qu'il soit arrivé
      // entre-temps (expédition, litige), sauf si la commande a déjà été remboursée ou annulée par ailleurs.
      if (['remboursee', 'annulee'].includes(frais.statut)) throw erreur(409, `La commande est déjà « ${frais.statut} » : vérifiez-la.`, 'statut_change');
      if (frais.statut !== c.statut) historique(frais, `Remboursement effectué alors que la commande passait à « ${frais.statut} » : enregistré quand même${['expediee', 'livree'].includes(frais.statut) ? ' ; stock remis comme si les articles revenaient : corrigez-le s’ils ne reviennent pas' : ''}`);
      const retourDemande = c.retour && c.retour.statut === 'rembourse';
      Object.assign(c, frais);
      if (retourDemande && c.retour) c.retour.statut = 'rembourse';
      if (c.refFournisseur && ctx.corps.fournisseurAnnule) historique(c, `Remboursement après annulation déclarée chez le fournisseur (réf. ${c.refFournisseur})`);
    }
    const textes = { payee: 'Paiement reçu', preparation: 'Préparation commencée', expediee: 'Expédiée', livree: 'Livrée', prete: 'Prête à retirer, client prévenu', retiree: 'Remise au client', remboursee: `Remboursée (${formatMontant(Retours.resteAvoir(c) / 100, config)}${(c.retoursPartiels || []).length ? ', reste après les retours partiels' : ''})`, annulee: 'Annulée' };
    // Numéro de suivi : celui que le marchand a reçu du transporteur. Jamais inventé pour une vraie commande
    // (le client recevrait un faux numéro) ; seul le mode simulation en fabrique un, pour la démonstration.
    if (cible === 'expediee' && !c.suivi) {
      const saisi = String(ctx.corps.suivi || '').trim().slice(0, 60);
      if (saisi) c.suivi = saisi;
      else if (paiement.nom === 'simulation') c.suivi = '99.00.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7);
    }
    if (c.statut === 'attente' && (cible === 'payee' || cible === 'annulee')) {
      // Paiement reçu hors ligne (virement, espèces) ou commande annulée : les liens de paiement en ligne sont fermés d'abord.
      for (const p of db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id)) {
        db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(p.id);
        if (p.fournisseur === 'stripe' && paiement.expirer) await paiement.expirer(p).catch(e => journal.error('[paiement] expiration', e.message));
      }
      // Pendant ces appels, le client a pu payer en ligne : on repart de la commande à jour (pas de seconde facture, pas de double vente).
      const frais = commandeDeBoutique(ctx.boutique.id, c.id);
      if (frais.statut !== 'attente') throw erreur(409, 'Cette commande vient d’être payée en ligne entre-temps : son statut n’a pas été changé.', 'deja_payee');
      Object.assign(c, frais);
      // Un lien de paiement créé pendant l'attente (client qui reprend son paiement) est fermé lui aussi.
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE commande_id = ? AND statut = 'cree'").run(c.id);
    }
    // À partir d'ici, plus d'attente : numéros de pièces attribués et commande enregistrée d'un seul tenant (transaction :
    // une erreur ne consomme pas de numéro sans pièce).
    transaction(db, () => {
    // Carte cadeau ou points rendus (paiement abandonné) : repris avant de marquer payée, sinon leur part serait offerte.
    if (cible === 'payee') {
      const refus = reprendreReservations(ctx.boutique.id, c);
      if (refus) throw erreur(409, `Impossible de marquer payée : ${refus}. Encaissez ce montant autrement, puis annulez et recréez la commande.`, 'reservation');
      gagnerPoints(ctx.boutique.id, c);   // paiement reçu hors ligne (virement) : points gagnés comme en ligne
    }
    if (cible === 'payee' && !c.facture) { c.facture = prochaineFacture(ctx.boutique.id, Date.now()); c.dateFacture = Date.now(); }
    if (cible === 'payee' && !c.payeLe && !c.payeManuelLe) c.payeManuelLe = Date.now();   // paiement reçu hors ligne : la facture électronique le dit payé, même si elle est annulée ensuite
    // Une facture émise ne s'efface pas : le remboursement produit un avoir numéroté qui la référence.
    if ((cible === 'remboursee' || cible === 'annulee') && c.facture && !c.avoir) { c.avoir = { numero: prochaineFacture(ctx.boutique.id, Date.now(), 'AV'), date: Date.now(), montant: Retours.resteAvoir(c) / 100 }; if ((c.retoursPartiels || []).length) { const vt = Retours.ventilationReste(c); if (vt) c.avoir.ventilation = vt; } }
    if (c.statut === 'attente' && cible === 'payee') ajusterStock(ctx.boutique.id, c.lignes, -1, canalStock(c));   // vendu : le stock baisse comme pour un paiement en ligne
    if ((cible === 'remboursee' || cible === 'annulee') && c.statut !== 'attente') ajusterStock(ctx.boutique.id, c.lignes, +1, canalStock(c));
    // Carte cadeau vendue : remboursable seulement si elle n'a pas servi ; elle est alors désactivée.
    if ((cible === 'remboursee' || cible === 'annulee') && c.carteEmise && !c.carteEmise.desactivee) {
      // (vérifiée et désactivée avant le remboursement, plus haut ; redésactivée ici si elle a été émise entre-temps)
      const k = db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ?').get(c.carteEmise.id);
      if (k && k.statut === 'active') Cartes.desactiver(ctx.boutique.id, k.id);
      c.carteEmise.desactivee = Date.now();
    }
    // Fidélité : points gagnés retirés, points utilisés rendus (une seule fois). Des points gagnés déjà dépensés ne
    // peuvent pas être repris : l'écart est noté dans l'historique (à déduire du remboursement si le marchand le souhaite).
    if ((cible === 'remboursee' || cible === 'annulee') && c.fidelite && !c.fidelite.annule && c.client && c.client.email) {
      const aReprendre = Math.max(0, (c.fidelite.gagnes || 0) - Retours.deja(c).points);   // une partie a pu être reprise aux retours partiels
      const repris = aReprendre ? FID.debiter(ctx.boutique.id, c.client.email, aReprendre, { commandeId: c.id, type: 'annulation' }) : 0;
      if (c.fidelite.debite && !c.fidelite.liberee) FID.crediter(ctx.boutique.id, c.client.email, c.fidelite.debite, { commandeId: c.id, type: 'remboursement' });
      if (c.fidelite.gagnes || c.fidelite.debite) {
        c.fidelite.annule = Date.now();
        const reg = FID.reglages(ctx.boutique.id), manque = aReprendre - repris;
        historique(c, `Points de fidélité de la commande annulés${manque > 0 ? ` ; ${manque} points gagnés avaient déjà été utilisés (valeur ${formatMontant(FID.valeur(reg, manque) / 100, config)}), non repris` : ''}`);
      }
    }
    // Partie payée par carte cadeau : rendue sur la carte (le reste est remboursé par le moyen de paiement d'origine).
    if ((cible === 'remboursee' || cible === 'annulee') && c.carteCadeau && !c.carteCadeau.liberee && !c.carteCadeau.rendue) {
      const rendu = Math.round(c.carteCadeau.montant * 100) - Retours.deja(c).carte;   // moins ce qui a été recrédité aux retours partiels
      if (rendu > 0) Cartes.crediter(c.carteCadeau.id, rendu, { commandeId: c.id, texte: `Commande n° ${c.numero} ${cible === 'annulee' ? 'annulée' : 'remboursée'}`, type: 'remboursement' });
      c.carteCadeau.rendue = Date.now();
      if (rendu > 0) historique(c, `${formatMontant(rendu / 100, config)} recrédités sur la carte cadeau ····${c.carteCadeau.fin}`);
    }
    c.statut = cible;
    historique(c, textes[cible] + (cible === 'expediee' ? (c.suivi ? `, suivi ${c.suivi}` : ', sans numéro de suivi') : ''));
    enregistrerCommande(c);
    });
    if (cible === 'expediee') emailExpedition(ctx.boutique, c, config);
    if (cible === 'prete' && EmailsClients.langueDe(c)) { const m = EmailsClients.pret(c, { ...optionsEmail(ctx.boutique, c, config), adresse: config.magasin.adresse || '', horaires: config.magasin.horaires }); envoyerEmail(ctx.boutique.id, c.client.email, m.sujet, m.corps, { langue: c.langue }); }
    else if (cible === 'prete') envoyerEmail(ctx.boutique.id, c.client.email, `Votre commande n° ${c.numero} est prête`, `Bonjour ${c.client.nom},\n\nVotre commande vous attend en boutique : ${config.magasin.adresse || ''}${config.magasin.horaires ? `\nHoraires : ${config.magasin.horaires}` : ''}.\nPrésentez ce numéro de commande : ${c.numero}.\n\nVotre commande : ${lienCommande(ctx.boutique, c.id)}\n\n${config.boutique.nom}`);
    return { commande: c };
  };
  r.post('/api/admin/commandes/:id/statut', exigerMarchand, ctx => ['remboursee', 'annulee'].includes(ctx.corps.statut) ? avecVerrou(ctx.params.id, () => changerStatut(ctx)) : changerStatut(ctx));
  /* Retour partiel : une partie des articles (et éventuellement la livraison) est remboursée, avec un avoir partiel
     numéroté dans la suite des factures et scellé au journal. Corps : { lignes: [{ index, qte }], port, remettreEnStock,
     motif, apercu, attendu }. Avec apercu: true, rien ne bouge : le calcul est renvoyé (montant, répartition, rang).
     La confirmation renvoie attendu = { rang, montant } de l'aperçu : un renvoi (double clic, second onglet, réponse
     perdue) ou une commande changée entre-temps est refusé au lieu de rembourser une seconde fois ou un autre montant.
     Remboursement Stripe : un marqueur « retour en cours » est enregistré avant l'appel. Une fois l'argent parti, l'avoir
     est toujours créé, même si la commande a changé (litige ouvert pendant l'appel) ; si l'enregistrement échoue, le
     prochain appel termine ce retour à l'identique, avec la même clé d'idempotence. */
  const LIVRAISON_LIBELLE = { fr: 'Livraison', de: 'Versand', it: 'Spedizione', en: 'Shipping' };
  const finaliserRetour = async (ctx, bid, config, en, { repris = false } = {}) => {
    if (repris && en.calcul.argent && en.mode === 'stripe') {
      const p = db.prepare('SELECT * FROM paiements WHERE id = ?').get(en.paiementId);
      try { await paiement.rembourser({ paiement: p, montant: en.calcul.argent, cle: en.cle }); }   // même clé : Stripe ne rembourse pas deux fois
      catch (e) {
        // Refus net de Stripe à la reprise : rien n'a été remboursé par cet appel. Le marqueur est retiré (sinon la commande
        // resterait bloquée) ; le marchand vérifie dans Stripe si le premier essai était passé.
        if (e.refuse) {
          transaction(db, () => { const f = commandeDeBoutique(bid, ctx.params.id); delete f.retourEnCours; historique(f, `Retour partiel en suspens abandonné : Stripe a refusé la reprise (${e.message}). Vérifiez dans Stripe si un remboursement de ${formatMontant(en.calcul.argent / 100, config)} a eu lieu.`); enregistrerCommande(f); });
          throw erreur(409, `Stripe refuse la reprise (${e.message}) : le retour en suspens est abandonné. Vérifiez dans votre tableau de bord Stripe si un remboursement de ${formatMontant(en.calcul.argent / 100, config)} a déjà eu lieu ; sinon, refaites le retour.`, 'reprise_refusee');
        }
        throw e;
      }
    }
    return transaction(db, () => {
      const f = commandeDeBoutique(bid, ctx.params.id), calcul = en.calcul, mode = en.mode;
      if ((f.retoursPartiels || []).length + 1 !== en.rang) { delete f.retourEnCours; enregistrerCommande(f); return { commande: f, avoir: (f.retoursPartiels.at(-1) || {}).numero }; }   // déjà enregistré
      delete f.retourEnCours;
      // Retour sans montant (valeur déjà rendue par un geste) : pas de pièce comptable, donc pas de numéro.
      const piece = { numero: calcul.sansMontant ? null : prochaineFacture(bid, Date.now(), 'AV'), date: Date.now(), lignes: calcul.lignes, port: calcul.port, montant: calcul.montant, argent: calcul.argent, carte: calcul.carte, mode, stock: en.stock, motif: en.motif, ...(calcul.geste ? { geste: true } : {}) };
      // Stock : les unités vraiment retirées à la vente reviennent (ou sont sorties du compte si l'article est abîmé).
      for (const x of calcul.lignes) {
        const l = f.lignes[x.index];
        const pris = typeof l.retireStock === 'number' ? l.retireStock : Math.max(0, l.qte - Retours.deja(f).qte[x.index]);
        const n = Math.min(x.qte, pris);
        if (n <= 0) continue;
        const repartition = l.emplacements ? { ...l.emplacements } : null;
        if (piece.stock) {
          const tmp = { ...l, qte: n, retireStock: n, emplacements: repartition };
          ajusterStock(bid, [tmp], +1, canalStock(f));
          if (l.emplacements) for (const [eid, k] of Object.entries(tmp.emplacementsRepris || {})) { l.emplacements[eid] -= k; if (l.emplacements[eid] <= 0) delete l.emplacements[eid]; }
        } else if (l.emplacements) {
          let reste = n; for (const eid of Object.keys(l.emplacements)) { const k = Math.min(reste, l.emplacements[eid]); l.emplacements[eid] -= k; reste -= k; if (l.emplacements[eid] <= 0) delete l.emplacements[eid]; if (!reste) break; }
        }
        l.retireStock = pris - n;
      }
      if (piece.carte) Cartes.crediter(f.carteCadeau.id, piece.carte, { commandeId: f.id, texte: `Retour partiel, commande n° ${f.numero}`, type: 'remboursement' });
      // Points gagnés avec la commande : la part des articles rendus (hors livraison) est reprise ; des points déjà
      // dépensés ne peuvent pas l'être : l'écart est noté.
      let notePoints = '';
      // (un geste commercial ne reprend pas de points : c'est un dédommagement, pas une vente annulée)
      if (!calcul.geste && f.fidelite && f.fidelite.gagnes && !f.fidelite.annule && f.client && f.client.email) {
        const articles = Math.max(1, Retours.cts(f.total) - Retours.cts(f.port));
        const vises = Math.min(f.fidelite.gagnes - Retours.deja(f).points, Math.round(f.fidelite.gagnes * (piece.montant - piece.port) / articles));
        if (vises > 0) {
          piece.points = vises; piece.pointsRepris = FID.debiter(bid, f.client.email, vises, { commandeId: f.id, type: 'annulation' });
          notePoints = piece.pointsRepris < vises ? ` ; ${vises - piece.pointsRepris} points gagnés déjà utilisés, non repris (valeur ${formatMontant(FID.valeur(FID.reglages(bid), vises - piece.pointsRepris) / 100, config)})` : ` ; ${vises} points de fidélité repris`;
        }
      }
      // Ventilation par taux figée à l'émission : le document ne changera plus, même si les règles de calcul évoluent.
      if (piece.numero) { const vt = Retours.ventilationPiece(f, piece); if (vt) piece.ventilation = vt; }
      f.retoursPartiels = [...(f.retoursPartiels || []), piece];
      // Demande de retour du client entièrement couverte par les retours partiels : marquée remboursée.
      if (f.retour && f.retour.statut === 'demande' && (f.retour.lignes || []).every(x => Number.isInteger(x.ligne) && Retours.deja(f).qte[x.ligne] >= x.qte)) f.retour.statut = 'rembourse';
      const liste = calcul.geste ? 'geste commercial, sans retour d’article' : calcul.lignes.map(x => `${x.qte} × ${f.lignes[x.index].nom}`).join(', ');
      if (calcul.sansMontant) {
        historique(f, `Retour sans remboursement (valeur déjà rendue par un geste commercial) : ${liste}${piece.stock ? '' : ' ; articles non remis en stock'}${piece.motif ? ` ; motif : ${piece.motif}` : ''}`);
        enregistrerCommande(f);
        noterActivite(ctx.marchand.id, 'remboursement', `Retour sans remboursement (commande n° ${f.numero})`, ctx);
        return { commande: f, avoir: null };
      }
      historique(f, `${calcul.geste ? 'Geste commercial' : 'Retour partiel'} ${piece.numero} : ${formatMontant(piece.montant / 100, config)} remboursés (${liste}${piece.port ? ', livraison' : ''})${piece.carte ? `, dont ${formatMontant(piece.carte / 100, config)} sur la carte cadeau ····${f.carteCadeau.fin}` : ''}${mode === 'manuel' && piece.argent ? ` ; ${formatMontant(piece.argent / 100, config)} à rendre au client par vos soins (virement, espèces)` : ''}${piece.stock ? '' : ' ; articles non remis en stock'}${notePoints}${piece.motif ? ` ; motif : ${piece.motif}` : ''}${f.litige ? ' ; attention : un litige bancaire est ouvert sur cette commande' : ''}`);
      enregistrerCommande(f);   // scelle l'avoir partiel au journal
      try { integ.emettre(bid, 'commande.remboursement_partiel', { ...commandeApi(f, config.boutique.devise || 'CHF', { client: false }), avoir: piece.numero, montant: piece.montant / 100, geste: !!calcul.geste, lignesRendues: calcul.lignes.map(x => ({ nom: f.lignes[x.index].nom, qte: x.qte, montant: x.montant / 100 })) }); } catch (e) { journal.error('[webhook]', e.message); }
      noterActivite(ctx.marchand.id, 'remboursement', `${calcul.geste ? 'Geste commercial' : 'Retour partiel'} ${piece.numero} (commande n° ${f.numero}, ${formatMontant(piece.montant / 100, config)})`, ctx);
      // Client prévenu (dans sa langue) : montant, articles, livraison, part recréditée sur la carte, numéro de l'avoir.
      if (f.client && f.client.email && !f.client.illisible) {
        const GESTE = { fr: 'Geste commercial', de: 'Kulanzgutschrift', it: 'Gesto commerciale', en: 'Goodwill credit' };
        const lignes = (calcul.geste ? [`- ${GESTE[EmailsClients.langueDe(f) || 'fr'] || GESTE.fr} : ${formatMontant(piece.montant / 100, config)}`] : calcul.lignes.map(x => `- ${x.qte} × ${f.lignes[x.index].nom} : ${formatMontant(x.montant / 100, config)}`)).concat(piece.port ? [`- ${LIVRAISON_LIBELLE[EmailsClients.langueDe(f) || 'fr'] || 'Livraison'} : ${formatMontant(piece.port / 100, config)}`] : []).join('\n');
        const o = { ...optionsEmail(ctx.boutique, f, config), montant: formatMontant(piece.montant / 100, config), lignes, carte: piece.carte ? formatMontant(piece.carte / 100, config) : '', manuel: mode === 'manuel', avoir: piece.numero };
        const m = EmailsClients.langueDe(f) ? EmailsClients.remboursementPartiel(f, o) : { sujet: `Remboursement partiel de votre commande n° ${f.numero}`, corps: `Bonjour ${f.client.nom},\n\nNous avons remboursé ${o.montant} :\n${lignes}${o.carte ? `\n\nDont ${o.carte} recrédités sur votre carte cadeau.` : ''}\n\n${o.manuel ? 'Le remboursement se fait selon les modalités convenues avec nous (par exemple par virement).' : 'Le montant revient sur votre moyen de paiement d’origine ; selon votre banque, comptez quelques jours.'} Référence de l’avoir : ${piece.numero}.\n\nVotre commande : ${o.lienCommande}\n\n${config.boutique.nom}` };
        envoyerEmail(bid, f.client.email, m.sujet, m.corps, { langue: f.langue });
      }
      return { commande: f, avoir: piece.numero, ...(repris ? { repris: true } : {}) };
    });
  };
  r.post('/api/admin/commandes/:id/retour-partiel', exigerMarchand, ctx => {
    if (ctx.role === 'commandes') throw erreur(403, 'Rembourser est réservé au propriétaire ou à la gestion complète.', 'role');
    const bid = ctx.boutique.id, config = lireConfig(ctx.boutique);
    const preparer = c => {
      if (!transitionsPossibles(c).includes('remboursee') || c.avoir) throw erreur(409, `Une commande « ${c.statut} » ne peut pas être remboursée.`, 'statut');
      if (c.litige) throw erreur(409, 'Un litige bancaire existe sur cette commande : le remboursement passe par la banque du client, pas par un retour.', 'litige');
      const p = db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'paye'").get(c.id);
      const carte = c.carteCadeau && !c.carteCadeau.liberee ? Retours.cts(c.carteCadeau.montant) : 0;
      const argentPaye = p ? p.montant_centimes : Math.max(0, Retours.cts(c.total) - carte);
      const calcul = Retours.calculer(c, ctx.corps, { argentPaye });
      if (c.refFournisseur && ['payee', 'preparation', 'fournisseur'].includes(c.statut) && calcul.lignes.some(x => x.qte > 0 && c.lignes[x.index].type === 'drop') && !ctx.corps.fournisseurAnnule)
        throw erreur(409, `La partie fournisseur est déjà commandée (réf. ${c.refFournisseur}) : annulez ces articles chez le fournisseur d’abord, puis confirmez.`, 'fournisseur_a_annuler');
      return { p, calcul, mode: p && p.fournisseur === 'stripe' ? 'stripe' : p ? p.fournisseur : 'manuel', rang: (c.retoursPartiels || []).length + 1 };
    };
    const c0 = commandeDeBoutique(bid, ctx.params.id);
    if (ctx.corps.apercu === true) {
      if (c0.retourEnCours) throw erreur(409, 'Un retour partiel remboursé chez Stripe attend son avoir : terminez-le d’abord (bouton « Terminer le retour en cours »).', 'retour_en_cours');
      const { calcul, mode, rang } = preparer(c0);
      return { apercu: { ...calcul, mode, rang, lignes: calcul.lignes.map(x => ({ ...x, nom: c0.lignes[x.index].nom })) } };
    }
    return avecVerrou(c0.id, async () => {
      const c = commandeDeBoutique(bid, c0.id);
      // Abandon déclaré par le marchand (il a vérifié dans Stripe qu'aucun remboursement n'a eu lieu) : marqueur retiré, tracé.
      if (ctx.corps.abandonner === true) {
        if (!c.retourEnCours) throw erreur(409, 'Aucun retour en suspens sur cette commande.', 'rien_a_abandonner');
        transaction(db, () => { const f = commandeDeBoutique(bid, c.id); const m = f.retourEnCours; delete f.retourEnCours; historique(f, `Retour partiel en suspens de ${formatMontant(m.calcul.montant / 100, config)} abandonné par le marchand (aucun remboursement constaté chez Stripe)`); enregistrerCommande(f); });
        noterActivite(ctx.marchand.id, 'remboursement', `Retour en suspens abandonné (commande n° ${c.numero})`, ctx);
        return { commande: commandeDeBoutique(bid, c.id), abandonne: true };
      }
      // Retour dont l'argent est parti sans avoir enregistré : terminé d'abord, à l'identique (rien d'autre n'est fait).
      if (c.retourEnCours) return finaliserRetour(ctx, bid, config, c.retourEnCours, { repris: true });
      const { p, calcul, mode, rang } = preparer(c);
      const att = ctx.corps.attendu || {};
      if (att.rang !== rang) throw erreur(409, 'Ce retour vient déjà d’être enregistré (ou un autre l’a précédé) : vérifiez la commande.', 'deja_enregistre');
      if (att.montant !== calcul.montant) throw erreur(409, 'Le montant a changé depuis le calcul : recalculez avant de confirmer.', 'montant_change');
      const en = { rang, cle: `retour-${c.id}-${rang}`, calcul, mode, paiementId: p ? p.id : null, stock: ctx.corps.remettreEnStock !== false,
        motif: String(ctx.corps.motif || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || null, le: Date.now() };
      if (calcul.argent && mode === 'stripe') {
        transaction(db, () => { const f = commandeDeBoutique(bid, c.id); f.retourEnCours = en; enregistrerCommande(f); });
        try { await paiement.rembourser({ paiement: p, montant: calcul.argent, cle: en.cle }); }
        catch (e) {
          // Refus net de Stripe (rien n'a été remboursé) : le marqueur est retiré. Coupure, délai ou erreur 5xx : le remboursement
          // a peut-être eu lieu ; le marqueur reste, et « Terminer le retour en cours » le reprend avec la même clé d'idempotence.
          if (e.refuse) { transaction(db, () => { const f = commandeDeBoutique(bid, c.id); delete f.retourEnCours; enregistrerCommande(f); }); throw e; }
          journal.error('[retour-partiel] réponse de Stripe incertaine', c.id, e.message);
          throw erreur(502, 'Stripe n’a pas confirmé le remboursement (coupure ou erreur de leur côté). Il a peut-être été fait : cliquez sur « Terminer le retour en cours » dans la commande, sans attendre plus d’un jour, pour l’enregistrer (le client ne sera pas remboursé deux fois).', 'stripe_incertain');
        }
      }
      try { return await finaliserRetour(ctx, bid, config, en); }
      catch (e) {
        if (calcul.argent && mode === 'stripe') {
          journal.error('[retour-partiel] remboursement Stripe fait, avoir non créé', c.id, e.message);
          throw erreur(500, `${formatMontant(calcul.argent / 100, config)} ont été remboursés chez Stripe, mais l’avoir n’a pas encore été créé. Rouvrez la commande et cliquez sur « Terminer le retour en cours » : le client ne sera pas remboursé deux fois.`, 'avoir_non_cree');
        }
        throw e;
      }
    });
  });
  // Idempotence de la caisse : une même clé de ticket n'enregistre qu'une vente (double clic, renvoi après coupure).
  const ticketsVus = new Map();
  db.exec('CREATE TABLE IF NOT EXISTS tickets_caisse (cle TEXT PRIMARY KEY, reponse TEXT NOT NULL, le INTEGER NOT NULL)');
  /* Carte cadeau présentée en caisse : seuls les échecs comptent, par membre de l'équipe (une faute de frappe d'un vendeur
     ne bloque pas la caisse des autres ; l'essai de codes au hasard est arrêté). */
  const carteCaisse = (ctx, code) => {
    const carte = Cartes.trouver(ctx.boutique.id, code), devise = lireConfig(ctx.boutique).boutique.devise || 'EUR';
    if (!carte || !Cartes.disponible(carte) || carte.devise !== devise) {
      auth.limiter(`carte-caisse:${ctx.boutique.id}:${ctx.marchand.id}`, 30 * facteurLimites, 15 * 60000, 'Trop de cartes cadeaux refusées : réessayez dans quelques minutes.');
      throw carteRefusee(ctx.boutique, carte);
    }
    return carte;
  };
  r.post('/api/admin/caisse/carte', exigerFonction('magasin'), ctx => {
    const carte = carteCaisse(ctx, ctx.corps.code);
    return { solde: Cartes.disponible(carte) / 100, fin: carte.fin, expireLe: carte.expire_le };
  });
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
    // Vente faite hors ligne (déjà encaissée) : jamais refusée pour le stock ; une rupture est signalée dans l'historique.
    const horsLigne = Number(ctx.corps.horsLigneLe) > Date.now() - 30 * 86400000 && Number(ctx.corps.horsLigneLe) <= Date.now() + 60000 ? Number(ctx.corps.horsLigneLe) : null;
    const lignes = prix.construireLignes(produits, ctx.corps.lignes, { qteMax: 999, verifierStock: !horsLigne });   // vente en magasin : quantités de marché ou de gros
    if (lignes.some(l => l.type === 'drop')) throw erreur(400, 'La caisse n’accepte que les produits en stock.', 'caisse_drop');
    const total = prix.arrondi(lignes.reduce((a, l) => a + l.prix * l.qte, 0));
    let moyen = ctx.corps.moyen === 'especes' ? 'espèces' : ctx.corps.moyen === 'twint' ? 'TWINT' : 'carte';
    // Carte cadeau présentée en caisse : débitée du montant du ticket (au plus), le reste est encaissé par le moyen choisi.
    let carte = null, centimesCarte = 0;
    if (ctx.corps.carteCadeau) {
      if (horsLigne) throw erreur(400, 'Carte cadeau : son solde se vérifie en ligne. Encaissez cette vente autrement.', 'carte_hors_ligne');
      carte = carteCaisse(ctx, ctx.corps.carteCadeau);
      const dispo = Cartes.disponible(carte);
      centimesCarte = Math.min(dispo, Math.round(total * 100));
      if (centimesCarte === Math.round(total * 100)) moyen = 'carte cadeau';
    }
    const reste = prix.arrondi(total - centimesCarte / 100);
    return transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(ctx.boutique.id).compteur_commande;
      const id = auth.nouvelId('c_');
      const now = horsLigne || Date.now();   // vente hors ligne : datée (et facturée) au moment où elle a été encaissée
      const config = lireConfig(ctx.boutique);
      const donnees = { client: { nom: 'Client en boutique', email: '', ville: '' }, lignes, sousTotal: total, port: 0, total, tauxTva: prix.tauxTva(config), livraison: 'retrait', canal: 'magasin', moyen: !reste ? 'carte-cadeau' : ['especes', 'twint', 'carte'].includes(ctx.corps.moyen) ? ctx.corps.moyen : 'carte', suivi: '', note: '', facture: prochaineFacture(ctx.boutique.id, now), dateFacture: now, historique: [{ date: now, texte: `Vente encaissée en boutique (${carte ? `carte cadeau ····${carte.fin} : ${formatMontant(centimesCarte / 100, config)}${reste ? `, reste en ${moyen} : ${formatMontant(reste, config)}` : ''}` : moyen})` }] };
      if (carte) donnees.carteCadeau = { id: carte.id, fin: carte.fin, montant: centimesCarte / 100 };
      prix.figerTaux(donnees, config);
      // Espèces en francs : le client paie le montant arrondi à 5 centimes (sur ce qui reste après la carte) ; l'écart est noté.
      if (ctx.corps.moyen === 'especes' && config.boutique.pays === 'ch' && reste) { const enc = Math.round(reste * 20) / 20; donnees.encaisse = prix.arrondi(enc); donnees.arrondi = prix.arrondi(enc - reste); }
      ajusterStock(ctx.boutique.id, lignes, -1, 'magasin');   // avant l'enregistrement : la ligne garde d'où viennent les articles (retour au bon endroit)
      insererCommande(id, ctx.boutique.id, numero, now, 'retiree', auth.nouvelId(), donnees);
      if (carte && !Cartes.debiter(carte.id, centimesCarte, { commandeId: id, texte: `Ticket n° ${numero}`, maintenant: Date.now() })) throw erreur(409, 'Le solde de la carte cadeau vient de changer : vérifiez-le et réessayez.', 'carte_solde');
      sceller(ctx.boutique.id, { id, numero, date: now, statut: 'retiree', ...donnees });   // ticket de caisse scellé à l'encaissement
      if (horsLigne) {
        const manque = lignes.filter(l => typeof l.retireStock === 'number' && l.retireStock < l.qte);
        const c2 = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(id));
        // Prix changés entre la vente et l'envoi : le montant encaissé est signalé, à vérifier.
        const attendu = Number(ctx.corps.totalAttendu), ecart = Number.isFinite(attendu) && Math.abs(attendu - total) >= 0.01;
        historique(c2, `Vente encaissée hors ligne le ${new Date(horsLigne).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}, envoyée au retour du réseau${manque.length ? ` ; stock insuffisant pour ${manque.map(l => l.nom).join(', ')} (à vérifier)` : ''}${ecart ? ` ; montant affiché à la caisse ${formatMontant(attendu, config)}, prix actuels ${formatMontant(total, config)} (à vérifier)` : ''}`);
        c2.lignes = lignes; enregistrerCommande(c2);
      }
      integ.emettre(ctx.boutique.id, 'commande.retiree', commandeApi({ id, numero, date: now, statut: 'retiree', ...donnees, canal: donnees.canal || 'caisse' }, config.boutique.devise || 'CHF'));
      return { statut: 201, corps: { id, numero, facture: donnees.facture, total: formatMontant(total, config), ...(carte ? { carteCadeau: formatMontant(centimesCarte / 100, config), ...(reste ? { reste: formatMontant(reste, config) } : {}), soldeCarte: formatMontant(Cartes.disponible(db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ?').get(carte.id)) / 100, config) } : {}) } };
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
  const commandesDuClient = (boutiqueId, email) => db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND email_index = ?').all(boutiqueId, PII.index(boutiqueId, email) || '').map(lireCommande)
    .filter(c => PII.normEmail(c.client && c.client.email) === PII.normEmail(email));
  /* Export complet de la boutique (portabilité) : tout ce qui appartient au marchand, en un fichier JSON lisible.
     Propriétaire seulement, mot de passe (et code de double authentification) redemandés : le fichier contient les données
     des clients. Aucun secret n'en sort (mots de passe, sessions, clés d'API, secrets de webhooks, jetons des clients). */
  r.post('/api/admin/export-complet', exigerProprietaire, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    if (!(await auth.essayerMotDePasse(['mdp:' + m.id], Number(env.LIMITE_ESSAIS) || 10, String(ctx.corps.motDePasse || ''), m.mot_de_passe))) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    // Limite vérifiée avant le code : un code de secours n'est pas consommé pour un export refusé.
    auth.limiter('export-complet:' + ctx.boutique.id, 5, 3600000, 'Export déjà fait plusieurs fois cette heure : réessayez plus tard.');
    const df = deuxFacteursDe(m.id);
    if (df && df.actif) {
      auth.limiter('2fa-gestion:' + m.id, 5 * facteurLimites, 15 * 60000, 'Trop d’essais : réessayez dans 15 minutes.');
      if (!verifierSecondFacteur(df, String(ctx.corps.code || ''), ctx)) throw erreur(401, 'Code de vérification requis ou incorrect.', 'code_2fa');
    }
    const b = ctx.boutique, config = lireConfig(b), iso = t => t ? new Date(t).toISOString() : null;
    const pause = () => new Promise(r2 => setImmediate(r2));   // le serveur reste disponible pour les autres boutiques
    // Produits, supprimés compris mais marqués. Photos dans le fichier jusqu'à 40 Mo en tout ; au-delà, un lien de téléchargement par photo.
    const produitsBruts = db.prepare('SELECT id, donnees, supprime FROM produits WHERE boutique_id = ? ORDER BY ordre, rowid').all(b.id).map(r2 => ({ ...JSON.parse(r2.donnees), id: r2.id, ...(r2.supprime ? { supprime: true } : {}) }));
    const poidsImages = db.prepare('SELECT COALESCE(SUM(LENGTH(i.donnees)), 0) n FROM images_produits i JOIN produits p ON p.id = i.produit_id WHERE p.boutique_id = ?').get(b.id).n;
    const imagesDansFichier = poidsImages <= 40 * 1024 * 1024;
    const produits = produitsBruts.map(p2 => p2.image !== IMG ? p2 : imagesDansFichier ? { ...p2, image: imageDe(p2.id) } : { ...p2, image: `${urlPublique}/api/admin/export-complet/image/${encodeURIComponent(p2.id)}` });
    await pause();
    const commandes = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? ORDER BY numero').all(b.id).map(row => { const { jeton, ...c } = lireCommande(row); void jeton; return { ...c, date: iso(c.date) }; });
    const donnees = {
      format: 'comptoir-export', version: 1, exporteLe: new Date().toISOString(), boutique: { slug: b.slug, creeLe: iso(b.cree_le), compteurFactures: b.compteur_facture },
      configuration: config,
      produits, photos: imagesDansFichier ? 'dans le fichier' : 'à télécharger depuis le lien de chaque produit (connecté à Comptoir)',
      commandes,
      clients: [...commandes.reduce((map, c) => { const e = String((c.client && c.client.email) || '').toLowerCase(); if (!e) return map; const x = map.get(e) || { email: e, nom: c.client.nom, commandes: 0, total: 0, premiere: c.date, derniere: c.date }; x.commandes++; x.total = Math.round((x.total + (c.total || 0)) * 100) / 100; x.derniere = c.date; map.set(e, x); return map; }, new Map()).values()],
      avis: db.prepare('SELECT produit_id, commande_id, note, texte, prenom, ville, cree_le, reponse FROM avis WHERE boutique_id = ?').all(b.id).map(a => ({ ...a, cree_le: iso(a.cree_le) })),
      abonnes: db.prepare('SELECT email, cree_le, langue FROM abonnes WHERE boutique_id = ?').all(b.id).map(a => ({ ...a, cree_le: iso(a.cree_le) })),
      desinscriptions: db.prepare('SELECT email, cree_le FROM desinscriptions WHERE boutique_id = ?').all(b.id).map(a => ({ ...a, cree_le: iso(a.cree_le) })),
      // Nouveautés : devis (déchiffrés), cartes cadeaux (sans code : il n'est connu que du client), stock par emplacement,
      // programme de fidélité (soldes anonymes : seule une empreinte de l'e-mail est connue).
      devis: DV.lister(b.id).map(d => { const { historique, ...reste } = d; return { ...reste, creeLe: iso(d.creeLe), majLe: iso(d.majLe), historique }; }),
      cartesCadeaux: { vente: Cartes.reglagesVente(b.id), cartes: Cartes.lister(b.id, 100000).map(k => ({ ...k, creeLe: iso(k.creeLe), expireLe: iso(k.expireLe) })), mouvements: db.prepare('SELECT carte_id, le, type, montant, solde, commande_id FROM cartes_mouvements WHERE boutique_id = ? ORDER BY id').all(b.id).map(m2 => ({ ...m2, montant: m2.montant / 100, solde: m2.solde / 100, le: iso(m2.le) })) },
      emplacements: { liste: EMP.lister(b.id), repartition: EMP.repartition(b.id), mouvements: EMP.mouvements(b.id, 100000).map(m2 => ({ ...m2, le: iso(m2.le) })) },
      fidelite: { reglages: FID.reglages(b.id), comptes: db.prepare('SELECT points, actif_le FROM fidelite_comptes WHERE boutique_id = ? AND points > 0').all(b.id).map(c2 => ({ points: c2.points, actifLe: iso(c2.actif_le) })) },
      alertesStock: db.prepare('SELECT produit_id, variante_id, email, langue, cree_le FROM alertes_stock WHERE boutique_id = ?').all(b.id).map(a => ({ ...a, cree_le: iso(a.cree_le) })),
      journalVentes: db.prepare('SELECT seq, type, ref, commande_id, le, contenu, empreinte FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq').all(b.id).map(e => ({ ...e, le: iso(e.le), contenu: JSON.parse(e.contenu) }))
    };
    await pause();
    const corps = Buffer.from(JSON.stringify(donnees), 'utf8');   // sans indentation : moitié moins de mémoire
    // Prévenu seulement une fois le fichier prêt (un export qui échoue ne déclenche pas d'e-mail).
    noterActivite(m.id, 'export-complet', `${commandes.length} commandes`, ctx);
    envoyerEmail(null, m.email, 'Export complet de votre boutique Comptoir', `Bonjour,\n\nUn export complet de votre boutique (commandes, clients, produits) vient d’être téléchargé.\n\nCe n’est pas vous ? Changez votre mot de passe tout de suite et écrivez-nous.\n\nL’équipe Comptoir`);
    ctx.entetes['Cache-Control'] = 'private, no-store';
    ctx.entetes['Content-Disposition'] = `attachment; filename="comptoir-${b.slug}-${new Date().toISOString().slice(0, 10)}.json"`;
    return { binaire: corps, type: 'application/json; charset=utf-8' };
  });
  // Photo d'un produit (supprimé compris) pour un export trop lourd pour contenir les photos : propriétaire connecté seulement.
  r.get('/api/admin/export-complet/image/:id', exigerProprietaire, ctx => {
    const p = db.prepare('SELECT id FROM produits WHERE id = ? AND boutique_id = ?').get(String(ctx.params.id), ctx.boutique.id);
    const m = p && /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(imageDe(p.id) || '');
    if (!m) throw erreur(404, 'Image introuvable.', 'introuvable');
    ctx.entetes['Cache-Control'] = 'private, no-store';
    return { binaire: Buffer.from(m[3], 'base64'), type: m[1] };
  });
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
    oublierCommandes(ctx.boutique.id);   // plus de copie déchiffrée de ses commandes en mémoire
    const email = valider.email(ctx.corps.email).toLowerCase();
    const commandes = commandesDuClient(ctx.boutique.id, email);
    const ouvertes = commandes.filter(c => ['attente', 'payee', 'preparation', 'fournisseur', 'prete'].includes(c.statut));
    if (ouvertes.length) throw erreur(409, `Commande n° ${ouvertes[0].numero} encore en cours : effacez les données une fois qu’elle est expédiée ou annulée (l’adresse sert à la livraison).`, 'commande_en_cours');
    db.exec('PRAGMA secure_delete = ON');   // effacement : les données retirées ne restent pas lisibles dans le fichier
    try {
    transaction(db, () => {
      FID.effacer(ctx.boutique.id, email);   // points de fidélité de ce client
      DV.anonymiser(ctx.boutique.id, email, PII.normEmail);   // devis de ce client professionnel
      for (const c of commandes) {
        c.client = { nom: 'Client effacé', email: '', adresse: '', npa: '', ville: '', consentement: null };
        // Texte libre écrit par le client (motif de retour, repris dans l'historique) : effacé aussi.
        if (c.retour && c.retour.motif) { const motif = c.retour.motif; c.retour.motif = ''; c.historique = (c.historique || []).map(h => h.texte && h.texte.includes(motif) ? { ...h, texte: h.texte.split(motif).join('(effacé)') } : h); }
        historique(c, 'Données personnelles du client effacées à sa demande');
        enregistrerCommande(c);
        db.prepare("UPDATE avis SET prenom = 'Client', ville = '' WHERE boutique_id = ? AND commande_id = ?").run(ctx.boutique.id, c.id);
      }
      db.prepare('DELETE FROM abonnes WHERE boutique_id = ? AND email = ?').run(ctx.boutique.id, email);
      db.prepare("DELETE FROM emails WHERE boutique_id = ? AND lower(destinataire) = ?").run(ctx.boutique.id, email);
      integ.effacerClient(ctx.boutique.id, email);   // envois de webhooks gardés
      db.prepare('DELETE FROM alertes_stock WHERE boutique_id = ? AND email = ?').run(ctx.boutique.id, email);
      // Clés exactes (« bienvenue:<email> », « reconquete:<email>:<commande> ») : pas de LIKE, dont « _ » et « % » sont des jokers.
      for (const { cle } of db.prepare('SELECT cle FROM envois_auto WHERE boutique_id = ?').all(ctx.boutique.id)) {
        const parts = String(cle).split(':');
        if (parts.length >= 2 && parts[1].toLowerCase() === email) db.prepare('DELETE FROM envois_auto WHERE boutique_id = ? AND cle = ?').run(ctx.boutique.id, cle);
      }
    });
    } finally { db.exec('PRAGMA secure_delete = OFF'); }
    // La liste de désinscription garde l'adresse : elle sert justement à ne plus lui écrire.
    return { ok: true, commandes: commandes.length };
  });
  // Liens personnels des clients (confirmation d'inscription, désinscription) masqués : le marchand voit l'e-mail, pas le jeton.
  r.get('/api/admin/emails', exigerMarchand, ctx => db.prepare('SELECT destinataire, sujet, corps, cree_le FROM emails WHERE boutique_id = ? ORDER BY id DESC LIMIT 50').all(ctx.boutique.id)
    .map(e => ({ ...e, corps: courriel.masquerSecrets(String(e.corps || '').replace(/(\/(?:reinscription|desinscription)\?j=)[^\s"'<>]+/g, '$1…')) })));   // liens personnels et codes masqués

  /* ---------- Boutique publique ---------- */
  r.get('/api/public/:slug', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const config = configVente(b);
    const notes = statsAvis(b.id);
    const regime = config.boutique.pays === 'ch' ? 'ch' : 'ue';
    const produits = listerProduits(b.id).filter(vendable).map(({ cout, portF, codeFournisseur, fournisseur, source, aVerifier, historiquePrix, prixReference, ...p }) => {
      const pb = PrixBarres.verifier({ prix: p.prix, prixReference, historiquePrix }, regime);
      return { ...p, ...(Array.isArray(p.variantes) ? { variantes: p.variantes.map(({ ref, ...v }) => v) } : {}), ...(p.image === IMG ? { image: `/api/public/${encodeURIComponent(b.slug)}/image/${encodeURIComponent(p.id)}` } : {}), avis: notes[p.id] || null, ...(pb.ok ? { prixBarre: prixReference } : {}) };   // photo chargée à part (mise en cache par le navigateur)
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
      cartesCadeaux: (() => { const v = Cartes.reglagesVente(b.id); return v.actif ? { montants: v.montants } : null; })(),
      fidelite: (() => { const f = FID.reglages(b.id); return f.actif ? { pointsParUnite: f.pointsParUnite, valeurPour100: f.valeurPour100, seuil: f.seuil, plafondPct: f.plafondPct } : null; })(),
      offres: (({ paliersActifs, paliers, suggestions, barrePort, seuilPort, regles }) => ({ paliersActifs, paliers, suggestions, barrePort, seuilPort, regles: regles.filter(r => r.actif && r.type === 'panier') }))(Remises.offresDe(config)),
      // Le code de bienvenue n'est pas publié (il passerait outre la double confirmation de l'inscription) : seulement s'il existe.
      newsletter: (({ actif, remise, code }) => ({ actif, remise, code: !!code }))(relances.nettoyer(config.automatisations).bienvenue),
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
    const reserve = {}, parReseau = {};
    const indexClient = PII.index(b.id, emailClient);
    const empreinteReseau = crypto.createHmac('sha256', cleChiffrement).update(`reseau:${b.id}:${reseauIp(ctx.ip)}`).digest('hex').slice(0, 24);
    for (const r2 of db.prepare("SELECT date, donnees, email_index FROM commandes WHERE boutique_id = ? AND statut = 'attente' AND date > ?").all(b.id, Date.now() - 90 * 86400000)) {
      const d = JSON.parse(r2.donnees);   // lignes et moyen seulement : rien à déchiffrer
      // 30 minutes pour un paiement en ligne, 48 heures pour une facture QR (une commande fictive sur facture ne bloque pas le stock un mois).
      // Devis accepté : payé souvent par virement, stock réservé 7 jours.
      // Paiement en ligne : 35 minutes, plus longtemps que la page de paiement Stripe (fermée au bout de 31 minutes) : un
      // paiement ne peut donc pas aboutir après la fin de la réservation et vendre un article déjà revendu.
      const depuis = Math.max(r2.date, d.reserveDepuis || 0);
      const active = !(d.abandonneeLe >= depuis) && depuis > Date.now() - (d.moyen === 'facture' ? 48 * 3600000 : d.canal === 'devis' ? 7 * 86400000 : 35 * 60000);
      if (!active || (indexClient && r2.email_index === indexClient)) continue;   // son propre essai précédent ne bloque pas le client
      if (d.reseau === empreinteReseau && active && d.moyen !== 'facture' && d.canal !== 'devis') for (const l of d.lignes || []) if (l.type !== 'drop') parReseau[l.produitId] = (parReseau[l.produitId] || 0) + (l.qte || 0);
      for (const l of d.lignes || []) if (l.type !== 'drop') { reserve[l.produitId] = (reserve[l.produitId] || 0) + (l.qte || 0); if (l.varianteId) reserve[`${l.produitId}:${l.varianteId}`] = (reserve[`${l.produitId}:${l.varianteId}`] || 0) + (l.qte || 0); }
    }
    const produits = listerProduits(b.id).filter(vendable).map(p => !reserve[p.id] || p.type === 'drop' ? p : { ...p, stock: Math.max(0, p.stock - reserve[p.id]), ...(Array.isArray(p.variantes) ? { variantes: p.variantes.map(v => ({ ...v, stock: Math.max(0, v.stock - (reserve[`${p.id}:${v.id}`] || 0)) })) } : {}) });   // produit masqué ou du fournisseur de démonstration : « plus disponible »
    const lignesBrutes = prix.construireLignes(produits, ctx.corps.lignes).map(l => ({ ...l, codeFournisseur: (produits.find(p => p.id === l.produitId) || {}).codeFournisseur }));
    // Un même réseau ne réserve pas tout le stock sans payer : ses commandes impayées (adresses e-mail différentes, souvent
    // jetables ; la commande en cours comprise) retiennent au plus la moitié du stock d'un produit, au moins 3, au plus 20.
    // Un achat courant (jusqu'à 3 exemplaires, même s'ils sont les derniers) passe toujours (simulation de 60 jours : des
    // clients réels refusés avec un plancher de 2). Au-delà, le client paie d'abord, ou passe
    // par un devis (achats professionnels en quantité).
    { const parProduit = {}; for (const l of lignesBrutes) if (l.type !== 'drop') parProduit[l.produitId] = (parProduit[l.produitId] || 0) + l.qte;
      let tous = null; const stockDe = pid => { tous = tous || listerProduits(b.id); const p = tous.find(x => x.id === pid); return p ? Math.max(0, p.stock) : 0; };
      for (const [pid, q] of Object.entries(parProduit)) if ((parReseau[pid] || 0) + q > Math.min(20, Math.max(3, Math.ceil(stockDe(pid) / 2))) * facteurLimites) throw erreur(429, 'Quantité trop grande pour une commande en ligne non payée : terminez d’abord un paiement en cours, réduisez la quantité, ou demandez un devis à la boutique.', 'trop_reserve'); }
    const modes = prix.modesLivraison(config);
    const mode = typeof ctx.corps.livraison === 'string' && Object.hasOwn(modes, ctx.corps.livraison) ? modes[ctx.corps.livraison] : null;
    if (!mode) throw erreur(400, 'Mode de livraison indisponible.', 'livraison_invalide');
    const cl = ctx.corps.client || {};
    // Le nom est repris dans les e-mails de la boutique (« Bonjour … ») : une seule ligne, sans lien ni nom de domaine,
    // sinon n'importe qui ferait envoyer par la boutique un message de son choix à l'adresse de son choix.
    const client = {
      nom: nomSur(valider.texte(cl.nom, 'Le nom', { max: 100 })),
      email: valider.email(cl.email),
      adresse: ctx.corps.livraison === 'retrait' ? '' : sansLien(uneLigne(valider.texte(cl.adresse, 'L’adresse', { max: 200 })), 'L’adresse', 'adresse_invalide'),
      npa: ctx.corps.livraison === 'retrait' ? '' : uneLigne(valider.texte(cl.npa, 'Le code postal', { min: 4, max: 10 })),
      ville: sansLien(uneLigne(valider.texte(cl.ville, 'La ville', { max: 100 })), 'La ville', 'ville_invalide'),
      consentement: cl.consentement === true || cl.consentement === 'on' ? Date.now() : null
    };
    if (config.boutique.pays === 'ch' && client.npa && !/^\d{4}$/.test(client.npa)) throw erreur(400, 'Le NPA suisse compte 4 chiffres.', 'npa_invalide');
    // Commandes impayées : elles réservent le stock (30 minutes). Au plus 3 en cours par adresse e-mail et par réseau
    // (empreinte, jamais l'adresse IP en clair) : un visiteur ne garde pas un produit « épuisé » en enchaînant des
    // commandes jamais payées. Les commandes payées ne comptent pas.
    const impayees = db.prepare("SELECT COUNT(*) n FROM commandes WHERE boutique_id = ? AND statut = 'attente' AND date > ? AND (email_index = ? OR json_extract(donnees, '$.reseau') = ?)").get(b.id, Date.now() - 30 * 60000, PII.index(b.id, client.email) || '', empreinteReseau).n;
    if (impayees >= 3 * facteurLimites) throw erreur(429, 'Plusieurs commandes attendent déjà leur paiement : terminez un paiement en cours, ou réessayez dans 30 minutes.', 'trop_impayees');
    const calcul = Remises.appliquer(lignesBrutes, config, ctx.corps.code);
    if (ctx.corps.code && calcul.codeValide === false) throw erreur(400, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    if (calcul.codeMinimum) throw erreur(400, `Ce code s’applique dès ${formatMontant(calcul.codeMinimum, config)} d’achat.`, 'code_minimum');
    const codePromo = calcul.motif && calcul.motif.type === 'code' ? calcul.motif.code : null;
    // Le code de bienvenue est annoncé « sur votre première commande » : refusé à une adresse qui a déjà commandé ici.
    const bienvenue = ((config.automatisations || {}).bienvenue || {});
    const codeBienvenue = !!(calcul.motif && calcul.motif.code && bienvenue.code && calcul.motif.code.toUpperCase() === String(bienvenue.code).toUpperCase());
    if (codeBienvenue) {
      // Commandes en attente comprises si leur paiement est encore possible (lien ouvert depuis moins de 35 minutes, ou
      // facture QR) : deux commandes ouvertes ensemble ne profitent pas toutes deux du code. Une commande dont le client a
      // annulé le paiement ne compte pas : il peut recommencer avec le code. Reprendre plus tard l'ancienne est alors refusé.
      const deja = !!db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND email_index = ? AND statut <> 'annulee' AND (statut <> 'attente' OR json_extract(donnees, '$.moyen') = 'facture' OR EXISTS (SELECT 1 FROM paiements p WHERE p.commande_id = commandes.id AND p.statut = 'cree' AND p.cree_le > ?)) LIMIT 1").get(b.id, PII.index(b.id, client.email) || '', Date.now() - 35 * 60000);
      if (deja) throw erreur(400, `Le code ${bienvenue.code} est réservé à une première commande.`, 'code_premiere_commande');
    }
    let lignes = calcul.lignes, remise = calcul.remise, apresRemise = calcul.apresRemise;
    const sousTotal = calcul.sousTotal;
    // Points de fidélité : seulement avec le code reçu par e-mail (vérifié ici, consommé dans la transaction).
    // Les points déjà engagés par une autre commande en attente de ce client ne sont pas comptés deux fois.
    let fidelite = null;
    if (ctx.corps.fidelite) {
      const reg = FID.reglages(b.id);
      if (!reg.actif) throw erreur(400, 'Le programme de fidélité n’est pas actif.', 'fidelite_inactive');
      auth.limiter(`fidelite-commande:${b.id}:${ctx.ip}`, 20 * facteurLimites, 15 * 60000, 'Trop d’essais. Réessayez dans quelques minutes.');
      if (!FID.verifierCode(b.id, client.email, String(ctx.corps.fidelite.code || ''), { demande: String(ctx.corps.fidelite.demande || ''), reseau: reseauIp(ctx.ip) })) throw erreur(400, 'Code de fidélité invalide ou expiré : demandez-en un nouveau.', 'fidelite_code');
      // Points réservés par une commande en attente : déjà débités, donc absents du solde (pas de double utilisation).
      const res = Fidelite.appliquerPoints(lignes, reg, FID.solde(b.id, client.email));
      if (!res) throw erreur(400, `Pas assez de points pour une remise (minimum ${reg.seuil} points).`, 'fidelite_insuffisant');
      lignes = res.lignes; remise = prix.arrondi(remise + res.remise / 100); apresRemise = prix.arrondi(apresRemise - res.remise / 100);
      fidelite = { points: res.points, montant: res.remise / 100 };
    }
    const port = prix.fraisPort(mode, calcul.apresRemise, Remises.offresDe(config).seuilPort);   // seuil de port offert : avant les points
    const total = prix.arrondi(apresRemise + port);
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
    // Carte cadeau : un moyen de paiement (pas une remise : la TVA porte sur les articles). Montant réservé en la débitant
    // dans la transaction de la commande ; recrédité si la commande est annulée ou si le paiement du reste n'aboutit pas.
    let carte = null, centimesCarte = 0;
    if (ctx.corps.carteCadeau) {
      auth.limiter(`carte:${b.id}:${ctx.ip}`, 20 * facteurLimites, 15 * 60000, 'Trop d’essais de carte cadeau. Réessayez dans quelques minutes.');
      if (parFacture) throw erreur(400, 'La carte cadeau se combine avec le paiement en ligne, pas avec le paiement sur facture.', 'carte_facture');
      carte = Cartes.trouver(b.id, ctx.corps.carteCadeau);
      const dispo = Cartes.disponible(carte);
      if (!carte || !dispo || carte.devise !== devise) throw carteRefusee(b, carte);
      centimesCarte = Math.min(dispo, Math.round(total * 100));
      // Le prestataire de paiement refuse moins de 0,50 : la carte laisse alors 0,50 à payer en ligne.
      const reste = Math.round(total * 100) - centimesCarte;
      if (reste > 0 && reste < 50) centimesCarte = Math.round(total * 100) - 50;
      if (centimesCarte <= 0) throw erreur(400, 'Montant trop faible pour combiner carte cadeau et paiement en ligne.', 'carte_montant');
    }
    const resteCentimes = Math.round(total * 100) - centimesCarte;
    const compte = parFacture || !resteCentimes ? null : compteVente(b);   // avant toute écriture : sans compte de paiement actif, aucune commande n'est créée
    const { commande, pmt, payee } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      if (fidelite && !FID.verifierCode(b.id, client.email, String(ctx.corps.fidelite.code || ''), { demande: String(ctx.corps.fidelite.demande || ''), reseau: reseauIp(ctx.ip), consommer: true })) throw erreur(400, 'Code de fidélité invalide ou expiré : demandez-en un nouveau.', 'fidelite_code');
      { const refus = limiteCode(b.id, config, codePromo, client.email); if (refus) throw refus; }   // dans la transaction : deux commandes simultanées ne prennent pas la dernière utilisation
      const motifs = [calcul.motif ? calcul.motif.libelle : null, fidelite ? `${fidelite.points} points de fidélité` : null].filter(Boolean);
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', reseau: empreinteReseau, ...(codeBienvenue ? { codeBienvenue: true } : {}), ...(codePromo ? { codePromo } : {}), client, lignes, sousTotal, remise, motifRemise: motifs.length ? motifs.join(' + ') : null, ...(fidelite ? { fidelite } : {}), port, total, tauxTva: prix.tauxTva(config), livraison: ctx.corps.livraison, canal: 'web', suivi: '', note: '', historique: [{ date: now, texte: 'Commande passée en ligne, paiement en attente' + (remise ? ` (remise : ${motifs.join(' + ')})` : '') }] };
      prix.figerTaux(c, config);   // taux de TVA figé par ligne (taux réduit des denrées alimentaires)
      // Langue dans laquelle le client a commandé (parmi celles de la boutique) : ses e-mails suivent.
      if (typeof ctx.corps.langue === 'string' && ctx.corps.langue !== 'fr' && EmailsClients.LANGUES.includes(ctx.corps.langue) && (config.boutique.langues || []).includes(ctx.corps.langue)) c.langue = ctx.corps.langue;
      // Score de risque (fraude, revente) : explicable, il ne bloque pas la vente.
      try {
        // Client de confiance : une commande déjà expédiée, livrée ou retirée (pas une commande remboursée).
        const clientConnu = !!db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND statut IN ('expediee', 'livree', 'retiree') AND email_index = ? LIMIT 1").get(b.id, PII.index(b.id, client.email) || '');
        c.risque = Risque.evaluer(c, { reseau: ctx.ip, compteurs: compteursRisque, panierMoyen: panierMoyen(b.id), clientConnu, boutique: b.id });
        if (c.risque.niveau !== 'faible') c.historique.push({ date: now, texte: `Risque ${c.risque.niveau === 'eleve' ? 'élevé' : 'moyen'} (${c.risque.score}/100) : ${c.risque.raisons.join(' ; ')}` });
      } catch (e) { journal.error('[risque]', e.message); }
      if (client.email) { const em = String(client.email).toLowerCase(); compteursRisque.ajouter(`r:${b.id}:${ctx.ip}`, em, now); compteursRisque.ajouter(`e:${b.id}:${em}`, ctx.ip, now); }
      if (parFacture) {
        c.moyen = 'facture'; c.facture = prochaineFacture(b.id, now); c.dateFacture = now;
        c.echeance = now + config.reglages.echeanceJours * 86400000; c.referenceQr = referencePaiement(b, numero, config.entreprise.iban);
        c.historique = [...(c.historique || []), { date: now, texte: `Facture QR ${c.facture} émise, payable jusqu’au ${new Date(c.echeance).toLocaleDateString('fr-CH')}` }];
      }
      if (carte) {
        c.carteCadeau = { id: carte.id, fin: carte.fin, montant: centimesCarte / 100, reserveLe: now };
        c.historique.push({ date: now, texte: `Carte cadeau ····${carte.fin} : ${formatMontant(centimesCarte / 100, config)} réservés${resteCentimes ? `, reste ${formatMontant(resteCentimes / 100, config)} à payer en ligne` : ''}` });
      }
      // Points de fidélité débités dès la commande (rendus si le paiement n'aboutit pas) : jamais utilisés deux fois.
      if (fidelite) {
        if (FID.debiter(b.id, client.email, fidelite.points, { commandeId: c.id, maintenant: now }) < fidelite.points) throw erreur(409, 'Le solde de vos points vient de changer : réessayez.', 'fidelite_solde');
        c.fidelite = { ...fidelite, debite: fidelite.points, reserveLe: now };
      }
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      insererCommande(id, b.id, n, date, statut, jeton, donnees);
      // Débit conditionnel (solde suffisant) : deux commandes simultanées ne dépensent pas deux fois la même carte.
      if (carte && !Cartes.debiter(carte.id, centimesCarte, { commandeId: c.id, texte: `Commande n° ${numero}`, maintenant: now })) throw erreur(409, 'Le solde de la carte cadeau vient de changer : vérifiez-le et réessayez.', 'carte_solde');
      if (donnees.facture) sceller(b.id, c);   // facture QR émise à la commande
      if (parFacture) return { commande: { ...c, jeton }, pmt: null };
      // Entièrement payée par la carte : payée tout de suite, sans paiement en ligne.
      if (!resteCentimes) { const res = marquerPayee(db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.id), `Payée par carte cadeau ····${carte.fin} (${formatMontant(total, config)})`); return { commande: { ...res.c, jeton }, pmt: null, payee: res }; }
      const p = { id: auth.nouvelId('pay_'), commande_id: c.id, montant_centimes: resteCentimes };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, c.id, paiement.nom, resteCentimes, devise, 'cree', now, compte);
      return { commande: { ...c, jeton }, pmt: p };
    });
    if (payee) {
      await apresPaiement(payee);
      return { statut: 201, corps: { commandeId: commande.id, numero: commande.numero, jeton: commande.jeton, total, payeeParCarte: true, paiementUrl: `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}` } };
    }
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
      transaction(db, () => {
        if (commande.carteCadeau) Cartes.crediter(commande.carteCadeau.id, Math.round(commande.carteCadeau.montant * 100), { commandeId: commande.id, texte: `Commande n° ${commande.numero} : paiement en ligne impossible` });
        if (commande.fidelite && commande.fidelite.debite) FID.crediter(b.id, commande.client.email, commande.fidelite.debite, { commandeId: commande.id, type: 'liberation' });
        db.prepare('DELETE FROM paiements WHERE commande_id = ?').run(commande.id); db.prepare('DELETE FROM commandes WHERE id = ?').run(commande.id);
      });
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
${FEUILLE_1}</head><body>
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
  /* Reprise : pièces émises avant le journal, ou dont le scellement a été interrompu : scellées une fois, dans l'ordre de leur date. */
  try {
    const n = JV().reprendre(lireCommande, { signaler: (bid, c, quoi) => journal.error(`[journal-inalterable] reprise : commande n° ${c.numero} de la boutique ${bid} non scellée (${quoi}). À examiner : le journal signale ce numéro à la vérification.`) });
    if (n) journal.log(`[journal-inalterable] ${n} pièce(s) reprise(s)`);
  } catch (e) { journal.error('[journal-inalterable] reprise', e.message); }
  if (env.NODE_ENV === 'production' && !/^[0-9a-f]{64}$/i.test(env.SECRET_CHIFFREMENT || '')) journal.error('[securite] ATTENTION : SECRET_CHIFFREMENT absent. La clé qui chiffre les secrets de double authentification et signe le journal des ventes est gardée dans la base : une copie de la base suffit à les lire et à recalculer le journal.');
  if (JV().etat('').cleChangee) journal.error('[journal-inalterable] ATTENTION : la clé de signature a changé (SECRET_CHIFFREMENT). Les journaux existants ne peuvent plus être vérifiés ; remettez l’ancienne clé.');
  const lireCommandesParIds = boutiqueId => ids => {
    const m = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const tranche = ids.slice(i, i + 500);
      for (const row of db.prepare(`SELECT * FROM commandes WHERE boutique_id = ? AND id IN (${tranche.map(() => '?').join(', ')})`).all(boutiqueId, ...tranche)) m.set(row.id, lireCommande(row));
    }
    return m;
  };
  const verificationsEnCours = new Set();
  async function verifierJournal(b, ancre = null, maintenant = Date.now()) {
    if (verificationsEnCours.has(b.id)) throw erreur(429, 'Une vérification est déjà en cours pour cette boutique.', 'en_cours');
    verificationsEnCours.add(b.id);
    try { return await JV().verifier(b.id, { lireCommandes: lireCommandesParIds(b.id), compteurFactures: db.prepare('SELECT compteur_facture FROM boutiques WHERE id = ?').get(b.id).compteur_facture, ancre, maintenant }); }
    finally { verificationsEnCours.delete(b.id); }
  }
  /* Journal inaltérable : état (rapide), vérification complète à la demande (par lots), export pour l'archivage. */
  r.get('/api/admin/journal-inalterable', exigerMarchand, ctx => JV().etat(ctx.boutique.id));
  r.post('/api/admin/journal-inalterable/verifier', exigerMarchand, async ctx => {
    auth.limiter('journal-verifier:' + ctx.boutique.id, 6 * facteurLimites, 3600000, 'Vérification déjà faite plusieurs fois cette heure : réessayez plus tard.');
    const ancre = typeof ctx.corps.ancre === 'string' && /^[0-9a-f]{64}$/i.test(ctx.corps.ancre.trim()) ? ctx.corps.ancre.trim() : null;
    if (ctx.corps.ancre && !ancre) throw erreur(400, 'Empreinte invalide : 64 caractères (chiffres et lettres a à f).', 'ancre');
    return verifierJournal(ctx.boutique, ancre);
  });
  r.get('/api/admin/journal-inalterable/export', exigerMarchand, ctx => {
    ctx.entetes['Cache-Control'] = 'private, no-store';
    ctx.entetes['Content-Disposition'] = `attachment; filename="journal-inalterable-${ctx.boutique.slug}.csv"`;
    return { binaire: Buffer.from(JV().exporterCsv(ctx.boutique.id), 'utf8'), type: 'text/csv; charset=utf-8' };
  });
  /* Facture électronique (XML CII, norme EN 16931, format de Factur-X) : pour le logiciel comptable ou une plateforme agréée.
     Même contrôle pour le XML seul et pour le PDF Factur-X qui le contient : rien n'est produit s'il manque une mention
     ou si les montants du XML sont incohérents. */
  const factureStructuree = ctx => {
    const c0 = commandeDeBoutique(ctx.boutique.id, ctx.params.id), config = lireConfig(ctx.boutique);
    const r0 = documentStructure(c0, config, ctx.query.get('avoir'));
    ctx.entetes['Cache-Control'] = 'private, no-store';
    return r0;
  };
  // Pièce d'une commande (facture, avoir final « 1 », ou avoir partiel « AV-… ») : XML EN 16931 contrôlé avant d'être servi.
  const documentStructure = (c0, config, q) => {
    // ?avoir=1 : avoir final ; ?avoir=AV-… : un avoir partiel (retour d'une partie des articles).
    const piece = q && q !== '1' ? (c0.retoursPartiels || []).find(p => p.numero === q) : null;
    if (q && q !== '1' && !piece) throw erreur(404, 'Avoir introuvable pour cette commande.', 'introuvable');
    const avoir = !!q;
    if (q === '1' && !c0.avoir) throw erreur(404, 'Cette commande n’a pas d’avoir.', 'introuvable');
    const c = piece ? Retours.vuePartielle(c0, piece) : q === '1' && (c0.retoursPartiels || []).length ? Retours.vueReste(c0) : c0;
    const manque = FactureElectronique.manques(c, config);
    if (manque.length) throw erreur(409, `Facture électronique impossible : il manque : ${manque.join(', ')}. À compléter dans Paramètres, Conformité.`, 'incomplet');
    const devise = config.boutique.devise || 'EUR';
    const xml = FactureElectronique.produire(c, config, { avoir, devise });
    const incoherences = FactureElectronique.verifier(xml);
    if (incoherences.length) { journal.error('[facture-electronique]', c.id, incoherences.join(', ')); throw erreur(500, 'Facture électronique incohérente : elle n’a pas été produite. Signalez-le au support.', 'incoherent'); }
    return { c, config, avoir, devise, xml, nom: String(avoir ? c.avoir.numero : c.facture).replace(/[^\w.-]/g, '_') };
  };
  r.get('/api/admin/commandes/:id/facture-electronique', exigerMarchand, ctx => {
    const { xml, nom } = factureStructuree(ctx);
    ctx.entetes['Content-Disposition'] = `attachment; filename="${nom}.xml"`;
    return { binaire: Buffer.from(xml, 'utf8'), type: 'application/xml; charset=utf-8' };
  });
  /* Factur-X : la facture en PDF/A-3, lisible par une personne, avec le XML EN 16931 joint (factur-x.xml). */
  r.get('/api/admin/commandes/:id/facture-pdf', exigerMarchand, ctx => {
    const { c, config, avoir, devise, xml, nom } = factureStructuree(ctx);
    ctx.entetes['Content-Disposition'] = `attachment; filename="${nom}.pdf"`;
    return { binaire: FacturxPdf.produire(c, config, { avoir, devise, xml }), type: 'application/pdf' };
  });
  /* Pièces de la commande pour le client (facture, avoirs) en PDF Factur-X : avec le jeton personnel de sa commande,
     comme la page de suivi. Rien pour une carte cadeau vendue (pas de facture : bon à usages multiples). */
  r.get('/api/public/:slug/commandes/:id/document', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    auth.limiter('document-client:' + ctx.ip, 60 * facteurLimites, 3600000, 'Trop de téléchargements. Réessayez plus tard.');
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!row || !auth.egal(String(ctx.query.get('jeton') || ''), row.jeton_client)) throw erreur(404, 'Document introuvable.', 'introuvable');
    const c = lireCommande(row);
    if (!c.facture || c.canal === 'carte') throw erreur(404, 'Document introuvable.', 'introuvable');
    let doc;
    try { doc = documentStructure(c, lireConfig(b), ctx.query.get('avoir') || null); }
    catch (e) {
      if (e.statut === 409) throw erreur(409, 'Ce document n’est pas encore disponible : la boutique complète ses informations. Contactez-la si besoin.', 'indisponible');
      if (e.statut >= 500) throw erreur(500, 'Ce document ne peut pas être produit pour l’instant. Contactez la boutique.', 'indisponible');
      throw e;
    }
    ctx.entetes['Cache-Control'] = 'private, no-store';
    ctx.entetes['Content-Disposition'] = `attachment; filename="${doc.nom}.pdf"`;
    return { binaire: FacturxPdf.produire(doc.c, doc.config, { avoir: doc.avoir, devise: doc.devise, xml: doc.xml }), type: 'application/pdf' };
  });
  /* ---------- Programme de fidélité ---------- */
  r.get('/api/admin/fidelite', exigerMarchand, ctx => ({ reglages: FID.reglages(ctx.boutique.id), stats: FID.stats(ctx.boutique.id), registreCoherent: !FID.verifier(ctx.boutique.id).length }));
  r.put('/api/admin/fidelite', exigerMarchand, ctx => { const reg = FID.ecrireReglages(ctx.boutique.id, ctx.corps); noterActivite(ctx.marchand.id, 'fidelite', reg.actif ? 'Programme activé ou modifié' : 'Programme désactivé', ctx); return { reglages: reg }; });
  // Code pour utiliser ses points : même réponse que l'adresse ait des points ou non (aucune information sur les clients) ;
  // un e-mail n'est envoyé qu'aux adresses qui ont des points (pas d'envoi à une adresse quelconque).
  r.post('/api/public/:slug/fidelite/code', ctx => {
    const b = boutiqueOuverte(ctx.params.slug), reg = FID.reglages(b.id);
    if (!reg.actif) throw erreur(404, 'Programme de fidélité inactif.', 'fidelite_inactive');
    const email = valider.email(ctx.corps.email);
    auth.limiter(`fidelite-code:${b.id}:${reseauIp(ctx.ip)}`, 5 * facteurLimites, 15 * 60000, 'Trop de demandes de code. Réessayez dans quelques minutes.');
    // Codes demandés pour une adresse : 3 par heure depuis un même réseau, 10 tous réseaux confondus (un tiers ne coupe pas
    // l'accès du client à ses codes depuis chez lui).
    const cleEmail = email.normalize('NFC').toLowerCase();
    auth.limiter(`fidelite-code-email:${b.id}:${cleEmail}:${reseauIp(ctx.ip)}`, 3 * facteurLimites, 3600000, 'Un code a déjà été envoyé à cette adresse : vérifiez vos e-mails.');
    // (le plafond tous réseaux ne s'applique pas au réseau où le client a déjà saisi un code juste)
    if (!FID.reseauSur(b.id, email, reseauIp(ctx.ip))) auth.limiter(`fidelite-code-email-tout:${b.id}:${cleEmail}`, 10 * facteurLimites, 3600000, 'Un code a déjà été envoyé à cette adresse : vérifiez vos e-mails.');
    const points = FID.solde(b.id, email);
    // Même réponse (une demande) que l'adresse ait des points ou non : rien n'indique qui est client.
    let demande = crypto.randomBytes(18).toString('base64url');
    if (points > 0) {
      const config = lireConfig(b), nc = FID.nouveauCode(b.id, email), code = nc.code; demande = nc.demande;
      const langue = typeof ctx.corps.langue === 'string' && (config.boutique.langues || []).includes(ctx.corps.langue) ? ctx.corps.langue : null;
      const traduit = langue && EmailsClients.codeFidelite(langue, { nomBoutique: config.boutique.nom, points, valeur: formatMontant(FID.valeur(reg, points) / 100, config), code });
      if (traduit) envoyerEmail(b.id, email, traduit.sujet, traduit.corps, { langue });
      else envoyerEmail(b.id, email, `${config.boutique.nom} : votre code pour utiliser vos points`, `Bonjour,\n\nVous avez ${points} points de fidélité chez ${config.boutique.nom} (${formatMontant(FID.valeur(reg, points) / 100, config)}).\n\nVotre code pour les utiliser sur votre commande : ${code}\nIl est valable 15 minutes.\n\nVous n'avez rien demandé ? Ignorez cet e-mail : sans ce code, personne ne peut utiliser vos points.\n\n${config.boutique.nom}`);
    }
    return { ok: true, demande };
  });
  r.post('/api/public/:slug/fidelite/solde', ctx => {
    const b = boutiqueOuverte(ctx.params.slug), reg = FID.reglages(b.id);
    if (!reg.actif) throw erreur(404, 'Programme de fidélité inactif.', 'fidelite_inactive');
    const email = valider.email(ctx.corps.email);
    auth.limiter(`fidelite-solde:${b.id}:${reseauIp(ctx.ip)}`, 20 * facteurLimites, 15 * 60000, 'Trop d’essais. Réessayez dans quelques minutes.');
    if (!FID.verifierCode(b.id, email, String(ctx.corps.code || ''), { demande: String(ctx.corps.demande || ''), reseau: reseauIp(ctx.ip) })) {
      // Frein de la boutique : seuls les mauvais codes le consomment ; un code juste passe toujours.
      if (!FID.reseauSur(b.id, email, reseauIp(ctx.ip))) auth.limiter(`fidelite-echecs:${b.id}`, 300 * facteurLimites, 3600000, 'Trop de codes erronés sur cette boutique : réessayez dans un moment.');
      throw erreur(400, 'Code invalide ou expiré : demandez-en un nouveau.', 'fidelite_code'); }
    const points = FID.solde(b.id, email);
    return { points, valeur: FID.valeur(reg, points) / 100, seuil: reg.seuil, plafondPct: reg.plafondPct, utilisable: points >= reg.seuil };
  });

  /* ---------- Devis pour les clients professionnels ---------- */
  const FEUILLE_DEVIS = feuille(`*{box-sizing:border-box}body{margin:0;background:#F4F5F7;color:#151821;font:15px/1.5 system-ui,sans-serif}main{max-width:820px;margin:24px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.haut{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.haut h1{margin:0;font-size:22px}.sous{color:#5B6170;font-size:14px}.num{text-align:right;white-space:nowrap}
table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px 6px;border-bottom:1px solid #E3E5EA;text-align:left;vertical-align:top}th{font-size:13px;color:#5B6170;font-weight:600}
.totaux{margin-left:auto;max-width:340px}.totaux div{display:flex;justify-content:space-between;padding:3px 0}.totaux .total{font-weight:700;font-size:17px;border-top:2px solid #151821;margin-top:6px;padding-top:8px}
.encart{background:#F4F5F7;border-radius:8px;padding:14px 16px;margin:18px 0}.ok{background:#E8F5EE}.alerte{background:#FDF0E6}
form{margin:14px 0}label{display:block;margin:10px 0}input[type=text]{width:100%;max-width:420px;padding:10px;border:1px solid #C9CDD5;border-radius:8px;font:inherit}
button{font:inherit;padding:11px 18px;border-radius:8px;border:0;background:#1F5F8B;color:#fff;cursor:pointer}button.second{background:#fff;color:#151821;border:1px solid #C9CDD5}
button:focus-visible,input:focus-visible{outline:3px solid #1F5F8B;outline-offset:2px}.mono{font-family:ui-monospace,monospace}
@media (max-width:600px){main{margin:0;border-radius:0;padding:20px 16px}th:nth-child(3),td:nth-child(3){display:none}}@media print{body{background:#fff}main{box-shadow:none;margin:0}form,.imp{display:none}}`);
  const lienDevis = (b, d, jeton) => `${urlPublique}/devis/${encodeURIComponent(b.slug)}/${d.id}?jeton=${encodeURIComponent(jeton)}`;
  const statutDevis = (d, maintenant = Date.now()) => DV.expire(d, maintenant) ? 'expire' : d.statut;
  const resumeDevis = d => ({ id: d.id, numero: d.numero, statut: statutDevis(d), creeLe: d.creeLe, majLe: d.majLe, client: d.client, objet: d.objet, total: d.total, valableJusquau: d.valableJusquau || null, acceptation: d.acceptation || null, commande: d.commande ? { id: d.commande.id, numero: d.commande.numero } : null });
  r.get('/api/admin/devis', exigerMarchand, ctx => ({ devis: DV.lister(ctx.boutique.id).map(resumeDevis) }));
  r.get('/api/admin/devis/:id', exigerMarchand, ctx => { const d = DV.deBoutique(ctx.boutique.id, ctx.params.id); const { commande, ...reste } = d; return { devis: { ...reste, statut: statutDevis(d), commande: commande ? { id: commande.id, numero: commande.numero } : null, ventilation: Devis.ventiler(d, lireConfig(ctx.boutique)) } }; });
  r.post('/api/admin/devis', exigerMarchand, ctx => {
    auth.limiter(`devis:${ctx.boutique.id}`, 500 * facteurLimites, 86400000, 'Trop de devis créés aujourd’hui.');
    const config = lireConfig(ctx.boutique);
    const contenu = Devis.preparer(ctx.corps, listerProduits(ctx.boutique.id).filter(vendable), config);
    return { statut: 201, corps: { devis: resumeDevis(DV.nouveau(ctx.boutique.id, contenu)) } };
  });
  r.put('/api/admin/devis/:id', exigerMarchand, ctx => {
    const d = DV.deBoutique(ctx.boutique.id, ctx.params.id);
    // Un devis accepté, refusé ou annulé ne change plus. Modifier un devis envoyé le repasse en brouillon : l'ancien lien ne marche plus.
    if (!['brouillon', 'envoye'].includes(d.statut)) throw erreur(409, 'Ce devis ne peut plus être modifié : dupliquez-le.', 'fige');
    const contenu = Devis.preparer(ctx.corps, listerProduits(ctx.boutique.id).filter(vendable), lireConfig(ctx.boutique));
    const etaitEnvoye = d.statut === 'envoye';
    Object.assign(d, contenu, { statut: 'brouillon', valableJusquau: null });
    d.historique.push({ date: Date.now(), texte: etaitEnvoye ? 'Modifié après envoi : repassé en brouillon, ancien lien désactivé' : 'Modifié' });
    transaction(db, () => { DV.ecrire(d); if (etaitEnvoye) db.prepare('UPDATE devis SET jeton_hash = NULL WHERE id = ?').run(d.id); });
    return { devis: resumeDevis(d) };
  });
  r.post('/api/admin/devis/:id/envoyer', exigerMarchand, ctx => {
    exigerEmailVerifie(ctx, 'envoyer un devis');
    const d = DV.deBoutique(ctx.boutique.id, ctx.params.id);
    if (!['brouillon', 'envoye'].includes(d.statut)) throw erreur(409, 'Ce devis n’est plus modifiable ni envoyable.', 'fige');
    const config = lireConfig(ctx.boutique), maintenant = Date.now();
    if (!String((config.entreprise || {}).adresse || '').trim() || !(config.entreprise || {}).raison) throw erreur(409, 'Renseignez d’abord votre raison sociale et votre adresse (Paramètres, Conformité) : elles figurent sur le devis.', 'entreprise_incomplete');
    auth.limiter(`devis-envoi:${ctx.boutique.id}`, 200 * facteurLimites, 86400000, 'Trop de devis envoyés aujourd’hui.');
    const jeton = DV.nouveauJeton(d.id);
    // Validité : à compter du premier envoi (un renvoi ne la prolonge pas).
    // (sauf devis expiré : le renvoyer lui redonne sa durée de validité, le marchand le confirme ainsi).
    if (d.statut === 'brouillon' || !d.valableJusquau || d.valableJusquau < maintenant) d.valableJusquau = maintenant + d.validiteJours * 86400000;
    d.statut = 'envoye'; d.envoyeLe = maintenant;
    d.historique.push({ date: maintenant, texte: "Envoyé au client par e-mail" });   // sans l’adresse : l’historique n’est pas chiffré
    DV.ecrire(d);
    const lien = lienDevis(ctx.boutique, d, jeton);
    envoyerEmail(ctx.boutique.id, d.client.email, `Devis ${d.numero} de ${config.boutique.nom}${d.objet ? ` : ${d.objet}` : ''}`,
      `Bonjour${d.client.contact ? ` ${d.client.contact}` : ''},\n\nVoici notre devis ${d.numero} pour ${d.client.raison} : ${formatMontant(d.total, config)} TTC, valable jusqu’au ${new Date(d.valableJusquau).toLocaleDateString('fr-FR')}.\n\nConsulter, accepter ou refuser le devis en ligne :\n${lien}\n\nUne fois accepté, il devient une commande, payable en ligne ou par virement.\n\n${(config.entreprise || {}).raison || config.boutique.nom}`);
    return { devis: resumeDevis(d), lien };
  });
  r.post('/api/admin/devis/:id/annuler', exigerMarchand, ctx => {
    const d = DV.deBoutique(ctx.boutique.id, ctx.params.id);
    if (!['brouillon', 'envoye'].includes(d.statut)) throw erreur(409, 'Seul un devis en brouillon ou envoyé peut être annulé.', 'fige');
    d.statut = 'annule'; d.historique.push({ date: Date.now(), texte: 'Annulé' });
    transaction(db, () => { DV.ecrire(d); db.prepare('UPDATE devis SET jeton_hash = NULL WHERE id = ?').run(d.id); });
    return { devis: resumeDevis(d) };
  });
  r.post('/api/admin/devis/:id/dupliquer', exigerMarchand, ctx => {
    const d = DV.deBoutique(ctx.boutique.id, ctx.params.id);
    // Recalcul à partir de la saisie : prix du catalogue d'aujourd'hui, remise et lignes libres reprises telles quelles.
    const saisie = { client: d.client, objet: d.objet, conditions: d.conditions, remisePct: d.remisePct, port: d.port, validiteJours: d.validiteJours,
      lignes: d.lignes.map(l => l.produitId ? { produitId: l.produitId, varianteId: l.varianteId, qte: l.qte } : { nom: l.nom, qte: l.qte, prixHt: l.prixHtSaisi ?? Math.round(l.prixTtc / (1 + l.tauxTva) * 100) / 100, tauxReduit: l.tauxReduit }) };
    const contenu = Devis.preparer(saisie, listerProduits(ctx.boutique.id).filter(vendable), lireConfig(ctx.boutique));
    const n = DV.nouveau(ctx.boutique.id, contenu);
    n.historique.push({ date: Date.now(), texte: `Copie du devis ${d.numero}` }); DV.ecrire(n);
    return { statut: 201, corps: { devis: resumeDevis(n) } };
  });

  /* Page publique du devis (lien secret) : consultation, acceptation (bon pour accord), refus, paiement. */
  const lireFormulaire = ctx => Object.fromEntries(new URLSearchParams(String(ctx.corpsBrut || '').slice(0, 4000)));
  const devisPublic = (ctx, jeton) => {
    const b = boutiqueOuverte(ctx.params.slug);
    const d = DV.parLien(b.id, ctx.params.id, jeton);
    if (!d || d.statut === 'brouillon' || d.statut === 'annule') throw erreur(404, 'Devis introuvable ou lien expiré. Demandez un nouveau lien à l’entreprise.', 'introuvable');
    return { b, d, config: lireConfig(b) };
  };
  function pageDevis(b, d, config, jeton, message = '') {
    const e = config.entreprise || {}, m = n => escHtml(formatMontant(n, config)), pct = t => `${(Math.round(t * 1000) / 10).toString().replace('.', ',')} %`;
    const vent = Devis.ventiler(d, config), sansTva = vent.every(v => !v.taux), st = statutDevis(d);
    const cmd = d.commande ? db.prepare('SELECT statut FROM commandes WHERE id = ?').get(d.commande.id) : null;
    const champJeton = `<input type="hidden" name="jeton" value="${escHtml(jeton)}">`;
    const action = suffixe => `/devis/${encodeURIComponent(b.slug)}/${encodeURIComponent(d.id)}/${suffixe}`;
    let bloc = '';
    if (st === 'envoye') bloc = `<form method="post" action="${action('accepter')}">${champJeton}<h2>Accepter ce devis</h2>
      <label>Nom et fonction du signataire<br><input type="text" name="nom" required maxlength="120" autocomplete="name"></label>
      <label><input type="checkbox" name="accord" value="oui" required> Bon pour accord : j’accepte ce devis et ses conditions au nom de ${escHtml(d.client.raison)}.</label>
      <button>Accepter le devis</button></form>
      <form method="post" action="${action('refuser')}">${champJeton}<button class="second">Refuser le devis</button></form>`;
    else if (st === 'expire') bloc = `<div class="encart alerte">Ce devis a expiré le ${new Date(d.valableJusquau).toLocaleDateString('fr-FR')}. Demandez un nouveau devis à ${escHtml(e.raison || config.boutique.nom)}.</div>`;
    else if (st === 'refuse') bloc = '<div class="encart">Devis refusé. Merci de votre réponse.</div>';
    else if (st === 'accepte') {
      bloc = `<div class="encart ok">Devis accepté le ${new Date(d.acceptation.le).toLocaleDateString('fr-FR')} par ${escHtml(d.acceptation.nom)}. Commande n° ${d.commande.numero}.</div>`;
      if (cmd && cmd.statut === 'attente') bloc += `<h2>Paiement</h2><form method="post" action="${action('payer')}">${champJeton}<button>Payer ${m(d.total)} en ligne</button></form>`
        + (e.iban ? `<p>Ou par virement : IBAN <span class="mono">${escHtml(String(e.iban).replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim())}</span>, titulaire ${escHtml(e.raison || '')}, référence <b>Commande ${d.commande.numero}</b>. La commande est préparée dès réception du paiement.</p>` : '');
      else if (cmd && cmd.statut !== 'annulee') bloc += '<p>Paiement reçu. Merci !</p>';
    }
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Devis ${escHtml(d.numero)} · ${escHtml(config.boutique.nom)}</title>${FEUILLE_DEVIS}</head><body><main>
<div class="haut"><div><b>${escHtml(e.raison || config.boutique.nom)}</b><div class="sous">${escHtml(e.adresse || '')}${e.email ? `<br>${escHtml(e.email)}` : ''}${e.siret ? `<br>${escHtml(e.siret)}` : ''}${e.tvaIntra ? `<br>N° TVA ${escHtml(e.tvaIntra)}` : ''}</div></div>
<div class="num"><h1>Devis ${escHtml(d.numero)}</h1><div class="sous">du ${new Date(d.envoyeLe || d.creeLe).toLocaleDateString('fr-FR')}${d.valableJusquau ? `<br>valable jusqu’au ${new Date(d.valableJusquau).toLocaleDateString('fr-FR')}` : ''}</div></div></div>
${message ? `<div class="encart ${/accept|reçu/.test(message) ? 'ok' : ''}" role="status">${escHtml(message)}</div>` : ''}
<p><span class="sous">Pour</span><br><b>${escHtml(d.client.raison)}</b>${d.client.contact ? `<br>${escHtml(d.client.contact)}` : ''}${d.client.adresse ? `<br>${escHtml(d.client.adresse)}` : ''}${d.client.npa || d.client.ville ? `<br>${escHtml(`${d.client.npa} ${d.client.ville}`.trim())}` : ''}${d.client.tva ? `<br>N° TVA ${escHtml(d.client.tva)}` : ''}</p>
${d.objet ? `<p><b>Objet :</b> ${escHtml(d.objet)}</p>` : ''}
<table><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">${sansTva ? 'Prix unitaire' : 'PU HT'}</th>${sansTva ? '' : '<th class="num">TVA</th>'}<th class="num">Total ${sansTva ? '' : 'TTC'}</th></tr></thead><tbody>
${d.lignes.map(l => `<tr><td>${escHtml(l.nom)}</td><td class="num">${l.qte}</td><td class="num">${m(sansTva ? l.prixTtc : typeof l.prixHtSaisi === 'number' ? l.prixHtSaisi : l.prixTtc / (1 + l.tauxTva))}</td>${sansTva ? '' : `<td class="num">${pct(l.tauxTva)}</td>`}<td class="num">${m(l.totalTtcBrut ?? l.prixTtc * l.qte)}</td></tr>`).join('')}
${d.remise ? `<tr><td>Remise ${String(d.remisePct).replace('.', ',')} %</td><td></td><td></td>${sansTva ? '' : '<td></td>'}<td class="num">−${m(d.remise)}</td></tr>` : ''}
${d.port ? `<tr><td>Livraison</td><td class="num">1</td><td></td>${sansTva ? '' : '<td class="num">au prorata</td>'}<td class="num">${m(d.port)}</td></tr>` : ''}</tbody></table>
<div class="totaux">${sansTva ? '' : vent.map(v => `<div><span>Base HT ${pct(v.taux)}</span><span>${m(v.ht)}</span></div><div><span>TVA ${pct(v.taux)}</span><span>${m(v.tva)}</span></div>`).join('')}<div class="total"><span>Total ${sansTva ? '' : 'TTC'}</span><span>${m(d.total)}</span></div></div>
${sansTva ? `<p class="sous">${escHtml(config.boutique.pays === 'ch' ? 'Entreprise non assujettie à la TVA.' : config.boutique.pays === 'be' ? 'Régime particulier de franchise des petites entreprises.' : 'TVA non applicable, art. 293 B du CGI.')}</p>` : ''}
${d.conditions ? `<h2>Conditions</h2><p>${escHtml(d.conditions).replace(/\n/g, '<br>')}</p>` : ''}
${bloc}</main></body></html>`;
  }
  r.get('/devis/:slug/:id', ctx => {
    const jeton = String(ctx.query.get('jeton') || '');
    const { b, d, config } = devisPublic(ctx, jeton);
    ctx.entetes['Cache-Control'] = 'private, no-store';
    if (!d.consulteLe && d.statut === 'envoye') { d.consulteLe = Date.now(); d.historique.push({ date: d.consulteLe, texte: 'Consulté par le client' }); DV.ecrire(d); }
    return { html: pageDevis(b, d, config, jeton, ctx.query.get('ok') === 'accepte' ? 'Devis accepté : votre commande est enregistrée.' : ctx.query.get('ok') === 'refuse' ? 'Votre refus est enregistré.' : '') };
  });
  /* Erreur sur la page publique (double clic, devis expiré, trop d'essais) : la page du devis est réaffichée avec le
     message, au lieu d'une réponse technique. */
  const repondreDevis = async (ctx, fn) => {
    try { return await fn(); } catch (e) {
      if (!e.statut || e.statut >= 500 || e.code === 'introuvable') throw e;
      const f = lireFormulaire(ctx);
      let page; try { const { b, d, config } = devisPublic(ctx, f.jeton); page = pageDevis(b, d, config, f.jeton, e.message); } catch { throw e; }
      return { html: page };
    }
  };
  const accepterDevis = async ctx => {
    const f = lireFormulaire(ctx);
    auth.limiter(`devis-public:${ctx.ip}`, 30 * facteurLimites, 15 * 60000, 'Trop d’essais. Réessayez dans quelques minutes.');
    const { b, d, config } = devisPublic(ctx, f.jeton);
    const nom = String(f.nom || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 120);
    if (!nom || f.accord !== 'oui') throw erreur(400, 'Indiquez le nom du signataire et cochez « bon pour accord ».', 'accord_requis');
    const maintenant = Date.now();
    const res = transaction(db, () => {
      const frais = DV.deBoutique(b.id, d.id);   // relu dans la transaction : une seule acceptation, même avec deux clics
      if (frais.statut !== 'envoye' || DV.expire(frais, maintenant)) throw erreur(409, DV.expire(frais, maintenant) ? 'Ce devis a expiré.' : 'Ce devis n’est plus en attente de réponse.', 'deja_traite');
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const c = { id: auth.nouvelId('c_'), numero, date: maintenant, statut: 'attente',
        client: { nom: frais.client.raison, contact: frais.client.contact, email: frais.client.email, adresse: frais.client.adresse, npa: frais.client.npa, ville: frais.client.ville, pays: frais.client.pays, tva: frais.client.tva },
        lignes: frais.lignes.map(l => ({ produitId: l.produitId, ...(l.varianteId ? { varianteId: l.varianteId } : {}), nom: l.nom, prix: l.prix, qte: l.qte, type: l.type, tauxTva: l.tauxTva, tauxReduit: l.tauxReduit, source: l.source || null, fournisseur: l.fournisseur || null, ...(l.codeFournisseur ? { codeFournisseur: l.codeFournisseur } : {}) })),
        sousTotal: frais.sousTotal, remise: frais.remise, motifRemise: frais.remise ? `Remise du devis ${frais.numero} (${frais.remisePct} %)` : null, port: frais.port, total: frais.total, tauxTva: frais.tauxTva,
        livraison: 'devis', canal: 'devis', devis: { id: frais.id, numero: frais.numero }, echeance: maintenant + (config.reglages.echeanceJours || 30) * 86400000, suivi: '', note: '',
        historique: [{ date: maintenant, texte: `Commande issue du devis ${frais.numero}, accepté en ligne (signataire dans la fiche du devis)` }] };
      const jetonCommande = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      insererCommande(id, b.id, n, date, statut, jetonCommande, donnees);
      // Stock : l'acceptation n'est pas bloquée (le marchand peut réassortir), mais un manque est signalé tout de suite.
      const prods = listerProduits(b.id);
      const manques = frais.lignes.filter(l => l.produitId && l.type !== 'drop').filter(l => { const p = prods.find(x => x.id === l.produitId); if (!p) return true; const v = l.varianteId && Array.isArray(p.variantes) ? p.variantes.find(x => x.id === l.varianteId) : null; return (v ? v.stock : p.stock) < l.qte; }).map(l => l.nom);
      if (manques.length) c.historique.push({ date: maintenant, texte: `Stock insuffisant à l’acceptation : ${manques.join(', ')}. Réassortissez avant l’expédition.` });
      if (manques.length) { const { id: _i, numero: _n, date: _d, statut: _s, ...dn } = c; db.prepare('UPDATE commandes SET donnees = ? WHERE id = ?').run(stockerDonneesCommande(dn, b.id, c.id), c.id); }
      frais.manques = manques;
      frais.statut = 'accepte';
      frais.acceptation = { le: maintenant, reseau: crypto.createHmac('sha256', cleChiffrement).update(`devis:${ctx.ip}`).digest('hex').slice(0, 32), empreinte: Devis.empreinteContenu(frais.numero, frais) };
      frais.commande = { id: c.id, numero };
      frais.client = { ...frais.client, signataire: nom };   // nom du signataire : avec les coordonnées chiffrées du client
      frais.historique.push({ date: maintenant, texte: `Accepté en ligne : commande n° ${numero}` });
      DV.ecrire(frais, maintenant);
      return { c, frais };
    });
    integ.emettre(b.id, 'devis.accepte', { id: res.frais.id, numero: res.frais.numero, total: res.frais.total, devise: config.boutique.devise || 'EUR', accepteLe: new Date(res.frais.acceptation.le).toISOString(), commande: { id: res.c.id, numero: res.c.numero }, client: { raison: res.frais.client.raison, email: res.frais.client.email } });
    const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
    if (mch) envoyerEmail(null, mch.email, `Devis ${res.frais.numero} accepté : ${formatMontant(res.frais.total, config)}`, `Bonjour,\n\n${res.frais.client.raison} a accepté le devis ${res.frais.numero}.\nCommande n° ${res.c.numero} créée, en attente de paiement (en ligne ou par virement). Marquez-la payée à réception d'un virement.${res.frais.manques && res.frais.manques.length ? `\n\nAttention, stock insuffisant : ${res.frais.manques.join(', ')}.` : ''}\n\nVoir la commande : ${urlPublique}/app#commandes\n\nComptoir`);
    envoyerEmail(b.id, res.frais.client.email, `Devis ${res.frais.numero} accepté : commande n° ${res.c.numero}`, `Bonjour,\n\nNous avons bien reçu votre accord pour le devis ${res.frais.numero} (${formatMontant(res.frais.total, config)}). Votre commande n° ${res.c.numero} est enregistrée.\n\nPaiement en ligne ou coordonnées de virement : ${urlPublique}/devis/${encodeURIComponent(b.slug)}/${res.frais.id}?jeton=${encodeURIComponent(f.jeton)}\n\n${(config.entreprise || {}).raison || config.boutique.nom}`);
    return { redirection: `/devis/${encodeURIComponent(b.slug)}/${encodeURIComponent(d.id)}?jeton=${encodeURIComponent(f.jeton)}&ok=accepte` };
  };
  r.post('/devis/:slug/:id/accepter', ctx => repondreDevis(ctx, () => accepterDevis(ctx)));
  const refuserDevis = ctx => {
    const f = lireFormulaire(ctx);
    auth.limiter(`devis-public:${ctx.ip}`, 30 * facteurLimites, 15 * 60000, 'Trop d’essais. Réessayez dans quelques minutes.');
    const { b, d } = devisPublic(ctx, f.jeton);
    transaction(db, () => {
      const frais = DV.deBoutique(b.id, d.id);
      if (frais.statut !== 'envoye') throw erreur(409, 'Ce devis n’est plus en attente de réponse.', 'deja_traite');
      frais.statut = 'refuse'; frais.historique.push({ date: Date.now(), texte: 'Refusé par le client' }); DV.ecrire(frais);
    });
    const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
    if (mch) envoyerEmail(null, mch.email, `Devis ${d.numero} refusé`, `Bonjour,\n\n${d.client.raison} a refusé le devis ${d.numero}.\n\nComptoir`);
    return { redirection: `/devis/${encodeURIComponent(b.slug)}/${encodeURIComponent(d.id)}?jeton=${encodeURIComponent(f.jeton)}&ok=refuse` };
  };
  r.post('/devis/:slug/:id/refuser', ctx => repondreDevis(ctx, () => refuserDevis(ctx)));
  const payerDevis = async ctx => {
    const f = lireFormulaire(ctx);
    auth.limiter(`devis-public:${ctx.ip}`, 30 * facteurLimites, 15 * 60000, 'Trop d’essais. Réessayez dans quelques minutes.');
    const { b, d } = devisPublic(ctx, f.jeton);
    const row = d.commande && db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(d.commande.id, b.id);
    if (!row || row.statut !== 'attente') return { redirection: `/devis/${encodeURIComponent(b.slug)}/${encodeURIComponent(d.id)}?jeton=${encodeURIComponent(f.jeton)}` };
    return { redirection: (await ouvrirPaiement(b, row)).paiementUrl };
  };
  r.post('/devis/:slug/:id/payer', ctx => repondreDevis(ctx, () => payerDevis(ctx)));
  /* ---------- Stock sur plusieurs emplacements ---------- */
  r.get('/api/admin/emplacements', exigerMarchand, ctx => {
    const produits = listerProduits(ctx.boutique.id);
    if (!ctx.lectureSeule) transaction(db, () => EMP.nettoyer(ctx.boutique.id, produits.map(p => p.id)));   // lignes de produits supprimés autrefois
    return { emplacements: EMP.lister(ctx.boutique.id), repartition: EMP.repartition(ctx.boutique.id), ecarts: EMP.verifier(ctx.boutique.id, produits), mouvements: EMP.mouvements(ctx.boutique.id, 50), types: Emplacements.TYPES };
  });
  r.post('/api/admin/emplacements', exigerMarchand, ctx => {
    const e = transaction(db, () => EMP.creer(ctx.boutique.id, { nom: ctx.corps.nom, type: ctx.corps.type }, listerProduits(ctx.boutique.id)));
    noterActivite(ctx.marchand.id, 'emplacement', `Emplacement créé : ${e.nom}`, ctx);
    return { statut: 201, corps: { emplacement: e } };
  });
  r.delete('/api/admin/emplacements/:id', exigerMarchand, ctx => { transaction(db, () => EMP.supprimer(ctx.boutique.id, ctx.params.id)); return { ok: true }; });
  r.post('/api/admin/emplacements/transferts', exigerMarchand, ctx => {
    const b = ctx.corps, p = listerProduits(ctx.boutique.id).find(x => x.id === b.produitId);
    if (!p || p.type === 'drop') throw erreur(404, 'Produit introuvable.', 'produit_introuvable');
    const aVar = Array.isArray(p.variantes) && p.variantes.length;
    if (aVar && !p.variantes.some(v => v.id === b.varianteId)) throw erreur(400, 'Choisissez une variante.', 'variante_requise');
    transaction(db, () => EMP.transferer(ctx.boutique.id, { produitId: p.id, varianteId: aVar ? b.varianteId : '', de: b.de, vers: b.vers, quantite: b.quantite }));
    integ.emettre(ctx.boutique.id, 'stock.transfert', { produit: { id: p.id, nom: p.nom }, varianteId: aVar ? b.varianteId : null, de: b.de, vers: b.vers, quantite: Number(b.quantite) });
    return { repartition: EMP.repartition(ctx.boutique.id)[p.id] || {} };
  });

  /* ---------- Cartes cadeaux ---------- */
  // Carte vide parce que son solde est réservé par une commande en attente de paiement : message distinct (le client
  // qui vient d'annuler son paiement comprend pourquoi, et sait que le montant revient).
  const carteRefusee = (b, carte) => {
    const reservee = carte && carte.statut === 'active' && db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND statut = 'attente' AND json_extract(donnees, '$.carteCadeau.id') = ? AND json_extract(donnees, '$.carteCadeau.liberee') IS NULL LIMIT 1").get(b.id, carte.id);
    return reservee ? erreur(409, 'Le solde de cette carte est réservé par une commande en attente de paiement. Il revient sur la carte si ce paiement n’aboutit pas (au plus tard 2 heures après).', 'carte_reservee')
      : erreur(400, 'Carte cadeau inconnue, expirée ou épuisée.', 'carte_invalide');
  };
  // Export pour la fiduciaire : mouvements d'une période (dates AAAA-MM-JJ, fin incluse), encours en fin de période.
  r.get('/api/admin/cartes-cadeaux/export', exigerMarchand, ctx => {
    // Jours civils à l'heure de Suisse et de France (Europe/Zurich, même fuseau que Paris et Bruxelles), pas en UTC :
    // une vente à 0 h 30 le 1er janvier compte dans la nouvelle année.
    const FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    const minuit = j => { for (const h of ['+01:00', '+02:00']) { const t = Date.parse(`${j}T00:00:00${h}`); if (FMT.format(t) === `${j} 00`) return t; } return NaN; };
    // Date réelle seulement (ni 13e mois ni 30 février) : relue à l'identique après conversion.
    const lire = (nom, def) => { const v = ctx.query.get(nom); if (!v) return def; const t = Date.parse(`${v}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) throw erreur(400, 'Période invalide (dates au format AAAA-MM-JJ).', 'invalide'); return v; };
    const jd = lire('debut', null), jf = lire('fin', null);
    const debut = jd ? minuit(jd) : 0;
    const finExclue = jf ? minuit(new Date(Date.parse(`${jf}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) : Date.now() + 1;
    if (!Number.isFinite(debut) || !Number.isFinite(finExclue) || finExclue <= debut) throw erreur(400, 'Période invalide.', 'invalide');
    // Cartes dont la vente a été remboursée, annulée ou contestée : leur solde est revenu au client.
    const annulees = new Set(db.prepare(`SELECT json_extract(donnees, '$.carteEmise.id') AS id FROM commandes WHERE boutique_id = ? AND json_extract(donnees, '$.carteEmise.id') IS NOT NULL
      AND (statut IN ('remboursee', 'annulee') OR json_extract(donnees, '$.litige.statut') IN ('needs_response', 'under_review', 'lost'))`).all(ctx.boutique.id).map(r => r.id));
    const numeros = new Map(db.prepare("SELECT id, numero FROM commandes WHERE boutique_id = ? AND id IN (SELECT DISTINCT commande_id FROM cartes_mouvements WHERE boutique_id = ? AND commande_id IS NOT NULL)").all(ctx.boutique.id, ctx.boutique.id).map(r => [r.id, r.numero]));
    ctx.entetes['Cache-Control'] = 'private, no-store';
    ctx.entetes['Content-Disposition'] = `attachment; filename="cartes-cadeaux-${ctx.boutique.slug}.csv"`;
    return { binaire: Buffer.from(Cartes.exporter(ctx.boutique.id, { debut, fin: finExclue, numeros, annulees }), 'utf8'), type: 'text/csv; charset=utf-8' };
  });
  r.get('/api/admin/cartes-cadeaux', exigerMarchand, ctx => ({ cartes: Cartes.lister(ctx.boutique.id), registreCoherent: !Cartes.verifier(ctx.boutique.id).length }));
  // Réglages de la vente en ligne : déclarés avant « /:id » (sinon « vente » serait pris pour un identifiant).
  r.get('/api/admin/cartes-cadeaux/vente', exigerMarchand, ctx => ({ vente: Cartes.reglagesVente(ctx.boutique.id) }));
  r.put('/api/admin/cartes-cadeaux/vente', exigerMarchand, ctx => ({ vente: Cartes.ecrireReglagesVente(ctx.boutique.id, ctx.corps || {}, lireConfig(ctx.boutique).boutique.pays) }));
  r.get('/api/admin/cartes-cadeaux/:id', exigerMarchand, ctx => Cartes.detail(ctx.boutique.id, ctx.params.id));
  // Émettre une carte crée un moyen de paiement : réservé au propriétaire et à la gestion complète (le rôle « commandes » n'y a pas accès).
  r.post('/api/admin/cartes-cadeaux', exigerMarchand, ctx => {
    auth.limiter(`emission-carte:${ctx.boutique.id}`, 200 * facteurLimites, 86400000, 'Trop de cartes émises aujourd’hui.');
    const config = lireConfig(ctx.boutique), b = ctx.corps;
    const mois = b.expireMois === undefined || b.expireMois === null || b.expireMois === '' ? null : Number(b.expireMois);
    if (mois !== null && (!Number.isInteger(mois) || mois < 1 || mois > 120)) throw erreur(400, 'Validité : entre 1 et 120 mois, ou sans limite.', 'validite_invalide');
    // Belgique : un titre-cadeau vaut au moins 2 ans (loi du 22 avril 2019).
    if (mois !== null && config.boutique.pays === 'be' && mois < 24) throw erreur(400, 'En Belgique, une carte cadeau est valable au moins 2 ans.', 'validite_invalide');
    const texte = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
    const expireLe = mois ? (() => { const d = new Date(); d.setMonth(d.getMonth() + mois); return d.getTime(); })() : null;
    const r2 = Cartes.emettre(ctx.boutique.id, { montant: Number(b.montant), devise: config.boutique.devise || 'EUR', expireLe, destinataire: texte(b.destinataire, 100), note: texte(b.note, 200) });
    // Émettre une carte crée un moyen de paiement : noté dans le journal d'activité ; le propriétaire est prévenu si un membre l'a fait.
    noterActivite(ctx.marchand.id, 'carte-cadeau', `${formatMontant(r2.carte.initial, config)}, carte ····${r2.carte.fin}`, ctx);
    integ.emettre(ctx.boutique.id, 'carte.emise', { id: r2.carte.id, fin: r2.carte.fin, montant: r2.carte.initial, devise: r2.carte.devise, expireLe: r2.carte.expireLe ? new Date(r2.carte.expireLe).toISOString() : null, origine: 'manuelle' });   // jamais le code
    if (ctx.role && ctx.role !== 'proprietaire') { const p = db.prepare('SELECT email FROM marchands WHERE id = ?').get(ctx.boutique.marchand_id); if (p) envoyerEmail(null, p.email, `Carte cadeau émise par ${ctx.marchand.email}`, `Bonjour,\n\n${ctx.marchand.email} a émis une carte cadeau de ${formatMontant(r2.carte.initial, config)} (····${r2.carte.fin}) sur ${config.boutique.nom}.\n\nToutes les cartes : ${urlPublique}/app#magasin\n\nComptoir`); }
    return { statut: 201, corps: r2 };
  });
  /* Achat d'une carte cadeau dans la boutique : une commande à part (canal « carte »), payée en ligne. */
  r.post('/api/public/:slug/cartes-cadeaux/achat', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug), reg = Cartes.reglagesVente(b.id), config = configVente(b);
    if (!reg.actif) throw erreur(404, 'Cette boutique ne vend pas de cartes cadeaux en ligne.', 'vente_inactive');
    const adrV = String((config.entreprise || {}).adresse || '').trim();
    if (!adrV || /compléter/i.test(adrV)) throw erreur(409, 'Cette boutique termine la saisie de ses informations légales : la vente ouvre très bientôt.', 'boutique_incomplete');
    auth.limiter(`achat-carte:${b.id}:${reseauIp(ctx.ip)}`, 10 * facteurLimites, 3600000, 'Trop d’achats de cartes en peu de temps. Réessayez plus tard.');
    const montant = Number(ctx.corps.montant);
    if (!reg.montants.includes(montant)) throw erreur(400, 'Montant de carte cadeau indisponible.', 'montant_invalide');
    const cl = ctx.corps.client || {}, de = ctx.corps.destinataire || {};
    const client = { nom: nomSur(valider.texte(cl.nom, 'Votre nom', { max: 100 })), email: valider.email(cl.email), adresse: '', npa: '', ville: '' };
    if (de.email) client.destinataire = { nom: de.nom ? valider.texte(de.nom, 'Le nom du destinataire', { max: 100 }) : '', email: valider.email(de.email) };
    if (ctx.corps.message) client.message = texteSur(ctx.corps.message, 300);
    auth.limiter(`achat-carte-email:${b.id}:${client.email.toLowerCase()}`, 5 * facteurLimites, 86400000, 'Trop d’achats de cartes pour cette adresse aujourd’hui.');
    const devise = config.boutique.devise || 'EUR', compte = compteVente(b);
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', devise, ...(typeof ctx.corps.langue === 'string' && ctx.corps.langue !== 'fr' && EmailsClients.LANGUES.includes(ctx.corps.langue) && (config.boutique.langues || []).includes(ctx.corps.langue) ? { langue: ctx.corps.langue } : {}), client, lignes: [{ produitId: null, nom: `Carte cadeau ${formatMontant(montant, config)}`, prix: montant, qte: 1, type: 'carte-cadeau', tauxTva: 0 }], sousTotal: montant, remise: 0, port: 0, total: montant, tauxTva: 0, livraison: 'carte', canal: 'carte', suivi: '', note: '', historique: [{ date: now, texte: 'Carte cadeau achetée en ligne, paiement en attente' }] };
      try { c.risque = Risque.evaluer(c, { reseau: ctx.ip, compteurs: compteursRisque, panierMoyen: panierMoyen(b.id), clientConnu: false, boutique: b.id }); if (c.risque.niveau !== 'faible') c.historique.push({ date: now, texte: `Risque ${c.risque.niveau === 'eleve' ? 'élevé' : 'moyen'} (${c.risque.score}/100) : ${c.risque.raisons.join(' ; ')}` }); } catch (e) { journal.error('[risque]', e.message); }
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      insererCommande(id, b.id, n, date, statut, jeton, donnees);
      const p = { id: auth.nouvelId('pay_'), commande_id: c.id, montant_centimes: Math.round(montant * 100) };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, c.id, paiement.nom, p.montant_centimes, devise, 'cree', now, compte);
      return { commande: { ...c, jeton }, pmt: p };
    });
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    let session;
    try { session = await paiement.creerSession({ pays: config.boutique.pays, paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1`, compte, moyens: moyensDe(b.id) }); }
    catch (e) { transaction(db, () => { db.prepare('DELETE FROM paiements WHERE commande_id = ?').run(commande.id); db.prepare('DELETE FROM commandes WHERE id = ?').run(commande.id); }); throw e; }
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { statut: 201, corps: { commandeId: commande.id, jeton: commande.jeton, paiementUrl: session.url } };
  });
  // Sous le même verrou que les remboursements : une carte ne peut pas être libérée pendant que la vente est remboursée.
  r.post('/api/admin/commandes/:id/liberer-carte', exigerMarchand, ctx => avecVerrou(ctx.params.id, async () => {
    const c = commandeDeBoutique(ctx.boutique.id, ctx.params.id);
    if (c.canal !== 'carte' || c.statut !== 'payee' || c.carteEmise) throw erreur(409, 'Aucune carte cadeau retenue pour cette commande.', 'rien_a_liberer');
    if (litigeBloquant(c)) throw erreur(409, 'Le paiement de cette carte est contesté auprès de la banque : la carte ne peut pas être libérée.', 'litige');
    transaction(db, () => { emettreCarteVendue(ctx.boutique.id, c, { liberer: true }); historique(c, 'Carte cadeau libérée par le marchand'); enregistrerCommande(c); });
    return { commande: c };
  }));
  r.post('/api/admin/cartes-cadeaux/:id/desactiver', exigerMarchand, ctx => ({ carte: Cartes.desactiver(ctx.boutique.id, ctx.params.id) }));
  // Solde d'une carte, pour le client (boutique) : limité par adresse et par boutique contre l'essai de codes au hasard.
  r.post('/api/public/:slug/carte-cadeau', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    auth.limiter(`carte:${b.id}:${ctx.ip}`, 20 * facteurLimites, 15 * 60000, 'Trop d’essais de carte cadeau. Réessayez dans quelques minutes.');
    const carte = Cartes.trouver(b.id, ctx.corps.code), dispo = Cartes.disponible(carte);
    if (!carte || !dispo || carte.devise !== (lireConfig(b).boutique.devise || 'EUR')) {
      if (!carte) auth.limiter(`carte-boutique:${b.id}`, 2000 * facteurLimites, 3600000, 'Vérification des cartes cadeaux momentanément indisponible.');   // seuls les codes inconnus comptent
      const e = carteRefusee(b, carte); if (e.code === 'carte_invalide') e.statut = 404; throw e; }
    return { solde: dispo / 100, devise: carte.devise, fin: carte.fin, expireLe: carte.expire_le };
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
    if (resultat.payees.length || resultat.doublons.length) noterActivite(ctx.boutique.marchand_id, 'import-camt', `${resultat.payees.length} payée(s)`, ctx);
    return resultat;
  });
  /* ---------- Intégrations : gestion (espace marchand, formule Croissance) ---------- */
  r.get('/api/admin/integrations', exigerMarchand, ctx => ({ inclus: apiPermise(ctx.boutique.id), cles: integ.listerCles(ctx.boutique.id), webhooks: integ.listerWebhooks(ctx.boutique.id), portees: integ.PORTEES, evenements: integ.EVENEMENTS, base: `${urlPublique}/api/v1` }));
  r.post('/api/admin/integrations/cles', exigerFonction('api'), ctx => { exigerIdentite(ctx); const r2 = integ.creerCle(ctx.boutique.id, ctx.corps); noterActivite(ctx.marchand.id, 'cle-api', String(ctx.corps.nom || '').slice(0, 60), ctx); return { statut: 201, corps: r2 }; });
  r.post('/api/admin/integrations/cles/:id/revoquer', exigerMarchand, ctx => { if (!integ.revoquerCle(ctx.boutique.id, ctx.params.id)) throw erreur(404, 'Clé inconnue.', 'introuvable'); noterActivite(ctx.marchand.id, 'cle-api-revoquee', null, ctx); return { ok: true }; });
  r.post('/api/admin/integrations/webhooks', exigerFonction('api'), async ctx => (exigerIdentite(ctx), { statut: 201, corps: await integ.creerWebhook(ctx.boutique.id, ctx.corps) }));
  r.post('/api/admin/integrations/webhooks/:id/supprimer', exigerMarchand, ctx => { if (!integ.supprimerWebhook(ctx.boutique.id, ctx.params.id)) throw erreur(404, 'Webhook inconnu.', 'introuvable'); return { ok: true }; });
  r.post('/api/admin/integrations/webhooks/:id/secret', exigerFonction('api'), ctx => {
    exigerIdentite(ctx);
    const r2 = integ.renouvelerSecret(ctx.boutique.id, ctx.params.id); if (!r2) throw erreur(404, 'Webhook inconnu.', 'introuvable');
    noterActivite(ctx.marchand.id, 'secret-webhook', r2.id, ctx);
    return r2;
  });
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
  const produitApi = (p, slug) => ({ id: p.id, nom: p.nom, prix: p.prix, stock: p.type === 'drop' ? null : p.stock, ...(Array.isArray(p.variantes) && p.variantes.length ? { options: p.options, variantes: p.variantes.map(v => ({ id: v.id, valeurs: v.valeurs, stock: p.type === 'drop' ? null : v.stock, prix: typeof v.prix === 'number' ? v.prix : p.prix, ...(p.type === 'drop' && v.ref ? { ref: v.ref } : {}) })) } : {}), type: p.type, actif: p.actif !== false, categorie: p.categorie || '', image: p.image ? `${urlPublique}/api/public/${encodeURIComponent(slug)}/image/${p.id}` : null });
  r.get('/api/v1/produits', exigerCle('produits:lecture'), ctx => ({ donnees: listerProduits(ctx.boutique.id).map(p => produitApi(p, ctx.boutique.slug)) }));
  r.patch('/api/v1/produits/:id', exigerCle('produits:ecriture'), ctx => {
    const ancien = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ? AND supprime = 0').get(ctx.params.id, ctx.boutique.id);
    if (!ancien) throw erreur(404, 'Produit introuvable.', 'introuvable');
    const avant = JSON.parse(ancien.donnees);
    const c = ctx.corps || {}, maj = { ...avant };
    if (c.prix !== undefined) maj.prix = c.prix;
    if (c.stock !== undefined && avant.type !== 'drop' && Array.isArray(avant.variantes) && avant.variantes.length) throw erreur(400, 'Produit à variantes : mettez à jour le stock de chaque variante (« variantes »: [{ "id", "stock" }]).', 'variantes');
    if (c.stock !== undefined && avant.type !== 'drop') maj.stock = c.stock;
    // Stock ou prix d'une ou plusieurs variantes (identifiant = combinaison, ex. « M/Noir »)
    if (c.variantes !== undefined) {
      if (!Array.isArray(c.variantes) || !Array.isArray(avant.variantes) || !avant.variantes.length) throw erreur(400, '« variantes » : ce produit n’a pas de variantes.', 'variantes');
      maj.variantes = avant.variantes.map(v => {
        const u = c.variantes.find(x => x && x.id === v.id); if (!u) return v;
        if (u.stock !== undefined && avant.type === 'drop') throw erreur(400, 'Produit du fournisseur : le stock de ses variantes est celui du fournisseur.', 'stock_fournisseur');
        if (u.stock !== undefined && (!Number.isInteger(u.stock) || u.stock < 0 || u.stock > 1e6)) throw erreur(400, `Stock invalide pour la variante « ${v.id} ».`, 'stock');
        if (u.prix !== undefined && u.prix !== null && (typeof u.prix !== 'number' || !(prix.arrondi(u.prix) >= 0.01) || u.prix > 1e6)) throw erreur(400, `Prix invalide pour la variante « ${v.id} ».`, 'prix');
        return { ...v, ...(u.stock !== undefined ? { stock: u.stock } : {}), ...(u.prix === null ? { prix: undefined } : u.prix !== undefined ? { prix: u.prix } : {}) };
      });
      if (c.variantes.some(x => !x || !avant.variantes.some(v => v.id === x.id))) throw erreur(400, 'Variante inconnue.', 'variantes');
    }
    if (c.actif !== undefined) { if (typeof c.actif !== 'boolean') throw erreur(400, '« actif » doit valoir true ou false.', 'actif'); maj.actif = c.actif; }
    if (c.stock !== undefined && (!Number.isInteger(c.stock) || c.stock < 0 || c.stock > 1e6)) throw erreur(400, '« stock » doit être un entier positif.', 'stock');
    if (c.prix !== undefined && (typeof c.prix !== 'number' || !(prix.arrondi(c.prix) >= 0.01) || c.prix > 1e6)) throw erreur(400, '« prix » doit valoir au moins 0,01 (arrondi au centime).', 'prix');
    const propre = nettoyerProduit({ ...maj, type: avant.type, source: avant.source, codeFournisseur: avant.codeFournisseur, image: avant.image, options: avant.options, variantes: maj.variantes || avant.variantes }, avant.historiquePrix || []);
    transaction(db, () => { db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(serialiserProduit(ctx.params.id, propre), ctx.params.id); reconcilierProduit(ctx.boutique.id, ctx.params.id); });   // fiche et emplacements ensemble
    if (avant.type !== 'drop' && (avant.stock || 0) > 0 && propre.stock <= 0) integ.emettre(ctx.boutique.id, 'produit.rupture', { id: ctx.params.id, nom: propre.nom, stock: 0 });
    return produitApi({ ...propre, id: ctx.params.id }, ctx.boutique.slug);
  });
  /* Clients : regroupés par l'index aveugle de l'e-mail (sans rien déchiffrer pour compter), par pages de 50 (100 au plus).
     Seule la dernière commande de chaque client de la page est déchiffrée (e-mail, nom). Avant, la route déchiffrait
     toutes les commandes de la boutique à chaque appel (0,8 s de calcul bloquant à 20 000 commandes). */
  r.get('/api/v1/clients', exigerCle('clients:lecture'), ctx => {
    auth.limiter(`api-clients:${ctx.boutique.id}`, 60 * facteurLimites, 60000, 'Trop de lectures de la liste des clients : réessayez dans une minute.');
    const q = ctx.query, limite = Math.max(1, Math.min(100, Number(q.get('limite')) || 50)), apres = q.get('apres') || '';
    if (apres && !/^[0-9a-f]{40}$/.test(apres)) throw erreur(400, 'Curseur « apres » invalide : repassez la valeur « suite » reçue.', 'curseur');
    const groupes = db.prepare(`SELECT email_index, COUNT(*) n, ROUND(SUM(json_extract(donnees, '$.total')), 2) total, MAX(date) derniere FROM commandes
      WHERE boutique_id = ? AND statut NOT IN ('attente', 'annulee') AND email_index IS NOT NULL AND email_index > ? GROUP BY email_index ORDER BY email_index LIMIT ?`).all(ctx.boutique.id, apres, limite + 1);
    const page = groupes.slice(0, limite);
    const derniere = db.prepare("SELECT * FROM commandes WHERE boutique_id = ? AND email_index = ? AND statut NOT IN ('attente', 'annulee') ORDER BY date DESC LIMIT 1");
    const donnees = page.map(g => { const c = lireCommande(derniere.get(ctx.boutique.id, g.email_index)); return { email: String(c.client && c.client.email || '').toLowerCase(), nom: c.client && c.client.nom, commandes: g.n, total: Math.round(g.total * 100) / 100, derniere: new Date(g.derniere).toISOString() }; });
    return { donnees, suite: groupes.length > limite ? page[page.length - 1].email_index : null };
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
      if (!a.produitId || !c.lignes.some(l => l.produitId === a.produitId)) continue;   // jamais d'avis sans produit (ligne libre)
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
    return { prenom: c.client.nom.split(' ')[0], produits: c.lignes.filter(l => l.produitId && !deja.has(l.produitId)).map(l => ({ produitId: l.produitId, nom: l.nom })) };   // lignes libres (devis) : pas d'avis
  });
  r.patch('/api/admin/avis/:id', exigerMarchand, ctx => {
    const res = db.prepare('UPDATE avis SET reponse = ? WHERE id = ? AND boutique_id = ?').run(String(ctx.corps.reponse || '').slice(0, 1000) || null, ctx.params.id, ctx.boutique.id);
    if (!res.changes) throw erreur(404, 'Avis introuvable.', 'avis_introuvable');
    return { ok: true };
  });

  /* Offre après l’achat : un complément à prix réduit, livré dans le même colis (2 heures après le paiement au plus). */
  const DELAI_COMPLEMENT = 2 * 3600 * 1000;
  function offreApres(b, c) {
    if (c.canal === 'carte' || c.canal === 'devis') return null;   // ni carte cadeau ni devis : pas d'offre « avec votre commande »
    if (!['payee', 'fournisseur', 'preparation'].includes(c.statut) || c.parent || (c.complements || []).length) return null;
    const paye = (c.historique || []).find(h => /^Paiement/.test(h.texte));
    if (!paye || Date.now() - paye.date > DELAI_COMPLEMENT) return null;
    const config = configVente(b);
    const r = Remises.regleApplicable(config, c.lignes, 'apres');
    if (!r) return null;
    const p = listerProduits(b.id).find(x => x.id === r.alors && vendable(x) && !(Array.isArray(x.variantes) && x.variantes.length) && (x.type === 'drop' || x.stock > 0));   // un produit à variantes se choisit sur sa fiche
    return p ? { regle: r.id, produitId: p.id, nom: p.nom, prix: p.prix, prixOffre: prix.arrondi(p.prix * (1 - r.remise / 100)), remise: r.remise, teinte: p.teinte, image: p.image === IMG ? `/api/public/${encodeURIComponent(b.slug)}/image/${encodeURIComponent(p.id)}` : p.image || null } : null;
  }
  const verifierJeton = (row, jeton) => row && auth.egal(jeton || '', row.jeton_client);
  r.post('/api/public/:slug/commandes/:id/complement', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!verifierJeton(row, ctx.corps.jeton)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const parent = lireCommande(row);
    if (parent.canal === 'carte' || parent.canal === 'devis') throw erreur(409, 'Pas de complément pour cette commande.', 'complement_impossible');
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
      insererCommande(id, b.id, n, date, statut, jeton, donnees);
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
    const m = Remises.offresDe(configVente(b)).codes.find(x => x.code === c.code);
    if (m && m.max && utilisationsCode(b.id, c.code) >= m.max) throw erreur(404, `Le code ${c.code} a atteint son nombre d’utilisations.`, 'code_epuise');
    const conditions = [bv.code && String(bv.code).toUpperCase() === c.code ? { type: 'premiere', texte: 'Valable sur une première commande.' } : null, m && m.minimum ? { type: 'minimum', texte: `Dès ${formatMontant(m.minimum, configVente(b))} d’achat.` } : null, m && m.unParClient ? { type: 'client', texte: 'Une fois par adresse e-mail.' } : null].filter(Boolean);
    return { code: c.code, remise: c.remise, ...(m && m.minimum ? { minimum: m.minimum } : {}), ...(conditions.length ? { conditions, condition: conditions.map(x => x.texte).join(' ') } : {}) };
  });
  /* Mes commandes : les liens de suivi des commandes de cette adresse (12 derniers mois) envoyés à cette adresse seule.
     Réponse identique que l'adresse soit connue ou non : le formulaire ne révèle pas qui est client. */
  r.post('/api/public/:slug/mes-commandes', ctx => {
    auth.limiter('mes-commandes:' + ctx.ip, 10 * facteurLimites, 3600000, 'Trop de demandes. Réessayez plus tard.');
    const b = boutiqueParSlug(ctx.params.slug);
    const email = valider.email(ctx.corps.email).toLowerCase();
    const rows = db.prepare("SELECT id, numero, date, statut, donnees FROM commandes WHERE boutique_id = ? AND date > ? AND statut NOT IN ('attente', 'annulee') AND email_index = ? ORDER BY date DESC LIMIT 20").all(b.id, Date.now() - 365 * 86400000, PII.index(b.id, email))
      .filter(r2 => PII.normEmail((lireDonneesCommande({ ...r2, boutique_id: b.id }).client || {}).email) === PII.normEmail(email));   // l'index ne suffit pas : l'adresse déchiffrée doit correspondre
    if (!rows.length) return { ok: true };
    // Compté seulement quand un e-mail part : des demandes pour une adresse sans commande n'épuisent pas celles du vrai client.
    try { auth.limiter(`mes-commandes-adresse:${b.id}|${email}`, 3, 86400000, ''); } catch { return { ok: true }; }
    const config = lireConfig(b), libelles = { payee: 'payée', preparation: 'en préparation', fournisseur: 'en préparation', expediee: 'expédiée', livree: 'livrée', prete: 'prête à retirer', retiree: 'retirée', remboursee: 'remboursée' };
    // Langue de la commande la plus récente : la liste part dans la langue où le client a commandé.
    const langue = (() => { try { return JSON.parse(rows[0].donnees).langue || null; } catch { return null; } })();
    const traduit = EmailsClients.mesCommandes(langue, { nomBoutique: config.boutique.nom, commandes: rows.map(r2 => ({ numero: r2.numero, date: r2.date, statut: r2.statut, lien: lienCommande(b, r2.id) })) });
    if (traduit) { envoyerEmail(b.id, email, traduit.sujet, traduit.corps, { langue }); return { ok: true }; }
    envoyerEmail(b.id, email, `Vos commandes chez ${config.boutique.nom}`, `Bonjour,\n\nVoici vos commandes chez ${config.boutique.nom} :\n\n${rows.map(r2 => `- n° ${r2.numero} du ${new Date(r2.date).toLocaleDateString('fr-CH')} (${libelles[r2.statut] || r2.statut}) : ${lienCommande(b, r2.id)}`).join('\n')}\n\nVous n'avez rien demandé ? Ignorez cet e-mail.\n\n${config.boutique.nom}`);
    return { ok: true };
  });
  /* « Prévenez-moi » : un client demande à être prévenu du retour en stock d'un produit (ou d'une variante) épuisé.
     Un seul e-mail, puis l'adresse est effacée ; sans retour en stock, effacée après 90 jours. */
  db.exec('CREATE TABLE IF NOT EXISTS alertes_stock (boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, produit_id TEXT NOT NULL, variante_id TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL, langue TEXT, cree_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, produit_id, variante_id, email))');
  r.post('/api/public/:slug/produits/:id/alerte', ctx => {
    auth.limiter('alerte-stock:' + ctx.ip, 20 * facteurLimites, 3600000, 'Trop de demandes. Réessayez plus tard.');
    const b = boutiqueOuverte(ctx.params.slug);
    const email = valider.email(ctx.corps.email).toLowerCase();
    const p = listerProduits(b.id).find(x => x.id === ctx.params.id && vendable(x) && x.type !== 'drop');
    if (!p) throw erreur(404, 'Produit introuvable.', 'introuvable');
    const vid = Array.isArray(p.variantes) && p.variantes.length ? String(ctx.corps.varianteId || '') : '';
    const v = vid ? p.variantes.find(x => x.id === vid) : null;
    if (vid && !v) throw erreur(400, 'Variante inconnue.', 'variante');
    if (!vid && Array.isArray(p.variantes) && p.variantes.length) throw erreur(400, 'Choisissez une variante.', 'variante_requise');
    // Article disponible : rien à attendre (sinon le formulaire servirait à envoyer un e-mail à n'importe quelle adresse).
    if ((v ? v.stock : p.stock) > 0) throw erreur(409, 'Cet article est disponible : vous pouvez le commander dès maintenant.', 'disponible');
    // Limites par boutique : par réseau et par adresse (une adresse ne peut pas être inscrite sans fin par un tiers).
    auth.limiter(`alerte-stock-boutique:${b.id}|${ctx.ip}`, 10 * facteurLimites, 86400000, 'Trop de demandes. Réessayez plus tard.');
    try { auth.limiter(`alerte-stock-adresse:${b.id}|${email}`, 5, 86400000, ''); } catch { return { ok: true }; }
    if (db.prepare('SELECT COUNT(*) n FROM alertes_stock WHERE boutique_id = ?').get(b.id).n >= 5000) throw erreur(503, 'Les demandes sont momentanément complètes pour cette boutique. Réessayez plus tard.', 'complet');
    const langue = ['de', 'it', 'en'].includes(ctx.corps.langue) ? ctx.corps.langue : null;
    db.prepare('INSERT OR IGNORE INTO alertes_stock (boutique_id, produit_id, variante_id, email, langue, cree_le) VALUES (?, ?, ?, ?, ?, ?)').run(b.id, p.id, vid, email, langue, Date.now());
    return { ok: true };
  });
  const TEXTE_RETOUR = {
    fr: (n, s2, u) => [`De retour en stock : ${n}`, `Bonjour,\n\nBonne nouvelle : ${n} est de nouveau disponible chez ${s2}.\n${u}\n\nVous recevez cet unique e-mail car vous l'avez demandé ; votre adresse est maintenant effacée.\n\n${s2}`],
    de: (n, s2, u) => [`Wieder an Lager: ${n}`, `Guten Tag,\n\ngute Nachricht: ${n} ist bei ${s2} wieder erhältlich.\n${u}\n\nSie erhalten diese einmalige E-Mail auf Ihren Wunsch; Ihre Adresse ist nun gelöscht.\n\n${s2}`],
    it: (n, s2, u) => [`Di nuovo disponibile: ${n}`, `Buongiorno,\n\nbuone notizie: ${n} è di nuovo disponibile presso ${s2}.\n${u}\n\nRicevi quest’unica e-mail su tua richiesta; il tuo indirizzo è ora cancellato.\n\n${s2}`],
    en: (n, s2, u) => [`Back in stock: ${n}`, `Hello,\n\nGood news: ${n} is available again at ${s2}.\n${u}\n\nYou are receiving this one-time email because you asked for it; your address has now been erased.\n\n${s2}`]
  };
  function alertesRetourStock(maintenant = Date.now()) {
    db.prepare('DELETE FROM alertes_stock WHERE cree_le < ?').run(maintenant - 90 * 86400000);
    // Boutique par boutique, produit par produit : seules les demandes d'un article revenu en stock sont lues.
    // (Une boutique pleine de demandes en attente ne retarde plus celles des autres.)
    for (const { boutique_id: bid } of db.prepare('SELECT DISTINCT boutique_id FROM alertes_stock').all()) {
      const b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(bid); if (!b) continue;
      if (!abo.etat(b.marchand_id).actif) continue;   // boutique fermée : le lien mènerait à une page introuvable
      const prods = listerProduits(bid), config = lireConfig(b);
      for (const g of db.prepare('SELECT produit_id, variante_id FROM alertes_stock WHERE boutique_id = ? GROUP BY produit_id, variante_id').all(bid)) {
        const p = prods.find(x => x.id === g.produit_id);
        if (!p || !vendable(p)) continue;
        const v = g.variante_id ? (Array.isArray(p.variantes) ? p.variantes.find(x => x.id === g.variante_id) : null) : null;
        // Variante supprimée : la demande n'a plus d'objet, effacée sans e-mail.
        if (g.variante_id && !v) { db.prepare('DELETE FROM alertes_stock WHERE boutique_id = ? AND produit_id = ? AND variante_id = ?').run(bid, g.produit_id, g.variante_id); continue; }
        if ((v ? v.stock : p.stock) <= 0) continue;
        const nom = v ? `${p.nom} (${v.valeurs.join(' / ')})` : p.nom;
        for (const a of db.prepare('SELECT * FROM alertes_stock WHERE boutique_id = ? AND produit_id = ? AND variante_id = ?').all(bid, g.produit_id, g.variante_id)) {
          const [sujet, corps] = (TEXTE_RETOUR[a.langue] || TEXTE_RETOUR.fr)(nom, config.boutique.nom, EmailsClients.avecLangue(`${urlBoutique(b)}${urlBoutique(b).endsWith('/') ? '' : '/'}p/${encodeURIComponent(p.id)}`, { langue: a.langue }));
          envoyerEmail(b.id, a.email, sujet, corps, { langue: a.langue });
          db.prepare('DELETE FROM alertes_stock WHERE boutique_id = ? AND produit_id = ? AND variante_id = ? AND email = ?').run(bid, a.produit_id, a.variante_id, a.email);
        }
      }
    }
  }
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
    // Langue de la boutique au moment de l'inscription : la confirmation et la bienvenue partent dans cette langue ;
    // elle est gardée avec l'abonné (table abonnes) pour de futurs envois de nouvelles.
    const langue = typeof ctx.corps.langue === 'string' && ctx.corps.langue !== 'fr' && EmailsClients.LANGUES.includes(ctx.corps.langue) && (lireConfig(b).boutique.langues || []).includes(ctx.corps.langue) ? ctx.corps.langue : null;
    db.prepare('INSERT INTO optins (jeton_hash, boutique_id, email, expire_le, langue) VALUES (?, ?, ?, ?, ?)').run(auth.sha256(jetonOptin), b.id, email.toLowerCase(), Date.now() + 7 * 86400000, langue);
    const nom = lireConfig(b).boutique.nom, lien = `${urlPublique}/reinscription?j=${jetonOptin}`;
    const traduit = EmailsClients.optin(langue, { nomBoutique: nom, lien });
    if (traduit) envoyerEmail(b.id, email, traduit.sujet, traduit.corps, { langue });
    else envoyerEmail(b.id, email, `Confirmez votre inscription chez ${nom}`, `Bonjour,\n\nVous (ou quelqu'un d'autre) avez demandé à recevoir les nouvelles et offres de ${nom}. Pour confirmer, cliquez ici :\n${lien}\n\nSi ce n'est pas vous, ignorez cet e-mail : vous ne recevrez rien d'autre.\n\n${nom}`);
    return { ok: true, confirmation: true };
  });
  /* Paiement annulé par le client (retour « annuler » du prestataire) : la carte cadeau réservée est recréditée tout de
     suite, pour qu'il puisse réessayer. La commande reste en attente : reprendre son paiement débite la carte à nouveau. */
  r.post('/api/public/:slug/commandes/:id/abandonner', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!row || !auth.egal(String(ctx.corps.jeton || ''), row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const ouverts = transaction(db, () => {
      const frais = db.prepare('SELECT * FROM commandes WHERE id = ?').get(row.id), c = lireCommande(frais);
      if (frais.statut !== 'attente' || c.moyen === 'facture') return [];
      const liens = db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id);
      // Le client a quitté le paiement : liens fermés, stock rendu à la vente tout de suite (pas au bout de 35 minutes),
      // carte cadeau et points rendus. « Reprendre » rouvre un lien et réserve de nouveau, si le stock est encore là.
      libererReservations(row.boutique_id, c, 'paiement annulé par le client');
      if (!liens.length && c.abandonneeLe) return [];
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE commande_id = ? AND statut = 'cree'").run(c.id);
      c.abandonneeLe = Date.now();
      enregistrerCommande(c);
      return liens;
    });
    for (const p of ouverts) if (p.fournisseur === 'stripe' && paiement.expirer) await paiement.expirer(p).catch(e => journal.error('[paiement] expiration', e.message));
    return { ok: true };
  });
  r.post('/api/public/:slug/commandes/:id/reprendre', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    const jeton = String(ctx.corps.jeton || '');
    if (!row || !auth.egal(jeton, row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    if (row.statut !== 'attente') throw erreur(409, 'Cette commande est déjà payée ou annulée.', 'deja_traitee');
    return ouvrirPaiement(b, row);
  });
  /* Nouveau lien de paiement en ligne pour une commande en attente (paiement repris, devis accepté) : les liens encore
     ouverts sont fermés d'abord ; la carte cadeau éventuellement recréditée est débitée à nouveau. */
  /* Utilisations d'un code promo : commandes qui le portent et qui comptent (payées, ou en attente avec un paiement encore
     possible : lien ouvert depuis moins de 35 minutes, facture QR). Une commande annulée ou dont le client a quitté le
     paiement rend son utilisation. Avec index : celles de ce client seulement. */
  function utilisationsCode(bid, code, { index = null, saufId = '' } = {}) {
    return db.prepare(`SELECT COUNT(*) n FROM commandes WHERE boutique_id = ? AND id <> ? AND code_promo = ? ${index ? 'AND email_index = ?' : ''}
      AND statut <> 'annulee' AND (statut <> 'attente' OR json_extract(donnees, '$.moyen') = 'facture' OR EXISTS (SELECT 1 FROM paiements p WHERE p.commande_id = commandes.id AND p.statut = 'cree' AND p.cree_le > ?))`)
      .get(bid, saufId, code, ...(index ? [index] : []), Date.now() - 35 * 60000).n;
  }
  // Le code peut-il encore servir à ce client ? Renvoie null, ou l'erreur à lever.
  function limiteCode(bid, config, code, email, saufId = '') {
    const c = code && Remises.offresDe(config).codes.find(x => x.code === code);
    if (!c) return null;
    if (c.max && utilisationsCode(bid, code, { saufId }) >= c.max) return erreur(400, `Le code ${code} a atteint son nombre d’utilisations.`, 'code_epuise');
    if (c.unParClient && utilisationsCode(bid, code, { index: PII.index(bid, email) || '', saufId }) > 0) return erreur(400, `Le code ${code} ne s’utilise qu’une fois par client.`, 'code_deja_utilise');
    return null;
  }
  // Stock réservé par les autres commandes en attente encore actives (même règle qu'à la commande).
  function reservationsAutres(bid, saufId) {
    const reserve = {};
    for (const r2 of db.prepare("SELECT id, date, donnees FROM commandes WHERE boutique_id = ? AND statut = 'attente' AND id <> ? AND date > ?").all(bid, saufId, Date.now() - 90 * 86400000)) {
      const d = JSON.parse(r2.donnees);
      const depuis = Math.max(r2.date, d.reserveDepuis || 0);
      if (d.abandonneeLe >= depuis || !(depuis > Date.now() - (d.moyen === 'facture' ? 48 * 3600000 : d.canal === 'devis' ? 7 * 86400000 : 35 * 60000))) continue;
      for (const l of d.lignes || []) if (l.type !== 'drop') { reserve[l.produitId] = (reserve[l.produitId] || 0) + (l.qte || 0); if (l.varianteId) reserve[`${l.produitId}:${l.varianteId}`] = (reserve[`${l.produitId}:${l.varianteId}`] || 0) + (l.qte || 0); }
    }
    return reserve;
  }
  async function ouvrirPaiement(b, row) {
    const c = lireCommande(row);
    const devise = lireConfig(b).boutique.devise || 'EUR';
    const compte = compteVente(b);
    for (const ancien of db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id)) {
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(ancien.id);
      if (ancien.fournisseur === 'stripe' && paiement.expirer) await paiement.expirer(ancien).catch(e => journal.error('[paiement] expiration', e.message));
    }
    // Carte cadeau ou points rendus (paiement abandonné) : repris avant de rouvrir le paiement du reste.
    if ((c.carteCadeau && c.carteCadeau.liberee) || (c.fidelite && c.fidelite.liberee)) transaction(db, () => {
      const frais = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.id));
      if (frais.statut !== 'attente') return;
      const refus = reprendreReservations(b.id, frais);
      if (refus) throw erreur(409, `Paiement impossible : ${refus}. Passez une nouvelle commande.`, 'reservation');
      historique(frais, 'Paiement repris : réservations reprises'); enregistrerCommande(frais);
      Object.assign(c, frais);
    });
    // Paiement repris en ligne (lien de relance, des heures plus tard) : le stock est vérifié à nouveau (les articles ont pu
    // être vendus entre-temps) et réservé de nouveau pour la durée du lien. Le code de bienvenue ne sert qu'une fois.
    if (c.canal !== 'devis' && c.moyen !== 'facture') transaction(db, () => {
      const frais = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.id));
      const autres = reservationsAutres(b.id, c.id), prods = listerProduits(b.id);
      const manque = frais.lignes.filter(l => l.type !== 'drop').find(l => { const p = prods.find(x => x.id === l.produitId); if (!p || p.type === 'drop') return false;
        const v = l.varianteId && Array.isArray(p.variantes) ? p.variantes.find(y => y.id === l.varianteId) : null;
        const dispo = v ? v.stock - (autres[`${l.produitId}:${l.varianteId}`] || 0) : p.stock - (autres[l.produitId] || 0);
        return dispo < frais.lignes.filter(y => y.produitId === l.produitId && (!v || y.varianteId === l.varianteId)).reduce((a, y) => a + y.qte, 0); });
      if (manque) throw erreur(409, `« ${manque.nom} » n’est plus disponible dans cette quantité : passez une nouvelle commande.`, 'stock_insuffisant');
      { const refus = limiteCode(b.id, configVente(b), frais.codePromo, frais.client.email, c.id); if (refus) throw erreur(409, `${refus.message} Passez une nouvelle commande sans lui.`, refus.code); }
      if (frais.codeBienvenue && db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND id <> ? AND email_index = ? AND statut <> 'annulee' AND (statut <> 'attente' OR json_extract(donnees, '$.moyen') = 'facture' OR EXISTS (SELECT 1 FROM paiements p WHERE p.commande_id = commandes.id AND p.statut = 'cree' AND p.cree_le > ?)) LIMIT 1").get(b.id, c.id, PII.index(b.id, frais.client.email) || '', Date.now() - 35 * 60000))
        throw erreur(409, 'Le code de bienvenue a déjà servi pour une autre commande : passez une nouvelle commande sans lui.', 'code_premiere_commande');
      frais.reserveDepuis = Math.max(Date.now(), (frais.abandonneeLe || 0) + 1); enregistrerCommande(frais); Object.assign(c, frais);
    });
    const resteCentimes = Math.round(c.total * 100) - (c.carteCadeau ? Math.round(c.carteCadeau.montant * 100) : 0);
    const pmt = { id: auth.nouvelId('pay_'), commande_id: c.id, montant_centimes: resteCentimes };
    db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le, compte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(pmt.id, c.id, paiement.nom, resteCentimes, devise, 'cree', Date.now(), compte);
    const retour = `${urlBoutique(b)}?commande=${c.id}&jeton=${row.jeton_client}`;
    const session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande: c, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1`, compte, moyens: moyensDe(b.id) });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { paiementUrl: session.url };
  }

  /* E-mails automatiques de toutes les boutiques (appelé régulièrement). */
  /* Entretien périodique : ce qui ne doit pas dépendre d'un minuteur en mémoire (perdu au redémarrage),
     les commandes restées bloquées chez le fournisseur, et la purge des tables qui grossiraient sans fin. */
  let dernierePurge = 0;
  /* Carte cadeau réservée par une commande dont le reste n'est pas payé après 2 heures : le lien de paiement est fermé
     et le montant revient sur la carte. Si le paiement arrive quand même, la carte est débitée à nouveau (ou l'argent
     est rendu si son solde ne suffit plus) : jamais de commande payée à moitié. */
  function libererCartes(maintenant) {
    // Délai compté depuis la dernière réservation (création, reprise du paiement), pas depuis la commande. Une facture QR
    // (payable jusqu'à son échéance, par virement) garde ses réservations.
    const rows = db.prepare(`SELECT * FROM commandes WHERE statut = 'attente' AND COALESCE(json_extract(donnees, '$.moyen'), '') <> 'facture'
      AND ((json_extract(donnees, '$.carteCadeau.id') IS NOT NULL AND json_extract(donnees, '$.carteCadeau.liberee') IS NULL) OR (json_extract(donnees, '$.fidelite.debite') > 0 AND json_extract(donnees, '$.fidelite.liberee') IS NULL))
      AND COALESCE(json_extract(donnees, '$.carteCadeau.reserveLe'), json_extract(donnees, '$.fidelite.reserveLe'), date) < ? LIMIT 200`).all(maintenant - 2 * 3600000);
    for (const row of rows) {
      const ouverts = transaction(db, () => {
        const frais = db.prepare('SELECT * FROM commandes WHERE id = ?').get(row.id);
        if (!frais || frais.statut !== 'attente') return [];
        const c = lireCommande(frais);
        if (!libererReservations(row.boutique_id, c, 'paiement non terminé après 2 heures', maintenant)) return [];
        enregistrerCommande(c);
        const p = db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id);
        db.prepare("UPDATE paiements SET statut = 'annule' WHERE commande_id = ? AND statut = 'cree'").run(c.id);
        return p;
      });
      for (const p of ouverts) if (p.fournisseur === 'stripe' && paiement.expirer) paiement.expirer(p).catch(e => journal.error('[paiement] expiration', e.message));
    }
  }
  function entretien(maintenant = Date.now()) {
    // Copies déchiffrées des commandes (état de l'espace marchand) : effacées après 30 minutes sans ouverture.
    for (const [bid, v] of JSON_COMMANDES) if (maintenant - v.le >= JSON_COMMANDES_DUREE) JSON_COMMANDES.delete(bid);
    // Appareils connus sans connexion depuis un an (cookie expiré, navigateur remplacé) : oubliés.
    db.prepare('DELETE FROM appareils_connus WHERE vu_le < ?').run(maintenant - 365 * 86400000);
    // Fournisseur de démonstration : expéditions en attente (redémarrage, webhook en échec)
    if (delaiExpeditionDemo >= 0) for (const r of db.prepare("SELECT ref FROM demo_fournisseur_commandes WHERE statut = 'recue' AND cree_le < ?").all(maintenant - delaiExpeditionDemo - 60000)) expedierDemo(r.ref).catch(e => journal.error('[demo-fournisseur]', e.message));
    libererCartes(maintenant);
    // Carte cadeau vendue dont l'e-mail n'a pas pu partir (adresse refusée, service en panne) : l'acheteur a payé et
    // n'a pas son code. Le marchand et l'acheteur sont prévenus ; la carte se réémet depuis la commande (annuler, rembourser).
    for (const row of db.prepare("SELECT * FROM commandes WHERE statut = 'payee' AND json_extract(donnees, '$.canal') = 'carte' AND json_extract(donnees, '$.carteEmise.email') IS NOT NULL AND json_extract(donnees, '$.carteEmise.echecEnvoi') IS NULL LIMIT 100").all()) {
      const c = lireCommande(row), e = db.prepare('SELECT envoye, tentatives FROM emails WHERE id = ?').get(c.carteEmise.email);
      if (!e || e.envoye || e.tentatives < 12) continue;
      db.prepare('UPDATE emails SET corps = ? WHERE id = ?').run(courriel.masquerSecrets(db.prepare('SELECT corps FROM emails WHERE id = ?').get(c.carteEmise.email).corps), c.carteEmise.email);
      c.carteEmise.echecEnvoi = maintenant; historique(c, 'L’e-mail de la carte cadeau n’a pas pu être envoyé : remboursez la commande (la carte est désactivée) et invitez le client à en racheter une avec une adresse correcte.');
      enregistrerCommande(c);
      const b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id), m = b && db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
      if (m) envoyerEmail(null, m.email, `Carte cadeau non remise (commande n° ${c.numero})`, `Bonjour,\n\nL'e-mail contenant la carte cadeau de la commande n° ${c.numero} n'a pas pu être envoyé (adresse refusée ou service indisponible). Le client a payé : remboursez la commande depuis Commandes (la carte, jamais utilisée, est désactivée).\n\n${urlPublique}/app#commandes\n\nComptoir`);
    }
    if (maintenant - dernierePurge < 86400000) return;
    dernierePurge = maintenant;
    // Commande transmise, sans expédition depuis 7 jours : le marchand est prévenu (une fois), pour relancer le fournisseur
    for (const row of db.prepare("SELECT id, numero, boutique_id FROM commandes WHERE statut = 'fournisseur' AND date < ?").all(maintenant - 7 * 86400000)) {
      if (!relances.reserverEnvoi || !relances.reserverEnvoi(db, row.boutique_id, `bloquee:${row.id}`, maintenant)) continue;
      const b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id), mch = b && db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
      if (mch) envoyerEmail(null, mch.email, `Commande n° ${row.numero} : toujours pas expédiée par le fournisseur`, `Bonjour,\n\nLa commande n° ${row.numero} a été transmise au fournisseur il y a plus de 7 jours et n'a pas encore de numéro de suivi. Contactez le fournisseur, ou remboursez le client depuis Commandes si le colis ne part pas.\n\nComptoir`);
    }
    // Purge quotidienne
    try { FID.menage(maintenant); } catch (e) { journal.error('[fidelite] ménage', e.message); }   // codes, échecs, réseaux sûrs périmés
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
      // Remboursements de la semaine : avoirs émis (retours partiels, gestes, remboursements complets), quelle que soit la
      // date de la commande ; pas les annulations de factures jamais payées (aucun argent rendu).
      const debutSem = lundi - 7 * 86400000;
      const avoirsSem = db.prepare("SELECT * FROM commandes WHERE boutique_id = ? AND COALESCE(maj_le, date) >= ? AND (json_extract(donnees, '$.retoursPartiels') IS NOT NULL OR json_extract(donnees, '$.avoir.date') >= ?)").all(b.id, debutSem, debutSem).map(lireCommande)
        .flatMap(c => Retours.piecesAvoir(c).filter(a => a.date >= debutSem && a.date < lundi && !(a.final && !(c.payeLe || c.payeManuelLe))));
      const totalAvoirs = avoirsSem.reduce((x, a) => x + Math.round(a.vue.total * 100), 0) / 100, gestesSem = avoirsSem.filter(a => a.geste);
      // Part recréditée sur des cartes cadeaux (pas de l'argent rendu) : dite à part.
      const surCartes = avoirsSem.reduce((x, a) => x + Math.round(((a.vue.carteCadeau && !a.vue.carteCadeau.liberee && a.vue.carteCadeau.montant) || 0) * 100), 0) / 100;
      // Rien à dire : ni commande récente ni remboursement de la semaine (un remboursement d'une commande ancienne compte).
      if (!cmds.length && !avoirsSem.length) continue;
      const vendue = c => !['attente', 'annulee', 'remboursee'].includes(c.statut) && c.canal !== 'carte';   // carte cadeau vendue : pas du chiffre d'affaires (compté quand elle sert)
      const sem = cmds.filter(c => c.date >= lundi - 7 * 86400000 && c.date < lundi && vendue(c)), avant = cmds.filter(c => c.date < lundi - 7 * 86400000 && vendue(c));
      const ca = l => l.reduce((a, c) => a + c.total - Retours.deja(c).total / 100, 0), f = m => formatMontant(m, config);   // moins les retours partiels
      const evol = (x, y) => y ? `${x >= y ? '+' : '−'}${Math.abs(Math.round((x - y) / y * 100))} % par rapport à la semaine d’avant` : 'première semaine de ventes';
      const parProduit = {};
      for (const c of sem) for (const l of c.lignes || []) { const k = l.nom; parProduit[k] = parProduit[k] || { q: 0, m: 0 }; parProduit[k].q += l.qte; parProduit[k].m += l.prix * l.qte; }
      const tops = Object.entries(parProduit).sort((a, b2) => b2[1].m - a[1].m).slice(0, 3);
      const toutes = db.prepare("SELECT * FROM commandes WHERE boutique_id = ? AND statut IN ('payee', 'preparation', 'attente')").all(b.id).map(lireCommande);
      const aExpedier = toutes.filter(c => ['payee', 'preparation'].includes(c.statut) && c.livraison !== 'retrait' && c.canal !== 'carte' && !(c.lignes || []).every(l => l.type === 'drop'));
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
        ...(avoirsSem.length ? [`- Remboursements : ${f(totalAvoirs)} (${avoirsSem.length} avoir${avoirsSem.length > 1 ? 's' : ''}${gestesSem.length ? `, dont ${gestesSem.length} geste${gestesSem.length > 1 ? 's' : ''} commercia${gestesSem.length > 1 ? 'ux' : 'l'} pour ${f(gestesSem.reduce((x, a) => x + Math.round(a.vue.total * 100), 0) / 100)}` : ''}${surCartes ? `, dont ${f(surCartes)} recrédités sur des cartes cadeaux` : ''}). Les retours des commandes de la période sont déjà déduits du chiffre d’affaires ci-dessus.`] : []),
        ...(tops.length ? ['', 'Meilleurs produits :', ...tops.map(([nom, x]) => `- ${nom} : ${x.q} vendu${x.q > 1 ? 's' : ''}, ${f(x.m)}`)] : []),
        '', 'À faire cette semaine :',
        aExpedier.length ? `- ${aExpedier.length} commande${aExpedier.length > 1 ? 's' : ''} à préparer et expédier` : '- Aucune commande en retard d’expédition',
        ...(echues.length ? [`- ${echues.length} facture${echues.length > 1 ? 's' : ''} QR échue${echues.length > 1 ? 's' : ''} non payée${echues.length > 1 ? 's' : ''} (n° ${echues.slice(0, 5).map(c => c.numero).join(', ')}) : importez votre relevé bancaire ou relancez le client`] : []),
        ...(risquees.length ? [`- ${risquees.length} commande${risquees.length > 1 ? 's' : ''} à risque de fraude à vérifier (n° ${risquees.slice(0, 5).map(c => c.numero).join(', ')})`] : []),
        ...ruptures.map(x => `- Rupture prévue dans ${x.jours} jour${x.jours > 1 ? 's' : ''} : ${x.p.nom} (stock ${x.p.stock})`),
        ...(() => { const cl = JV().ancrer(b.id, maintenant);   // empreinte gardée : elle doit rester dans la chaîne
          return cl ? ['', `Journal inaltérable des ventes : clôture du ${cl.ref}, empreinte ${cl.empreinte}`, 'Gardez cet e-mail : cette empreinte prouve que vos factures n’ont pas été modifiées depuis.'] : []; })(),
        '', `Votre tableau de bord : ${urlPublique}/app#tableau`, '', 'Ce rapport arrive chaque lundi. Pour ne plus le recevoir : Paramètres > E-mails.', '', 'L’équipe Comptoir'
      ];
      envoyerEmail(null, mch.email, `Votre semaine : ${f(ca(sem))}, ${sem.length} commande${sem.length > 1 ? 's' : ''} (${config.boutique.nom})`, lignes.join('\n'));
      n++;
    }
    return n;
  }
  /* Vérification automatique du journal, une fois par jour et par boutique (une boutique à la fois, par lots) :
     le marchand est prévenu par e-mail si une anomalie apparaît. */
  let verificationNocturne = false;
  async function verificationsNocturnes(maintenant = Date.now()) {
    if (verificationNocturne) return; verificationNocturne = true;
    try {
      const dues = db.prepare('SELECT DISTINCT j.boutique_id id FROM journal_inalterable j JOIN boutiques b ON b.id = j.boutique_id LEFT JOIN journal_verifications v ON v.boutique_id = j.boutique_id WHERE v.le IS NULL OR v.le < ?').all(maintenant - 86400000);
      for (const { id } of dues) {
        const b = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(id); if (!b || verificationsEnCours.has(id)) continue;
        try {
          const avant = db.prepare('SELECT resultat FROM journal_verifications WHERE boutique_id = ?').get(id);
          const empreinteAnomalies = r => crypto.createHash('sha256').update(JSON.stringify((r && r.anomalies) || [])).digest('hex');
          const r2 = await verifierJournal(b, null, maintenant);
          // E-mail seulement pour des anomalies nouvelles (pas chaque nuit pour les mêmes), jamais pour un simple changement de clé du serveur.
          if (!r2.ok && !r2.cleChangee && (!avant || empreinteAnomalies(JSON.parse(avant.resultat)) !== empreinteAnomalies(r2))) {
            const m = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
            if (m) envoyerEmail(null, m.email, `Journal des ventes : ${r2.nbAnomalies} anomalie${r2.nbAnomalies > 1 ? 's' : ''} détectée${r2.nbAnomalies > 1 ? 's' : ''} (${lireConfig(b).boutique.nom})`,
              `Bonjour,\n\nLa vérification automatique du journal inaltérable de vos ventes a trouvé ${r2.nbAnomalies} anomalie${r2.nbAnomalies > 1 ? 's' : ''} :\n\n${r2.anomalies.slice(0, 10).map(a => `- ${a}`).join('\n')}\n\nDétail dans Comptoir, Conformité. Si vous n'expliquez pas ces écarts, écrivez-nous.\n\nL’équipe Comptoir`);
          }
        } catch (e) {
          // Une boutique en erreur n'arrête pas les autres ; son échec est noté (elle sera réessayée demain, pas toutes les 5 minutes).
          journal.error('[journal-inalterable] vérification', id, e.message);
          db.prepare('INSERT OR REPLACE INTO journal_verifications (boutique_id, le, resultat) VALUES (?, ?, ?)').run(id, maintenant, JSON.stringify({ ok: false, nbAnomalies: 1, anomalies: [`Vérification impossible : ${e.message}`] }));
        }
      }
    } finally { verificationNocturne = false; }
  }
  function automatisationsEcheances(maintenant = Date.now()) {
    let n = 0;
    entretien(maintenant);
    try { rapportsHebdo(maintenant); } catch (e) { journal.error('[rapport-hebdo]', e.message); }
    try { alertesRetourStock(maintenant); } catch (e) { journal.error('[retour-stock]', e.message); }
    try { appliquerRecuperations(maintenant); } catch (e) { journal.error('[recuperation]', e.message); }
    // Fidélité : points des comptes inactifs expirés, un lot de 1000 comptes par boutique et par passage (toutes les
    // quelques minutes) ; boutiques supprimées exclues, programme en pause ignoré (dans expirer).
    for (const { boutique_id: bid } of db.prepare('SELECT f.boutique_id FROM fidelite_reglages f JOIN boutiques b ON b.id = f.boutique_id').all()) { try { FID.expirer(bid, maintenant); } catch (e) { journal.error('[fidelite] expiration', e.message); } }
    // Clôture journalière du journal inaltérable (jours terminés), pour chaque boutique qui a des pièces.
    // (boutiques supprimées : leur journal est gardé pour l'archivage, mais plus clôturé)
    for (const { boutique_id: bid } of db.prepare('SELECT DISTINCT j.boutique_id FROM journal_inalterable j JOIN boutiques b ON b.id = j.boutique_id').all()) {
      try {
        // Chaque clôture part aussi vers les webhooks du marchand qui l'ont demandée : une copie quotidienne de l'empreinte hors de Comptoir.
        const devise = (() => { const b = db.prepare('SELECT config FROM boutiques WHERE id = ?').get(bid); try { return JSON.parse(b.config).boutique.devise || 'EUR'; } catch { return 'EUR'; } })();
        for (const cl of JV().cloturer(bid, maintenant)) {
          try { integ.emettre(bid, 'journal.cloture', { jour: cl.jour, empreinte: cl.empreinte, pieces: cl.pieces, totalJour: cl.totalJour / 100, grandTotal: cl.grandTotal / 100, devise }); }
          catch (e) { journal.error('[journal-inalterable] webhook de clôture', bid, cl.jour, e.message); }   // une erreur n'empêche pas les jours suivants
        }
      } catch (e) { journal.error('[journal-inalterable] clôture', bid, e.message); }
    }
    verificationsNocturnes(maintenant).catch(e => journal.error('[journal-inalterable] vérification', e.message));
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
  /* Retours : France et Belgique, 14 jours après réception (droit de rétractation) ; Suisse, le délai choisi par le
     marchand (sinon aucun). Point de départ : la livraison ou le retrait (sinon l'expédition, puis la commande). */
  const delaiRetour = (b, c) => {
    if (!['expediee', 'livree', 'retiree'].includes(c.statut) || c.canal === 'magasin' || c.canal === 'devis' || c.canal === 'carte') return 0;
    const config = lireConfig(b), jours = config.boutique.pays === 'ch' ? Number((config.entreprise || {}).retoursJours) || 0 : Math.max(14, Number((config.entreprise || {}).retoursJours) || 0);
    if (!jours) return 0;
    const recu = [...(c.historique || [])].reverse().find(h => /^(Livrée|Remise au client|Retirée|Expédiée)/.test(h.texte));
    return (recu ? recu.date : c.date) + (jours + (c.statut === 'expediee' ? 7 : 0)) * 86400000;   // colis en route : 7 jours d'acheminement en plus
  };
  r.post('/api/public/:slug/commandes/:id/retour', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    auth.limiter('retour:' + ctx.ip, 10 * facteurLimites, 3600000, 'Trop de demandes. Réessayez plus tard.');
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!row || !auth.egal(String(ctx.corps.jeton || ''), row.jeton_client)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const c = lireCommande(row);
    if (c.retour && c.retour.statut === 'demande') throw erreur(409, 'Un retour est déjà demandé pour cette commande.', 'retour_existant');
    if (c.avoir || c.statut === 'remboursee') throw erreur(409, 'Cette commande est déjà remboursée.', 'deja_rembourse');
    const dejaRendus = Retours.deja(c).qte;
    if (delaiRetour(b, c) <= Date.now()) throw erreur(409, 'Le délai de retour de cette commande est dépassé.', 'retour_hors_delai');
    const voulus = Array.isArray(ctx.corps.lignes) ? ctx.corps.lignes : [];
    // Chaque ligne repérée par sa position (deux tailles du même produit sont deux lignes distinctes)
    const lignes = c.lignes.map((l, i) => { const v = voulus.find(x => x && Number(x.ligne) === i); const q = v ? Math.max(0, Math.min(l.qte - dejaRendus[i], parseInt(v.qte, 10) || 0)) : 0; return q ? { ligne: i, produitId: l.produitId, ...(l.varianteId ? { varianteId: l.varianteId } : {}), nom: l.nom, qte: q, prix: l.prix } : null; }).filter(Boolean);
    if (!lignes.length) throw erreur(400, 'Choisissez au moins un article à retourner.', 'retour_vide');
    const motif = String(ctx.corps.motif || '').trim().slice(0, 500);
    c.retour = { date: Date.now(), lignes, motif, statut: 'demande', montant: prix.arrondi(lignes.reduce((a, l) => a + l.prix * l.qte, 0)) };
    historique(c, `Retour demandé par le client : ${lignes.map(l => `${l.qte} × ${l.nom}`).join(', ')}${motif ? ` (motif : ${motif.slice(0, 120)})` : ''}`);
    enregistrerCommande(c);
    const config = lireConfig(b), e = config.entreprise || {}, f = m => formatMontant(m, config);
    const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(b.marchand_id);
    if (mch) envoyerEmail(null, mch.email, `Retour demandé : commande n° ${c.numero}`, `Bonjour,\n\n${c.client.nom} demande à retourner :\n${lignes.map(l => `- ${l.qte} × ${l.nom} (${f(l.prix * l.qte)})`).join('\n')}\n${motif ? `\nMotif : ${motif}\n` : ''}\nÀ réception des articles, remboursez depuis Commandes (n° ${c.numero}).\n${urlPublique}/app#commandes\n\nL’équipe Comptoir`);
    envoyerEmail(b.id, c.client.email, `Votre demande de retour (commande n° ${c.numero})`, `Bonjour ${c.client.nom},\n\nNous avons bien reçu votre demande de retour :\n${lignes.map(l => `- ${l.qte} × ${l.nom}`).join('\n')}\n\nRenvoyez les articles à cette adresse, dans leur emballage si possible :\n${e.raison || config.boutique.nom}\n${e.adresse || ''}\n\nLe remboursement intervient dès réception${config.boutique.pays === 'ch' ? '' : ', au plus tard 14 jours après votre demande'}.\n\n${config.boutique.nom}`);
    notifierEquipe(b, { titre: `Retour demandé · n° ${c.numero}`, texte: `${lignes.reduce((a, l) => a + l.qte, 0)} article(s), ${f(c.retour.montant)}`, url: '/app#commandes' }).catch(() => {});
    return { statut: 201, corps: { ok: true } };
  });
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
    const c = lireCommande(row), rendus = Retours.deja(c).qte;
    return { numero: c.numero, statut: c.statut, total: c.total, port: c.port || 0, livraison: c.livraison, date: c.date, prenom: String((c.client && c.client.nom) || '').split(' ')[0], ville: (c.client && c.client.ville) || '', suivi: c.suivi || null, lignes: c.lignes.map((l, i) => ({ produitId: l.produitId, ...(l.varianteId ? { varianteId: l.varianteId } : {}), nom: l.nom, qte: l.qte, prix: l.prix, rendu: rendus[i] })), offreApres: offreApres(b, c),
      // Liens de téléchargement seulement si la boutique a toutes ses mentions (sinon le document ne peut pas être produit).
      documentsDisponibles: !!c.facture && c.canal !== 'carte' && !FactureElectronique.manques(c, lireConfig(b)).length,
      facture: c.facture && c.canal !== 'carte' ? c.facture : null, avoir: c.avoir && c.avoir.numero ? c.avoir.numero : null, retour: c.retour ? { statut: c.retour.statut, date: c.retour.date } : null,
      avoirsPartiels: (c.retoursPartiels || []).filter(p => p.numero).map(p => ({ numero: p.numero, date: p.date, montant: p.montant / 100 })),
      retourPossible: delaiRetour(b, c) > Date.now() && !(c.retour && c.retour.statut === 'demande') && !c.avoir && c.statut !== 'remboursee' && rendus.some((q, i) => q < c.lignes[i].qte) };
  });

  /* ---------- Webhooks ---------- */
  r.post('/api/webhooks/stripe', async ctx => {
    if (paiement.nom !== 'stripe' || !paiement.verifierWebhook(ctx.corpsBrut, ctx.req.headers['stripe-signature'])) throw erreur(400, 'Signature invalide.', 'signature');
    const ev = lireJsonSur(ctx.corpsBrut);
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw erreur(400, 'Événement invalide.', 'corps_invalide');
    // Stripe renvoie un même événement en cas de doute : il n'est traité qu'une fois (plus d'e-mail en double).
    if (ev.id) {
      db.exec('CREATE TABLE IF NOT EXISTS evenements_stripe (id TEXT PRIMARY KEY, recu_le INTEGER NOT NULL)');
      if (db.prepare('INSERT OR IGNORE INTO evenements_stripe (id, recu_le) VALUES (?, ?)').run(String(ev.id), Date.now()).changes === 0) return { recu: true, deja: true };
      db.prepare('DELETE FROM evenements_stripe WHERE recu_le < ?').run(Date.now() - 30 * 86400000);
    }
    try { return await traiterEvenementStripe(ev); }
    catch (e) { if (ev.id) db.prepare('DELETE FROM evenements_stripe WHERE id = ?').run(String(ev.id)); throw e; }   // échec (Stripe injoignable…) : Stripe réessaiera, l'événement n'est pas perdu
  });
  function marquerRembourseChezStripe(intent, compte) {
    const p = db.prepare("SELECT * FROM paiements WHERE intent = ? AND statut = 'a_rembourser' AND COALESCE(compte, '') = ?").get(intent, compte || '');
    if (!p) return;
    db.prepare("UPDATE paiements SET statut = 'rembourse' WHERE id = ?").run(p.id);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ?').get(p.commande_id);
    if (row) { const c = lireCommande(row); historique(c, 'Paiement à rendre : remboursé depuis Stripe.'); enregistrerCommande(c); }
  }
  async function traiterEvenementStripe(ev) {
    // Événement d'un compte connecté (boutique) : jamais un abonnement Comptoir ; seuls l'état du compte et ses ventes comptent.
    if (ev.account) {
      const objet = (ev.data && ev.data.object) || {};
      if (ev.type === 'account.updated') { const e = etatDepuisCompte(objet); db.prepare('UPDATE comptes_stripe SET pret = ?, moyens = ?, maj_le = ? WHERE compte = ?').run(e.pret ? 1 : 0, JSON.stringify(e.moyens), Date.now(), ev.account); }
      if (ev.type === 'account.application.deauthorized') db.prepare('UPDATE comptes_stripe SET pret = 0, maj_le = ? WHERE compte = ?').run(Date.now(), ev.account);
      if (((ev.type === 'checkout.session.completed' && objet.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded') && objet.metadata && objet.metadata.paiement_id) {
        const p = db.prepare('SELECT * FROM paiements WHERE id = ?').get(String(objet.metadata.paiement_id));
        if (p && p.compte === ev.account && !sessionNonConforme(objet, p)) {   // la vente doit venir du compte de la boutique, au bon montant
          await paiementConfirme(objet.metadata.paiement_id, objet.id);
          if (objet.payment_intent) db.prepare('UPDATE paiements SET intent = ? WHERE id = ?').run(String(objet.payment_intent), String(objet.metadata.paiement_id));
        }
      }
      // Remboursement fait directement chez Stripe (tableau de bord) d'un paiement « à rembourser » : il n'est plus signalé.
      if (ev.type === 'charge.refunded' && objet.refunded === true && objet.payment_intent) marquerRembourseChezStripe(String(objet.payment_intent), ev.account);
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
          // Carte cadeau vendue contestée (carte bancaire volée ?) : la carte est bloquée tout de suite si elle n'a pas servi.
          // (à chaque événement du litige, pas seulement le premier : une carte émise entre-temps est bloquée aussi)
          if (c.carteEmise && !c.carteEmise.desactivee) {
            const k = db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ?').get(c.carteEmise.id);
            if (k && k.statut === 'active') { Cartes.desactiver(b.id, k.id); c.carteEmise.desactivee = Date.now(); historique(c, `Carte cadeau ····${c.carteEmise.fin} bloquée à cause du litige${k.solde < k.initial ? ` (déjà utilisée pour ${formatMontant((k.initial - k.solde) / 100, config)})` : ''}`); }
          }
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
    if (ev.type === 'charge.refunded' && objet.refunded === true && objet.payment_intent) marquerRembourseChezStripe(String(objet.payment_intent), null);
    if (((ev.type === 'checkout.session.completed' && objet.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded') && objet.metadata && objet.metadata.paiement_id) {
      // Webhook de la plateforme : seulement pour un paiement encaissé par la plateforme (pas celui d'une boutique connectée).
      const p = db.prepare('SELECT * FROM paiements WHERE id = ?').get(String(objet.metadata.paiement_id));
      if (p && !p.compte && !sessionNonConforme(objet, p)) await paiementConfirme(p.id, objet.id);
    }
    return { recu: true };
  }
  r.post('/api/webhooks/fournisseurs/:code', ctx => {
    const f = db.prepare('SELECT * FROM fournisseurs WHERE code = ?').get(ctx.params.code);
    if (!f || !fournisseurs.verifierSignature(ctx.corpsBrut, ctx.req.headers['x-signature'], f.secret_webhook)) throw erreur(401, 'Signature invalide.', 'signature');
    const ev = lireJsonSur(ctx.corpsBrut);
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw erreur(400, 'Événement invalide.', 'corps_invalide');
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
    ${FEUILLE_2}</head>
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
          const proprio = sess && db.prepare('SELECT marchand_id FROM boutiques WHERE id = ?').get(a.boutiqueId);
          const e = sess && proprio && abo.etat(proprio.marchand_id);   // abonnement de la boutique (propriétaire), aussi pour l'équipe
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
    if (!minuterieFlux) requeteCourante.exit(() => { minuterieFlux = setInterval(tourDeFlux, Number(env.FLUX_INTERVALLE_MS) || 2000); minuterieFlux.unref(); });   // hors du contexte de cette requête
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
  function pageBoutique(b, { racine, produitId = null, langue = null }) {
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
    const langueOk = ['de', 'it', 'en'].includes(langue) && (config.boutique.langues || []).includes(langue) ? langue : null;
    const sansLangue = p ? urlProduit(p) : base + '/';
    const canonique = langueOk ? `${sansLangue}?lang=${langueOk}` : sansLangue;   // chaque version linguistique est sa propre page
    const ld = p ? { '@context': 'https://schema.org', '@type': 'Product', name: p.nom, description: court(p.description), ...(image ? { image } : {}), url: canonique, brand: { '@type': 'Brand', name: nom },
      // Variantes : fourchette de prix (AggregateOffer) ; sinon une offre simple
      offers: Array.isArray(p.variantes) && p.variantes.length ? (prixV => ({ '@type': 'AggregateOffer', lowPrice: Math.min(...prixV).toFixed(2), highPrice: Math.max(...prixV).toFixed(2), offerCount: p.variantes.length, priceCurrency: devise, availability: p.variantes.some(v => v.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: canonique }))(p.variantes.map(v => typeof v.prix === 'number' ? v.prix : p.prix))
        : { '@type': 'Offer', price: Number(p.prix).toFixed(2), priceCurrency: devise, availability: p.type === 'drop' || p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: canonique } }
      : { '@context': 'https://schema.org', '@type': 'OnlineStore', name: nom, url: canonique, description, ...(config.entreprise && config.entreprise.email ? { email: config.entreprise.email } : {}) };
    const tete = [
      `<meta name="comptoir-slug" content="${escHtml(b.slug)}">`, `<meta name="comptoir-racine" content="${escHtml(new URL(base + '/').pathname)}">`,
      ...(p ? [`<meta name="comptoir-produit" content="${escHtml(p.id)}">`] : []),
      `<title>${escHtml(titre)}</title>`, `<meta name="description" content="${escHtml(description)}">`, `<link rel="canonical" href="${escHtml(canonique)}">`, `<link rel="sitemap" type="application/xml" href="${escHtml(base)}/sitemap.xml">`,
      ...(ouverte && !(produitId && !p) ? [] : ['<meta name="robots" content="noindex">']),
      // Boutique en plusieurs langues : chaque version annoncée aux moteurs de recherche (hreflang), le français par défaut.
      ...((config.boutique.langues || []).filter(l => ['de', 'it', 'en'].includes(l)).length ? ['fr', ...(config.boutique.langues || []).filter(l => ['de', 'it', 'en'].includes(l))].map(l => `<link rel="alternate" hreflang="${l}" href="${escHtml(l === 'fr' ? sansLangue : `${sansLangue}?lang=${l}`)}">`).concat([`<link rel="alternate" hreflang="x-default" href="${escHtml(sansLangue)}">`]) : []),
      `<meta property="og:type" content="${p ? 'product' : 'website'}">`, `<meta property="og:site_name" content="${escHtml(nom)}">`, `<meta property="og:title" content="${escHtml(p ? p.nom : nom)}">`,
      `<meta property="og:description" content="${escHtml(description)}">`, `<meta property="og:url" content="${escHtml(canonique)}">`, `<meta property="og:locale" content="fr_${config.boutique.pays === 'ch' ? 'CH' : config.boutique.pays === 'be' ? 'BE' : 'FR'}">`,
      ...(image ? [`<meta property="og:image" content="${escHtml(image)}">`, '<meta name="twitter:card" content="summary_large_image">'] : ['<meta name="twitter:card" content="summary">']),
      ...(p ? [`<meta property="product:price:amount" content="${Number(p.prix).toFixed(2)}">`, `<meta property="product:price:currency" content="${devise}">`] : []),
      `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
    ].join('\n');
    // Contenu lisible sans JavaScript (robots, aperçus) ; remplacé par la boutique interactive au chargement.
    const sansJs = `<noscript><main class="page-erreur"><h1>${escHtml(p ? p.nom : nom)}</h1>${p ? `<p>${escHtml(court(p.description))}</p><p><strong>${escHtml(formatMontant(p.prix, config))}</strong></p>` : `<p>${escHtml(description)}</p><ul>${produits.slice(0, 60).map(x => `<li><a href="${escHtml(urlProduit(x))}">${escHtml(x.nom)}</a> · ${escHtml(formatMontant(x.prix, config))}</li>`).join('')}</ul>`}<p>Activez JavaScript pour commander.</p></main></noscript>`;
    return fs.readFileSync(path.join(RACINE_FRONT, 'boutique.html'), 'utf8').replace(/<title>[^<]*<\/title>/, '').replace('<html lang="fr">', () => `<html lang="${langueOk || 'fr'}">`).replace('<head>', () => `<head>\n${tete}`).replace('<div id="app"></div>', () => `<div id="app"></div>${sansJs}`);   // fonctions : « $' » ou « $& » dans un nom de boutique restent du texte
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
  const pageSimple = (titre, texte, formulaire = '', langue = 'fr') => `<!doctype html><html lang="${EmailsClients.LANGUES.includes(langue) ? langue : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(titre)}</title>
${FEUILLE_3}</head><body><main><h1>${escHtml(titre)}</h1><p>${escHtml(texte)}</p>${formulaire}</main></body></html>`;
  /* Pages légales de la plateforme elle-même (l'exploitant les complète avec EXPLOITANT_* dans l'environnement). */
  const exploitant = () => ({
    nom: env.EXPLOITANT_NOM || '', adresse: env.EXPLOITANT_ADRESSE || '', email: env.EXPLOITANT_EMAIL || '', ide: env.EXPLOITANT_IDE || '', hebergeur: env.HEBERGEUR || ''
  });
  const pageLegale = (titre, blocs) => {
    const x = exploitant(), manque = !x.nom || !x.adresse || !x.email;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(titre)} · Comptoir</title>
${FEUILLE_4}</head>
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
    const langue = EmailsClients.langueDe({ langue: ctx.query.get('lang') }) || 'fr', t = EmailsClients.pages(langue);
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) return { html: pageSimple(t.invalide[0], t.invalide[1], '', langue) };
    const b = db.prepare('SELECT config FROM boutiques WHERE id = ?').get(d.boutiqueId);
    const nom = b ? JSON.parse(b.config).boutique.nom : '';
    if (estDesinscrit(d.boutiqueId, d.email)) return { html: pageSimple(t.dejaDesinscrit[0], t.dejaDesinscrit[1](d.email, nom), '', langue) };
    return { html: pageSimple(t.desinscrire[0](nom), t.desinscrire[1](d.email), `<form method="post" action="/desinscription?j=${encodeURIComponent(ctx.query.get('j'))}${langue !== 'fr' ? `&amp;lang=${langue}` : ''}"><button>${t.desinscrire[2]}</button></form>`, langue) };
  });
  db.exec('CREATE TABLE IF NOT EXISTS optins (jeton_hash TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, email TEXT NOT NULL, expire_le INTEGER NOT NULL, utilise INTEGER NOT NULL DEFAULT 0)');
  for (const sql of ['ALTER TABLE optins ADD COLUMN langue TEXT', 'ALTER TABLE abonnes ADD COLUMN langue TEXT']) { try { db.exec(sql); } catch { /* déjà là */ } }   // langue des e-mails commerciaux
  const lireOptin = j => { const o = db.prepare('SELECT * FROM optins WHERE jeton_hash = ? AND expire_le > ?').get(auth.sha256(String(j || '')), Date.now()); return o ? { boutiqueId: o.boutique_id, email: o.email, utilise: !!o.utilise, langue: o.langue || null } : null; };
  r.get('/reinscription', ctx => {
    const d = lireOptin(ctx.query.get('j'));
    if (!d) { const t = EmailsClients.pages(ctx.query.get('lang')); return { html: pageSimple(t.invalide[0], t.invalide[1], '', EmailsClients.langueDe({ langue: ctx.query.get('lang') }) || 'fr') }; }
    const t = EmailsClients.pageOptin(d.langue) || ['Recevoir les nouvelles de la boutique', e => `Confirmez l’inscription de ${e}.`, 'Confirmer mon inscription'];
    return { html: pageSimple(t[0], t[1](d.email), `<form method="post" action="/reinscription?j=${encodeURIComponent(ctx.query.get('j'))}"><button>${t[2]}</button></form>`, d.langue || 'fr') };
  });
  r.post('/reinscription', ctx => {
    const d = lireOptin(ctx.query.get('j'));
    if (!d) throw erreur(400, 'Lien invalide ou expiré.', 'invalide');
    // Usage unique : un second clic confirme sans rien refaire (le marchand ne peut pas réinscrire quelqu'un avec un vieux lien).
    if (d.utilise) { const t = EmailsClients.pages(d.langue); return { html: pageSimple(t.dejaConfirme[0], t.dejaConfirme[1](d.email), '', d.langue || 'fr') }; }
    db.prepare('UPDATE optins SET utilise = 1 WHERE jeton_hash = ?').run(auth.sha256(String(ctx.query.get('j') || '')));
    db.prepare('DELETE FROM desinscriptions WHERE boutique_id = ? AND email = ?').run(d.boutiqueId, d.email);
    const nouveau = db.prepare('INSERT OR IGNORE INTO abonnes (boutique_id, email, cree_le, langue) VALUES (?, ?, ?, ?)').run(d.boutiqueId, d.email, Date.now(), d.langue).changes > 0;
    const bq = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(d.boutiqueId);
    // Inscription confirmée : l'e-mail de bienvenue (et son code) part maintenant, une seule fois par adresse.
    if (nouveau && bq) relances.emailBienvenue({ db, boutique: bq, config: configVente(bq), email: d.email, urlPublique, urlBoutique: urlBoutique(bq), envoyerEmail, langue: d.langue });
    const t = EmailsClients.pageOptin(d.langue);
    return { html: t ? pageSimple(t[3], t[4](d.email), '', d.langue) : pageSimple('C’est fait', `${d.email} recevra désormais les nouvelles de cette boutique. Vous pourrez vous désinscrire à tout moment depuis chaque e-mail.`) };
  });
  r.post('/desinscription', ctx => {
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) throw erreur(400, 'Lien de désinscription invalide.', 'invalide');
    db.prepare('INSERT OR IGNORE INTO desinscriptions (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(d.boutiqueId, d.email, Date.now());
    db.prepare('DELETE FROM abonnes WHERE boutique_id = ? AND email = ?').run(d.boutiqueId, d.email);
    const langue = EmailsClients.langueDe({ langue: ctx.query.get('lang') }) || 'fr', t = EmailsClients.pages(langue);
    return { html: pageSimple(t.desinscrit[0], t.desinscrit[1](d.email), '', langue) };
  });

  /* ---------- Abonnement Comptoir ---------- */
  r.get('/api/abonnement', exigerProprietaire, ctx => ({ ...abo.etat(ctx.marchand.id), formules: abo.formulesPour(deviseDe(ctx.boutique)), devise: deviseDe(ctx.boutique) }));
  // Retour de Stripe Checkout : paiement vérifié tout de suite, sans attendre le webhook.
  r.post('/api/abonnement/verifier', exigerProprietaire, async ctx => {
    const { etat: e, devenuActif } = await abo.verifierRetour(ctx.marchand.id);
    if (devenuActif) emailAbonnement(ctx.marchand.id, 'active');   // le webhook arrivera après : c'est ici que l'abonnement devient actif
    return e;
  });
  r.post('/api/abonnement/commencer', exigerProprietaire, async ctx => {
    if (abo.prestataire === 'simulation' && env.NODE_ENV === 'production' && abo.obligatoire) throw erreur(503, 'Le paiement des abonnements n’est pas encore configuré (clé Stripe manquante).', 'paiement_non_configure');
    return abo.commencer({ marchand: ctx.marchand, formule: String(ctx.corps.formule || ''), devise: deviseDe(ctx.boutique) });
  });
  r.post('/api/abonnement/changer', ctx => { exigerProprietaire(ctx); exigerMarchand(ctx); }, ctx => abo.changer({ marchand: ctx.marchand, formule: String(ctx.corps.formule || '') }));
  r.post('/api/abonnement/resilier', ctx => { exigerProprietaire(ctx); exigerMarchand(ctx); }, async ctx => { const r2 = await abo.resilier({ marchand: ctx.marchand }); if (!r2.url) emailAbonnement(ctx.marchand.id, 'resiliation'); return r2; });
  r.post('/api/abonnement/reprendre', ctx => { exigerProprietaire(ctx); exigerMarchand(ctx); }, ctx => abo.reprendre({ marchand: ctx.marchand }));
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
  /* JSON reçu : les clés qui changeraient le comportement d'un objet (__proto__, constructor, prototype, toString, valueOf)
     sont écartées à la lecture. Sinon, { "code": { "toString": 1 } } ferait échouer String(code) (erreur 500). */
  const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'toJSON', 'toLocaleString', 'hasOwnProperty']);
  const lireJsonSur = texte => JSON.parse(texte, (k, v) => CLES_INTERDITES.has(k) ? undefined : v);
  async function gerer(req, res) {
    let entetesRequete = {};
    gerer.enCours++; res.on('close', () => { gerer.enCours--; });   // requêtes en cours (arrêt propre : on attend qu'elles finissent)
    // En-têtes de sécurité sur toutes les réponses : aucun script étranger (tout est servi par Comptoir),
    // pas d'affichage dans un cadre d'un autre site (clickjacking), pas de devinette du type de fichier.
    // Styles : fichiers du site et feuilles connues (empreintes) seulement ; aucun style en ligne (attribut ou bloc injecté).
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' ${[...empreintesStyles].join(' ')}; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; object-src 'none'; worker-src 'self'; manifest-src 'self'${securise ? '; upgrade-insecure-requests' : ''}; report-uri /csp-rapport`);   // les navigateurs signalent ce qu'ils ont bloqué (tentative d'injection, extension) ; report-to non utilisé : avec lui, Chromium n'envoie plus rien par report-uri
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');   // une page ouverte depuis un autre site ne garde pas la main sur la nôtre
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), serial=(), hid=(), bluetooth=(), midi=(), browsing-topics=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');   // nos fichiers (photos, données) ne s'intègrent pas dans la page d'un autre site
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (securise) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // HEAD : même réponse que GET, sans corps (Node l'omet de lui-même ; la réponse a déjà noté la méthode d'origine).
    if (req.method === 'HEAD') req.method = 'GET';
    // Adresse impossible à lire (« // », « //:x ») : 400, et surtout pas une exception hors du try (le processus tomberait).
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Requête invalide.'); return; }
    const chemin = url.pathname;
    try {
      // Domaine personnalisé : la boutique est servie à la racine de son propre domaine.
      const hote = String(req.headers.host || '').split(':')[0].toLowerCase();
      // Sur le domaine d'un marchand, seule sa boutique est servie : ni espace marchand, ni connexion, ni console
      // (un cookie de session posé pour ce domaine pourrait sinon partir chez son propriétaire).
      if (hote && hote !== hotePrincipal && /^\/(app|operateur|devis|facture|paiement-simule|abonnement-simule)(\/|$)|^\/api\/(auth|admin|abonnement|v1|session|webhooks)(\/|$)/.test(chemin)
        && db.prepare("SELECT 1 FROM boutiques WHERE lower(json_extract(config, '$.boutique.domaine.domaine')) = ? AND json_extract(config, '$.boutique.domaine.actif') = 1").get(hote)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Introuvable'); return;
      }
      if (hote && hote !== hotePrincipal && req.method === 'GET' && (chemin === '/' || chemin === '/index.html' || /^\/p\/[\w-]+$/.test(chemin) || chemin === '/sitemap.xml' || chemin === '/robots.txt')) {
        const b = db.prepare("SELECT * FROM boutiques WHERE lower(json_extract(config, '$.boutique.domaine.domaine')) = ? AND json_extract(config, '$.boutique.domaine.actif') = 1").get(hote);
        if (b) {
          const racine = `https://${hote}/`;
          if (chemin === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(planDuSite(b, racine)); }
          if (chemin === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(`User-agent: *\nAllow: /\nAllow: /api/public/*/image/\nDisallow: /api/\nSitemap: ${racine}sitemap.xml\n`); }
          const pid = chemin.startsWith('/p/') ? decodeURIComponent(chemin.slice(3)) : null;
          return envoyerHtml(res, pid && !produitVisible(b, pid) ? 404 : 200, pageBoutique(b, { racine, produitId: pid, langue: url.searchParams.get('lang') }));
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
            if (b) return envoyerHtml(res, mBoutique[2] && !produitVisible(b, mBoutique[2]) ? 404 : 200, pageBoutique(b, { racine: domaineDe(b) ? `https://${domaineDe(b)}/` : `${urlPublique}/s/${b.slug}/`, produitId: mBoutique[2] || null, langue: url.searchParams.get('lang') }));
          }
          const mPlan = /^\/s\/([\w-]+)\/sitemap\.xml$/.exec(chemin);
          if (mPlan) { const b = db.prepare('SELECT * FROM boutiques WHERE slug = ?').get(mPlan[1]); if (b) { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(planDuSite(b, `${urlPublique}/s/${b.slug}/`)); } }
          if (chemin === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('User-agent: *\nAllow: /\nAllow: /s/\nDisallow: /app\nDisallow: /demo\nAllow: /api/public/*/image/\nDisallow: /api/\nDisallow: /paiement-simule/\nDisallow: /abonnement-simule/\n'); }
          if (FICHIERS_PUBLICS.test(chemin) && servirStatique(res, RACINE_FRONT, chemin.slice(1))) return;
        }
        throw erreur(404, 'Page introuvable.', 'introuvable');
      }
      const ctx = { req, res, params: route.params, query: url.searchParams, cookies: lireCookies(req), entetes: {}, ip: reseauIp(ipClient(req)), corps: {}, corpsBrut: '' };
      entetesRequete = ctx.entetes;   // cookie de session renouvelé : envoyé même avec une réponse d'erreur
      // HTTPS : seule la session « __Host- » compte ; un cookie de session sans préfixe (posé par un sous-domaine, en HTTP) est ignoré.
      if (securise) { const h = ctx.cookies[`__Host-${auth.COOKIE}`]; delete ctx.cookies[auth.COOKIE]; if (h) ctx.cookies[auth.COOKIE] = h; }
      // Requête qui modifie quelque chose, venue d'un autre site (même un sous-domaine voisin) : refusée, avec ou sans corps.
      // Le navigateur indique sa provenance (Sec-Fetch-Site, Origin) ; les webhooks et l'API par clé n'ont pas de navigateur.
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && chemin.startsWith('/api/') && !chemin.startsWith('/api/webhooks/') && !chemin.startsWith('/api/v1/')) {
        const provenance = req.headers['sec-fetch-site'], origine = req.headers.origin;
        let autreSite = !!provenance && !['same-origin', 'none'].includes(provenance);
        // Origine acceptée : l'hôte demandé (boutique sur son domaine) ou l'adresse publique configurée (proxy qui réécrit Host).
        if (!autreSite && origine) { try { const o = new URL(origine); autreSite = origine === 'null' || (o.host !== req.headers.host && o.origin !== originePublique); } catch { autreSite = true; } }
        if (autreSite) throw erreur(403, 'Requête venue d’un autre site : refusée.', 'autre_site');
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        ctx.corpsBrut = (await lireCorps(req, chemin === '/csp-rapport' ? 16 * 1024 : undefined)).toString('utf8');   // rapports CSP : petits, sans compte
        const type = req.headers['content-type'] || '';
        if (chemin.startsWith('/api/') && !chemin.startsWith('/api/webhooks/')) {
          // JSON obligatoire : un formulaire d'un autre site ne peut pas envoyer ce type sans CORS (protection CSRF).
          if (ctx.corpsBrut && !type.startsWith('application/json')) throw erreur(415, 'Envoyez du JSON.', 'type_contenu');
          ctx.corps = ctx.corpsBrut ? lireJsonSur(ctx.corpsBrut) : {};
          if (!ctx.corps || typeof ctx.corps !== 'object' || Array.isArray(ctx.corps)) throw erreur(400, 'Requête invalide : un objet JSON est attendu.', 'corps_invalide');
        } else if (type.startsWith('application/json') && ctx.corpsBrut) { const v = lireJsonSur(ctx.corpsBrut); ctx.corps = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
      }
      let resultat;
      await requeteCourante.run({ auteur: null }, async () => { for (const g of route.gestionnaires) resultat = await g(ctx); });
      if (resultat && resultat.diffusion) return;   // flux SSE : la réponse reste ouverte
      if (resultat && resultat.binaire) { res.writeHead(200, { 'Content-Type': resultat.type, 'Cache-Control': 'public, max-age=3600', ...ctx.entetes }); res.end(resultat.binaire); return; }
      if (resultat && resultat.redirection) { res.writeHead(303, { Location: resultat.redirection, ...ctx.entetes }); res.end(); return; }
      if (resultat && resultat.html) return envoyerHtml(res, 200, resultat.html, ctx.entetes);
      if (resultat && resultat.statut && 'corps' in resultat) return envoyerJson(res, resultat.statut, resultat.corps, ctx.entetes);
      envoyerJson(res, 200, resultat ?? { ok: true }, ctx.entetes);
    } catch (e) {
      if (e instanceof SyntaxError) e = erreur(400, 'JSON invalide.', 'json_invalide');
      if (!(e instanceof ErreurHttp)) { journal.error('[erreur]', e); e = erreur(500, 'Erreur interne. Réessayez dans un instant.', 'interne'); }
      if (res.headersSent) return res.end();
      // Seul le renouvellement de la session est gardé sur une erreur (pas d'autre en-tête préparé par la route).
      const sc = entetesRequete['Set-Cookie'];
      envoyerJson(res, e.statut, { erreur: e.message, code: e.code }, sc ? { 'Set-Cookie': sc } : {});
    }
  }
  gerer.enCours = 0;
  // Arrêt propre : les flux en direct (connexions sans fin) sont fermés ; le navigateur se reconnectera au nouveau serveur.
  gerer.fermerFlux = () => { for (const a of flux) { try { a.res.end(); } catch { /* déjà fermé */ } } flux.clear(); };
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
