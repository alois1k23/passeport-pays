/* Programme de fidélité sans compte client : points gagnés à chaque commande payée, utilisés comme remise.
   - Le client est reconnu par son e-mail ; la base n'en garde qu'une empreinte HMAC (pas de fichier de clients en plus).
   - Utiliser ses points demande un code à 6 chiffres envoyé à cette adresse : connaître l'e-mail de quelqu'un ne suffit
     pas pour dépenser ses points. Code valable 15 minutes, 5 essais, à usage unique.
   - Les points sont une remise (ils baissent le prix, donc la base de TVA), plafonnée à la moitié des articles.
   - Registre des mouvements : gain, utilisation, annulation (commande remboursée), expiration (compte inactif).
   - Points en entiers, montants en centimes entiers. */
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const DEFAUT = { actif: false, pointsParUnite: 1, valeurPour100: 500, seuil: 100, plafondPct: 50, expirationMois: 24 };
const normEmail = e => String(e || '').normalize('NFC').trim().toLowerCase();   // même normalisation que l'index des clients (pii.js)

function lireReglages(saisie, actuels = DEFAUT) {
  const s = { ...actuels, ...(saisie && typeof saisie === 'object' ? saisie : {}) };   // champs absents : valeurs actuelles
  const n = (v, min, max, nom, entier = true) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < min || x > max || (entier && !Number.isInteger(x))) throw erreur(400, `${nom} : entre ${min} et ${max}.`, 'reglage_invalide');
    return x;
  };
  const r = {
    actif: s.actif === true,
    pointsParUnite: n(s.pointsParUnite ?? DEFAUT.pointsParUnite, 1, 100, 'Points par unité dépensée'),
    valeurPour100: n(s.valeurPour100 ?? DEFAUT.valeurPour100, 10, 5000, 'Valeur de 100 points (centimes)'),
    seuil: n(s.seuil ?? DEFAUT.seuil, 10, 100000, 'Points minimum pour les utiliser'),
    plafondPct: n(s.plafondPct ?? DEFAUT.plafondPct, 5, 90, 'Part maximale de la commande payée en points'),
    expirationMois: n(s.expirationMois ?? DEFAUT.expirationMois, 6, 120, 'Expiration après inactivité (mois)')
  };
  // Générosité : part du prix rendue en points. Au-delà de 30 %, une erreur de saisie ruinerait la boutique.
  if (r.pointsParUnite * r.valeurPour100 / 100 > 30) throw erreur(400, `Programme trop généreux : ${(r.pointsParUnite * r.valeurPour100 / 100).toLocaleString('fr-FR')} % du prix rendus en points (30 % au maximum). Baissez les points gagnés ou leur valeur.`, 'reglage_invalide');
  return r;
}

