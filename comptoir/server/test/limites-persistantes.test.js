// Les compteurs anti-abus survivent à un redémarrage du serveur (arrêt propre par SIGTERM), sans IP ni e-mail en clair ;
// l'arrêt n'attend pas les flux en direct.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const portLibre = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const base = path.join(os.tmpdir(), `comptoir-limites-${process.pid}.db`);
const enCours = new Set();
const demarrer = port => new Promise((ok, ko) => {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), BASE_DE_DONNEES: base, SAUVEGARDE: 'non', URL_PUBLIQUE: `http://127.0.0.1:${port}`, LIMITE_ESSAIS: '', ABONNEMENT_OBLIGATOIRE: 'non' }, stdio: ['ignore', 'pipe', 'pipe'] });
  enCours.add(p); p.on('exit', () => enCours.delete(p));
  const delai = setTimeout(() => ko(new Error('démarrage trop long')), 10000);
  p.stdout.on('data', d => { if (String(d).includes('écoute')) { clearTimeout(delai); ok(p); } });
  p.on('error', e => { clearTimeout(delai); ko(e); });
});
const arreter = p => new Promise(ok => { const t0 = Date.now(); p.on('exit', () => ok(Date.now() - t0)); p.kill('SIGTERM'); });

test('compteurs anti-abus persistants, arrêt propre', { timeout: 60000 }, async () => {
  try {
    const port = await portLibre(), B = `http://127.0.0.1:${port}`;
    const connexion = () => fetch(`${B}/api/auth/connexion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'victime@exemple.ch', motDePasse: 'mauvais mot de passe' }) }).then(r => r.status);
    let srv = await demarrer(port);
    for (let i = 0; i < 10; i++) assert.equal(await connexion(), 401);
    assert.equal(await connexion(), 429, 'bloqué après 10 échecs');
    // Un flux en direct ouvert (marchand connecté) ne retarde pas l'arrêt.
    const ins = await fetch(`${B}/api/auth/inscription`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'flux@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Flux', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'F', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [] }) });
    const cookie = ins.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    const flux = await fetch(`${B}/api/admin/flux`, { headers: { Cookie: cookie } });
    assert.equal(flux.status, 200);
    const duree = await arreter(srv);
    assert.ok(duree < 3000, `arrêt en ${duree} ms malgré le flux ouvert`);
    const db = new DatabaseSync(base, { readOnly: true });
    const lignes = db.prepare('SELECT * FROM limites').all(); db.close();
    assert.ok(lignes.length >= 2);
    const texte = JSON.stringify(lignes);
    assert.ok(!texte.includes('victime@exemple.ch') && !texte.includes('127.0.0.1'), 'aucune adresse ni e-mail en clair');
    srv = await demarrer(port);
    assert.equal(await connexion(), 429, 'toujours bloqué après le redémarrage');
    await arreter(srv);
  } finally {
    for (const p of enCours) p.kill('SIGKILL');
    for (const f of [base, base + '-wal', base + '-shm']) fs.rmSync(f, { force: true });
  }
});
