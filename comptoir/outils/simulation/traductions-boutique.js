// Lancer : node outils/simulation/traductions-boutique.js (Playwright et Chromium requis).
// Audit des traductions de la boutique : affiche la boutique en français (accueil, fiche produit avec toutes les
// options, panier, retrait, contenu numérique, commande minimum), relève chaque texte visible et chaque libellé
// (aria-label, placeholder, title) hors des zones du marchand (data-sans-traduction), puis vérifie qu'il est couvert en
// allemand, italien et anglais (dictionnaire ou modèle). Sortie : les textes manquants par langue ; code 1 s'il en reste.
const http = require('node:http');
const R = require('node:path').join(__dirname, '../../server/src/') + '/';
const { ouvrir } = require(R + 'db'); const { creerApp } = require(R + 'app');
const T = require('../../js/traductions.js');
const { chromium } = require('playwright');

const RELEVE = () => {
  const out = new Set();
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const p = n.parentElement; if (!p || p.closest('script,style,[data-sans-traduction],[data-legal],.cookies') || !visible(p)) continue;
    const t = n.nodeValue.trim(); if (t && /[a-zà-ÿ]{2}/i.test(t)) out.add('T|' + t);
  }
  for (const e of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
    if (e.closest('[data-sans-traduction]')) continue;
    for (const a of ['aria-label', 'placeholder', 'title']) { const v = e.getAttribute(a); if (v && /[a-zà-ÿ]{2}/i.test(v) && !/^Voir /.test(v)) out.add('A|' + v); }
  }
  return [...out];
};

(async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { ABONNEMENT_OBLIGATOIRE: 'non', LIMITES_FACTEUR: '100' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const b = await chromium.launch();
  const p0 = await (await b.newContext()).newPage(); await p0.goto(base + '/app');
  const info = await p0.evaluate(async () => {
    const j = (m, u, c) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: c ? JSON.stringify(c) : undefined }).then(r => r.json());
    await j('POST', '/api/auth/inscription', { email: 't@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Épicerie Nord', pays: 'ch', langues: ['fr', 'de', 'it', 'en'] }, magasin: { clickCollect: true, adresse: 'Rue 2, 1003 Lausanne' }, entreprise: { raison: 'E Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 't@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const id = async p => (await j('POST', '/api/admin/produits', { produit: { stock: 10, ...p } })).id;
    const the = await id({ nom: 'Thé vert', prix: 9, contenance: 100, unite: 'g', origine: 'Japon', ingredients: 'Thé vert', allergenes: ['soja'], marque: 'Maison', reassortJours: 30 });
    const tasse = await id({ nom: 'Tasse', prix: 18 });
    const pull = await id({ nom: 'Pull', prix: 60, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }], variantes: [{ id: 'S', valeurs: ['S'], stock: 0 }, { id: 'M', valeurs: ['M'], stock: 3 }] });
    const epuise = await id({ nom: 'Bol', prix: 12, stock: 0 });
    const pre = await id({ nom: 'Calendrier', prix: 20, stock: 0, precommande: true, expeditionPrevue: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), precommandeMax: 50 });
    const etat = await j('GET', '/api/admin/etat');
    await j('PUT', `/api/admin/produits/${the}`, { produit: { ...etat.produits.find(x => x.id === the), complements: [tasse, pull] } });
    await j('PUT', '/api/admin/config', { config: { boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, livraisons: etat.livraisons, offres: etat.offres, reglages: { ...etat.reglages, minimumCommande: 50, emballageCadeau: true } } });
    return { slug: etat.serveur.slug, the, tasse, pull, epuise, pre };
  });
  const textes = new Set();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  const releve = async () => { for (const t of await p.evaluate(RELEVE)) textes.add(t); };
  const u = chemin => `${base}/s/${info.slug}${chemin}${chemin.includes('?') ? '&' : '?'}lang=fr`;
  await p.goto(u('')); await p.waitForTimeout(900); await releve();
  // Deux fiches vues (« Vus récemment »), fiche complète, fiche à variantes, fiche épuisée.
  for (const id of [info.tasse, info.pull, info.epuise, info.pre, info.the]) { await p.goto(u(`/p/${id}`)); await p.waitForTimeout(700); await releve(); }
  await p.goto(u('')); await p.waitForTimeout(700);
  const fav = await p.$('[data-sf="fav"]'); if (fav) { await fav.click(); await p.waitForTimeout(300); }
  await releve();
  // Vue « Mes favoris » (avec « Partager ma liste »), puis une liste partagée reçue par lien.
  const vf = await p.$('[data-sf="favoris"]'); if (vf) { await vf.click(); await p.waitForTimeout(300); await releve(); await vf.click().catch(() => {}); }
  await p.goto(u(`?liste=${encodeURIComponent([info.tasse, info.pull].join(','))}`)); await p.waitForTimeout(800); await releve();
  await p.click('[data-sf="liste-panier"]'); await p.waitForTimeout(500); await releve();
  await p.goto(u('')); await p.waitForTimeout(600);
  // Fenêtres : espace pro, suivi des commandes.
  for (const d of ['pro', 'commandes']) { const bt = await p.$(`[data-action="doc"][data-id="${d}"]`); if (bt) { await bt.click(); await p.waitForTimeout(400); await releve(); await p.keyboard.press('Escape'); await p.waitForTimeout(200); } }
  // Panier : livraison (minimum non atteint), puis retrait.
  await p.goto(u(`/p/${info.the}`)); await p.waitForTimeout(700);
  await p.click(`.sf-fiche-achat [data-sf="ajouter"][data-id="${info.the}"]`); await p.waitForTimeout(700); await releve();
  const r = await p.$('input[name="livraison"][value="retrait"]'); if (r) { await p.click('input[name="livraison"][value="retrait"]'); await p.waitForTimeout(500); await releve(); }
  // Lien de panier avec un article inconnu (avis au-dessus du panier).
  await p.goto(u(`?panier=${encodeURIComponent(`${info.tasse}:1,inconnu:1`)}`)); await p.waitForTimeout(900); await releve();
  await b.close(); s.close();

  const manque = {};
  for (const l of ['de', 'it', 'en']) manque[l] = [...textes].filter(x => { const [k, t] = [x.slice(0, 1), x.slice(2)]; return !T.couvert(t, l, k === 'A') && !/^[−-]?\s*(?:CHF|€)?\s*[\d’'.,\s−-]+(?:CHF|€)?$/.test(t) && !/^\S+@\S+$/.test(t); }).map(x => x.slice(2));
  // Noms du marchand (boutique, produits, catégories, options) : jamais traduits.
  // Noms de transporteurs et de modes de livraison (noms propres du service).
  const noms = new Set(['La Poste Economy', 'La Poste Priority', 'Calendrier', 'Épicerie Nord', 'Thé vert', 'Tasse', 'Pull', 'Bol', 'Maison', 'Japon', 'S', 'M', 'Taille', 'E Sàrl', 'Rue 2, 1003 Lausanne', 'Rue 1, 1003 Lausanne']);
  let total = 0;
  for (const l of Object.keys(manque)) { manque[l] = manque[l].filter(t => !noms.has(t)); total += manque[l].length; }
  console.log(`${textes.size} textes relevés.`);
  for (const [l, liste] of Object.entries(manque)) { console.log(`\n${l} : ${liste.length} manquant(s)`); for (const t of liste) console.log('  ' + JSON.stringify(t)); }
  process.exitCode = total ? 1 : 0;
})();
