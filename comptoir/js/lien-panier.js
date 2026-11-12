/* Comptoir — lien de panier : le marchand compose un panier (produits, quantités, code promo) et l'envoie par
   WhatsApp, Instagram, SMS ou e-mail. Le client arrive sur la boutique avec ce panier prêt et paie comme d'habitude
   (mêmes contrôles de prix, de stock et de risque : le lien ne fixe aucun prix). */
const LIEN_PANIER = { qte: {}, code: '' };
function lienPanierUrl() {
  const lignes = Object.entries(LIEN_PANIER.qte).filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`);
  if (!lignes.length) return '';
  const u = new URL(urlBoutiquePublique());
  u.searchParams.set('panier', lignes.join(','));
  if (LIEN_PANIER.code) u.searchParams.set('code', LIEN_PANIER.code);
  return u.toString();
}
function vueLienPanier() {
  const prods = etat.produits.filter(p => p.actif && !p.aVerifier && !(Array.isArray(p.variantes) && p.variantes.length));   // produits à variantes : le client choisit sur la fiche
  const codes = typeof Remises !== 'undefined' && Remises.codesValables ? Remises.codesValables(typeof etatVente === 'function' ? etatVente() : etat).map(c => c.code) : [];
  const url = lienPanierUrl();
  const total = prods.reduce((a, p) => a + (LIEN_PANIER.qte[p.id] || 0) * p.prix, 0);
  return `<section class="carte lien-panier"><div class="carte-tete"><h2>Lien de panier</h2><button class="btn petit fantome" data-action="lien-panier-fermer">Fermer</button></div>
    <p class="sous">Composez un panier et envoyez le lien à votre client (WhatsApp, Instagram, SMS, e-mail). Il arrive sur votre boutique avec ces articles prêts et paie comme d’habitude. Les prix et le stock sont ceux de la boutique au moment où il ouvre le lien.</p>
    <div class="table-wrap"><table class="table compacte"><thead><tr><th>Produit</th><th class="num">Prix</th><th class="num">Quantité</th></tr></thead><tbody>
      ${prods.map(p => `<tr><td>${esc(p.nom)}${p.type !== 'drop' && p.stock <= 0 ? ' <span class="pill muted">Épuisé</span>' : ''}</td><td class="num">${euros(p.prix)}</td><td class="num"><input type="number" min="0" max="20" step="1" value="${LIEN_PANIER.qte[p.id] || 0}" data-lien-qte="${esc(p.id)}" aria-label="Quantité de ${esc(p.nom)}" class="qte-lien"></td></tr>`).join('') || '<tr><td colspan="3" class="sous">Aucun produit en vente.</td></tr>'}
    </tbody></table></div>
    ${codes.length ? `<label class="champ"><span>Code promo (facultatif)</span><select data-lien-code><option value="">Aucun</option>${codes.map(c => `<option ${c === LIEN_PANIER.code ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
    ${url ? `<p class="sous">Panier : <b>${euros(total)}</b> avant livraison${LIEN_PANIER.code ? ' et remise' : ''}.</p>
      <p class="mono secret-integ">${esc(url)}</p>
      <div class="rangee"><button class="btn" data-action="lien-panier-copier">Copier le lien</button><a class="btn fantome" href="https://wa.me/?text=${encodeURIComponent(`Voici votre panier chez ${etat.boutique.nom} : ${url}`)}" target="_blank" rel="noopener">Envoyer par WhatsApp</a><a class="btn fantome" href="mailto:?subject=${encodeURIComponent(`Votre panier chez ${etat.boutique.nom}`)}&body=${encodeURIComponent(url)}">Par e-mail</a></div>
      <div class="qr-lien">${typeof qrSvg === 'function' ? qrSvg(url, { taille: 160, etiquette: 'QR code du lien de panier' }) : ''}</div>` : '<p class="sous">Choisissez au moins un produit.</p>'}
  </section>`;
}
document.addEventListener('input', e => {
  const q = e.target.closest('[data-lien-qte]'), c = e.target.closest('[data-lien-code]');
  if (!q && !c) return;
  if (q) LIEN_PANIER.qte[q.dataset.lienQte] = Math.max(0, Math.min(20, parseInt(q.value, 10) || 0));
  if (c) LIEN_PANIER.code = c.value;
  const id = q ? q.dataset.lienQte : null;
  rendre();
  if (id) { const n = document.querySelector(`[data-lien-qte="${CSS.escape(id)}"]`); if (n) n.focus(); }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action^="lien-panier"]'); if (!el) return;
  if (el.dataset.action === 'lien-panier') { ui.lienPanier = !ui.lienPanier; rendre(); return; }
  if (el.dataset.action === 'lien-panier-fermer') { ui.lienPanier = false; rendre(); return; }
  if (el.dataset.action === 'lien-panier-copier') { try { await navigator.clipboard.writeText(lienPanierUrl()); toast('Lien copié.'); } catch { toast('Copie impossible : sélectionnez le lien.'); } }
});
