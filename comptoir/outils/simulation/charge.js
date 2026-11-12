// Test de charge : 1000 boutiques sur un seul serveur (le vrai server.js, dans son propre processus).
// 1. Création des boutiques par l'API (inscription), puis historique inséré en base (commandes des 13 derniers mois).
// 2. Trafic mêlé pendant une durée fixe, avec N clients simultanés : vitrines (lecture), commandes et paiements,
//    espace marchand (état complet, devis, cartes cadeaux), soldes de cartes.
// 3. Rapport : débit, latences p50/p95/p99 par type de requête, erreurs, mémoire du serveur.
// Usage : node outils/simulation/charge.js [boutiques=1000] [commandes par boutique=200] [secondes=60] [clients simultanés=50]
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const NB = Number(process.argv[2] || 1000), HISTO = Number(process.argv[3] || 200), DUREE = Number(process.argv[4] || 60), PARALLELE = Number(process.argv[5] || 50);
const fichier = path.join(os.tmpdir(), `comptoir-charge-${process.pid}.db`);
const portLibre = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const id = p => p + crypto.randomBytes(8).toString('base64url');
const pct = (t, p) => { if (!t.length) return 0; const s = [...t].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

async function demarrer(port) {
  const p = spawn(process.execPath, [path.join(__dirname, '../../server/server.js')], { env: { ...process.env, PORT: String(port), BASE_DE_DONNEES: fichier, SAUVEGARDE: 'non', URL_PUBLIQUE: `http://127.0.0.1:${port}`, ABONNEMENT_OBLIGATOIRE: 'non', LIMITES_FACTEUR: '100000', LIMITE_ESSAIS: '100000', LIMITE_COMMANDES: '100000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const erreurs = []; p.stderr.on('data', d => erreurs.push(String(d)));
  await new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error('démarrage')), 30000); p.stdout.on('data', d => { if (String(d).includes('écoute')) { clearTimeout(t); ok(); } }); });
  return { p, erreurs };
}
const memoire = pid => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024; } catch { return null; } };

