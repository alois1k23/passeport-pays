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
  try {
    const sortie = fs.createWriteStream(temp, { mode: 0o600 });
    sortie.write(Buffer.concat([ENTETE, iv]));
    await pipeline(fs.createReadStream(source), c, sortie);
    fs.appendFileSync(temp, c.getAuthTag());
    fs.renameSync(temp, destination);   // jamais de fichier à moitié écrit sous le nom final
  } catch (e) { fs.rmSync(temp, { force: true }); throw e; }
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
    await pipeline(fs.createReadStream(source, { start: tete.length, end: taille - 17 }), d, fs.createWriteStream(temp, { mode: 0o600 }));
    fs.renameSync(temp, destination);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    // Disque plein, droits… : l'erreur d'origine (sinon la console accuserait la clé à tort).
    if (e && e.code && !String(e.code).startsWith('ERR_CRYPTO') && e.code !== 'ERR_OSSL_BAD_DECRYPT') throw e;
    throw new Error('Restauration refusée : mauvaise clé, ou fichier modifié ou abîmé.');
  }
}
/* Empreinte SHA-256 de la base contenue dans une sauvegarde chiffrée, calculée en flux : rien n'est écrit sur le disque
   (pas de copie en clair), et l'étiquette d'authenticité est contrôlée (une copie altérée échoue). */
async function empreinteDechiffree(source, cleHex) {
  const taille = fs.statSync(source).size;
  const fd = fs.openSync(source, 'r'); const tete = Buffer.alloc(ENTETE.length + 12), tag = Buffer.alloc(16);
  fs.readSync(fd, tete, 0, tete.length, 0); fs.readSync(fd, tag, 0, 16, taille - 16); fs.closeSync(fd);
  if (!tete.subarray(0, ENTETE.length).equals(ENTETE)) throw new Error('en-tête de sauvegarde invalide');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cleHex, 'hex'), tete.subarray(ENTETE.length)); d.setAuthTag(tag);
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(source, { start: tete.length, end: taille - 17 }), d, async function* (flux) { for await (const morceau of flux) h.update(morceau); });
  return h.digest('hex');
}


/* Sauvegarde du jour : copie cohérente (VACUUM INTO) dans un fichier caché créé en 0600, vérifiée (quick_check), puis :
   - avec une clé (SAUVEGARDE_CLE) : chiffrée, la copie en clair effacée aussitôt, puis RESTAURÉE À L'ESSAI en mémoire
     (déchiffrée en flux, sans rien écrire) : elle doit redonner exactement les mêmes octets (SHA-256) que la copie
     vérifiée. Une sauvegarde chiffrée qu'on ne saurait pas restaurer avec la clé actuelle n'est jamais gardée. (Cela
     prouve que la clé actuelle la relit, pas que cette clé est gardée ailleurs : c'est à l'exploitant de la conserver.)
   - sans clé : seulement vérifiée par quick_check (pas d'essai de restauration).
   Puis renommée sous son nom final. En cas d'échec (disque plein, arrêt), rien ne
   reste : ni copie en clair, ni fichier partiel, ni sauvegarde vide qui prendrait la place d'une bonne.
   Rétention : les 14 plus récentes ; la plus récente n'est jamais supprimée. */
const path = require('node:path');
const MOTIF = /^comptoir-\d{4}-\d{2}-\d{2}\.db(\.enc)?$/;
let enCours = false;
async function sauvegarderBase(db, dossier, opts = {}) {
  // Une seule à la fois : une tentative lente n'est pas doublée par la suivante (qui effacerait ses fichiers temporaires).
  if (enCours) return { enCours: true, cree: false };
  enCours = true;
  try { return await sauvegarderUne(db, dossier, opts); } finally { enCours = false; }
}
async function sauvegarderUne(db, dossier, { cle = null, date = new Date(), garder = 14 } = {}) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  // Restes d'un essai interrompu : effacés
  for (const f of fs.readdirSync(dossier)) if (/^\.comptoir-.*\.tmp$/.test(f) || f.endsWith('.partiel')) fs.rmSync(path.join(dossier, f), { force: true });
  const chiffree = cleValide(cle);
  // Anciennes copies en clair alors qu'une clé est maintenant fournie : chiffrées, puis effacées
  if (chiffree) for (const f of fs.readdirSync(dossier).filter(x => /^comptoir-\d{4}-\d{2}-\d{2}\.db$/.test(x))) {
    const src = path.join(dossier, f);
    // Même garantie que pour une nouvelle sauvegarde : la copie en clair n'est effacée qu'une fois la version chiffrée relue.
    if (!fs.existsSync(src + '.enc')) {
      await chiffrer(src, src + '.enc', cle);
      if (await empreinteDechiffree(src + '.enc', cle) !== await empreinteFichier(src)) { fs.rmSync(src + '.enc', { force: true }); throw new Error(`chiffrement de l’ancienne sauvegarde ${f} non relu`); }
    }
    fs.rmSync(src);
  }
  const nom = path.join(dossier, `comptoir-${date.toISOString().slice(0, 10)}.db`), final = chiffree ? nom + '.enc' : nom;
  let cree = false, commandes = null;
  if (!fs.existsSync(final)) {
    const base = path.join(dossier, `.comptoir-${process.pid}-${Date.now()}`);
    const temp = base + '.tmp', tempChiffre = base + '-chiffre.tmp';
    try {
      fs.closeSync(fs.openSync(temp, 'wx', 0o600));   // fichier vide, lisible par le seul propriétaire, rempli par SQLite
      db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
      const { DatabaseSync } = require('node:sqlite');
      const v = new DatabaseSync(temp, { readOnly: true });
      const ok = v.prepare('PRAGMA quick_check').get();
      try { commandes = v.prepare('SELECT COUNT(*) n FROM commandes').get().n; } catch { commandes = null; }
      v.close();
      if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('copie de la base invalide');
      if (chiffree) {
        const empreinte = await empreinteFichier(temp);
        await chiffrer(temp, tempChiffre, cle);
        fs.rmSync(temp, { force: true });   // la copie en clair ne reste pas pendant l'essai
        if (await empreinteDechiffree(tempChiffre, cle) !== empreinte) throw new Error('la sauvegarde chiffrée ne redonne pas la même base à la restauration');
        fs.renameSync(tempChiffre, final);
      } else fs.renameSync(temp, final);
      cree = true;
    } finally { for (const f of [temp, tempChiffre]) fs.rmSync(f, { force: true }); }
  }
  const fichiers = fs.readdirSync(dossier).filter(f => MOTIF.test(f) && fs.statSync(path.join(dossier, f)).size > 0).sort();
  for (const f of fichiers.slice(0, -Math.max(1, garder))) fs.rmSync(path.join(dossier, f));
  return { fichier: final, cree, chiffree, verifiee: cree && chiffree, commandes, taille: fs.existsSync(final) ? fs.statSync(final).size : 0 };
}
const empreinteFichier = f => new Promise((ok, ko) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko); });

module.exports = { chiffrer, dechiffrer, cleValide, sauvegarderBase, empreinteDechiffree };
