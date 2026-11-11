// Petit routeur HTTP (sans dépendance) : routes avec paramètres, corps JSON limité,
// cookies, erreurs typées et fichiers statiques.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

class ErreurHttp extends Error {
  constructor(statut, message, code) { super(message); this.statut = statut; this.code = code || 'erreur'; }
}
const erreur = (statut, message, code) => new ErreurHttp(statut, message, code);

function creerRouteur() {
  const routes = [];
  const ajouter = (methode, motif, ...gestionnaires) => {
    const noms = [];
    const re = new RegExp('^' + motif.replace(/\/:(\w+)/g, (_, n) => { noms.push(n); return '/([^/]+)'; }) + '/?$');
    routes.push({ methode, re, noms, gestionnaires });
  };
  return {
    get: (m, ...g) => ajouter('GET', m, ...g),
    post: (m, ...g) => ajouter('POST', m, ...g),
    put: (m, ...g) => ajouter('PUT', m, ...g),
    patch: (m, ...g) => ajouter('PATCH', m, ...g),
    delete: (m, ...g) => ajouter('DELETE', m, ...g),
    trouver(methode, chemin) {
      for (const r of routes) {
        if (r.methode !== methode) continue;
        const m = r.re.exec(chemin);
        if (m) {
          // Adresse mal encodée (« %E0 », « %zz ») : requête invalide, pas une erreur du serveur.
          try { return { gestionnaires: r.gestionnaires, params: Object.fromEntries(r.noms.map((n, i) => [n, decodeURIComponent(m[i + 1])])) }; }
          catch { throw erreur(400, 'Adresse invalide.', 'adresse_invalide'); }
        }
      }
      return null;
    }
  };
}

function lireCorps(req, limite = 2 * 1024 * 1024) {
  return new Promise((ok, ko) => {
    const morceaux = [];
    let taille = 0;
    // Trop volumineux : on répond 413 proprement (au lieu de couper la connexion) et on vide le reste sans le garder.
    if (Number(req.headers['content-length']) > limite) { req.resume(); ko(erreur(413, 'Requête trop volumineuse.', 'trop_volumineux')); return; }
    req.on('data', c => {
      taille += c.length;
      if (taille > limite) { req.removeAllListeners('data'); req.resume(); ko(erreur(413, 'Requête trop volumineuse.', 'trop_volumineux')); return; }
      morceaux.push(c);
    });
    req.on('end', () => ok(Buffer.concat(morceaux)));
    req.on('error', ko);
  });
}

function lireCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const brut = part.slice(i + 1).trim();
    try { out[part.slice(0, i).trim()] = decodeURIComponent(brut); } catch { out[part.slice(0, i).trim()] = brut; }   // cookie mal encodé : gardé tel quel
  }
  return out;
}

/* Compression gzip des réponses texte de plus de 1 Ko quand le navigateur l'accepte (≈ 10 fois moins de données). */
function compresser(res, corps, entetes) {
  const accepte = res.req && /\bgzip\b/.test(res.req.headers['accept-encoding'] || '');
  const tampon = Buffer.isBuffer(corps) ? corps : Buffer.from(corps);
  if (!accepte || tampon.length < 1024) return { corps: tampon, entetes };
  return { corps: zlib.gzipSync(tampon, { level: 6 }), entetes: { ...entetes, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } };
}

function envoyerJson(res, statut, donnees, entetes = {}) {
  const z = compresser(res, JSON.stringify(donnees), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes });
  res.writeHead(statut, z.entetes);
  res.end(z.corps);
}

function envoyerHtml(res, statut, html) {
  res.writeHead(statut, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

const TYPES = { '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/* Sert un fichier sous `racine` ; refuse toute sortie du dossier (../). */
const ETAGS = new Map();
function servirStatique(res, racine, chemin) {
  const cible = path.normalize(path.join(racine, chemin));
  if (!cible.startsWith(racine + path.sep) && cible !== racine) return false;
  let fichier = cible;
  try {
    if (fs.statSync(fichier).isDirectory()) fichier = path.join(fichier, 'index.html');
    const st = fs.statSync(fichier);
    // ETag (empreinte du contenu, recalculée seulement si le fichier change) : un rechargement ne retélécharge rien
    // de ce qui n'a pas changé (réponse 304), tout en restant toujours à jour après une mise en production.
    let e = ETAGS.get(fichier);
    if (!e || e.mtime !== st.mtimeMs || e.taille !== st.size) { const c = fs.readFileSync(fichier); e = { mtime: st.mtimeMs, taille: st.size, etag: `"${crypto.createHash('sha1').update(c).digest('base64url').slice(0, 20)}"` }; ETAGS.set(fichier, e); }
    const type = TYPES[path.extname(fichier)] || 'application/octet-stream';
    const communs = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: e.etag, Vary: 'Accept-Encoding', ...(path.basename(fichier) === 'sw.js' ? { 'Service-Worker-Allowed': '/app' } : {}) };
    const req = res.req;
    // Une étiquette par encodage (« …-br », « …-gzip ») : deux réponses différentes n'ont jamais la même ETag.
    const ae = String(req && req.headers['accept-encoding'] || '');
    const compressible = (/^(text|application\/(json|manifest))/.test(type) || type.includes('svg')) && st.size >= 1024;
    const algo = compressible ? (/\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null) : null;
    communs.ETag = algo ? e.etag.replace(/"$/, `-${algo}"`) : e.etag;
    const base = e.etag.slice(1, -1);
    if (req && String(req.headers['if-none-match'] || '').split(/,\s*/).some(x => x.replace(/^W\//, '').replace(/"/g, '').replace(/-(br|gzip)$/, '') === base)) { res.writeHead(304, communs); res.end(); return true; }
    const contenu = fs.readFileSync(fichier);
    // Fichiers texte : compressés une fois (Brotli, sinon gzip) puis gardés en mémoire jusqu'au prochain changement.
    let z = { corps: contenu, entetes: communs };
    if (algo) {
      if (!e[algo]) e[algo] = algo === 'br' ? zlib.brotliCompressSync(contenu, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : zlib.gzipSync(contenu, { level: 9 });
      z = { corps: e[algo], entetes: { ...communs, 'Content-Encoding': algo } };
    }
    res.writeHead(200, z.entetes);
    res.end(z.corps);
    return true;
  } catch { return false; }
}

/* Petits validateurs : renvoient la valeur nettoyée ou lèvent une erreur 400. */
const valider = {
  texte(v, nom, { min = 1, max = 200 } = {}) {
    if (typeof v !== 'string') throw erreur(400, `${nom} est obligatoire.`, 'invalide');
    const t = v.trim();
    if (t.length < min || t.length > max) throw erreur(400, `${nom} doit faire entre ${min} et ${max} caractères.`, 'invalide');
    return t;
  },
  email(v) {
    const t = valider.texte(v, 'L’e-mail', { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw erreur(400, 'Adresse e-mail invalide.', 'invalide');
    return t;
  },
  nombre(v, nom, { min = 0, max = 1e7 } = {}) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw erreur(400, `${nom} doit être un nombre entre ${min} et ${max}.`, 'invalide');
    return n;
  },
  entier(v, nom, opts) {
    const n = valider.nombre(v, nom, opts);
    if (!Number.isInteger(n)) throw erreur(400, `${nom} doit être un nombre entier.`, 'invalide');
    return n;
  }
};

module.exports = { creerRouteur, lireCorps, lireCookies, envoyerJson, envoyerHtml, servirStatique, erreur, ErreurHttp, valider };
