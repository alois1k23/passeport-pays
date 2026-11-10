/* Comptoir — méthode de lancement.
   Principes publics d’e-commerçants et d’outils reconnus, traduits en règles
   vérifiables dans le logiciel. Les sources et leur fiabilité sont détaillées
   dans METHODE.md. Les seuils marqués « règle Comptoir » sont des choix par défaut,
   modifiables, et non des chiffres tirés des sources. */

/* ---------- 1. Grille « produit gagnant » ---------- */
const MARQUES_PROTEGEES = /\b(apple|iphone|airpods|nike|adidas|disney|marvel|pok[eé]mon|chanel|dyson|lego|samsung|gucci|louis vuitton|rolex)\b/i;

function criteresProduit(f) {
  const p = { ...f, type: 'drop' };
  const m = margeProduit(p);
  const cout = f.cout + (f.portF || 0);
  const margeBrute = m.avantPub; // même définition que dans les tests : après TVA, fournisseur, douane et frais de paiement
  const mois = new Date().getMonth();
  const indice = (SECTEURS[f.niche] ? SECTEURS[f.niche].courbe[mois] : 100) / 100;
  return [
    { nom: 'Prix de vente entre 25 et 60', ok: f.prix >= 25 && f.prix <= 60, detail: `${euros(f.prix)}. Assez bas pour l’achat impulsif, assez haut pour payer la publicité.`, source: 'Minea' },
    { nom: 'Vendu au moins 3 fois son coût', ok: f.prix >= 3 * cout, detail: `${(f.prix / cout).toFixed(1).replace('.', ',')} × le coût fournisseur + port.`, source: 'Minea' },
    { nom: 'Marge brute d’au moins 20 par vente', ok: margeBrute >= 20, detail: `${euros(margeBrute)} avant publicité : c’est votre budget maximum pour obtenir une vente.`, source: 'Minea' },
    { nom: 'Marge nette de 20 % ou plus', ok: m.taux >= 0.2, detail: `${Math.round(m.taux * 100)} % après TVA, douane, paiement et publicité estimée.`, source: 'Minea' },
    { nom: 'Effet « waouh » ou résout un problème', ok: f.tendance >= 60 || !!PROBLEMES[f.categorie], detail: PROBLEMES[f.categorie] ? `Répond à : ${PROBLEMES[f.categorie][0]}.` : 'Montrable en vidéo en moins de 3 secondes.', source: 'Minea, Kamil Sattar' },
    { nom: 'Livré en 7 jours maximum', ok: f.delai[1] <= 7, detail: `${f.delai[0]} à ${f.delai[1]} jours depuis l’entrepôt ${ENTREPOTS[f.entrepot].nom.toLowerCase()}.`, source: 'Kamil Sattar, Minea' },
    { nom: 'Pas de marque protégée', ok: !MARQUES_PROTEGEES.test(f.nom), detail: 'Aucun logo ni nom de grande marque : sinon, risque de blocage des publicités et de litige.', source: 'Kamil Sattar' },
    { nom: 'Demande de saison favorable', ok: indice >= 1, detail: `Indice ${Math.round(indice * 100)} en ${MOIS_LONG[mois]} (100 = mois moyen).`, source: 'Comptoir' }
  ];
}

function blocCriteres(f) {
  const c = criteresProduit(f);
  const n = c.filter(x => x.ok).length;
  return `<details class="criteres"><summary><span class="pill ${n >= 7 ? 'good' : n >= 5 ? 'info' : 'warn'}">${n}/${c.length} critères produit gagnant</span></summary>
    <ul>${c.map(x => `<li class="${x.ok ? 'ok' : 'ko'}"><b>${x.ok ? 'Oui' : 'Non'}</b><span><strong>${esc(x.nom)}</strong><br><span class="sous">${esc(x.detail)} (${esc(x.source)})</span></span></li>`).join('')}</ul></details>`;
}

