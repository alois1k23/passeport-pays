/* Comptoir — conversion et fidélisation : e-mails automatiques, remises par
   quantité, codes promo, livraison offerte, suggestions au panier.
   Sur un vrai compte, les e-mails partent du serveur (server/src/relances.js) ;
   en démo, les chiffres d’envoi sont simulés et signalés. */

const AUTO_DEFAUT = {
  bienvenue: { actif: true, remise: 10, code: 'BIENVENUE10' },
  paiement: { actif: true, etapes: [{ heures: 1 }, { heures: 24 }], remise: 0, code: '' },
  avis: { actif: true, jours: 7 },
  reconquete: { actif: false, jours: 90, remise: 15, code: 'RETOUR15' }
};

function etatConversion() {
  etat.automatisations = etat.automatisations || JSON.parse(JSON.stringify(AUTO_DEFAUT));
  for (const k of Object.keys(AUTO_DEFAUT)) etat.automatisations[k] = { ...AUTO_DEFAUT[k], ...(etat.automatisations[k] || {}) };
  etat.offres = { ...Remises.OFFRES_DEFAUT, ...(etat.offres || {}) };
  return { a: etat.automatisations, o: etat.offres };
}

function statsConversion() {
  const d0 = Date.now() - 30 * JOUR;
  const c30 = etat.commandes.filter(c => c.date >= d0 && c.canal === 'web');
  const reel = connecteServeur();
  const abandons = reel ? c30.filter(c => c.statut === 'attente' || c.relances).length : Math.round(c30.length * 0.32);
  const recup = reel ? c30.filter(c => c.recuperee) : c30.filter(c => hacheTexte(c.id) < 0.06);
  const avecRemise = c30.filter(c => c.remise > 0 || (!reel && hacheTexte(c.id + 'r') < 0.3));
  const sansRemise = c30.filter(c => !avecRemise.includes(c));
  const moy = l => l.length ? l.reduce((a, c) => a + c.total, 0) / l.length : 0;
  return {
    reel, abandons, recup: recup.length, caRecup: recup.reduce((a, c) => a + c.total, 0),
    abonnes: reel ? etat.abonnes || 0 : 214,
    envois: reel ? etat.envois || {} : { paiement: Math.round(abandons * 1.6), avis: Math.round(c30.length * 0.7), bienvenue: 38, reconquete: 0 },
    panierRemise: moy(avecRemise), panierSans: moy(sansRemise), partRemise: c30.length ? avecRemise.length / c30.length : 0
  };
}

