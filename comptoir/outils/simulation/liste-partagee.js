// Lancer : node outils/simulation/liste-partagee.js (Playwright et Chromium requis).
// Liste de favoris partagée, de bout en bout dans deux navigateurs (bureau en français, mobile en allemand) : A met trois
// favoris et partage le lien ; B l'ouvre, voit la liste, ajoute tout au panier (le produit à variantes reste à choisir),
// puis garde la liste dans ses favoris. Code 1 au moindre écart.
const http = require('node:http');
const R = require('node:path').join(__dirname, '../../server/src/') + '/';
const { ouvrir } = require(R + 'db'); const { creerApp } = require(R + 'app');
const { chromium } = require('playwright');
(async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { ABONNEMENT_OBLIGATOIRE: 'non', LIMITES_FACTEUR: '100' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const b = await chromium.launch(); const p0 = await (await b.newContext()).newPage(); await p0.goto(base + '/app');
  const info = await p0.evaluate(async () => {
    const j = (m, u, c) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: c ? JSON.stringify(c) : undefined }).then(r => r.json());
    await j('POST', '/api/auth/inscription', { email: 'l@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier', pays: 'ch', langues: ['fr', 'de'] }, entreprise: { raison: 'A Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'l@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const id = async p => (await j('POST', '/api/admin/produits', { produit: { stock: 5, ...p } })).id;
    return { vase: await id({ nom: 'Vase', prix: 40 }), epuise: await id({ nom: 'Lampe', prix: 30, stock: 0 }), bol: await id({ nom: 'Bol', prix: 15 }), pull: await id({ nom: 'Pull', prix: 60, options: [{ nom: 'Taille', valeurs: ['S', 'M'] }], variantes: [{ id: 'S', valeurs: ['S'], stock: 2 }, { id: 'M', valeurs: ['M'], stock: 2 }] }), slug: (await j('GET', '/api/admin/etat')).serveur.slug };
  });
  const res = {};
  for (const [nom, vp, lang] of [['bureau', { width: 1280, height: 900 }, 'fr'], ['mobile', { width: 390, height: 800 }, 'de']]) {
    // Personne A : met trois favoris et partage sa liste (presse-papiers).
    const ca = await b.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] }); const a = await ca.newPage(); const errs = []; a.on('pageerror', e => errs.push(e.message));
    await a.goto(`${base}/s/${info.slug}?lang=${lang}`); await a.waitForTimeout(900);
    for (const id of [info.vase, info.bol, info.pull]) { await a.click(`[data-sf="fav"][data-id="${id}"]`); await a.waitForTimeout(150); }
    await a.click('[data-sf="favoris"]'); await a.waitForTimeout(300);
    await a.click('[data-sf="partager-favoris"]'); await a.waitForTimeout(500);
    const lien = await a.evaluate(() => navigator.clipboard.readText().catch(() => document.querySelector('#lien-liste input')?.value));
    const libelle = await a.evaluate(() => document.querySelector('#lien-liste span')?.textContent);
    // Personne B : autre navigateur, ouvre le lien.
    const cb = await b.newContext({ viewport: vp }); const p = await cb.newPage(); p.on('pageerror', e => errs.push('B: ' + e.message));
    await p.goto(lien); await p.waitForTimeout(1000);
    const vue = await p.evaluate(() => ({ titre: document.querySelector('.sf-produits h2')?.textContent, cartes: [...document.querySelectorAll('.sf-produits .sf-carte h3')].map(x => x.textContent.trim()), deborde: document.documentElement.scrollWidth > innerWidth }));
    await p.click('[data-sf="liste-panier"]'); await p.waitForTimeout(600);
    const panier = await p.evaluate(() => ({ lignes: vue.panier.map(l => `${l.qte}×${l.nom}`), avis: document.querySelector('.avis-lien')?.textContent }));
    await p.click('.tiroir-corps [data-c="fermer"]'); await p.waitForTimeout(300);
    const urlFermee = await p.evaluate(() => location.search);   // la liste reste affichée : l'adresse la garde
    await p.click('[data-sf="liste-favoris"]'); await p.waitForTimeout(400);
    const favB = await p.evaluate(() => ({ n: FAVORIS.size, url: location.search }));
    // Lien sans produit en vente : boutique normale. Lien vers un seul produit épuisé : « Tout ajouter » explique, sans tiroir vide.
    await p.goto(`${base}/s/${info.slug}?liste=zzz,yyy`); await p.waitForTimeout(700);
    const invalide = await p.evaluate(() => !!document.querySelector('[data-sf="liste-panier"]'));
    await p.goto(`${base}/s/${info.slug}?liste=${info.epuise}&lang=${lang}`); await p.waitForTimeout(700);
    await p.click('[data-sf="liste-panier"]'); await p.waitForTimeout(400);
    const epuise = await p.evaluate(() => ({ tiroir: vue.ouvert, avis: document.querySelector('.sf-liste-partagee [role="status"]')?.textContent }));
    res[nom] = { lien: lien && lien.replace(base, ''), libelle, vue, panier, urlFermee, favB, invalide, epuise, errs };
    await ca.close(); await cb.close();
  }
  await b.close(); s.close();
  const ecarts = [];
  for (const [nom, r] of Object.entries(res)) {
    if (!r.lien || !/\?liste=/.test(r.lien)) ecarts.push(`${nom} : lien de liste absent`);
    if (/@|nom=|email/i.test(r.lien || '')) ecarts.push(`${nom} : le lien contient autre chose que des produits`);
    if (r.vue.cartes.join(',') !== 'Vase,Bol,Pull') ecarts.push(`${nom} : liste reçue ${r.vue.cartes}`);
    if (r.vue.deborde) ecarts.push(`${nom} : débordement horizontal`);
    if (r.panier.lignes.join(',') !== '1×Vase,1×Bol') ecarts.push(`${nom} : panier ${r.panier.lignes}`);
    if (!r.panier.avis) ecarts.push(`${nom} : pas d'avis pour le produit à variantes`);
    if (r.favB.n !== 3 || r.favB.url.includes('liste=')) ecarts.push(`${nom} : favoris de B ${r.favB.n}, adresse ${r.favB.url}`);
    if (!r.urlFermee.includes('liste=')) ecarts.push(`${nom} : l'adresse a perdu la liste à la fermeture du panier (${r.urlFermee})`);
    if (!r.libelle) ecarts.push(`${nom} : pas de champ avec le lien`);
    if (r.invalide) ecarts.push(`${nom} : un lien sans produit valide affiche une liste`);
    if (r.epuise.tiroir || !r.epuise.avis) ecarts.push(`${nom} : liste épuisée ${JSON.stringify(r.epuise)}`);
    if (r.errs.length) ecarts.push(`${nom} : erreurs ${r.errs.join(' | ')}`);
  }
  if (res.mobile && !/Geteilte Liste/.test(res.mobile.vue.titre)) ecarts.push('mobile : titre non traduit en allemand');
  if (res.mobile && !/ausverkauft/.test(res.mobile.epuise.avis || '')) ecarts.push(`mobile : avis d'épuisement non traduit (${res.mobile.epuise.avis})`);
  if (res.mobile && !/Link kopiert/.test(res.mobile.libelle || '')) ecarts.push('mobile : libellé du lien non traduit');
  console.log(ecarts.length ? ecarts.join('\n') : 'Liste partagée : bureau (fr) et mobile (de) conformes, 0 écart.');
  process.exitCode = ecarts.length ? 1 : 0;
})();