(async () => {
  const port = await portLibre(), B = `http://127.0.0.1:${port}`;
  let srv = await demarrer(port);
  const t0 = Date.now();
  // 1. Boutiques (par lots de 20 en parallèle), chacune avec 20 produits.
  const boutiques = [];
  const villes = ['Lausanne', 'Genève', 'Lyon', 'Paris', 'Bruxelles', 'Liège', 'Nantes', 'Fribourg'];
  for (let i = 0; i < NB; i += 20) {
    await Promise.all(Array.from({ length: Math.min(20, NB - i) }, async (_, k) => {
      const n = i + k, pays = ['ch', 'fr', 'be'][n % 3];
      const r = await fetch(`${B}/api/auth/inscription`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${n >> 8}.${n & 255}` }, body: JSON.stringify({ email: `charge${n}@exemple.ch`, motDePasse: 'un mot de passe solide', config: { boutique: { nom: `Boutique ${n}`, pays, secteur: 'maison', sections: [] }, entreprise: { raison: `Société ${n}`, adresse: `Rue ${n}, ${pays === 'fr' ? '75011' : '1003'} ${villes[n % 8]}`, regime: 'normal', email: `contact${n}@exemple.ch` } }, produits: Array.from({ length: 20 }, (_, j) => ({ nom: `Article ${j}`, prix: 12 + j * 3, stock: 100000, type: 'stock' })) }) });
      if (r.status !== 201) throw new Error(`inscription ${n} : ${r.status} ${await r.text()}`);
      boutiques[n] = { cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
    }));
  }
  const tCreation = Date.now() - t0;
  // Historique : arrêt du serveur, insertion directe (rapide), redémarrage.
  await new Promise(ok => { srv.p.on('exit', ok); srv.p.kill('SIGTERM'); });
  const db = new DatabaseSync(fichier);
  const lignesB = db.prepare('SELECT id, slug FROM boutiques ORDER BY rowid').all();
  const ins = db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const statuts = ['livree', 'livree', 'livree', 'expediee', 'payee', 'preparation', 'annulee', 'remboursee', 'retiree', 'livree'];
  const maintenant = Date.now();
  db.exec('BEGIN');
  lignesB.forEach((b, n) => {
    boutiques[n].id = b.id; boutiques[n].slug = b.slug;
    const prods = db.prepare('SELECT id, donnees FROM produits WHERE boutique_id = ?').all(b.id).map(r => ({ id: r.id, ...JSON.parse(r.donnees) }));
    boutiques[n].produits = prods.map(p => p.id);
    for (let k = 0; k < HISTO; k++) {
      const p = prods[k % prods.length], qte = 1 + (k % 3), total = p.prix * qte;
      ins.run(id('c_'), b.id, 1001 + k, maintenant - Math.floor(k / HISTO * 395 * 86400000), statuts[k % 10], id(''), JSON.stringify({ client: { nom: `Client ${k % 300}`, email: `client${k % 300}@exemple.ch`, adresse: 'Rue 1', npa: '1003', ville: villes[k % 8] }, lignes: [{ produitId: p.id, nom: p.nom, prix: p.prix, qte, type: 'stock', tauxTva: 0.081 }], sousTotal: total, remise: 0, port: 0, total, tauxTva: 0.081, livraison: 'retrait', canal: 'web', historique: [] }));
    }
    db.prepare('UPDATE boutiques SET compteur_commande = ? WHERE id = ?').run(1001 + HISTO, b.id);
  });
  db.exec('COMMIT');
  const taille = fs.statSync(fichier).size; db.close();
  srv = await demarrer(port);

  // 2. Trafic mêlé.
  const mesures = {}, erreurs = {};
  const noter = (type, ms, statut) => { (mesures[type] ||= []).push(ms); if (statut >= 500 || statut === 0) erreurs[type] = (erreurs[type] || 0) + 1; };
  const appel = async (type, m, chemin, { corps, cookie, ip } = {}) => {
    const t = performance.now();
    let statut = 0, rep = null;
    try { rep = await fetch(B + chemin, { method: m, redirect: 'manual', headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': ip || '10.1.1.1' }, body: corps ? JSON.stringify(corps) : undefined }); statut = rep.status; await rep.arrayBuffer(); }
    catch { statut = 0; }
    noter(type, performance.now() - t, statut);
    return { statut, rep };
  };
  const ACTIONS = [
    [55, async (b, ip) => appel('vitrine (GET /api/public/:slug)', 'GET', `/api/public/${b.slug}`, { ip })],
    [12, async (b, ip) => appel('page boutique (GET /s/:slug)', 'GET', `/s/${b.slug}`, { ip })],
    [10, async (b, ip) => {
      const r = await fetch(`${B}/api/public/${b.slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ lignes: [{ produitId: b.produits[Math.floor(Math.random() * 20)], qte: 1 }], livraison: b.slug ? (['poste-eco', 'colissimo', 'bpost'][boutiques.indexOf(b) % 3]) : '', client: { nom: 'Client Charge', email: `c${Math.floor(Math.random() * 1e6)}@exemple.ch`, adresse: 'Rue 2', npa: boutiques.indexOf(b) % 3 === 1 ? '75011' : '1003', ville: 'Lausanne' } }) }).catch(() => null);
      const t = performance.now(); void t;
      if (!r) return noter('commande (POST)', 0, 0);
      const j = await r.json().catch(() => ({}));
      noter('commande (POST)', 0, r.status); mesures['commande (POST)'].pop();
      if (r.status === 201 && j.paiementUrl) await appel('paiement simulé (POST)', 'POST', `/paiement-simule/${j.paiementUrl.split('/').pop()}/confirmer`, { ip });
    }],
    [12, async b => appel('espace marchand (GET /api/admin/etat)', 'GET', '/api/admin/etat', { cookie: b.cookie })],
    [4, async b => appel('liste des devis (GET)', 'GET', '/api/admin/devis', { cookie: b.cookie })],
    [4, async b => appel('cartes cadeaux (GET)', 'GET', '/api/admin/cartes-cadeaux', { cookie: b.cookie })],
    [3, async (b, ip) => appel('solde carte cadeau (POST)', 'POST', `/api/public/${b.slug}/carte-cadeau`, { corps: { code: 'AAAA-BBBB-CCCC-DDDD' }, ip })]
  ];
  // Commande : mesurée de bout en bout (création + réponse).
  ACTIONS[2][1] = (orig => async (b, ip) => { const t = performance.now(); await orig(b, ip); (mesures['commande + paiement (bout en bout)'] ||= []).push(performance.now() - t); })(ACTIONS[2][1]);
  const poids = ACTIONS.reduce((a, x) => a + x[0], 0);
  const tirer = () => { let r = Math.random() * poids; for (const [p, f] of ACTIONS) { if ((r -= p) < 0) return f; } return ACTIONS[0][1]; };
  const fin = Date.now() + DUREE * 1000; let n = 0, memMax = 0;
  const sondeMem = setInterval(() => { const m = memoire(srv.p.pid); if (m > memMax) memMax = m; }, 1000);
  await Promise.all(Array.from({ length: PARALLELE }, async (_, w) => {
    while (Date.now() < fin) { const b = boutiques[Math.floor(Math.random() * NB)]; await tirer()(b, `10.${w}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`); n++; }
  }));
  clearInterval(sondeMem);
  await new Promise(ok => { srv.p.on('exit', ok); srv.p.kill('SIGTERM'); });

  // 3. Rapport.
  const lignes = Object.entries(mesures).filter(([, t]) => t.length).map(([type, t]) => ({ type, n: t.length, p50: pct(t, 50), p95: pct(t, 95), p99: pct(t, 99), max: Math.max(...t), erreurs: erreurs[type] || 0 }));
  const rapport = { boutiques: NB, commandesHistorique: NB * HISTO, base: `${(taille / 1048576).toFixed(0)} Mo`, creationBoutiquesS: +(tCreation / 1000).toFixed(1), dureeS: DUREE, clientsSimultanes: PARALLELE, actions: n, actionsParSeconde: +(n / DUREE).toFixed(1), memoireMaxMo: Math.round(memMax), journalErreurs: srv.erreurs.join('').split('\n').filter(l => /erreur|error/i.test(l)).slice(0, 5), mesuresMs: lignes.map(l => ({ ...l, p50: +l.p50.toFixed(1), p95: +l.p95.toFixed(1), p99: +l.p99.toFixed(1), max: +l.max.toFixed(1) })) };
  console.log(JSON.stringify(rapport, null, 1));
  for (const f of [fichier, fichier + '-wal', fichier + '-shm']) fs.rmSync(f, { force: true });
})().catch(e => { console.error(e); process.exit(1); });
