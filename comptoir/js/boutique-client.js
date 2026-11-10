/* Comptoir — boutique publique d’un marchand (servie par le serveur sur /s/<slug>).
   Charge la boutique depuis l’API, gère le panier et envoie la commande au serveur,
   qui recalcule les prix et redirige vers le paiement (TWINT/carte ou simulation). */

// Sur un domaine personnalisé, le serveur indique la boutique dans une balise meta ; sinon /s/<slug>.
const slug = (document.querySelector('meta[name="comptoir-slug"]') || {}).content || location.pathname.split('/').filter(Boolean)[1];
const racineBoutique = document.querySelector('meta[name="comptoir-slug"]') ? '/' : location.pathname;

/* Mesure d’audience sans cookie : identifiant aléatoire propre à l’onglet (perdu à sa fermeture), aucune donnée personnelle. */
const sessionMesure = (() => { try { let s = sessionStorage.getItem('comptoir-session'); if (!s) { s = 's' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); sessionStorage.setItem('comptoir-session', s); } return s; } catch { return 's' + Math.random().toString(36).slice(2, 14); } })();
const dejaMesure = new Set();
function mesurer(type, extra = {}) {
  const cle = type + (extra.valeur || '');
  if (dejaMesure.has(cle) && type !== 'panier') return;
  dejaMesure.add(cle);
  try { fetch(`/api/public/${encodeURIComponent(slug)}/evenement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, session: sessionMesure, ...extra }), keepalive: true }).catch(() => {}); } catch { /* ignoré */ }
}
const CLE_PANIER = `comptoir-panier-${slug}`;
let etat = null;           // lu par storefront.js (devise, produits, boutique)
let donnees = null;
const vue = { fiche: null, panier: lirePanier(), ouvert: false, livraison: null, envoi: false, message: null, legal: null, code: null, codeMessage: '' };

function lirePanier() { try { return JSON.parse(localStorage.getItem(CLE_PANIER)) || []; } catch { return []; } }
function garderPanier() { try { localStorage.setItem(CLE_PANIER, JSON.stringify(vue.panier)); } catch { /* ignoré */ } }
const $ = s => document.querySelector(s);

async function demarrer() {
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}`);
    if (!rep.ok) throw new Error((await rep.json()).erreur || 'Boutique introuvable.');
    donnees = await rep.json();
    if (location.hash.startsWith('#produit-')) vue.fiche = decodeURIComponent(location.hash.slice(9));
  } catch (e) {
    $('#app').innerHTML = `<div class="page-erreur"><h1>Boutique introuvable</h1><p>${esc(e.message)}</p></div>`;
    return;
  }
  etat = { boutique: donnees.boutique, produits: donnees.produits, entreprise: donnees.entreprise, magasin: donnees.magasin, avisRecents: donnees.avisRecents || [] };
  document.title = donnees.boutique.nom;
  document.body.style.background = donnees.boutique.theme.bg;
  // Le panier ne garde que les produits encore en vente, au prix actuel.
  vue.panier = vue.panier.map(l => { const p = donnees.produits.find(x => x.id === l.produitId); return p && { produitId: p.id, nom: p.nom, prix: p.prix, qte: l.qte }; }).filter(Boolean);
  vue.livraison = Object.keys(donnees.livraisons)[0];
  mesurer('vue');
  const q = new URLSearchParams(location.search);
  if (q.get('reprendre')) { reprendrePaiement(q.get('reprendre'), q.get('jeton')); return; }
  if (q.get('avis')) { formulaireAvis(q.get('avis'), q.get('jeton')); return; }
  if (q.get('commande')) suivreCommande(q.get('commande'), q.get('jeton'), q.get('annule'));
  rendre();
}

