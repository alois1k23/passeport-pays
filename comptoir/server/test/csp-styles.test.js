// Politique de sécurité sans styles en ligne : chaque bloc <style> des pages servies est autorisé par son empreinte,
// aucun attribut style dans le HTML produit.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');

test('feuilles de style autorisées par empreinte, aucun style en ligne', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  try {
    const ins = await (await fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'st@exemple.ch', motDePasse: 'un mot de passe solide', config: { boutique: { nom: 'Style', pays: 'ch', secteur: 'maison', sections: [] }, entreprise: { raison: 'S', adresse: 'Rue 1, 1003 Lausanne' } }, produits: [] }) })).json();
    for (const chemin of ['/', '/app', `/s/${ins.slug}`, '/mentions-legales', '/conditions', '/confidentialite', '/reinscription?j=x', '/desinscription?j=x']) {
      const r = await fetch(base + chemin), html = await r.text(), csp = r.headers.get('content-security-policy');
      assert.doesNotMatch(csp, /'unsafe-inline'/, `${chemin} : pas de 'unsafe-inline'`);
      assert.doesNotMatch(html, /\sstyle\s*=/i, `${chemin} : aucun attribut style`);
      for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        const h = `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`;
        assert.ok(csp.includes(h), `${chemin} : bloc <style> autorisé par son empreinte`);
      }
    }
  } finally { s.close(); }
});
