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
  // Abonnement échu pendant la session : retour à l'écran de paiement.
  if (rep.status === 402 && SERVEUR.connecte && !chemin.startsWith('/api/abonnement')) { location.reload(); }
  if (!rep.ok) { const e = new Error(json.erreur || `Erreur ${rep.status}`); e.statut = rep.status; throw e; }
  // Le serveur répond de nouveau : une modification restée en échec part tout de suite.
  if (typeof ENREGISTREMENT !== 'undefined' && ENREGISTREMENT.echecs && !ENREGISTREMENT.enCours && chemin !== '/api/admin/config') setTimeout(envoyerConfig, 0);
  return json;
}

async function initServeur() {
  if (!/^https?:$/.test(location.protocol) || location.pathname.startsWith('/demo')) return;
  let s;
  try {
    const rep = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!rep.ok || !(rep.headers.get('content-type') || '').includes('application/json')) return;
    s = await rep.json();
    if (typeof s.connecte !== 'boolean') return;
  } catch { return; }
  Object.assign(SERVEUR, s, { actif: true });
  const params = new URLSearchParams(location.search);
  const formuleUrl = params.get('formule');
  if (formuleUrl) { try { sessionStorage.setItem('comptoir-formule', formuleUrl); } catch { /* ignoré */ } }
  if (SERVEUR.connecte && s.abonnement && !s.abonnement.actif) { installerAbonnement(s.abonnement, params.get('abonnement')); return; }
  if (SERVEUR.connecte) {
    await rechargerEtat(); installerModeConnecte();
    if (params.get('abonnement') === 'ok') { history.replaceState(null, '', location.pathname + '#tableau'); setTimeout(() => toast('Paiement reçu : votre boutique est en ligne. Bienvenue !'), 300); }
  } else installerConnexion();
}

/* Enregistrement différé de la configuration. Avant tout rechargement depuis le serveur, la modification en
   attente est envoyée d’abord : sinon le rechargement l’écraserait (réglage perdu sans prévenir). */
const ENREGISTREMENT = { minuterie: null, enCours: null, echecs: 0 };
const ACTIONS_EN_COURS = new Set();
function envoyerConfig() {
  clearTimeout(ENREGISTREMENT.minuterie); ENREGISTREMENT.minuterie = null;
  const envoi = api('PUT', '/api/admin/config', { config: configActuelle() })
    .then(() => { if (ENREGISTREMENT.echecs) toast('Connexion rétablie : vos modifications sont enregistrées.'); ENREGISTREMENT.echecs = 0; })
    .catch(e => {
      // Échec (serveur ou réseau coupé) : on réessaie tout seul, de plus en plus espacé, et dès le retour du réseau.
      ENREGISTREMENT.echecs++;
      const delai = [5000, 15000, 30000][Math.min(ENREGISTREMENT.echecs - 1, 2)];
      toast(`Non enregistré (${e.statut ? e.message : 'connexion perdue'}). Nouvel essai dans ${delai / 1000} s, ne fermez pas la page.`);
      if (!ENREGISTREMENT.minuterie && (!e.statut || e.statut >= 500)) ENREGISTREMENT.minuterie = setTimeout(envoyerConfig, delai);
    })
    .finally(() => { if (ENREGISTREMENT.enCours === envoi) ENREGISTREMENT.enCours = null; });
  ENREGISTREMENT.enCours = envoi;
  return envoi;
}
async function viderEnregistrement() {
  if (ENREGISTREMENT.minuterie) await envoyerConfig();
  else if (ENREGISTREMENT.enCours) await ENREGISTREMENT.enCours;
}

