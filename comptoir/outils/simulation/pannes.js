// Réseau lent, doubles clics et serveur coupé : aucune action ne doit être faite deux fois, aucune erreur ne doit rester muette.
// Usage : node pannes.js http://localhost:3000
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:3000';
const constats = [];
const ralentir = async (ctx, ms) => ctx.route('**/api/**', async r => { await new Promise(ok => setTimeout(ok, ms)); await r.continue().catch(() => {}); });

(async () => {
  const b = await chromium.launch();
  // 1. Inscription : double clic sur « Continuer » avec un réseau lent
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ralentir(ctx, 1500);
  const p = await ctx.newPage();
  const err = []; p.on('pageerror', e => err.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(base + '/app'); await p.waitForTimeout(2500);
  const email = `panne${Date.now()}@exemple.ch`;
  await p.fill('#cx-nom', 'Panne Test'); await p.fill('#cx-email', email); await p.fill('#cx-mdp', 'mot de passe solide');
  await p.dblclick('#form-auth button.btn'); await p.click('#form-auth button.btn').catch(() => {});
  await p.waitForTimeout(9000);
  const erreurAff = await p.evaluate(() => document.querySelector('.alerte-encart')?.innerText || '');
  if (/existe déjà/.test(erreurAff)) constats.push('double clic à l’inscription : message « compte existe déjà » affiché à tort');
  if (!(await p.$('[data-abo="payer"]'))) constats.push('double clic à l’inscription : écran de paiement absent ' + erreurAff);
  await p.check('input[data-abo="formule"][value="pro"]', { force: true }).catch(() => {}); await p.waitForTimeout(200);   // la caisse est dans la formule Pro
  await p.dblclick('[data-abo="payer"]'); await p.waitForURL(/abonnement-simule/, { timeout: 15000 });
  await p.click('button:has-text("Payer")'); await p.waitForTimeout(9000);
  // Adresse de l'entreprise (sans elle, la boutique n'accepte pas de commandes), saisie comme un marchand dans Conformité
  await p.evaluate(() => { location.hash = 'conformite'; }); await p.waitForTimeout(800);
  await p.fill('#en-adresse', 'Rue de Bourg 1, 1003 Lausanne'); await p.press('#en-adresse', 'Tab'); await p.waitForTimeout(2500);
    // 2. Import catalogue : double clic
  await p.evaluate(() => { location.hash = 'sourcing'; }); await p.waitForTimeout(800);
  const avantImport = await p.evaluate(() => etat.produits.length);
  const bouton = p.locator('[data-action="importer-produit"]').first();
  await bouton.dblclick(); await p.waitForTimeout(6000);
  const apresImport = await p.evaluate(() => api('GET', '/api/admin/etat').then(e => e.produits.length));
  if (apresImport - avantImport > 1) constats.push(`double clic sur « Importer » : ${apresImport - avantImport} produits ajoutés`);
  // 3. Nouveau produit : double clic sur Enregistrer
  await p.evaluate(() => { location.hash = 'produits'; }); await p.waitForTimeout(800);
  await p.click('[data-action="nouveau-produit"]'); await p.waitForTimeout(300);
  await p.fill('#pf-nom', 'Produit double clic'); await p.fill('#pf-prix', '20'); if (await p.$('#pf-stock')) await p.fill('#pf-stock', '5');
  await p.dblclick('[data-form="produit"] button.btn:not(.fantome)'); await p.waitForTimeout(7000);
  const nDouble = await p.evaluate(() => api('GET', '/api/admin/etat').then(e => e.produits.filter(x => x.nom === 'Produit double clic').length));
  if (nDouble !== 1) constats.push(`double clic sur « Enregistrer » un produit : ${nDouble} produits créés`);
  // 4. Caisse : double clic sur Encaisser
  await p.evaluate(() => { location.hash = 'magasin'; }); await p.waitForTimeout(800);
  const avantCaisse = await p.evaluate(() => api('GET', '/api/admin/etat').then(e => e.commandes.filter(c => c.canal === 'magasin').length));
  await p.click('[data-action="caisse-ajout"] >> nth=0').catch(() => constats.push('caisse : aucun produit en stock'));
  await p.waitForTimeout(300);
  await p.dblclick('[data-action="encaisser"] >> nth=0').catch(() => {}); await p.waitForTimeout(7000);
  const apresCaisse = await p.evaluate(() => api('GET', '/api/admin/etat').then(e => e.commandes.filter(c => c.canal === 'magasin').length));
  if (apresCaisse - avantCaisse > 1) constats.push(`double clic sur « Encaisser » : ${apresCaisse - avantCaisse} ventes enregistrées`);
  const slug = await p.evaluate(() => SERVEUR.slug);
  // 5. Boutique : double clic sur Payer avec réseau lent
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ralentir(c2, 1500);
  const q = await c2.newPage();
  await q.goto(`${base}/s/${slug}`); await q.waitForTimeout(3500);
  await q.click('.sf-carte [data-sf="ajouter"] >> nth=0'); await q.waitForTimeout(300);
  await q.fill('#commande input[name="nom"]', 'Double Clic'); await q.fill('#commande input[name="email"]', 'double@exemple.ch');
  if (await q.$('#commande input[name="adresse"]')) { await q.fill('#commande input[name="adresse"]', 'Rue 1'); await q.fill('#commande input[name="npa"]', '1003'); await q.fill('#commande input[name="ville"]', 'Lausanne'); }
  await q.dblclick('#commande button.sf-btn.plein'); await q.waitForTimeout(6000);
  const nCmd = await p.evaluate(() => api('GET', '/api/admin/etat').then(e => e.commandes.filter(c => c.client.email === 'double@exemple.ch').length));
  if (nCmd > 1) constats.push(`double clic sur « Payer » : ${nCmd} commandes créées`);
  // 6. Serveur injoignable pendant l'utilisation de l'admin
  await ctx.unroute('**/api/**');
  await ctx.route('**/api/**', r => r.abort('connectionrefused').catch(() => {}));
  await p.evaluate(() => { location.hash = 'editeur'; }); await p.waitForTimeout(500);
  await p.click('.ls-nom >> nth=0').catch(() => {}); await p.waitForTimeout(200);
  const champ = await p.$('.ls-champs input'); if (champ) await champ.fill('Modifié hors ligne');
  await p.waitForTimeout(2500);
  const toast = await p.evaluate(() => document.querySelector('#toast')?.innerText || '');
  if (!/enregistr|connexion|réseau|hors ligne/i.test(toast)) constats.push(`serveur coupé : aucune alerte visible quand une modification n’est pas enregistrée (toast : « ${toast} »)`);
  await p.evaluate(() => { location.hash = 'produits'; }); await p.waitForTimeout(300);
  await p.click('[data-action="dupliquer-produit"] >> nth=0').catch(() => {}); await p.waitForTimeout(1000);
  const toast2 = await p.evaluate(() => document.querySelector('#toast')?.innerText || '');
  if (!toast2) constats.push('serveur coupé : action « dupliquer » sans message d’erreur');
  // Retour du serveur : la modification faite hors ligne est-elle envoyée ?
  await ctx.unroute('**/api/**');
  await p.waitForTimeout(16000);
  const titre = await p.evaluate(() => api('GET', '/api/admin/etat').then(e => JSON.stringify(e.boutique.sections)));
  if (!titre.includes('Modifié hors ligne')) constats.push('modification faite pendant la coupure perdue après le retour du serveur');
  if (err.length) constats.push('erreurs JavaScript : ' + [...new Set(err)].join(' | ').slice(0, 300));
  console.log(constats.length ? constats.join('\n') : 'aucun problème');
  await b.close();
})();
