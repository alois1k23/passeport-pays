// 100 utilisateurs dans un vrai navigateur : 40 marchands (mode connecté) et 60 acheteurs sur les boutiques créées.
const { chromium, devices } = require('playwright');
const base = process.argv[2] || 'http://localhost:3995';
const dossier = process.argv[3] || require('node:os').tmpdir();
const anomalies = [], reussites = {};
const note = (qui, quoi, detail = '') => anomalies.push({ qui, quoi, detail: String(detail).slice(0, 240) });
const ok = k => { reussites[k] = (reussites[k] || 0) + 1; };
const ECRANS = [
  ['bureau 1440', { viewport: { width: 1440, height: 900 } }],
  ['portable 1280', { viewport: { width: 1280, height: 720 } }],
  ['tablette', { viewport: { width: 820, height: 1180 }, hasTouch: true }],
  ['iPhone 13', devices['iPhone 13']],
  ['petit Android 360', { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]
];
const ROUTES = ['tableau', 'analyse', 'copilote', 'commandes', 'clients', 'magasin', 'produits', 'sourcing', 'tests', 'fournisseurs', 'social', 'conversion', 'domaines', 'editeur', 'conformite', 'boutique', 'parametres', 'offre', 'creer'];
const NOMS = ['Atelier Sauge', 'Café d’Ouchy', 'L\'Émeraude & Co', 'Zürich Design', 'Boutique 🌿 Verte', '<b>Gras</b>', 'Nord', 'Les Délices de Montreux et environs du Léman', 'Bijoux Léman', 'TechZone'];

async function controlerPage(p, qui, ou, larg) {
  const r = await p.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/.{0,40}\b(undefined|NaN|\[object Object\]|Invalid Date)\b.{0,40}/);
    const vue = document.querySelector('#vue');
    const larges = [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 2 && !e.closest('.table-wrap, .chaleur-wrap, .onglets, .segment, .param-nav, .scene, .comptes, .frise-saisons'); }).slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + '#' + e.id + '@' + Math.round(e.getBoundingClientRect().right));
    return { suspect: m && m[0], vide: vue ? vue.innerText.trim().length < 20 : false, deborde: document.documentElement.scrollWidth > innerWidth + 1, larges };
  });
  if (r.suspect) note(qui, `texte technique visible (${ou})`, r.suspect);
  if (r.vide) note(qui, `page vide (${ou})`);
  if (r.deborde) note(qui, `défilement horizontal (${ou}, ${larg})`, r.larges.join(', '));
}

