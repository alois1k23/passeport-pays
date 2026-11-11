/* Comptoir — paramètres : tout ce qui configure la boutique et le compte, au même endroit. */

const SECTIONS_PARAM = [['general', 'Général'], ['apparence', 'Apparence'], ['paiements', 'Paiements'], ['livraison', 'Livraison'], ['emails', 'E-mails'], ['domaine', 'Domaine'], ['abonnement', 'Abonnement'], ['donnees', 'Données'], ['sensible', 'Zone sensible']];

function enLigne() { return typeof SERVEUR !== 'undefined' && SERVEUR.connecte; }

function vueParametres() {
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
    corps = `<section class="carte"><div class="carte-tete"><h2>Encaissement</h2>${statut(stripe, 'Stripe actif', enLigne() ? 'Paiement simulé' : 'Démo')}</div>
      <div class="liste-reglages">
        <div><strong>TWINT</strong><span class="sous">Paiement mobile le plus utilisé en Suisse, uniquement en CHF.</span>${statut(stripe && b.devise === 'CHF', 'Proposé', 'Inactif')}</div>
        <div><strong>Cartes</strong><span class="sous">Visa, Mastercard et autres cartes acceptées par Stripe.</span>${statut(stripe, 'Proposé', 'Inactif')}</div>
      </div>
      <p class="sous">${stripe ? 'Les paiements passent par Stripe Checkout ; les remboursements partent depuis la fiche commande.' : 'Pour encaisser pour de vrai : créez un compte Stripe au nom de l’entreprise, activez TWINT, puis renseignez les clés sur le serveur (guide : server/README.md). En attendant, le paiement est simulé et aucun montant n’est débité.'}</p></section>`;
  } else if (s === 'livraison') {
    const modes = Object.values(livraisonsPays(b.pays));
    corps = `<section class="carte sans-pad"><div class="carte-tete pad"><h2>Modes de livraison</h2><span class="sous">tarifs TTC facturés au client</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Mode</th><th>Délai (stock propre)</th><th class="num">Prix</th></tr></thead><tbody>
      ${modes.filter(m => m.transporteur || (etat.magasin && etat.magasin.clickCollect)).map(m => `<tr><td>${esc(m.nom)}</td><td class="sous">${esc(m.delai)}</td><td class="num">${m.prix ? euros(m.prix) : 'Gratuit'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pad-x pad-b"><p class="sous">Livraison offerte dès <b>${seuilPort() > 0 ? euros(seuilPort()) : 'jamais'}</b> (hors envoi express) : réglable dans <a class="lien" href="#conversion">Conversion</a>. Commandes passées après 14 h : expédiées le jour ouvrable suivant. Pour les produits en dropshipping, le délai affiché est celui du fournisseur.</p></div></section>`;
  } else if (s === 'emails') {
    const service = enLigne() ? SERVEUR.emails : null;
    corps = `<section class="carte"><div class="carte-tete"><h2>Envoi des e-mails</h2>${statut(!!service, service === 'brevo' ? 'Brevo actif' : service === 'postmark' ? 'Postmark actif' : 'Actif', enLigne() ? 'File d’attente' : 'Démo')}</div>
      <p class="sous">${service ? 'Les e-mails partent automatiquement : confirmations, expéditions, relances, avis, bienvenue.' : 'Sans service d’envoi, les e-mails sont préparés et gardés en file, mais ne partent pas. Branchez Brevo (hébergé en Europe) ou Postmark sur le serveur pour les envoyer.'}</p>
      <div class="liste-reglages">${['Confirmation de commande', 'Colis expédié, avec suivi', 'Commande prête à retirer', 'Relance de paiement abandonné', 'Bienvenue (newsletter)', 'Demande d’avis', 'Reconquête des inactifs'].map((n, i) => `<div><strong>${n}</strong><span class="sous">${i < 3 ? 'Toujours envoyé (e-mail de service)' : 'Réglable dans Conversion'}</span></div>`).join('')}</div>
      ${enLigne() ? '<div class="rangee"><button class="btn petit fantome" data-action="voir-emails">Voir les derniers e-mails</button></div>' : ''}</section>`;
  } else if (s === 'domaine') {
    const d = b.domaine;
    corps = `<section class="carte"><div class="carte-tete"><h2>Adresse de la boutique</h2>${d && d.actif ? statut(true, 'Domaine actif', '') : d ? statut(false, '', 'DNS à configurer') : '<span class="pill muted">Adresse Comptoir</span>'}</div>
      <p class="mono">${esc(d && d.domaine ? d.domaine : (enLigne() ? location.host + '/s/' + SERVEUR.slug : slugifier(b.nom) + '.comptoir.shop'))}</p>
      <div class="rangee"><a class="btn petit" href="#domaines">${d ? 'Gérer le domaine' : 'Choisir un domaine'}</a></div></section>`;
  } else if (s === 'abonnement') {
    const a = enLigne() && SERVEUR.abonnement;
    if (!a) {
      corps = `<section class="carte"><div class="carte-tete"><h2>Formule</h2><span class="pill muted">Démo</span></div>
        <p class="sous">Dans la démo, aucun abonnement n’est nécessaire. Sur Comptoir, vous choisissez une formule et payez avant d’accéder à votre espace : uniquement votre boutique et vos données.</p>
        <div class="rangee"><a class="btn petit fantome" href="#offre">Comparer les formules</a></div></section>`;
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
  else if (a === 'abo-changer' || a === 'abo-resilier' || a === 'abo-reprendre') {
    if (a === 'abo-resilier' && !confirm('Résilier l’abonnement ? Votre boutique reste ouverte jusqu’à la fin du mois payé.')) return;
    if (a === 'abo-changer') {
      const ab = SERVEUR.abonnement || {}, f = Formules.FORMULES[el.dataset.v];
      if (f && !confirm(`Passer à ${f.nom} pour ${Formules.prixTexte(el.dataset.v, ab.devise)} par mois ? Le changement est immédiat ; ${ab.prestataire === 'stripe' ? 'la différence pour le mois en cours est calculée au prorata et ajoutée à (ou déduite de) votre prochaine facture.' : 'en mode test, rien n’est débité.'}`)) return;
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
