/* Comptoir — parcours d'entrée de la démonstration (sans serveur), comme sur la vraie plateforme :
   accueil (présentation, formules, questions) → choix de la formule → compte → paiement → création de la boutique
   → tableau de bord. La formule choisie s'applique ensuite (fonctions réservées verrouillées).
   Démonstration : rien n'est envoyé, aucun moyen de paiement n'est demandé ; tout reste dans ce navigateur.
   Sur un vrai serveur, ce parcours est fait par accueil.html, l'inscription et Stripe (js/serveur.js). */

const CLE_PARCOURS = 'comptoir-parcours';
function lireParcours() { try { return JSON.parse(localStorage.getItem(CLE_PARCOURS) || 'null'); } catch { return null; } }
function ecrireParcours(p) { try { localStorage.setItem(CLE_PARCOURS, JSON.stringify(p)); } catch { /* navigation privée : le parcours vaut pour cette visite */ } PARCOURS_MEMOIRE = p; }
let PARCOURS_MEMOIRE = null;
function parcoursCourant() { return lireParcours() || PARCOURS_MEMOIRE; }

/* Parcours à afficher ? Jamais avec un compte réel, ni sur la page /demo du serveur (démo directe). */
function parcoursActif() {
  if (typeof SERVEUR !== 'undefined' && (SERVEUR.actif || SERVEUR.connecte)) return false;
  if (/^\/demo/.test(location.pathname)) return false;
  const p = parcoursCourant();
  return !p || !['fini', 'demo', 'creation'].includes(p.etape);
}

const PAYS_PARCOURS = { ch: { nom: 'Suisse', devise: 'CHF' }, fr: { nom: 'France', devise: 'EUR' }, be: { nom: 'Belgique', devise: 'EUR' } };
const prixParcours = (id, devise) => Formules.prixTexte(id, devise);

