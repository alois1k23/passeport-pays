// Audit d'accessibilité automatique (inspiré des règles WCAG 2.2 AA) sur tous les écrans, en clair et en sombre.
// Usage : node accessibilite.js <url-base> ; sans serveur : node accessibilite.js file:///…/comptoir
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:3000';
const ROUTES = ['tableau', 'analyse', 'copilote', 'commandes', 'clients', 'magasin', 'produits', 'stars', 'sourcing', 'tests', 'fournisseurs', 'social', 'conversion', 'domaines', 'editeur', 'conformite', 'boutique', 'parametres', 'offre', 'creer'];

function auditer() {
  const pb = [];
  const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const nomAccessible = e => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.innerText || e.getAttribute('title') || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) || (e.closest('label') && e.closest('label').textContent) || (['BUTTON', 'A'].includes(e.tagName) ? e.innerText : '') || e.getAttribute('alt') || (e.querySelector && e.querySelector('img[alt],svg[aria-label]') ? 'img' : '') || '').trim();
  const desc = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}${e.dataset && e.dataset.action ? `[${e.dataset.action}]` : ''}`;
  for (const e of document.querySelectorAll('input:not([type=hidden]), select, textarea')) if (visible(e) && !nomAccessible(e) && e.type !== 'file') pb.push(['champ sans étiquette', desc(e) + (e.placeholder ? ` (placeholder « ${e.placeholder} »)` : '')]);
  for (const e of document.querySelectorAll('button, a[href], [role=button]')) if (visible(e) && !nomAccessible(e)) pb.push(['bouton ou lien sans nom', desc(e)]);
  for (const e of document.querySelectorAll('img')) if (!e.hasAttribute('alt')) pb.push(['image sans alt', desc(e)]);
  for (const e of document.querySelectorAll('[data-action]:not(button):not(a):not(input):not(select):not(textarea):not(label):not(form):not(tr):not([aria-hidden=true])')) if (visible(e) && !e.getAttribute('role') && e.tabIndex < 0) pb.push(['élément cliquable inaccessible au clavier', desc(e)]);
  for (const e of document.querySelectorAll('tr[data-action]')) if (visible(e) && e.tabIndex < 0) pb.push(['ligne cliquable inaccessible au clavier', desc(e)]);
  if (!document.documentElement.lang) pb.push(['page sans langue', '']);
  if (!document.querySelector('h1')) pb.push(['page sans titre h1', location.hash]);
  // Contrastes : couleur du texte contre le premier fond opaque des parents
  // Accepte rgb()/rgba() (0–255) et color(srgb …) (0–1, produit par color-mix).
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const echelle = /^color\(srgb/.test(c) ? 1 : 255; const [r, g, b] = m.slice(0, 3).map(v => { v = Number(v) / echelle; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const fond = e => { for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); const m = s.backgroundColor.match(/[\d.]+/g); if (s.backgroundImage && s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null; if (m && (m.length < 4 || Number(m[3]) > 0.9)) return s.backgroundColor; } return 'rgb(255,255,255)'; };
  const vus = new Set();
  const marche = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = marche.nextNode())) {
    const e = n.parentElement;
    if (!e || vus.has(e) || !n.textContent.trim() || !visible(e) || e.closest('svg, .sf-visuel, [aria-hidden=true], .st-courbe, .graph')) continue;
    vus.add(e);
    const s = getComputedStyle(e), f = fond(e);
    if (!f || Number(s.opacity) < 0.99) continue;
    const a = lum(s.color), b = lum(f); if (a === null || b === null) continue;
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const grand = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
    const desactive = e.closest('button:disabled, [aria-disabled=true], .inactif');
    if (!desactive && ratio < (grand ? 3 : 4.5)) pb.push(['contraste insuffisant', `${ratio.toFixed(2)} : « ${n.textContent.trim().slice(0, 30)} » (${desc(e)})`]);
  }
  return pb;
}

async function focusVisible(p) {
  const ratés = [];
  for (let k = 0; k < 25; k++) {
    await p.keyboard.press('Tab');
    const r = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const ok = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); return ok ? null : `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''} « ${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 25)} »`; });
    if (r) ratés.push(r);
  }
  return [...new Set(ratés)];
}

(async () => {
  const b = await chromium.launch();
  const total = {};
  const ajouter = (ou, liste) => { for (const [type, d] of liste) { const k = type; (total[k] = total[k] || new Map()); const cle = d.replace(/\d+\.\d+ :/, ''); if (!total[k].has(cle)) total[k].set(cle, ou); } };
  for (const theme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    const url = base.startsWith('file:') ? base + '/index.html' : base + '/demo';
    await p.goto(url); await p.waitForTimeout(800);
    for (const r of ROUTES) {
      await p.evaluate(r => { location.hash = r; }, r); await p.waitForTimeout(450);
      ajouter(`${theme} ${r}`, await p.evaluate(auditer));
      if (theme === 'light') { await p.evaluate(() => document.activeElement && document.activeElement.blur()); for (const f of await focusVisible(p)) ajouter(`clavier ${r}`, [['focus invisible', f]]); }
    }
    // Boutique publique (aperçu), fiche produit, panier
    await p.evaluate(() => { location.hash = 'boutique'; }); await p.waitForTimeout(400);
    await p.click('[data-sf="fiche"] >> nth=0').catch(() => {}); await p.waitForTimeout(300); ajouter(`${theme} fiche produit`, await p.evaluate(auditer));
    await p.keyboard.press('Escape');
    if (!base.startsWith('file:')) {
      await p.goto(base + '/'); await p.waitForTimeout(500); ajouter(`${theme} accueil`, await p.evaluate(auditer));
      await p.goto(base + '/app?formule=croissance'); await p.waitForTimeout(800); ajouter(`${theme} inscription`, await p.evaluate(auditer));
    }
    await p.close();
  }
  await b.close();
  for (const [k, m] of Object.entries(total).sort((a, b) => b[1].size - a[1].size)) console.log(`\n[${m.size}] ${k}\n  ` + [...m.entries()].slice(0, 12).map(([d, ou]) => `${ou} : ${d}`).join('\n  '));
  if (!Object.keys(total).length) console.log('aucun problème');
})();
