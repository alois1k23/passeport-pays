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
          : '<p class="sous">Votre stock couvre la demande prévue.</p>'}
        ${camp.dateLimite ? `<p class="encart">Dropshipping : vos fournisseurs livrent en ${Math.max(...camp.vedettes.filter(x => x.p.delai).map(x => x.p.delai[1]))} jours au plus. Date limite de commande affichée aux clients : <strong>${camp.dateLimite.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</strong>.</p>` : ''}
        ${camp.delaiLong.length ? `<p class="encart alerte-encart">${camp.delaiLong.map(p => esc(p.nom)).join(', ')} : livraison en plus de 10 jours. Retirez-le de la campagne ou passez à un fournisseur européen.</p>` : ''}
      </div>
      <div class="bloc"><h3>Planning</h3><ol class="frise">${camp.planning.map(p => `<li class="${p.passe ? 'passe' : ''}"><span>${esc(p.texte)}</span><time>${p.label}</time></li>`).join('')}</ol></div>
      <div class="rangee">
        <button class="btn" data-action="valider-campagne">${etatCamp ? 'Mettre à jour la campagne' : 'Valider et programmer'}</button>
        <a class="btn fantome" href="#editeur">Voir la bannière dans l’éditeur</a>
      </div>
    </section>

    <div class="pile">
      <section class="carte">
        <div class="carte-tete"><h2>Contenus rédigés</h2><span class="sous">Modifiables avant envoi</span></div>
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
  const url = 'https://' + (etat.boutique.domaine ? etat.boutique.domaine.domaine : slugifier(etat.boutique.nom) + '.comptoir.shop');
  const retraits = etat.commandes.filter(c => c.livraison === 'retrait' && c.canal === 'web' && ['payee', 'preparation', 'prete'].includes(c.statut)).sort((a, b) => a.date - b.date);
  const ventesMag = etat.commandes.filter(c => c.canal === 'magasin' && c.date > Date.now() - 30 * 86400000);
  const totalCaisse = ui.caisse.reduce((a, l) => a + l.prix * l.qte, 0);
  const visibles = etat.produits.filter(p => p.actif && p.stock > 0).length;
  return `
  <div class="tete"><div><h1>Magasin et caisse</h1><p class="sous">Boutique physique et site partagent le même stock. ${ventesMag.length} ventes en boutique sur 30 jours (${euros(ventesMag.reduce((a, c) => a + c.total, 0))}).</p></div></div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Caisse</h2><span class="sous">Encaissez une vente au comptoir : le stock du site est mis à jour</span></div>
      <div class="caisse-produits">${etat.produits.filter(p => p.actif && p.type !== 'drop').length ? '' : '<p class="sous">La caisse sert aux produits que vous avez en stock (marchés, pop-up, boutique). Ajoutez-en un dans Produits.</p>'}${etat.produits.filter(p => p.actif && p.type !== 'drop').map(p => `
        <button class="caisse-btn" data-action="caisse-ajout" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>${visuelProduit(p)}<span>${esc(p.nom)}</span><b class="num">${euros(p.prix)}</b><small>${p.stock} en stock</small></button>`).join('')}</div>
      <div class="ticket">
        <div class="ticket-tete"><strong>Ticket</strong><span class="sous">${ui.caisse.reduce((a, l) => a + l.qte, 0)} article${ui.caisse.reduce((a, l) => a + l.qte, 0) > 1 ? 's' : ''}</span></div>
        ${ui.caisse.length ? `<table class="table compacte"><tbody>${ui.caisse.map(l => `<tr><td class="num">${l.qte} ×</td><td>${esc(l.nom)}</td><td class="num">${euros(l.prix * l.qte)}</td><td class="num"><button class="icone" data-action="caisse-retire" data-id="${l.produitId}" aria-label="Retirer ${esc(l.nom)}">×</button></td></tr>`).join('')}</tbody></table>`
          : '<p class="sous ticket-vide">Touchez un produit pour l’ajouter au ticket.</p>'}
        <div class="ticket-total"><span>Total TTC</span><strong>${euros(totalCaisse)}</strong></div>
        ${estSuisse() && ui.caisse.length && Math.round(totalCaisse * 20) / 20 !== Math.round(totalCaisse * 100) / 100 ? `<p class="sous">En espèces : ${euros(Math.round(totalCaisse * 20) / 20)} (arrondi aux 5 centimes).</p>` : ''}
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
        <label class="case"><input id="mg-cc" type="checkbox" data-magasin="clickCollect" ${m.clickCollect ? 'checked' : ''}> Proposer le retrait en boutique</label>
        <label class="case"><input id="mg-g" type="checkbox" data-magasin="googleSync" ${m.googleSync ? 'checked' : ''}> Synchroniser la fiche Google (horaires et stock)</label>
        ${m.googleSync ? `<p class="sous"><span class="pill good">Synchronisée</span> ${visibles} produits en stock visibles sur Google (simulé)</p>` : ''}
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
    client: { nom: 'Client en boutique', email: '', ville: etat.magasin.adresse.split(',').pop().trim() || '' },
    lignes: ui.caisse.map(l => ({ ...l })), sousTotal: total, port: 0, total: Math.round(total * 100) / 100,
    statut: 'retiree', livraison: 'retrait', canal: 'magasin', moyen: ['especes', 'twint', 'carte'].includes(moyen) ? moyen : 'carte', suivi: '', note: '', tauxTva: tauxTvaVente(),
    historique: [{ date: now, texte: `Vente encaissée en boutique (${moyen === 'especes' ? 'espèces' : moyen === 'twint' ? 'TWINT' : 'carte'})` }]
  };
  c.facture = numeroFactureSuivant(etat, now);
  etat.commandes.push(c);
  for (const l of ui.caisse) { const p = etat.produits.find(x => x.id === l.produitId); if (p) p.stock = Math.max(0, p.stock - l.qte); }
  ui.caisse = [];
  sauver();
  toast(`Vente de ${euros(total)} encaissée. Ticket ${c.facture}, stock du site mis à jour.`);
  rendre();
}

/* ---------- Conformité française ---------- */
function tva(c) {
  // Taux figé au moment de la vente : une facture émise ne change pas si le régime de TVA change ensuite.
  const taux = typeof c.tauxTva === 'number' ? c.tauxTva : tauxTvaVente();
  const franchise = taux === 0;
  const ttc = c.total, ht = franchise ? ttc : Math.round(ttc / (1 + taux) * 100) / 100;
  return { ht, tva: Math.round((ttc - ht) * 100) / 100, ttc, franchise, taux };
}

const COMPLETER = { Impressum: 'en-adresse', 'Mentions légales': 'en-siret', 'Médiateur de la consommation': 'en-med', 'Transparence dropshipping': '' };
function vueConformite() {
  const e = etat.entreprise;
  const factures = etat.commandes.filter(c => c.facture).sort((a, b) => b.date - a.date);
  const ch = estSuisse();
  const verifs = ch ? [
    ['Impressum', !!(e.raison && e.adresse && e.email && !/compléter/.test(e.adresse)), 'Nom, adresse postale et e-mail affichés (obligatoire en Suisse pour la vente en ligne, LCD art. 3)', 'Indiquez votre adresse postale complète : obligatoire pour vendre en ligne', 'mentions'],
    ['Conditions générales de vente', true, 'Générées : livraison, retours volontaires 30 jours, garantie 2 ans', '', 'cgv'],
    ['Protection des données (nLPD)', true, 'Déclaration de confidentialité générée, fournisseurs et pays de destination des données listés', '', 'mentions'],
    ['Transparence dropshipping', etat.produits.filter(p => p.type === 'drop').every(p => p.delai), 'Délais réels de chaque fournisseur affichés sur les fiches et au paiement', 'Indiquez les délais de livraison de chaque fournisseur', null],
    ['Prix en CHF, TTC', true, 'Prix affichés en francs suisses, frais de livraison indiqués avant le paiement', '', null],
    ['TVA', true, e.regime === 'ch-assujetti' ? 'Assujetti : TVA 8,1 % détaillée sur chaque facture' : `Non assujetti (chiffre d’affaires sous ${euros(100000)} par an). Comptoir vous prévient à l’approche du seuil.`, '', null]
  ] : [
    ['Mentions légales', !!(e.raison && e.siret && e.adresse), 'Générées à partir de la fiche entreprise', `Renseignez la raison sociale, le ${droitPays().idCourt} et l’adresse`, 'mentions'],
    ['Conditions générales de vente', true, 'Générées et tenues à jour (livraison, retours, rétractation 14 jours)', '', 'cgv'],
    ['Bandeau cookies (RGPD)', true, 'Accepter et Refuser au même niveau, mesure d’audience sans cookie par défaut', '', null],
    ['Médiateur de la consommation', !!e.mediateur, 'Indiqué dans les CGV', 'Obligatoire pour vendre aux particuliers : indiquez votre médiateur', null],
    ['TVA', true, e.regime === 'franchise' ? `${droitPays().franchiseNom} : « ${droitPays().franchise} » sur les factures` : `TVA à ${droitPays().tvaTexte} détaillée sur chaque facture`, '', null],
    ['Facture électronique', true, 'Factures numérotées sans rupture, export Factur-X prêt pour la réforme (simulé)', '', null]
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
      <label class="champ"><span>Adresse</span><input id="en-adresse" value="${esc(e.adresse)}" data-entreprise="adresse"></label>
      <div class="deux"><label class="champ"><span>Régime de TVA</span><select id="en-regime" data-entreprise="regime">${(ch ? [['ch-non', 'Non assujetti'], ['ch-assujetti', 'Assujetti (8,1 %)']] : [['franchise', droitPays().franchiseNom], ['normal', `Assujetti (${droitPays().tvaTexte})`]]).map(([v, n]) => `<option value="${v}" ${e.regime === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="champ"><span>${ch ? 'Numéro TVA' : 'Numéro de TVA'}</span><input id="en-tva" value="${esc(e.tvaIntra)}" data-entreprise="tvaIntra" placeholder="${ch ? 'CHE-123.456.789 TVA' : droitPays().tvaExemple}"></label></div>
      <label class="champ"><span>E-mail de contact</span><input id="en-email" value="${esc(e.email)}" data-entreprise="email"></label>
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
    <p><strong>Données personnelles (nLPD)</strong> : nous traitons vos données pour exécuter votre commande. Elles sont transmises au prestataire de paiement, à La Poste et, pour les articles expédiés par nos partenaires, aux fournisseurs suivants : ${fournisseurs.length ? fournisseurs.map(esc).join(', ') : 'aucun'}. Certains se trouvent dans l’Union européenne, qui offre une protection adéquate des données. Vous pouvez demander l’accès, la rectification ou l’effacement de vos données à ${esc(e.email || 'l’adresse de contact')}.</p>
    <p><strong>Hébergement</strong> : Comptoir, en Suisse et dans l’Union européenne.</p>`;
  }
  return `<h2>Mentions légales</h2>
  <p><strong>Éditeur du site</strong> : ${esc(e.raison)}, ${esc(e.forme)}, ${droitPays().idCourt} ${esc(e.siret || '[à compléter]')}, ${esc(e.adresse || '[adresse à compléter]')}. Contact : ${esc(e.email || '[e-mail]')}.</p>
  ${e.tvaIntra ? `<p>N° de TVA intracommunautaire : ${esc(e.tvaIntra)}.</p>` : ''}
  <p><strong>Directeur de la publication</strong> : le représentant légal de ${esc(e.raison)}.</p>
  <p><strong>Hébergement</strong> : Comptoir (plateforme), hébergement en Union européenne.</p>
  <p><strong>Données personnelles</strong> : les données collectées servent uniquement au traitement des commandes de ${esc(b.nom)}. Vous disposez d’un droit d’accès, de rectification et de suppression en écrivant à ${esc(e.email || 'l’adresse de contact')}.</p>`;
}
function texteCGV() {
  const e = etat.entreprise, b = etat.boutique;
  const modes = Object.values(livraisonsPays(b.pays)).filter(l => l.transporteur || etat.magasin.clickCollect);
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
  if (m.type === 'facture') {
    const c = etat.commandes.find(x => x.id === m.id);
    const e = etat.entreprise, t = tva(c);
    corps = `<article class="facture">
      <header><div><strong class="f-nom">${esc(e.raison)}</strong><div>${esc(e.forme)} · ${estSuisse() ? 'IDE' : droitPays().idCourt} ${esc(e.siret || '—')}</div>${e.tvaIntra ? `<div>${esc(e.tvaIntra)}</div>` : ''}<div>${esc(e.adresse)}</div></div>
        <div class="f-num"><span class="eyebrow">Facture</span><div class="mono">${c.facture}</div><div>${new Date(c.date).toLocaleDateString('fr-FR')}</div></div></header>
      <div class="f-client"><span class="sous">Facturé à</span><div>${esc(c.client.nom)}</div><div class="sous">${esc(c.client.email)} ${esc(c.client.ville)}</div><div class="sous">Commande #${c.numero} · ${c.canal === 'magasin' ? 'vente en boutique' : TOUTES_LIVRAISONS[c.livraison].nom}</div></div>
      <table class="table compacte"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU TTC</th><th class="num">Total TTC</th></tr></thead><tbody>
        ${c.lignes.map(l => `<tr><td>${esc(l.nom)}</td><td class="num">${l.qte}</td><td class="num">${euros(l.prix)}</td><td class="num">${euros(l.prix * l.qte)}</td></tr>`).join('')}
        ${c.port ? `<tr><td>Livraison</td><td class="num">1</td><td class="num">${euros(c.port)}</td><td class="num">${euros(c.port)}</td></tr>` : ''}
      </tbody></table>
      <div class="f-totaux"><div><span>Total HT</span><span>${euros(t.ht)}</span></div><div><span>TVA ${t.franchise ? '' : (Math.round(t.taux * 1000) / 10).toString().replace('.', ',') + ' %'}</span><span>${euros(t.tva)}</span></div><div class="total"><span>Total TTC</span><span>${euros(t.ttc)}</span></div></div>
      <footer>${estSuisse() ? (t.franchise ? 'Entreprise non assujettie à la TVA. ' : '') + 'Paiement reçu. Merci pour votre achat.' : (t.franchise ? droitPays().franchise + '. ' : '') + 'Paiement reçu.' + (droitPays().recouvrement ? ' Pas d’escompte pour paiement anticipé. En cas de retard de paiement, indemnité forfaitaire de 40 € pour frais de recouvrement (professionnels).' : '')}</footer>
    </article>
    ${estSuisse() ? '<div class="rangee"><span class="pill good">Export comptable prêt (simulé)</span><span class="sous">Factures numérotées, exportables pour votre fiduciaire.</span></div>' : '<div class="rangee"><span class="pill good">Factur-X prêt (simulé)</span><span class="sous">PDF lisible + données XML, conforme à la réforme de la facture électronique.</span></div>'}`;
  } else if (m.type === 'etiquette') {
    const c = etat.commandes.find(x => x.id === m.id);
    const l = TOUTES_LIVRAISONS[c.livraison];
    corps = `<article class="etiquette">
      <div class="et-tete"><strong>${esc(l.transporteur)}</strong><span>${esc(l.court)}</span></div>
      <div><span class="sous">Expéditeur</span><div>${esc(etat.entreprise.raison)}</div><div>${esc(etat.entreprise.adresse)}</div></div>
      <div class="et-dest"><span class="sous">Destinataire</span><div><strong>${esc(c.client.nom)}</strong></div><div>${esc(c.client.ville)}</div></div>
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
  return `${nom} : une pièce de notre collection ${cat.toLowerCase()}, sélectionnée par ${b.nom}. ` +
    `Pensé pour durer et pour se glisser naturellement chez vous. Expédié sous 48 h, retours gratuits 30 jours. ` +
    `Idéal en ${sec.kws.find(k => k[0] === 'cadeau') ? 'cadeau' : 'idée cadeau'} pour ${saisonDuMois(new Date().getMonth()).nom.toLowerCase()}.`;
}
function reduireImage(fichier, taille = 480) {
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
        ok(cv.toDataURL('image/jpeg', 0.78));
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}
async function importerPhotos(fichiers) {
  const liste = [...fichiers].filter(f => f.type.startsWith('image/')).slice(0, 12);
  if (!liste.length) { toast('Choisissez des fichiers image (JPEG, PNG, HEIC converti).'); return; }
  let n = 0;
  for (const [i, f] of liste.entries()) {
    try {
      const image = await reduireImage(f);
      const fiche = ficheDepuisPhoto(f.name, etat.produits.length + i);
      etat.produits.push({ id: nouvelId('p'), ...fiche, stock: 5, teinte: Math.floor(Math.random() * 360), actif: false, image, aVerifier: true });
      n++;
    } catch (e) { /* image illisible : ignorée */ }
  }
  sauver();
  toast(`${n} fiche${n > 1 ? 's' : ''} créée${n > 1 ? 's' : ''} depuis vos photos. Vérifiez le prix puis mettez en ligne.`);
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
      ${i === 1 ? '<span class="eyebrow">Le plus choisi</span>' : '<span class="eyebrow">&nbsp;</span>'}
      <h2>${nom}</h2><p class="sous">${pour}</p>
      <div class="prix"><strong>${devise === 'CHF' ? 'CHF ' + prix + '.–' : prix + ' €'}</strong><span class="sous">${ch ? 'par mois' : 'HT / mois'}</span></div>
      <ul>${inclus.map(x => `<li>${x}</li>`).join('')}</ul>
      ${connecteAuServeur() ? `<a class="btn ${i === 1 ? '' : 'fantome'}" href="#parametres" data-action="section-param" data-v="abonnement">Choisir ${nom}</a>` : `<a class="btn ${i === 1 ? '' : 'fantome'}" href="#creer">Essayer 30 jours</a>`}
    </section>`).join('')}</div>
  <section class="carte">
    <div class="carte-tete"><h2>Ce qui nous distingue</h2></div>
    <div class="atouts">
      ${ch ? `<div><strong>Le dropshipping qui tient ses promesses</strong><p class="sous">Fournisseurs en Suisse et en Europe, délais affichés honnêtement, pas de frais de douane surprise pour vos clients.</p></div>
      <div><strong>La vraie marge, avant de vendre</strong><p class="sous">Coût fournisseur, TVA d’import, dédouanement, frais TWINT et carte, publicité : vous savez ce que vous gagnez par vente.</p></div>
      <div><strong>Fait pour la Suisse</strong><p class="sous">CHF, TWINT, La Poste (Economy, Priority, PickPost), Impressum et nLPD.</p></div>` : ''}
      <div><strong>Copilote de saison</strong><p class="sous">Chaque temps fort (Black Friday, Noël, fête des mères, soldes) arrive avec une campagne prête, calculée sur vos ventes et votre stock.</p></div>
      ${ch ? '<div><strong>Conforme en Suisse</strong><p class="sous">Factures numérotées, CGV, Impressum, déclaration nLPD, TVA suisse : générés et tenus à jour.</p></div>' : '<div><strong>Conforme en France</strong><p class="sous">Factures numérotées et facture électronique, CGV, mentions légales, RGPD, TVA : générés et tenus à jour.</p></div>'}
      <div><strong>Boutique et magasin réunis</strong><p class="sous">Une caisse, un stock, le retrait en magasin et la fiche Google, sans application supplémentaire.</p></div>
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
    case 'valider-campagne': {
      const evt = prochainsTempsForts(4).find(x => x.cle === ui.campagne);
      const camp = genererCampagne(etat, evt);
      appliquerCampagne(etat, camp); etat.boutique.modifie = false; sauver();
      toast(`Campagne ${evt.nom} programmée : bannière, code ${camp.code || 'cadeau'}, e-mail et publication planifiés.`, ['boutique', 'Voir la boutique']);
      rendre(); break;
    }
    case 'mois-domaine': ui.dom.mois = Number(el.dataset.mois); break;
    case 'caisse-ajout': {
      const p = etat.produits.find(x => x.id === id);
      const l = ui.caisse.find(x => x.produitId === id);
      if (l) { if (l.qte < p.stock) l.qte++; } else ui.caisse.push({ produitId: id, nom: p.nom, prix: p.prix, qte: 1 });
      rendre(); break;
    }
    case 'caisse-retire': ui.caisse = ui.caisse.filter(x => x.produitId !== id); rendre(); break;
    case 'encaisser': encaisser(el.dataset.moyen); break;
    case 'facture': ui.modal = { type: 'facture', id }; rendreModal(); break;
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
  else if (t.dataset.magasin) { etat.magasin[t.dataset.magasin] = t.type === 'checkbox' ? t.checked : t.value; sauver(); if (t.type === 'checkbox') rendre(); }
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
  if (typeof QRCode === 'undefined') { z.innerHTML = '<p class="sous">QR indisponible hors ligne</p>'; return; }
  new QRCode(z, { text: z.dataset.url, width: 132, height: 132, colorDark: '#151821', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
  // Texte alternatif de l'image générée (lecteurs d'écran) ; le canvas de secours est masqué pour eux.
  setTimeout(() => { z.querySelectorAll('img').forEach(i => i.setAttribute('alt', `QR code vers ${z.dataset.url}`)); z.querySelectorAll('canvas').forEach(c => c.setAttribute('aria-hidden', 'true')); z.setAttribute('role', 'img'); z.setAttribute('aria-label', `QR code vers ${z.dataset.url}`); }, 0);
}
