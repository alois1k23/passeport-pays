// 100 boutiques de dropshipping créées par le vrai parcours (navigateur), de la plus simple à la plus complexe,
// puis contrôlées : administration (19 écrans), boutique publique, achat, transmission au fournisseur, expédition.
// Usage : node boutiques-drop.js http://localhost:3000 [dossier-captures] [nombre]
const { chromium, devices } = require('playwright');
const base = process.argv[2] || 'http://localhost:3000';
const dossier = process.argv[3] || require('node:os').tmpdir();
const N = Number(process.argv[4] || 100);
const anomalies = [], bilan = [];
const note = (qui, quoi, detail = '') => anomalies.push({ qui, quoi, detail: String(detail).slice(0, 260) });
const NIVEAUX = ['simple', 'standard', 'avancée', 'très complexe'];
const SECTEURS = ['maison', 'animaux', 'tech', 'deco', 'mode', 'beaute', 'epicerie', 'sport', 'bijoux'];
const PAYS = ['ch', 'ch', 'ch', 'fr', 'ch', 'be', 'ch', 'ch', 'fr', 'ch'];
const RACINES = ['Lumen', 'Kibo', 'Atelier', 'Nordlys', 'Zéphyr', 'Café', 'Pixel', 'Brise', 'Alpage', 'Lac', 'Étoile', 'Mosaïque', 'Sauge', 'Cèdre', 'Opale', 'Vélo', 'Pattes', 'Grain', 'Ondine', 'Rivage'];
const SUFFIXES = ['Shop', 'Maison', '& Co', 'Store', 'Léman', 'Studio', 'Suisse', 'Box', 'Lab', 'Concept'];
const ROUTES = ['tableau', 'analyse', 'copilote', 'commandes', 'clients', 'magasin', 'produits', 'sourcing', 'tests', 'fournisseurs', 'social', 'conversion', 'domaines', 'editeur', 'conformite', 'boutique', 'parametres', 'offre'];
const ECRANS = [['bureau', { viewport: { width: 1440, height: 900 } }], ['portable', { viewport: { width: 1280, height: 760 } }], ['tablette', { viewport: { width: 820, height: 1180 }, hasTouch: true }], ['iPhone', devices['iPhone 13']], ['Android 360', { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true }]];

