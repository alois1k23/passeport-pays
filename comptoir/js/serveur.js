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
  if (rep.status === 402 && SERVEUR.connecte && !SERVEUR.lectureSeule && !chemin.startsWith('/api/abonnement')) { location.reload(); }
  if (!rep.ok) { const e = new Error(json.erreur || `Erreur ${rep.status}`); e.statut = rep.status; throw e; }
  // Le serveur répond de nouveau : une modification restée en échec part tout de suite.
  if (typeof ENREGISTREMENT !== 'undefined' && ENREGISTREMENT.echecs && !ENREGISTREMENT.enCours && chemin !== '/api/admin/config') setTimeout(envoyerConfig, 0);
  return json;
}

async function initServeur() {
  if (!/^https?:$/.test(location.protocol) || location.pathname.startsWith('/demo')) return;
  let s;
  try {
    let rep;
    try { rep = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' }); }
    catch (err) {
      // Application installée ouverte hors connexion : on le dit, au lieu d'afficher la démo ou l'inscription.
      if (location.pathname.startsWith('/app') && !navigator.onLine) {
        document.body.innerHTML = '<main class="page-erreur"><h1>Pas de connexion</h1><p>Comptoir a besoin d’Internet pour afficher vos commandes et vos produits. La page se recharge dès que la connexion revient.</p></main>';
        addEventListener('online', () => location.reload());
        await new Promise(() => {});   // rien d'autre ne démarre
      }
      throw err;
    }
    if (!rep.ok || !(rep.headers.get('content-type') || '').includes('application/json')) return;
    s = await rep.json();
    if (typeof s.connecte !== 'boolean') return;
  } catch { return; }
  Object.assign(SERVEUR, s, { actif: true });
  // Application installable (PWA) : manifeste et service worker, seulement servis par Comptoir (pas en démo hors ligne).
  if (location.pathname.startsWith('/app')) {
    document.head.insertAdjacentHTML('beforeend', '<link rel="manifest" href="/app.webmanifest"><meta name="theme-color" content="#0D1016"><link rel="apple-touch-icon" href="/img/icone-192.png">');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/app' }).catch(() => { /* facultatif */ });
  }
  const params = new URLSearchParams(location.search);
  const formuleUrl = params.get('formule');
  if (formuleUrl) { try { sessionStorage.setItem('comptoir-formule', formuleUrl); } catch { /* ignoré */ } }
  // Retour de Stripe Checkout : le paiement est vérifié tout de suite (le webhook peut arriver quelques secondes plus tard).
  if (SERVEUR.connecte && s.abonnement && !s.abonnement.actif && params.get('abonnement') === 'ok') {
    for (let i = 0; i < 4 && !s.abonnement.actif; i++) {
      try { s.abonnement = await api('POST', '/api/abonnement/verifier'); } catch { /* nouvel essai */ }
      if (!s.abonnement.actif) await new Promise(ok => setTimeout(ok, 2000));
    }
    SERVEUR.abonnement = s.abonnement;
  }
  // Abonnement terminé ou impayé : consultation et export en lecture seule, sur demande (bouton de l'écran des formules).
  let lecture = false; try { lecture = sessionStorage.getItem('comptoir-lecture') === '1'; } catch { /* ignoré */ }
  if (SERVEUR.connecte && s.abonnement && !s.abonnement.actif && lecture && ['resilie', 'impaye'].includes(s.abonnement.statut)) {
    SERVEUR.lectureSeule = true;
    await rechargerEtat(); installerModeConnecte();
    sauver = function () { toast('Lecture seule : reprenez un abonnement pour modifier votre boutique.'); };
    document.querySelector('.colonne').insertAdjacentHTML('afterbegin', `<div class="encart alerte-encart bandeau-lecture" role="status"><b>Lecture seule.</b> Votre abonnement est terminé : vos commandes, factures et clients restent consultables et exportables (Paramètres > Données) pendant 12 mois, et les commandes déjà payées peuvent encore être expédiées ou remboursées. <button class="lien-bouton" data-lecture="reprendre">Reprendre un abonnement</button></div>`);
    document.addEventListener('click', e => { if (e.target.closest('[data-lecture="reprendre"]')) { try { sessionStorage.removeItem('comptoir-lecture'); } catch { /* ignoré */ } location.reload(); } });
    return;
  }
  // Membre de l'équipe et abonnement de la boutique inactif : c'est au propriétaire d'agir.
  if (SERVEUR.connecte && s.role && s.role !== 'proprietaire' && s.abonnement && !s.abonnement.actif) {
    $('#vue').innerHTML = '<div class="assistant carte connexion"><span class="eyebrow">Comptoir</span><h1>Boutique en pause</h1><p class="sous">L’abonnement de cette boutique n’est pas actif. Seul son propriétaire peut le reprendre : prévenez-le.</p></div>';
    return;
  }
  if (SERVEUR.connecte && s.abonnement && !s.abonnement.actif) { installerAbonnement(s.abonnement, params.get('abonnement')); return; }
  if (SERVEUR.connecte) {
    await rechargerEtat(); installerModeConnecte();
    // Rôle « commandes » : la boutique ne se modifie pas depuis ce compte (les réglages ne sont pas envoyés).
    if (SERVEUR.role === 'commandes') sauver = function () { /* lecture des réglages seulement */ };
    if (params.get('abonnement') === 'ok') { history.replaceState(null, '', location.pathname + '#tableau'); setTimeout(() => toast(String((etat.entreprise || {}).adresse || '').trim() && !/compléter/.test((etat.entreprise || {}).adresse || '') ? 'Paiement reçu : votre boutique est en ligne. Bienvenue !' : 'Paiement reçu. Dernière étape avant vos premières ventes : l’adresse de votre entreprise (Conformité).'), 300); }
  } else if (typeof afficherInvitation === 'function' && await afficherInvitation()) { /* invitation affichée */ }
  else installerConnexion();
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
  SERVEUR.emails = e.serveur.emails || null; SERVEUR.creeLe = e.serveur.creeLe || null; SERVEUR.abonnement = e.serveur.abonnement || null; SERVEUR.jetonDomaine = e.serveur.jetonDomaine || null; SERVEUR.paiementsBoutique = e.serveur.paiementsBoutique || null;
  // Lien d'activation Stripe expiré (?relancer=1) : un nouveau lien est demandé et ouvert directement.
  if (/[?&]relancer=1/.test(location.search) && SERVEUR.paiementsBoutique && !SERVEUR.paiementsBoutique.pret) {
    history.replaceState(null, '', location.pathname + '?section=paiements' + location.hash);   // une seule fois, pas à chaque rechargement
    api('POST', '/api/admin/paiements/activer').then(r => { if (r.url) location.href = r.url; }).catch(() => {});
  }
  // Retour de la page d'activation Stripe : l'état du compte est relu une fois (le webhook peut arriver un peu plus tard).
  { const pb = SERVEUR.paiementsBoutique; if (pb && pb.mode === 'stripe' && pb.compte && !pb.pret) api('GET', '/api/admin/paiements/etat').then(r => { if (r.pret) { SERVEUR.paiementsBoutique = r; rendre(); } }).catch(() => {}); } SERVEUR.urlBoutique = e.serveur.urlBoutique || null;
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
    if (etatForm.onglet === '2fa') {
      // Second facteur : code de l'application d'authentification, ou code de secours.
      $('#vue').innerHTML = `<div class="assistant carte connexion">
        <span class="eyebrow">Comptoir</span><h1>Code de vérification</h1>
        <p class="sous">Saisissez le code à 6 chiffres de votre application d’authentification, ou un code de secours.</p>
        <form id="form-auth" class="assistant-corps">
          <label class="champ"><span>Code</span><input name="code" required autocomplete="one-time-code" maxlength="12" autofocus autocapitalize="off" spellcheck="false"></label>
          ${etatForm.erreur ? `<p class="encart alerte-encart" role="alert">${esc(etatForm.erreur)}</p>` : ''}
          <button class="btn" ${etatForm.envoi ? 'disabled' : ''}>Vérifier</button>
        </form>
        <button class="bouton-lien" data-cx="connexion">Retour</button></div>`;
      return;
    }
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
      ${ins || !ClesAcces.disponible() ? '' : '<div class="separateur-ou" role="separator"><span>ou</span></div><button class="btn fantome plein-largeur" data-cle-acces="connexion">Se connecter avec une clé d’accès</button>'}
      ${ins ? '' : '<button class="bouton-lien" data-cx="oubli">Mot de passe oublié ?</button>'}
      ${ins ? '<p class="sous">Votre boutique est créée avec un design, des pages et, en dropshipping, les meilleurs produits du catalogue fournisseurs pour votre niche. Vous pourrez tout modifier.</p>' : ''}
    </div>`;
  };
  rendre = rendreAuth;
  document.addEventListener('click', async e => {
    if (!e.target.closest('[data-cle-acces="connexion"]')) return;
    etatForm.erreur = ''; etatForm.envoi = true; rendre();
    try { await ClesAcces.connexion(); location.hash = 'tableau'; location.reload(); }
    catch (err) { etatForm.envoi = false; etatForm.erreur = ClesAcces.messageErreur(err); rendre(); }
  });
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
        const r = await api('POST', '/api/auth/reinitialiser', { jeton: jetonReinit, motDePasse: d.motDePasse });
        history.replaceState(null, '', location.pathname);
        // Compte qui exigeait une clé d'accès : aucune session ouverte par le lien, il faut se reconnecter avec le nouveau mot de passe.
        if (r && r.differe) { etatForm.onglet = 'connexion'; etatForm.envoi = false; etatForm.erreur = `Votre compte n’accepte que la clé d’accès : par sécurité, le nouveau mot de passe prendra effet le ${new Date(r.differe).toLocaleString('fr-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Si vous retrouvez votre clé, connectez-vous avec elle : la demande est annulée. Un e-mail vous l’explique.`; rendre(); return; }
        if (r && r.reconnexion) { etatForm.onglet = 'connexion'; etatForm.envoi = false; etatForm.erreur = 'Mot de passe changé, clés d’accès supprimées : connectez-vous avec votre nouveau mot de passe.'; rendre(); return; }
      } else if (etatForm.onglet === '2fa') {
        await api('POST', '/api/auth/connexion/2fa', { defi: etatForm.defi, code: d.code });
      } else if (etatForm.onglet === 'connexion') {
        const r = await api('POST', '/api/auth/connexion', { email: d.email, motDePasse: d.motDePasse });
        if (r.deuxFacteurs) { etatForm.defi = r.defi; etatForm.onglet = '2fa'; etatForm.envoi = false; rendre(); document.querySelector('input[name="code"]')?.focus(); return; }
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
      etatForm.envoi = false; etatForm.erreur = err.message;
      if (etatForm.onglet === '2fa' && /reconnectez-vous|Délai dépassé/i.test(err.message)) etatForm.onglet = 'connexion';   // défi expiré : retour au mot de passe
      rendre();
      document.querySelector('#form-auth input:not([type=hidden])')?.focus();
    }
  }, true);
}