function installerParcours() {
  const rendreApp = rendre;
  document.body.classList.add('hors-espace', 'parcours');
  const cote = document.querySelector('.cote'); if (cote) cote.hidden = true;
  const fil = document.getElementById('fil');
  const p = parcoursCourant() || { etape: 'accueil' };
  const e = { etape: p.etape || 'accueil', formule: p.formule || 'croissance', pays: p.pays || 'ch', email: p.email || '', erreur: '', envoi: false };
  const sauverEtape = () => ecrireParcours({ etape: e.etape, formule: e.formule, pays: e.pays, email: e.email });
  const devise = () => PAYS_PARCOURS[e.pays].devise;

  function vueAccueil() {
    const plans = Formules.ORDRE.map(id => {
      const f = Formules.FORMULES[id];
      return `<article class="plan ${id === 'croissance' ? 'conseille' : ''}">
        <span class="eyebrow">${id === 'croissance' ? 'Conseillé pour démarrer' : '&nbsp;'}</span><h3>${esc(f.nom)}</h3><p class="sous">${esc(f.resume)}</p>
        <div class="prix"><strong>${prixParcours(id, devise())}</strong><span class="sous">par mois</span></div>
        <ul>${f.inclus.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <button class="btn ${id === 'croissance' ? '' : 'fantome'}" data-parcours="choisir" data-v="${id}">Choisir ${esc(f.nom)}</button></article>`;
    }).join('');
    return `<div class="parcours-page">
      <section class="parcours-hero">
        <span class="eyebrow">Suisse · France · Belgique</span>
        <h1>Votre boutique en ligne, prête à vendre, avec la marge nette sous les yeux.</h1>
        <p class="intro">Lancez votre boutique en dropshipping ou avec vos propres produits. Comptoir calcule votre marge nette avant chaque vente, transmet les commandes aux fournisseurs, et prépare vos publications pour les réseaux sociaux.</p>
        <div class="rangee"><a class="btn" href="#formules" data-parcours="defiler">Voir les formules</a><button class="btn fantome" data-parcours="demo">Explorer la démo sans compte</button></div>
        <p class="sous">0 % de commission sur vos ventes · TWINT en Suisse, Bancontact en Belgique, cartes partout · sans engagement</p>
      </section>
      <section class="parcours-bloc"><h2>Comment ça marche</h2>
        <ol class="parcours-etapes">
          <li><b>1. Choisissez votre formule</b><span>Trois formules, un prix fixe par mois, résiliable à tout moment.</span></li>
          <li><b>2. Créez votre compte et payez</b><span>Paiement sécurisé ; votre espace s'ouvre aussitôt.</span></li>
          <li><b>3. Créez votre boutique</b><span>Nom, activité, style et domaine : votre site est prêt en quelques minutes.</span></li>
          <li><b>4. Vendez et pilotez</b><span>Commandes, clients, marges, campagnes : tout dans votre tableau de bord.</span></li>
        </ol></section>
      <section class="parcours-bloc"><h2>Ce que fait Comptoir</h2>
        <div class="parcours-fonctions">
          <div><b>Boutique et éditeur</b><span>Un site rapide sur ordinateur et téléphone, des thèmes, vos sections, votre domaine.</span></div>
          <div><b>Dropshipping sans surprise</b><span>Catalogue de fournisseurs, délais et frais d'importation affichés, commandes transmises automatiquement.</span></div>
          <div><b>Marge nette réelle</b><span>Prix d'achat, port, frais de paiement et publicité déduits avant que vous fixiez un prix.</span></div>
          <div><b>Conformité par pays</b><span>Impressum suisse, mentions légales françaises et belges, factures et TVA selon votre régime.</span></div>
          <div><b>Vendre plus (Croissance)</b><span>Codes promo, remises par quantité, e-mails automatiques, copilote de saison, publications préparées, API et webhooks.</span></div>
          <div><b>Magasin et caisse (Pro)</b><span>Un seul stock pour le site et vos ventes en personne, retrait en magasin.</span></div>
        </div></section>
      <section class="parcours-bloc" id="formules"><h2>Les formules</h2>
        <div class="rangee parcours-pays" role="group" aria-label="Pays de votre entreprise">${Object.entries(PAYS_PARCOURS).map(([k, v]) => `<button class="btn petit ${e.pays === k ? '' : 'fantome'}" data-parcours="pays" data-v="${k}" aria-pressed="${e.pays === k}">${v.nom}</button>`).join('')}</div>
        <div class="plans">${plans}</div>
        <p class="sous">${e.pays === 'ch' ? 'Prix en francs suisses, par mois.' : 'Prix en euros, par mois.'} Prix finaux : la TVA éventuelle est indiquée dans les conditions. Aucun essai gratuit : vous payez le premier mois, puis vous pouvez résilier quand vous voulez (accès jusqu'à la fin du mois payé).</p>
      </section>
      <section class="parcours-bloc"><h2>Questions fréquentes</h2>
        <details><summary>Comptoir prend-il une commission sur mes ventes ?</summary><p>Non. Vous payez votre formule ; les ventes sont versées sur votre propre compte de paiement. Seuls les frais du prestataire de paiement s'appliquent.</p></details>
        <details><summary>Puis-je changer de formule ?</summary><p>Oui, à tout moment dans Paramètres > Abonnement. À la hausse, les fonctions s'ouvrent tout de suite ; à la baisse, vos réglages sont gardés.</p></details>
        <details><summary>Les réseaux sociaux sont-ils publiés automatiquement ?</summary><p>Comptoir prépare le calendrier et les textes ; vous les relisez et les publiez en un geste. La publication automatique arrive avec la connexion des API officielles des réseaux.</p></details>
        <details><summary>Que se passe-t-il si j'arrête ?</summary><p>Votre boutique reste ouverte jusqu'à la fin du mois payé, puis elle est fermée aux clients. Vous pouvez exporter vos commandes et vos clients.</p></details>
      </section>
      <p class="parcours-note sous">Démonstration : rien n'est envoyé ni débité, tout reste dans ce navigateur.</p>
    </div>`;
  }

  function vueCompte() {
    const f = Formules.FORMULES[e.formule];
    return `<div class="parcours-page etroite">
      <ol class="etapes"><li class="fait">Formule</li><li class="actif">Compte</li><li>Paiement</li><li>Boutique</li></ol>
      <section class="carte parcours-carte">
        <h1>Créez votre compte</h1>
        <p class="sous">Formule <b>${esc(f.nom)}</b> · ${prixParcours(e.formule, devise())} par mois · <button class="lien-bouton" data-parcours="retour">changer</button></p>
        ${e.erreur ? `<p class="encart alerte-encart" role="alert">${esc(e.erreur)}</p>` : ''}
        <form data-parcours-form="compte" class="pile" novalidate>
          <label class="champ"><span>E-mail</span><input name="email" type="email" required autocomplete="email" value="${esc(e.email)}"></label>
          <label class="champ"><span>Mot de passe (10 caractères au moins)</span><input name="mdp" type="password" required minlength="10" autocomplete="new-password"></label>
          <label class="champ"><span>Pays de votre entreprise</span><select name="pays">${Object.entries(PAYS_PARCOURS).map(([k, v]) => `<option value="${k}" ${e.pays === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
          <label class="case"><input name="cgu" type="checkbox" required> J'accepte les conditions d'utilisation de Comptoir.</label>
          <button class="btn">Continuer vers le paiement</button>
        </form>
        <p class="sous">Démonstration : le mot de passe n'est ni envoyé ni gardé.</p>
      </section></div>`;
  }

  function vuePaiement() {
    const f = Formules.FORMULES[e.formule];
    return `<div class="parcours-page etroite">
      <ol class="etapes"><li class="fait">Formule</li><li class="fait">Compte</li><li class="actif">Paiement</li><li>Boutique</li></ol>
      <section class="carte parcours-carte">
        <h1>Paiement de votre abonnement</h1>
        <div class="parcours-recap"><div><b>Comptoir ${esc(f.nom)}</b><span class="sous">${esc(e.email)} · ${PAYS_PARCOURS[e.pays].nom}</span></div><strong>${prixParcours(e.formule, devise())}<small> / mois</small></strong></div>
        <ul class="sous">${f.inclus.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="encart">Sur Comptoir, cette étape ouvre la page de paiement sécurisée de Stripe (carte). <b>Ici, c'est une démonstration : aucun moyen de paiement n'est demandé et rien n'est débité.</b></p>
        <div class="rangee"><button class="btn" data-parcours="payer" ${e.envoi ? 'disabled' : ''}>${e.envoi ? 'Paiement en cours…' : `Payer ${prixParcours(e.formule, devise())} (démonstration)`}</button><button class="btn fantome" data-parcours="retour-compte">Retour</button></div>
        <p class="sous">Sans engagement : résiliable à tout moment, l'accès reste ouvert jusqu'à la fin du mois payé.</p>
      </section></div>`;
  }

  rendre = function () {
    if (fil) fil.innerHTML = '<button class="marque-retour lien-bouton" data-parcours="accueil">Comptoir</button>';
    $('#vue').innerHTML = e.etape === 'compte' ? vueCompte() : e.etape === 'paiement' ? vuePaiement() : vueAccueil();
  };

  function terminer(etape) {
    e.etape = etape; sauverEtape();
    document.removeEventListener('click', surClic, true);
    document.removeEventListener('submit', surEnvoi, true);
    document.body.classList.remove('hors-espace', 'parcours');
    if (cote) cote.hidden = false;
    rendre = rendreApp;
    if (etape === 'creation') {
      ui.assistant = { etape: 1, nom: '', secteur: 'maison', pays: e.pays, modele: 'drop', theme: 'leman', exemples: true, domaine: null };
      if (location.hash === '#creer') surHash(); else location.hash = 'creer';
    } else { if (location.hash === '#tableau') surHash(); else location.hash = 'tableau'; }
  }

  function surClic(ev) {
    const b = ev.target.closest('[data-parcours]');
    if (!b) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const a = b.dataset.parcours;
    if (a === 'defiler') { document.getElementById('formules')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (a === 'pays') { e.pays = b.dataset.v; sauverEtape(); rendre(); document.querySelector(`[data-parcours="pays"][data-v="${e.pays}"]`)?.focus(); return; }
    if (a === 'choisir') { e.formule = b.dataset.v; e.etape = 'compte'; e.erreur = ''; sauverEtape(); rendre(); window.scrollTo(0, 0); document.querySelector('input[name="email"]')?.focus(); return; }
    if (a === 'retour' || a === 'accueil') { e.etape = 'accueil'; e.erreur = ''; sauverEtape(); rendre(); window.scrollTo(0, 0); return; }
    if (a === 'retour-compte') { e.etape = 'compte'; sauverEtape(); rendre(); return; }
    if (a === 'demo') { terminer('demo'); toast('Démo ouverte : toutes les fonctions sont visibles. Revenez à l’accueil depuis Paramètres > Abonnement.'); return; }
    if (a === 'payer') {
      e.envoi = true; rendre();
      setTimeout(() => { e.envoi = false; toast(`Paiement reçu (démonstration) : formule ${Formules.FORMULES[e.formule].nom} active. Créez maintenant votre boutique.`); terminer('creation'); }, 700);
    }
  }
  function surEnvoi(ev) {
    const f = ev.target.closest('[data-parcours-form="compte"]');
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const d = new FormData(f);
    const email = String(d.get('email') || '').trim(), mdp = String(d.get('mdp') || '');
    e.erreur = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? 'Indiquez une adresse e-mail valable.' : mdp.length < 10 ? 'Le mot de passe doit faire au moins 10 caractères.' : !d.get('cgu') ? 'Acceptez les conditions d’utilisation pour continuer.' : '';
    e.email = email; e.pays = String(d.get('pays') || e.pays);
    if (e.erreur) { rendre(); document.querySelector('[role="alert"]')?.focus?.(); return; }
    e.etape = 'paiement'; sauverEtape(); rendre(); window.scrollTo(0, 0);
  }
  document.addEventListener('click', surClic, true);
  document.addEventListener('submit', surEnvoi, true);
  rendre();
}

/* La boutique créée après le paiement (appelé par creerBoutique) : le parcours est terminé. */
function finParcoursCreation() {
  const p = parcoursCourant();
  if (p && p.etape === 'creation') ecrireParcours({ ...p, etape: 'fini' });
}

/* Revenir à l'accueil (démonstration) : le parcours recommence. */
function recommencerParcours() { ecrireParcours({ etape: 'accueil' }); location.hash = ''; location.reload(); }

/* Démarrage : le parcours passe avant le tableau de bord tant qu'il n'est pas fait. */
{
  const demarrerOrigine = demarrer;
  demarrer = async function () {
    await initServeur();
    const p = parcoursCourant();
    if (parcoursActif()) { installerParcours(); return; }
    if (p && p.etape === 'creation' && !(typeof SERVEUR !== 'undefined' && SERVEUR.connecte)) {
      if (ui.assistant && ui.assistant.etape === 1 && !ui.assistant.nom) ui.assistant.pays = p.pays || ui.assistant.pays;
      if (location.hash !== '#creer') { location.hash = 'creer'; return; }
    }
    surHash();
  };
  void demarrerOrigine;
}
