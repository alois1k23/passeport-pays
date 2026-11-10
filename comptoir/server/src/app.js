// Application Comptoir : routes de l'API, logique des commandes, paiements,
// transmission aux fournisseurs, e-mails, pages publiques.
'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const abonnements = require('./abonnements');
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
  const prochaineFacture = (boutiqueId, date) => {
    const b = db.prepare('UPDATE boutiques SET compteur_facture = compteur_facture + 1 WHERE id = ? RETURNING compteur_facture').get(boutiqueId);
    return `FA-${new Date(date).getFullYear()}-${String(b.compteur_facture).padStart(4, '0')}`;
  };
  const ajusterStock = (boutiqueId, lignes, sens) => {
    for (const l of lignes) {
      if (l.type === 'drop') continue;
      const p = db.prepare('SELECT donnees FROM produits WHERE id = ? AND boutique_id = ?').get(l.produitId, boutiqueId);
      if (!p) continue;
      const d = JSON.parse(p.donnees);
      d.stock = Math.max(0, (d.stock || 0) + sens * l.qte);
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
  const estDesinscrit = (boutiqueId, email) => !!db.prepare('SELECT 1 FROM desinscriptions WHERE boutique_id = ? AND email = ?').get(boutiqueId, email);
  /* Contenu des e-mails de commande : récapitulatif, lien de suivi personnel, lien du transporteur. */
  const lienCommande = (b, id) => { const row = db.prepare('SELECT jeton_client FROM commandes WHERE id = ?').get(id); return row ? `${urlBoutique(b)}?commande=${encodeURIComponent(id)}&jeton=${encodeURIComponent(row.jeton_client)}` : urlBoutique(b); };
  const recapitulatif = (c, config) => [
    ...c.lignes.map(l => `- ${l.qte} × ${l.nom} : ${formatMontant(l.prix * l.qte, config)}`),
    ...(c.remise ? [`- Remise${c.motifRemise ? ` (${c.motifRemise})` : ''} : −${formatMontant(c.remise, config)}`] : []),
    `- Livraison${(prix.modesLivraison(config)[c.livraison] || {}).nom ? ` (${prix.modesLivraison(config)[c.livraison].nom})` : ''} : ${c.port ? formatMontant(c.port, config) : 'offerte'}`,
    `Total payé : ${formatMontant(c.total, config)}`
  ].join('\n');
  const lienTransporteur = (transporteur, suivi) => {
    const n = encodeURIComponent(String(suivi || '').replace(/\s/g, ''));
    if (/la poste|post/i.test(transporteur || '') && /^99\.|^\d{2}\.\d{2}/.test(suivi || '')) return `https://service.post.ch/ekp-web/ui/entry/shipping/0?formattedParcelCodes=${n}`;
    if (/colissimo|la poste/i.test(transporteur || '')) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`;
    if (/chronopost/i.test(transporteur || '')) return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`;
    if (/mondial/i.test(transporteur || '')) return `https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition=${n}`;
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
      tests: (Array.isArray(config.tests) ? config.tests : []).slice(-50).map(t => ({
        id: String(t.id).slice(0, 30), produitId: String(t.produitId).slice(0, 40), canal: ['meta', 'tiktok-ads', 'organique'].includes(t.canal) ? t.canal : 'meta',
        budgetJour: Math.max(0, Number(t.budgetJour) || 0), debut: Number(t.debut) || Date.now(),
        resultats: (Array.isArray(t.resultats) ? t.resultats : []).slice(0, 60).map(r => Object.fromEntries(['depense', 'vues', 'impressions', 'vues3s', 'clics', 'ventes'].map(k => [k, Math.max(0, Number(r[k]) || 0)])))
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
      aVerifier: !!p.aVerifier
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
    const produit = nettoyerProduit({ ...src, type: 'drop', actif: true, teinte: (src.id.charCodeAt(2) * 47) % 360, source: src.id, codeFournisseur, description: src.description || `${src.nom}. Expédié par notre partenaire, livré en ${src.delai[0]} à ${src.delai[1]} jours.` });
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, (SELECT COALESCE(MAX(ordre), 0) + 1 FROM produits WHERE boutique_id = ?))').run(id, boutiqueId, JSON.stringify(produit), boutiqueId);
    return { id };
  }
  function slugUnique(nom) {
    const base = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'boutique';
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
      if (c.statut === 'payee') return ['fournisseur', 'annulee'];
      if (c.statut === 'fournisseur') return ['expediee'];
    }
    if (c.livraison === 'retrait') {
      if (c.statut === 'preparation') return ['prete'];
      if (c.statut === 'prete') return ['retiree'];
      if (c.statut === 'retiree') return ['remboursee'];
    }
    return { attente: ['payee', 'annulee'], payee: ['preparation', 'annulee'], preparation: ['expediee'], expediee: ['livree'], livree: ['remboursee'] }[c.statut] || [];
  }

  /* Transmet au fournisseur les articles en dropshipping d'une commande payée. */
  async function transmettreAuFournisseur(boutique, c, auto) {
    const lignesDrop = c.lignes.filter(l => l.type === 'drop');
    if (!lignesDrop.length || c.refFournisseur) return c;
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
    const p = db.prepare('SELECT * FROM paiements WHERE id = ?').get(paiementId);
    if (!p || p.statut === 'paye') return;
    const res = transaction(db, () => {
      db.prepare("UPDATE paiements SET statut = 'paye', ref_externe = COALESCE(?, ref_externe) WHERE id = ?").run(refExterne || null, p.id);
      const row = db.prepare('SELECT * FROM commandes WHERE id = ?').get(p.commande_id);
      const c = lireCommande(row);
      c.statut = 'payee';
      c.facture = prochaineFacture(row.boutique_id, Date.now());
      if (c.relances) { c.recuperee = true; c.historique.push({ date: Date.now(), texte: 'Paiement récupéré après relance' }); }
      if (c.parent) {
        const pr = db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.parent);
        if (pr) { const parent = lireCommande(pr); parent.complements = [...(parent.complements || []), c.id]; historique(parent, `Complément n° ${c.numero} ajouté après l’achat : à expédier dans le même colis`); enregistrerCommande(parent); }
      }
      historique(c, `Paiement ${p.fournisseur === 'stripe' ? 'en ligne' : 'simulé'} accepté (${formatMontant(p.montant_centimes / 100, lireConfig(db.prepare('SELECT config FROM boutiques WHERE id = ?').get(row.boutique_id)))})`);
      enregistrerCommande(c);
      ajusterStock(row.boutique_id, c.lignes, -1);
      return { c, boutique: db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id) };
    });
    const config = lireConfig(res.boutique);
    envoyerEmail(res.boutique.id, res.c.client.email, `Commande n° ${res.c.numero} confirmée`,
      `Bonjour ${res.c.client.nom},\n\nMerci pour votre commande chez ${config.boutique.nom}.\n\n${recapitulatif(res.c, config)}\n\n${res.c.livraison === 'retrait' ? 'Nous vous écrivons dès que la commande est prête à retirer.' : 'Nous vous écrivons dès l’expédition, avec le numéro de suivi.'}\nSuivre votre commande : ${lienCommande(res.boutique, res.c.id)}\n\nUne question ? Répondez à cet e-mail${config.entreprise && config.entreprise.email ? ` ou écrivez à ${config.entreprise.email}` : ''}.`);
    if (config.reglages.autoTransmission && res.c.lignes.some(l => l.type === 'drop')) {
      try { await transmettreAuFournisseur(res.boutique, res.c, true); } catch (e) {
        const c = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(res.c.id));
        historique(c, `Échec de la transmission automatique : ${e.message} Transmettez-la à la main.`);
        enregistrerCommande(c);
        journal.error('[fournisseur]', e.message);
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

  /* ---------- Comptes ---------- */
  r.get('/api/session', ctx => {
    const m = auth.marchandDepuisRequete(db, ctx.cookies);
    const b = m && db.prepare('SELECT slug FROM boutiques WHERE marchand_id = ?').get(m.id);
    return { connecte: !!m, email: m ? m.email : null, slug: b ? b.slug : null, paiement: paiement.nom, emails: serviceEmail ? serviceEmail.nom : null, abonnement: m ? abo.etat(m.id) : null };
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
    ctx.entetes['Set-Cookie'] = auth.cookieSession(auth.creerSession(db, marchandId), securise);
    return { statut: 201, corps: { ok: true, slug } };
  });
  r.post('/api/auth/connexion', ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const email = valider.email(ctx.corps.email);
    const m = db.prepare('SELECT * FROM marchands WHERE email = ?').get(email);
    if (!m || !auth.verifierMotDePasse(String(ctx.corps.motDePasse || ''), m.mot_de_passe)) throw erreur(401, 'E-mail ou mot de passe incorrect.', 'identifiants');
    ctx.entetes['Set-Cookie'] = auth.cookieSession(auth.creerSession(db, m.id), securise);
    return { ok: true };
  });
  /* Mot de passe oublié : lien valable 1 heure, réponse identique que le compte existe ou non. */
  r.post('/api/auth/oubli', ctx => {
    auth.limiterConnexion(ctx.ip, Number(env.LIMITE_ESSAIS) || 10);
    const email = valider.email(ctx.corps.email);
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
    ctx.entetes['Set-Cookie'] = auth.cookieSession(auth.creerSession(db, ligne.marchand_id), securise);
    return { ok: true };
  });

  /* Domaine personnalisé : actif quand le DNS pointe vers Comptoir (enregistrement CNAME ou même adresse IP). */
  r.post('/api/admin/domaine/verifier', exigerMarchand, async ctx => {
    const config = lireConfig(ctx.boutique);
    const d = config.boutique.domaine;
    if (!d || !d.domaine) throw erreur(400, 'Choisissez d’abord un domaine.', 'sans_domaine');
    const domaine = String(d.domaine).toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domaine)) throw erreur(400, 'Nom de domaine invalide.', 'domaine_invalide');
    let ok = env.DOMAINES_SANS_VERIFICATION === '1';
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
  r.post('/api/admin/compte/supprimer', exigerCompte, ctx => {
    const m = db.prepare('SELECT * FROM marchands WHERE id = ?').get(ctx.marchand.id);
    if (!auth.verifierMotDePasse(String(ctx.corps.motDePasse || ''), m.mot_de_passe)) throw erreur(401, 'Mot de passe incorrect.', 'identifiants');
    transaction(db, () => {
      for (const b of db.prepare('SELECT id FROM boutiques WHERE marchand_id = ?').all(m.id)) {
        for (const t of ['publications', 'evenements', 'avis', 'abonnes', 'envois_auto', 'emails']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(b.id);
      }
      db.prepare('DELETE FROM marchands WHERE id = ?').run(m.id); // boutiques, produits, commandes, sessions : suppression en cascade
    });
    ctx.entetes['Set-Cookie'] = auth.cookieSession(null, securise);
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
    return { version: 2, ...config, produits: listerProduits(ctx.boutique.id), commandes, publications, abonnes, envois, avis, audience, offresVues, visites30j: 0, compteurFacture: ctx.boutique.compteur_facture, serveur: { slug: ctx.boutique.slug, email: ctx.marchand.email, paiement: paiement.nom, emails: serviceEmail ? serviceEmail.nom : null, creeLe: ctx.boutique.cree_le , abonnement: abo.etat(ctx.marchand.id)} };
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
    if (cible === 'remboursee') {
      const p = db.prepare("SELECT * FROM paiements WHERE commande_id = ? AND statut = 'paye'").get(c.id);
      if (p && p.fournisseur === 'stripe') await paiement.rembourser({ paiement: p });
      if (p) db.prepare("UPDATE paiements SET statut = 'rembourse' WHERE id = ?").run(p.id);
    }
    const textes = { payee: 'Paiement reçu', preparation: 'Préparation commencée', expediee: 'Expédiée', livree: 'Livrée', prete: 'Prête à retirer, client prévenu', retiree: 'Remise au client', remboursee: `Remboursée (${formatMontant(c.total, config)})`, annulee: 'Annulée' };
    if (cible === 'expediee' && !c.suivi) c.suivi = '99.00.' + Math.floor(100000 + Math.random() * 899999) + '.' + Math.floor(1e7 + Math.random() * 9e7);
    if (cible === 'payee' && !c.facture) c.facture = prochaineFacture(ctx.boutique.id, Date.now());
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
  r.post('/api/admin/caisse', exigerMarchand, ctx => {
    const cleTicket = typeof ctx.corps.cle === 'string' ? `${ctx.boutique.id}:${ctx.corps.cle.slice(0, 60)}` : null;
    if (cleTicket && ticketsVus.has(cleTicket)) return ticketsVus.get(cleTicket);
    for (const [k, v] of ticketsVus) if (Date.now() - v.le > 3600000) ticketsVus.delete(k);
    const reponse = encaisserCaisse(ctx);
    if (cleTicket) ticketsVus.set(cleTicket, { ...reponse, le: Date.now() });
    return reponse;
  });
  function encaisserCaisse(ctx) {
    const produits = listerProduits(ctx.boutique.id);
    const lignes = prix.construireLignes(produits, ctx.corps.lignes);
    if (lignes.some(l => l.type === 'drop')) throw erreur(400, 'La caisse n’accepte que les produits en stock.', 'caisse_drop');
    const total = prix.arrondi(lignes.reduce((a, l) => a + l.prix * l.qte, 0));
    const moyen = ctx.corps.moyen === 'especes' ? 'espèces' : ctx.corps.moyen === 'twint' ? 'TWINT' : 'carte';
    return transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(ctx.boutique.id).compteur_commande;
      const id = auth.nouvelId('c_');
      const now = Date.now();
      const config = lireConfig(ctx.boutique);
      const donnees = { client: { nom: 'Client en boutique', email: '', ville: '' }, lignes, sousTotal: total, port: 0, total, tauxTva: prix.tauxTva(config), livraison: 'retrait', canal: 'magasin', suivi: '', note: '', facture: prochaineFacture(ctx.boutique.id, now), historique: [{ date: now, texte: `Vente encaissée en boutique (${moyen})` }] };
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
  r.post('/api/admin/publications', exigerMarchand, ctx => {
    const liste = Array.isArray(ctx.corps.publications) ? ctx.corps.publications : [];
    if (!liste.length || liste.length > 80) throw erreur(400, 'Entre 1 et 80 publications à la fois.', 'invalide');
    const propres = liste.map(social.nettoyerPublication);
    transaction(db, () => { for (const p of propres) social.enregistrer(db, ctx.boutique.id, { ...p, id: auth.nouvelId('pub_') }); });
    return { statut: 201, corps: { n: propres.length } };
  });
  r.put('/api/admin/publications/:id', exigerMarchand, ctx => {
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
  r.post('/api/admin/publications/:id/publier', exigerMarchand, async ctx => {
    const p = publicationDeBoutique(ctx.boutique.id, ctx.params.id);
    const config = lireConfig(ctx.boutique);
    if (!config.social.comptes[p.reseau]) throw erreur(409, 'Connectez d’abord ce réseau.', 'compte_absent');
    return { publication: await social.publier(db, ctx.boutique.id, p, config) };
  });

  /* Publie les publications programmées arrivées à échéance (appelé chaque minute). */
  async function publierEcheances(maintenant = Date.now()) {
    const dues = db.prepare("SELECT p.*, b.config FROM publications p JOIN boutiques b ON b.id = p.boutique_id WHERE p.statut = 'programmee' AND p.date <= ? LIMIT 200").all(maintenant);
    let n = 0;
    for (const row of dues) {
      const config = JSON.parse(row.config);
      if (!config.social || !config.social.comptes || !config.social.comptes[row.reseau]) continue;
      try { await social.publier(db, row.boutique_id, social.lire(row), config); n++; } catch (e) { journal.error('[social]', e.message); }
    }
    return n;
  }

  r.get('/api/admin/emails', exigerMarchand, ctx => db.prepare('SELECT destinataire, sujet, corps, cree_le FROM emails WHERE boutique_id = ? ORDER BY id DESC LIMIT 50').all(ctx.boutique.id));

  /* ---------- Boutique publique ---------- */
  r.get('/api/public/:slug', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const config = lireConfig(b);
    const notes = statsAvis(b.id);
    const regime = config.boutique.pays === 'ch' ? 'ch' : 'ue';
    const produits = listerProduits(b.id).filter(p => p.actif && !p.aVerifier).map(({ cout, portF, codeFournisseur, fournisseur, source, aVerifier, historiquePrix, prixReference, ...p }) => {
      const pb = PrixBarres.verifier({ prix: p.prix, prixReference, historiquePrix }, regime);
      return { ...p, avis: notes[p.id] || null, ...(pb.ok ? { prixBarre: prixReference } : {}) };
    });
    const avisRecents = db.prepare('SELECT a.note, a.texte, a.prenom, a.ville, a.cree_le, a.reponse, a.produit_id FROM avis a WHERE a.boutique_id = ? AND a.texte <> \'\' ORDER BY a.cree_le DESC LIMIT 6').all(b.id);
    // Un code promo affiché dans la bannière doit exister au paiement ; un contact d'exemple est remplacé par l'e-mail de l'entreprise.
    const codesOk = new Set(Remises.codesValables(config).map(c => c.code.toUpperCase()));
    const sectionsPubliques = (config.boutique.sections || []).map(s => {
      if (s.type === 'saison' && s.props && s.props.code && !codesOk.has(String(s.props.code).toUpperCase())) return { ...s, props: { ...s.props, code: '' } };
      if (s.type === 'pied' && s.props && (!s.props.contact || /@exemple\./i.test(s.props.contact))) return { ...s, props: { ...s.props, contact: config.entreprise.email || '' } };
      return s;
    });
    return {
      boutique: { ...config.boutique, sections: sectionsPubliques },
      magasin: { clickCollect: !!config.magasin.clickCollect, adresse: config.magasin.adresse || '' },
      entreprise: { raison: config.entreprise.raison, adresse: config.entreprise.adresse, email: config.entreprise.email, forme: config.entreprise.forme, siret: config.entreprise.siret, regime: config.entreprise.regime },
      produits, avisRecents,
      livraisons: prix.modesLivraison(config),
      seuilPortOffert: Remises.offresDe(config).seuilPort,
      offres: (({ paliersActifs, paliers, suggestions, barrePort, seuilPort, regles }) => ({ paliersActifs, paliers, suggestions, barrePort, seuilPort, regles: regles.filter(r => r.actif && r.type === 'panier') }))(Remises.offresDe(config)),
      newsletter: relances.nettoyer(config.automatisations).bienvenue,
      paiement: paiement.nom
    };
  });
  r.post('/api/public/:slug/commandes', async ctx => {
    auth.limiter('commande:' + ctx.ip, (Number(env.LIMITE_COMMANDES) || 30) * facteurLimites, 15 * 60000, 'Trop de commandes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueOuverte(ctx.params.slug);
    const config = lireConfig(b);
    const produits = listerProduits(b.id);
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
    const lignes = calcul.lignes;
    const sousTotal = calcul.sousTotal, remise = calcul.remise;
    const port = prix.fraisPort(mode, calcul.apresRemise, Remises.offresDe(config).seuilPort);
    const total = prix.arrondi(calcul.apresRemise + port);
    const devise = config.boutique.devise || 'EUR';
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', client, lignes, sousTotal, remise, motifRemise: calcul.motif ? calcul.motif.libelle : null, port, total, tauxTva: prix.tauxTva(config), livraison: ctx.corps.livraison, canal: 'web', suivi: '', note: '', historique: [{ date: now, texte: 'Commande passée en ligne, paiement en attente' + (remise ? ` (remise : ${calcul.motif.libelle})` : '') }] };
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, b.id, n, date, statut, jeton, JSON.stringify(donnees));
      const p = { id: auth.nouvelId('pay_'), commande_id: c.id };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.id, c.id, paiement.nom, Math.round(total * 100), devise, 'cree', now);
      return { commande: { ...c, jeton }, pmt: p };
    });
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    const session = await paiement.creerSession({ paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1` });
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
    const liste = Array.isArray(ctx.corps.avis) ? ctx.corps.avis.slice(0, 20) : [];
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
    const p = listerProduits(b.id).find(x => x.id === r.alors && x.actif && (x.type === 'drop' || x.stock > 0));
    return p ? { regle: r.id, produitId: p.id, nom: p.nom, prix: p.prix, prixOffre: prix.arrondi(p.prix * (1 - r.remise / 100)), remise: r.remise, teinte: p.teinte, image: p.image || null } : null;
  }
  const verifierJeton = (row, jeton) => row && String(jeton || '').length === row.jeton_client.length && crypto.timingSafeEqual(Buffer.from(String(jeton)), Buffer.from(row.jeton_client));
  r.post('/api/public/:slug/commandes/:id/complement', async ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    if (!verifierJeton(row, ctx.corps.jeton)) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    const parent = lireCommande(row);
    const o = offreApres(b, parent);
    if (!o || o.regle !== ctx.corps.regle) throw erreur(409, 'Cette offre n’est plus disponible.', 'offre_expiree');
    const config = lireConfig(b);
    const p = listerProduits(b.id).find(x => x.id === o.produitId);
    const devise = config.boutique.devise || 'EUR';
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const lignes = [{ produitId: p.id, nom: p.nom, prix: o.prixOffre, prixInitial: p.prix, qte: 1, type: p.type || 'stock', source: p.source || null, fournisseur: p.fournisseur || null, codeFournisseur: p.codeFournisseur, offre: o.regle, apres: true }];
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', client: parent.client, lignes, sousTotal: o.prixOffre, remise: 0, port: 0, total: o.prixOffre, tauxTva: prix.tauxTva(config), livraison: parent.livraison, canal: 'web', suivi: '', note: '', parent: parent.id, historique: [{ date: now, texte: `Complément à la commande n° ${parent.numero} (offre −${o.remise} %, même colis)` }] };
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, b.id, n, date, statut, jeton, JSON.stringify(donnees));
      const pp = { id: auth.nouvelId('pay_'), commande_id: c.id };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(pp.id, c.id, paiement.nom, Math.round(c.total * 100), devise, 'cree', now);
      return { commande: { ...c, jeton }, pmt: pp };
    });
    const retour = `${urlBoutique(b)}?commande=${commande.id}&jeton=${commande.jeton}`;
    const session = await paiement.creerSession({ paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${urlBoutique(b)}?commande=${parent.id}&jeton=${row.jeton_client}` });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { statut: 201, corps: { paiementUrl: session.url } };
  });

  /* Mesure d’audience sans cookie : identifiant de session aléatoire (onglet), aucune adresse IP enregistrée. */
  const TYPES_EVENEMENTS = ['vue', 'produit', 'panier', 'livraison', 'paiement', 'offre_vue'];
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
    const saisi = String(ctx.corps.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = Remises.codesValables(lireConfig(b)).find(x => x.code === saisi);
    if (!c) throw erreur(404, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    return { code: c.code, remise: c.remise };
  });
  r.post('/api/public/:slug/newsletter', ctx => {
    auth.limiter('newsletter:' + ctx.ip, 20 * facteurLimites, 15 * 60000, 'Trop de requêtes en peu de temps. Réessayez dans quelques minutes.');
    const b = boutiqueParSlug(ctx.params.slug);
    const email = valider.email(ctx.corps.email);
    db.prepare('INSERT OR IGNORE INTO abonnes (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(b.id, email, Date.now());
    db.prepare('DELETE FROM desinscriptions WHERE boutique_id = ? AND email = ?').run(b.id, email);   // nouvelle inscription explicite : nouveau consentement
    relances.emailBienvenue({ db, boutique: b, config: lireConfig(b), email, urlPublique, urlBoutique: urlBoutique(b), envoyerEmail });
    return { ok: true };
  });
  r.post('/api/public/:slug/commandes/:id/reprendre', async ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const row = db.prepare('SELECT * FROM commandes WHERE id = ? AND boutique_id = ?').get(ctx.params.id, b.id);
    const jeton = String(ctx.corps.jeton || '');
    if (!row || jeton.length !== row.jeton_client.length || !crypto.timingSafeEqual(Buffer.from(jeton), Buffer.from(row.jeton_client))) throw erreur(404, 'Commande introuvable.', 'commande_introuvable');
    if (row.statut !== 'attente') throw erreur(409, 'Cette commande est déjà payée ou annulée.', 'deja_traitee');
    const c = lireCommande(row);
    const devise = lireConfig(b).boutique.devise || 'EUR';
    const pmt = { id: auth.nouvelId('pay_'), commande_id: c.id };
    db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(pmt.id, c.id, paiement.nom, Math.round(c.total * 100), devise, 'cree', Date.now());
    const retour = `${urlBoutique(b)}?commande=${c.id}&jeton=${row.jeton_client}`;
    const session = await paiement.creerSession({ paiement: pmt, commande: c, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1` });
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
    if (ev.type === 'checkout.session.completed' && ev.data.object.payment_status === 'paid') {
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
    if (ev.statut === 'expediee' && !c.suivi) {
      c.suivi = String(ev.suivi || '').slice(0, 60);
      c.transporteur = String(ev.transporteur || '').slice(0, 40);
      if (estDrop(c)) c.statut = 'expediee';
      historique(c, `Expédiée par le fournisseur (${c.transporteur}), suivi ${c.suivi} envoyé au client`);
      enregistrerCommande(c);
      { const bq = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id); emailExpedition(bq, c, lireConfig(bq)); }
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
  function pageBoutique(b, { racine, produitId = null }) {
    const config = lireConfig(b);
    const ouverte = abo.etat(b.marchand_id).actif;
    const produits = listerProduits(b.id).filter(p => p.actif && !p.aVerifier);
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
      `<title>${escHtml(titre)}</title>`, `<meta name="description" content="${escHtml(description)}">`, `<link rel="canonical" href="${escHtml(canonique)}">`,
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
    const produits = abo.etat(b.marchand_id).actif ? listerProduits(b.id).filter(p => p.actif && !p.aVerifier) : [];
    const urls = [`${base}/`, ...produits.map(p => `${base}/p/${encodeURIComponent(p.id)}`)];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${escHtml(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  }
  // Image d'un produit en fichier (pour l'aperçu de partage : og:image doit être une adresse, pas une image intégrée).
  r.get('/api/public/:slug/image/:id', ctx => {
    const b = boutiqueOuverte(ctx.params.slug);
    const p = listerProduits(b.id).find(x => x.id === ctx.params.id && x.actif && x.image);
    const m = p && /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(p.image);
    if (!m) throw erreur(404, 'Image introuvable.', 'introuvable');
    return { binaire: Buffer.from(m[3], 'base64'), type: m[1] };
  });

  /* ---------- Désinscription des e-mails commerciaux (lien personnel signé, confirmation par un clic) ---------- */
  const pageSimple = (titre, texte, formulaire = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(titre)}</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#F4F5F7;color:#151821;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{background:#fff;border:1px solid #E0E3EA;border-radius:14px;padding:28px;max-width:440px;display:grid;gap:12px}h1{font-size:1.2rem;margin:0}button{font:inherit;padding:11px 16px;border-radius:9px;border:1px solid #151821;background:#151821;color:#fff;font-weight:600;cursor:pointer}</style></head><body><main><h1>${escHtml(titre)}</h1><p>${escHtml(texte)}</p>${formulaire}</main></body></html>`;
  r.get('/desinscription', ctx => {
    const d = lireJetonDesinscription(ctx.query.get('j'));
    if (!d) return { html: pageSimple('Lien invalide', 'Ce lien de désinscription est incomplet ou a été modifié.') };
    const b = db.prepare('SELECT config FROM boutiques WHERE id = ?').get(d.boutiqueId);
    const nom = b ? JSON.parse(b.config).boutique.nom : 'cette boutique';
    if (estDesinscrit(d.boutiqueId, d.email)) return { html: pageSimple('Vous êtes déjà désinscrit', `${d.email} ne reçoit plus les nouvelles et offres de ${nom}.`) };
    return { html: pageSimple(`Ne plus recevoir les e-mails de ${nom}`, `Confirmez pour ${d.email}. Vous recevrez toujours les e-mails liés à vos commandes (confirmation, expédition).`, `<form method="post" action="/desinscription?j=${encodeURIComponent(ctx.query.get('j'))}"><button>Me désinscrire</button></form>`) };
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
          if (chemin === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${racine}sitemap.xml\n`); }
          return envoyerHtml(res, 200, pageBoutique(b, { racine, produitId: chemin.startsWith('/p/') ? decodeURIComponent(chemin.slice(3)) : null }));
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
            if (b) return envoyerHtml(res, 200, pageBoutique(b, { racine: domaineDe(b) ? `https://${domaineDe(b)}/` : `${urlPublique}/s/${b.slug}/`, produitId: mBoutique[2] || null }));
          }
          const mPlan = /^\/s\/([\w-]+)\/sitemap\.xml$/.exec(chemin);
          if (mPlan) { const b = db.prepare('SELECT * FROM boutiques WHERE slug = ?').get(mPlan[1]); if (b) { res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }); return res.end(planDuSite(b, `${urlPublique}/s/${b.slug}/`)); } }
          if (chemin === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('User-agent: *\nAllow: /\nAllow: /s/\nDisallow: /app\nDisallow: /demo\nDisallow: /api/\nDisallow: /paiement-simule/\nDisallow: /abonnement-simule/\n'); }
          if (FICHIERS_PUBLICS.test(chemin) && servirStatique(res, RACINE_FRONT, chemin.slice(1))) return;
        }
        throw erreur(404, 'Page introuvable.', 'introuvable');
      }
      const ctx = { req, res, params: route.params, query: url.searchParams, cookies: lireCookies(req), entetes: {}, ip: req.socket.remoteAddress, corps: {}, corpsBrut: '' };
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        ctx.corpsBrut = (await lireCorps(req)).toString('utf8');
        const type = req.headers['content-type'] || '';
        if (chemin.startsWith('/api/') && !chemin.startsWith('/api/webhooks/')) {
          // JSON obligatoire : un formulaire d'un autre site ne peut pas envoyer ce type sans CORS (protection CSRF).
          if (ctx.corpsBrut && !type.startsWith('application/json')) throw erreur(415, 'Envoyez du JSON.', 'type_contenu');
          ctx.corps = ctx.corpsBrut ? JSON.parse(ctx.corpsBrut) : {};
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
