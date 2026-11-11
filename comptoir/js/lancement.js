/* Comptoir — plan de lancement en 90 jours.
   Étapes d’action (pas d’objectifs de chiffre d’affaires : les jalons de revenus
   publiés par des formateurs sont auto-déclarés et ne sont pas repris ici).
   La plupart se cochent toutes seules à partir des données ; les autres à la main. */

function etapesLancement() {
  etatConversion();
  if (!connecteServeur()) {
    if (!etat.social) semerHistoriqueSocial(etat);
    if (!etat.avis && !connecteServeur()) semerAvis();   // avis simulés : démo seulement
    if (!etat.tests) semerTests();
  }
  const actifs = etat.produits.filter(p => p.actif);
  const rentables = actifs.filter(p => margeProduit(p).taux >= 0.2);
  const drops = actifs.filter(p => p.type === 'drop');
  const pubs = (etat.publications || []).filter(p => p.statut === 'publiee');
  const web = etat.commandes.filter(c => c.canal === 'web' && compteVentes(c));
  const tests = (etat.tests || []).map(analyseTest).filter(Boolean);
  const auto = etat.automatisations || {};
  const e = etat.entreprise || {};
  const manuel = (etat.lancement = etat.lancement || {});
  const semaine = (etat.tests || []).filter(t => t.debut > Date.now() - 7 * JOUR).length;
  const net30 = etat.commandes.filter(c => c.date > Date.now() - 30 * JOUR).reduce((a, c) => a + beneficeCommande(c), 0) - (typeof depensePub === 'function' ? depensePub(Date.now() - 30 * JOUR, Date.now() + 1) : 0);
  return [
    { phase: 'Jours 1 à 7 · Préparer', etapes: [
      { cle: 'produits', nom: '3 produits ou plus avec au moins 20 % de marge nette', ok: rentables.length >= 3, detail: `${rentables.length} sur ${actifs.length}`, lien: 'sourcing', source: 'Minea' },
      { cle: 'delais', nom: 'Tous les produits en dropshipping livrés en 7 jours maximum', ok: drops.length > 0 && drops.every(p => p.delai && p.delai[1] <= 7), detail: `${drops.filter(p => p.delai && p.delai[1] > 7).length} trop lent(s)`, lien: 'produits', source: 'Kamil Sattar, Baymard' },
      { cle: 'legal', nom: `Fiche entreprise complète (${estSuisse() ? 'Impressum' : 'mentions légales'}, contact)`, ok: !!(e.raison && e.email && e.adresse && !/compléter/.test(e.adresse)), lien: 'conformite' },
      { cle: 'emails', nom: 'E-mails automatiques actifs avant toute publicité', ok: !!(auto.paiement && auto.paiement.actif && auto.bienvenue && auto.bienvenue.actif && auto.avis && auto.avis.actif), lien: 'conversion', source: 'créateurs interrogés, Klaviyo' },
      { cle: 'domaine', nom: 'Domaine personnalisé choisi', ok: !!etat.boutique.domaine, lien: 'domaines' }
    ] },
    { phase: 'Jours 7 à 30 · Contenu gratuit', etapes: [
      { cle: 'videos', nom: '30 publications en ligne', ok: pubs.length >= 30, detail: `${pubs.length} / 30`, lien: 'social', source: 'Kamil Sattar : 3 à 5 vidéos par jour' },
      { cle: 'influence', nom: 'Contacter des micro-influenceurs (commission, produit offert)', ok: !!manuel.influence, manuel: true, lien: 'social', source: 'Kamil Sattar' },
      { cle: 'vente', nom: 'Première vente en ligne', ok: web.length >= 1, detail: `${web.length} commande(s)`, lien: 'commandes' }
    ] },
    { phase: 'Jours 30 à 60 · Tester', etapes: [
      { cle: 'test', nom: 'Premier test publicitaire avec règles de coupe', ok: tests.some(t => t.depense > 0), lien: 'tests' },
      { cle: 'rythme', nom: '3 produits testés en une semaine', ok: semaine >= 3, detail: `${semaine} cette semaine`, lien: 'tests', source: 'Minea' },
      { cle: 'avis', nom: '10 avis clients vérifiés', ok: (etat.avis || []).length >= 10, detail: `${(etat.avis || []).length} / 10`, lien: 'conversion', source: 'Spiegel Research Center' }
    ] },
    { phase: 'Jours 60 à 90 · Augmenter', etapes: [
      { cle: 'gagnant', nom: 'Un produit rentable après publicité identifié', ok: tests.some(t => t.verdict === 'Augmenter'), lien: 'tests' },
      { cle: 'benefice', nom: 'Bénéfice net positif sur 30 jours, publicité comprise', ok: net30 > 0, detail: euros(net30), lien: 'analyse' },
      { cle: 'stock', nom: 'Passer le produit gagnant en stock propre (meilleure marge, délai plus court)', ok: !!manuel.stock, manuel: true, lien: 'produits', source: 'Sebastian Ghiorghiu, Lucas Bivert' }
    ] }
  ];
}

function blocLancement() {
  const phases = etapesLancement();
  const toutes = phases.flatMap(p => p.etapes);
  const faites = toutes.filter(e => e.ok).length;
  if (faites === toutes.length && !ui.lancementOuvert) return '';
  const prochaines = toutes.filter(e => !e.ok).slice(0, 3);
  return `<section class="carte lancement">
    <div class="carte-tete"><div><h2>Plan de lancement</h2><span class="sous">${faites} étapes sur ${toutes.length} · synthèse de conseils publics de créateurs et d’études · <button class="lien-bouton" data-action="sources">Sources</button></span></div>
      <button class="btn fantome petit" data-action="lancement-ouvrir">${ui.lancementOuvert ? 'Réduire' : 'Voir tout le plan'}</button></div>
    <div class="piste-lancement"><i style="width:${faites / toutes.length * 100}%"></i></div>
    ${ui.lancementOuvert ? `<div class="phases">${phases.map(ph => `<div class="phase"><h3>${ph.phase}</h3><ul>${ph.etapes.map(ligneEtape).join('')}</ul></div>`).join('')}</div>`
      : `<ul class="prochaines">${prochaines.map(ligneEtape).join('')}</ul>`}
  </section>`;
}
function ligneEtape(e) {
  return `<li class="${e.ok ? 'fait' : ''}">
    ${e.manuel ? `<input type="checkbox" data-lancement="${e.cle}" ${e.ok ? 'checked' : ''} aria-label="${esc(e.nom)}">` : `<span class="coche" aria-hidden="true">${e.ok ? '✓' : ''}</span>`}
    <a href="#${e.lien}">${esc(e.nom)}</a>${e.detail ? `<span class="sous">${esc(e.detail)}</span>` : ''}${e.source ? `<span class="source">${esc(e.source)}</span>` : ''}</li>`;
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-action="lancement-ouvrir"]')) { ui.lancementOuvert = !ui.lancementOuvert; rendre(); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.lancement;
  if (!k) return;
  etat.lancement = etat.lancement || {};
  etat.lancement[k] = e.target.checked;
  sauver(); rendre();
});
