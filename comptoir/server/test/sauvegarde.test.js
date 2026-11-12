// Sauvegardes chiffrées : aller-retour, mauvaise clé et fichier modifié refusés, restauration en ligne de commande.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const S = require('../src/sauvegarde');
const { ouvrir } = require('../src/db');

test('sauvegarde chiffrée de bout en bout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpt-sauv-'));
  try {
    const cle = crypto.randomBytes(32).toString('hex');
    const db = ouvrir(path.join(dir, 'base.db'));
    db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m1', 'secret@exemple.ch', 'x', 0)").run();
    db.exec(`VACUUM INTO '${path.join(dir, 'copie.db')}'`);
    await S.chiffrer(path.join(dir, 'copie.db'), path.join(dir, 'copie.db.enc'), cle);
    assert.ok(!fs.readFileSync(path.join(dir, 'copie.db.enc')).includes('secret@exemple.ch'), 'illisible sans la clé');
    await assert.rejects(S.dechiffrer(path.join(dir, 'copie.db.enc'), path.join(dir, 'x.db'), crypto.randomBytes(32).toString('hex')), /mauvaise clé/);
    assert.ok(!fs.existsSync(path.join(dir, 'x.db')) && !fs.existsSync(path.join(dir, 'x.db.partiel')), 'rien de laissé après un échec');
    const abime = Buffer.from(fs.readFileSync(path.join(dir, 'copie.db.enc'))); abime[100] ^= 1; fs.writeFileSync(path.join(dir, 'abime.enc'), abime);
    await assert.rejects(S.dechiffrer(path.join(dir, 'abime.enc'), path.join(dir, 'y.db'), cle), /modifié/);
    // Restauration par la commande du serveur
    execFileSync(process.execPath, [path.join(__dirname, '..', 'server.js'), '--restaurer', path.join(dir, 'copie.db.enc'), path.join(dir, 'restauree.db')], { env: { ...process.env, SAUVEGARDE_CLE: cle }, stdio: 'pipe' });
    assert.equal(ouvrir(path.join(dir, 'restauree.db')).prepare('SELECT email FROM marchands').get().email, 'secret@exemple.ch');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