function creer(db, cle) {
  db.exec(`CREATE TABLE IF NOT EXISTS fidelite_reglages (boutique_id TEXT PRIMARY KEY, donnees TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fidelite_comptes (boutique_id TEXT NOT NULL, empreinte TEXT NOT NULL, points INTEGER NOT NULL CHECK (points >= 0), actif_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, empreinte));
    CREATE TABLE IF NOT EXISTS fidelite_mouvements (id INTEGER PRIMARY KEY AUTOINCREMENT, boutique_id TEXT NOT NULL, empreinte TEXT NOT NULL, le INTEGER NOT NULL, type TEXT NOT NULL, points INTEGER NOT NULL, solde INTEGER NOT NULL, commande_id TEXT);
    CREATE INDEX IF NOT EXISTS fidelite_mvt ON fidelite_mouvements (boutique_id, empreinte, id);
    CREATE TABLE IF NOT EXISTS fidelite_codes (boutique_id TEXT NOT NULL, empreinte TEXT NOT NULL, code_hash TEXT NOT NULL, expire INTEGER NOT NULL, essais INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (boutique_id, empreinte));`);
  // Échecs par adresse sur 24 heures, conservés quand un nouveau code est envoyé : pas d'essais illimités en redemandant des codes.
  try { db.exec('ALTER TABLE fidelite_codes ADD COLUMN echecs INTEGER NOT NULL DEFAULT 0'); db.exec('ALTER TABLE fidelite_codes ADD COLUMN echecs_depuis INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
  const empreinte = (bid, email) => crypto.createHmac('sha256', cle).update(`fidelite:${bid}:${normEmail(email)}`).digest('hex');
  // Codes liés à leur demande (identifiant aléatoire remis au seul navigateur qui l'a faite) ; échecs comptés par adresse
  // ET par réseau : quelqu'un qui connaît l'adresse d'un client ne peut pas épuiser ses essais à sa place.
  db.exec(`CREATE TABLE IF NOT EXISTS fidelite_codes_demandes (boutique_id TEXT NOT NULL, empreinte TEXT NOT NULL, demande TEXT NOT NULL, code_hash TEXT NOT NULL, expire INTEGER NOT NULL, essais INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (boutique_id, empreinte, demande));
    CREATE TABLE IF NOT EXISTS fidelite_echecs (boutique_id TEXT NOT NULL, empreinte TEXT NOT NULL, reseau TEXT NOT NULL, echecs INTEGER NOT NULL, depuis INTEGER NOT NULL, PRIMARY KEY (boutique_id, empreinte, reseau));`);
  const hashDemande = d => crypto.createHash('sha256').update(String(d)).digest('hex');
  const echecsDe = (bid, emp, reseau, maintenant) => {
    const lignes = db.prepare('SELECT reseau, echecs FROM fidelite_echecs WHERE boutique_id = ? AND empreinte = ? AND depuis > ?').all(bid, emp, maintenant - 86400000);
    return { reseau: (lignes.find(l => l.reseau === reseau) || { echecs: 0 }).echecs, total: lignes.reduce((a, l) => a + l.echecs, 0) };
  };
  const hashCode = (bid, emp, code) => crypto.createHmac('sha256', cle).update(`code:${bid}:${emp}:${String(code)}`).digest();
  // Expiration en lot : index partiel (seuls les comptes qui ont encore des points), donc léger même avec beaucoup de comptes expirés.
  db.exec('DROP INDEX IF EXISTS fidelite_comptes_actif');
  db.exec('CREATE INDEX IF NOT EXISTS fidelite_comptes_a_expirer ON fidelite_comptes (boutique_id, actif_le) WHERE points > 0');
  // Mise à zéro + inscription au registre d'un seul tenant (point de sauvegarde : valable aussi dans une transaction en cours).
  const avecPoint = fn => { db.exec('SAVEPOINT fidelite_exp'); try { const r = fn(); db.exec('RELEASE fidelite_exp'); return r; } catch (e) { db.exec('ROLLBACK TO fidelite_exp'); db.exec('RELEASE fidelite_exp'); throw e; } };
  const inscrire = (bid, emp, type, points, solde, commandeId, le) => db.prepare('INSERT INTO fidelite_mouvements (boutique_id, empreinte, le, type, points, solde, commande_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(bid, emp, le, type, points, solde, commandeId || null);

  const api = {
    DEFAUT,
    reglages(bid) { const r = db.prepare('SELECT donnees FROM fidelite_reglages WHERE boutique_id = ?').get(bid); return r ? { ...DEFAUT, ...JSON.parse(r.donnees) } : { ...DEFAUT }; },
    ecrireReglages(bid, saisie, maintenant = Date.now()) {
      const avant = api.reglages(bid), r = lireReglages(saisie, avant);
      // Reprise après une pause : l'inactivité recommence à compter d'aujourd'hui (pendant la pause, personne ne pouvait gagner de points).
      if (r.actif && !avant.actif) db.prepare('UPDATE fidelite_comptes SET actif_le = MAX(actif_le, ?) WHERE boutique_id = ? AND points > 0').run(maintenant, bid);
      db.prepare('INSERT INTO fidelite_reglages (boutique_id, donnees) VALUES (?, ?) ON CONFLICT (boutique_id) DO UPDATE SET donnees = excluded.donnees').run(bid, JSON.stringify(r)); return r;
    },
    empreinte,
    /* Solde (points) ; un compte inactif depuis la durée d'expiration est remis à zéro (mouvement « expiration »). */
    solde(bid, email, maintenant = Date.now()) {
      const emp = empreinte(bid, email), r = db.prepare('SELECT * FROM fidelite_comptes WHERE boutique_id = ? AND empreinte = ?').get(bid, emp);
      if (!r) return 0;
      const reg = api.reglages(bid), exp = reg.expirationMois;
      if (reg.actif && r.points > 0 && r.actif_le < maintenant - exp * 30.44 * 86400000) {   // programme en pause : rien n'expire
        avecPoint(() => { db.prepare('UPDATE fidelite_comptes SET points = 0 WHERE boutique_id = ? AND empreinte = ?').run(bid, emp); inscrire(bid, emp, 'expiration', -r.points, 0, null, maintenant); });
        return 0;
      }
      return r.points;
    },
    /* Valeur en centimes d'un nombre de points. */
    valeur: (reg, points) => Math.floor(points * reg.valeurPour100 / 100),
    /* Points nécessaires pour une remise donnée (centimes), arrondis au point supérieur. */
    pointsPour: (reg, centimes) => Math.ceil(centimes * 100 / reg.valeurPour100),
    gagnes: (reg, centimesArticles) => Math.floor(centimesArticles / 100 * reg.pointsParUnite),
    crediter(bid, email, points, { commandeId, type = 'gain', maintenant = Date.now() } = {}) {
      if (!Number.isInteger(points) || points <= 0) return;
      api.solde(bid, email, maintenant);   // applique une éventuelle expiration avant d'ajouter
      const emp = empreinte(bid, email);
      const r = db.prepare('INSERT INTO fidelite_comptes (boutique_id, empreinte, points, actif_le) VALUES (?, ?, ?, ?) ON CONFLICT (boutique_id, empreinte) DO UPDATE SET points = points + excluded.points, actif_le = excluded.actif_le RETURNING points').get(bid, emp, points, maintenant);
      inscrire(bid, emp, type, points, r.points, commandeId, maintenant);
    },
    /* Débit borné au solde (jamais négatif) : renvoie les points réellement débités. */
    debiter(bid, email, points, { commandeId, type = 'utilisation', maintenant = Date.now() } = {}) {
      if (!Number.isInteger(points) || points <= 0) return 0;
      const dispo = api.solde(bid, email, maintenant), pris = Math.min(points, dispo);
      if (!pris) return 0;
      const emp = empreinte(bid, email);
      const r = db.prepare('UPDATE fidelite_comptes SET points = points - ?, actif_le = ? WHERE boutique_id = ? AND empreinte = ? AND points >= ? RETURNING points').get(pris, maintenant, bid, emp, pris);
      if (!r) return 0;
      inscrire(bid, emp, type, -pris, r.points, commandeId, maintenant);
      return pris;
    },
    /* Code à usage unique pour utiliser ses points (15 minutes, 5 essais), lié à sa demande. Renvoie { code, demande } :
       le code part par e-mail, la demande (aléatoire) revient au seul navigateur qui l'a faite. */
    nouveauCode(bid, email, maintenant = Date.now()) {
      const emp = empreinte(bid, email), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), demande = crypto.randomBytes(18).toString('base64url');
      db.prepare('DELETE FROM fidelite_codes_demandes WHERE expire < ?').run(maintenant - 86400000);   // ménage
      db.prepare('INSERT INTO fidelite_codes_demandes (boutique_id, empreinte, demande, code_hash, expire, essais) VALUES (?, ?, ?, ?, ?, 0)')
        .run(bid, emp, hashDemande(demande), hashCode(bid, emp, code).toString('hex'), maintenant + 15 * 60000);
      return { code, demande };
    },
    /* Vérifie le code de cette demande ; consommer = true l'efface (utilisation à la commande).
       Plafonds : 5 essais par code ; 10 échecs par adresse et par réseau sur 24 h ; 100 échecs par adresse, tous réseaux
       confondus (force brute impraticable, blocage d'un client par un tiers très coûteux). */
    verifierCode(bid, email, code, { demande, reseau = '', consommer = false, maintenant = Date.now() } = {}) {
      const emp = empreinte(bid, email), e = echecsDe(bid, emp, reseau, maintenant);
      if (e.reseau >= 10 || e.total >= 100 || !demande || !/^\d{6}$/.test(String(code || ''))) return false;
      const r = db.prepare('SELECT * FROM fidelite_codes_demandes WHERE boutique_id = ? AND empreinte = ? AND demande = ?').get(bid, emp, hashDemande(demande));
      if (!r || r.expire < maintenant || r.essais >= 5) return false;
      const ok = crypto.timingSafeEqual(Buffer.from(r.code_hash, 'hex'), hashCode(bid, emp, String(code)));
      if (!ok) {
        db.prepare('UPDATE fidelite_codes_demandes SET essais = essais + 1 WHERE boutique_id = ? AND empreinte = ? AND demande = ?').run(bid, emp, r.demande);
        db.prepare(`INSERT INTO fidelite_echecs (boutique_id, empreinte, reseau, echecs, depuis) VALUES (?, ?, ?, 1, ?)
          ON CONFLICT (boutique_id, empreinte, reseau) DO UPDATE SET echecs = CASE WHEN depuis > ? THEN echecs + 1 ELSE 1 END, depuis = CASE WHEN depuis > ? THEN depuis ELSE excluded.depuis END`).run(bid, emp, reseau, maintenant, maintenant - 86400000, maintenant - 86400000);
        return false;
      }
      if (consommer) db.prepare('DELETE FROM fidelite_codes_demandes WHERE boutique_id = ? AND empreinte = ?').run(bid, emp);
      return true;
    },
    /* Effacement d'un client (droit à l'effacement) : son compte, son code et ses mouvements (les autres totaux restent justes). */
    effacer(bid, email) {
      const emp = empreinte(bid, email);
      db.prepare('DELETE FROM fidelite_comptes WHERE boutique_id = ? AND empreinte = ?').run(bid, emp);
      db.prepare('DELETE FROM fidelite_codes WHERE boutique_id = ? AND empreinte = ?').run(bid, emp);
      db.prepare('DELETE FROM fidelite_codes_demandes WHERE boutique_id = ? AND empreinte = ?').run(bid, emp);
      db.prepare('DELETE FROM fidelite_echecs WHERE boutique_id = ? AND empreinte = ?').run(bid, emp);
      db.prepare('DELETE FROM fidelite_mouvements WHERE boutique_id = ? AND empreinte = ?').run(bid, emp);
    },
    /* Expiration des comptes inactifs, par lots (maintenance) : un lot = une transaction, le serveur reste disponible même
       pour une boutique de dizaines de milliers de clients. Programme en pause : rien n'expire (les clients ne pouvaient pas
       gagner de points). Renvoie le nombre de comptes remis à zéro dans ce lot. */
    expirer(bid, maintenant = Date.now(), { lot = 1000 } = {}) {
      const reg = api.reglages(bid);
      if (!reg.actif) return 0;
      const limite = maintenant - reg.expirationMois * 30.44 * 86400000;
      const comptes = db.prepare('SELECT empreinte, points FROM fidelite_comptes WHERE boutique_id = ? AND points > 0 AND actif_le < ? LIMIT ?').all(bid, limite, lot);
      if (!comptes.length) return 0;
      return avecPoint(() => {
        for (const r of comptes) { db.prepare('UPDATE fidelite_comptes SET points = 0 WHERE boutique_id = ? AND empreinte = ?').run(bid, r.empreinte); inscrire(bid, r.empreinte, 'expiration', -r.points, 0, null, maintenant); }
        return comptes.length;
      });
    },
    /* Points en circulation (engagement envers les clients), leur valeur, et ce qui expire dans les 30 jours sans achat.
       Lecture seule : les comptes déjà expirés (pas encore remis à zéro par la maintenance) ne sont pas comptés. */
    stats(bid, maintenant = Date.now()) {
      const reg = api.reglages(bid), limite = reg.actif ? maintenant - reg.expirationMois * 30.44 * 86400000 : 0;
      const r = db.prepare('SELECT COUNT(*) membres, COALESCE(SUM(points), 0) points FROM fidelite_comptes WHERE boutique_id = ? AND points > 0 AND actif_le >= ?').get(bid, limite);
      const b = reg.actif ? db.prepare('SELECT COUNT(*) comptes, COALESCE(SUM(points), 0) points FROM fidelite_comptes WHERE boutique_id = ? AND points > 0 AND actif_le >= ? AND actif_le < ?').get(bid, limite, limite + 30 * 86400000) : { comptes: 0, points: 0 };
      const m = db.prepare("SELECT type, COALESCE(SUM(points), 0) s FROM fidelite_mouvements WHERE boutique_id = ? AND le > ? GROUP BY type").all(bid, maintenant - 30 * 86400000);
      return { membres: r.membres, points: r.points, valeur: api.valeur(reg, r.points), bientot: { comptes: b.comptes, points: b.points }, trenteJours: Object.fromEntries(m.map(x => [x.type, x.s])) };
    },
    verifier(bid) {
      const ecarts = [];
      for (const c of db.prepare('SELECT empreinte, points FROM fidelite_comptes WHERE boutique_id = ?').all(bid)) {
        let cumul = 0;
        for (const m of db.prepare('SELECT points, solde FROM fidelite_mouvements WHERE boutique_id = ? AND empreinte = ? ORDER BY id').all(bid, c.empreinte)) { cumul += m.points; if (cumul !== m.solde) ecarts.push(c.empreinte); }
        if (cumul !== c.points) ecarts.push(c.empreinte);
      }
      return [...new Set(ecarts)];
    }
  };
  return api;
}

/* Remise en points appliquée aux lignes : prix unitaires réduits du même facteur (comme une remise en %), si bien que
   factures, TVA et facture électronique restent justes. Renvoie les lignes, la remise réelle (centimes) et les points. */
function appliquerPoints(lignes, reg, pointsDispo) {
  const articles = Math.round(lignes.reduce((a, l) => a + l.prix * l.qte, 0) * 100);
  if (!articles || pointsDispo < reg.seuil) return null;
  const cible = Math.min(Math.floor(pointsDispo * reg.valeurPour100 / 100), Math.floor(articles * reg.plafondPct / 100));
  if (cible <= 0) return null;
  const f = 1 - cible / articles;
  // Arrondi au centime supérieur : la remise réelle ne dépasse jamais la valeur des points ni le plafond.
  const nouvelles = lignes.map(l => ({ ...l, prix: Math.ceil(Math.round(l.prix * f * 1e6) / 1e4) / 100 }));
  const reelle = articles - Math.round(nouvelles.reduce((a, l) => a + l.prix * l.qte, 0) * 100);
  if (reelle <= 0) return null;
  const points = Math.min(pointsDispo, Math.ceil(reelle * 100 / reg.valeurPour100));
  return { lignes: nouvelles, remise: reelle, points };
}

module.exports = { creer, lireReglages, appliquerPoints, DEFAUT };
