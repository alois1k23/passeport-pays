/* Comptoir — boutique publique d’un marchand (servie par le serveur sur /s/<slug>).
   Charge la boutique depuis l’API, gère le panier et envoie la commande au serveur,
   qui recalcule les prix et redirige vers le paiement (TWINT/carte ou simulation). */

const slug = location.pathname.split('/').filter(Boolean)[1];
const CLE_PANIER = `comptoir-panier-${slug}`;
let etat = null;           // lu par storefront.js (devise, produits, boutique)
let donnees = null;
const vue = { panier: lirePanier(), ouvert: false, livraison: null, envoi: false, message: null, legal: null, code: null, codeMessage: '' };

function lirePanier() { try { return JSON.parse(localStorage.getItem(CLE_PANIER)) || []; } catch { return []; } }
function garderPanier() { try { localStorage.setItem(CLE_PANIER, JSON.stringify(vue.panier)); } catch { /* ignoré */ } }
const $ = s => document.querySelector(s);

async function demarrer() {
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}`);
    if (!rep.ok) throw new Error((await rep.json()).erreur || 'Boutique introuvable.');
    donnees = await rep.json();
  } catch (e) {
    $('#app').innerHTML = `<div class="page-erreur"><h1>Boutique introuvable</h1><p>${esc(e.message)}</p></div>`;
    return;
  }
  etat = { boutique: donnees.boutique, produits: donnees.produits, entreprise: donnees.entreprise, magasin: donnees.magasin };
  document.title = donnees.boutique.nom;
  document.body.style.background = donnees.boutique.theme.bg;
  // Le panier ne garde que les produits encore en vente, au prix actuel.
  vue.panier = vue.panier.map(l => { const p = donnees.produits.find(x => x.id === l.produitId); return p && { produitId: p.id, nom: p.nom, prix: p.prix, qte: l.qte }; }).filter(Boolean);
  vue.livraison = Object.keys(donnees.livraisons)[0];
  const q = new URLSearchParams(location.search);
  if (q.get('reprendre')) { reprendrePaiement(q.get('reprendre'), q.get('jeton')); return; }
  if (q.get('commande')) suivreCommande(q.get('commande'), q.get('jeton'), q.get('annule'));
  rendre();
}

function fraisPortClient(cle, sousTotal) {
  const m = donnees.livraisons[cle];
  if (!m || !m.prix) return 0;
  return !m.jamaisOffert && sousTotal >= donnees.seuilPortOffert ? 0 : m.prix;
}

/* Remises : même calcul que le serveur (js/remises.js), avec le code validé par l’API. */
function calculPanier() {
  const config = { offres: { ...donnees.offres, codes: vue.code ? [vue.code] : [] } };
  return Remises.appliquer(vue.panier, config, vue.code ? vue.code.code : '');
}

function rendre() {
  const calc = calculPanier();
  const total = calc.apresRemise;
  const port = total ? fraisPortClient(vue.livraison, total) : 0;
  const seuil = donnees.seuilPortOffert;
  const suggestion = donnees.offres.suggestions ? donnees.produits.find(p => !vue.panier.some(l => l.produitId === p.id) && (p.type === 'drop' || p.stock > 0)) : null;
  const drops = vue.panier.map(l => donnees.produits.find(p => p.id === l.produitId)).filter(p => p && p.type === 'drop' && p.delai);
  const delai = drops.length ? [Math.max(...drops.map(p => p.delai[0])), Math.max(...drops.map(p => p.delai[1]))] : null;
  const ch = donnees.boutique.pays === 'ch';
  const retrait = vue.livraison === 'retrait';
  const th = donnees.boutique.theme;
  let cookies = null;
  try { cookies = localStorage.getItem('comptoir-cookies'); } catch { /* ignoré */ }

  $('#app').innerHTML = `
    ${renduBoutique(etat, { mode: 'live', panier: vue.panier })}
    ${cookies ? '' : `<div class="cookies" role="region" aria-label="Cookies"><p>${esc(donnees.boutique.nom)} utilise uniquement des cookies nécessaires au panier. Aucune mesure d’audience n’est activée sans votre accord.</p><div class="rangee"><button class="btn petit fantome" data-c="cookies" data-v="refus">Refuser</button><button class="btn petit fantome" data-c="cookies" data-v="accord">Accepter</button></div></div>`}
    <div class="tiroir ${vue.ouvert ? 'ouvert' : ''}" aria-hidden="${!vue.ouvert}">
      <div class="tiroir-fond" data-c="fermer"></div>
      <aside class="tiroir-corps" style="${varsTheme(th)}">
        <div class="carte-tete"><h2>${vue.message ? 'Votre commande' : 'Panier'}</h2><button class="icone" data-c="fermer">Fermer</button></div>
        ${vue.message ? vue.message : vue.panier.length ? `
          <ul class="lignes-panier">${vue.panier.map(l => `<li><span>${esc(l.nom)}</span>
            <div class="qte"><button data-c="qte" data-id="${esc(l.produitId)}" data-d="-1" aria-label="Retirer un">−</button><b>${l.qte}</b><button data-c="qte" data-id="${esc(l.produitId)}" data-d="1" aria-label="Ajouter un">+</button></div>
            <span class="num">${euros(l.prix * l.qte)}</span></li>`).join('')}</ul>
          ${donnees.offres.barrePort && vue.livraison !== 'retrait' ? `<div class="barre-port"><p>${total >= seuil ? 'Livraison offerte' : `Plus que <b>${euros(seuil - total)}</b> pour la livraison offerte`}</p><span><i style="width:${Math.min(100, total / seuil * 100)}%"></i></span></div>` : ''}
          ${calc.prochainPalier ? `<p class="palier">Ajoutez ${calc.prochainPalier.manque} article${calc.prochainPalier.manque > 1 ? 's' : ''} : <b>−${calc.prochainPalier.remise} %</b> sur toute la commande.</p>` : ''}
          ${suggestion ? `<div class="suggestion">${visuelProduit(suggestion)}<div><small>Souvent ajouté</small><strong>${esc(suggestion.nom)}</strong><span>${euros(suggestion.prix)}</span></div><button class="sf-btn sf-btn-ligne" data-sf="ajouter" data-id="${esc(suggestion.id)}">Ajouter</button></div>` : ''}
          <form id="form-code" class="code-promo"><input name="code" placeholder="Code promo" aria-label="Code promo" value="${esc(vue.code ? vue.code.code : '')}" autocomplete="off"><button class="sf-btn sf-btn-ligne">${vue.code ? 'Changer' : 'Appliquer'}</button></form>
          ${vue.codeMessage ? `<p class="mini">${esc(vue.codeMessage)}</p>` : ''}
          <fieldset class="modes-livraison"><legend>Livraison</legend>${Object.entries(donnees.livraisons).map(([k, m]) => `
            <label class="${vue.livraison === k ? 'actif' : ''}"><input type="radio" name="livraison" value="${esc(k)}" data-c="livraison" ${vue.livraison === k ? 'checked' : ''}>
            <span>${esc(m.nom)}<small>${k === 'retrait' ? esc(donnees.magasin.adresse) : delai ? `${delai[0]} à ${delai[1]} jours` : ''}</small></span><b>${fraisPortClient(k, total) ? euros(fraisPortClient(k, total)) : 'Offert'}</b></label>`).join('')}</fieldset>
          <div class="totaux"><div><span>Sous-total</span><span>${euros(calc.sousTotal)}</span></div>${calc.remise ? `<div class="remise"><span>Remise · ${esc(calc.motif.libelle)}</span><span>−${euros(calc.remise)}</span></div>` : ''}<div><span>Livraison</span><span>${port ? euros(port) : 'Offerte'}</span></div><div class="total"><span>Total</span><span>${euros(total + port)}</span></div></div>
          <form id="commande">
            <label class="champ"><span>Nom et prénom</span><input name="nom" required autocomplete="name"></label>
            <label class="champ"><span>E-mail</span><input name="email" type="email" required autocomplete="email"></label>
            ${retrait ? '' : `<label class="champ"><span>Adresse</span><input name="adresse" required autocomplete="street-address"></label>
            <div class="deux"><label class="champ"><span>${ch ? 'NPA' : 'Code postal'}</span><input name="npa" required inputmode="numeric" autocomplete="postal-code" ${ch ? 'pattern="[0-9]{4}" maxlength="4"' : ''}></label>`}
            <label class="champ"><span>Ville</span><input name="ville" required autocomplete="address-level2"></label>${retrait ? '' : '</div>'}
            <p class="erreur-form" id="erreur" hidden></p>
            <button class="sf-btn plein" ${vue.envoi ? 'disabled' : ''}>${vue.envoi ? 'Redirection vers le paiement…' : `Payer ${euros(total + port)}`}</button>
            <p class="mini">${donnees.paiement === 'stripe' ? (ch ? 'Paiement sécurisé par TWINT ou carte.' : 'Paiement sécurisé par carte.') : 'Mode test : le paiement est simulé, aucun montant n’est débité.'} En payant, vous acceptez les <button type="button" class="bouton-lien" data-c="legal" data-v="cgv">CGV</button>.</p>
          </form>` : '<p>Votre panier est vide.</p>'}
      </aside>
    </div>
    ${vue.legal ? `<div id="modal"><div class="modal-fond" data-c="legal-fermer"></div><div class="modal-corps" role="dialog" aria-modal="true"><button class="icone modal-x" data-c="legal-fermer">Fermer</button><article class="doc-legal">${texteLegal(vue.legal)}</article></div></div>` : ''}`;
}

function texteLegal(type) {
  const e = donnees.entreprise, b = donnees.boutique, ch = b.pays === 'ch';
  if (type === 'cgv') return `<h2>Conditions générales de vente</h2>
    <p><strong>Vendeur.</strong> ${esc(e.raison || b.nom)}, ${esc(e.adresse || '')}. Contact : ${esc(e.email || '')}.</p>
    <p><strong>Prix.</strong> En ${esc(b.devise)}, TVA comprise${e.regime === 'ch-non' ? ' (entreprise non assujettie à la TVA)' : ''}.</p>
    <p><strong>Livraison.</strong> ${Object.values(donnees.livraisons).map(m => `${esc(m.nom)} : ${m.prix ? euros(m.prix) : 'gratuit'}`).join(' ; ')}. Offerte dès ${euros(donnees.seuilPortOffert)} sauf envoi express. Les articles expédiés par nos partenaires indiquent leur délai sur la fiche produit.</p>
    <p><strong>Retours.</strong> ${ch ? 'Le droit suisse ne prévoit pas de droit de rétractation général pour les achats en ligne. Nous acceptons toutefois les retours sous 30 jours.' : 'Vous disposez de 14 jours pour vous rétracter (art. L221-18 du Code de la consommation).'}</p>
    <p><strong>Garantie.</strong> 2 ans pour les défauts.</p>`;
  return `<h2>${ch ? 'Impressum et protection des données' : 'Mentions légales'}</h2>
    <p><strong>Exploitant.</strong> ${esc(e.raison || b.nom)}, ${esc(e.forme || '')}${e.siret ? ', ' + esc(e.siret) : ''}, ${esc(e.adresse || '')}. Contact : ${esc(e.email || '')}.</p>
    <p><strong>Données personnelles.</strong> Vos données servent uniquement à traiter votre commande. Elles sont transmises au prestataire de paiement, au transporteur et, pour les articles expédiés par nos partenaires, au fournisseur concerné. Vous pouvez demander leur consultation ou leur effacement par e-mail.</p>`;
}

async function envoyerCommande(form) {
  const d = new FormData(form);
  vue.envoi = true; rendre();
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/commandes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lignes: vue.panier.map(l => ({ produitId: l.produitId, qte: l.qte })), livraison: vue.livraison, code: vue.code ? vue.code.code : undefined, client: Object.fromEntries(d) })
    });
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur || 'La commande n’a pas pu être créée.');
    location.href = json.paiementUrl;
  } catch (e) {
    vue.envoi = false; rendre();
    const p = $('#erreur'); p.textContent = e.message; p.hidden = false;
    // Garde la saisie
    const f = $('#commande');
    for (const [k, v] of d) if (f.elements[k]) f.elements[k].value = v;
  }
}

async function suivreCommande(id, jeton, annule) {
  vue.ouvert = true;
  if (annule) { vue.message = '<p>Le paiement a été annulé. Votre panier est conservé : vous pouvez réessayer.</p>'; history.replaceState(null, '', location.pathname); vue.message += '<button class="sf-btn" data-c="retour-panier">Revenir au panier</button>'; return; }
  const libelles = { attente: 'Paiement en cours de confirmation…', payee: 'Paiement reçu. Nous préparons votre commande.', fournisseur: 'Paiement reçu. Votre commande est en préparation chez notre partenaire.', preparation: 'Votre commande est en préparation.', expediee: 'Votre colis est en route.', livree: 'Votre colis a été livré.', prete: 'Votre commande vous attend en boutique.', retiree: 'Commande retirée. Merci !', annulee: 'Commande annulée.', remboursee: 'Commande remboursée.' };
  for (let i = 0; i < 20; i++) {
    try {
      const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/commandes/${encodeURIComponent(id)}?jeton=${encodeURIComponent(jeton || '')}`);
      if (!rep.ok) { vue.message = '<p>Commande introuvable.</p>'; break; }
      const c = await rep.json();
      if (c.statut !== 'attente') { vue.panier = []; garderPanier(); }
      vue.message = `<div class="confirm"><h3>Commande n° ${c.numero}</h3><p>${libelles[c.statut] || ''}</p>
        <ul class="lignes-panier">${c.lignes.map(l => `<li><span>${esc(l.nom)}</span><b>${l.qte}</b><span class="num">${euros(l.prix * l.qte)}</span></li>`).join('')}</ul>
        <div class="totaux"><div class="total"><span>Total payé</span><span>${euros(c.total)}</span></div></div>
        ${c.suivi ? `<p>Numéro de suivi : <b class="mono">${esc(c.suivi)}</b></p>` : ''}<p class="mini">Un e-mail de confirmation vous a été envoyé.</p></div>`;
      rendre();
      if (['expediee', 'livree', 'retiree', 'annulee', 'remboursee'].includes(c.statut)) break;
    } catch { break; }
    await new Promise(r => setTimeout(r, 3000));
  }
}

