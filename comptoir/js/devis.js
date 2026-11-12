/* Comptoir — devis pour les clients professionnels (espace marchand).
   Rédaction (articles du catalogue ou lignes libres HT, remise, livraison, validité), envoi par lien secret,
   suivi (consulté, accepté, refusé, expiré), duplication. Le client accepte en ligne ; le devis devient une commande. */
const STATUTS_DEVIS = { brouillon: ['Brouillon', ''], envoye: ['Envoyé', 'info'], accepte: ['Accepté', 'good'], refuse: ['Refusé', 'bad'], expire: ['Expiré', 'warn'], annule: ['Annulé', ''] };
const devisVide = () => ({ id: null, client: { raison: '', contact: '', email: '', adresse: '', npa: '', ville: '', tva: '', pays: etat.boutique.pays }, objet: '', lignes: [], remisePct: 0, port: 0, validiteJours: 30, conditions: '' });

function vueDevis() {
  if (!connecteAuServeur()) return `<div class="tete"><div><h1>Devis</h1><p class="sous">Devis en ligne pour vos clients professionnels : envoyés par lien, acceptés en un clic, transformés en commande.</p></div></div>
    <section class="carte"><p>Les devis s’envoient depuis votre boutique en ligne. Connectez-vous à votre compte pour les utiliser.</p></section>`;
  if (!ui.devisListe && !ui.devisEnCours) setTimeout(chargerDevis, 0);
  const liste = ui.devisListe || [];
  const e = ui.devisEdition;
  return `<div class="tete"><div><h1>Devis</h1><p class="sous">Pour vos clients professionnels : le client reçoit un lien, consulte et accepte en ligne (bon pour accord). Le devis accepté devient une commande, payable en ligne ou par virement.</p></div>
    ${e ? '' : `<button class="btn" data-action="devis-nouveau">${icone('plus')} Nouveau devis</button>`}</div>
  ${e ? formulaireDevis(e) : ''}
  ${ui.devisLien ? `<div class="encart" role="status"><b>Devis ${esc(ui.devisLien.numero)} envoyé à ${esc(ui.devisLien.email)}.</b> Lien personnel du client (ne le publiez pas) : <span class="mono code-lien">${esc(ui.devisLien.lien)}</span> <button class="btn petit fantome" data-action="devis-copier">Copier le lien</button></div>` : ''}
  <section class="carte">
    ${liste.length ? `<table class="table"><thead><tr><th>Devis</th><th>Client</th><th class="num">Total TTC</th><th>État</th><th></th></tr></thead><tbody>${liste.map(d => {
      const [nom, ton] = STATUTS_DEVIS[d.statut] || [d.statut, ''];
      const actions = [
        ['brouillon', 'envoye'].includes(d.statut) ? `<button class="btn petit fantome" data-action="devis-modifier" data-id="${esc(d.id)}">Modifier</button>` : '',
        ['brouillon', 'envoye'].includes(d.statut) ? `<button class="btn petit${d.statut === 'brouillon' ? '' : ' fantome'}" data-action="devis-envoyer" data-id="${esc(d.id)}">${d.statut === 'brouillon' ? 'Envoyer' : 'Renvoyer'}</button>` : '',
        `<button class="btn petit fantome" data-action="devis-dupliquer" data-id="${esc(d.id)}">Dupliquer</button>`,
        ['brouillon', 'envoye'].includes(d.statut) ? `<button class="btn petit fantome" data-action="devis-annuler" data-id="${esc(d.id)}">Annuler</button>` : ''
      ].join('');
      return `<tr><td><span class="mono">${esc(d.numero)}</span><div class="sous">${dateCourte(d.creeLe)}${d.objet ? ` · ${esc(d.objet)}` : ''}</div></td>
        <td>${esc(d.client.raison)}<div class="sous">${esc(d.client.email)}</div></td>
        <td class="num">${euros(d.total)}</td>
        <td><span class="pill ${ton}">${nom}</span>${d.statut === 'envoye' && d.valableJusquau ? `<div class="sous">jusqu’au ${new Date(d.valableJusquau).toLocaleDateString('fr-FR')}</div>` : ''}${d.acceptation ? `<div class="sous">par ${esc(d.acceptation.nom)}</div>` : ''}${d.commande ? `<div class="sous"><a href="#commandes">Commande n° ${d.commande.numero}</a></div>` : ''}</td>
        <td class="num"><div class="rangee">${actions}</div></td></tr>`;
    }).join('')}</tbody></table>` : `<p class="sous">${ui.devisEnCours ? 'Chargement…' : 'Aucun devis pour l’instant. Créez-en un pour un client professionnel : hôtel, restaurant, entreprise, collectivité.'}</p>`}
  </section>`;
}