/* ---------- 2. Tests produits ----------
   Règles (sources et limites dans METHODE.md) :
   - marge de contribution par vente = prix HT − achat − import/douane − frais de paiement (avant publicité) ;
     c’est aussi le coût d’acquisition d’équilibre (CPA d’équilibre). ROAS d’équilibre = prix / contribution.
   - couper : dépense ≥ 3 × CPA d’équilibre sans aucune vente, après au moins 500 impressions (règle répandue, 2× à 5× selon les sources) ;
     ou coût par vente au-dessus du CPA d’équilibre une fois la fenêtre de jugement passée.
   - apprentissage : Meta et TikTok visent environ 50 conversions en 7 jours ; TikTok déconseille toute modification avant 20.
   - accroche : part des impressions qui regardent 3 secondes (hook rate), cible 30 à 40 % (Motion).
   - augmenter : pas de pourcentage fixe reconnu. Soit horizontal (nouvelles publicités sur l’angle gagnant, Common Thread Collective),
     soit hausse de budget puis environ 7 jours d’attente avant de juger (Ben Heath). */
const CANAUX_TEST = {
  meta: { nom: 'Publicités Meta (Instagram, Facebook)', jours: 3, apprentissage: 50, regle: '5 à 10 publicités dans un même test, jugées après 3 jours (Minea ; 1 à 2 jours selon Jordan Welch). Vidéo verticale, message lisible sans le son dans les 3 premières secondes, 15 s ou moins (Meta).' },
  'tiktok-ads': { nom: 'Publicités TikTok', jours: 3, apprentissage: 50, gel: 20, regle: '3 à 5 publicités très différentes par groupe d’annonces, style natif, texte à l’écran court (TikTok). Testez d’abord les 3 premières secondes (Gabriel St-Germain).' },
  organique: { nom: 'TikTok organique', jours: 30, apprentissage: 0, regle: '3 à 5 vidéos de 10 à 30 s par jour pendant 30 jours (Kamil Sattar). Des mesures plus prudentes montrent déjà un gain en passant de 1 à 2–5 publications par semaine (Buffer).' }
};
const SEUIL_COUPE = 3;          // × CPA d’équilibre dépensé sans vente
const IMPRESSIONS_MIN = 500;
const HOOK_CIBLE = [0.30, 0.40];
const CTR_SIGNAL = 0.02;        // CTR lien > 2 % : signal positif (Harry Coleman)

function contributionProduit(p) { return margeProduit(p, { cpa: 0 }).avantPub; }
const margeBruteProduit = contributionProduit; // ancien nom, conservé pour les autres écrans

