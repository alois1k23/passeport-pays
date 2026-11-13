/* Comptoir — Paramètres > Intégrations : clés d'API et webhooks (formule Croissance).
   Une clé ou un secret de webhook n'est affiché qu'une fois, à sa création. */
const INTEG = { donnees: null, chargement: false, erreur: '', nouvelle: null };
const LIBELLES_PORTEES = { 'commandes:lecture': 'Lire les commandes', 'commandes:ecriture': 'Marquer les commandes expédiées', 'produits:lecture': 'Lire les produits', 'produits:ecriture': 'Modifier prix et stock', 'clients:lecture': 'Données des clients (nom, e-mail, adresse)' };
const LIBELLES_EVENEMENTS = { 'commande.payee': 'Commande payée', 'commande.expediee': 'Commande expédiée', 'commande.livree': 'Commande livrée', 'commande.remboursee': 'Commande remboursée', 'commande.annulee': 'Commande annulée', 'commande.retiree': 'Commande retirée en magasin', 'produit.rupture': 'Produit épuisé', 'journal.cloture': 'Clôture du journal des ventes (empreinte du jour)', 'devis.accepte': 'Devis accepté par le client', 'carte.emise': 'Carte cadeau émise (sans son code)', 'stock.transfert': 'Transfert de stock entre emplacements' };
function chargerIntegrations() {
  if (INTEG.chargement) return;
  INTEG.chargement = true;
  api('GET', '/api/admin/integrations').then(d => { INTEG.donnees = d; INTEG.erreur = ''; }).catch(e => { INTEG.erreur = e.message; }).finally(() => { INTEG.chargement = false; rendre(); });
}
function vueIntegrations() {
  const intro = `<section class="carte"><div class="carte-tete"><h2>Intégrations</h2>${fonctionIncluse('api') ? '' : '<span class="pill muted">Formule Croissance</span>'}</div>
    <p class="sous">Reliez votre boutique à votre comptabilité, votre entrepôt ou Zapier / Make : une <b>clé d’API</b> permet à un outil de lire vos commandes et de mettre à jour votre stock ; un <b>webhook</b> prévient un outil à chaque commande payée, expédiée ou remboursée. Documentation : <a href="/docs/API.md" target="_blank" rel="noopener">API Comptoir</a>.</p></section>`;
  const horsFormule = `<section class="carte"><p class="sous">L’API et les webhooks sont inclus dans la formule Croissance.</p><div class="rangee"><button class="btn" data-action="section-param" data-v="abonnement">Voir les formules</button></div></section>`;
  if (typeof enLigne === 'function' && !enLigne()) return fonctionIncluse('api') ? intro + `<section class="carte"><p class="sous">Disponible une fois votre boutique en ligne : en démonstration, aucune donnée ne quitte ce navigateur.</p></section>` : intro + horsFormule;
  const d = INTEG.donnees;
  if (!d && INTEG.erreur) return intro + `<section class="carte"><p class="encart alerte-encart" role="alert">${esc(INTEG.erreur)}</p><div class="rangee"><button class="btn petit" data-action="integ-reessayer">Réessayer</button></div></section>`;
  if (!d) { chargerIntegrations(); return intro + '<section class="carte"><p class="sous">Chargement…</p></section>'; }
  // Formule sans API (ou abonnement terminé) : plus rien ne sort ; le marchand peut encore révoquer et supprimer.
  if (!d.inclus) return intro + horsFormule + (d.cles.length || d.webhooks.length ? `<section class="carte"><div class="carte-tete"><h2>Intégrations existantes</h2><span class="pill muted">Inactives</span></div>
    <p class="sous">Vos clés ne fonctionnent plus et aucun webhook n’est envoyé. Vous pouvez les supprimer.</p>
    <ul class="journal-compte">${d.cles.map(c => `<li>Clé « ${esc(c.nom)} » <span class="mono">${esc(c.prefixe)}…</span> <button class="btn petit fantome danger" data-action="integ-revoquer" data-id="${esc(c.id)}">Révoquer</button></li>`).join('')}
    ${d.webhooks.map(w => `<li>Webhook <span class="mono">${esc(w.url)}</span> <button class="btn petit fantome danger" data-action="integ-supprimer" data-id="${esc(w.id)}">Supprimer</button></li>`).join('')}</ul></section>` : '');
  const date = t => t ? new Date(t).toLocaleString('fr-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';
  const nouvelle = INTEG.nouvelle ? `<section class="carte"><div class="carte-tete"><h2 id="integ-nouvelle-titre" tabindex="-1">${INTEG.nouvelle.type === 'cle' ? 'Votre nouvelle clé d’API' : 'Secret de signature du webhook'}</h2><span class="pill warn">Affiché une seule fois</span></div>
      <p class="sous">${INTEG.nouvelle.type === 'cle' ? 'Copiez-la maintenant dans votre outil. Elle donne accès à vos données : ne la partagez pas, ne la publiez pas.' : 'Votre outil s’en sert pour vérifier que les appels viennent bien de Comptoir (en-tête Comptoir-Signature).'}</p>
      <p class="mono secret-integ">${esc(INTEG.nouvelle.valeur)}</p>
      <div class="rangee"><button class="btn" data-action="integ-copier">Copier</button><button class="btn fantome" data-action="integ-fini">C’est copié</button></div></section>` : '';
  const cles = `<section class="carte"><div class="carte-tete"><h2>Clés d’API</h2><span class="sous mono">${esc(d.base)}</span></div>
    ${d.cles.length ? `<div class="table-wrap"><table class="table compacte"><thead><tr><th>Nom</th><th>Clé</th><th>Permissions</th><th>Dernier usage</th><th></th></tr></thead><tbody>
      ${d.cles.map(c => `<tr><td>${esc(c.nom)}</td><td class="mono">${esc(c.prefixe)}…</td><td class="sous">${c.portees.map(p => esc(LIBELLES_PORTEES[p] || p)).join(', ')}</td><td>${date(c.utilisee_le)}</td><td class="num"><button class="btn petit fantome danger" data-action="integ-revoquer" data-id="${esc(c.id)}">Révoquer</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="sous">Aucune clé pour l’instant.</p>'}
    <details${d.cles.length ? '' : ' open'}><summary>Créer une clé</summary><form data-form="integ-cle" class="grille-form">
      <label class="champ"><span>Nom (pour vous en souvenir)</span><input name="nom" maxlength="60" required placeholder="Comptabilité, entrepôt…"></label>
      <fieldset class="champ"><legend>Permissions</legend>${d.portees.map(p => `<label class="case"><input type="checkbox" name="portees" value="${esc(p)}"${p.endsWith(':lecture') && p.startsWith('commandes') ? ' checked' : ''}> ${esc(LIBELLES_PORTEES[p] || p)}</label>`).join('')}</fieldset>
      <div class="rangee"><button class="btn">Créer la clé</button><span class="sous">N’accordez que le nécessaire.</span></div></form></details></section>`;
  const statutEnvoi = e => e.statut === 'envoye' ? '<span class="pill good">Reçu</span>' : e.statut === 'echec' ? '<span class="pill bad">Abandonné</span>' : `<span class="pill warn">Nouvel essai (${e.tentatives})</span>`;
  const webhooks = `<section class="carte"><div class="carte-tete"><h2 id="integ-webhooks-titre" tabindex="-1">Webhooks</h2>${d.webhooks.length ? '<button class="btn petit fantome" data-action="integ-tester">Envoyer un test</button>' : ''}</div>
    ${d.webhooks.map(w => `<div class="webhook-integ"><p><span class="mono">${esc(w.url)}</span> <span class="pill muted">${w.donneesClient ? 'avec données clients' : 'sans données clients'}</span> <button class="btn petit fantome" data-action="integ-donnees" data-id="${esc(w.id)}" data-avec="${w.donneesClient ? '' : '1'}" aria-label="${w.donneesClient ? 'Retirer' : 'Ajouter'} les données des clients pour ${esc(w.url)}">${w.donneesClient ? 'Retirer les données clients' : 'Ajouter les données clients'}</button> ${w.actif ? (w.premier_echec ? `<span class="pill warn">Ne répond plus depuis le ${date(w.premier_echec)}</span>` : '<span class="pill good">Actif</span>') : `<span class="pill bad">En pause : aucune réponse depuis 3 jours</span> <button class="btn petit" data-action="integ-reactiver" data-id="${esc(w.id)}">Réactiver${w.enAttente ? ` et envoyer les ${w.enAttente} événements en attente` : ''}</button>`}</p>
      <p class="sous">${w.evenements.map(x => esc(LIBELLES_EVENEMENTS[x] || x)).join(' · ')}</p>
      ${w.derniers.length ? `<ul class="journal-compte">${w.derniers.map(e => `<li><span class="sous">${date(e.cree_le)}</span> ${esc(LIBELLES_EVENEMENTS[e.evenement] || e.evenement)} ${statutEnvoi(e)}${e.dernier_code ? ` <span class="mono sous">HTTP ${esc(String(e.dernier_code))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="sous">Aucun envoi pour l’instant.</p>'}
      <div class="rangee"><button class="btn petit fantome" data-action="integ-secret" data-id="${esc(w.id)}" data-url="${esc(w.url)}" aria-label="Nouveau secret pour ${esc(w.url)}">Nouveau secret</button><button class="btn petit fantome danger" data-action="integ-supprimer" data-id="${esc(w.id)}">Supprimer</button></div></div>`).join('')}
    <details${d.webhooks.length ? '' : ' open'}><summary>Ajouter un webhook</summary><form data-form="integ-webhook" class="grille-form">
      <label class="champ"><span>Adresse (https://…)</span><input name="url" type="url" required placeholder="https://hooks.zapier.com/…" pattern="https://.*"></label>
      <fieldset class="champ"><legend>Événements</legend>${d.evenements.map(x => `<label class="case"><input type="checkbox" name="evenements" value="${esc(x)}"${x === 'commande.payee' ? ' checked' : ''}> ${esc(LIBELLES_EVENEMENTS[x] || x)}</label>`).join('')}</fieldset>
      <label class="case"><input type="checkbox" name="donneesClient"> Inclure les données personnelles des clients (nom, e-mail, adresse)<span class="sous"> : sans cette case, chaque commande n’indique que le pays du client. Cochez-la seulement si votre outil en a besoin (expédition, comptabilité nominative).</span></label>
      <div class="rangee"><button class="btn">Ajouter</button><span class="sous">Si votre outil ne répond pas, Comptoir réessaie pendant environ 38 heures ; rien n’est perdu.</span></div></form></details></section>`;
  return intro + nouvelle + cles + webhooks;
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action^="integ-"]'); if (!el) return;
  const a = el.dataset.action;
  INTEG.erreur = '';
  try {
    if (a === 'integ-reessayer') INTEG.donnees = null;
    else if (a === 'integ-copier') { await navigator.clipboard.writeText(INTEG.nouvelle.valeur); toast('Copié.'); return; }
    else if (a === 'integ-fini') { INTEG.nouvelle = null; focaliserQuandPret('#integ-webhooks-titre'); }
    else if (a === 'integ-revoquer') { if (!confirm('Révoquer cette clé ? Les outils qui l’utilisent perdront l’accès immédiatement.')) return; await api('POST', `/api/admin/integrations/cles/${encodeURIComponent(el.dataset.id)}/revoquer`); toast('Clé révoquée.'); INTEG.donnees = null; }
    else if (a === 'integ-supprimer') { if (!confirm('Supprimer ce webhook ?')) return; await api('POST', `/api/admin/integrations/webhooks/${encodeURIComponent(el.dataset.id)}/supprimer`); INTEG.donnees = null; }
    else if (a === 'integ-secret') {
      if (!confirm(`Créer un nouveau secret de signature pour ${el.dataset.url || 'ce webhook'} ? L’ancien reste valable 24 heures, le temps de mettre à jour votre outil.`)) return;
      const r = await api('POST', `/api/admin/integrations/webhooks/${encodeURIComponent(el.dataset.id)}/secret`);
      INTEG.nouvelle = { type: 'webhook', valeur: r.secret }; INTEG.donnees = null;
      toast('Nouveau secret créé, affiché en haut de la page : l’ancien signe encore les envois pendant 24 heures.');
      focaliserQuandPret('#integ-nouvelle-titre');
    }
    else if (a === 'integ-donnees') {
      const avec = el.dataset.avec === '1';
      if (avec && !confirm('Ce webhook recevra le nom, l’e-mail et l’adresse de vos clients. Votre outil en a-t-il vraiment besoin ?')) return;
      await api('POST', `/api/admin/integrations/webhooks/${encodeURIComponent(el.dataset.id)}/donnees`, { donneesClient: avec });
      toast(avec ? 'Les prochains événements contiendront les données des clients.' : 'Les prochains événements ne contiendront plus les données des clients.'); INTEG.donnees = null;
    }
    else if (a === 'integ-reactiver') { await api('POST', `/api/admin/integrations/webhooks/${encodeURIComponent(el.dataset.id)}/reactiver`); toast('Webhook réactivé.'); INTEG.donnees = null; }
    else if (a === 'integ-tester') {
      el.disabled = true;
      const r = await api('POST', '/api/admin/integrations/webhooks/tester');
      toast(r.resultats.map(x => `${x.url.replace(/^https?:\/\//, '').slice(0, 40)} : ${x.ok ? `reçu (HTTP ${x.code})` : x.code ? `refusé (HTTP ${x.code})` : 'aucune réponse'}`).join(' · ') || 'Aucun webhook.');
    }
  } catch (err) { INTEG.erreur = err.message; toast(err.message); }
  rendre();
});
/* Après un nouveau rendu (souvent après rechargement des données), le focus va à l'élément attendu dès qu'il existe :
   un utilisateur au clavier ou au lecteur d'écran n'est pas renvoyé en haut de la page. */
function focaliserQuandPret(selecteur) {
  let essais = 0;
  const essayer = () => { const el = document.querySelector(selecteur); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } else if (essais++ < 120) setTimeout(essayer, 25); };
  setTimeout(essayer, 0);
}
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="integ-cle"], [data-form="integ-webhook"]'); if (!f) return;
  e.preventDefault();
  const fd = new FormData(f); INTEG.erreur = '';
  try {
    if (f.dataset.form === 'integ-cle') { const r = await api('POST', '/api/admin/integrations/cles', { nom: fd.get('nom'), portees: fd.getAll('portees') }); INTEG.nouvelle = { type: 'cle', valeur: r.cle }; }
    else { const r = await api('POST', '/api/admin/integrations/webhooks', { url: fd.get('url'), evenements: fd.getAll('evenements'), donneesClient: fd.get('donneesClient') === 'on' }); INTEG.nouvelle = { type: 'webhook', valeur: r.secret }; }
    INTEG.donnees = null;
  } catch (err) { INTEG.erreur = err.message; toast(err.message); }
  rendre();
});
