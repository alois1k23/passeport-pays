/* Comptoir — journal de la boutique (blog) : articles en texte enrichi sûr, publiés en pages HTML complètes côté serveur
   (lisibles par les moteurs de recherche sans JavaScript), avec données structurées et plan du site.
   Texte enrichi : titres (## et ###), paragraphes, **gras**, *italique*, listes (- …), liens [texte](https://…).
   Aucun HTML n'est accepté : tout le reste est échappé. Les liens ne sont que https://, ouverts avec rel="nofollow noopener". */
'use strict';
const crypto = require('node:crypto');

const MAX_ARTICLES = 300, MAX_CORPS = 40000, MAX_PRODUITS = 6;
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ligne = t => String(t || '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();

/* Mise en forme d'une ligne : échappement d'abord, puis gras, italique et liens sur le texte échappé (rien ne peut
   réintroduire une balise). Lien : texte et adresse sans crochets ni parenthèses, https seulement. */
function enLigne(t) {
  return esc(t)
    .replace(/\[([^\]\n]{1,120})\]\((https:\/\/[^\s()<>"']{3,500})\)/g, (m, texte, url) => `<a href="${url}" rel="nofollow noopener">${texte}</a>`)
    .replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]{1,300})\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}
function versHtml(texte) {
  const blocs = [], lignes = String(texte || '').slice(0, MAX_CORPS).replace(/\r/g, '').split('\n');
  let para = [], liste = [];
  const fermerPara = () => { if (para.length) { blocs.push(`<p>${para.map(enLigne).join('<br>')}</p>`); para = []; } };
  const fermerListe = () => { if (liste.length) { blocs.push(`<ul>${liste.map(x => `<li>${enLigne(x)}</li>`).join('')}</ul>`); liste = []; } };
  for (const brut of lignes) {
    const l = brut.replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '');
    if (/^###\s+/.test(l)) { fermerPara(); fermerListe(); blocs.push(`<h3>${enLigne(l.replace(/^###\s+/, ''))}</h3>`); }
    else if (/^##\s+/.test(l)) { fermerPara(); fermerListe(); blocs.push(`<h2>${enLigne(l.replace(/^##\s+/, ''))}</h2>`); }
    else if (/^\s*[-•]\s+/.test(l)) { fermerPara(); liste.push(l.replace(/^\s*[-•]\s+/, '')); }
    else if (!l.trim()) { fermerPara(); fermerListe(); }
    else { fermerListe(); para.push(l.trim()); }
  }
  fermerPara(); fermerListe();
  return blocs.join('\n');
}
const texteBrut = texte => String(texte || '').slice(0, 2000).replace(/^#{2,3}\s+/gm, '').replace(/\*\*|\*/g, '').replace(/\[([^\]\n]{0,120})\]\([^)\s]{0,500}\)/g, '$1').replace(/\s+/g, ' ').trim();
const slugDe = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';

function creerArticles({ db, erreur }) {
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, slug TEXT NOT NULL, titre TEXT NOT NULL, resume TEXT NOT NULL DEFAULT '', corps TEXT NOT NULL DEFAULT '', publie INTEGER NOT NULL DEFAULT 0, publie_le INTEGER, cree_le INTEGER NOT NULL, maj_le INTEGER NOT NULL, UNIQUE (boutique_id, slug));
    CREATE INDEX IF NOT EXISTS articles_boutique ON articles(boutique_id, publie, publie_le);`);
  try { db.exec("ALTER TABLE articles ADD COLUMN produits TEXT NOT NULL DEFAULT '[]'"); } catch { /* déjà là */ }   // produits présentés sous l'article
  const lireProduits = t => { try { const v = JSON.parse(t || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, MAX_PRODUITS) : []; } catch { return []; } };
  const lire = r => r && { id: r.id, slug: r.slug, titre: r.titre, resume: r.resume, corps: r.corps, produits: lireProduits(r.produits), publie: !!r.publie, publieLe: r.publie_le, creeLe: r.cree_le, majLe: r.maj_le };
  // Listes sans le texte des articles (léger) ; le texte n'est lu que pour un article.
  const liste = (bid, { publies = false } = {}) => db.prepare(`SELECT id, slug, titre, resume, '' corps, produits, publie, publie_le, cree_le, maj_le FROM articles WHERE boutique_id = ? ${publies ? 'AND publie = 1' : ''} ORDER BY COALESCE(publie_le, cree_le) DESC`).all(bid).map(lire);
  const compter = bid => db.prepare('SELECT COUNT(*) n FROM articles WHERE boutique_id = ? AND publie = 1').get(bid).n;
  const complet = (bid, id) => lire(db.prepare('SELECT * FROM articles WHERE id = ? AND boutique_id = ?').get(String(id), bid));
  const publie = (bid, slug) => lire(db.prepare('SELECT * FROM articles WHERE boutique_id = ? AND slug = ? AND publie = 1').get(bid, String(slug || '')));
  /* existe(id) : le produit appartient à la boutique (contrôle fait par l'appelant, qui connaît les produits). */
  function enregistrer(bid, a, id = null, existe = () => true) {
    const titre = ligne(a.titre).slice(0, 140);
    if (!titre) throw erreur(400, 'Donnez un titre à l’article.', 'article_titre');
    const corps = String(a.corps || '').slice(0, MAX_CORPS), resume = ligne(a.resume).slice(0, 300);
    const avantProduits = id ? (db.prepare('SELECT produits FROM articles WHERE id = ? AND boutique_id = ?').get(id, bid) || {}).produits : null;
    // Clé absente (autre client de l'API) : la sélection existante est gardée.
    const produits = !('produits' in Object(a)) && avantProduits ? lireProduits(avantProduits) : [...new Set((Array.isArray(a.produits) ? a.produits : []).filter(x => typeof x === 'string' && x.length <= 40 && existe(x)))].slice(0, MAX_PRODUITS);
    const avant = id ? db.prepare('SELECT * FROM articles WHERE id = ? AND boutique_id = ?').get(id, bid) : null;
    // Adresse stable : un article renommé garde la sienne (les liens déjà partagés restent bons), sauf adresse demandée.
    const voulu = a.slug ? slugDe(a.slug) : avant ? avant.slug : slugDe(titre);
    if (id && !avant) throw erreur(404, 'Article introuvable.', 'introuvable');
    if (!id && db.prepare('SELECT COUNT(*) n FROM articles WHERE boutique_id = ?').get(bid).n >= MAX_ARTICLES) throw erreur(409, `${MAX_ARTICLES} articles au plus.`, 'articles_trop');
    // Adresse unique dans la boutique : suffixe -2, -3… si elle est prise.
    let slug = voulu, n = 2;
    while (db.prepare('SELECT 1 FROM articles WHERE boutique_id = ? AND slug = ? AND id IS NOT ?').get(bid, slug, id)) slug = `${voulu}-${n++}`.slice(0, 90);
    const pub = a.publie === true, maintenant = Date.now();
    const publieLe = pub ? (avant && avant.publie_le) || maintenant : null;
    if (avant) db.prepare('UPDATE articles SET slug = ?, titre = ?, resume = ?, corps = ?, produits = ?, publie = ?, publie_le = ?, maj_le = ? WHERE id = ?').run(slug, titre, resume, corps, JSON.stringify(produits), pub ? 1 : 0, publieLe, maintenant, id);
    else { id = 'art_' + crypto.randomBytes(8).toString('hex'); db.prepare('INSERT INTO articles (id, boutique_id, slug, titre, resume, corps, produits, publie, publie_le, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, bid, slug, titre, resume, corps, JSON.stringify(produits), pub ? 1 : 0, publieLe, maintenant, maintenant); }
    return lire(db.prepare('SELECT * FROM articles WHERE id = ?').get(id));
  }
  const supprimer = (bid, id) => db.prepare('DELETE FROM articles WHERE id = ? AND boutique_id = ?').run(String(id), bid).changes > 0;
  const toutSupprimer = bid => db.prepare('DELETE FROM articles WHERE boutique_id = ?').run(bid);
  return { liste, compter, complet, publie, enregistrer, supprimer, toutSupprimer };
}

module.exports = { creerArticles, versHtml, texteBrut, slugDe, esc };
