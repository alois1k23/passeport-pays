// Requêtes hostiles ou malformées contre l'API : aucune ne doit provoquer d'erreur 500, de fuite ou d'effet non autorisé.
// Usage : node securite-api.js http://localhost:3000
const base = process.argv[2] || 'http://localhost:3000';
const constats = [];
const req = async (m, chemin, corps, entetes = {}, brut = false) => {
  const r = await fetch(base + chemin, { method: m, redirect: 'manual', headers: { ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}), ...entetes }, body: corps === undefined ? undefined : brut ? corps : JSON.stringify(corps) });
  const t = await r.text();
  if (r.status >= 500) constats.push(`${m} ${chemin} → ${r.status} : ${t.slice(0, 100)}`);
  return { s: r.status, t, h: r.headers };
};

(async () => {
  // Fichiers du serveur, base, remontée de dossiers
  for (const c of ['/server/src/app.js', '/server/donnees/comptoir.db', '/../server/src/auth.js', '/js/../server/src/auth.js', '/%2e%2e/server/src/auth.js', '/js/%2e%2e%2fserver%2fsrc%2fauth.js', '/.env', '/package.json', '/server/package.json', '/.git/config', '/docs/journal-nuit.md', '/outils/simulation/api.js'])
    { const r = await req('GET', c); if (r.s === 200 && !/<html|<!doctype/i.test(r.t.slice(0, 200))) constats.push(`fichier interne servi : ${c}`); if (/require\(|scrypt|SQLite format/.test(r.t)) constats.push(`contenu interne exposé : ${c}`); }
  // Corps malformés et types inattendus
  await req('POST', '/api/auth/inscription', '{pas du json', {}, true);
  await req('POST', '/api/auth/inscription', 'x'.repeat(3e6), {}, true);
  await req('POST', '/api/auth/connexion', { email: ['a'], motDePasse: { $ne: 1 } });
  await req('POST', '/api/auth/connexion', { email: "' OR 1=1 --", motDePasse: "' OR 1=1 --" });
  await req('POST', '/api/auth/inscription', { email: 'x@y.ch', motDePasse: 'a'.repeat(10), config: { boutique: { nom: 'A'.repeat(5000) } } });
  await req('POST', '/api/auth/inscription', { email: 'y@y.ch', motDePasse: 'mot de passe solide', config: null });
  await req('POST', '/api/auth/inscription', { email: 'z@y.ch', motDePasse: 'mot de passe solide', config: { boutique: { nom: 'Ok', sections: 'pas un tableau', theme: 42 } }, produits: 'x', importer: { a: 1 } });
  await req('POST', '/api/public/inexistante/commandes', { lignes: [] });
  await req('GET', '/api/public/%00');
  await req('GET', '/api/public/' + 'a'.repeat(5000));
  await req('DELETE', '/api/session');
  await req('POST', '/api/webhooks/stripe', { type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: 'm_x' } } });
  const wf = await req('POST', '/api/webhooks/fournisseurs/demo', { ref: 'x', statut: 'expediee' });
  if (wf.s < 400) constats.push('webhook fournisseur accepté sans signature');
  const ws = await req('POST', '/api/webhooks/stripe', { type: 'invoice.paid' }, { 'Stripe-Signature': 't=1,v1=faux' });
  if (ws.s < 400) constats.push('webhook Stripe accepté sans signature valide');
  // Un compte : session, déconnexion, réinitialisation
  const email = `secu${Date.now()}@exemple.ch`;
  const ins = await req('POST', '/api/auth/inscription', { email, motDePasse: 'mot de passe solide', config: { boutique: { nom: 'Sécu', pays: 'ch', secteur: 'maison', sections: [] } } });
  const cookie = (ins.h.get('set-cookie') || '').split(';')[0];
  if (!/HttpOnly/i.test(ins.h.get('set-cookie') || '')) constats.push('cookie de session sans HttpOnly');
  if (!/SameSite=(Lax|Strict)/i.test(ins.h.get('set-cookie') || '')) constats.push('cookie de session sans SameSite');
  // CSRF : un formulaire d'un autre site ne peut envoyer que du texte/urlencoded
  const csrf = await req('PUT', '/api/admin/config', 'config=x', { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, true);
  if (csrf.s < 400) constats.push('requête non JSON acceptée (risque CSRF)');
  const csrf2 = await req('POST', '/api/abonnement/commencer', 'formule=pro', { Cookie: cookie, 'Content-Type': 'text/plain' }, true);
  if (csrf2.s < 400) constats.push('abonnement démarrable par un formulaire d’un autre site (CSRF)');
  await req('POST', '/api/auth/deconnexion', {}, { Cookie: cookie });
  const apres = await req('GET', '/api/abonnement', undefined, { Cookie: cookie });
  if (apres.s !== 401) constats.push(`session encore valide après déconnexion (${apres.s})`);
  // Énumération des comptes : même réponse que l'e-mail existe ou non
  const o1 = await req('POST', '/api/auth/oubli', { email }), o2 = await req('POST', '/api/auth/oubli', { email: 'inconnu' + Date.now() + '@exemple.ch' });
  if (o1.s !== o2.s || o1.t !== o2.t) constats.push('mot de passe oublié : réponse différente selon que le compte existe');
  const c1 = await req('POST', '/api/auth/connexion', { email, motDePasse: 'faux' }), c2 = await req('POST', '/api/auth/connexion', { email: 'x' + email, motDePasse: 'faux' });
  if (c1.t !== c2.t) constats.push('connexion : message différent selon que le compte existe');
  const rj = await req('POST', '/api/auth/reinitialiser', { jeton: 'faux', motDePasse: 'nouveau mot de passe' });
  if (rj.s < 400) constats.push('réinitialisation acceptée avec un faux jeton');
  // Rafale de commandes publiques depuis la même adresse
  let acceptees = 0;
  const pub = await req('GET', '/api/public/secu');
  for (let k = 0; k < 60; k++) { const r = await req('POST', '/api/public/secu/commandes', { lignes: [{ produitId: 'x', qte: 1 }], livraison: 'poste-eco', client: { nom: 'Spam', email: 's@exemple.ch', adresse: 'R', npa: '1003', ville: 'L' } }); if (r.s !== 429) acceptees++; }
  if (pub.s === 404 && acceptees === 60) constats.push('aucune limite de débit sur la création de commandes publiques (60 requêtes acceptées sans 429)');
  console.log(constats.length ? constats.join('\n') : 'aucun problème');
})();