function vueConversion() {
  const { a, o } = etatConversion();
  const s = statsConversion();
  const codes = Remises.codesValables(etat);
  const interrupteur = (cle, actif) => `<label class="interrupteur petit"><input type="checkbox" data-auto="${cle}.actif" ${actif ? 'checked' : ''}><span>${actif ? 'Actif' : 'Désactivé'}</span></label>`;
  const flux = [
    { cle: 'paiement', titre: 'Relance de paiement abandonné', quand: `${a.paiement.etapes.map(e => e.heures < 1 ? `${Math.round(e.heures * 60)} min` : `${e.heures} h`).join(' puis ')} après une commande non payée`, envoyes: s.envois.paiement || 0,
      reglages: `${a.paiement.etapes.map((e, i) => `<label class="champ"><span>E-mail ${i + 1} après (heures)</span><input type="number" min="0.25" max="168" step="0.25" value="${e.heures}" data-auto="paiement.etapes.${i}.heures"></label>`).join('')}
        <label class="champ"><span>Remise dans le dernier e-mail (%)</span><input type="number" min="0" max="30" value="${a.paiement.remise}" data-auto="paiement.remise"></label>
        <label class="champ"><span>Code associé</span><input value="${esc(a.paiement.code)}" placeholder="ex. RELANCE10" data-auto="paiement.code"></label>`,
      apercu: `Votre commande chez ${etat.boutique.nom} vous attend. Un souci au moment de payer ? Reprenez-la en un clic.${a.paiement.remise && a.paiement.code ? ` −${a.paiement.remise} % avec ${a.paiement.code} dans le dernier rappel.` : ''}` },
    { cle: 'bienvenue', titre: 'Bienvenue (inscription newsletter)', quand: 'Immédiatement après l’inscription', envoyes: s.envois.bienvenue || 0,
      reglages: `<label class="champ"><span>Remise de bienvenue (%)</span><input type="number" min="0" max="50" value="${a.bienvenue.remise}" data-auto="bienvenue.remise"></label><label class="champ"><span>Code</span><input value="${esc(a.bienvenue.code)}" data-auto="bienvenue.code"></label>`,
      apercu: `Merci de votre inscription. Voici −${a.bienvenue.remise} % sur votre première commande avec le code ${a.bienvenue.code}.` },
    { cle: 'avis', titre: 'Demande d’avis', quand: `${a.avis.jours} jours après la livraison`, envoyes: s.envois.avis || 0,
      reglages: `<label class="champ"><span>Délai après livraison (jours)</span><input type="number" min="1" max="60" value="${a.avis.jours}" data-auto="avis.jours"></label>`,
      apercu: 'Vous avez reçu votre commande. Qu’en pensez-vous ? Votre avis aide d’autres clients à choisir.' },
    { cle: 'reconquete', titre: 'Reconquête des clients inactifs', quand: `Sans commande depuis ${a.reconquete.jours} jours`, envoyes: s.envois.reconquete || 0,
      reglages: `<label class="champ"><span>Inactif depuis (jours)</span><input type="number" min="30" max="365" value="${a.reconquete.jours}" data-auto="reconquete.jours"></label><label class="champ"><span>Remise (%)</span><input type="number" min="0" max="50" value="${a.reconquete.remise}" data-auto="reconquete.remise"></label><label class="champ"><span>Code</span><input value="${esc(a.reconquete.code)}" data-auto="reconquete.code"></label>`,
      apercu: `De nouveaux produits sont arrivés depuis votre dernière commande. Pour votre retour : −${a.reconquete.remise} % avec ${a.reconquete.code}.` }
  ];
  return `
  <div class="tete"><div><h1>Conversion et fidélisation</h1><p class="sous">E-mails automatiques, remises et codes promo. Tout ce qui transforme un visiteur en client, puis un client en client fidèle.</p></div></div>
  <div class="kpis">
    <div class="kpi tuile"><span>Paiements abandonnés (30 j)</span><div class="tuile-ligne"><strong>${s.abandons}</strong></div><div class="tuile-pied"><span class="sous">commandes créées mais non payées</span></div></div>
    <div class="kpi tuile"><span>Récupérés par relance</span><div class="tuile-ligne"><strong>${s.recup}</strong></div><div class="tuile-pied"><span class="sous">${euros(s.caRecup)} de chiffre d’affaires</span></div></div>
    <div class="kpi tuile"><span>Abonnés newsletter</span><div class="tuile-ligne"><strong>${s.abonnes.toLocaleString('fr-FR')}</strong></div><div class="tuile-pied"><span class="sous">reçoivent l’e-mail de bienvenue</span></div></div>
    <div class="kpi tuile"><span>Panier moyen avec remise</span><div class="tuile-ligne"><strong>${euros(s.panierRemise)}</strong></div><div class="tuile-pied"><span class="sous">contre ${euros(s.panierSans)} sans · ${fmtPct(s.partRemise)} des commandes</span></div></div>
  </div>
  ${s.reel ? '' : '<p class="note">Démo : volumes d’envoi et récupérations simulés. Sur un compte réel, ils viennent des envois effectués par le serveur.</p>'}
  <section class="carte sans-pad">
    <div class="carte-tete pad"><h2>E-mails automatiques</h2><span class="sous">envoyés par Comptoir, une seule fois par client et par événement</span></div>
    <div class="flux">${flux.map(f => `
      <article class="flux-ligne">
        <div class="flux-titre"><strong>${f.titre}</strong><span class="sous">${f.quand}</span></div>
        <div class="flux-apercu"><span class="sous">Aperçu</span><p>${esc(f.apercu)}</p></div>
        <div class="flux-chiffre"><b class="mono">${f.envoyes}</b><span class="sous">envoyés</span></div>
        ${interrupteur(f.cle, a[f.cle].actif)}
        <details class="flux-reglages"><summary>Réglages</summary><div class="deux">${f.reglages}</div></details>
      </article>`).join('')}</div>
  </section>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Remises par quantité</h2><label class="interrupteur petit"><input type="checkbox" data-offre="paliersActifs" ${o.paliersActifs ? 'checked' : ''}><span>${o.paliersActifs ? 'Actives' : 'Désactivées'}</span></label></div>
      <p class="sous">Le panier affiche « Ajoutez 1 article : −5 % ». Non cumulable avec un code promo : la remise la plus avantageuse pour le client s’applique.</p>
      <div class="paliers">${[0, 1].map(i => { const p = o.paliers[i] || { qte: i + 2, remise: 0 }; return `<div class="deux"><label class="champ"><span>Dès (articles)</span><input type="number" min="2" max="20" value="${p.qte}" data-palier="${i}.qte"></label><label class="champ"><span>Remise (%)</span><input type="number" min="0" max="50" value="${p.remise}" data-palier="${i}.remise"></label></div>`; }).join('')}</div>
      <label class="case"><input type="checkbox" data-offre="barrePort" ${o.barrePort ? 'checked' : ''}> Barre « plus que X pour la livraison offerte » dans le panier</label>
      <label class="case"><input type="checkbox" data-offre="suggestions" ${o.suggestions ? 'checked' : ''}> Suggérer un produit complémentaire dans le panier</label>
    </section>
    <section class="carte sans-pad">
      <div class="carte-tete pad"><h2>Codes promo valables</h2><span class="sous">${codes.length} codes</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th class="num">Remise</th><th>Origine</th><th></th></tr></thead><tbody>
        ${codes.map(c => `<tr><td class="mono">${esc(c.code)}</td><td class="num">−${c.remise} %</td><td class="sous">${esc(c.source)}</td><td class="num">${c.source === 'Code manuel' ? `<button class="bouton-lien" data-action="suppr-code" data-code="${esc(c.code)}">Retirer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucun code.</td></tr>'}
      </tbody></table></div>
      <form class="ajout-code" data-form="ajout-code"><input name="code" placeholder="NOUVEAUCODE" required maxlength="20" aria-label="Code"><input name="remise" type="number" min="1" max="70" value="10" required aria-label="Remise en %"><button class="btn petit">Ajouter</button></form>
    </section>
  </div>`;
}

function majChemin(obj, chemin, valeur) {
  const k = chemin.split('.');
  let o = obj;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  o[k[k.length - 1]] = valeur;
}

document.addEventListener('change', e => {
  const t = e.target;
  if (!etat) return;
  if (t.dataset.auto) {
    const { a } = etatConversion();
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    majChemin(a, t.dataset.auto, v);
    sauver(); rendre();
  } else if (t.dataset.offre) {
    etatConversion(); etat.offres[t.dataset.offre] = t.checked; sauver(); rendre();
  } else if (t.dataset.palier) {
    const { o } = etatConversion();
    const [i, k] = t.dataset.palier.split('.');
    o.paliers = [0, 1].map(j => ({ ...(o.paliers[j] || { qte: j + 2, remise: 0 }) }));
    o.paliers[i][k] = Number(t.value);
    sauver(); rendre();
  }
});
document.addEventListener('submit', e => {
  if (e.target.dataset.form !== 'ajout-code') return;
  e.preventDefault();
  const d = new FormData(e.target);
  const { o } = etatConversion();
  const code = String(d.get('code')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;
  o.codes = [...(o.codes || []).filter(c => c.code !== code), { code, remise: Number(d.get('remise')) }];
  sauver(); toast(`Code ${code} ajouté.`); rendre();
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action="suppr-code"]');
  if (!el) return;
  const { o } = etatConversion();
  o.codes = (o.codes || []).filter(c => c.code !== el.dataset.code);
  sauver(); rendre();
});