/* ---------- Avant l'accès : choix de la formule et paiement ---------- */
function installerAbonnement(etatAbo, retour) {
  modeHorsEspace();
  document.querySelector('.cote').hidden = true;
  const e = { formules: [], devise: 'CHF', choisie: null, envoi: false, erreur: retour === 'annule' ? 'Le paiement a été annulé. Vous pouvez réessayer quand vous voulez.' : retour === 'ok' ? 'Votre paiement est en cours de confirmation par Stripe. Rechargez la page dans une minute : inutile de payer une seconde fois.' : '' };
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
        <span class="eyebrow">${f.id === 'croissance' ? 'Conseillé pour démarrer' : '&nbsp;'}</span><h2>${esc(f.nom)}</h2><p class="sous">${esc(f.resume)}</p>
        <div class="prix"><strong>${prix(f)}</strong><span class="sous">par mois</span></div>
        <ul>${f.inclus.map(x => `<li>${esc(x)}</li>`).join('')}</ul></label>`).join('')}</div>
      <div class="abonnement-pied">
        <button class="btn" data-abo="payer" ${!e.choisie || e.envoi ? 'disabled' : ''}>${e.envoi ? 'Redirection vers le paiement…' : e.choisie ? `Payer ${prix(e.formules.find(f => f.id === e.choisie) || { prix: 0 })} et ouvrir ma boutique` : 'Choisissez une formule'}</button>
        <p class="sous">Sans engagement : résiliable à tout moment dans Paramètres, l’accès reste ouvert jusqu’à la fin du mois payé. 0 % de commission sur vos ventes. ${SERVEUR.paiement === 'stripe' ? 'Paiement sécurisé par carte (Stripe).' : 'Mode test : aucun montant n’est débité.'}</p>
        ${['resilie', 'impaye'].includes(etatAbo.statut) ? '<p class="sous"><button class="btn fantome" data-abo="lecture">Consulter et exporter mes données (lecture seule)</button></p>' : ''}
        <p class="sous"><button class="lien-bouton" data-abo="deconnexion">Se déconnecter</button></p>
        <details class="sous"><summary>Supprimer mon compte</summary><p>Le compte, la boutique préparée et ses produits sont supprimés définitivement.</p>
          <form data-form="supprimer-compte" class="rangee"><input type="password" name="motDePasse" placeholder="Votre mot de passe" required autocomplete="current-password" aria-label="Mot de passe"><button class="btn petit fantome danger-doux">Supprimer définitivement</button></form></details>
      </div></div>`;
  };
  document.addEventListener('change', ev => { if (ev.target.dataset.abo === 'formule') { e.choisie = ev.target.value; try { sessionStorage.setItem('comptoir-formule', e.choisie); } catch { /* ignoré */ } rendre(); const r = document.querySelector(`input[data-abo="formule"][value="${e.choisie}"]`); if (r) r.focus(); } });
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-abo]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'LABEL') return;
    if (b.dataset.abo === 'lecture') { try { sessionStorage.setItem('comptoir-lecture', '1'); } catch { /* ignoré */ } location.reload(); return; }
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
        // Expédition : le numéro de suivi du transporteur (facultatif), transmis au client dans l'e-mail.
        let suivi = '';
        // (sauf pour une commande que le fournisseur expédie lui-même : c'est lui qui donne le numéro)
        const cmdC = (etat.commandes || []).find(x => x.id === id);
        if (el.dataset.statut === 'expediee' && !(cmdC && cmdC.statut === 'fournisseur')) {
          const s = prompt('Numéro de suivi du colis (facultatif) :', '');
          if (s === null) { bloquer(); return; }   // annulé : rien ne part, ni ici ni dans le mode démo
          suivi = s.trim();
        }
        bloquer(); el.disabled = true;
        const r = await api('POST', `/api/admin/commandes/${encodeURIComponent(id)}/statut`, { statut: el.dataset.statut, ...(suivi ? { suivi } : {}), ...(el.dataset.fournisseurAnnule === '1' ? { fournisseurAnnule: true } : {}) });
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
        const carte = String(ui.carteCaisse || '').trim();
        if (carte && !(ui.carteCaisseInfo && ui.carteCaisseInfo.code === carte)) { toast('Vérifiez d’abord la carte cadeau : son solde est déduit avant d’encaisser le reste.'); return; }
        // Vente avec carte restée sans réponse (coupure réseau) : elle a peut-être été enregistrée. Un nouveau ticket sans
        // cette carte n'est créé qu'après confirmation (sinon le client paierait deux fois).
        if (ui.cleTicketCarte && ui.cleTicketCarte === ui.cleTicket && !carte) {
          if (!confirm('La vente précédente avec carte cadeau n’a pas reçu de réponse : elle a peut-être été enregistrée. Vérifiez dans Commandes. Encaisser malgré tout ce ticket comme une nouvelle vente ?')) return;
          ui.cleTicket = null; ui.cleTicketCarte = null;
        }
        const ticket = { lignes: ui.caisse.map(l => ({ produitId: l.produitId, qte: l.qte, ...(l.varianteId ? { varianteId: l.varianteId } : {}) })), moyen: el.dataset.moyen, cle: ui.cleTicket, ...(carte ? { carteCadeau: carte } : {}) };
        let r;
        try { r = await api('POST', '/api/admin/caisse', ticket); }
        catch (err) {
          // Le solde d'une carte cadeau se vérifie en ligne : sans réseau, la vente n'est pas gardée (encaisser autrement).
          // Avec une carte : jamais mise en file hors ligne. Même ticket (même clé) à renvoyer : aucun risque de double vente.
          if (carte && !(err.statut && err.statut < 500)) { ui.cleTicketCarte = ui.cleTicket; toast('Pas de réponse du serveur : la vente avec carte cadeau n’est peut-être pas enregistrée. Touchez à nouveau le même bouton dès le retour du réseau (elle ne sera pas comptée deux fois).'); return; }
          // Pas de réseau (marché, sous-sol) ou serveur indisponible : la vente est gardée sur l'appareil et envoyée plus tard.
          // La clé du ticket empêche tout doublon quand elle repart.
          if (err.statut && err.statut < 500) throw err;
          const resume = ui.caisse.map(l => `${l.qte} × ${l.nom}`).join(', '), totalHL = Math.round(ui.caisse.reduce((a, l) => a + l.prix * l.qte, 0) * 100) / 100;
          if (!CaisseHorsLigne.ajouter({ ...ticket, resume, total: totalHL, le: Date.now() })) {
            // Rien n'a pu être gardé : le ticket reste affiché, le marchand le note à la main.
            alert(`Pas de connexion, et cet appareil n’a plus de place pour garder la vente.\n\nNotez-la à la main : ${resume} (${euros(totalHL)}, ${new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}).\nLe ticket reste affiché.`);
            return;
          }
          ui.caisse = []; ui.recuCaisse = ''; ui.cleTicket = null;
          toast('Pas de connexion : la vente est gardée sur cet appareil et sera envoyée dès le retour du réseau.'); rendre(); return;
        }
        ui.caisse = []; ui.recuCaisse = ''; ui.cleTicket = null; ui.carteCaisse = ''; ui.carteCaisseInfo = null; ui.cleTicketCarte = null;
        if (r.carteCadeau) ui.cartesCadeaux = null;   // soldes à recharger
        ui.emplacements = null;   // répartition du stock à recharger
        await rafraichir(r.carteCadeau ? `Vente de ${r.total} : ${r.carteCadeau} sur la carte cadeau (solde restant ${r.soldeCarte})${r.reste ? `, ${r.reste} à encaisser` : ', rien d’autre à encaisser'}. Facture ${r.facture}.` : `Vente de ${r.total} encaissée. Facture ${r.facture}.`);
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

  // Les nouvelles commandes apparaissent toutes seules : flux en direct (Server-Sent Events), le serveur prévient dès
  // qu'une commande arrive ou change. Sans flux (proxy qui le coupe, navigateur ancien) : signature toutes les 15 s.
  let signature = null, enAttente = false, nonVues = 0;
  const dejaNotifiees = new Set();   // hors de « etat », qui est remplacé à chaque rechargement
  const titreDeBase = document.title;
  const appliquer = async (nouvelles = []) => {
    if (ui.produitEdite || ui.devisEdition || ['editeur', 'creer'].includes(ui.route)) { enAttente = true; return; }   // pas pendant une saisie (fiche produit, devis)
    enAttente = false;
    const avant = etat.commandes.length, statuts = etat.commandes.map(c => c.statut).join();
    try { await rechargerEtat(); } catch { return; }
    if (etat.commandes.length === avant && etat.commandes.map(c => c.statut).join() === statuts) return;
    ui.devisListe = null;   // une nouvelle commande peut venir d'un devis accepté : liste à recharger
    rendre();
    const payees = nouvelles.filter(n => !dejaNotifiees.has(n.numero));
    if (payees.length) {
      payees.forEach(n => dejaNotifiees.add(n.numero));
      const texte = payees.length === 1 ? `Nouvelle commande n° ${payees[0].numero} : ${euros(Number(payees[0].total) || 0)}` : `${payees.length} nouvelles commandes payées`;
      toast(texte);
      if (document.hidden) {
        nonVues += payees.length; document.title = `(${nonVues}) ${titreDeBase}`;
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const options = { body: texte, tag: 'comptoir-commande', icon: '/img/icone-192.png', badge: '/img/icone-192.png' };
            // Via le service worker quand il est là (obligatoire sur Android ; un clic ramène sur les commandes)
            if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification('Comptoir', options));
            else new Notification('Comptoir', options);
          }
        } catch { /* ignoré */ }
      }
    } else if (etat.commandes.length > avant) toast(`Nouvelle commande reçue (${etat.commandes.length - avant}).`);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { nonVues = 0; document.title = titreDeBase; } });
  setInterval(() => { if (enAttente) appliquer(); }, 3000);
  let echecsFlux = 0, flux = null;
  const ouvrirFlux = () => {
    if (!('EventSource' in window)) return false;
    flux = new EventSource('/api/admin/flux');
    flux.addEventListener('pret', () => { echecsFlux = 0; ui.enDirect = true; });
    flux.addEventListener('maj', e => { let d = {}; try { d = JSON.parse(e.data); } catch { /* ignoré */ } appliquer(d.nouvelles || []); });
    flux.addEventListener('fin', () => { flux.close(); ui.enDirect = false; });   // session terminée
    flux.onerror = () => { ui.enDirect = false; if (++echecsFlux >= 5) { flux.close(); flux = null; } };
    // Proxy qui retient le flux (le message « pret » n'arrive jamais) : on passe à l'interrogation régulière.
    setTimeout(() => { if (flux && !ui.enDirect && flux.readyState !== 2) { flux.close(); flux = null; } }, 10000);
    return true;
  };
  ouvrirFlux();
  setInterval(async () => {
    if (flux && flux.readyState === 1) return;   // le flux en direct s'en charge
    if (document.hidden) return;
    let s;
    try { s = JSON.stringify(await api('GET', '/api/admin/signature')); } catch { return; }
    if (signature === null) { signature = s; return; }
    if (s === signature) return;
    signature = s;
    appliquer();
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

/* Caisse hors ligne : ventes en attente gardées dans ce navigateur, envoyées au retour du réseau (avec leur clé unique). */
const CaisseHorsLigne = (() => {
  const cle = () => `comptoir-caisse-attente-${SERVEUR.slug || ''}`;
  const lire = () => { try { return JSON.parse(localStorage.getItem(cle()) || '[]'); } catch { return []; } };
  // Renvoie false si l'écriture n'a pas tenu (stockage plein ou bloqué) : la vente n'est alors PAS gardée.
  const ecrire = l => { try { localStorage.setItem(cle(), JSON.stringify(l)); return localStorage.getItem(cle()) === JSON.stringify(l); } catch { return false; } };
  let envoi = false;
  async function envoyer() {
    if (envoi || !SERVEUR.connecte || !navigator.onLine) return;
    const attente = lire(); if (!attente.length) return;
    envoi = true; let reussies = 0;
    try {
      for (const t of attente) {
        if (!lire().some(x => x.cle === t.cle)) continue;   // retirée par le marchand pendant l'envoi
        try {
          await api('POST', '/api/admin/caisse', { lignes: t.lignes, moyen: t.moyen, cle: t.cle, horsLigneLe: t.le, totalAttendu: t.total });
          ecrire(lire().filter(x => x.cle !== t.cle)); reussies++;
        } catch (err) {
          // Pas de réseau, session expirée, abonnement, limite de requêtes : passager, on réessaiera sans rien signaler comme refusé.
          if (!err.statut || err.statut >= 500 || [401, 402, 403, 408, 429].includes(err.statut)) break;
          ecrire(lire().map(x => x.cle === t.cle ? { ...x, erreur: err.message } : x));   // vrai refus (données invalides) : gardée et signalée, jamais perdue
        }
      }
    } finally { envoi = false; }
    if (reussies) { toast(`${reussies} vente${reussies > 1 ? 's' : ''} hors ligne envoyée${reussies > 1 ? 's' : ''}.`); if (typeof rechargerEtat === 'function') { await rechargerEtat(); rendre(); } }
  }
  addEventListener('online', () => envoyer());
  setInterval(envoyer, 30000);
  setTimeout(envoyer, 3000);
  return { ajouter: t => ecrire([...lire(), t]), lire, envoyer, retirer: c => ecrire(lire().filter(x => x.cle !== c)) };
})();
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action="caisse-attente-envoyer"], [data-action="caisse-attente-retirer"]'); if (!el) return;
  if (el.dataset.action === 'caisse-attente-retirer') { if (!confirm('Retirer cette vente de la file ? Elle ne sera pas enregistrée (à saisir à la main si l’argent a été encaissé).')) return; CaisseHorsLigne.retirer(el.dataset.cle); }
  else await CaisseHorsLigne.envoyer();
  rendre();
});

