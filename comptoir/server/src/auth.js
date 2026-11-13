// Comptes marchands : mots de passe scrypt, sessions par cookie HttpOnly.
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const DUREE_SESSION = 30 * 24 * 3600 * 1000;
const COOKIE = 'comptoir_session';

// scrypt asynchrone : un calcul (≈ 50 ms) ne bloque pas les autres requêtes pendant ce temps.
const scrypt = (mdp, sel, n) => new Promise((ok, ko) => crypto.scrypt(mdp, sel, n, { N: 16384, r: 8, p: 1 }, (e, h) => e ? ko(e) : ok(h)));
async function hacherMotDePasse(mdp) {
  const sel = crypto.randomBytes(16);
  const hash = await scrypt(mdp, sel, 64);
  return `scrypt$${sel.toString('base64')}$${hash.toString('base64')}`;
}

async function verifierMotDePasse(mdp, stocke) {
  const [algo, selB64, hashB64] = String(stocke).split('$');
  if (algo !== 'scrypt') return false;
  const attendu = Buffer.from(hashB64, 'base64');
  if (!attendu.length) return false;
  const calcule = await scrypt(mdp, Buffer.from(selB64 || '', 'base64'), attendu.length);
  return crypto.timingSafeEqual(attendu, calcule);
}

const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
/* Comparaison à temps constant de deux textes, sûre pour les caractères multi-octets (longueurs en octets). */
function egal(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const nouvelId = (prefixe = '') => prefixe + crypto.randomBytes(9).toString('base64url');

function creerSession(db, marchandId) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (jeton_hash, marchand_id, expire_le) VALUES (?, ?, ?)').run(sha256(jeton), marchandId, Date.now() + DUREE_SESSION);
  return jeton;
}

