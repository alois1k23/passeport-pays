// Lancer : node outils/simulation/performance-boutique.js (Playwright et Chromium requis).
// Mesure de la boutique publique, comme un visiteur sur téléphone (processeur ralenti 4×, réseau « 4G lente ») :
// poids transféré, nombre de requêtes, plus grand affichage (LCP), décalages de mise en page (CLS), temps de blocage.
'use strict';
const http = require('node:http');
const R = require('node:path').join(__dirname, '../../server/src/') + '/';
const { ouvrir } = require(R + 'db'); const { creerApp } = require(R + 'app');
const { chromium } = require('playwright');
(async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { ABONNEMENT_OBLIGATOIRE: 'non', LIMITES_FACTEUR: '100' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const b = await chromium.launch();
  const p0 = await (await b.newContext()).newPage(); await p0.goto(base + '/app');
  const info = await p0.evaluate(async () => {
    const j = (m, u, c) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: c ? JSON.stringify(c) : undefined }).then(r => r.json());
    await j('POST', '/api/auth/inscription', { email: 'perf@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier Lin', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Lin Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'perf@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    // Une photo réaliste (≈ 60 Ko) pour 24 produits.
    const c = document.createElement('canvas'); c.width = 900; c.height = 900; const g = c.getContext('2d');
    for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${(i * 37) % 360},40%,${40 + (i % 30)}%)`; g.fillRect((i * 53) % 900, (i * 97) % 900, 24, 24); }
    const image = c.toDataURL('image/jpeg', 0.7);
    let premier = null;
    for (let i = 0; i < 24; i++) { const r = await j('POST', '/api/admin/produits', { produit: { nom: `Produit ${i + 1}`, prix: 20 + i, stock: 5, image, description: 'Lin lavé, tissé au Portugal. '.repeat(4) } }); premier = premier || r.id; }
    return { slug: (await j('GET', '/api/admin/etat')).serveur.slug, premier, poidsImage: Math.round(image.length * 0.75 / 1024) };
  });
  const pages = [['accueil', `/s/${info.slug}`], ['produit', `/s/${info.slug}/p/${info.premier}`], ['journal', `/s/${info.slug}/journal`]];
  const resultats = [];
  for (const [nom, url] of pages) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    let octets = 0, requetes = 0; const parType = {};
    cdp.on('Network.loadingFinished', e => { octets += e.encodedDataLength; requetes++; });
    cdp.on('Network.responseReceived', e => { const t = e.type || 'autre'; parType[t] = (parType[t] || 0) + 1; });
    await p.addInitScript(() => {
      window.__lcp = 0; window.__cls = 0; window.__tbt = 0;
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
    });
    const t0 = Date.now();
    await p.goto(base + url, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    const m = await p.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Math.round(window.__cls * 1000) / 1000, tbt: Math.round(window.__tbt), images: document.images.length, imagesDiffereees: [...document.images].filter(i => i.loading === 'lazy').length }));
    resultats.push({ page: nom, chargementMs: Date.now() - t0, koTransferes: Math.round(octets / 1024), requetes, parType, ...m });
    await ctx.close();
  }
  console.log(JSON.stringify({ poidsImageSourceKo: info.poidsImage, resultats }, null, 1));
  await b.close(); s.close();
})();
