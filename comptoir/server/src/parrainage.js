/* Comptoir — parrainage : un client recommande la boutique avec son code personnel (« AMI… »).
   - Le filleul obtient une remise sur sa première commande dans cette boutique (pas sur sa propre adresse de parrain).
   - Le parrain reçoit un code de remise à usage unique (« MERCI… ») 14 jours après le paiement du filleul, si la commande
     n'a été ni annulée ni remboursée entre-temps : payer, toucher la récompense puis se faire rembourser ne rapporte rien.
   - Adresse et nom du parrain chiffrés au repos ; index aveugle de l'e-mail pour le retrouver, l'effacer, le comparer au
     filleul. Les codes ne contiennent rien de personnel.
   Module sans dépendance d'Express : la base, le chiffrement (pii) et la date sont fournis par l'application. */
'use strict';
const crypto = require('node:crypto');

const MAX_PARRAINS = 50000, DELAI_RECOMPENSE = 14 * 86400000, VALIDITE_RECOMPENSE = 365 * 86400000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans I, O, 0, 1 (lus à voix haute ou recopiés)
const aleatoire = n => [...crypto.randomBytes(n)].map(x => ALPHABET[x % ALPHABET.length]).join('');
const STATUTS_GARDES = ['payee', 'preparation', 'expediee', 'livree', 'prete', 'retiree'];

/* Réglages de la boutique : { actif, filleul (remise du filleul, %), parrain (remise du code de récompense, %) }. */
function nettoyerReglages(r) {
  const x = r && typeof r === 'object' ? r : {};
  const pct = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.max(5, Math.min(30, Math.round(Number(v)))) : d);
  return { actif: x.actif === true, filleul: pct(x.filleul, 10), parrain: pct(x.parrain, 10) };
}

