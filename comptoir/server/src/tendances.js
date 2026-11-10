// Collecte des signaux de demande pour les produits stars, rafraîchie périodiquement.
// Sources, toutes facultatives sauf la première :
//  1. Ventes observées sur Comptoir : commandes payées des 28 derniers jours, toutes boutiques,
//     agrégées par produit du catalogue. Un produit n'apparaît que s'il est vendu par au moins
//     TENDANCES_MIN_BOUTIQUES boutiques (2 par défaut) : aucune boutique ne peut déduire les ventes d'une autre.
//  2. Google Trends, via l'API SerpApi (SERPAPI_KEY) : évolution des recherches sur 4 semaines,
//     par pays (CH, FR, BE). Les requêtes tournent sur le catalogue (TENDANCES_REQUETES_MAX par passage).
//  3. Fichier importé (TENDANCES_FICHIER) : export JSON d'un outil d'analyse (Minea, Jungle Scout,
//     relevés de meilleures ventes faits à la main…) : [{ "id" ou "nom", "evolution", "niveau", "pays" }].
// Les pages des places de marché (Amazon, Galaxus, AliExpress…) ne sont pas aspirées : leurs conditions
// d'utilisation l'interdisent. Elles peuvent alimenter la source 3, ou une API officielle ajoutée ici.
'use strict';
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tendances (
  cle TEXT PRIMARY KEY,          -- source|pays|produit
  donnees TEXT NOT NULL,
  maj_le INTEGER NOT NULL
);`;
const JOUR = 86400000;

function creerCollecte({ db, env = {}, catalogue, fetchImpl = fetch, journal = console }) {
  db.exec(SCHEMA);
  const minBoutiques = Number(env.TENDANCES_MIN_BOUTIQUES || 2);
  const requetesMax = Number(env.TENDANCES_REQUETES_MAX || 30);
  const ecrire = (cle, donnees, t = Date.now()) => db.prepare('INSERT INTO tendances (cle, donnees, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET donnees = excluded.donnees, maj_le = excluded.maj_le').run(cle, JSON.stringify(donnees), t);
  const meta = { derniere: null, sources: {} };

  /* 1. Ventes Comptoir agrégées par produit source et par pays de boutique. */
  function collecterVentes(maintenant = Date.now()) {
    const depuis = maintenant - 28 * JOUR;
    const lignes = db.prepare(`SELECT c.date, c.donnees, b.id AS boutique, b.config FROM commandes c JOIN boutiques b ON b.id = c.boutique_id
      WHERE c.date >= ? AND c.statut NOT IN ('attente', 'annulee', 'remboursee')`).all(depuis);
    const sources = new Map(db.prepare('SELECT id, donnees FROM produits').all().map(r => { try { return [r.id, JSON.parse(r.donnees).source || null]; } catch { return [r.id, null]; } }));
    const agr = {};
    for (const l of lignes) {
      let cmd, pays;
      try { cmd = JSON.parse(l.donnees); pays = JSON.parse(l.config).boutique.pays || 'ch'; } catch { continue; }
      for (const ligne of cmd.lignes || []) {
        const src = sources.get(ligne.produitId);
        if (!src) continue;
        for (const p of [pays, 'tous']) {
          const k = `${p}|${src}`;
          const a = agr[k] = agr[k] || { n7: 0, n28: 0, boutiques: new Set() };
          a.n28 += ligne.qte || 1;
          if (l.date >= maintenant - 7 * JOUR) a.n7 += ligne.qte || 1;
          a.boutiques.add(l.boutique);
        }
      }
    }
    db.prepare("DELETE FROM tendances WHERE cle LIKE 'ventes|%'").run();
    let n = 0;
    for (const [k, a] of Object.entries(agr)) {
      if (a.boutiques.size < minBoutiques) continue;       // confidentialité
      ecrire(`ventes|${k}`, { n7: a.n7, n28: a.n28, boutiques: a.boutiques.size }, maintenant); n++;
    }
    meta.sources.ventes = { actif: true, majLe: maintenant, detail: `${n} produit${n > 1 ? 's' : ''} vendus dans au moins ${minBoutiques} boutiques sur 28 jours` };
  }

  /* 2. Google Trends via SerpApi : on interroge d'abord les produits les plus anciennement mis à jour. */
  async function collecterTrends(maintenant = Date.now()) {
    if (!env.SERPAPI_KEY) { meta.sources.trends = { actif: false, detail: 'Ajoutez une clé SerpApi (SERPAPI_KEY) pour suivre les recherches Google en Suisse, en France et en Belgique.' }; return; }
    const paysActifs = [...new Set(db.prepare('SELECT config FROM boutiques').all().map(r => { try { return JSON.parse(r.config).boutique.pays; } catch { return 'ch'; } }))].filter(p => ['ch', 'fr', 'be'].includes(p));
    const anciennete = new Map(db.prepare("SELECT cle, maj_le FROM tendances WHERE cle LIKE 'trends|%'").all().map(r => [r.cle, r.maj_le]));
    const file = [];
    for (const pays of paysActifs.length ? paysActifs : ['ch']) for (const p of catalogue) if (p.mots) file.push({ pays, p, cle: `trends|${pays}|${p.id}`, t: anciennete.get(`trends|${pays}|${p.id}`) || 0 });
    file.sort((a, b) => a.t - b.t);
    let ok = 0, echecs = 0;
    for (const { pays, p, cle } of file.slice(0, requetesMax)) {
      try {
        const url = `https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES&date=${encodeURIComponent('today 3-m')}&geo=${pays.toUpperCase()}&q=${encodeURIComponent(p.mots)}&api_key=${encodeURIComponent(env.SERPAPI_KEY)}`;
        const rep = await fetchImpl(url);
        if (!rep.ok) throw new Error('HTTP ' + rep.status);
        const j = await rep.json();
        const points = ((j.interest_over_time && j.interest_over_time.timeline_data) || []).map(x => Number(x.values && x.values[0] && x.values[0].extracted_value) || 0);
        if (points.length < 8) continue;
        const moy = a => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
        const recent = moy(points.slice(-4)), avant = moy(points.slice(-8, -4));
        ecrire(cle, { evolution: avant ? Math.max(-1, Math.min(3, recent / avant - 1)) : 0, niveau: Math.round(recent), source: 'google', points: points.slice(-12) }, maintenant);
        ok++;
      } catch (e) { echecs++; journal.error('[tendances] Google Trends', p.mots, e.message); }
    }
    meta.sources.trends = { actif: true, majLe: maintenant, detail: `${ok} recherche${ok > 1 ? 's' : ''} mise${ok > 1 ? 's' : ''} à jour${echecs ? `, ${echecs} en échec` : ''} (rotation sur ${file.length})` };
  }

  /* 3. Fichier d'un outil d'analyse ou de relevés de meilleures ventes. */
  function collecterFichier(maintenant = Date.now()) {
    if (!env.TENDANCES_FICHIER) { meta.sources.fichier = { actif: false, detail: 'Importez un export d’outil d’analyse (Minea, Jungle Scout…) ou vos relevés de meilleures ventes au format JSON (TENDANCES_FICHIER).' }; return; }
    try {
      const liste = JSON.parse(fs.readFileSync(env.TENDANCES_FICHIER, 'utf8'));
      let n = 0;
      for (const x of Array.isArray(liste) ? liste : []) {
        const p = catalogue.find(c => c.id === x.id || (x.nom && c.nom.toLowerCase() === String(x.nom).toLowerCase()));
        if (!p || typeof x.evolution !== 'number') continue;
        for (const pays of x.pays ? [x.pays] : ['ch', 'fr', 'be']) ecrire(`fichier|${pays}|${p.id}`, { evolution: Math.max(-1, Math.min(3, x.evolution)), niveau: Number(x.niveau) || 50, source: 'fichier', plateforme: x.plateforme || null }, maintenant);
        n++;
      }
      meta.sources.fichier = { actif: true, majLe: maintenant, detail: `${n} produit${n > 1 ? 's' : ''} lus dans le fichier importé` };
    } catch (e) { meta.sources.fichier = { actif: false, detail: `Fichier illisible : ${e.message}` }; }
  }

  async function rafraichir(maintenant = Date.now()) {
    collecterVentes(maintenant);
    collecterFichier(maintenant);
    await collecterTrends(maintenant);
    meta.derniere = maintenant;
  }

  /* Signaux pour un pays : { ventes: { id: {...} }, trends: { id: {...} } } (Google prioritaire sur le fichier). */
  function signaux(pays) {
    const out = { ventes: {}, trends: {} };
    for (const r of db.prepare('SELECT cle, donnees, maj_le FROM tendances').all()) {
      const [source, p, id] = r.cle.split('|');
      if (p !== pays) continue;
      const d = { ...JSON.parse(r.donnees), majLe: r.maj_le };
      if (source === 'ventes') out.ventes[id] = d;
      else if (source === 'trends' || (source === 'fichier' && !out.trends[id])) out.trends[id] = d;
    }
    return { majLe: meta.derniere, sources: meta.sources, ...out };
  }

  return { rafraichir, signaux, collecterVentes };
}

module.exports = { creerCollecte };
