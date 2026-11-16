/* Comptoir — parrainage : un client recommande la boutique avec son code personnel (« AMI… »).
   - Le filleul obtient une remise sur sa première commande dans cette boutique (pas sur sa propre adresse de parrain).
   - Le parrain reçoit un code de remise à usage unique (« MERCI… ») 14 jours après la LIVRAISON (ou le retrait) de la
     commande du filleul, fin du délai de rétractation, si elle n'a été ni annulée, ni remboursée même en partie, ni
     contestée (litige), ni retournée. Une seule récompense par filleul (adresse ramenée à sa forme canonique : sans
     « +étiquette », sans les points chez Gmail), 10 au plus par parrain et par an, et un montant minimum de commande.
   - Adresse et nom du parrain chiffrés au repos ; index aveugle de l'e-mail pour le retrouver, l'effacer, le comparer au
     filleul. Les codes ne contiennent rien de personnel.
   Module sans dépendance d'Express : la base, le chiffrement (pii) et la date sont fournis par l'application. */
'use strict';
const crypto = require('node:crypto');

const MAX_PARRAINS = 50000, DELAI_RECOMPENSE = 14 * 86400000, VALIDITE_RECOMPENSE = 365 * 86400000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans I, O, 0, 1 (lus à voix haute ou recopiés)
const aleatoire = n => [...crypto.randomBytes(n)].map(x => ALPHABET[x % ALPHABET.length]).join('');
const STATUTS_PAYES = ['payee', 'preparation', 'fournisseur', 'expediee', 'livree', 'prete', 'retiree'];
const STATUTS_LIVRES = ['livree', 'retiree'];
const PLAFOND_PARRAIN = 10;   // récompenses par parrain sur 12 mois
/* Forme canonique d'une adresse pour les contrôles anti-abus : minuscules, sans « +étiquette » ; chez Gmail, sans les
   points et googlemail.com ramené à gmail.com. Jamais stockée en clair (seulement son index aveugle). */
function canonique(email) {
  const e = String(email || '').trim().toLowerCase(), at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).replace(/\+.*$/, ''), domaine = e.slice(at + 1);
  if (domaine === 'googlemail.com') domaine = 'gmail.com';
  if (domaine === 'gmail.com') local = local.replace(/\./g, '');
  // Proton : points, tirets et soulignés ignorés ; quatre domaines pour la même boîte.
  if (['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me'].includes(domaine)) { domaine = 'proton.me'; local = local.replace(/[._-]/g, ''); }
  // Yahoo : « nom-motcle » est une adresse jetable de la boîte « nom ».
  if (/^yahoo\.[a-z.]+$/.test(domaine) || domaine === 'ymail.com') local = local.replace(/-.*$/, '');
  return `${local}@${domaine}`;
}

/* Réglages de la boutique : { actif, filleul (remise du filleul, %), parrain (remise du code de récompense, %) }. */
function nettoyerReglages(r) {
  const x = r && typeof r === 'object' ? r : {};
  const pct = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.max(5, Math.min(30, Math.round(Number(v)))) : d);
  // Montant minimum de la commande du filleul (articles après remise) : 0 à 500, 20 par défaut.
  const minimum = Number.isFinite(Number(x.minimum)) && x.minimum !== '' && x.minimum !== null ? Math.max(0, Math.min(500, Math.round(Number(x.minimum)))) : 20;
  return { actif: x.actif === true, filleul: pct(x.filleul, 10), parrain: pct(x.parrain, 10), minimum };
}

