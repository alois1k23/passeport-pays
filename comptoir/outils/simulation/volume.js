// Grosse boutique : 500 produits et 10 000 commandes sur 13 mois, puis mesure de chaque écran et de l'API.
// Usage : node volume.js http://localhost:3000 chemin/base.db  (le serveur doit utiliser cette base)
const { chromium } = require('playwright');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const base = process.argv[2], fichier = process.argv[3];
const NB_PRODUITS = Number(process.argv[4] || 500), NB_COMMANDES = Number(process.argv[5] || 10000);
const id = p => p + crypto.randomBytes(8).toString('base64url');

(async () => {
  // 1. Compte et abonnement par l'API (comme un vrai client)
  const email = `volume${Date.now()}@exemple.ch`;
  const ins = await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, motDePasse: 'mot de passe solide', config: { boutique: { nom: 'Grande Boutique', pays: 'ch', secteur: 'maison', sections: [{ id: 's1', type: 'hero', props: { titre: 'Bienvenue' } }, { id: 's2', type: 'produits', props: { titre: 'Nos produits', nombre: '8' } }, { id: 's3', type: 'pied', props: { texte: '©' } }] }, entreprise: { raison: 'Grande Boutique Sàrl', adresse: 'Rue du Lac 1, 1003 Lausanne', email, regime: 'ch-assujetti' } }, importer: ['f03', 'f05', 'f06', 'f07', 'f18', 'f21'] }) });
  const cookie = ins.headers.get('set-cookie').split(';')[0];
  const { url } = await (await fetch(base + '/api/abonnement/commencer', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ formule: 'pro' }) })).json();
  await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
  // 2. Données insérées directement en base
  const db = new DatabaseSync(fichier);
  const b = db.prepare('SELECT b.id FROM boutiques b JOIN marchands m ON m.id = b.marchand_id WHERE m.email = ?').get(email);
  const prods = db.prepare('SELECT id, donnees FROM produits WHERE boutique_id = ?').all(b.id).map(r => ({ id: r.id, ...JSON.parse(r.donnees) }));
  const ins1 = db.prepare('INSERT INTO produits (id, boutique_id, donnees, ordre) VALUES (?, ?, ?, ?)');
  const cats = ['Bougies', 'Textile', 'Cuisine', 'Luminaires', 'Rangement', 'Déco', 'Papeterie', 'Jardin'];
  db.exec('BEGIN');
  for (let k = prods.length; k < NB_PRODUITS; k++) {
    const p = { nom: `Article ${k} ${cats[k % 8].toLowerCase()} édition ${2020 + (k % 7)}`, description: 'Description de démonstration. '.repeat(4), categorie: cats[k % 8], prix: 15 + (k % 90), stock: k % 13 === 0 ? 2 : 40, actif: k % 17 !== 0, teinte: (k * 37) % 360, type: 'stock', cout: 5 + (k % 30), historiquePrix: [] };
    const i = id('p_'); ins1.run(i, b.id, JSON.stringify(p), k); prods.push({ id: i, ...p });
  }
  const ins2 = db.prepare('INSERT INTO commandes (id, boutique_id, numero, date, statut, jeton_client, donnees) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const villes = ['Lausanne', 'Genève', 'Vevey', 'Morges', 'Nyon', 'Montreux', 'Fribourg', 'Sion', 'Neuchâtel', 'Yverdon-les-Bains'];
  const statuts = ['livree', 'livree', 'livree', 'expediee', 'payee', 'preparation', 'annulee', 'remboursee', 'attente', 'retiree'];
  const maintenant = Date.now();
  for (let k = 0; k < NB_COMMANDES; k++) {
    const n = 1 + (k % 3), lignes = [];
    for (let j = 0; j < n; j++) { const p = prods[(k * 7 + j * 13) % prods.length]; lignes.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 + (j % 2), type: p.type || 'stock', prixInitial: p.prix }); }
    const sous = lignes.reduce((a, l) => a + l.prix * l.qte, 0), port = sous >= 60 ? 0 : 7;
    const date = maintenant - Math.floor((k / NB_COMMANDES) * 395 * 86400000) - (k % 86400) * 1000;
    const statut = statuts[k % statuts.length];
    const c = { client: { nom: `Client ${k % 2500}`, email: `client${k % 2500}@exemple.ch`, adresse: 'Rue 1', npa: '1003', ville: villes[k % 10], consentement: k % 3 === 0 }, lignes, sousTotal: sous, remise: 0, port, total: sous + port, livraison: k % 4 ? 'poste-eco' : 'poste-prio', canal: k % 9 === 0 ? 'magasin' : 'web', suivi: '', note: '', historique: [{ date, texte: 'Commande passée en ligne' }], ...(statut !== 'attente' ? { facture: `FA-${new Date(date).getFullYear()}-${String(k + 1).padStart(4, '0')}` } : {}) };
    ins2.run(id('c_'), b.id, 1001 + k, date, statut, id(''), JSON.stringify(c));
  }
  db.exec('COMMIT');
  db.prepare('UPDATE boutiques SET compteur_commande = ?, compteur_facture = ? WHERE id = ?').run(1001 + NB_COMMANDES, NB_COMMANDES, b.id);
  // 3. API : temps et taille de l'état complet
  let t = Date.now();
  const etat = await fetch(base + '/api/admin/etat', { headers: { Cookie: cookie } });
  const texte = await etat.text();
  console.log(`API /api/admin/etat : ${Date.now() - t} ms, ${(texte.length / 1e6).toFixed(1)} Mo, statut ${etat.status}`);
  const slug = JSON.parse(texte).serveur.slug;
  t = Date.now(); const pub = await (await fetch(`${base}/api/public/${slug}`)).text(); console.log(`API boutique publique : ${Date.now() - t} ms, ${(pub.length / 1e3).toFixed(0)} Ko`);
  // 4. Navigateur : temps de chaque écran
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const [nomC, valC] = cookie.split('=');
  await ctx.addCookies([{ name: nomC, value: valC, url: base }]);
  const p = await ctx.newPage();
  const err = []; p.on('pageerror', e => err.push(e.message));
  t = Date.now(); await p.goto(base + '/app'); await p.waitForFunction(() => typeof etat !== 'undefined' && etat.commandes && etat.commandes.length > 100, null, { timeout: 60000 });
  console.log(`Chargement de l'application : ${Date.now() - t} ms`);
  const res = [];
  for (const r of ['tableau', 'analyse', 'commandes', 'clients', 'produits', 'stars', 'conformite', 'conversion', 'copilote', 'magasin', 'social', 'editeur', 'parametres', 'fournisseurs', 'tests']) {
    const ms = await p.evaluate(r => { const t0 = performance.now(); location.hash = r; window.dispatchEvent(new HashChangeEvent('hashchange')); return performance.now() - t0; }, r);
    await p.waitForTimeout(150);
    const ms2 = await p.evaluate(() => { const t0 = performance.now(); rendre(); return performance.now() - t0; });
    res.push(`${r} ${Math.round(Math.max(ms, ms2))} ms`);
  }
  console.log('Rendu des écrans : ' + res.join(' · '));
  // Recherche et pagination dans les commandes
  await p.evaluate(() => { location.hash = 'commandes'; }); await p.waitForTimeout(300);
  t = Date.now(); await p.fill('[data-champ="recherche"], input[type="search"]', 'Client 42').catch(() => {}); await p.waitForTimeout(400); console.log(`Recherche commandes : ${Date.now() - t - 400} ms (attente déduite)`);
  t = Date.now(); await p.click('[data-action="export-commandes"] >> nth=0').catch(() => {}); console.log(`Export CSV : ${Date.now() - t} ms`);
  const memoire = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
  console.log(`Mémoire JavaScript : ${memoire} Mo · erreurs : ${err.length ? err.join(' | ') : 'aucune'}`);
  const q = await br.newPage({ viewport: { width: 390, height: 844 } });
  t = Date.now(); await q.goto(`${base}/s/${slug}`); await q.waitForSelector('.sf-carte'); console.log(`Boutique publique (mobile) : ${Date.now() - t} ms`);
  await br.close();
})();
