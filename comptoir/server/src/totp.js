// Double authentification par code à usage unique (TOTP, RFC 6238 : HMAC-SHA1, 30 secondes, 6 chiffres),
// compatible avec Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Proton Pass…
// Les secrets sont chiffrés en base (AES-256-GCM) ; un code déjà utilisé ne sert pas deux fois.
'use strict';
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, valeur = 0, out = '';
  for (const o of buf) { valeur = (valeur << 8) | o; bits += 8; while (bits >= 5) { out += ALPHABET[(valeur >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(valeur << (5 - bits)) & 31];
  return out;
}
function deBase32(txt) {
  const propre = String(txt).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, valeur = 0; const out = [];
  for (const c of propre) { valeur = (valeur << 5) | ALPHABET.indexOf(c); bits += 5; if (bits >= 8) { out.push((valeur >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const nouveauSecret = () => base32(crypto.randomBytes(20));   // 160 bits, comme recommandé par la RFC 4226

function code(secret, pas) {
  const compteur = Buffer.alloc(8); compteur.writeBigUInt64BE(BigInt(pas));
  const h = crypto.createHmac('sha1', deBase32(secret)).update(compteur).digest();
  const d = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(d) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const pasActuel = (t = Date.now()) => Math.floor(t / 30000);

/* Vérifie un code (tolérance d'un pas avant ou après pour l'horloge du téléphone). Renvoie le pas utilisé, ou null.
   dernierPas : dernier pas accepté pour ce compte ; un code de ce pas ou d'avant est refusé (pas de rejeu). */
function verifier(secret, saisi, { t = Date.now(), dernierPas = -1 } = {}) {
  const c = String(saisi || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const p = pasActuel(t);
  for (const delta of [0, -1, 1]) {
    const pas = p + delta;
    if (pas <= dernierPas) continue;
    const attendu = code(secret, pas);
    if (crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(c))) return pas;
  }
  return null;
}

/* Adresse à mettre dans le QR code de l'application d'authentification. */
const uri = (secret, compte, emetteur = 'Comptoir') =>
  `otpauth://totp/${encodeURIComponent(emetteur)}:${encodeURIComponent(compte)}?secret=${secret}&issuer=${encodeURIComponent(emetteur)}&algorithm=SHA1&digits=6&period=30`;

/* Codes de secours : 10 codes de 10 caractères, gardés seulement en empreinte (SHA-256). */
function codesSecours() {
  const codes = Array.from({ length: 10 }, () => base32(crypto.randomBytes(7)).slice(0, 10).toLowerCase().replace(/(.{5})/, '$1-'));
  return { codes, empreintes: codes.map(empreinteSecours) };
}
const empreinteSecours = c => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

/* Chiffrement des secrets au repos (clé serveur de 32 octets). */
function chiffrer(cle, texte) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', cle, iv);
  const corps = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), corps].map(b => b.toString('base64url')).join('.');
}
function dechiffrer(cle, enveloppe) {
  const [iv, tag, corps] = String(enveloppe).split('.').map(x => Buffer.from(x, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', cle, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(corps), d.final()]).toString('utf8');
}

module.exports = { base32, deBase32, nouveauSecret, code, pasActuel, verifier, uri, codesSecours, empreinteSecours, chiffrer, dechiffrer };