async function controler(p, qui, ou) {
  const r = await p.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/.{0,40}\b(undefined|NaN|\[object Object\]|Invalid Date|Infinity)\b.{0,40}/);
    const vue = document.querySelector('#vue');
    return { suspect: m && m[0], vide: vue ? vue.innerText.trim().length < 20 : false, deborde: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  if (r.suspect) note(qui, `texte technique visible (${ou})`, r.suspect);
  if (r.vide) note(qui, `page vide (${ou})`);
  if (r.deborde) note(qui, `défilement horizontal (${ou})`);
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
async function etape(qui, nom, f) { try { return await f(); } catch (e) { note(qui, `étape « ${nom} » impossible`, e.message.split('\n')[0]); return null; } }

async function boutique(b, i) {
  const niveau = i % 4;
  const [nomEcran, opts] = ECRANS[i % ECRANS.length];
  const pays = PAYS[i % PAYS.length], secteur = SECTEURS[i % 9], modele = niveau === 3 && i % 8 === 3 ? 'mixte' : 'drop';
  const nom = `${RACINES[i % RACINES.length]} ${SUFFIXES[Math.floor(i / RACINES.length) % SUFFIXES.length]}${i >= 50 ? ' ' + i : ''}`;
  const qui = `boutique ${i + 1} « ${nom} » (${NIVEAUX[niveau]}, ${secteur}, ${pays}, ${nomEcran})`;
  const ctx = await b.newContext({ ...opts, colorScheme: i % 3 === 1 ? 'dark' : 'light', locale: 'fr-CH' });
  const p = await ctx.newPage();
  p.on('pageerror', e => note(qui, 'erreur JavaScript', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|fonts|qrcode|Failed to load resource/.test(m.text())) note(qui, 'erreur console', m.text()); });
  p.on('dialog', d => d.accept());
  const go = async r => { await p.evaluate(r => { location.hash = r; }, r); await p.waitForTimeout(380); };
  const res = { i, nom, niveau, pays, secteur, produits: 0, drop: 0, commande: null };
  try {
    // 1. Inscription par le formulaire
    await p.goto(base + '/app'); await p.waitForTimeout(600);
    await p.fill('#cx-nom', nom); await p.selectOption('#cx-secteur', secteur); await p.selectOption('#cx-modele', modele); await p.selectOption('#cx-pays', pays);
    await p.fill('#cx-email', `drop${i}-${Date.now()}@exemple.ch`); await p.fill('#cx-mdp', 'mot de passe solide');
    await p.click('#form-auth button.btn'); await p.waitForTimeout(2600);
    if (!(await p.evaluate(() => typeof SERVEUR !== 'undefined' && SERVEUR.connecte))) { note(qui, 'inscription impossible', await p.evaluate(() => document.body.innerText.slice(0, 200))); await ctx.close(); return res; }
    const devise = await p.evaluate(() => etat.boutique.devise);
    if (devise !== (pays === 'ch' ? 'CHF' : 'EUR')) note(qui, 'devise incohérente', devise);
    const nInit = await p.evaluate(() => etat.produits.length);
    if (!nInit) note(qui, 'boutique créée sans aucun produit de départ');

    // 2. Import de produits fournisseurs depuis « Trouver des produits » (0 à 12 selon le niveau)
    const aImporter = [0, 3, 6, 12][niveau];
    if (aImporter) await etape(qui, 'import fournisseurs', async () => {
      await go('sourcing');
      if (niveau === 3) { const chine = p.locator('.puce input[data-entrepot="CN"]'); if (await chine.count() && !(await chine.isChecked())) { await chine.check({ force: true }); await p.waitForTimeout(500); } await p.selectOption('#sc-delai', '20').catch(() => {}); await p.waitForTimeout(400); }
      for (let k = 0; k < aImporter; k++) {
        const btn = await p.$('[data-action="importer-produit"]');
        if (!btn) break;
        await btn.click(); await p.waitForTimeout(700);
      }
    });

    // 3. Produits : édition (prix barré, marge négative, masqué), produit personnel
    if (niveau >= 2) await etape(qui, 'édition produit', async () => {
      await go('produits');
      await p.click('[data-action="editer-produit"] >> nth=0').catch(() => p.click('tr[data-action="editer-produit"] >> nth=0'));
      await p.waitForTimeout(400);
      const prix = Number(await p.inputValue('#pf-prix'));
      if (niveau === 3) await p.fill('#pf-prix', String(Math.max(1, Math.round(prix * 0.3))));   // vendu sous le coût
      else if (await p.$('#pf-ref')) await p.fill('#pf-ref', String(Math.round(prix * 1.3)));    // prix barré
      await p.click('[data-form="produit"] button.btn:not(.fantome)'); await p.waitForTimeout(900);
    });
    if (niveau === 3) await etape(qui, 'produit personnel', async () => {
      await go('produits'); await p.click('[data-action="nouveau-produit"]'); await p.waitForTimeout(300);
      await p.fill('#pf-nom', 'Création maison « édition limitée » — ' + '✨'.repeat(3));
      await p.fill('#pf-prix', '1234.5'); if (await p.$('#pf-stock')) await p.fill('#pf-stock', '1'); if (await p.$('#pf-cout')) await p.fill('#pf-cout', '400');
      if (await p.$('#pf-desc')) await p.fill('#pf-desc', 'Texte très long. '.repeat(120));
      await p.click('[data-form="produit"] button.btn:not(.fantome)'); await p.waitForTimeout(900);
    });

    // 4. Éditeur : thème, sections ajoutées, déplacées, supprimées, textes extrêmes
    if (niveau >= 1) await etape(qui, 'éditeur', async () => {
      await go('editeur');
      if (await p.$('[data-action="vue-ed-mobile"][data-id="modifier"]:visible')) await p.click('[data-action="vue-ed-mobile"][data-id="modifier"]');
      await p.click('[data-action="onglet-editeur"][data-id="style"]'); await p.waitForTimeout(250);
      const themes = await p.$$('[data-action="theme"]'); if (themes.length) { await themes[i % themes.length].click(); await p.waitForTimeout(300); }
      await p.click('[data-action="onglet-editeur"][data-id="sections"]'); await p.waitForTimeout(250);
      const ajouts = [[], ['faq'], ['faq', 'newsletter', 'texte'], ['annonce', 'faq', 'newsletter', 'texte', 'avis', 'saison', 'arguments']][niveau];
      for (const t of ajouts) { await p.selectOption('#type-ajout', t); await p.click('[data-action="ajouter-section"]'); await p.waitForTimeout(250); }
      if (niveau >= 2) { await p.click('[data-action="descendre"] >> nth=0').catch(() => {}); await p.waitForTimeout(200); await p.click('[data-action="supprimer-section"] >> nth=1').catch(() => {}); await p.waitForTimeout(250); }
      if (niveau === 3) {
        await p.click('.ls-nom >> nth=0'); await p.waitForTimeout(200);
        const c = await p.$('.ls-champs input'); if (c) { await c.fill('Titre très long '.repeat(15) + ' 🌍 <i>balise</i> & « guillemets »'); await p.waitForTimeout(700); }
      }
      if (await p.$('[data-action="publier"]')) { await p.click('[data-action="publier"]'); await p.waitForTimeout(500); }
    });

    // 5. Conversion : code promo, règle d'offre, seuil de port
    if (niveau >= 2) await etape(qui, 'conversion', async () => {
      await go('conversion');
      await p.fill('[data-form="ajout-code"] input[name="code"]', 'LANCEMENT' + i); await p.fill('[data-form="ajout-code"] input[name="remise"]', String(5 + i % 30));
      await p.click('[data-form="ajout-code"] button'); await p.waitForTimeout(700);
      if (await p.$('[data-action="ajout-regle"]:not([disabled])')) { await p.click('[data-action="ajout-regle"]'); await p.waitForTimeout(700); }
    });

    // 6. Réseaux sociaux, tests produits, copilote, domaine, conformité
    if (niveau >= 2) await etape(qui, 'réseaux sociaux', async () => {
      await go('social');
      for (const r of niveau === 3 ? ['instagram', 'tiktok'] : ['tiktok']) { await p.click(`[data-action="compte-social"][data-id="${r}"]`); await p.waitForTimeout(500); }
      await p.click('[data-action="generer-planning"]'); await p.waitForTimeout(1800);
      if (!(await p.evaluate(() => (etat.publications || []).length))) note(qui, 'aucune publication générée');
    });
    if (niveau === 3) await etape(qui, 'test produit', async () => {
      await go('tests');
      const f = await p.$('[data-form="nouveau-test"] button.btn'); if (f) { await f.click(); await p.waitForTimeout(700); }
      const s = await p.$('form.saisie-test');
      if (s) { for (const [n, v] of [['depense', '25'], ['impressions', '4000'], ['vues3s', '1300'], ['clics', '80'], ['ventes', '2']]) { const el = await p.$(`form.saisie-test input[name="${n}"]`); if (el) await el.fill(v); } await p.click('.test-pied .btn:not(.fantome)'); await p.waitForTimeout(700); }
    });
    if (niveau === 3) await etape(qui, 'copilote', async () => { await go('copilote'); await p.click('[data-action="valider-campagne"]'); await p.waitForTimeout(700); });
    if (niveau >= 1) await etape(qui, 'domaine', async () => { await go('domaines'); const d = await p.$('[data-action="choisir-domaine"]'); if (d) { await d.click(); await p.waitForTimeout(600); } });
    if (niveau >= 1) await etape(qui, 'conformité', async () => {
      await go('conformite');
      await p.fill('#en-adresse', 'Rue du Lac ' + (i + 1) + ', 1003 Lausanne'); await p.press('#en-adresse', 'Tab'); await p.waitForTimeout(250);
      if (pays === 'ch') { await p.fill('#en-siret', 'CHE-123.456.' + String(100 + i)); await p.press('#en-siret', 'Tab'); }
      await p.fill('#en-email', `contact${i}@exemple.ch`); await p.press('#en-email', 'Tab'); await p.waitForTimeout(800);
    });

    // 7. Tour complet de l'administration
    for (const r of ROUTES) { await go(r); await controler(p, qui, r); }
    await attendre(900);   // laisse partir l'enregistrement différé
    const e = await p.evaluate(() => api('GET', '/api/admin/etat'));
    res.produits = e.produits.filter(x => x.actif !== false).length;
    res.drop = e.produits.filter(x => x.type === 'drop').length;
    if (!e.produits.length) note(qui, 'aucun produit dans la boutique');
    const sansDelai = e.produits.filter(x => x.type === 'drop' && !(Array.isArray(x.delai) && x.delai[1] > 0));
    if (sansDelai.length) note(qui, 'produit fournisseur sans délai de livraison', sansDelai.map(x => x.nom).join(', '));
    if (niveau >= 1 && !(e.entreprise && /Lac/.test(e.entreprise.adresse || ''))) note(qui, 'adresse de l’entreprise non enregistrée', JSON.stringify(e.entreprise).slice(0, 120));
    if (niveau >= 2 && !((e.offres && e.offres.codes) || []).some(c => c.code === 'LANCEMENT' + i)) note(qui, 'code promo non enregistré sur le serveur');
    const slug = await p.evaluate(() => SERVEUR.slug);
    if (i % 10 === 0) await p.screenshot({ path: `${dossier}/admin-${i + 1}.png` });

    // 8. Boutique publique et achat par un client (autre appareil)
    const [nomC, optsC] = ECRANS[(i + 3) % ECRANS.length];
    const c = await b.newContext({ ...optsC, locale: 'fr-CH' });
    const q = await c.newPage();
    q.on('pageerror', e2 => note(qui, 'erreur JavaScript (boutique)', e2.message));
    await q.goto(`${base}/s/${slug}`); await q.waitForTimeout(900);
    await controler(q, qui, 'boutique publique');
    const pub = await q.evaluate(() => ({ produits: donnees.produits.length, cartes: document.querySelectorAll('.sf-carte').length, sections: document.querySelectorAll('.sf > section, .sf > header, .sf > footer').length, delais: [...document.querySelectorAll('.sf-delai')].map(x => x.innerText), titre: document.title }));
    if (!pub.cartes) note(qui, 'aucun produit visible sur la boutique', JSON.stringify(pub));
    if (pub.delais.some(t => !/\d/.test(t))) note(qui, 'délai de livraison illisible', pub.delais.join(' | '));
    if (!pub.titre || pub.titre === 'Boutique') note(qui, 'titre de page de la boutique générique', pub.titre);
    if (await q.$('[data-c="cookies"]')) await q.click('[data-c="cookies"] >> nth=1');
    const cartes = await q.$$('.sf-carte [data-sf="ajouter"]:not([disabled])');
    if (!cartes.length) { note(qui, 'aucun produit achetable'); await c.close(); bilan.push(res); return res; }
    await q.click('.sf-titre-lien >> nth=0'); await q.waitForTimeout(300);
    await controler(q, qui, 'fiche produit');
    await q.click('.sf-fiche [data-sf="ajouter"]').catch(() => q.click('.sf-carte [data-sf="ajouter"] >> nth=0'));
    await q.waitForTimeout(300);
    if (niveau >= 2 && cartes.length > 1) { await q.click('.tiroir-corps [data-c="fermer"]'); await q.waitForTimeout(200); await q.click('.sf-carte [data-sf="ajouter"]:not([disabled]) >> nth=1'); await q.waitForTimeout(300); }
    const offre = await q.$('[data-c="offre"]'); if (offre && i % 2) { await offre.check(); await q.waitForTimeout(300); }
    await q.fill('#commande input[name="nom"]', 'Client Test ' + i); await q.fill('#commande input[name="email"]', `acheteur${i}@exemple.ch`);
    if (await q.$('#commande input[name="adresse"]')) { await q.fill('#commande input[name="adresse"]', 'Chemin des Vignes 5'); await q.fill('#commande input[name="npa"]', pays === 'ch' ? '1201' : '75011'); }
    const nModes = (await q.$$('input[name="livraison"]')).length;
    if (nModes > 1) { await q.locator('input[name="livraison"]').nth(i % nModes).check(); await q.waitForTimeout(250); }
    if (niveau >= 2 && i % 3 === 0) { await q.fill('#form-code input', 'lancement' + i); await q.click('#form-code button'); await q.waitForTimeout(600); const msg = await q.evaluate(() => document.querySelector('.code-promo + .mini')?.innerText || ''); if (/n’existe pas|invalide/i.test(msg)) note(qui, 'code promo créé par le marchand refusé en boutique', msg); }
    if (!(await q.inputValue('#commande input[name="ville"]'))) await q.fill('#commande input[name="ville"]', pays === 'ch' ? 'Genève' : 'Paris');
    if ((await q.inputValue('#commande input[name="nom"]')) !== 'Client Test ' + i) note(qui, 'saisie du client perdue dans le panier');
    const totalAffiche = await q.evaluate(() => document.querySelector('#commande button.sf-btn.plein')?.innerText);
    await q.click('#commande button.sf-btn.plein');
    await q.waitForURL(/paiement-simule/, { timeout: 8000 }).catch(() => {});
    if (!/paiement-simule/.test(q.url())) { note(qui, 'commande refusée', await q.evaluate(() => document.querySelector('#erreur')?.innerText || document.body.innerText.slice(0, 120))); await c.close(); bilan.push(res); return res; }
    const montantPage = await q.evaluate(() => (document.body.innerText.match(/(CHF|€)\s?[\d’'.,\s]+|[\d’'.,\s]+\s?€/) || [''])[0].trim());
    await q.click('button:has-text("Payer")'); await q.waitForTimeout(1800);
    await controler(q, qui, 'confirmation');
    const conf = await q.evaluate(() => document.querySelector('.confirm')?.innerText || '');
    if (!/Commande n°/.test(conf)) note(qui, 'pas de confirmation après paiement', conf.slice(0, 100));
    if (!/Disponible|Livré|Retrait/.test(conf)) note(qui, 'confirmation sans date de livraison', conf.slice(0, 160));
    res.commande = { totalAffiche, montantPage };
    if (i % 10 === 5) await q.screenshot({ path: `${dossier}/confirmation-${i + 1}.png` });
    await c.close();

    // 9. Côté marchand : transmission au fournisseur, expédition, facture, total
    let cmd = null;
    for (let k = 0; k < 25; k++) {
      const e2 = await p.evaluate(() => api('GET', '/api/admin/etat'));
      cmd = e2.commandes.filter(x => x.canal !== 'magasin').sort((x, y) => y.date - x.date)[0];
      if (cmd && ['expediee', 'livree'].includes(cmd.statut)) break;
      await attendre(400);
    }
    if (!cmd) note(qui, 'commande absente de l’administration');
    else {
      const aDrop = cmd.lignes.some(l => l.type === 'drop');
      if (aDrop && !['fournisseur', 'expediee', 'livree'].includes(cmd.statut)) note(qui, 'commande dropshipping non transmise au fournisseur', cmd.statut);
      if (aDrop && cmd.statut === 'expediee' && !cmd.suivi) note(qui, 'expédiée sans numéro de suivi');
      if (!cmd.facture) note(qui, 'commande payée sans facture');
      const affiche = Number(String(res.commande.totalAffiche || '').replace(/[^\d.,]/g, '').replace(/’/g, '').replace(',', '.'));
      if (affiche && Math.abs(affiche - cmd.total) > 0.01) note(qui, 'total affiché au client différent du total enregistré', `${res.commande.totalAffiche} contre ${cmd.total}`);
      await go('commandes'); await controler(p, qui, 'commandes après achat');
      await p.click(`[data-action="ouvrir-commande"][data-id="${cmd.id}"]`).catch(() => {}); await p.waitForTimeout(400);
      await controler(p, qui, 'fiche commande');
      res.statut = cmd.statut;
    }
    await ctx.close();
    bilan.push(res);
    return { ...res, slug };
  } catch (e) { note(qui, 'parcours interrompu', e.message.split('\n')[0]); await p.screenshot({ path: `${dossier}/erreur-${i + 1}.png` }).catch(() => {}); await ctx.close().catch(() => {}); bilan.push(res); return res; }
}

(async () => {
  const t0 = Date.now();
  const b = await chromium.launch();
  for (let i = 0; i < N; i += 5) await Promise.all([0, 1, 2, 3, 4].filter(k => i + k < N).map(k => boutique(b, i + k)));
  await b.close();
  console.log(JSON.stringify({ duree: Math.round((Date.now() - t0) / 1000), boutiques: bilan.length, commandes: bilan.filter(x => x.commande).length, parNiveau: NIVEAUX.map((n, k) => [n, bilan.filter(x => x.niveau === k).length, Math.round(bilan.filter(x => x.niveau === k).reduce((a, x) => a + x.produits, 0) / Math.max(1, bilan.filter(x => x.niveau === k).length))]), reussites: { boutiques: bilan.length }, anomalies, bilan }, null, 1));
})();
