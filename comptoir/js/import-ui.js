/* Comptoir — import d'un catalogue existant (Produits > Importer un catalogue).
   Le fichier CSV exporté de Shopify, WooCommerce, PrestaShop ou d'un tableur est lu, un aperçu montre ce qui sera créé
   (et ce qui est ignoré, ligne par ligne), puis l'import se fait en un clic. En ligne, le serveur valide et enregistre,
   et récupère les photos ; en démonstration, tout reste dans ce navigateur (sans les photos). */
const IMPORT_CSV = { texte: '', nomFichier: '' };

function resumeImportLocal(texte) {
  const r = ImportCatalogue.convertir(texte);
  const deja = new Set(etat.produits.map(p => p.refImport).filter(Boolean));
  const nouveaux = r.produits.filter(p => !deja.has(p.refImport));
  return { format: r.format, nomFormat: r.nomFormat, total: r.produits.length, nouveaux: nouveaux.length, dejaImportes: r.produits.length - nouveaux.length, avecPhoto: 0,
    erreurs: r.erreurs.slice(0, 200), nbErreurs: r.erreurs.length,
    apercu: nouveaux.slice(0, 50).map(p => ({ nom: p.nom, prix: p.prix, prixReference: p.prixReference || null, stock: p.stock, categorie: p.categorie, variantes: p.variantes ? p.variantes.length : 0, photo: false, actif: p.actif })),
    _produits: nouveaux };
}

