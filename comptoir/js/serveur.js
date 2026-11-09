/* Comptoir — mode connecté.
   Quand l’interface est servie par le serveur Comptoir (node server/server.js),
   elle passe en mode réel : compte marchand, données en base, vraies commandes
   venant de la boutique publique, paiements et fournisseurs.
   Ouverte comme simple fichier ou dans un aperçu, elle reste en mode démo. */

const SERVEUR = { actif: false, connecte: false, email: null, slug: null, paiement: null };

async function api(methode, chemin, corps) {
  const rep = await fetch(chemin, {
    method: methode, credentials: 'same-origin',
    headers: corps ? { 'Content-Type': 'application/json' } : {},
    body: corps ? JSON.stringify(corps) : undefined
  });
  const texte = await rep.text();
  const json = texte ? JSON.parse(texte) : {};
  if (!rep.ok) { const e = new Error(json.erreur || `Erreur ${rep.status}`); e.statut = rep.status; throw e; }
  return json;
}

async function initServeur() {
  if (!/^https?:$/.test(location.protocol)) return;
  let s;
  try {
    const rep = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!rep.ok || !(rep.headers.get('content-type') || '').includes('application/json')) return;
    s = await rep.json();
    if (typeof s.connecte !== 'boolean') return;
  } catch { return; }
  Object.assign(SERVEUR, s, { actif: true });
  if (SERVEUR.connecte) { await rechargerEtat(); installerModeConnecte(); }
  else installerConnexion();
}

async function rechargerEtat() {
  const e = await api('GET', '/api/admin/etat');
  etat = completerEtat(e);
  SERVEUR.slug = e.serveur.slug;
  SERVEUR.paiement = e.serveur.paiement;
}
const urlBoutique = () => `${location.origin}/s/${SERVEUR.slug}`;
const configActuelle = () => ({ boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, reglages: etat.reglages, campagnes: etat.campagnes, rdv: etat.rdv, cookies: etat.cookies, social: etat.social, tests: etat.tests || [] });
async function rafraichir(message) {
  try { await rechargerEtat(); } catch (e) { toast(e.message); }
  rendre();
  if (message) toast(message);
}

/* ---------- Connexion et inscription ---------- */
function installerConnexion() {
  const etatForm = { onglet: 'inscription', erreur: '', envoi: false };
  document.querySelector('.cote').hidden = true;
  rendre = function () {
    const ins = etatForm.onglet === 'inscription';
    $('#vue').innerHTML = `<div class="assistant carte connexion">
      <span class="eyebrow">Comptoir</span>
      <h1>${ins ? 'Créez votre boutique' : 'Connexion'}</h1>
      <div class="onglets plein"><button class="${ins ? 'actif' : ''}" data-cx="inscription">Créer un compte</button><button class="${ins ? '' : 'actif'}" data-cx="connexion">Se connecter</button></div>
      <form id="form-auth" class="assistant-corps">
        ${ins ? `<label class="champ"><span>Nom de la boutique</span><input id="cx-nom" name="nom" required maxlength="80" placeholder="ex. Lacustre"></label>
        <div class="deux"><label class="champ"><span>Niche</span><select id="cx-secteur" name="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${k === 'maison' ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
        <label class="champ"><span>Modèle</span><select id="cx-modele" name="modele"><option value="drop">Dropshipping</option><option value="stock">Mes propres produits</option><option value="mixte">Les deux</option></select></label></div>
        <label class="champ"><span>Pays</span><select id="cx-pays" name="pays"><option value="ch">Suisse</option><option value="fr">France</option><option value="be">Belgique</option></select></label>` : ''}
        <label class="champ"><span>E-mail</span><input id="cx-email" name="email" type="email" required autocomplete="email"></label>
        <label class="champ"><span>Mot de passe${ins ? ' (10 caractères minimum)' : ''}</span><input id="cx-mdp" name="motDePasse" type="password" required minlength="${ins ? 10 : 1}" autocomplete="${ins ? 'new-password' : 'current-password'}"></label>
        ${etatForm.erreur ? `<p class="encart alerte-encart">${esc(etatForm.erreur)}</p>` : ''}
        <button class="btn" ${etatForm.envoi ? 'disabled' : ''}>${etatForm.envoi ? 'Un instant…' : ins ? 'Créer ma boutique' : 'Se connecter'}</button>
      </form>
      ${ins ? '<p class="sous">Votre boutique est créée avec un design, des pages et, en dropshipping, les meilleurs produits du catalogue fournisseurs pour votre niche. Vous pourrez tout modifier.</p>' : ''}
    </div>`;
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cx]');
    if (b) { etatForm.onglet = b.dataset.cx; etatForm.erreur = ''; rendre(); }
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'form-auth') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const d = Object.fromEntries(new FormData(e.target));
    etatForm.envoi = true; etatForm.erreur = ''; rendre();
    try {
      if (etatForm.onglet === 'connexion') {
        await api('POST', '/api/auth/connexion', { email: d.email, motDePasse: d.motDePasse });
      } else {
        const nom = d.nom.trim();
        const pays = d.pays;
        const theme = pays === 'ch' ? 'leman' : 'craie';
        const config = {
          boutique: { nom, secteur: d.secteur, slogan: '', theme: { ...THEMES[theme], id: theme }, sections: sectionsParDefaut(nom, d.secteur, pays), domaine: null, publiee: true, pays, modele: d.modele, langues: ['fr'] },
          entreprise: { raison: nom, forme: pays === 'ch' ? 'Raison individuelle' : 'Micro-entreprise', siret: '', tvaIntra: '', adresse: '', email: d.email, regime: pays === 'ch' ? 'ch-non' : 'franchise', mediateur: '' },
          magasin: { actif: false, adresse: '', horaires: '', clickCollect: false, googleSync: false },
          reglages: { autoTransmission: true, cpa: 8 }
        };
        const propres = d.modele === 'drop' ? [] : produitsDepuisSecteur(d.secteur).slice(0, d.modele === 'mixte' ? 2 : 6).map(({ id, ...p }) => ({ ...p, type: 'stock' }));
        await api('POST', '/api/auth/inscription', { email: d.email, motDePasse: d.motDePasse, config, produits: propres });
        if (d.modele !== 'stock') {
          etat = { boutique: config.boutique, entreprise: config.entreprise, produits: [], commandes: [], reglages: config.reglages };
          const meilleurs = CATALOGUE.filter(f => f.niche === d.secteur && f.entrepot !== 'CN').map(f => ({ f, s: potentielProduit(f).score })).sort((a, b) => b.s - a.s).slice(0, d.modele === 'mixte' ? 3 : 4);
          for (const { f } of meilleurs) await api('POST', '/api/admin/produits/import', { source: f.id });
        }
      }
      location.hash = 'tableau';
      location.reload();
    } catch (err) {
      etatForm.envoi = false; etatForm.erreur = err.message; rendre();
    }
  }, true);
}