async function marchand(b, i) {
  const [nomEcran, opts] = ECRANS[i % ECRANS.length];
  const sombre = i % 3 === 2;
  const qui = `marchand ${i + 1} (${nomEcran}${sombre ? ', sombre' : ''})`;
  const ctx = await b.newContext({ ...opts, colorScheme: sombre ? 'dark' : 'light', locale: 'fr-CH' });
  const p = await ctx.newPage();
  p.on('pageerror', e => note(qui, 'erreur JavaScript', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|fonts|qrcode|Failed to load resource/.test(m.text())) note(qui, 'erreur console', m.text()); });
  p.on('dialog', d => d.accept());
  const larg = opts.viewport ? opts.viewport.width : 390;
  try {
    await p.goto(base + '/app'); await p.waitForTimeout(700);
    const nom = NOMS[i % NOMS.length] + (i >= NOMS.length ? ' ' + i : '');
    await p.fill('#cx-nom', nom); await p.fill('#cx-email', `ui${i}-${Date.now()}@exemple.ch`); await p.fill('#cx-mdp', 'mot de passe solide');
    if (await p.$('#cx-pays')) await p.selectOption('#cx-pays', i % 4 === 3 ? 'fr' : 'ch').catch(() => {});
    if (await p.$('#cx-secteur')) await p.selectOption('#cx-secteur', { index: i % 9 }).catch(() => {});
    await p.click('#form-auth button[type="submit"], #form-auth button:not([type])'); await p.waitForTimeout(2500);
    const co = await p.evaluate(() => typeof SERVEUR !== 'undefined' && SERVEUR.connecte);
    if (!co) { note(qui, 'inscription par le formulaire impossible', await p.evaluate(() => document.querySelector('.erreur-form, #toast')?.innerText || document.body.innerText.slice(0, 200))); await ctx.close(); return null; }
    ok('inscription');
    const titre = await p.evaluate(() => document.title);
    if (/<b>/.test(titre) && /<b>/.test(await p.evaluate(() => document.querySelector('#nom-boutique')?.innerHTML || ''))) note(qui, 'balise HTML interprétée dans le nom');
    // Parcours de tous les écrans (dans un ordre différent selon la personne)
    const ordre = ROUTES.slice(i % 5).concat(ROUTES.slice(0, i % 5));
    for (const r of ordre) {
      await p.evaluate(r => location.hash = r, r); await p.waitForTimeout(350);
      await controlerPage(p, qui, r, larg);
    }
    ok('tous les écrans');
    // Ajout d'un produit (prix décimal avec virgule pour certains)
    await p.evaluate(() => location.hash = 'produits'); await p.waitForTimeout(400);
    await p.click('[data-action="nouveau-produit"]'); await p.waitForTimeout(300);
    await p.fill('#pf-nom', 'Mug en grès ' + i);
    await p.fill('#pf-prix', i % 2 ? '24.90' : '25');
    if (await p.$('#pf-stock')) await p.fill('#pf-stock', '12');
    if (await p.$('#pf-cout')) await p.fill('#pf-cout', '8');
    await p.click('[data-form="produit"] button.btn:not(.fantome)'); await p.waitForTimeout(900);
    const n = await p.evaluate(i => etat.produits.some(x => x.nom === 'Mug en grès ' + i), i);
    if (!n) note(qui, 'produit non enregistré via le formulaire', await p.evaluate(() => document.querySelector('#toast')?.innerText || ''));
    else ok('ajout produit');
    // Code promo
    await p.evaluate(() => location.hash = 'conversion'); await p.waitForTimeout(500);
    await p.fill('[data-form="ajout-code"] input[name="code"]', 'ete' + i);
    await p.fill('[data-form="ajout-code"] input[name="remise"]', '12');
    await p.click('[data-form="ajout-code"] button'); await p.waitForTimeout(900);
    const code = await p.evaluate(i => Remises.codesValables(etat).some(c => c.code === ('ETE' + i)), i);
    if (!code) note(qui, 'code promo non ajouté'); else ok('code promo');
    // Éditeur : modifier le titre de la première section
    await p.evaluate(() => location.hash = 'editeur'); await p.waitForTimeout(400);
    await p.click('.ls-nom >> nth=0').catch(e => note(qui, 'section de l’éditeur non cliquable', e.message.split('\n')[0]));
    await p.waitForTimeout(250);
    const champ = await p.$('.ls-champs input, .ls-champs textarea');
    if (champ) { await champ.fill('Bienvenue chez nous ' + i); await p.waitForTimeout(800); ok('édition section'); } else note(qui, 'aucun champ dans la section ouverte');
    if (await p.$('[data-action="publier"]')) { await p.click('[data-action="publier"]'); await p.waitForTimeout(500); ok('publication du site'); }
    // Réseaux sociaux : générer le planning
    await p.evaluate(() => location.hash = 'social'); await p.waitForTimeout(400);
    if (!(await p.$('[data-action="generer-planning"][disabled]'))) note(qui, 'bouton « Générer » actif sans réseau connecté');
    await p.click('[data-action="compte-social"][data-id="instagram"]').catch(e => note(qui, 'connexion Instagram impossible', e.message.split('\n')[0])); await p.waitForTimeout(700);
    await p.click('[data-action="generer-planning"]').catch(() => note(qui, 'bouton « Générer » inutilisable après connexion'));
    await p.waitForTimeout(1500);
    const nPub = await p.evaluate(() => (etat.publications || []).length);
    if (!nPub) note(qui, 'aucune publication générée', await p.evaluate(() => (document.querySelector('#toast')?.innerText || '') + ' | comptes=' + JSON.stringify(etat.social && etat.social.comptes) + ' | produits=' + etat.produits.filter(x => x.actif).length)); else ok('planning social');
    // Paramètres : toutes les sections
    await p.evaluate(() => location.hash = 'parametres'); await p.waitForTimeout(300);
    for (const s of ['general', 'apparence', 'paiements', 'livraison', 'emails', 'domaine', 'abonnement', 'donnees', 'sensible']) { await p.click(`[data-action="section-param"][data-v="${s}"]`); await p.waitForTimeout(120); await controlerPage(p, qui, 'paramètres ' + s, larg); }
    // Palette de commandes
    if (larg > 700) { await p.keyboard.press('Control+k'); await p.waitForTimeout(200); await p.keyboard.type('comm'); await p.keyboard.press('Enter'); await p.waitForTimeout(400); if (!(await p.evaluate(() => location.hash)).includes('commandes')) note(qui, 'palette Ctrl+K : « comm » n’ouvre pas Commandes'); else ok('palette'); }
    // Rechargement : l'état doit persister côté serveur
    await p.reload(); await p.waitForTimeout(1500);
    const persiste = await p.evaluate(i => etat.produits.some(x => x.nom === 'Mug en grès ' + i), i);
    if (!persiste) note(qui, 'produit perdu après rechargement'); else ok('persistance');
    const slug = await p.evaluate(() => SERVEUR.slug);
    if (i % 4 === 0) await p.screenshot({ path: `${dossier}/m${i + 1}.png` });
    await ctx.close();
    return slug;
  } catch (e) { note(qui, 'parcours interrompu', e.message.split('\n')[0]); await p.screenshot({ path: `${dossier}/m${i + 1}-erreur.png` }).catch(() => {}); await ctx.close(); return null; }
}

