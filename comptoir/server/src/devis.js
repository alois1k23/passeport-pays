/* Devis pour les clients professionnels : rédigé par le marchand, envoyé par un lien secret, accepté en ligne
   (« bon pour accord » avec le nom du signataire), puis transformé en commande payable.
   - Lignes du catalogue (prix TTC de la boutique) ou lignes libres saisies HT (prestation, article sur mesure).
   - Remise globale en %, frais de livraison, durée de validité.
   - Les montants sont calculés comme ceux d'une commande (prix nets TTC par ligne, taux de TVA figé) : la commande
     née du devis, sa facture et sa facture électronique reprennent exactement les montants acceptés.
   - Le lien contient un jeton aléatoire de 256 bits ; la base n'en garde que l'empreinte (SHA-256).
   - Une fois accepté, un devis ne change plus : la preuve d'acceptation (date, signataire, empreinte du réseau,
     empreinte du contenu accepté) est conservée. */
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');
const prix = require('./prix');
const FactureElectronique = require('./facture-electronique');

const r2 = n => Math.round(n * 100) / 100;
const STATUTS = ['brouillon', 'envoye', 'accepte', 'refuse', 'annule'];
const texte = (v, max, nom, { requis = false } = {}) => {
  const t = typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim() : '';
  if (requis && !t) throw erreur(400, `${nom} : obligatoire.`, 'invalide');
  if (t.length > max) throw erreur(400, `${nom} : ${max} caractères au maximum.`, 'invalide');
  return t;
};

