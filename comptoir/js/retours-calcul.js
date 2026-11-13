/* Retours partiels : remboursement d'une partie des articles d'une commande facturée, avec un avoir partiel numéroté.
   Calculs en centimes entiers, sans dérive d'arrondi :
   - les prix des lignes sont déjà remisés (code promo, palier, points de fidélité, remise du devis : c.remise n'est
     qu'informatif) ; le montant des articles (total − livraison) est réparti entre les lignes au prorata de prix × quantité,
     par la méthode du plus fort reste : la somme des lignes est exactement ce que le client a payé pour les articles,
     même avec des prix à fractions de centime ;
   - le montant remboursé pour r unités d'une ligne dont il reste u unités est (valeur restante de la ligne) × r / u,
     arrondi ; les dernières unités reçoivent exactement le reste : une ligne entièrement rendue est remboursée de son montant
     payé, au centime, même après un geste commercial ;
   - geste commercial (remise après vente, sans retour d'article) : montant réparti au plus fort reste entre les valeurs
     restantes des lignes ; l'avoir porte une ligne « Geste commercial » par article concerné (la TVA suit son taux) ;
   - la somme des avoirs partiels et de l'avoir final (remboursement du reste) est exactement le total de la facture.
   Répartition de l'argent : d'abord le paiement d'origine (carte bancaire, TWINT…), puis, au-delà de ce qui a été payé
   ainsi, la carte cadeau utilisée (recréditée). Les points de fidélité utilisés sont déjà déduits des prix : ils ne sont
   pas rendus lors d'un retour partiel (ils le sont si la commande entière est remboursée).
   Chaque avoir partiel est une pièce du journal inaltérable (type « avoir-partiel »), avec ses lignes et son montant.
   Module partagé : le serveur (remboursements, documents, journal) et l'application (décompte de TVA, export comptable)
   calculent avec le même code. */
