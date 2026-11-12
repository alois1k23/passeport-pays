/* Comptoir — modules qui font la différence :
   copilote de saison, magasin et retrait, conformité française
   (factures, CGV, mentions légales), ajout de produits par photo,
   session d’accompagnement et page d’offre. */

/* ---------- Copilote de saison ---------- */
function vueCopilote() {
  const evts = prochainsTempsForts(4);
  const choisi = evts.find(e => e.cle === ui.campagne) || evts[0];
  ui.campagne = choisi.cle;
  const camp = genererCampagne(etat, choisi);
  const etatCamp = etat.campagnes[choisi.cle];
  const passe = dernierTempsFort();
  const bilan = passe && bilanCampagne(etat, passe);
  const jours = d => Math.ceil((d - new Date()) / 86400000);

  return `
  <div class="tete"><div><h1>Copilote de saison</h1><p class="sous">Chaque temps fort est préparé à partir de vos ventes. Vous relisez, vous validez, c’est en ligne.</p></div></div>
  <div class="frise-saisons" role="tablist">${evts.map(e => {
    const st = etat.campagnes[e.cle];
    return `<button role="tab" aria-selected="${e.cle === choisi.cle}" class="${e.cle === choisi.cle ? 'actif' : ''}" data-action="campagne" data-id="${e.cle}">
      <span class="sous frise-date">${e.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })}</span>
      <strong>${esc(e.nom)}</strong>
      <span class="sous">${dansJours(e.date)}</span>
      ${st ? '<span class="pill good">Programmée</span>' : jours(e.date) <= 21 ? '<span class="pill warn">À valider</span>' : '<span class="pill muted">Préparée</span>'}</button>`;
  }).join('')}</div>

  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><div><span class="eyebrow">Campagne prête · ${esc(camp.dateTxt)}</span><h2 class="titre-campagne">${esc(choisi.nom)}</h2></div>
        ${etatCamp ? `<span class="pill good">Programmée le ${dateCourte(etatCamp.le)}</span>` : ''}</div>
      <div class="chiffres">
        <div><span class="sous">CA prévu</span><strong>${camp.caPrevu === null ? '—' : euros(camp.caPrevu)}</strong>${camp.caPrevu === null ? '<span class="sous">dès vos premières ventes</span>' : ''}</div>
        <div><span class="sous">Offre</span><strong>${choisi.remise ? '-' + choisi.remise + ' %' : 'Cadeau'}</strong></div>
        <div><span class="sous">Durée</span><strong>${choisi.duree} j</strong></div>
      </div>
      <div class="bloc"><h3>Produits mis en avant</h3>
        <table class="table compacte"><tbody>${camp.vedettes.map(x => `<tr><td class="vignette">${visuelProduit(x.p)}</td><td>${esc(x.p.nom)}<div class="sous">${x.ventes90} ventes sur 90 j</div></td><td class="num">${euros(x.p.prix)}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="bloc"><h3>Stock et délais face à la demande prévue</h3>
        ${camp.ruptures.length ? `<ul class="todo">${camp.ruptures.map(x => `<li class="alerte"><a href="#produits"><span class="todo-n">+${x.manque}</span><span class="todo-t">${esc(x.p.nom)} à commander : ${x.prevision} ventes prévues, ${x.p.stock} en stock</span><span class="todo-fl" aria-hidden="true">›</span></a></li>`).join('')}</ul>`
          : camp.caPrevu === null ? '<p class="sous">La demande sera prévue à partir de vos premières ventes.</p>' : '<p class="sous">Votre stock couvre la demande prévue.</p>'}
        ${camp.dateLimite ? `<p class="encart">Dropshipping : vos fournisseurs livrent en ${camp.delaiMax} jours au plus. Date limite de commande affichée aux clients : <strong>${camp.dateLimite.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</strong>.</p>` : ''}
        ${camp.delaiLong.length ? `<p class="encart alerte-encart">${camp.delaiLong.map(p => esc(p.nom)).join(', ')} : livraison en plus de 10 jours. Retirez-le de la campagne ou passez à un fournisseur européen.</p>` : ''}
      </div>
      <div class="bloc"><h3>Planning</h3><ol class="frise">${camp.planning.map(p => `<li class="${p.passe ? 'passe' : ''}"><span>${esc(p.texte)}</span><time>${p.label}</time></li>`).join('')}</ol></div>
      <div class="rangee">
        <button class="btn" data-action="valider-campagne">${etatCamp ? 'Mettre à jour la campagne' : 'Valider et programmer'}</button>${etatCamp ? '<button class="btn fantome danger-doux" data-action="annuler-campagne">Annuler la campagne</button>' : ''}
        <a class="btn fantome" href="#editeur">Voir la bannière dans l’éditeur</a>
      </div>
    </section>

    <div class="pile">
      <section class="carte">
        <div class="carte-tete"><h2>Contenus rédigés</h2><span class="sous">À copier : l’e-mail et la publication s’envoient depuis votre messagerie et vos réseaux</span></div>
        <div class="bloc"><h3>Bannière du site</h3><p><strong>${esc(camp.banniere.titre)}</strong> · ${esc(camp.banniere.texte)}</p></div>
        <div class="bloc"><h3>E-mail aux clients</h3><p class="sous">Objet : ${esc(camp.email.objet)}</p><pre class="brouillon">${esc(camp.email.corps)}</pre></div>
        <div class="bloc"><h3>Publication Instagram</h3><pre class="brouillon">${esc(camp.post)}</pre></div>
        <div class="bloc"><h3>Domaine de campagne</h3><p class="mono">${esc(camp.domaine)}</p><a class="lien" href="#domaines" data-action="mois-domaine" data-mois="${choisi.date.getMonth()}">Vérifier la disponibilité</a></div>
      </section>
      ${bilan ? `<section class="carte">
        <div class="carte-tete"><h2>Bilan : ${esc(passe.nom)}</h2><span class="sous">${passe.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span></div>
        <div class="chiffres">
          <div><span class="sous">CA pendant</span><strong>${euros(bilan.pendant)}</strong></div>
          <div><span class="sous">vs période avant</span><strong class="${bilan.evolution >= 0 ? 'up' : 'down'}">${bilan.evolution === null ? '—' : pct(bilan.evolution)}</strong></div>
        </div>
        ${bilan.top ? `<p class="sous">Meilleure vente : ${esc(bilan.top)}. Le copilote s’en sert pour préparer l’an prochain.</p>` : ''}
      </section>` : ''}
    </div>
  </div>`;
}

/* ---------- Magasin, caisse et retrait ---------- */
function vueMagasin() {
  const m = etat.magasin;
  const url = urlBoutiquePublique();   // l'adresse où la boutique répond vraiment
  const retraits = etat.commandes.filter(c => c.livraison === 'retrait' && c.canal === 'web' && ['payee', 'preparation', 'prete'].includes(c.statut)).sort((a, b) => a.date - b.date);
  const ventesMag = etat.commandes.filter(c => c.canal === 'magasin' && c.date > Date.now() - 30 * 86400000);
  const totalCaisse = ui.caisse.reduce((a, l) => a + l.prix * l.qte, 0);
  const visibles = etat.produits.filter(p => p.actif && p.stock > 0).length;
  return `
  <div class="tete"><div><h1>Magasin et caisse</h1><p class="sous">Boutique physique et site partagent le même stock. ${ventesMag.length} ventes en boutique sur 30 jours (${euros(ventesMag.reduce((a, c) => a + c.total, 0))}).</p></div></div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Caisse</h2><span class="sous">Encaissez une vente au comptoir : le stock du site est mis à jour</span></div>
      <div class="caisse-produits">${etat.produits.filter(p => p.actif && p.type !== 'drop').length ? '' : '<p class="sous">La caisse sert aux produits que vous avez en stock (marchés, pop-up, boutique). Ajoutez-en un dans Produits.</p>'}${etat.produits.filter(p => p.actif && p.type !== 'drop').flatMap(p => Array.isArray(p.variantes) && p.variantes.length ? p.variantes.map(v => ({ p, v })) : [{ p, v: null }]).map(({ p, v }) => `
        <button class="caisse-btn" data-action="caisse-ajout" data-id="${p.id}" data-variante="${esc(v ? v.id : '')}" ${(v ? v.stock : p.stock) <= 0 ? 'disabled' : ''}>${visuelProduit(p)}<span>${esc(p.nom)}${v ? ` <small>${esc(v.valeurs.join(' / '))}</small>` : ''}</span><b class="num">${euros(v && typeof v.prix === 'number' ? v.prix : p.prix)}</b><small>${v ? v.stock : p.stock} en stock</small></button>`).join('')}</div>
      <div class="ticket">
        <div class="ticket-tete"><strong>Ticket</strong><span class="sous">${ui.caisse.reduce((a, l) => a + l.qte, 0)} article${ui.caisse.reduce((a, l) => a + l.qte, 0) > 1 ? 's' : ''}</span></div>
        ${ui.caisse.length ? `<table class="table compacte"><tbody>${ui.caisse.map(l => `<tr><td class="num">${l.qte} ×</td><td>${esc(l.nom)}</td><td class="num">${euros(l.prix * l.qte)}</td><td class="num"><button class="icone" data-action="caisse-retire" data-id="${l.produitId}" data-variante="${esc(l.varianteId || '')}" aria-label="Retirer ${esc(l.nom)}">×</button></td></tr>`).join('')}</tbody></table>`
          : '<p class="sous ticket-vide">Touchez un produit pour l’ajouter au ticket.</p>'}
        <div class="ticket-total"><span>Total TTC</span><strong>${euros(totalCaisse)}</strong></div>
        ${estSuisse() && ui.caisse.length && Math.round(totalCaisse * 20) / 20 !== Math.round(totalCaisse * 100) / 100 ? `<p class="sous">En espèces : ${euros(Math.round(totalCaisse * 20) / 20)} (arrondi aux 5 centimes).</p>` : ''}
        ${ui.caisse.length ? (() => { const du = estSuisse() ? Math.round(totalCaisse * 20) / 20 : Math.round(totalCaisse * 100) / 100, recu = Number(ui.recuCaisse) || 0; return `<label class="champ rendu-monnaie"><span>Espèces reçues</span><input id="cs-recu" type="number" min="0" step="0.05" inputmode="decimal" value="${ui.recuCaisse || ''}" data-caisse="recu" data-du="${du}" placeholder="${du.toFixed(2)}"></label><p id="cs-rendu" aria-live="polite">${texteRendu(du, recu)}</p>`; })() : ''}
        <div class="rangee">${estSuisse() ? `<button class="btn" data-action="encaisser" data-moyen="twint" ${ui.caisse.length ? '' : 'disabled'}>TWINT</button>` : ''}<button class="btn${estSuisse() ? ' fantome' : ''}" data-action="encaisser" data-moyen="carte" ${ui.caisse.length ? '' : 'disabled'}>Carte</button><button class="btn fantome" data-action="encaisser" data-moyen="especes" ${ui.caisse.length ? '' : 'disabled'}>Espèces</button></div>
      </div>
    </section>
    <div class="pile">
      <section class="carte">
        <div class="carte-tete"><h2>Retraits en magasin</h2><span class="sous">${retraits.length} en cours</span></div>
        ${retraits.length ? `<table class="table compacte"><tbody>${retraits.map(c => `<tr><td class="mono">#${c.numero}</td><td>${esc(c.client.nom)}<div class="sous">${dateCourte(c.date)}</div></td><td>${pill(c.statut)}</td>
          <td class="num">${c.statut === 'prete' ? `<button class="btn petit" data-action="statut" data-id="${c.id}" data-statut="retiree">Remis au client</button>` : `<button class="btn petit fantome" data-action="statut" data-id="${c.id}" data-statut="prete">Prête</button>`}</td></tr>`).join('')}</tbody></table>`
          : '<p class="sous">Aucun retrait en attente.</p>'}
      </section>
      <section class="carte">
        <div class="carte-tete"><h2>QR code de vitrine</h2></div>
        <div class="qr-ligne"><div id="qr" class="qr" data-url="${esc(url)}"></div>
          <div class="bloc"><p>À coller sur la vitrine et le comptoir : vos clients retrouvent la boutique en ligne, même magasin fermé.</p><p class="mono sous">${esc(url)}</p></div></div>
      </section>
      <section class="carte">
        <div class="carte-tete"><h2>Infos du magasin</h2></div>
        <label class="champ"><span>Adresse</span><input id="mg-adresse" value="${esc(m.adresse)}" data-magasin="adresse"></label>
        <label class="champ"><span>Horaires</span><input id="mg-horaires" value="${esc(m.horaires)}" data-magasin="horaires"></label>
        <label class="case"><input id="mg-cc" type="checkbox" data-magasin="clickCollect" ${m.clickCollect ? 'checked' : ''}> Proposer le retrait en boutique</label>${m.clickCollect && !String(m.adresse || '').trim() ? '<p class="sous alerte-texte">Sans adresse de magasin, le retrait n’est pas proposé aux clients.</p>' : ''}
        ${connecteAuServeur() ? '<p class="sous">Synchronisation avec votre fiche Google (horaires et stock) : bientôt disponible.</p>' : `<label class="case"><input id="mg-g" type="checkbox" data-magasin="googleSync" ${m.googleSync ? 'checked' : ''}> Synchroniser la fiche Google (horaires et stock)</label>
        ${m.googleSync ? `<p class="sous"><span class="pill good">Synchronisée</span> ${visibles} produits en stock visibles sur Google (simulé)</p>` : ''}`}
      </section>
    </div>
  </div>`;
}

function encaisser(moyen) {
  if (!ui.caisse.length) return;
  const total = ui.caisse.reduce((a, l) => a + l.prix * l.qte, 0);
  const numero = Math.max(1000, ...etat.commandes.map(c => c.numero)) + 1;
  const now = Date.now();
  const c = {
    id: 'c' + numero, numero, date: now,
    client: { nom: 'Client en boutique', email: '', ville: '' },
    lignes: ui.caisse.map(l => ({ ...l })), sousTotal: total, port: 0, total: Math.round(total * 100) / 100,
    statut: 'retiree', livraison: 'retrait', canal: 'magasin', moyen: ['especes', 'twint', 'carte'].includes(moyen) ? moyen : 'carte', suivi: '', note: '', tauxTva: tauxTvaVente(),
    historique: [{ date: now, texte: `Vente encaissée en boutique (${moyen === 'especes' ? 'espèces' : moyen === 'twint' ? 'TWINT' : 'carte'})` }]
  };
  c.facture = numeroFactureSuivant(etat, now); c.dateFacture = now;
  for (const l of c.lignes) { const p = etat.produits.find(x => x.id === l.produitId); l.tauxTva = tauxTvaProduit(p); }
  if (moyen === 'especes' && estSuisse()) { c.encaisse = Math.round(c.total * 20) / 20; c.arrondi = Math.round((c.encaisse - c.total) * 100) / 100; }
  etat.commandes.push(c);
  for (const l of c.lignes) { const p = etat.produits.find(x => x.id === l.produitId); const v = p && l.varianteId && Array.isArray(p.variantes) ? p.variantes.find(x => x.id === l.varianteId) : null; if (v) { const r = Math.min(l.qte, Math.max(0, v.stock)); v.stock -= r; } l.type = p ? p.type : l.type; if (p) { l.retireStock = Math.min(l.qte, Math.max(0, p.stock)); p.stock -= l.retireStock; } }
  ui.caisse = []; ui.recuCaisse = '';
  sauver();
  toast(`Vente de ${euros(total)} encaissée. Ticket ${c.facture}, stock du site mis à jour.`);
  rendre();
}

/* ---------- Conformité française ---------- */
/* TVA d'une commande, détaillée par taux (une facture peut mêler taux normal et taux réduit).
   Taux figés au moment de la vente, ligne par ligne : une facture émise ne change pas si le régime change ensuite.
   Remise et frais de port sont répartis au prorata des lignes. */
function tauxDeLigne(c, l) { return typeof l.tauxTva === 'number' ? l.tauxTva : typeof c.tauxTva === 'number' ? c.tauxTva : tauxTvaVente(); }
function tva(c) {
  const r2 = n => Math.round(n * 100) / 100;
  const ttc = c.total, base = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1;
  const groupes = {};
  for (const l of c.lignes) { const t = tauxDeLigne(c, l); groupes[t] = (groupes[t] || 0) + ttc * (l.prix * l.qte) / base; }
  if (!c.lignes.length) groupes[typeof c.tauxTva === 'number' ? c.tauxTva : tauxTvaVente()] = ttc;
  const parTaux = Object.entries(groupes).map(([t, m]) => ({ taux: Number(t), ttc: r2(m) })).sort((a, b) => b.ttc - a.ttc);
  if (parTaux.length) parTaux[0].ttc = r2(parTaux[0].ttc + ttc - parTaux.reduce((a, x) => a + x.ttc, 0));   // somme exacte au centime
  for (const x of parTaux) { x.ht = x.taux ? r2(x.ttc / (1 + x.taux)) : x.ttc; x.tva = r2(x.ttc - x.ht); }
  parTaux.sort((a, b) => b.taux - a.taux);
  const ht = r2(parTaux.reduce((a, x) => a + x.ht, 0)), montantTva = r2(parTaux.reduce((a, x) => a + x.tva, 0));
  const franchise = parTaux.every(x => x.taux === 0);
  return { ht, tva: montantTva, ttc, franchise, taux: parTaux[0] ? parTaux[0].taux : 0, parTaux };
}
const pctTva = t => (Math.round(t * 1000) / 10).toString().replace('.', ',') + ' %';

/* Facture ou avoir : mentions obligatoires selon le pays et le régime de TVA. */
function documentFacture(c, avoir = false) {
  const e = etat.entreprise, t = tva(c), ch = estSuisse(), signe = avoir ? -1 : 1;
  const ei = !ch && /micro|^ei$|entrepreneur individuel/i.test(e.forme || '') ? ' EI' : '';
  const sansTva = t.franchise;
  const assujettiSansNumero = !sansTva && !e.tvaIntra;
  const dateDoc = avoir ? c.avoir.date : (c.dateFacture || c.date);
  const adresse = [c.client.adresse, [c.client.npa, c.client.ville].filter(Boolean).join(' ')].filter(Boolean);
  const m = n => euros(signe * n);
  return `<article class="facture">
      <header><div><strong class="f-nom">${esc(e.raison)}${ei}</strong><div>${esc(e.forme)} · ${ch ? 'IDE' : droitPays().idCourt} ${esc(e.siret || '—')}</div>${e.tvaIntra ? `<div>N° TVA ${esc(e.tvaIntra)}</div>` : ''}<div>${esc(e.adresse)}</div></div>
        <div class="f-num"><span class="eyebrow">${avoir ? 'Avoir' : 'Facture'}</span><div class="mono">${avoir ? c.avoir.numero : c.facture}</div><div>${new Date(dateDoc).toLocaleDateString('fr-FR')}</div></div></header>
      ${assujettiSansNumero ? `<p class="encart alerte-encart">Numéro de TVA manquant : obligatoire sur les factures d’une entreprise assujettie. Renseignez-le dans Conformité.</p>` : ''}
      ${avoir ? `<p class="encart">Avoir annulant la facture <b class="mono">${c.facture}</b> du ${new Date(c.dateFacture || c.date).toLocaleDateString('fr-FR')} (commande remboursée).</p>` : ''}
      <div class="f-client"><span class="sous">${avoir ? 'Client' : 'Facturé à'}</span><div>${esc(c.client.nom)}</div>${adresse.map(x => `<div class="sous">${esc(x)}</div>`).join('')}${c.client.email ? `<div class="sous">${esc(c.client.email)}</div>` : ''}<div class="sous">Commande #${c.numero} du ${new Date(c.date).toLocaleDateString('fr-FR')} · ${c.canal === 'magasin' ? 'vente en boutique' : (TOUTES_LIVRAISONS[c.livraison] || { nom: c.livraison }).nom}</div></div>
      <table class="table compacte"><thead><tr><th>Désignation</th><th class="num">Qté</th>${sansTva ? '<th class="num">Prix unitaire</th>' : '<th class="num">PU HT</th><th class="num">TVA</th>'}<th class="num">${sansTva ? 'Total' : 'Total TTC'}</th></tr></thead><tbody>
        ${c.lignes.map(l => { const tl = tauxDeLigne(c, l); return `<tr><td>${esc(l.nom)}</td><td class="num">${l.qte}</td>${sansTva ? `<td class="num">${m(l.prix)}</td>` : `<td class="num">${m(l.prix / (1 + tl))}</td><td class="num">${pctTva(tl)}</td>`}<td class="num">${m(l.prix * l.qte)}</td></tr>`; }).join('')}
        ${c.remise ? `<tr><td>Remise${c.motifRemise ? ` (${esc(c.motifRemise)})` : ''}, déjà déduite des prix</td><td></td>${sansTva ? '<td></td>' : '<td></td><td></td>'}<td class="num sous">${euros(c.remise)}</td></tr>` : ''}
        ${c.port ? `<tr><td>Livraison</td><td class="num">1</td>${sansTva ? `<td class="num">${m(c.port)}</td>` : `<td class="num">—</td><td class="num">au prorata</td>`}<td class="num">${m(c.port)}</td></tr>` : ''}
      </tbody></table>
      <div class="f-totaux">${sansTva ? `<div class="total"><span>Total</span><span>${m(t.ttc)}</span></div>`
        : `${t.parTaux.map(x => `<div><span>Base HT ${pctTva(x.taux)}</span><span>${m(x.ht)}</span></div><div><span>TVA ${pctTva(x.taux)}</span><span>${m(x.tva)}</span></div>`).join('')}
           <div><span>Total HT</span><span>${m(t.ht)}</span></div><div><span>Total TVA</span><span>${m(t.tva)}</span></div><div class="total"><span>Total TTC</span><span>${m(t.ttc)}</span></div>`}
        ${!avoir && c.arrondi ? `<div><span>Arrondi espèces</span><span>${euros(c.arrondi)}</span></div><div><span>Encaissé</span><span>${euros(c.encaisse)}</span></div>` : ''}</div>
      <footer>${ch ? (sansTva ? 'Entreprise non assujettie à la TVA. ' : '') + (avoir ? 'Montant remboursé.' : 'Paiement reçu. Merci pour votre achat.') : (sansTva ? droitPays().franchise + '. ' : '') + (avoir ? 'Montant remboursé.' : 'Paiement reçu.')}</footer>
    </article>`;
}

/* Adresse postale complète : rue, puis code postal (4 ou 5 chiffres) et localité. */
const adressePostale = a => !!a && !/compléter/.test(a) && /\d{4,5}\s+\S/.test(a);
const COMPLETER = { Impressum: 'en-adresse', 'Mentions légales': 'en-siret', 'Médiateur de la consommation': 'en-med', TVA: 'en-tva', 'Facture électronique': '', 'Transparence dropshipping': '' };
function vueConformite() {
  const e = etat.entreprise;
  const factures = etat.commandes.filter(c => c.facture).sort((a, b) => b.date - a.date);
  const ch = estSuisse();
  const verifs = ch ? [
    ['Impressum', !!(e.raison && adressePostale(e.adresse) && e.email), 'Nom, adresse postale et e-mail affichés (obligatoire en Suisse pour la vente en ligne, LCD art. 3)', 'Indiquez votre adresse postale complète : obligatoire pour vendre en ligne', 'mentions'],
    ['Conditions générales de vente', true, `Générées : livraison, ${Number(e.retoursJours) > 0 ? `retours volontaires ${Number(e.retoursJours)} jours` : 'pas de reprise hors défaut'}, garantie 2 ans`, '', 'cgv'],
    ['Protection des données (nLPD)', true, 'Déclaration de confidentialité générée, avec les fournisseurs et les pays où leurs données sont transmises', '', 'mentions'],
    ['Transparence dropshipping', etat.produits.filter(p => p.type === 'drop').every(p => p.delai), 'Délais réels de chaque fournisseur affichés sur les fiches et au paiement', 'Indiquez les délais de livraison de chaque fournisseur', null],
    ['Prix en CHF, TTC', true, 'Prix affichés en francs suisses, frais de livraison indiqués avant le paiement', '', null],
    ['TVA', e.regime !== 'ch-assujetti' || /^CHE-\d{3}\.\d{3}\.\d{3}\s*(TVA|MWST|IVA)$/i.test((e.tvaIntra || '').trim()), e.regime === 'ch-assujetti' ? 'Assujetti : TVA 8,1 % (2,6 % pour les denrées alimentaires) détaillée par taux sur chaque facture, avec votre numéro' : `Non assujetti (chiffre d’affaires sous ${euros(100000)} par an). Comptoir vous prévient à l’approche du seuil.`, '', null]
  ] : [
    ['Mentions légales', !!(e.raison && e.siret && e.adresse && e.email && (etat.boutique.pays === 'be' || e.telephone)), 'Générées à partir de la fiche entreprise', `Renseignez la raison sociale, le ${droitPays().idCourt}, l’adresse, l’e-mail${etat.boutique.pays === 'be' ? '' : ' et le téléphone (obligatoire en France, loi pour la confiance dans l’économie numérique)'}`, 'mentions'],
    ['Conditions générales de vente', true, 'Générées et tenues à jour (livraison, retours, rétractation 14 jours)', '', 'cgv'],
    ['Bandeau cookies (RGPD)', true, 'Accepter et Refuser au même niveau, mesure d’audience seulement après accord', '', null],
    ['Médiateur de la consommation', etat.boutique.pays === 'be' || !!e.mediateur, etat.boutique.pays === 'be' ? (e.mediateur ? 'Indiqué dans les CGV (facultatif en Belgique)' : 'Facultatif en Belgique : le Service de médiation pour le consommateur reste joignable par vos clients') : 'Indiqué dans les CGV', 'Obligatoire pour vendre aux particuliers en France : indiquez votre médiateur', null],
    ['TVA', e.regime === 'franchise' || !!(e.tvaIntra || '').trim(), e.regime === 'franchise' ? `${droitPays().franchiseNom}${etat.boutique.pays === 'be' ? ' (chiffre d’affaires annuel jusqu’à 25 000 €)' : ''} : « ${droitPays().franchise} » sur les factures` : `TVA détaillée par taux sur chaque facture (${droitPays().tvaTexte}, taux réduit pour les denrées alimentaires), avec votre numéro`, 'Indiquez votre numéro de TVA : obligatoire sur les factures d’une entreprise assujettie', null],
    etat.boutique.pays === 'be'
      ? ['Facture électronique', true, 'Ventes aux particuliers : factures numérotées sans rupture, avoirs compris. Entre entreprises, la facture électronique structurée (Peppol) est obligatoire depuis le 1er janvier 2026 : utilisez un service Peppol pour vos achats et ventes professionnels', '', null]
      : ['Facture électronique', false, '', 'À préparer : toute entreprise doit pouvoir recevoir des factures électroniques via une plateforme agréée depuis septembre 2026 ; l’émission et la transmission des ventes aux particuliers (e-reporting) deviennent obligatoires pour les petites entreprises en septembre 2027. Choisissez une plateforme agréée.', null]
  ];
  const pageF = Math.min(ui.pageFacture || 1, Math.max(1, Math.ceil(factures.length / 25)));
  const ca12 = etat.commandes.filter(c => c.date > Date.now() - 365 * 86400000 && !['annulee', 'remboursee', 'attente'].includes(c.statut)).reduce((a, c) => a + c.total, 0);
  return `
  <div class="tete"><div><h1>Conformité</h1><p class="sous">${ch ? 'Impressum, protection des données, TVA et factures gérés pour vous, selon le droit suisse.' : 'Factures, mentions obligatoires et RGPD gérés pour vous.'} Vous vendez, Comptoir s’occupe de la paperasse.</p></div></div>
  ${ch ? `<p class="encart">Seuil d’assujettissement à la TVA : ${euros(ca12)} de chiffre d’affaires sur 12 mois, soit ${Math.round(ca12 / 1000)} % du seuil de ${euros(100000)}.</p>` : ''}
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Points de contrôle</h2><span class="sous">${verifs.filter(v => v[1]).length} / ${verifs.length} en règle</span></div>
      <ul class="controles">${verifs.map(([nom, ok, oui, non, doc]) => `<li>
        <span class="pill ${ok ? 'good' : 'warn'}">${ok ? 'En règle' : 'À compléter'}</span>
        <div><strong>${nom}</strong><div class="sous">${ok ? oui : non}</div></div>
        <span class="controle-action">${!ok ? `<button class="btn petit" data-action="completer-fiche" data-champ="${COMPLETER[nom] || ''}">Compléter</button>` : doc ? `<button class="btn petit fantome" data-action="doc" data-id="${doc}">Lire</button>` : ''}</span></li>`).join('')}</ul>
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>Fiche entreprise</h2><span class="sous">Utilisée sur les factures et documents</span></div>
      <label class="champ"><span>Raison sociale</span><input id="en-raison" value="${esc(e.raison)}" data-entreprise="raison"></label>
      <div class="deux"><label class="champ"><span>Forme juridique</span><select id="en-forme" data-entreprise="forme">${(ch ? ['Raison individuelle', 'Sàrl', 'SA'] : droitPays().formes).map(f => `<option ${f === e.forme ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="champ"><span>${ch ? 'Numéro IDE' : droitPays().id}</span><input id="en-siret" value="${esc(e.siret)}" data-entreprise="siret" placeholder="${ch ? 'CHE-123.456.789' : droitPays().idExemple}"></label></div>
      <label class="champ"><span>Adresse postale complète</span><input id="en-adresse" value="${esc(e.adresse)}" data-entreprise="adresse" placeholder="Rue du Lac 12, 1003 Lausanne" autocomplete="street-address"></label>${e.adresse && !adressePostale(e.adresse) ? '<p class="sous erreur-champ">Ajoutez le code postal et la localité (ex. « Rue du Lac 12, 1003 Lausanne ») : l’adresse figure sur vos factures et vos mentions légales.</p>' : ''}
      <div class="deux"><label class="champ"><span>Régime de TVA</span><select id="en-regime" data-entreprise="regime">${(ch ? [['ch-non', 'Non assujetti'], ['ch-assujetti', 'Assujetti (8,1 %)']] : [['franchise', droitPays().franchiseNom], ['normal', `Assujetti (${droitPays().tvaTexte})`]]).map(([v, n]) => `<option value="${v}" ${e.regime === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="champ"><span>${ch ? 'Numéro TVA' : 'Numéro de TVA'}</span><input id="en-tva" value="${esc(e.tvaIntra)}" data-entreprise="tvaIntra" placeholder="${ch ? 'CHE-123.456.789 TVA' : droitPays().tvaExemple}"></label></div>
      <label class="champ"><span>E-mail de contact</span><input id="en-email" value="${esc(e.email)}" data-entreprise="email"></label>
      ${ch ? '' : `<label class="champ"><span>Téléphone${etat.boutique.pays === 'be' ? ' (facultatif)' : ''}</span><input id="en-tel" type="tel" value="${esc(e.telephone || '')}" data-entreprise="telephone"></label>`}
      ${ch ? `<label class="champ"><span>Retours acceptés (au-delà de la garantie, facultatif en Suisse)</span><select id="en-retours" data-entreprise="retoursJours">${[['', 'Aucun, sauf défaut'], ['14', '14 jours'], ['30', '30 jours']].map(([v, n]) => `<option value="${v}" ${String(e.retoursJours || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : `<label class="champ"><span>Médiateur de la consommation</span><input id="en-med" value="${esc(e.mediateur)}" data-entreprise="mediateur" placeholder="Nom et site du médiateur"></label>`}
    </section>
  </div>
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>Factures</h2><span class="sous">${factures.length} facture${factures.length > 1 ? 's' : ''}, numérotation continue</span></div>
    <div class="table-wrap"><table class="table table-cartes"><thead><tr><th>N° facture</th><th>Date</th><th>Client</th><th>Canal</th><th class="num">HT</th><th class="num">TVA</th><th class="num">TTC</th><th></th></tr></thead>
    <tbody>${factures.slice((pageF - 1) * 25, pageF * 25).map(c => { const t = tva(c); return `<tr><td class="mono carte-titre" data-label="Facture">${c.facture}</td><td data-label="Date">${dateCourte(c.date)}</td><td data-label="Client">${esc(c.client.nom)}</td><td data-label="Canal">${c.canal === 'magasin' ? 'Boutique' : 'En ligne'}</td>
      <td class="num" data-label="HT">${euros(t.ht)}</td><td class="num" data-label="TVA">${t.franchise ? '—' : euros(t.tva)}</td><td class="num" data-label="TTC">${euros(t.ttc)}</td><td class="num"><button class="btn petit fantome" data-action="facture" data-id="${c.id}">Voir</button></td></tr>`; }).join('')}</tbody></table></div>
    ${pagination(factures.length, pageF, 25, 'page-facture')}
  </section>`;
}

function texteMentions() {
  const e = etat.entreprise, b = etat.boutique;
  if (estSuisse()) {
    const fournisseurs = [...new Set(etat.produits.filter(p => p.type === 'drop').map(p => p.fournisseur))];
    return `<h2>Impressum et protection des données</h2>
    <p><strong>Exploitant</strong> : ${esc(e.raison)}, ${esc(e.forme)}${e.siret ? ', IDE ' + esc(e.siret) : ''}, ${esc(e.adresse || '[adresse à compléter]')}. Contact : ${esc(e.email || '[e-mail]')}.</p>
    ${e.tvaIntra ? `<p>N° TVA : ${esc(e.tvaIntra)}.</p>` : ''}
    <p><strong>Données personnelles (nLPD)</strong> : nous traitons vos données pour exécuter votre commande. Elles sont transmises au prestataire de paiement, à La Poste et, pour les articles expédiés par nos partenaires, aux fournisseurs suivants : ${fournisseurs.length ? fournisseurs.map(esc).join(', ') : 'aucun'}. ${(() => { const pays = [...new Set(etat.produits.filter(p => p.type === 'drop' && p.entrepot).map(p => p.entrepot))]; const noms = { CH: 'Suisse', UE: 'Union européenne (protection adéquate reconnue par le Conseil fédéral)', CN: 'Chine (pays sans protection adéquate : seules les données nécessaires à la livraison y sont transmises, pour exécuter votre commande, art. 17 al. 1 let. b nLPD)' }; return pays.length ? `Pays de destination : ${pays.map(k => noms[k] || k).join(' ; ')}.` : ''; })()} Vous pouvez demander l’accès, la rectification ou l’effacement de vos données à ${esc(e.email || 'l’adresse de contact')}.</p>
    <p><strong>Hébergement</strong> : Comptoir, en Suisse et dans l’Union européenne.</p>`;
  }
  return `<h2>Mentions légales</h2>
  <p><strong>Éditeur du site</strong> : ${esc(e.raison)}, ${esc(e.forme)}, ${droitPays().idCourt} ${esc(e.siret || '[à compléter]')}, ${esc(e.adresse || '[adresse à compléter]')}. Contact : ${esc(e.email || '[e-mail]')}${e.telephone ? `, ${esc(e.telephone)}` : ''}.</p>
  ${e.tvaIntra ? `<p>N° de TVA intracommunautaire : ${esc(e.tvaIntra)}.</p>` : ''}
  <p><strong>Directeur de la publication</strong> : le représentant légal de ${esc(e.raison)}.</p>
  <p><strong>Hébergement</strong> : plateforme Comptoir${typeof SERVEUR !== 'undefined' && SERVEUR.hebergeur ? ` (${esc(SERVEUR.hebergeur)})` : ''}.</p>
  <p><strong>Données personnelles</strong> : les données collectées servent uniquement au traitement des commandes de ${esc(b.nom)}. Vous disposez d’un droit d’accès, de rectification et de suppression en écrivant à ${esc(e.email || 'l’adresse de contact')}.</p>`;
}
function texteCGV() {
  const e = etat.entreprise, b = etat.boutique;
  const modes = Object.values(livraisonsPays(b.pays)).filter(l => l.transporteur || retraitPossible());
  if (estSuisse()) {
    const drops = etat.produits.filter(p => p.type === 'drop' && p.delai);
    return `<h2>Conditions générales de vente</h2>
    <p><strong>1. Objet.</strong> Ventes conclues sur le site de ${esc(b.nom)}, exploité par ${esc(e.raison)}, ${esc(e.adresse || '[adresse]')}.</p>
    <p><strong>2. Prix et paiement.</strong> Prix en francs suisses (CHF), TVA comprise${e.regime === 'ch-assujetti' ? ' (8,1 %)' : ' (entreprise non assujettie à la TVA)'}. Paiement par TWINT ou carte. ${etat.produits.some(p => p.actif && p.type === 'drop' && p.entrepot && p.entrepot !== 'CH') ? 'Les articles expédiés depuis l’étranger peuvent être soumis à la TVA d’importation et à des frais de dédouanement, réclamés à la livraison par La Poste lorsque la TVA dépasse CHF 5 par envoi ; la fiche de chaque produit indique son pays d’expédition.' : 'Aucun frais de douane n’est facturé à la livraison.'}</p>
    <p><strong>3. Livraison.</strong> ${modes.map(l => `${l.nom} : ${l.prix ? euros(l.prix) : 'gratuit'}`).join(' ; ')}. ${seuilPort() > 0 ? `Offerte dès ${euros(seuilPort())} (hors Priority).` : 'Pas de livraison offerte.'} ${drops.length ? `Certains articles sont expédiés directement par nos partenaires depuis la Suisse ou l’Europe : le délai indiqué sur chaque fiche produit (de ${Math.min(...drops.map(p => p.delai[0]))} à ${Math.max(...drops.map(p => p.delai[1]))} jours) s’applique.` : ''}</p>
    <p><strong>4. Retours.</strong> Le droit suisse ne prévoit pas de droit de rétractation général pour les achats en ligne. ${Number(e.retoursJours) > 0 ? `Nous acceptons toutefois les retours sous ${Number(e.retoursJours)} jours après réception (articles non utilisés, dans leur emballage ; frais de retour à la charge du client).` : 'Les articles ne sont ni repris ni échangés, sauf défaut (voir la garantie).'}</p>
    <p><strong>5. Garantie.</strong> Garantie de 2 ans pour les défauts (art. 197 ss CO).</p>
    <p><strong>6. Droit applicable.</strong> Droit suisse, for au siège de l’exploitant, sous réserve des fors impératifs du consommateur.</p>`;
  }
  return `<h2>Conditions générales de vente</h2>
  <p><strong>1. Objet.</strong> Les présentes conditions régissent les ventes conclues sur le site de ${esc(b.nom)}, exploité par ${esc(e.raison)} (${droitPays().idCourt} ${esc(e.siret || '[à compléter]')}).</p>
  <p><strong>2. Prix.</strong> Les prix sont indiqués en euros, toutes taxes comprises${e.regime === 'franchise' ? ` (${droitPays().franchise})` : ''}.</p>
  <p><strong>3. Livraison.</strong> ${modes.map(l => `${l.nom} : ${l.prix ? euros(l.prix) : 'gratuit'}, ${l.delai}`).join(' ; ')}. ${seuilPort() > 0 ? `Livraison offerte dès ${euros(seuilPort())} d’achat (hors express).` : 'Pas de livraison offerte.'}</p>
  <p><strong>4. Droit de rétractation.</strong> Vous disposez de 14 jours à compter de la réception pour vous rétracter, sans avoir à vous justifier (${droitPays().retractation}). Le remboursement intervient sous 14 jours.</p>
  <p><strong>5. Garanties.</strong> Les produits bénéficient de la garantie légale de conformité (2 ans) et de la garantie des vices cachés.</p>
  <p><strong>6. Médiation.</strong> En cas de litige, vous pouvez recourir gratuitement au médiateur de la consommation : ${esc(e.mediateur || '[médiateur à renseigner]')}.</p>`;
}

/* ---------- Fenêtres (factures, étiquettes, documents légaux, accompagnement) ---------- */
function rendreModal() {
  const zone = $('#modal');
  const m = ui.modal;
  if (!m) {
    const etaitOuverte = !zone.hidden;
    zone.hidden = true; zone.innerHTML = ''; zone.dataset.cle = '';
    // Rendre le focus à l’élément qui a ouvert la fenêtre
    if (etaitOuverte && rendreModal.retour && document.contains(rendreModal.retour)) rendreModal.retour.focus();
    return;
  }
  if (zone.hidden) rendreModal.retour = document.activeElement;
  zone.dataset.cle = JSON.stringify(m);
  let corps = '';
  if (m.type === 'facture' || m.type === 'avoir') {
    const c = etat.commandes.find(x => x.id === m.id);
    corps = documentFacture(c, m.type === 'avoir') + (estSuisse() ? '<div class="rangee"><span class="sous">Factures et avoirs numérotés dans une seule suite continue, exportables pour votre fiduciaire.</span></div>' : '<div class="rangee"><span class="sous">Factures et avoirs numérotés dans une seule suite continue.</span></div>');
  } else if (m.type === 'etiquette') {
    const c = etat.commandes.find(x => x.id === m.id);
    const l = TOUTES_LIVRAISONS[c.livraison];
    corps = `<article class="etiquette">
      <div class="et-tete"><strong>${esc(l.transporteur)}</strong><span>${esc(l.court)}</span></div>
      <div><span class="sous">Expéditeur</span><div>${esc(etat.entreprise.raison)}</div><div>${esc(etat.entreprise.adresse)}</div></div>
      <div class="et-dest"><span class="sous">Destinataire</span><div><strong>${esc(c.client.nom)}</strong></div>${c.client.adresse ? `<div>${esc(c.client.adresse)}</div>` : ''}<div>${esc([c.client.npa, c.client.ville].filter(Boolean).join(' '))}</div></div>
      <div class="code-barre" aria-hidden="true">${Array.from(c.suivi || 'X').map((ch, i) => `<i style="width:${1 + (ch.charCodeAt(0) + i) % 4}px"></i>`).join('')}</div>
      <div class="mono et-suivi">${esc(c.suivi)}</div>
    </article><p class="sous">Étiquette générée via l’API ${esc(l.transporteur)} (simulée). Poids estimé : ${(c.lignes.reduce((a, x) => a + x.qte, 0) * 0.45).toFixed(1).replace('.', ',')} kg.</p>`;
  } else if (m.type === 'html') {
    corps = m.html;
  } else if (m.type === 'doc') {
    corps = `<article class="doc-legal">${m.id === 'cgv' ? texteCGV() : texteMentions()}</article>`;
  } else if (m.type === 'rdv') {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const creneaux = [];
    for (let d = 1; creneaux.length < 6; d++) {
      const j = ajouterJours(base, d);
      if (j.getDay() === 0 || j.getDay() === 6) continue;
      for (const h of [10, 14, 17]) if (creneaux.length < 6 && (d + h) % 2) { const x = new Date(j); x.setHours(h); creneaux.push(x); }
    }
    corps = `<h2>Session de lancement offerte</h2>
      <p>30 minutes en visio avec un conseiller Comptoir : on configure ensemble votre boutique, vos livraisons et votre première campagne.</p>
      <div class="creneaux">${creneaux.map(c => `<button class="btn fantome" data-action="reserver-rdv" data-t="${c.getTime()}">${c.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${c.getHours()} h</button>`).join('')}</div>`;
  }
  zone.innerHTML = `<div class="modal-fond" data-action="fermer-modal"></div><div class="modal-corps" role="dialog" aria-modal="true" tabindex="-1"><button class="icone modal-x" data-action="fermer-modal">Fermer</button>${corps}</div>`;
  zone.hidden = false;
  const cible = zone.querySelector('.modal-corps input:not([disabled]), .modal-corps textarea:not([disabled]), .modal-corps .btn') || zone.querySelector('.modal-corps');
  cible.focus({ preventScroll: true });
}

/* ---------- Ajout de produits par photo ---------- */
const MOTS_PRODUITS = {
  deco: ['Bougie', 'Vase', 'Diffuseur', 'Coupelle', 'Plaid'], mode: ['Pull', 'Chemise', 'Robe', 'Écharpe', 'Sac'],
  beaute: ['Sérum', 'Savon', 'Baume', 'Huile', 'Crème'], epicerie: ['Thé', 'Confiture', 'Miel', 'Biscuits', 'Coffret'],
  sport: ['Gourde', 'Tapis', 'T-shirt', 'Sac', 'Bandeau'], bijoux: ['Collier', 'Bague', 'Bracelet', 'Boucles', 'Pendentif'],
  maison: ['Lampe', 'Diffuseur', 'Plaid', 'Organiseur', 'Bougie'], animaux: ['Gamelle', 'Coussin', 'Jouet', 'Laisse', 'Brosse'],
  tech: ['Chargeur', 'Support', 'Câble', 'Écouteurs', 'Étui']
};
function ficheDepuisPhoto(nomFichier, i) {
  const sec = etat.boutique.secteur;
  const s = SECTEURS[sec];
  const brut = nomFichier.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\b(img|dsc|photo|image|pxl)\b\s*\d*/gi, '').replace(/\d{3,}/g, '').trim();
  const mot = (MOTS_PRODUITS[sec] || ['Produit'])[i % 5] || 'Produit';
  const nom = brut.length > 2 ? brut[0].toUpperCase() + brut.slice(1) : `${mot} ${['Aube', 'Sauge', 'Galet', 'Lin', 'Ambre'][i % 5]}`;
  const prix = s.produits.map(p => p[2]).sort((a, b) => a - b)[3];
  const cat = s.categories.find(c => nom.toLowerCase().includes(c.toLowerCase().slice(0, 4))) || s.categories[i % s.categories.length];
  return { nom, categorie: cat, prix, description: redigerDescription(nom, cat) };
}
function redigerDescription(nom, cat) {
  const b = etat.boutique;
  const sec = SECTEURS[b.secteur];
  return `${nom} : une pièce de notre collection ${cat.toLowerCase()}, sélectionnée par ${b.nom}.`;
    // Aucun délai, aucune condition de retour inventés (CGV et fiche) ; pas de texte « à compléter » qui finirait tel quel sous les yeux des clients.
}
/* Photo produit : 1000 px au plus (nette sur un écran de téléphone récent), en WebP si le navigateur sait l'encoder
   (environ 30 % plus léger que le JPEG à qualité égale), sinon JPEG ; qualité réduite par paliers sous 280 Ko. */
function reduireImage(fichier, taille = 1000) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onerror = ko;
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = ko;
      img.onload = () => {
        const r = Math.min(1, taille / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const webp = cv.toDataURL('image/webp', 0.82).startsWith('data:image/webp');
        let q = 0.82, url = cv.toDataURL(webp ? 'image/webp' : 'image/jpeg', q);
        while (url.length > 370000 && q > 0.45) { q -= 0.08; url = cv.toDataURL(webp ? 'image/webp' : 'image/jpeg', q); }
        ok(url);
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}
function messagePhotos(n, refus) {
  const ok = n ? `${n} fiche${n > 1 ? 's' : ''} créée${n > 1 ? 's' : ''} depuis vos photos. Vérifiez le prix puis mettez en ligne.` : '';
  const ko = refus.length ? `${refus.slice(0, 3).join(', ')}${refus.length > 3 ? '…' : ''} : format non lisible. Exportez la photo en JPEG ou PNG (sur iPhone : Réglages > Appareil photo > Formats > Le plus compatible).` : '';
  return [ok, ko].filter(Boolean).join(' ') || 'Aucune photo importée.';
}
async function importerPhotos(fichiers) {
  const liste = [...fichiers].filter(f => f.type.startsWith('image/')).slice(0, 12);
  if (!liste.length) { toast('Choisissez des fichiers image (JPEG, PNG, HEIC converti).'); return; }
  let n = 0; const refus = [];
  for (const [i, f] of liste.entries()) {
    try {
      const image = await reduireImage(f);
      const fiche = ficheDepuisPhoto(f.name, etat.produits.length + i);
      etat.produits.push({ id: nouvelId('p'), ...fiche, stock: 5, teinte: Math.floor(Math.random() * 360), actif: false, image, aVerifier: true });
      n++;
    } catch (e) { refus.push(f.name); }   // HEIC ou fichier abîmé : illisible par le navigateur
  }
  sauver();
  toast(messagePhotos(n, refus));
  rendre();
}

/* ---------- Offre ---------- */
function vueOffre() {
  const ch = estSuisse();
  // Même définition que le serveur et la page de tarifs (js/formules.js).
  const devise = ch ? 'CHF' : 'EUR';
  const plans = Formules.ORDRE.map(id => { const f = Formules.FORMULES[id]; return [f.nom, f.prix, f.resume, f.inclus, id]; });
  return `
  <div class="tete"><div><h1>Offre et tarifs</h1><p class="sous">Un prix fixe, tout compris. Pas d’applications payantes à empiler, pas de commission sur vos ventes (hors frais bancaires du paiement).</p></div></div>
  <div class="plans">${plans.map(([nom, prix, pour, inclus], i) => `
    <section class="plan ${i === 1 ? 'conseille' : ''}">
      ${i === 1 ? '<span class="eyebrow">Conseillé pour démarrer</span>' : '<span class="eyebrow">&nbsp;</span>'}
      <h2>${nom}</h2><p class="sous">${pour}</p>
      <div class="prix"><strong>${devise === 'CHF' ? 'CHF ' + prix + '.–' : prix + ' €'}</strong><span class="sous">par mois</span></div>
      <ul>${inclus.map(x => `<li>${x}</li>`).join('')}</ul>
      ${connecteAuServeur() && SERVEUR.abonnement && SERVEUR.abonnement.formule === Formules.ORDRE[i] ? '<span class="pill ok">Votre formule</span>' : connecteAuServeur() ? `<a class="btn ${i === 1 ? '' : 'fantome'}" href="#parametres" data-action="section-param" data-v="abonnement">Passer à ${nom}</a>` : `<a class="btn ${i === 1 ? '' : 'fantome'}" href="#creer">Créer une boutique de démonstration</a>`}
    </section>`).join('')}</div>
  <section class="carte">
    <div class="carte-tete"><h2>Ce qui nous distingue</h2></div>
    <div class="atouts">
      ${ch ? `<div><strong>Le dropshipping qui tient ses promesses</strong><p class="sous">Fournisseurs en Suisse et en Europe, délais affichés honnêtement, pas de frais de douane surprise pour vos clients.</p></div>
      <div><strong>La vraie marge, avant de vendre</strong><p class="sous">Coût fournisseur, TVA d’import, dédouanement, frais TWINT et carte, publicité : vous savez ce que vous gagnez par vente.</p></div>
      <div><strong>Fait pour la Suisse</strong><p class="sous">CHF, TWINT, La Poste (Economy, Priority, PickPost), Impressum et nLPD.</p></div>` : ''}
      <div><strong>Copilote de saison</strong><p class="sous">Chaque temps fort (Black Friday, Noël, fête des mères, soldes) arrive avec une campagne prête, calculée sur vos ventes et votre stock.</p></div>
      ${ch ? '<div><strong>Conforme en Suisse</strong><p class="sous">Factures numérotées, CGV, Impressum, déclaration nLPD, TVA suisse : générés et tenus à jour.</p></div>' : '<div><strong>Conforme en France</strong><p class="sous">Factures numérotées et facture électronique, CGV, mentions légales, RGPD, TVA : générés et tenus à jour.</p></div>'}
      <div><strong>Boutique et magasin réunis</strong><p class="sous">Une caisse, un stock et le retrait en magasin, sans application supplémentaire.</p></div>
      <div><strong>Un humain au démarrage</strong><p class="sous">30 minutes en visio pour lancer la boutique avec vous. En français.</p></div>
    </div>
  </section>`;
}

/* ---------- Événements propres aux modules ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'campagne': ui.campagne = id; rendre(); break;
    case 'annuler-campagne': {
      const evt = prochainsTempsForts(6).find(x => x.cle === ui.campagne);
      if (!evt || !confirm(`Annuler la campagne ${evt.nom} ? Sa bannière est retirée et son code ne fonctionnera plus.`)) break;
      annulerCampagne(etat, evt.cle); sauver(); toast(`Campagne ${evt.nom} annulée.`); rendre(); break;
    }
    case 'valider-campagne': {
      const evt = prochainsTempsForts(4).find(x => x.cle === ui.campagne);
      const camp = genererCampagne(etat, evt);
      appliquerCampagne(etat, camp); etat.boutique.modifie = false; sauver();
      toast(`Campagne ${evt.nom} programmée : bannière${camp.code ? ` et code ${camp.code}` : ''} du ${new Date(camp.lancement).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${new Date(camp.finCampagne).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}. L’e-mail et la publication sont prêts à copier.`, ['boutique', 'Voir la boutique']);
      rendre(); break;
    }
    case 'mois-domaine': ui.dom.mois = Number(el.dataset.mois); break;
    case 'caisse-ajout': {
      const p = etat.produits.find(x => x.id === id), vid = el.dataset.variante || '';
      const v = vid && Array.isArray(p.variantes) ? p.variantes.find(x => x.id === vid) : null;
      const l = ui.caisse.find(x => x.produitId === id && (x.varianteId || '') === vid);
      if (l) { if (l.qte < (v ? v.stock : p.stock)) l.qte++; }
      else ui.caisse.push(v ? { produitId: id, varianteId: v.id, nom: `${p.nom} (${v.valeurs.join(' / ')})`, prix: typeof v.prix === 'number' ? v.prix : p.prix, qte: 1 } : { produitId: id, nom: p.nom, prix: p.prix, qte: 1 });
      rendre(); break;
    }
    case 'caisse-retire': ui.caisse = ui.caisse.filter(x => !(x.produitId === id && (x.varianteId || '') === (el.dataset.variante || ''))); rendre(); break;
    case 'encaisser': encaisser(el.dataset.moyen); break;
    case 'facture': ui.modal = { type: 'facture', id }; rendreModal(); break;
    case 'avoir': ui.modal = { type: 'avoir', id }; rendreModal(); break;
    case 'etiquette': ui.modal = { type: 'etiquette', id }; rendreModal(); break;
    case 'doc': ui.modal = { type: 'doc', id }; rendreModal(); break;
    case 'rdv': ui.modal = { type: 'rdv' }; rendreModal(); break;
    case 'reserver-rdv':
      etat.rdv = Number(el.dataset.t); sauver(); ui.modal = null; rendreModal();
      toast(`Session réservée le ${dateHeure(etat.rdv)}. Lien de visio envoyé par e-mail (simulé).`); rendre(); break;
    case 'fermer-modal': ui.modal = null; rendreModal(); break;
    case 'photos': $('#photo-input').click(); break;
    case 'rediger': {
      const f = el.closest('form');
      f.elements.description.value = redigerDescription(f.elements.nom.value || 'Ce produit', f.elements.categorie.value);
      break;
    }
    case 'cookies': etat.cookies = el.dataset.choix; sauver(); rendre(); break;
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'photo-input') { importerPhotos(t.files); t.value = ''; }
  else if (t.dataset.magasin) {
    if (t.dataset.magasin === 'clickCollect' && t.checked && !String(etat.magasin.adresse || '').trim()) { t.checked = false; toast('Indiquez d’abord l’adresse du magasin : vos clients doivent savoir où retirer leur commande.'); return; }
    etat.magasin[t.dataset.magasin] = t.type === 'checkbox' ? t.checked : t.value; sauver(); if (t.type === 'checkbox') rendre();
  }
  else if (t.dataset.entreprise) { etat.entreprise[t.dataset.entreprise] = t.value; sauver(); rendre(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.modal) { e.preventDefault(); e.stopImmediatePropagation(); ui.modal = null; rendreModal(); return; }
  // Le focus reste dans la fenêtre ouverte (Tab et Maj+Tab)
  if (e.key === 'Tab' && ui.modal) {
    const f = [...document.querySelectorAll('#modal .modal-corps button, #modal .modal-corps input, #modal .modal-corps textarea, #modal .modal-corps select, #modal .modal-corps a[href]')].filter(x => !x.disabled && x.offsetParent);
    if (!f.length) return;
    const [premier, dernier] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
  }
});

function dessinerQR() {
  const z = document.getElementById('qr');
  if (!z) return;
  z.innerHTML = '';
  const svg = qrSvg(z.dataset.url, { taille: 132, etiquette: `QR code vers ${z.dataset.url}` });
  if (!svg) { z.innerHTML = '<p class="sous">QR indisponible</p>'; return; }
  z.innerHTML = svg; return;
  // Texte alternatif de l'image générée (lecteurs d'écran) ; le canvas de secours est masqué pour eux.
  setTimeout(() => { z.querySelectorAll('img').forEach(i => i.setAttribute('alt', `QR code vers ${z.dataset.url}`)); z.querySelectorAll('canvas').forEach(c => c.setAttribute('aria-hidden', 'true')); z.setAttribute('role', 'img'); z.setAttribute('aria-label', `QR code vers ${z.dataset.url}`); }, 0);
}

/* Caisse : montant reçu en espèces et monnaie à rendre, recalculés à la frappe sans redessiner la vue
   (un rendu complet replaçait le curseur au début du champ : « 100 » devenait « 001 »). */
function texteRendu(du, recu) {
  if (!recu) return '';
  return recu < du ? `<span class="alerte-texte">Il manque ${euros(du - recu)}.</span>` : `À rendre : <strong>${euros(recu - du)}</strong>`;
}
document.addEventListener('input', e => {
  if (!e.target.dataset || e.target.dataset.caisse !== 'recu') return;
  ui.recuCaisse = e.target.value;
  const z = document.getElementById('cs-rendu');
  if (z) z.innerHTML = texteRendu(Number(e.target.dataset.du) || 0, Number(e.target.value) || 0);
});
