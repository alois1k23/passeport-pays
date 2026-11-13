// Fuzzing HTTP : chaque route du serveur (publique, espace marchand, API) reçoit des corps et des paramètres aléatoires
// et hostiles (types inattendus, chaînes énormes, clés __proto__, tableaux à la place d'objets, JSON cassé).
// Règles : jamais d'erreur 500, jamais de pile ni de chemin de fichier dans une réponse, jamais d'exception non gérée
// (le serveur la journalise sous « [erreur] »).
// Usage : node outils/simulation/fuzz-http.js [essais par route = 20] [graine = 1]
'use strict';
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { ouvrir } = require('../../server/src/db');
const { creerApp } = require('../../server/src/app');

const ESSAIS = Number(process.argv[2]) || 20;
let graine = Number(process.argv[3]) || 1;
const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
const choisir = l => l[Math.floor(hasard() * l.length)];

const CHAMPS = ['lignes', 'client', 'email', 'montant', 'code', 'statut', 'qte', 'index', 'geste', 'attendu', 'apercu', 'port', 'motif', 'jeton', 'demande', 'fidelite',
  'carteCadeau', 'config', 'produits', 'motDePasse', 'nom', 'prix', 'stock', 'livraison', 'moyen', 'langue', 'montants', 'validiteMois', 'actif', 'suivi', 'produitId',
  'varianteId', 'ligne', 'remettreEnStock', 'abandonner', 'reprendre', 'de', 'vers', 'quantite', 'type', 'url', 'evenements', 'portees', 'debut', 'fin', 'reponse',
  'note', 'texte', 'titre', 'expireMois', 'destinataire', 'message', 'destEmail', 'destNom', 'remise', 'seuil', 'plafondPct', 'expirationMois', 'id', 'ids', 'cle'];
const VALEURS = () => [null, true, false, 0, -1, 1e308, -0, NaN, 1.5, 2 ** 53, '', ' ', 'x'.repeat(20000), '0', '1', '-1', '1e9', '<script>alert(1)</script>', "'; DROP TABLE commandes; --",
  '../../etc/passwd', '%00', '\u0000', '‮', 'é'.repeat(300), '2026-13-45', 'AV-2026-0001', '1111-2222-3333-4444', [], [{}], [null], [1, 2, 3], {}, { __proto__: { admin: true } },
  { constructor: { prototype: { x: 1 } } }, { index: '0', qte: '1' }, [{ index: 0, qte: 1 }], [{ index: -1, qte: 1e9 }], { montant: '12,5' }, Array(500).fill('a')];
const valeur = (prof = 0) => { const r = hasard(); if (prof < 2 && r < 0.15) return objet(prof + 1); if (prof < 2 && r < 0.25) return Array.from({ length: Math.floor(hasard() * 4) }, () => valeur(prof + 1)); return choisir(VALEURS()); };
const objet = (prof = 0) => { const o = {}; const n = 1 + Math.floor(hasard() * 6); for (let i = 0; i < n; i++) o[choisir(CHAMPS)] = valeur(prof); if (hasard() < 0.1) o.__proto__ = { polue: true }; return o; };
const corps = () => { const r = hasard(); if (r < 0.06) return '{"cassé":'; if (r < 0.1) return '[]'; if (r < 0.13) return 'null'; if (r < 0.16) return '"texte"'; if (r < 0.18) return JSON.stringify({ x: 'y'.repeat(2e6) }); return JSON.stringify(objet()); };

