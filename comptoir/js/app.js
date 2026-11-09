/* Comptoir — application : routage, interface d’administration, éditeur, commandes. */

const CLE = 'comptoir-etat-v1';
let etat = charger();
const ui = {
  route: 'tableau',
  commande: null,
  filtre: 'tous',
  recherche: '',
  section: null,
  ongletEditeur: 'sections',
  appareil: 'ordinateur',
  panier: [],
  panierOuvert: false,
  confirmation: null,
  produitEdite: null,
  dom: { mois: new Date().getMonth(), motsCles: '', marque: null },
  assistant: { etape: 1, nom: '', secteur: 'mode', pays: 'fr', theme: 'craie', exemples: true, domaine: null },
  confirmerReset: false,
  campagne: null,
  caisse: [],
  modal: null,
  livraison: 'colissimo'
};

/* ---------- Persistance ---------- */
function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (brut) { const e = JSON.parse(brut); if (e && e.version === 1) return completerEtat(e); }
  } catch (e) { /* stockage indisponible : on repart de la démo */ }
  return boutiqueDemo();
}
function sauver() {
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) { /* ignoré */ }
}

/* ---------- Utilitaires ---------- */
const $ = s => document.querySelector(s);
const JOUR = 86400000;
function dateCourte(t) { return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
function dateHeure(t) { return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function pct(n) { return (n > 0 ? '+' : '') + Math.round(n * 100) + ' %'; }
function pill(statut) { const s = STATUTS[statut]; return `<span class="pill ${s.ton}">${s.nom}</span>`; }
function compteVentes(c) { return !['annulee', 'remboursee', 'attente'].includes(c.statut); }
function toast(msg, lien) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (lien ? ` <a href="#${lien[0]}">${esc(lien[1])}</a>` : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4200);
}
function nouvelId(prefixe) { return prefixe + Math.random().toString(36).slice(2, 8); }

/* ---------- Graphique en barres (SVG, à l’échelle) ---------- */
function graphBarres(donnees, { hauteur = 180, format = v => v, surligne = -1, labelsTous = false } = {}) {
  const L = 640, H = hauteur, mg = { g: 44, d: 8, h: 10, b: 24 };
  const max = Math.max(1, ...donnees.map(d => d.v));
  const pas = Math.pow(10, Math.floor(Math.log10(max)));
  const haut = Math.ceil(max / pas) * pas;
  const y = v => mg.h + (H - mg.h - mg.b) * (1 - v / haut);
  const bande = (L - mg.g - mg.d) / donnees.length;
  const larg = Math.max(2, bande - 2);
  const ticks = [0, haut / 2, haut];
  let svg = `<svg viewBox="0 0 ${L} ${H}" class="graph" role="img">`;
  for (const t of ticks) {
    svg += `<line x1="${mg.g}" x2="${L - mg.d}" y1="${y(t)}" y2="${y(t)}" class="grille"/>`;
    svg += `<text x="${mg.g - 6}" y="${y(t) + 4}" text-anchor="end" class="axe">${esc(format(t))}</text>`;
  }
  donnees.forEach((d, i) => {
    const x = mg.g + i * bande + 1;
    const top = y(d.v), bas = y(0), h = bas - top, r = Math.min(4, larg / 2, h);
    const chemin = h <= 0 ? '' : `M${x},${bas} V${top + r} Q${x},${top} ${x + r},${top} H${x + larg - r} Q${x + larg},${top} ${x + larg},${top + r} V${bas} Z`;
    svg += `<path d="${chemin}" class="barre${i === surligne ? ' fort' : ''}"/>`;
    svg += `<rect x="${x - 1}" y="${mg.h}" width="${bande}" height="${H - mg.h - mg.b}" class="cible" data-tip="${esc(d.tip || d.label + ' : ' + format(d.v))}"/>`;
    if (labelsTous || i % Math.ceil(donnees.length / 6) === 0 || i === donnees.length - 1)
      svg += `<text x="${x + larg / 2}" y="${H - 6}" text-anchor="middle" class="axe${i === surligne ? ' fort' : ''}">${esc(d.label)}</text>`;
  });
  return svg + '</svg>';
}

/* ---------- Coque de l’application ---------- */
const NAV = [
  ['tableau', 'Tableau de bord'],
  ['copilote', 'Copilote de saison'],
  ['commandes', 'Commandes'],
  ['produits', 'Produits'],
  ['clients', 'Clients'],
  ['magasin', 'Magasin'],
  ['editeur', 'Éditeur du site'],
  ['domaines', 'Domaines'],
  ['conformite', 'Conformité'],
  ['boutique', 'Voir la boutique']
];

function rendre() {
  const route = ui.route;
  document.body.dataset.route = route;
  const aTraiter = etat.commandes.filter(c => c.statut === 'payee' || c.statut === 'preparation').length;
  const aValider = prochainsTempsForts(2).filter(e => !etat.campagnes[e.cle]).length;
  $('#nav').innerHTML = NAV.map(([id, nom]) => `<a href="#${id}" class="${route === id ? 'actif' : ''}">${nom}${id === 'commandes' && aTraiter ? `<b class="badge">${aTraiter}</b>` : ''}${id === 'copilote' && aValider ? `<b class="badge">${aValider}</b>` : ''}</a>`).join('');
  $('#nom-boutique').textContent = etat.boutique.nom;
  $('#domaine-actuel').textContent = etat.boutique.domaine ? etat.boutique.domaine.domaine : slugifier(etat.boutique.nom) + '.comptoir.shop';
  const vues = { tableau: vueTableau, commandes: vueCommandes, produits: vueProduits, clients: vueClients, editeur: vueEditeur, domaines: vueDomaines, boutique: vueBoutique, creer: vueAssistant, copilote: vueCopilote, magasin: vueMagasin, conformite: vueConformite, offre: vueOffre };
  $('#vue').innerHTML = (vues[route] || vueTableau)();
  apresRendu();
}

function apresRendu() {
  if (ui.route === 'editeur') rendreApercu();
  if (ui.route === 'magasin') dessinerQR();
  rendreModal();
}

/* ---------- Tableau de bord ---------- */
function statsPeriode(debut, fin) {
  const cs = etat.commandes.filter(c => c.date >= debut && c.date < fin && compteVentes(c));
  const ca = cs.reduce((a, c) => a + c.total, 0);
  return { ca, n: cs.length, panier: cs.length ? ca / cs.length : 0 };
}

function vueTableau() {
  const now = Date.now();
  const cur = statsPeriode(now - 30 * JOUR, now + 1);
  const prev = statsPeriode(now - 60 * JOUR, now - 30 * JOUR);
  const conv = cur.n / etat.visites30j;
  const aExpedier = etat.commandes.filter(c => c.statut === 'payee' || c.statut === 'preparation');
  const attente = etat.commandes.filter(c => c.statut === 'attente').length;
  const jours = [];
  for (let i = 29; i >= 0; i--) {
    const d0 = new Date(now - i * JOUR); d0.setHours(0, 0, 0, 0);
    const s = statsPeriode(d0.getTime(), d0.getTime() + JOUR);
    jours.push({ label: dateCourte(d0), v: Math.round(s.ca), tip: `${dateCourte(d0)} : ${euros(s.ca)} · ${s.n} commande${s.n > 1 ? 's' : ''}` });
  }
  const mois = new Date().getMonth();
  const saison = SAISONS[mois];
  const secteur = SECTEURS[etat.boutique.secteur];
  const indice = secteur.courbe[mois];
  const stockBas = etat.produits.filter(p => p.actif && p.stock <= 5);
  const prochain = prochainsTempsForts(1)[0];
  const campProchain = genererCampagne(etat, prochain);
  const retraits = etat.commandes.filter(c => c.livraison === 'retrait' && c.canal === 'web' && ['payee', 'preparation', 'prete'].includes(c.statut)).length;
  const recentes = [...etat.commandes].sort((a, b) => b.date - a.date).slice(0, 6);
  const evol = (a, b) => b ? `<span class="evol ${a >= b ? 'up' : 'down'}">${pct(a / b - 1)} vs 30 j préc.</span>` : '';

  return `
  <div class="tete"><div><h1>Bonjour</h1><p class="sous">Voici l’activité de ${esc(etat.boutique.nom)} sur les 30 derniers jours.</p></div>
    <a class="btn" href="#boutique">Voir la boutique</a></div>
  <div class="kpis">
    <div class="kpi"><span>Chiffre d’affaires</span><strong>${euros(cur.ca)}</strong>${evol(cur.ca, prev.ca)}</div>
    <div class="kpi"><span>Commandes</span><strong>${cur.n}</strong>${evol(cur.n, prev.n)}</div>
    <div class="kpi"><span>Panier moyen</span><strong>${euros(cur.panier)}</strong>${evol(cur.panier, prev.panier)}</div>
    <div class="kpi"><span>Taux de conversion</span><strong>${(conv * 100).toFixed(1).replace('.', ',')} %</strong><span class="evol neutre">${etat.visites30j.toLocaleString('fr-FR')} visites (simulées)</span></div>
  </div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Chiffre d’affaires par jour</h2><span class="sous">30 derniers jours, commandes payées</span></div>
      <div class="graph-wrap">${graphBarres(jours, { format: v => v >= 1000 ? (v / 1000).toLocaleString('fr-FR') + ' k€' : v + ' €', surligne: 29 })}</div>
    </section>
    <section class="carte saison-carte">
      <span class="eyebrow">Copilote · prochain temps fort</span>
      <h2>${esc(prochain.nom)}, ${prochain.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</h2>
      <p>Dans ${Math.ceil((prochain.date - new Date()) / JOUR)} jours. ${etat.campagnes[prochain.cle] ? 'Votre campagne est programmée.' : `Campagne prête : ${euros(campProchain.caPrevu)} de ventes prévues${campProchain.ruptures.length ? `, ${campProchain.ruptures.length} produit${campProchain.ruptures.length > 1 ? 's' : ''} à réassortir` : ''}.`}</p>
      <div class="jauge"><div style="width:${Math.min(100, indice / 1.8)}%"></div></div>
      <p class="sous">Demande « ${esc(secteur.nom)} » : indice ${indice} (100 = mois moyen)</p>
      <div class="rangee"><a class="btn" href="#copilote">${etat.campagnes[prochain.cle] ? 'Voir la campagne' : 'Relire et valider'}</a><a class="btn fantome" href="#domaines">Domaine de campagne</a></div>
    </section>
  </div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Dernières commandes</h2><a href="#commandes" class="lien">Toutes les commandes</a></div>
      <div class="table-wrap"><table class="table"><tbody>${recentes.map(c => `
        <tr data-action="ouvrir-commande" data-id="${c.id}" tabindex="0"><td class="mono">#${c.numero}</td><td>${esc(c.client.nom)}</td><td class="num">${euros(c.total)}</td><td>${pill(c.statut)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>À faire</h2></div>
      <ul class="todo">
        <li class="${aExpedier.length ? 'alerte' : ''}"><a href="#commandes" data-action="filtre-lien" data-filtre="payee"><strong>${aExpedier.length}</strong> commande${aExpedier.length > 1 ? 's' : ''} à préparer et expédier</a></li>
        <li class="${attente ? 'alerte' : ''}"><a href="#commandes" data-action="filtre-lien" data-filtre="attente"><strong>${attente}</strong> paiement${attente > 1 ? 's' : ''} en attente</a></li>
        ${stockBas.map(p => `<li class="alerte"><a href="#produits"><strong>${p.stock}</strong> en stock : ${esc(p.nom)}</a></li>`).join('')}
        ${retraits ? `<li class="alerte"><a href="#magasin"><strong>${retraits}</strong> retrait${retraits > 1 ? 's' : ''} click & collect en cours</a></li>` : ''}
        ${etat.boutique.domaine ? '' : '<li class="alerte"><a href="#domaines">Aucun domaine personnalisé : choisissez-en un</a></li>'}
        ${etat.entreprise.mediateur ? '' : '<li class="alerte"><a href="#conformite">Indiquez votre médiateur de la consommation (obligatoire)</a></li>'}
        <li>${etat.rdv ? `<a href="#tableau">Session de lancement le <strong>${dateHeure(etat.rdv)}</strong></a>` : '<button class="todo-btn" data-action="rdv">Réservez votre session de lancement offerte (30 min en visio)</button>'}</li>
      </ul>
    </section>
  </div>`;
}

/* ---------- Commandes ---------- */
function fluxPour(c) {
  if (c.livraison === 'retrait') {
    if (c.statut === 'preparation') return [['prete', 'Prête : prévenir le client']];
    if (c.statut === 'prete') return [['retiree', 'Remise au client']];
    if (c.statut === 'retiree') return [['remboursee', 'Rembourser']];
  }
  return FLUX[c.statut] || [];
}
const FLUX = {
  attente: [['payee', 'Marquer comme payée'], ['annulee', 'Annuler la commande']],
  payee: [['preparation', 'Commencer la préparation'], ['annulee', 'Annuler la commande']],
  preparation: [['expediee', 'Expédier (générer le suivi)']],
  expediee: [['livree', 'Marquer comme livrée']],
  livree: [['remboursee', 'Rembourser']],
  remboursee: [], annulee: []
};

function vueCommandes() {
  const filtres = [['tous', 'Toutes'], ['payee', 'À préparer'], ['preparation', 'En préparation'], ['expediee', 'Expédiées'], ['livree', 'Livrées'], ['attente', 'En attente'], ['remboursee', 'Remboursées']];
  const q = ui.recherche.trim().toLowerCase();
  const liste = [...etat.commandes].sort((a, b) => b.date - a.date)
    .filter(c => ui.filtre === 'tous' || c.statut === ui.filtre)
    .filter(c => !q || String(c.numero).includes(q) || c.client.nom.toLowerCase().includes(q) || c.client.email.includes(q));
  const ouverte = etat.commandes.find(c => c.id === ui.commande);
  return `
  <div class="tete"><div><h1>Commandes</h1><p class="sous">${etat.commandes.length} commandes au total</p></div></div>
  <div class="filtres">
    <div class="onglets" role="tablist">${filtres.map(([id, nom]) => {
      const n = id === 'tous' ? etat.commandes.length : etat.commandes.filter(c => c.statut === id).length;
      return `<button role="tab" aria-selected="${ui.filtre === id}" class="${ui.filtre === id ? 'actif' : ''}" data-action="filtre" data-filtre="${id}">${nom} <span>${n}</span></button>`;
    }).join('')}</div>
    <input id="recherche-commandes" type="search" placeholder="N°, nom ou e-mail" value="${esc(ui.recherche)}" data-champ="recherche">
  </div>
  <div class="maitre-detail ${ouverte ? 'ouvert' : ''}">
    <section class="carte sans-pad">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>N°</th><th>Date</th><th>Client</th><th class="num">Articles</th><th class="num">Total</th><th>Statut</th></tr></thead>
        <tbody>${liste.map(c => `
          <tr data-action="ouvrir-commande" data-id="${c.id}" tabindex="0" class="${c.id === ui.commande ? 'choisi' : ''}">
            <td class="mono">#${c.numero}</td><td>${dateCourte(c.date)}</td>
            <td><div>${esc(c.client.nom)}</div><div class="sous">${esc(c.client.ville)}</div></td>
            <td class="num">${c.lignes.reduce((a, l) => a + l.qte, 0)}</td><td class="num">${euros(c.total)}</td><td>${pill(c.statut)}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="vide">Aucune commande ne correspond.</td></tr>'}
        </tbody></table></div>
    </section>
    ${ouverte ? detailCommande(ouverte) : ''}
  </div>`;
}

function detailCommande(c) {
  return `<aside class="carte detail" aria-label="Commande ${c.numero}">
    <div class="carte-tete"><h2 class="mono">#${c.numero}</h2><button class="icone" data-action="fermer-commande" aria-label="Fermer">Fermer</button></div>
    <div class="rangee">${pill(c.statut)}<span class="sous">${dateHeure(c.date)}</span></div>
    <div class="bloc"><h3>${c.canal === 'magasin' ? 'Vente en boutique' : 'Livraison'}</h3><p>${c.canal === 'magasin' ? 'Encaissée au comptoir' : esc(LIVRAISONS[c.livraison].nom)}</p></div>
    <div class="bloc"><h3>Client</h3><p>${esc(c.client.nom)}<br><span class="sous">${esc(c.client.email)} · ${esc(c.client.ville)}</span></p></div>
    <div class="bloc"><h3>Articles</h3>
      <table class="table compacte"><tbody>${c.lignes.map(l => `<tr><td>${l.qte} ×</td><td>${esc(l.nom)}</td><td class="num">${euros(l.prix * l.qte)}</td></tr>`).join('')}
      <tr><td></td><td class="sous">Livraison</td><td class="num">${c.port ? euros(c.port) : 'Offerte'}</td></tr>
      <tr class="total"><td></td><td>Total</td><td class="num">${euros(c.total)}</td></tr></tbody></table>
    </div>
    ${c.suivi ? `<div class="bloc"><h3>Suivi ${esc(LIVRAISONS[c.livraison].transporteur || '')}</h3><p class="mono">${esc(c.suivi)}</p></div>` : ''}
    <div class="rangee">${c.facture ? `<button class="btn petit fantome" data-action="facture" data-id="${c.id}">Facture ${c.facture}</button>` : ''}${c.suivi && LIVRAISONS[c.livraison].transporteur ? `<button class="btn petit fantome" data-action="etiquette" data-id="${c.id}">Étiquette d’envoi</button>` : ''}</div>
    <div class="bloc actions">${fluxPour(c).map(([s, nom], i) => `<button class="btn ${i ? 'fantome' : ''} ${s === 'annulee' || s === 'remboursee' ? 'danger' : ''}" data-action="statut" data-id="${c.id}" data-statut="${s}">${nom}</button>`).join('') || '<p class="sous">Aucune action possible : commande clôturée.</p>'}</div>
    <div class="bloc"><h3>Historique</h3><ol class="frise">${[...c.historique].reverse().map(h => `<li><span>${esc(h.texte)}</span><time>${dateHeure(h.date)}</time></li>`).join('')}</ol></div>
    <div class="bloc"><label for="note-${c.id}"><h3>Note interne</h3></label><textarea id="note-${c.id}" rows="2" data-champ="note" data-id="${c.id}" placeholder="Visible uniquement par vous">${esc(c.note)}</textarea></div>
  </aside>`;
}

function changerStatut(id, statut) {
  const c = etat.commandes.find(x => x.id === id);
  if (!c) return;
  c.statut = statut;
  if (statut === 'expediee' && !c.suivi) c.suivi = ({ relais: 'MR', chronopost: 'XY' }[c.livraison] || '6A') + Math.floor(1e10 + Math.random() * 9e10);
  if (statut === 'payee' && !c.facture) c.facture = numeroFactureSuivant(etat, Date.now());
  if (statut === 'remboursee' || statut === 'annulee') {
    for (const l of c.lignes) { const p = etat.produits.find(x => x.id === l.produitId); if (p) p.stock += l.qte; }
  }
  const textes = { payee: 'Paiement reçu', preparation: 'Préparation commencée', expediee: `Expédiée, suivi ${c.suivi}`, livree: 'Livrée', remboursee: `Remboursée (${euros(c.total)}), avoir émis, stock remis`, annulee: 'Annulée, stock remis', prete: 'Prête à retirer, SMS envoyé au client (simulé)', retiree: 'Remise au client en boutique' };
  c.historique.push({ date: Date.now(), texte: textes[statut] });
  sauver();
  toast(`Commande #${c.numero} : ${STATUTS[statut].nom.toLowerCase()}. Le client a reçu un e-mail (simulé).`);
  rendre();
}

/* ---------- Produits ---------- */
function vueProduits() {
  const p = ui.produitEdite;
  const cats = SECTEURS[etat.boutique.secteur].categories;
  return `
  <div class="tete"><div><h1>Produits</h1><p class="sous">${etat.produits.length} produits · ${etat.produits.filter(x => x.actif).length} en ligne</p></div>
    <div class="rangee"><button class="btn fantome" data-action="photos">Ajouter par photo</button><button class="btn" data-action="nouveau-produit">Ajouter un produit</button></div>
    <input type="file" id="photo-input" accept="image/*" multiple hidden></div>
  <p class="astuce">Prenez vos produits en photo : Comptoir crée les fiches (nom, catégorie, prix conseillé, description). Vous n’avez plus qu’à vérifier.</p>
  <div class="maitre-detail ${p ? 'ouvert' : ''}">
    <section class="carte sans-pad"><div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>Produit</th><th>Catégorie</th><th class="num">Prix</th><th class="num">Stock</th><th>Statut</th></tr></thead>
      <tbody>${etat.produits.map(x => `
        <tr data-action="editer-produit" data-id="${x.id}" tabindex="0" class="${p && p.id === x.id ? 'choisi' : ''}">
          <td class="vignette">${visuelProduit(x)}</td><td>${esc(x.nom)}</td><td>${esc(x.categorie)}</td>
          <td class="num">${euros(x.prix)}</td>
          <td class="num">${x.stock <= 5 ? `<span class="pill ${x.stock <= 0 ? 'bad' : 'warn'}">${x.stock}</span>` : x.stock}</td>
          <td>${x.aVerifier ? '<span class="pill warn">À vérifier</span>' : x.actif ? '<span class="pill good">En ligne</span>' : '<span class="pill muted">Masqué</span>'}</td></tr>`).join('')}
      </tbody></table></div></section>
    ${p ? `<aside class="carte detail"><form data-form="produit">
      <div class="carte-tete"><h2>${etat.produits.find(x => x.id === p.id) ? 'Modifier le produit' : 'Nouveau produit'}</h2><button type="button" class="icone" data-action="fermer-produit">Fermer</button></div>
      ${visuelProduit(p, true)}
      <label class="champ"><span>Nom</span><input id="pf-nom" name="nom" required value="${esc(p.nom)}"></label>
      <label class="champ"><span>Description <button type="button" class="lien bouton-lien" data-action="rediger">Rédiger pour moi</button></span><textarea id="pf-desc" name="description" rows="4">${esc(p.description)}</textarea></label>
      <div class="deux"><label class="champ"><span>Prix (€)</span><input id="pf-prix" name="prix" type="number" min="0" step="0.01" required value="${p.prix}"></label>
      <label class="champ"><span>Stock</span><input id="pf-stock" name="stock" type="number" min="0" step="1" required value="${p.stock}"></label></div>
      <label class="champ"><span>Catégorie</span><select id="pf-cat" name="categorie">${cats.map(c => `<option ${c === p.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="case"><input id="pf-actif" type="checkbox" name="actif" ${p.actif ? 'checked' : ''}> Visible dans la boutique</label>
      <div class="rangee"><button class="btn">Enregistrer</button>${etat.produits.find(x => x.id === p.id) ? `<button type="button" class="btn fantome danger" data-action="supprimer-produit" data-id="${p.id}">Supprimer</button>` : ''}</div>
    </form></aside>` : ''}
  </div>`;
}

/* ---------- Clients ---------- */
function vueClients() {
  const parEmail = {};
  for (const c of etat.commandes) {
    const k = c.client.email;
    parEmail[k] = parEmail[k] || { ...c.client, n: 0, total: 0, derniere: 0 };
    parEmail[k].n++;
    if (compteVentes(c)) parEmail[k].total += c.total;
    parEmail[k].derniere = Math.max(parEmail[k].derniere, c.date);
  }
  const liste = Object.values(parEmail).sort((a, b) => b.total - a.total);
  const fideles = liste.filter(c => c.n > 1).length;
  return `
  <div class="tete"><div><h1>Clients</h1><p class="sous">${liste.length} clients · ${fideles} ont commandé plusieurs fois</p></div></div>
  <section class="carte sans-pad"><div class="table-wrap"><table class="table">
    <thead><tr><th>Client</th><th>Ville</th><th class="num">Commandes</th><th class="num">Total dépensé</th><th>Dernière commande</th></tr></thead>
    <tbody>${liste.map(c => `<tr><td><div>${esc(c.nom)}</div><div class="sous">${esc(c.email)}</div></td><td>${esc(c.ville)}</td>
      <td class="num">${c.n}</td><td class="num">${euros(c.total)}</td><td>${dateCourte(c.derniere)}</td></tr>`).join('')}</tbody>
  </table></div></section>`;
}

/* ---------- Éditeur ---------- */
function vueEditeur() {
  const b = etat.boutique;
  const onglets = [['sections', 'Sections'], ['style', 'Style'], ['infos', 'Infos']];
  let panneau = '';
  if (ui.ongletEditeur === 'sections') {
    panneau = `<ol class="liste-sections">${b.sections.map((s, i) => `
      <li class="${ui.section === s.id ? 'ouvert' : ''}">
        <div class="ls-tete">
          <button class="ls-nom" data-action="choisir-section" data-id="${s.id}" aria-expanded="${ui.section === s.id}">${esc(TYPES_SECTIONS[s.type].nom)}</button>
          <button class="icone" data-action="monter" data-id="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
          <button class="icone" data-action="descendre" data-id="${s.id}" ${i === b.sections.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
          <button class="icone" data-action="supprimer-section" data-id="${s.id}" aria-label="Supprimer">×</button>
        </div>
        ${ui.section === s.id ? champsSection(s) : ''}
      </li>`).join('')}</ol>
      <div class="ajout"><label for="type-ajout" class="sous">Ajouter une section</label>
        <div class="rangee"><select id="type-ajout">${Object.entries(TYPES_SECTIONS).map(([k, v]) => `<option value="${k}">${esc(v.nom)}</option>`).join('')}</select>
        <button class="btn" data-action="ajouter-section">Ajouter</button></div></div>`;
  } else if (ui.ongletEditeur === 'style') {
    const t = b.theme;
    panneau = `<div class="themes">${Object.entries(THEMES).map(([id, th]) => `
        <button class="theme-choix ${t.id === id ? 'actif' : ''}" data-action="theme" data-id="${id}" style="background:${th.bg};color:${th.text};border-radius:${Math.min(th.radius, 12)}px">
          <span style="font-family:${th.font}">${th.nom}</span><i style="background:${th.primary}"></i></button>`).join('')}</div>
      <div class="deux">
        <label class="champ"><span>Couleur principale</span><input id="st-primary" type="color" value="${t.primary}" data-theme="primary"></label>
        <label class="champ"><span>Fond</span><input id="st-bg" type="color" value="${t.bg}" data-theme="bg"></label>
        <label class="champ"><span>Texte</span><input id="st-text" type="color" value="${t.text}" data-theme="text"></label>
        <label class="champ"><span>Cartes</span><input id="st-surface" type="color" value="${t.surface}" data-theme="surface"></label>
      </div>
      <label class="champ"><span>Police des titres</span><select id="st-font" data-theme="font">${POLICES.map(([v, n]) => `<option value="${esc(v)}" ${t.font === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="champ"><span>Arrondi des angles : <b id="rayon-val">${t.radius}</b> px</span><input id="st-radius" type="range" min="0" max="24" value="${t.radius}" data-theme="radius"></label>`;
  } else {
    panneau = `<label class="champ"><span>Nom de la boutique</span><input id="in-nom" value="${esc(b.nom)}" data-boutique="nom"></label>
      <label class="champ"><span>Slogan</span><input id="in-slogan" value="${esc(b.slogan)}" data-boutique="slogan"></label>
      <label class="champ"><span>Secteur</span><select id="in-secteur" data-boutique="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${b.secteur === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
      <div class="bloc"><h3>Adresse</h3><p class="mono">${esc(b.domaine ? b.domaine.domaine : slugifier(b.nom) + '.comptoir.shop')}</p><a href="#domaines" class="lien">Changer de domaine</a></div>`;
  }
  return `
  <div class="tete"><div><h1>Éditeur du site</h1><p class="sous">Cliquez sur une section de l’aperçu pour la modifier.</p></div>
    <div class="rangee">
      <div class="segment" role="group" aria-label="Appareil">
        <button class="${ui.appareil === 'ordinateur' ? 'actif' : ''}" data-action="appareil" data-id="ordinateur">Ordinateur</button>
        <button class="${ui.appareil === 'mobile' ? 'actif' : ''}" data-action="appareil" data-id="mobile">Mobile</button>
      </div>
      <button class="btn" data-action="publier">${b.modifie ? 'Publier les modifications' : 'Publié'}</button>
    </div></div>
  <div class="editeur">
    <aside class="carte panneau">
      <div class="onglets plein">${onglets.map(([id, n]) => `<button class="${ui.ongletEditeur === id ? 'actif' : ''}" data-action="onglet-editeur" data-id="${id}">${n}</button>`).join('')}</div>
      <div class="panneau-corps">${panneau}</div>
    </aside>
    <div class="scene"><div class="appareil ${ui.appareil}"><div class="barre-url"><span></span><span></span><span></span><em class="mono">${esc(b.domaine ? b.domaine.domaine : slugifier(b.nom) + '.comptoir.shop')}</em></div><div id="apercu"></div></div></div>
  </div>`;
}

function champsSection(s) {
  const cats = SECTEURS[etat.boutique.secteur].categories;
  return `<div class="ls-champs">${TYPES_SECTIONS[s.type].champs.map(([cle, label, type]) => {
    const id = `f-${s.id}-${cle}`;
    const v = s.props[cle] ?? '';
    let input;
    if (type === 'textarea') input = `<textarea id="${id}" rows="2" data-prop="${cle}" data-id="${s.id}">${esc(v)}</textarea>`;
    else if (type.startsWith('select:')) input = `<select id="${id}" data-prop="${cle}" data-id="${s.id}">${type.slice(7).split(',').map(o => `<option ${o === String(v) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (type === 'categorie') input = `<select id="${id}" data-prop="${cle}" data-id="${s.id}"><option value="">Toutes</option>${cats.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else input = `<input id="${id}" value="${esc(v)}" data-prop="${cle}" data-id="${s.id}">`;
    return `<label class="champ" for="${id}"><span>${label}</span>${input}</label>`;
  }).join('')}</div>`;
}

function rendreApercu() {
  const a = $('#apercu');
  if (a) a.innerHTML = renduBoutique(etat, { mode: 'edition', selection: ui.section });
}
function modifie() { etat.boutique.modifie = true; sauver(); const b = document.querySelector('[data-action="publier"]'); if (b) b.textContent = 'Publier les modifications'; }

/* ---------- Domaines ---------- */
function vueDomaines() {
  const b = etat.boutique;
  const marque = ui.dom.marque ?? b.nom;
  const res = suggererDomaines({ marque, secteurId: b.secteur, motsCles: ui.dom.motsCles.split(','), pays: b.pays, mois: ui.dom.mois, etat });
  const secteur = SECTEURS[b.secteur];
  const courbe = secteur.courbe.map((v, i) => ({ label: MOIS[i], v, tip: `${MOIS_LONG[i]} : indice ${v} · ${SAISONS[i].nom}` }));
  const ligne = r => `
    <tr class="${r.disponible ? '' : 'indispo'}">
      <td><div class="mono dom">${esc(r.domaine)}</div><div class="sous">${esc(r.raisons.slice(0, 2).join(' · '))}</div></td>
      <td><span class="tag">${esc(r.genre)}</span></td>
      <td><div class="score"><div class="score-barre"><i style="width:${r.score}%"></i></div><b>${r.score}</b></div></td>
      <td>${r.disponible ? '<span class="pill good">Disponible</span>' : r.prime ? '<span class="pill warn">Premium</span>' : '<span class="pill muted">Déjà pris</span>'}</td>
      <td class="num">${r.disponible || r.prime ? euros(r.prix) + '<div class="sous">puis ' + euros(r.renouv) + '/an</div>' : '—'}</td>
      <td>${r.disponible ? `<button class="btn petit ${b.domaine && b.domaine.domaine === r.domaine ? 'fantome' : ''}" data-action="choisir-domaine" data-domaine="${esc(r.domaine)}" data-prix="${r.prix}" data-genre="${esc(r.genre)}">${b.domaine && b.domaine.domaine === r.domaine ? 'Choisi' : 'Choisir'}</button>` : ''}</td>
    </tr>`;
  const reco = (r, titre, texte) => r ? `<div class="reco"><span class="eyebrow">${titre}</span><div class="mono dom grand">${esc(r.domaine)}</div>
      <div class="detail-score">${Object.entries({ Demande: r.detail.demande, Saison: r.detail.saison, Brièveté: r.detail.court, Mémorisation: r.detail.memo, Extension: r.detail.extension }).map(([k, v]) => `<div><span>${k}</span><div class="score-barre"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}</div>
      <p class="sous">${texte}</p>
      <button class="btn" data-action="choisir-domaine" data-domaine="${esc(r.domaine)}" data-prix="${r.prix}" data-genre="${esc(r.genre)}">Réserver pour ${euros(r.prix)}</button></div>` : '';
  return `
  <div class="tete"><div><h1>Domaines</h1><p class="sous">Suggestions calculées à partir de la demande du marché, des ventes de vos clients et de la saison.</p></div></div>
  <section class="carte filtres-domaine">
    <label class="champ"><span>Nom de marque</span><input id="dom-marque" value="${esc(marque)}" data-champ="dom-marque"></label>
    <label class="champ"><span>Mots-clés en plus (séparés par des virgules)</span><input id="dom-kw" value="${esc(ui.dom.motsCles)}" placeholder="ex. artisanal, vegan" data-champ="dom-kw"></label>
    <label class="champ"><span>Simuler le mois</span><select id="dom-mois" data-champ="dom-mois">${MOIS_LONG.map((m, i) => `<option value="${i}" ${i === ui.dom.mois ? 'selected' : ''}>${m}${i === new Date().getMonth() ? ' (actuel)' : ''}</option>`).join('')}</select></label>
    <label class="champ"><span>Pays principal</span><select id="dom-pays" data-boutique-dom="pays">${[['fr', 'France'], ['be', 'Belgique'], ['ch', 'Suisse'], ['ca', 'Canada']].map(([k, v]) => `<option value="${k}" ${b.pays === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  </section>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Demande « ${esc(secteur.nom)} » sur l’année</h2><span class="sous">Indice saisonnier, 100 = mois moyen</span></div>
      <div class="graph-wrap">${graphBarres(courbe, { surligne: ui.dom.mois, labelsTous: true, hauteur: 170 })}</div>
      <p class="sous">${MOIS_LONG[ui.dom.mois][0].toUpperCase() + MOIS_LONG[ui.dom.mois].slice(1)} : ${esc(res.saison.nom)}. ${esc(res.saison.conseil)}</p>
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>Ce que vos clients achètent</h2><span class="sous">Part du CA, 90 jours</span></div>
      ${res.signal.length ? `<ul class="parts">${res.signal.map(s => `<li><span>${esc(s.cat)}</span><div class="score-barre"><i style="width:${Math.round(s.part * 100)}%"></i></div><b>${Math.round(s.part * 100)} %</b></li>`).join('')}</ul>
      <p class="sous">Les mots-clés liés à vos meilleures catégories reçoivent un bonus : ${res.topKws.map(k => `« ${esc(k.kw)} »`).join(', ')}.</p>`
      : '<p class="sous">Pas encore de ventes : les suggestions s’appuient sur la demande du marché. Le signal clients apparaîtra avec vos premières commandes.</p>'}
    </section>
  </div>
  <div class="recos">
    ${reco(res.principal, 'Domaine principal recommandé', 'À garder toute l’année : c’est l’adresse de votre boutique.')}
    ${reco(res.campagne, 'Domaine de campagne', `Redirigé vers votre boutique le temps de « ${esc(res.campagne ? res.campagne.saison.nom : '')} » : utile pour la publicité et les réseaux sociaux.`)}
  </div>
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>Toutes les suggestions</h2><span class="sous">${res.resultats.filter(r => r.disponible).length} disponibles sur ${res.resultats.length}</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Domaine</th><th>Type</th><th>Score</th><th>Disponibilité</th><th class="num">Prix 1re année</th><th></th></tr></thead>
    <tbody>${res.resultats.map(ligne).join('')}</tbody></table></div>
  </section>
  <p class="note">Démo : volumes de recherche, disponibilité et prix sont simulés. En production, ils viennent de l’API d’un registrar et de Google Trends.</p>`;
}

/* ---------- Boutique en ligne (vue client) ---------- */
function vueBoutique() {
  const total = ui.panier.reduce((a, l) => a + l.prix * l.qte, 0);
  const modes = Object.entries(LIVRAISONS).filter(([k]) => k !== 'retrait' || etat.magasin.clickCollect);
  if (!modes.find(([k]) => k === ui.livraison)) ui.livraison = 'colissimo';
  const port = total ? fraisPort(ui.livraison, total) : 0;
  return `
  <div class="bandeau-client"><span>Vous voyez <b class="mono">${esc(etat.boutique.domaine ? etat.boutique.domaine.domaine : slugifier(etat.boutique.nom) + '.comptoir.shop')}</b> comme un client. Passez une commande : elle apparaîtra dans l’admin.</span><a href="#tableau" class="btn petit">Retour à l’admin</a></div>
  <div class="boutique-live">${renduBoutique(etat, { mode: 'live', panier: ui.panier })}</div>
  ${etat.cookies ? '' : `<div class="cookies" role="region" aria-label="Cookies"><p>${esc(etat.boutique.nom)} utilise des cookies de mesure d’audience pour améliorer le site. Vous pouvez les accepter ou les refuser.</p><div class="rangee"><button class="btn petit fantome" data-action="cookies" data-choix="refus">Refuser</button><button class="btn petit fantome" data-action="cookies" data-choix="accord">Accepter</button></div></div>`}
  <div class="tiroir ${ui.panierOuvert ? 'ouvert' : ''}" aria-hidden="${!ui.panierOuvert}">
    <div class="tiroir-fond" data-action="fermer-panier"></div>
    <aside class="tiroir-corps" style="${varsTheme(etat.boutique.theme)}">
      <div class="carte-tete"><h2>Panier</h2><button class="icone" data-action="fermer-panier">Fermer</button></div>
      ${ui.confirmation ? `<div class="confirm"><h3>Merci pour votre commande</h3><p>Commande <b class="mono">#${ui.confirmation}</b> confirmée.</p><a class="sf-btn" href="#commandes" data-action="voir-commande" data-num="${ui.confirmation}">Voir la commande dans l’admin</a></div>` :
      ui.panier.length ? `
        <ul class="lignes-panier">${ui.panier.map(l => `<li><span>${esc(l.nom)}</span>
          <div class="qte"><button data-action="qte" data-id="${l.produitId}" data-d="-1" aria-label="Retirer un">−</button><b>${l.qte}</b><button data-action="qte" data-id="${l.produitId}" data-d="1" aria-label="Ajouter un">+</button></div>
          <span class="num">${euros(l.prix * l.qte)}</span></li>`).join('')}</ul>
        <div class="totaux"><div><span>Livraison</span><span>${port ? euros(port) : 'Offerte'}</span></div><div class="total"><span>Total</span><span>${euros(total + port)}</span></div></div>
        <fieldset class="modes-livraison"><legend>Livraison</legend>${modes.map(([k, l]) => `<label class="${ui.livraison === k ? 'actif' : ''}"><input type="radio" name="livraison" value="${k}" data-livraison ${ui.livraison === k ? 'checked' : ''}><span>${esc(l.nom)}<small>${k === 'retrait' ? esc(etat.magasin.adresse) + ' · prêt en ' + l.delai : l.delai}</small></span><b>${fraisPort(k, total) ? euros(fraisPort(k, total)) : 'Offert'}</b></label>`).join('')}</fieldset>
        <form data-form="paiement">
          <label class="champ"><span>Nom</span><input id="pay-nom" name="nom" required value="Alex Morel"></label>
          <label class="champ"><span>E-mail</span><input id="pay-email" name="email" type="email" required value="alex.morel@exemple.fr"></label>
          <label class="champ"><span>Ville</span><input id="pay-ville" name="ville" required value="Bordeaux"></label>
          <button class="sf-btn plein">Payer ${euros(total + port)} (simulation)</button>
          <p class="mini">Carte, paiement en 3 fois ou Wero. En validant, vous acceptez les <button type="button" class="bouton-lien" data-action="doc" data-id="cgv">CGV</button>. Rétractation sous 14 jours.</p>
        </form>` : '<p>Votre panier est vide.</p>'}
    </aside>
  </div>`;
}

function passerCommande(form) {
  const d = new FormData(form);
  const sousTotal = ui.panier.reduce((a, l) => a + l.prix * l.qte, 0);
  const port = fraisPort(ui.livraison, sousTotal);
  const numero = Math.max(1000, ...etat.commandes.map(c => c.numero)) + 1;
  const now = Date.now();
  etat.commandes.push({
    livraison: ui.livraison, canal: 'web', facture: numeroFactureSuivant(etat, now),
    id: 'c' + numero, numero, date: now,
    client: { nom: d.get('nom'), email: d.get('email'), ville: d.get('ville') },
    lignes: ui.panier.map(l => ({ ...l })), sousTotal, port, total: Math.round((sousTotal + port) * 100) / 100,
    statut: 'payee', suivi: '', note: '',
    historique: [{ date: now, texte: 'Commande passée en ligne' }, { date: now, texte: 'Paiement par carte accepté (simulé)' }]
  });
  for (const l of ui.panier) { const p = etat.produits.find(x => x.id === l.produitId); if (p) p.stock = Math.max(0, p.stock - l.qte); }
  ui.panier = [];
  ui.confirmation = numero;
  sauver();
  rendre();
}

/* ---------- Assistant de création ---------- */
function vueAssistant() {
  const a = ui.assistant;
  const etapes = ['Votre activité', 'Le style', 'Le domaine'];
  let corps = '';
  if (a.etape === 1) {
    corps = `<label class="champ"><span>Nom de la boutique</span><input id="as-nom" value="${esc(a.nom)}" placeholder="ex. Atelier Sauge" data-assistant="nom" required></label>
      <label class="champ"><span>Que vendez-vous ?</span><select id="as-secteur" data-assistant="secteur">${Object.entries(SECTEURS).map(([k, v]) => `<option value="${k}" ${a.secteur === k ? 'selected' : ''}>${v.nom}</option>`).join('')}</select></label>
      <label class="champ"><span>Où sont vos clients ?</span><select id="as-pays" data-assistant="pays">${[['fr', 'France'], ['be', 'Belgique'], ['ch', 'Suisse'], ['ca', 'Canada']].map(([k, v]) => `<option value="${k}" ${a.pays === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="case"><input id="as-ex" type="checkbox" data-assistant="exemples" ${a.exemples ? 'checked' : ''}> Ajouter 6 produits d’exemple à modifier ensuite</label>`;
  } else if (a.etape === 2) {
    corps = `<div class="themes grands">${Object.entries(THEMES).map(([id, th]) => `
      <button class="theme-choix ${a.theme === id ? 'actif' : ''}" data-action="as-theme" data-id="${id}" style="background:${th.bg};color:${th.text};border-radius:${Math.min(th.radius, 14)}px">
        <span style="font-family:${th.font};font-size:1.4rem">${esc(a.nom || 'Ma boutique')}</span><small style="font-family:${th.body};color:${th.muted}">Thème ${th.nom}</small><i style="background:${th.primary}"></i></button>`).join('')}</div>`;
  } else {
    const res = suggererDomaines({ marque: a.nom || 'ma boutique', secteurId: a.secteur, pays: a.pays, mois: new Date().getMonth() });
    const top = res.resultats.filter(r => r.disponible && r.genre !== 'campagne').slice(0, 4);
    if (!a.domaine && top[0]) a.domaine = top[0].domaine;
    corps = `<p class="sous">Classés selon la demande « ${esc(SECTEURS[a.secteur].nom)} » en ${MOIS_LONG[new Date().getMonth()]} et la facilité à retenir le nom.</p>
      <div class="choix-domaines">${top.map(r => `<label class="choix-dom ${a.domaine === r.domaine ? 'actif' : ''}"><input type="radio" name="as-dom" value="${esc(r.domaine)}" data-assistant="domaine" ${a.domaine === r.domaine ? 'checked' : ''}>
        <span class="mono">${esc(r.domaine)}</span><b>${r.score}</b><span class="sous">${euros(r.prix)} la 1re année</span></label>`).join('')}
      <label class="choix-dom ${a.domaine === '' ? 'actif' : ''}"><input type="radio" name="as-dom" value="" data-assistant="domaine" ${a.domaine === '' ? 'checked' : ''}><span>Plus tard, garder l’adresse gratuite</span></label></div>`;
  }
  return `<div class="assistant carte">
    <a href="#tableau" class="lien">Annuler</a>
    <h1>Créer une boutique</h1>
    <ol class="etapes">${etapes.map((e, i) => `<li class="${i + 1 === a.etape ? 'actif' : i + 1 < a.etape ? 'fait' : ''}">${e}</li>`).join('')}</ol>
    <div class="assistant-corps">${corps}</div>
    <div class="rangee fin">${a.etape > 1 ? '<button class="btn fantome" data-action="as-prec">Retour</button>' : ''}
      <button class="btn" data-action="${a.etape < 3 ? 'as-suiv' : 'as-creer'}">${a.etape < 3 ? 'Continuer' : 'Créer ma boutique'}</button></div>
    <p class="sous">La boutique de démonstration actuelle sera remplacée. Vous pourrez la restaurer avec « Réinitialiser la démo ».</p>
  </div>`;
}

function creerBoutique() {
  const a = ui.assistant;
  const nom = a.nom.trim() || 'Ma boutique';
  const res = suggererDomaines({ marque: nom, secteurId: a.secteur, pays: a.pays });
  const dom = res.resultats.find(r => r.domaine === a.domaine);
  etat = {
    version: 1,
    boutique: { nom, secteur: a.secteur, slogan: '', theme: { ...THEMES[a.theme], id: a.theme }, sections: sectionsParDefaut(nom, a.secteur), domaine: dom ? { domaine: dom.domaine, prix: dom.prix, date: Date.now() } : null, publiee: true, pays: a.pays },
    produits: a.exemples ? produitsDepuisSecteur(a.secteur) : [],
    commandes: [], visites30j: 0
  };
  completerEtat(etat);
  etat.entreprise.raison = nom;
  sauver();
  ui.assistant = { etape: 1, nom: '', secteur: 'mode', pays: 'fr', theme: 'craie', exemples: true, domaine: null };
  toast(`${nom} est en ligne. Personnalisez maintenant chaque section.`);
  location.hash = 'editeur';
}

/* ---------- Événements ---------- */
document.addEventListener('click', e => {
  // Clic dans l’aperçu de l’éditeur : sélectionne la section
  const bloc = e.target.closest('[data-section]');
  if (bloc && ui.route === 'editeur') {
    e.preventDefault();
    ui.section = bloc.dataset.section; ui.ongletEditeur = 'sections'; rendre();
    document.querySelector('.liste-sections li.ouvert')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const sf = e.target.closest('[data-sf]');
  if (sf && ui.route === 'boutique') {
    const a = sf.dataset.sf;
    if (a === 'ajouter') {
      const p = etat.produits.find(x => x.id === sf.dataset.id);
      const l = ui.panier.find(x => x.produitId === p.id);
      if (l) l.qte = Math.min(p.stock, l.qte + 1); else ui.panier.push({ produitId: p.id, nom: p.nom, prix: p.prix, qte: 1 });
      ui.confirmation = null; ui.panierOuvert = true; rendre();
    } else if (a === 'panier') { ui.panierOuvert = true; rendre(); }
    else if (a === 'defiler') { document.getElementById('sf-collection')?.scrollIntoView({ behavior: 'smooth' }); }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const s = id && etat.boutique.sections.find(x => x.id === id);
  const idx = s ? etat.boutique.sections.indexOf(s) : -1;
  switch (action) {
    case 'ouvrir-commande': ui.commande = id; if (ui.route !== 'commandes') location.hash = 'commandes'; else rendre(); break;
    case 'fermer-commande': ui.commande = null; rendre(); break;
    case 'filtre': ui.filtre = el.dataset.filtre; rendre(); break;
    case 'filtre-lien': ui.filtre = el.dataset.filtre; break;
    case 'statut': changerStatut(id, el.dataset.statut); break;
    case 'nouveau-produit': ui.produitEdite = { id: nouvelId('p'), nom: '', description: '', prix: 20, stock: 10, categorie: SECTEURS[etat.boutique.secteur].categories[0], teinte: Math.floor(Math.random() * 360), actif: true }; rendre(); break;
    case 'editer-produit': ui.produitEdite = { ...etat.produits.find(x => x.id === id) }; rendre(); break;
    case 'fermer-produit': ui.produitEdite = null; rendre(); break;
    case 'supprimer-produit': etat.produits = etat.produits.filter(x => x.id !== id); ui.produitEdite = null; sauver(); toast('Produit supprimé.'); rendre(); break;
    case 'choisir-section': ui.section = ui.section === id ? null : id; rendre(); break;
    case 'monter': if (idx > 0) { etat.boutique.sections.splice(idx - 1, 0, ...etat.boutique.sections.splice(idx, 1)); modifie(); rendre(); } break;
    case 'descendre': if (idx >= 0 && idx < etat.boutique.sections.length - 1) { etat.boutique.sections.splice(idx + 1, 0, ...etat.boutique.sections.splice(idx, 1)); modifie(); rendre(); } break;
    case 'supprimer-section': etat.boutique.sections.splice(idx, 1); if (ui.section === id) ui.section = null; modifie(); rendre(); break;
    case 'ajouter-section': {
      const type = $('#type-ajout').value;
      const n = { id: nouvelId('s'), type, props: { ...TYPES_SECTIONS[type].defaut } };
      const piedIdx = etat.boutique.sections.findIndex(x => x.type === 'pied');
      etat.boutique.sections.splice(piedIdx >= 0 ? piedIdx : etat.boutique.sections.length, 0, n);
      ui.section = n.id; modifie(); rendre(); break;
    }
    case 'onglet-editeur': ui.ongletEditeur = id; rendre(); break;
    case 'appareil': ui.appareil = id; rendre(); break;
    case 'theme': etat.boutique.theme = { ...THEMES[id], id }; modifie(); rendre(); break;
    case 'publier': etat.boutique.modifie = false; sauver(); toast('Modifications publiées.', ['boutique', 'Voir la boutique']); rendre(); break;
    case 'choisir-domaine':
      etat.boutique.domaine = { domaine: el.dataset.domaine, prix: Number(el.dataset.prix), genre: el.dataset.genre, date: Date.now() };
      sauver(); toast(`${el.dataset.domaine} réservé (simulation). Votre boutique y est accessible.`); rendre(); break;
    case 'fermer-panier': ui.panierOuvert = false; ui.confirmation = null; rendre(); break;
    case 'qte': {
      const l = ui.panier.find(x => x.produitId === id);
      const p = etat.produits.find(x => x.id === id);
      l.qte = Math.min(p.stock, l.qte + Number(el.dataset.d));
      if (l.qte <= 0) ui.panier = ui.panier.filter(x => x !== l);
      rendre(); break;
    }
    case 'voir-commande': ui.commande = 'c' + el.dataset.num; ui.filtre = 'tous'; ui.panierOuvert = false; ui.confirmation = null; break;
    case 'as-theme': ui.assistant.theme = id; rendre(); break;
    case 'as-prec': ui.assistant.etape--; rendre(); break;
    case 'as-suiv':
      if (ui.assistant.etape === 1 && !ui.assistant.nom.trim()) { $('#as-nom').focus(); toast('Donnez un nom à votre boutique pour continuer.'); break; }
      ui.assistant.etape++; ui.assistant.domaine = null; rendre(); break;
    case 'as-creer': creerBoutique(); break;
    case 'reset':
      if (!ui.confirmerReset) { ui.confirmerReset = true; el.textContent = 'Confirmer la réinitialisation'; setTimeout(() => { ui.confirmerReset = false; el.textContent = 'Réinitialiser la démo'; }, 4000); break; }
      ui.confirmerReset = false; etat = boutiqueDemo(); sauver(); ui.commande = null; ui.section = null; toast('Démo Maison Brume restaurée.'); location.hash = 'tableau'; rendre(); break;
  }
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-action], [data-section]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape') { if (ui.panierOuvert) { ui.panierOuvert = false; rendre(); } else if (ui.commande) { ui.commande = null; rendre(); } }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.prop) {
    const s = etat.boutique.sections.find(x => x.id === t.dataset.id);
    s.props[t.dataset.prop] = t.value; modifie(); rendreApercu();
  } else if (t.dataset.theme) {
    const k = t.dataset.theme;
    etat.boutique.theme[k] = k === 'radius' ? Number(t.value) : t.value;
    if (k === 'radius') $('#rayon-val').textContent = t.value;
    modifie(); rendreApercu();
  } else if (t.dataset.boutique) {
    etat.boutique[t.dataset.boutique] = t.value; modifie(); rendreApercu();
    if (t.dataset.boutique === 'nom') $('#nom-boutique').textContent = t.value;
  } else if (t.dataset.champ === 'recherche') {
    ui.recherche = t.value; rendre(); const r = $('#recherche-commandes'); r.focus(); r.setSelectionRange(r.value.length, r.value.length);
  } else if (t.dataset.champ === 'note') {
    const c = etat.commandes.find(x => x.id === t.dataset.id); c.note = t.value; sauver();
  } else if (t.dataset.assistant && t.type !== 'radio' && t.type !== 'checkbox') {
    ui.assistant[t.dataset.assistant] = t.value;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.champ === 'dom-marque') { ui.dom.marque = t.value; rendre(); }
  else if (t.dataset.champ === 'dom-kw') { ui.dom.motsCles = t.value; rendre(); }
  else if (t.dataset.champ === 'dom-mois') { ui.dom.mois = Number(t.value); rendre(); }
  else if (t.dataset.boutiqueDom === 'pays') { etat.boutique.pays = t.value; sauver(); rendre(); }
  else if (t.dataset.boutique === 'secteur') { rendre(); }
  else if (t.dataset.livraison !== undefined) { ui.livraison = t.value; rendre(); }
  else if (t.dataset.assistant === 'exemples') ui.assistant.exemples = t.checked;
  else if (t.dataset.assistant === 'domaine') { ui.assistant.domaine = t.value; rendre(); }
  else if (t.dataset.assistant === 'secteur' || t.dataset.assistant === 'pays') ui.assistant[t.dataset.assistant] = t.value;
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === 'produit') {
    const d = new FormData(f);
    const p = { ...ui.produitEdite, nom: d.get('nom'), description: d.get('description'), prix: Number(d.get('prix')), stock: Number(d.get('stock')), categorie: d.get('categorie'), actif: d.get('actif') === 'on', aVerifier: false };
    const i = etat.produits.findIndex(x => x.id === p.id);
    if (i >= 0) etat.produits[i] = p; else etat.produits.push(p);
    ui.produitEdite = null; sauver(); toast(`« ${p.nom} » enregistré.`); rendre();
  } else if (f.dataset.form === 'paiement') {
    passerCommande(f);
  } else if (f.dataset.sf === 'newsletter') {
    f.innerHTML = '<p>Merci, vous êtes inscrit.</p>';
  }
});

/* Infobulles des graphiques */
document.addEventListener('pointerover', e => {
  const c = e.target.closest('[data-tip]');
  const tip = $('#tip');
  if (!c) { tip.hidden = true; return; }
  tip.textContent = c.dataset.tip; tip.hidden = false;
});
document.addEventListener('pointermove', e => {
  const tip = $('#tip');
  if (tip.hidden) return;
  const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  tip.style.transform = `translate(${x}px, ${e.clientY - 36}px)`;
});

/* Routage par ancre (#commandes, #editeur…) */
function surHash() {
  const r = location.hash.slice(1);
  ui.route = [...NAV.map(n => n[0]), 'creer', 'offre'].includes(r) ? r : 'tableau';
  if (ui.route !== 'boutique') { ui.panierOuvert = false; }
  ui.modal = null;
  rendre();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', surHash);
surHash();