function formulaireDevis(e) {
  const ch = estSuisse();
  const articles = etat.produits.filter(p => p.actif).flatMap(p => Array.isArray(p.variantes) && p.variantes.length ? p.variantes.map(v => ({ p, v })) : [{ p, v: null }]);
  const r = Number(e.remisePct) || 0, t = tauxTvaVente();
  const estimation = e.lignes.reduce((a, l) => a + (l.produitId ? Number(l.prixTtc) || 0 : (Number(l.prixHt) || 0) * (1 + t)) * (1 - r / 100) * (Number(l.qte) || 0), 0) + (Number(e.port) || 0);
  const champ = (cle, libelle, attrs = '') => `<label class="champ"><span>${libelle}</span><input data-dv="client.${cle}" value="${esc(e.client[cle] || '')}" ${attrs}></label>`;
  return `<section class="carte" aria-labelledby="dv-titre">
    <div class="carte-tete"><h2 id="dv-titre">${e.id ? `Modifier le devis ${esc(e.numero || '')}` : 'Nouveau devis'}</h2><button class="lien bouton-lien" data-action="devis-fermer">Fermer sans enregistrer</button></div>
    ${e.statut === 'envoye' ? '<p class="encart alerte-encart">Ce devis a déjà été envoyé : l’enregistrer le repasse en brouillon, et le lien reçu par le client ne fonctionnera plus. Renvoyez-le ensuite.</p>' : ''}
    <fieldset class="groupe-champs"><legend>Client professionnel</legend><div class="grille-2">
      ${champ('raison', 'Raison sociale', 'required maxlength="150" autocomplete="organization"')}${champ('contact', 'Contact (facultatif)', 'maxlength="100"')}
      ${champ('email', 'E-mail', 'type="email" required maxlength="200"')}${champ('tva', `N° de TVA${ch ? ' / IDE' : ' intracommunautaire'} (facultatif)`, 'maxlength="30"')}
      ${champ('adresse', 'Adresse', 'maxlength="200" autocomplete="street-address"')}<label class="champ"><span>Pays du client</span><select data-dv="client.pays">${[['ch', 'Suisse'], ['fr', 'France'], ['be', 'Belgique'], ['de', 'Allemagne'], ['it', 'Italie'], ['lu', 'Luxembourg'], ['at', 'Autriche'], ['es', 'Espagne'], ['nl', 'Pays-Bas']].map(([k, n]) => `<option value="${k}" ${(e.client.pays || etat.boutique.pays) === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${(e.client.pays || etat.boutique.pays) !== etat.boutique.pays ? '<p class="sous alerte-texte" role="status">Client d’un autre pays : le régime de TVA (exonération, autoliquidation, export) n’est pas encore géré. Ce devis sera refusé.</p>' : ''}<div class="deux">${champ('npa', ch ? 'NPA' : 'Code postal', 'maxlength="10"')}${champ('ville', 'Ville', 'maxlength="100"')}</div>
    </div></fieldset>
    <label class="champ"><span>Objet (facultatif)</span><input data-dv="objet" value="${esc(e.objet || '')}" maxlength="200" placeholder="Décoration du hall d’accueil"></label>
    <table class="table compacte"><caption class="sous">Lignes du devis</caption><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">Prix unitaire</th><th></th></tr></thead><tbody>
      ${e.lignes.map((l, i) => `<tr><td>${l.produitId ? esc(l.nom) : `<input data-dv="lignes.${i}.nom" value="${esc(l.nom || '')}" aria-label="Désignation de la ligne ${i + 1}" maxlength="200" required>`}</td>
        <td class="num"><input data-dv="lignes.${i}.qte" type="number" min="1" max="100000" step="1" value="${esc(l.qte)}" aria-label="Quantité de la ligne ${i + 1}" class="champ-court"></td>
        <td class="num">${l.produitId ? `${euros(l.prixTtc)} TTC` : `<input data-dv="lignes.${i}.prixHt" type="number" min="0" step="0.01" value="${esc(l.prixHt)}" aria-label="Prix HT de la ligne ${i + 1}" class="champ-court"> HT`}</td>
        <td class="num"><button class="icone" data-action="devis-ligne-retirer" data-i="${i}" aria-label="Retirer la ligne ${i + 1}">×</button></td></tr>`).join('') || '<tr><td colspan="4" class="sous">Ajoutez un article du catalogue ou une ligne libre (prestation, article sur mesure).</td></tr>'}
    </tbody></table>
    <div class="rangee">
      <select id="dv-article" aria-label="Article du catalogue"><option value="">Article du catalogue…</option>${articles.map(({ p, v }) => `<option value="${esc(p.id)}|${esc(v ? v.id : '')}">${esc(p.nom)}${v ? ` (${esc(v.valeurs.join(' / '))})` : ''} · ${euros(v && typeof v.prix === 'number' ? v.prix : p.prix)}</option>`).join('')}</select>
      <button class="btn petit fantome" data-action="devis-ligne-article">Ajouter l’article</button>
      <button class="btn petit fantome" data-action="devis-ligne-libre">Ajouter une ligne libre</button>
    </div>
    <div class="grille-2">
      <label class="champ"><span>Remise sur le devis (%)</span><input data-dv="remisePct" type="number" min="0" max="90" step="0.5" value="${esc(e.remisePct)}"></label>
      <label class="champ"><span>Livraison TTC</span><input data-dv="port" type="number" min="0" step="0.01" value="${esc(e.port)}"></label>
      <label class="champ"><span>Validité (jours)</span><input data-dv="validiteJours" type="number" min="1" max="365" step="1" value="${esc(e.validiteJours)}"></label>
    </div>
    <label class="champ"><span>Conditions (facultatif)</span><textarea data-dv="conditions" maxlength="2000" rows="3" placeholder="Acompte, délai de livraison, modalités de paiement…">${esc(e.conditions || '')}</textarea></label>
    <p aria-live="polite">Total estimé : <b id="dv-total">${euros(estimation)}</b> TTC <span class="sous">(montant exact calculé à l’enregistrement)</span></p>
    <div class="rangee"><button class="btn" data-action="devis-enregistrer">Enregistrer</button><button class="btn fantome" data-action="devis-enregistrer" data-envoyer="1">Enregistrer et envoyer</button></div>
  </section>`;
}

async function chargerDevis() {
  ui.devisEnCours = true;
  try { ui.devisListe = (await api('GET', '/api/admin/devis')).devis; } catch (err) { ui.devisListe = []; toast(err.message); }
  finally { ui.devisEnCours = false; }
  if (location.hash.startsWith('#devis')) rendre();
}

// Saisie : l'état est mis à jour sans redessiner (le curseur reste dans le champ) ; seul le total estimé est recalculé.
document.addEventListener('input', ev => {
  const cle = ev.target.dataset && ev.target.dataset.dv; if (!cle || !ui.devisEdition) return;
  const morceaux = cle.split('.'); let o = ui.devisEdition;
  for (const m of morceaux.slice(0, -1)) o = o[m];
  o[morceaux[morceaux.length - 1]] = ev.target.value;
  const z = document.getElementById('dv-total');
  if (z) { const e = ui.devisEdition, r = Number(e.remisePct) || 0, t = tauxTvaVente(); z.textContent = euros(e.lignes.reduce((a, l) => a + (l.produitId ? Number(l.prixTtc) || 0 : (Number(l.prixHt) || 0) * (1 + t)) * (1 - r / 100) * (Number(l.qte) || 0), 0) + (Number(e.port) || 0)); }
});

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-action^="devis-"]'); if (!el) return;
  const a = el.dataset.action, e = ui.devisEdition;
  try {
    if (a === 'devis-nouveau') { ui.devisEdition = devisVide(); ui.devisLien = null; rendre(); document.querySelector('[data-dv="client.raison"]')?.focus(); }
    else if (a === 'devis-fermer') { if ((e.lignes.length || e.client.raison) && !confirm('Fermer sans enregistrer ? Les modifications seront perdues.')) return; ui.devisEdition = null; rendre(); }
    else if (a === 'devis-ligne-libre') { e.lignes.push({ produitId: null, nom: '', qte: 1, prixHt: '' }); rendre(); document.querySelector(`[data-dv="lignes.${e.lignes.length - 1}.nom"]`)?.focus(); }
    else if (a === 'devis-ligne-article') {
      const [pid, vid] = (document.getElementById('dv-article').value || '').split('|'); if (!pid) { toast('Choisissez un article.'); return; }
      const p = etat.produits.find(x => x.id === pid), v = vid && Array.isArray(p.variantes) ? p.variantes.find(x => x.id === vid) : null;
      e.lignes.push({ produitId: pid, ...(v ? { varianteId: v.id } : {}), nom: v ? `${p.nom} (${v.valeurs.join(' / ')})` : p.nom, qte: 1, prixTtc: v && typeof v.prix === 'number' ? v.prix : p.prix }); rendre();
    }
    else if (a === 'devis-ligne-retirer') { e.lignes.splice(Number(el.dataset.i), 1); rendre(); }
    else if (a === 'devis-enregistrer') {
      // Contrôles avant envoi : une ligne libre sans désignation ou sans prix n'est pas enregistrée à 0 en silence.
      const vide = e.lignes.findIndex(l => !l.produitId && (!String(l.nom || '').trim() || l.prixHt === '' || !Number.isFinite(Number(l.prixHt))));
      if (vide >= 0) { toast(`Ligne ${vide + 1} : indiquez la désignation et le prix HT.`); document.querySelector(`[data-dv="lignes.${vide}.${String(e.lignes[vide].nom || '').trim() ? 'prixHt' : 'nom'}"]`)?.focus(); return; }
      if (!String(e.client.raison || '').trim() || !String(e.client.email || '').trim()) { toast('Indiquez la raison sociale et l’e-mail du client.'); document.querySelector(`[data-dv="client.${String(e.client.raison || '').trim() ? 'email' : 'raison'}"]`)?.focus(); return; }
      el.disabled = true;
      const corps = { client: e.client, objet: e.objet, conditions: e.conditions, remisePct: Number(e.remisePct) || 0, port: Number(e.port) || 0, validiteJours: Number(e.validiteJours) || 30,
        lignes: e.lignes.map(l => l.produitId ? { produitId: l.produitId, ...(l.varianteId ? { varianteId: l.varianteId } : {}), qte: Number(l.qte) } : { nom: l.nom, qte: Number(l.qte), prixHt: Number(l.prixHt), ...(l.tauxReduit ? { tauxReduit: true } : {}) }) };
      const r = e.id ? await api('PUT', `/api/admin/devis/${encodeURIComponent(e.id)}`, corps) : await api('POST', '/api/admin/devis', corps);
      ui.devisEdition = null;
      ui.devisListe = null;
      try { if (el.dataset.envoyer) await envoyerDevis(r.devis.id); else toast(`Devis ${r.devis.numero} enregistré (${euros(r.devis.total)} TTC).`); }
      catch (err) { toast(`Devis ${r.devis.numero} enregistré, mais pas envoyé : ${err.message}`); }
      rendre();
    }
    else if (a === 'devis-envoyer') { el.disabled = true; await envoyerDevis(el.dataset.id); ui.devisListe = null; rendre(); }
    else if (a === 'devis-modifier') {
      const d = (await api('GET', `/api/admin/devis/${encodeURIComponent(el.dataset.id)}`)).devis;
      ui.devisEdition = { id: d.id, numero: d.numero, statut: d.statut, client: { ...devisVide().client, ...d.client }, objet: d.objet, conditions: d.conditions, remisePct: d.remisePct, port: d.port, validiteJours: d.validiteJours,
        lignes: d.lignes.map(l => l.produitId ? { produitId: l.produitId, varianteId: l.varianteId, nom: l.nom, qte: l.qte, prixTtc: l.prixTtc } : { produitId: null, nom: l.nom, qte: l.qte, prixHt: l.prixHtSaisi ?? Math.round(l.prixTtc / (1 + l.tauxTva) * 100) / 100, tauxReduit: l.tauxReduit }) };
      ui.devisLien = null; rendre(); window.scrollTo(0, 0);
    }
    else if (a === 'devis-dupliquer') { const r = await api('POST', `/api/admin/devis/${encodeURIComponent(el.dataset.id)}/dupliquer`, {}); toast(`Copie créée : ${r.devis.numero} (brouillon, prix du catalogue actuels).`); ui.devisListe = null; rendre(); }
    else if (a === 'devis-annuler') { if (!confirm('Annuler ce devis ? Le lien envoyé au client ne fonctionnera plus.')) return; await api('POST', `/api/admin/devis/${encodeURIComponent(el.dataset.id)}/annuler`, {}); ui.devisListe = null; rendre(); }
    else if (a === 'devis-copier' && ui.devisLien) { try { await navigator.clipboard.writeText(ui.devisLien.lien); toast('Lien copié.'); } catch { toast('Copie impossible : sélectionnez le lien.'); } }
  } catch (err) { el.disabled = false; toast(err.message); }
});

async function envoyerDevis(id) {
  const r = await api('POST', `/api/admin/devis/${encodeURIComponent(id)}/envoyer`, {});
  ui.devisLien = { numero: r.devis.numero, email: r.devis.client.email, lien: r.lien };
  toast(`Devis ${r.devis.numero} envoyé à ${r.devis.client.email}.`);
}
