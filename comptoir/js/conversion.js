/* Comptoir — conversion et fidélisation : e-mails automatiques, remises par
   quantité, codes promo, livraison offerte, suggestions au panier.
   Sur un vrai compte, les e-mails partent du serveur (server/src/relances.js) ;
   en démo, les chiffres d’envoi sont simulés et signalés. */

const AUTO_DEFAUT = {
  bienvenue: { actif: true, remise: 10, code: 'BIENVENUE10' },
  paiement: { actif: true, etapes: [{ heures: 1 }, { heures: 24 }, { heures: 72 }], remise: 0, code: '' },
  avis: { actif: true, jours: 7 },
  reconquete: { actif: false, jours: 90, remise: 15, code: 'RETOUR15' }
};

function etatConversion() {
  etat.automatisations = etat.automatisations || JSON.parse(JSON.stringify(AUTO_DEFAUT));
  for (const k of Object.keys(AUTO_DEFAUT)) etat.automatisations[k] = { ...AUTO_DEFAUT[k], ...(etat.automatisations[k] || {}) };
  const avaitRegles = etat.offres && Array.isArray(etat.offres.regles);
  etat.offres = { ...Remises.OFFRES_DEFAUT, ...(etat.offres || {}) };
  if (!avaitRegles) {
    etat.offres.regles = [];
    // Démo : deux offres d’exemple (une dans le panier, une après l’achat)
    if (!connecteServeur() && etat.produits.length >= 5) {
      const [a, , , d, e] = etat.produits;
      etat.offres.regles = [{ id: 'r1', si: a.id, alors: e.id, remise: 15, type: 'panier', actif: true }, { id: 'r2', si: '*', alors: d.id, remise: 20, type: 'apres', actif: true }];
    }
  }
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

/* ---------- Avis vérifiés ---------- */
const AVIS_DEMO = {
  5: ['Superbe, exactement comme sur les photos. Livré vite.', 'Très belle qualité, je recommande sans hésiter.', 'Cadeau parfait, emballage soigné.', 'Rapport qualité-prix excellent, arrivé en 3 jours.'],
  4: ['Très bien, juste un peu plus petit que prévu.', 'Bon produit, livraison un jour plus tard qu’annoncé.'],
};
/* Avis propres à certains produits : jamais une remarque sur un câble pour un plaid. */
const AVIS_SPECIFIQUES = [
  [/lamp|lumin|bougie|diffus|humidif|veilleuse/i, 5, 'Ambiance garantie le soir, on adore.'],
  [/lamp|chargeur|humidif|diffus|veilleuse/i, 4, 'Joli et pratique. Le câble pourrait être plus long.'],
  [/plaid|coton|coussin|linge/i, 5, 'Très doux, il ne bouloche pas après lavage.'],
  [/organis|tiroir|rangement|bambou/i, 4, 'Pratique, les compartiments sont un peu étroits.']
];
const AVIS_DEMO_SUITE = {
  3: ['Correct, mais la couleur est plus froide que sur la photo.', 'Fait le travail, sans plus.'],
  2: ['Déçu par la finition, un petit défaut sur le côté.'],
  1: ['Arrivé abîmé. Le service client a proposé un échange.']
};
function semerAvis() {
  etat.avis = [];
  const livrees = etat.commandes.filter(c => c.canal === 'web' && c.statut === 'livree');
  for (const c of livrees) {
    const h = hacheTexte(c.id + 'avis');
    if (h > 0.24) continue;
    const l = c.lignes[0];
    const r = hacheTexte(c.id + 'n');
    const note = r < 0.62 ? 5 : r < 0.86 ? 4 : r < 0.94 ? 3 : r < 0.97 ? 2 : 1;
    const prod = etat.produits.find(p => p.id === l.produitId);
    const textes = [...(AVIS_DEMO[note] || []), ...(AVIS_DEMO_SUITE[note] || []), ...AVIS_SPECIFIQUES.filter(([re, n]) => n === note && prod && re.test(`${prod.nom} ${prod.categorie}`)).map(x => x[2])];
    etat.avis.push({ id: 'av' + c.id, commandeId: c.id, produitId: l.produitId, note, texte: textes[Math.floor(hacheTexte(c.id + 't') * textes.length)], prenom: c.client.nom.split(' ')[0], ville: c.client.ville, date: Math.min(c.date + 9 * JOUR, Date.now() - JOUR), reponse: note <= 2 ? 'Merci pour votre retour, nous vous avons écrit pour organiser l’échange.' : null });
  }
  etat.avis.sort((a, b) => b.date - a.date);
}
function statsAvisProduits() {
  const s = {};
  for (const a of etat.avis || []) { const x = s[a.produitId] = s[a.produitId] || { somme: 0, n: 0 }; x.somme += a.note; x.n++; }
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { moyenne: v.somme / v.n, n: v.n }]));
}
const MOTS_VIDES = new Set('le la les un une des de du et à au aux en pour par sur avec sans très plus moins que qui est sont a été je j on nous vous il elle ce cet cette mais pas ne bien tout trop un peu comme mon ma mes notre nos votre vos leur leurs dans se s y d l qu n c arrivé fait être pourrait avoir était aussi encore peut'.split(' ').map(m => m.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
function motsFrequents(textes) {
  // Compté sans accents (« deçu » = « déçu »), affiché avec l’orthographe d’origine.
  const c = {}, forme = {};
  const sansAccent = m => m.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const t of textes) for (const m of t.toLowerCase().match(/[a-zà-ÿœæ]{4,}/g) || []) {
    const k = sansAccent(m);
    if (MOTS_VIDES.has(k)) continue;
    c[k] = (c[k] || 0) + 1; forme[k] = forme[k] || m;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => [forme[k], n]);
}
function blocAvis() {
  const avis = etat.avis || [];
  const n = avis.length;
  const moyenne = n ? avis.reduce((s, a) => s + a.note, 0) / n : 0;
  const repart = [5, 4, 3, 2, 1].map(k => ({ nom: `${k} étoile${k > 1 ? 's' : ''}`, v: avis.filter(a => a.note === k).length }));
  const positifs = motsFrequents(avis.filter(a => a.note >= 4).map(a => a.texte));
  const negatifs = motsFrequents(avis.filter(a => a.note <= 3).map(a => a.texte));
  return `<section class="carte">
    <div class="carte-tete"><h2>Avis clients vérifiés</h2><span class="sous">${n} avis · moyenne ${n ? moyenne.toFixed(1).replace('.', ',') : '—'} / 5</span></div>
    <p class="sous">Collectés par l’e-mail de demande d’avis, uniquement auprès de clients livrés. Un produit avec 5 avis a une probabilité d’achat bien plus élevée qu’un produit sans avis (Spiegel Research Center), et une note de 4,2 à 4,5 inspire plus confiance qu’un 5,0 parfait. Tous les avis sont publiés.</p>
    <div class="grille-2 serre">
      <div>${barresH(repart, { format: v => String(v) })}</div>
      <div class="mots"><h3>Ce que vos clients apprécient</h3><p>${positifs.map(([m, k]) => `<span class="tag">${esc(m)} ${k}</span>`).join(' ') || '<span class="sous">—</span>'}</p>
        <h3>Ce qui revient dans les critiques</h3><p>${negatifs.map(([m, k]) => `<span class="tag">${esc(m)} ${k}</span>`).join(' ') || '<span class="sous">—</span>'}</p>
        <p class="sous">Les mots positifs sont de bons angles pour vos accroches ; les critiques indiquent quoi corriger (photo, délai, fournisseur).</p></div>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Note</th><th>Avis</th><th>Produit</th><th>Réponse publique</th></tr></thead><tbody>
      ${avis.slice(0, 12).map(a => `<tr><td class="etoiles-cel"><span class="etoiles" aria-label="${a.note} sur 5">${'★'.repeat(a.note)}<span class="etoiles-vides" aria-hidden="true">${'★'.repeat(5 - a.note)}</span></span></td><td>${esc(a.texte)}<div class="sous">${esc(a.prenom)}, ${esc(a.ville)} · ${dateCourte(a.date)}</div></td><td class="sous">${esc((etat.produits.find(p => p.id === a.produitId) || { nom: '—' }).nom)}</td>
        <td><textarea class="reponse-avis" rows="2" data-avis="${esc(a.id)}" placeholder="Répondre publiquement" aria-label="Réponse à l’avis de ${esc(a.prenom)}">${esc(a.reponse || "")}</textarea></td></tr>`).join('') || '<tr><td colspan="4" class="vide">Pas encore d’avis. Ils arriveront avec la demande d’avis envoyée après livraison.</td></tr>'}
    </tbody></table></div>
  </section>`;
}

function vueConversion() {
  if (!etat.avis && !connecteServeur()) { semerAvis(); sauver(); }
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
    { cle: 'reconquete', titre: 'Reconquête des clients inactifs', quand: `Sans commande depuis ${a.reconquete.jours} jours, clients ayant accepté les e-mails`, envoyes: s.envois.reconquete || 0,
      reglages: `<label class="champ"><span>Inactif depuis (jours)</span><input type="number" min="30" max="365" value="${a.reconquete.jours}" data-auto="reconquete.jours"></label><label class="champ"><span>Remise (%)</span><input type="number" min="0" max="50" value="${a.reconquete.remise}" data-auto="reconquete.remise"></label><label class="champ"><span>Code</span><input value="${esc(a.reconquete.code)}" data-auto="reconquete.code"></label>`,
      apercu: `De nouveaux produits sont arrivés depuis votre dernière commande. Pour votre retour : −${a.reconquete.remise} % avec ${a.reconquete.code}.` }
  ];
  return `
  <div class="tete"><div><h1>Conversion et e-mails</h1><p class="sous">E-mails automatiques, remises et codes promo. Tout ce qui transforme un visiteur en client, puis un client en client fidèle.</p></div></div>
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
        <div class="flux-chiffre"><b>${f.envoyes.toLocaleString("fr-FR")}</b><span class="sous">envoyés</span></div>
        ${interrupteur(f.cle, a[f.cle].actif)}
        <details class="flux-reglages"><summary>Réglages</summary><div class="deux">${f.reglages}</div></details>
      </article>`).join('')}</div>
  </section>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Remises par quantité</h2><label class="interrupteur petit"><input type="checkbox" data-offre="paliersActifs" ${o.paliersActifs ? 'checked' : ''}><span>${o.paliersActifs ? 'Actives' : 'Désactivées'}</span></label></div>
      <p class="sous">Le panier affiche « Ajoutez 1 article : −5 % ». Non cumulable avec un code promo : la remise la plus avantageuse pour le client s’applique.</p>
      <div class="paliers">${[0, 1].map(i => { const p = o.paliers[i] || { qte: i + 2, remise: 0 }; return `<div class="deux"><label class="champ"><span>Dès (articles)</span><input type="number" min="2" max="20" value="${p.qte}" data-palier="${i}.qte"></label><label class="champ"><span>Remise (%)</span><input type="number" min="0" max="50" value="${p.remise}" data-palier="${i}.remise"></label></div>`; }).join('')}</div>
      ${assistantSeuil(o)}
      <label class="case"><input type="checkbox" data-offre="barrePort" ${o.barrePort ? 'checked' : ''}> Barre « plus que X pour la livraison offerte » dans le panier</label>
      <label class="case"><input type="checkbox" data-offre="suggestions" ${o.suggestions ? 'checked' : ''}> Suggérer un produit complémentaire dans le panier</label>
    </section>
    ${blocRegles(o)}
    <section class="carte sans-pad">
      <div class="carte-tete pad"><h2>Codes promo valables</h2><span class="sous">${codes.length} code${codes.length > 1 ? "s" : ""}</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th class="num">Remise</th><th>Origine</th><th></th></tr></thead><tbody>
        ${codes.map(c => `<tr><td class="mono">${esc(c.code)}</td><td class="num">−${c.remise} %</td><td class="sous">${esc(c.source)}</td><td class="num">${c.source === 'Code manuel' ? `<button class="btn petit fantome danger-doux" data-action="suppr-code" data-code="${esc(c.code)}">Retirer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucun code.</td></tr>'}
      </tbody></table></div>
      <form class="ajout-code" data-form="ajout-code"><input name="code" placeholder="NOUVEAUCODE" required maxlength="20" aria-label="Code"><input name="remise" type="number" min="1" max="70" value="10" required aria-label="Remise en %"><button class="btn">Ajouter</button></form>
    </section>
  </div>
  ${blocAvis()}`;
}

/* Assistant du seuil de livraison offerte : répartition des paniers réels (90 jours). */
function assistantSeuil(o) {
  const paniers = etat.commandes.filter(c => c.canal === 'web' && compteVentes(c) && c.date > Date.now() - 90 * JOUR).map(c => c.total - (c.port || 0)).sort((a, b) => a - b);
  const q = f => paniers.length ? paniers[Math.min(paniers.length - 1, Math.floor(f * paniers.length))] : 0;
  const au = s => paniers.length ? paniers.filter(x => x >= s).length / paniers.length : 0;
  const med = q(0.5), p75 = q(0.75);
  const propose = Math.ceil(p75 / 5) * 5;
  return `<div class="assistant-seuil">
    <label class="champ"><span>Livraison offerte dès (${devise()}, 0 = jamais)</span><input type="number" min="0" max="1000" step="5" value="${o.seuilPort}" data-seuil></label>
    ${paniers.length >= 10 ? `<p class="sous">Sur 90 jours : panier médian <b>${euros(med)}</b>, 3 commandes sur 4 sous <b>${euros(p75)}</b>. Avec le seuil actuel, ${fmtPct(au(o.seuilPort))} des commandes ont la livraison offerte.
      Un seuil un peu au-dessus du panier habituel incite à ajouter un article ; ${o.seuilPort !== propose ? `<button type="button" class="bouton-lien" data-action="seuil-propose" data-v="${propose}">essayer ${euros(propose)}</button>` : 'c’est le cas ici'}. Vérifiez l’effet sur la marge dans Analyse › Rentabilité.</p>` : '<p class="sous">L’assistant proposera un seuil à partir de vos paniers réels dès 10 commandes.</p>'}
  </div>`;
}

/* Offres complémentaires : règles « si le panier contient X, proposer Y à −N % », avec taux d’acceptation. */
function statsRegle(r) {
  const acceptees = etat.commandes.filter(c => compteVentes(c) && c.lignes.some(l => l.offre === r.id));
  const reel = connecteServeur();
  const vues = reel ? (etat.offresVues || {})[r.id] || 0 : Math.round(etat.commandes.filter(c => c.date > Date.now() - 90 * JOUR).length * (r.type === 'apres' ? 0.9 : 0.55));
  const nAcc = reel ? acceptees.length : Math.round(vues * (0.05 + hacheTexte(r.id) * 0.07));
  const ca = reel ? acceptees.reduce((a, c) => a + c.lignes.filter(l => l.offre === r.id).reduce((s, l) => s + l.prix * l.qte, 0), 0) : nAcc * ((etat.produits.find(p => p.id === r.alors) || { prix: 0 }).prix * (1 - r.remise / 100));
  return { vues, acceptees: nAcc, taux: vues ? nAcc / vues : 0, ca };
}
function blocRegles(o) {
  const opts = (sel, avecTout) => `${avecTout ? `<option value="*" ${sel === '*' ? 'selected' : ''}>N’importe quel panier</option>` : ''}${etat.produits.filter(p => p.actif).map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}`;
  return `<section class="carte sans-pad regles">
    <div class="carte-tete pad"><h2>Offres complémentaires</h2><span class="sous">dans le panier ou juste après l’achat (même colis, pendant 2 heures)</span></div>
    <p class="sous pad-x">Proposez un produit lié, pas n’importe lequel : une offre sans rapport avec l’achat est souvent ignorée. Les taux d’acceptation très élevés cités par certains vendeurs d’applications sont des cas isolés ; une moyenne publiée tourne autour de 5 %.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Si le panier contient</th><th>Proposer</th><th class="num">Remise</th><th>Moment</th><th class="num">Vues</th><th class="num">Acceptées</th><th class="num">Chiffre d’affaires</th><th></th></tr></thead><tbody>
    ${o.regles.map((r, i) => { const s = statsRegle(r); return `<tr class="${r.actif ? '' : 'inactif'}">
      <td><select data-regle="${i}.si" aria-label="Condition">${opts(r.si, true)}</select></td>
      <td><select data-regle="${i}.alors" aria-label="Produit proposé">${opts(r.alors, false)}</select>${r.si === r.alors ? '<div class="sous">Choisissez un autre produit.</div>' : ''}</td>
      <td class="num"><input type="number" min="0" max="50" value="${r.remise}" data-regle="${i}.remise" class="mini-nombre" aria-label="Remise en %"> %</td>
      <td><select data-regle="${i}.type" aria-label="Moment"><option value="panier" ${r.type === 'panier' ? 'selected' : ''}>Dans le panier</option><option value="apres" ${r.type === 'apres' ? 'selected' : ''}>Après l’achat</option></select></td>
      <td class="num">${s.vues}</td><td class="num">${s.acceptees}<div class="sous">${fmtPct(s.taux)}</div></td><td class="num">${euros(s.ca)}</td>
      <td class="num actions-regle"><label class="interrupteur petit"><input type="checkbox" data-regle="${i}.actif" ${r.actif ? 'checked' : ''} aria-label="Offre active"><span>${r.actif ? 'Active' : 'Inactive'}</span></label><button class="btn petit fantome danger-doux" data-action="suppr-regle" data-i="${i}">Retirer</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="vide">Aucune offre. Ajoutez-en une : par exemple, une bougie proposée avec le diffuseur.</td></tr>'}
    </tbody></table></div>
    <div class="pad-x pad-b"><button class="btn petit fantome" data-action="ajout-regle" ${etat.produits.length < 2 ? 'disabled' : ''}>Ajouter une offre</button>${connecteServeur() ? '' : ' <span class="sous">Démo : vues et acceptations simulées.</span>'}</div>
  </section>`;
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
  } else if (t.dataset.regle) {
    const { o } = etatConversion();
    const [i, k] = t.dataset.regle.split('.');
    o.regles[i][k] = k === 'actif' ? t.checked : k === 'remise' ? Math.max(0, Math.min(50, Number(t.value) || 0)) : t.value;
    sauver(); rendre();
  } else if (t.dataset.seuil !== undefined) {
    etatConversion(); etat.offres.seuilPort = Math.max(0, Number(t.value) || 0); sauver(); rendre();
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
document.addEventListener('change', async e => {
  const t = e.target;
  if (!t.dataset || !t.dataset.avis) return;
  const a = (etat.avis || []).find(x => x.id === t.dataset.avis);
  if (!a) return;
  a.reponse = t.value.trim() || null;
  try { if (connecteServeur()) await api('PATCH', `/api/admin/avis/${encodeURIComponent(a.id)}`, { reponse: a.reponse || '' }); else sauver(); toast('Réponse publiée sous l’avis.'); } catch (err) { toast(err.message); }
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
  if (e.target.closest('[data-action="ajout-regle"]')) {
    const { o } = etatConversion();
    const [a, b] = etat.produits.filter(p => p.actif);
    o.regles = [...o.regles, { id: 'r' + Date.now().toString(36), si: a.id, alors: b.id, remise: 10, type: 'panier', actif: true }].slice(0, 10);
    sauver(); rendre(); return;
  }
  const sr = e.target.closest('[data-action="suppr-regle"]');
  if (sr) { const { o } = etatConversion(); o.regles = o.regles.filter((_, i) => i !== Number(sr.dataset.i)); sauver(); rendre(); return; }
  const sp = e.target.closest('[data-action="seuil-propose"]');
  if (sp) { etatConversion(); etat.offres.seuilPort = Number(sp.dataset.v); sauver(); toast(`Livraison offerte dès ${euros(Number(sp.dataset.v))}.`); rendre(); return; }
  const el = e.target.closest('[data-action="suppr-code"]');
  if (!el) return;
  const { o } = etatConversion();
  o.codes = (o.codes || []).filter(c => c.code !== el.dataset.code);
  sauver(); rendre();
});
