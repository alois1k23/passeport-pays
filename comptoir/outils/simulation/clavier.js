// Parcours d'achat entièrement au clavier, dans un vrai navigateur : vitrine, ajout au panier, panier (fenêtre),
// livraison, coordonnées, paiement, confirmation. À chaque étape : le focus est visible, reste dans la fenêtre ouverte,
// revient au bon endroit à la fermeture, et chaque changement important est annoncé (zone « status » ou « alert »).
// Usage : node outils/simulation/clavier.js  (démarre son propre serveur)
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const { chromium } = require('playwright');

const portLibre = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const problemes = [], etapes = [];
const note = (quoi, detail = '') => problemes.push(`${quoi}${detail ? ` : ${detail}` : ''}`);

(async () => {
  const port = await portLibre(), B = `http://127.0.0.1:${port}`, base = path.join(os.tmpdir(), `comptoir-clavier-${process.pid}.db`);
  const srv = spawn(process.execPath, [path.join(__dirname, '../../server/server.js')], { env: { ...process.env, PORT: String(port), BASE_DE_DONNEES: base, SAUVEGARDE: 'non', URL_PUBLIQUE: B, LIMITE_ESSAIS: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(ok => srv.stdout.on('data', d => { if (String(d).includes('écoute')) ok(); }));
  const br = await chromium.launch(); const p = await br.newPage();
  const erreurs = []; p.on('pageerror', e => erreurs.push(e.message));
  try {
    await p.goto(B);
    await p.evaluate(b => fetch('/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }), { email: 'clavier@exemple.fr', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Clavier', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Clavier SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal', email: 'c@exemple.fr' } }, produits: [{ nom: 'Vase bleu', prix: 40, stock: 5, type: 'stock' }, { nom: 'Bougie', prix: 15, stock: 5, type: 'stock' }] });
    await p.context().clearCookies();
    await p.goto(`${B}/s/clavier`); await p.waitForTimeout(800);
    // Bandeau de cookies : se ferme au clavier.
    const focus = () => p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); return { tag: e.tagName.toLowerCase(), texte: (e.getAttribute('aria-label') || e.innerText || e.value || e.name || '').trim().slice(0, 50), visible, dansDialogue: !!e.closest('[role=dialog][aria-modal=true]'), attrs: { sf: e.dataset.sf, c: e.dataset.c, id: e.id, name: e.name } }; });
    // Tabulation jusqu'à un élément, en vérifiant le focus visible sur le chemin.
    const tabJusqua = async (cond, max = 60, quoi = '') => {
      for (let i = 0; i < max; i++) {
        await p.keyboard.press('Tab'); const f = await focus();
        if (f && !f.visible) note('focus invisible', `${f.tag} « ${f.texte} »`);
        if (f && cond(f)) return f;
      }
      note('élément introuvable au clavier', quoi); return null;
    };
    if (await p.locator('.bandeau-cookies, [data-c="cookies-refuser"], button:has-text("Refuser")').count()) {
      const f = await tabJusqua(f => /Refuser/.test(f.texte), 80, 'bouton « Refuser » des cookies'); if (f) await p.keyboard.press('Enter');
      etapes.push('bandeau de cookies refusé au clavier');
    }
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    let f = await tabJusqua(f => f.attrs.sf === 'ajouter', 80, 'bouton « Ajouter au panier »');
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    const annonce = await p.evaluate(() => [...document.querySelectorAll('[role=status], [aria-live]')].map(e => e.innerText.trim()).filter(Boolean).join(' | '));
    if (!annonce) note('ajout au panier non annoncé (aucune zone status ou aria-live remplie)'); else etapes.push(`ajout annoncé : « ${annonce.slice(0, 80)} »`);
    // Le panier s'ouvre-t-il, avec le focus dedans ?
    f = await focus();
    if (!f || !f.dansDialogue) {
      const g = await tabJusqua(x => /panier/i.test(x.texte) || x.attrs.sf === 'panier' || x.attrs.c === 'ouvrir', 80, 'bouton du panier');
      if (g) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
    }
    f = await focus();
    if (!f || !f.dansDialogue) note('focus hors de la fenêtre du panier à son ouverture', JSON.stringify(f)); else etapes.push(`panier ouvert, focus sur « ${f.texte} »`);
    // Piège du focus : 40 tabulations restent dans la fenêtre.
    let sorti = false; for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); const x = await focus(); if (x && !x.dansDialogue) { sorti = true; note('le focus sort de la fenêtre du panier', x.texte); break; } }
    if (!sorti) etapes.push('focus maintenu dans la fenêtre du panier (40 tabulations)');
    // Quantité + au clavier
    f = await tabJusqua(x => x.attrs.c === 'qte' && /Ajouter/.test(x.texte), 40, 'bouton « + » de quantité');
    if (f) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); const q = await p.locator('.qte b').first().innerText(); if (q !== '2') note('quantité non modifiée au clavier', q); else etapes.push('quantité passée à 2 au clavier'); const g = await focus(); if (!g || g.attrs.c !== 'qte') note('focus perdu après le changement de quantité', JSON.stringify(g)); }
    // Livraison : flèches dans le groupe de boutons radio.
    f = await tabJusqua(x => x.tag === 'input' && x.attrs.name === 'livraison', 40, 'choix de livraison');
    if (f) { await p.keyboard.press('Space'); await p.waitForTimeout(200); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300); const v = await p.evaluate(() => document.querySelector('input[name=livraison]:checked')?.value); if (!v) note('livraison non choisie au clavier'); else etapes.push(`livraison choisie aux flèches : ${v}`); const g = await focus(); if (!g || g.attrs.name !== 'livraison') note('focus perdu après le choix de livraison', JSON.stringify(g)); }
    // Formulaire : envoi vide → erreurs reliées aux champs ?
    f = await tabJusqua(x => x.attrs.name === 'nom', 40, 'champ « Nom »');
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    const invalide = await p.evaluate(() => { const e = document.activeElement; return { nom: e && e.name, invalide: e && e.matches(':invalid') }; });
    if (!invalide.invalide) note('envoi vide : le premier champ requis ne reçoit pas le focus', JSON.stringify(invalide)); else etapes.push('envoi vide : focus sur le premier champ requis');
    const saisir = async (nom, valeur) => { const g = await focus(); if (!g || g.attrs.name !== nom) { const h = await tabJusqua(x => x.attrs.name === nom, 20, `champ ${nom}`); if (!h) return; } await p.keyboard.type(valeur); };
    await saisir('nom', 'Alex Clavier'); await p.keyboard.press('Tab'); await saisir('email', 'alex@exemple.fr'); await p.keyboard.press('Tab');
    await saisir('adresse', '3 rue Haute'); await p.keyboard.press('Tab'); await saisir('npa', '69002'); await p.keyboard.press('Tab'); await saisir('ville', 'Lyon');
    f = await tabJusqua(x => x.tag === 'button' && /Payer/.test(x.texte), 20, 'bouton « Payer »');
    if (f) { await p.keyboard.press('Enter'); await p.waitForURL(/paiement-simule/, { timeout: 5000 }).catch(() => note('pas de passage au paiement')); }
    if (/paiement-simule/.test(p.url())) {
      etapes.push('passage au paiement');
      const g = await tabJusqua(x => x.tag === 'button' && /Payer/.test(x.texte), 20, 'bouton de paiement'); if (g) await p.keyboard.press('Enter');
      await p.waitForURL(/commande=/, { timeout: 5000 }).catch(() => note('pas de retour sur la boutique après paiement'));
      await p.waitForTimeout(1500);
      const conf = await p.evaluate(() => ({ titre: document.activeElement && document.activeElement.innerText, texte: (document.querySelector('.tiroir-corps') || document.body).innerText.slice(0, 200) }));
      if (!/Paiement reçu|Merci/.test(conf.texte)) note('confirmation absente', conf.texte); else etapes.push('confirmation affichée');
      const g2 = await focus(); if (!g2 || !g2.dansDialogue) note('focus hors de la confirmation après le paiement', JSON.stringify(g2)); else etapes.push(`focus sur la confirmation (« ${g2.texte} »)`);
      // Échap ferme la fenêtre ; le focus revient dans la page.
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      const ouvert = await p.locator('.tiroir.ouvert').count(), g3 = await focus();
      if (ouvert) note('Échap ne ferme pas la fenêtre'); else etapes.push('Échap ferme la fenêtre');
      if (!g3) note('focus perdu (sur la page entière) après la fermeture'); else etapes.push(`focus rendu à « ${g3.texte} »`);
    }
  } finally { await br.close(); srv.kill(); for (const x of [base, base + '-wal', base + '-shm']) fs.rmSync(x, { force: true }); }
  console.log(JSON.stringify({ etapes, problemes, erreursJs: erreurs }, null, 1));
  process.exit(problemes.length || erreurs.length ? 1 : 0);
})();
