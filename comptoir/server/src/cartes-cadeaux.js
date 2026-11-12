/* Cartes cadeaux : émission, solde, utilisation en ligne et en caisse, registre des mouvements.
   - Le code (16 caractères, 80 bits d'aléa, alphabet sans caractères ambigus) n'est montré qu'une fois, à l'émission.
     La base ne garde qu'une empreinte HMAC (clé hors de la base en production) et les 4 derniers caractères :
     une copie de la base ne permet pas d'utiliser les cartes.
   - Montants en centimes entiers. Chaque débit est une seule instruction conditionnelle (solde suffisant, carte
     active, non expirée) : deux paiements simultanés ne peuvent pas dépenser deux fois le même solde.
   - Chaque mouvement est inscrit au registre avec le solde qui en résulte : solde = somme des mouvements, vérifiable.
   Sur le plan fiscal, une carte utilisable pour tout le catalogue est un « bon à usages multiples » : pas de TVA à la
   vente de la carte, la TVA est due sur les articles achetés avec. La carte est donc un moyen de paiement, pas une remise. */
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

  const empreinte = (boutiqueId, code) => crypto.createHmac('sha256', cle).update(`carte-cadeau:${boutiqueId}:${normaliser(code)}`).digest('hex');
  const inscrire = (carte, type, montant, solde, commandeId, texte, le) => db.prepare('INSERT INTO cartes_mouvements (carte_id, boutique_id, le, type, montant, solde, commande_id, texte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(carte.id, carte.boutique_id, le, type, montant, solde, commandeId || null, texte ? String(texte).slice(0, 200) : null);
  const publique = row => row && ({ id: row.id, fin: row.fin, initial: row.initial / 100, solde: row.solde / 100, devise: row.devise, statut: row.statut, creeLe: row.cree_le, expireLe: row.expire_le, destinataire: row.destinataire, note: row.note, origine: row.origine });

  return {
    normaliser, formater,
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
    publique
  };
}

module.exports = { creer, normaliser, formater, genererCode };