function creerParrainage({ db, pii }) {
  db.exec(`CREATE TABLE IF NOT EXISTS parrains (boutique_id TEXT NOT NULL, code TEXT NOT NULL, email_index TEXT NOT NULL, donnees TEXT NOT NULL, cree_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, code));
    CREATE UNIQUE INDEX IF NOT EXISTS parrains_client ON parrains(boutique_id, email_index);
    CREATE TABLE IF NOT EXISTS filleuls (commande_id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, code TEXT NOT NULL, statut TEXT NOT NULL, cree_le INTEGER NOT NULL, paye_le INTEGER, recompense TEXT);
    CREATE INDEX IF NOT EXISTS filleuls_echeance ON filleuls(statut, paye_le);
    CREATE TABLE IF NOT EXISTS recompenses (boutique_id TEXT NOT NULL, code TEXT NOT NULL, email_index TEXT NOT NULL, remise INTEGER NOT NULL, cree_le INTEGER NOT NULL, expire INTEGER NOT NULL, PRIMARY KEY (boutique_id, code));`);
  for (const [t, col] of [['parrains', 'reseau TEXT'], ['parrains', 'canon TEXT'], ['filleuls', 'filleul_canon TEXT'], ['filleuls', 'livre_le INTEGER'], ['recompenses', 'parrain_code TEXT']]) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${col}`); } catch { /* déjà là */ } }
  db.exec('CREATE INDEX IF NOT EXISTS filleuls_canon ON filleuls(boutique_id, filleul_canon)');
  const P = () => pii();
  const index = (bid, email) => { const x = P(); const e = String(email || '').trim().toLowerCase(); return x ? x.index(bid, e) : crypto.createHash('sha256').update(`${bid}|${e}`).digest('hex'); };
  const fermer = (bid, code, o) => { const x = P(); return x ? x.chiffrer(o, { boutique: bid, commande: `parrain:${code}` }) : JSON.stringify(o); };
  const ouvrir = (bid, code, t) => { const x = P(); try { return x && /^v\d\./.test(t) ? x.dechiffrer(t, { boutique: bid, commande: `parrain:${code}` }) : JSON.parse(t); } catch { return null; } };
  const indexCanon = (bid, email) => index(bid, canonique(email));
  const normaliser = c => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

  /* Code personnel d'un client (créé à la première demande, le même ensuite). null si la boutique en a déjà trop. */
  /* reseau : empreinte réseau de la commande qui a donné le code (jamais l'adresse IP) : une commande de filleul venue du
     même réseau ne rapporte pas de récompense. Une adresse et ses alias (forme canonique) n'ont qu'un seul code. */
  function codePour(bid, email, nom, maintenant = Date.now(), reseau = null) {
    const idx = index(bid, email), canon = indexCanon(bid, email);
    const r = db.prepare('SELECT code FROM parrains WHERE boutique_id = ? AND (email_index = ? OR canon = ?) ORDER BY cree_le LIMIT 1').get(bid, idx, canon);
    if (r) { if (reseau) db.prepare('UPDATE parrains SET reseau = ? WHERE boutique_id = ? AND code = ?').run(String(reseau).slice(0, 80), bid, r.code); return r.code; }
    if (db.prepare('SELECT COUNT(*) n FROM parrains WHERE boutique_id = ?').get(bid).n >= MAX_PARRAINS) return null;
    for (let i = 0; i < 5; i++) {
      const code = 'AMI' + aleatoire(6);
      try { db.prepare('INSERT INTO parrains (boutique_id, code, email_index, donnees, cree_le, canon, reseau) VALUES (?, ?, ?, ?, ?, ?, ?)').run(bid, code, idx, fermer(bid, code, { email: String(email).trim().toLowerCase(), nom: String(nom || '').slice(0, 120) }), maintenant, canon, reseau ? String(reseau).slice(0, 80) : null); return code; }
      catch (e) { if (!/UNIQUE/.test(e.message)) throw e; if (db.prepare('SELECT 1 FROM parrains WHERE boutique_id = ? AND email_index = ?').get(bid, idx)) return codePour(bid, email, nom, maintenant); }
    }
    return null;
  }

  /* Code saisi : parrainage (filleul) ou récompense (parrain). Renvoie { type, code, remise, emailIndex } ou null. */
  function trouver(bid, saisi, reglages, maintenant = Date.now()) {
    const code = normaliser(saisi); if (!code) return null;
    if (/^AMI[A-Z0-9]{6}$/.test(code)) {
      if (!reglages.actif) return null;
      const r = db.prepare('SELECT email_index, canon FROM parrains WHERE boutique_id = ? AND code = ?').get(bid, code);
      return r ? { type: 'filleul', code, remise: reglages.filleul, minimum: reglages.minimum, emailIndex: r.email_index, canonIndex: r.canon || r.email_index } : null;
    }
    if (/^MERCI[A-Z0-9]{6}$/.test(code)) {
      // Une récompense déjà gagnée reste valable même si le marchand arrête le programme ensuite.
      const r = db.prepare('SELECT email_index, remise, cree_le, expire FROM recompenses WHERE boutique_id = ? AND code = ?').get(bid, code);
      return r && r.expire > maintenant ? { type: 'recompense', code, remise: r.remise, emailIndex: r.email_index, cree: r.cree_le } : null;
    }
    return null;
  }

  /* Commande d'un filleul créée (en attente de paiement). */
  function noterFilleul(bid, commandeId, code, emailFilleul, maintenant = Date.now()) {
    db.prepare("INSERT OR IGNORE INTO filleuls (commande_id, boutique_id, code, statut, cree_le, filleul_canon) VALUES (?, ?, ?, 'attente', ?, ?)").run(commandeId, bid, code, maintenant, indexCanon(bid, emailFilleul));
  }
  /* Ce client (forme canonique) a-t-il déjà été parrainé ici (récompense versée ou en cours) ? */
  // Comme le code de bienvenue : une commande abandonnée (lien de paiement fermé depuis 35 minutes) ne compte pas ;
  // une commande payée, sur facture, ou encore payable, oui.
  const dejaParraine = (bid, email, saufCommande = '', maintenant = Date.now()) => !!db.prepare(`SELECT 1 FROM filleuls f JOIN commandes c ON c.id = f.commande_id
      WHERE f.boutique_id = ? AND f.filleul_canon = ? AND f.commande_id <> ? AND c.statut NOT IN ('annulee', 'remboursee')
        AND (c.statut <> 'attente' OR json_extract(c.donnees, '$.moyen') = 'facture' OR EXISTS (SELECT 1 FROM paiements p WHERE p.commande_id = c.id AND p.statut = 'cree' AND p.cree_le > ?)) LIMIT 1`).get(bid, indexCanon(bid, email), saufCommande, maintenant - 35 * 60000);
  function payee(commandeId, maintenant = Date.now()) {
    db.prepare("UPDATE filleuls SET paye_le = ? WHERE commande_id = ? AND statut = 'attente' AND paye_le IS NULL").run(maintenant, commandeId);
  }

  const annulerFilleul = id => db.prepare("UPDATE filleuls SET statut = 'annule' WHERE commande_id = ? AND statut = 'attente'").run(id);
  const oublierCommande = id => db.prepare('DELETE FROM filleuls WHERE commande_id = ?').run(id);   // commande supprimée (paiement jamais ouvert)
  /* Échéances (tâche horaire). infoDe(id) : { statut, litige, retours } de la commande (ou null) ; reglagesDe(bid) ;
     peutEnvoyer(bid) : faux tant que la boutique est fermée (abonnement), la récompense attend.
     Renvoie les récompenses à envoyer : [{ bid, email, nom, code, remise, expire, filleulCommande }]. */
  function echeances(infoDe, reglagesDe, peutEnvoyer, maintenant = Date.now(), signaler = () => {}) {
    const aEnvoyer = [], annuler = id => db.prepare("UPDATE filleuls SET statut = 'annule' WHERE commande_id = ?").run(id);
    for (const f of db.prepare("SELECT * FROM filleuls WHERE statut = 'attente' ORDER BY cree_le LIMIT 2000").all()) {
      // Une ligne fautive (données abîmées) ne bloque ni les suivantes ni les récompenses déjà calculées.
      try { const r = echeance(f, infoDe, reglagesDe, peutEnvoyer, maintenant, annuler); if (r) aEnvoyer.push(r); } catch (e) { signaler(`${f.commande_id} : ${e.message}`); }
    }
    // Récompenses expirées depuis un an : supprimées.
    db.prepare('DELETE FROM recompenses WHERE expire < ?').run(maintenant - 365 * 86400000);
    return aEnvoyer;
  }
  function echeance(f, infoDe, reglagesDe, peutEnvoyer, maintenant, annuler) {
    {
      const i = infoDe(f.commande_id);
      if (!i || ['annulee', 'remboursee'].includes(i.statut) || i.litige || i.retours) { annuler(f.commande_id); return null; }
      // Jamais payée : oubliée après 60 jours (sauf facture QR encore payable : sa ligne reste).
      if (i.statut === 'attente') { if (f.cree_le < maintenant - 60 * 86400000 && !i.facture) db.prepare('DELETE FROM filleuls WHERE commande_id = ?').run(f.commande_id); return null; }
      if (!STATUTS_LIVRES.includes(i.statut)) {
        // Payée, pas (ou plus) livrée : une commande revenue en arrière repart de zéro pour le délai de rétractation.
        if (f.livre_le) db.prepare('UPDATE filleuls SET livre_le = NULL WHERE commande_id = ?').run(f.commande_id);
        if (f.cree_le < maintenant - 180 * 86400000) annuler(f.commande_id);
        return null;
      }
      // Livrée ou retirée : le délai de 14 jours (rétractation) part du premier passage qui la voit livrée.
      if (!f.livre_le) { db.prepare('UPDATE filleuls SET livre_le = ? WHERE commande_id = ?').run(maintenant, f.commande_id); return null; }
      if (f.livre_le > maintenant - DELAI_RECOMPENSE) return null;
      if (f.filleul_canon && db.prepare("SELECT 1 FROM filleuls WHERE boutique_id = ? AND filleul_canon = ? AND statut = 'credite' AND commande_id <> ?").get(f.boutique_id, f.filleul_canon, f.commande_id)) { annuler(f.commande_id); return null; }   // une récompense par filleul
      const p = db.prepare('SELECT * FROM parrains WHERE boutique_id = ? AND code = ?').get(f.boutique_id, f.code);
      const d = p && ouvrir(f.boutique_id, p.code, p.donnees);
      if (!p || !d || !d.email) { annuler(f.commande_id); return null; }   // parrain effacé entre-temps
      // Même réseau que le parrain (empreinte, jamais l'adresse IP) : la remise du filleul reste, pas de récompense.
      if (p.reseau && i.reseau && p.reseau === i.reseau) { annuler(f.commande_id); return null; }
      // Plafond par personne (tous les codes de la même adresse canonique).
      if (db.prepare('SELECT COUNT(*) n FROM recompenses r JOIN parrains q ON q.boutique_id = r.boutique_id AND q.code = r.parrain_code WHERE r.boutique_id = ? AND q.canon = ? AND r.cree_le > ?').get(f.boutique_id, p.canon || '', maintenant - 365 * 86400000).n >= PLAFOND_PARRAIN) { annuler(f.commande_id); return null; }
      if (!peutEnvoyer(f.boutique_id)) return null;   // boutique fermée : la récompense attend sa réouverture
      const remise = reglagesDe(f.boutique_id).parrain, code = 'MERCI' + aleatoire(6), expire = maintenant + VALIDITE_RECOMPENSE;
      // Passage à « credite » et création du code ensemble (tout ou rien) ; une seule fois par commande de filleul.
      let fait = false;
      db.exec('SAVEPOINT recompense');
      try {
        fait = db.prepare("UPDATE filleuls SET statut = 'credite', recompense = ? WHERE commande_id = ? AND statut = 'attente'").run(code, f.commande_id).changes > 0;
        if (fait) db.prepare('INSERT INTO recompenses (boutique_id, code, email_index, remise, cree_le, expire, parrain_code) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.boutique_id, code, p.email_index, remise, maintenant, expire, p.code);
        db.exec('RELEASE recompense');
      } catch (e) { db.exec('ROLLBACK TO recompense'); db.exec('RELEASE recompense'); throw e; }
      return fait ? { bid: f.boutique_id, email: d.email, nom: d.nom, code, remise, expire, filleulCommande: f.commande_id } : null;
    }
  }

  function stats(bid) {
    const n = s => db.prepare(`SELECT COUNT(*) n FROM filleuls WHERE boutique_id = ? AND statut = '${s}'`).get(bid).n;
    return { parrains: db.prepare('SELECT COUNT(*) n FROM parrains WHERE boutique_id = ?').get(bid).n, enAttente: n('attente'), recompenses: n('credite') };
  }
  /* Effacement des données d'un client (droit à l'effacement) : son code de parrain, ses récompenses, ses traces de filleul. */
  function effacer(bid, email) {
    const idx = index(bid, email), canon = indexCanon(bid, email);
    // Récompenses gagnées par tous ses codes (alias compris), puis les codes eux-mêmes.
    db.prepare('DELETE FROM recompenses WHERE boutique_id = ? AND (email_index = ? OR parrain_code IN (SELECT code FROM parrains WHERE boutique_id = ? AND (email_index = ? OR canon = ?)))').run(bid, idx, bid, idx, canon);
    db.prepare('DELETE FROM parrains WHERE boutique_id = ? AND (email_index = ? OR canon = ?)').run(bid, idx, canon);
    db.prepare("UPDATE filleuls SET filleul_canon = NULL WHERE boutique_id = ? AND filleul_canon = ?").run(bid, canon);
  }
  function supprimerBoutique(bid) { for (const t of ['parrains', 'filleuls', 'recompenses']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(bid); }

  return { codePour, trouver, noterFilleul, dejaParraine, annulerFilleul, oublierCommande, echeances, stats, effacer, supprimerBoutique, index, indexCanon, normaliser };
}

module.exports = { creerParrainage, nettoyerReglages, canonique, STATUTS_PAYES, DELAI_RECOMPENSE };
