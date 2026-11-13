/* Cartes cadeaux : émission, solde, utilisation en ligne et en caisse, registre des mouvements.
   - Le code (16 caractères, 80 bits d'aléa, alphabet sans caractères ambigus) n'est montré qu'une fois, à l'émission.
     La base ne garde qu'une empreinte HMAC (clé hors de la base en production) et les 4 derniers caractères :
     une copie de la base ne permet pas d'utiliser les cartes.
   - Montants en centimes entiers. Chaque débit est une seule instruction conditionnelle (solde suffisant, carte
     active, non expirée) : deux paiements simultanés ne peuvent pas dépenser deux fois le même solde.
   - Chaque mouvement est inscrit au registre avec le solde qui en résulte : solde = somme des mouvements, vérifiable.
   La carte est un moyen de paiement, pas une remise : la facture des articles achetés avec elle porte leur TVA.
   Fiscalité de la vente d'une carte : bon « à usages multiples » (TVA à l'utilisation) dans le cas général ; dans l'UE,
   une boutique à un seul taux qui ne vend que dans son pays émet un bon « à usage unique » (TVA dès la vente). */
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // base 32 de Crockford : ni I, L, O, U
const normaliser = code => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').slice(0, 32);
const formater = code => code.match(/.{4}/g).join('-');
const centimes = n => Math.round(Number(n) * 100);

function genererCode() {
  const octets = crypto.randomBytes(16);
  let code = ''; for (const o of octets) code += ALPHABET[o & 31];   // 16 × 5 bits = 80 bits
  return code;
}

