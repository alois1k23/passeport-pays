// Un mois d'exploitation en accéléré : 100 marchands arrivent sur Comptoir (formules et pays variés),
// créent leur boutique, vendent pendant 30 jours, changent de formule, résilient, sont renouvelés.
// Le vrai code du serveur tourne dans ce processus avec une horloge virtuelle (30 jours en quelques minutes).
// Après chaque journée et à la fin, des invariants sont vérifiés, côté marchands, côté acheteurs et côté exploitant.
// Usage : node outils/simulation/mois.js [nombre de marchands=100] [jours=60] [départ AAAA-MM-JJ]
'use strict';

/* Horloge virtuelle (avant de charger le serveur) */
const DateReelle = Date;
// Date de départ (4e argument, AAAA-MM-JJ) : par ex. 2026-12-20 pour passer le Nouvel An, 2027-03-20 pour le passage à l'heure d'été.
let T = process.argv[4] ? DateReelle.parse(process.argv[4] + 'T07:00:00Z') : DateReelle.UTC(2026, 10, 12, 7, 0, 0);
class DateVirtuelle extends DateReelle {
  constructor(...a) { if (a.length) super(...a); else super(T); }
  static now() { return T; }
}
global.Date = DateVirtuelle;
const JOUR = 86400000, HEURE = 3600000;

const http = require('node:http');
const path = require('node:path');
const S = path.join(__dirname, '../../server/src/');
const { ouvrir } = require(S + 'db');
const { creerApp } = require(S + 'app');

const N = Number(process.argv[2] || 100), JOURS = Number(process.argv[3] || 60);
const anomalies = [];
const note = (qui, quoi, detail = '') => { anomalies.push({ jour: Math.floor((T - DEBUT) / JOUR), qui, quoi, detail: String(detail).slice(0, 220) }); };
const DEBUT = T;
let graine = 42; const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
const choix = arr => arr[Math.floor(hasard() * arr.length)];
const durees = [];