/* ---------- Mode connecté : chaque action passe par le serveur ---------- */
function installerModeConnecte() {
  // La configuration (design, sections, entreprise, magasin, campagnes…) est envoyée après chaque modification.
  let minuterie = null;
  sauver = function () {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => api('PUT', '/api/admin/config', { config: configActuelle() }).catch(e => toast(`Non enregistré : ${e.message}`)), 600);
  };

  // Pied de la barre latérale : compte, boutique en ligne, déconnexion.
  const pied = document.querySelector('.cote-pied');
  pied.innerHTML = `<span class="sous compte">${esc(SERVEUR.email)}</span>
    <a class="btn" href="${esc(urlBoutique())}" target="_blank" rel="noopener">Ouvrir ma boutique en ligne</a>
    <a class="lien" href="#offre">L’offre et les tarifs</a>
    <button class="btn fantome" data-srv="deconnexion">Se déconnecter</button>`;
  document.querySelector('.boutique-actuelle .mono').dataset.fixe = '1';

  // « Voir la boutique » : la vraie boutique publique remplace la simulation.
  vueBoutique = function () {
    return `<div class="tete"><div><h1>Votre boutique en ligne</h1><p class="sous">Les commandes passées ici arrivent dans Commandes, avec paiement ${SERVEUR.paiement === 'stripe' ? 'réel (TWINT et cartes)' : 'simulé tant qu’aucune clé Stripe n’est configurée'}.</p></div></div>
      <section class="carte"><p class="mono">${esc(urlBoutique())}</p><div class="rangee"><a class="btn" href="${esc(urlBoutique())}" target="_blank" rel="noopener">Ouvrir la boutique</a></div></section>`;
  };
  // Pas de démo ni de réinitialisation sur un vrai compte.
  const assistantOrig = vueAssistant;
  vueAssistant = function () { return assistantOrig().replace(/<div class="rangee"><span class="sous">Ou charger une démo :[\s\S]*?<\/div>\s*$/, '').replace('La boutique de démonstration actuelle sera remplacée. Vous pourrez la restaurer avec « Réinitialiser la démo ».', 'Le design et les produits actuels seront remplacés. Vos commandes et factures sont conservées.'); };

  // Clics : on intercepte avant les gestionnaires de la démo (phase de capture).
  document.addEventListener('click', async e => {
    const srv = e.target.closest('[data-srv]');
    if (srv && srv.dataset.srv === 'deconnexion') { await api('POST', '/api/auth/deconnexion'); location.reload(); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    const bloquer = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    try {
      if (action === 'statut') {
        bloquer(); el.disabled = true;
        const r = await api('POST', `/api/admin/commandes/${encodeURIComponent(id)}/statut`, { statut: el.dataset.statut });
        await rafraichir(`Commande n° ${r.commande.numero} : ${STATUTS[r.commande.statut].nom.toLowerCase()}.`);
      } else if (action === 'supprimer-produit') {
        bloquer();
        await api('DELETE', `/api/admin/produits/${encodeURIComponent(id)}`);
        ui.produitEdite = null; await rafraichir('Produit supprimé.');
      } else if (action === 'importer-produit') {
        bloquer(); el.disabled = true;
        await api('POST', '/api/admin/produits/import', { source: id });
        await rafraichir('Produit ajouté à votre boutique.');
      } else if (action === 'encaisser') {
        bloquer();
        const r = await api('POST', '/api/admin/caisse', { lignes: ui.caisse.map(l => ({ produitId: l.produitId, qte: l.qte })), moyen: el.dataset.moyen });
        ui.caisse = []; await rafraichir(`Vente de ${r.total} encaissée. Facture ${r.facture}.`);
      } else if (action === 'as-creer') {
        bloquer();
        await recreerBoutique();
      } else if (action === 'reset' || action === 'demo') {
        bloquer();
      }
    } catch (err) { el.disabled = false; toast(err.message); }
  }, true);

  // Fiche produit : création ou mise à jour en base.
  document.addEventListener('submit', async e => {
    if (e.target.dataset.form !== 'produit') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const d = new FormData(e.target);
    const p = { ...ui.produitEdite, nom: d.get('nom'), description: d.get('description'), prix: Number(d.get('prix')), stock: Number(d.get('stock')), cout: d.get('cout') === '' || d.get('cout') === null ? undefined : Number(d.get('cout')), categorie: d.get('categorie'), actif: d.get('actif') === 'on', aVerifier: false };
    try {
      if (etat.produits.find(x => x.id === p.id)) await api('PUT', `/api/admin/produits/${encodeURIComponent(p.id)}`, { produit: p });
      else await api('POST', '/api/admin/produits', { produit: p });
      ui.produitEdite = null; await rafraichir(`« ${p.nom} » enregistré.`);
    } catch (err) { toast(err.message); }
  }, true);

  // Notes internes : enregistrées en base quelques instants après la frappe.
  const notes = {};
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.champ !== 'note') return;
    clearTimeout(notes[t.dataset.id]);
    notes[t.dataset.id] = setTimeout(() => api('PATCH', `/api/admin/commandes/${encodeURIComponent(t.dataset.id)}`, { note: t.value }).catch(err => toast(err.message)), 700);
  }, true);

  // Photos : les fiches sont créées en base.
  document.addEventListener('change', async e => {
    if (e.target.id !== 'photo-input') return;
    e.stopImmediatePropagation();
    const fichiers = [...e.target.files].filter(f => f.type.startsWith('image/')).slice(0, 12);
    e.target.value = '';
    let n = 0;
    for (const [i, f] of fichiers.entries()) {
      try {
        const image = await reduireImage(f);
        await api('POST', '/api/admin/produits', { produit: { ...ficheDepuisPhoto(f.name, etat.produits.length + i), stock: 5, teinte: Math.floor(Math.random() * 360), actif: false, image, aVerifier: true, type: 'stock' } });
        n++;
      } catch (err) { toast(err.message); }
    }
    await rafraichir(`${n} fiche${n > 1 ? 's' : ''} créée${n > 1 ? 's' : ''} depuis vos photos. Vérifiez le prix puis mettez en ligne.`);
  }, true);

  // Les nouvelles commandes de la boutique publique apparaissent toutes seules.
  setInterval(async () => {
    if (document.hidden || ui.produitEdite || ['editeur', 'creer'].includes(ui.route)) return;
    const avant = etat.commandes.length;
    const statuts = etat.commandes.map(c => c.statut).join();
    try { await rechargerEtat(); } catch { return; }
    if (etat.commandes.length !== avant || etat.commandes.map(c => c.statut).join() !== statuts) {
      rendre();
      if (etat.commandes.length > avant) toast(`Nouvelle commande reçue (${etat.commandes.length - avant}).`);
    }
  }, 15000);
}