/* Facture électronique (XML EN 16931, ou PDF Factur-X qui le contient) : téléchargée seulement si le serveur l'a produite ;
   sinon, ce qui manque est affiché. */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action="facture-xml"]'); if (!el) return;
  try {
    const r = await fetch(`/api/admin/commandes/${encodeURIComponent(el.dataset.id)}/${el.dataset.format === 'pdf' ? 'facture-pdf' : 'facture-electronique'}${el.dataset.avoir ? '?avoir=1' : ''}`, { credentials: 'same-origin' });
    if (!r.ok) { let m = 'Téléchargement impossible.'; try { m = (await r.json()).erreur || m; } catch { /* ignoré */ } toast(m); return; }
    const nom = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || (el.dataset.format === 'pdf' ? 'facture.pdf' : 'facture.xml');
    const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
    a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast('Pas de connexion : réessayez dans un instant.'); }
});

/* Journal inaltérable : état rapide, vérification complète (côté serveur, par lots) et export CSV pour l'archivage. */
async function chargerEtatJournal() {
  ui.journalEtatEnCours = true;
  try { const r = await fetch('/api/admin/journal-inalterable', { credentials: 'same-origin' }); if (r.ok) { ui.journalEtat = await r.json(); ui.journalEtatErreur = null; } else ui.journalEtatErreur = 'État du journal indisponible pour l’instant.'; }
  catch { ui.journalEtatErreur = 'Pas de connexion : état du journal indisponible.'; }
  finally { ui.journalEtatEnCours = false; ui.journalEtatLe = Date.now(); }   // succès ou échec : pas de nouvel essai avant 30 s
  if (location.hash.startsWith('#conformite')) rendre();
}
async function verifierJournal(ancre) {
  ui.journalVerifEnCours = true; rendre();
  try {
    const r = await fetch('/api/admin/journal-inalterable/verifier', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ancre ? { ancre } : {}) });
    const j = await r.json().catch(() => ({}));
    ui.journalVerif = r.ok ? j : { erreur: j.erreur || 'Vérification impossible pour l’instant.' };
  } catch { ui.journalVerif = { erreur: 'Pas de connexion : vérification impossible pour l’instant.' }; }
  finally { ui.journalVerifEnCours = false; }
  await chargerEtatJournal();
  toast(ui.journalVerif.erreur ? ui.journalVerif.erreur : ui.journalVerif.ancreOk === false ? 'Empreinte introuvable dans le journal.' : ui.journalVerif.ok ? 'Journal vérifié : intact.' : `${ui.journalVerif.nbAnomalies} anomalie(s) détectée(s).`);
}
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form="journal-ancre"]'); if (!f) return;
  e.preventDefault(); verifierJournal(String(new FormData(f).get('ancre') || '').trim());
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action="journal-verifier"], [data-action="journal-exporter"]'); if (!el) return;
  if (el.dataset.action === 'journal-verifier') { await verifierJournal(); return; }
  try {
    const r = await fetch('/api/admin/journal-inalterable/export', { credentials: 'same-origin' });
    if (!r.ok) { toast('Export impossible pour l’instant.'); return; }
    const nom = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'journal-inalterable.csv';
    const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
    a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast('Pas de connexion : réessayez dans un instant.'); }
});