/* NPA → localité pour les plages les plus courantes de Suisse romande (la saisie reste libre). */
const NPA_CH = [[1000, 1018, 'Lausanne'], [1020, 1020, 'Renens'], [1009, 1009, 'Pully'], [1110, 1110, 'Morges'], [1260, 1260, 'Nyon'], [1400, 1400, 'Yverdon-les-Bains'], [1700, 1709, 'Fribourg'], [1800, 1800, 'Vevey'], [1820, 1820, 'Montreux'], [1950, 1951, 'Sion'], [1200, 1209, 'Genève'], [1227, 1227, 'Carouge'], [2000, 2000, 'Neuchâtel'], [2300, 2300, 'La Chaux-de-Fonds'], [2500, 2505, 'Bienne'], [3000, 3030, 'Berne'], [8000, 8099, 'Zurich'], [4000, 4059, 'Bâle']];
document.addEventListener('input', e => {
  if (e.target.name !== 'npa' || !donnees || donnees.boutique.pays !== 'ch') return;
  const n = Number(e.target.value);
  const ville = e.target.form && e.target.form.elements.ville;
  const t = NPA_CH.find(([a, b]) => n >= a && n <= b);
  if (t && ville && !ville.value) ville.value = t[2];
});

function fraisPortClient(cle, sousTotal) {
  const m = donnees.livraisons[cle];
  if (!m || !m.prix) return 0;
  return donnees.seuilPortOffert > 0 && !m.jamaisOffert && sousTotal >= donnees.seuilPortOffert ? 0 : m.prix;
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
  const regle = vue.panier.length ? Remises.regleApplicable({ offres: donnees.offres }, vue.panier, 'panier') : null;
  const produitOffre = regle ? donnees.produits.find(p => p.id === regle.alors && (p.type === 'drop' || p.stock > 0)) : null;
  if (produitOffre && vue.ouvert) mesurer('offre_vue', { valeur: regle.id });
  const suggestion = donnees.offres.suggestions && !produitOffre ? donnees.produits.find(p => !vue.panier.some(l => l.produitId === p.id) && (p.type === 'drop' || p.stock > 0)) : null;
  const drops = vue.panier.map(l => donnees.produits.find(p => p.id === l.produitId)).filter(p => p && p.type === 'drop' && p.delai);
  const delai = drops.length ? [Math.max(...drops.map(p => p.delai[0])), Math.max(...drops.map(p => p.delai[1]))] : null;
  const ch = donnees.boutique.pays === 'ch';
  const retrait = vue.livraison === 'retrait';
  const th = donnees.boutique.theme;
  let cookies = null;
  try { cookies = localStorage.getItem('comptoir-cookies'); } catch { /* ignoré */ }

  $('#app').innerHTML = `
    ${renduBoutique(etat, { mode: 'live', panier: vue.panier, fiche: vue.fiche })}
    ${cookies ? '' : `<div class="cookies" role="region" aria-label="Cookies"><p>${esc(donnees.boutique.nom)} utilise uniquement des cookies nécessaires au panier. Aucune mesure d’audience n’est activée sans votre accord.</p><div class="rangee"><button class="btn petit fantome" data-c="cookies" data-v="refus">Refuser</button><button class="btn petit fantome" data-c="cookies" data-v="accord">Accepter</button></div></div>`}
    <div class="tiroir ${vue.ouvert ? 'ouvert' : ''}" aria-hidden="${!vue.ouvert}">
      <div class="tiroir-fond" data-c="fermer"></div>
      <aside class="tiroir-corps" style="${varsTheme(th)}">
        <div class="carte-tete"><h2>${vue.message ? 'Votre commande' : 'Panier'}</h2><button class="icone" data-c="fermer">Fermer</button></div>
        ${vue.message ? vue.message : vue.panier.length ? `
          <ul class="lignes-panier">${calc.lignes.map(l => l.offre ? `<li><span>${esc(l.nom)} <small class="mini">offre −${Math.round((1 - l.prix / l.prixInitial) * 100)} %</small></span>
            <button class="bouton-lien" data-c="retirer-offre">Retirer</button><span class="num">${euros(l.prix)}</span></li>` : `<li><span>${esc(l.nom)}</span>
            <div class="qte"><button data-c="qte" data-id="${esc(l.produitId)}" data-d="-1" aria-label="Retirer un">−</button><b>${l.qte}</b><button data-c="qte" data-id="${esc(l.produitId)}" data-d="1" aria-label="Ajouter un">+</button></div>
            <span class="num">${euros(l.prixInitial * l.qte)}</span></li>`).join('')}</ul>
          ${donnees.offres.barrePort && seuil > 0 && vue.livraison !== 'retrait' ? `<div class="barre-port"><p>${total >= seuil ? 'Livraison offerte' : `Plus que <b>${euros(seuil - total)}</b> pour la livraison offerte`}</p><span><i style="width:${Math.min(100, total / seuil * 100)}%"></i></span></div>` : ''}
          ${calc.prochainPalier ? `<p class="palier">Ajoutez ${calc.prochainPalier.manque} article${calc.prochainPalier.manque > 1 ? 's' : ''} : <b>−${calc.prochainPalier.remise} %</b> sur toute la commande.</p>` : ''}
          ${produitOffre ? `<label class="offre-panier">${visuelProduit(produitOffre)}<span><input type="checkbox" data-c="offre" data-regle="${esc(regle.id)}" data-id="${esc(produitOffre.id)}"> <strong>Ajouter ${esc(produitOffre.nom)}</strong><br><s>${euros(produitOffre.prix)}</s> <b>${euros(produitOffre.prix * (1 - regle.remise / 100))}</b> · −${regle.remise} % seulement avec cette commande</span></label>` : ''}
          ${suggestion ? `<div class="suggestion">${visuelProduit(suggestion)}<div><small>Souvent ajouté</small><strong>${esc(suggestion.nom)}</strong><span>${euros(suggestion.prix)}</span></div><button class="sf-btn sf-btn-ligne" data-sf="ajouter" data-id="${esc(suggestion.id)}">Ajouter</button></div>` : ''}
          <form id="form-code" class="code-promo"><input name="code" placeholder="Code promo" aria-label="Code promo" value="${esc(vue.code ? vue.code.code : '')}" autocomplete="off"><button class="sf-btn sf-btn-ligne">${vue.code ? 'Changer' : 'Appliquer'}</button></form>
          ${vue.codeMessage ? `<p class="mini">${esc(vue.codeMessage)}</p>` : ''}
          <fieldset class="modes-livraison"><legend>Livraison</legend>${Object.entries(donnees.livraisons).map(([k, m]) => `
            <label class="${vue.livraison === k ? 'actif' : ''}"><input type="radio" name="livraison" value="${esc(k)}" data-c="livraison" ${vue.livraison === k ? 'checked' : ''}>
            <span>${esc(m.nom)}<small>${k === 'retrait' ? esc(donnees.magasin.adresse) : esc(fenetreLivraison(k === 'poste-prio' && !delai ? [1, 1] : delai || [2, 3]))}</small></span><b>${fraisPortClient(k, total) ? euros(fraisPortClient(k, total)) : 'Offert'}</b></label>`).join('')}</fieldset>
          <div class="totaux"><div><span>Sous-total</span><span>${euros(calc.sousTotal)}</span></div>${calc.remise ? `<div class="remise"><span>Remise · ${esc(calc.motif.libelle)}</span><span>−${euros(calc.remise)}</span></div>` : ''}<div><span>Livraison</span><span>${port ? euros(port) : 'Offerte'}</span></div><div class="total"><span>Total</span><span>${euros(total + port)}</span></div></div>
          <form id="commande">
            <label class="champ"><span>Nom et prénom</span><input name="nom" required autocomplete="name"></label>
            <label class="champ"><span>E-mail</span><input name="email" type="email" required autocomplete="email"></label>
            ${retrait ? '' : `<label class="champ"><span>Adresse</span><input name="adresse" required autocomplete="street-address"></label>
            <div class="deux"><label class="champ"><span>${ch ? 'NPA' : 'Code postal'}</span><input name="npa" required inputmode="numeric" autocomplete="postal-code" ${ch ? 'pattern="[0-9]{4}" maxlength="4"' : ''}></label>`}
            <label class="champ"><span>Ville</span><input name="ville" required autocomplete="address-level2"></label>${retrait ? '' : '</div>'}
            <label class="case-sf"><input type="checkbox" name="consentement"> Recevoir les nouveautés et offres par e-mail (facultatif, désinscription à tout moment)</label>
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
  mesurer('paiement');
  vue.envoi = true; rendre();
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/commandes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lignes: vue.panier.map(l => ({ produitId: l.produitId, qte: l.qte, ...(l.offre ? { offre: l.offre } : {}) })), livraison: vue.livraison, code: vue.code ? vue.code.code : undefined, client: { ...Object.fromEntries(d), consentement: d.get('consentement') === 'on' } })
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
  if (annule) { vue.message = '<p>Le paiement a été annulé. Votre panier est conservé : vous pouvez réessayer.</p>'; history.replaceState(null, '', racineBoutique); vue.message += '<button class="sf-btn" data-c="retour-panier">Revenir au panier</button>'; return; }
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
        ${c.suivi ? `<p>Numéro de suivi : <b class="mono">${esc(c.suivi)}</b></p>` : ''}<p class="mini">Un e-mail de confirmation vous a été envoyé.</p></div>
        ${c.offreApres ? `<div class="offre-apres">${visuelProduit({ nom: c.offreApres.nom, teinte: c.offreApres.teinte, image: c.offreApres.image })}<div><small>Uniquement maintenant</small><strong>${esc(c.offreApres.nom)}</strong><span><s>${euros(c.offreApres.prix)}</s> <b>${euros(c.offreApres.prixOffre)}</b> (−${c.offreApres.remise} %), livré dans le même colis, sans frais de port.</span>
          <button class="sf-btn" data-c="complement" data-commande="${esc(id)}" data-jeton="${esc(jeton)}" data-regle="${esc(c.offreApres.regle)}">Ajouter à ma commande</button><button class="bouton-lien" data-c="refuser-offre">Non merci</button></div></div>` : ''}`;
      if (c.offreApres) mesurer('offre_vue', { valeur: c.offreApres.regle });
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
      const l = vue.panier.find(x => x.produitId === p.id && !x.offre);
      mesurer('panier', { produitId: p.id });
      const q = Math.max(1, Number(document.querySelector('[data-sf-qte]')?.value) || 1);
      const max = p.type === 'drop' ? 20 : p.stock;
      if (l) l.qte = Math.min(max, l.qte + q); else vue.panier.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: Math.min(max, q) });
      garderPanier(); vue.fiche = null; vue.message = null; vue.ouvert = true; rendre();
    } else if (sf.dataset.sf === 'panier') { vue.ouvert = true; rendre(); }
    else if (sf.dataset.sf === 'fiche') { vue.fiche = sf.dataset.id; history.replaceState(null, '', '#produit-' + encodeURIComponent(sf.dataset.id)); rendre(); document.querySelector('.sf-fiche-fermer')?.focus(); }
    else if (sf.dataset.sf === 'fermer-fiche') { vue.fiche = null; history.replaceState(null, '', location.pathname + location.search); rendre(); }
    else if (sf.dataset.sf === 'nav') allerSection(document, sf.dataset.v);
    else if (sf.dataset.sf === 'defiler') document.getElementById('sf-collection')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const doc = e.target.closest('[data-action="doc"]');
  if (doc) { vue.legal = doc.dataset.id === 'cgv' ? 'cgv' : 'mentions'; rendre(); return; }
  const el = e.target.closest('[data-c]');
  if (!el) return;
  const c = el.dataset.c;
  if (c === 'fermer') { vue.ouvert = false; if (vue.message && !vue.panier.length) vue.message = null; history.replaceState(null, '', racineBoutique); rendre(); }
  else if (c === 'retirer-offre') { vue.panier = vue.panier.filter(x => !x.offre); garderPanier(); rendre(); }
  else if (c === 'retour-panier') { vue.message = null; rendre(); }
  else if (c === 'qte') {
    const l = vue.panier.find(x => x.produitId === el.dataset.id && !x.offre);
    l.qte += Number(el.dataset.d);
    if (l.qte <= 0) vue.panier = vue.panier.filter(x => x !== l);
    garderPanier(); rendre();
  } else if (c === 'cookies') { try { localStorage.setItem('comptoir-cookies', el.dataset.v); } catch { /* ignoré */ } rendre(); }
  else if (c === 'legal') { vue.legal = el.dataset.v; rendre(); }
  else if (c === 'legal-fermer') { vue.legal = null; rendre(); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.c === 'livraison') { vue.livraison = e.target.value; mesurer('livraison'); rendre(); }
  else if (e.target.dataset.c === 'offre') {
    const p = donnees.produits.find(x => x.id === e.target.dataset.id);
    if (e.target.checked) vue.panier.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1, offre: e.target.dataset.regle });
    garderPanier(); rendre();
  }
});
document.addEventListener('focusin', e => { if (e.target.closest && e.target.closest('#commande')) mesurer('livraison'); });
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-c="complement"]');
  if (b) {
    b.disabled = true;
    try {
      const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/commandes/${encodeURIComponent(b.dataset.commande)}/complement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jeton: b.dataset.jeton, regle: b.dataset.regle }) });
      const json = await rep.json();
      if (!rep.ok) throw new Error(json.erreur);
      location.href = json.paiementUrl;
    } catch (err) { b.disabled = false; b.insertAdjacentHTML('afterend', `<p class="erreur-form">${esc(err.message || 'Offre indisponible.')}</p>`); }
  } else if (e.target.closest('[data-c="refuser-offre"]')) { document.querySelector('.offre-apres')?.remove(); }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'commande') envoyerCommande(e.target);
  else if (e.target.dataset.sf === 'newsletter') inscrireNewsletter(e.target);
  else if (e.target.id === 'form-code') appliquerCode(e.target.elements.code.value);
  else if (e.target.id === 'form-avis') envoyerAvis(e.target);
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
  } catch (e) { vue.message = `<p>${esc(e.message || 'Impossible de reprendre cette commande.')}</p>`; history.replaceState(null, '', racineBoutique); rendre(); }
}

async function formulaireAvis(id, jeton) {
  vue.ouvert = true;
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/avis-a-donner?commande=${encodeURIComponent(id)}&jeton=${encodeURIComponent(jeton)}`);
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur);
    vue.avis = { id, jeton };
    vue.message = json.produits.length ? `<form id="form-avis" class="form-avis"><p>Merci ${esc(json.prenom)} ! Votre avis sera publié avec votre prénom et votre ville, marqué « achat vérifié ».</p>
      ${json.produits.map(p => `<fieldset data-produit="${esc(p.produitId)}"><legend>${esc(p.nom)}</legend>
        <div class="etoiles-saisie">${[5, 4, 3, 2, 1].map(n => `<input type="radio" id="n-${esc(p.produitId)}-${n}" name="note-${esc(p.produitId)}" value="${n}" required><label for="n-${esc(p.produitId)}-${n}" title="${n} étoile${n > 1 ? 's' : ''}">★</label>`).join('')}</div>
        <textarea name="texte-${esc(p.produitId)}" rows="3" maxlength="1000" placeholder="Qu’avez-vous aimé ? Qu’est-ce qui pourrait être mieux ?"></textarea></fieldset>`).join('')}
      <button class="sf-btn plein">Publier mon avis</button></form>` : '<p>Vous avez déjà donné votre avis pour cette commande. Merci !</p>';
  } catch (e) { vue.message = `<p>${esc(e.message || 'Lien d’avis invalide.')}</p>`; }
  history.replaceState(null, '', racineBoutique);
  rendre();
}
async function envoyerAvis(form) {
  const avis = [...form.querySelectorAll('fieldset[data-produit]')].map(f => ({ produitId: f.dataset.produit, note: Number((f.querySelector('input:checked') || {}).value), texte: f.querySelector('textarea').value }));
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/avis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandeId: vue.avis.id, jeton: vue.avis.jeton, avis }) });
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur);
    vue.message = '<p>Merci, votre avis est publié.</p>';
  } catch (e) { vue.message = `<p>${esc(e.message || 'Envoi impossible.')}</p>`; }
  rendre();
}

demarrer();

document.addEventListener('keydown', e => { if (e.key === 'Escape' && vue.fiche) { vue.fiche = null; rendre(); } });
