/* Comptoir — boutique publique d’un marchand (servie par le serveur sur /s/<slug>).
   Charge la boutique depuis l’API, gère le panier et envoie la commande au serveur,
   qui recalcule les prix et redirige vers le paiement (TWINT/carte ou simulation). */

// Sur un domaine personnalisé, le serveur indique la boutique dans une balise meta ; sinon /s/<slug>.
const slug = (document.querySelector('meta[name="comptoir-slug"]') || {}).content || location.pathname.split('/').filter(Boolean)[1];
// Racine de la boutique (« /s/<slug>/ » ou « / » sur un domaine personnalisé), donnée par le serveur.
const racineBoutique = (document.querySelector('meta[name="comptoir-racine"]') || {}).content || location.pathname.replace(/\/p\/[^/]+\/?$/, '/');
const urlFiche = id => racineBoutique.replace(/\/?$/, '/') + 'p/' + encodeURIComponent(id);

/* Mesure d’audience sans cookie : identifiant aléatoire propre à l’onglet (perdu à sa fermeture), aucune donnée personnelle. */
// Mesure seulement après « Accepter » (le bandeau le promet) ; l'identifiant d'onglet n'est créé qu'à ce moment-là.
function consentementMesure() { try { return localStorage.getItem('comptoir-cookies') === 'accord'; } catch { return false; } }
function sessionMesureCourante() { try { let s = sessionStorage.getItem('comptoir-session'); if (!s) { s = 's' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); sessionStorage.setItem('comptoir-session', s); } return s; } catch { return null; } }
const dejaMesure = new Set();
function mesurer(type, extra = {}) {
  if (!consentementMesure()) return;
  const sessionMesure = sessionMesureCourante();
  const cle = type + (extra.valeur || '');
  if (dejaMesure.has(cle) && type !== 'panier') return;
  dejaMesure.add(cle);
  try { fetch(`/api/public/${encodeURIComponent(slug)}/evenement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, session: sessionMesure, ...extra }), keepalive: true }).catch(() => {}); } catch { /* ignoré */ }
}
const CLE_PANIER = `comptoir-panier-${slug}`;
let etat = null;           // lu par storefront.js (devise, produits, boutique)
let donnees = null;
const vue = { saisie: {}, fiche: null, panier: lirePanier(), ouvert: false, livraison: null, envoi: false, message: null, legal: null, code: null, codeMessage: '' };

function lirePanier() { try { return JSON.parse(localStorage.getItem(CLE_PANIER)) || []; } catch { return []; } }
function garderPanier() { try { localStorage.setItem(CLE_PANIER, JSON.stringify(vue.panier)); } catch { /* ignoré */ } }
const $ = s => document.querySelector(s);

async function demarrer() {
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}`);
    if (!rep.ok) throw new Error((await rep.json()).erreur || 'Boutique introuvable.');
    donnees = await rep.json();
    const produitPage = (document.querySelector('meta[name="comptoir-produit"]') || {}).content;
    if (produitPage) vue.fiche = produitPage;
    else if (location.hash.startsWith('#produit-')) vue.fiche = decodeURIComponent(location.hash.slice(9));   // anciens liens
  } catch (e) {
    $('#app').innerHTML = `<div class="page-erreur"><h1>Boutique introuvable</h1><p>${esc(e.message)}</p></div>`;
    return;
  }
  etat = { boutique: donnees.boutique, produits: donnees.produits, entreprise: donnees.entreprise, magasin: donnees.magasin, avisRecents: donnees.avisRecents || [] };
  if (!vue.fiche) document.title = titreAccueil();
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
// Principales localités de Suisse (NPA de début et de fin). La plage la plus précise l’emporte : 1009 donne Pully, pas Lausanne.
const NPA_CH = [[1000, 1018, 'Lausanne'], [1009, 1009, 'Pully'], [1012, 1012, 'Lausanne'], [1020, 1020, 'Renens'], [1023, 1023, 'Crissier'], [1024, 1024, 'Ecublens'], [1030, 1030, 'Bussigny'], [1052, 1052, 'Le Mont-sur-Lausanne'], [1066, 1066, 'Epalinges'], [1070, 1070, 'Puidoux'], [1095, 1095, 'Lutry'], [1110, 1110, 'Morges'], [1131, 1131, 'Tolochenaz'], [1163, 1163, 'Etoy'], [1180, 1180, 'Rolle'], [1196, 1196, 'Gland'], [1200, 1209, 'Genève'], [1212, 1212, 'Grand-Lancy'], [1213, 1213, 'Petit-Lancy'], [1214, 1214, 'Vernier'], [1217, 1217, 'Meyrin'], [1218, 1218, 'Le Grand-Saconnex'], [1219, 1219, 'Le Lignon'], [1220, 1220, 'Les Avanchets'], [1224, 1224, 'Chêne-Bougeries'], [1225, 1225, 'Chêne-Bourg'], [1226, 1226, 'Thônex'], [1227, 1227, 'Carouge'], [1228, 1228, 'Plan-les-Ouates'], [1231, 1231, 'Conches'], [1232, 1232, 'Confignon'], [1233, 1233, 'Bernex'], [1234, 1234, 'Vessy'], [1242, 1242, 'Satigny'], [1245, 1245, 'Collonge-Bellerive'], [1246, 1246, 'Corsier'], [1253, 1253, 'Vandœuvres'], [1255, 1255, 'Veyrier'], [1260, 1260, 'Nyon'], [1290, 1290, 'Versoix'], [1295, 1295, 'Mies'], [1400, 1400, 'Yverdon-les-Bains'], [1450, 1450, 'Sainte-Croix'], [1530, 1530, 'Payerne'], [1580, 1580, 'Avenches'], [1610, 1610, 'Oron-la-Ville'], [1630, 1630, 'Bulle'], [1700, 1709, 'Fribourg'], [1720, 1720, 'Corminbœuf'], [1752, 1752, 'Villars-sur-Glâne'], [1762, 1762, 'Givisiez'], [1800, 1800, 'Vevey'], [1814, 1814, 'La Tour-de-Peilz'], [1815, 1815, 'Clarens'], [1820, 1820, 'Montreux'], [1844, 1844, 'Villeneuve'], [1860, 1860, 'Aigle'], [1870, 1870, 'Monthey'], [1880, 1880, 'Bex'], [1890, 1890, 'Saint-Maurice'], [1920, 1920, 'Martigny'], [1950, 1951, 'Sion'], [1964, 1964, 'Conthey'], [1958, 1958, 'Uvrier'], [3960, 3960, 'Sierre'], [3900, 3900, 'Brigue'], [3920, 3920, 'Zermatt'], [3963, 3963, 'Crans-Montana'], [2000, 2000, 'Neuchâtel'], [2016, 2016, 'Cortaillod'], [2072, 2072, 'Saint-Blaise'], [2300, 2300, 'La Chaux-de-Fonds'], [2400, 2400, 'Le Locle'], [2502, 2505, 'Bienne'], [2500, 2500, 'Bienne'], [2800, 2800, 'Delémont'], [2900, 2900, 'Porrentruy'], [3000, 3030, 'Berne'], [3084, 3084, 'Wabern'], [3097, 3097, 'Liebefeld'], [3400, 3400, 'Berthoud'], [3600, 3600, 'Thoune'], [3800, 3800, 'Interlaken'], [4000, 4059, 'Bâle'], [4102, 4102, 'Binningen'], [4123, 4123, 'Allschwil'], [4410, 4410, 'Liestal'], [4500, 4500, 'Soleure'], [4600, 4600, 'Olten'], [5000, 5000, 'Aarau'], [5400, 5400, 'Baden'], [6000, 6009, 'Lucerne'], [6300, 6300, 'Zoug'], [6340, 6340, 'Baar'], [6500, 6500, 'Bellinzone'], [6600, 6600, 'Locarno'], [6900, 6908, 'Lugano'], [6850, 6850, 'Mendrisio'], [7000, 7000, 'Coire'], [7500, 7500, 'Saint-Moritz'], [7270, 7270, 'Davos'], [8000, 8099, 'Zurich'], [8200, 8200, 'Schaffhouse'], [8302, 8302, 'Kloten'], [8400, 8411, 'Winterthour'], [8500, 8500, 'Frauenfeld'], [8600, 8600, 'Dübendorf'], [8700, 8700, 'Küsnacht'], [8800, 8800, 'Thalwil'], [8840, 8840, 'Einsiedeln'], [8952, 8952, 'Schlieren'], [9000, 9016, 'Saint-Gall'], [9100, 9100, 'Herisau'], [9500, 9500, 'Wil']];
document.addEventListener('input', e => {
  if (e.target.name !== 'npa' || !donnees || donnees.boutique.pays !== 'ch') return;
  const n = Number(e.target.value);
  const ville = e.target.form && e.target.form.elements.ville;
  const t = NPA_CH.filter(([a, b]) => n >= a && n <= b).sort((x, y) => (x[1] - x[0]) - (y[1] - y[0]))[0];
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

/* Le panier se redessine à chaque changement (livraison, code, quantité) : on garde ce que le client a déjà
   saisi, l’élément actif et la position de défilement, sinon il devrait tout retaper. */
const CHAMPS_CLIENT = ['nom', 'email', 'adresse', 'npa', 'ville', 'consentement'];
function lireSaisie() {
  const f = document.getElementById('commande');
  if (f) for (const k of CHAMPS_CLIENT) { const el = f.elements[k]; if (el) vue.saisie[k] = el.type === 'checkbox' ? el.checked : el.value; }
  const code = document.querySelector('#form-code input');
  if (code && !vue.code) vue.saisie.code = code.value;
}
function rendre() {
  lireSaisie();
  const ae = document.activeElement;
  const actif = ae && ae.name && ae.type !== 'radio' ? { nom: ae.name, form: ae.form && ae.form.id, debut: ae.selectionStart } : null;
  // Boutons et choix (+, −, livraison, Appliquer…) : retrouvés après le rendu par leurs attributs, pour garder le focus clavier.
  const cleFocus = ae && ae !== document.body && !actif ? ['data-c', 'data-sf', 'data-id', 'data-d', 'name', 'value'].filter(k => ae.hasAttribute(k) && (k !== 'value' || ae.type === 'radio')).map(k => `[${k}="${CSS.escape(ae.getAttribute(k))}"]`).join('') : '';
  const dansTiroir = !!(ae && ae.closest && ae.closest('.tiroir-corps'));
  const idFocus = ae && ae !== document.body && ae.id ? ae.id : '';
  const etaitOuvert = !!document.querySelector('.tiroir.ouvert');
  const defil = document.querySelector('.tiroir-corps')?.scrollTop || 0;
  rendreBrut();
  const f = document.getElementById('commande');
  if (f) for (const k of CHAMPS_CLIENT) { const el = f.elements[k]; if (el && vue.saisie[k] !== undefined) { if (el.type === 'checkbox') el.checked = !!vue.saisie[k]; else el.value = vue.saisie[k]; } }
  const code = document.querySelector('#form-code input');
  if (code && !vue.code && vue.saisie.code) code.value = vue.saisie.code;
  const corps = document.querySelector('.tiroir-corps');
  if (corps) corps.scrollTop = defil;
  if (actif && actif.form) {
    const el = document.getElementById(actif.form)?.elements[actif.nom];
    if (el && el.type !== 'radio') { el.focus({ preventScroll: true }); try { if (actif.debut !== null && actif.debut !== undefined) el.setSelectionRange(actif.debut, actif.debut); } catch { /* champ sans sélection */ } }
  } else if (vue.legal && !document.activeElement.closest?.('#modal')) {
    document.querySelector('#modal .modal-x')?.focus({ preventScroll: true });
  } else if (vue.ouvert && !etaitOuvert) {
    document.querySelector('.tiroir-corps h2')?.focus({ preventScroll: true });   // à l'ouverture, le lecteur d'écran annonce le panier
  } else if (cleFocus || idFocus) {
    const el = (cleFocus && document.querySelector(cleFocus + ':not([disabled])')) || (idFocus && document.getElementById(idFocus));
    if (el) el.focus({ preventScroll: true });
    else if (dansTiroir && vue.ouvert) document.querySelector('.tiroir-corps h2')?.focus({ preventScroll: true });
  }
}
function rendreBrut() {
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
    <div class="tiroir ${vue.ouvert ? 'ouvert' : ''}" aria-hidden="${!vue.ouvert}" ${vue.ouvert ? '' : 'inert'}>
      <div class="tiroir-fond" data-c="fermer"></div>
      <aside class="tiroir-corps" style="${varsTheme(th)}" role="dialog" aria-modal="true" aria-labelledby="titre-tiroir">
        <div class="carte-tete"><h2 id="titre-tiroir" tabindex="-1">${vue.message ? 'Votre commande' : 'Panier'}</h2><button class="icone" data-c="fermer">Fermer</button></div>
        ${vue.message ? vue.message : vue.panier.length ? `
          <ul class="lignes-panier">${calc.lignes.map(l => l.offre ? `<li><span>${esc(l.nom)} <small class="mini">offre −${Math.round((1 - l.prix / l.prixInitial) * 100)} %</small></span>
            <button class="bouton-lien" data-c="retirer-offre">Retirer</button><span class="num">${euros(l.prix)}</span></li>` : `<li><span>${esc(l.nom)}</span>
            <div class="qte"><button data-c="qte" data-id="${esc(l.produitId)}" data-d="-1" aria-label="Retirer un">−</button><b>${l.qte}</b><button data-c="qte" data-id="${esc(l.produitId)}" data-d="1" aria-label="Ajouter un" ${(() => { const pr = donnees.produits.find(x => x.id === l.produitId); return pr && l.qte >= (pr.type === 'drop' ? 20 : pr.stock) ? 'disabled title="Stock maximum atteint"' : ''; })()}>+</button></div>
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
            ${(donnees.entreprise || {}).adresse ? '' : '<p class="sf-note" role="status">Cette boutique termine la saisie de ses informations légales : les commandes ouvrent très bientôt.</p>'}
            <button class="sf-btn plein" ${vue.envoi || !(donnees.entreprise || {}).adresse ? 'disabled' : ''}>${vue.envoi ? 'Redirection vers le paiement…' : `Payer ${euros(total + port)}`}</button>
            <p class="mini">${donnees.paiement === 'stripe' ? (ch ? 'Paiement sécurisé par TWINT ou carte.' : donnees.boutique.pays === 'be' ? 'Paiement sécurisé par Bancontact ou carte.' : 'Paiement sécurisé par carte.') : 'Mode test : le paiement est simulé, aucun montant n’est débité.'} En payant, vous acceptez les <button type="button" class="bouton-lien" data-c="legal" data-v="cgv">CGV</button>.</p>
          </form>` : '<p>Votre panier est vide.</p>'}
      </aside>
    </div>
    ${vue.legal ? `<div id="modal"><div class="modal-fond" data-c="legal-fermer"></div><div class="modal-corps" role="dialog" aria-modal="true"><button class="icone modal-x" data-c="legal-fermer">Fermer</button><article class="doc-legal">${texteLegal(vue.legal)}</article></div></div>` : ''}`;
}

function texteLegal(type) {
  const e = donnees.entreprise, b = donnees.boutique, ch = b.pays === 'ch';
  if (type === 'cgv') return `<h2>Conditions générales de vente</h2>
    <p><strong>Vendeur.</strong> ${esc(e.raison || b.nom)}${e.siret ? `, ${ch ? 'IDE' : esc(droitPays(b.pays).idCourt)} ${esc(e.siret)}` : ''}${e.adresse ? `, ${esc(e.adresse)}` : ''}${e.email ? `. Contact : ${esc(e.email)}` : ''}.</p>
    <p><strong>Prix.</strong> En ${esc(b.devise)}. ${esc(mentionTva(e.regime, b.pays))}.</p>
    ${(() => { const etr = donnees.produits.some(p => p.type === 'drop' && p.entrepot && (ch ? p.entrepot !== 'CH' : p.entrepot !== 'UE')); return etr ? `<p><strong>Importation.</strong> ${ch ? 'Les articles expédiés depuis l’étranger peuvent être soumis à la TVA d’importation et à des frais de dédouanement, réclamés à la livraison par La Poste lorsque la TVA dépasse CHF 5 par envoi.' : 'Les articles expédiés depuis l’extérieur de l’Union européenne peuvent être soumis à la TVA d’importation et à des frais du transporteur, réclamés à la livraison.'} La fiche de chaque produit indique son pays d’expédition.</p>` : ''; })()}
    <p><strong>Livraison.</strong> ${Object.values(donnees.livraisons).map(m => `${esc(m.nom)} : ${m.prix ? euros(m.prix) : 'gratuit'}`).join(' ; ')}. ${donnees.seuilPortOffert > 0 ? `Offerte dès ${euros(donnees.seuilPortOffert)} sauf envoi express.` : 'Pas de livraison offerte.'} Les articles expédiés par nos partenaires indiquent leur délai sur la fiche produit.</p>
    <p><strong>Retours.</strong> ${ch ? `Le droit suisse ne prévoit pas de droit de rétractation général pour les achats en ligne. ${Number(e.retoursJours) > 0 ? `Nous acceptons toutefois les retours sous ${Number(e.retoursJours)} jours après réception (articles non utilisés, dans leur emballage ; frais de retour à la charge du client).` : 'Les articles ne sont ni repris ni échangés, sauf défaut (voir la garantie).'}` : `Vous disposez de 14 jours à compter de la réception pour vous rétracter, sans avoir à vous justifier (${esc(droitPays(b.pays).retractation)}). Il suffit de nous l’écrire${e.email ? ` à ${esc(e.email)}` : ''} ; le remboursement intervient au plus tard 14 jours après votre demande, frais de livraison initiaux compris (hors envoi express).`}</p>
    <p><strong>Garantie.</strong> ${ch ? 'Garantie de 2 ans pour les défauts (art. 197 ss CO).' : 'Garantie légale de conformité de 2 ans et garantie des vices cachés.'}</p>
    ${!ch && e.mediateur ? `<p><strong>Médiation.</strong> En cas de litige, vous pouvez recourir gratuitement au médiateur de la consommation : ${esc(e.mediateur)}.</p>` : ''}`;
  return `<h2>${ch ? 'Impressum et protection des données' : 'Mentions légales'}</h2>
    <p><strong>Exploitant.</strong> ${[e.raison || b.nom, e.forme, e.siret ? `${ch ? 'IDE' : droitPays(b.pays).idCourt} ${e.siret}` : '', e.adresse].filter(Boolean).map(esc).join(', ')}.${e.email ? ` Contact : ${esc(e.email)}${e.telephone ? `, ${esc(e.telephone)}` : ''}.` : ''}</p>
    ${e.tvaIntra ? `<p><strong>TVA.</strong> ${esc(e.tvaIntra)}</p>` : ''}
    ${!ch && e.mediateur ? `<p><strong>Médiateur de la consommation.</strong> ${esc(e.mediateur)}</p>` : ''}
    <p><strong>Hébergement.</strong> ${donnees.hebergeur ? esc(donnees.hebergeur) : 'Plateforme Comptoir'}.</p>
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
    try { if (json.commandeId) sessionStorage.setItem('comptoir-paiement-' + json.commandeId, '1'); } catch { /* ignoré */ }
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
      // Date de livraison estimée : délai le plus long des articles, ou celui du mode choisi ; retrait : adresse du magasin.
      const prods = c.lignes.map(l => donnees.produits.find(p => p.id === l.produitId)).filter(Boolean);
      const drops = prods.filter(p => p.type === 'drop' && p.delai);
      const delai = drops.length ? [Math.max(...drops.map(p => p.delai[0])), Math.max(...drops.map(p => p.delai[1]))] : c.livraison === 'poste-prio' ? [1, 1] : [2, 3];
      const mode = donnees.livraisons[c.livraison];
      const retrait = c.livraison === 'retrait';
      const pointRetrait = !retrait && mode && /pickpost|relais|point/i.test(c.livraison + ' ' + mode.nom);
      const etapes = [['Commande reçue', true], ['Préparation', !['attente'].includes(c.statut)], [retrait ? 'Prête à retirer' : 'Expédiée', ['expediee', 'livree', 'prete', 'retiree'].includes(c.statut)], [retrait ? 'Retirée' : 'Livrée', ['livree', 'retiree'].includes(c.statut)]];
      vue.message = `<div class="confirm"><p class="confirm-merci">${c.prenom ? `Merci ${esc(c.prenom)} !` : 'Merci !'}</p><h3>Commande n° ${c.numero}</h3><p>${c.statut === 'attente' && i >= 19 ? 'La confirmation du paiement prend plus de temps que prévu. Si votre paiement est passé, vous recevrez la confirmation par e-mail ; sinon, rien n’a été débité et vous pouvez réessayer.' : libelles[c.statut] || ''}</p>
        ${['annulee', 'remboursee'].includes(c.statut) ? '' : `<ol class="suivi-etapes">${etapes.map(([n, fait]) => `<li class="${fait ? 'fait' : ''}">${n}</li>`).join('')}</ol>`}
        ${['annulee', 'remboursee', 'livree', 'retiree'].includes(c.statut) ? '' : `<div class="confirm-livraison"><b>${retrait ? 'Retrait en magasin' : esc(pointRetrait ? fenetreLivraison(delai, c.date).replace(/^Livré/, 'Disponible au point de retrait') : fenetreLivraison(delai, c.date))}</b><span>${retrait ? esc(donnees.magasin.adresse || '') + ' · nous vous écrivons dès que c’est prêt' : pointRetrait ? `${esc(mode.nom)} · un avis de retrait vous sera envoyé` : `${mode ? esc(mode.nom) : 'Livraison'}${c.ville ? ' à ' + esc(c.ville) : ''}`}</span></div>`}
        <ul class="lignes-panier">${c.lignes.map(l => `<li><span>${esc(l.nom)}</span><b>${l.qte}</b><span class="num">${euros(l.prix * l.qte)}</span></li>`).join('')}</ul>
        <div class="totaux">${c.port ? `<div><span>Livraison</span><span>${euros(c.port)}</span></div>` : ''}<div class="total"><span>${c.statut === 'attente' ? 'Total' : 'Total payé'}</span><span>${euros(c.total)}</span></div></div>
        ${c.suivi ? `<p>Numéro de suivi : <b class="mono">${esc(c.suivi)}</b></p>` : ''}<p class="mini">${c.statut === 'attente' ? 'Vous recevrez un e-mail de confirmation dès que le paiement sera reçu, avec le lien pour suivre votre commande.' : 'Un e-mail de confirmation vous est envoyé, avec le lien pour suivre votre commande.'}</p>
        <button class="sf-btn plein" data-c="fermer">Continuer mes achats</button></div>
        ${c.offreApres ? `<div class="offre-apres">${visuelProduit({ nom: c.offreApres.nom, teinte: c.offreApres.teinte, image: c.offreApres.image })}<div><small>Uniquement maintenant</small><strong>${esc(c.offreApres.nom)}</strong><span><s>${euros(c.offreApres.prix)}</s> <b>${euros(c.offreApres.prixOffre)}</b> (−${c.offreApres.remise} %), livré dans le même colis, sans frais de port.</span>
          <button class="sf-btn" data-c="complement" data-commande="${esc(id)}" data-jeton="${esc(jeton)}" data-regle="${esc(c.offreApres.regle)}">Ajouter à ma commande</button><button class="bouton-lien" data-c="refuser-offre">Non merci</button></div></div>` : ''}`;
      if (c.offreApres) mesurer('offre_vue', { valeur: c.offreApres.regle });
      // Une seule fois par commande, et seulement dans l'onglet où le paiement a été commencé (sinon un lien d'e-mail recompterait).
      if (!['attente', 'annulee', 'remboursee'].includes(c.statut)) { try { if (sessionStorage.getItem('comptoir-paiement-' + id) && !sessionStorage.getItem('comptoir-payee-' + id)) { sessionStorage.setItem('comptoir-payee-' + id, '1'); mesurer('payee'); } } catch { /* stockage indisponible */ } }
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
      garderPanier(); if (vue.fiche) fermerFiche({ rendu: false }); vue.message = null; vue.ouvert = true; rendre();
    } else if (sf.dataset.sf === 'panier') { vue.ouvert = true; rendre(); }
    else if (sf.dataset.sf === 'tout-voir') { vueVitrine.tout = vueVitrine.tout === sf.dataset.id ? null : sf.dataset.id; vueVitrine.cat = ''; rendre(); document.querySelector(`[data-sf="tout-voir"][data-id="${CSS.escape(sf.dataset.id)}"]`)?.closest('.sf-produits')?.scrollIntoView({ block: 'start' }); }
    else if (sf.dataset.sf === 'cat') { vueVitrine.cat = sf.dataset.v; rendre(); }
    else if (sf.dataset.sf === 'fiche') { vue.fiche = sf.dataset.id; history.pushState({ fiche: sf.dataset.id }, '', urlFiche(sf.dataset.id)); const pf = donnees.produits.find(x => x.id === sf.dataset.id); if (pf) document.title = `${pf.nom} · ${donnees.boutique.nom}`; rendre(); document.querySelector('.sf-fiche-fermer')?.focus(); }
    else if (sf.dataset.sf === 'fermer-fiche') fermerFiche();
    else if (sf.dataset.sf === 'nav') allerSection(document, sf.dataset.v);
    else if (sf.dataset.sf === 'defiler') document.getElementById('sf-collection')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const doc = e.target.closest('[data-action="doc"]');
  if (doc) { vue.legal = doc.dataset.id === 'cgv' ? 'cgv' : 'mentions'; rendre(); return; }
  const el = e.target.closest('[data-c]');
  if (!el) return;
  const c = el.dataset.c;
  if (c === 'fermer') { vue.ouvert = false; if (vue.message && !vue.panier.length) vue.message = null; if (!vue.fiche) history.replaceState(null, '', racineBoutique); rendre(); }
  else if (c === 'retirer-offre') { vue.panier = vue.panier.filter(x => !x.offre); garderPanier(); rendre(); }
  else if (c === 'retour-panier') { vue.message = null; rendre(); }
  else if (c === 'qte') {
    const l = vue.panier.find(x => x.produitId === el.dataset.id && !x.offre);
    const pr = donnees.produits.find(x => x.id === l.produitId);
    const max = pr ? (pr.type === 'drop' ? 20 : pr.stock) : 20;
    l.qte = Math.min(max, l.qte + Number(el.dataset.d));   // le serveur refuserait au paiement : on borne tout de suite
    if (l.qte <= 0) vue.panier = vue.panier.filter(x => x !== l);
    garderPanier(); rendre();
  } else if (c === 'cookies') { try { localStorage.setItem('comptoir-cookies', el.dataset.v); } catch { /* ignoré */ } if (el.dataset.v === 'accord') mesurer('vue'); rendre(); }
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
// Échap ferme la fenêtre du dessus seulement : conditions de vente, puis panier, puis fiche produit.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (vue.legal) { vue.legal = null; e.stopImmediatePropagation(); rendre(); }
  else if (vue.ouvert) { vue.ouvert = false; e.stopImmediatePropagation(); rendre(); }
});

async function appliquerCode(code) {
  code = String(code || '').trim();
  if (!code) { vue.code = null; vue.codeMessage = ''; rendre(); return; }
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur);
    vue.code = json;
    const calc = calculPanier();
    vue.codeMessage = calc.motif && calc.motif.type === 'code' ? `Code ${json.code} appliqué : −${json.remise} %.${json.condition ? ' ' + json.condition : ''}` : `Code ${json.code} valable, mais la remise par quantité est plus avantageuse : elle s’applique (non cumulable).`;
  } catch (e) { vue.code = null; vue.codeMessage = e.message || 'Code non reconnu.'; }
  rendre();
}

async function inscrireNewsletter(form) {
  const email = form.querySelector('input[type=email]').value;
  try {
    const rep = await fetch(`/api/public/${encodeURIComponent(slug)}/newsletter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const json = await rep.json();
    if (!rep.ok) throw new Error(json.erreur);
    if (json.confirmation) { form.innerHTML = '<p>Vous vous étiez désinscrit : pour recevoir à nouveau nos nouvelles, confirmez en cliquant sur le lien que nous venons de vous envoyer.</p>'; return; }
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
        <div class="etoiles-saisie">${[5, 4, 3, 2, 1].map(n => `<input type="radio" id="n-${esc(p.produitId)}-${n}" name="note-${esc(p.produitId)}" value="${n}" required><label for="n-${esc(p.produitId)}-${n}" title="${n} étoile${n > 1 ? 's' : ''}">★<span class="sf-lecteur">${n} étoile${n > 1 ? 's' : ''}</span></label>`).join('')}</div>
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
    rendre();
  } catch (e) {
    // Le formulaire reste tel quel (notes et commentaires) : l'erreur s'affiche dedans.
    let err = form.querySelector('.erreur-avis');
    if (!err) { err = document.createElement('p'); err.className = 'erreur-avis'; err.setAttribute('role', 'alert'); form.querySelector('button').before(err); }
    err.textContent = e.message || 'Envoi impossible. Réessayez dans un instant.';
  }
}

demarrer();

document.addEventListener('keydown', e => { if (e.key === 'Escape' && vue.fiche && !vue.legal) fermerFiche(); });
/* Fermer la fiche : si on l'a ouverte depuis la boutique, « Retour » du navigateur, sinon l'adresse de la boutique remplace celle du produit. */
/* Même titre que la page rendue par le serveur (« Nom · Slogan ») : les moteurs et les onglets voient la même chose. */
function titreAccueil() { const b = donnees.boutique; return b.slogan ? `${b.nom} · ${b.slogan}` : b.nom; }
function fermerFiche({ rendu = true } = {}) {
  vue.fiche = null; document.title = titreAccueil();
  if (history.state && history.state.fiche && /\/p\//.test(location.pathname)) { history.back(); return; }   // popstate redessine
  history.replaceState(null, '', racineBoutique);
  if (rendu) rendre();
}

// Retour arrière du navigateur : ouvre ou ferme la fiche produit selon l'adresse.
addEventListener('popstate', () => {
  const m = /\/p\/([^/]+)\/?$/.exec(location.pathname);
  vue.fiche = m ? decodeURIComponent(m[1]) : null;
  document.title = vue.fiche && donnees ? `${(donnees.produits.find(x => x.id === vue.fiche) || {}).nom || ''} · ${donnees.boutique.nom}` : (donnees ? titreAccueil() : document.title);
  rendre();
});

/* Fenêtres (panier, fiche produit, CGV) : Tab reste à l'intérieur tant qu'elles sont ouvertes. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const boite = document.querySelector('#modal .modal-corps') || document.querySelector('.tiroir.ouvert .tiroir-corps') || document.querySelector('.sf-fiche') || document.querySelector('#modal .modal-corps');
  if (!boite) return;
  const f = [...boite.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
});
