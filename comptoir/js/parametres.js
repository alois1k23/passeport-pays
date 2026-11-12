/* Comptoir — paramètres : tout ce qui configure la boutique et le compte, au même endroit. */

const SECTIONS_PARAM = [['general', 'Général'], ['apparence', 'Apparence'], ['paiements', 'Paiements'], ['livraison', 'Livraison'], ['emails', 'E-mails'], ['domaine', 'Domaine'], ['abonnement', 'Abonnement'], ['donnees', 'Données'], ['securite', 'Sécurité'], ['integrations', 'Intégrations'], ['sensible', 'Zone sensible']];

function enLigne() { return typeof SERVEUR !== 'undefined' && SERVEUR.connecte; }

function vueParametres() {
  // Retour de la page d'activation Stripe (?section=paiements) : la bonne section s'ouvre.
  if (!ui.sectionParam) { try { const q = new URLSearchParams(location.search).get('section'); if (q && SECTIONS_PARAM.some(([k]) => k === q)) ui.sectionParam = q; } catch { /* ignoré */ } }
  const s = ui.sectionParam || 'general';
  const b = etat.boutique, e = etat.entreprise || {};
  const statut = (ok, oui, non) => `<span class="pill ${ok ? 'good' : 'warn'}">${ok ? oui : non}</span>`;
  let corps = '';
  if (s === 'general') corps = `
    <section class="carte"><div class="carte-tete"><h2>Boutique</h2></div>
      <div class="deux"><label class="champ"><span>Nom de la boutique</span><input id="pa-nom" value="${esc(b.nom)}" data-boutique="nom"></label>
      <label class="champ"><span>Slogan</span><input id="pa-slogan" value="${esc(b.slogan || '')}" data-boutique="slogan" placeholder="Une phrase qui résume votre boutique"></label></div>
      <div class="deux"><label class="champ"><span>E-mail de contact (affiché aux clients)</span><input id="pa-email" type="email" value="${esc(e.email || '')}" data-entreprise="email"></label>
      <div class="champ"><span>Pays et devise</span><p class="valeur">${({ ch: 'Suisse', fr: 'France', be: 'Belgique', ca: 'Canada' }[b.pays] || esc(b.pays))} · ${esc(b.devise || (b.pays === 'ch' ? 'CHF' : 'EUR'))}</p></div></div>
      <p class="sous">Les informations légales (raison sociale, IDE, TVA) se règlent dans <a class="lien" href="#conformite">Conformité</a>. Les langues et le design, dans l’<a class="lien" href="#editeur">éditeur du site</a>.</p></section>`;
  else if (s === 'apparence') {
    let t = 'auto'; try { t = localStorage.getItem('comptoir-theme') || 'auto'; } catch { /* ignoré */ }
    corps = `<section class="carte"><div class="carte-tete"><h2>Thème de l’interface</h2><span class="sous">sur cet appareil</span></div>
      <div class="choix-theme">${[['auto', 'Comme le système', 'auto'], ['light', 'Clair', 'soleil'], ['dark', 'Sombre', 'lune']].map(([k, n, ic]) => `<button class="${t === k ? 'actif' : ''}" data-action="theme-choix" data-v="${k}">${icone(ic, 18)}<span>${n}</span></button>`).join('')}</div>
      <p class="sous">Raccourci : la recherche s’ouvre avec <kbd>Ctrl</kbd> <kbd>K</kbd> (ou <kbd>⌘</kbd> <kbd>K</kbd> sur Mac).</p></section>`;
  } else if (s === 'paiements') {
    const stripe = enLigne() && SERVEUR.paiement === 'stripe';
    const pret = !!(SERVEUR.paiementsBoutique || {}).pret;   // compte Stripe de la boutique activé
    corps = `<section class="carte"><div class="carte-tete"><h2>Encaissement</h2>${statut(stripe && pret, 'Stripe actif', stripe ? 'À activer' : enLigne() ? 'Paiement simulé' : 'Démo')}</div>
      <div class="liste-reglages">
        <div><strong>TWINT</strong><span class="sous">Paiement mobile le plus utilisé en Suisse, uniquement en CHF.</span>${statut(stripe && pret && b.devise === 'CHF' && !!(SERVEUR.paiementsBoutique || {}).twint, 'Proposé', stripe && pret && b.devise === 'CHF' ? 'En cours de validation par Stripe' : 'Inactif')}</div>
        <div><strong>Cartes</strong><span class="sous">Visa, Mastercard et autres cartes acceptées par Stripe.</span>${statut(stripe && pret, 'Proposé', 'Inactif')}</div>
      </div>
      ${stripe ? (() => {
        const pb = SERVEUR.paiementsBoutique || {};
        return pb.pret
          ? '<p class="sous">Votre compte Stripe est actif : chaque vente est versée directement sur votre compte (Comptoir ne prend aucune commission ; seuls les frais de Stripe s’appliquent). Les remboursements partent depuis la fiche commande.</p>'
          : `<div class="alerte"><strong>Activez vos paiements pour ouvrir les commandes.</strong> Les ventes sont versées sur votre propre compte Stripe : Stripe vérifie votre identité et l’IBAN de votre entreprise (quelques minutes). Tant que ce n’est pas fait, la boutique est visible mais n’accepte pas de commande.</div>
             <div class="rangee"><button class="btn" data-action="activer-paiements">${pb.compte ? 'Terminer l’activation chez Stripe' : 'Activer les paiements avec Stripe'}</button></div>`;
      })() : ''}
      <p class="sous">${stripe ? '' : 'Le paiement en ligne n’est pas encore branché sur cette installation : il est simulé et aucun montant n’est débité. Il s’active quand l’exploitant de la plateforme relie Stripe (cartes, TWINT en Suisse, Bancontact en Belgique).'}</p></section>`;
    if (b.pays === 'ch') {
      const e = etat.entreprise || {}, ibanOk = typeof QrFacture !== 'undefined' && QrFacture.ibanValide(e.iban), qr = ibanOk && typeof QrFacture !== 'undefined' && QrFacture.estQrIban(e.iban);
      const actif = !!(etat.reglages && etat.reglages.factureQr);
      corps += `<section class="carte"><div class="carte-tete"><h2>Paiement sur facture QR</h2>${statut(actif && ibanOk, 'Proposé aux clients', actif ? 'IBAN à corriger' : 'Désactivé')}</div>
        <p class="sous">Vos clients suisses peuvent aussi payer sur facture : Comptoir émet une QR-facture (norme SIX), payable avec n’importe quelle application bancaire. Votre commande part dès réception du paiement ; importez votre relevé (camt.054) et les commandes payées se mettent à jour toutes seules.</p>
        <div class="grille-form"><label class="champ"><span>IBAN ou QR-IBAN de l’entreprise</span><input value="${esc(e.iban || '')}" data-entreprise="iban" placeholder="CH44 3199 9123 0008 8901 2" autocomplete="off" spellcheck="false"></label>
          <label class="champ"><span>Délai de paiement</span><select data-reglage="echeanceJours">${[10, 20, 30, 45, 60].map(n => `<option value="${n}" ${(etat.reglages && etat.reglages.echeanceJours || 30) === n ? 'selected' : ''}>${n} jours</option>`).join('')}</select></label></div>
        ${e.iban && !ibanOk ? '<p class="sous erreur-champ">IBAN invalide : vérifiez-le (21 caractères, commençant par CH ou LI).</p>' : ibanOk ? `<p class="sous">${qr ? 'QR-IBAN : références QR (QRR) que la banque rapproche automatiquement.' : 'IBAN : références créancier (RF…) ; pour un rapprochement automatique par la banque, demandez-lui un QR-IBAN.'}</p>` : ''}
        <label class="case"><input type="checkbox" data-reglage="factureQr" ${actif ? 'checked' : ''} ${ibanOk ? '' : 'disabled'}> Proposer le paiement sur facture QR</label>
        ${enLigne() ? '<div class="rangee"><label class="btn fantome petit importer">Importer un relevé bancaire (camt.054)<input type="file" id="import-camt" accept=".xml,application/xml,text/xml" hidden></label></div>' : ''}</section>`;
    }
  } else if (s === 'livraison') {
    const modes = Object.values(livraisonsPays(b.pays));
    corps = `<section class="carte sans-pad"><div class="carte-tete pad"><h2>Modes de livraison</h2><span class="sous">tarifs TTC facturés au client</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Mode</th><th>Délai (stock propre)</th><th class="num">Prix</th></tr></thead><tbody>
      ${modes.filter(m => m.transporteur || retraitPossible()).map(m => `<tr><td>${esc(m.nom)}</td><td class="sous">${esc(m.delai)}</td><td class="num">${m.prix ? euros(m.prix) : 'Gratuit'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pad-x pad-b"><p class="sous">Livraison offerte dès <b>${seuilPort() > 0 ? euros(seuilPort()) : 'jamais'}</b> (hors envoi express).</p>
        <label class="champ"><span>Livraison offerte dès (${devise()}, 0 = jamais)</span><input type="number" min="0" max="1000" step="5" value="${seuilPort()}" data-seuil></label>
        <p class="sous">Commandes passées après 14 h : expédiées le jour ouvrable suivant. Pour les produits en dropshipping, le délai affiché est celui du fournisseur.</p></div></section>`;
  } else if (s === 'emails') {
    const service = enLigne() ? SERVEUR.emails : null;
    const notif = typeof Notification === 'undefined' ? 'indisponible' : Notification.permission;
    const carteNotif = enLigne() ? `<section class="carte"><div class="carte-tete"><h2>Notifications sur cet appareil</h2>${statut(notif === 'granted', notif === 'granted' ? 'Activées' : notif === 'denied' ? 'Bloquées' : 'Inactives', 'Navigateur')}</div>
      <p class="sous">Une notification à chaque commande payée, même quand Comptoir est en arrière-plan. ${notif === 'denied' ? 'Vous les avez bloquées : autorisez-les dans les réglages du site de votre navigateur.' : notif === 'indisponible' ? 'Ce navigateur ne les propose pas. Sur iPhone : ajoutez d’abord Comptoir à l’écran d’accueil (Partager > Sur l’écran d’accueil).' : 'Installez aussi Comptoir comme une application (menu du navigateur > Installer) pour l’ouvrir en un geste.'}</p>
      ${notif === 'default' ? '<div class="rangee"><button class="btn" data-action="notif-activer">Activer les notifications</button></div>' : ''}</section>` : '';
    const rapport = !(etat.reglages && etat.reglages.rapportHebdo === false);
    const carteRapport = `<section class="carte"><div class="carte-tete"><h2>Rapport du lundi</h2>${statut(rapport, 'Actif', 'Inactif')}</div>
      <p class="sous">Chaque lundi matin, un e-mail résume votre semaine : chiffre d’affaires comparé à la semaine d’avant, meilleurs produits, commandes à expédier, factures QR échues, commandes à risque et ruptures de stock prévues.</p>
      <label class="case"><input type="checkbox" data-reglage="rapportHebdo" ${rapport ? 'checked' : ''}> Recevoir le rapport du lundi</label></section>`;
    corps = carteNotif + carteRapport + `<section class="carte"><div class="carte-tete"><h2>Envoi des e-mails</h2>${statut(!!service, service === 'brevo' ? 'Brevo actif' : service === 'postmark' ? 'Postmark actif' : 'Actif', enLigne() ? 'File d’attente' : 'Démo')}</div>
      <p class="sous">${service ? `Les e-mails partent automatiquement : confirmations, expéditions${fonctionIncluse('conversion') ? ', relances, avis, bienvenue' : ' (relances, avis et bienvenue : avec la formule Croissance)'}.` : 'Sans service d’envoi, les e-mails sont préparés et gardés en file, mais ne partent pas. Branchez Brevo (hébergé en Europe) ou Postmark sur le serveur pour les envoyer.'}</p>
      <div class="liste-reglages">${['Confirmation de commande', 'Colis expédié, avec suivi', 'Commande prête à retirer', 'Relance de paiement abandonné', 'Bienvenue (newsletter)', 'Demande d’avis', 'Reconquête des inactifs'].map((n, i) => `<div><strong>${n}</strong><span class="sous">${i < 3 ? (i === 2 && !retraitPossible() ? 'Envoyé si le retrait en magasin est activé' : 'Toujours envoyé (e-mail de service)') : fonctionIncluse('conversion') ? 'Réglable dans <a class="lien" href="#conversion">Conversion</a>' : 'Avec la formule Croissance'}</span></div>`).join('')}</div>
      ${enLigne() ? '<div class="rangee"><button class="btn petit fantome" data-action="voir-emails">Voir les derniers e-mails</button></div>' : ''}</section>`;
  } else if (s === 'domaine') {
    const d = b.domaine;
    corps = `<section class="carte"><div class="carte-tete"><h2>Adresse de la boutique</h2>${d && d.actif ? statut(true, 'Domaine actif', '') : d ? statut(false, '', 'DNS à configurer') : '<span class="pill muted">Adresse Comptoir</span>'}</div>
      <p class="mono">${esc(adresseBoutique())}</p>${d && d.domaine && enLigne() && !d.actif ? `<p class="sous">${esc(d.domaine)} : en attente de la vérification DNS.</p>` : ''}
      <div class="rangee"><a class="btn petit" href="#domaines">${d ? 'Gérer le domaine' : 'Choisir un domaine'}</a></div></section>`;
  } else if (s === 'abonnement') {
    const a = enLigne() && SERVEUR.abonnement;
    const demo = !enLigne() ? abonnementCourant() : null;
    if (demo) {
      // Démonstration avec le parcours d'entrée : la formule choisie s'applique, et peut changer ici.
      const f = Formules.FORMULES[demo.formule];
      corps = `<section class="carte"><div class="carte-tete"><h2>Formule ${esc(f.nom)}</h2><span class="pill good">Active (démo)</span></div>
        <p class="sous">${esc(Formules.prixTexte(demo.formule, demo.devise))} par mois. ${esc(f.resume)}.</p>
        <ul class="sous">${f.inclus.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="rangee">${Formules.ORDRE.filter(k => k !== demo.formule).map(k => `<button class="btn petit fantome" data-action="abo-changer" data-v="${k}">Passer à ${esc(Formules.FORMULES[k].nom)}</button>`).join('')}<a class="btn petit fantome" href="#offre">Comparer les formules</a></div>
        <p class="sous">Démonstration : aucun prélèvement. <button class="lien-bouton" data-action="parcours-recommencer">Recommencer depuis l’accueil</button></p></section>`;
    } else if (!a) {
      corps = `<section class="carte"><div class="carte-tete"><h2>Formule</h2><span class="pill muted">Démo</span></div>
        <p class="sous">Dans la démo libre, toutes les fonctions sont ouvertes. Sur Comptoir, vous choisissez une formule et payez avant d’accéder à votre espace : uniquement votre boutique et vos données.</p>
        <div class="rangee"><button class="btn petit" data-action="parcours-recommencer">Voir l’accueil et choisir une formule</button><a class="btn petit fantome" href="#offre">Comparer les formules</a></div></section>`;
    } else {
      const noms = { lancement: 'Lancement', croissance: 'Croissance', pro: 'Pro' };
      const prixAbo = a.prix ? (a.devise === 'CHF' ? `CHF ${a.prix}.– / mois` : `${a.prix} € / mois`) : '—';
      const fin = a.periodeFin ? new Date(a.periodeFin).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
      const pill = a.statut === 'impaye' ? '<span class="pill bad">Paiement en échec</span>' : a.finDemandee ? '<span class="pill warn">Résiliation demandée</span>' : '<span class="pill good">Actif</span>';
      corps = `<section class="carte"><div class="carte-tete"><h2>Votre abonnement</h2>${pill}</div>
        <div class="chiffres"><div><span class="sous">Formule</span><strong>${esc(noms[a.formule] || a.formule || '—')}</strong></div><div><span class="sous">Prix</span><strong>${prixAbo}</strong></div><div><span class="sous">${a.finDemandee ? 'Accès jusqu’au' : 'Prochain renouvellement'}</span><strong>${fin}</strong></div></div>
        <p class="sous">Sans commission sur vos ventes. ${a.prestataire === 'stripe' ? 'Paiement par carte via Stripe ; factures et moyen de paiement dans le portail Stripe.' : 'Mode test : renouvellement simulé, aucun montant débité.'}</p>
        ${a.finDemandee ? '' : `<div class="rangee">${Object.entries(noms).filter(([k]) => k !== a.formule).map(([k, n]) => `<button class="btn petit fantome" data-action="abo-changer" data-v="${k}">Passer à ${n}</button>`).join('')}<a class="btn petit fantome" href="#offre">Comparer les formules</a></div>`}
        <div class="rangee">${a.finDemandee ? '<button class="btn petit" data-action="abo-reprendre">Garder mon abonnement</button>' : '<button class="btn petit fantome danger-doux" data-action="abo-resilier">Résilier</button>'}</div>
        <p class="sous">${a.finDemandee ? `Votre boutique et votre espace restent ouverts jusqu’au ${fin}. Ensuite, la boutique est fermée aux clients ; vos données sont conservées et vous pouvez reprendre à tout moment.` : 'La résiliation prend effet à la fin du mois payé : rien n’est remboursé au prorata, rien n’est prélevé ensuite.'}</p></section>`;
    }
  } else if (s === 'donnees') {
    corps = `<section class="carte"><div class="carte-tete"><h2>Exporter vos données</h2></div>
      <p class="sous">Vos données vous appartiennent. L’export complet contient la boutique, les produits, les commandes, les clients, les avis et les réglages, au format JSON (lisible par d’autres outils). Les exports CSV des commandes et des clients sont dans leurs pages.</p>
      <div class="rangee"><button class="btn" data-action="export-complet">Exporter tout (JSON)</button><button class="btn fantome" data-action="export-commandes">Commandes (CSV)</button><button class="btn fantome" data-action="export-clients">Clients (CSV)</button></div></section>
      ${enLigne() ? '' : `<section class="carte"><div class="carte-tete"><h2>Restaurer une démo</h2></div><p class="sous">Importez un export JSON pour retrouver une boutique de démonstration dans ce navigateur.</p>
      <label class="btn fantome petit importer">Choisir un fichier<input type="file" id="import-json" accept="application/json" hidden></label></section>`}`;
  } else if (s === 'securite') {
    corps = enLigne() ? vueSecurite() : `<section class="carte"><div class="carte-tete"><h2>Sécurité du compte</h2><span class="pill muted">Démo</span></div>
      <p class="sous">Sur Comptoir : double authentification (application Google Authenticator, 1Password, Bitwarden…), codes de secours, liste des appareils connectés avec déconnexion à distance, journal d’activité et alerte par e-mail à chaque connexion depuis un nouvel appareil.</p></section>`;
  } else if (s === 'integrations') {
    corps = vueIntegrations();
  } else if (s === 'sensible') {
    corps = enLigne()
      ? `<section class="carte"><div class="carte-tete"><h2>Mot de passe et appareils</h2></div>
        <form data-form="changer-mdp" class="grille-form"><label class="champ"><span>Mot de passe actuel</span><input type="password" name="actuel" required autocomplete="current-password"></label>
          <label class="champ"><span>Nouveau mot de passe (10 caractères minimum)</span><input type="password" name="nouveau" required minlength="10" autocomplete="new-password"></label>
          <div class="rangee"><button class="btn">Changer le mot de passe</button><span class="sous">Les autres appareils connectés sont déconnectés.</span></div></form>
        <div class="rangee"><button class="btn fantome petit" data-action="deconnecter-autres">Déconnecter les autres appareils</button></div></section>
      <section class="carte zone-sensible"><div class="carte-tete"><h2>Supprimer le compte</h2></div>
        <p class="sous">Supprime définitivement la boutique, les produits, les commandes, les factures, les clients et les avis. Exportez vos données avant : vos factures doivent être conservées 10 ans.</p>
        <form data-form="supprimer-compte" class="rangee"><input type="password" name="motDePasse" placeholder="Votre mot de passe" required autocomplete="current-password" aria-label="Mot de passe"><button class="btn danger">Supprimer définitivement</button></form></section>`
      : `<section class="carte zone-sensible"><div class="carte-tete"><h2>Réinitialiser la démo</h2></div>
        <p class="sous">Efface les modifications faites dans ce navigateur et recharge la boutique de démonstration de Lausanne.</p>
        <div class="rangee"><button class="btn danger" data-action="reset">Réinitialiser la démo</button></div></section>`;
  }
  return `
  <div class="tete"><div><h1>Paramètres</h1><p class="sous">Boutique, paiements, livraison, e-mails, domaine, abonnement et données.</p></div></div>
  <div class="parametres">
    <nav class="param-nav" aria-label="Sections des paramètres">${SECTIONS_PARAM.map(([k, n]) => `<button class="${s === k ? 'actif' : ''}" data-action="section-param" data-v="${k}" ${s === k ? 'aria-current="page"' : ''}>${n}</button>`).join('')}</nav>
    <div class="param-corps">${corps}</div>
  </div>`;
}

function exporterTout() {
  const donnees = { exporteLe: new Date().toISOString(), application: 'Comptoir', ...etat };
  telechargerTexte(`comptoir-export-${slugifier(etat.boutique.nom)}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(donnees, null, 2), 'application/json', 'Export complet téléchargé.');
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'section-param') { ui.sectionParam = el.dataset.v; rendre(); }
  else if (a === 'theme-choix') { try { localStorage.setItem('comptoir-theme', el.dataset.v); } catch { /* ignoré */ } appliquerTheme(); rendre(); }
  else if (a === 'export-complet') exporterTout();
  else if (a === 'activer-paiements') {
    el.disabled = true;
    api('POST', '/api/admin/paiements/activer').then(r => {
      if (r.url) { location.href = r.url; return; }   // page d'activation de Stripe (identité, IBAN) ; retour ici ensuite
      SERVEUR.paiementsBoutique = { mode: 'stripe', pret: true, compte: true }; toast('Paiements actifs : votre boutique accepte les commandes.'); rendre();
    }).catch(err => { el.disabled = false; toast(err.message || 'Activation impossible pour le moment.'); });
  }
  else if (a === 'parcours-recommencer') { if (typeof recommencerParcours === 'function') recommencerParcours(); }
  else if (a === 'abo-changer' && !enLigne() && abonnementCourant() && typeof parcoursCourant === 'function') {
    // Démonstration : la formule change tout de suite, sans prélèvement.
    const f = Formules.FORMULES[el.dataset.v];
    if (!f || !confirm(`Passer à ${f.nom} (démonstration, aucun prélèvement) ?`)) return;
    ecrireParcours({ ...parcoursCourant(), formule: el.dataset.v });
    toast(`Formule ${f.nom} active.`); rendre();
  }
  else if (a === 'abo-changer' || a === 'abo-resilier' || a === 'abo-reprendre') {
    if (a === 'abo-resilier' && !confirm('Résilier l’abonnement ? Votre boutique reste ouverte jusqu’à la fin du mois payé.')) return;
    if (a === 'abo-changer') {
      const ab = SERVEUR.abonnement || {}, f = Formules.FORMULES[el.dataset.v];
      // Ce qui s'arrête tout de suite en descendant de formule (les réglages restent enregistrés).
      const DETAIL = { conversion: 'codes promo, remises par quantité, offres, campagnes, e-mails automatiques', magasin: 'caisse, retrait en magasin', social: 'les publications programmées repassent en brouillon à leur date' };
      const perdues = Object.keys(Formules.FONCTIONS).filter(k => Formules.permet(ab.formule, k) && !Formules.permet(el.dataset.v, k)).map(k => Formules.NOMS_FONCTIONS[k] + (DETAIL[k] ? ` (${DETAIL[k]})` : ''));
      const avert = perdues.length ? `\n\nS'arrêtent immédiatement :\n– ${perdues.join('\n– ')}\n\nVos réglages sont gardés et reviennent si vous reprenez la formule.` : '';
      if (f && !confirm(`Passer à ${f.nom} pour ${Formules.prixTexte(el.dataset.v, ab.devise)} par mois ? Le changement est immédiat ; ${ab.prestataire === 'stripe' ? (Formules.FORMULES[el.dataset.v].prix > Formules.FORMULES[ab.formule].prix ? 'la différence pour le reste du mois est facturée maintenant, au prorata.' : 'le nouveau prix s’applique dès la prochaine échéance (pas de remboursement du mois en cours).') : 'en mode test, rien n’est débité.'}${avert}`)) return;
    }
    try {
      const r = await api('POST', `/api/abonnement/${a === 'abo-changer' ? 'changer' : a === 'abo-resilier' ? 'resilier' : 'reprendre'}`, a === 'abo-changer' ? { formule: el.dataset.v } : {});
      if (r.url) { location.href = r.url; return; }
      await rechargerEtat(); rendre();
      toast(a === 'abo-changer' ? 'Formule modifiée.' : a === 'abo-resilier' ? 'Résiliation enregistrée pour la fin du mois payé.' : 'Abonnement conservé.');
    } catch (err) { toast(err.message); }
  }
  else if (a === 'sources') { ui.modal = { type: 'html', html: `<h2>Sources et limites</h2><p class="sous">Les règles par défaut de Comptoir s’appuient sur des conseils publics et des textes officiels. Elles restent ajustables.</p><ul class="sources-liste">${SOURCES.map(([t, d]) => `<li><strong>${esc(t)}</strong><span class="sous">${esc(d)}</span></li>`).join('')}</ul>` }; rendreModal(); }
  else if (a === 'voir-emails') {
    try {
      const l = await api('GET', '/api/admin/emails');
      ui.modal = { type: 'html', html: `<h2>Derniers e-mails</h2><div class="table-wrap"><table class="table compacte"><tbody>${l.map(m => `<tr><td>${esc(m.sujet)}<div class="sous">${esc(m.destinataire)}</div></td><td class="sous num">${dateHeure(m.cree_le)}</td></tr>`).join('') || '<tr><td class="vide">Aucun e-mail pour l’instant.</td></tr>'}</tbody></table></div>` };
      rendreModal();
    } catch (err) { toast(err.message); }
  }
});
document.addEventListener('change', e => {
  if (e.target.id !== 'import-json') return;
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d.boutique || !Array.isArray(d.produits) || !Array.isArray(d.commandes)) throw new Error('Ce fichier n’est pas un export Comptoir.');
      const { exporteLe, application, ...reste } = d;
      // Fichier incomplet : on refuse ce qui ne peut pas être une boutique, et on complète le reste (sinon l'éditeur planterait).
      if (!reste.boutique || typeof reste.boutique !== 'object' || !String(reste.boutique.nom || '').trim()) throw new Error('Ce fichier ne contient pas de boutique Comptoir.');
      const b = reste.boutique;
      b.secteur = SECTEURS[b.secteur] ? b.secteur : 'maison';
      b.pays = ['ch', 'fr', 'be', 'ca'].includes(b.pays) ? b.pays : 'ch';
      b.theme = b.theme && typeof b.theme === 'object' && b.theme.bg ? b.theme : { ...THEMES.leman, id: 'leman' };
      if (!Array.isArray(b.sections)) b.sections = sectionsParDefaut(b.nom, b.secteur, b.pays);
      b.sections = b.sections.filter(x => x && TYPES_SECTIONS[x.type]).map(x => { const def = { ...TYPES_SECTIONS[x.type].defaut }; if (x.type === 'saison') delete def.code; return { ...x, props: { ...def, ...(x.props || {}) } }; });   // jamais de code promo d'exemple
      reste.produits = Array.isArray(reste.produits) ? reste.produits.filter(x => x && x.id && x.nom) : [];
      reste.commandes = Array.isArray(reste.commandes) ? reste.commandes.filter(x => x && x.id && Array.isArray(x.lignes) && x.client) : [];
      etat = completerEtat(reste); sauver(); toast('Données restaurées.'); location.hash = 'tableau'; rendre();
    } catch (err) { toast(err.message || 'Fichier illisible.'); }
  };
  r.readAsText(f);
});
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'changer-mdp') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const d = new FormData(e.target);
  try { await api('POST', '/api/admin/compte/mot-de-passe', { actuel: d.get('actuel'), nouveau: d.get('nouveau') }); e.target.reset(); toast('Mot de passe changé. Les autres appareils sont déconnectés.'); }
  catch (err) { toast(err.message); }
}, true);
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-action="deconnecter-autres"]')) return;
  e.stopImmediatePropagation();
  try { const r = await api('POST', '/api/admin/compte/deconnecter-autres', {}); toast(r.n ? `${r.n} autre${r.n > 1 ? 's' : ''} appareil${r.n > 1 ? 's' : ''} déconnecté${r.n > 1 ? 's' : ''}.` : 'Aucun autre appareil n’était connecté.'); }
  catch (err) { toast(err.message); }
}, true);
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'supprimer-compte') return;
  e.preventDefault(); e.stopImmediatePropagation();
  try {
    await api('POST', '/api/admin/compte/supprimer', { motDePasse: new FormData(e.target).get('motDePasse') });
    location.href = '/';
  } catch (err) { toast(err.message); }
}, true);


