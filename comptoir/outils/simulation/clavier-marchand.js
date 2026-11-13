// Espace marchand au clavier, dans un vrai navigateur : caisse (ajout au ticket, encaissement), commandes (ouverture
// d'une commande, changement de statut), devis (nouveau devis). À chaque tabulation : focus visible ; pour les
// fenêtres et panneaux : focus déplacé à l'ouverture et rendu à la fermeture.
// Usage : node outils/simulation/clavier-marchand.js
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path'), os = require('node:os'), fs = require('node:fs'), net = require('node:net');
const { chromium } = require('playwright');
const portLibre = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const problemes = [], etapes = [];
const note = (q, d = '') => problemes.push(`${q}${d ? ` : ${d}` : ''}`);

(async () => {
  const port = await portLibre(), B = `http://127.0.0.1:${port}`, base = path.join(os.tmpdir(), `comptoir-clavier-m-${process.pid}.db`);
  const srv = spawn(process.execPath, [path.join(__dirname, '../../server/server.js')], { env: { ...process.env, PORT: String(port), BASE_DE_DONNEES: base, SAUVEGARDE: 'non', URL_PUBLIQUE: B, LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(ok => srv.stdout.on('data', d => { if (String(d).includes('écoute')) ok(); }));
  const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
  const erreurs = []; p.on('pageerror', e => erreurs.push(e.message));
  const focus = () => p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), texte: (e.getAttribute('aria-label') || e.innerText || e.value || e.name || '').trim().slice(0, 50), visible: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'), action: e.dataset.action, id: e.id, dataset: { ...e.dataset } }; });
  const tab = async (cond, max = 120, quoi = '') => { for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); const f = await focus(); if (f && !f.visible) note('focus invisible', `${f.tag} « ${f.texte} »`); if (f && cond(f)) return f; } note('introuvable au clavier', quoi); return null; };
  try {
    await p.goto(B + '/app');
    await p.evaluate(b => fetch('/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }), { email: 'km@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Clavier', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'Clavier Sàrl', adresse: 'Rue 1, 1003 Lausanne', regime: 'ch-assujetti' } }, produits: [{ nom: 'Vase', prix: 40, stock: 5, type: 'stock' }, { nom: 'Bougie', prix: 15, stock: 5, type: 'stock' }] });
    // Caisse
    await p.goto(B + '/app?v=2#magasin'); await p.waitForTimeout(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    let f = await tab(x => x.action === 'caisse-ajout', 200, 'produit de la caisse');
    if (f) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); const n = await p.locator('.ticket tbody tr').count(); if (n !== 1) note('ajout au ticket au clavier sans effet'); else etapes.push('produit ajouté au ticket (Entrée)'); const g = await focus(); if (!g) note('focus perdu après l’ajout au ticket'); else etapes.push(`focus après ajout : « ${g.texte} »`); }
    f = await tab(x => x.action === 'encaisser', 60, 'bouton Encaisser');
    if (f) { await p.keyboard.press('Enter'); await p.waitForTimeout(1200); const t = await p.locator('#toast').innerText().catch(() => ''); if (!/encaissée/.test(t)) note('encaissement au clavier', t); else etapes.push(`encaissement : « ${t.slice(0, 50)} »`); const annonce = await p.evaluate(() => { const t = document.getElementById('toast'); return t && (t.getAttribute('role') || t.getAttribute('aria-live')); }); if (!annonce) note('message de confirmation non annoncé (toast sans role/aria-live)'); const g = await focus(); if (!g) note('focus perdu après l’encaissement'); }
    // Commandes
    await p.goto(B + '/app?v=3#commandes'); await p.waitForTimeout(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    f = await tab(x => x.action === 'ouvrir-commande', 200, 'ligne de commande');
    if (f) {
      await p.keyboard.press('Enter'); await p.waitForTimeout(400);
      const g = await focus(), panneau = await p.locator('.maitre-detail.ouvert, [data-detail], .detail-commande').count();
      if (!panneau) note('détail de commande non ouvert au clavier'); else etapes.push('commande ouverte (Entrée)');
      if (!g || !(await p.evaluate(() => !!document.activeElement.closest('.detail, .detail-commande, aside, [role=dialog], .panneau')))) note('focus pas déplacé dans le détail de la commande', JSON.stringify(g));
      else etapes.push(`focus dans le détail : « ${g.texte} »`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      const g2 = await focus(); if (!g2) note('Échap : focus perdu à la fermeture du détail'); else etapes.push(`Échap : focus rendu à « ${g2.texte} »`);
    }
    // Devis
    await p.goto(B + '/app?v=4#devis'); await p.waitForTimeout(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    f = await tab(x => x.action === 'devis-nouveau', 200, 'bouton Nouveau devis');
    if (f) { await p.keyboard.press('Enter'); await p.waitForTimeout(400); const g = await focus(); if (!g || g.dataset.dv !== 'client.raison') note('focus pas sur le premier champ du devis', JSON.stringify(g)); else etapes.push('nouveau devis : focus sur « Raison sociale »'); }
    // Retour partiel et geste commercial, au clavier : ouverture, calcul, confirmation, focus à chaque étape.
    const cmd = await p.evaluate(async () => {
      const j = (m, u, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
      const e = await j('GET', '/api/admin/etat');
      const c = await j('POST', `/api/public/${e.serveur.slug}/commandes`, { lignes: [{ produitId: e.produits[0].id, qte: 2 }], livraison: 'poste-eco', client: { nom: 'Lou', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } });
      await fetch(c.paiementUrl.replace(/^https?:\/\/[^/]+/, '') + '/confirmer', { method: 'POST', redirect: 'manual' });
      return c;
    });
    await p.goto(B + '/app?v=5#commandes'); await p.waitForTimeout(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    f = await tab(x => x.action === 'ouvrir-commande' && x.dataset.id === cmd.commandeId, 200, 'commande payée à rembourser');
    if (f) {
      await p.keyboard.press('Enter'); await p.waitForTimeout(400);
      f = await tab(x => x.action === 'retour-partiel-ouvrir' && !x.dataset.mode, 80, 'bouton Retour partiel');
      if (f) {
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        let g = await focus();
        if (!g || g.tag !== 'input') note('retour partiel : focus pas sur la première quantité', JSON.stringify(g)); else etapes.push('retour partiel : focus sur la première quantité');
        await p.keyboard.press('Control+A'); await p.keyboard.type('1');
        f = await tab(x => x.tag === 'button' && /Calculer/.test(x.texte), 20, 'bouton Calculer');
        if (f) {
          await p.keyboard.press('Enter'); await p.waitForTimeout(600); g = await focus();
          if (!g || !/^Rembourser/.test(g.texte)) note('retour partiel : focus pas sur la confirmation après le calcul', JSON.stringify(g));
          else { etapes.push(`retour partiel : focus sur « ${g.texte} »`); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); const t = await p.locator('#toast').innerText().catch(() => ''); if (!/Retour partiel remboursé/.test(t)) note('retour partiel au clavier', t); else etapes.push('retour partiel confirmé au clavier'); const apres = await focus(); if (!apres) note('retour partiel : focus perdu après la confirmation'); else etapes.push(`après confirmation, focus sur « ${String(apres.texte).slice(0, 40)} »`); }
        }
      }
      // Geste commercial : ouverture, puis Annuler rend le focus au bouton du geste.
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      if (!(await p.locator('[data-action="retour-partiel-ouvrir"][data-mode="geste"]').count())) { await p.locator(`[data-action="ouvrir-commande"][data-id="${cmd.commandeId}"]`).first().click(); await p.waitForTimeout(400); await p.evaluate(() => document.activeElement && document.activeElement.blur()); }
      f = await tab(x => x.action === 'retour-partiel-ouvrir' && x.dataset.mode === 'geste', 120, 'bouton Geste commercial');
      if (f) {
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        const g = await focus(); if (!g || g.tag !== 'input') note('geste : focus pas sur le montant', JSON.stringify(g)); else etapes.push('geste : focus sur le montant');
        f = await tab(x => x.action === 'retour-partiel-fermer', 20, 'bouton Annuler du geste');
        if (f) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); const h = await focus(); if (!h || h.dataset.mode !== 'geste') note('geste : focus pas rendu au bouton du geste après Annuler', JSON.stringify(h)); else etapes.push('geste : Annuler rend le focus au bouton'); }
      }
    }
  } finally { await br.close(); srv.kill(); for (const x of [base, base + '-wal', base + '-shm']) fs.rmSync(x, { force: true }); }
  console.log(JSON.stringify({ etapes, problemes: [...new Set(problemes)], erreursJs: erreurs }, null, 1));
  process.exit(problemes.length || erreurs.length ? 1 : 0);
})();