/* Lignes et totaux d'un devis à partir de la saisie du marchand. Les prix du catalogue viennent de la base. */
function preparer(saisie, produits, config) {
  const s = saisie && typeof saisie === 'object' ? saisie : {};
  const normal = prix.tauxTva(config), reduit = prix.tauxReduit(config);
  if (!Array.isArray(s.lignes) || !s.lignes.length || s.lignes.length > 100) throw erreur(400, 'Un devis compte entre 1 et 100 lignes.', 'lignes_invalides');
  const remisePct = s.remisePct === undefined || s.remisePct === null || s.remisePct === '' ? 0 : Number(s.remisePct);
  if (!Number.isFinite(remisePct) || remisePct < 0 || remisePct > 90) throw erreur(400, 'Remise : entre 0 et 90 %.', 'remise_invalide');
  const lignes = s.lignes.map((l, i) => {
    if (!l || typeof l !== 'object') throw erreur(400, `Ligne ${i + 1} invalide.`, 'ligne_invalide');
    const qte = Number(l.qte);
    if (!Number.isInteger(qte) || qte < 1 || qte > 100000) throw erreur(400, `Ligne ${i + 1} : quantité entière entre 1 et 100 000.`, 'quantite_invalide');
    if (l.produitId) {
      const p = produits.find(x => x.id === l.produitId);
      if (!p) throw erreur(400, `Ligne ${i + 1} : produit introuvable.`, 'produit_introuvable');
      const v = Array.isArray(p.variantes) && p.variantes.length ? p.variantes.find(x => x.id === l.varianteId) : null;
      if (Array.isArray(p.variantes) && p.variantes.length && !v) throw erreur(400, `Ligne ${i + 1} : choisissez une variante de « ${p.nom} ».`, 'variante_requise');
      const t = p.tauxReduit ? reduit : normal, prixTtc = r2(v && typeof v.prix === 'number' ? v.prix : p.prix);
      return { produitId: p.id, ...(v ? { varianteId: v.id } : {}), nom: v ? `${p.nom} (${v.valeurs.join(' / ')})` : p.nom, qte, tauxTva: t, tauxReduit: !!p.tauxReduit, prixTtc, type: p.type || 'stock', source: p.source || null, fournisseur: p.fournisseur || null, ...(p.codeFournisseur ? { codeFournisseur: p.codeFournisseur } : {}) };
    }
    const nom = texte(l.nom, 200, `Ligne ${i + 1}, désignation`, { requis: true });
    const ht = Number(l.prixHt);
    if (!Number.isFinite(ht) || ht < 0 || ht > 1000000) throw erreur(400, `Ligne ${i + 1} : prix HT entre 0 et 1 000 000.`, 'prix_invalide');
    const t = l.tauxReduit ? reduit : normal;
    return { produitId: null, nom, qte, tauxTva: t, tauxReduit: !!l.tauxReduit, prixHtSaisi: ht, prixTtc: ht * (1 + t), type: 'libre' };
  });
  // Calcul par ligne (pas par unité) : le total d'une ligne de 1000 unités n'accumule pas l'arrondi de chaque unité.
  // Ligne libre : total HT = prix HT saisi × quantité, arrondi, puis TTC ; ligne du catalogue : prix TTC × quantité.
  // Le prix unitaire net (prix) est total ÷ quantité, non arrondi : les sommes de la commande et de la facture
  // retrouvent exactement ces totaux de ligne.
  for (const l of lignes) {
    const f = 1 - remisePct / 100;
    if (l.type === 'libre') { const htBrut = r2(l.prixHtSaisi * l.qte); l.totalTtcBrut = r2(htBrut * (1 + l.tauxTva)); l.totalTtc = r2(r2(htBrut * f) * (1 + l.tauxTva)); }
    else { l.totalTtcBrut = r2(l.prixTtc * l.qte); l.totalTtc = r2(l.totalTtcBrut * f); }
    l.prix = l.totalTtc / l.qte;
  }
  const port = s.port === undefined || s.port === null || s.port === '' ? 0 : r2(Number(s.port));
  if (!Number.isFinite(port) || port < 0 || port > 100000) throw erreur(400, 'Frais de livraison : entre 0 et 100 000.', 'port_invalide');
  const validiteJours = s.validiteJours === undefined || s.validiteJours === null || s.validiteJours === '' ? 30 : Number(s.validiteJours);
  if (!Number.isInteger(validiteJours) || validiteJours < 1 || validiteJours > 365) throw erreur(400, 'Validité : entre 1 et 365 jours.', 'validite_invalide');
  const c = s.client && typeof s.client === 'object' ? s.client : {};
  const email = texte(c.email, 200, 'E-mail du client', { requis: true }).toLowerCase();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email)) throw erreur(400, 'E-mail du client invalide.', 'email_invalide');
  const client = {
    raison: texte(c.raison, 150, 'Raison sociale', { requis: true }), contact: texte(c.contact, 100, 'Contact'), email,
    adresse: texte(c.adresse, 200, 'Adresse'), npa: texte(c.npa, 10, 'Code postal'), ville: texte(c.ville, 100, 'Ville'),
    pays: /^(fr|ch|be|de|it|lu|at|es|nl)$/.test(String(c.pays || '')) ? c.pays : config.boutique.pays, tva: texte(c.tva, 30, 'N° de TVA du client')
  };
  // Client d'un autre pays : TVA intracommunautaire (exonération, autoliquidation) ou export pas encore gérés ici.
  if (client.pays !== config.boutique.pays) throw erreur(400, 'Devis pour un client d’un autre pays : le régime de TVA (exonération intracommunautaire, autoliquidation, export) n’est pas encore géré par Comptoir. Établissez ce devis avec votre fiduciaire.', 'pays_client');
  const sousTotal = r2(lignes.reduce((a, l) => a + l.totalTtcBrut, 0));
  const totalLignes = r2(lignes.reduce((a, l) => a + l.totalTtc, 0));
  const total = r2(totalLignes + port);
  if (!(total > 0)) throw erreur(400, 'Le montant du devis doit être positif.', 'montant_invalide');
  return { client, lignes, remisePct, port, sousTotal, remise: r2(sousTotal - totalLignes), total, validiteJours, objet: texte(s.objet, 200, 'Objet'), conditions: texte(s.conditions, 2000, 'Conditions'), tauxTva: normal };
}

/* Ventilation par taux (bases HT, TVA) : même calcul que la facture. */
const ventiler = (d, config) => FactureElectronique.ventiler({ lignes: d.lignes, total: d.total, tauxTva: d.tauxTva }, prix.tauxTva(config));