/* ---------- Sécurité du compte (mode connecté) ---------- */
const SECURITE = { donnees: null, chargement: false, mise: null, codes: null, erreur: '' };
const LIBELLES_ACTIVITE = { connexion: 'Connexion', 'echec-2fa': 'Code de vérification refusé', 'code-secours': 'Code de secours utilisé', '2fa-activee': 'Double authentification activée', '2fa-desactivee': 'Double authentification désactivée', 'session-revoquee': 'Appareil déconnecté', 'autres-deconnectes': 'Autres appareils déconnectés', 'mot-de-passe': 'Mot de passe modifié', 'cle-acces': 'Connexion par clé d’accès', 'cle-acces-ajoutee': 'Clé d’accès ajoutée', 'cle-acces-supprimee': 'Clé d’accès supprimée', 'cle-api': 'Clé d’API créée', 'cle-api-revoquee': 'Clé d’API révoquée', 'import-camt': 'Relevé bancaire importé' };
function chargerSecurite() {
  if (SECURITE.chargement) return;
  SECURITE.chargement = true;
  api('GET', '/api/admin/compte/securite').then(d => { SECURITE.donnees = d; }).catch(e => { SECURITE.erreur = e.message; }).finally(() => { SECURITE.chargement = false; rendre(); });
}
function vueSecurite() {
  const d = SECURITE.donnees;
  if (!d && SECURITE.erreur) return `<section class="carte"><p class="encart alerte-encart" role="alert">${esc(SECURITE.erreur)}</p><div class="rangee"><button class="btn petit" data-action="securite-reessayer">Réessayer</button></div></section>`;
  if (!d) { chargerSecurite(); return '<section class="carte"><p class="sous">Chargement…</p></section>'; }
  const date = t => t ? new Date(t).toLocaleString('fr-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const erreur = SECURITE.erreur ? `<p class="encart alerte-encart" role="alert">${esc(SECURITE.erreur)}</p>` : '';
  let df;
  if (SECURITE.codes) df = `<section class="carte"><div class="carte-tete"><h2>Codes de secours</h2><span class="pill good">Double authentification active</span></div>
      <p class="sous">Gardez ces codes en lieu sûr (gestionnaire de mots de passe, papier). Chacun remplace une fois le code de l’application si vous perdez votre téléphone. Ils ne seront plus affichés.</p>
      <div class="codes-secours mono">${SECURITE.codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>
      <div class="rangee"><button class="btn" data-action="secours-telecharger">Télécharger (.txt)</button><button class="btn fantome" data-action="secours-fini">C’est noté</button></div></section>`;
  else if (SECURITE.mise) df = `<section class="carte"><div class="carte-tete"><h2>Activer la double authentification</h2></div>
      <ol class="sous etapes-texte"><li>Ouvrez votre application d’authentification et scannez ce code (ou saisissez la clé).</li><li>Saisissez le code à 6 chiffres affiché, et votre mot de passe.</li></ol>
      <div class="qr-2fa" id="qr-2fa">${qrSvg(SECURITE.mise.uri, { taille: 180, etiquette: 'QR code à scanner avec votre application d’authentification' })}</div>
      <p class="sous">Clé : <span class="mono">${esc(SECURITE.mise.secret.replace(/(.{4})/g, '$1 ').trim())}</span></p>
      <form data-form="2fa-activer" class="grille-form"><label class="champ"><span>Code à 6 chiffres</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <label class="champ"><span>Mot de passe</span><input type="password" name="motDePasse" required autocomplete="current-password"></label>
        ${erreur}<div class="rangee"><button class="btn">Activer</button><button type="button" class="btn fantome" data-action="2fa-annuler">Annuler</button></div></form></section>`;
  else if (d.deuxFacteurs) df = `<section class="carte"><div class="carte-tete"><h2>Double authentification</h2><span class="pill good">Active</span></div>
      <p class="sous">Un code de votre application est demandé à chaque connexion. Codes de secours restants : <b>${d.codesSecoursRestants}</b>.</p>
      <details><summary>Obtenir de nouveaux codes de secours</summary><form data-form="2fa-codes" class="grille-form"><label class="champ"><span>Code de l’application ou code de secours</span><input name="code" autocomplete="one-time-code" maxlength="12" required></label>
        <label class="champ"><span>Mot de passe</span><input type="password" name="motDePasse" required autocomplete="current-password"></label><div class="rangee"><button class="btn fantome">Remplacer mes codes de secours</button></div></form></details>
      <details><summary>Désactiver</summary><form data-form="2fa-desactiver" class="grille-form"><label class="champ"><span>Code de l’application ou code de secours</span><input name="code" autocomplete="one-time-code" maxlength="12" required></label>
        <label class="champ"><span>Mot de passe</span><input type="password" name="motDePasse" required autocomplete="current-password"></label>${erreur}<div class="rangee"><button class="btn fantome danger">Désactiver</button></div></form></details></section>`;
  else df = `<section class="carte"><div class="carte-tete"><h2>Double authentification</h2><span class="pill warn">Inactive</span></div>
      <p class="sous">Recommandée : même avec votre mot de passe, personne ne peut se connecter sans le code de votre téléphone. Compatible Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Proton Pass.</p>
      ${erreur}<div class="rangee"><button class="btn" data-action="2fa-preparer">Activer la double authentification</button></div></section>`;
  const cles = d.clesAcces || [];
  const clesAcces = `<section class="carte"><div class="carte-tete"><h2>Clés d’accès</h2>${cles.length ? `<span class="pill good">${cles.length} enregistrée${cles.length > 1 ? 's' : ''}</span>` : '<span class="pill muted">Aucune</span>'}</div>
    <p class="sous">Connectez-vous sans mot de passe, avec le visage, l’empreinte ou le code de votre téléphone ou ordinateur (Face ID, Touch ID, Windows Hello, Android). Une clé d’accès ne peut pas être volée par un faux site : elle ne fonctionne que sur Comptoir.</p>
    ${cles.length ? `<ul class="journal-compte">${cles.map(c => `<li><b>${esc(c.nom)}</b> <span class="sous">ajoutée le ${date(c.creeLe)} · dernière utilisation : ${c.utiliseeLe ? date(c.utiliseeLe) : 'jamais'}</span>
      <details class="en-ligne"><summary>Supprimer</summary><form data-form="cle-supprimer" data-id="${esc(c.id)}" class="rangee"><input type="password" name="motDePasse" required placeholder="Mot de passe" autocomplete="current-password"><button class="btn petit fantome danger">Supprimer</button></form></details></li>`).join('')}</ul>` : ''}
    ${ClesAcces.disponible() ? `<details${cles.length ? '' : ' open'}><summary>Ajouter une clé d’accès sur cet appareil</summary><form data-form="cle-ajouter" class="grille-form">
      <label class="champ"><span>Nom (pour la reconnaître)</span><input name="nom" maxlength="60" placeholder="iPhone de Marie, MacBook…"></label>
      <label class="champ"><span>Mot de passe</span><input type="password" name="motDePasse" required autocomplete="current-password"></label>
      ${d.deuxFacteurs ? '<label class="champ"><span>Code de l’application ou code de secours</span><input name="code" required autocomplete="one-time-code" maxlength="12"></label>' : ''}
      <div class="rangee"><button class="btn">Créer la clé d’accès</button></div></form></details>` : '<p class="sous">Ce navigateur ne gère pas les clés d’accès.</p>'}</section>`;
  const appareils = `<section class="carte"><div class="carte-tete"><h2>Appareils connectés</h2></div>
    <div class="table-wrap"><table class="table compacte"><thead><tr><th>Appareil</th><th>Dernière activité</th><th>Réseau</th><th></th></tr></thead><tbody>
    ${d.sessions.map(x => `<tr><td>${esc(x.appareil)}${x.actuelle ? ' <span class="pill info">Cet appareil</span>' : ''}</td><td>${date(x.vuLe || x.creeLe)}</td><td class="mono sous">${esc(x.reseau || '—')}</td><td class="num">${x.actuelle ? '' : `<button class="btn petit fantome" data-action="session-revoquer" data-id="${esc(x.id)}">Déconnecter</button>`}</td></tr>`).join('')}
    </tbody></table></div></section>`;
  const journal = `<section class="carte"><div class="carte-tete"><h2>Activité du compte</h2><span class="sous">50 derniers événements</span></div>
    ${d.journal.length ? `<ul class="journal-compte">${d.journal.map(x => `<li><span class="sous">${date(x.date)}</span> <b>${esc(LIBELLES_ACTIVITE[x.type] || x.type)}</b>${x.detail ? ` · ${esc(x.detail)}` : ''}${x.reseau ? ` <span class="mono sous">${esc(x.reseau)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="sous">Aucun événement pour l’instant.</p>'}</section>`;
  return df + clesAcces + appareils + journal;
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action;
  if (!['2fa-preparer', '2fa-annuler', 'secours-telecharger', 'secours-fini', 'session-revoquer', 'securite-reessayer', 'secours-nouveaux'].includes(a)) return;
  if (a === 'securite-reessayer') { SECURITE.erreur = ''; SECURITE.donnees = null; rendre(); return; }
  SECURITE.erreur = '';
  try {
    if (a === '2fa-preparer') { SECURITE.mise = await api('POST', '/api/admin/compte/2fa/preparer'); }
    else if (a === '2fa-annuler') SECURITE.mise = null;
    else if (a === 'secours-telecharger') {
      const url = URL.createObjectURL(new Blob([`Codes de secours Comptoir (${SERVEUR.email || ''})\n\n${SECURITE.codes.join('\n')}\n\nChaque code ne sert qu'une fois.\n`], { type: 'text/plain' }));
      const lien = Object.assign(document.createElement('a'), { href: url, download: 'comptoir-codes-de-secours.txt' }); lien.click(); URL.revokeObjectURL(url); return;
    }
    else if (a === 'secours-fini') { SECURITE.codes = null; SECURITE.donnees = null; }
    else if (a === 'session-revoquer') { await api('POST', `/api/admin/compte/sessions/${encodeURIComponent(el.dataset.id)}/revoquer`); toast('Appareil déconnecté.'); SECURITE.donnees = null; }
  } catch (err) { SECURITE.erreur = err.message; }
  rendre();
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="cle-ajouter"], [data-form="cle-supprimer"]'); if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  try {
    if (f.dataset.form === 'cle-ajouter') { const r = await ClesAcces.enregistrer(d.motDePasse, d.nom, d.code); toast(`Clé d’accès « ${r.nom} » ajoutée.`); }
    else { await api('POST', `/api/admin/compte/cles-acces/${encodeURIComponent(f.dataset.id)}/supprimer`, { motDePasse: d.motDePasse }); toast('Clé d’accès supprimée.'); }
    SECURITE.donnees = null;
  } catch (err) { toast(ClesAcces.messageErreur(err)); }
  rendre();
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="2fa-activer"], [data-form="2fa-desactiver"], [data-form="2fa-codes"]'); if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f)); SECURITE.erreur = '';
  try {
    if (f.dataset.form === '2fa-activer') { const r = await api('POST', '/api/admin/compte/2fa/activer', d); SECURITE.mise = null; SECURITE.codes = r.codesSecours; toast('Double authentification activée.'); }
    else if (f.dataset.form === '2fa-codes') { const r = await api('POST', '/api/admin/compte/2fa/codes', d); SECURITE.codes = r.codesSecours; toast('Nouveaux codes de secours : les anciens ne fonctionnent plus.'); }
    else { await api('POST', '/api/admin/compte/2fa/desactiver', d); toast('Double authentification désactivée.'); SECURITE.donnees = null; }
  } catch (err) { SECURITE.erreur = err.message; }
  rendre();
});

