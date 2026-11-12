/* Journal inaltérable des pièces de vente : factures, tickets de caisse et avoirs.
   Chaque pièce est scellée une seule fois, dès son émission, dans une chaîne de hachage propre à la boutique :
   empreinte = SHA-256(empreinte précédente | contenu). Modifier, supprimer ou insérer une pièce après coup casse la chaîne,
   et une pièce dont la commande a été modifiée ne correspond plus à son sceau : la vérification le montre.
   Chaque jour d'activité est clôturé (nombre de pièces, total du jour, grand total perpétuel), et l'empreinte de la
   dernière clôture part chaque lundi dans le rapport du marchand : une copie hors du serveur, qui empêche de recalculer
   toute la chaîne en silence.
   Ce sont les principes d'inaltérabilité, de sécurisation, de conservation et d'archivage demandés en France aux
   logiciels de caisse (art. 286, I-3° bis du CGI). Le journal ne vaut pas certification (NF 525 ou attestation de l'éditeur).
   Le contenu scellé ne contient aucune donnée personnelle du client : l'effacement d'un client (RGPD) reste possible. */
'use strict';
const crypto = require('node:crypto');

const ORIGINE = '0'.repeat(64);
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const centimes = n => Math.round(Number(n || 0) * 100);
// Jour civil à Zurich (même fuseau pour la France et la Belgique).
const jourDe = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

function creerTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS journal_inalterable (
    boutique_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, ref TEXT NOT NULL, commande_id TEXT, le INTEGER NOT NULL,
    contenu TEXT NOT NULL, empreinte TEXT NOT NULL, PRIMARY KEY (boutique_id, seq), UNIQUE (boutique_id, type, ref))`);
}

/* Contenu scellé d'une pièce, champs dans un ordre fixe. */
function contenuPiece(type, c) {
  const avoir = type === 'avoir';
  const lignes = (c.lignes || []).map(l => [String(l.nom), Number(l.qte), centimes(l.prix), typeof l.tauxTva === 'number' ? Math.round(l.tauxTva * 1000) : null]);
  return JSON.stringify({
    type, numero: avoir ? c.avoir.numero : c.facture, commande: c.numero, date: avoir ? c.avoir.date : (c.dateFacture || c.date),
    canal: c.canal || 'web', total: (avoir ? -1 : 1) * centimes(avoir ? (c.avoir.montant ?? c.total) : c.total),
    port: centimes(c.port), remise: centimes(c.remise), lignes, factureOrigine: avoir ? c.facture : undefined
  });
}

function ajouter(db, boutiqueId, type, ref, commandeId, contenu, le) {
  const dernier = db.prepare('SELECT seq, empreinte FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq DESC LIMIT 1').get(boutiqueId);
  const seq = dernier ? dernier.seq + 1 : 1;
  const empreinte = sha256(`${dernier ? dernier.empreinte : ORIGINE}|${seq}|${type}|${ref}|${le}|${contenu}`);
  db.prepare('INSERT INTO journal_inalterable (boutique_id, seq, type, ref, commande_id, le, contenu, empreinte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(boutiqueId, seq, type, ref, commandeId, le, contenu, empreinte);
  return empreinte;
}

/* Scelle la facture (ou le ticket) et l'avoir d'une commande s'ils ne le sont pas encore. Idempotent. */
function sceller(db, boutiqueId, c, maintenant = Date.now()) {
  const faits = [];
  const deja = (type, ref) => db.prepare('SELECT 1 FROM journal_inalterable WHERE boutique_id = ? AND type = ? AND ref = ?').get(boutiqueId, type, ref);
  if (c.facture) {
    const type = c.canal === 'magasin' ? 'ticket' : 'facture';
    if (!deja(type, c.facture)) { ajouter(db, boutiqueId, type, c.facture, c.id, contenuPiece(type, c), maintenant); faits.push(c.facture); }
  }
  if (c.avoir && c.avoir.numero && !deja('avoir', c.avoir.numero)) { ajouter(db, boutiqueId, 'avoir', c.avoir.numero, c.id, contenuPiece('avoir', c), maintenant); faits.push(c.avoir.numero); }
  return faits;
}

/* Clôture des jours d'activité terminés (avant aujourd'hui) : une entrée par jour, avec le grand total perpétuel. */
function cloturer(db, boutiqueId, maintenant = Date.now()) {
  const aujourdHui = jourDe(maintenant);
  const derniere = db.prepare("SELECT ref, contenu FROM journal_inalterable WHERE boutique_id = ? AND type = 'cloture' ORDER BY seq DESC LIMIT 1").get(boutiqueId);
  let grandTotal = derniere ? JSON.parse(derniere.contenu).grandTotal : 0;
  const depuis = derniere ? db.prepare("SELECT seq FROM journal_inalterable WHERE boutique_id = ? AND type = 'cloture' AND ref = ?").get(boutiqueId, derniere.ref).seq : 0;
  const pieces = db.prepare("SELECT le, contenu FROM journal_inalterable WHERE boutique_id = ? AND seq > ? AND type != 'cloture' ORDER BY seq").all(boutiqueId, depuis);
  const parJour = new Map();
  for (const p of pieces) { const j = jourDe(p.le); if (j >= aujourdHui) continue; if (!parJour.has(j)) parJour.set(j, []); parJour.get(j).push(JSON.parse(p.contenu)); }
  let n = 0;
  for (const [jour, liste] of [...parJour].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (derniere && jour <= derniere.ref) continue;   // jour déjà clôturé (pièce scellée en retard : comptée le jour suivant)
    const totalJour = liste.reduce((a, x) => a + x.total, 0);
    grandTotal += totalJour;
    const contenu = JSON.stringify({ jour, pieces: liste.length, factures: liste.filter(x => x.type !== 'avoir').length, avoirs: liste.filter(x => x.type === 'avoir').length, totalJour, grandTotal });
    ajouter(db, boutiqueId, 'cloture', jour, null, contenu, maintenant);
    n++;
  }
  return n;
}

/* Vérifie la chaîne entière et la concordance de chaque pièce avec sa commande actuelle.
   lireCommande(id) renvoie la commande (ou null si elle n'existe plus). */
function verifier(db, boutiqueId, lireCommande) {
  const entrees = db.prepare('SELECT * FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq').all(boutiqueId);
  const anomalies = [];
  let prec = ORIGINE, attendu = 1;
  for (const e of entrees) {
    if (e.seq !== attendu) anomalies.push(`Entrée n° ${attendu} manquante (suppression).`);
    attendu = e.seq + 1;
    if (sha256(`${prec}|${e.seq}|${e.type}|${e.ref}|${e.le}|${e.contenu}`) !== e.empreinte) anomalies.push(`Entrée n° ${e.seq} (${e.ref}) modifiée : son empreinte ne correspond plus.`);
    prec = e.empreinte;
    if (e.type === 'cloture' || !e.commande_id) continue;
    const c = lireCommande(e.commande_id);
    if (!c) { anomalies.push(`${e.ref} : la commande a été supprimée.`); continue; }
    const refActuelle = e.type === 'avoir' ? (c.avoir && c.avoir.numero) : c.facture;
    if (refActuelle !== e.ref || contenuPiece(e.type, c) !== e.contenu) anomalies.push(`${e.ref} : la pièce ne correspond plus à son sceau (montant, articles ou numéro modifiés).`);
  }
  const derniere = [...entrees].reverse().find(e => e.type === 'cloture');
  return {
    ok: !anomalies.length, anomalies: anomalies.slice(0, 50), nbAnomalies: anomalies.length,
    pieces: entrees.filter(e => e.type !== 'cloture').length, clotures: entrees.filter(e => e.type === 'cloture').length,
    empreinte: entrees.length ? entrees[entrees.length - 1].empreinte : null,
    derniereCloture: derniere ? { jour: derniere.ref, empreinte: derniere.empreinte, ...JSON.parse(derniere.contenu) } : null
  };
}

/* Export CSV (archivage) : toutes les entrées, avec leur empreinte. */
function exporterCsv(db, boutiqueId) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lignes = db.prepare('SELECT * FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq').all(boutiqueId).map(e => {
    const d = JSON.parse(e.contenu);
    return [e.seq, e.type, q(e.ref), new Date(e.le).toISOString(), e.type === 'cloture' ? (d.totalJour / 100).toFixed(2) : (d.total / 100).toFixed(2), e.type === 'cloture' ? (d.grandTotal / 100).toFixed(2) : '', e.empreinte, q(e.contenu)].join(';');
  });
  return '﻿' + ['seq', 'type', 'reference', 'scelle_le', 'montant', 'grand_total', 'empreinte', 'contenu'].join(';') + '\n' + lignes.join('\n') + '\n';
}

module.exports = { creerTables, sceller, cloturer, verifier, exporterCsv, contenuPiece, jourDe, ORIGINE };
