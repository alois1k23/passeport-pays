/* Comptoir — créneaux de retrait en magasin (click & collect) : le marchand indique ses plages par jour de la semaine,
   la durée d'un créneau, combien de retraits par créneau, le délai de préparation et l'horizon ; le client choisit un
   créneau libre en commandant. Heures toujours comprises à Lausanne (heure d'été et d'hiver comprises). Module pur. */
'use strict';

const FUSEAU = 'Europe/Zurich';
const minutes = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); if (!m) return null; const v = Number(m[1]) * 60 + Number(m[2]); return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : null; };

/* Règles lues dans la configuration, toujours bornées (la configuration vient du navigateur du marchand). */
function regles(config) {
  const c = (config && config.magasin && config.magasin.creneaux) || {};
  const jours = {};
  for (let j = 0; j < 7; j++) {
    const p = c.jours && c.jours[j];
    const d = p && minutes(p[0]), f = p && minutes(p[1]);
    jours[j] = d !== null && f !== null && d !== undefined && f !== undefined && f > d ? [d, f] : null;
  }
  return {
    actif: c.actif === true && Object.values(jours).some(Boolean),
    jours,
    duree: [15, 30, 60].includes(Number(c.duree)) ? Number(c.duree) : 30,
    capacite: Math.max(1, Math.min(50, Math.round(Number(c.capacite) || 3))),
    delai: [60, 120, 240, 1440].includes(Number(c.delai)) ? Number(c.delai) : 120,
    horizon: [3, 7, 14].includes(Number(c.horizon)) ? Number(c.horizon) : 7
  };
}
// Date et heure murale à Lausanne pour un instant donné.
function mural(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { a: +p.year, m: +p.month, j: +p.day, h: +p.hour, min: +p.minute, js: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// Instant (ms) d'une heure murale à Lausanne : deux corrections suffisent, changement d'heure compris.
function instant(a, m, j, minDuJour) {
  const voulu = Date.UTC(a, m - 1, j, 0, minDuJour);
  let t = voulu;
  for (let i = 0; i < 2; i++) { const w = mural(t); t += voulu - Date.UTC(w.a, w.m - 1, w.j, w.h, w.min); }
  return t;
}
/* Créneaux encore libres, du prochain possible (délai de préparation) jusqu'à l'horizon. pris : Map début → nombre. */
function liste(r, maintenant = Date.now(), pris = new Map()) {
  if (!r.actif) return [];
  const out = [], debutPossible = maintenant + r.delai * 60000;
  // Jours du calendrier à Lausanne (et non tranches de 24 heures : un changement d'heure ne saute ni ne double un jour).
  const w0 = mural(maintenant);
  for (let k = 0; k <= r.horizon; k++) {
    const d = new Date(Date.UTC(w0.a, w0.m - 1, w0.j + k));
    const w = { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, j: d.getUTCDate(), js: d.getUTCDay() }, plage = r.jours[w.js];
    if (!plage) continue;
    for (let t = plage[0]; t + r.duree <= plage[1]; t += r.duree) {
      const debut = instant(w.a, w.m, w.j, t);
      const verif = mural(debut);
      if (verif.h * 60 + verif.min !== t) continue;   // heure qui n'existe pas (passage à l'heure d'été)
      if (debut < debutPossible) continue;
      // Places prises : par début exact (Map) ou par chevauchement (liste de réservations : la durée a pu changer depuis).
      const fin = debut + r.duree * 60000;
      const n = Array.isArray(pris) ? pris.filter(x => x.debut < fin && (x.fin || x.debut + 1) > debut).length : (pris.get(debut) || 0);
      const reste = r.capacite - n;
      if (reste > 0) out.push({ debut, fin, reste });
    }
  }
  return [...new Map(out.map(x => [x.debut, x])).values()].sort((a, b) => a.debut - b.debut).slice(0, 1500);
}
const libelle = (debut, fin) => {
  const f = o => new Intl.DateTimeFormat('fr-CH', { timeZone: FUSEAU, ...o }).format(new Date(debut));
  const h = ms => new Intl.DateTimeFormat('fr-CH', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(':', ' h ');
  return `${f({ weekday: 'long', day: 'numeric', month: 'long' })}, ${h(debut)} – ${h(fin)}`;
};

module.exports = { regles, liste, libelle, instant, mural };