function analyseTest(t) {
  const p = etat.produits.find(x => x.id === t.produitId);
  if (!p) return null;
  const mb = contributionProduit(p);
  const roasEq = mb > 0 ? p.prix / mb : Infinity;
  const tot = k => t.resultats.reduce((a, r) => a + (Number(k === 'impressions' ? (r.impressions ?? r.vues) : r[k]) || 0), 0);
  const depense = tot('depense'), ventes = tot('ventes'), clics = tot('clics'), impressions = tot('impressions'), vues3s = tot('vues3s');
  const vues = impressions;
  const cpa = ventes ? depense / ventes : null;
  const roas = depense ? ventes * p.prix / depense : null;
  const jours = t.resultats.length;
  const canal = CANAUX_TEST[t.canal];
  const hook = impressions && vues3s ? vues3s / impressions : null;
  const ctr = impressions ? clics / impressions : null;
  const cpm = impressions ? depense / impressions * 1000 : null;
  const cvr = clics ? ventes / clics : null;
  const ventes7 = t.resultats.slice(-7).reduce((a, r) => a + (Number(r.ventes) || 0), 0);
  const enApprentissage = canal.apprentissage && ventes7 < canal.apprentissage;
  const budgetMin = mb > 0 && canal.apprentissage ? canal.apprentissage * mb / 7 : null;
  let verdict, raison, ton, conseil = '';
  if (t.canal === 'organique') {
    const taux = vues ? clics / vues * 1000 : 0;
    if (jours < 7) { verdict = 'Continuer'; ton = 'info'; raison = `Jour ${jours} sur 30. Gardez le rythme et notez les accroches qui retiennent.`; }
    else if (ventes === 0 && jours >= 14) { verdict = 'Changer d’angle'; ton = 'warn'; raison = '14 jours sans vente : testez un autre problème ou une autre accroche avant d’abandonner le produit.'; }
    else { verdict = 'Continuer'; ton = ventes ? 'good' : 'info'; raison = `${clics} clics pour ${vues.toLocaleString('fr-FR')} vues (${taux.toFixed(1).replace('.', ',')} pour 1000). ${ventes} vente${ventes > 1 ? 's' : ''}.`; }
  } else if (!jours) { verdict = 'À lancer'; ton = 'muted'; raison = canal.regle; }
  else if (!ventes && depense >= SEUIL_COUPE * mb && impressions >= IMPRESSIONS_MIN) { verdict = 'Couper'; ton = 'bad'; raison = `${euros(depense)} dépensés sans vente, soit plus de ${SEUIL_COUPE} fois le coût d’acquisition d’équilibre (${euros(mb)}).`; }
  else if (cpa !== null && jours >= canal.jours && cpa > mb) { verdict = hook !== null && hook < HOOK_CIBLE[0] ? 'Changer l’accroche' : 'Couper'; ton = 'bad'; raison = `Coût par vente ${euros(cpa)} au-dessus du seuil d’équilibre ${euros(mb)} : chaque vente coûte de l’argent.${hook !== null && hook < HOOK_CIBLE[0] ? ` L’accroche retient peu (${fmtPct(hook)} regardent 3 s, cible 30–40 %) : testez de nouvelles premières secondes avant d’abandonner le produit.` : ''}`; }
  else if (cpa !== null && jours >= canal.jours && cpa <= mb * 0.7) {
    verdict = 'Augmenter'; ton = 'good';
    raison = `Coût par vente ${euros(cpa)}, soit ${Math.round(cpa / mb * 100)} % du seuil d’équilibre. Rendement pub ${roas.toFixed(2).replace('.', ',')} pour un seuil d’équilibre de ${roasEq.toFixed(2).replace('.', ',')}.`;
    conseil = enApprentissage && canal.gel && ventes7 < canal.gel ? `Ne touchez à rien avant ${canal.gel} conversions (TikTok).` : 'Deux options : ajouter 2 ou 3 nouvelles publicités sur le même angle (horizontal), ou augmenter le budget puis attendre environ 7 jours avant de juger.';
  } else if (jours >= canal.jours) { verdict = 'Garder et itérer'; ton = 'info'; raison = 'Rentable mais sans marge de sécurité : changez les 3 premières secondes ou testez un nouvel angle avant d’augmenter le budget.'; }
  else { verdict = 'Attendre'; ton = 'info'; raison = `Jour ${jours} sur ${canal.jours}. Jugez après ${canal.jours} jours, sauf si la dépense sans vente dépasse ${SEUIL_COUPE} × ${euros(mb)}.`; }
  return { p, mb, roasEq, depense, ventes, clics, vues, impressions, vues3s, cpa, roas, jours, verdict, raison, conseil, ton, budgetJour: t.budgetJour, ctr, hook, cpm, cvr, ventes7, enApprentissage, budgetMin, apprentissage: canal.apprentissage };
}

function etatTests() { etat.tests = etat.tests || []; return etat.tests; }

/* Démo : deux tests déjà menés, un rentable, un à couper. */
function semerTests() {
  const drops = etat.produits.filter(p => p.type === 'drop');
  if (drops.length < 2) return;
  const j = 86400000, now = Date.now();
  etat.tests = [
    { id: nouvelId('t'), produitId: drops[1].id, canal: 'meta', budgetJour: 50, debut: now - 6 * j, resultats: [
      { depense: 50, impressions: 9800, vues3s: 3430, clics: 210, ventes: 3 }, { depense: 50, impressions: 10400, vues3s: 3740, clics: 228, ventes: 4 }, { depense: 50, impressions: 9100, vues3s: 3180, clics: 196, ventes: 5 }] },
    { id: nouvelId('t'), produitId: drops[drops.length - 1].id, canal: 'meta', budgetJour: 50, debut: now - 4 * j, resultats: [
      { depense: 50, impressions: 8800, vues3s: 1580, clics: 61, ventes: 0 }, { depense: 50, impressions: 9300, vues3s: 1670, clics: 70, ventes: 1 }] }
  ];
}

