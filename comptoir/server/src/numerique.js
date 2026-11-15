/* Comptoir — produits numériques : le fichier d'un produit (livre, musique, patron, logiciel…) livré après paiement.
   - Le fichier arrive en morceaux d'1 Mo (la limite de 2 Mo par requête reste la même partout), avec son empreinte
     SHA-256 contrôlée à la fin : un fichier tronqué ou mélangé n'est jamais enregistré.
   - Chaque achat reçoit des liens personnels : seule l'empreinte du jeton est gardée, valable 30 jours et
     5 téléchargements. Une commande remboursée ou annulée ne télécharge plus rien.
   - Le fichier part toujours en pièce jointe (jamais affiché par le navigateur sur le domaine de Comptoir), avec un nom
     nettoyé. */
'use strict';
const crypto = require('node:crypto');

const TAILLE_MAX = 25 * 1024 * 1024, MORCEAU = 1024 * 1024, STOCKAGE_BOUTIQUE = 200 * 1024 * 1024;
const DUREE_LIEN = 30 * 86400000, TELECHARGEMENTS = 5;
const EXTENSIONS = { pdf: 'application/pdf', epub: 'application/epub+zip', mobi: 'application/x-mobipocket-ebook', zip: 'application/zip', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', stl: 'model/stl', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf' };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

/* Nom de fichier sûr : une ligne, sans chemin ni caractère de contrôle ou d'inversion, extension autorisée. */
function nomSur(nom) {
  const n = String(nom || '').normalize('NFC').replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069"<>:|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const ext = (n.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
  return ext && EXTENSIONS[ext.toLowerCase()] && n.length > ext.length + 1 ? { nom: n, ext: ext.toLowerCase(), type: EXTENSIONS[ext.toLowerCase()] } : null;
}