/* Notes internes en attente d'envoi : envoyées avant toute relecture de l'état (sinon la relecture les écraserait). */
const NOTES_EN_ATTENTE = { valeurs: {}, minuteries: {} };
function envoyerNote(id) {
  clearTimeout(NOTES_EN_ATTENTE.minuteries[id]);
  if (!(id in NOTES_EN_ATTENTE.valeurs)) return Promise.resolve();
  const note = NOTES_EN_ATTENTE.valeurs[id]; delete NOTES_EN_ATTENTE.valeurs[id];
  return api('PATCH', `/api/admin/commandes/${encodeURIComponent(id)}`, { note }).catch(err => toast(err.message));
}
async function rechargerEtat() {
  await Promise.all(Object.keys(NOTES_EN_ATTENTE.valeurs).map(envoyerNote));
  await viderEnregistrement();
  const e = await api('GET', '/api/admin/etat');
  // Une modification faite pendant la lecture garde la priorité : on relira au prochain passage.
  if (ENREGISTREMENT.minuterie || ENREGISTREMENT.enCours) return;
  etat = completerEtat(e);
  SERVEUR.slug = e.serveur.slug;
  SERVEUR.paiement = e.serveur.paiement;
  SERVEUR.emails = e.serveur.emails || null; SERVEUR.creeLe = e.serveur.creeLe || null; SERVEUR.abonnement = e.serveur.abonnement || null; SERVEUR.jetonDomaine = e.serveur.jetonDomaine || null;
}
const urlBoutique = () => `${location.origin}/s/${SERVEUR.slug}`;
const configActuelle = () => ({ boutique: etat.boutique, entreprise: etat.entreprise, magasin: etat.magasin, reglages: etat.reglages, campagnes: etat.campagnes, rdv: etat.rdv, cookies: etat.cookies, social: etat.social, tests: etat.tests || [], automatisations: etat.automatisations, offres: etat.offres, lancement: etat.lancement || {}, fournisseursSuivi: etat.fournisseursSuivi || {} });
async function rafraichir(message) {
  try { await rechargerEtat(); } catch (e) { toast(e.message); }
  rendre();
  if (message) toast(message);
}

/* Écrans hors espace marchand (connexion, paiement) : pas de recherche ni de badge « Démo », lien vers l'accueil. */
function modeHorsEspace() {
  document.body.classList.add('hors-espace');
  const fil = document.getElementById('fil');
  if (fil) { fil.innerHTML = '<a class="marque-retour" href="/">← Comptoir</a>'; }
}

