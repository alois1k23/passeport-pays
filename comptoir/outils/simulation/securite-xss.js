// Test d'injection (XSS stockée) : des charges piégées dans tous les champs saisissables par un marchand
// ou par un acheteur ; on vérifie dans le navigateur qu'aucune ne s'exécute, ni en boutique ni dans l'admin.
// Usage : node securite-xss.js http://localhost:3000
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:3000';
const PIEGES = [
  '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
  '"><svg onload="window.__xss=(window.__xss||0)+1">',
  '</script><script>window.__xss=(window.__xss||0)+1</script>',
  'javascript:window.__xss=1',
  "'-alert(1)-'",
  '<a href="javascript:window.__xss=1">lien</a>',
  '{{constructor.constructor("window.__xss=1")()}}',
  '<iframe srcdoc="<script>parent.__xss=1</script>">'
];
const p = k => PIEGES[k % PIEGES.length];
const constats = [];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const m = await ctx.newPage();
  m.on('dialog', d => { constats.push('boîte de dialogue ouverte par une injection : ' + d.message()); d.dismiss(); });
  await m.goto(base + '/app'); await m.waitForTimeout(600);
  await m.fill('#cx-nom', 'Boutique ' + p(0).slice(0, 40)); await m.fill('#cx-email', `xss${Date.now()}@exemple.ch`); await m.fill('#cx-mdp', 'mot de passe solide');
  await m.click('#form-auth button.btn'); await m.waitForTimeout(2500);
  await m.click('[data-abo="payer"]'); await m.waitForURL(/abonnement-simule/); await m.click('button:has-text("Payer")'); await m.waitForTimeout(2500);
  // Le marchand remplit tout avec des pièges (par l'API, comme un attaquant le ferait)
  const slug = await m.evaluate(async P => {
    const e = await api('GET', '/api/admin/etat');
    const { produits, commandes, serveur, avis, abonnes, envois, audience, offresVues, ...conf } = e;
    conf.boutique.slogan = P[1];
    conf.boutique.sections = conf.boutique.sections.map((s, i) => ({ ...s, props: Object.fromEntries(Object.entries(s.props).map(([k, v], j) => [k, typeof v === 'string' ? P[(i + j) % P.length] : v])) }));
    conf.boutique.sections.push({ id: 'zz', type: 'inconnu<script>', props: { titre: P[2] } });
    conf.entreprise = { ...conf.entreprise, raison: P[3], adresse: P[0], email: 'a@b.ch' + P[1], siret: P[5] };
    conf.magasin = { ...conf.magasin, adresse: P[6], horaires: P[7], clickCollect: true };
    conf.offres = { ...conf.offres, codes: [{ code: 'XSS<img>', remise: 10 }] };
    await api('PUT', '/api/admin/config', { config: conf });
    await api('POST', '/api/admin/produits', { produit: { nom: P[0], description: P[2], categorie: P[1], prix: 20, stock: 9, type: 'stock' } });
    await api('POST', '/api/admin/produits', { produit: { nom: 'Normal', description: P[5], categorie: P[6], prix: 30, stock: 9, type: 'stock' } });
    return SERVEUR.slug;
  }, PIEGES);
  // Un acheteur piège sa commande (nom, adresse, ville, e-mail) et s'inscrit à la newsletter
  const cl = await ctx.newPage();
  cl.on('dialog', d => { constats.push('boîte de dialogue (boutique) : ' + d.message()); d.dismiss(); });
  await cl.goto(`${base}/s/${slug}`); await cl.waitForTimeout(900);
  const enBoutique = await cl.evaluate(() => window.__xss || 0);
  if (enBoutique) constats.push(`boutique publique : ${enBoutique} injection(s) exécutée(s)`);
  const pub = await cl.evaluate(() => fetch(location.pathname.replace('/s/', '/api/public/')).then(r => r.json()));
  const prod = pub.produits[0];
  const cmd = await cl.evaluate(async ({ slug, prod, P }) => {
    const r = await fetch(`/api/public/${slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: prod.id, qte: 1 }], livraison: 'poste-eco', client: { nom: P[0], email: 'pirate@exemple.ch', adresse: P[1], npa: '1003', ville: P[2] } }) });
    return { statut: r.status, json: await r.json() };
  }, { slug, prod, P: PIEGES });
  if (cmd.json.paiementUrl) { await cl.goto(cmd.json.paiementUrl); await cl.waitForTimeout(400); if (await cl.evaluate(() => window.__xss || 0)) constats.push('page de paiement : injection exécutée'); await cl.click('button:has-text("Payer")'); await cl.waitForTimeout(1500); if (await cl.evaluate(() => window.__xss || 0)) constats.push('confirmation de commande : injection exécutée'); }
  // Fiche produit, mentions légales, CGV
  await cl.goto(`${base}/s/${slug}`); await cl.waitForTimeout(800);
  await cl.click('[data-sf="fiche"] >> nth=0').catch(() => {}); await cl.waitForTimeout(300);
  await cl.click('.sf-legal button >> nth=0').catch(() => {}); await cl.waitForTimeout(300);
  if (await cl.evaluate(() => window.__xss || 0)) constats.push('fiche produit ou mentions légales : injection exécutée');
  // Côté marchand : tous les écrans, la fiche de la commande piégée, la facture, les e-mails
  await m.reload(); await m.waitForTimeout(2000);
  for (const r of ['tableau', 'commandes', 'clients', 'produits', 'editeur', 'conformite', 'magasin', 'boutique', 'conversion', 'parametres', 'analyse', 'social', 'stars', 'domaines', 'copilote']) {
    await m.evaluate(r => { location.hash = r; }, r); await m.waitForTimeout(350);
    const n = await m.evaluate(() => window.__xss || 0);
    if (n) { constats.push(`admin, écran ${r} : injection exécutée`); await m.evaluate(() => { window.__xss = 0; }); }
  }
  await m.evaluate(() => { location.hash = 'commandes'; }); await m.waitForTimeout(400);
  await m.click('[data-action="ouvrir-commande"] >> nth=0').catch(() => {}); await m.waitForTimeout(400);
  await m.click('[data-action="facture"]').catch(() => {}); await m.waitForTimeout(400);
  if (await m.evaluate(() => window.__xss || 0)) constats.push('fiche commande ou facture : injection exécutée');
  await m.evaluate(() => { location.hash = 'clients'; }); await m.waitForTimeout(400);
  await m.click('[data-action="ouvrir-client"] >> nth=0').catch(() => {}); await m.waitForTimeout(400);
  if (await m.evaluate(() => window.__xss || 0)) constats.push('fiche client : injection exécutée');
  const mails = await m.evaluate(() => api('GET', '/api/admin/emails'));
  // Les e-mails partent en texte brut (Brevo textContent, Postmark TextBody) : une balise y reste du texte.
  if (mails.some(e => /<\/?(html|body|div|p)\b/i.test(e.corps))) constats.push('e-mail envoyé en HTML : échapper les champs saisis');
  // En-têtes de sécurité
  const h = await fetch(base + '/s/' + slug).then(r => Object.fromEntries(r.headers));
  for (const k of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) if (!h[k]) constats.push(`en-tête ${k} absent`);
  const api2 = await fetch(base + '/api/session').then(r => Object.fromEntries(r.headers));
  if (!api2['cache-control'] || !/no-store/.test(api2['cache-control'])) constats.push('réponses API sans Cache-Control: no-store');
  console.log(constats.length ? constats.join('\n') : 'aucune injection exécutée');
  await b.close();
})();
