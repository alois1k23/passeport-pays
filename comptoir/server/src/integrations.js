// Intégrations des marchands : clés d'API à portée limitée et webhooks sortants signés.
//  - Clé : « cpt_<32 caractères> », montrée une seule fois, gardée en empreinte (SHA-256) ; portées : lecture ou écriture
//    des commandes et des produits, lecture des clients.
//  - Webhook : URL https du marchand ; chaque envoi est signé (en-tête Comptoir-Signature: t=…,v1=HMAC-SHA256(t.corps)),
//    réessayé avec un délai croissant (jusqu'à 10 fois sur environ 2 jours) ; les adresses internes sont refusées (SSRF).
'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { erreur } = require('./http');

const PORTEES = ['commandes:lecture', 'commandes:ecriture', 'produits:lecture', 'produits:ecriture', 'clients:lecture'];
const EVENEMENTS = ['commande.payee', 'commande.expediee', 'commande.livree', 'commande.remboursee', 'commande.annulee', 'commande.retiree', 'produit.rupture'];
const ESSAIS_MAX = 10;
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');

/* Adresse IP privée, locale ou réservée : un webhook ne doit jamais viser l'intérieur du serveur ou du réseau. */
function ipInterne(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const i = ip.toLowerCase();
  if (i.startsWith('::ffff:')) return ipInterne(i.slice(7));
  return i === '::1' || i === '::' || /^f[cd]/.test(i) || /^fe[89ab]/.test(i) || i.startsWith('ff');
}