/* ---------- Connexion et inscription ---------- */
function installerConnexion() {
  modeHorsEspace();
  const jetonReinit = new URLSearchParams(location.search).get('reinitialiser');
  const etatForm = { onglet: jetonReinit ? 'reinit' : new URLSearchParams(location.search).get('connexion') ? 'connexion' : 'inscription', erreur: '', envoi: false, info: '' };
  let formuleChoisie = null;
  try { formuleChoisie = sessionStorage.getItem('comptoir-formule'); } catch { /* ignoré */ }
  document.querySelector('.cote').hidden = true;
  // La saisie survit aux rendus (erreur du serveur, envoi, changement d'onglet) : rien n'est à retaper.
  etatForm.saisie = etatForm.saisie || {};
  const rendreAuth = function () {
    const f = document.getElementById('form-auth');
    if (f) for (const el of f.elements) if (el.name) etatForm.saisie[el.name] = el.value;
    rendreFormAuth();
    const nf = document.getElementById('form-auth');
    if (nf) for (const el of nf.elements) if (el.name && etatForm.saisie[el.name] !== undefined && (el.type !== 'password' || etatForm.ongletSaisie === etatForm.onglet)) el.value = etatForm.saisie[el.name];
    etatForm.ongletSaisie = etatForm.onglet;
  };
  const rendreFormAuth = function () {
    const ins = etatForm.onglet === 'inscription';
    if (etatForm.onglet === 'oubli' || etatForm.onglet === 'reinit') {
      const oubli = etatForm.onglet === 'oubli';
      $('#vue').innerHTML = `<div class="assistant carte connexion">
        <span class="eyebrow">Comptoir</span><h1>${oubli ? 'Mot de passe oublié' : 'Nouveau mot de passe'}</h1>
        <form id="form-auth" class="assistant-corps">
          ${oubli ? '<label class="champ"><span>E-mail du compte</span><input name="email" type="email" required autocomplete="email"></label>' : '<label class="champ"><span>Nouveau mot de passe (10 caractères minimum)</span><input name="motDePasse" type="password" required minlength="10" autocomplete="new-password"></label>'}
          ${etatForm.erreur ? `<p class="encart alerte-encart">${esc(etatForm.erreur)}</p>` : ''}${etatForm.info ? `<p class="encart">${esc(etatForm.info)}</p>` : ''}
          <button class="btn" ${etatForm.envoi ? 'disabled' : ''}>${oubli ? 'Recevoir un lien' : 'Enregistrer et me connecter'}</button>
        </form>
        <button class="bouton-lien" data-cx="connexion">Retour à la connexion</button></div>`;
      return;
    }
    $('#vue').innerHTML = `<div class="assistant carte connexion">
      <span class="eyebrow">Comptoir</span>
      <h1>${ins ? 'Créez votre boutique' : 'Connexion'}</h1>
      ${ins ? `<p class="sous">${formuleChoisie ? `Formule choisie : <b>${esc({ lancement: 'Lancement', croissance: 'Croissance', pro: 'Pro' }[formuleChoisie] || formuleChoisie)}</b>. ` : ''}Étape 1 sur 2 : votre compte et votre boutique. Étape 2 : le paiement de l’abonnement, puis l’accès à votre espace.</p>` : ''}
      <div class="onglets plein"><button class="${ins ? 'actif' : ''}" data-cx="inscription">Créer un compte</button><button class="${ins ? '' : 'actif'}" data-cx="connexion">Se connecter</button></div>
      <form id="form-auth" class="assistant-corps">
        ${ins ? `<label class="champ"><span>Nom de la boutique</span><input id="cx-nom" name="nom" required maxlength="80" placeholder="ex. Lacustre"></label>
        <div class="deux"><label class="champ"><span>Niche</span><select id="cx-secteur" name="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${k === 'maison' ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
        <label class="champ"><span>Modèle</span><select id="cx-modele" name="modele"><option value="drop">Dropshipping</option><option value="stock">Mes propres produits</option><option value="mixte">Les deux</option></select></label></div>
        <label class="champ"><span>Pays</span><select id="cx-pays" name="pays"><option value="ch">Suisse</option><option value="fr">France</option><option value="be">Belgique</option></select></label>` : ''}
        <label class="champ"><span>E-mail</span><input id="cx-email" name="email" type="email" required autocomplete="email"></label>
        <label class="champ"><span>Mot de passe${ins ? ' (10 caractères minimum)' : ''}</span><input id="cx-mdp" name="motDePasse" type="password" required minlength="${ins ? 10 : 1}" autocomplete="${ins ? 'new-password' : 'current-password'}"></label>
        ${etatForm.erreur ? `<p class="encart alerte-encart">${esc(etatForm.erreur)}</p>` : ''}
        <button class="btn" ${etatForm.envoi ? 'disabled' : ''}>${etatForm.envoi ? 'Un instant…' : ins ? 'Continuer vers le choix de la formule' : 'Se connecter'}</button>
      </form>
      ${ins ? '' : '<button class="bouton-lien" data-cx="oubli">Mot de passe oublié ?</button>'}
      ${ins ? '<p class="sous">Votre boutique est créée avec un design, des pages et, en dropshipping, les meilleurs produits du catalogue fournisseurs pour votre niche. Vous pourrez tout modifier.</p>' : ''}
    </div>`;
  };
  rendre = rendreAuth;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cx]');
    if (b) { etatForm.onglet = b.dataset.cx; etatForm.erreur = ''; etatForm.info = ''; rendre(); }
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'form-auth') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const d = Object.fromEntries(new FormData(e.target));
    etatForm.envoi = true; etatForm.erreur = ''; rendre();
    try {
      if (etatForm.onglet === 'oubli') {
        await api('POST', '/api/auth/oubli', { email: d.email });
        etatForm.envoi = false; etatForm.info = 'Si un compte existe pour cette adresse, un lien valable 1 heure vient de partir. Pensez à vérifier les indésirables.'; rendre();
        return;
      } else if (etatForm.onglet === 'reinit') {
        await api('POST', '/api/auth/reinitialiser', { jeton: jetonReinit, motDePasse: d.motDePasse });
        history.replaceState(null, '', location.pathname);
      } else if (etatForm.onglet === 'connexion') {
        await api('POST', '/api/auth/connexion', { email: d.email, motDePasse: d.motDePasse });
      } else {
        const nom = d.nom.trim();
        const pays = d.pays;
        const theme = pays === 'ch' ? 'leman' : 'craie';
        const config = {
          boutique: { nom, secteur: d.secteur, slogan: '', theme: { ...THEMES[theme], id: theme }, sections: sectionsParDefaut(nom, d.secteur, pays), domaine: null, publiee: true, pays, modele: d.modele, langues: ['fr'] },
          entreprise: { raison: nom, forme: pays === 'ch' ? 'Raison individuelle' : pays === 'be' ? 'Personne physique' : 'Micro-entreprise', siret: '', tvaIntra: '', adresse: '', email: d.email, regime: pays === 'ch' ? 'ch-non' : 'franchise', mediateur: '' },
          magasin: { actif: false, adresse: '', horaires: '', clickCollect: false, googleSync: false },
          reglages: { autoTransmission: true, cpa: 8 }
        };
        // Produits d'exemple (modèles « stock » et « mixte ») : masqués et « à vérifier » tant que le marchand n'a pas confirmé
        // qu'il les possède (prix, stock, photo). Jamais le même nom qu'un produit du catalogue fournisseur.
        const nomsCatalogue = new Set(CATALOGUE.filter(f => f.niche === d.secteur).map(f => f.nom.toLowerCase()));
        const propres = d.modele === 'drop' ? [] : produitsDepuisSecteur(d.secteur).filter(p => !nomsCatalogue.has(p.nom.toLowerCase())).slice(0, d.modele === 'mixte' ? 2 : 6)
          .map(({ id, ...p }) => ({ ...p, description: `${p.nom}. ${p.description} Exemple de fiche : remplacez ce texte, la photo, le prix et le stock par les vôtres.`, type: 'stock', actif: false, aVerifier: true }));
        let importer = [];
        if (d.modele !== 'stock') {
          etat = { boutique: config.boutique, entreprise: config.entreprise, produits: [], commandes: [], reglages: config.reglages };
          // Produits stars de la niche pour le mois en cours (saison, demande de référence, marge, délai) : jamais de Chine au départ.
          importer = Tendances.classer(CATALOGUE.filter(f => f.niche === d.secteur && f.entrepot !== 'CN'), { mois: new Date().getMonth(), pays, profils: PROFILS_SAISON, marge: f => potentielProduit(f).marge })
            .slice(0, d.modele === 'mixte' ? 3 : 5).map(x => x.p.id);
        }
        await api('POST', '/api/auth/inscription', { email: d.email, motDePasse: d.motDePasse, config, produits: propres, importer });
      }
      location.hash = 'tableau';
      location.reload();
    } catch (err) {
      etatForm.envoi = false; etatForm.erreur = err.message; rendre();
    }
  }, true);
}

