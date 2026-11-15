/* Comptoir — codes-barres GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) : forme et chiffre de contrôle GS1.
   Module pur, partagé par le serveur (validation) et l'interface (caisse : lecture au scanner). */
(function (racine) {
'use strict';

// Espaces et tirets ignorés (« 7 610000 000017 » se lit comme 7610000000017).
const normaliser = t => String(t ?? '').replace(/[\s-]/g, '');
function valide(t) {
  const c = normaliser(t);
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(c)) return false;
  const d = [...c].map(Number), controle = d.pop();
  // Depuis la droite (sans le contrôle) : poids 3, 1, 3, 1…
  const somme = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (somme % 10)) % 10 === controle;
}

const controle = base => { const d = [...base].map(Number).reverse(); return String((10 - (d.reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10); };
/* Code interne (EAN-13 commençant par 20 : réservé à l'usage en magasin, jamais attribué à un fabricant), différent de
   ceux déjà pris. */
function codeInterne(pris = new Set(), alea = Math.random) {
  for (let i = 0; i < 1000; i++) {
    const base = '20' + Array.from({ length: 10 }, () => Math.floor(alea() * 10)).join('');
    const code = base + controle(base);
    if (!pris.has(code)) return code;
  }
  return null;
}
/* Barres d'un code EAN-13, UPC-A (lu comme EAN-13 commençant par 0) ou EAN-8 : suite de 0 et 1 (un module chacun),
   sans les marges. GTIN-14 : null (il s'imprime en ITF-14, hors de portée ici). */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map(x => [...x].map(b => b === '0' ? '1' : '0').join('')), G = R.map(x => [...x].reverse().join(''));
const PARITE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function barres(t) {
  let c = normaliser(t);
  if (!valide(c) || c.length === 14) return null;
  if (c.length === 12) c = '0' + c;
  const d = [...c].map(Number);
  if (c.length === 8) return '101' + d.slice(0, 4).map(x => L[x]).join('') + '01010' + d.slice(4).map(x => R[x]).join('') + '101';
  const par = PARITE[d[0]];
  return '101' + d.slice(1, 7).map((x, i) => (par[i] === 'L' ? L : G)[x]).join('') + '01010' + d.slice(7).map(x => R[x]).join('') + '101';
}

/* Forme de référence d'un code : le même article en UPC-A (12 chiffres), en EAN-13 commençant par 0 ou en GTIN-14
   commençant par 0 est un seul et même code. Rangé en 13 chiffres (8 pour un EAN-8) : unicité et lecture au scanner
   comparent toujours cette forme. */
function canonique(t) {
  let c = normaliser(t);
  if (c.length === 12) c = '0' + c;
  if (c.length === 14 && c[0] === '0') c = c.slice(1);
  if (c.length === 13 && c.startsWith('00000') && valide(c.slice(5))) c = c.slice(5);   // EAN-8 complété par des zéros
  return c;
}

const api = { normaliser, canonique, valide, codeInterne, barres };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.Gtin = api;
})(typeof window !== 'undefined' ? window : globalThis);