function creerIntegrations({ db, env = {}, journal = console, fetchImpl = fetch, resoudre = h => dns.lookup(h, { all: true }) }) {
  db.exec(`CREATE TABLE IF NOT EXISTS cles_api (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, nom TEXT NOT NULL, prefixe TEXT NOT NULL, empreinte TEXT NOT NULL UNIQUE, portees TEXT NOT NULL, cree_le INTEGER NOT NULL, utilisee_le INTEGER, revoquee INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, url TEXT NOT NULL, secret TEXT NOT NULL, evenements TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1, cree_le INTEGER NOT NULL, echecs_suite INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS webhook_envois (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, evenement TEXT NOT NULL, corps TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'attente', tentatives INTEGER NOT NULL DEFAULT 0, prochain_essai INTEGER NOT NULL, dernier_code INTEGER, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS webhook_envois_file ON webhook_envois(statut, prochain_essai);`);
  const httpLocalPermis = env.INTEGRATIONS_HTTP_LOCAL === '1';   // essais uniquement : webhooks vers http://127.0.0.1

  /* ---------- Clés d'API ---------- */
  function creerCle(boutiqueId, { nom, portees }) {
    const p = (Array.isArray(portees) ? portees : []).filter(x => PORTEES.includes(x));
    if (!p.length) throw erreur(400, 'Choisissez au moins une permission.', 'portees');
    if (db.prepare('SELECT COUNT(*) n FROM cles_api WHERE boutique_id = ? AND revoquee = 0').get(boutiqueId).n >= 10) throw erreur(409, '10 clés actives au plus : révoquez-en une.', 'trop_de_cles');
    const cle = 'cpt_' + crypto.randomBytes(24).toString('base64url');
    const id = 'key_' + crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO cles_api (id, boutique_id, nom, prefixe, empreinte, portees, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, boutiqueId, String(nom || 'Clé').slice(0, 60), cle.slice(0, 12), sha256(cle), JSON.stringify([...new Set(p)]), Date.now());
    return { id, cle };
  }
  const listerCles = boutiqueId => db.prepare('SELECT id, nom, prefixe, portees, cree_le, utilisee_le FROM cles_api WHERE boutique_id = ? AND revoquee = 0 ORDER BY cree_le DESC').all(boutiqueId).map(c => ({ ...c, portees: JSON.parse(c.portees) }));
  const revoquerCle = (boutiqueId, id) => db.prepare('UPDATE cles_api SET revoquee = 1 WHERE id = ? AND boutique_id = ?').run(String(id), boutiqueId).changes > 0;
  /* Authentifie « Authorization: Bearer cpt_… » ; renvoie { boutiqueId, portees, id } ou lève 401. */
  function authentifier(entete) {
    const m = /^Bearer\s+(cpt_[\w-]{20,64})$/.exec(String(entete || ''));
    if (!m) throw erreur(401, 'Clé d’API manquante ou invalide (en-tête Authorization: Bearer cpt_…).', 'cle_api');
    const c = db.prepare('SELECT * FROM cles_api WHERE empreinte = ? AND revoquee = 0').get(sha256(m[1]));
    if (!c) throw erreur(401, 'Clé d’API inconnue ou révoquée.', 'cle_api');
    if (!c.utilisee_le || Date.now() - c.utilisee_le > 60000) db.prepare('UPDATE cles_api SET utilisee_le = ? WHERE id = ?').run(Date.now(), c.id);
    return { id: c.id, boutiqueId: c.boutique_id, portees: JSON.parse(c.portees) };
  }

  /* ---------- Webhooks ---------- */
  async function verifierUrl(url) {
    let u;
    try { u = new URL(String(url)); } catch { throw erreur(400, 'Adresse invalide.', 'url'); }
    const local = httpLocalPermis && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    if (!local) {
      if (u.protocol !== 'https:') throw erreur(400, 'L’adresse doit commencer par https://', 'url');
      if (u.username || u.password) throw erreur(400, 'Pas d’identifiants dans l’adresse.', 'url');
      if (net.isIP(u.hostname) && ipInterne(u.hostname)) throw erreur(400, 'Adresse interne refusée.', 'url');
      const ips = await resoudre(u.hostname).catch(() => { throw erreur(400, 'Nom de domaine introuvable.', 'url'); });
      if (!ips.length || ips.some(x => ipInterne(x.address))) throw erreur(400, 'Ce domaine pointe vers une adresse interne : refusé.', 'url');
    }
    return u.toString().slice(0, 500);
  }
  async function creerWebhook(boutiqueId, { url, evenements }) {
    const ev = (Array.isArray(evenements) ? evenements : []).filter(x => EVENEMENTS.includes(x));
    if (!ev.length) throw erreur(400, 'Choisissez au moins un événement.', 'evenements');
    if (db.prepare('SELECT COUNT(*) n FROM webhooks WHERE boutique_id = ?').get(boutiqueId).n >= 10) throw erreur(409, '10 webhooks au plus.', 'trop_de_webhooks');
    const propre = await verifierUrl(url);
    const id = 'wh_' + crypto.randomBytes(6).toString('hex'), secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO webhooks (id, boutique_id, url, secret, evenements, cree_le) VALUES (?, ?, ?, ?, ?, ?)').run(id, boutiqueId, propre, secret, JSON.stringify([...new Set(ev)]), Date.now());
    return { id, secret };
  }
  const listerWebhooks = boutiqueId => db.prepare('SELECT id, url, evenements, actif, cree_le, echecs_suite FROM webhooks WHERE boutique_id = ? ORDER BY cree_le DESC').all(boutiqueId)
    .map(w => ({ ...w, evenements: JSON.parse(w.evenements), actif: !!w.actif, derniers: db.prepare('SELECT evenement, statut, tentatives, dernier_code, cree_le FROM webhook_envois WHERE webhook_id = ? ORDER BY cree_le DESC LIMIT 5').all(w.id) }));
  const supprimerWebhook = (boutiqueId, id) => db.prepare('DELETE FROM webhooks WHERE id = ? AND boutique_id = ?').run(String(id), boutiqueId).changes > 0;
  function reactiverWebhook(boutiqueId, id) { return db.prepare('UPDATE webhooks SET actif = 1, echecs_suite = 0 WHERE id = ? AND boutique_id = ?').run(String(id), boutiqueId).changes > 0; }

  /* Émet un événement : un envoi par webhook abonné (file persistante, survit aux redémarrages). */
  function emettre(boutiqueId, type, donnees) {
    if (!EVENEMENTS.includes(type) && type !== 'test') return 0;
    let n = 0;
    for (const w of db.prepare('SELECT * FROM webhooks WHERE boutique_id = ? AND actif = 1').all(boutiqueId)) {
      if (type !== 'test' && !JSON.parse(w.evenements).includes(type)) continue;
      const id = 'evt_' + crypto.randomBytes(8).toString('hex');
      const corps = JSON.stringify({ id, type, cree: new Date().toISOString(), donnees });
      db.prepare('INSERT INTO webhook_envois (id, webhook_id, evenement, corps, prochain_essai, cree_le) VALUES (?, ?, ?, ?, ?, ?)').run(id, w.id, type, corps, Date.now(), Date.now());
      n++;
    }
    return n;
  }
  const signer = (secret, t, corps) => crypto.createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex');

  let enCours = false;
  async function envoyerFile({ lot = 30 } = {}) {
    if (enCours) return 0;
    enCours = true;
    let n = 0;
    try {
      const envois = db.prepare(`SELECT e.*, w.url, w.secret, w.actif FROM webhook_envois e JOIN webhooks w ON w.id = e.webhook_id WHERE e.statut = 'attente' AND e.prochain_essai <= ? ORDER BY e.prochain_essai LIMIT ?`).all(Date.now(), lot);
      for (const e of envois) {
        if (!e.actif) continue;
        const t = Math.floor(Date.now() / 1000);
        let code = 0;
        try {
          await verifierUrl(e.url);   // le DNS a pu changer depuis l'enregistrement (rebinding)
          const rep = await fetchImpl(e.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Comptoir-Webhooks/1', 'Comptoir-Signature': `t=${t},v1=${signer(e.secret, t, e.corps)}`, 'Comptoir-Evenement': e.evenement, 'Comptoir-Id': e.id }, body: e.corps });
          code = rep.status;
        } catch (err) { code = 0; journal.error('[webhook]', e.url, err.message); }
        if (code >= 200 && code < 300) {
          db.prepare("UPDATE webhook_envois SET statut = 'envoye', tentatives = tentatives + 1, dernier_code = ? WHERE id = ?").run(code, e.id);
          db.prepare('UPDATE webhooks SET echecs_suite = 0 WHERE id = ?').run(e.webhook_id);
          n++;
        } else {
          const t2 = e.tentatives + 1, fin = t2 >= ESSAIS_MAX;
          db.prepare('UPDATE webhook_envois SET statut = ?, tentatives = ?, dernier_code = ?, prochain_essai = ? WHERE id = ?').run(fin ? 'echec' : 'attente', t2, code || null, Date.now() + Math.min(12 * 3600000, 30000 * 2 ** t2), e.id);
          // Point d'arrivée en panne depuis longtemps : le webhook est mis en pause (le marchand le réactive).
          const w = db.prepare('UPDATE webhooks SET echecs_suite = echecs_suite + 1 WHERE id = ? RETURNING echecs_suite').get(e.webhook_id);
          if (w && w.echecs_suite >= 50) db.prepare('UPDATE webhooks SET actif = 0 WHERE id = ?').run(e.webhook_id);
        }
      }
      db.prepare("DELETE FROM webhook_envois WHERE cree_le < ? AND statut <> 'attente'").run(Date.now() - 30 * 86400000);
    } finally { enCours = false; }
    return n;
  }

  return { PORTEES, EVENEMENTS, creerCle, listerCles, revoquerCle, authentifier, creerWebhook, listerWebhooks, supprimerWebhook, reactiverWebhook, emettre, envoyerFile, signer, verifierUrl };
}

module.exports = { creerIntegrations, ipInterne, PORTEES, EVENEMENTS };