/* L’assistant, sur un vrai compte, remplace le design et les produits (pas les commandes). */
async function recreerBoutique() {
  const a = ui.assistant;
  const nom = a.nom.trim() || etat.boutique.nom;
  const config = configActuelle();
  config.boutique = { ...config.boutique, nom, secteur: a.secteur, theme: { ...THEMES[a.theme], id: a.theme }, sections: sectionsParDefaut(nom, a.secteur, a.pays), pays: a.pays, modele: a.modele };
  if (a.domaine) config.boutique.domaine = { domaine: a.domaine, date: Date.now() };
  const propres = a.exemples && a.modele !== 'drop' ? produitsDepuisSecteur(a.secteur).slice(0, a.modele === 'mixte' ? 2 : 6).map(({ id, ...p }) => ({ ...p, type: 'stock' })) : [];
  await api('POST', '/api/admin/reinitialiser', { config, produits: propres });
  if (a.exemples && a.modele !== 'stock') {
    const meilleurs = CATALOGUE.filter(f => f.niche === a.secteur && f.entrepot !== 'CN').map(f => ({ f, s: potentielProduit(f).score })).sort((x, y) => y.s - x.s).slice(0, a.modele === 'mixte' ? 3 : 4);
    for (const { f } of meilleurs) await api('POST', '/api/admin/produits/import', { source: f.id });
  }
  await rechargerEtat();
  location.hash = 'editeur';
  toast(`${nom} est prête. Personnalisez chaque section.`);
}

/* Démarrage commun (appelé par app.js). */
async function demarrer() {
  await initServeur();
  surHash();
}
