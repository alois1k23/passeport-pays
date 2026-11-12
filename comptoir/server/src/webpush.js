/* Notifications push (Web Push) sans dépendance :
   - chiffrement du message pour l'appareil : RFC 8291 (ECDH P-256 + HKDF + AES-128-GCM, codage « aes128gcm » de la RFC 8188) ;
   - identification du serveur auprès du service push : VAPID, RFC 8292 (jeton JWT signé en ES256).
   Le service push (Google, Mozilla, Apple, Microsoft) ne voit qu'un message chiffré : seul l'appareil du marchand le lit. */
'use strict';
const crypto = require('node:crypto');

const b64u = b => Buffer.from(b).toString('base64url');
const deB64u = t => Buffer.from(String(t || ''), 'base64url');
const hkdf = (sel, ikm, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, sel, info, n));

/* Paire de clés VAPID (P-256) : publique non compressée (65 octets) et privée (32 octets), en base64url. */
function genererClesVapid() {
  const e = crypto.createECDH('prime256v1'); e.generateKeys();
  return { publique: b64u(e.getPublicKey()), privee: b64u(e.getPrivateKey()) };
}
const clePriveeObjet = (publique, privee) => {
  const pub = deB64u(publique);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privee }, format: 'jwk' });
};

/* Chiffrement RFC 8291. sel et clés de l'expéditeur injectables pour vérifier le vecteur de test de la RFC. */
function chiffrer(message, { p256dh, auth }, { sel = crypto.randomBytes(16), expediteur = null, taille = 4096 } = {}) {
  const uaPublique = deB64u(p256dh), secretAuth = deB64u(auth);
  if (uaPublique.length !== 65 || secretAuth.length !== 16) throw new Error('abonnement push invalide');
  const as = crypto.createECDH('prime256v1');
  if (expediteur) as.setPrivateKey(deB64u(expediteur)); else as.generateKeys();
  const asPublique = as.getPublicKey();
  const secretEcdh = as.computeSecret(uaPublique);
  const ikm = hkdf(secretAuth, secretEcdh, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublique, asPublique]), 32);
  const cek = hkdf(sel, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sel, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const clair = Buffer.concat([Buffer.from(message), Buffer.from([2])]);   // 0x02 : dernier (et seul) enregistrement
  if (clair.length + 16 > taille) throw new Error('message push trop long');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const chiffre = Buffer.concat([c.update(clair), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(taille);
  return Buffer.concat([sel, rs, Buffer.from([asPublique.length]), asPublique, chiffre]);
}

/* Jeton VAPID pour l'origine du service push (valable 12 h). */
function enteteVapid(endpoint, { publique, privee, sujet }) {
  const aud = new URL(endpoint).origin;
  const tete = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corps = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujet }));
  const sig = crypto.sign('sha256', Buffer.from(`${tete}.${corps}`), { key: clePriveeObjet(publique, privee), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${tete}.${corps}.${b64u(sig)}, k=${publique}`;
}

// Services push connus (navigateurs) : aucune autre adresse n'est contactée (pas de requête vers l'intérieur du réseau).
const SERVICES = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
function endpointValide(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && SERVICES.some(r => r.test(u.hostname)); } catch { return false; }
}

/* Envoi : renvoie le code HTTP (201 = accepté ; 404/410 = abonnement expiré, à supprimer). */
async function envoyer(abonnement, message, vapid, { fetchImpl = fetch, ttl = 86400, urgence = 'high' } = {}) {
  if (!endpointValide(abonnement.endpoint)) return 'invalide';
  const corps = chiffrer(JSON.stringify(message), abonnement);
  const r = await fetchImpl(abonnement.endpoint, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgence, Authorization: enteteVapid(abonnement.endpoint, vapid) }, body: corps });
  try { await r.body?.cancel(); } catch { /* ignoré */ }
  return r.status;
}

module.exports = { genererClesVapid, chiffrer, enteteVapid, endpointValide, envoyer, b64u, deB64u };
