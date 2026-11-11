/* Comptoir — pilote automatique des réseaux sociaux.
   Lit les produits, les ventes, les marges, la saison et les campagnes du copilote,
   génère un calendrier de publications (Instagram, TikTok, Facebook, Pinterest)
   avec accroche, légende, hashtags et script vidéo plan par plan, les publie
   (automatiquement ou après validation), mesure les résultats et ajuste la suite.
   En démo et sans comptes connectés via les API officielles, la publication et
   les statistiques sont simulées. */

const RESEAUX = {
  tiktok: { nom: 'TikTok', formats: ['Vidéo'], heures: ['19:00', '21:00', '12:30'] },
  instagram: { nom: 'Instagram', formats: ['Reel', 'Carrousel', 'Reel', 'Story'], heures: ['18:30', '12:00', '20:00'] },
  facebook: { nom: 'Facebook', formats: ['Reel', 'Publication'], heures: ['13:00', '19:30'] },
  pinterest: { nom: 'Pinterest', formats: ['Épingle'], heures: ['20:30', '21:30'] }
};
const PILIERS = {
  probleme: { nom: 'Problème → solution', court: 'Problème' },
  produit: { nom: 'Démonstration produit', court: 'Démo' },
  avis: { nom: 'Avis et contenus clients', court: 'Avis' },
  coulisses: { nom: 'Coulisses', court: 'Coulisses' },
  saison: { nom: 'Temps fort de saison', court: 'Saison' },
  offre: { nom: 'Offre limitée', court: 'Offre' }
};
const TONS = { chaleureux: 'Chaleureux', premium: 'Premium', fun: 'Fun et direct' };

/* Problème que résout chaque catégorie (sert aux accroches « problème → solution »). */
const PROBLEMES = {
  Luminaires: ['un salon trop froid le soir', 'une lumière de plafond agressive'],
  Diffuseurs: ['l’air sec en hiver', 'une pièce qui sent le renfermé'],
  Textile: ['avoir froid sur le canapé', 'un canapé triste'],
  Rangement: ['des tiroirs en désordre', 'perdre 10 minutes à chercher ses affaires'],
  Bougies: ['une maison sans ambiance', 'des soirées toutes pareilles'],
  Accessoires: ['un quotidien compliqué', 'les petits tracas de tous les jours'],
  Couchage: ['un chien qui dort mal', 'un animal stressé la nuit'],
  Jouets: ['un chat qui s’ennuie', 'un animal qui détruit tout'],
  Recharge: ['trois chargeurs qui traînent partout', 'un téléphone à plat'],
  Visage: ['une peau terne', 'une routine trop longue'],
  Cheveux: ['un brushing qui prend 30 minutes', 'des cheveux abîmés'],
  Matériel: ['des muscles raides après le sport', 'un matériel qui ne tient pas']
};

const ACCROCHES = {
  probleme: [p => `${p.probleme.charAt(0).toUpperCase() + p.probleme.slice(1)} ? On a la solution.`, p => `Arrête de subir ${p.probleme}. Voici ce qu’on fait à la place.`, p => `Le problème de ${p.probleme}, réglé en 10 secondes.`],
  produit: [p => `POV : tu découvres ${p.nom.toLowerCase()}`, p => `Personne ne parle de ce produit, et pourtant…`, p => `3 raisons pour lesquelles tout le monde veut ${p.nom.toLowerCase()}`, p => `Je ne pensais pas qu’un ${p.categorie.toLowerCase().replace(/s$/, '')} pouvait faire ça`],
  avis: [p => p.citation ? `${p.citation}` : `${p.prenom}, de ${p.ville}, nous a envoyé cette vidéo`, () => `Ce que nos clients disent après une semaine`, () => `On a lu vos 50 derniers avis. Voici le plus drôle.`],
  coulisses: [p => `On prépare vos commandes${p.ch ? ' depuis la Suisse romande' : ''} : viens voir`, () => `Comment on choisit nos produits (on en refuse 9 sur 10)`, () => `Une journée dans notre petite boutique en ligne`],
  saison: [p => `${p.evt} arrive dans ${p.jours} jours : voici l’idée cadeau`, p => `L’idée cadeau ${p.evt} que personne n’aura`, p => `Dernière ligne droite avant ${p.evt}`],
  offre: [p => `${p.remise} jusqu’à dimanche avec le code ${p.code}`, p => `Notre seule promo du mois : ${p.remise}`, () => `Plus que quelques pièces. Après, c’est fini.`]
};

function etatSocial() {
  etat.social = etat.social || {};
  const s = etat.social;
  s.comptes = s.comptes || { instagram: false, tiktok: false, facebook: false, pinterest: false };
  s.reglages = s.reglages || { auto: false, validation: true, ton: 'chaleureux', frequence: { tiktok: 5, instagram: 4, facebook: 2, pinterest: 3 }, piliers: Object.keys(PILIERS) };
  etat.publications = etat.publications || [];
  return s;
}