function cookieSession(jeton, securise) {
  const attributs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${jeton ? DUREE_SESSION / 1000 : 0}`];
  if (securise) attributs.push('Secure');
  // HTTPS : préfixe __Host- (Secure, Path=/, sans Domain) : ni un sous-domaine ni une page en HTTP ne peuvent poser ou remplacer la session.
  return `${securise ? '__Host-' : ''}${COOKIE}=${jeton || ''}; ${attributs.join('; ')}`;
}

function marchandDepuisRequete(db, cookies) {
  const jeton = cookies[COOKIE];
  if (!jeton) return null;
  const s = db.prepare('SELECT marchand_id, expire_le FROM sessions WHERE jeton_hash = ?').get(sha256(jeton));
  if (!s || s.expire_le < Date.now()) return null;
  const m = db.prepare('SELECT id, email FROM marchands WHERE id = ?').get(s.marchand_id) || null;
  // Session glissante : un marchand qui utilise son espace n'est pas déconnecté au bout de 30 jours ;
  // passé la moitié de sa durée, elle repart pour 30 jours (le cookie est renouvelé par l'appelant).
  if (m && s.expire_le - Date.now() < DUREE_SESSION / 2) {
    db.prepare('UPDATE sessions SET expire_le = ? WHERE jeton_hash = ?').run(Date.now() + DUREE_SESSION, sha256(jeton));
    m.cookieRenouvele = jeton;
  }
  return m;
}

function supprimerSession(db, cookies) {
  if (cookies[COOKIE]) db.prepare('DELETE FROM sessions WHERE jeton_hash = ?').run(sha256(cookies[COOKIE]));
}

/* Compteurs anti-abus (essais de connexion, échecs, limites de débit).
   En mémoire pour la vitesse, et recopiés en base toutes les 2 secondes et à l'arrêt, puis rechargés au démarrage :
   un redémarrage du serveur (même provoqué) ne remet pas les compteurs à zéro.
   Les clés (qui contiennent des adresses IP ou des e-mails) ne sont jamais écrites en clair : seulement leur empreinte. */
const QUART = 15 * 60 * 1000;
// Empreinte HMAC avec une clé du serveur (dérivée de SECRET_CHIFFREMENT) : une copie de la base ne permet pas de retrouver
// les adresses IP par force brute. Avant l'appel de persisterLimites, clé aléatoire propre au processus.
let cleEmpreinte = crypto.randomBytes(32), cleFixee = false;
const empreinteCle = cle => crypto.createHmac('sha256', cleEmpreinte).update('limite|' + cle).digest('hex').slice(0, 32);
const modifies = new Set();   // « type|empreinte » à recopier en base
let basePersistance = null, minuteur = null;
function marquer(type, k) { if (basePersistance) modifies.add(`${type}|${k}`); }
function persisterLimites(db, cle) {
  // Clé fixée une seule fois par processus (les compteurs en mémoire en dépendent).
  if (!cleFixee && cle) { cleEmpreinte = crypto.createHmac('sha256', cle).update('comptoir:limites').digest(); cleFixee = true; essais.clear(); echecs.clear(); compteurs.clear(); }
  db.exec(`CREATE TABLE IF NOT EXISTS limites (type TEXT NOT NULL, cle TEXT NOT NULL, n INTEGER NOT NULL, depuis INTEGER NOT NULL, fenetre INTEGER NOT NULL, expire INTEGER, PRIMARY KEY (type, cle));`);
  try { db.exec('ALTER TABLE limites ADD COLUMN expire INTEGER'); } catch { /* déjà là */ }
  db.exec('CREATE INDEX IF NOT EXISTS limites_expire ON limites (expire)');
  const maintenant = Date.now();
  db.prepare('DELETE FROM limites WHERE expire IS NULL OR expire < ?').run(maintenant);
  for (const r of db.prepare('SELECT * FROM limites').all()) {
    const carte = r.type === 'essais' ? essais : r.type === 'echecs' ? echecs : compteurs;
    const e = carte.get(r.cle);
    if (!e || e.depuis < r.depuis || (e.depuis === r.depuis && e.n < r.n)) carte.set(r.cle, { n: r.n, depuis: r.depuis, fenetre: r.fenetre });
  }
  basePersistance = db;
  if (!minuteur) { minuteur = setInterval(() => ecrireLimites(), 2000); minuteur.unref(); }
}
let derniereExpiration = 0, erreurSignalee = false;
function ecrireLimites(tout = false) {
  const db = basePersistance; if (!db || !modifies.size) return;
  // Par lots de 2000 (le serveur reste disponible) ; tout d'un coup à l'arrêt.
  const lot = [...modifies].slice(0, tout ? Infinity : 2000);
  for (const t of lot) modifies.delete(t);
  try {
    db.exec('BEGIN');
    const ecr = db.prepare('INSERT OR REPLACE INTO limites (type, cle, n, depuis, fenetre, expire) VALUES (?, ?, ?, ?, ?, ?)'), eff = db.prepare('DELETE FROM limites WHERE type = ? AND cle = ?');
    for (const t of lot) {
      const i = t.indexOf('|'), type = t.slice(0, i), k = t.slice(i + 1);
      const e = (type === 'essais' ? essais : type === 'echecs' ? echecs : compteurs).get(k);
      if (e) ecr.run(type, k, e.n, e.depuis, e.fenetre || QUART, e.depuis + (e.fenetre || QUART)); else eff.run(type, k);
    }
    if (Date.now() - derniereExpiration > 60000) { db.prepare('DELETE FROM limites WHERE expire < ?').run(Date.now()); derniereExpiration = Date.now(); }   // une fois par minute (colonne indexée)
    db.exec('COMMIT');
    erreurSignalee = false;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* base fermée */ }
    for (const t of lot) modifies.add(t);   // réessayé au prochain passage, rien n'est perdu
    if (!erreurSignalee) { erreurSignalee = true; console.error('[limites] écriture impossible, nouvel essai dans 2 s :', e.message); }
  }
}

/* Limite les essais de connexion : 10 par adresse IP et par quart d'heure. */
const essais = new Map();
// Bloc d'adresses voisines (IPv4 /24, IPv6 /48) : un robot qui change d'adresse dans son bloc ne remet pas son compteur à zéro.
// Sert aux échecs de connexion sur un compte donné, jamais à un compteur commun à tout le bloc (un voisin bloquerait les autres).
function blocReseau(ip) {
  const v = String(ip || '').replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v.replace(/\.\d+$/, '.0/24');
  if (v.includes(':')) return v.toLowerCase().split(':').slice(0, 3).join(':') + '::/48';
  return v;
}
function limiterConnexion(ip, max = 10) {
  const maintenant = Date.now(), k = empreinteCle(ip);
  const e = essais.get(k) || { n: 0, depuis: maintenant, fenetre: QUART };
  if (maintenant - e.depuis > QUART) { e.n = 0; e.depuis = maintenant; }
  e.n++;
  essais.set(k, e); marquer('essais', k);
  if (essais.size > 50000) for (const [k2, v] of essais) if (maintenant - v.depuis > QUART) { essais.delete(k2); marquer('essais', k2); }
  if (e.n > max) throw erreur(429, 'Trop d’essais de connexion. Réessayez dans 15 minutes.', 'trop_essais');
}

/* Connexion : seuls les ÉCHECS comptent (une connexion réussie ne bloque personne), par adresse et par compte visé. */
const echecs = new Map();
function compteEchecs(cle) {
  const e = echecs.get(empreinteCle(cle));
  if (!e || Date.now() - e.depuis > 15 * 60 * 1000) return 0;
  return e.n;
}
function verifierEchecs(cles, max) {
  if (cles.some(c => compteEchecs(c) >= max)) throw erreur(429, 'Trop d’essais de connexion. Réessayez dans 15 minutes.', 'trop_essais');
}
function oublierEchecs(cles) { for (const c of cles) { const k = empreinteCle(c); echecs.delete(k); marquer('echecs', k); } }
/* Essai de mot de passe compté AVANT le calcul (asynchrone) : des requêtes parallèles ne passent pas toutes la limite
   avant qu'un seul échec soit noté. Un essai réussi est ensuite décompté. */
// Empreinte factice au bon format : le calcul scrypt a lieu, la comparaison échoue toujours.
const HASH_FACTICE = ['scrypt', crypto.randomBytes(16).toString('base64'), crypto.randomBytes(64).toString('base64')].join('$');
async function essayerMotDePasse(cles, max, mdp, stocke) {
  verifierEchecs(cles, max);
  noterEchec(cles);
  // Compte inexistant : un calcul factice de même durée, pour ne pas révéler par le temps de réponse qu'il n'existe pas.
  const ok = stocke ? await verifierMotDePasse(mdp, stocke) : (await verifierMotDePasse(mdp, HASH_FACTICE), false);
  if (ok) for (const c of cles) { const k = empreinteCle(c), e = echecs.get(k); if (e && e.n > 0) { e.n--; marquer('echecs', k); } }
  return ok;
}
function noterEchec(cles) {
  const maintenant = Date.now();
  // Purge : la table ne grossit pas sans limite (adresses et e-mails choisis par un attaquant).
  if (echecs.size > 20000) for (const [k, e] of echecs) if (maintenant - e.depuis > QUART) { echecs.delete(k); marquer('echecs', k); }
  for (const c of cles) { const k = empreinteCle(c), e = echecs.get(k); if (!e || maintenant - e.depuis > QUART) echecs.set(k, { n: 1, depuis: maintenant, fenetre: QUART }); else e.n++; marquer('echecs', k); }
}

/* Limite de débit générique (mémoire du processus) : max requêtes par fenêtre pour une clé (ex. « commande:<ip> »). */
const compteurs = new Map();
function limiter(cle, max, fenetreMs, message) {
  const maintenant = Date.now(), k = empreinteCle(cle);
  const e = compteurs.get(k) || { n: 0, depuis: maintenant, fenetre: fenetreMs };
  if (maintenant - e.depuis > fenetreMs) { e.n = 0; e.depuis = maintenant; }
  e.n++; e.fenetre = fenetreMs;
  compteurs.set(k, e); marquer('compteurs', k);
  if (compteurs.size > 50000) for (const [k2, v] of compteurs) if (maintenant - v.depuis > (v.fenetre || fenetreMs)) { compteurs.delete(k2); marquer('compteurs', k2); }
  if (e.n > max) throw erreur(429, message, 'trop_de_requetes');
}

module.exports = { persisterLimites, ecrireLimites, compteEchecs, essayerMotDePasse, egal, limiter, hacherMotDePasse, verifierMotDePasse, creerSession, cookieSession, marchandDepuisRequete, supprimerSession, limiterConnexion, blocReseau, verifierEchecs, noterEchec, oublierEchecs, nouvelId, sha256, COOKIE };
