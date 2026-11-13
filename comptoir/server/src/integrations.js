// Intégrations des marchands : clés d'API à portée limitée et webhooks sortants signés.
//  - Clé : « cpt_<32 caractères> », montrée une seule fois, gardée en empreinte (SHA-256) ; portées : lecture ou écriture
//    des commandes et des produits, lecture des clients.
//  - Webhook : URL https du marchand ; chaque envoi est signé (en-tête Comptoir-Signature: t=…,v1=HMAC-SHA256(t.corps)),
//    réessayé avec un délai croissant (15 essais sur environ 40 heures) ; mis en pause après 3 jours sans réponse réussie.
//  - SSRF : adresses internes refusées sous toutes leurs formes (IPv4, IPv6, IPv4 dans IPv6, NAT64, 6to4) ; la connexion
//    se fait à l'adresse vérifiée (résolution DNS unique, pas de « rebinding » entre le contrôle et l'envoi).
'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { erreur } = require('./http');

const PORTEES = ['commandes:lecture', 'commandes:ecriture', 'produits:lecture', 'produits:ecriture', 'clients:lecture'];
const EVENEMENTS = ['commande.payee', 'commande.expediee', 'commande.livree', 'commande.remboursee', 'commande.remboursement_partiel', 'commande.annulee', 'commande.retiree', 'produit.rupture', 'journal.cloture', 'devis.accepte', 'carte.emise', 'stock.transfert'];
const ESSAIS_MAX = 15;
const PAUSE_APRES_MS = 3 * 86400000;   // aucune réponse réussie depuis 3 jours : webhook mis en pause
const FILE_MAX = 5000;                  // lignes gardées par webhook, tous statuts (au-delà, les plus anciennes sont supprimées)
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');

/* Adresse IP privée, locale ou réservée : un webhook ne doit jamais viser l'intérieur du serveur ou du réseau. */
function ipv4Interne(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || (a === 192 && b === 88 && c === 99) || a >= 224;   // 192.88.99.0/24 : relais 6to4
}
// IPv6 → 8 groupes de 16 bits (accepte « :: » et une fin en notation IPv4).
function groupesIpv6(ip) {
  let t = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (v4) { const o = v4[1].split('.').map(Number); t = t.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16); }
  const [g, d] = t.split('::');
  const gauche = g ? g.split(':') : [], droite = d !== undefined && d ? d.split(':') : [];
  const milieu = d !== undefined ? Array(8 - gauche.length - droite.length).fill('0') : [];
  return [...gauche, ...milieu, ...droite].map(x => parseInt(x, 16) || 0);
}
const v4De = (h, l) => `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`;
function ipInterne(ip) {
  ip = String(ip || '').replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return ipv4Interne(ip);
  if (!net.isIPv6(ip)) return true;   // forme inconnue : refusée par prudence
  const g = groupesIpv6(ip);
  const zero = n => g.slice(0, n).every(x => x === 0);
  if (zero(8)) return true;                                              // ::
  if (zero(7) && g[7] === 1) return true;                                // ::1
  if (zero(5) && (g[5] === 0xffff || g[5] === 0)) return ipv4Interne(v4De(g[6], g[7]));   // ::ffff:a.b.c.d, ::a.b.c.d
  if (zero(4) && g[4] === 0xffff && g[5] === 0) return ipv4Interne(v4De(g[6], g[7]));     // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0) return ipv4Interne(v4De(g[6], g[7]));   // NAT64 bien connu (64:ff9b::/96)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;                         // NAT64 local (64:ff9b:1::/48, RFC 8215) : position de l'IPv4 variable, refusé
  if (g[0] === 0x2002) return ipv4Interne(v4De(g[1], g[2]));                               // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                                          // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;                                      // documentation
  const h = g[0];
  return (h & 0xfe00) === 0xfc00 || (h & 0xffc0) === 0xfe80 || (h & 0xffc0) === 0xfec0 || (h & 0xff00) === 0xff00 || (h & 0xff00) === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0;
}

