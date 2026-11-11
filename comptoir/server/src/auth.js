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
  return `${COOKIE}=${jeton || ''}; ${attributs.join('; ')}`;
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

/* Limite les essais de connexion : 10 par adresse IP et par quart d'heure. */
const essais = new Map();
function limiterConnexion(ip, max = 10) {
  const maintenant = Date.now();
  const e = essais.get(ip) || { n: 0, depuis: maintenant };
  if (maintenant - e.depuis > 15 * 60 * 1000) { e.n = 0; e.depuis = maintenant; }
  e.n++;
  essais.set(ip, e);
  if (essais.size > 50000) for (const [k, v] of essais) if (maintenant - v.depuis > 15 * 60 * 1000) essais.delete(k);
  if (e.n > max) throw erreur(429, 'Trop d’essais de connexion. Réessayez dans 15 minutes.', 'trop_essais');
}

/* Connexion : seuls les ÉCHECS comptent (une connexion réussie ne bloque personne), par adresse et par compte visé. */
const echecs = new Map();
function compteEchecs(cle) {
  const e = echecs.get(cle);
  if (!e || Date.now() - e.depuis > 15 * 60 * 1000) return 0;
  return e.n;
}
function verifierEchecs(cles, max) {
  if (cles.some(c => compteEchecs(c) >= max)) throw erreur(429, 'Trop d’essais de connexion. Réessayez dans 15 minutes.', 'trop_essais');
}
function oublierEchecs(cles) { for (const c of cles) echecs.delete(c); }
/* Essai de mot de passe compté AVANT le calcul (asynchrone) : des requêtes parallèles ne passent pas toutes la limite
   avant qu'un seul échec soit noté. Un essai réussi est ensuite décompté. */
async function essayerMotDePasse(cles, max, mdp, stocke) {
  verifierEchecs(cles, max);
  noterEchec(cles);
  const ok = !!stocke && await verifierMotDePasse(mdp, stocke);
  if (ok) for (const c of cles) { const e = echecs.get(c); if (e && e.n > 0) e.n--; }
  return ok;
}
function noterEchec(cles) {
  const maintenant = Date.now();
  // Purge : la table ne grossit pas sans limite (adresses et e-mails choisis par un attaquant).
  if (echecs.size > 20000) for (const [k, e] of echecs) if (maintenant - e.depuis > 15 * 60 * 1000) echecs.delete(k);
  for (const c of cles) { const e = echecs.get(c); if (!e || maintenant - e.depuis > 15 * 60 * 1000) echecs.set(c, { n: 1, depuis: maintenant }); else e.n++; }
}

/* Limite de débit générique (mémoire du processus) : max requêtes par fenêtre pour une clé (ex. « commande:<ip> »). */
const compteurs = new Map();
function limiter(cle, max, fenetreMs, message) {
  const maintenant = Date.now();
  const e = compteurs.get(cle) || { n: 0, depuis: maintenant };
  if (maintenant - e.depuis > fenetreMs) { e.n = 0; e.depuis = maintenant; }
  e.n++;
  compteurs.set(cle, e);
  if (compteurs.size > 50000) for (const [k, v] of compteurs) if (maintenant - v.depuis > fenetreMs) compteurs.delete(k);
  if (e.n > max) throw erreur(429, message, 'trop_de_requetes');
}

module.exports = { essayerMotDePasse, egal, limiter, hacherMotDePasse, verifierMotDePasse, creerSession, cookieSession, marchandDepuisRequete, supprimerSession, limiterConnexion, verifierEchecs, noterEchec, oublierEchecs, nouvelId, sha256, COOKIE };