/* Cartes cadeaux : liste, émission (le code n'est gardé qu'en mémoire, le temps de le noter), désactivation. */
async function chargerCartesCadeaux() {
  ui.cartesEnCours = true;
  try { ui.cartesCadeaux = await api('GET', '/api/admin/cartes-cadeaux'); } catch (err) { ui.cartesCadeaux = { cartes: [], registreCoherent: true }; toast(`Cartes cadeaux indisponibles : ${err.message}`); }
  finally { ui.cartesEnCours = false; }
  if (location.hash.startsWith('#magasin')) rendre();
}
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'carte-cadeau') return;
  e.preventDefault();
  const d = new FormData(e.target), bouton = e.target.querySelector('button');
  bouton.disabled = true;
  try {
    ui.carteEmise = await api('POST', '/api/admin/cartes-cadeaux', { montant: Number(d.get('montant')), expireMois: d.get('expireMois') ? Number(d.get('expireMois')) : null, destinataire: d.get('destinataire') || null });
    ui.cartesCadeaux = null; rendre();
  } catch (err) { toast(err.message); bouton.disabled = false; }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action^="carte-"]'); if (!el) return;
  if (el.dataset.action === 'carte-masquer') { ui.carteEmise = null; rendre(); return; }
  if (el.dataset.action === 'carte-imprimer' && ui.carteEmise) {
    // Impression dans une fenêtre dédiée, sans script ni style en ligne (politique de sécurité).
    const w = window.open('', '_blank', 'width=480,height=360'); if (!w) { toast('Autorisez les fenêtres pour imprimer.'); return; }
    const doc = w.document, corps = doc.body, nom = (etat.boutique && etat.boutique.nom) || '';
    doc.title = 'Carte cadeau';
    for (const [balise, texte] of [['h1', `Carte cadeau ${nom}`], ['p', `Montant : ${euros(ui.carteEmise.carte.initial)}`], ['p', `Code : ${ui.carteEmise.code}`], ['p', ui.carteEmise.carte.expireLe ? `Valable jusqu’au ${new Date(ui.carteEmise.carte.expireLe).toLocaleDateString('fr-FR')}` : 'Sans date limite'], ['p', 'À utiliser en ligne ou en boutique.']]) { const n = doc.createElement(balise); n.textContent = texte; corps.appendChild(n); }
    w.print(); return;
  }
  if (el.dataset.action === 'carte-desactiver') {
    if (!confirm('Désactiver cette carte ? Son solde ne pourra plus être utilisé.')) return;
    try { await api('POST', `/api/admin/cartes-cadeaux/${encodeURIComponent(el.dataset.id)}/desactiver`, {}); ui.cartesCadeaux = null; toast('Carte désactivée.'); rendre(); }
    catch (err) { toast(err.message); }
  }
});

/* Caisse : solde de la carte cadeau lu avant d'encaisser (monnaie à rendre calculée sur le reste). */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action="caisse-carte-verifier"]'); if (!el) return;
  const code = String(ui.carteCaisse || '').trim(); if (!code) { toast('Saisissez le code de la carte.'); return; }
  el.disabled = true;
  try { const r = await api('POST', '/api/admin/caisse/carte', { code }); ui.carteCaisseInfo = { code, solde: r.solde, fin: r.fin }; }
  catch (err) { ui.carteCaisseInfo = null; toast(err.message); }
  rendre();
});
