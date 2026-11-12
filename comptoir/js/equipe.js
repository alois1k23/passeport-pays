/* Comptoir — équipe : le propriétaire invite des collaborateurs ; un invité accepte depuis le lien reçu par e-mail. */
const EQUIPE = { donnees: null, chargement: false, erreur: '' };
function chargerEquipe() {
  if (EQUIPE.chargement) return; EQUIPE.chargement = true;
  api('GET', '/api/admin/equipe').then(d => { EQUIPE.donnees = d; EQUIPE.erreur = ''; }).catch(e => { EQUIPE.erreur = e.message; }).finally(() => { EQUIPE.chargement = false; rendre(); });
}
function vueEquipe() {
  const d = EQUIPE.donnees;
  if (!d && EQUIPE.erreur) return `<section class="carte"><p class="encart alerte-encart" role="alert">${esc(EQUIPE.erreur)}</p></section>`;
  if (!d) { chargerEquipe(); return '<section class="carte"><p class="sous">Chargement…</p></section>'; }
  const date = t => new Date(t).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<section class="carte"><div class="carte-tete"><h2>Équipe</h2><span class="sous">${d.membres.length} membre${d.membres.length > 1 ? 's' : ''} · 5 au plus</span></div>
    <p class="sous">Invitez un collaborateur : il a son propre compte (mot de passe, double authentification), et ses actions sur les commandes portent son nom. Rôle « Commandes » : préparer, expédier, transmettre au fournisseur, encaisser à la caisse, sans rembourser ni modifier la boutique. « Gestion complète » : tout, sauf l’abonnement, l’équipe, les paiements et les intégrations.</p>
    ${d.membres.length || d.invitations.length ? `<div class="table-wrap"><table class="table compacte"><thead><tr><th>Personne</th><th>Rôle</th><th>Depuis</th><th></th></tr></thead><tbody>
      ${d.membres.map(m => `<tr><td>${esc(m.email)}</td><td>${esc(d.roles[m.role] || m.role)}</td><td>${date(m.cree_le)}</td><td class="num"><button class="btn petit fantome danger" data-action="equipe-retirer" data-id="${esc(m.id)}" data-email="${esc(m.email)}">Retirer</button></td></tr>`).join('')}
      ${d.invitations.map(i => `<tr><td>${esc(i.email)} <span class="pill muted">Invitation envoyée</span></td><td>${esc(d.roles[i.role] || i.role)}</td><td>expire le ${date(i.expire_le)}</td><td class="num"><button class="btn petit fantome" data-action="equipe-annuler" data-id="${esc(i.id)}">Annuler</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <form data-form="equipe-inviter" class="grille-form"><div class="deux"><label class="champ"><span>E-mail</span><input name="email" type="email" required autocomplete="off"></label>
      <label class="champ"><span>Rôle</span><select name="role">${Object.entries(d.roles).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></label></div>
      <div class="rangee"><button class="btn">Envoyer l’invitation</button><span class="sous">Lien valable 7 jours.</span></div></form></section>`;
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action="equipe-retirer"], [data-action="equipe-annuler"]'); if (!el) return;
  try {
    if (el.dataset.action === 'equipe-retirer') { if (!confirm(`Retirer ${el.dataset.email} de l’équipe ? Son accès est coupé immédiatement et son compte supprimé.`)) return; await api('POST', `/api/admin/equipe/${encodeURIComponent(el.dataset.id)}/retirer`); toast('Accès retiré.'); }
    else { await api('POST', `/api/admin/equipe/invitations/${encodeURIComponent(el.dataset.id)}/annuler`); toast('Invitation annulée.'); }
    EQUIPE.donnees = null;
  } catch (err) { toast(err.message); }
  rendre();
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="equipe-inviter"]'); if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  try { await api('POST', '/api/admin/equipe/inviter', d); toast(`Invitation envoyée à ${d.email}.`); EQUIPE.donnees = null; } catch (err) { toast(err.message); }
  rendre();
});

/* Acceptation d'une invitation : /app?invitation=… (avant toute connexion). Renvoie true si l'écran est affiché. */
async function afficherInvitation() {
  const jeton = new URLSearchParams(location.search).get('invitation'); if (!jeton) return false;
  const vue = document.querySelector('#vue') || document.body;
  rendre = function () { /* écran d'invitation : l'application ne s'affiche pas tant que l'invité n'a pas rejoint */ };
  if (typeof modeHorsEspace === 'function') modeHorsEspace();   // même présentation que l'écran de connexion
  const cote = document.querySelector('.cote'); if (cote) cote.hidden = true;
  let info;
  try { info = await api('GET', `/api/auth/invitation?jeton=${encodeURIComponent(jeton)}`); }
  catch (err) { vue.innerHTML = `<div class="assistant carte connexion"><span class="eyebrow">Comptoir</span><h1>Invitation</h1><p class="encart alerte-encart">${esc(err.message)}</p></div>`; return true; }
  const dessiner = (erreur = '', envoi = false) => {
    vue.innerHTML = `<div class="assistant carte connexion"><span class="eyebrow">Comptoir</span><h1>Rejoindre ${esc(info.boutique)}</h1>
      <p class="sous">Vous êtes invité dans l’équipe de <b>${esc(info.boutique)}</b>, avec le rôle : ${esc(info.role)}. Choisissez votre mot de passe pour créer votre accès.</p>
      <form id="form-invitation" class="assistant-corps"><label class="champ"><span>E-mail</span><input value="${esc(info.email)}" disabled></label>
        <label class="champ"><span>Mot de passe (10 caractères au moins ; une phrase de quelques mots est idéale)</span><input name="motDePasse" type="password" required minlength="10" autocomplete="new-password" autofocus></label>
        ${erreur ? `<p class="encart alerte-encart" role="alert">${esc(erreur)}</p>` : ''}<button class="btn" ${envoi ? 'disabled' : ''}>${envoi ? 'Un instant…' : 'Rejoindre l’équipe'}</button></form></div>`;
    document.getElementById('form-invitation').addEventListener('submit', async ev => {
      ev.preventDefault(); const mdp = new FormData(ev.target).get('motDePasse');
      dessiner('', true);
      try { await api('POST', '/api/auth/invitation', { jeton, motDePasse: mdp }); location.href = '/app#tableau'; }
      catch (err) { dessiner(err.message); }
    });
  };
  dessiner();
  return true;
}
