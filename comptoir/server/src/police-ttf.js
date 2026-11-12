/* Police TrueType pour les PDF : lecture des métriques, et sous-ensemble (seuls les glyphes utilisés gardent leur dessin).
   Les numéros de glyphes sont conservés : le PDF les utilise directement (Identity-H), sans table de correspondance.
   Seules les tables utiles au rendu sont gardées ; « post » est réduite au format 3 (sans noms de glyphes). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const GARDEES = ['OS/2', 'cmap', 'cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep'];

function lire(fichier) {
  const b = fs.readFileSync(fichier);
  if (b.readUInt32BE(0) !== 0x00010000) throw new Error(`police TrueType attendue : ${path.basename(fichier)}`);
  const tables = {};
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16, tag = b.toString('latin1', o, o + 4);
    tables[tag] = b.subarray(b.readUInt32BE(o + 8), b.readUInt32BE(o + 8) + b.readUInt32BE(o + 12));
  }
  for (const t of ['head', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap', 'maxp', 'OS/2', 'post']) if (!tables[t]) throw new Error(`table ${t} absente`);
  const head = tables.head, hhea = tables.hhea, os2 = tables['OS/2'], post = tables.post;
  const unites = head.readUInt16BE(18), formatLoca = head.readInt16BE(50);
  const nbGlyphes = tables.maxp.readUInt16BE(4), nbMetriques = hhea.readUInt16BE(34);
  const avance = new Uint16Array(nbGlyphes);
  for (let g = 0; g < nbGlyphes; g++) avance[g] = tables.hmtx.readUInt16BE(4 * Math.min(g, nbMetriques - 1));
  const loca = new Uint32Array(nbGlyphes + 1);
  for (let g = 0; g <= nbGlyphes; g++) loca[g] = formatLoca ? tables.loca.readUInt32BE(4 * g) : tables.loca.readUInt16BE(2 * g) * 2;

  // Table cmap : format 12 (tout Unicode) de préférence, sinon format 4 (plan de base).
  const cmap = tables.cmap, correspondance = new Map();
  let sous = null;
  for (let i = 0, nb = cmap.readUInt16BE(2); i < nb; i++) {
    const plateforme = cmap.readUInt16BE(4 + i * 8), codage = cmap.readUInt16BE(6 + i * 8), o = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(o);
    if (plateforme === 3 && codage === 10 && format === 12) { sous = { o, format }; break; }
    if (plateforme === 3 && codage === 1 && format === 4) sous = { o, format };
  }
  if (!sous) throw new Error('table cmap Unicode absente');
  if (sous.format === 12) {
    for (let i = 0, nb = cmap.readUInt32BE(sous.o + 12); i < nb; i++) {
      const p = sous.o + 16 + i * 12, debut = cmap.readUInt32BE(p), fin = cmap.readUInt32BE(p + 4), g0 = cmap.readUInt32BE(p + 8);
      for (let c = debut; c <= fin; c++) correspondance.set(c, g0 + c - debut);
    }
  } else {
    const o = sous.o, segX2 = cmap.readUInt16BE(o + 6), fins = o + 14, debuts = fins + segX2 + 2, deltas = debuts + segX2, decal = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const fin = cmap.readUInt16BE(fins + 2 * s), debut = cmap.readUInt16BE(debuts + 2 * s), delta = cmap.readInt16BE(deltas + 2 * s), ro = cmap.readUInt16BE(decal + 2 * s);
      for (let c = debut; c <= fin && c !== 0xFFFF; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xFFFF;
        else { const a = decal + 2 * s + ro + 2 * (c - debut); g = cmap.readUInt16BE(a); if (g) g = (g + delta) & 0xFFFF; }
        if (g) correspondance.set(c, g);
      }
    }
  }
  return {
    nomPostScript: nomPs(tables.name) || path.basename(fichier, '.ttf').replace(/[^A-Za-z0-9-]/g, ''),
    tables, unites, nbGlyphes, avance, loca, correspondance,
    bbox: [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)],
    ascendante: hhea.readInt16BE(4), descendante: hhea.readInt16BE(6),
    hauteurCapitales: os2.readUInt16BE(0) >= 2 && os2.length >= 90 ? os2.readInt16BE(88) : Math.round(head.readInt16BE(42) * 0.7),
    angle: post.readInt32BE(4) / 65536,
    graisse: os2.readUInt16BE(4)
  };
}

function nomPs(name) {
  if (!name) return null;
  const nb = name.readUInt16BE(2), stock = name.readUInt16BE(4);
  for (let i = 0; i < nb; i++) {
    const o = 6 + i * 12;
    if (name.readUInt16BE(o + 6) !== 6) continue;
    const pf = name.readUInt16BE(o), lg = name.readUInt16BE(o + 8), dec = name.readUInt16BE(o + 10);
    const brut = name.subarray(stock + dec, stock + dec + lg);
    const t = pf === 3 || pf === 0 ? Buffer.from(brut).swap16().toString('utf16le') : brut.toString('latin1');
    if (/^[A-Za-z0-9-]+$/.test(t)) return t;
  }
  return null;
}

/* Glyphes composés : chaque glyphe utilisé entraîne ses composants. */
function fermeture(police, glyphes) {
  const { tables: { glyf }, loca } = police, pile = [...glyphes], vus = new Set(glyphes);
  while (pile.length) {
    const g = pile.pop(), debut = loca[g], fin = loca[g + 1];
    if (fin - debut < 10 || glyf.readInt16BE(debut) >= 0) continue;
    let p = debut + 10;
    for (;;) {
      const drapeaux = glyf.readUInt16BE(p), composant = glyf.readUInt16BE(p + 2);
      if (!vus.has(composant)) { vus.add(composant); pile.push(composant); }
      p += 4 + (drapeaux & 1 ? 4 : 2) + (drapeaux & 8 ? 2 : drapeaux & 0x40 ? 4 : drapeaux & 0x80 ? 8 : 0);
      if (!(drapeaux & 0x20)) break;
    }
  }
  return vus;
}

