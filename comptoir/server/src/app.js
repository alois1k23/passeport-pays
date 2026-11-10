// Application Comptoir : routes de l'API, logique des commandes, paiements,
// transmission aux fournisseurs, e-mails, pages publiques.
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { creerRouteur, lireCorps, lireCookies, envoyerJson, envoyerHtml, servirStatique, erreur, ErreurHttp, valider } = require('./http');
const auth = require('./auth');
const { transaction } = require('./db');
const prix = require('./prix');
const { choisirPrestataire } = require('./paiements');
const fournisseurs = require('./fournisseurs');
const social = require('./social');
const relances = require('./relances');
const Remises = require('../../js/remises.js');

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

  /* ---------- Accès aux données ---------- */
  const lireConfig = b => JSON.parse(b.config);
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
  const envoyerEmail = (boutiqueId, destinataire, sujet, corps) => {
    if (!destinataire) return;
    db.prepare('INSERT INTO emails (boutique_id, destinataire, sujet, corps, cree_le) VALUES (?, ?, ?, ?, ?)').run(boutiqueId, destinataire, sujet, corps, Date.now());
    if (env.LOG_EMAILS) journal.log(`[e-mail] à ${destinataire} : ${sujet}`);
  };
  const formatMontant = (n, config) => Number(n).toLocaleString(config.boutique.devise === 'CHF' ? 'fr-CH' : 'fr-FR', { style: 'currency', currency: config.boutique.devise || 'EUR' });

  /* ---------- Validation de la configuration envoyée par l'éditeur ---------- */
  function nettoyerConfig(config) {
    if (!config || typeof config !== 'object' || !config.boutique || typeof config.boutique !== 'object') throw erreur(400, 'Configuration de boutique invalide.', 'config_invalide');
    if (JSON.stringify(config).length > 300000) throw erreur(413, 'Configuration trop volumineuse.', 'trop_volumineux');
    const b = config.boutique;
    b.nom = valider.texte(b.nom, 'Le nom de la boutique', { max: 80 });
    b.pays = ['fr', 'be', 'ch', 'ca'].includes(b.pays) ? b.pays : 'ch';
    b.devise = b.pays === 'ch' ? 'CHF' : b.pays === 'ca' ? 'CAD' : 'EUR';
    const t = b.theme || {};
    for (const k of ['bg', 'surface', 'text', 'muted', 'primary', 'onPrimary']) if (!COULEUR.test(t[k] || '')) t[k] = '#333333';
    if (!POLICES.includes(t.font)) t.font = POLICES[4];
    if (!POLICES.includes(t.body)) t.body = POLICES[4];
    t.radius = Math.max(0, Math.min(24, Number(t.radius) || 0));
    b.theme = t;
    if (!Array.isArray(b.sections)) b.sections = [];
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
      tests: (Array.isArray(config.tests) ? config.tests : []).slice(-50).map(t => ({
        id: String(t.id).slice(0, 30), produitId: String(t.produitId).slice(0, 40), canal: ['meta', 'tiktok-ads', 'organique'].includes(t.canal) ? t.canal : 'meta',
        budgetJour: Math.max(0, Number(t.budgetJour) || 0), debut: Number(t.debut) || Date.now(),
        resultats: (Array.isArray(t.resultats) ? t.resultats : []).slice(0, 60).map(r => Object.fromEntries(['depense', 'vues', 'clics', 'ventes'].map(k => [k, Math.max(0, Number(r[k]) || 0)])))
      }))
    };
  }
  function nettoyerProduit(p) {
    const type = p.type === 'drop' ? 'drop' : 'stock';
    const propre = {
      nom: valider.texte(p.nom, 'Le nom du produit', { max: 120 }),
      description: typeof p.description === 'string' ? p.description.slice(0, 3000) : '',
      categorie: typeof p.categorie === 'string' ? p.categorie.slice(0, 60) : '',
      prix: valider.nombre(p.prix, 'Le prix', { min: 0, max: 100000 }),
      stock: type === 'drop' ? 999 : valider.entier(p.stock ?? 0, 'Le stock', { min: 0, max: 1e6 }),
      actif: p.actif !== false,
      teinte: Math.abs(Math.round(Number(p.teinte) || 0)) % 360,
      type,
      aVerifier: !!p.aVerifier
    };
    if (p.cout !== undefined && p.cout !== null && p.cout !== '') propre.cout = valider.nombre(p.cout, 'Le coût', { min: 0, max: 100000 });
    if (typeof p.image === 'string' && p.image) {
      if (!IMAGE.test(p.image) || p.image.length > 400000) throw erreur(400, 'Image invalide : JPEG, PNG ou WebP de moins de 300 Ko.', 'image_invalide');
      propre.image = p.image;
    }
    if (type === 'drop') Object.assign(propre, { portF: Number(p.portF) || 0, entrepot: ['CH', 'UE', 'CN'].includes(p.entrepot) ? p.entrepot : 'UE', delai: Array.isArray(p.delai) ? p.delai.slice(0, 2).map(Number) : [3, 7], fournisseur: String(p.fournisseur || '').slice(0, 80), source: String(p.source || '').slice(0, 40), codeFournisseur: p.codeFournisseur || 'demo' });
    return propre;
  }
  function slugUnique(nom) {
    const base = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'boutique';
    let slug = base, i = 2;
    while (db.prepare('SELECT 1 FROM boutiques WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
    return slug;
  }
  function insererProduits(boutiqueId, produits) {
    (produits || []).slice(0, 200).forEach((p, i) => {
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
    const rep = await fournisseurs.client(f, fetchImpl).passerCommande({
      referenceMarchand: `${boutique.slug}-${c.numero}`,
      lignes: lignesDrop.map(l => ({ produitId: l.source, qte: l.qte })),
      livraison: { nom: c.client.nom, adresse: c.client.adresse || '', npa: c.client.npa || '', ville: c.client.ville, pays: lireConfig(boutique).boutique.pays.toUpperCase() }
    });
    const frais = lireCommande(db.prepare('SELECT * FROM commandes WHERE id = ?').get(c.id));
    frais.refFournisseur = rep.ref;
    frais.codeFournisseur = f.code;
    if (estDrop(frais)) frais.statut = 'fournisseur';
    historique(frais, `${auto ? 'Transmise automatiquement' : 'Transmise'} à ${f.nom} (${rep.ref})`);
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
      historique(c, `Paiement ${p.fournisseur === 'stripe' ? 'en ligne' : 'simulé'} accepté (${formatMontant(p.montant_centimes / 100, lireConfig(db.prepare('SELECT config FROM boutiques WHERE id = ?').get(row.boutique_id)))})`);
      enregistrerCommande(c);
      ajusterStock(row.boutique_id, c.lignes, -1);
      return { c, boutique: db.prepare('SELECT * FROM boutiques WHERE id = ?').get(row.boutique_id) };
    });
    const config = lireConfig(res.boutique);
    envoyerEmail(res.boutique.id, res.c.client.email, `Commande n° ${res.c.numero} confirmée`,
      `Bonjour ${res.c.client.nom},\n\nMerci pour votre commande chez ${config.boutique.nom}. Total : ${formatMontant(res.c.total, config)}.\nNous vous écrirons dès l'expédition.\n`);
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
  const exigerMarchand = ctx => {
    ctx.marchand = auth.marchandDepuisRequete(db, ctx.cookies);
    if (!ctx.marchand) throw erreur(401, 'Connectez-vous pour continuer.', 'non_connecte');
    ctx.boutique = boutiqueDuMarchand(ctx.marchand.id);
  };

  /* ---------- Comptes ---------- */
  r.get('/api/session', ctx => {
    const m = auth.marchandDepuisRequete(db, ctx.cookies);
    const b = m && db.prepare('SELECT slug FROM boutiques WHERE marchand_id = ?').get(m.id);
    return { connecte: !!m, email: m ? m.email : null, slug: b ? b.slug : null, paiement: paiement.nom };
  });
  r.post('/api/auth/inscription', ctx => {
    auth.limiterConnexion(ctx.ip);
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
    });
    ctx.entetes['Set-Cookie'] = auth.cookieSession(auth.creerSession(db, marchandId), securise);
    return { statut: 201, corps: { ok: true, slug } };
  });
  r.post('/api/auth/connexion', ctx => {
    auth.limiterConnexion(ctx.ip);
    const email = valider.email(ctx.corps.email);
    const m = db.prepare('SELECT * FROM marchands WHERE email = ?').get(email);
    if (!m || !auth.verifierMotDePasse(String(ctx.corps.motDePasse || ''), m.mot_de_passe)) throw erreur(401, 'E-mail ou mot de passe incorrect.', 'identifiants');
    ctx.entetes['Set-Cookie'] = auth.cookieSession(auth.creerSession(db, m.id), securise);
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
    return { version: 2, ...config, produits: listerProduits(ctx.boutique.id), commandes, publications, abonnes, envois, visites30j: 0, compteurFacture: ctx.boutique.compteur_facture, serveur: { slug: ctx.boutique.slug, email: ctx.marchand.email, paiement: paiement.nom } };
  });
  r.put('/api/admin/config', exigerMarchand, ctx => {
    const config = nettoyerConfig(ctx.corps.config);
    db.prepare('UPDATE boutiques SET config = ? WHERE id = ?').run(JSON.stringify(config), ctx.boutique.id);
    return { ok: true };
  });
  r.post('/api/admin/reinitialiser', exigerMarchand, ctx => {
    const config = nettoyerConfig(ctx.corps.config);
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
    db.prepare('UPDATE produits SET donnees = ? WHERE id = ?').run(JSON.stringify(nettoyerProduit(fusion)), ctx.params.id);
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
    const deja = listerProduits(ctx.boutique.id).find(p => p.source === src.id);
    if (deja) return { id: deja.id, deja: true };
    const id = auth.nouvelId('p_');
    const produit = nettoyerProduit({ ...src, type: 'drop', actif: true, teinte: (src.id.charCodeAt(2) * 47) % 360, source: src.id, codeFournisseur: f.code, description: `${src.nom}. Expédié par notre partenaire, livré en ${src.delai[0]} à ${src.delai[1]} jours.` });
    db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, (SELECT COALESCE(MAX(ordre), 0) + 1 FROM produits WHERE boutique_id = ?))').run(id, ctx.boutique.id, JSON.stringify(produit), ctx.boutique.id);
    return { statut: 201, corps: { id } };
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
    if (cible === 'expediee') envoyerEmail(ctx.boutique.id, c.client.email, `Votre commande n° ${c.numero} est en route`, `Bonjour ${c.client.nom},\n\nVotre colis est parti. Suivi : ${c.suivi}\n`);
    if (cible === 'prete') envoyerEmail(ctx.boutique.id, c.client.email, `Votre commande n° ${c.numero} est prête`, `Bonjour ${c.client.nom},\n\nVotre commande vous attend en boutique : ${config.magasin.adresse || ''}.\n`);
    return { commande: c };
  });
  r.post('/api/admin/caisse', exigerMarchand, ctx => {
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
      const donnees = { client: { nom: 'Client en boutique', email: '', ville: '' }, lignes, sousTotal: total, port: 0, total, livraison: 'retrait', canal: 'magasin', suivi: '', note: '', facture: prochaineFacture(ctx.boutique.id, now), historique: [{ date: now, texte: `Vente encaissée en boutique (${moyen})` }] };
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ctx.boutique.id, numero, now, 'retiree', auth.nouvelId(), JSON.stringify(donnees));
      ajusterStock(ctx.boutique.id, lignes, -1);
      return { statut: 201, corps: { id, numero, facture: donnees.facture, total: formatMontant(total, config) } };
    });
  });
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
    const b = boutiqueParSlug(ctx.params.slug);
    const config = lireConfig(b);
    const produits = listerProduits(b.id).filter(p => p.actif).map(({ cout, portF, codeFournisseur, fournisseur, source, aVerifier, ...p }) => p);
    return {
      boutique: config.boutique,
      magasin: { clickCollect: !!config.magasin.clickCollect, adresse: config.magasin.adresse || '' },
      entreprise: { raison: config.entreprise.raison, adresse: config.entreprise.adresse, email: config.entreprise.email, forme: config.entreprise.forme, siret: config.entreprise.siret, regime: config.entreprise.regime },
      produits,
      livraisons: prix.modesLivraison(config),
      seuilPortOffert: prix.SEUIL_PORT_OFFERT,
      offres: (({ paliersActifs, paliers, suggestions, barrePort }) => ({ paliersActifs, paliers, suggestions, barrePort }))(Remises.offresDe(config)),
      newsletter: relances.nettoyer(config.automatisations).bienvenue,
      paiement: paiement.nom
    };
  });
  r.post('/api/public/:slug/commandes', async ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
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
      ville: valider.texte(cl.ville, 'La ville', { max: 100 })
    };
    if (config.boutique.pays === 'ch' && client.npa && !/^\d{4}$/.test(client.npa)) throw erreur(400, 'Le NPA suisse compte 4 chiffres.', 'npa_invalide');
    const calcul = Remises.appliquer(lignesBrutes, config, ctx.corps.code);
    if (ctx.corps.code && calcul.codeValide === false) throw erreur(400, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    const lignes = calcul.lignes;
    const sousTotal = calcul.sousTotal, remise = calcul.remise;
    const port = prix.fraisPort(mode, calcul.apresRemise);
    const total = prix.arrondi(calcul.apresRemise + port);
    const devise = config.boutique.devise || 'EUR';
    const { commande, pmt } = transaction(db, () => {
      const numero = db.prepare('UPDATE boutiques SET compteur_commande = compteur_commande + 1 WHERE id = ? RETURNING compteur_commande').get(b.id).compteur_commande;
      const now = Date.now();
      const c = { id: auth.nouvelId('c_'), numero, date: now, statut: 'attente', client, lignes, sousTotal, remise, motifRemise: calcul.motif ? calcul.motif.libelle : null, port, total, livraison: ctx.corps.livraison, canal: 'web', suivi: '', note: '', historique: [{ date: now, texte: 'Commande passée en ligne, paiement en attente' + (remise ? ` (remise : ${calcul.motif.libelle})` : '') }] };
      const jeton = auth.nouvelId();
      const { id, numero: n, date, statut, ...donnees } = c;
      db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, b.id, n, date, statut, jeton, JSON.stringify(donnees));
      const p = { id: auth.nouvelId('pay_'), commande_id: c.id };
      db.prepare('INSERT INTO paiements (id, commande_id, fournisseur, montant_centimes, devise, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p.id, c.id, paiement.nom, Math.round(total * 100), devise, 'cree', now);
      return { commande: { ...c, jeton }, pmt: p };
    });
    const retour = `${urlPublique}/s/${b.slug}?commande=${commande.id}&jeton=${commande.jeton}`;
    const session = await paiement.creerSession({ paiement: pmt, commande, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1` });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { statut: 201, corps: { commandeId: commande.id, numero: commande.numero, jeton: commande.jeton, total, paiementUrl: session.url } };
  });
  r.post('/api/public/:slug/code', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const saisi = String(ctx.corps.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = Remises.codesValables(lireConfig(b)).find(x => x.code === saisi);
    if (!c) throw erreur(404, 'Ce code promo n’existe pas ou a expiré.', 'code_invalide');
    return { code: c.code, remise: c.remise };
  });
  r.post('/api/public/:slug/newsletter', ctx => {
    const b = boutiqueParSlug(ctx.params.slug);
    const email = valider.email(ctx.corps.email);
    db.prepare('INSERT OR IGNORE INTO abonnes (boutique_id, email, cree_le) VALUES (?, ?, ?)').run(b.id, email, Date.now());
    relances.emailBienvenue({ db, boutique: b, config: lireConfig(b), email, urlPublique, envoyerEmail });
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
    const retour = `${urlPublique}/s/${b.slug}?commande=${c.id}&jeton=${row.jeton_client}`;
    const session = await paiement.creerSession({ paiement: pmt, commande: c, devise, urlRetour: retour, urlAnnulation: `${retour}&annule=1` });
    db.prepare('UPDATE paiements SET ref_externe = ? WHERE id = ?').run(session.refExterne, pmt.id);
    return { paiementUrl: session.url };
  });

  /* E-mails automatiques de toutes les boutiques (appelé régulièrement). */
  function automatisationsEcheances(maintenant = Date.now()) {
    let n = 0;
    for (const b of db.prepare('SELECT * FROM boutiques').all()) {
      const commandes = db.prepare('SELECT * FROM commandes WHERE boutique_id = ? AND date > ?').all(b.id, maintenant - 400 * 86400000).map(row => ({ ...lireCommande(row), jeton: row.jeton_client }));
      n += relances.executer({ db, boutique: b, config: lireConfig(b), commandes, maintenant, urlPublique, envoyerEmail, formatMontant,
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
    return { numero: c.numero, statut: c.statut, total: c.total, suivi: c.suivi || null, lignes: c.lignes.map(l => ({ nom: l.nom, qte: l.qte, prix: l.prix })) };
  });

  /* ---------- Webhooks ---------- */
  r.post('/api/webhooks/stripe', async ctx => {
    if (paiement.nom !== 'stripe' || !paiement.verifierWebhook(ctx.corpsBrut, ctx.req.headers['stripe-signature'])) throw erreur(400, 'Signature invalide.', 'signature');
    const ev = JSON.parse(ctx.corpsBrut);
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
      envoyerEmail(row.boutique_id, c.client.email, `Votre commande n° ${c.numero} est en route`, `Bonjour ${c.client.nom},\n\nVotre colis est parti avec ${c.transporteur}. Suivi : ${c.suivi}\n`);
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
  r.get('/paiement-simule/:id', ctx => { const { p, c, config } = chargerPaiementSimule(ctx.params.id); return { html: pageSimulation(p, c, config) }; });
  r.post('/paiement-simule/:id/confirmer', async ctx => {
    const { p, row } = chargerPaiementSimule(ctx.params.id);
    await paiementConfirme(p.id, p.id);
    return { redirection: `/s/${row.slug}?commande=${row.id}&jeton=${row.jeton_client}` };
  });
  r.post('/paiement-simule/:id/annuler', ctx => {
    const { p, row } = chargerPaiementSimule(ctx.params.id);
    if (p.statut === 'cree') db.prepare("UPDATE paiements SET statut = 'annule' WHERE id = ?").run(p.id);
    return { redirection: `/s/${row.slug}?commande=${row.id}&jeton=${row.jeton_client}&annule=1` };
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
    const url = new URL(req.url, 'http://local');
    const chemin = url.pathname;
    try {
      const route = r.trouver(req.method, chemin);
      if (!route) {
        if (req.method === 'GET') {
          if (chemin === '/' && servirStatique(res, RACINE_FRONT, 'accueil.html')) return;
          if ((chemin === '/app' || chemin === '/demo') && servirStatique(res, RACINE_FRONT, 'index.html')) return;
          if (/^\/s\/[\w-]+$/.test(chemin) && servirStatique(res, RACINE_FRONT, 'boutique.html')) return;
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
  return gerer;
}

function escHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { creerApp };
