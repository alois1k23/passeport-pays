/* Clés d'accès (passkeys, norme W3C WebAuthn niveau 2), sans dépendance.
   - Enregistrement : attestation « none » (on ne demande pas l'identité du fabricant), clé publique COSE convertie en JWK.
   - Connexion : signature vérifiée sur authenticatorData || SHA-256(clientDataJSON), avec ES256 (P-256) ou RS256.
   - Vérification de l'utilisateur (UV : visage, empreinte, code de l'appareil) exigée : une clé d'accès vaut deux facteurs.
   - Le compteur de signatures, quand l'appareil en tient un, détecte une clé clonée. */
'use strict';
const crypto = require('node:crypto');

const b64u = b => Buffer.from(b).toString('base64url');
const deB64u = t => Buffer.from(String(t || ''), 'base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();

/* Décodeur CBOR minimal (RFC 8949) : entiers, chaînes d'octets et de texte, tableaux, tables, simples. Limité en
   profondeur et en taille : une entrée piégée ne peut pas faire exploser la mémoire. */
function decoderCbor(buf, depart = 0) {
  let i = depart;
  const lireLongueur = info => {
    if (info < 24) return info;
    if (info === 24) { if (i + 1 > buf.length) throw new Error('CBOR tronqué'); return buf[i++]; }
    if (info === 25) { if (i + 2 > buf.length) throw new Error('CBOR tronqué'); const v = buf.readUInt16BE(i); i += 2; return v; }
    if (info === 26) { if (i + 4 > buf.length) throw new Error('CBOR tronqué'); const v = buf.readUInt32BE(i); i += 4; return v; }
    throw new Error('CBOR : longueur non prise en charge');
  };
  const element = profondeur => {
    if (profondeur > 8) throw new Error('CBOR trop profond');
    if (i >= buf.length) throw new Error('CBOR tronqué');
    const octet = buf[i++], type = octet >> 5, info = octet & 31;
    switch (type) {
      case 0: return lireLongueur(info);
      case 1: return -1 - lireLongueur(info);
      case 2: case 3: {
        const n = lireLongueur(info);
        if (i + n > buf.length) throw new Error('CBOR tronqué');
        const v = buf.subarray(i, i + n); i += n;
        return type === 2 ? Buffer.from(v) : v.toString('utf8');
      }
      case 4: { const n = lireLongueur(info); if (n > 64) throw new Error('CBOR : tableau trop long'); const t = []; for (let k = 0; k < n; k++) t.push(element(profondeur + 1)); return t; }
      case 5: { const n = lireLongueur(info); if (n > 64) throw new Error('CBOR : table trop longue'); const m = new Map(); for (let k = 0; k < n; k++) { const c = element(profondeur + 1); m.set(c, element(profondeur + 1)); } return m; }
      case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; throw new Error('CBOR : valeur simple non prise en charge');
      default: throw new Error('CBOR : type non pris en charge');
    }
  };
  const valeur = element(0);
  return { valeur, fin: i };
}

/* Clé publique COSE → objet KeyObject de Node (EC2 P-256 / ES256, ou RSA / RS256). */
function cleDepuisCose(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = cose.get(-2), y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('clé EC invalide');
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) } };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1), e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) throw new Error('clé RSA invalide (2048 bits au moins)');
    return { alg: -257, jwk: { kty: 'RSA', n: b64u(n), e: b64u(e) } };
  }
  throw new Error('Algorithme de clé non pris en charge (ES256 ou RS256 attendus).');
}

/* authenticatorData : empreinte du domaine (32), drapeaux (1), compteur (4), puis données de la clé si AT. */
function lireAuthData(ad) {
  if (ad.length < 37) throw new Error('authenticatorData trop court');
  const r = { rpIdHash: ad.subarray(0, 32), drapeaux: ad[32], compteur: ad.readUInt32BE(33) };
  r.up = !!(r.drapeaux & 0x01); r.uv = !!(r.drapeaux & 0x04); r.at = !!(r.drapeaux & 0x40);
  if (r.at) {
    if (ad.length < 55) throw new Error('données de clé tronquées');
    const lg = ad.readUInt16BE(53);
    if (lg > 1023 || ad.length < 55 + lg) throw new Error('identifiant de clé invalide');
    r.credId = Buffer.from(ad.subarray(55, 55 + lg));
    const { valeur } = decoderCbor(ad, 55 + lg);
    if (!(valeur instanceof Map)) throw new Error('clé COSE invalide');
    r.cose = valeur;
  }
  return r;
}

function verifierClientData(clientDataJSON, { type, defi, origine }) {
  let cd;
  try { cd = JSON.parse(deB64u(clientDataJSON).toString('utf8')); } catch { throw new Error('clientDataJSON illisible'); }
  if (cd.type !== type) throw new Error('type de cérémonie inattendu');
  if (!defi || cd.challenge !== defi) throw new Error('défi inattendu');
  if (cd.origin !== origine) throw new Error('origine inattendue : ' + String(cd.origin).slice(0, 80));
  if (cd.crossOrigin === true) throw new Error('appel depuis un autre site refusé');
  return cd;
}

/* Enregistrement : renvoie { credId, cle (JWK + alg), compteur } ou lève une erreur. */
function verifierEnregistrement(rep, { defi, origine, rpId }) {
  verifierClientData(rep.clientDataJSON, { type: 'webauthn.create', defi, origine });
  const { valeur: att } = decoderCbor(deB64u(rep.attestationObject));
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new Error('attestationObject invalide');
  const ad = lireAuthData(att.get('authData'));
  if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error('domaine inattendu');
  if (!ad.up || !ad.uv) throw new Error('vérification de l’utilisateur exigée (visage, empreinte ou code de l’appareil)');
  if (!ad.at || !ad.credId) throw new Error('aucune clé dans la réponse');
  const cle = cleDepuisCose(ad.cose);
  crypto.createPublicKey({ key: cle.jwk, format: 'jwk' });   // clé utilisable (point sur la courbe, etc.)
  return { credId: b64u(ad.credId), cle, compteur: ad.compteur };
}

/* Connexion : vérifie la signature et renvoie le nouveau compteur, ou lève une erreur. */
function verifierConnexion(rep, { defi, origine, rpId, cle, compteur }) {
  verifierClientData(rep.clientDataJSON, { type: 'webauthn.get', defi, origine });
  const adBuf = deB64u(rep.authenticatorData);
  const ad = lireAuthData(adBuf);
  if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error('domaine inattendu');
  if (!ad.up || !ad.uv) throw new Error('vérification de l’utilisateur exigée');
  const donnees = Buffer.concat([adBuf, sha256(deB64u(rep.clientDataJSON))]);
  const pub = crypto.createPublicKey({ key: cle.jwk, format: 'jwk' });
  const ok = cle.alg === -7
    ? crypto.verify('sha256', donnees, { key: pub, dsaEncoding: 'der' }, deB64u(rep.signature))
    : crypto.verify('sha256', donnees, { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, deB64u(rep.signature));
  if (!ok) throw new Error('signature invalide');
  // Compteur : s'il est tenu et ne progresse pas, la clé a peut-être été copiée.
  if ((ad.compteur !== 0 || compteur !== 0) && ad.compteur <= compteur) throw new Error('compteur de la clé incohérent (clé clonée ?)');
  return { compteur: ad.compteur };
}

module.exports = { decoderCbor, lireAuthData, cleDepuisCose, verifierEnregistrement, verifierConnexion, b64u, deB64u };
