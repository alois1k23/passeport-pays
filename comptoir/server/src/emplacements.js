/* Stock sur plusieurs emplacements (magasin, entrepôt, dépôt…), avec transferts et registre des mouvements.
   Le stock total d'un produit (ou d'une variante) reste celui de la fiche produit, utilisé partout (boutique, caisse,
   réservations) ; les emplacements en donnent la répartition, et leur somme est toujours égale au total :
   - une vente en caisse prend d'abord dans les magasins, une vente en ligne d'abord dans les entrepôts ;
   - une annulation ou un retour remet les articles là d'où ils venaient ;
   - une correction du stock dans la fiche produit s'applique à l'emplacement principal (le premier) ;
   - un transfert déplace des articles d'un emplacement à un autre sans changer le total.
   Sans emplacement déclaré, rien ne change (le stock reste un seul nombre). */
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const TYPES = { magasin: 'Magasin', entrepot: 'Entrepôt', depot: 'Dépôt' };
const cleVariante = v => v || '';

function creer(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS emplacements (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, nom TEXT NOT NULL, type TEXT NOT NULL, ordre INTEGER NOT NULL, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS emplacements_boutique ON emplacements (boutique_id, ordre);
    CREATE TABLE IF NOT EXISTS stock_emplacements (boutique_id TEXT NOT NULL, produit_id TEXT NOT NULL, variante_id TEXT NOT NULL DEFAULT '', emplacement_id TEXT NOT NULL, quantite INTEGER NOT NULL CHECK (quantite >= 0), PRIMARY KEY (produit_id, variante_id, emplacement_id));
    CREATE INDEX IF NOT EXISTS stock_emplacements_boutique ON stock_emplacements (boutique_id, emplacement_id);
    CREATE TABLE IF NOT EXISTS stock_mouvements (id INTEGER PRIMARY KEY AUTOINCREMENT, boutique_id TEXT NOT NULL, le INTEGER NOT NULL, produit_id TEXT NOT NULL, variante_id TEXT NOT NULL DEFAULT '', emplacement_id TEXT NOT NULL, quantite INTEGER NOT NULL, type TEXT NOT NULL, reference TEXT);
    CREATE INDEX IF NOT EXISTS stock_mouvements_boutique ON stock_mouvements (boutique_id, le);`);
  const lister = bid => db.prepare('SELECT id, nom, type, ordre FROM emplacements WHERE boutique_id = ? ORDER BY ordre, cree_le').all(bid);
  const qte = (pid, vid, eid) => (db.prepare('SELECT quantite FROM stock_emplacements WHERE produit_id = ? AND variante_id = ? AND emplacement_id = ?').get(pid, cleVariante(vid), eid) || { quantite: 0 }).quantite;
  const poser = (bid, pid, vid, eid, n) => db.prepare('INSERT INTO stock_emplacements (boutique_id, produit_id, variante_id, emplacement_id, quantite) VALUES (?, ?, ?, ?, ?) ON CONFLICT (produit_id, variante_id, emplacement_id) DO UPDATE SET quantite = excluded.quantite').run(bid, pid, cleVariante(vid), eid, n);
  const noter = (bid, pid, vid, eid, n, type, reference, maintenant) => { if (n) db.prepare('INSERT INTO stock_mouvements (boutique_id, le, produit_id, variante_id, emplacement_id, quantite, type, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(bid, maintenant, pid, cleVariante(vid), eid, n, type, reference || null); };
  // Ordre de prélèvement selon le canal : magasins d'abord pour la caisse, entrepôts d'abord pour la vente en ligne.
  const ordrePour = (bid, canal) => {
    const l = lister(bid), prefere = canal === 'magasin' ? 'magasin' : 'entrepot';
    return [...l.filter(e => e.type === prefere), ...l.filter(e => e.type !== prefere)];
  };
  /* Unités stockables : produit sans variante → [produit, ''] ; produit à variantes → une unité par variante. */
  const unites = p => Array.isArray(p.variantes) && p.variantes.length ? p.variantes.map(v => [p.id, v.id, Math.max(0, v.stock || 0)]) : [[p.id, '', Math.max(0, p.stock || 0)]];

  const api = {
    TYPES, lister,
    actif: bid => !!db.prepare('SELECT 1 FROM emplacements WHERE boutique_id = ? LIMIT 1').get(bid),
    /* Nouvel emplacement. Le premier reçoit tout le stock existant (il devient l'emplacement principal). */
    creer(bid, { nom, type }, produits, maintenant = Date.now()) {
      const n = String(nom || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 60);
      if (!n) throw erreur(400, 'Nom de l’emplacement : obligatoire.', 'invalide');
      if (!TYPES[type]) throw erreur(400, 'Type d’emplacement inconnu.', 'invalide');
      const existants = lister(bid);
      if (existants.length >= 20) throw erreur(400, '20 emplacements au plus.', 'invalide');
      if (existants.some(e => e.nom.toLowerCase() === n.toLowerCase())) throw erreur(409, 'Un emplacement porte déjà ce nom.', 'doublon');
      const id = `em_${crypto.randomBytes(8).toString('base64url')}`;
      db.prepare('INSERT INTO emplacements (id, boutique_id, nom, type, ordre, cree_le) VALUES (?, ?, ?, ?, ?, ?)').run(id, bid, n, type, existants.length, maintenant);
      if (!existants.length) for (const p of produits) if (p.type !== 'drop') for (const [pid, vid, q] of unites(p)) { poser(bid, pid, vid, id, q); noter(bid, pid, vid, id, q, 'initial', null, maintenant); }
      return { id, nom: n, type, ordre: existants.length };
    },
    /* Suppression : seulement un emplacement vide et pas le dernier s'il reste du stock ailleurs… sauf le principal. */
    supprimer(bid, id) {
      const l = lister(bid), e = l.find(x => x.id === id);
      if (!e) throw erreur(404, 'Emplacement introuvable.', 'introuvable');
      const reste = db.prepare('SELECT COALESCE(SUM(quantite), 0) n FROM stock_emplacements WHERE boutique_id = ? AND emplacement_id = ?').get(bid, id).n;
      if (reste > 0) throw erreur(409, `Cet emplacement contient encore ${reste} article(s) : transférez-les d’abord.`, 'non_vide');
      if (l.length > 1 && l[0].id === id) throw erreur(409, 'L’emplacement principal ne se supprime qu’en dernier.', 'principal');
      db.prepare('DELETE FROM stock_emplacements WHERE emplacement_id = ?').run(id);
      db.prepare('DELETE FROM emplacements WHERE id = ?').run(id);
    },
    /* Répartition : { produitId: { varianteId|'': { emplacementId: quantite } } } */
    repartition(bid) {
      const out = {};
      for (const r of db.prepare('SELECT produit_id, variante_id, emplacement_id, quantite FROM stock_emplacements WHERE boutique_id = ?').all(bid)) ((out[r.produit_id] ||= {})[r.variante_id] ||= {})[r.emplacement_id] = r.quantite;
      return out;
    },
    /* Vente : retire n unités (déjà retirées du total) dans l'ordre du canal. Renvoie la répartition, pour un éventuel retour. */
    retirer(bid, pid, vid, n, { canal = 'web', reference, maintenant = Date.now() } = {}) {
      const pris = {};
      if (!api.actif(bid) || n <= 0) return pris;
      let reste = n;
      for (const e of ordrePour(bid, canal)) {
        if (!reste) break;
        const dispo = qte(pid, vid, e.id), k = Math.min(dispo, reste);
        if (k > 0) { poser(bid, pid, vid, e.id, dispo - k); noter(bid, pid, vid, e.id, -k, 'vente', reference, maintenant); pris[e.id] = k; reste -= k; }
      }
      return pris;
    },
    /* Retour ou annulation : remet les unités là d'où elles venaient (ou dans l'emplacement principal). */
    // Renvoie, par emplacement d'origine, les unités reprises de la répartition (retour partiel : le reste servira au suivant).
    remettre(bid, pid, vid, n, repartition, { reference, maintenant = Date.now() } = {}) {
      const repris = {};
      if (!api.actif(bid) || n <= 0) return repris;
      const l = lister(bid), ids = new Set(l.map(e => e.id));
      let reste = n;
      for (const [eid, k0] of Object.entries(repartition || {})) {
        if (!ids.has(eid) || !reste) continue;
        const k = Math.min(k0, reste); poser(bid, pid, vid, eid, qte(pid, vid, eid) + k); noter(bid, pid, vid, eid, k, 'retour', reference, maintenant); reste -= k; repris[eid] = k;
      }
      if (reste) { const e = l[0]; poser(bid, pid, vid, e.id, qte(pid, vid, e.id) + reste); noter(bid, pid, vid, e.id, reste, 'retour', reference, maintenant); }
      return repris;
    },
    /* Correction du total depuis la fiche produit : l'écart va à l'emplacement principal (une baisse prend ensuite ailleurs). */
    ajusterTotal(bid, pid, vid, ecart, { maintenant = Date.now() } = {}) {
      if (!api.actif(bid) || !ecart) return;
      const l = lister(bid);
      if (ecart > 0) { poser(bid, pid, vid, l[0].id, qte(pid, vid, l[0].id) + ecart); noter(bid, pid, vid, l[0].id, ecart, 'correction', null, maintenant); return; }
      let reste = -ecart;
      for (const e of l) { if (!reste) break; const d = qte(pid, vid, e.id), k = Math.min(d, reste); if (k) { poser(bid, pid, vid, e.id, d - k); noter(bid, pid, vid, e.id, -k, 'correction', null, maintenant); reste -= k; } }
    },
    /* Transfert entre deux emplacements : le total ne change pas. */
    transferer(bid, { produitId, varianteId, de, vers, quantite }, maintenant = Date.now()) {
      const l = lister(bid), n = Number(quantite);
      if (!l.some(e => e.id === de) || !l.some(e => e.id === vers) || de === vers) throw erreur(400, 'Choisissez deux emplacements différents.', 'invalide');
      if (!Number.isInteger(n) || n < 1 || n > 1000000) throw erreur(400, 'Quantité à transférer : nombre entier positif.', 'invalide');
      const dispo = qte(produitId, varianteId, de);
      if (dispo < n) throw erreur(409, `Seulement ${dispo} article(s) à cet emplacement.`, 'stock_insuffisant');
      const ref = `transfert ${crypto.randomBytes(4).toString('hex')}`;
      poser(bid, produitId, varianteId, de, dispo - n); noter(bid, produitId, varianteId, de, -n, 'transfert', ref, maintenant);
      poser(bid, produitId, varianteId, vers, qte(produitId, varianteId, vers) + n); noter(bid, produitId, varianteId, vers, n, 'transfert', ref, maintenant);
    },
    /* Après une écriture de la fiche produit (création, modification, API) : l'écart entre la fiche et les emplacements
       est porté à l'emplacement principal (une baisse prend ensuite ailleurs). */
    reconcilier(bid, p, maintenant = Date.now()) {
      if (!p || p.type === 'drop' || !api.actif(bid)) return;
      // Variantes disparues (renommées, retirées) ou produit passé à variantes : leurs lignes sont retirées (pas d'orphelin).
      const valides = new Set(unites(p).map(([, vid]) => cleVariante(vid)));
      for (const r of db.prepare('SELECT variante_id, emplacement_id, quantite FROM stock_emplacements WHERE boutique_id = ? AND produit_id = ?').all(bid, p.id)) {
        if (valides.has(r.variante_id)) continue;
        db.prepare('DELETE FROM stock_emplacements WHERE boutique_id = ? AND produit_id = ? AND variante_id = ? AND emplacement_id = ?').run(bid, p.id, r.variante_id, r.emplacement_id);
        noter(bid, p.id, r.variante_id, r.emplacement_id, -r.quantite, 'correction', 'variante disparue', maintenant);
      }
      for (const [pid, vid, q] of unites(p)) {
        const somme = db.prepare('SELECT COALESCE(SUM(quantite), 0) n FROM stock_emplacements WHERE produit_id = ? AND variante_id = ?').get(pid, cleVariante(vid)).n;
        if (somme !== q) api.ajusterTotal(bid, pid, vid, q - somme, { maintenant });
      }
    },
    /* Produit supprimé : ses lignes sont retirées (rien ne reste bloqué dans un emplacement). */
    purgerProduit(bid, pid, maintenant = Date.now()) {
      for (const r of db.prepare('SELECT variante_id, emplacement_id, quantite FROM stock_emplacements WHERE boutique_id = ? AND produit_id = ?').all(bid, pid)) noter(bid, pid, r.variante_id, r.emplacement_id, -r.quantite, 'suppression', 'produit supprimé', maintenant);
      db.prepare('DELETE FROM stock_emplacements WHERE boutique_id = ? AND produit_id = ?').run(bid, pid);
    },
    /* Lignes de produits qui n'existent plus (supprimés avant cette correction) : retirées. */
    nettoyer(bid, idsValides, maintenant = Date.now()) {
      const ok = new Set(idsValides);
      for (const pid of db.prepare('SELECT DISTINCT produit_id FROM stock_emplacements WHERE boutique_id = ?').all(bid).map(r => r.produit_id)) if (!ok.has(pid)) api.purgerProduit(bid, pid, maintenant);
    },
    /* Contrôle : pour chaque produit, somme des emplacements = stock de la fiche. Renvoie les écarts. */
    verifier(bid, produits) {
      if (!api.actif(bid)) return [];
      const rep = api.repartition(bid), ecarts = [];
      for (const p of produits) if (p.type !== 'drop') {
        const valides = new Set(unites(p).map(([, vid]) => cleVariante(vid)));
        for (const [pid, vid, q] of unites(p)) {
          const somme = Object.values((rep[pid] || {})[vid] || {}).reduce((a, x) => a + x, 0);
          if (somme !== q) ecarts.push({ produitId: pid, varianteId: vid || null, fiche: q, emplacements: somme });
        }
        for (const [vid, parEmp] of Object.entries(rep[p.id] || {})) if (!valides.has(vid)) ecarts.push({ produitId: p.id, varianteId: vid || null, fiche: 0, emplacements: Object.values(parEmp).reduce((a, x) => a + x, 0), orpheline: true });
      }
      return ecarts;
    },
    mouvements(bid, limite = 200) { return db.prepare('SELECT le, produit_id produitId, variante_id varianteId, emplacement_id emplacementId, quantite, type, reference FROM stock_mouvements WHERE boutique_id = ? ORDER BY id DESC LIMIT ?').all(bid, limite); }
  };
  return api;
}

module.exports = { creer, TYPES };
