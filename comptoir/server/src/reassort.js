/* Comptoir — rappels de réassort : pour les produits qui s'épuisent (café, thé, savon, croquettes…), le client peut
   demander, en commandant, un e-mail qui lui rappelle de recommander après N jours, avec un lien qui remplit son panier.
   - Accord exprès du client à la commande (case non cochée par défaut), arrêt en un clic dans chaque e-mail.
   - 12 rappels au plus par demande ; une nouvelle commande du même client pour les mêmes produits remplace l'ancienne.
   - Adresse et nom chiffrés au repos (comme les commandes) ; index d'e-mail pour l'effacement des données d'un client.
   - Ce n'est pas un abonnement payant : rien n'est débité sans que le client repasse commande. */
'use strict';
const crypto = require('node:crypto');

const MAX_RAPPELS = 12, MAX_PAR_BOUTIQUE = 20000, JOURS_MIN = 7, JOURS_MAX = 180;

function creerReassort({ db, pii, signer }) {
  db.exec(`CREATE TABLE IF NOT EXISTS reassorts (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, email_index TEXT NOT NULL, cle_produits TEXT NOT NULL, donnees TEXT NOT NULL, jours INTEGER NOT NULL, prochain INTEGER NOT NULL, envois INTEGER NOT NULL DEFAULT 0, cree_le INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS reassorts_prochain ON reassorts(prochain);
    CREATE INDEX IF NOT EXISTS reassorts_client ON reassorts(boutique_id, email_index);`);
  try { db.exec('ALTER TABLE reassorts ADD COLUMN commande_id TEXT'); } catch { /* déjà là */ }   // commande d'origine : remboursée ou annulée, le rappel tombe
  db.exec('CREATE INDEX IF NOT EXISTS reassorts_commande ON reassorts(commande_id)');
  const P = () => pii();
  const index = (bid, email) => { const x = P(); const e = String(email || '').trim().toLowerCase(); return x ? x.index(bid, e) : crypto.createHash('sha256').update(`${bid}|${e}`).digest('hex'); };
  const fermer = (bid, id, o) => { const x = P(); return x ? x.chiffrer(o, { boutique: bid, commande: `reassort:${id}` }) : JSON.stringify(o); };
  const ouvrir = (bid, id, t) => { const x = P(); try { return x && /^v\d\./.test(t) ? x.dechiffrer(t, { boutique: bid, commande: `reassort:${id}` }) : JSON.parse(t); } catch { return null; } };
  const jetonDe = id => `${id}.${signer(`reassort|${id}`)}`;

  /* Demande (après paiement) : { email, nom, langue, jours, lignes: [{ produitId, qte }], commandeId, depart }.
     depart : début du délai (précommande : la date d'expédition annoncée, pas le jour du paiement). */
  function creer(bid, d, maintenant = Date.now()) {
    const jours = Math.round(Number(d.jours));
    if (!d.email || !Number.isFinite(jours) || jours < JOURS_MIN || jours > JOURS_MAX) return null;
    const lignes = (d.lignes || []).filter(l => l && typeof l.produitId === 'string').slice(0, 20).map(l => ({ produitId: l.produitId, ...(typeof l.varianteId === 'string' && l.varianteId ? { varianteId: l.varianteId.slice(0, 80) } : {}), qte: Math.max(1, Math.min(20, Math.round(Number(l.qte) || 1))) }));
    if (!lignes.length) return null;
    // Clé : couples produit|variante sans doublon (deux tailles commandées séparément gardent chacune leur rappel).
    const fus = new Map(); for (const l of lignes) { const k = `${l.produitId}|${l.varianteId || ''}`; fus.set(k, { ...l, qte: Math.min(20, (fus.get(k) ? fus.get(k).qte : 0) + l.qte) }); }
    lignes.splice(0, lignes.length, ...fus.values());
    const idx = index(bid, d.email), cle = [...fus.keys()].sort().join(',');
    db.prepare('DELETE FROM reassorts WHERE boutique_id = ? AND email_index = ? AND cle_produits = ?').run(bid, idx, cle);   // même client, mêmes produits : la nouvelle commande remplace
    if (db.prepare('SELECT COUNT(*) n FROM reassorts WHERE boutique_id = ?').get(bid).n >= MAX_PAR_BOUTIQUE) return { plein: true };
    const id = 'ra_' + crypto.randomBytes(9).toString('hex');
    const depart = Math.max(maintenant, Number(d.depart) || 0);
    db.prepare('INSERT INTO reassorts (id, boutique_id, email_index, cle_produits, donnees, jours, prochain, cree_le, commande_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, bid, idx, cle, fermer(bid, id, { email: String(d.email).trim().toLowerCase(), nom: String(d.nom || '').slice(0, 120), langue: d.langue || null, lignes }), jours, depart + jours * 86400000, maintenant, d.commandeId || null);
    return { id, jeton: jetonDe(id) };
  }
  /* Rappels arrivés à échéance (lot borné), avec données déchiffrées. Illisibles (clé changée) : supprimés. */
  function dus(maintenant = Date.now(), limite = 500) {
    const out = [];
    for (const r of db.prepare('SELECT * FROM reassorts WHERE prochain <= ? ORDER BY prochain LIMIT ?').all(maintenant, limite)) {
      const d = ouvrir(r.boutique_id, r.id, r.donnees);
      if (!d) { db.prepare('DELETE FROM reassorts WHERE id = ?').run(r.id); continue; }
      if (!Array.isArray(d.lignes)) { db.prepare('DELETE FROM reassorts WHERE id = ?').run(r.id); continue; }
      out.push({ id: r.id, boutiqueId: r.boutique_id, jours: r.jours, envois: r.envois, prochain: r.prochain, creeLe: r.cree_le, ...d, jeton: jetonDe(r.id) });
    }
    return out;
  }
  /* Rappel pris en charge (envoyé ou sauté), de façon atomique : seul le processus qui fait passer « prochain » de sa
     valeur lue à la suivante l'envoie (aucun doublon si plusieurs processus tournent). Au 12e, la demande s'éteint. */
  function reserver(r, maintenant = Date.now()) {
    if (r.envois + 1 >= MAX_RAPPELS) return db.prepare('DELETE FROM reassorts WHERE id = ? AND prochain = ?').run(r.id, r.prochain).changes === 1;
    return db.prepare('UPDATE reassorts SET envois = envois + 1, prochain = ? WHERE id = ? AND prochain = ?').run(maintenant + r.jours * 86400000, r.id, r.prochain).changes === 1;
  }
  // Le client vient de recommander (avec ou sans la case) : ses rappels pour ces produits repartent de zéro.
  function repousser(bid, email, produitIds, maintenant = Date.now()) {
    const ids = new Set(produitIds);
    for (const r of db.prepare('SELECT id, cle_produits, jours FROM reassorts WHERE boutique_id = ? AND email_index = ?').all(bid, index(bid, email)))
      // Même produit, quelle que soit la variante.
      if (r.cle_produits.split(',').some(x => ids.has(x.split('|')[0]))) db.prepare('UPDATE reassorts SET prochain = ? WHERE id = ?').run(maintenant + r.jours * 86400000, r.id);
  }
  const commandesActives = bid => db.prepare('SELECT commande_id FROM reassorts WHERE boutique_id = ? AND commande_id IS NOT NULL').all(bid).map(r => r.commande_id);
  const supprimerCommande = commandeId => db.prepare('DELETE FROM reassorts WHERE commande_id = ?').run(commandeId).changes;
  const compterClient = (bid, email) => db.prepare('SELECT COUNT(*) n FROM reassorts WHERE boutique_id = ? AND email_index = ?').get(bid, index(bid, email)).n;
  const supprimerId = id => db.prepare('DELETE FROM reassorts WHERE id = ?').run(id).changes > 0;
  // Lien d'arrêt : identifiant signé (aucun secret gardé), comparaison à temps constant.
  function deJeton(jeton) {
    const [id, sig] = String(jeton || '').split('.');
    if (!/^ra_[0-9a-f]{18}$/.test(id || '') || !sig) return null;
    const attendu = Buffer.from(signer(`reassort|${id}`)), recu = Buffer.from(sig);
    if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) return null;
    const r = db.prepare('SELECT id, boutique_id FROM reassorts WHERE id = ?').get(id);
    return r ? { id: r.id, boutiqueId: r.boutique_id } : { id, boutiqueId: null, deja: true };
  }
  const compter = bid => db.prepare('SELECT COUNT(*) n FROM reassorts WHERE boutique_id = ?').get(bid).n;
  const supprimerClient = (bid, email) => db.prepare('DELETE FROM reassorts WHERE boutique_id = ? AND email_index = ?').run(bid, index(bid, email)).changes;
  const toutSupprimer = bid => db.prepare('DELETE FROM reassorts WHERE boutique_id = ?').run(bid);
  /* Rotation de la clé des données clients : demandes rechiffrées, index de l'adresse recalculé avec la clé courante
     (sinon l'effacement d'un client ne retrouverait plus ses rappels). */
  function renouvelerCle() {
    const x = P(); if (!x) return 0;
    let n = 0;
    for (const r of db.prepare('SELECT id, boutique_id, email_index, donnees FROM reassorts').all()) {
      const ctx = { boutique: r.boutique_id, commande: `reassort:${r.id}` };
      let d, ancien = false;
      try { d = /^v\d\./.test(r.donnees) ? x.dechiffrer(r.donnees, ctx) : JSON.parse(r.donnees); ancien = !/^v\d\./.test(r.donnees) || x.aRenouveler(r.donnees, ctx); } catch { continue; }
      if (!d || !d.email) continue;
      const idx = index(r.boutique_id, d.email);
      if (!ancien && idx === r.email_index) continue;
      db.prepare('UPDATE reassorts SET email_index = ?, donnees = ? WHERE id = ?').run(idx, fermer(r.boutique_id, r.id, d), r.id); n++;
    }
    return n;
  }
  return { creer, dus, reserver, repousser, commandesActives, supprimerCommande, compterClient, supprimerId, deJeton, compter, supprimerClient, toutSupprimer, renouvelerCle, MAX_RAPPELS };
}

const joursValides = j => { const n = Math.round(Number(j)); return Number.isFinite(n) && n >= JOURS_MIN && n <= JOURS_MAX ? n : null; };
module.exports = { creerReassort, joursValides, JOURS_MIN, JOURS_MAX };