(function (racine, fabrique) {
  const m = fabrique();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else racine.RetoursCalcul = m;
})(typeof window !== 'undefined' ? window : globalThis, () => {
'use strict';
// Erreur avec statut HTTP : sur le serveur, celle du routeur (renvoyée telle quelle au client) ; dans le navigateur, un message.
const erreur = (() => {
  try { if (typeof module !== 'undefined' && module.exports && typeof require === 'function') return require('../server/src/http.js').erreur; } catch { /* navigateur */ }
  return (statut, message, code) => Object.assign(new Error(message), { statut, code: code || 'erreur' });
})();

const cts = n => Math.round(Number(n || 0) * 100);

/* Montant payé pour chaque ligne (centimes) : les articles (total − livraison) répartis au plus fort reste. */
function netsLignes(c) {
  const poids = (c.lignes || []).map(l => Math.max(0, Number(l.prix) || 0) * (Number(l.qte) || 0));
  const somme = poids.reduce((a, b) => a + b, 0), articles = Math.max(0, cts(c.total) - cts(c.port));
  if (!somme) return poids.map(() => 0);
  const parts = poids.map(p => articles * p / somme), entieres = parts.map(Math.floor);
  let reste = articles - entieres.reduce((a, b) => a + b, 0);
  const ordre = parts.map((p, i) => [p - entieres[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of ordre) { if (reste <= 0) break; entieres[i]++; reste--; }
  return entieres;
}

/* Ce qui a déjà été rendu : unités et montants par ligne, port, argent, carte, points. */
function deja(c) {
  const n = (c.lignes || []).length, qte = Array(n).fill(0), montant = Array(n).fill(0);
  let port = 0, argent = 0, carte = 0, points = 0, total = 0;
  for (const p of c.retoursPartiels || []) {
    for (const l of p.lignes) { qte[l.index] += l.qte; montant[l.index] += l.montant; }
    port += p.port || 0; argent += p.argent || 0; carte += p.carte || 0; points += p.points || 0; total += p.montant;
  }
  return { qte, montant, port, argent, carte, points, total };
}

/* Geste commercial : demande = { geste: montant } (unités de la devise). Mêmes contrôles d'argent qu'un retour. */
function calculerGeste(c, demande, { argentPaye }) {
  if (!c.facture) throw erreur(409, 'Cette commande n’a pas de facture : pas de geste commercial possible.', 'sans_facture');
  if (c.canal === 'carte') throw erreur(409, 'Une carte cadeau vendue se rembourse en entier (si elle n’a pas servi).', 'carte_vendue');
  const montant = cts(demande.geste), d = deja(c), nets = netsLignes(c);
  if (typeof demande.geste !== 'number' || !Number.isInteger(montant) || montant <= 0 || Math.abs(Number(demande.geste) * 100 - montant) > 1e-6) throw erreur(400, 'Montant du geste commercial invalide.', 'montant_invalide');
  const restes = c.lignes.map((l, i) => (Number(l.qte) || 0) - d.qte[i] > 0 ? Math.max(0, nets[i] - d.montant[i]) : 0);
  const dispo = restes.reduce((a, b) => a + b, 0);
  if (montant > dispo) throw erreur(409, `Le geste commercial dépasse la valeur des articles non remboursés (${(dispo / 100).toFixed(2)}).`, 'depasse');
  // Répartition au plus fort reste, proportionnelle à la valeur restante de chaque ligne.
  const parts = restes.map(r => montant * r / dispo), entieres = parts.map(Math.floor);
  let reste = montant - entieres.reduce((a, b) => a + b, 0);
  for (const [, i] of parts.map((p, i) => [p - entieres[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])) { if (reste <= 0) break; entieres[i]++; reste--; }
  const lignes = entieres.map((m, i) => ({ index: i, qte: 0, montant: m })).filter(x => x.montant > 0);
  return repartirArgent(c, d, { lignes, port: 0, montant, geste: true }, argentPaye);
}

/* Argent d'abord sur le moyen de paiement d'origine, puis sur la carte cadeau ; jamais plus que ce qui a été payé. */
function repartirArgent(c, d, r, argentPaye) {
  if (d.total + r.montant > cts(c.total)) throw erreur(409, 'Le montant dépasserait le total de la facture.', 'depasse');
  const argent = Math.min(r.montant, Math.max(0, argentPaye - d.argent));
  const carteRestante = c.carteCadeau && !c.carteCadeau.liberee ? Math.max(0, cts(c.carteCadeau.montant) - d.carte) : 0;
  const carte = Math.min(r.montant - argent, carteRestante);
  if (argent + carte !== r.montant) throw erreur(409, 'Montant supérieur à ce qui a été payé pour cette commande.', 'depasse_paye');
  return { ...r, argent, carte };
}

/* Calcule un retour partiel. demande = { lignes: [{ index, qte }], port: bool }. argentPaye : centimes payés par le
   moyen d'origine (hors carte cadeau). Lève une erreur 400/409 explicite si la demande n'est pas possible. */
function calculer(c, demande, { argentPaye }) {
  if (Object.hasOwn(demande, 'geste')) {
    if ((Array.isArray(demande.lignes) && demande.lignes.length) || demande.port === true) throw erreur(400, 'Un geste commercial ne se combine pas avec un retour d’articles : faites deux opérations.', 'geste_mixte');
    return calculerGeste(c, demande, { argentPaye });
  }
  if (!c.facture) throw erreur(409, 'Cette commande n’a pas de facture : rien à rembourser partiellement.', 'sans_facture');
  if (c.canal === 'carte') throw erreur(409, 'Une carte cadeau vendue se rembourse en entier (si elle n’a pas servi).', 'carte_vendue');
  const d = deja(c), nets = netsLignes(c), demandees = Array.isArray(demande.lignes) ? demande.lignes : [];
  const vues = new Set(), lignes = [];
  for (const x of demandees) {
    if (!x || typeof x !== 'object' || typeof x.index !== 'number') throw erreur(400, 'Article du retour inconnu.', 'ligne_invalide');
    const i = x.index, q = Number(x.qte);
    if (!Number.isInteger(i) || i < 0 || i >= c.lignes.length || vues.has(i)) throw erreur(400, 'Article du retour inconnu.', 'ligne_invalide');
    if (!Number.isInteger(q) || q < 0) throw erreur(400, 'Quantité retournée invalide.', 'qte_invalide');
    vues.add(i);
    if (!q) continue;
    const l = c.lignes[i], n = Number(l.qte) || 0, restant = n - d.qte[i];
    if (q > restant) throw erreur(409, `« ${l.nom} » : ${restant} unité${restant > 1 ? 's' : ''} au plus peu${restant > 1 ? 'vent' : 't'} encore être retournée${restant > 1 ? 's' : ''}.`, 'qte_trop');
    // Valeur restante de la ligne (moins les unités déjà rendues et la part d'un geste commercial) répartie sur les unités restantes.
    const valeur = Math.max(0, nets[i] - d.montant[i]), montant = q === restant ? valeur : Math.round(valeur * q / restant);
    lignes.push({ index: i, qte: q, montant });
  }
  const port = demande.port === true && cts(c.port) > 0 && !d.port ? cts(c.port) : 0;
  if (demande.port === true && !port && cts(c.port) > 0) throw erreur(409, 'La livraison a déjà été remboursée.', 'port_deja');
  // Au moins un article : un avoir porte toujours sur des articles (EN 16931 : une ligne au moins) ; la livraison seule
  // se rembourse avec le premier article retourné, ou avec la commande entière.
  if (!lignes.length) throw erreur(400, 'Choisissez au moins un article à rembourser (la livraison se rembourse avec un article).', 'retour_vide');
  // Tous les articles seraient rendus : c'est un remboursement complet (avoir final, points rendus, statut « remboursée »).
  // Il inclut la livraison : en cas de rétractation totale, les frais de livraison standard sont dus au client
  // (directive 2011/83/UE, art. 13).
  const toutRendu = c.lignes.every((l, i) => d.qte[i] + (lignes.find(x => x.index === i) || { qte: 0 }).qte >= (Number(l.qte) || 0));
  if (toutRendu) throw erreur(409, 'Ce retour couvre tous les articles restants : utilisez « Rembourser » pour la commande entière (livraison comprise).', 'retour_complet');
  const montant = lignes.reduce((a, l) => a + l.montant, 0) + port;
  // Articles dont toute la valeur a déjà été rendue (geste commercial) : retour sans remboursement ni avoir (aucun montant),
  // seulement le stock et le suivi des unités rendues.
  if (montant <= 0) return { lignes, port: 0, montant: 0, argent: 0, carte: 0, sansMontant: true };
  return repartirArgent(c, d, { lignes, port, montant }, argentPaye);
}

/* Commande telle que la présente un avoir partiel (facture électronique, PDF, sceau) : lignes retournées à leur prix
   payé (déjà remisé), livraison si elle est rendue, total = montant de l'avoir. Sans retoursPartiels : la vue est une
   pièce à part entière, jamais recalculée comme avoir final. */
function vuePartielle(c, piece) {
  // Geste commercial : une ligne « Geste commercial » par article concerné, au taux de TVA de l'article.
  const lignes = piece.geste ? piece.lignes.map(x => ({ ...c.lignes[x.index], nom: `Geste commercial : ${c.lignes[x.index].nom}`, prix: x.montant / 100, qte: 1 }))
    : piece.lignes.map(x => ({ ...c.lignes[x.index], qte: x.qte }));
  const articles = lignes.reduce((a, l) => a + l.prix * l.qte, 0);
  const avantGeste = remiseGeste(c, Math.round(articles * 100) + (piece.port || 0) - piece.montant, piece);
  // Ventilation : celle enregistrée sur la pièce à son émission (document figé) ; à défaut, recalculée.
  return { ...c, retoursPartiels: undefined, lignes, sousTotal: Math.round(articles * 100) / 100, ...avantGeste, port: (piece.port || 0) / 100, total: piece.montant / 100,
    ventilation: piece.ventilation !== undefined ? piece.ventilation : ventilationPiece(c, piece), portParTaux: portVentile(c, piece.port || 0),
    carteCadeau: piece.carte ? { ...(c.carteCadeau || {}), montant: piece.carte / 100 } : undefined, arrondi: undefined, encaisse: undefined,
    avoir: { numero: piece.numero, date: piece.date, montant: piece.montant / 100, libelle: piece.geste ? `Avoir sur la facture ${c.facture} : geste commercial, sans retour d’article.` : `Avoir partiel sur la facture ${c.facture} : retour de ${piece.lignes.reduce((a, x) => a + x.qte, 0)} article${piece.lignes.reduce((a, x) => a + x.qte, 0) > 1 ? 's' : ''}${piece.port ? ' et livraison' : ''}.` } };
}

/* Commande telle que la présente l'avoir final quand des avoirs partiels existent : ce qui restait (unités, montants,
   livraison), total = montant de l'avoir final. */
function vueReste(c) {
  const d = deja(c), lignes = [];
  c.lignes.forEach((l, i) => { const q = (Number(l.qte) || 0) - d.qte[i]; if (q > 0) lignes.push({ ...l, qte: q }); });
  const port = d.port ? 0 : cts(c.port);
  const avoir = c.avoir ? { ...c.avoir, libelle: c.avoir.libelle || `Avoir pour le solde de la facture ${c.facture} (après ${c.retoursPartiels.filter(p => p.numero).map(p => p.numero).join(', ')}).` } : c.avoir;
  const reste = resteAvoir(c), articles = lignes.reduce((a, l) => a + l.prix * l.qte, 0);
  return { ...c, retoursPartiels: undefined, lignes, sousTotal: Math.round(articles * 100) / 100, ...remiseGeste(c, Math.round(articles * 100) + port - reste), port: port / 100, total: reste / 100,
    ventilation: c.avoir && c.avoir.ventilation !== undefined ? c.avoir.ventilation : ventilationReste(c), portParTaux: portVentile(c, port),
    carteCadeau: c.carteCadeau ? { ...c.carteCadeau, montant: Math.max(0, cts(c.carteCadeau.montant) - d.carte) / 100 } : c.carteCadeau, arrondi: undefined, encaisse: undefined, avoir };
}

/* Après un geste commercial, les articles valent moins que leur prix : l'écart est présenté comme une remise nommée
   (sinon la facture électronique l'appellerait « Arrondi »). Sans geste, rien ne change (remise 0). */
function remiseGeste(c, ecart, pieceCourante = null) {
  // « Antérieur » = placé avant dans la liste des pièces (ordre d'émission), jamais d'après l'heure : deux pièces de la même
  // milliseconde ou une horloge recalée ne changent pas le contenu recalculé d'une pièce scellée.
  const liste = c.retoursPartiels || [], k = pieceCourante ? liste.findIndex(p => p.numero === pieceCourante.numero) : liste.length;
  const geste = liste.slice(0, k < 0 ? liste.length : k).some(p => p.geste);
  return geste && ecart > 0 ? { remise: ecart / 100, motifRemise: 'Geste commercial déjà accordé' } : { remise: 0, motifRemise: null };
}

/* Montant de l'avoir final (centimes) : total de la facture moins les avoirs partiels. */
const resteAvoir = c => cts(c.total) - deja(c).total;

/* Ventilation par taux de TVA (centimes TTC), pour que les avoirs compensent la facture taux par taux :
   - facture : même calcul que la facture imprimée et la facture électronique (total réparti au prorata des lignes) ;
   - avoir partiel : lignes rendues à leur taux, et livraison remboursée répartie entre les taux comme sur la facture ;
   - avoir final : exactement ce qui reste de la facture, taux par taux.
   null si un taux manque (anciennes commandes sans taux figé) : les documents gardent alors leur calcul habituel. */
const tauxL = (c, l) => typeof l.tauxTva === 'number' ? l.tauxTva : typeof c.tauxTva === 'number' ? c.tauxTva : null;
function ventilationFacture(c) {
  if (!(c.lignes || []).length || c.lignes.some(l => tauxL(c, l) === null)) return null;
  const ttc = Number(c.total), base = c.lignes.reduce((a, l) => a + l.prix * l.qte, 0) || 1, groupes = {};
  for (const l of c.lignes) { const t = tauxL(c, l); groupes[t] = (groupes[t] || 0) + ttc * (l.prix * l.qte) / base; }
  const parTaux = Object.entries(groupes).map(([t, v]) => [t, Math.round(v * 100)]).sort((a, b) => b[1] - a[1]);
  parTaux[0][1] += cts(ttc) - parTaux.reduce((a, x) => a + x[1], 0);
  return Object.fromEntries(parTaux);
}
function portParTaux(c) {
  const poids = {}; for (const l of c.lignes) { const t = tauxL(c, l); poids[t] = (poids[t] || 0) + l.prix * l.qte; }
  const taux = Object.keys(poids), somme = taux.reduce((a, t) => a + poids[t], 0) || 1, port = cts(c.port);
  const parts = taux.map(t => port * poids[t] / somme), ent = parts.map(Math.floor);
  let reste = port - ent.reduce((a, b) => a + b, 0);
  for (const [, i] of parts.map((p, i) => [p - ent[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])) { if (reste <= 0) break; ent[i]++; reste--; }
  return Object.fromEntries(taux.map((t, i) => [t, ent[i]]));
}
function ventilationPiece(c, piece) {
  if (!ventilationFacture(c)) return null;
  const v = {};
  for (const x of piece.lignes) { const t = tauxL(c, c.lignes[x.index]); v[t] = (v[t] || 0) + x.montant; }
  if (piece.port) for (const [t, m] of Object.entries(portParTaux(c))) v[t] = (v[t] || 0) + m;
  return v;
}
function ventilationReste(c) {
  const f = ventilationFacture(c); if (!f) return null;
  const v = { ...f };
  for (const p of c.retoursPartiels || []) { const vp = p.ventilation || ventilationPiece(c, p); if (!vp) return null; for (const [t, m] of Object.entries(vp)) v[t] = (v[t] || 0) - m; }
  // Arrondis indépendants (facture par taux, avoirs par ligne) : un centime négatif sur un taux est repris sur le plus
  // grand taux positif, le total restant exact (écart d'au plus quelques centimes par taux, au lieu d'abandonner).
  for (const t of Object.keys(v)) if (v[t] < 0) {
    const plus = Object.keys(v).filter(k => v[k] > 0).sort((a, b) => v[b] - v[a])[0];
    if (plus === undefined || v[plus] + v[t] < 0) return null;
    v[plus] += v[t]; v[t] = 0;
  }
  return v;
}
/* Livraison remboursée par une pièce, par taux (centimes TTC) : comme sur la facture. Avoir final : la part restante. */
function portVentile(c, centimes) { if (!centimes || !ventilationFacture(c)) return null; return centimes === cts(c.port) ? portParTaux(c) : null; }

/* Pièces d'avoir d'une commande, dans l'ordre d'émission, chacune avec sa « vue » (lignes, total, livraison) : pour le
   décompte de TVA et l'export comptable, avec les mêmes montants que les documents émis et que le journal scellé. */
function piecesAvoir(c) {
  const out = [];
  for (const p of c.retoursPartiels || []) if (p.numero) out.push({ numero: p.numero, date: p.date, geste: !!p.geste, vue: vuePartielle(c, p) });
  if (c.avoir && c.avoir.numero) out.push({ numero: c.avoir.numero, date: c.avoir.date, geste: false, final: true, vue: (c.retoursPartiels || []).length ? vueReste(c) : c });
  return out;
}

/* Ventilation imposée d'une vue d'avoir, si elle est utilisable : somme = total, pas de montant négatif, et chaque taux
   des lignes présent (sinon une ligne n'aurait pas de base de TVA). Renvoie [{ taux, ttc (en unités) }] ou null. */
function ventilationImposee(c, tauxLigne) {
  if (!c.ventilation) return null;
  const ent = Object.entries(c.ventilation).filter(([, m]) => m !== 0);
  if (ent.some(([, m]) => m < 0) || ent.reduce((a, [, m]) => a + m, 0) !== cts(c.total)) return null;
  const presents = new Set(ent.map(([t]) => Number(t)));
  if (!(c.lignes || []).every(l => presents.has(tauxLigne(l)))) return null;
  return ent.map(([t, m]) => ({ taux: Number(t), ttc: m / 100 }));
}

return { netsLignes, deja, calculer, vuePartielle, vueReste, resteAvoir, piecesAvoir, ventilationFacture, ventilationPiece, ventilationReste, ventilationImposee, cts };

});
