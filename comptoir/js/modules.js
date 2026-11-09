/* Comptoir — modules qui font la différence :
   copilote de saison, magasin & click & collect, conformité française
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
      <span class="mono">${e.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
      <strong>${esc(e.nom)}</strong>
      <span class="sous">dans ${jours(e.date)} j</span>
      ${st ? '<span class="pill good">Programmée</span>' : '<span class="pill warn">À valider</span>'}</button>`;
  }).join('')}</div>

  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><div><span class="eyebrow">Campagne prête · ${esc(camp.dateTxt)}</span><h2 class="titre-campagne">${esc(choisi.nom)}</h2></div>
        ${etatCamp ? `<span class="pill good">Programmée le ${dateCourte(etatCamp.le)}</span>` : ''}</div>
      <div class="chiffres">
        <div><span class="sous">CA prévu</span><strong>${euros(camp.caPrevu)}</strong></div>
        <div><span class="sous">Offre</span><strong>${choisi.remise ? '-' + choisi.remise + ' %' : 'Cadeau'}</strong></div>
        <div><span class="sous">Durée</span><strong>${choisi.duree} j</strong></div>
      </div>
      <div class="bloc"><h3>Produits mis en avant</h3>
        <table class="table compacte"><tbody>${camp.vedettes.map(x => `<tr><td class="vignette">${visuelProduit(x.p)}</td><td>${esc(x.p.nom)}<div class="sous">${x.ventes90} ventes sur 90 j</div></td><td class="num">${euros(x.p.prix)}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="bloc"><h3>Stock face à la demande prévue</h3>
        ${camp.ruptures.length ? `<ul class="todo">${camp.ruptures.map(x => `<li class="alerte"><a href="#produits"><strong>+${x.manque}</strong> ${esc(x.p.nom)} à commander : ${x.prevision} ventes prévues, ${x.p.stock} en stock</a></li>`).join('')}</ul>`
          : '<p class="sous">Votre stock couvre la demande prévue.</p>'}
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

/* ---------- Magasin, caisse et click & collect ---------- */
function vueMagasin() {
  const m = etat.magasin;
  const url = 'https://' + (etat.boutique.domaine ? etat.boutique.domaine.domaine : slugifier(etat.boutique.nom) + '.comptoir.shop');
  const retraits = etat.commandes.filter(c => c.livraison === 'retrait' && c.canal === 'web' && ['payee', 'preparation', 'prete'].includes(c.statut)).sort((a, b) => a.date - b.date);
  const ventesMag = etat.commandes.filter(c => c.canal === 'magasin' && c.date > Date.now() - 30 * 86400000);
  const totalCaisse = ui.caisse.reduce((a, l) => a + l.prix * l.qte, 0);
  const visibles = etat.produits.filter(p => p.actif && p.stock > 0).length;
  return `
  <div class="tete"><div><h1>Magasin</h1><p class="sous">Boutique physique et site partagent le même stock. ${ventesMag.length} ventes en boutique sur 30 jours (${euros(ventesMag.reduce((a, c) => a + c.total, 0))}).</p></div></div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Caisse</h2><span class="sous">Encaissez une vente au comptoir : le stock du site est mis à jour</span></div>
      <div class="caisse-produits">${etat.produits.filter(p => p.actif).map(p => `
        <button class="caisse-btn" data-action="caisse-ajout" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>${visuelProduit(p)}<span>${esc(p.nom)}</span><b class="num">${euros(p.prix)}</b><small>${p.stock} en stock</small></button>`).join('')}</div>
      <div class="ticket">
        ${ui.caisse.length ? `<table class="table compacte"><tbody>${ui.caisse.map(l => `<tr><td>${l.qte} ×</td><td>${esc(l.nom)}</td><td class="num">${euros(l.prix * l.qte)}</td><td><button class="icone" data-action="caisse-retire" data-id="${l.produitId}" aria-label="Retirer">×</button></td></tr>`).join('')}
          <tr class="total"><td></td><td>Total TTC</td><td class="num">${euros(totalCaisse)}</td><td></td></tr></tbody></table>
          <div class="rangee"><button class="btn" data-action="encaisser" data-moyen="carte">Encaisser par carte</button><button class="btn fantome" data-action="encaisser" data-moyen="especes">Espèces</button></div>`
          : '<p class="sous">Touchez un produit pour l’ajouter au ticket.</p>'}
      </div>
    </section>
    <div class="pile">
      <section class="carte">
        <div class="carte-tete"><h2>Retraits click & collect</h2><span class="sous">${retraits.length} en cours</span></div>
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
        <label class="case"><input id="mg-cc" type="checkbox" data-magasin="clickCollect" ${m.clickCollect ? 'checked' : ''}> Proposer le retrait en boutique (click & collect)</label>
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
    statut: 'retiree', livraison: 'retrait', canal: 'magasin', suivi: '', note: '',
    historique: [{ date: now, texte: `Vente encaissée en boutique (${moyen === 'carte' ? 'carte' : 'espèces'})` }]
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
  const franchise = etat.entreprise.regime === 'franchise';
  const ttc = c.total, ht = franchise ? ttc : Math.round(ttc / 1.2 * 100) / 100;
  return { ht, tva: Math.round((ttc - ht) * 100) / 100, ttc, franchise };
}

function vueConformite() {
  const e = etat.entreprise;
  const factures = etat.commandes.filter(c => c.facture).sort((a, b) => b.date - a.date);
  const verifs = [
    ['Mentions légales', !!(e.raison && e.siret && e.adresse), 'Générées à partir de la fiche entreprise', 'Renseignez la raison sociale, le SIRET et l’adresse', 'mentions'],
    ['Conditions générales de vente', true, 'Générées et tenues à jour (livraison, retours, rétractation 14 jours)', '', 'cgv'],
    ['Bandeau cookies (RGPD)', true, 'Accepter et Refuser au même niveau, mesure d’audience sans cookie par défaut', '', null],
    ['Médiateur de la consommation', !!e.mediateur, 'Indiqué dans les CGV', 'Obligatoire pour vendre aux particuliers : indiquez votre médiateur', null],
    ['TVA', true, e.regime === 'franchise' ? 'Franchise en base : « TVA non applicable, art. 293 B du CGI » sur les factures' : 'TVA à 20 % détaillée sur chaque facture', '', null],
    ['Facture électronique', true, 'Factures numérotées sans rupture, export Factur-X prêt pour la réforme (simulé)', '', null]
  ];
  return `
  <div class="tete"><div><h1>Conformité</h1><p class="sous">Factures, mentions obligatoires et RGPD gérés pour vous. Vous vendez, Comptoir s’occupe de la paperasse.</p></div></div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Points de contrôle</h2><span class="sous">${verifs.filter(v => v[1]).length} / ${verifs.length} en règle</span></div>
      <ul class="controles">${verifs.map(([nom, ok, oui, non, doc]) => `<li>
        <span class="pill ${ok ? 'good' : 'warn'}">${ok ? 'En règle' : 'À compléter'}</span>
        <div><strong>${nom}</strong><div class="sous">${ok ? oui : non}</div></div>
        ${doc ? `<button class="btn petit fantome" data-action="doc" data-id="${doc}">Lire</button>` : ''}</li>`).join('')}</ul>
    </section>
    <section class="carte">
      <div class="carte-tete"><h2>Fiche entreprise</h2><span class="sous">Utilisée sur les factures et documents</span></div>
      <label class="champ"><span>Raison sociale</span><input id="en-raison" value="${esc(e.raison)}" data-entreprise="raison"></label>
      <div class="deux"><label class="champ"><span>Forme juridique</span><select id="en-forme" data-entreprise="forme">${['Micro-entreprise', 'EI', 'EURL', 'SASU', 'SARL', 'SAS'].map(f => `<option ${f === e.forme ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="champ"><span>SIRET</span><input id="en-siret" value="${esc(e.siret)}" data-entreprise="siret"></label></div>
      <label class="champ"><span>Adresse</span><input id="en-adresse" value="${esc(e.adresse)}" data-entreprise="adresse"></label>
      <div class="deux"><label class="champ"><span>Régime de TVA</span><select id="en-regime" data-entreprise="regime"><option value="franchise" ${e.regime === 'franchise' ? 'selected' : ''}>Franchise en base</option><option value="normal" ${e.regime === 'normal' ? 'selected' : ''}>Assujetti (20 %)</option></select></label>
      <label class="champ"><span>N° TVA intracom.</span><input id="en-tva" value="${esc(e.tvaIntra)}" data-entreprise="tvaIntra" placeholder="FR…"></label></div>
      <label class="champ"><span>Médiateur de la consommation</span><input id="en-med" value="${esc(e.mediateur)}" data-entreprise="mediateur" placeholder="Nom et site du médiateur"></label>
    </section>
  </div>
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>Factures</h2><span class="sous">${factures.length} factures, numérotation continue</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>N° facture</th><th>Date</th><th>Client</th><th>Canal</th><th class="num">HT</th><th class="num">TVA</th><th class="num">TTC</th><th></th></tr></thead>
    <tbody>${factures.slice(0, 40).map(c => { const t = tva(c); return `<tr><td class="mono">${c.facture}</td><td>${dateCourte(c.date)}</td><td>${esc(c.client.nom)}</td><td>${c.canal === 'magasin' ? 'Boutique' : 'En ligne'}</td>
      <td class="num">${euros(t.ht)}</td><td class="num">${t.franchise ? '—' : euros(t.tva)}</td><td class="num">${euros(t.ttc)}</td><td><button class="btn petit fantome" data-action="facture" data-id="${c.id}">Voir</button></td></tr>`; }).join('')}</tbody></table></div>
  </section>`;
}

function texteMentions() {
  const e = etat.entreprise, b = etat.boutique;
  return `<h2>Mentions légales</h2>
  <p><strong>Éditeur du site</strong> : ${esc(e.raison)}, ${esc(e.forme)}, SIRET ${esc(e.siret || '[à compléter]')}, ${esc(e.adresse || '[adresse à compléter]')}. Contact : ${esc(e.email || '[e-mail]')}.</p>
  ${e.tvaIntra ? `<p>N° de TVA intracommunautaire : ${esc(e.tvaIntra)}.</p>` : ''}
  <p><strong>Directeur de la publication</strong> : le représentant légal de ${esc(e.raison)}.</p>
  <p><strong>Hébergement</strong> : Comptoir (plateforme), hébergement en Union européenne.</p>
  <p><strong>Données personnelles</strong> : les données collectées servent uniquement au traitement des commandes de ${esc(b.nom)}. Vous disposez d’un droit d’accès, de rectification et de suppression en écrivant à ${esc(e.email || 'l’adresse de contact')}.</p>`;
}
function texteCGV() {
  const e = etat.entreprise, b = etat.boutique;
  const modes = Object.values(LIVRAISONS).filter(l => l.transporteur || etat.magasin.clickCollect);
  return `<h2>Conditions générales de vente</h2>
  <p><strong>1. Objet.</strong> Les présentes conditions régissent les ventes conclues sur le site de ${esc(b.nom)}, exploité par ${esc(e.raison)} (SIRET ${esc(e.siret || '[à compléter]')}).</p>
  <p><strong>2. Prix.</strong> Les prix sont indiqués en euros, toutes taxes comprises${e.regime === 'franchise' ? ' (TVA non applicable, art. 293 B du CGI)' : ''}.</p>
  <p><strong>3. Livraison.</strong> ${modes.map(l => `${l.nom} : ${l.prix ? euros(l.prix) : 'gratuit'}, ${l.delai}`).join(' ; ')}. Livraison offerte dès ${SEUIL_PORT_OFFERT} € d’achat (hors express).</p>
  <p><strong>4. Droit de rétractation.</strong> Vous disposez de 14 jours à compter de la réception pour vous rétracter, sans avoir à vous justifier (art. L221-18 du Code de la consommation). Le remboursement intervient sous 14 jours.</p>
  <p><strong>5. Garanties.</strong> Les produits bénéficient de la garantie légale de conformité (2 ans) et de la garantie des vices cachés.</p>
  <p><strong>6. Médiation.</strong> En cas de litige, vous pouvez recourir gratuitement au médiateur de la consommation : ${esc(e.mediateur || '[médiateur à renseigner]')}.</p>`;
}

/* ---------- Fenêtres (factures, étiquettes, documents légaux, accompagnement) ---------- */
function rendreModal() {
  const zone = $('#modal');
  const m = ui.modal;
  if (!m) { zone.hidden = true; zone.innerHTML = ''; return; }
  let corps = '';
  if (m.type === 'facture') {
    const c = etat.commandes.find(x => x.id === m.id);
    const e = etat.entreprise, t = tva(c);
    corps = `<article class="facture">
      <header><div><strong class="f-nom">${esc(e.raison)}</strong><div>${esc(e.forme)} · SIRET ${esc(e.siret || '—')}</div><div>${esc(e.adresse)}</div></div>
        <div class="f-num"><span class="eyebrow">Facture</span><div class="mono">${c.facture}</div><div>${new Date(c.date).toLocaleDateString('fr-FR')}</div></div></header>
      <div class="f-client"><span class="sous">Facturé à</span><div>${esc(c.client.nom)}</div><div class="sous">${esc(c.client.email)} ${esc(c.client.ville)}</div><div class="sous">Commande #${c.numero} · ${c.canal === 'magasin' ? 'vente en boutique' : LIVRAISONS[c.livraison].nom}</div></div>
      <table class="table compacte"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU TTC</th><th class="num">Total TTC</th></tr></thead><tbody>
        ${c.lignes.map(l => `<tr><td>${esc(l.nom)}</td><td class="num">${l.qte}</td><td class="num">${euros(l.prix)}</td><td class="num">${euros(l.prix * l.qte)}</td></tr>`).join('')}
        ${c.port ? `<tr><td>Livraison</td><td class="num">1</td><td class="num">${euros(c.port)}</td><td class="num">${euros(c.port)}</td></tr>` : ''}
      </tbody></table>
      <div class="f-totaux"><div><span>Total HT</span><span>${euros(t.ht)}</span></div><div><span>TVA ${t.franchise ? '' : '20 %'}</span><span>${t.franchise ? '0,00 €' : euros(t.tva)}</span></div><div class="total"><span>Total TTC</span><span>${euros(t.ttc)}</span></div></div>
      <footer>${t.franchise ? 'TVA non applicable, art. 293 B du CGI. ' : ''}Paiement reçu. Pas d’escompte pour paiement anticipé. En cas de retard de paiement, indemnité forfaitaire de 40 € pour frais de recouvrement (professionnels).</footer>
    </article>
    <div class="rangee"><span class="pill good">Factur-X prêt (simulé)</span><span class="sous">PDF lisible + données XML, conforme à la réforme de la facture électronique.</span></div>`;
  } else if (m.type === 'etiquette') {
    const c = etat.commandes.find(x => x.id === m.id);
    const l = LIVRAISONS[c.livraison];
    corps = `<article class="etiquette">
      <div class="et-tete"><strong>${esc(l.transporteur)}</strong><span>${esc(l.court)}</span></div>
      <div><span class="sous">Expéditeur</span><div>${esc(etat.entreprise.raison)}</div><div>${esc(etat.entreprise.adresse)}</div></div>
      <div class="et-dest"><span class="sous">Destinataire</span><div><strong>${esc(c.client.nom)}</strong></div><div>${esc(c.client.ville)}</div></div>
      <div class="code-barre" aria-hidden="true">${Array.from(c.suivi || 'X').map((ch, i) => `<i style="width:${1 + (ch.charCodeAt(0) + i) % 4}px"></i>`).join('')}</div>
      <div class="mono et-suivi">${esc(c.suivi)}</div>
    </article><p class="sous">Étiquette générée via l’API ${esc(l.transporteur)} (simulée). Poids estimé : ${(c.lignes.reduce((a, x) => a + x.qte, 0) * 0.45).toFixed(1).replace('.', ',')} kg.</p>`;
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
  zone.innerHTML = `<div class="modal-fond" data-action="fermer-modal"></div><div class="modal-corps" role="dialog" aria-modal="true"><button class="icone modal-x" data-action="fermer-modal">Fermer</button>${corps}</div>`;
  zone.hidden = false;
}

/* ---------- Ajout de produits par photo ---------- */
const MOTS_PRODUITS = {
  deco: ['Bougie', 'Vase', 'Diffuseur', 'Coupelle', 'Plaid'], mode: ['Pull', 'Chemise', 'Robe', 'Écharpe', 'Sac'],
  beaute: ['Sérum', 'Savon', 'Baume', 'Huile', 'Crème'], epicerie: ['Thé', 'Confiture', 'Miel', 'Biscuits', 'Coffret'],
  sport: ['Gourde', 'Tapis', 'T-shirt', 'Sac', 'Bandeau'], bijoux: ['Collier', 'Bague', 'Bracelet', 'Boucles', 'Pendentif']
};
function ficheDepuisPhoto(nomFichier, i) {
  const sec = etat.boutique.secteur;
  const s = SECTEURS[sec];
  const brut = nomFichier.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\b(img|dsc|photo|image|pxl)\b\s*\d*/gi, '').replace(/\d{3,}/g, '').trim();
  const mot = MOTS_PRODUITS[sec][i % 5];
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
    `Idéal en ${sec.kws.find(k => k[0] === 'cadeau') ? 'cadeau' : 'idée cadeau'} pour ${SAISONS[new Date().getMonth()].nom.toLowerCase()}.`;
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
  const plans = [
    ['Atelier', 19, 'Pour démarrer', ['Boutique complète et éditeur', 'Domaine .fr offert la 1re année', 'Copilote de saison', 'Factures et CGV conformes', 'Colissimo et Mondial Relay', '0 % de commission Comptoir']],
    ['Commerce', 39, 'Boutique physique + en ligne', ['Tout Atelier, plus :', 'Caisse et stock unique', 'Click & collect et QR de vitrine', 'Fiche Google synchronisée', 'Fiches produits par photo illimitées', 'Session de lancement en visio']],
    ['Maison', 79, 'Plusieurs boutiques ou salariés', ['Tout Commerce, plus :', '3 points de vente', '5 comptes équipe', 'Domaines de campagne illimités', 'Export comptable automatique', 'Conseiller dédié']]
  ];
  return `
  <div class="tete"><div><h1>L’offre Comptoir</h1><p class="sous">Un prix fixe, tout compris. Pas d’applications payantes à empiler, pas de commission sur vos ventes (hors frais bancaires du paiement).</p></div></div>
  <div class="plans">${plans.map(([nom, prix, pour, inclus], i) => `
    <section class="plan ${i === 1 ? 'conseille' : ''}">
      ${i === 1 ? '<span class="eyebrow">Le plus choisi</span>' : '<span class="eyebrow">&nbsp;</span>'}
      <h2>${nom}</h2><p class="sous">${pour}</p>
      <div class="prix"><strong>${prix} €</strong><span class="sous">HT / mois</span></div>
      <ul>${inclus.map(x => `<li>${x}</li>`).join('')}</ul>
      <a class="btn ${i === 1 ? '' : 'fantome'}" href="#creer">Essayer 30 jours</a>
    </section>`).join('')}</div>
  <section class="carte">
    <div class="carte-tete"><h2>Ce qui nous distingue</h2></div>
    <div class="atouts">
      <div><strong>Copilote de saison</strong><p class="sous">Chaque temps fort (Black Friday, Noël, fête des mères, soldes) arrive avec une campagne prête, calculée sur vos ventes et votre stock.</p></div>
      <div><strong>Conforme en France</strong><p class="sous">Factures numérotées et facture électronique, CGV, mentions légales, RGPD, TVA : générés et tenus à jour.</p></div>
      <div><strong>Boutique et magasin réunis</strong><p class="sous">Une caisse, un stock, le click & collect et la fiche Google, sans application supplémentaire.</p></div>
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.modal) { ui.modal = null; rendreModal(); } });

function dessinerQR() {
  const z = document.getElementById('qr');
  if (!z) return;
  z.innerHTML = '';
  if (typeof QRCode === 'undefined') { z.innerHTML = '<p class="sous">QR indisponible hors ligne</p>'; return; }
  new QRCode(z, { text: z.dataset.url, width: 132, height: 132, colorDark: '#151821', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
}