document.addEventListener('click', e => {
  const sf = e.target.closest('[data-sf]');
  if (sf) {
    if (sf.dataset.sf === 'ajouter') {
      const p = donnees.produits.find(x => x.id === sf.dataset.id);
      const l = vue.panier.find(x => x.produitId === p.id);
      if (l) l.qte = Math.min(p.type === 'drop' ? 20 : p.stock, l.qte + 1); else vue.panier.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 });
      garderPanier(); vue.message = null; vue.ouvert = true; rendre();
    } else if (sf.dataset.sf === 'panier') { vue.ouvert = true; rendre(); }
    else if (sf.dataset.sf === 'defiler') document.getElementById('sf-collection')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const doc = e.target.closest('[data-action="doc"]');
  if (doc) { vue.legal = doc.dataset.id === 'cgv' ? 'cgv' : 'mentions'; rendre(); return; }
  const el = e.target.closest('[data-c]');
  if (!el) return;
  const c = el.dataset.c;
  if (c === 'fermer') { vue.ouvert = false; if (vue.message && !vue.panier.length) vue.message = null; history.replaceState(null, '', location.pathname); rendre(); }
  else if (c === 'retour-panier') { vue.message = null; rendre(); }
  else if (c === 'qte') {
    const l = vue.panier.find(x => x.produitId === el.dataset.id);
    l.qte += Number(el.dataset.d);
    if (l.qte <= 0) vue.panier = vue.panier.filter(x => x !== l);
    garderPanier(); rendre();
  } else if (c === 'cookies') { try { localStorage.setItem('comptoir-cookies', el.dataset.v); } catch { /* ignoré */ } rendre(); }
  else if (c === 'legal') { vue.legal = el.dataset.v; rendre(); }
  else if (c === 'legal-fermer') { vue.legal = null; rendre(); }
});
document.addEventListener('change', e => { if (e.target.dataset.c === 'livraison') { vue.livraison = e.target.value; rendre(); } });
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'commande') envoyerCommande(e.target);
  else if (e.target.dataset.sf === 'newsletter') inscrireNewsletter(e.target);
  else if (e.target.id === 'form-code') appliquerCode(e.target.elements.code.value);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { vue.legal = null; vue.ouvert = false; rendre(); } });

