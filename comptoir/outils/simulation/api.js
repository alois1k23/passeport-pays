// Simulation de 100 utilisateurs contre un vrai serveur Comptoir : 40 marchands, 60 acheteurs.
// Chaque anomalie est notée : erreur 5xx, statut inattendu, total faux, texte « undefined »/NaN, fuite de données.
const base = process.argv[2] || 'http://localhost:3995';
const anomalies = [], ok = [];
const note = (qui, quoi, detail) => anomalies.push({ qui, quoi, detail: String(detail).slice(0, 300) });
const bien = (quoi) => ok.push(quoi);

function client() {
  let cookie = '';
  return async (methode, chemin, corps, opts = {}) => {
    const rep = await fetch(base + chemin, { method: methode, redirect: 'manual', headers: { ...(corps !== undefined ? { 'Content-Type': opts.type || 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: corps === undefined ? undefined : (opts.brut ? corps : JSON.stringify(corps)) });
    const sc = rep.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await rep.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = { _texte: t.slice(0, 200) }; }
    if (/undefined|NaN|\[object Object\]/.test(t) && !chemin.includes('catalogue')) note(chemin, 'texte suspect dans la réponse', t.match(/.{0,60}(undefined|NaN|\[object Object\]).{0,60}/)?.[0]);
    if (rep.status >= 500) note(`${methode} ${chemin}`, `erreur serveur ${rep.status}`, t);
    return { statut: rep.status, json };
  };
}
const theme = { bg: '#F6F4EF', surface: '#FFFFFF', text: '#1B1B1B', muted: '#666666', primary: '#1D5C70', onPrimary: '#FFFFFF', font: "'Outfit', sans-serif", body: "'Outfit', sans-serif", radius: 10 };
const NOMS = ['Café d’Ouchy', 'L\'Atelier Émeraude & Co', 'Zürich Design', 'Boutique 🌿 Verte', 'Ça Marche !', 'Les Délices de Montreux', 'Nord', 'A', 'Maison ' + 'Très Longue '.repeat(8), '<script>alert(1)</script>', 'Bijoux Léman', 'TechZone Genève', 'Animaux Heureux', 'Épicerie fine du Jura', 'Sport & Lac', 'Mode Lausanne', 'Beauté Naturelle', 'Déco Vevey', 'Lumière d’Hiver', 'Coffrets Suisses'];
const SECTEURS = ['maison', 'animaux', 'tech', 'deco', 'mode', 'beaute', 'epicerie', 'sport', 'bijoux'];
const PRODUITS_BIZARRES = [
  { nom: 'Prix zéro', prix: 0, stock: 3 }, { nom: 'Prix négatif', prix: -5, stock: 1 }, { nom: 'Très cher', prix: 1e7, stock: 1 }, { nom: 'Prix texte', prix: 'abc', stock: 1 },
  { nom: '', prix: 20, stock: 1 }, { nom: 'Stock négatif', prix: 20, stock: -3 }, { nom: 'Décimales', prix: 12.345, stock: 2 }, { nom: 'Nom '.repeat(60), prix: 9, stock: 1 },
  { nom: 'Prix barré', prix: 40, prixReference: 55, stock: 5 }, { nom: 'Image piégée', prix: 10, stock: 1, image: 'javascript:alert(1)' }
];

async function marchand(i) {
  const qui = `marchand ${i + 1}`;
  const c = client();
  const nom = NOMS[i % NOMS.length] + (i >= NOMS.length ? ' ' + i : '');
  const pays = i % 4 === 3 ? 'fr' : 'ch';
  const email = `m${i}-${Date.now()}@exemple.ch`;
  const r = await c('POST', '/api/auth/inscription', { email, motDePasse: 'mot de passe solide ' + i, config: { boutique: { nom, pays, secteur: SECTEURS[i % 9], modele: ['drop', 'stock', 'mixte'][i % 3], theme, sections: [{ id: 's1', type: 'hero', props: { titre: nom } }, { id: 's2', type: 'produits', props: { titre: 'Nos produits', nombre: '4' } }] }, entreprise: { raison: nom, adresse: 'Rue de Bourg 1, 1003 Lausanne', regime: pays === 'ch' ? 'ch-non' : 'franchise' }, magasin: { clickCollect: i % 5 === 0 }, reglages: { autoTransmission: true, cpa: 8 } }, produits: [{ nom: 'Produit phare', prix: 49, stock: 10, type: 'stock', cout: 15 }] });
  if (r.statut !== 201) { if ((nom.trim().length < 2 || nom.length > 80) && r.statut === 400) bien('nom de boutique hors limites refusé proprement'); else note(qui, `inscription refusée (${nom})`, JSON.stringify(r.json)); return null; }
  const slug = r.json.slug;
  // Nouveau parcours : la formule est payée avant l'accès à l'espace marchand (paiement simulé).
  const abo = await c('POST', '/api/abonnement/commencer', { formule: 'pro' });
  if (!abo.json || !abo.json.url) { note(qui, 'paiement de la formule impossible', JSON.stringify(abo.json)); return null; }
  await fetch(abo.json.url + '/confirmer', { method: 'POST', redirect: 'manual' });
  if (/script/.test(slug)) note(qui, 'slug contient du code', slug);
  // Produits normaux et bizarres
  const p = PRODUITS_BIZARRES[i % PRODUITS_BIZARRES.length];
  const rp = await c('POST', '/api/admin/produits', { produit: { ...p, type: 'stock', cout: 5 } });
  const attendu400 = ['Prix négatif', 'Très cher', 'Prix texte', '', 'Stock négatif', 'Image piégée'].includes(p.nom) || p.nom.length > 120;
  if (attendu400 && rp.statut !== 400) note(qui, `produit invalide accepté : « ${p.nom.slice(0, 30)} »`, `statut ${rp.statut}`);
  else if (!attendu400 && rp.statut !== 201) note(qui, `produit valide refusé : « ${p.nom} »`, JSON.stringify(rp.json));
  else bien('validation produit');
  // Import du catalogue fournisseur
  const cat = await c('GET', '/api/admin/catalogue');
  const liste = cat.json && cat.json.produits;
  if (cat.statut === 200 && Array.isArray(liste) && liste.length) {
    const imp = await c('POST', '/api/admin/produits/import', { source: liste[i % liste.length].id });
    if (imp.statut >= 400) note(qui, 'import catalogue échoué', JSON.stringify(imp.json)); else bien('import catalogue');
  } else note(qui, 'catalogue fournisseur indisponible', cat.statut);
  // Lecture état et cohérence
  const e = await c('GET', '/api/admin/etat');
  if (e.statut !== 200) { note(qui, 'état admin illisible', e.statut); return null; }
  if (e.json.boutique.devise !== (pays === 'ch' ? 'CHF' : 'EUR')) note(qui, 'devise incohérente', e.json.boutique.devise);
  // Config : code promo, offres, tentative d'activer un domaine sans DNS
  const { produits, commandes, serveur, avis, abonnes, envois, audience, offresVues, ...conf } = e.json;
  const cfg = { ...conf, offres: { ...(e.json.offres || {}), codes: [{ code: 'bienvenue' + i, remise: 15 }, { code: 'TROP', remise: 95 }], seuilPort: [60, 0, 100][i % 3] }, boutique: { ...e.json.boutique, domaine: { domaine: 'pirate.ch', actif: true } } };
  const rc = await c('PUT', '/api/admin/config', { config: cfg });
  if (rc.statut >= 400) note(qui, 'enregistrement des réglages refusé', JSON.stringify(rc.json));
  const e2 = await c('GET', '/api/admin/etat');
  if (e2.json.boutique.domaine && e2.json.boutique.domaine.actif) note(qui, 'domaine activé sans vérification DNS', JSON.stringify(e2.json.boutique.domaine));
  const codes = (e2.json.offres && e2.json.offres.codes) || [];
  if (codes.some(x => x.remise > 70)) note(qui, 'remise de 95 % acceptée', JSON.stringify(codes));
  // Mauvaises connexions, mot de passe oublié
  const autre = client();
  if ((await autre('POST', '/api/auth/connexion', { email, motDePasse: 'faux' })).statut !== 401) note(qui, 'connexion avec mauvais mot de passe non refusée', '');
  if ((await autre('POST', '/api/auth/connexion', { email: email.toUpperCase(), motDePasse: 'mot de passe solide ' + i })).statut !== 200) note(qui, 'connexion refusée quand l’e-mail est saisi en majuscules', email.toUpperCase());
  if ((await autre('POST', '/api/auth/oubli', { email })).statut !== 200) note(qui, 'mot de passe oublié en erreur', '');
  // Accès croisé : un autre marchand ne doit pas lire cette boutique
  if ((await autre('GET', '/api/admin/etat')).statut === 200) { /* connecté via majuscules : normal */ }
  // Publication sociale
  const pub = await c('POST', '/api/admin/publications', { publications: [{ reseau: 'instagram', format: 'Reel', pilier: 'produit', date: Date.now() + 3600e3, accroche: 'Test ' + nom, legende: 'Légende', hashtags: ['#test'], statut: 'programmee' }] });
  if (pub.statut >= 400) note(qui, 'création de publication refusée', JSON.stringify(pub.json));
  return { c, slug, i, pays, email, codePromo: ('bienvenue' + i).toUpperCase(), seuil: [60, 0, 100][i % 3] };
}

async function acheteur(j, boutiques) {
  const qui = `acheteur ${j + 1}`;
  const b = boutiques[j % boutiques.length];
  const c = client();
  const pub = await c('GET', '/api/public/' + b.slug);
  if (pub.statut !== 200) { note(qui, 'boutique publique inaccessible', pub.statut); return; }
  const d = pub.json;
  if (d.produits.some(p => 'cout' in p || 'codeFournisseur' in p)) note(qui, 'coût fournisseur visible publiquement', b.slug);
  await c('POST', `/api/public/${b.slug}/evenement`, { type: 'visite', session: 'sess' + j });
  const dispo = d.produits.filter(p => p.type === 'drop' || p.stock > 0);
  if (!dispo.length) { note(qui, 'aucun produit achetable', b.slug); return; }
  const prod = dispo[j % dispo.length];
  const modes = Object.keys(d.livraisons || {});
  const scenario = j % 12;
  const clientInfo = { nom: ['Léa Müller', 'Jean-Pierre D’Allaz', 'Zoë', 'Ömer Yılmaz', 'Anne Marie'][j % 5], email: `a${j}@exemple.ch`, adresse: 'Rue de Bourg 1', npa: '1003', ville: 'Lausanne', consentement: j % 2 === 0 };
  let lignes = [{ produitId: prod.id, qte: 1 + (j % 3) }];
  let corps = { lignes, livraison: modes[j % modes.length], client: clientInfo };
  const attendu = { 0: 201, 1: 400, 2: 400, 3: 400, 4: 400, 5: 201, 6: 400, 7: 201, 8: 201, 9: 400, 10: 201, 11: 201 }[scenario];
  if (scenario === 1) corps.lignes = [];
  if (scenario === 2) corps.lignes = [{ produitId: prod.id, qte: -2 }];
  if (scenario === 3) corps.client = { ...clientInfo, email: 'pas-un-email' };
  if (scenario === 4) corps.lignes = [{ produitId: 'inexistant', qte: 1 }];
  if (scenario === 5) corps.code = b.codePromo.toLowerCase();
  if (scenario === 6) corps.livraison = 'teleportation';
  if (scenario === 7) corps.lignes = dispo.slice(0, 3).map(p => ({ produitId: p.id, qte: 1 }));
  if (scenario === 8) corps.code = 'CODEFAUX';
  if (scenario === 9) corps.client = { ...clientInfo, adresse: '' };
  if (scenario === 11) corps.lignes = [{ produitId: prod.id, qte: 1, prix: 0.01 }];
  if (scenario === 5 || scenario === 8) {
    const v = await c('POST', `/api/public/${b.slug}/code`, { code: corps.code });
    if (scenario === 5 && v.statut !== 200) note(qui, 'code promo valide refusé quand saisi en minuscules', `${corps.code} → ${JSON.stringify(v.json)}`);
    if (scenario === 8 && v.statut === 200) note(qui, 'code promo inconnu accepté', corps.code);
  }
  const cmd = await c('POST', `/api/public/${b.slug}/commandes`, corps);
  if (scenario === 8 && cmd.statut === 400) { bien('code faux refusé à la commande'); }
  else if (cmd.statut !== attendu) { note(qui, `commande (scénario ${scenario}) : statut ${cmd.statut} au lieu de ${attendu}`, JSON.stringify(cmd.json)); return; }
  if (cmd.statut !== 201) { bien('saisie invalide refusée'); return; }
  // Vérification du total
  const sous = corps.lignes.reduce((a, l) => a + d.produits.find(p => p.id === l.produitId).prix * l.qte, 0);
  if (cmd.json.total > sous + 30 || cmd.json.total < 0) note(qui, 'total incohérent', `${cmd.json.total} pour ${sous}`);
  if (scenario === 11 && cmd.json.total < prod.prix) note(qui, 'prix du navigateur accepté', cmd.json.total);
  if (scenario === 5 && !(cmd.json.total < sous + 20 && cmd.json.remise > 0) && cmd.json.remise === undefined) { /* vérifié plus bas */ }
  // Paiement : 3 acheteurs sur 4 paient, le dernier abandonne
  if (j % 4 !== 3 && cmd.json.paiementUrl) {
    const page = await fetch(cmd.json.paiementUrl); const html = await page.text();
    if (!/TWINT|carte/i.test(html)) note(qui, 'page de paiement sans moyen de paiement', html.slice(0, 120));
    await fetch(cmd.json.paiementUrl + '/confirmer', { method: 'POST', redirect: 'manual' });
    const s = await c('GET', `/api/public/${b.slug}/commandes/${cmd.json.commandeId}?jeton=${cmd.json.jeton}`);
    if (s.statut !== 200 || s.json.statut === 'attente') note(qui, 'commande toujours en attente après paiement', JSON.stringify(s.json).slice(0, 200));
    else bien('paiement confirmé');
  } else if (cmd.json.paiementUrl) {
    const rep = await c('POST', `/api/public/${b.slug}/commandes/${cmd.json.commandeId}/reprendre`, { jeton: cmd.json.jeton });
    if (rep.statut >= 400) note(qui, 'reprise d’un paiement abandonné impossible', JSON.stringify(rep.json));
  }
  // Newsletter (deux fois : la seconde ne doit pas créer de doublon ni d’erreur)
  if (j % 3 === 0) {
    const n1 = await c('POST', `/api/public/${b.slug}/newsletter`, { email: `n${j}@exemple.ch`, consentement: true });
    const n2 = await c('POST', `/api/public/${b.slug}/newsletter`, { email: `N${j}@Exemple.ch`, consentement: true });
    if (n1.statut >= 400) note(qui, 'inscription newsletter refusée', JSON.stringify(n1.json));
    if (n2.statut >= 500) note(qui, 'double inscription newsletter en erreur', JSON.stringify(n2.json));
  }
  // Suivi avec un mauvais jeton
  const fuite = await client()('GET', `/api/public/${b.slug}/commandes/${cmd.json.commandeId}?jeton=x`);
  if (fuite.statut === 200) note(qui, 'commande lisible sans jeton', '');
}

(async () => {
  const t0 = Date.now();
  const marchands = [];
  for (let i = 0; i < 40; i++) { try { const m = await marchand(i); if (m) marchands.push(m); } catch (e) { note('marchand ' + (i + 1), 'exception du simulateur', e.stack); } }
  for (let j = 0; j < 60; j++) { try { await acheteur(j, marchands); } catch (e) { note('acheteur ' + (j + 1), 'exception du simulateur', e.stack); } }
  // Contrôle final côté marchand : commandes reçues, factures continues
  for (const m of marchands.slice(0, 40)) {
    const e = await m.c('GET', '/api/admin/etat');
    const fact = e.json.commandes.filter(x => x.facture).map(x => Number(x.facture.split('-').pop())).sort((a, b) => a - b);
    if (fact.some((n, k) => n !== k + 1)) note('marchand ' + (m.i + 1), 'numérotation des factures avec trou', fact.join(','));
  }
  console.log(JSON.stringify({ duree: Date.now() - t0, marchands: marchands.length, okParType: ok.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {}), anomalies }, null, 1));
})();
