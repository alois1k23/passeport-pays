/* Chiffrement au repos des données personnelles des clients dans les commandes (nom, e-mail, adresse, téléphone…).
   - AES-256-GCM (chiffrement authentifié) : une donnée modifiée ou déplacée dans la base est détectée, pas lue de travers.
     Le chiffré est lié à son usage (données associées « comptoir:client:v1 »).
   - Index aveugle de l'e-mail : HMAC-SHA256 (clé distincte), pour retrouver les commandes d'un client sans stocker son
     adresse en clair ni pouvoir la retrouver depuis l'index.
   - Clés dérivées (HKDF) de la clé principale : avec SECRET_CHIFFREMENT gardée hors de la base, une copie de la base
     ou d'une sauvegarde ne révèle aucun client. Sans elle, la clé est dans la base et le chiffrement ne protège pas
     contre une copie complète (avertissement au démarrage, comme pour le reste).
   Format : « v1. » + base64url(iv 12 octets | étiquette 16 octets | chiffré). */
'use strict';
const crypto = require('node:crypto');

const AAD = Buffer.from('comptoir:client:v1');

function creer(cle) {
  const kChiffre = Buffer.from(crypto.hkdfSync('sha256', cle, Buffer.alloc(0), 'comptoir:pii:chiffrement', 32));
  const kIndex = Buffer.from(crypto.hkdfSync('sha256', cle, Buffer.alloc(0), 'comptoir:pii:index', 32));
  const chiffrer = objet => {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', kChiffre, iv);
    c.setAAD(AAD);
    const ct = Buffer.concat([c.update(JSON.stringify(objet), 'utf8'), c.final()]);
    return `v1.${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url')}`;
  };
  const dechiffrer = texte => {
    if (typeof texte !== 'string' || !texte.startsWith('v1.')) throw new Error('donnée client chiffrée illisible');
    const b = Buffer.from(texte.slice(3), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', kChiffre, b.subarray(0, 12));
    d.setAAD(AAD); d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  };
  const index = email => { const e = String(email || '').trim().toLowerCase(); return e ? crypto.createHmac('sha256', kIndex).update(e).digest('hex').slice(0, 40) : null; };
  return {
    chiffrer, dechiffrer, index,
    /* Données d'une commande telles qu'écrites en base : le client remplacé par son chiffré. */
    versStockage(donnees) {
      if (!donnees || !donnees.client) return donnees;
      const { client, ...reste } = donnees;
      return { ...reste, clientChiffre: chiffrer(client) };
    },
    /* Données lues en base : le client déchiffré (les commandes d'avant le chiffrement sont lues telles quelles). */
    depuisStockage(donnees) {
      if (!donnees || !donnees.clientChiffre) return donnees;
      const { clientChiffre, ...reste } = donnees;
      return { ...reste, client: dechiffrer(clientChiffre) };
    }
  };
}

module.exports = { creer };
