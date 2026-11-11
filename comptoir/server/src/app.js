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
const { creerRouteur, lireCorps, lireCookies, envoyerJson, envoyerHtml, servirStatique, erreur, ErreurHttp, valider } = require('./http');
const auth = require('./auth');
const { transaction } = require('./db');
const prix = require('./prix');
const { choisirPrestataire } = require('./paiements');
const fournisseurs = require('./fournisseurs');
const social = require('./social');
const relances = require('./relances');
const Remises = require('../../js/remises.js');
const PrixBarres = require('../../js/prix-barres.js');
const courriel = require('./courriel');

const RACINE_FRONT = path.resolve(__dirname, '..', '..');
const FICHIERS_PUBLICS = /^\/(index\.html|boutique\.html|accueil\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js|img\/[\w.-]+\.(jpg|png|svg))$/;
const POLICES = ["'Fraunces', Georgia, serif", "'DM Serif Display', Georgia, serif", "'Syne', system-ui, sans-serif", "'Bricolage Grotesque', system-ui, sans-serif", "'Outfit', system-ui, sans-serif", "'IBM Plex Sans', system-ui, sans-serif"];
const COULEUR = /^#[0-9a-f]{6}$/i;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function creerApp({ db, env = {}, urlPublique, fetchImpl = fetch, journal = console }) {
  const r = creerRouteur();
  const securise = urlPublique.startsWith('https://');
  const paiement = choisirPrestataire(env, urlPublique);
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
    return proxiesConfiance.has(pair) && xff.length ? xff[xff.length - 1] : pair;
  };
  const vendable = p => p.actif && !p.aVerifier && (fournisseurDemoVendable || p.codeFournisseur !== 'demo');
  // Délai avant que le faux fournisseur expédie (2 min par défaut ; négatif = jamais, pour tester à la main).
  const delaiExpeditionDemo = env.DEMO_DELAI_EXPEDITION_MS === undefined ? 120000 : Number(env.DEMO_DELAI_EXPEDITION_MS);
  const secretsDemo = { cleApiDemo: crypto.randomBytes(24).toString('hex'), secretWebhookDemo: crypto.randomBytes(24).toString('hex') };
  fournisseurs.installerDemo(db, urlPublique, secretsDemo);
  relances.creerTables(db);
  courriel.creerTables(db);
  const serviceEmail = courriel.prestataire(env, fetchImpl);
  const hotePrincipal = new URL(urlPublique).hostname.toLowerCase();
  // Facteur des limites de débit publiques (1 en production ; plus élevé pour les tests et simulations depuis une seule adresse).
  const facteurLimites = Math.max(1, Number(env.LIMITES_FACTEUR) || 1);
  const abo = abonnements.creerGestion({ db, env, urlPublique, fetchImpl });
  const collecte = tendances.creerCollecte({ db, env, catalogue: fournisseurs.CATALOGUE_DEMO, fetchImpl, journal });
  const deviseDe = b => lireConfig(b).boutique.pays === 'ch' ? 'CHF' : 'EUR';

  /* ---------- Accès aux données ---------- */
  const lireConfig = b => JSON.parse(b.config);
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
  const listerProduits = (boutiqueId, avecSupprimes = false) =>
    db.prepare(`SELECT id, donnees FROM produits WHERE boutique_id = ? ${avecSupprimes ? '' : 'AND supprime = 0'} ORDER BY ordre, rowid`).all(boutiqueId)
      .map(p => ({ ...JSON.parse(p.donnees), id: p.id }));
  const lireCommande = row => row && ({ ...JSON.parse(row.donnees), id: row.id, numero: row.numero, date: row.date, statut: row.statut });
  const commandeDeBoutique = (boutiqueId, id) => {
    const c = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(id, boutiqueId));
    if (!c) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    return c;
  };
  const enregistrerCommande = c => {
    const { id, numero, date, statut, ...donnees } = c;
    db.prepare('UPDATE commandes SET statut = ?, donnees = ? WHERE id = ?').run(statut, JSON.stringify(donnees), id);
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
      if (sens < 0) { const retire = Math.min(l.qte, Math.max(0, d.stock || 0)); l.retireStock = retire; d.stock = (d.stock || 0) - retire; }
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
    return sig.length === attendu.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu)) ? { boutiqueId, email } : null;
  };
  // Appareil où le marchand s'est connecté : cookie signé, valable un an, qui ne contient que l'empreinte de l'e-mail.
  // Lié à l'empreinte du mot de passe actuel : un changement ou une réinitialisation du mot de passe révoque tous les appareils.
  const jetonAppareil = email => { const m = db.prepare('SELECT mot_de_passe FROM marchands WHERE lower(email) = ?').get(email); return crypto.createHmac('sha256', cleDesinscription).update(`appareil|${email}|${m ? m.mot_de_passe : ''}`).digest('base64url').slice(0, 32); };
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
  const lienCommande = (b, id) => { const row = db.prepare('SELECT jeton_client FROM commandes WHERE id = ?').get(id); return row ? `${urlBoutique(b)}?commande=${encodeURIComponent(id)}&jeton=${encodeURIComponent(row.jeton_client)}` : urlBoutique(b); };
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
  const lienTransporteur = (transporteur, suivi) => {
    const n = encodeURIComponent(String(suivi || '').replace(/\s/g, ''));
    if (/la poste|post/i.test(transporteur || '') && /^99\.|^\d{2}\.\d{2}/.test(suivi || '')) return `https://service.post.ch/ekp-web/ui/entry/shipping/0?formattedParcelCodes=${n}`;
    if (/colissimo|la poste/i.test(transporteur || '')) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
    if (/chronopost/i.test(transporteur || '')) return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
    if (/mondial/i.test(transporteur || '')) return `https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition=${n}`;
    if (/bpost/i.test(transporteur || '')) return `https://track.bpost.cloud/btr/web/#/search?itemCode=${n}&lang=fr`;
    return null;
  };
  const emailExpedition = (b, c, config) => {
    const lien = lienTransporteur(c.transporteur || (prix.modesLivraison(config)[c.livraison] || {}).transporteur, c.suivi);
    envoyerEmail(b.id, c.client.email, `Votre commande n° ${c.numero} est en route`,
      `Bonjour ${c.client.nom},\n\nVotre colis est parti${c.transporteur ? ` avec ${c.transporteur}` : ''}.\nNuméro de suivi : ${c.suivi}${lien ? `\nSuivre le colis : ${lien}` : ''}\n\nVotre commande : ${lienCommande(b, c.id)}\n\nMerci et à bientôt,\n${config.boutique.nom}`);
  };
  const envoyerEmail = (boutiqueId, destinataire, sujet, corps, { marketing = false } = {}) => {
    if (!destinataire) return;
    if (marketing && boutiqueId && estDesinscrit(boutiqueId, destinataire)) return;
    let pied = '', lien = null;
    const b = boutiqueId ? db.prepare('SELECT config FROM boutiques WHERE id = ?').get(boutiqueId) : null;
    if (b) {
      const conf = JSON.parse(b.config), e = conf.entreprise || {};
      const identite = [e.raison || conf.boutique.nom, e.adresse, e.email ? `Contact : ${e.email}` : ''].filter(Boolean).join(' · ');
      if (marketing) lien = `${urlPublique}/desinscription?j=${jetonDesinscription(boutiqueId, destinataire)}`;
      pied = `\n\n—\n${identite}${lien ? `\nVous recevez cet e-mail car vous avez accepté les nouvelles de ${conf.boutique.nom}. Pour ne plus les recevoir : ${lien}` : ''}`;
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
      reglages: { autoTransmission: config.reglages ? config.reglages.autoTransmission !== false : true, cpa: Number(config.reglages && config.reglages.cpa) || 8 },
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
    if (typeof p.image === 'string' && p.image) {
      if (!IMAGE.test(p.image) || p.image.length > 400000) throw erreur(400, 'Image invalide : JPEG, PNG ou WebP de moins de 300 Ko.', 'image_invalide');
      propre.image = p.image;
    }
    if (p.prixReference !== undefined && p.prixReference !== null && p.prixReference !== '' && Number(p.prixReference) > 0) propre.prixReference = valider.nombre(p.prixReference, 'Le prix barré', { min: 0, max: 100000 });
    // Historique des prix tenu par le serveur seul (sert à vérifier les prix barrés) : le navigateur ne peut pas le modifier.
    propre.historiquePrix = PrixBarres.noterPrix(historiqueAvant, propre.prix);
    if (type === 'drop') Object.assign(propre, { portF: Number(p.portF) || 0, entrepot: ['CH', 'UE', 'CN'].includes(p.entrepot) ? p.entrepot : 'UE', delai: Array.isArray(p.delai) ? p.delai.slice(0, 2).map(Number) : [3, 7], fournisseur: String(p.fournisseur || '').slice(0, 80), source: String(p.source || '').slice(0, 40), codeFournisseur: p.codeFournisseur || 'demo' });
    return propre;
  }
  /* Ajoute un produit du catalogue fournisseur à une boutique (une seule fois par produit source). */
  function importerProduit(boutiqueId, src, codeFournisseur) {
    const deja = listerProduits(boutiqueId).find(p => p.source === src.id);
    if (deja) return { id: deja.id, deja: true };
    const id = auth.nouvelId('p_');
    const produit = nettoyerProduit({ ...src, type: 'drop', actif: true, tauxReduit: src.niche === 'epicerie', teinte: (src.id.charCodeAt(2) * 47) % 360, source: src.id, codeFournisseur, description: src.description || `${src.nom}. Expédié par notre partenaire, livré en ${src.delai[0]} à ${src.delai[1]} jours.` });
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, (SELECT COALESCE(MAX(ordre), 0) + 1 FROM produits WHERE boutique_id = ?))').run(id, boutiqueId, JSON.stringify(produit), boutiqueId);
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
      db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, ?)').run(auth.nouvelId('p_'), boutiqueId, JSON.stringify(nettoyerProduit(p)), i);
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
      referenceMarchand: `${boutique.slug}-${c.numero}`,
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
      const c = lireCommande(row);
      c.statut = 'payee';
      c.facture = prochaineFacture(row.boutique_id, Date.now()); c.dateFacture = Date.now();
      if (c.relances) { c.recuperee = true; c.historique.push({ date: Date.now(), texte: 'Paiement récupéré après relance' }); }
      if (c.parent) {
        const pr = db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.parent);
        if (pr) { const parent = lireCommande(pr); parent.complements = [...(parent.complements || []), c.id]; historique(parent, `Complément n° ${c.numero} ajouté après l’achat : à expédier dans le même colis`); enregistrerCommande(parent); }
      }
      historique(c, `Paiement ${p.fournisseur === 'stripe' ? 'en ligne' : 'simulé'} accepté (${formatMontant(p.montant_centimes / 100, lireConfig(db.prepare('SELECT config FROM boutiques WHERE id = ?').get(row.boutique_id)))})`);
      // Stock : la vente est faite (le client a payé), mais une rupture est signalée au lieu d'être cachée.
      const prods = listerProduits(row.boutique_id);
      const manques = c.lignes.filter(l => l.type !== 'drop').map(l => ({ l, p: prods.find(x => x.id === l.produitId) })).filter(x => x.p && x.p.type !== 'drop' && x.p.stock < c.lignes.filter(y => y.produitId === x.l.produitId).reduce((a, y) => a + y.qte, 0));
      if (manques.length) { c.alerteStock = true; historique(c, `Rupture de stock au paiement : ${[...new Set(manques.map(x => x.p.nom))].join(', ')}. Réapprovisionnez ou remboursez.`); }
      ajusterStock(row.boutique_id, c.lignes, -1);
      enregistrerCommande(c);
      return { c, boutique: db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id) };
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
    const config = lireConfig(res.boutique);
    envoyerEmail(res.boutique.id, res.c.client.email, `Commande n° ${res.c.numero} confirmée`,
      `Bonjour ${res.c.client.nom},\n\nMerci pour votre commande chez ${config.boutique.nom}.\n\n${recapitulatif(res.c, config)}\n\n${res.c.livraison === 'retrait' ? 'Nous vous écrivons dès que la commande est prête à retirer.' : 'Nous vous écrivons dès l’expédition, avec le numéro de suivi.'}\nSuivre votre commande : ${lienCommande(res.boutique, res.c.id)}\n\nUne question ? Répondez à cet e-mail${config.entreprise && config.entreprise.email ? ` ou écrivez à ${config.entreprise.email}` : ''}.${infoRetractation(res.boutique, res.c, config)}`);
    // Le marchand est prévenu de chaque commande payée (sans e-mail, une commande à expédier pourrait rester oubliée).
    {
      const mch = db.prepare('SELECT email FROM marchands WHERE id = ?').get(res.boutique.marchand_id);
      const drop = res.c.lignes.every(l => l.type === 'drop'), auto = config.reglages.autoTransmission;
      const quoiFaire = res.c.alerteStock ? 'Attention : rupture de stock pour cette commande. Réapprovisionnez, ou remboursez le client depuis Commandes.' : res.c.parent ? `Complément de la commande n° ${(lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(res.c.parent)) || {}).numero || ''} : à joindre au même colis.` : res.c.livraison === 'retrait' ? 'À préparer pour un retrait en magasin.' : drop && auto ? 'Rien à faire : la commande part automatiquement chez le fournisseur.' : drop ? 'À transmettre au fournisseur depuis Commandes.' : 'À préparer et expédier.';
      // Produits en stock tombés à zéro avec cette vente : ils s'affichent « Épuisé » ; le marchand doit le savoir.
      // Une seule alerte, au passage à zéro : le stock d'avant cette vente était positif (pas de doublon à chaque vente suivante).
      const vendus = {}; for (const l of res.c.lignes) if (l.type !== 'drop') vendus[l.produitId] = (vendus[l.produitId] || 0) + l.qte;
      const epuises = res.c.alerteStock ? [] : listerProduits(res.boutique.id).filter(p => vendus[p.id] && p.type !== 'drop' && p.stock <= 0 && p.stock + vendus[p.id] > 0);   // en rupture, l'e-mail de commande le dit déjà
      if (mch && epuises.length) envoyerEmail(null, mch.email, `Stock épuisé : ${epuises.map(p => p.nom).join(', ').slice(0, 120)}`, `Bonjour,\n\nAprès la commande n° ${res.c.numero}, ces produits n'ont plus de stock et s'affichent « Épuisé » dans votre boutique :\n${epuises.map(p => `- ${p.nom}`).join('\n')}\n\nRéassort : ${urlPublique}/app#produits`);
      if (mch) envoyerEmail(null, mch.email, `${res.c.parent ? 'Complément de commande' : 'Nouvelle commande'} n° ${res.c.numero} : ${formatMontant(res.c.total, config)}`,
        `Bonjour,\n\nNouvelle commande payée sur ${config.boutique.nom}.\n\n${recapitulatif(res.c, config)}\n\n${res.c.livraison !== 'retrait' && res.c.client.ville ? `Livraison : ${res.c.client.ville}\n` : ''}${quoiFaire}\n\nVoir la commande : ${urlPublique}/app#commandes`);
    }
    if (config.reglages.autoTransmission && res.c.lignes.some(l => l.type === 'drop')) {
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

  /* ---------- Garde d'authentification ---------- */
  // Compte connecté (sans exiger l'abonnement) : paiement de l'abonnement, suppression du compte.
  const exigerCompte = ctx => {
    ctx.marchand = auth.marchandDepuisRequete(db, ctx.cookies);
    if (!ctx.marchand) throw erreur(401, 'Connectez-vous pour continuer.', 'non_connecte');
    ctx.boutique = boutiqueDuMarchand(ctx.marchand.id);
  };
  // Espace marchand : uniquement sa propre boutique (boutique_id du compte), et seulement si l'abonnement est payé.
  const exigerMarchand = ctx => {
    exigerCompte(ctx);
    if (!abo.etat(ctx.marchand.id).actif) throw erreur(402, 'Choisissez une formule et réglez votre abonnement pour accéder à votre boutique.', 'abonnement_requis');
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
    const b = m && db.prepare('SELECT slug FROM boutiques WHERE marchand_id = ?').get(m.id);
    return { connecte: !!m, email: m ? m.email : null, slug: b ? b.slug : null, paiement: paiement.nom, fournisseurDemoVendable, socialSimule, hebergeur: env.HEBERGEUR || null, emails: serviceEmail ? serviceEmail.nom : null, abonnement: m ? abo.etat(m.id) : null };
  });
  r.post('/api/auth/inscription', ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const email = valider.email(ctx.corps.email);
    const mdp = valider.texte(ctx.corps.motDePasse, 'Le mot de passe', { min: 10, max: 200 });
    const config = nettoyerConfig(ctx.corps.config);
    if (db.prepare('SELECT 1 FROM marchands WHERE email = ?').get(email)) throw erreur(409, 'Un compte existe déjà avec cet e-mail. Connectez-vous.', 'email_pris');
    const marchandId = auth.nouvelId('m_');
    const boutiqueId = auth.nouvelId('b_');
    const slug = slugUnique(config.boutique.nom);
    transaction(db, () => {
      db.prepare('INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES (?, ?, ?, ?)').run(marchandId, email, auth.hacherMotDePasse(mdp), Date.now());
      db.prepare('INSERT INTO boutiques (id, marchand_id, slug, config, cree_le) VALUES (?, ?, ?, ?, ?)').run(boutiqueId, marchandId, slug, JSON.stringify(config), Date.now());
      insererProduits(boutiqueId, ctx.corps.produits);
      // Produits fournisseurs choisis à l'inscription (préparés avant même le paiement de l'abonnement).
      const sources = Array.isArray(ctx.corps.importer) ? ctx.corps.importer.slice(0, 12).map(String) : [];
      for (const src of fournisseurs.CATALOGUE_DEMO.filter(x => sources.includes(x.id))) importerProduit(boutiqueId, src, 'demo');
    });
    ctx.entetes['Set-Cookie'] = [auth.cookieSession(auth.creerSession(db, marchandId), securise), cookieAppareil(email.toLowerCase())];
    return { statut: 201, corps: { ok: true, slug } };
  });
  r.post('/api/auth/connexion', ctx => {
    const email = valider.email(ctx.corps.email);
    // Limites par adresse, et par compte depuis cette adresse : un tiers ne peut pas verrouiller le compte d'un marchand
    // depuis d'autres adresses. Le compte seul n'est bloqué qu'à un seuil très élevé (attaque distribuée massive).
    const max = Number(env.LIMITE_ESSAIS) || 10, e = email.toLowerCase(), reseau = reseauIp(ctx.ip);
    const parIp = ['ip:' + reseau, `compte-ip:${e}|${reseau}`];
    auth.verifierEchecs(parIp, max);
    // Seuil global du compte (attaque répartie sur beaucoup d'adresses) : il ne s'applique jamais à un appareil où
    // le marchand s'est déjà connecté (cookie signé), donc personne ne peut l'empêcher de se connecter de chez lui.
    const appareilConnu = String(ctx.cookies.comptoir_appareil || '') === jetonAppareil(e);
    if (!appareilConnu) auth.verifierEchecs(['compte:' + e], max * 20);
    const m = db.prepare('SELECT * FROM marchands WHERE email = ?').get(email);
    if (!m || !auth.verifierMotDePasse(String(ctx.corps.motDePasse || ''), m.mot_de_passe)) { auth.noterEchec([...parIp, 'compte:' + e]); throw erreur(401, 'E-mail ou mot de passe incorrect.', 'identifiants'); }
    auth.oublierEchecs([`compte-ip:${e}|${reseau}`]);
    ctx.entetes['Set-Cookie'] = [auth.cookieSession(auth.creerSession(db, m.id), securise), cookieAppareil(e)];
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
  r.post('/api/auth/reinitialiser', ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const mdp = valider.texte(ctx.corps.motDePasse, 'Le mot de passe', { min: 10, max: 200 });
    const ligne = db.prepare('SELECT * FROM reinitialisations WHERE jeton_hash = ?').get(auth.sha256(String(ctx.corps.jeton || '')));
    if (!ligne || ligne.expire_le < Date.now()) throw erreur(400, 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.', 'lien_expire');
    transaction(db, () => {
      db.prepare('UPDATE marchands SET mot_de_passe = ? WHERE id = ?').run(auth.hacherMotDePasse(mdp), ligne.marchand_id);
      db.prepare('DELETE FROM sessions WHERE marchand_id = ?').run(ligne.marchand_id);
      db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(ligne.marchand_id);
    });
    { const mr = db.prepare('SELECT email FROM marchands WHERE id = ?').get(ligne.marchand_id); ctx.entetes['Set-Cookie'] = [auth.cookieSession(auth.creerSession(db, ligne.marchand_id), securise), cookieAppareil(String(mr.email).toLowerCase())]; }
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
  r.post('/api/admin/compte/mot-de-passe', exigerCompte, ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    const cles = ['mdp:' + m.id];   // clé propre : une attaque sur la page de connexion ne bloque pas un marchand déjà connecté
    auth.verifierEchecs(cles, Number(env.LIMITE_ESSAIS) || 10);
    if (!auth.verifierMotDePasse(String(ctx.corps.actuel || ''), m.mot_de_passe)) { auth.noterEchec(cles); throw erreur(401, 'Mot de passe actuel incorrect.', 'identifiants'); }
    const nouveau = valider.texte(ctx.corps.nouveau, 'Le nouveau mot de passe', { min: 10, max: 200 });
    const actuelle = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    transaction(db, () => {
      db.prepare('UPDATE marchands SET mot_de_passe = ? WHERE id = ?').run(auth.hacherMotDePasse(nouveau), m.id);
      db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(m.id, actuelle);
      db.prepare('DELETE FROM reinitialisations WHERE marchand_id = ?').run(m.id);
    });
    ctx.entetes['Set-Cookie'] = cookieAppareil(String(m.email).toLowerCase());   // cet appareil reste reconnu ; les autres ne le sont plus
    return { ok: true };
  });
  r.post('/api/admin/compte/deconnecter-autres', exigerCompte, ctx => {
    const actuelle = auth.sha256(String(ctx.cookies[auth.COOKIE] || ''));
    return { ok: true, n: db.prepare('DELETE FROM sessions WHERE marchand_id = ? AND jeton_hash <> ?').run(ctx.marchand.id, actuelle).changes };
  });
  r.post('/api/admin/compte/supprimer', exigerCompte, async ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    if (!auth.verifierMotDePasse(String(ctx.corps.motDePasse || ''), m.mot_de_passe)) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    await abo.arreterDefinitivement(m.id);   // sinon Stripe continuerait de prélever un compte supprimé
    transaction(db, () => {
      for (const b of db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').all(m.id)) {
        for (const t of ['publications', 'evenements', 'avis', 'abonnes', 'envois_auto', 'emails']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(b.id);
      }
      db.prepare('DELETE FROM emails WHERE boutique_id IS NULL AND lower(destinataire) = ?').run(String(m.email).toLowerCase());   // seulement les e-mails de compte, pas ceux reçus comme client d'autres boutiques   // e-mails de compte (réinitialisation, abonnement)
      db.prepare('DELETE FROM marchands WHERE id = ?').run(m.id); // boutiques, produits, commandes, sessions : suppression en cascade
    });
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
    return { version: 2, ...config, desinscrits, produits: listerProduits(ctx.boutique.id), commandes, publications, abonnes, envois, avis, audience, offresVues, visites30j: 0, compteurFacture: ctx.boutique.compteur_facture, serveur: { slug: ctx.boutique.slug, email: ctx.marchand.email, paiement: paiement.nom, emails: serviceEmail ? serviceEmail.nom : null, creeLe: ctx.boutique.cree_le , abonnement: abo.etat(ctx.marchand.id), jetonDomaine: jetonDomaine(ctx.boutique.id), urlBoutique: urlBoutique(ctx.boutique) } };
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
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, ?)').run(id, ctx.boutique.id, JSON.stringify(nettoyerProduit(ctx.corps.produit || {})), ordre);
    return { statut: 201, corps: { id } };
  });
  r.put('/api/admin/produits/:id', exigerMarchand, ctx => {
    const ancien = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ? AND supprime = 0').get(ctx.params.id, ctx.boutique.id);
    if (!ancien) throw erreur(404, 'Produit introuvable.', 'produit_introuvable');
    const avant = JSON.parse(ancien.donnees);
    // Les données fournisseur ne se modifient pas depuis l'interface.
    const fusion = { ...ctx.corps.produit, type: avant.type, source: avant.source, fournisseur: avant.fournisseur, entrepot: avant.entrepot, delai: avant.delai, portF: avant.portF, codeFournisseur: avant.codeFournisseur };
    db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(JSON.stringify(nettoyerProduit(fusion, avant.historiquePrix || [])), ctx.params.id);
    return { ok: true };
  });
  r.delete('/api/admin/produits/:id', exigerMarchand, ctx => {
    const res = db.prepare('UPDATE produits SET supprime = 1 WHERE id = ? AND boutique_id = ?').run(ctx.params.id, ctx.boutique.id);
    if (!res.changes) throw erreur(404, 'Produit introuvable.', 'produit_introuvable');
    return { ok: true };
  });
  r.get('/api/admin/catalogue', exigerMarchand, async () => {
    const f = db.prepare("SELECT * FROM fournisseurs WHERE code = 'demo'").get();
    return { fournisseur: f.nom, produits: await fournisseurs.client(f, fetchImpl).catalogue() };
  });
  r.post('/api/admin/produits/import', exigerMarchand, async ctx => {
    const f = db.prepare("SELECT * FROM fournisseurs WHERE code = 'demo'").get();
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
    if (cible === 'expediee' && !c.suivi) c.suivi = '99.00.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7);
    if (cible === 'payee' && !c.facture) { c.facture = prochaineFacture(ctx.boutique.id, Date.now()); c.dateFacture = Date.now(); }
    // Une facture émise ne s'efface pas : le remboursement produit un avoir numéroté qui la référence.
    if (cible === 'remboursee' && c.facture && !c.avoir) c.avoir = { numero: prochaineFacture(ctx.boutique.id, Date.now(), 'AV'), date: Date.now(), montant: c.total };
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
    historique(c, textes[cible] + (cible === 'expediee' ? `, suivi ${c.suivi}` : ''));
    enregistrerCommande(c);
    if (cible === 'expediee') emailExpedition(ctx.boutique, c, config);
    if (cible === 'prete') envoyerEmail(ctx.boutique.id, c.client.email, `Votre commande n° ${c.numero} est prête`, `Bonjour ${c.client.nom},\n\nVotre commande vous attend en boutique : ${config.magasin.adresse || ''}${config.magasin.horaires ? `\nHoraires : ${config.magasin.horaires}` : ''}.\nPrésentez ce numéro de commande : ${c.numero}.\n\nVotre commande : ${lienCommande(ctx.boutique, c.id)}\n\n${config.boutique.nom}`);
    return { commande: c };
  });
  // Idempotence de la caisse : une même clé de ticket n'enregistre qu'une vente (double clic, renvoi après coupure).
  const ticketsVus = new Map();
  r.post('/api/admin/caisse', exigerFonction('magasin'), ctx => {
    const cleTicket = typeof ctx.corps.cle === 'string' ? `${ctx.boutique.id}:${ctx.corps.cle.slice(0, 60)}` : null;
    if (cleTicket && ticketsVus.has(cleTicket)) return ticketsVus.get(cleTicket);
    for (const [k, v] of ticketsVus) if (Date.now() - v.le > 3600000) ticketsVus.delete(k);
    const reponse = encaisserCaisse(ctx);
    if (cleTicket) ticketsVus.set(cleTicket, { ...reponse, le: Date.now() });
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
    const dues = db.prepare("SELECT p.*, b.config FROM publications p JOIN boutiques b ON b.id = p.boutique_id WHERE p.statut = 'programmee' AND p.date <= ? LIMIT 200").all(maintenant);
    let n = 0;
    for (const row of dues) {
      const config = JSON.parse(row.config);
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
      // Clés exactes (« bienvenue:<email> », « reconquete:<email>:<commande> ») : pas de LIKE, dont « _ » et « % » sont des jokers.
      for (const { cle } of db.prepare('SELECT cle FROM envois_auto WHERE boutique_id = ?').all(ctx.boutique.id)) {
        const parts = String(cle).split(':');
        if (parts.length >= 2 && parts[1].toLowerCase() === email) db.prepare('DELETE FROM envois_auto WHERE boutique_id = ? AND cle = ?').run(ctx.boutique.id, cle);
      }
    });
    // La liste de désinscription garde l'adresse : elle sert justement à ne plus lui écrire.
    return { ok: true, commandes: commandes.length };
  });
  r.get('/api/admin/emails', exigerMarchand, ctx => db.prepare('SELECT destinataire, sujet, corps, cree_le FROM emails WHERE boutique_id = ? ORDER BY id DESC LIMIT 50').all(ctx.boutique.id));

  /* ---------- Boutique publique ---------- */
  r.get('/api/public/:slug', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const config = lireConfig(b);
    const notes = statsAvis(b.id);
    const regime = config.boutique.pays === 'ch' ? 'ch' : 'ue';
    const produits = listerProduits(b.id).filter(vendable).map(({ cout, portF, codeFournisseur, fournisseur, source, aVerifier, historiquePrix, prixReference, ...p }) => {
      const pb = PrixBarres.verifier({ prix: p.prix, prixReference, historiquePrix }, regime);
      return { ...p, avis: notes[p.id] || null, ...(pb.ok ? { prixBarre: prixReference } : {}) };
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
      hebergeur: env.HEBERGEUR || null   // identité de l'hébergeur (obligatoire dans les mentions légales en France)
    };
  });
  r.post('/api/public/:slug/commandes', async ctx => {
    auth.limiter('commande:' + ctx.ip, (Number(env.LIMITE_COMMANDES) || 30) * facteurLimites, 15 * 60000, 'Trop de commandes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueOuverte(ctx.params.slug);
    const config = lireConfig(b);
    // Vendre à distance sans adresse du vendeur est interdit (CH : LCD art. 3 s ; FR : LCEN art. 6 ; BE : CDE art. VI.45).
    if (!String((config.entreprise || {}).adresse || '').trim()) throw erreur(409, 'Cette boutique termine la saisie de ses informations légales : les commandes ouvrent très bientôt.', 'boutique_incomplete');
    const produits = listerProduits(b.id).filter(vendable);   // produit masqué ou du fournisseur de démonstration : « plus disponible »
    const lignesBrutes = prix.construireLignes(produits, ctx.corps.lignes).map(l => ({ ...l, codeFournisseur: (produits.find(p => p.id === l.produitId) || {}).codeFournisseur }));
    const modes = prix.modesLivraison(config);
    const mode = modes[ctx.corps.livraison];
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
    const devise = config.boutique.devise || 'EUR';
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', client, lignes, sousTotal, remise, motifRemise: calcul.motif ? calcul.motif.libelle : null, port, total, tauxTva: prix.tauxTva(config), livraison: ctx.corps.livraison, canal: 'web', suivi: '', note: '', historique: [{ date: now, texte: 'Commande passée en ligne, paiement en attente' + (remise ? ` (remise : ${calcul.motif.libelle})` : '') }] };
      prix.figerTaux(c, config);   // taux de TVA figé par ligne (taux réduit des denrées alimentaires)
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, b.id, n, date, statut, jeton, JSON.stringify(donnees));
      const p = { id: auth.nouvelId('pay_'), commande_id: c.id };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.id, c.id, paiement.nom, Math.round(total * 100), devise, 'cree', now);
      return { commande: { ...c, jeton }, pmt: p };
    });
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    const session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1` });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { statut: 201, corps: { commandeId: commande.id, numero: commande.numero, jeton: commande.jeton, total, paiementUrl: session.url } };
  });
  /* Avis vérifiés : seul un client ayant reçu sa commande peut noter, une fois par produit. */
  const statsAvis = boutiqueId => Object.fromEntries(db.prepare('SELECT produit_id, AVG(note) AS m, COUNT(*) AS n FROM avis WHERE boutique_id = ? GROUP BY produit_id').all(boutiqueId).map(x => [x.produit_id, { moyenne: x.m, n: x.n }]));
  r.post('/api/public/:slug/avis', ctx => {
    auth.limiter('avis:' + ctx.ip, 20 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(String(ctx.corps.commandeId || ''), b.id);
    const jeton = String(ctx.corps.jeton || '');
    if (!row || jeton.length !== row.jeton_client.length || !crypto.timingSafeEqual(Buffer.from(jeton), Buffer.from(row.jeton_client))) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
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
    if (!row || jeton.length !== row.jeton_client.length || !crypto.timingSafeEqual(Buffer.from(jeton), Buffer.from(row.jeton_client))) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
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
    const config = lireConfig(b);
    const r = Remises.regleApplicable(config, c.lignes, 'apres');
    if (!r) return null;
    const p = listerProduits(b.id).find(x => x.id === r.alors && vendable(x) && (x.type === 'drop' || x.stock > 0));
    return p ? { regle: r.id, produitId: p.id, nom: p.nom, prix: p.prix, prixOffre: prix.arrondi(p.prix * (1 - r.remise / 100)), remise: r.remise, teinte: p.teinte, image: p.image || null } : null;
  }
  const verifierJeton = (row, jeton) => row && String(jeton || '').length === row.jeton_client.length && crypto.timingSafeEqual(Buffer.from(String(jeton)), Buffer.from(row.jeton_client));
  r.post('/api/public/:slug/commandes/:id/complement', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!verifierJeton(row, ctx.corps.jeton)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const parent = lireCommande(row);
    const dejaLa = db.prepare("SELECT 1 FROM commandes WHERE boutique_id = ? AND statut NOT IN ('annulee') AND json_extract(donnees, '$.parent') = ?").get(b.id, parent.id);
    if (dejaLa) throw erreur(409, 'Le complément a déjà été ajouté à cette commande.', 'complement_existant');
    const o = offreApres(b, parent);
    if (!o || o.regle !== ctx.corps.regle) throw erreur(409, 'Cette offre n’est plus disponible.', 'offre_expiree');
    const config = lireConfig(b);
    const p = listerProduits(b.id).find(x => x.id === o.produitId);
    if (!p || !vendable(p)) throw erreur(409, 'Cette offre n’est plus disponible.', 'offre_expiree');
    const devise = config.boutique.devise || 'EUR';
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
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(pp.id, c.id, paiement.nom, Math.round(c.total * 100), devise, 'cree', now);
      return { commande: { ...c, jeton }, pmt: pp };
    });
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    const session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${urlBoutique(b)}?commande=${parent.id}&jeton=${row.jeton_client}` });
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
    if (n < 300) db.prepare('INSERT INTO evenements (boutique_id, type, session, produit_id, valeur, date) VALUES (?, ?, ?, ?, ?, ?)').run(b.id, type, session, String(ctx.corps.produitId || '').slice(0, 40) || null, String(ctx.corps.valeur || '').slice(0, 40) || null, Date.now());
    return { ok: true };
  });

  r.post('/api/public/:slug/code', ctx => {
    auth.limiter('code:' + ctx.ip, 40 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const saisi = String(ctx.corps.code || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = Remises.codesValables(lireConfig(b)).find(x => x.code === saisi);
    if (!c) throw erreur(404, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    // Le code de bienvenue ne vaut que pour une première commande : on le dit dès sa saisie (contrôlé au paiement avec l'e-mail).
    const bv = ((lireConfig(b).automatisations || {}).bienvenue || {});
    return { code: c.code, remise: c.remise, ...(bv.code && String(bv.code).toUpperCase() === c.code ? { condition: 'Valable sur une première commande.' } : {}) };
  });
  r.post('/api/public/:slug/newsletter', ctx => {
    auth.limiter('newsletter:' + ctx.ip, 20 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const email = valider.email(ctx.corps.email);
    if (estDesinscrit(b.id, email)) {
      // Adresse désinscrite : n'importe qui pourrait la réinscrire ; seul un clic dans l'e-mail envoyé à cette adresse le fait.
      const lien = `${urlPublique}/reinscription?j=${jetonDesinscription(b.id, email)}`;
      envoyerEmail(b.id, email, `Confirmez votre inscription chez ${lireConfig(b).boutique.nom}`, `Bonjour,\n\nVous vous étiez désinscrit des nouvelles de ${lireConfig(b).boutique.nom}. Pour vous réinscrire, confirmez ici :\n${lien}\n\nSi ce n'est pas vous, ignorez cet e-mail : rien ne changera.`);
      return { ok: true, confirmation: true };
    }
    db.prepare('INSERT OR IGNORE INTO abonnes (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(b.id, email, Date.now());
    relances.emailBienvenue({ db, boutique: b, config: lireConfig(b), email, urlPublique, urlBoutique: urlBoutique(b), envoyerEmail });
    return { ok: true };
  });
  r.post('/api/public/:slug/commandes/:id/reprendre', async ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    const jeton = String(ctx.corps.jeton || '');
    if (!row || jeton.length !== row.jeton_client.length || !crypto.timingSafeEqual(Buffer.from(jeton), Buffer.from(row.jeton_client))) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    if (row.statut !== 'attente') throw erreur(409, 'Cette commande est déjà payée ou annulée.', 'deja_traitee');
    const c = lireCommande(row);
    const devise = lireConfig(b).boutique.devise || 'EUR';
    for (const ancien of db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'cree'").all(c.id)) {
      db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(ancien.id);
      if (ancien.fournisseur === 'stripe' && paiement.expirer) await paiement.expirer(ancien).catch(e => journal.error('[paiement] expiration', e.message));
    }
    const pmt = { id: auth.nouvelId('pay_'), commande_id: c.id };
    db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(pmt.id, c.id, paiement.nom, Math.round(c.total * 100), devise, 'cree', Date.now());
    const retour = `${urlBoutique(b)}?commande=${c.id}&jeton=${row.jeton_client}`;
    const session = await paiement.creerSession({ pays: lireConfig(b).boutique.pays, paiement: pmt, commande: c, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1` });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { paiementUrl: session.url };
  });

  /* E-mails automatiques de toutes les boutiques (appelé régulièrement). */
  function automatisationsEcheances(maintenant = Date.now()) {
    let n = 0;
    for (const b of db.prepare('SELECT * FROM boutiques').all()) {
      const commandes = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND date > ?').all(b.id, maintenant - 400 * 86400000).map(row => ({ ...lireCommande(row), jeton: row.jeton_client }));
      n += relances.executer({ db, boutique: b, config: lireConfig(b), commandes, maintenant, urlPublique, urlBoutique: urlBoutique(b), envoyerEmail, formatMontant,
        enregistrerCommande: c => { const { jeton, ...reste } = c; enregistrerCommande(reste); } });
    }
    return n;
  }

  r.get('/api/public/:slug/commandes/:id', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    const jeton = String(ctx.query.get('jeton') || '');
    if (!row || jeton.length !== row.jeton_client.length || !crypto.timingSafeEqual(Buffer.from(jeton), Buffer.from(row.jeton_client))) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const c = lireCommande(row);
    return { numero: c.numero, statut: c.statut, total: c.total, port: c.port || 0, livraison: c.livraison, date: c.date, prenom: String((c.client && c.client.nom) || '').split(' ')[0], ville: (c.client && c.client.ville) || '', suivi: c.suivi || null, lignes: c.lignes.map(l => ({ produitId: l.produitId, nom: l.nom, qte: l.qte, prix: l.prix })), offreApres: offreApres(b, c) };
  });

  /* ---------- Webhooks ---------- */
  r.post('/api/webhooks/stripe', async ctx => {
    if (paiement.nom !== 'stripe' || !paiement.verifierWebhook(ctx.corpsBrut, ctx.req.headers['stripe-signature'])) throw erreur(400, 'Signature invalide.', 'signature');
    const ev = JSON.parse(ctx.corpsBrut);
    const evAbo = abo.evenementStripe(ev);
    if (evAbo) { if (evAbo.marchandId) emailAbonnement(evAbo.marchandId, evAbo.evenement); return { recu: true }; }
    const objet = (ev.data && ev.data.object) || {};
    if (((ev.type === 'checkout.session.completed' && objet.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded') && objet.metadata && objet.metadata.paiement_id) {
      await paiementConfirme(ev.data.object.metadata.paiement_id, ev.data.object.id);
    }
    return { recu: true };
  });
  r.post('/api/webhooks/fournisseurs/:code', ctx => {
    const f = db.prepare('SELECT * FROM fournisseurs WHERE code = ?').get(ctx.params.code);
    if (!f || !fournisseurs.verifierSignature(ctx.corpsBrut, ctx.req.headers['x-signature'], f.secret_webhook)) throw erreur(401, 'Signature invalide.', 'signature');
    const ev = JSON.parse(ctx.corpsBrut);
    const row = db.prepare("SELECT * FROM commandes WHERE json_extract(donnees, '$.refFournisseur') = ?").get(String(ev.ref));
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
      envoyerEmail(bq.id, c.client.email, `Une partie de votre commande n° ${c.numero} est en route`, `Bonjour ${c.client.nom},\n\nCes articles sont partis${c.transporteurFournisseur ? ` avec ${c.transporteurFournisseur}` : ''} :\n${parties}\nNuméro de suivi : ${c.suiviFournisseur}\n\nLe reste de votre commande suit séparément ; nous vous écrirons à son expédition.\n\nVotre commande : ${lienCommande(bq, c.id)}\n\n${conf.boutique.nom}`);
    }
    return { recu: true };
  });

  /* ---------- Paiement simulé (page de test, désactivée en production) ---------- */
  const pageSimulation = (p, c, config) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paiement (simulation)</title>
    <style>body{font:16px/1.5 system-ui,sans-serif;background:#F3F4F7;color:#151821;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:1px solid #E0E3EA;border-radius:12px;padding:28px;max-width:420px;width:100%;display:grid;gap:14px}h1{font-size:1.3rem;margin:0}.total{font-size:1.8rem;font-weight:700}button{font:inherit;font-weight:600;padding:12px;border-radius:8px;border:1px solid #151821;width:100%;cursor:pointer}.payer{background:#151821;color:#fff}.annuler{background:#fff}.note{color:#5B6372;font-size:.85rem}</style></head>
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
  r.get('/api/admin/signature', exigerMarchand, ctx => {
    const c = db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(date), 0) AS derniere FROM commandes WHERE boutique_id = ?").get(ctx.boutique.id);
    const a = db.prepare('SELECT COUNT(*) AS n FROM avis WHERE boutique_id = ?').get(ctx.boutique.id);
    const statuts = db.prepare('SELECT statut, COUNT(*) AS n FROM commandes WHERE boutique_id = ? GROUP BY statut').all(ctx.boutique.id).map(x => x.statut + x.n).join(',');
    return { commandes: c.n, derniere: c.derniere, statuts, avis: a.n };
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
    const config = lireConfig(b);
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
    return fs.readFileSync(path.join(RACINE_FRONT, 'boutique.html'), 'utf8').replace(/<title>[^<]*<\/title>/, '').replace('<head>', `<head>\n${tete}`).replace('<div id="app"></div>', `<div id="app"></div>${sansJs}`);
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
    const m = p && /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(p.image);
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
      ['Durée et droits', 'Les données sont conservées tant que le compte existe, puis supprimées, sauf les pièces comptables (10 ans en Suisse). Vous pouvez demander l’accès, la rectification ou l’effacement de vos données par e-mail. Un compte peut être supprimé à tout moment depuis ses paramètres.']
    ]) };
  });
  r.get('/conditions', () => ({ html: pageLegale('Conditions d’utilisation', [
    ['Service', 'Comptoir fournit un logiciel pour créer et gérer une boutique en ligne. Le marchand vend en son nom : il est responsable de ses produits, de ses prix, de ses textes et du respect du droit applicable à ses ventes.'],
    ['Abonnement', `Formules ${['lancement', 'croissance', 'pro'].map(f => `${escHtml(Formules.FORMULES[f].nom)} (CHF ${Formules.FORMULES[f].prix}.– ou ${Formules.FORMULES[f].prix} € par mois)`).join(', ')}, payées par mois et par carte. Aucune commission sur les ventes ; seuls les frais du prestataire de paiement s’appliquent.`],
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
  r.get('/reinscription', ctx => {
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) return { html: pageSimple('Lien invalide', 'Ce lien est incomplet ou a été modifié.') };
    return { html: pageSimple('Recevoir à nouveau les nouvelles', `Confirmez pour ${d.email}.`, `<form method="post" action="/reinscription?j=${encodeURIComponent(ctx.query.get('j'))}"><button>Me réinscrire</button></form>`) };
  });
  r.post('/reinscription', ctx => {
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) throw erreur(400, 'Lien invalide.', 'invalide');
    db.prepare('DELETE FROM desinscriptions WHERE boutique_id = ? AND email = ?').run(d.boutiqueId, d.email);
    db.prepare('INSERT OR IGNORE INTO abonnes (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(d.boutiqueId, d.email, Date.now());
    return { html: pageSimple('C’est fait', `${d.email} recevra de nouveau les nouvelles de cette boutique.`) };
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
      impaye: [`Paiement de votre abonnement en échec`, `Bonjour,\n\nLe dernier paiement de votre abonnement Comptoir n’est pas passé. Votre boutique ${nom} est fermée aux clients tant que le paiement n’est pas régularisé ; vos données sont conservées.\n\nMettez à jour votre moyen de paiement : ${urlPublique}/app\n\nL’équipe Comptoir`],
      resiliation: [`Résiliation enregistrée`, `Bonjour,\n\nLa résiliation de votre abonnement Comptoir est enregistrée. Votre boutique ${nom} et votre espace restent ouverts jusqu’au ${fin}. Rien ne sera prélevé ensuite.\n\nVous changez d’avis ? Paramètres > Abonnement > Garder mon abonnement : ${urlPublique}/app\n\nL’équipe Comptoir`],
      termine: [`Votre abonnement est terminé`, `Bonjour,\n\nVotre abonnement Comptoir est terminé : la boutique ${nom} est fermée aux clients. Vos données sont conservées ; reprenez un abonnement quand vous voulez : ${urlPublique}/app\n\nL’équipe Comptoir`]
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
    if (ctx.req.headers.authorization !== `Bearer ${f.cle_api}`) throw erreur(401, 'Clé API invalide.', 'cle_api');
  };
  async function expedierDemo(ref) {
    const cmd = db.prepare('SELECT * FROM demo_fournisseur_commandes WHERE ref = ?').get(ref);
    if (!cmd || cmd.statut === 'expediee') return;
    db.prepare("UPDATE demo_fournisseur_commandes SET statut = 'expediee' WHERE ref = ?").run(ref);
    const f = db.prepare("SELECT * FROM fournisseurs WHERE code = 'demo'").get();
    const corps = JSON.stringify({ ref, statut: 'expediee', transporteur: 'La Poste', suivi: '99.60.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7) });
    await fetchImpl(`${urlPublique}/api/webhooks/fournisseurs/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': fournisseurs.signer(corps, f.secret_webhook) }, body: corps });
  }
  r.get('/demo-fournisseur/catalogue', exigerCleDemo, () => fournisseurs.CATALOGUE_DEMO);
  r.post('/demo-fournisseur/commandes', exigerCleDemo, ctx => {
    const lignes = ctx.corps.lignes;
    if (!Array.isArray(lignes) || !lignes.length || lignes.some(l => !fournisseurs.CATALOGUE_DEMO.find(p => p.id === l.produitId))) throw erreur(400, 'Produit inconnu du fournisseur.', 'produit_inconnu');
    const ref = 'FO-' + crypto.randomInt(100000, 999999);
    db.prepare('INSERT INTO demo_fournisseur_commandes (ref, donnees, statut, cree_le) VALUES (?, ?, ?, ?)').run(ref, JSON.stringify(ctx.corps), 'recue', Date.now());
    if (delaiExpeditionDemo >= 0) setTimeout(() => expedierDemo(ref).catch(e => journal.error('[demo-fournisseur]', e.message)), delaiExpeditionDemo).unref();
    return { statut: 201, corps: { ref, statut: 'recue' } };
  });
  r.post('/demo-fournisseur/commandes/:ref/expedier', exigerCleDemo, async ctx => { await expedierDemo(ctx.params.ref); return { ok: true }; });

  /* ---------- Gestionnaire HTTP ---------- */
  async function gerer(req, res) {
    // En-têtes de sécurité sur toutes les réponses : pas de chargement de script étranger (hors cdnjs pour le QR code),
    // pas d'affichage dans un cadre d'un autre site (clickjacking), pas de devinette du type de fichier.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; object-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
      const ctx = { req, res, params: route.params, query: url.searchParams, cookies: lireCookies(req), entetes: {}, ip: ipClient(req), corps: {}, corpsBrut: '' };
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
  return gerer;
}

function escHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { creerApp };