(async () => {
  const erreursServeur = [];
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  const journal = { log() {}, error: (...a) => { if (String(a[0]).startsWith('[erreur]')) erreursServeur.push(a.map(x => x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x)).join(' ')); } };
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '100000', LIMITES_FACTEUR: '100000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal }));
  let cookie = '';
  const brut = async (m, chemin, texte, { session = true, entetes = {} } = {}) => {
    const r = await fetch(base + chemin, { method: m, redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', ...(session && cookie ? { Cookie: cookie } : {}), ...entetes }, body: m === 'GET' || m === 'HEAD' ? undefined : texte });
    const sc = r.headers.getSetCookie(); if (session && sc.length && /session/.test(sc.join(';'))) cookie = sc.map(x => x.split(';')[0]).join('; ');
    return { statut: r.status, texte: await r.text().catch(() => '') };
  };
  const appel = (m, chemin, o, opt) => brut(m, chemin, o === undefined ? undefined : JSON.stringify(o), opt).then(r => { try { return { ...r, json: JSON.parse(r.texte) }; } catch { return r; } });

  // État de départ : un marchand, une boutique, des produits, une commande payée, une carte, une clé d'API.
  const conf = { boutique: { nom: 'Fuzz', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'Fuzz Sàrl', adresse: 'Rue 1, 1003 Lausanne', email: 'f@exemple.ch', regime: 'ch-assujetti', tvaIntra: 'CHE-123.456.789 TVA' } };
  await appel('POST', '/api/auth/inscription', { email: 'fuzz@exemple.ch', motDePasse: 'un mot de passe solide', config: conf, produits: [{ nom: 'Vase', prix: 40, stock: 500, type: 'stock' }, { nom: 'Bougie', prix: 12.9, stock: 500, type: 'stock' }] });
  const e = (await appel('GET', '/api/admin/etat')).json, slug = e.serveur.slug, produit = e.produits[0].id;
  await appel('PUT', '/api/admin/fidelite', { actif: true });
  const cmd = (await appel('POST', `/api/public/${slug}/commandes`, { lignes: [{ produitId: produit, qte: 3 }], livraison: 'poste-eco', client: { nom: 'Lou', email: 'lou@exemple.ch', adresse: 'Rue 3', npa: '1003', ville: 'Lausanne' } }, { session: false })).json;
  await brut('POST', `/paiement-simule/${cmd.paiementUrl.split('/').pop()}/confirmer`, null, { session: false });
  const carte = (await appel('POST', '/api/admin/cartes-cadeaux', { montant: 50 })).json.carte;
  const cle = (await appel('POST', '/api/admin/integrations/cles', { nom: 'fuzz', portees: ['commandes:lecture', 'commandes:ecriture', 'produits:lecture', 'produits:ecriture', 'clients:lecture'] })).json.cle;

  // Routes déclarées dans le serveur ; les paramètres reçoivent une vraie valeur ou une valeur hostile.
  const source = fs.readFileSync(path.join(__dirname, '../../server/src/app.js'), 'utf8');
  const routes = [...source.matchAll(/^\s*r\.(get|post|put|delete|patch)\('([^']+)'/gm)].map(m => ({ methode: m[1].toUpperCase(), chemin: m[2] }));
  // Routes qui ferment la session ou effacent le compte : à la fin, pour ne pas couper le reste.
  const fin = r => /deconnexion|compte\/supprimer|sessions\/revoquer|clients\/effacer/.test(r.chemin);
  routes.sort((a, b) => fin(a) - fin(b));
  // Flux en direct (connexion ouverte sans fin) : hors du fuzzing.
  for (let i = routes.length - 1; i >= 0; i--) if (/\/flux\b/.test(routes[i].chemin)) routes.splice(i, 1);
  const param = nom => {
    const vrai = { slug, id: cmd.commandeId, numero: String(cmd.numero), produit, pid: produit }[nom];
    return encodeURIComponent(hasard() < 0.6 && vrai ? vrai : choisir(['x', '0', '-1', '99999999', '%2e%2e', 'a'.repeat(300), 'AV-2026-0001', carte.id, '__proto__', '1;2']));
  };
  const constats = [], vus = new Set();
  const noter = (r, quoi, detail) => { const k = `${r.methode} ${r.chemin} ${quoi}`; if (vus.has(k)) return; vus.add(k); constats.push({ route: `${r.methode} ${r.chemin}`, quoi, detail: String(detail).slice(0, 300) }); };
  let requetes = 0; const statuts = {};
  for (const r of routes) {
    for (let i = 0; i < ESSAIS; i++) {
      const chemin = r.chemin.replace(/:(\w+)/g, (_, n) => param(n)) + (hasard() < 0.4 ? `?${choisir(CHAMPS)}=${encodeURIComponent(String(valeur()))}&jeton=${encodeURIComponent(String(choisir(VALEURS())))}` : '');
      const avecSession = hasard() < 0.75, avecCle = /^\/api\/v1/.test(r.chemin) && hasard() < 0.8;
      const avant = erreursServeur.length;
      let rep;
      try { rep = await brut(r.methode, chemin, corps(), { session: avecSession, entetes: avecCle ? { Authorization: `Bearer ${cle}` } : {} }); }
      catch (x) { noter(r, x.name === 'TimeoutError' ? 'pas de réponse en 10 s' : 'connexion coupée', x.message); continue; }
      requetes++; statuts[rep.statut] = (statuts[rep.statut] || 0) + 1;
      if (rep.statut >= 500) noter(r, `erreur ${rep.statut}`, rep.texte);
      if (/\bat [\w.<>]+ \(|\/server\/src\/|node:internal|\.js:\d+:\d+/.test(rep.texte)) noter(r, 'pile ou chemin de fichier exposé', rep.texte);
      if (erreursServeur.length > avant) noter(r, 'exception non gérée', erreursServeur.at(-1));
    }
    process.stderr.write(`${r.methode} ${r.chemin}\n`);
    // Garde la session : certaines routes la ferment.
    if (!cookie || (await appel('GET', '/api/admin/etat')).statut === 401) { await appel('POST', '/api/auth/connexion', { email: 'fuzz@exemple.ch', motDePasse: 'un mot de passe solide' }); }
  }
  s.close();
  console.log(JSON.stringify({ routes: routes.length, requetes, statuts, constats: constats.length, details: constats.slice(0, 60) }, null, 1));
  process.exit(constats.length ? 1 : 0);
})();
