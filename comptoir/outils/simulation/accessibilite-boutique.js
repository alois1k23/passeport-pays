// Lancer : node outils/simulation/accessibilite-boutique.js (Playwright et Chromium requis).
// Audit d'accessibilité de la boutique publique : noms accessibles, libellés, alt, contrastes, titres, langue, cibles tactiles.
const http = require('node:http');
const R = require('node:path').join(__dirname, '../../server/src/') + '/';
const { ouvrir } = require(R + 'db'); const { creerApp } = require(R + 'app');
const { chromium } = require('playwright');
const AUDIT = () => {
  const out = [];
  const nomAcc = el => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) || el.innerText || el.value || el.getAttribute('title') || (el.querySelector('img[alt]')?.getAttribute('alt')) || '').trim();
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const desc = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} « ${(el.innerText || el.getAttribute('name') || '').trim().slice(0, 30)} »`;
  if (!document.documentElement.lang) out.push('html sans lang');
  for (const el of document.querySelectorAll('button, a[href], [role=button]')) if (visible(el) && !nomAcc(el)) out.push('sans nom accessible : ' + desc(el));
  for (const el of document.querySelectorAll('img')) if (!el.hasAttribute('alt')) out.push('img sans alt : ' + el.src.slice(0, 60));
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden' || !visible(el)) continue;
    const lab = el.labels && el.labels.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
    if (!lab) out.push('champ sans libellé : ' + desc(el));
  }
  const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  for (const [k, n] of Object.entries(ids)) if (n > 1) out.push(`id en double : ${k} (${n})`);
  // Titres : un seul h1, pas de saut de niveau.
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h => +h.tagName[1]);
  if (hs.filter(x => x === 1).length !== 1) out.push(`h1 : ${hs.filter(x => x === 1).length}`);
  for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) { out.push(`saut de titre h${hs[i - 1]} → h${hs[i]}`); break; }
  // Contraste du texte (fond opaque le plus proche).
  const rgb = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] === undefined ? 1 : v[3] }; };
  const lum = ({ r, g, b }) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fond = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.9) return c; if (getComputedStyle(e).backgroundImage !== 'none') return null; } return { r: 255, g: 255, b: 255 }; };
  const vus = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el), c = rgb(cs.color), f = fond(el); if (!c || !f) continue;
    const L1 = lum(c), L2 = lum(f), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const grand = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (grand ? 3 : 4.5)) { const k = `${cs.color}/${f.r},${f.g},${f.b}`; if (!vus.has(k)) { vus.add(k); out.push(`contraste ${ratio.toFixed(2)} : ${desc(el)} (${cs.color} sur rgb(${f.r},${f.g},${f.b}))`); } }
  }
  // Cibles tactiles (mobile) : 24 px au moins (WCAG 2.2 AA).
  if (innerWidth < 500) for (const el of document.querySelectorAll('button, a[href], input[type=checkbox], input[type=radio]')) { if (!visible(el)) continue; const r = el.getBoundingClientRect(); if ((r.width < 24 || r.height < 24) && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline')) out.push(`cible petite ${Math.round(r.width)}×${Math.round(r.height)} : ${desc(el)}`); }
  return [...new Set(out)];
};
(async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { ABONNEMENT_OBLIGATOIRE: 'non', LIMITES_FACTEUR: '100' }, urlPublique: base, journal: { log() {}, error() {} } }));
  const b = await chromium.launch();
  const p0 = await (await b.newContext()).newPage(); await p0.goto(base + '/app');
  const info = await p0.evaluate(async () => {
    const j = (m, u, c) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: c ? JSON.stringify(c) : undefined }).then(r => r.json());
    await j('POST', '/api/auth/inscription', { email: 'a11y@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier Lin', pays: 'ch', secteur: 'maison' }, entreprise: { raison: 'Lin Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'a11y@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } } });
    const ids = [];
    for (const [nom, prix, extra] of [['Torchon en lin', 18, { reassortJours: 30, contenance: 250, unite: 'g' }], ['Nappe brodée', 60, {}], ['Plaid', 90, { precommande: true, expeditionPrevue: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) }]]) ids.push((await j('POST', '/api/admin/produits', { produit: { nom, prix, stock: 5, description: 'Lin lavé, tissé au Portugal.', ...extra } })).id);
    await j('POST', '/api/admin/articles', { titre: 'Entretenir le lin', corps: '## Lavage\nÀ 30 °C.', publie: true, produits: ids.slice(0, 2) });
    return { slug: (await j('GET', '/api/admin/etat')).serveur.slug, ids };
  });
  const pages = [
    ['accueil', `/s/${info.slug}`, null],
    ['produit', `/s/${info.slug}/p/${info.ids[2]}`, null],
    ['panier', `/s/${info.slug}`, async p => { await p.evaluate(ids => { vue.panier = [{ produitId: ids[0], qte: 1, nom: 'Torchon en lin', prix: 18 }]; vue.ouvert = true; rendre(); }, info.ids); }],
    ['journal', `/s/${info.slug}/journal/entretenir-le-lin`, null]
  ];
  for (const [vnom, vp] of [['bureau', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 800 }]]) {
    const ctx = await b.newContext({ viewport: vp });
    for (const [nom, url, action] of pages) {
      const p = await ctx.newPage(); await p.goto(base + url); await p.waitForTimeout(1000);
      if (action) { await action(p); await p.waitForTimeout(500); }
      const r = await p.evaluate(AUDIT);
      console.log(`${vnom} ${nom} : ${r.length ? '\n  - ' + r.join('\n  - ') : 'aucun constat'}`);
      await p.close();
    }
    await ctx.close();
  }
  await b.close(); s.close();
})();
