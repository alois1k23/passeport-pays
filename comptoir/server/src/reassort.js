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
  const P = () => pii();
  const index = (bid, email) => { const x = P(); const e = String(email || '').trim().toLowerCase(); return x ? x.index(bid, e) : crypto.createHash('sha256').update(`${bid}|${e}`).digest('hex'); };
  const fermer = (bid, id, o) => { const x = P(); return x ? x.chiffrer(o, { boutique: bid, commande: `reassort:${id}` }) : JSON.stringify(o); };
  const ouvrir = (bid, id, t) => { const x = P(); try { return x && /^v\d\./.test(t) ? x.dechiffrer(t, { boutique: bid, commande: `reassort:${id}` }) : JSON.parse(t); } catch { return null; } };
  const jetonDe = id => `${id}.${signer(`reassort|${id}`)}`;

  /* Demande (après paiement) : { email, nom, langue, jours, lignes: [{ produitId, qte }] }. */
  function creer(bid, d, maintenant = Date.now()) {
    const jours = Math.round(Number(d.jours));
    if (!d.email || !Number.isFinite(jours) || jours < JOURS_MIN || jours > JOURS_MAX) return null;
    const lignes = (d.lignes || []).filter(l => l && typeof l.produitId === 'string').slice(0, 20).map(l => ({ produitId: l.produitId, qte: Math.max(1, Math.min(20, Math.round(Number(l.qte) || 1))) }));
    if (!lignes.length) return null;
    const idx = index(bid, d.email), cle = lignes.map(l => l.produitId).sort().join(',');
    db.prepare('DELETE FROM reassorts WHERE boutique_id = ? AND email_index = ? AND cle_produits = ?').run(bid, idx, cle);   // même client, mêmes produits : la nouvelle commande remplace
    if (db.prepare('SELECT COUNT(*) n FROM reassorts WHERE boutique_id = ?').get(bid).n >= MAX_PAR_BOUTIQUE) return null;
    const id = 'ra_' + crypto.randomBytes(9).toString('hex');
    db.prepare('INSERT INTO reassorts (id, boutique_id, email_index, cle_produits, donnees, jours, prochain, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, bid, idx, cle, fermer(bid, id, { email: String(d.email).trim().toLowerCase(), nom: String(d.nom || '').slice(0, 120), langue: d.langue || null, lignes }), jours, maintenant + jours * 86400000, maintenant);
    return { id, jeton: jetonDe(id) };
  }
  /* Rappels arrivés à échéance (lot borné), avec données déchiffrées. Illisibles (clé changée) : supprimés. */
  function dus(maintenant = Date.now(), limite = 500) {
    const out = [];
    for (const r of db.prepare('SELECT * FROM reassorts WHERE prochain <= ? ORDER BY prochain LIMIT ?').all(maintenant, limite)) {
      const d = ouvrir(r.boutique_id, r.id, r.donnees);
      if (!d) { db.prepare('DELETE FROM reassorts WHERE id = ?').run(r.id); continue; }
      out.push({ id: r.id, boutiqueId: r.boutique_id, jours: r.jours, envois: r.envois, ...d, jeton: jetonDe(r.id) });
    }
    return out;
  }
  // Rappel envoyé (ou sauté) : prochain dans N jours ; au 12e, la demande s'éteint.
  function avancer(id, maintenant = Date.now()) {
    const r = db.prepare('SELECT * FROM reassorts WHERE id = ?').get(id); if (!r) return;
    if (r.envois + 1 >= MAX_RAPPELS) db.prepare('DELETE FROM reassorts WHERE id = ?').run(id);
    else db.prepare('UPDATE reassorts SET envois = envois + 1, prochain = ? WHERE id = ?').run(maintenant + r.jours * 86400000, id);
  }
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
  return { creer, dus, avancer, supprimerId, deJeton, compter, supprimerClient, toutSupprimer, MAX_RAPPELS };
}

const joursValides = j => { const n = Math.round(Number(j)); return Number.isFinite(n) && n >= JOURS_MIN && n <= JOURS_MAX ? n : null; };
module.exports = { creerReassort, joursValides, JOURS_MIN, JOURS_MAX };
