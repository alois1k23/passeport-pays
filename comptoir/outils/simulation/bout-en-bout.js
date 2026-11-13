// Essai de bout en bout « comme en production », avec de faux services externes (faux-services.js) :
// le vrai serveur (server.js, NODE_ENV=production, clés Stripe et Brevo définies) et un vrai navigateur.
// Parcours : abonnement des marchands, activation des paiements (Connect), ventes sur le compte de chaque boutique,
// TWINT et Bancontact, fournisseur réel (contrat du README), remboursement, litige, carte refusée, webhooks en double,
// panne du service d'e-mail, renouvellement, impayé, changement de formule, résiliation, redémarrage du serveur.
// Usage : node outils/simulation/bout-en-bout.js
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { creerFauxServices } = require('./faux-services');

const anomalies = [], etapes = [];
const note = (quoi, detail = '') => { anomalies.push({ quoi, detail: String(detail).slice(0, 300) }); console.log('  ✗', quoi, detail ? `— ${String(detail).slice(0, 160)}` : ''); };
const ok = quoi => { etapes.push(quoi); console.log('  ✓', quoi); };
const verifier = (cond, quoi, detail) => cond ? ok(quoi) : note(quoi, detail);
const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(f, ms = 8000) { const fin = Date.now() + ms; while (Date.now() < fin) { const v = await f(); if (v) return v; await attendre(150); } return null; }