(async () => {
  // Vraie base sur disque : le serveur est redémarré au milieu de la période (rien ne doit se perdre).
  const fichier = path.join(require('node:os').tmpdir(), `comptoir-mois-${process.pid}.db`);
  let db = ouvrir(fichier);
  const silencieux = { log() {}, error(...a) { erreursServeur.push(a.join(' ').slice(0, 200)); } };
  const erreursServeur = [];
  const serveur = http.createServer();
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const ENV = { DEMO_DELAI_EXPEDITION_MS: '10', LIMITE_ESSAIS: '10' };
  let gerer = creerApp({ db, env: ENV, urlPublique: base, journal: silencieux });
  serveur.on('request', gerer);
  async function redemarrer() {
    await new Promise(ok => setTimeout(ok, 200));
    serveur.removeAllListeners('request'); db.close();
    db = ouvrir(fichier); gerer = creerApp({ db, env: ENV, urlPublique: base, journal: silencieux }); serveur.on('request', gerer);
  }
  const desinscrits = new Map(), effaces = [], supprimes = [];

  let ipSuivante = 1;
  function client(ip = `10.${Math.floor(ipSuivante / 250)}.${ipSuivante % 250}.${(ipSuivante++ % 200) + 1}`) {
    const jar = {};
    return async (m, chemin, corps) => {
      const t0 = DateReelle.now();
      const rep = await fetch(chemin.startsWith('http') ? chemin : base + chemin, { method: m, redirect: 'manual', headers: { 'X-Forwarded-For': ip, ...(corps ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.values(jar).join('; ') }, body: corps ? JSON.stringify(corps) : undefined });
      durees.push(DateReelle.now() - t0);
      for (const c of rep.headers.getSetCookie()) { const [nv] = c.split(';'); jar[nv.split('=')[0]] = nv; }
      const t = await rep.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = { _texte: t.slice(0, 100) }; }
      if (rep.status >= 500) note(`${m} ${chemin.replace(base, '')}`, `erreur serveur ${rep.status}`, t);
      if (/\bundefined\b|\bNaN\b/.test(t) && !/catalogue|etat/.test(chemin)) note(chemin.replace(base, ''), 'texte suspect', t.match(/.{0,50}\b(undefined|NaN)\b.{0,50}/)?.[0]);
      return { s: rep.status, j: json };
    };
  }

  const PAYS = [['ch', 'Rue du Lac 12, 1003 Lausanne', 'poste-eco'], ['fr', '14 rue des Tanneurs, 69001 Lyon', 'colissimo'], ['be', 'Rue Neuve 3, 1000 Bruxelles', 'bpost']];
  const FORMULE = i => ['lancement', 'lancement', 'croissance', 'croissance', 'pro'][i % 5];
  const SECTEURS = ['maison', 'deco', 'animaux', 'beaute', 'sport', 'mode', 'tech', 'bijoux'];
  const marchands = [];
  const STOCK_INITIAL = 40;

  async function arrivee(i) {
    const [pays, adresse, livraison] = PAYS[i % 3];
    const m = { i, pays, livraison, formule: FORMULE(i), c: client(), code: `PROMO${i}`, resilie: false, journal: [] };
    const r = await m.c('POST', '/api/auth/inscription', { email: `marchand${i}@exemple.${pays}`, motDePasse: 'un mot de passe solide ' + i,
      config: { boutique: { nom: `Boutique ${i}`, pays, secteur: SECTEURS[i % SECTEURS.length], sections: [] }, entreprise: { raison: `Société ${i}`, adresse, email: `contact${i}@exemple.${pays}`, telephone: '+41 21 000 00 00', regime: pays === 'ch' ? 'ch-non' : 'franchise' } },
      produits: [...[1, 2, 3].map(k => ({ nom: `Article ${k} de ${i}`, prix: 15 + k * 12 + (i % 7), cout: 5 + k * 3, stock: STOCK_INITIAL, type: 'stock' })), { nom: `Pièce unique de ${i}`, prix: 99, cout: 30, stock: 1, type: 'stock' }] });
    m.mdp = 'un mot de passe solide ' + i;
    if (r.s !== 201) { note(`marchand ${i}`, 'inscription refusée', JSON.stringify(r.j)); return; }
    m.slug = r.j.slug;
    const abo = await m.c('POST', '/api/abonnement/commencer', { formule: m.formule });
    if (!abo.j || !abo.j.url) { note(`marchand ${i}`, 'paiement de la formule impossible', JSON.stringify(abo.j)); return; }
    await m.c('POST', abo.j.url + '/confirmer');
    const e = await m.c('GET', '/api/admin/etat');
    if (e.s !== 200) { note(`marchand ${i}`, 'espace inaccessible après paiement', e.s); return; }
    // Produits du fournisseur (dropshipping) pour la moitié des boutiques
    if (i % 2 === 0) {
      const cat = await m.c('GET', '/api/admin/catalogue');
      for (const src of (cat.j.produits || []).filter(x => x.niche === SECTEURS[i % SECTEURS.length]).slice(0, 2)) await m.c('POST', '/api/admin/produits/import', { source: src.id });
    }
    // Réglages : tous les marchands essaient de créer un code promo et des remises (Lancement : sans effet à la vente).
    const { produits, commandes, serveur: s, avis, abonnes, envois, audience, offresVues, desinscrits, publications, ...conf } = (await m.c('GET', '/api/admin/etat')).j;
    conf.offres = { ...(conf.offres || {}), codes: [{ code: m.code, remise: 15 }], paliersActifs: true, paliers: [{ qte: 2, remise: 10 }] };
    conf.automatisations = { bienvenue: { actif: true, remise: 10, code: 'BIENVENUE' + i }, paiement: { actif: true, etapes: [{ heures: 2 }, { heures: 24 }] }, avis: { actif: true, jours: 5 } };
    if (m.formule === 'pro' || i % 7 === 0) conf.magasin = { ...(conf.magasin || {}), clickCollect: true, adresse };
    conf.social = { comptes: { instagram: true }, reglages: {} };
    const pc = await m.c('PUT', '/api/admin/config', { config: conf });
    if (pc.s !== 200) note(`marchand ${i}`, 'réglages refusés', JSON.stringify(pc.j));
    if (m.formule !== 'lancement') {
      const pub = await m.c('POST', '/api/admin/publications', { publications: [1, 3, 6, 10, 15, 21].map(j => ({ reseau: 'instagram', date: T + j * JOUR, format: 'Reel', pilier: 'produit', accroche: 'Nouveauté', legende: 'Découvrez', hashtags: [], statut: 'programmee' })) });
      if (pub.s !== 201) note(`marchand ${i}`, 'publications refusées', JSON.stringify(pub.j));
    }
    marchands.push(m);
  }

  const acheteurs = [];
  async function commander(m) {
    const actifs = acheteurs.filter(x => !x.efface);
    const a = actifs.length < 400 || hasard() < 0.3 ? { c: client(), email: `client${acheteurs.length}@exemple.${m.pays}`, nom: `Client ${acheteurs.length}` } : choix(actifs);
    if (!acheteurs.includes(a)) acheteurs.push(a);
    const pub = await a.c('GET', `/api/public/${m.slug}`);
    if (pub.s !== 200) { if (!m.resilie) note(`boutique ${m.i}`, 'boutique publique inaccessible', pub.s); return; }
    if (m.resilieFini) note(`boutique ${m.i}`, 'boutique encore ouverte après la fin de l’abonnement');
    const prods = pub.j.produits; if (!prods.length) return;
    const lignes = []; for (let k = 0, n = 1 + Math.floor(hasard() * 3); k < n; k++) { const p = choix(prods); const l = lignes.find(x => x.produitId === p.id); if (l) l.qte++; else lignes.push({ produitId: p.id, qte: 1 }); }
    const retrait = pub.j.livraisons.retrait && hasard() < 0.3;
    if (pub.j.livraisons.retrait && !(m.formule === 'pro' || m.formuleActuelle === 'pro')) note(`boutique ${m.i}`, 'retrait en magasin proposé hors formule Pro', m.formuleActuelle || m.formule);
    const avecCode = hasard() < 0.3;
    if (hasard() < 0.1) await a.c('POST', `/api/public/${m.slug}/newsletter`, { email: a.email });
    let r = await a.c('POST', `/api/public/${m.slug}/commandes`, { lignes, livraison: retrait ? 'retrait' : m.livraison, ...(avecCode ? { code: m.code } : {}), client: { nom: a.nom, email: a.email, adresse: 'Rue 1', npa: m.pays === 'fr' ? '75001' : '1000', ville: 'Ville' } });
    const formule = m.formuleActuelle || m.formule;
    if (avecCode && formule === 'lancement' && r.s === 201) note(`boutique ${m.i}`, 'code promo accepté avec la formule Lancement');
    if (avecCode && r.s === 400 && r.j && r.j.code === 'code_invalide') {
      if (formule !== 'lancement') note(`boutique ${m.i}`, 'code promo refusé alors que la formule l’inclut', formule);
      r = await a.c('POST', `/api/public/${m.slug}/commandes`, { lignes, livraison: retrait ? 'retrait' : m.livraison, client: { nom: a.nom, email: a.email, adresse: 'Rue 1', npa: m.pays === 'fr' ? '75001' : '1000', ville: 'Ville' } });
    }
    if (r.s === 409 && /stock|disponible/i.test(JSON.stringify(r.j))) return;   // rupture : normal
    if (r.s !== 201) { note(`boutique ${m.i}`, `commande refusée (${r.s})`, JSON.stringify(r.j)); return; }
    const x = hasard();
    if (x < 0.05) { await Promise.all([a.c('POST', r.j.paiementUrl + '/confirmer'), a.c('POST', r.j.paiementUrl + '/confirmer')]); }   // double clic sur « Payer »
    else if (x < 0.85) { const p = await a.c('POST', r.j.paiementUrl + '/confirmer'); if (p.s >= 400) note(`boutique ${m.i}`, 'paiement refusé', p.s); }
    else if (x < 0.9) await a.c('POST', r.j.paiementUrl + '/annuler');
    // sinon : panier abandonné (la relance de paiement doit partir si la formule l'inclut)
    if (hasard() < 0.5) { const st = await a.c('GET', `/api/public/${m.slug}/commandes/${r.j.commandeId}?jeton=${r.j.jeton}`); if (st.s !== 200) note(`boutique ${m.i}`, 'suivi de commande inaccessible au client', st.s); }
  }

  async function gestion(m) {
    const e = await m.c('GET', '/api/admin/etat');
    if (e.s === 402) { if (!m.resilie) note(`marchand ${m.i}`, 'espace bloqué (402) sans résiliation', ''); return; }
    if (e.s !== 200) { note(`marchand ${m.i}`, 'espace illisible', e.s); return; }
    for (const c of e.j.commandes) {
      const r = hasard();
      if (c.statut === 'payee' && r < 0.03) { const x = await m.c('POST', `/api/admin/commandes/${c.id}/statut`, { statut: 'remboursee', fournisseurAnnule: true }); if (x.s !== 200) note(`marchand ${m.i}`, 'remboursement refusé', JSON.stringify(x.j)); continue; }
      if (c.statut === 'payee' && c.lignes.some(l => l.type !== 'drop')) await m.c('POST', `/api/admin/commandes/${c.id}/statut`, { statut: 'preparation' });
      else if (c.statut === 'preparation') {
        if (c.livraison === 'retrait') await m.c('POST', `/api/admin/commandes/${c.id}/statut`, { statut: 'prete' });
        else { const x = await m.c('POST', `/api/admin/commandes/${c.id}/statut`, { statut: 'expediee', suivi: `99.00.${100000 + c.numero}.12345678` }); if (x.s !== 200) note(`marchand ${m.i}`, 'expédition refusée', JSON.stringify(x.j)); }
      } else if (c.statut === 'prete' && r < 0.7) await m.c('POST', `/api/admin/commandes/${c.id}/statut`, { statut: 'retiree' });
      else if (c.statut === 'expediee' && r < 0.5) await m.c('POST', `/api/admin/commandes/${c.id}/statut`, { statut: 'livree' });
    }
    // Caisse (Pro) : une vente en personne
    if ((m.formuleActuelle || m.formule) === 'pro' && hasard() < 0.5) {
      const p = e.j.produits.find(x => x.type !== 'drop' && x.stock > 2);
      if (p) { const x = await m.c('POST', '/api/admin/caisse', { lignes: [{ produitId: p.id, qte: 1 }], moyen: 'carte', cle: `t${m.i}-${T}` }); if (x.s !== 200 && x.s !== 201) note(`marchand ${m.i}`, 'vente en caisse refusée', JSON.stringify(x.j)); }
    }
  }

  /* ---------- Le mois ---------- */
  for (let jour = 0; jour < JOURS; jour++) {
    // Arrivées : les 100 marchands sur les 10 premiers jours
    for (let i = jour * Math.ceil(N / 10); i < Math.min(N, (jour + 1) * Math.ceil(N / 10)); i++) await arrivee(i);
    // Changements de formule
    if (jour === 12) for (const m of marchands) {
      const vers = m.formule === 'lancement' && m.i % 10 === 0 ? 'croissance' : m.formule === 'pro' && m.i % 10 === 4 ? 'croissance' : m.formule === 'croissance' && m.i % 10 === 2 ? 'lancement' : null;
      if (vers) { const x = await m.c('POST', '/api/abonnement/changer', { formule: vers }); if (x.s !== 200) note(`marchand ${m.i}`, 'changement de formule refusé', JSON.stringify(x.j)); else m.formuleActuelle = vers; }
    }
    if (jour === 15) for (const m of marchands.filter(x => x.i % 13 === 5)) { const x = await m.c('POST', '/api/abonnement/resilier'); if (x.s !== 200) note(`marchand ${m.i}`, 'résiliation refusée', JSON.stringify(x.j)); else { m.resilie = true; m.finPeriode = (await m.c('GET', '/api/abonnement')).j.periodeFin; } }
    // Concurrence : plusieurs clients achètent en même temps la pièce unique d'une boutique
    if (jour === 3 || jour === 9) for (const m of marchands.slice(0, 25)) {
      const pub = await client()('GET', `/api/public/${m.slug}`);
      const p = pub.j && pub.j.produits.find(x => /^Pièce unique/.test(x.nom)); if (!p) continue;
      const cl = [0, 1, 2, 3].map(k => ({ c: client(), email: `rafale${jour}-${m.i}-${k}@exemple.ch` }));
      const cmds = await Promise.all(cl.map(x => x.c('POST', `/api/public/${m.slug}/commandes`, { lignes: [{ produitId: p.id, qte: 1 }], livraison: m.livraison, client: { nom: 'Rafale Client', email: x.email, adresse: 'Rue 1', npa: '1000', ville: 'Ville' } })));
      await Promise.all(cmds.map((r, k) => r.s === 201 ? cl[k].c('POST', r.j.paiementUrl + '/confirmer') : null));
    }
    // Changement de mot de passe : l'autre appareil connecté est déconnecté
    if (jour === 8) for (const m of marchands.slice(10, 15)) {
      const autre = client();
      await autre('POST', '/api/auth/connexion', { email: `marchand${m.i}@exemple.${m.pays}`, motDePasse: m.mdp });
      if ((await autre('GET', '/api/admin/etat')).s !== 200) { note(`marchand ${m.i}`, 'connexion depuis un second appareil impossible'); continue; }
      const x = await m.c('POST', '/api/admin/compte/mot-de-passe', { actuel: m.mdp, nouveau: m.mdp + ' nouveau' });
      if (x.s !== 200) { note(`marchand ${m.i}`, 'changement de mot de passe refusé', JSON.stringify(x.j)); continue; }
      m.mdp += ' nouveau';
      if ((await autre('GET', '/api/admin/etat')).s !== 401) note(`marchand ${m.i}`, 'ancienne session encore valable après le changement de mot de passe');
      if ((await m.c('GET', '/api/admin/etat')).s !== 200) note(`marchand ${m.i}`, 'session actuelle perdue après le changement de mot de passe');
      const vieux = client(); if ((await vieux('POST', '/api/auth/connexion', { email: `marchand${m.i}@exemple.${m.pays}`, motDePasse: m.mdp.replace(/ nouveau$/, '') })).s !== 401) note(`marchand ${m.i}`, 'ancien mot de passe encore accepté');
    }
    // Redémarrage du serveur au milieu de la période
    if (jour === Math.floor(JOURS / 2)) { await redemarrer(); process.stdout.write('— serveur redémarré —\n'); }
    // Effacement des données d'un client (RGPD) : plus aucun e-mail ensuite, commandes anonymisées
    if (jour === 20) for (const m of marchands.filter(x => x.i % 11 === 3 && !x.supprime)) {
      const b = db.prepare('SELECT id FROM boutiques WHERE slug = ?').get(m.slug);
      const parClient = {};
      for (const r of db.prepare('SELECT statut, donnees FROM commandes WHERE boutique_id = ?').all(b.id)) { const e = JSON.parse(r.donnees).client.email; (parClient[e] = parClient[e] || []).push(r.statut); }
      const cible = Object.entries(parClient).find(([e, st]) => !/^rafale/.test(e) && st.every(x => ['livree', 'retiree', 'remboursee', 'annulee'].includes(x)));
      if (!cible) continue;
      const x = await m.c('POST', '/api/admin/clients/effacer', { email: cible[0] });
      if (x.s !== 200) { note(`marchand ${m.i}`, 'effacement des données refusé', JSON.stringify(x.j)); continue; }
      effaces.push({ boutique: b.id, email: cible[0], t: T, m });
      const a = acheteurs.find(y => y.email === cible[0]); if (a) a.efface = true;
    }
    // Suppression de compte par deux marchands
    if (jour === 22) for (const m of marchands.filter(x => x.i % 25 === 7 && !x.resilie).slice(0, 2)) {
      const b = db.prepare('SELECT id, marchand_id FROM boutiques WHERE slug = ?').get(m.slug);
      const x = await m.c('POST', '/api/admin/compte/supprimer', { motDePasse: m.mdp });
      if (x.s !== 200) { note(`marchand ${m.i}`, 'suppression du compte refusée', JSON.stringify(x.j)); continue; }
      m.supprime = true; supprimes.push({ m, b, t: T });
    }
    // Journée : 4 tranches de 6 heures
    for (let tranche = 0; tranche < 4; tranche++) {
      for (const m of marchands.filter(x => !x.supprime)) { if (m.finPeriode && T > m.finPeriode + 3 * JOUR) m.resilieFini = true; const n = Math.floor(hasard() * 2.2); for (let k = 0; k < n; k++) await commander(m); }
      if (tranche === 2) for (const m of marchands.filter(x => !x.supprime)) await gestion(m);
      await new Promise(ok => setTimeout(ok, 30));   // expéditions du fournisseur de démonstration (temps réel)
      T += 6 * HEURE;
      try { gerer.automatisationsEcheances(T); } catch (e) { note('tâches', 'e-mails automatiques en erreur', e.message); }
      try { await gerer.publierEcheances(T); } catch (e) { note('tâches', 'publications en erreur', e.message); }
    }
    // Désinscription : 20 % des destinataires d'un e-mail commercial cliquent sur le lien « ne plus recevoir »
    for (const ml of db.prepare("SELECT boutique_id, destinataire, corps FROM emails WHERE cree_le > ? AND corps LIKE '%/desinscription?j=%'").all(T - JOUR)) {
      const cle = `${ml.boutique_id}|${ml.destinataire.toLowerCase()}`;
      if (desinscrits.has(cle) || hasard() > 0.2) continue;
      const lien = ml.corps.match(/https?:\/\/\S+\/desinscription\?j=[\w.-]+/);
      if (!lien) { note('e-mail', 'lien de désinscription illisible', ml.corps.slice(-120)); continue; }
      const x = await client()('POST', lien[0]); if (x.s !== 200) note('e-mail', 'désinscription refusée', x.s);
      desinscrits.set(cle, T);
    }
    process.stdout.write(`jour ${jour + 1}/${JOURS} · ${marchands.length} marchands · ${db.prepare('SELECT COUNT(*) n FROM commandes').get().n} commandes · ${anomalies.length} anomalies\n`);
  }

  /* ---------- Vérifications de fin de mois ---------- */
  const bilan = { formules: {}, commandes: {}, emails: {}, abonnements: {} };
  const lireC = r => ({ ...JSON.parse(r.donnees), id: r.id, numero: r.numero, statut: r.statut, date: r.date });
  for (const m of marchands.filter(x => !x.supprime)) {
    const b = db.prepare('SELECT * FROM boutiques WHERE slug = ?').get(m.slug);
    const cmds = db.prepare('SELECT * FROM commandes WHERE boutique_id = ?').all(b.id).map(lireC);
    const prods = db.prepare('SELECT id, donnees FROM produits WHERE boutique_id = ?').all(b.id).map(r => ({ id: r.id, ...JSON.parse(r.donnees) }));
    const formuleFinale = m.formuleActuelle || m.formule;
    bilan.formules[formuleFinale] = (bilan.formules[formuleFinale] || 0) + 1;
    for (const c of cmds) bilan.commandes[c.statut] = (bilan.commandes[c.statut] || 0) + 1;
    // Stock : initial − quantités réellement retirées par les ventes non annulées / non remboursées
    for (const p of prods.filter(x => x.type !== 'drop')) {
      const retire = cmds.filter(c => !['attente', 'annulee', 'remboursee'].includes(c.statut)).flatMap(c => c.lignes).filter(l => l.produitId === p.id).reduce((s, l) => s + (l.retireStock ?? l.qte), 0);
      if (p.stock < 0) note(`boutique ${m.i}`, 'stock négatif', `${p.nom} : ${p.stock}`);
      const initial = /^Pièce unique/.test(p.nom) ? 1 : STOCK_INITIAL;
      if (p.stock !== initial - retire) note(`boutique ${m.i}`, 'stock incohérent avec les ventes', `${p.nom} : stock ${p.stock}, attendu ${initial - retire}`);
    }
    // Factures et avoirs : une seule suite continue (exigence comptable), numéros uniques et sans trou
    const factures = [...cmds.filter(c => c.facture).map(c => c.facture), ...cmds.filter(c => c.avoir).map(c => c.avoir.numero)];
    if (new Set(factures).size !== factures.length) note(`boutique ${m.i}`, 'numéro de facture en double');
    const nums = factures.map(f => Number(String(f).match(/(\d+)$/)?.[1])).sort((x, y) => x - y);
    for (let k = 1; k < nums.length; k++) if (nums[k] !== nums[k - 1] + 1) { note(`boutique ${m.i}`, 'trou dans la numérotation des factures', `${nums[k - 1]} → ${nums[k]}`); break; }
    for (const c of cmds) {
      if (!['attente', 'annulee'].includes(c.statut) && !c.facture) note(`boutique ${m.i}`, 'commande payée sans facture', `n° ${c.numero}`);
      if (c.facture && c.dateFacture && !String(c.facture).includes(`-${new DateReelle(c.dateFacture).getFullYear()}-`)) note(`boutique ${m.i}`, 'année de la facture différente de sa date', `${c.facture} du ${new DateReelle(c.dateFacture).toISOString().slice(0, 10)}`);
      if (c.facture && c.dateFacture && c.dateFacture < c.date) note(`boutique ${m.i}`, 'facture datée avant la commande', `n° ${c.numero}`);
      if (c.statut === 'remboursee' && c.facture && !c.avoir) note(`boutique ${m.i}`, 'remboursement sans avoir', `n° ${c.numero}`);
      const sousTotal = Math.round(c.lignes.reduce((s, l) => s + l.prix * l.qte, 0) * 100) / 100;
      if (c.canal !== 'magasin' && Math.abs(sousTotal + (c.port || 0) - c.total) > 0.011) note(`boutique ${m.i}`, 'total de commande incohérent', `n° ${c.numero} : lignes ${sousTotal} + port ${c.port} ≠ ${c.total}`);
      if (formuleFinale === 'lancement' && m.formule === 'lancement' && (c.remise || 0) > 0) note(`boutique ${m.i}`, 'remise appliquée avec la formule Lancement', `n° ${c.numero}`);
      if (c.statut === 'expediee' && c.livraison !== 'retrait' && !c.suivi && !c.lignes.every(l => l.type === 'drop')) note(`boutique ${m.i}`, 'expédiée sans numéro de suivi', `n° ${c.numero}`);
    }
    // E-mails
    const mails = db.prepare('SELECT destinataire, sujet, cree_le FROM emails WHERE boutique_id = ?').all(b.id);
    for (const ml of mails) { const k = ml.sujet.replace(/\d+|Boutique \d+/g, '#').replace(/chez .*$/, 'chez …').slice(0, 45); bilan.emails[k] = (bilan.emails[k] || 0) + 1; }
    const marketing = mails.filter(x => /^(Bienvenue chez|Votre commande chez .* vous attend|Votre panier chez|Votre avis sur|Ça fait longtemps)/.test(x.sujet));
    if (m.formule === 'lancement' && !m.formuleActuelle && marketing.length) note(`boutique ${m.i}`, 'e-mails automatiques envoyés avec la formule Lancement', marketing.map(x => x.sujet).slice(0, 2).join(' | '));
    for (const c of cmds.filter(x => !['attente', 'annulee'].includes(x.statut) && x.client.email)) {   // sans e-mail : client effacé (RGPD)
      const conf = mails.filter(x => x.destinataire === c.client.email && x.sujet === `Commande n° ${c.numero} confirmée`);
      if (c.canal !== 'magasin' && conf.length !== 1) note(`boutique ${m.i}`, `${conf.length} e-mail(s) de confirmation pour une commande payée`, `n° ${c.numero} (${c.statut}, ${c.client.email}) : ${(c.historique || []).map(h => h.texte).join(' | ')}`);
      const paye = (c.historique || []).find(h => /^Paiement/.test(h.texte));
      const relanceApres = mails.filter(x => x.destinataire === c.client.email && /vous attend/.test(x.sujet) && paye && x.cree_le > paye.date && x.sujet.includes(String(c.numero)));
      if (relanceApres.length) note(`boutique ${m.i}`, 'relance de paiement envoyée après le paiement', `n° ${c.numero}`);
    }
    if (m.resilieFini) { const pub = await client()('GET', `/api/public/${m.slug}`); if (pub.s === 200) note(`boutique ${m.i}`, 'boutique encore ouverte après la fin de l’abonnement', ''); }
    // Publications : rien ne part pour une formule sans réseaux sociaux
    const pubs = db.prepare('SELECT statut, date FROM publications WHERE boutique_id = ?').all(b.id);
    if (formuleFinale === 'lancement' && pubs.some(p => p.statut === 'publiee' && p.date > DEBUT + 12 * JOUR + JOUR)) note(`boutique ${m.i}`, 'publication partie après le passage à Lancement');
    const a = db.prepare('SELECT * FROM abonnements WHERE marchand_id = ?').get(b.marchand_id);
    const etatAbo = a.statut + (a.fin_demandee ? ' (fin demandée)' : '');
    bilan.abonnements[etatAbo] = (bilan.abonnements[etatAbo] || 0) + 1;
    if (!m.resilie && !(a.statut === 'actif' && a.periode_fin > T)) note(`marchand ${m.i}`, 'abonnement non renouvelé alors qu’il n’a pas été résilié', `${a.statut}, fin ${new DateReelle(a.periode_fin).toISOString()}`);
  }
  // Survente : une vente payée sans stock est signalée au marchand (alerte de rupture), jamais silencieuse
  for (const r of db.prepare("SELECT boutique_id, numero, donnees FROM commandes WHERE statut NOT IN ('attente', 'annulee', 'remboursee')").all()) {
    const c = JSON.parse(r.donnees);
    if (c.canal !== 'magasin' && c.lignes.some(l => l.type !== 'drop' && l.retireStock !== undefined && l.retireStock < l.qte) && !c.alerteStock) note(`commande ${r.numero}`, 'vendue sans stock et sans alerte de rupture');
  }
  // Désinscrits : plus aucun e-mail commercial après le clic
  for (const [cle, t] of desinscrits) {
    const [bid, email] = cle.split('|');
    const apres = db.prepare("SELECT sujet FROM emails WHERE boutique_id = ? AND lower(destinataire) = ? AND cree_le > ? AND corps LIKE '%/desinscription?j=%'").all(bid, email, t);
    if (apres.length) note('désinscription', 'e-mail commercial envoyé après la désinscription', `${email} : ${apres[0].sujet}`);
  }
  // Données effacées : plus de trace du client, plus d'e-mail
  for (const ef of effaces) {
    const restes = db.prepare('SELECT donnees FROM commandes WHERE boutique_id = ?').all(ef.boutique).filter(r => JSON.parse(r.donnees).client.email.toLowerCase() === ef.email.toLowerCase());
    if (restes.length) note(`boutique ${ef.m.i}`, 'commandes non anonymisées après l’effacement', `${restes.length} commande(s)`);
    const mails = db.prepare('SELECT sujet FROM emails WHERE lower(destinataire) = ? AND cree_le > ?').all(ef.email.toLowerCase(), ef.t);
    if (mails.length) note(`boutique ${ef.m.i}`, 'e-mail envoyé à un client effacé', mails[0].sujet);
  }
  // Comptes supprimés : plus rien ne reste, la boutique ne répond plus
  for (const sp of supprimes) {
    for (const t of ['produits', 'commandes', 'publications', 'abonnes', 'envois_auto', 'emails', 'comptes_stripe']) {
      try { const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE boutique_id = ?`).get(sp.b.id).n; if (n) note(`marchand ${sp.m.i}`, `données restantes après suppression du compte (${t})`, n); } catch { /* table absente */ }
    }
    if (db.prepare('SELECT 1 FROM marchands WHERE id = ?').get(sp.b.marchand_id)) note(`marchand ${sp.m.i}`, 'compte encore présent après suppression');
    if ((await client()('GET', `/api/public/${sp.m.slug}`)).s === 200) note(`marchand ${sp.m.i}`, 'boutique encore en ligne après suppression du compte');
  }
  // Contenu de tous les e-mails : rien d'indéfini ; lien de désinscription sur les commerciaux, jamais sur les e-mails de commande
  let vus = 0;
  for (const ml of db.prepare('SELECT sujet, corps FROM emails').all()) {
    if (/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(ml.sujet + ml.corps) && vus++ < 5) note('e-mail', 'texte indéfini dans un e-mail', `${ml.sujet} : ${(ml.sujet + ml.corps).match(/.{0,40}(undefined|NaN|\[object|null).{0,40}/)[0]}`);
    const commercial = /^(Bienvenue chez|Votre commande chez .* vous attend|Votre panier chez|Votre avis sur|Ça fait longtemps)/.test(ml.sujet);
    const lien = ml.corps.includes('/desinscription?j=');
    if (commercial && !lien && vus++ < 10) note('e-mail', 'e-mail commercial sans lien de désinscription', ml.sujet);
    if (/^Commande n° \d+ confirmée|est en route|est prête/.test(ml.sujet) && lien && vus++ < 10) note('e-mail', 'lien de désinscription sur un e-mail de commande', ml.sujet);
  }
  // Demande d'avis : seulement après une livraison ou un retrait
  for (const ml of db.prepare("SELECT boutique_id, destinataire, cree_le FROM emails WHERE sujet LIKE 'Votre avis sur%'").all()) {
    const recu = db.prepare('SELECT donnees FROM commandes WHERE boutique_id = ?').all(ml.boutique_id).map(r => JSON.parse(r.donnees))
      .some(c => c.client.email === ml.destinataire && (c.historique || []).some(h => /^(Livrée|Remise au client)/.test(h.texte) && h.date <= ml.cree_le));
    if (!recu) { note('e-mail', 'demande d’avis avant la réception de la commande', ml.destinataire); break; }
  }
  // L'espace du marchand montre toutes ses commandes (pas de limite cachée)
  for (const m of marchands.filter(x => !x.supprime && !x.resilieFini).slice(0, 10)) {
    const e = await m.c('GET', '/api/admin/etat'); const b = db.prepare('SELECT id FROM boutiques WHERE slug = ?').get(m.slug);
    const n = db.prepare('SELECT COUNT(*) n FROM commandes WHERE boutique_id = ?').get(b.id).n;
    if (e.s === 200 && e.j.commandes.length !== n) note(`marchand ${m.i}`, 'commandes manquantes dans l’espace marchand', `${e.j.commandes.length} affichées sur ${n}`);
  }
  // Isolation : un marchand ne lit jamais les commandes d'un autre
  if (marchands.length > 1) { const [m1, m2] = marchands; const e = await m1.c('GET', '/api/admin/etat'); const b2 = db.prepare('SELECT id FROM boutiques WHERE slug = ?').get(m2.slug); if (JSON.stringify(e.j).includes(b2.id)) note('isolation', 'données d’une autre boutique visibles'); }

  const mrr = marchands.reduce((s, m) => s + (m.resilieFini ? 0 : { lancement: 29, croissance: 59, pro: 119 }[m.formuleActuelle || m.formule]), 0);
  const tri = [...durees].sort((x, y) => x - y);
  const file = db.prepare('SELECT COUNT(*) n, SUM(envoye) e FROM emails').get();
  console.log(JSON.stringify({
    marchands: marchands.length, acheteurs: acheteurs.length, jours: JOURS, desinscriptions: desinscrits.size, effacements: effaces.length, comptesSupprimes: supprimes.length,
    commandes: bilan.commandes, formulesFinales: bilan.formules, abonnements: bilan.abonnements,
    revenuMensuelExploitant: `${mrr} (CHF/€ mélangés, ordre de grandeur)`,
    emails: { total: file.n, envoyes: file.e || 0, parSujet: bilan.emails },
    requetes: { nombre: durees.length, medianeMs: tri[Math.floor(tri.length / 2)], p95Ms: tri[Math.floor(tri.length * 0.95)], maxMs: tri[tri.length - 1] },
    erreursJournalServeur: erreursServeur.slice(0, 10), nbErreursJournal: erreursServeur.length,
    anomaliesParType: anomalies.reduce((o, a) => { o[a.quoi] = (o[a.quoi] || 0) + 1; return o; }, {}),
    anomalies: anomalies.slice(0, 40), nbAnomalies: anomalies.length
  }, null, 1));
  serveur.close(); db.close(); try { require('node:fs').rmSync(fichier); require('node:fs').rmSync(fichier + '-wal', { force: true }); require('node:fs').rmSync(fichier + '-shm', { force: true }); } catch { /* ignoré */ }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
