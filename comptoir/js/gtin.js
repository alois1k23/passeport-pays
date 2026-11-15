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

const api = { normaliser, valide };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else racine.Gtin = api;
})(typeof window !== 'undefined' ? window : globalThis);