function creerIntegrations({ db, env = {}, journal = console, resoudre = h => dns.lookup(h, { all: true }), permis = () => true, chiffrement = () => null }) {
  /* File des envois chiffrée au repos (données des clients dans les événements) : même chiffrement que les commandes,
     lié à la boutique et à l'envoi ; index aveugle de l'e-mail du client pour l'effacement (RGPD). */
  const fermer = (bid, id, corps) => { const P = chiffrement(); return P ? P.chiffrer({ corps }, { boutique: bid, commande: `webhook:${id}` }) : corps; };
  const ouvrir = (bid, id, texte) => { const P = chiffrement(); if (!P || !/^v[12]\./.test(texte)) return texte; try { return P.dechiffrer(texte, { boutique: bid, commande: `webhook:${id}` }).corps; } catch { return null; } };
  db.exec(`CREATE TABLE IF NOT EXISTS cles_api (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, nom TEXT NOT NULL, prefixe TEXT NOT NULL, empreinte TEXT NOT NULL UNIQUE, portees TEXT NOT NULL, cree_le INTEGER NOT NULL, utilisee_le INTEGER, revoquee INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE, url TEXT NOT NULL, secret TEXT NOT NULL, evenements TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1, cree_le INTEGER NOT NULL, echecs_suite INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS webhook_envois (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, evenement TEXT NOT NULL, corps TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'attente', tentatives INTEGER NOT NULL DEFAULT 0, prochain_essai INTEGER NOT NULL, dernier_code INTEGER, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS webhook_envois_file ON webhook_envois(statut, prochain_essai);
    CREATE INDEX IF NOT EXISTS webhook_envois_hook ON webhook_envois(webhook_id, statut, cree_le);
    CREATE INDEX IF NOT EXISTS webhook_envois_age ON webhook_envois(webhook_id, cree_le);`);
  // donnees_client : 1 = le webhook reçoit nom, e-mail et adresse des clients ; 0 = seulement le pays (minimisation).
  // Les webhooks d'avant ce réglage gardent leur comportement (1) ; un nouveau webhook ne les reçoit que si on le demande.
  for (const col of ['secret_ancien TEXT', 'secret_ancien_jusqu INTEGER', 'donnees_client INTEGER NOT NULL DEFAULT 1']) { try { db.exec(`ALTER TABLE webhooks ADD COLUMN ${col}`); } catch { /* déjà là */ } }
  try { db.exec('ALTER TABLE webhook_envois ADD COLUMN email_index TEXT'); } catch { /* déjà là */ }
  for (const col of ['premier_echec INTEGER', 'dernier_succes INTEGER']) { try { db.exec(`ALTER TABLE webhooks ADD COLUMN ${col}`); } catch { /* déjà là */ } }
  const httpLocalPermis = env.INTEGRATIONS_HTTP_LOCAL === '1';   // essais uniquement : webhooks vers http://127.0.0.1

  /* ---------- Clés d'API ---------- */
  // Expiration (facultative) et réseaux autorisés (facultatifs) : une clé volée cesse de servir à sa date, ou hors des
  // adresses IP du serveur qui l'utilise (comptabilité, entrepôt).
  for (const col of ['expire_le INTEGER', 'reseaux TEXT']) { try { db.exec(`ALTER TABLE cles_api ADD COLUMN ${col}`); } catch { /* déjà là */ } }
  const DUREES_CLE = [30, 90, 365];
  const ipNette = ip => { const t = String(ip || '').trim(); return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(t) ? t.slice(7) : t; };
  function lireReseaux(texte) {
    const brut = (Array.isArray(texte) ? texte : String(texte || '').split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean);
    if (brut.length > 10) throw erreur(400, '10 réseaux au plus.', 'reseaux');
    return brut.map(r => {
      const [adr, pre, reste] = r.split('/');
      if (r.includes('%')) throw erreur(400, `Réseau invalide : « ${r.slice(0, 50)} » (identifiant de zone non accepté).`, 'reseaux');
      const v = net.isIP(ipNette(adr));
      const max = v === 4 ? 32 : 128;
      const n = pre === undefined ? max : /^\d{1,3}$/.test(pre) ? Number(pre) : NaN;
      if (!v || reste !== undefined || !(n >= (v === 4 ? 8 : 16) && n <= max)) throw erreur(400, `Réseau invalide : « ${r.slice(0, 50)} ». Exemples : 203.0.113.7, 203.0.113.0/24, 2001:db8::/48.`, 'reseaux');
      // IPv6 qui recouvre des adresses IPv4 (::/80 dont ::1 et ::, ::ffff:0:0/96, 64:ff9b::/96) : refusée, elle autoriserait
      // des adresses IPv4 sans que la liste le montre. Une adresse IPv4 s'écrit sous sa forme IPv4.
      if (v === 6) {
        const entree = new net.BlockList(); entree.addSubnet(ipNette(adr), n, 'ipv6');
        const plages = [['::', 80], ['::ffff:0:0', 96], ['64:ff9b::', 96]];
        if (plages.some(([base, p]) => { const pl = new net.BlockList(); pl.addSubnet(base, p, 'ipv6'); return entree.check(base, 'ipv6') || pl.check(ipNette(adr), 'ipv6'); }))
          throw erreur(400, `Réseau refusé : « ${r.slice(0, 50)} » recouvre des adresses IPv4 ; écrivez l’adresse IPv4 elle-même (ex. 203.0.113.7).`, 'reseaux');
      }
      return `${ipNette(adr)}/${n}`;
    });
  }
  // Adresse exacte du client (pas son réseau /64) ; seules les règles de sa famille (IPv4 ou IPv6) sont consultées.
  const dansReseaux = (ip, reseaux) => {
    const a = ipNette(String(ip || '').replace(/%.*$/, '')), v = net.isIP(a);
    if (!v) return false;
    const bl = new net.BlockList();
    for (const r of reseaux) { const [adr, n] = r.split('/'); if (net.isIP(adr) === v) bl.addSubnet(adr, Number(n), v === 4 ? 'ipv4' : 'ipv6'); }
    return bl.check(a, v === 4 ? 'ipv4' : 'ipv6');
  };
  function creerCle(boutiqueId, { nom, portees, expireJours, reseaux }) {
    const p = (Array.isArray(portees) ? portees : []).filter(x => PORTEES.includes(x));
    if (!p.length) throw erreur(400, 'Choisissez au moins une permission.', 'portees');
    const jours = expireJours === undefined || expireJours === null || expireJours === '' || expireJours === 'jamais' ? null : Number(expireJours);
    if (jours !== null && !DUREES_CLE.includes(jours)) throw erreur(400, 'Durée de validité : 30, 90 ou 365 jours, ou sans limite.', 'expiration');
    const rs = lireReseaux(reseaux);
    if (db.prepare('SELECT COUNT(*) n FROM cles_api WHERE boutique_id = ? AND revoquee = 0').get(boutiqueId).n >= 10) throw erreur(409, '10 clés actives au plus : révoquez-en une.', 'trop_de_cles');
    const cle = 'cpt_' + crypto.randomBytes(24).toString('base64url');
    const id = 'key_' + crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO cles_api (id, boutique_id, nom, prefixe, empreinte, portees, cree_le, expire_le, reseaux) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, boutiqueId, String(nom || 'Clé').slice(0, 60), cle.slice(0, 12), sha256(cle), JSON.stringify([...new Set(p)]), Date.now(), jours ? Date.now() + jours * 86400000 : null, rs.length ? JSON.stringify(rs) : null);
    return { id, cle, expireLe: jours ? Date.now() + jours * 86400000 : null, reseaux: rs };
  }
  const listerCles = boutiqueId => db.prepare('SELECT id, nom, prefixe, portees, cree_le, utilisee_le, expire_le, reseaux FROM cles_api WHERE boutique_id = ? AND revoquee = 0 ORDER BY cree_le DESC').all(boutiqueId).map(c => ({ ...c, portees: JSON.parse(c.portees), reseaux: c.reseaux ? JSON.parse(c.reseaux) : [], expiree: !!(c.expire_le && c.expire_le < Date.now()) }));
  const revoquerCle = (boutiqueId, id) => db.prepare('UPDATE cles_api SET revoquee = 1 WHERE id = ? AND boutique_id = ?').run(String(id), boutiqueId).changes > 0;
  /* Authentifie « Authorization: Bearer cpt_… » ; renvoie { boutiqueId, portees, id } ou lève 401. */
  function authentifier(entete, ip) {
    const m = /^Bearer\s+(cpt_[\w-]{20,64})$/.exec(String(entete || ''));
    if (!m) throw erreur(401, 'Clé d’API manquante ou invalide (en-tête Authorization: Bearer cpt_…).', 'cle_api');
    const c = db.prepare('SELECT * FROM cles_api WHERE empreinte = ? AND revoquee = 0').get(sha256(m[1]));
    if (!c) throw erreur(401, 'Clé d’API inconnue ou révoquée.', 'cle_api');
    if (c.expire_le && c.expire_le < Date.now()) throw erreur(401, 'Clé d’API expirée : créez-en une nouvelle dans Paramètres > Intégrations.', 'cle_expiree');
    if (c.reseaux && !dansReseaux(ip, JSON.parse(c.reseaux))) throw erreur(403, 'Cette clé d’API n’est pas autorisée depuis cette adresse IP.', 'reseau_refuse');
    if (!c.utilisee_le || Date.now() - c.utilisee_le > 60000) db.prepare('UPDATE cles_api SET utilisee_le = ? WHERE id = ?').run(Date.now(), c.id);
    return { id: c.id, boutiqueId: c.boutique_id, portees: JSON.parse(c.portees) };
  }

  /* ---------- Webhooks ---------- */
  const hoteLocal = u => httpLocalPermis && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  async function verifierUrl(url) {
    const brut = String(url || '');
    if (brut.length > 500) throw erreur(400, 'Adresse trop longue (500 caractères au plus).', 'url');
    let u;
    try { u = new URL(brut); } catch { throw erreur(400, 'Adresse invalide.', 'url'); }
    if (!hoteLocal(u)) {
      if (u.protocol !== 'https:') throw erreur(400, 'L’adresse doit commencer par https://', 'url');
      if (u.username || u.password) throw erreur(400, 'Pas d’identifiants dans l’adresse.', 'url');
      const hote = u.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(hote)) { if (ipInterne(hote)) throw erreur(400, 'Adresse interne refusée.', 'url'); }
      else {
        const ips = await resoudre(hote).catch(() => { throw erreur(400, 'Nom de domaine introuvable.', 'url'); });
        if (!ips.length || ips.some(x => ipInterne(x.address))) throw erreur(400, 'Ce domaine pointe vers une adresse interne : refusé.', 'url');
      }
    }
    return u.toString();
  }
  /* Résolution DNS au moment de la connexion, avec contrôle de l'adresse obtenue : la connexion part vers l'adresse
     vérifiée, pas vers une seconde résolution qu'un DNS malveillant pourrait faire pointer vers l'intérieur. */
  const lookupSur = (hote, options, rappel) => {
    if (typeof options === 'function') { rappel = options; options = {}; }
    resoudre(hote).then(ips => {
      const bonnes = ips.filter(x => !ipInterne(x.address));
      if (!bonnes.length || bonnes.length !== ips.length) return rappel(Object.assign(new Error('adresse interne refusée'), { code: 'EINTERNE' }));
      if (options && options.all) return rappel(null, bonnes.map(x => ({ address: x.address, family: x.family || (net.isIPv6(x.address) ? 6 : 4) })));
      rappel(null, bonnes[0].address, bonnes[0].family || (net.isIPv6(bonnes[0].address) ? 6 : 4));
    }, e => rappel(e));
  };
  /* Envoi POST (pas de redirection suivie, 10 s au plus, réponse lue et limitée à 64 Ko). Renvoie le code HTTP ou 0. */
  function poster(url, corps, entetes, delai = 10000) {
    return new Promise(ok => {
      let u; try { u = new URL(url); } catch { return ok(0); }
      const local = hoteLocal(u);
      const mod = u.protocol === 'https:' ? https : http;
      if (!local && u.protocol !== 'https:') return ok(0);
      const hote = u.hostname.replace(/^\[|\]$/g, '');
      if (!local && net.isIP(hote) && ipInterne(hote)) return ok(0);
      const req = mod.request({ protocol: u.protocol, hostname: hote, port: u.port || undefined, path: u.pathname + u.search, method: 'POST', agent: false,
        headers: { ...entetes, 'Content-Length': Buffer.byteLength(corps) }, timeout: delai, servername: net.isIP(hote) ? undefined : hote,
        ...(local || net.isIP(hote) ? {} : { lookup: lookupSur }) }, rep => {
        let lu = 0; rep.on('data', d => { lu += d.length; if (lu > 65536) rep.destroy(); });
        rep.on('end', () => ok(rep.statusCode)); rep.on('close', () => ok(rep.statusCode)); rep.on('error', () => ok(rep.statusCode || 0));
      });
      const minuterie = setTimeout(() => req.destroy(new Error('délai dépassé')), delai);
      req.on('timeout', () => req.destroy(new Error('délai dépassé')));
      req.on('error', e => { journal.error('[webhook]', u.host, e.code || e.message); ok(0); });
      req.on('close', () => clearTimeout(minuterie));
      req.end(corps);
    });
  }
  /* Secret d'un webhook : chiffré en base (comme les données des clients), lu au moment de signer. Pendant 24 heures après
     une rotation, l'ancien secret signe aussi : l'en-tête porte deux « v1= », le destinataire accepte l'un ou l'autre
     le temps de mettre à jour sa configuration. */
  const fermerSecret = (bid, id, secret) => { const P = chiffrement(); return P ? P.chiffrer({ secret }, { boutique: bid, commande: `webhook-secret:${id}` }) : secret; };
  // Secret illisible (clé SECRET_CHIFFREMENT changée sans l'ancienne) : null, jamais une exception qui arrêterait l'envoi des
  // autres boutiques ; ce webhook n'envoie rien (aucun envoi non signé) et c'est journalisé.
  const secretsSignales = new Set();
  const ouvrirSecret = (bid, id, texte) => { if (!texte) return null; const P = chiffrement(); if (!P || !/^v[12]\./.test(texte)) return texte;
    try { return P.dechiffrer(texte, { boutique: bid, commande: `webhook-secret:${id}` }).secret; } catch { if (secretsSignales.has(id)) return null; secretsSignales.add(id); journal.error(`[webhooks] secret du webhook ${id} illisible : envois suspendus (recréez le webhook, ou remettez l'ancienne clé)`); return null; } };
  // Ordre : l'ancien secret d'abord, le nouveau en dernier (un vérificateur qui ne garde que le dernier « v1= » marche avec le nouveau secret).
  const secretsDe = w => { const courant = ouvrirSecret(w.boutique_id, w.id, w.secret); if (!courant) return [];
    return [w.secret_ancien && w.secret_ancien_jusqu > Date.now() ? ouvrirSecret(w.boutique_id, w.id, w.secret_ancien) : null, courant].filter(Boolean); };
  const entetesSignes = (secrets, id, type, corps) => { const t = Math.floor(Date.now() / 1000); return { 'Content-Type': 'application/json', 'User-Agent': 'Comptoir-Webhooks/1', 'Comptoir-Signature': `t=${t},${(Array.isArray(secrets) ? secrets : [secrets]).map(x => `v1=${signer(x, t, corps)}`).join(',')}`, 'Comptoir-Evenement': type, 'Comptoir-Id': id }; };

  async function creerWebhook(boutiqueId, { url, evenements, donneesClient = false }) {
    const ev = (Array.isArray(evenements) ? evenements : []).filter(x => EVENEMENTS.includes(x));
    if (!ev.length) throw erreur(400, 'Choisissez au moins un événement.', 'evenements');
    if (db.prepare('SELECT COUNT(*) n FROM webhooks WHERE boutique_id = ?').get(boutiqueId).n >= 10) throw erreur(409, '10 webhooks au plus.', 'trop_de_webhooks');
    const propre = await verifierUrl(url);
    const id = 'wh_' + crypto.randomBytes(6).toString('hex'), secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO webhooks (id, boutique_id, url, secret, evenements, cree_le, donnees_client) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, boutiqueId, propre, fermerSecret(boutiqueId, id, secret), JSON.stringify([...new Set(ev)]), Date.now(), donneesClient === true ? 1 : 0);
    return { id, secret };
  }
  /* Nouveau secret (fuite, départ d'un prestataire) sans perdre la file : l'ancien signe encore 24 heures. */
  function renouvelerSecret(boutiqueId, id) {
    const w = db.prepare('SELECT * FROM webhooks WHERE id = ? AND boutique_id = ?').get(String(id), boutiqueId);
    if (!w) return null;
    const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url'), jusqu = Date.now() + 24 * 3600000;
    db.prepare('UPDATE webhooks SET secret = ?, secret_ancien = ?, secret_ancien_jusqu = ? WHERE id = ?').run(fermerSecret(boutiqueId, w.id, secret), w.secret, jusqu, w.id);
    return { id: w.id, secret, ancienValableJusqua: new Date(jusqu).toISOString() };
  }
  /* Webhooks dont le secret ne se lit plus avec les clés connues (console de l'exploitant). */
  const secretsIllisibles = () => db.prepare('SELECT id, boutique_id, secret FROM webhooks').all().filter(w => !ouvrirSecret(w.boutique_id, w.id, w.secret)).length;
  /* Secrets encore en clair (avant le chiffrement) : chiffrés une fois (appelé au démarrage). */
  function chiffrerSecrets() {
    if (!chiffrement()) return 0;
    let n = 0;
    for (const w of db.prepare("SELECT id, boutique_id, secret FROM webhooks WHERE secret NOT LIKE 'v_.%'").all()) { db.prepare('UPDATE webhooks SET secret = ? WHERE id = ?').run(fermerSecret(w.boutique_id, w.id, w.secret), w.id); n++; }
    return n;
  }
  const listerWebhooks = boutiqueId => db.prepare('SELECT id, url, evenements, actif, cree_le, echecs_suite, premier_echec, dernier_succes, donnees_client FROM webhooks WHERE boutique_id = ? ORDER BY cree_le DESC').all(boutiqueId)
    .map(({ donnees_client, ...w }) => ({ ...w, evenements: JSON.parse(w.evenements), actif: !!w.actif, donneesClient: !!donnees_client,
      enAttente: db.prepare("SELECT COUNT(*) n FROM webhook_envois WHERE webhook_id = ? AND statut = 'attente'").get(w.id).n,
      derniers: db.prepare('SELECT evenement, statut, tentatives, dernier_code, cree_le FROM webhook_envois WHERE webhook_id = ? ORDER BY cree_le DESC LIMIT 5').all(w.id) }));
  const supprimerWebhook = (boutiqueId, id) => db.prepare('DELETE FROM webhooks WHERE id = ? AND boutique_id = ?').run(String(id), boutiqueId).changes > 0;
  /* Réactivation : les événements gardés pendant la pause repartent tout de suite. */
  function reactiverWebhook(boutiqueId, id) {
    const ok = db.prepare('UPDATE webhooks SET actif = 1, echecs_suite = 0, premier_echec = NULL WHERE id = ? AND boutique_id = ?').run(String(id), boutiqueId).changes > 0;
    if (ok) db.prepare("UPDATE webhook_envois SET prochain_essai = ?, tentatives = 0 WHERE webhook_id = ? AND statut = 'attente'").run(Date.now(), String(id));
    return ok;
  }

  /* Émet un événement : un envoi par webhook abonné (file persistante, survit aux redémarrages).
     Un webhook en pause continue de recevoir ses événements dans la file : rien n'est perdu à la réactivation. */
  const dernieresRuptures = new Map();
  /* Contenu sans données personnelles : le client réduit à son pays, comme une commande lue par une clé d'API sans
     « clients:lecture ». Même la raison sociale d'un devis est retirée (pour un indépendant, c'est son nom). */
  function sansDonneesClient(donnees) {
    if (!donnees || typeof donnees !== 'object' || !donnees.client || typeof donnees.client !== 'object') return donnees;
    return { ...donnees, client: { pays: donnees.client.pays || null } };
  }
  function changerDonneesClient(boutiqueId, id, avec) {
    return db.prepare('UPDATE webhooks SET donnees_client = ? WHERE id = ? AND boutique_id = ?').run(avec ? 1 : 0, String(id), boutiqueId).changes === 1;
  }
  function emettre(boutiqueId, type, donnees) {
    if (!EVENEMENTS.includes(type)) return 0;
    if (!permis(boutiqueId)) return 0;   // formule sans API ou abonnement terminé : plus aucune donnée ne sort
    // Rupture de stock : au plus une par produit toutes les 10 minutes (un stock qui oscille entre 0 et 5 par l'API ne
    // remplit pas la file).
    if (type === 'produit.rupture' && donnees && donnees.id) {
      const cle = `${boutiqueId}|${donnees.id}`, t = Date.now();
      if (t - (dernieresRuptures.get(cle) || 0) < 10 * 60000) return 0;
      dernieresRuptures.set(cle, t); if (dernieresRuptures.size > 20000) dernieresRuptures.clear();
    }
    let n = 0;
    for (const w of db.prepare('SELECT * FROM webhooks WHERE boutique_id = ?').all(boutiqueId)) {
      if (!JSON.parse(w.evenements).includes(type)) continue;
      const id = 'evt_' + crypto.randomBytes(8).toString('hex');
      const pour = w.donnees_client ? donnees : sansDonneesClient(donnees);
      const corps = JSON.stringify({ id, type, cree: new Date().toISOString(), donnees: pour });
      const email = pour && pour.client && pour.client.email, P = chiffrement();
      db.prepare('INSERT INTO webhook_envois (id, webhook_id, evenement, corps, prochain_essai, cree_le, email_index) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, w.id, type, fermer(boutiqueId, id, corps), Date.now(), Date.now(), P && email ? P.index(boutiqueId, email) : null);
      // File bornée, tous statuts confondus : ni un point d'arrivée en panne, ni un flot d'événements ne remplit la base
      // (les plus anciennes lignes au-delà de la limite sont supprimées, pas seulement marquées).
      db.prepare(`DELETE FROM webhook_envois WHERE id IN (SELECT id FROM webhook_envois WHERE webhook_id = ? ORDER BY cree_le DESC LIMIT -1 OFFSET ${FILE_MAX})`).run(w.id);
      n++;
    }
    return n;
  }
  const signer = (secret, t, corps) => crypto.createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex');

  /* Test depuis l'écran Intégrations : envoyé tout de suite à chaque webhook de la boutique, hors file et hors
     compteur d'échecs ; renvoie le code reçu par adresse. */
  async function tester(boutiqueId) {
    const res = [];
    for (const w of db.prepare('SELECT * FROM webhooks WHERE boutique_id = ?').all(boutiqueId)) {
      const id = 'evt_test_' + crypto.randomBytes(6).toString('hex');
      const corps = JSON.stringify({ id, type: 'test', cree: new Date().toISOString(), donnees: { message: 'Événement de test envoyé depuis Comptoir.' } });
      const secrets = secretsDe(w);
      const code = secrets.length ? await poster(w.url, corps, entetesSignes(secrets, id, 'test', corps), 5000) : 0;   // secret illisible : rien n'est envoyé
      res.push({ id: w.id, url: w.url, code, ok: code >= 200 && code < 300 });
    }
    return res;
  }

  /* Envoi de la file : équitable entre webhooks (5 envois au plus par webhook et par passage), dans l'ordre des
     événements d'un même webhook, et on s'arrête au premier échec d'un webhook (inutile d'insister pendant ce passage). */
  let enCours = false;
  async function envoyerFile({ lot = 60, parWebhook = 5 } = {}) {
    if (enCours) return 0;
    enCours = true;
    let n = 0;
    try {
      const maintenant = Date.now();
      const hooks = db.prepare(`SELECT DISTINCT w.* FROM webhooks w JOIN webhook_envois e ON e.webhook_id = w.id WHERE w.actif = 1 AND e.statut = 'attente' AND e.prochain_essai <= ? LIMIT 500`).all(maintenant);
      let budget = lot;
      const traiter = async w => { try { await traiterUn(w); } catch (x) { journal.error(`[webhooks] envoi du webhook ${w.id}`, x.message); } };   // une erreur d'un webhook n'arrête pas les autres
      const traiterUn = async w => {
        if (!secretsDe(w).length) return;   // secret illisible : file gardée, rien d'envoyé sans signature valable
        if (!permis(w.boutique_id)) { db.prepare("UPDATE webhook_envois SET statut = 'echec' WHERE webhook_id = ? AND statut = 'attente'").run(w.id); return; }
        const envois = db.prepare("SELECT * FROM webhook_envois WHERE webhook_id = ? AND statut = 'attente' AND prochain_essai <= ? ORDER BY cree_le LIMIT ?").all(w.id, maintenant, parWebhook);
        for (const e of envois) {
          if (budget <= 0) return;
          budget--;
          const corps = ouvrir(w.boutique_id, e.id, e.corps);
          if (corps === null) { db.prepare("UPDATE webhook_envois SET statut = 'echec' WHERE id = ?").run(e.id); journal.error('[webhook] envoi illisible (clé changée ?)', e.id); continue; }
          const code = await poster(w.url, corps, entetesSignes(secretsDe(w), e.id, e.evenement, corps));
          if (code >= 200 && code < 300) {
            // Livré : le corps (données du client, chiffrées) ne sert plus ; seules les métadonnées restent (30 jours).
            db.prepare("UPDATE webhook_envois SET statut = 'envoye', tentatives = tentatives + 1, dernier_code = ?, corps = '', email_index = NULL WHERE id = ?").run(code, e.id);
            db.prepare('UPDATE webhooks SET echecs_suite = 0, premier_echec = NULL, dernier_succes = ? WHERE id = ?').run(Date.now(), w.id);
            n++;
          } else {
            const t2 = e.tentatives + 1, fin = t2 >= ESSAIS_MAX;
            db.prepare('UPDATE webhook_envois SET statut = ?, tentatives = ?, dernier_code = ?, prochain_essai = ? WHERE id = ?').run(fin ? 'echec' : 'attente', t2, code || null, Date.now() + Math.min(6 * 3600000, 30000 * 2 ** t2), e.id);
            const h = db.prepare('UPDATE webhooks SET echecs_suite = echecs_suite + 1, premier_echec = COALESCE(premier_echec, ?) WHERE id = ? RETURNING premier_echec').get(Date.now(), w.id);
            // Plus aucune réponse réussie depuis 3 jours : pause (les événements restent en file, le marchand réactive).
            if (h && Date.now() - h.premier_echec >= PAUSE_APRES_MS) db.prepare('UPDATE webhooks SET actif = 0 WHERE id = ?').run(w.id);
            return;
          }
        }
      };
      for (let k = 0; k < hooks.length; k += 10) await Promise.all(hooks.slice(k, k + 10).map(traiter));   // 10 adresses en parallèle au plus
      // Ménage : historique gardé 30 jours ; un événement jamais livré est abandonné au bout de 30 jours.
      db.prepare("DELETE FROM webhook_envois WHERE cree_le < ?").run(Date.now() - 30 * 86400000);
    } finally { enCours = false; }
    return n;
  }
  /* Effacement d'un client (RGPD) : ses données disparaissent aussi des envois gardés. */
  /* Envois en attente d'avant le chiffrement : chiffrés une fois (appelé au démarrage). */
  function chiffrerFile() {
    const P = chiffrement(); if (!P) return 0;
    let n = 0;
    for (const e of db.prepare("SELECT e.id, e.corps, w.boutique_id FROM webhook_envois e JOIN webhooks w ON w.id = e.webhook_id WHERE e.corps LIKE '{%'").all()) {
      let email = null; try { const d = JSON.parse(e.corps).donnees; email = d && d.client && d.client.email; } catch { /* corps illisible : chiffré tel quel */ }
      db.prepare('UPDATE webhook_envois SET corps = ?, email_index = ? WHERE id = ?').run(fermer(e.boutique_id, e.id, e.corps), email ? P.index(e.boutique_id, email) : null, e.id); n++;
    }
    return n;
  }
  /* Rotation de clé : envois en attente rechiffrés avec la clé courante et réindexés (l'index de l'ancienne clé ne
     retrouverait plus le client pour l'effacement de ses données). */
  function renouvelerCleFile() {
    const P = chiffrement(); if (!P) return 0;
    let n = 0;
    for (const e of db.prepare("SELECT e.id, e.corps, w.boutique_id FROM webhook_envois e JOIN webhooks w ON w.id = e.webhook_id WHERE e.corps LIKE 'v_.%'").all()) {
      const ctxE = { boutique: e.boutique_id, commande: `webhook:${e.id}` };
      let corps; try { if (!P.aRenouveler(e.corps, ctxE)) continue; corps = P.dechiffrer(e.corps, ctxE).corps; } catch { continue; }
      let email = null; try { const d = JSON.parse(corps).donnees; email = d && d.client && d.client.email; } catch { /* corps illisible */ }
      db.prepare('UPDATE webhook_envois SET corps = ?, email_index = ? WHERE id = ?').run(fermer(e.boutique_id, e.id, corps), email ? P.index(e.boutique_id, email) : null, e.id); n++;
    }
    // Secrets des webhooks (et ancien secret encore valable) : rechiffrés avec la clé courante.
    for (const w of db.prepare("SELECT id, boutique_id, secret, secret_ancien FROM webhooks WHERE secret LIKE 'v_.%' OR secret_ancien LIKE 'v_.%'").all()) {
      const ctxS = { boutique: w.boutique_id, commande: `webhook-secret:${w.id}` };
      const neuf = t => { if (!t || !/^v[12]\./.test(t)) return t; try { return P.aRenouveler(t, ctxS) ? fermerSecret(w.boutique_id, w.id, P.dechiffrer(t, ctxS).secret) : t; } catch { return t; } };
      const s1 = neuf(w.secret), s2 = neuf(w.secret_ancien);
      if (s1 !== w.secret || s2 !== w.secret_ancien) { db.prepare('UPDATE webhooks SET secret = ?, secret_ancien = ? WHERE id = ?').run(s1, s2, w.id); n++; }
    }
    return n;
  }
  function effacerClient(boutiqueId, email) {
    const P = chiffrement(), ix = P ? P.index(boutiqueId, email) : null;
    return db.prepare("DELETE FROM webhook_envois WHERE webhook_id IN (SELECT id FROM webhooks WHERE boutique_id = ?) AND (email_index = ? OR instr(lower(corps), ?) > 0)").run(boutiqueId, ix, JSON.stringify(String(email).toLowerCase())).changes;
  }

  return { PORTEES, EVENEMENTS, creerCle, listerCles, revoquerCle, authentifier, creerWebhook, listerWebhooks, supprimerWebhook, reactiverWebhook, emettre, envoyerFile, tester, effacerClient, chiffrerFile, renouvelerCleFile, renouvelerSecret, changerDonneesClient, chiffrerSecrets, secretsIllisibles, signer, verifierUrl, poster };
}

module.exports = { creerIntegrations, ipInterne, PORTEES, EVENEMENTS };