/* Import du relevé bancaire camt.054 : les factures QR payées passent en « payée ». */
document.addEventListener('change', async e => {
  if (e.target.id !== 'import-camt' || !e.target.files[0]) return;
  const f = e.target.files[0]; e.target.value = '';
  try {
    const r = await api('POST', '/api/admin/paiements/camt', { xml: await f.text() });
    const parts = [`${r.payees.length} facture${r.payees.length > 1 ? 's' : ''} payée${r.payees.length > 1 ? 's' : ''}`];
    if (r.deja.length) parts.push(`${r.deja.length} déjà enregistrée(s)`);
    if (r.ecarts.length) parts.push(`${r.ecarts.length} montant(s) à vérifier (${r.ecarts.map(x => x.numero ? `n° ${x.numero}${x.motif === 'trop-percu' ? ' trop-perçu' : x.annulee ? ' annulée' : ''}` : `réf. ${String(x.reference || '').slice(-6)} en ${x.devise}`).join(', ')})`);
    if (r.doublons && r.doublons.length) parts.push(`${r.doublons.length} facture(s) payée(s) deux fois, à rembourser (n° ${r.doublons.map(x => x.numero).join(', ')})`);
    if (r.inconnues.length) parts.push(`${r.inconnues.length} paiement(s) sans commande correspondante`);
    toast(parts.join(' · ')); if (typeof rechargerEtat === 'function') { await rechargerEtat(); rendre(); }
  } catch (err) { toast(err.message || 'Relevé illisible.'); }
});

/* Notifications du navigateur : demandées seulement sur un geste du marchand (bouton). */
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-action="notif-activer"]')) return;
  try { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Notifications activées sur cet appareil.' : 'Notifications non autorisées.'); } catch { toast('Notifications indisponibles.'); }
  rendre();
});
