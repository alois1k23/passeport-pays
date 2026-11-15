/* Comptoir — Paramètres > Journal : articles de la boutique (blog), en texte enrichi simple et sûr.
   Les pages publiques sont rendues par le serveur (référencement) ; l'aperçu vient aussi du serveur (même rendu). */
const JOURNAL_UI = { donnees: null, chargement: false, erreur: '', edite: null, apercu: '' };

function chargerJournal() {
  if (JOURNAL_UI.chargement) return;
  JOURNAL_UI.chargement = true;
  api('GET', '/api/admin/articles').then(d => { JOURNAL_UI.donnees = d; JOURNAL_UI.erreur = ''; }).catch(e => { JOURNAL_UI.erreur = e.message; }).finally(() => { JOURNAL_UI.chargement = false; rendre(); });
}
function urlJournal(slugArticle) {
  const base = SERVEUR.urlBoutique || (typeof etat !== 'undefined' && etat.serveur && etat.serveur.urlBoutique) || `/s/${encodeURIComponent(SERVEUR.slug || '')}`;
  return `${String(base).replace(/\/$/, '')}/journal${slugArticle ? '/' + encodeURIComponent(slugArticle) : ''}`;
}
function vueJournal() {
  const intro = `<section class="carte"><div class="carte-tete"><h2>Journal</h2></div>
    <p class="sous">Conseils, coulisses, nouveautés : chaque article a sa propre page, lisible par Google, et figure dans le plan de votre site. Un lien « Journal » apparaît en bas de votre boutique dès le premier article publié.</p></section>`;
  if (!(typeof enLigne === 'function' && enLigne())) return intro + '<section class="carte"><p class="sous">Disponible une fois votre boutique en ligne.</p></section>';
  const d = JOURNAL_UI.donnees;
  if (!d && JOURNAL_UI.erreur) return intro + `<section class="carte"><p class="encart alerte-encart" role="alert">${esc(JOURNAL_UI.erreur)}</p></section>`;
  if (!d) { chargerJournal(); return intro + '<section class="carte"><p class="sous">Chargement…</p></section>'; }
  const e = JOURNAL_UI.edite;
  const liste = d.articles.length ? `<ul class="journal-compte">${d.articles.map(a => `<li><b>${esc(a.titre)}</b> ${a.publie ? `<span class="pill good">Publié</span> <a class="lien" href="${esc(urlJournal(a.slug))}" target="_blank" rel="noopener">Voir</a>` : '<span class="pill muted">Brouillon</span>'}
      <button class="btn petit fantome" data-action="journal-modifier" data-id="${esc(a.id)}">Modifier</button> <button class="btn petit fantome danger" data-action="journal-supprimer" data-id="${esc(a.id)}">Supprimer</button></li>`).join('')}</ul>` : '<p class="sous">Aucun article pour l’instant.</p>';
  const form = e ? `<form data-form="journal" class="grille-form">
      <h3 id="journal-form-titre" tabindex="-1">${e.id ? 'Modifier l’article' : 'Nouvel article'}</h3>
      <label class="champ"><span>Titre</span><input name="titre" required maxlength="140" value="${esc(e.titre || '')}"></label>
      <label class="champ"><span>Résumé (affiché dans la liste et par Google, facultatif)</span><input name="resume" maxlength="300" value="${esc(e.resume || '')}"></label>
      <label class="champ"><span>Texte</span><textarea name="corps" rows="14" aria-describedby="aide-journal">${esc(e.corps || '')}</textarea></label>
      <p class="sous" id="aide-journal">Mise en forme : « ## » en début de ligne pour un intertitre, **gras**, *italique*, « - » pour une liste, [texte](https://adresse) pour un lien. Ligne vide entre deux paragraphes.</p>
      <label class="case"><input type="checkbox" name="publie" ${e.publie ? 'checked' : ''}> Publié (visible dans la boutique)</label>
      <div class="rangee"><button class="btn">Enregistrer</button><button type="button" class="btn fantome" data-action="journal-apercu">Aperçu</button><button type="button" class="btn fantome" data-action="journal-annuler">Annuler</button></div>
      ${JOURNAL_UI.apercu ? `<div class="encart apercu-journal" aria-label="Aperçu">${JOURNAL_UI.apercu}</div>` : ''}
    </form>` : '<button class="btn" data-action="journal-nouveau">Écrire un article</button>';
  return intro + `<section class="carte"><div class="carte-tete"><h2>Articles</h2>${d.articles.some(a => a.publie) ? `<a class="lien" href="${esc(urlJournal())}" target="_blank" rel="noopener">Voir le journal</a>` : ''}</div>${liste}</section><section class="carte">${form}</section>`;
}
// Saisie gardée avant un nouveau rendu (aperçu).
function lireFormJournal() {
  const f = document.querySelector('form[data-form="journal"]'); if (!f) return null;
  const d = new FormData(f);
  return { titre: d.get('titre'), resume: d.get('resume'), corps: d.get('corps'), publie: d.get('publie') === 'on' };
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-action^="journal-"]'); if (!b) return;
  const a = b.dataset.action;
  if (a === 'journal-nouveau') { JOURNAL_UI.edite = { publie: false }; JOURNAL_UI.apercu = ''; rendre(); document.getElementById('journal-form-titre')?.focus(); return; }
  if (a === 'journal-modifier') { JOURNAL_UI.edite = { ...JOURNAL_UI.donnees.articles.find(x => x.id === b.dataset.id) }; JOURNAL_UI.apercu = ''; rendre(); document.getElementById('journal-form-titre')?.focus(); return; }
  if (a === 'journal-annuler') { JOURNAL_UI.edite = null; JOURNAL_UI.apercu = ''; rendre(); return; }
  if (a === 'journal-apercu') {
    const v = lireFormJournal(); if (!v) return;
    JOURNAL_UI.edite = { ...JOURNAL_UI.edite, ...v };
    try { JOURNAL_UI.apercu = (await api('POST', '/api/admin/articles/apercu', { corps: v.corps })).rendu; } catch (err) { toast(err.message); }   // rendu du serveur : texte déjà échappé
    rendre(); return;
  }
  if (a === 'journal-supprimer') {
    if (!confirm('Supprimer cet article ? Sa page disparaît de la boutique.')) return;
    try { await api('DELETE', `/api/admin/articles/${encodeURIComponent(b.dataset.id)}`); toast('Article supprimé.'); JOURNAL_UI.donnees = null; } catch (err) { toast(err.message); }
    rendre();
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form="journal"]'); if (!f) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const v = lireFormJournal();
  try {
    const r = JOURNAL_UI.edite && JOURNAL_UI.edite.id ? await api('PUT', `/api/admin/articles/${encodeURIComponent(JOURNAL_UI.edite.id)}`, v) : await api('POST', '/api/admin/articles', v);
    toast(r.article.publie ? `« ${r.article.titre} » publié.` : `« ${r.article.titre} » enregistré en brouillon.`);
    JOURNAL_UI.edite = null; JOURNAL_UI.apercu = ''; JOURNAL_UI.donnees = null;
  } catch (err) { toast(err.message); }
  rendre();
}, true);
