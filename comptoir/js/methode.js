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

/* ---------- 2. Tests produits : règles pour arrêter ou augmenter le budget ---------- */
const CANAUX_TEST = {
  meta: { nom: 'Publicités Meta (Instagram, Facebook)', jours: 3, ensembles: 5, regle: '5 à 10 ensembles de publicités pendant 3 jours (Minea).' },
  'tiktok-ads': { nom: 'Publicités TikTok', jours: 3, ensembles: 5, regle: 'Tester d’abord les 3 premières secondes de la vidéo, puis les miniatures (Gabriel St-Germain).' },
  organique: { nom: 'TikTok organique', jours: 30, ensembles: 0, regle: '3 à 5 vidéos de 10 à 30 secondes par jour pendant 30 jours, sans budget publicitaire (Kamil Sattar).' }
};

function margeBruteProduit(p) {
  const m = margeProduit(p, { cpa: 0 });
  return m.avantPub;
}

function analyseTest(t) {
  const p = etat.produits.find(x => x.id === t.produitId);
  if (!p) return null;
  const mb = margeBruteProduit(p);
  const tot = k => t.resultats.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const depense = tot('depense'), ventes = tot('ventes'), clics = tot('clics'), vues = tot('vues');
  const cpa = ventes ? depense / ventes : null;
  const roas = depense ? ventes * p.prix / depense : null;
  const jours = t.resultats.length;
  const canal = CANAUX_TEST[t.canal];
  let verdict, raison, ton;
  if (t.canal === 'organique') {
    const tauxClic = vues ? clics / vues * 1000 : 0;
    if (jours < 7) { verdict = 'Continuer'; ton = 'info'; raison = `Jour ${jours} sur 30. Publiez 3 à 5 vidéos par jour et gardez les accroches qui retiennent.`; }
    else if (ventes === 0 && jours >= 14) { verdict = 'Changer d’angle'; ton = 'warn'; raison = '14 jours sans vente : testez un autre problème ou une autre accroche avant d’abandonner le produit.'; }
    else { verdict = ventes ? 'Continuer' : 'Continuer'; ton = ventes ? 'good' : 'info'; raison = `${clics} clics pour ${vues.toLocaleString('fr-FR')} vues (${tauxClic.toFixed(1).replace('.', ',')} pour 1000). ${ventes} ventes.`; }
  } else if (!jours) { verdict = 'À lancer'; ton = 'muted'; raison = canal.regle; }
  else if (depense > mb && !ventes) { verdict = 'Couper'; ton = 'bad'; raison = `${euros(depense)} dépensés sans vente : plus que votre marge brute (${euros(mb)}).`; }
  else if (cpa !== null && cpa > mb) { verdict = 'Couper'; ton = 'bad'; raison = `Coût par vente ${euros(cpa)} > marge brute ${euros(mb)} : chaque vente vous fait perdre de l’argent (Minea).`; }
  else if (cpa !== null && jours >= canal.jours && cpa <= mb * 0.7) { verdict = 'Augmenter le budget'; ton = 'good'; raison = `Coût par vente ${euros(cpa)}, soit ${Math.round(cpa / mb * 100)} % de la marge brute. Augmentez de 20 % tous les 2 jours tant que ça tient (règle Comptoir).`; }
  else if (jours >= canal.jours) { verdict = 'Garder et optimiser'; ton = 'info'; raison = 'Rentable mais juste : changez les 3 premières secondes de vos vidéos avant d’augmenter le budget.'; }
  else { verdict = 'Attendre'; ton = 'info'; raison = `Jour ${jours} sur ${canal.jours}. Ne coupez pas avant ${canal.jours} jours, sauf si la dépense dépasse déjà la marge brute.`; }
  return { p, mb, depense, ventes, clics, vues, cpa, roas, jours, verdict, raison, ton, budgetJour: t.budgetJour, ctr: vues ? clics / vues * 100 : null };
}

function etatTests() { etat.tests = etat.tests || []; return etat.tests; }

/* Démo : deux tests déjà menés pour montrer les deux issues. */
function semerTests() {
  const drops = etat.produits.filter(p => p.type === 'drop');
  if (drops.length < 2) return;
  const j = 86400000, now = Date.now();
  etat.tests = [
    { id: nouvelId('t'), produitId: drops[1].id, canal: 'meta', budgetJour: 50, debut: now - 6 * j, resultats: [
      { depense: 50, vues: 9800, clics: 160, ventes: 3 }, { depense: 50, vues: 10400, clics: 171, ventes: 4 }, { depense: 50, vues: 9100, clics: 150, ventes: 5 }] },
    { id: nouvelId('t'), produitId: drops[drops.length - 1].id, canal: 'meta', budgetJour: 50, debut: now - 4 * j, resultats: [
      { depense: 50, vues: 8800, clics: 60, ventes: 0 }, { depense: 50, vues: 9300, clics: 72, ventes: 1 }] }
  ];
}

