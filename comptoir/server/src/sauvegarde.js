/* Sauvegardes chiffrées (facultatif, SAUVEGARDE_CLE = 64 caractères hexadécimaux) : AES-256-GCM, en flux.
   Format : « CPTB1 » (5 octets) · vecteur d'initialisation (12) · données chiffrées · étiquette d'authenticité (16).
   Une copie volée hors du serveur (stockage objet, disque externe) est illisible sans la clé ; une copie modifiée
   est refusée à la restauration. */
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const ENTETE = Buffer.from('CPTB1');

const cleValide = c => /^[0-9a-f]{64}$/i.test(String(c || ''));

async function chiffrer(source, destination, cleHex) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(cleHex, 'hex'), iv);
  const temp = destination + '.partiel';
  const sortie = fs.createWriteStream(temp);
  sortie.write(Buffer.concat([ENTETE, iv]));
  await pipeline(fs.createReadStream(source), c, sortie);
  fs.appendFileSync(temp, c.getAuthTag());
  fs.renameSync(temp, destination);   // jamais de fichier à moitié écrit sous le nom final
}

async function dechiffrer(source, destination, cleHex) {
  const taille = fs.statSync(source).size;
  if (taille < ENTETE.length + 12 + 16) throw new Error('Fichier trop court : ce n’est pas une sauvegarde chiffrée de Comptoir.');
  const fd = fs.openSync(source, 'r');
  const tete = Buffer.alloc(ENTETE.length + 12), tag = Buffer.alloc(16);
  fs.readSync(fd, tete, 0, tete.length, 0); fs.readSync(fd, tag, 0, 16, taille - 16); fs.closeSync(fd);
  if (!tete.subarray(0, ENTETE.length).equals(ENTETE)) throw new Error('Ce fichier n’est pas une sauvegarde chiffrée de Comptoir.');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cleHex, 'hex'), tete.subarray(ENTETE.length));
  d.setAuthTag(tag);
  const temp = destination + '.partiel';
  try {
    await pipeline(fs.createReadStream(source, { start: tete.length, end: taille - 17 }), d, fs.createWriteStream(temp));
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw new Error('Restauration refusée : mauvaise clé, ou fichier modifié ou abîmé.');
  }
  fs.renameSync(temp, destination);
}

module.exports = { chiffrer, dechiffrer, cleValide };
