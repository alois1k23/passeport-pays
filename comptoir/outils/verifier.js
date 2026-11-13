// Toutes les vérifications de Comptoir, l'une après l'autre, avec un bilan final.
// Usage : npm run verifier            (complet : tests, bout en bout, clavier, simulation de 60 jours, fuzzing HTTP, charge réduite)
//         npm run verifier -- --rapide (tests et bout en bout seulement)
// Les étapes qui ouvrent un navigateur (bout en bout, clavier) demandent Playwright ; sans lui, elles sont signalées et sautées.
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const racine = path.join(__dirname, '..'), rapide = process.argv.includes('--rapide');
const node = process.execPath, sansAvert = '--disable-warning=ExperimentalWarning';
const fichiers = d => require('node:fs').readdirSync(path.join(racine, d)).filter(f => f.endsWith('.test.js')).map(f => path.join(d, f));
let playwright = true; try { require.resolve('playwright'); } catch { playwright = false; }
const etapes = [
  ['Tests automatiques', [sansAvert, '--test', ...fichiers('server/test')], racine, r => /# fail 0/.test(r)],
  ['Parcours de bout en bout', [sansAvert, path.join(racine, 'outils/simulation/bout-en-bout.js')], path.join(racine, 'server'), r => / 0 anomalie/.test(r), true],   // ouvre aussi un navigateur
  ...(rapide ? [] : [
    ['Achat au clavier (boutique)', [sansAvert, 'outils/simulation/clavier.js'], racine, r => /"problemes": \[\]/.test(r), true],
    ['Espace marchand au clavier', [sansAvert, 'outils/simulation/clavier-marchand.js'], racine, r => /"problemes": \[\]/.test(r), true],
    ['Simulation de 60 jours (100 marchands)', [sansAvert, 'outils/simulation/mois.js', '100', '60'], racine, r => /"nbAnomalies": 0/.test(r.slice(-400))],
    ['Fuzzing HTTP (toutes les routes, corps hostiles)', [sansAvert, 'outils/simulation/fuzz-http.js', '8', String(Date.now() % 100000)], racine, r => /"constats": 0/.test(r)],
    ['Charge réduite (100 boutiques, 15 s)', [sansAvert, 'outils/simulation/charge.js', '100', '50', '15', '20'], racine, r => { try { const j = JSON.parse(r.slice(r.indexOf('{'))); return j.mesuresMs.every(m => m.erreurs === 0) && !j.journalErreurs.length; } catch { return false; } }]
  ])
];
const bilan = [];
for (const [nom, args, cwd, ok, navigateur] of etapes) {
  if (navigateur && !playwright) { bilan.push([nom, 'sautée (Playwright absent)']); continue; }
  process.stdout.write(`▶ ${nom}… `);
  const t0 = Date.now(), r = spawnSync(node, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60000 });
  const sortie = `${r.stdout || ''}${r.stderr || ''}`, reussi = r.status === 0 && ok(sortie);
  const duree = `${Math.round((Date.now() - t0) / 1000)} s`;
  console.log(reussi ? `réussie (${duree})` : `ÉCHEC (${duree})`);
  if (!reussi) {
    console.log(sortie.split('\n').filter(l => /not ok|✗|anomal|erreur|Error/i.test(l)).slice(0, 15).join('\n'));
    // Parcours au clavier : la liste des problèmes en entier (ses lignes ne contiennent pas forcément les mots-clés).
    const pb = /"problemes": \[[\s\S]*?\]/.exec(sortie); if (pb) console.log(pb[0].slice(0, 2000));
  }
  bilan.push([nom, reussi ? 'réussie' : 'ÉCHEC']);
}
console.log('\nBilan :'); for (const [n, e] of bilan) console.log(`  ${e === 'réussie' ? '✓' : e.startsWith('sautée') ? '–' : '✗'} ${n} : ${e}`);
process.exit(bilan.some(([, e]) => e === 'ÉCHEC') ? 1 : 0);