/* Empreinte du contenu accepté (client, lignes, montants, conditions) : preuve de ce qui a été accepté. */
// Le signataire (ajouté à l'acceptation) ne fait pas partie du contenu accepté : l'empreinte se recalcule à l'identique.
const sansSignataire = c => { if (!c) return c; const { signataire, ...reste } = c; return reste; };
const empreinteContenu = (numero, d) => crypto.createHash('sha256').update(JSON.stringify([numero, sansSignataire(d.client), d.lignes.map(l => [l.nom, l.qte, l.prix, l.tauxTva]), d.port, d.total, d.conditions, d.valableJusquau])).digest('hex');

function creer(db, chiffrement = () => null) {
  // Coordonnées du client professionnel chiffrées au repos (même chiffrement que les commandes, lié au devis).
  const ctx = row => ({ boutique: row.boutique_id, commande: `devis:${row.id}` });
  const versStockage = (row, donnees) => { const P = chiffrement(); return JSON.stringify(P ? P.versStockage(donnees, ctx(row)) : donnees); };
  db.exec(`CREATE TABLE IF NOT EXISTS devis (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, numero TEXT NOT NULL, statut TEXT NOT NULL,
    cree_le INTEGER NOT NULL, maj_le INTEGER NOT NULL, jeton_hash TEXT, donnees TEXT NOT NULL, UNIQUE (boutique_id, numero))`);
  db.exec('CREATE INDEX IF NOT EXISTS devis_boutique ON devis (boutique_id, cree_le)');
  try { db.exec('ALTER TABLE boutiques ADD COLUMN compteur_devis INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
  const lire = row => {
    if (!row) return row;
    const P = chiffrement(), d0 = JSON.parse(row.donnees), d = P ? P.depuisStockage(d0, ctx(row)) : d0;
    // Signataire gardé avec les coordonnées chiffrées ; présenté dans l'acceptation comme avant.
    if (d.acceptation && d.client && d.client.signataire && !d.acceptation.nom) d.acceptation = { ...d.acceptation, nom: d.client.signataire };
    return { id: row.id, numero: row.numero, statut: row.statut, creeLe: row.cree_le, majLe: row.maj_le, ...d };
  };
  const ecrire = (d, maintenant = Date.now()) => {
    const { id, numero, statut, creeLe, majLe, ...donnees } = d;
    if (donnees.acceptation && donnees.acceptation.nom) { const { nom, ...acc } = donnees.acceptation; donnees.acceptation = acc; if (donnees.client && !donnees.client.signataire) donnees.client = { ...donnees.client, signataire: nom }; }   // jamais en clair
    const b = db.prepare('SELECT boutique_id FROM devis WHERE id = ?').get(id);
    db.prepare('UPDATE devis SET statut = ?, maj_le = ?, donnees = ? WHERE id = ?').run(statut, maintenant, versStockage({ id, boutique_id: b ? b.boutique_id : '' }, donnees), id);
  };
  const hash = j => crypto.createHash('sha256').update(String(j)).digest('hex');
  const api = {
    lire, ecrire, STATUTS,
    /* Rotation de clé : coordonnées chiffrées avec une ancienne clé, rechiffrées avec la courante (appelé au démarrage).
       Un chiffré illisible est laissé tel quel. */
    renouvelerCle() {
      const P = chiffrement(); if (!P) return 0;
      let n = 0;
      for (const row of db.prepare("SELECT * FROM devis WHERE json_valid(donnees) AND json_extract(donnees, '$.clientChiffre') IS NOT NULL").all()) {
        const d0 = JSON.parse(row.donnees);
        try { if (!P.aRenouveler(d0.clientChiffre, ctx(row))) continue; } catch { continue; }
        db.prepare('UPDATE devis SET donnees = ? WHERE id = ?').run(versStockage(row, P.depuisStockage(d0, ctx(row))), row.id); n++;
      }
      return n;
    },
    /* Devis d'avant le chiffrement : coordonnées du client chiffrées une fois (appelé au démarrage). */
    chiffrerAnciens() {
      if (!chiffrement()) return 0;
      let n = 0;
      for (const row of db.prepare("SELECT * FROM devis WHERE json_valid(donnees) AND json_extract(donnees, '$.client') IS NOT NULL").all()) {
        db.prepare('UPDATE devis SET donnees = ? WHERE id = ?').run(versStockage(row, JSON.parse(row.donnees)), row.id); n++;
      }
      return n;
    },
    nouveau(boutiqueId, contenu, maintenant = Date.now()) {
      const n = db.prepare('UPDATE boutiques SET compteur_devis = compteur_devis + 1 WHERE id = ? RETURNING compteur_devis').get(boutiqueId).compteur_devis;
      const numero = `DE-${new Date(maintenant).getFullYear()}-${String(n).padStart(4, '0')}`;
      const id = `dv_${crypto.randomBytes(9).toString('base64url')}`;
      const donnees = { ...contenu, historique: [{ date: maintenant, texte: 'Devis créé' }] };
      db.prepare('INSERT INTO devis (id, boutique_id, numero, statut, cree_le, maj_le, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, boutiqueId, numero, 'brouillon', maintenant, maintenant, versStockage({ id, boutique_id: boutiqueId }, donnees));
      return lire(db.prepare('SELECT * FROM devis WHERE id = ?').get(id));
    },
    deBoutique(boutiqueId, id) {
      const d = lire(db.prepare('SELECT * FROM devis WHERE id = ? AND boutique_id = ?').get(id, boutiqueId));
      if (!d) throw erreur(404, 'Devis introuvable.', 'introuvable');
      return d;
    },
    /* Effacement d'un client (RGPD) : ses devis sont anonymisés (montants et lignes gardés pour la comptabilité). */
    anonymiser(boutiqueId, email, normaliser = e => String(e || '').trim().toLowerCase()) {
      let n = 0;
      for (const row of db.prepare('SELECT * FROM devis WHERE boutique_id = ?').all(boutiqueId)) {
        const d = lire(row);
        if (!d.client || d.client.illisible || normaliser(d.client.email) !== normaliser(email)) continue;
        d.client = { raison: 'Client effacé', contact: '', email: '', adresse: '', npa: '', ville: '', pays: d.client.pays, tva: '' };
        if (d.acceptation) d.acceptation = { ...d.acceptation, nom: undefined };
        d.historique.push({ date: Date.now(), texte: 'Coordonnées du client effacées (demande du client)' });
        api.ecrire(d); db.prepare('UPDATE devis SET jeton_hash = NULL WHERE id = ?').run(d.id); n++;
      }
      return n;
    },
    lister(boutiqueId) { return db.prepare('SELECT * FROM devis WHERE boutique_id = ? ORDER BY cree_le DESC LIMIT 500').all(boutiqueId).map(lire); },
    /* Nouveau lien : l'ancien ne fonctionne plus. Renvoie le jeton en clair (à mettre dans le lien, jamais stocké). */
    nouveauJeton(id) { const j = crypto.randomBytes(32).toString('base64url'); db.prepare('UPDATE devis SET jeton_hash = ? WHERE id = ?').run(hash(j), id); return j; },
    /* Devis d'après son lien public (comparaison en temps constant de l'empreinte du jeton). */
    parLien(boutiqueId, id, jeton) {
      const row = db.prepare('SELECT * FROM devis WHERE id = ? AND boutique_id = ?').get(id, boutiqueId);
      if (!row || !row.jeton_hash || typeof jeton !== 'string' || jeton.length > 100) return null;
      const a = Buffer.from(row.jeton_hash, 'hex'), b = Buffer.from(hash(jeton), 'hex');
      return crypto.timingSafeEqual(a, b) ? lire(row) : null;
    },
    expire: (d, maintenant = Date.now()) => d.statut === 'envoye' && d.valableJusquau && d.valableJusquau < maintenant,
    empreinteContenu
  };
  return api;
}

module.exports = { creer, preparer, ventiler, empreinteContenu };
