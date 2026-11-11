// Réseaux sociaux : validation des publications et publication.
//
// Publication réelle : chaque réseau impose son API officielle, une application
// validée par le réseau et l'accord du marchand (OAuth) :
//   - Instagram et Facebook : Meta Graph API (Instagram Content Publishing)
//   - TikTok : Content Posting API
//   - Pinterest : API v5 (création d'épingles)
// Tant que ces accès ne sont pas configurés, la publication est simulée et les
// statistiques sont marquées « simulées ».
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const RESEAUX = ['tiktok', 'instagram', 'facebook', 'pinterest'];
const PILIERS = ['probleme', 'produit', 'avis', 'coulisses', 'saison', 'offre'];
const DEFAUT_FREQUENCE = { tiktok: 5, instagram: 4, facebook: 2, pinterest: 3 };
const texte = (v, max) => String(v ?? '').slice(0, max);

function nettoyerReglages(s) {
  s = s && typeof s === 'object' ? s : {};
  const comptes = Object.fromEntries(RESEAUX.map(k => [k, !!(s.comptes && s.comptes[k])]));
  const r = s.reglages || {};
  return {
    comptes,
    reglages: {
      auto: !!r.auto, validation: r.validation !== false,
      ton: ['chaleureux', 'premium', 'fun'].includes(r.ton) ? r.ton : 'chaleureux',
      frequence: Object.fromEntries(RESEAUX.map(k => { const v = r.frequence && r.frequence[k]; return [k, v === undefined ? DEFAUT_FREQUENCE[k] : Math.max(0, Math.min(21, Number(v) || 0))]; })),
      piliers: Array.isArray(r.piliers) ? r.piliers.filter(p => PILIERS.includes(p)) : PILIERS
    }
  };
}

function nettoyerPublication(p) {
  if (!p || !RESEAUX.includes(p.reseau)) throw erreur(400, 'Réseau social inconnu.', 'invalide');
  const date = Number(p.date);
  if (!Number.isFinite(date)) throw erreur(400, 'Date de publication invalide.', 'invalide');
  return {
    reseau: p.reseau, date,
    format: texte(p.format, 30), pilier: PILIERS.includes(p.pilier) ? p.pilier : 'produit',
    produitId: texte(p.produitId, 40), produitNom: texte(p.produitNom, 120),
    accroche: texte(p.accroche, 300), legende: texte(p.legende, 3000),
    hashtags: (Array.isArray(p.hashtags) ? p.hashtags : []).slice(0, 15).map(h => texte(h, 40)),
    partenariat: p.partenariat ? { avec: texte(p.partenariat.avec, 60) } : null,
    variantes: (Array.isArray(p.variantes) ? p.variantes : []).slice(0, 3).map(v => texte(v, 300)),
    script: Array.isArray(p.script) ? p.script.filter(x => x && typeof x === 'object').slice(0, 8).map(s => ({ t: texte(s.t, 20), texte: texte(s.texte, 400) })) : null,
    statut: p.statut === 'programmee' ? 'programmee' : 'brouillon'
  };
}

function lire(row) {
  return { ...JSON.parse(row.donnees), id: row.id, reseau: row.reseau, date: row.date, statut: row.statut };
}
function enregistrer(db, boutiqueId, p) {
  const { id, reseau, date, statut, ...donnees } = p;
  db.prepare(`INSERT INTO publications (id, boutique_id, reseau, date, statut, donnees) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET reseau = excluded.reseau, date = excluded.date, statut = excluded.statut, donnees = excluded.donnees`)
    .run(id, boutiqueId, reseau, date, statut, JSON.stringify(donnees));
}

/* Statistiques simulées, déterministes (mêmes règles que l'interface de démo). */
function statsSimulees(p) {
  const h = crypto.createHash('sha256').update(p.id + p.accroche).digest()[0] / 255;
  const base = { tiktok: 2400, instagram: 900, facebook: 350, pinterest: 600 }[p.reseau] || 500;
  const fmt = { 'Vidéo': 1.6, Reel: 1.5, Carrousel: 0.9, Story: 0.5, Publication: 0.6, 'Épingle': 1 }[p.format] || 1;
  const pil = { probleme: 1.4, produit: 1.15, avis: 1.25, coulisses: 0.9, saison: 1.2, offre: 1 }[p.pilier] || 1;
  const vues = Math.round(base * fmt * (0.4 + h * 1.6));
  const clics = Math.round(vues * 0.012 * pil);
  return { vues, likes: Math.round(vues * (0.04 + h * 0.05)), clics, ventes: Math.round(clics * 0.03 * pil), simulees: true };
}

async function publier(db, boutiqueId, p) {
  // Point de branchement des API officielles (voir en-tête). Ici : simulation.
  const publiee = { ...p, statut: 'publiee', date: Math.min(p.date, Date.now()), idExterne: 'sim_' + crypto.randomBytes(6).toString('hex'), stats: statsSimulees(p) };
  enregistrer(db, boutiqueId, publiee);
  return publiee;
}

module.exports = { nettoyerReglages, nettoyerPublication, lire, enregistrer, publier, RESEAUX };
