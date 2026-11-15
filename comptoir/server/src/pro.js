/* Comptoir — clients professionnels : remise propre (prix TTC remisés), paiement sur facture avec plafond.
   - Le marchand ouvre les comptes pro (e-mail, raison sociale, numéro de TVA ou IDE, remise, facture et plafond) ;
     e-mail et raison sociale sont chiffrés au repos comme les données des clients des commandes.
   - Le client pro se connecte dans la boutique avec un code à usage unique reçu par e-mail (6 chiffres, 15 minutes,
     5 essais, lié à la demande du navigateur qui l'a faite) ; il reçoit un jeton de 30 jours, dont seule l'empreinte est
     gardée. Rien n'indique à un inconnu si une adresse a un compte pro (même réponse dans tous les cas).
   - La remise et le droit de payer sur facture sont toujours relus et appliqués par le serveur à la commande. */
'use strict';
const crypto = require('node:crypto');

const MAX_CLIENTS = 500, DUREE_SESSION = 30 * 86400000, DUREE_CODE = 15 * 60000;
const sha256 = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function creerPro({ db, erreur, pii }) {
  db.exec(`CREATE TABLE IF NOT EXISTS clients_pro (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, donnees TEXT NOT NULL, remise REAL NOT NULL DEFAULT 0, facture INTEGER NOT NULL DEFAULT 0, plafond_centimes INTEGER NOT NULL DEFAULT 0, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS clients_pro_boutique ON clients_pro(boutique_id);
    CREATE TABLE IF NOT EXISTS pro_codes (demande_hash TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, client_id TEXT NOT NULL, code_hash TEXT NOT NULL, expire_le INTEGER NOT NULL, essais INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pro_echecs (client_id TEXT PRIMARY KEY, echecs INTEGER NOT NULL, depuis INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pro_sessions (jeton_hash TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, client_id TEXT NOT NULL, expire_le INTEGER NOT NULL);`);

  const P = () => pii();
  const fermer = (bid, id, o) => { const x = P(); return x ? x.chiffrer(o, { boutique: bid, commande: `pro:${id}` }) : JSON.stringify(o); };
  const ouvrir = (bid, id, t) => { const x = P(); try { return x && /^v\d\./.test(t) ? x.dechiffrer(t, { boutique: bid, commande: `pro:${id}` }) : JSON.parse(t); } catch { return null; } };
  const lire = r => { const d = ouvrir(r.boutique_id, r.id, r.donnees); return d ? { id: r.id, email: d.email, raison: d.raison, ide: d.ide || '', remise: r.remise, facture: !!r.facture, plafond: r.plafond_centimes / 100, creeLe: r.cree_le } : { id: r.id, illisible: true }; };
  const normEmail = e => String(e || '').trim().toLowerCase();

  function valider(c) {
    const email = normEmail(c.email);
    if (!/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i.test(email)) throw erreur(400, 'E-mail du client pro invalide.', 'pro_email');
    const raison = String(c.raison || '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!raison) throw erreur(400, 'Indiquez la raison sociale.', 'pro_raison');
    const ide = String(c.ide || '').replace(/[^\w.\- ]/g, '').trim().slice(0, 30);
    const remise = Number(c.remise ?? 0);
    if (!Number.isFinite(remise) || remise < 0 || remise > 50) throw erreur(400, 'Remise de 0 à 50 %.', 'pro_remise');
    const plafond = Number(c.plafond ?? 0);
    if (!Number.isFinite(plafond) || plafond < 0 || plafond > 1e6) throw erreur(400, 'Plafond de facture invalide.', 'pro_plafond');
    return { email, raison, ide, remise: Math.round(remise * 10) / 10, facture: c.facture === true && plafond > 0, plafondCentimes: Math.round(plafond * 100) };
  }
  const liste = bid => db.prepare('SELECT * FROM clients_pro WHERE boutique_id = ? ORDER BY cree_le').all(bid).map(lire);
  const parEmail = (bid, email) => liste(bid).find(c => !c.illisible && c.email === normEmail(email)) || null;
  function enregistrer(bid, c, id = null) {
    const v = valider(c);
    const autre = parEmail(bid, v.email);
    if (autre && autre.id !== id) throw erreur(409, 'Cet e-mail a déjà un compte pro.', 'pro_doublon');
    if (!id && db.prepare('SELECT COUNT(*) n FROM clients_pro WHERE boutique_id = ?').get(bid).n >= MAX_CLIENTS) throw erreur(409, `${MAX_CLIENTS} clients pro au plus.`, 'pro_trop');
    const ident = id || 'pro_' + crypto.randomBytes(8).toString('hex');
    const donnees = fermer(bid, ident, { email: v.email, raison: v.raison, ide: v.ide });
    if (id) { if (!db.prepare('UPDATE clients_pro SET donnees = ?, remise = ?, facture = ?, plafond_centimes = ? WHERE id = ? AND boutique_id = ?').run(donnees, v.remise, v.facture ? 1 : 0, v.plafondCentimes, id, bid).changes) throw erreur(404, 'Client pro introuvable.', 'introuvable'); }
    else db.prepare('INSERT INTO clients_pro (id, boutique_id, donnees, remise, facture, plafond_centimes, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ident, bid, donnees, v.remise, v.facture ? 1 : 0, v.plafondCentimes, Date.now());
    return lire(db.prepare('SELECT * FROM clients_pro WHERE id = ?').get(ident));
  }
  function supprimer(bid, id) {
    const n = db.prepare('DELETE FROM clients_pro WHERE id = ? AND boutique_id = ?').run(String(id), bid).changes;
    db.prepare('DELETE FROM pro_sessions WHERE client_id = ?').run(String(id)); db.prepare('DELETE FROM pro_codes WHERE client_id = ?').run(String(id));
    return n > 0;
  }

  /* Code de connexion : renvoie { demande, code, client } si l'adresse a un compte pro, sinon une demande factice
     (même réponse pour le navigateur : rien ne dit si l'adresse est cliente pro). */
  // Échecs de connexion par compte, sur 24 heures (tous réseaux confondus) : au 20e, plus de code ni de connexion.
  const echecs = id => { const e = db.prepare('SELECT * FROM pro_echecs WHERE client_id = ?').get(id); return e && e.depuis > Date.now() - 86400000 ? e.echecs : 0; };
  const noterEchec = id => db.prepare('INSERT INTO pro_echecs (client_id, echecs, depuis) VALUES (?, 1, ?) ON CONFLICT (client_id) DO UPDATE SET echecs = CASE WHEN depuis > ? THEN echecs + 1 ELSE 1 END, depuis = CASE WHEN depuis > ? THEN depuis ELSE excluded.depuis END RETURNING echecs').get(id, Date.now(), Date.now() - 86400000, Date.now() - 86400000).echecs;
  const MAX_ECHECS = 20;
  function nouveauCode(bid, email) {
    const c = parEmail(bid, email), demande = crypto.randomBytes(18).toString('base64url');
    db.prepare('DELETE FROM pro_codes WHERE expire_le < ?').run(Date.now());
    if (!c || echecs(c.id) >= MAX_ECHECS) return { demande, code: null, client: null };   // bloqué : même réponse, aucun e-mail
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    db.prepare('DELETE FROM pro_codes WHERE client_id = ?').run(c.id);   // un seul code valable à la fois
    db.prepare('INSERT INTO pro_codes (demande_hash, boutique_id, client_id, code_hash, expire_le) VALUES (?, ?, ?, ?, ?)').run(sha256(demande), bid, c.id, sha256(`${c.id}:${code}`), Date.now() + DUREE_CODE);
    return { demande, code, client: c };
  }
  /* Connexion : code juste pour cette demande → jeton de 30 jours (empreinte seule gardée). 5 essais par code. */
  function connecter(bid, email, demande, code) {
    const cible = parEmail(bid, email);
    if (cible && echecs(cible.id) >= MAX_ECHECS) return null;
    const res = connecter1(bid, email, demande, code);
    if (!res && cible && noterEchec(cible.id) === MAX_ECHECS) return { bloque: cible };
    return res;
  }
  function connecter1(bid, email, demande, code) {
    const r = db.prepare('SELECT * FROM pro_codes WHERE demande_hash = ? AND boutique_id = ?').get(sha256(String(demande || '')), bid);
    const c = r && db.prepare('SELECT * FROM clients_pro WHERE id = ? AND boutique_id = ?').get(r.client_id, bid);
    const client = c && lire(c);
    if (!r || !client || client.illisible || client.email !== normEmail(email) || r.expire_le < Date.now() || r.essais >= 5 || !/^\d{6}$/.test(String(code || ''))) {
      if (r) db.prepare('UPDATE pro_codes SET essais = essais + 1 WHERE demande_hash = ?').run(r.demande_hash);
      return null;
    }
    if (!crypto.timingSafeEqual(Buffer.from(r.code_hash, 'hex'), Buffer.from(sha256(`${client.id}:${code}`), 'hex'))) { db.prepare('UPDATE pro_codes SET essais = essais + 1 WHERE demande_hash = ?').run(r.demande_hash); return null; }
    db.prepare('DELETE FROM pro_codes WHERE client_id = ?').run(client.id);
    db.prepare('DELETE FROM pro_echecs WHERE client_id = ?').run(client.id);
    const jeton = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM pro_sessions WHERE expire_le < ?').run(Date.now());
    db.prepare('INSERT INTO pro_sessions (jeton_hash, boutique_id, client_id, expire_le) VALUES (?, ?, ?, ?)').run(sha256(jeton), bid, client.id, Date.now() + DUREE_SESSION);
    return { jeton, client };
  }
  /* Client pro d'un jeton (ou null) : la remise et le plafond sont ceux du compte maintenant, pas ceux de la connexion. */
  function deJeton(bid, jeton) {
    if (typeof jeton !== 'string' || jeton.length < 20 || jeton.length > 100) return null;
    const s = db.prepare('SELECT * FROM pro_sessions WHERE jeton_hash = ? AND boutique_id = ? AND expire_le > ?').get(sha256(jeton), bid, Date.now());
    const c = s && db.prepare('SELECT * FROM clients_pro WHERE id = ? AND boutique_id = ?').get(s.client_id, bid);
    const client = c && lire(c);
    return client && !client.illisible ? client : null;
  }
  const deconnecter = (bid, jeton) => db.prepare('DELETE FROM pro_sessions WHERE jeton_hash = ? AND boutique_id = ?').run(sha256(String(jeton || '')), bid).changes > 0;
  const toutSupprimer = bid => { db.prepare('DELETE FROM pro_echecs WHERE client_id IN (SELECT id FROM clients_pro WHERE boutique_id = ?)').run(bid); for (const t of ['clients_pro', 'pro_codes', 'pro_sessions']) db.prepare(`DELETE FROM ${t} WHERE boutique_id = ?`).run(bid); };
  // Ménage : codes expirés, sessions échues.
  const menage = (m = Date.now()) => { db.prepare('DELETE FROM pro_codes WHERE expire_le < ?').run(m); db.prepare('DELETE FROM pro_sessions WHERE expire_le < ?').run(m); };
  return { liste, parEmail, enregistrer, supprimer, nouveauCode, connecter, deJeton, deconnecter, toutSupprimer, menage, MAX_CLIENTS };
}

module.exports = { creerPro };