const somme = b => { let s = 0; const p = Buffer.alloc(Math.ceil(b.length / 4) * 4); b.copy(p); for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };

/* Fichier de police réduit aux glyphes demandés (plus le glyphe 0, obligatoire). */
function sousEnsemble(police, glyphes) {
  const gardes = fermeture(police, new Set([0, ...glyphes]));
  const { tables, loca, nbGlyphes } = police;
  const morceaux = [], nouvelleLoca = Buffer.alloc(4 * (nbGlyphes + 1));
  let pos = 0;
  for (let g = 0; g < nbGlyphes; g++) {
    nouvelleLoca.writeUInt32BE(pos, 4 * g);
    if (gardes.has(g) && loca[g + 1] > loca[g]) {
      const d = tables.glyf.subarray(loca[g], loca[g + 1]);
      morceaux.push(d); pos += d.length;
      if (pos % 4) { const r = 4 - (pos % 4); morceaux.push(Buffer.alloc(r)); pos += r; }
    }
  }
  nouvelleLoca.writeUInt32BE(pos, 4 * nbGlyphes);
  const nouvelles = {};
  for (const t of GARDEES) if (tables[t]) nouvelles[t] = Buffer.from(tables[t]);
  nouvelles.glyf = Buffer.concat(morceaux);
  nouvelles.loca = nouvelleLoca;
  nouvelles.head.writeInt16BE(1, 50);              // loca au format long
  nouvelles.head.writeUInt32BE(0, 8);              // checkSumAdjustment, recalculé plus bas
  const post = Buffer.from(nouvelles.post.subarray(0, 32)); post.writeUInt32BE(0x00030000, 0); nouvelles.post = post;

  const tags = Object.keys(nouvelles).sort(), n = tags.length;
  let puissance = 1, log = 0; while (puissance * 2 <= n) { puissance *= 2; log++; }
  const entete = Buffer.alloc(12 + 16 * n);
  entete.writeUInt32BE(0x00010000, 0); entete.writeUInt16BE(n, 4); entete.writeUInt16BE(puissance * 16, 6); entete.writeUInt16BE(log, 8); entete.writeUInt16BE(n * 16 - puissance * 16, 10);
  const corps = []; let decalage = entete.length;
  tags.forEach((t, i) => {
    const d = nouvelles[t], o = 12 + 16 * i;
    entete.write(t, o, 'latin1'); entete.writeUInt32BE(somme(d), o + 4); entete.writeUInt32BE(decalage, o + 8); entete.writeUInt32BE(d.length, o + 12);
    const remplissage = (4 - (d.length % 4)) % 4;
    corps.push(d, Buffer.alloc(remplissage)); decalage += d.length + remplissage;
  });
  const fichier = Buffer.concat([entete, ...corps]);
  const oHead = entete.readUInt32BE(12 + 16 * tags.indexOf('head') + 8);
  fichier.writeUInt32BE((0xB1B0AFBA - somme(fichier)) >>> 0, oHead + 8);
  return fichier;
}

const cache = new Map();
const charger = fichier => { if (!cache.has(fichier)) cache.set(fichier, lire(fichier)); return cache.get(fichier); };

module.exports = { charger, sousEnsemble, fermeture };