/* ---------- Avant l'accès : choix de la formule et paiement ---------- */
function installerAbonnement(etatAbo, retour) {
  modeHorsEspace();
  document.querySelector('.cote').hidden = true;
  const e = { formules: [], devise: 'CHF', choisie: null, envoi: false, erreur: retour === 'annule' ? 'Le paiement a été annulé. Vous pouvez réessayer quand vous voulez.' : '' };
  try { e.choisie = sessionStorage.getItem('comptoir-formule'); } catch { /* ignoré */ }
  const prix = (f) => e.devise === 'CHF' ? `CHF ${f.prix}.–` : `${f.prix} €`;
  rendre = function () {
    const titre = etatAbo.statut === 'impaye' ? 'Votre dernier paiement n’est pas passé' : etatAbo.statut === 'resilie' ? 'Votre abonnement est terminé' : 'Plus qu’une étape : choisissez votre formule';
    const texte = etatAbo.statut === 'impaye' ? 'Mettez à jour votre moyen de paiement pour rouvrir votre boutique et votre espace.' : etatAbo.statut === 'resilie' ? 'Vos données sont conservées : reprenez un abonnement pour rouvrir votre boutique.' : 'Votre boutique est prête mais pas encore en ligne. Dès le paiement, vous accédez à votre espace : modifications du site, commandes, tableau de bord. Uniquement votre boutique.';
    $('#vue').innerHTML = `<div class="abonnement-page">
      <div class="abonnement-tete"><span class="eyebrow">Comptoir · ${esc(SERVEUR.email || '')}</span><h1>${titre}</h1><p class="sous">${texte}</p></div>
      ${e.erreur ? `<p class="encart alerte-encart">${esc(e.erreur)}</p>` : ''}
      <div class="plans">${e.formules.map(f => `<label class="plan choix-plan ${e.choisie === f.id ? 'conseille' : ''}">
        <input type="radio" name="formule" value="${f.id}" ${e.choisie === f.id ? 'checked' : ''} data-abo="formule">
        <span class="eyebrow">${f.id === 'croissance' ? 'Le plus choisi' : '&nbsp;'}</span><h2>${esc(f.nom)}</h2><p class="sous">${esc(f.resume)}</p>
        <div class="prix"><strong>${prix(f)}</strong><span class="sous">par mois</span></div>
        <ul>${f.inclus.map(x => `<li>${esc(x)}</li>`).join('')}</ul></label>`).join('')}</div>
      <div class="abonnement-pied">
        <button class="btn" data-abo="payer" ${!e.choisie || e.envoi ? 'disabled' : ''}>${e.envoi ? 'Redirection vers le paiement…' : e.choisie ? `Payer ${prix(e.formules.find(f => f.id === e.choisie) || { prix: 0 })} et ouvrir ma boutique` : 'Choisissez une formule'}</button>
        <p class="sous">Sans engagement : résiliable à tout moment dans Paramètres, l’accès reste ouvert jusqu’à la fin du mois payé. 0 % de commission sur vos ventes. ${SERVEUR.paiement === 'stripe' ? 'Paiement sécurisé par carte (Stripe).' : 'Mode test : aucun montant n’est débité.'}</p>
        <p class="sous"><button class="lien-bouton" data-abo="deconnexion">Se déconnecter</button></p>
        <details class="sous"><summary>Supprimer mon compte</summary><p>Le compte, la boutique préparée et ses produits sont supprimés définitivement.</p>
          <form data-form="supprimer-compte" class="rangee"><input type="password" name="motDePasse" placeholder="Votre mot de passe" required autocomplete="current-password" aria-label="Mot de passe"><button class="btn petit fantome danger-doux">Supprimer définitivement</button></form></details>
      </div></div>`;
  };
  document.addEventListener('change', ev => { if (ev.target.dataset.abo === 'formule') { e.choisie = ev.target.value; try { sessionStorage.setItem('comptoir-formule', e.choisie); } catch { /* ignoré */ } rendre(); const r = document.querySelector(`input[data-abo="formule"][value="${e.choisie}"]`); if (r) r.focus(); } });
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-abo]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'LABEL') return;
    if (b.dataset.abo === 'deconnexion') { await api('POST', '/api/auth/deconnexion').catch(() => {}); location.href = '/'; return; }
    if (b.dataset.abo === 'payer' && e.choisie) {
      e.envoi = true; e.erreur = ''; rendre();
      try { const r = await api('POST', '/api/abonnement/commencer', { formule: e.choisie }); location.href = r.url; }
      catch (err) { e.envoi = false; e.erreur = err.message; rendre(); }
    }
  });
  api('GET', '/api/abonnement').then(r => {
    e.formules = r.formules; e.devise = r.devise;
    if (!r.formules.some(f => f.id === e.choisie)) e.choisie = r.formule || 'croissance';
    rendre();
  }).catch(err => { e.erreur = err.message; rendre(); });
  rendre();
}

