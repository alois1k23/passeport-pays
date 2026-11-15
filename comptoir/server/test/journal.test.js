// Journal (blog) : texte enrichi sûr, pages rendues par le serveur, plan du site, brouillons invisibles.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const A = require('../src/articles');

test('texte enrichi : mise en forme, et rien d’exécutable', () => {
  const h = A.versHtml('## Titre <b>\nUn **gras** et *italique*, [lien](https://exemple.ch/a?b=1&c=2).\nSuite\n\n- un\n- deux\n### Sous-titre');
  assert.equal(h, '<h2>Titre &lt;b&gt;</h2>\n<p>Un <strong>gras</strong> et <em>italique</em>, <a href="https://exemple.ch/a?b=1&amp;c=2" rel="nofollow noopener">lien</a>.<br>Suite</p>\n<ul><li>un</li><li>deux</li></ul>\n<h3>Sous-titre</h3>');
  for (const piege of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '[x](https://a.ch/" onmouseover="alert(1))', '[x](data:text/html,<b>)', '**<svg onload=alert(1)>**']) {
    const out = A.versHtml(piege);
    assert.ok(!/<(script|img|svg)|javascript:|data:|onmouseover="|onerror=/i.test(out.replace(/&lt;|&quot;|&#39;/g, '')) || !/<(script|img|svg)\b/i.test(out), piege);
    assert.ok(!/<(script|img|svg)\b/i.test(out) && !/href="(javascript|data):/i.test(out) && !/" onmouseover="/.test(out), `${piege} → ${out}`);
  }
  assert.equal(A.slugDe('Été à Lausanne : nos 5 idées !'), 'ete-a-lausanne-nos-5-idees');
});

test('journal de bout en bout', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie().map(x => x.split(';')[0]).join('; '); if (sc) cookie = sc; return { s: r.status, j: await r.json().catch(() => null) }; };
  try {
    await c('POST', '/api/auth/inscription', { email: 'blog@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Atelier <Lac>', pays: 'ch' } } });
    const { url } = (await c('POST', '/api/abonnement/commencer', { formule: 'croissance' })).j; await fetch(url + '/confirmer', { method: 'POST', redirect: 'manual' });
    assert.equal((await c('POST', '/api/admin/articles', { titre: '   ' })).j.code, 'article_titre');
    const a1 = (await c('POST', '/api/admin/articles', { titre: 'Entretenir le lin', resume: 'Trois gestes simples.', corps: '## Lavage\nÀ **30 °C**, jamais plus.\n<script>alert(1)</script>', publie: true })).j.article;
    assert.equal(a1.slug, 'entretenir-le-lin');
    const a2 = (await c('POST', '/api/admin/articles', { titre: 'Entretenir le lin', corps: 'Brouillon', publie: false })).j.article;
    assert.equal(a2.slug, 'entretenir-le-lin-2', 'adresse unique');
    const slug = (await c('GET', '/api/admin/etat')).j.serveur.slug;
    const liste = await fetch(`${base}/s/${slug}/journal`); const htmlListe = await liste.text();
    assert.equal(liste.status, 200); assert.match(htmlListe, /Entretenir le lin/); assert.doesNotMatch(htmlListe, /entretenir-le-lin-2/, 'brouillon absent');
    assert.match(htmlListe, /Atelier &lt;Lac&gt;/); assert.doesNotMatch(htmlListe, /Atelier <Lac>/);
    const art = await fetch(`${base}/s/${slug}/journal/entretenir-le-lin`); const html = await art.text();
    assert.equal(art.status, 200);
    assert.match(html, /<h2>Lavage<\/h2>/); assert.match(html, /<strong>30 °C<\/strong>/); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /"@type":"BlogPosting"/); assert.match(html, /<link rel="canonical" href="[^"]+\/journal\/entretenir-le-lin">/);
    const csp = art.headers.get('content-security-policy'); assert.match(csp, /script-src 'self'/);
    assert.equal((await fetch(`${base}/s/${slug}/journal/entretenir-le-lin-2`)).status, 404, 'brouillon : introuvable');
    const plan = await (await fetch(`${base}/s/${slug}/sitemap.xml`)).text();
    assert.match(plan, /\/journal\/entretenir-le-lin</); assert.doesNotMatch(plan, /entretenir-le-lin-2/);
    assert.equal((await c('GET', `/api/public/${slug}`)).j.journal, 1);
    // Publication, modification, suppression.
    assert.equal((await c('PUT', `/api/admin/articles/${a2.id}`, { titre: 'Le lin en hiver', corps: 'Publié', publie: true })).j.article.slug, 'le-lin-en-hiver');
    assert.equal((await fetch(`${base}/s/${slug}/journal/le-lin-en-hiver`)).status, 200);
    assert.equal((await c('DELETE', `/api/admin/articles/${a1.id}`)).s, 200);
    assert.equal((await fetch(`${base}/s/${slug}/journal/entretenir-le-lin`)).status, 404);
    { const ap = await c('POST', '/api/admin/articles/apercu', { corps: '**ok**' }); assert.equal(ap.s, 200, JSON.stringify(ap)); assert.match(ap.j.rendu, /<strong>ok<\/strong>/); }
  } finally { s.close(); }
});
