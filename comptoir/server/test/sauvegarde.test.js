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

test('sauvegarde du jour : vérifiée, chiffrée, 0600, rien en clair après un échec, rétention prudente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpt-sauv2-'));
  try {
    const cle = crypto.randomBytes(32).toString('hex');
    const db = ouvrir(path.join(dir, 'base.db'));
    db.prepare("INSERT INTO marchands (id, email, mot_de_passe, cree_le) VALUES ('m1', 'secret@exemple.ch', 'x', 0)").run();
    const dos = path.join(dir, 'sauvegardes');
    // Ancienne copie en clair laissée par une version précédente : chiffrée puis effacée
    fs.mkdirSync(dos); db.exec(`VACUUM INTO '${path.join(dos, 'comptoir-2026-01-01.db')}'`);
    fs.writeFileSync(path.join(dos, '.comptoir-1-1.tmp'), 'reste'); fs.writeFileSync(path.join(dos, 'x.enc.partiel'), 'reste');
    const r = await S.sauvegarderBase(db, dos, { cle, date: new Date('2026-11-12') });
    assert.ok(r.cree && r.fichier.endsWith('.db.enc'));
    const noms = fs.readdirSync(dos).sort();
    assert.deepEqual(noms, ['comptoir-2026-01-01.db.enc', 'comptoir-2026-11-12.db.enc'], 'aucune copie en clair ni reste : ' + noms);
    assert.equal(fs.statSync(r.fichier).mode & 0o777, 0o600, 'lisible par le seul propriétaire');
    // Échec du chiffrement (clé invalide côté flux simulé) : rien ne reste
    const avant = fs.readdirSync(dos).length;
    await assert.rejects(S.sauvegarderBase({ exec() { throw new Error('disque plein'); } }, dos, { cle, date: new Date('2026-11-13') }), /disque plein/);
    assert.equal(fs.readdirSync(dos).length, avant, 'échec : aucun fichier ajouté (ni vide, ni temporaire)');
    // Rétention : garder 1 → seule la plus récente reste
    await S.sauvegarderBase(db, dos, { cle, date: new Date('2026-11-14'), garder: 1 });
    assert.deepEqual(fs.readdirSync(dos), ['comptoir-2026-11-14.db.enc']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