function vueTests() {
  if (!etat.tests && !connecteServeur()) { semerTests(); sauver(); }
  const tests = etatTests();
  const semaine = tests.filter(t => t.debut > Date.now() - 7 * 86400000).length;
  const candidats = etat.produits.filter(p => p.actif);
  const t0 = ui.nouveauTest || { produitId: candidats[0] && candidats[0].id, canal: 'meta', budgetJour: 50 };
  const pChoisi = etat.produits.find(p => p.id === t0.produitId);
  return `
  <div class="tete"><div><h1>Tests produits</h1><p class="sous">Testez vite, coupez ce qui ne rapporte pas, augmentez le budget de ce qui marche. Les règles s’appliquent toutes seules.</p></div>
    <div class="objectif"><strong>${semaine}</strong><span>produit${semaine > 1 ? 's' : ''} testé${semaine > 1 ? 's' : ''} cette semaine<br><span class="sous">objectif : 3 à 5</span></span></div></div>
  <div class="grille-2">
    <section class="carte">
      <div class="carte-tete"><h2>Tests en cours</h2></div>
      ${tests.length ? tests.slice().reverse().map(t => {
        const a = analyseTest(t);
        if (!a) return '';
        return `<article class="test">
          <div class="test-tete">${visuelProduit(a.p)}<div><strong>${esc(a.p.nom)}</strong><div class="sous">${esc(CANAUX_TEST[t.canal].nom)} · jour ${a.jours}${t.canal !== 'organique' ? ` · ${euros(t.budgetJour)}/jour` : ''}</div></div><span class="pill ${a.ton}">${a.verdict}</span></div>
          <div class="chiffres">
            <div><span class="sous">${t.canal === 'organique' ? 'Vues' : 'Dépensé'}</span><strong>${t.canal === 'organique' ? a.vues.toLocaleString('fr-FR') : euros(a.depense)}</strong></div>
            <div><span class="sous">Ventes</span><strong>${a.ventes}</strong></div>
            <div><span class="sous">${t.canal === 'organique' ? 'Clics' : 'Coût par vente'}</span><strong>${t.canal === 'organique' ? a.clics : a.cpa === null ? '—' : euros(a.cpa)}</strong></div>
            <div><span class="sous">Marge brute</span><strong>${euros(a.mb)}</strong></div>
          </div>
          <p class="sous">${esc(a.raison)}</p>
          <form class="saisie-test" data-form="resultat-test" data-id="${t.id}">
            ${t.canal === 'organique' ? '' : `<label class="champ"><span>Dépense du jour</span><input name="depense" type="number" min="0" step="0.01" required></label>`}
            <label class="champ"><span>Vues</span><input name="vues" type="number" min="0" required></label>
            <label class="champ"><span>Clics</span><input name="clics" type="number" min="0" required></label>
            <label class="champ"><span>Ventes</span><input name="ventes" type="number" min="0" required></label>
            <button class="btn petit">Ajouter le jour ${a.jours + 1}</button>
          </form>
          <button class="bouton-lien" data-action="supprimer-test" data-id="${t.id}">Arrêter et retirer ce test</button>
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
          ${pChoisi ? `<div class="encart">
            <strong>Règles appliquées</strong><br>${esc(CANAUX_TEST[t0.canal].regle)}<br>
            Coupez si le coût par vente dépasse la marge brute : <b>${euros(margeBruteProduit(pChoisi))}</b> pour ce produit.<br>
            ${t0.canal === 'organique' ? 'Le pilote des réseaux sociaux peut publier les 3 vidéos par jour pour vous.' : `Budget total du test : <b>${euros(t0.budgetJour * CANAUX_TEST[t0.canal].jours)}</b> sur ${CANAUX_TEST[t0.canal].jours} jours.`}
          </div>` : ''}
          <button class="btn">Lancer le test</button>
        </form>
      </section>
      <section class="carte">
        <div class="carte-tete"><h2>Avant de dépenser en publicité</h2></div>
        <ol class="appris">
          <li>Commencez par le contenu gratuit : TikTok organique et micro-influenceurs payés à la commission (Kamil Sattar).</li>
          <li>Ne passez à la publicité payante qu’avec un budget de test que vous pouvez perdre.</li>
          <li>Un produit = un angle. Si l’accroche ne retient pas dans les 3 premières secondes, changez l’accroche avant le produit (Gabriel St-Germain).</li>
          <li>Surveillez les retours : 30 % de retours suffisent à effacer la marge (Minea).</li>
        </ol>
      </section>
    </div>
  </div>
  <p class="note">Les règles s’appuient sur des conseils publics (Minea, Kamil Sattar, Gabriel St-Germain) détaillés dans METHODE.md, avec leurs limites. Les chiffres de démo sont fictifs.</p>`;
}

/* ---------- 3. Micro-influenceurs (réseaux sociaux) ---------- */
function blocInfluenceurs() {
  const b = etat.boutique;
  const code = slugifier(b.nom).replace(/-/g, '').toUpperCase().slice(0, 8) + '10';
  const fr = b.pays !== 'ch';
  return `<section class="carte">
    <div class="carte-tete"><h2>Micro-influenceurs</h2><span class="sous">Payés à la commission, sans avance</span></div>
    <p class="sous">Contactez beaucoup de petits comptes (Kamil Sattar conseille 50 à 100 par jour au démarrage) : produit offert et 15 % de commission sur les ventes faites avec leur code.</p>
    <pre class="brouillon">Bonjour ! On adore tes vidéos. On est ${b.nom}, une petite boutique${b.pays === 'ch' ? ' de Suisse romande' : ''}. On aimerait t’offrir notre ${(etat.produits[0] || { nom: 'produit phare' }).nom.toLowerCase()} et te proposer 15 % sur chaque vente avec ton code ${code}. Ça te dit ?</pre>
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