(async () => {
  const PORT = 3400 + Math.floor(Math.random() * 400), B = `http://127.0.0.1:${PORT}`;
  const base = path.join(os.tmpdir(), `comptoir-e2e-${process.pid}.db`);
  const secrets = { secretWebhook: 'whsec_plateforme_essai', secretWebhookConnect: 'whsec_connect_essai', secretFournisseur: 'secret-fournisseur-essai', cleFournisseur: 'cle-fournisseur-essai' };
  const faux = creerFauxServices({ urlComptoir: B, ...secrets, journal: e => note('faux service en erreur', e.message) });
  const F = await faux.demarrer();
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(PORT), URL_PUBLIQUE: B, BASE_DE_DONNEES: base, SAUVEGARDE: 'non', TZ: 'Europe/Zurich',
    STRIPE_SECRET_KEY: 'sk_live_essai', STRIPE_WEBHOOK_SECRET: secrets.secretWebhook, STRIPE_CONNECT_WEBHOOK_SECRET: secrets.secretWebhookConnect, STRIPE_API_URL: F,
    BREVO_API_KEY: 'cle-brevo-essai', BREVO_API_URL: F, EMAIL_EXPEDITEUR: 'Comptoir <envoi@comptoir.example>', EMAIL_INTERVALLE_MS: '400', AUTO_INTERVALLE_MS: '1000', SOCIAL_INTERVALLE_MS: '1000',
    FOURNISSEUR_URL_API: `${F}/fournisseur`, FOURNISSEUR_CLE_API: secrets.cleFournisseur, FOURNISSEUR_SECRET_WEBHOOK: secrets.secretFournisseur, FOURNISSEUR_NOM: 'Fournisseur partenaire',
    VERIFIER_FUITES: 'non', EXPLOITANT_NOM: 'Comptoir Sàrl (essai)', EXPLOITANT_ADRESSE: 'Rue de Bourg 1, 1003 Lausanne', EXPLOITANT_EMAIL: 'contact@comptoir.example', EXPLOITANT_IDE: 'CHE-000.000.000', HEBERGEUR: 'Hébergeur (essai), Genève' };
  let serveur, journalServeur = '';
  const demarrerServeur = () => new Promise(okD => {
    serveur = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '../../server/server.js')], { env });
    serveur.stdout.on('data', d => { journalServeur += d; if (/écoute/.test(d)) okD(); });
    serveur.stderr.on('data', d => { journalServeur += d; });
  });
  await demarrerServeur();
  console.log(`Comptoir (production, faux services) sur ${B}`);
  const navigateur = await chromium.launch();

  /* Un marchand : inscription, choix de formule, paiement sur la page Stripe, fiche entreprise, activation des paiements */
  async function nouveauMarchand({ email, pays, formule, nom, adresse }) {
    const ctx = await navigateur.newContext(); const p = await ctx.newPage();
    p.on('pageerror', e => note(`erreur JavaScript (${nom})`, e.message));
    await p.goto(`${B}/`);
    verifier(await p.locator('text=Croissance').first().isVisible(), `accueil public avec les formules (${nom})`);
    await p.goto(`${B}/app?formule=${formule}`);
    const api = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; }, [m, u, b]);
    const ins = await api('POST', '/api/auth/inscription', { email, motDePasse: 'un mot de passe solide', config: { boutique: { nom, pays, secteur: 'maison', sections: [] }, entreprise: { raison: nom, adresse, email: `contact@${nom.toLowerCase().replace(/\W/g, '')}.example`, telephone: '+41 21 000 00 00', regime: pays === 'ch' ? 'ch-non' : 'franchise' } },
      produits: [{ nom: 'Vase en grès', prix: 45, cout: 12, stock: 10, type: 'stock' }] });
    if (ins.s !== 201) { note(`inscription refusée (${nom})`, JSON.stringify(ins.j)); return null; }
    await p.goto(`${B}/app`); await p.waitForSelector('[data-abo="payer"]', { timeout: 8000 });
    await p.check(`input[data-abo="formule"][value="${formule}"]`).catch(() => {});
    await p.click('[data-abo="payer"]');
    await p.waitForURL(/\/checkout\//, { timeout: 8000 });
    verifier(/Abonnement Comptoir/.test(await p.content()), `page de paiement Stripe de l’abonnement (${nom})`);
    await p.click('#payer');
    await p.waitForURL(/abonnement=ok|#tableau/, { timeout: 10000 });
    await p.waitForSelector('#nav a', { timeout: 10000 }).catch(() => {});
    const ab = await api('GET', '/api/abonnement');
    verifier(ab.j && ab.j.actif && ab.j.formule === formule && ab.j.statut === 'actif', `abonnement ${formule} actif après paiement, espace ouvert (${nom})`, JSON.stringify(ab.j));
    // Activation des paiements de la boutique (compte Stripe Express)
    await p.evaluate(() => { location.hash = 'parametres'; }); await p.waitForTimeout(300);
    await p.evaluate(() => { ui.sectionParam = 'paiements'; rendre(); });
    const bouton = p.locator('[data-action="activer-paiements"]');
    verifier(await bouton.isVisible(), `bouton « Activer les paiements » proposé (${nom})`);
    const pub0 = await api('GET', `/api/public/${ins.j.slug}`);
    verifier(pub0.j && pub0.j.paiementsActifs === false, `boutique annoncée « paiements bientôt » avant activation (${nom})`);
    // Adresse pas encore confirmée : les versements sont refusés, avec la marche à suivre ; puis le marchand ouvre le lien reçu.
    await bouton.click(); await p.waitForTimeout(500);
    verifier(/Confirmez d’abord votre adresse/.test(await p.textContent('#toast')), `versements refusés tant que l’adresse n’est pas confirmée (${nom})`, await p.textContent('#toast'));
    await jusqua(() => emailsA(email, /^Confirmez/).length, 5000);
    const lienVerif = (emailsA(email, /^Confirmez/).at(-1).texte.match(/https?:\S+verifier-email=[\w-]+/) || [])[0];
    verifier(!!lienVerif, `e-mail de confirmation de l’adresse reçu (${nom})`);
    await p.goto(lienVerif); await p.waitForTimeout(1200);
    verifier((await api('GET', '/api/session')).j.emailVerifie === true, `adresse confirmée par le lien (${nom})`);
    await p.evaluate(() => { location.hash = 'parametres'; }); await p.waitForTimeout(300);
    await p.evaluate(() => { ui.sectionParam = 'paiements'; rendre(); });
    await p.locator('[data-action="activer-paiements"]').click();
    await p.waitForURL(/\/connect\//, { timeout: 8000 });
    await p.click('#valider');
    await p.waitForURL(/section=paiements/, { timeout: 8000 });
    await p.waitForTimeout(800);
    const e = await api('GET', '/api/admin/paiements/etat');
    verifier(e.j && e.j.pret, `paiements de la boutique actifs après l’activation Stripe (${nom})`, JSON.stringify(e.j));
    return { p, ctx, api, slug: ins.j.slug, nom, pays, formule, email };
  }

  /* Un client : commande sur la boutique, paiement sur la page Stripe de la boutique */
  async function commander(m, { produit = 'Vase en grès', qte = 1, payer = true, livraison } = {}) {
    const ctx = await navigateur.newContext(); const p = await ctx.newPage();
    p.on('pageerror', e => note('erreur JavaScript (boutique)', e.message));
    await p.goto(`${B}/s/${m.slug}`);
    const r = await p.evaluate(async ([slug, produit, qte, livraison]) => {
      const pub = await (await fetch(`/api/public/${slug}`)).json();
      const pr = pub.produits.find(x => x.nom === produit);
      const rep = await fetch(`/api/public/${slug}/commandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes: [{ produitId: pr.id, qte }], livraison: livraison || Object.keys(pub.livraisons)[0], client: { nom: 'Léa Client', email: `client${Math.floor(Math.random() * 1e9)}@exemple.ch`, adresse: 'Rue 1', npa: '1003', ville: 'Lausanne' } }) });
      return { s: rep.status, j: await rep.json() };
    }, [m.slug, produit, qte, livraison]);
    if (r.s !== 201) { await ctx.close(); return { refus: r }; }
    await p.goto(r.j.paiementUrl);
    let paye = false;
    if (payer) { await p.click('#payer'); await p.waitForTimeout(600); paye = !/Carte refusée/.test(await p.content()); }
    const st = await (await fetch(`${B}/api/public/${m.slug}/commandes/${r.j.commandeId}?jeton=${r.j.jeton}`)).json();
    await ctx.close();
    return { id: r.j.commandeId, jeton: r.j.jeton, paye, statut: st.statut, total: r.j.total };
  }
  const derniereSession = () => Object.values(faux.pilote.etat.sessions).filter(s => s.mode === 'payment').pop();
  const emailsA = (dest, re) => faux.pilote.etat.emails.filter(e => (!dest || e.a === dest) && (!re || re.test(e.sujet)));

  console.log('\n— Marchands —');
  const A = await nouveauMarchand({ email: 'atelier@exemple.ch', pays: 'ch', formule: 'croissance', nom: 'Atelier Léman', adresse: 'Rue du Lac 12, 1003 Lausanne' });
  const Bm = await nouveauMarchand({ email: 'maison@exemple.be', pays: 'be', formule: 'lancement', nom: 'Maison Bruxelles', adresse: 'Rue Neuve 3, 1000 Bruxelles' });
  if (!A || !Bm) { console.log(JSON.stringify({ anomalies, journal: journalServeur.slice(-2000) }, null, 1)); process.exit(1); }

  console.log('\n— Ventes sur le compte de chaque boutique —');
  const c1 = await commander(A);
  const s1 = derniereSession();
  verifier(c1.paye && c1.statut === 'payee', 'commande payée sur la page Stripe, confirmée au retour du client', JSON.stringify(c1));
  verifier(s1 && s1.compte && faux.pilote.etat.comptes[s1.compte], 'paiement créé sur le compte Stripe de la boutique (pas sur celui de la plateforme)', s1 && s1.compte);
  verifier(s1 && s1.moyens.join() === 'card', 'TWINT non proposé tant que Stripe ne l’a pas validé pour la boutique', s1 && s1.moyens.join());
  await faux.pilote.activerTwint(s1.compte); await attendre(300);
  await commander(A, { payer: false });
  verifier(derniereSession().moyens.includes('twint'), 'TWINT proposé une fois validé par Stripe');
  await commander(Bm, { livraison: 'bpost' });
  verifier(derniereSession().moyens.includes('bancontact'), 'Bancontact proposé à la boutique belge');
  verifier(faux.pilote.etat.appelsStripe.every(a => a.version === '2024-06-20'), 'version d’API Stripe figée sur tous les appels', [...new Set(faux.pilote.etat.appelsStripe.map(a => a.version))].join());
  verifier(!Object.values(faux.pilote.etat.sessions).some(s => s.mode === 'payment' && !s.compte), 'aucune vente encaissée sur le compte de la plateforme');

  console.log('\n— Webhooks en double, carte refusée —');
  faux.pilote.etat.doublerWebhooks = true;
  const c2 = await commander(A);
  faux.pilote.etat.doublerWebhooks = false;
  await jusqua(() => emailsA(null, new RegExp(`n° \\d+ confirmée`)).length >= 3, 6000);
  const confirmations = faux.pilote.etat.emails.filter(e => / confirmée$/.test(e.sujet));
  verifier(new Set(confirmations.map(e => e.sujet + e.a)).size === confirmations.length, 'webhook reçu deux fois : une seule confirmation au client', confirmations.map(e => e.sujet).join(' | '));
  faux.pilote.etat.refusCarte = true;
  const c3 = await commander(A);
  faux.pilote.etat.refusCarte = false;
  verifier(!c3.paye && c3.statut === 'attente', 'carte refusée : commande non payée, rien d’encaissé', JSON.stringify(c3));

  console.log('\n— Fournisseur réel (contrat du README) —');
  const cat = await A.api('GET', '/api/admin/catalogue');
  verifier(cat.j && cat.j.fournisseur === 'Fournisseur partenaire' && cat.j.produits.length === 2, 'catalogue du vrai fournisseur affiché au marchand', JSON.stringify(cat.j).slice(0, 120));
  const imp = await A.api('POST', '/api/admin/produits/import', { source: 'FR-LAMPE-01' });
  verifier(imp.s === 201, 'produit du fournisseur importé', JSON.stringify(imp.j));
  const pubA = await A.api('GET', `/api/public/${A.slug}`);
  verifier(pubA.j.produits.some(x => x.nom === 'Lampe en lin'), 'produit du fournisseur réel vendable avec une clé Stripe réelle');
  const c4 = await commander(A, { produit: 'Lampe en lin' });
  const cmdF = await jusqua(() => Object.entries(faux.pilote.etat.commandesFournisseur)[0], 6000);
  verifier(cmdF && cmdF[1].cle, 'commande transmise automatiquement au fournisseur, avec clé d’idempotence', cmdF && cmdF[1].cle);
  const sw = cmdF && await faux.pilote.expedierFournisseur(cmdF[0]);
  verifier(sw === 200, 'webhook d’expédition du fournisseur accepté (signature vérifiée)', sw);
  const ex = await A.api('GET', '/api/admin/etat');
  const c4s = ex.j.commandes.find(x => x.id === c4.id);
  verifier(c4s && c4s.statut === 'expediee' && c4s.suivi, 'commande expédiée avec le numéro de suivi du fournisseur', JSON.stringify(c4s && { statut: c4s.statut, suivi: c4s.suivi }));
  await jusqua(() => emailsA(null, /est en route/).length, 5000);
  verifier(emailsA(null, /est en route/).length >= 1, 'e-mail d’expédition envoyé au client (par Brevo)');

  console.log('\n— Remboursement, litige —');
  const rb = await A.api('POST', `/api/admin/commandes/${c2.id}/statut`, { statut: 'remboursee' });
  verifier(rb.s === 200 && faux.pilote.etat.remboursements.length === 1 && faux.pilote.etat.remboursements[0].compte === s1.compte, 'remboursement exécuté par Stripe sur le compte de la boutique', JSON.stringify(faux.pilote.etat.remboursements));
  const pi1 = Object.entries(faux.pilote.etat.intents).find(([, v]) => v.session === s1.id)[0];
  verifier(await faux.pilote.litige(pi1) === 200, 'webhook de litige accepté');
  await jusqua(() => emailsA('atelier@exemple.ch', /Litige/).length, 5000);
  verifier(emailsA('atelier@exemple.ch', /Litige/).length === 1, 'marchand prévenu du litige par e-mail, avec l’échéance');
  const litigeEtat = await A.api('GET', '/api/admin/etat');
  verifier(litigeEtat.j.commandes.find(x => x.id === c1.id).litige, 'litige visible sur la commande');

  console.log('\n— Panne du service d’e-mail —');
  faux.pilote.etat.panneEmail = true;
  const c5 = await commander(A);
  await attendre(2500);
  const avant = faux.pilote.etat.emails.length;
  faux.pilote.etat.panneEmail = false;
  console.log('  … attente du nouvel essai (1 minute après l’échec)');
  const recu = await jusqua(() => faux.pilote.etat.emails.length > avant && faux.pilote.etat.emails.some(e => e.sujet.includes('confirmée') && e.texte.includes(String(c5.total).replace('.', ','))), 80000);
  verifier(recu, 'e-mails en échec pendant la panne, envoyés ensuite (aucun perdu)');

  console.log('\n— Abonnements : renouvellement, impayé, changement de formule, résiliation —');
  const subA = Object.values(faux.pilote.etat.abonnements).find(s => faux.pilote.etat.clients[s.customer] && faux.pilote.etat.clients[s.customer].email === 'atelier@exemple.ch') || Object.values(faux.pilote.etat.abonnements)[0];
  const finAvant = (await A.api('GET', '/api/abonnement')).j.periodeFin;
  await faux.pilote.renouveler(subA.id); await attendre(500);
  const apres = (await A.api('GET', '/api/abonnement')).j;
  verifier(apres.actif && apres.periodeFin > finAvant, 'renouvellement payé (facture au format récent, ligne de prorata en premier) : période prolongée', JSON.stringify({ finAvant, apres: apres.periodeFin }));
  await faux.pilote.renouveler(subA.id, { refus: true }); await attendre(500);
  const imp2 = (await A.api('GET', '/api/abonnement')).j;
  verifier(imp2.statut === 'impaye' && imp2.actif && imp2.periodeFin === apres.periodeFin, 'renouvellement refusé : « impayé », accès gardé pendant le délai, sans mois offert', JSON.stringify(imp2));
  await jusqua(() => emailsA('atelier@exemple.ch', /Paiement de votre abonnement en échec/).length, 5000);
  verifier(emailsA('atelier@exemple.ch', /en échec/).length === 1, 'marchand prévenu de l’impayé');
  await faux.pilote.renouveler(subA.id); await attendre(500);
  verifier((await A.api('GET', '/api/abonnement')).j.statut === 'actif', 'paiement régularisé : abonnement de nouveau actif');
  const subB = Object.values(faux.pilote.etat.abonnements).find(s => s.id !== subA.id);
  const pubLancement = await Bm.api('GET', `/api/public/${Bm.slug}`);
  verifier(pubLancement.j.offres.paliersActifs === false, 'formule Lancement : remises par quantité éteintes sur la boutique', JSON.stringify(pubLancement.j.offres));
  const up = await Bm.api('POST', '/api/abonnement/changer', { formule: 'croissance' });
  verifier(up.s === 200 && faux.pilote.etat.abonnements[subB.id].montant === 5900, 'passage à Croissance : prix changé chez Stripe', JSON.stringify(up.j));
  verifier(faux.pilote.etat.appelsStripe.some(a => a.methode === 'POST' && a.chemin === `subscriptions/${subB.id}`), 'souscription modifiée par l’API (pas de seconde souscription)');
  const pubB = await Bm.api('GET', `/api/public/${Bm.slug}`);
  verifier(pubB.j.offres.paliersActifs === true, 'formule Croissance appliquée tout de suite : remises par quantité actives', JSON.stringify(pubB.j.offres));
  const res = await Bm.api('POST', '/api/abonnement/resilier');
  verifier(res.s === 200 && faux.pilote.etat.abonnements[subB.id].cancel === true, 'résiliation demandée à Stripe pour la fin de la période (pas immédiate)', JSON.stringify(res.j));
  await jusqua(() => emailsA('maison@exemple.be', /Résiliation enregistrée/).length, 5000);
  verifier(emailsA('maison@exemple.be', /Résiliation enregistrée/).length === 1, 'e-mail de résiliation envoyé une fois');
  verifier((await Bm.api('GET', '/api/abonnement')).j.actif, 'boutique résiliée toujours ouverte jusqu’à la fin du mois payé');

  console.log('\n— Redémarrage du serveur —');
  const nAvant = (await A.api('GET', '/api/admin/etat')).j.commandes.length;
  serveur.kill(); await attendre(500); await demarrerServeur();
  const apresRedem = await A.api('GET', '/api/admin/etat');
  verifier(apresRedem.s === 200 && apresRedem.j.commandes.length === nAvant, 'après redémarrage : session et commandes intactes', `${apresRedem.s}, ${apresRedem.j && apresRedem.j.commandes.length}/${nAvant}`);
  const c6 = await commander(A);
  verifier(c6.paye && c6.statut === 'payee', 'vente après redémarrage');

  console.log('\n— E-mails reçus —');
  const tous = faux.pilote.etat.emails;
  verifier(tous.every(e => !/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(e.sujet + e.texte)), 'aucun texte indéfini dans les e-mails', tous.find(e => /undefined|NaN|null/.test(e.texte))?.sujet);
  verifier(tous.filter(e => / confirmée$/.test(e.sujet)).every(e => e.repondreA), 'réponses des clients dirigées vers le marchand (Reply-To)');
  verifier(tous.every(e => !/Comptoir Sàrl/.test(e.de && e.de.name || '')), 'e-mails des boutiques envoyés au nom de la boutique');
  const pagesLegales = await (await fetch(`${B}/mentions-legales`)).text();
  verifier(/Comptoir Sàrl \(essai\)/.test(pagesLegales) && /Hébergeur/.test(pagesLegales), 'mentions légales de la plateforme avec l’identité de l’exploitant');
  verifier(!/\[erreur\]|TypeError|ReferenceError/.test(journalServeur), 'journal du serveur sans erreur de programme', journalServeur.match(/.*(\[erreur\]|TypeError|ReferenceError).*/)?.[0]);

  await navigateur.close(); serveur.kill(); faux.serveur.close();
  try { for (const s of ['', '-wal', '-shm']) fs.rmSync(base + s, { force: true }); } catch { /* ignoré */ }
  console.log(`\n${etapes.length} contrôles réussis, ${anomalies.length} anomalie(s).`);
  if (anomalies.length) console.log(JSON.stringify(anomalies, null, 1));
  console.log(`E-mails envoyés par le faux Brevo : ${tous.length} · appels au faux Stripe : ${faux.pilote.etat.appelsStripe.length} · webhooks : ${faux.pilote.etat.webhooks.length}`);
  process.exit(anomalies.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