/* ---------- Mode connecté : chaque action passe par le serveur ---------- */
function installerModeConnecte() {
  // La configuration (design, sections, entreprise, magasin, campagnes…) est envoyée après chaque modification.
  sauver = function () {
    clearTimeout(ENREGISTREMENT.minuterie);
    ENREGISTREMENT.minuterie = setTimeout(envoyerConfig, 600);
  };
  // Fermeture de l’onglet juste après une modification : on l’envoie quand même.
  addEventListener('pagehide', () => { if (ENREGISTREMENT.minuterie) { clearTimeout(ENREGISTREMENT.minuterie); fetch('/api/admin/config', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: configActuelle() }) }); } });

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
  // Domaine personnalisé : instructions DNS et vérification.
  const domainesOrig = vueDomaines;
  vueDomaines = function () {
    const d = etat.boutique.domaine;
    const hote = location.hostname;
    const carte = d && d.domaine ? `<section class="carte"><div class="carte-tete"><h2>Votre domaine : <span class="mono">${esc(d.domaine)}</span></h2>${d.actif ? '<span class="pill good">Actif</span>' : '<span class="pill warn">En attente du DNS</span>'}</div>
      ${d.actif ? `<p>Votre boutique répond sur <a class="lien" href="https://${esc(d.domaine)}/" target="_blank" rel="noopener">https://${esc(d.domaine)}/</a>. Les e-mails et les liens de paiement l’utilisent.</p>`
        : `<ol class="appris"><li>Réservez le domaine chez un registrar (par exemple Infomaniak, Gandi ou OVH).</li><li>Dans sa zone DNS, créez un enregistrement <b>CNAME</b> nommé <span class="mono">www</span> (ou la racine si votre registrar le permet) vers <span class="mono">${esc(hote)}</span>.</li><li>Revenez ici et cliquez sur « Vérifier ». La propagation peut prendre quelques heures.</li></ol>
          <p class="sous">Preuve de propriété : ajoutez aussi un enregistrement <b>TXT</b> nommé <span class="mono">_comptoir.${esc(d.domaine)}</span> avec la valeur <span class="mono">comptoir=${esc(SERVEUR.jetonDomaine || '')}</span>.</p>
          <div class="rangee"><button class="btn" data-srv="verifier-dns">Vérifier le DNS</button></div>`}</section>` : '';
    return carte + domainesOrig();
  };


  // Clics : on intercepte avant les gestionnaires de la démo (phase de capture).
  document.addEventListener('click', async e => {
    const srv = e.target.closest('[data-srv]');
    if (srv && srv.dataset.srv === 'deconnexion') { await api('POST', '/api/auth/deconnexion'); location.reload(); return; }
    if (srv && srv.dataset.srv === 'dispo') {
      srv.disabled = true;
      const pill = document.querySelector(`[data-dispo="${CSS.escape(srv.dataset.d)}"]`);
      try {
        const r = await api('GET', `/api/admin/domaine/disponible?d=${encodeURIComponent(srv.dataset.d)}`);
        if (pill) { pill.className = 'pill ' + ({ libre: 'good', pris: 'muted', inconnu: 'warn' }[r.etat]); pill.textContent = { libre: 'Libre', pris: 'Déjà pris', inconnu: 'Registre injoignable' }[r.etat]; }
        if (r.etat !== 'inconnu') srv.remove(); else srv.disabled = false;
      } catch (err) { srv.disabled = false; toast(err.message); }
      return;
    }
    if (srv && srv.dataset.srv === 'verifier-dns') {
      srv.disabled = true;
      try { const r = await api('POST', '/api/admin/domaine/verifier'); await rafraichir(`Domaine actif : ${r.url}`); } catch (err) { srv.disabled = false; toast(err.message); }
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    const bloquer = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if ((action === 'statut' || action === 'supprimer-produit') && !confirmerAction(el)) { bloquer(); return; }
    // Une action qui écrit ne peut pas partir deux fois en même temps (double clic, réseau lent).
    const verrou = ['statut', 'supprimer-produit', 'importer-produit', 'encaisser', 'as-creer', 'transmettre-partie'].includes(action) ? `${action}:${id || ''}` : null;
    if (verrou && ACTIONS_EN_COURS.has(verrou)) { bloquer(); return; }
    if (verrou) ACTIONS_EN_COURS.add(verrou);
    try {
      if (action === 'statut') {
        bloquer(); el.disabled = true;
        const r = await api('POST', `/api/admin/commandes/${encodeURIComponent(id)}/statut`, { statut: el.dataset.statut, ...(el.dataset.fournisseurAnnule === '1' ? { fournisseurAnnule: true } : {}) });
        await rafraichir(`Commande n° ${r.commande.numero} : ${STATUTS[r.commande.statut].nom.toLowerCase()}.`);
      } else if (action === 'transmettre-partie') {
        bloquer(); el.disabled = true;
        const r = await api('POST', `/api/admin/commandes/${encodeURIComponent(id)}/transmettre`, {});
        await rafraichir(`Commande n° ${r.commande.numero} : partie fournisseur transmise.`);
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
        // Clé unique du ticket : le serveur n'enregistre jamais deux fois la même vente.
        ui.cleTicket = ui.cleTicket || `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        const r = await api('POST', '/api/admin/caisse', { lignes: ui.caisse.map(l => ({ produitId: l.produitId, qte: l.qte })), moyen: el.dataset.moyen, cle: ui.cleTicket });
        ui.caisse = []; ui.recuCaisse = ''; ui.cleTicket = null; await rafraichir(`Vente de ${r.total} encaissée. Facture ${r.facture}.`);
      } else if (action === 'as-creer') {
        bloquer();
        await recreerBoutique();
      } else if (action === 'reset' || action === 'demo') {
        bloquer();
      }
    } catch (err) { el.disabled = false; toast(err.message); }
    finally { if (verrou) ACTIONS_EN_COURS.delete(verrou); }
  }, true);

  // Fiche produit : création ou mise à jour en base (une seule fois, même en cas de double clic).
  document.addEventListener('submit', async e => {
    if (e.target.dataset.form !== 'produit') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (ACTIONS_EN_COURS.has('produit')) return;
    ACTIONS_EN_COURS.add('produit');
    const bouton = e.target.querySelector('button.btn:not(.fantome)');
    if (bouton) bouton.disabled = true;
    const d = new FormData(e.target);
    const p = { ...ui.produitEdite, nom: d.get('nom'), description: d.get('description'), prix: Number(d.get('prix')), stock: Number(d.get('stock')), cout: d.get('cout') === '' || d.get('cout') === null ? undefined : Number(d.get('cout')), categorie: d.get('categorie'), actif: d.get('actif') === 'on', aVerifier: false, prixReference: Number(d.get('prixReference')) || null, tauxReduit: d.get('tauxReduit') === 'on' };
    try {
      if (etat.produits.find(x => x.id === p.id)) await api('PUT', `/api/admin/produits/${encodeURIComponent(p.id)}`, { produit: p });
      else await api('POST', '/api/admin/produits', { produit: p });
      ui.produitEdite = null; await rafraichir(`« ${p.nom} » enregistré.`);
    } catch (err) { toast(err.message); if (bouton) bouton.disabled = false; }
    finally { ACTIONS_EN_COURS.delete('produit'); }
  }, true);

  // Notes internes : enregistrées en base quelques instants après la frappe.
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.champ !== 'note') return;
    const id = t.dataset.id;
    // La note est aussi gardée dans l'état local : un rendu entre-temps ne la remet pas à l'ancienne valeur.
    const c = etat.commandes.find(x => x.id === id); if (c) c.note = t.value;
    NOTES_EN_ATTENTE.valeurs[id] = t.value;
    clearTimeout(NOTES_EN_ATTENTE.minuteries[id]);
    NOTES_EN_ATTENTE.minuteries[id] = setTimeout(() => envoyerNote(id), 700);
  }, true);

  // Photos : les fiches sont créées en base.
  document.addEventListener('change', async e => {
    if (e.target.id !== 'photo-input') return;
    e.stopImmediatePropagation();
    const fichiers = [...e.target.files].filter(f => f.type.startsWith('image/')).slice(0, 12);
    e.target.value = '';
    let n = 0; const refus = [];
    for (const [i, f] of fichiers.entries()) {
      let image;
      try { image = await reduireImage(f); } catch { refus.push(f.name); continue; }   // HEIC ou fichier illisible
      try {
        await api('POST', '/api/admin/produits', { produit: { ...ficheDepuisPhoto(f.name, etat.produits.length + i), stock: 5, teinte: Math.floor(Math.random() * 360), actif: false, image, aVerifier: true, type: 'stock' } });
        n++;
      } catch (err) { refus.push(`${f.name} (${err && err.message ? err.message : 'refusée'})`); }
    }
    await rafraichir(messagePhotos(n, refus));
  }, true);

  // Les nouvelles commandes de la boutique publique apparaissent toutes seules.
  // Toutes les 15 s, une signature de quelques octets ; l'état complet n'est rechargé que s'il a changé.
  let signature = null;
  setInterval(async () => {
    if (document.hidden || ui.produitEdite || ['editeur', 'creer'].includes(ui.route)) return;
    let s;
    try { s = JSON.stringify(await api('GET', '/api/admin/signature')); } catch { return; }
    if (signature === null) { signature = s; return; }
    if (s === signature) return;
    signature = s;
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
  config.boutique = { ...config.boutique, nom, secteur: a.secteur, theme: { ...THEMES[a.theme], id: a.theme }, sections: sectionsParDefaut(nom, a.secteur, a.pays), pays: a.pays, devise: a.pays === 'ch' ? 'CHF' : 'EUR', modele: a.modele };
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

// Retour du réseau : on renvoie tout de suite ce qui attend ; quitter la page avec une modification non enregistrée est signalé.
addEventListener('online', () => { if (ENREGISTREMENT.echecs || ENREGISTREMENT.minuterie) envoyerConfig(); });
addEventListener('beforeunload', e => { if (SERVEUR.connecte && (ENREGISTREMENT.echecs || ENREGISTREMENT.minuterie || ENREGISTREMENT.enCours)) { e.preventDefault(); e.returnValue = ''; } });