/* Petit hachage déterministe pour les statistiques simulées. */
function hacheTexte(t) { let h = 2166136261; for (const c of String(t)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

/* Horaires appris : les 3 heures de publication qui ont obtenu le plus de clics par vue sur ce réseau
   (au moins 8 publications). Les horaires « génériques » des études ne valent qu’en attendant. */
function heuresApprises(reseau) {
  const l = (etat.publications || []).filter(p => p.reseau === reseau && p.statut === 'publiee' && p.stats && p.stats.vues);
  if (l.length < 8) return null;
  const parH = {};
  for (const p of l) { const h = new Date(p.date).getHours(); const x = parH[h] = parH[h] || { v: 0, c: 0 }; x.v += p.stats.vues; x.c += p.stats.clics; }
  const top = Object.entries(parH).sort((a, b) => b[1].c / b[1].v - a[1].c / a[1].v).slice(0, 3).map(([h]) => `${String(h).padStart(2, '0')}:00`);
  return top.length ? top : null;
}

/* Ce que le pilote a appris : performance relative de chaque pilier et format (clics par 1000 vues). */
function apprentissage() {
  const pub = (etat.publications || []).filter(p => p.statut === 'publiee' && p.stats);
  const taux = l => { const v = l.reduce((a, p) => a + p.stats.vues, 0); return v ? l.reduce((a, p) => a + p.stats.clics, 0) / v * 1000 : 0; };
  const global = taux(pub) || 1;
  const parCle = cle => Object.fromEntries([...new Set(pub.map(p => p[cle]))].map(k => {
    const l = pub.filter(p => p[cle] === k);
    return [k, { n: l.length, vues: l.reduce((a, p) => a + p.stats.vues, 0), clics: l.reduce((a, p) => a + p.stats.clics, 0), ventes: l.reduce((a, p) => a + p.stats.ventes, 0), indice: taux(l) / global }];
  }));
  return { n: pub.length, global, piliers: parCle('pilier'), formats: parCle('format'), reseaux: parCle('reseau') };
}

function hashtags(p, reseau) {
  const b = etat.boutique;
  const sec = SECTEURS[b.secteur] || SECTEURS.maison;
  const tags = [slugifier(b.nom).replace(/-/g, ''), ...sec.kws.slice(0, 3).map(k => k[0]), slugifier(p.categorie || '').replace(/-/g, '')];
  if (b.pays === 'ch') tags.push('suisseromande', 'lausanne', 'shoplocal');
  if (p.evtKw) tags.push(p.evtKw.replace(/-/g, ''));
  if (reseau === 'tiktok') tags.push('tiktokmademebuyit');
  if (reseau === 'pinterest') tags.push('idee' + (p.evtKw ? 'cadeau' : 'deco'));
  return [...new Set(tags.filter(Boolean))].slice(0, reseau === 'instagram' ? 8 : 5).map(t => '#' + t);
}

function scriptVideo(pilier, p, accroche) {
  const cta = p.code ? `Code ${p.code}, lien en bio` : 'Lien en bio';
  const scenes = {
    probleme: [['0–3 s', `Texte à l’écran : « ${accroche} ». Montrez le problème, sans parler.`], ['3–8 s', `Le ${p.nom.toLowerCase()} entre dans le cadre et règle le problème.`], ['8–15 s', `Gros plans : ${p.benefices.join(', ')}.`], ['15–20 s', `Résultat final + ${cta}.`]],
    produit: [['0–3 s', `Le produit en action dès la première image. Texte : « ${accroche} ».`], ['3–10 s', `Déballage rapide, puis utilisation en vrai (pas de photo fournisseur).`], ['10–17 s', `Trois bénéfices à l’écran : ${p.benefices.join(' · ')}.`], ['17–22 s', `Prix (${euros(p.prix)}) + ${cta}.`]],
    avis: [['0–3 s', `Le client face caméra ou ses mains. Texte : « ${accroche} ».`], ['3–15 s', `Son avis tel quel, en vertical, sans montage lourd.`], ['15–20 s', `Note ★★★★★ et nombre d’avis + ${cta}.`]],
    coulisses: [['0–3 s', `Vos mains qui emballent une commande. Texte : « ${accroche} ».`], ['3–15 s', `Étapes : contrôle, emballage, étiquette ${etat.boutique.pays === 'ch' ? 'La Poste' : 'Colissimo'}.`], ['15–20 s', `« Merci à vous » + ${cta}.`]],
    saison: [['0–3 s', `Texte : « ${accroche} ». Ambiance ${p.evt}.`], ['3–12 s', `Le ${p.nom.toLowerCase()} emballé en cadeau, puis ouvert.`], ['12–18 s', `Date limite de commande pour recevoir à temps.`], ['18–22 s', cta]],
    offre: [['0–3 s', `Texte en grand : « ${accroche} ».`], ['3–12 s', `Les 3 produits concernés, enchaînés vite.`], ['12–18 s', `Compte à rebours jusqu’à dimanche + ${cta}.`]]
  };
  return scenes[pilier].map(([t, texte]) => ({ t, texte }));
}

function legende(pilier, p, accroche, ton) {
  const intro = { chaleureux: '', premium: '', fun: '' }[ton];
  const corps = {
    probleme: `${p.nom} : ${p.benefices.join(', ')}.`,
    produit: `${p.description || p.nom}`,
    avis: `Merci ${p.prenom} pour ce retour ! Vous aussi, envoyez-nous votre vidéo : on la partage.`,
    coulisses: `Chaque commande est vérifiée avant de partir${p.delai ? `, livrée en ${p.delai[0]} à ${p.delai[1]} jours` : ''}.`,
    saison: `Pour ${p.evt}, on vous a préparé une sélection. ${p.dateLimite ? `Commandez avant le ${p.dateLimite} pour recevoir à temps.` : 'Choisissez la livraison Priority pour recevoir à temps.'}`,
    offre: `${p.remise} sur une sélection, avec le code ${p.code}. Jusqu’à dimanche minuit.`
  }[pilier];
  const fin = { chaleureux: 'Le lien est dans la bio.', premium: 'Disponible sur notre boutique.', fun: 'Fonce, lien en bio !' }[ton];
  return `${intro}${accroche}\n\n${corps}\n\n${fin}`;
}

/* Génère les publications des N prochains jours. */
function genererPlanning(jours = 14) {
  const s = etatSocial();
  const r = s.reglages;
  const reseaux = Object.keys(RESEAUX).filter(k => s.comptes[k] && r.frequence[k] > 0);
  if (!reseaux.length) return { erreur: 'Connectez au moins un réseau pour générer un calendrier.' };
  const produits = etat.produits.filter(p => p.actif);
  if (!produits.length) return { erreur: 'Ajoutez au moins un produit en ligne.' };
  const ventes = ventesParProduit(etat, Date.now() - 90 * 86400000);
  const poidsProduit = p => (ventes[p.id] || 0) + 3 + Math.max(0, margeProduit(p).taux) * 20;
  const appris = apprentissage();
  const prochains = prochainsTempsForts(3).filter(e => (e.date - Date.now()) / 86400000 <= 30);
  const campagne = prochains.map(e => etat.campagnes[e.cle] && { e, c: etat.campagnes[e.cle] }).find(Boolean);
  const piliers = r.piliers.filter(k => k !== 'saison' || prochains.length).filter(k => k !== 'offre' || campagne);
  if (!piliers.length) return { erreur: r.piliers.length ? 'Les types cochés (saison, offre) n’ont rien à annoncer ces 30 prochains jours : cochez aussi « Produit » ou « Problème résolu ».' : 'Choisissez au moins un type de contenu.' };
  const poidsPilier = k => ({ probleme: 3, produit: 3, avis: 2, coulisses: 1.5, saison: 2, offre: 1 }[k] || 1) * Math.max(0.5, Math.min(2, appris.piliers[k] ? appris.piliers[k].indice : 1));
  const tirage = (liste, poids, graine) => { const tot = liste.reduce((a, x) => a + poids(x), 0); let v = hacheTexte(graine) * tot; for (const x of liste) { v -= poids(x); if (v <= 0) return x; } return liste[0]; };
  const nouvelles = [];
  const debut = new Date(); debut.setHours(0, 0, 0, 0);
  const existantes = new Set(etat.publications.filter(p => p.statut !== 'publiee').map(p => p.reseau + p.date));
  let dernierProduit = null;
  for (const reseau of reseaux) {
    const parSemaine = r.frequence[reseau];
    const ecart = 7 / parSemaine;
    for (let i = 0; i * ecart < jours; i++) {
      const jour = new Date(debut); jour.setDate(jour.getDate() + 1 + Math.floor(i * ecart));
      const heures = heuresApprises(reseau) || RESEAUX[reseau].heures;
      const [h, m] = heures[i % heures.length].split(':').map(Number);
      jour.setHours(h, m);
      if (existantes.has(reseau + jour.getTime())) continue;
      const graine = `${reseau}-${jour.getTime()}-${etat.boutique.nom}`;
      const pilier = tirage(piliers, poidsPilier, graine + 'p');
      const p = tirage(produits.filter(x => x.id !== dernierProduit) .length ? produits.filter(x => x.id !== dernierProduit) : produits, poidsProduit, graine + 'x');
      dernierProduit = p.id;
      const formats = RESEAUX[reseau].formats;
      const format = pilier === 'avis' || pilier === 'probleme' ? formats[0] : formats[i % formats.length];
      const probs = PROBLEMES[p.categorie] || ['les petits tracas du quotidien'];
      const evt = prochains[0];
      const contexte = {
        nom: p.nom, categorie: p.categorie || 'produit', prix: p.prix, description: p.description, delai: p.delai,
        probleme: probs[i % probs.length], benefices: beneficesProduit(p), ch: etat.boutique.pays === 'ch',
        prenom: PRENOMS[Math.floor(hacheTexte(graine + 'n') * PRENOMS.length)], ville: (etat.boutique.pays === 'ch' ? VILLES_CH : VILLES)[Math.floor(hacheTexte(graine + 'v') * 10)],
        evt: evt ? evt.nom : '', evtKw: pilier === 'saison' && evt ? evt.kw : '', jours: evt ? Math.max(1, Math.ceil((evt.date - jour) / 86400000)) : 0,
        dateLimite: (() => { if (!evt) return ''; const d = ajouterJours(evt.date, -((p.delai ? p.delai[1] : 3) + 1)); return d > jour ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : ''; })(),
        code: pilier === 'offre' && campagne ? campagne.c.code : '', remise: campagne ? `-${campagne.e.remise} %` : '',
        citation: (() => { const a = (etat.avis || []).find(x => x.produitId === p.id && x.note >= 4 && x.texte.length >= 20 && x.texte.length <= 110); return a ? `« ${a.texte} » (${a.prenom}, ${a.ville})` : ''; })()
      };
      const modeles = ACCROCHES[pilier];
      const iAccroche = Math.floor(hacheTexte(graine + 'a') * modeles.length);
      const accroche = modeles[iAccroche](contexte);
      // Variantes à tester : autres accroches du même type + une accroche « problème » (4 à 5 vidéos × 3 accroches)
      const variantes = [...modeles.filter((_, k) => k !== iAccroche).map(f => f(contexte)), ...(pilier !== 'probleme' ? [ACCROCHES.probleme[0](contexte)] : [])].filter((v, k, arr) => v !== accroche && arr.indexOf(v) === k).slice(0, 2);
      nouvelles.push({
        id: (() => { const d = 'pub' + Math.round(jour.getTime() / 60000).toString(36) + reseau.slice(0, 2) + i; return (etat.publications || []).some(x => x.id === d) || nouvelles.some(x => x.id === d) ? nouvelId('pub') : d; })(), reseau, format, pilier, date: jour.getTime(), produitId: p.id, produitNom: p.nom,
        accroche, legende: legende(pilier, contexte, accroche, r.ton), hashtags: hashtags({ ...p, evtKw: contexte.evtKw }, reseau),
        script: ['Vidéo', 'Reel'].includes(format) ? scriptVideo(pilier, contexte, accroche) : null, variantes,
        statut: r.validation ? 'brouillon' : 'programmee', stats: null
      });
    }
  }
  nouvelles.sort((a, b) => a.date - b.date);
  return { publications: nouvelles };
}

function beneficesProduit(p) {
  const base = (p.description || '').split(/[.,]/).map(x => x.trim()).filter(x => x.length > 6 && x.length < 60).slice(0, 2);
  if (p.delai) base.push(`livré en ${p.delai[0]} à ${p.delai[1]} jours`);
  else base.push('expédié sous 24 h');
  return base.slice(0, 3).map(x => x.charAt(0).toLowerCase() + x.slice(1));
}

/* Statistiques simulées après publication (remplacées par les API des réseaux une fois connectés). */
function statsSimulees(pub) {
  const h = hacheTexte(pub.id + pub.accroche);
  const base = { tiktok: 2400, instagram: 900, facebook: 350, pinterest: 600 }[pub.reseau] || 500;
  const fmt = { 'Vidéo': 1.6, Reel: 1.5, Carrousel: 0.9, Story: 0.5, Publication: 0.6, 'Épingle': 1 }[pub.format] || 1;
  const pil = { probleme: 1.4, produit: 1.15, avis: 1.25, coulisses: 0.9, saison: 1.2, offre: 1 }[pub.pilier] || 1;
  const vues = Math.round(base * fmt * (0.4 + h * 1.6));
  const clics = Math.round(vues * 0.012 * pil * (0.6 + hacheTexte(pub.id) * 0.8));
  return { vues, likes: Math.round(vues * (0.04 + h * 0.05)), clics, ventes: Math.round(clics * 0.03 * pil * 10) / 10 >= 0.5 ? Math.round(clics * 0.03 * pil) : 0, simulees: true };
}

/* Historique de démonstration : 3 semaines de publications déjà passées. */
function semerHistoriqueSocial(e) {
  const garde = etat;
  etat = e;
  const s = etatSocial();
  s.comptes = { instagram: true, tiktok: true, facebook: true, pinterest: false };
  s.reglages.validation = true;
  const debut = Date.now() - 21 * 86400000;
  const res = genererPlanning(14);
  (res.publications || []).forEach((p, i) => {
    p.date = debut + (p.date - Date.now()) * 1.5 - 86400000;
    if (p.date < Date.now() - 3600000) { p.statut = 'publiee'; p.stats = statsSimulees(p); }
  });
  e.publications = (res.publications || []).filter(p => p.statut === 'publiee');
  etat = garde;
  return e;
}

/* ---------- Persistance : locale (démo) ou serveur (mode connecté) ---------- */
const connecteServeur = () => typeof SERVEUR !== 'undefined' && SERVEUR.connecte;
async function socialEnregistrer(action, pub) {
  if (connecteServeur()) {
    if (action === 'creer') await api('POST', '/api/admin/publications', { publications: pub });
    else if (action === 'maj') await api('PUT', `/api/admin/publications/${encodeURIComponent(pub.id)}`, { publication: pub });
    else if (action === 'suppr') await api('DELETE', `/api/admin/publications/${encodeURIComponent(pub.id)}`);
    else if (action === 'publier') await api('POST', `/api/admin/publications/${encodeURIComponent(pub.id)}/publier`);
    await rechargerEtat();
  } else {
    if (action === 'creer') etat.publications.push(...pub);
    else if (action === 'maj') Object.assign(etat.publications.find(x => x.id === pub.id), pub);
    else if (action === 'suppr') etat.publications = etat.publications.filter(x => x.id !== pub.id);
    else if (action === 'publier') { const x = etat.publications.find(p => p.id === pub.id); x.statut = 'publiee'; x.date = Math.min(x.date, Date.now()); x.stats = statsSimulees(x); }
    sauver();
  }
}

/* En démo, le pilote publie les publications programmées arrivées à échéance. */
setInterval(() => {
  if (connecteServeur() || !etat || !etat.social || !etat.social.reglages.auto) return;
  let n = 0;
  for (const p of etat.publications) if (p.statut === 'programmee' && p.date <= Date.now() && etat.social.comptes[p.reseau]) { p.statut = 'publiee'; p.stats = statsSimulees(p); n++; }
  if (n) { sauver(); if (ui.route === 'social') rendre(); toast(`${n} publication${n > 1 ? 's' : ''} mise${n > 1 ? 's' : ''} en ligne par le pilote.`); }
}, 20000);

/* ---------- Vue ---------- */
function vueSocial() {
  if (!etat.social && !connecteServeur()) { semerHistoriqueSocial(etat); sauver(); }
  const s = etatSocial();
  const r = s.reglages;
  const a = apprentissage();
  const avenir = etat.publications.filter(p => p.statut !== 'publiee').sort((x, y) => x.date - y.date);
  const publiees = etat.publications.filter(p => p.statut === 'publiee').sort((x, y) => y.date - x.date);
  const tot = k => publiees.reduce((acc, p) => acc + (p.stats ? p.stats[k] : 0), 0);
  const parJour = {};
  for (const p of avenir) { const k = new Date(p.date).toDateString(); (parJour[k] = parJour[k] || []).push(p); }
  const meilleur = (obj, noms) => { const e = Object.entries(obj).filter(([, v]) => v.n >= 2).sort((x, y) => y[1].indice - x[1].indice); return e.length ? { nom: noms ? noms[e[0][0]].nom : e[0][0], indice: e[0][1].indice, pire: noms ? noms[e[e.length - 1][0]].nom : e[e.length - 1][0] } : null; };
  const bp = meilleur(a.piliers, PILIERS), bf = meilleur(a.formats);
  const carte = p => `
    <article class="pub ${p.statut}" data-action="voir-pub" data-id="${p.id}" tabindex="0">
      <span class="pub-heure mono">${new Date(p.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="reseau r-${p.reseau}">${RESEAUX[p.reseau].nom}</span>
      <div class="pub-corps"><strong>${esc(p.accroche)}</strong><span class="sous">${esc(p.format)} · ${PILIERS[p.pilier].court} · ${esc(p.produitNom)}</span></div>
      ${p.statut === 'brouillon' ? '<span class="pill warn">À valider</span>' : '<span class="pill info">Programmée</span>'}
    </article>`;
  return `
  <div class="tete"><div><h1>Réseaux sociaux</h1><p class="sous">Le pilote prépare et publie vos contenus à partir de vos produits, de vos ventes et de la saison. Il apprend de chaque résultat.</p></div>
    <div class="rangee">
      <label class="interrupteur"><input type="checkbox" data-social="auto" ${r.auto ? 'checked' : ''}><span>Pilote automatique ${r.auto ? 'activé' : 'désactivé'}</span></label>
      <button class="btn fantome" data-action="lancement-intensif" title="3 vidéos TikTok par jour pendant 30 jours">Lancement intensif TikTok</button>
      <button class="btn" data-action="generer-planning" ${Object.values(s.comptes).some(Boolean) ? '' : 'disabled title="Connectez d’abord un réseau ci-dessous"'}>Générer les 2 prochaines semaines</button>
    </div></div>

  <div class="comptes">${Object.entries(RESEAUX).map(([k, n]) => `
    <div class="compte-reseau ${s.comptes[k] ? 'connecte' : ''}">
      <span class="reseau r-${k}">${n.nom}</span>
      ${s.comptes[k] ? `<span class="etat-compte ok">Connecté</span><label class="champ mini-champ"><span>Publications / semaine</span><input type="number" min="0" max="21" value="${r.frequence[k]}" data-frequence="${k}"></label><button class="btn petit fantome" data-action="compte-social" data-id="${k}">Déconnecter</button>`
      : `<span class="etat-compte">Non connecté</span><p class="sous">Connectez le compte pour que le pilote y publie.</p><button class="btn petit" data-action="compte-social" data-id="${k}">Connecter</button>`}
    </div>`).join('')}</div>

  <div class="kpis">
    <div class="kpi"><span>Publications (30 j)</span><strong>${publiees.filter(p => p.date > Date.now() - 30 * 86400000).length}</strong><span class="evol neutre">${avenir.length} à venir</span></div>
    <div class="kpi"><span>Vues</span><strong>${tot('vues').toLocaleString('fr-FR')}</strong><span class="evol neutre">${publiees.length} publication${publiees.length > 1 ? 's' : ''} publiée${publiees.length > 1 ? 's' : ''}</span></div>
    <div class="kpi"><span>Clics vers la boutique</span><strong>${tot('clics').toLocaleString('fr-FR')}</strong><span class="evol neutre">${a.global.toFixed(1).replace('.', ',')} pour 1000 vues</span></div>
    <div class="kpi"><span>Ventes attribuées</span><strong>${tot('ventes')}</strong>${publiees.some(p => p.stats && p.stats.simulees) ? '<span class="evol neutre">statistiques simulées</span>' : ''}</div>
  </div>

  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Calendrier</h2><span class="sous">${r.validation ? 'Validation avant publication' : 'Publication directe'}</span></div>
      ${avenir.length ? Object.entries(parJour).map(([j, l]) => `<div class="jour"><h3>${new Date(j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>${l.map(carte).join('')}</div>`).join('')
        : Object.values(s.comptes).some(Boolean) ? '<p class="sous">Aucune publication prévue. Cliquez sur « Générer les 2 prochaines semaines » : le pilote prépare tout, vous relisez.</p>' : '<p class="sous"><b>Première étape : connectez un réseau</b> (Instagram, TikTok, Facebook ou Pinterest) dans la rangée ci-dessus. Le pilote pourra ensuite préparer vos publications.</p>'}
      ${avenir.some(p => p.statut === 'brouillon') ? '<div class="rangee"><button class="btn" data-action="valider-tout">Valider tous les brouillons</button></div>' : ''}
    </section>
    <div class="pile">
      <section class="carte">
        <div class="carte-tete"><h2>Ce que le pilote a appris</h2><span class="sous">${a.n} publications analysées</span></div>
        ${bp ? `<ul class="appris">
          <li><span>Le contenu <strong>${esc(bp.nom)}</strong> fait ${bp.indice.toFixed(1).replace('.', ',')}× plus de clics que la moyenne : il en programme davantage.</span></li>
          ${bf ? `<li><span>Meilleur format : <strong>${esc(bf.nom)}</strong>. Le moins efficace : ${esc(bf.pire)}.</span></li>` : ''}
          <li><span>Moins de <strong>${esc(bp.pire)}</strong>, qui convertit le moins.</span></li></ul>`
        : '<p class="sous">Le pilote a besoin de quelques publications pour comparer. En attendant, il suit les bonnes pratiques : vidéo verticale, accroche dans les 3 premières secondes, produit montré en vrai.</p>'}
        <div class="table-wrap"><table class="table compacte"><thead><tr><th>Type de contenu</th><th class="num">Vues</th><th class="num">Clics</th><th class="num">Ventes</th></tr></thead><tbody>
          ${Object.entries(a.piliers).sort((x, y) => y[1].clics - x[1].clics).map(([k, v]) => `<tr><td>${PILIERS[k] ? PILIERS[k].nom : k}</td><td class="num">${v.vues.toLocaleString('fr-FR')}</td><td class="num">${v.clics}</td><td class="num">${v.ventes}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
      ${blocInfluenceurs()}
      <section class="carte">
        <div class="carte-tete"><h2>Réglages</h2></div>
        <label class="case"><input type="checkbox" data-social="validation" ${r.validation ? 'checked' : ''}> Me demander de valider chaque publication</label>
        <label class="champ"><span>Ton</span><select id="soc-ton" data-social="ton">${Object.entries(TONS).map(([k, n]) => `<option value="${k}" ${r.ton === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <fieldset class="champ"><legend>Types de contenu</legend><div class="rangee">${Object.entries(PILIERS).map(([k, v]) => `<label class="case"><input type="checkbox" data-pilier="${k}" ${r.piliers.includes(k) ? 'checked' : ''}> ${v.nom}</label>`).join('')}</div></fieldset>
      </section>
      ${publiees.length ? `<section class="carte"><div class="carte-tete"><h2>Dernières publications</h2></div>
        <table class="table compacte"><tbody>${publiees.slice(0, 6).map(p => `<tr data-action="voir-pub" data-id="${p.id}" tabindex="0"><td><span class="reseau r-${p.reseau}">${RESEAUX[p.reseau].nom}</span></td><td>${esc(p.accroche)}<div class="sous">${dateCourte(p.date)} · ${esc(p.format)}</div></td><td class="num">${p.stats ? p.stats.vues.toLocaleString('fr-FR') + ' vues' : ''}<div class="sous">${p.stats ? p.stats.clics + ' clics' : ''}</div></td></tr>`).join('')}</tbody></table></section>` : ''}
    </div>
  </div>
  <p class="note">Démo : connexion des comptes et statistiques simulées. En production, la publication passe par les API officielles (Instagram et Facebook via Meta, TikTok Content Posting API, Pinterest), après validation de l’application par chaque réseau.</p>`;
}

function modalPublication(p) {
  const produit = etat.produits.find(x => x.id === p.produitId) || { nom: p.produitNom, teinte: 200 };
  return `<div class="pub-detail">
    <div class="telephone"><div class="tel-entete"><span class="reseau r-${p.reseau}">${RESEAUX[p.reseau].nom}</span><span class="sous">${esc(p.format)}</span></div>
      ${visuelProduit(produit, true)}<p class="tel-accroche">${esc(p.accroche)}</p></div>
    <div class="pub-edition">
      <h2>${esc(PILIERS[p.pilier].nom)}</h2>
      <p class="sous">${new Date(p.date).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${esc(p.produitNom)}</p>
      ${p.stats ? `<div class="chiffres"><div><span class="sous">Vues</span><strong>${p.stats.vues.toLocaleString('fr-FR')}</strong></div><div><span class="sous">Clics</span><strong>${p.stats.clics}</strong></div><div><span class="sous">Ventes</span><strong>${p.stats.ventes}</strong></div></div>` : ''}
      <label class="champ"><span>Accroche (3 premières secondes)</span><input id="pub-accroche" value="${esc(p.accroche)}" ${p.statut === 'publiee' ? 'disabled' : ''}></label>
      <label class="champ"><span>Légende</span><textarea id="pub-legende" rows="6" ${p.statut === 'publiee' ? 'disabled' : ''}>${esc(p.legende)}</textarea></label>
      <p class="mono sous">${esc(p.hashtags.join(' '))}</p>
      <fieldset class="partenariat" ${p.statut === 'publiee' ? 'disabled' : ''}><label class="case"><input type="checkbox" id="pub-partenariat" ${p.partenariat ? 'checked' : ''}> Contenu en partenariat (influenceur, créateur payé ou produit offert)</label>
        <label class="champ"><span>Avec (compte du partenaire)</span><input id="pub-avec" value="${esc(p.partenariat ? p.partenariat.avec : '')}" placeholder="@compte"></label>
        <p class="sous">La mention « Publicité · Collaboration commerciale » est ajoutée en tête de la légende et doit aussi apparaître dans la vidéo. En France, c’est une obligation légale (loi du 9 juin 2023) ; en Suisse, la Commission pour la loyauté juge insuffisant un hashtag noyé parmi d’autres. Sur TikTok, activez aussi le réglage « contenu de marque ».</p></fieldset>
      ${p.variantes && p.variantes.length ? `<div class="bloc"><h3>Accroches à tester en variantes</h3><ul class="variantes">${p.variantes.map(v => `<li>${esc(v)}</li>`).join('')}</ul><p class="sous">Publiez la même vidéo avec une autre accroche : seules les 3 premières secondes changent. Le pilote compare les résultats.</p></div>` : ''}
      ${p.script ? `<p class="encart">Format : vertical 9:16, message lisible sans le son dans les 3 premières secondes, 15 s ou moins si la vidéo sert aussi de publicité. Gardez le texte hors des 14 % du haut et des 35 % du bas de l’écran (Meta). Une vidéo originale, sans filigrane d’une autre application : Instagram classe les reposts plus bas.</p>` : ''}
      ${p.script ? `<div class="bloc"><h3>Script vidéo</h3><ol class="script">${p.script.map(s => `<li><b class="mono">${s.t}</b><span>${esc(s.texte)}</span></li>`).join('')}</ol></div>` : ''}
      ${p.statut === 'publiee' ? '<span class="pill good">Publiée</span>' : `<div class="rangee">
        <button class="btn" data-action="enregistrer-pub" data-id="${p.id}" data-statut="programmee">${p.statut === 'brouillon' ? 'Valider et programmer' : 'Enregistrer'}</button>
        <button class="btn fantome" data-action="publier-pub" data-id="${p.id}">Publier maintenant</button>
        <button class="btn fantome danger" data-action="supprimer-pub" data-id="${p.id}">Supprimer</button></div>`}
    </div></div>`;
}

/* Champs modifiables de la fenêtre, avec la mention de partenariat placée en tête de la légende. */
const MENTION = 'Publicité · Collaboration commerciale';
function champsPublication() {
  const part = $('#pub-partenariat') && $('#pub-partenariat').checked;
  const avec = ($('#pub-avec') ? $('#pub-avec').value : '').trim();
  let legende = $('#pub-legende').value.replace(new RegExp('^' + MENTION + '[^\\n]*\\n+'), '');
  if (part) legende = `${MENTION}${avec ? ' avec ' + avec : ''}\n\n${legende}`;
  return { accroche: $('#pub-accroche').value, legende, partenariat: part ? { avec } : null };
}

/* ---------- Événements ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const pub = id && (etat.publications || []).find(p => p.id === id);
  try {
    if (action === 'generer-planning') {
      const res = genererPlanning(14);
      if (res.erreur) { toast(res.erreur); return; }
      el.disabled = true;
      await socialEnregistrer('creer', res.publications);
      toast(`${res.publications.length} publications préparées. ${etat.social.reglages.validation ? 'Relisez-les puis validez.' : 'Elles partiront à l’heure prévue.'}`);
      rendre();
    } else if (action === 'voir-pub') {
      ui.modal = { type: 'html', html: modalPublication(pub) }; rendreModal();
    } else if (action === 'enregistrer-pub') {
      await socialEnregistrer('maj', { ...pub, ...champsPublication(), statut: 'programmee' });
      ui.modal = null; rendreModal(); toast('Publication programmée.'); rendre();
    } else if (action === 'publier-pub') {
      if (!etat.social.comptes[pub.reseau]) { toast(`Connectez d’abord ${RESEAUX[pub.reseau].nom}.`); return; }
      await socialEnregistrer('maj', { ...pub, ...champsPublication() });
      await socialEnregistrer('publier', pub);
      ui.modal = null; rendreModal(); toast(`Publié sur ${RESEAUX[pub.reseau].nom}.`); rendre();
    } else if (action === 'supprimer-pub') {
      await socialEnregistrer('suppr', pub); ui.modal = null; rendreModal(); rendre();
    } else if (action === 'valider-tout') {
      for (const p of etat.publications.filter(x => x.statut === 'brouillon')) await socialEnregistrer('maj', { ...p, statut: 'programmee' });
      toast('Toutes les publications sont programmées.'); rendre();
    } else if (action === 'compte-social') {
      const s = etatSocial();
      s.comptes[id] = !s.comptes[id];
      sauver(); toast(s.comptes[id] ? `${RESEAUX[id].nom} connecté (simulation).` : `${RESEAUX[id].nom} déconnecté.`); rendre();
    }
  } catch (err) { el.disabled = false; toast(err.message); }
});
document.addEventListener('change', e => {
  const t = e.target;
  const s = etat && etat.social;
  if (!s) return;
  if (t.dataset.social) { s.reglages[t.dataset.social] = t.type === 'checkbox' ? t.checked : t.value; sauver(); rendre(); }
  else if (t.dataset.frequence) { s.reglages.frequence[t.dataset.frequence] = Math.max(0, Math.min(21, Number(t.value) || 0)); sauver(); }
  else if (t.dataset.pilier) { const k = t.dataset.pilier; s.reglages.piliers = t.checked ? [...new Set([...s.reglages.piliers, k])] : s.reglages.piliers.filter(x => x !== k); sauver(); }
});