async function appliquerCode(code) {
  code = String(code || '').trim();
  if (!code) { vue.code = null; vue.codeMessage = ''; rendre(); return; }
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur);
    vue.code = json;
    const calc = calculPanier();
    vue.codeMessage = calc.motif && calc.motif.type === 'code' ? `Code ${json.code} appliqué : −${json.remise} %.` : `Code ${json.code} valable, mais la remise par quantité est plus avantageuse : elle s’applique (non cumulable).`;
  } catch (e) { vue.code = null; vue.codeMessage = e.message || 'Code non reconnu.'; }
  rendre();
}

async function inscrireNewsletter(form) {
  const email = form.querySelector('input[type=email]').value;
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/newsletter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (!rep.ok) throw new Error((await rep.json()).erreur);
    form.innerHTML = `<p>Merci, vous êtes inscrit.${donnees.newsletter && donnees.newsletter.actif && donnees.newsletter.code ? ` Votre code de bienvenue vous attend par e-mail.` : ''}</p>`;
  } catch (e) { form.insertAdjacentHTML('beforeend', `<p class="erreur-form">${esc(e.message || 'Inscription impossible.')}</p>`); }
}

async function reprendrePaiement(id, jeton) {
  vue.ouvert = true; vue.message = '<p>Reprise de votre commande…</p>'; rendre();
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/commandes/${encodeURIComponent(id)}/reprendre`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jeton }) });
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur);
    location.href = json.paiementUrl;
  } catch (e) { vue.message = `<p>${esc(e.message || 'Impossible de reprendre cette commande.')}</p>`; history.replaceState(null, '', location.pathname); rendre(); }
}

demarrer();
