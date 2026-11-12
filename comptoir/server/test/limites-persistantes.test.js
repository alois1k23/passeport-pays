// Les compteurs anti-abus survivent à un redémarrage du serveur (arrêt propre par SIGTERM), sans IP ni e-mail en clair.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3700 + Math.floor(Math.random() * 200);
const base = path.join(os.tmpdir(), `comptoir-limites-${process.pid}.db`);
const demarrer = () => new Promise((ok, ko) => {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), BASE_DE_DONNEES: base, SAUVEGARDE: 'non', URL_PUBLIQUE: `http://127.0.0.1:${PORT}`, LIMITE_ESSAIS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { if (String(d).includes('écoute')) ok(p); });
  p.on('error', ko); setTimeout(() => ko(new Error('démarrage trop long')), 10000);
});
const arreter = p => new Promise(ok => { p.on('exit', ok); p.kill('SIGTERM'); });
const connexion = () => fetch(`http://127.0.0.1:${PORT}/api/auth/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'victime@exemple.ch', motDePasse: 'mauvais mot de passe' }) }).then(r => r.status);

test('compteurs anti-abus persistants', { timeout: 60000 }, async () => {
  try {
    let srv = await demarrer();
    for (let i = 0; i < 10; i++) assert.equal(await connexion(), 401);
    assert.equal(await connexion(), 429, 'bloqué après 10 échecs');
    await arreter(srv);   // arrêt propre : les compteurs sont écrits
    const db = new DatabaseSync(base, { readOnly: true });
    const lignes = db.prepare('SELECT * FROM limites').all(); db.close();
    assert.ok(lignes.length >= 2);
    assert.ok(!JSON.stringify(lignes).includes('victime@exemple.ch') && !JSON.stringify(lignes).includes('127.0.0.1'), 'aucune adresse ni e-mail en clair');
    srv = await demarrer();
    assert.equal(await connexion(), 429, 'toujours bloqué après le redémarrage');
    await arreter(srv);
  } finally { for (const f of [base, base + '-wal', base + '-shm']) fs.rmSync(f, { force: true }); }
});