function dialogueImport(res) {
  return new Promise(resoudre => {
    const retour = document.activeElement, enLigneOk = typeof enLigne === 'function' && enLigne();
    const d = document.createElement('dialog');
    d.className = 'dialogue-import'; d.setAttribute('aria-labelledby', 'import-titre');
    const avert = res.erreurs.filter(e => e.avertissement), refus = res.erreurs.filter(e => !e.avertissement);
    const ligneErr = e => `<li>${e.ligne ? `<span class="mono">ligne ${esc(String(e.ligne))}</span> · ` : ''}${esc(e.message)}</li>`;
    d.innerHTML = `<div class="pile">
      <h2 id="import-titre">Importer ${esc(IMPORT_CSV.nomFichier || 'le catalogue')}</h2>
      ${res.format ? `<p>Format reconnu : <b>${esc(res.nomFormat)}</b>. <b>${res.nouveaux}</b> produit${res.nouveaux > 1 ? 's' : ''} à créer${res.dejaImportes ? `, ${res.dejaImportes} déjà importé${res.dejaImportes > 1 ? 's' : ''} (ignoré${res.dejaImportes > 1 ? 's' : ''})` : ''}.</p>` : ''}
      ${res.apercu.length ? `<div class="table-wrap"><table class="table compacte"><caption class="sous">Aperçu${res.nouveaux > res.apercu.length ? ` des ${res.apercu.length} premiers` : ''}</caption><thead><tr><th>Produit</th><th class="num">Prix</th><th class="num">Stock</th><th class="col-etat">État</th></tr></thead><tbody>
        ${res.apercu.map(p => `<tr><td>${esc(p.nom)}${p.categorie ? `<br><span class="sous">${esc(p.categorie)}</span>` : ''}</td><td class="num">${esc(euros(p.prix))}${p.prixReference ? `<br><s class="sous">${esc(euros(p.prixReference))}</s>` : ''}</td><td class="num">${p.stock}${p.variantes ? `<br><span class="sous">${p.variantes} variantes</span>` : ''}</td><td class="col-etat">${p.actif ? 'En ligne' : 'Masqué'}${p.photo ? ' · photo' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${refus.length ? `<details${res.nouveaux ? '' : ' open'}><summary>${res.nbErreurs - avert.length} ligne${res.nbErreurs - avert.length > 1 ? 's' : ''} ignorée${res.nbErreurs - avert.length > 1 ? 's' : ''}</summary><ul class="liste-import">${refus.slice(0, 50).map(ligneErr).join('')}</ul></details>` : ''}
      ${avert.length ? `<details open><summary>${avert.length} point${avert.length > 1 ? 's' : ''} à vérifier</summary><ul class="liste-import">${avert.slice(0, 50).map(ligneErr).join('')}</ul></details>` : ''}
      ${res.nouveaux && enLigneOk && res.avecPhoto ? `<label class="case"><input type="checkbox" name="photos" checked> Récupérer les photos (${res.avecPhoto}), en arrière-plan</label>` : ''}
      ${res.nouveaux && !enLigneOk ? '<p class="sous">Démonstration : les produits restent dans ce navigateur, sans les photos.</p>' : ''}
      <p class="erreur" role="alert" hidden></p>
      <div class="rangee">${res.nouveaux ? `<button class="btn" type="button" data-importer>Importer ${res.nouveaux} produit${res.nouveaux > 1 ? 's' : ''}</button>` : ''}<button class="btn fantome" type="button" data-annuler>${res.nouveaux ? 'Annuler' : 'Fermer'}</button></div>
    </div>`;
    document.body.appendChild(d);
    let fini = false;
    const fin = v => { if (fini) return; fini = true; d.close(); d.remove(); if (retour && document.contains(retour)) retour.focus(); resoudre(v); };
    d.querySelector('[data-annuler]').addEventListener('click', () => fin(null));
    d.addEventListener('cancel', e => { e.preventDefault(); fin(null); });
    const bouton = d.querySelector('[data-importer]');
    if (bouton) bouton.addEventListener('click', () => { const c = d.querySelector('input[name=photos]'); fin({ photos: c ? c.checked : false }); });
    d.showModal();
    (bouton || d.querySelector('[data-annuler]')).focus();
  });
}

async function importerCatalogue(fichier) {
  if (!fichier) return;
  if (fichier.size > 1.8 * 1024 * 1024) { toast('Fichier trop lourd (1,8 Mo au plus) : exportez votre catalogue en plusieurs parties.'); return; }
  IMPORT_CSV.texte = await fichier.text(); IMPORT_CSV.nomFichier = fichier.name;
  const enLigneOk = typeof enLigne === 'function' && enLigne();
  let res;
  try { res = enLigneOk ? await api('POST', '/api/admin/produits/importer-csv/apercu', { csv: IMPORT_CSV.texte }) : resumeImportLocal(IMPORT_CSV.texte); }
  catch (e) { toast(e.message); return; }
  const choix = await dialogueImport(res);
  if (!choix) return;
  try {
    if (enLigneOk) {
      const r = await api('POST', '/api/admin/produits/importer-csv', { csv: IMPORT_CSV.texte, photos: choix.photos });
      await rechargerEtat();
      toast(`${r.importes} produit${r.importes > 1 ? 's' : ''} importé${r.importes > 1 ? 's' : ''}${r.photosEnCours ? ` ; ${r.photosEnCours} photo${r.photosEnCours > 1 ? 's' : ''} en cours de récupération` : ''}.`);
    } else {
      for (const p of res._produits) { const { images, ...propre } = p; etat.produits.push({ ...propre, type: 'stock', teinte: Math.floor(Math.random() * 360), id: nouvelId('p'), historiquePrix: [{ date: Date.now(), prix: p.prix }] }); }
      sauver();
      toast(`${res._produits.length} produit${res._produits.length > 1 ? 's' : ''} importé${res._produits.length > 1 ? 's' : ''}.`);
    }
  } catch (e) { toast(e.message); }
  IMPORT_CSV.texte = '';
  rendre();
}

document.addEventListener('click', e => {
  if (!e.target.closest('[data-action="importer-catalogue"]')) return;
  const input = document.getElementById('import-csv');
  if (input) { input.value = ''; input.click(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'import-csv') importerCatalogue(e.target.files && e.target.files[0]);
});