function creer(db, cle) {
  db.exec(`CREATE TABLE IF NOT EXISTS cartes_cadeaux (
    id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, empreinte TEXT NOT NULL, fin TEXT NOT NULL,
    initial INTEGER NOT NULL, solde INTEGER NOT NULL CHECK (solde >= 0), devise TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'active', cree_le INTEGER NOT NULL, expire_le INTEGER, destinataire TEXT, note TEXT, origine TEXT NOT NULL,
    UNIQUE (boutique_id, empreinte))`);
  db.exec(`CREATE TABLE IF NOT EXISTS cartes_mouvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, carte_id TEXT NOT NULL, boutique_id TEXT NOT NULL, le INTEGER NOT NULL,
    type TEXT NOT NULL, montant INTEGER NOT NULL, solde INTEGER NOT NULL, commande_id TEXT, texte TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS cartes_mouvements_carte ON cartes_mouvements (carte_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS cartes_cadeaux_boutique ON cartes_cadeaux (boutique_id, cree_le)');
  db.exec('CREATE INDEX IF NOT EXISTS cartes_mouvements_boutique_le ON cartes_mouvements (boutique_id, le)');   // export par période
  db.exec('CREATE TABLE IF NOT EXISTS cartes_vente (boutique_id TEXT PRIMARY KEY, donnees TEXT NOT NULL)');

  const empreinte = (boutiqueId, code) => crypto.createHmac('sha256', cle).update(`carte-cadeau:${boutiqueId}:${normaliser(code)}`).digest('hex');
  const inscrire = (carte, type, montant, solde, commandeId, texte, le) => db.prepare('INSERT INTO cartes_mouvements (carte_id, boutique_id, le, type, montant, solde, commande_id, texte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(carte.id, carte.boutique_id, le, type, montant, solde, commandeId || null, texte ? String(texte).slice(0, 200) : null);
  const publique = row => row && ({ id: row.id, fin: row.fin, initial: row.initial / 100, solde: row.solde / 100, devise: row.devise, statut: row.statut, creeLe: row.cree_le, expireLe: row.expire_le, destinataire: row.destinataire, note: row.note, origine: row.origine });

  const VENTE_DEFAUT = { actif: false, montants: [25, 50, 100], validiteMois: 24 };
  return {
    normaliser, formater,
    /* Vente en ligne (le client achète une carte dans la boutique) : réglages du marchand. */
    reglagesVente(bid) { const r = db.prepare('SELECT donnees FROM cartes_vente WHERE boutique_id = ?').get(bid); return r ? { ...VENTE_DEFAUT, ...JSON.parse(r.donnees) } : { ...VENTE_DEFAUT }; },
    ecrireReglagesVente(bid, s, pays) {
      const montants = [...new Set((Array.isArray(s.montants) ? s.montants : []).map(m => Math.round(Number(m) * 100) / 100))].filter(m => Number.isFinite(m)).sort((a, b) => a - b);
      if (s.actif === true && (!montants.length || montants.length > 8 || montants.some(m => m < 5 || m > 1000 || Math.abs(Math.round(m * 100) - m * 100) > 1e-6))) throw erreur(400, 'Montants proposés : de 1 à 8 montants entre 5 et 1000.', 'invalide');
      const mois = Number(s.validiteMois ?? 24);
      if (!Number.isInteger(mois) || mois < (pays === 'be' ? 24 : 12) || mois > 120) throw erreur(400, `Validité : entre ${pays === 'be' ? 24 : 12} et 120 mois.`, 'invalide');
      const r = { actif: s.actif === true, montants: montants.length ? montants : VENTE_DEFAUT.montants, validiteMois: mois };
      db.prepare('INSERT INTO cartes_vente (boutique_id, donnees) VALUES (?, ?) ON CONFLICT (boutique_id) DO UPDATE SET donnees = excluded.donnees').run(bid, JSON.stringify(r));
      return r;
    },
    /* Émet une carte : renvoie la carte et son code complet (seule fois où il existe en clair). */
    emettre(boutiqueId, { montant, devise, expireLe = null, destinataire = null, note = null, origine = 'manuelle', commandeId = null, maintenant = Date.now() }) {
      const c = centimes(montant);
      if (!Number.isInteger(c) || c < 100 || c > 1000000) throw erreur(400, 'Montant de la carte : entre 1 et 10 000.', 'montant_invalide');
      for (let essai = 0; essai < 5; essai++) {
        const code = genererCode(), id = `cc_${crypto.randomBytes(9).toString('base64url')}`;
        try {
          db.prepare('INSERT INTO cartes_cadeaux (id, boutique_id, empreinte, fin, initial, solde, devise, cree_le, expire_le, destinataire, note, origine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, boutiqueId, empreinte(boutiqueId, code), code.slice(-4), c, c, devise, maintenant, expireLe, destinataire, note, origine);
        } catch (e) { if (/UNIQUE/.test(e.message)) continue; throw e; }
        const carte = db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ?').get(id);
        inscrire(carte, 'emission', c, c, commandeId, origine === 'manuelle' ? 'Carte émise' : 'Carte vendue', maintenant);
        return { carte: publique(carte), code: formater(code) };
      }
      throw erreur(500, 'Émission impossible pour l’instant.', 'emission');
    },
    /* Carte d'après son code (null si inconnue). */
    trouver(boutiqueId, code) {
      if (normaliser(code).length !== 16) return null;
      return db.prepare('SELECT * FROM cartes_cadeaux WHERE boutique_id = ? AND empreinte = ?').get(boutiqueId, empreinte(boutiqueId, code)) || null;
    },
    /* Montant utilisable maintenant, en centimes (0 si désactivée, expirée ou épuisée). */
    disponible(row, maintenant = Date.now()) {
      if (!row || row.statut !== 'active' || (row.expire_le && row.expire_le <= maintenant)) return 0;
      return row.solde;
    },
    /* Débit atomique : true si le solde suffisait (et le mouvement est inscrit), false sinon. À appeler dans une transaction. */
    debiter(carteId, montant, { commandeId, texte, maintenant = Date.now() } = {}) {
      if (!Number.isInteger(montant) || montant <= 0) return false;
      const r = db.prepare("UPDATE cartes_cadeaux SET solde = solde - ? WHERE id = ? AND statut = 'active' AND solde >= ? AND (expire_le IS NULL OR expire_le > ?) RETURNING *").get(montant, carteId, montant, maintenant);
      if (!r) return false;
      inscrire(r, 'utilisation', -montant, r.solde, commandeId, texte, maintenant);
      return true;
    },
    /* Crédit (commande annulée ou remboursée, paiement abandonné) : toujours possible, même sur une carte expirée. */
    crediter(carteId, montant, { commandeId, texte, type = 'recredit', maintenant = Date.now() } = {}) {
      if (!Number.isInteger(montant) || montant <= 0) return;
      const r = db.prepare('UPDATE cartes_cadeaux SET solde = solde + ? WHERE id = ? RETURNING *').get(montant, carteId);
      if (r) inscrire(r, type, montant, r.solde, commandeId, texte, maintenant);
    },
    desactiver(boutiqueId, id, maintenant = Date.now()) {
      const r = db.prepare("UPDATE cartes_cadeaux SET statut = 'desactivee' WHERE id = ? AND boutique_id = ? AND statut = 'active' RETURNING *").get(id, boutiqueId);
      if (!r) throw erreur(404, 'Carte introuvable ou déjà désactivée.', 'introuvable');
      inscrire(r, 'desactivation', 0, r.solde, null, 'Carte désactivée', maintenant);
      return publique(r);
    },
    lister(boutiqueId, limite = 500) { return db.prepare('SELECT * FROM cartes_cadeaux WHERE boutique_id = ? ORDER BY cree_le DESC LIMIT ?').all(boutiqueId, limite).map(publique); },
    detail(boutiqueId, id) {
      const r = db.prepare('SELECT * FROM cartes_cadeaux WHERE id = ? AND boutique_id = ?').get(id, boutiqueId);
      if (!r) throw erreur(404, 'Carte introuvable.', 'introuvable');
      const mouvements = db.prepare('SELECT le, type, montant, solde, commande_id, texte FROM cartes_mouvements WHERE carte_id = ? ORDER BY id').all(id)
        .map(m => ({ le: m.le, type: m.type, montant: m.montant / 100, solde: m.solde / 100, commandeId: m.commande_id, texte: m.texte }));
      return { carte: publique(r), mouvements };
    },
    /* Contrôle du registre : pour chaque carte, solde = somme des mouvements, et chaque solde inscrit = cumul. */
    verifier(boutiqueId) {
      const ecarts = [];
      for (const carte of db.prepare('SELECT id, solde FROM cartes_cadeaux WHERE boutique_id = ?').all(boutiqueId)) {
        let cumul = 0;
        for (const m of db.prepare('SELECT montant, solde FROM cartes_mouvements WHERE carte_id = ? ORDER BY id').all(carte.id)) { cumul += m.montant; if (m.solde !== cumul) ecarts.push(carte.id); }
        if (cumul !== carte.solde) ecarts.push(carte.id);
      }
      return [...new Set(ecarts)];
    },
    /* Export pour la fiduciaire : tous les mouvements d'une période, puis, à la fin de la période :
       - l'encours (cartes actives, non expirées : un engagement envers les clients) ;
       - les cartes annulées (vente remboursée ou contestée : l'argent est revenu au client, ce n'est pas un gain) ;
       - les soldes de cartes expirées ou désactivées par la boutique (à traiter selon le conseil de la fiduciaire).
       numeros : Map id de commande → numéro ; annulees : Set des cartes dont la vente a été remboursée ou contestée.
       Montants avec une virgule décimale (tableurs en français). Deux requêtes, quel que soit le nombre de cartes. */
    exporter(boutiqueId, { debut, fin, numeros = new Map(), annulees = new Set() }) {
      const q = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };   // pas de formule dans un tableur
      const m2 = c => (c / 100).toFixed(2).replace('.', ',');
      const LIB = { emission: 'Émission', utilisation: 'Utilisation', recredit: 'Recrédit', remboursement: 'Recrédit (remboursement)', desactivation: 'Désactivation' };
      const lignes = [['date', 'carte', 'origine', 'mouvement', 'montant', 'solde_apres', 'commande', 'texte'].join(';')];
      for (const m of db.prepare('SELECT m.*, c.fin, c.origine FROM cartes_mouvements m JOIN cartes_cadeaux c ON c.id = m.carte_id WHERE m.boutique_id = ? AND m.le >= ? AND m.le < ? ORDER BY m.le, m.id').all(boutiqueId, debut, fin)) {
        lignes.push([q(new Date(m.le).toISOString()), q(`····${m.fin}`), q(m.origine === 'vente' ? 'vendue' : 'émise par la boutique'), q(LIB[m.type] || m.type), m2(m.montant), m2(m.solde), q(m.commande_id ? (numeros.get(m.commande_id) ?? '') : ''), q(m.texte || '')].join(';'));
      }
      // Solde de chaque carte à la date de fin : celui du dernier mouvement inscrit (ordre d'inscription, celui du cumul).
      const etats = db.prepare(`SELECT c.id, c.expire_le, (SELECT solde FROM cartes_mouvements WHERE carte_id = c.id AND le < ? ORDER BY id DESC LIMIT 1) AS solde,
          EXISTS (SELECT 1 FROM cartes_mouvements WHERE carte_id = c.id AND type = 'desactivation' AND le < ?) AS desactivee
        FROM cartes_cadeaux c WHERE c.boutique_id = ? AND c.cree_le < ?`).all(fin, fin, boutiqueId, fin);
      let encours = 0, perdus = 0, annule = 0, nbEncours = 0;
      for (const c of etats) {
        if (!c.solde) continue;
        if (annulees.has(c.id)) annule += c.solde;
        else if (c.desactivee || (c.expire_le && c.expire_le <= fin)) perdus += c.solde;
        else { encours += c.solde; nbEncours++; }
      }
      lignes.push('');
      lignes.push([q(`Encours au ${new Date(fin - 1).toISOString().slice(0, 10)}`), q(`${nbEncours} carte(s)`), '', q('Solde des cartes actives non expirées'), m2(encours), '', '', ''].join(';'));
      lignes.push([q('Cartes annulées'), '', '', q('Vente remboursée ou contestée : solde rendu au client, pas un gain'), m2(annule), '', '', ''].join(';'));
      lignes.push([q('Soldes non utilisables'), '', '', q('Cartes expirées ou désactivées : traitement à voir avec la fiduciaire'), m2(perdus), '', '', ''].join(';'));
      return '﻿' + lignes.join('\n') + '\n';
    },
    publique
  };
}

module.exports = { creer, normaliser, formater, genererCode };