function jaugeSimple(valeur, cible, libelle) {
  if (valeur === null) return `<div class="metrique"><span>${libelle}</span><b>—</b></div>`;
  const ok = cible === null ? null : valeur >= cible;
  return `<div class="metrique ${ok === null ? '' : ok ? 'ok' : 'ko'}"><span>${libelle}</span><b>${fmtPct(valeur)}</b></div>`;
}

function vueTests() {
  if (!etat.tests && !connecteServeur()) { semerTests(); sauver(); }
  const tests = etatTests();
  const semaine = tests.filter(t => t.debut > Date.now() - 7 * 86400000).length;
  const candidats = etat.produits.filter(p => p.actif);
  const t0 = ui.nouveauTest || { produitId: candidats[0] && candidats[0].id, canal: 'meta', budgetJour: 50 };
  const pChoisi = etat.produits.find(p => p.id === t0.produitId);
  const mb0 = pChoisi ? contributionProduit(pChoisi) : 0;
  const canal0 = CANAUX_TEST[t0.canal];
  return `
  <div class="tete"><div><h1>Tests produits</h1><p class="sous">Testez vite, coupez ce qui ne rapporte pas, augmentez ce qui marche. Les verdicts suivent des règles sourcées. <button class="lien-bouton" data-action="sources">Sources</button></p></div>
    <div class="objectif"><strong>${semaine}</strong><span>test${semaine > 1 ? 's' : ''} lancé${semaine > 1 ? 's' : ''} cette semaine<br><span class="sous">3 à 5 produits par semaine (Minea)</span></span></div></div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Tests en cours</h2></div>
      ${tests.length ? tests.slice().reverse().map(t => {
        const a = analyseTest(t);
        if (!a) return '';
        const org = t.canal === 'organique';
        return `<article class="test">
          <div class="test-tete">${visuelProduit(a.p)}<div><strong>${esc(a.p.nom)}</strong><div class="sous">${esc(CANAUX_TEST[t.canal].nom)} · jour ${a.jours}${org ? '' : ` · ${euros(t.budgetJour)}/jour`}</div></div><span class="pill ${a.ton}">${a.verdict}</span></div>
          <div class="chiffres">
            <div><span class="sous">${org ? 'Vues' : 'Dépensé'}</span><strong>${org ? a.vues.toLocaleString('fr-FR') : euros(a.depense)}</strong></div>
            <div><span class="sous">Ventes</span><strong>${a.ventes}</strong></div>
            <div><span class="sous">${org ? 'Clics' : 'Coût par vente'}</span><strong>${org ? a.clics : a.cpa === null ? '—' : euros(a.cpa)}</strong></div>
            <div><span class="sous">${org ? 'Contribution / vente' : 'Rendement pub / seuil'}</span><strong>${org ? euros(a.mb) : `${a.roas === null ? '—' : a.roas.toFixed(2).replace('.', ',')} / ${isFinite(a.roasEq) ? a.roasEq.toFixed(2).replace('.', ',') : '∞'}`}</strong></div>
          </div>
          ${org ? '' : `<div class="metriques">
            ${jaugeSimple(a.hook, HOOK_CIBLE[0], 'Vues de 3 s · cible 30–40\u00a0%')}
            ${jaugeSimple(a.ctr, CTR_SIGNAL, 'Taux de clic · signal dès 2\u00a0%')}
            <div class="metrique"><span>Coût pour 1000 affichages</span><b>${a.cpm === null ? '—' : euros(a.cpm)}</b></div>
            ${jaugeSimple(a.cvr, null, 'Conversion des clics')}
          </div>`}
          <p class="sous">${esc(a.raison)}${a.conseil ? ` <b>${esc(a.conseil)}</b>` : ''}</p>
          ${a.apprentissage && !org ? `<div class="apprentissage"><span class="sous">Phase d’apprentissage : ${a.ventes7} / ${a.apprentissage} ventes sur 7 jours${a.enApprentissage ? ' · évitez de modifier le test' : ' · terminée'}</span><span class="piste-app"><i style="width:${Math.min(100, a.ventes7 / a.apprentissage * 100)}%"></i></span></div>` : ''}
          <form class="saisie-test" id="saisie-${t.id}" data-form="resultat-test" data-id="${t.id}"><span class="saisie-titre">Résultats du jour ${a.jours + 1}</span>
            ${org ? '' : `<label class="champ"><span>Dépense (${devise()})</span><input name="depense" type="number" min="0" step="0.01" required></label>`}
            <label class="champ"><span>${org ? 'Vues' : 'Impressions'}</span><input name="impressions" type="number" min="0" required></label>
            ${org ? '' : `<label class="champ"><span>Vues 3 s</span><input name="vues3s" type="number" min="0"></label>`}
            <label class="champ"><span>Clics</span><input name="clics" type="number" min="0" required></label>
            <label class="champ"><span>Ventes</span><input name="ventes" type="number" min="0" required></label>
          </form>
          <div class="test-pied"><button class="btn petit fantome danger-doux" data-action="supprimer-test" data-id="${t.id}">Arrêter le test</button><button class="btn petit" type="submit" form="saisie-${t.id}">Enregistrer le jour ${a.jours + 1}</button></div>
        </article>`;
      }).join('') : '<p class="sous">Aucun test pour l’instant. Lancez-en un à droite.</p>'}
    </section>
    <div class="pile">
      <section class="carte">
        <div class="carte-tete"><h2>Lancer un test</h2></div>
        <form data-form="nouveau-test" class="assistant-corps">
          <label class="champ"><span>Produit</span><select name="produitId" data-nouveau-test="produitId">${candidats.map(p => `<option value="${p.id}" ${p.id === t0.produitId ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}</select></label>
          <label class="champ"><span>Canal</span><select name="canal" data-nouveau-test="canal">${Object.entries(CANAUX_TEST).map(([k, c]) => `<option value="${k}" ${k === t0.canal ? 'selected' : ''}>${c.nom}</option>`).join('')}</select></label>
          ${t0.canal === 'organique' ? '' : `<label class="champ"><span>Budget par jour (${devise()})</span><input name="budgetJour" type="number" min="5" step="1" value="${t0.budgetJour}" data-nouveau-test="budgetJour"></label>`}
          ${pChoisi ? `<div class="encart calcul-eq">
            <div><span>Contribution par vente (avant publicité)</span><b>${euros(mb0)}</b></div>
            <div><span>Coût d’acquisition d’équilibre</span><b>${euros(mb0)}</b></div>
            <div><span>Rendement pub d’équilibre</span><b>${mb0 > 0 ? (pChoisi.prix / mb0).toFixed(2).replace('.', ',') : '∞'}</b></div>
            ${t0.canal === 'organique' ? '' : `<div><span>Coupure si dépense sans vente ≥</span><b>${euros(SEUIL_COUPE * mb0)}</b></div>
            <div><span>Budget/jour pour finir l’apprentissage (${canal0.apprentissage} ventes en 7 j)</span><b>${euros(canal0.apprentissage * mb0 / 7)}</b></div>`}
            <p class="sous">${esc(canal0.regle)}${t0.canal !== 'organique' && t0.budgetJour < canal0.apprentissage * mb0 / 7 ? ' À ce budget, la phase d’apprentissage ne se terminera pas en 7 jours : c’est normal pour un premier test, mais jugez sur le coût par vente, pas sur les indicateurs de la plateforme.' : ''}</p>
          </div>` : ''}
          <button class="btn">Lancer le test</button>
        </form>
      </section>
      <section class="carte">
        <div class="carte-tete"><h2>Avant de dépenser en publicité</h2></div>
        <ol class="appris">
          <li>Commencez par le contenu gratuit : TikTok organique et micro-influenceurs payés à la commission (Kamil Sattar).</li>
          <li>Activez d’abord les e-mails automatiques : relance de paiement, bienvenue, demande d’avis (écran Conversion).</li>
          <li>Un produit, plusieurs accroches : 4 à 5 vidéos × 3 accroches (podcast Hors des Clous). Environ 5 % des publicités seulement deviennent gagnantes, et la moitié perdent : c’est normal (Motion, 2026).</li>
          <li>Les formats qui gagnent le plus souvent : déballage et démonstration (Motion, 2026).</li>
          <li>Surveillez les retours : 30 % de retours suffisent à effacer la marge (Minea).</li>
        </ol>
      </section>
    </div>
  </div>
  <p class="note">Les chiffres de démo sont fictifs. Les seuils publiés (taux d’accroche, taux de clic, apprentissage) sont des repères, pas des garanties.</p>`;
}

/* ---------- 3. Micro-influenceurs (réseaux sociaux) ---------- */
function blocInfluenceurs() {
  const b = etat.boutique;
  const code = slugifier(b.nom).replace(/-/g, '').toUpperCase().slice(0, 8) + '10';
  const fr = b.pays !== 'ch';
  return `<section class="carte">
    <div class="carte-tete"><h2>Micro-influenceurs</h2><span class="sous">Payés à la commission, sans avance</span></div>
    <p class="sous">Contactez beaucoup de petits comptes (Kamil Sattar conseille 50 à 100 par jour au démarrage) : produit offert, 15 % de commission sur les ventes faites avec leur code, et 10 % de remise pour leur communauté.</p>
    <pre class="brouillon">Bonjour ! On adore tes vidéos. On est ${b.nom}, une petite boutique${b.pays === 'ch' ? ' de Suisse romande' : ''}. On aimerait t’offrir notre ${(etat.produits[0] || { nom: 'produit phare' }).nom.toLowerCase()} et te proposer 15 % de commission sur chaque vente faite avec ton code ${code} (−10 % pour ta communauté). Ça te dit ?</pre>
    <p class="encart">${fr ? 'France (loi du 9 juin 2023) : l’influenceur doit afficher « Publicité » ou « Collaboration commerciale ». En dropshipping, il est responsable envers l’acheteur et doit indiquer l’identité du fournisseur.' : 'Suisse : la loi contre la concurrence déloyale interdit la publicité déguisée. Demandez une mention claire « Publicité » ou « Collaboration commerciale ».'}</p>
  </section>`;
}

/* ---------- Événements ---------- */
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.nouveauTest) {
    ui.nouveauTest = { ...(ui.nouveauTest || { produitId: etat.produits[0] && etat.produits[0].id, canal: 'meta', budgetJour: 50 }), [t.dataset.nouveauTest]: t.dataset.nouveauTest === 'budgetJour' ? Number(t.value) : t.value };
    rendre();
  }
});
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.form === 'nouveau-test') {
    e.preventDefault();
    const d = new FormData(f);
    etatTests().push({ id: nouvelId('t'), produitId: d.get('produitId'), canal: d.get('canal'), budgetJour: Number(d.get('budgetJour')) || 0, debut: Date.now(), resultats: [] });
    ui.nouveauTest = null; sauver(); toast('Test lancé. Ajoutez les résultats chaque jour : le verdict se met à jour.'); rendre();
  } else if (f.dataset.form === 'resultat-test') {
    e.preventDefault();
    const t = etatTests().find(x => x.id === f.dataset.id);
    const d = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, Number(v) || 0]));
    t.resultats.push(d);
    sauver();
    const a = analyseTest(t);
    toast(`Jour ${a.jours} enregistré : ${a.verdict.toLowerCase()}.`); rendre();
  }
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'supprimer-test') { etat.tests = etatTests().filter(t => t.id !== el.dataset.id); sauver(); rendre(); }
  else if (el.dataset.action === 'lancement-intensif') {
    const s = etatSocial();
    s.comptes.tiktok = true; s.reglages.frequence.tiktok = 21; s.reglages.piliers = ['probleme', 'produit', 'avis', 'offre', 'saison'];
    sauver(); toast('Lancement intensif : 3 vidéos TikTok par jour. Générez le calendrier.'); rendre();
  }
});