async function acheteur(b, j, slugs) {
  const [nomEcran, opts] = ECRANS[(j + 2) % ECRANS.length];
  const qui = `acheteur ${j + 1} (${nomEcran})`;
  const slug = slugs[j % slugs.length];
  const ctx = await b.newContext({ ...opts, locale: 'fr-CH' });
  const p = await ctx.newPage();
  p.on('pageerror', e => note(qui, 'erreur JavaScript', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|fonts|Failed to load resource/.test(m.text())) note(qui, 'erreur console', m.text()); });
  const larg = opts.viewport ? opts.viewport.width : 390;
  try {
    await p.goto(`${base}/s/${slug}`); await p.waitForTimeout(800);
    await controlerPage(p, qui, 'boutique', larg);
    if (await p.$('[data-c="cookies"]')) await p.click(`[data-c="cookies"] >> nth=${j % 2}`);
    // Navigation
    for (const v of ['collection', 'apropos', 'contact']) await p.click(`[data-sf="nav"][data-v="${v}"]`).catch(e => note(qui, `lien « ${v} » non cliquable`, e.message.split('\n')[0]));
    // Fiche produit (2 acheteurs sur 3), sinon ajout direct
    const fiches = await p.$$('[data-sf="fiche"]');
    if (!fiches.length) { note(qui, 'aucun produit sur la boutique'); await ctx.close(); return; }
    if (j % 3) {
      await p.click(`.sf-titre-lien >> nth=${j % Math.max(1, (await p.$$('.sf-titre-lien')).length)}`); await p.waitForTimeout(300);
      await controlerPage(p, qui, 'fiche produit', larg);
      if (await p.$('[data-sf-qte]')) await p.selectOption('[data-sf-qte]', String(1 + (j % 2)));
      await p.click('.sf-fiche [data-sf="ajouter"]');
    } else await p.click('.sf-carte [data-sf="ajouter"] >> nth=0');
    await p.waitForTimeout(400);
    const tiroir = await p.$('.tiroir.ouvert');
    if (!tiroir) { note(qui, 'le panier ne s’ouvre pas après l’ajout'); await ctx.close(); return; }
    // Quantité +/−
    if (j % 4 === 1) { await p.click('[data-c="qte"][data-d="1"] >> nth=0'); await p.waitForTimeout(150); }
    // Remplit d'abord le formulaire, PUIS change la livraison et applique un code : les saisies doivent rester.
    await p.fill('#commande input[name="nom"]', 'Léa Müller ' + j);
    await p.fill('#commande input[name="email"]', `client${j}@exemple.ch`);
    if (await p.$('#commande input[name="adresse"]')) { await p.fill('#commande input[name="adresse"]', 'Avenue de la Gare 3'); await p.fill('#commande input[name="npa"]', ['1003', '1201', '8001', '1950', '9999'][j % 5]); await p.waitForTimeout(150); }
    const villeAuto = await p.inputValue('#commande input[name="ville"]').catch(() => '');
    const boutiqueCH = await p.evaluate(() => donnees.boutique.pays === 'ch');
    if (boutiqueCH && j % 5 < 4 && !villeAuto) note(qui, 'ville non remplie depuis le NPA', ['1003', '1201', '8001', '1950'][j % 5]);
    const nModes = (await p.$$('input[name="livraison"]')).length;
    if (nModes > 1) { await p.locator('input[name="livraison"]').nth((j % (nModes - 1)) + 1).check(); await p.waitForTimeout(250); }
    if (j % 3 === 0) { await p.fill('#form-code input', j % 2 ? 'codefaux' : 'bienvenue10'); await p.click('#form-code button'); await p.waitForTimeout(600); }
    const garde = await p.inputValue('#commande input[name="nom"]').catch(() => '');
    if (garde !== 'Léa Müller ' + j) { note(qui, 'saisies du formulaire effacées après un changement de livraison ou de code', `nom = « ${garde} »`); await p.fill('#commande input[name="nom"]', 'Léa Müller ' + j); await p.fill('#commande input[name="email"]', `client${j}@exemple.ch`); if (await p.$('#commande input[name="adresse"]')) { await p.fill('#commande input[name="adresse"]', 'Avenue de la Gare 3'); await p.fill('#commande input[name="npa"]', '1003'); } }
    if (!(await p.inputValue('#commande input[name="ville"]').catch(() => 'x'))) await p.fill('#commande input[name="ville"]', 'Lausanne');
    await controlerPage(p, qui, 'panier', larg);
    // Bouton payer visible sans gêne sur petit écran
    const btn = await p.$('#commande button.sf-btn.plein');
    const box = btn && await btn.boundingBox();
    if (!box || box.width < 100) note(qui, 'bouton « Payer » trop petit ou absent');
    // 1 acheteur sur 6 abandonne
    if (j % 6 === 5) { await p.click('.tiroir-corps [data-c="fermer"]'); ok('abandon panier'); await ctx.close(); return; }
    await btn.click();
    await p.waitForURL(/paiement-simule|stripe/, { timeout: 8000 }).catch(() => {});
    if (!/paiement-simule/.test(p.url())) { note(qui, 'pas de redirection vers le paiement', await p.evaluate(() => document.querySelector('#erreur')?.innerText || '')); await ctx.close(); return; }
    await controlerPage(p, qui, 'page de paiement', larg);
    if (j % 10 === 9) { await p.click('form[action$="/annuler"] button, button:has-text("Annuler")').catch(() => {}); await p.waitForTimeout(800); const msg = await p.evaluate(() => document.body.innerText); if (!/annulé/i.test(msg)) note(qui, 'retour après annulation du paiement peu clair', msg.slice(0, 120)); else ok('annulation paiement'); await ctx.close(); return; }
    await p.click('button:has-text("Payer")'); await p.waitForTimeout(1500);
    const conf = await p.evaluate(() => document.body.innerText);
    if (!/merci|confirm|commande n°/i.test(conf)) note(qui, 'pas de confirmation visible après paiement', conf.slice(0, 160));
    else ok('commande payée');
    await controlerPage(p, qui, 'confirmation', larg);
    if (j % 7 === 0) await p.screenshot({ path: `${dossier}/a${j + 1}.png` });
  } catch (e) { note(qui, 'parcours interrompu', e.message.split('\n')[0]); await p.screenshot({ path: `${dossier}/a${j + 1}-erreur.png` }).catch(() => {}); }
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  const slugs = [];
  for (let i = 0; i < Number(process.env.NM || 40); i += 4) { const lot = await Promise.all([0, 1, 2, 3].map(k => marchand(b, i + k))); slugs.push(...lot.filter(Boolean)); }
  for (let j = 0; j < Number(process.env.NA || 60); j += 6) await Promise.all([0, 1, 2, 3, 4, 5].map(k => acheteur(b, j + k, slugs)));
  await b.close();
  console.log(JSON.stringify({ marchandsOk: slugs.length, reussites, anomalies }, null, 1));
})();