function creerNumerique({ db, erreur }) {
  db.exec(`CREATE TABLE IF NOT EXISTS fichiers_numeriques (produit_id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, nom TEXT NOT NULL, type TEXT NOT NULL, taille INTEGER NOT NULL, empreinte TEXT NOT NULL, donnees BLOB NOT NULL, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS fichiers_numeriques_boutique ON fichiers_numeriques(boutique_id);
    CREATE TABLE IF NOT EXISTS envois_fichiers (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, produit_id TEXT NOT NULL, nom TEXT NOT NULL, type TEXT NOT NULL, taille INTEGER NOT NULL, empreinte TEXT NOT NULL, morceaux INTEGER NOT NULL, cree_le INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS envois_morceaux (envoi_id TEXT NOT NULL, rang INTEGER NOT NULL, donnees BLOB NOT NULL, PRIMARY KEY (envoi_id, rang));
    CREATE TABLE IF NOT EXISTS telechargements (jeton_hash TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, commande_id TEXT NOT NULL, produit_id TEXT NOT NULL, expire_le INTEGER NOT NULL, restants INTEGER NOT NULL, utilises INTEGER NOT NULL DEFAULT 0, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS telechargements_commande ON telechargements(commande_id);`);

  const fichierDe = pid => db.prepare('SELECT nom, type, taille, empreinte, cree_le FROM fichiers_numeriques WHERE produit_id = ?').get(pid) || null;
  // Espace utilisé : fichiers enregistrés et envois en cours (sinon 60 envois commencés ensemble dépasseraient le quota).
  const stockage = (bid, sauf = null) => db.prepare('SELECT COALESCE(SUM(taille), 0) n FROM fichiers_numeriques WHERE boutique_id = ?').get(bid).n + db.prepare('SELECT COALESCE(SUM(taille), 0) n FROM envois_fichiers WHERE boutique_id = ? AND id IS NOT ?').get(bid, sauf).n;

  function commencer(bid, pid, { nom, taille, empreinte }) {
    const f = nomSur(nom);
    if (!f) throw erreur(400, `Type de fichier non accepté. Formats possibles : ${Object.keys(EXTENSIONS).join(', ')}.`, 'fichier_type');
    const t = Number(taille);
    if (!Number.isInteger(t) || t < 1 || t > TAILLE_MAX) throw erreur(400, `Fichier de 25 Mo au plus.`, 'fichier_taille');
    if (!/^[0-9a-f]{64}$/.test(String(empreinte || ''))) throw erreur(400, 'Empreinte du fichier invalide.', 'fichier_empreinte');
    const actuel = fichierDe(pid);
    if (stockage(bid) - (actuel ? actuel.taille : 0) + t > STOCKAGE_BOUTIQUE) throw erreur(409, 'Espace des fichiers numériques plein (200 Mo par boutique) : retirez un fichier inutilisé.', 'fichier_stockage');
    // Un seul envoi en cours par produit ; les envois abandonnés depuis plus d'une heure sont effacés.
    for (const e of db.prepare('SELECT id FROM envois_fichiers WHERE produit_id = ? OR cree_le < ?').all(pid, Date.now() - 3600000)) { db.prepare('DELETE FROM envois_morceaux WHERE envoi_id = ?').run(e.id); db.prepare('DELETE FROM envois_fichiers WHERE id = ?').run(e.id); }
    const id = 'env_' + crypto.randomBytes(12).toString('hex');
    db.prepare('INSERT INTO envois_fichiers (id, boutique_id, produit_id, nom, type, taille, empreinte, morceaux, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, bid, pid, f.nom, f.type, t, String(empreinte), Math.ceil(t / MORCEAU), Date.now());
    return { envoi: id, morceau: MORCEAU, morceaux: Math.ceil(t / MORCEAU) };
  }
  const envoiDe = (bid, pid, id) => {
    const e = db.prepare('SELECT * FROM envois_fichiers WHERE id = ? AND boutique_id = ? AND produit_id = ?').get(String(id || ''), bid, pid);
    if (!e) throw erreur(404, 'Envoi introuvable ou expiré : recommencez.', 'envoi_introuvable');
    return e;
  };
  function morceau(bid, pid, { envoi, rang, donnees }) {
    const e = envoiDe(bid, pid, envoi), r = Number(rang);
    if (!Number.isInteger(r) || r < 0 || r >= e.morceaux) throw erreur(400, 'Morceau hors du fichier.', 'morceau_invalide');
    if (typeof donnees !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(donnees)) throw erreur(400, 'Morceau illisible.', 'morceau_invalide');
    const b = Buffer.from(donnees, 'base64'), attendu = r === e.morceaux - 1 ? e.taille - r * MORCEAU : MORCEAU;
    if (b.length !== attendu) throw erreur(400, 'Morceau de taille inattendue.', 'morceau_invalide');
    db.prepare('INSERT OR REPLACE INTO envois_morceaux (envoi_id, rang, donnees) VALUES (?, ?, ?)').run(e.id, r, b);
    return { recu: r };
  }
  function terminer(bid, pid, { envoi }) {
    const e = envoiDe(bid, pid, envoi);
    const parts = db.prepare('SELECT rang, donnees FROM envois_morceaux WHERE envoi_id = ? ORDER BY rang').all(e.id);
    if (parts.length !== e.morceaux || parts.some((p, i) => p.rang !== i)) throw erreur(409, 'Fichier incomplet : recommencez l’envoi.', 'fichier_incomplet');
    const b = Buffer.concat(parts.map(p => Buffer.from(p.donnees)));
    const actuel = fichierDe(pid), ailleurs = stockage(bid, e.id) - (actuel ? actuel.taille : 0);
    db.prepare('DELETE FROM envois_morceaux WHERE envoi_id = ?').run(e.id); db.prepare('DELETE FROM envois_fichiers WHERE id = ?').run(e.id);
    if (b.length !== e.taille || sha256(b) !== e.empreinte) throw erreur(409, 'Le fichier reçu ne correspond pas à l’original (empreinte différente) : recommencez l’envoi.', 'fichier_empreinte');
    if (ailleurs + b.length > STOCKAGE_BOUTIQUE) throw erreur(409, 'Espace des fichiers numériques plein (200 Mo par boutique) : retirez un fichier inutilisé.', 'fichier_stockage');
    db.prepare('INSERT OR REPLACE INTO fichiers_numeriques (produit_id, boutique_id, nom, type, taille, empreinte, donnees, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(pid, bid, e.nom, e.type, e.taille, e.empreinte, b, Date.now());
    return fichierDe(pid);
  }
  const retirer = (bid, pid) => db.prepare('DELETE FROM fichiers_numeriques WHERE produit_id = ? AND boutique_id = ?').run(pid, bid).changes > 0;

  /* Liens d'une commande payée : un par produit numérique qui a un fichier. Les anciens liens de la commande sont
     révoqués (renvoi par le marchand). Renvoie les jetons en clair, à mettre dans l'e-mail, jamais gardés. */
  function creerLiens(bid, c) {
    const pids = [...new Set(c.lignes.filter(l => l.numerique).map(l => l.produitId))].filter(pid => fichierDe(pid));
    db.prepare('DELETE FROM telechargements WHERE commande_id = ?').run(c.id);
    return pids.map(pid => {
      const jeton = crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO telechargements (jeton_hash, boutique_id, commande_id, produit_id, expire_le, restants, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha256(jeton), bid, c.id, pid, Date.now() + DUREE_LIEN, TELECHARGEMENTS, Date.now());
      const l = c.lignes.find(x => x.produitId === pid);
      return { jeton, produitId: pid, nom: l ? l.nom : 'Fichier', fichier: fichierDe(pid).nom };
    });
  }
  const etatLiens = commandeId => db.prepare('SELECT produit_id produitId, expire_le expireLe, restants, utilises FROM telechargements WHERE commande_id = ?').all(commandeId);
  const revoquerLiens = commandeId => db.prepare('DELETE FROM telechargements WHERE commande_id = ?').run(commandeId).changes;

  /* Téléchargement : un essai de moins, de façon atomique ; la commande doit être payée (ni remboursée, ni annulée). */
  function telecharger(jeton, commandePermise, { essai = false } = {}) {
    const h = sha256(String(jeton || ''));
    const t = db.prepare('SELECT * FROM telechargements WHERE jeton_hash = ?').get(h);
    if (!t || t.expire_le < Date.now()) throw erreur(404, 'Ce lien de téléchargement a expiré. Demandez un nouveau lien à la boutique.', 'lien_expire');
    if (!commandePermise(t.commande_id)) throw erreur(410, 'Cette commande a été remboursée ou annulée : le téléchargement n’est plus possible.', 'commande_close');
    const f = db.prepare('SELECT nom, type, donnees FROM fichiers_numeriques WHERE produit_id = ? AND boutique_id = ?').get(t.produit_id, t.boutique_id);
    if (!f) throw erreur(404, 'Le fichier n’est plus disponible : contactez la boutique.', 'fichier_absent');
    if (essai) return { nom: f.nom, donnees: Buffer.alloc(0) };   // HEAD (aperçu de lien, antivirus de messagerie) : rien de décompté
    if (t.restants <= 0 || !db.prepare('UPDATE telechargements SET restants = restants - 1, utilises = utilises + 1 WHERE jeton_hash = ? AND restants > 0 AND expire_le > ? RETURNING restants').get(h, Date.now()))
      throw erreur(429, `Ce lien a déjà servi ${TELECHARGEMENTS} fois. Demandez un nouveau lien à la boutique.`, 'lien_epuise');
    return { nom: f.nom, donnees: Buffer.from(f.donnees) };
  }
  // Ménage : envois abandonnés, liens expirés depuis 30 jours.
  function menage(maintenant = Date.now()) {
    for (const e of db.prepare('SELECT id FROM envois_fichiers WHERE cree_le < ?').all(maintenant - 3600000)) { db.prepare('DELETE FROM envois_morceaux WHERE envoi_id = ?').run(e.id); db.prepare('DELETE FROM envois_fichiers WHERE id = ?').run(e.id); }
    db.prepare('DELETE FROM telechargements WHERE expire_le < ?').run(maintenant - DUREE_LIEN);
  }
  const toutSupprimer = bid => { for (const t of ['fichiers_numeriques', 'telechargements', 'envois_fichiers']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(bid); db.prepare('DELETE FROM envois_morceaux WHERE envoi_id NOT IN (SELECT id FROM envois_fichiers)').run(); };
  return { toutSupprimer, fichierDe, commencer, morceau, terminer, retirer, creerLiens, etatLiens, revoquerLiens, telecharger, menage, TAILLE_MAX, TELECHARGEMENTS, DUREE_LIEN };
}

/* En-tête Content-Disposition : pièce jointe, nom ASCII de repli et nom UTF-8 encodé (RFC 6266 / 5987). */
function dispositionPieceJointe(nom) {
  const ascii = String(nom).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

module.exports = { creerNumerique, nomSur, dispositionPieceJointe, EXTENSIONS };