function creerParrainage({ db, pii }) {
  db.exec(`CREATE TABLE IF NOT EXISTS parrains (boutique_id TEXT NOT NULL, code TEXT NOT NULL, email_index TEXT NOT NULL, donnees TEXT NOT NULL, cree_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, code));
    CREATE UNIQUE INDEX IF NOT EXISTS parrains_client ON parrains(boutique_id, email_index);
    CREATE TABLE IF NOT EXISTS filleuls (commande_id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, code TEXT NOT NULL, statut TEXT NOT NULL, cree_le INTEGER NOT NULL, paye_le INTEGER, recompense TEXT);
    CREATE INDEX IF NOT EXISTS filleuls_echeance ON filleuls(statut, paye_le);
    CREATE TABLE IF NOT EXISTS recompenses (boutique_id TEXT NOT NULL, code TEXT NOT NULL, email_index TEXT NOT NULL, remise INTEGER NOT NULL, cree_le INTEGER NOT NULL, expire INTEGER NOT NULL, PRIMARY KEY (boutique_id, code));`);
  const P = () => pii();
  const index = (bid, email) => { const x = P(); const e = String(email || '').trim().toLowerCase(); return x ? x.index(bid, e) : crypto.createHash('sha256').update(`${bid}|${e}`).digest('hex'); };
  const fermer = (bid, code, o) => { const x = P(); return x ? x.chiffrer(o, { boutique: bid, commande: `parrain:${code}` }) : JSON.stringify(o); };
  const ouvrir = (bid, code, t) => { const x = P(); try { return x && /^v\d\./.test(t) ? x.dechiffrer(t, { boutique: bid, commande: `parrain:${code}` }) : JSON.parse(t); } catch { return null; } };
  const normaliser = c => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

  /* Code personnel d'un client (créé à la première demande, le même ensuite). null si la boutique en a déjà trop. */
  function codePour(bid, email, nom, maintenant = Date.now()) {
    const idx = index(bid, email);
    const r = db.prepare('SELECT code FROM parrains WHERE boutique_id = ? AND email_index = ?').get(bid, idx);
    if (r) return r.code;
    if (db.prepare('SELECT COUNT(*) n FROM parrains WHERE boutique_id = ?').get(bid).n >= MAX_PARRAINS) return null;
    for (let i = 0; i < 5; i++) {
      const code = 'AMI' + aleatoire(6);
      try { db.prepare('INSERT INTO parrains (boutique_id, code, email_index, donnees, cree_le) VALUES (?, ?, ?, ?, ?)').run(bid, code, idx, fermer(bid, code, { email: String(email).trim().toLowerCase(), nom: String(nom || '').slice(0, 120) }), maintenant); return code; }
      catch (e) { if (!/UNIQUE/.test(e.message)) throw e; if (db.prepare('SELECT 1 FROM parrains WHERE boutique_id = ? AND email_index = ?').get(bid, idx)) return codePour(bid, email, nom, maintenant); }
    }
    return null;
  }

  /* Code saisi : parrainage (filleul) ou récompense (parrain). Renvoie { type, code, remise, emailIndex } ou null. */
  function trouver(bid, saisi, reglages, maintenant = Date.now()) {
    const code = normaliser(saisi); if (!code) return null;
    if (/^AMI[A-Z0-9]{6}$/.test(code)) {
      if (!reglages.actif) return null;
      const r = db.prepare('SELECT email_index FROM parrains WHERE boutique_id = ? AND code = ?').get(bid, code);
      return r ? { type: 'filleul', code, remise: reglages.filleul, emailIndex: r.email_index } : null;
    }
    if (/^MERCI[A-Z0-9]{6}$/.test(code)) {
      // Une récompense déjà gagnée reste valable même si le marchand arrête le programme ensuite.
      const r = db.prepare('SELECT email_index, remise, cree_le, expire FROM recompenses WHERE boutique_id = ? AND code = ?').get(bid, code);
      return r && r.expire > maintenant ? { type: 'recompense', code, remise: r.remise, emailIndex: r.email_index, cree: r.cree_le } : null;
    }
    return null;
  }

  /* Commande d'un filleul créée (en attente de paiement). */
  function noterFilleul(bid, commandeId, code, maintenant = Date.now()) {
    db.prepare("INSERT OR IGNORE INTO filleuls (commande_id, boutique_id, code, statut, cree_le) VALUES (?, ?, ?, 'attente', ?)").run(commandeId, bid, code, maintenant);
  }
  function payee(commandeId, maintenant = Date.now()) {
    db.prepare("UPDATE filleuls SET paye_le = ? WHERE commande_id = ? AND statut = 'attente' AND paye_le IS NULL").run(maintenant, commandeId);
  }

  /* Échéances (tâche horaire) : commandes de filleuls payées depuis 14 jours. statutDe(id) : statut actuel de la commande.
     Renvoie les récompenses à envoyer : [{ bid, email, nom, code, remise, expire, filleulCommande }]. */
  function echeances(statutDe, reglagesDe, maintenant = Date.now()) {
    const aEnvoyer = [];
    // Commandes jamais payées (abandonnées) : oubliées après 30 jours.
    db.prepare("DELETE FROM filleuls WHERE statut = 'attente' AND paye_le IS NULL AND cree_le < ?").run(maintenant - 30 * 86400000);
    for (const f of db.prepare("SELECT * FROM filleuls WHERE statut = 'attente' AND paye_le IS NOT NULL AND paye_le <= ? LIMIT 500").all(maintenant - DELAI_RECOMPENSE)) {
      const st = statutDe(f.commande_id);
      if (!STATUTS_GARDES.includes(st)) { db.prepare("UPDATE filleuls SET statut = 'annule' WHERE commande_id = ?").run(f.commande_id); continue; }
      const p = db.prepare('SELECT * FROM parrains WHERE boutique_id = ? AND code = ?').get(f.boutique_id, f.code);
      const d = p && ouvrir(f.boutique_id, p.code, p.donnees);
      if (!p || !d || !d.email) { db.prepare("UPDATE filleuls SET statut = 'annule' WHERE commande_id = ?").run(f.commande_id); continue; }   // parrain effacé entre-temps
      const remise = reglagesDe(f.boutique_id).parrain, code = 'MERCI' + aleatoire(6), expire = maintenant + VALIDITE_RECOMPENSE;
      // Une seule fois par commande de filleul : le passage à « credite » et la création du code vont ensemble.
      const fait = db.prepare("UPDATE filleuls SET statut = 'credite', recompense = ? WHERE commande_id = ? AND statut = 'attente'").run(code, f.commande_id);
      if (!fait.changes) continue;
      db.prepare('INSERT INTO recompenses (boutique_id, code, email_index, remise, cree_le, expire) VALUES (?, ?, ?, ?, ?, ?)').run(f.boutique_id, code, p.email_index, remise, maintenant, expire);
      aEnvoyer.push({ bid: f.boutique_id, email: d.email, nom: d.nom, code, remise, expire, filleulCommande: f.commande_id });
    }
    return aEnvoyer;
  }

  function stats(bid) {
    const n = s => db.prepare(`SELECT COUNT(*) n FROM filleuls WHERE boutique_id = ? AND statut = '${s}'`).get(bid).n;
    return { parrains: db.prepare('SELECT COUNT(*) n FROM parrains WHERE boutique_id = ?').get(bid).n, enAttente: db.prepare("SELECT COUNT(*) n FROM filleuls WHERE boutique_id = ? AND statut = 'attente' AND paye_le IS NOT NULL").get(bid).n, recompenses: n('credite') };
  }
  /* Effacement des données d'un client (droit à l'effacement) : son code de parrain et ses récompenses disparaissent. */
  function effacer(bid, emailIndex) {
    db.prepare('DELETE FROM parrains WHERE boutique_id = ? AND email_index = ?').run(bid, emailIndex);
    db.prepare('DELETE FROM recompenses WHERE boutique_id = ? AND email_index = ?').run(bid, emailIndex);
  }
  function supprimerBoutique(bid) { for (const t of ['parrains', 'filleuls', 'recompenses']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(bid); }

  return { codePour, trouver, noterFilleul, payee, echeances, stats, effacer, supprimerBoutique, index, normaliser };
}

module.exports = { creerParrainage, nettoyerReglages, DELAI_RECOMPENSE };
