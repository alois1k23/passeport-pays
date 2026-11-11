// Faux services externes pour essayer Comptoir de bout en bout, comme en production, sans compte réel :
//  - Stripe (paiements des boutiques via Connect, abonnements Comptoir, remboursements, litiges, webhooks signés) ;
//  - Brevo (envoi d'e-mails, avec pannes possibles) ;
//  - un fournisseur qui respecte le contrat du README (catalogue, commandes, webhook d'expédition signé).
// Les réponses imitent la forme des objets Stripe (version 2024-06-20) pour les champs que Comptoir lit.
// Ce n'est PAS Stripe : un essai en mode test avec un vrai compte reste nécessaire avant la mise en ligne.
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

function creerFauxServices({ urlComptoir, secretWebhook, secretWebhookConnect, secretFournisseur, cleFournisseur, journal = () => {} }) {
  const etat = {
    comptes: {}, sessions: {}, abonnements: {}, clients: {}, produits: {}, intents: {}, remboursements: [], webhooks: [],
    emails: [], panneEmail: false, refusCarte: false, commandesFournisseur: {}, appelsStripe: [], doublerWebhooks: false
  };
  let n = 0; const id = p => `${p}_${(++n).toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const maintenant = () => Math.floor(Date.now() / 1000);
  let base = '';

  /* Webhook signé vers Comptoir (comme Stripe : en-tête Stripe-Signature t=…,v1=HMAC-SHA256). */
  async function webhook(type, objet, compte = null) {
    const ev = { id: id('evt'), object: 'event', api_version: '2024-06-20', type, created: maintenant(), data: { object: objet }, ...(compte ? { account: compte } : {}) };
    const corps = JSON.stringify(ev), t = maintenant();
    const sig = crypto.createHmac('sha256', compte ? secretWebhookConnect : secretWebhook).update(`${t}.${corps}`).digest('hex');
    const envoyer = () => fetch(`${urlComptoir}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: corps }).then(r => r.status).catch(() => 0);
    const statut = await envoyer();
    etat.webhooks.push({ type, compte, statut });
    if (etat.doublerWebhooks) etat.webhooks.push({ type, compte, statut: await envoyer(), double: true });   // Stripe renvoie parfois un événement
    return statut;
  }

  const lireCorps = req => new Promise(ok => { let d = ''; req.on('data', c => d += c); req.on('end', () => ok(d)); });
  const formulaire = d => Object.fromEntries(new URLSearchParams(d));
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const page = (res, titre, corps) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>${titre}</title><body style="font:16px system-ui;max-width:480px;margin:40px auto"><h1>${titre}</h1><p><b>Faux Stripe</b> (essai) : aucun argent réel.</p>${corps}</body></html>`); };
  const erreurStripe = (res, code, message) => json(res, code, { error: { type: 'invalid_request_error', message } });

  function abonnementObjet(s) { return { id: s.id, object: 'subscription', status: s.status, customer: s.customer, current_period_start: s.debut, current_period_end: s.fin, cancel_at_period_end: !!s.cancel, metadata: s.metadata, items: { data: [{ id: s.item, price: { currency: s.devise, unit_amount: s.montant, product: s.produit } }] } }; }

  async function stripe(req, res, chemin, corps) {
    const compte = req.headers['stripe-account'] || null;
    const p = formulaire(corps);
    etat.appelsStripe.push({ methode: req.method, chemin, compte, idem: req.headers['idempotency-key'] || null, version: req.headers['stripe-version'] || null });
    if (!/^Bearer sk_(test|live)_/.test(req.headers.authorization || '')) return erreurStripe(res, 401, 'Invalid API Key provided');
    if (compte && !etat.comptes[compte]) return erreurStripe(res, 403, `No such account: '${compte}'`);
    // Comptes connectés (Express)
    if (req.method === 'POST' && chemin === 'accounts') {
      const cle = req.headers['idempotency-key'];
      const deja = cle && Object.values(etat.comptes).find(a => a.idem === cle);
      if (deja) return json(res, 200, deja.objet);
      const a = { id: id('acct'), object: 'account', type: 'express', country: p.country, email: p.email, charges_enabled: false, details_submitted: false, livemode: false, capabilities: { card_payments: 'inactive', transfers: 'inactive', ...(p['capabilities[twint_payments][requested]'] ? { twint_payments: 'inactive' } : {}), ...(p['capabilities[bancontact_payments][requested]'] ? { bancontact_payments: 'inactive' } : {}) } };
      etat.comptes[a.id] = { objet: a, idem: cle };
      return json(res, 200, a);
    }
    let m;
    if (req.method === 'GET' && (m = /^accounts\/([\w-]+)$/.exec(chemin))) return etat.comptes[m[1]] ? json(res, 200, etat.comptes[m[1]].objet) : erreurStripe(res, 404, `No such account: '${m[1]}'`);
    if (req.method === 'POST' && chemin === 'account_links') {
      if (!etat.comptes[p.account]) return erreurStripe(res, 404, `No such account: '${p.account}'`);
      return json(res, 200, { object: 'account_link', url: `${base}/connect/${p.account}?retour=${encodeURIComponent(p.return_url)}`, expires_at: maintenant() + 300 });
    }
    // Sessions Checkout (paiement d'une commande sur le compte d'une boutique, ou abonnement Comptoir)
    if (req.method === 'POST' && chemin === 'checkout/sessions') {
      const moyens = Object.entries(p).filter(([k]) => k === 'payment_method_types[]').map(([, v]) => v);
      const tous = new URLSearchParams(corps).getAll('payment_method_types[]');
      if (compte) {
        const cap = etat.comptes[compte].objet.capabilities;
        for (const mp of tous) if (mp === 'twint' && cap.twint_payments !== 'active') return erreurStripe(res, 400, 'The payment method type "twint" is invalid. Please ensure the provided type is activated in your dashboard.');
        if (!etat.comptes[compte].objet.charges_enabled) return erreurStripe(res, 400, 'Your account cannot currently make live charges.');
      }
      let total = 0; for (let i = 0; p[`line_items[${i}][quantity]`]; i++) total += Number(p[`line_items[${i}][quantity]`]) * Number(p[`line_items[${i}][price_data][unit_amount]`] || 0);
      const s = { id: id('cs_test'), object: 'checkout.session', mode: p.mode, status: 'open', payment_status: 'unpaid', compte, total, devise: p['line_items[0][price_data][currency]'], success_url: p.success_url, cancel_url: p.cancel_url,
        client_reference_id: p.client_reference_id || null, customer: p.customer || null, customer_email: p.customer_email || null, metadata: Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])),
        sub_metadata: Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('subscription_data[metadata][')).map(([k, v]) => [k.slice(28, -1), v])), moyens: tous, payment_intent: null, subscription: null };
      etat.sessions[s.id] = s;
      void moyens;
      return json(res, 200, { ...vueSession(s), url: `${base}/checkout/${s.id}` });
    }
    if ((m = /^checkout\/sessions\/([\w-]+)(\/expire)?$/.exec(chemin))) {
      const s = etat.sessions[m[1]];
      if (!s || (s.compte || null) !== (compte || null)) return erreurStripe(res, 404, `No such checkout.session: '${m[1]}'`);
      if (m[2]) { if (s.status === 'open') s.status = 'expired'; return json(res, 200, vueSession(s)); }
      return json(res, 200, vueSession(s));
    }
    if (req.method === 'POST' && chemin === 'refunds') {
      const pi = etat.intents[p.payment_intent];
      if (!pi || (pi.compte || null) !== (compte || null)) return erreurStripe(res, 404, `No such payment_intent: '${p.payment_intent}'`);
      const r = { id: id('re'), object: 'refund', payment_intent: p.payment_intent, amount: pi.montant, status: 'succeeded' };
      etat.remboursements.push({ ...r, compte }); return json(res, 200, r);
    }
    // Abonnements Comptoir (compte de la plateforme)
    if ((m = /^subscriptions\/([\w-]+)$/.exec(chemin))) {
      const s = etat.abonnements[m[1]]; if (!s) return erreurStripe(res, 404, `No such subscription: '${m[1]}'`);
      if (req.method === 'GET') return json(res, 200, abonnementObjet(s));
      if (req.method === 'DELETE') { s.status = 'canceled'; await webhook('customer.subscription.deleted', abonnementObjet(s)); return json(res, 200, abonnementObjet(s)); }
      if (p.cancel_at_period_end) s.cancel = p.cancel_at_period_end === 'true';
      if (p['items[0][price_data][unit_amount]']) {
        const nouveau = Number(p['items[0][price_data][unit_amount]']);
        if (nouveau > s.montant && p.proration_behavior === 'always_invoice' && etat.refusCarte && p.payment_behavior === 'error_if_incomplete') return json(res, 402, { error: { type: 'card_error', message: 'Your card was declined.' } });
        s.montant = nouveau; s.produit = p['items[0][price_data][product]'] || s.produit;
      }
      if (p['metadata[formule]']) s.metadata.formule = p['metadata[formule]'];
      setTimeout(() => webhook('customer.subscription.updated', abonnementObjet(s)), 50);
      return json(res, 200, abonnementObjet(s));
    }
    if (req.method === 'GET' && chemin.startsWith('products/search')) return json(res, 200, { data: Object.values(etat.produits).filter(x => chemin.includes(encodeURIComponent(x.metadata.formule)) || chemin.includes(x.metadata.formule)) });
    if (req.method === 'POST' && chemin === 'products') { const pr = { id: id('prod'), name: p.name, metadata: { formule: p['metadata[formule]'] } }; etat.produits[pr.id] = pr; return json(res, 200, pr); }
    if (req.method === 'POST' && chemin === 'billing_portal/sessions') return json(res, 200, { url: `${base}/portail?retour=${encodeURIComponent(p.return_url)}` });
    return erreurStripe(res, 404, `Unrecognized request URL (${req.method}: /v1/${chemin}) — non imité par le faux Stripe`);
  }
  function vueSession(s) { return { id: s.id, object: 'checkout.session', mode: s.mode, status: s.status, payment_status: s.payment_status, payment_intent: s.payment_intent, subscription: s.subscription, customer: s.customer, client_reference_id: s.client_reference_id, metadata: s.metadata, amount_total: s.total }; }

  /* Paiement sur la page hébergée (le client clique « Payer ») */
  async function payer(s) {
    if (s.status !== 'open') return false;
    if (etat.refusCarte) return false;
    s.status = 'complete'; s.payment_status = 'paid';
    if (s.mode === 'subscription') {
      const cus = s.customer || id('cus'); s.customer = cus; etat.clients[cus] = { email: s.customer_email };
      const sub = { id: id('sub'), status: 'active', customer: cus, debut: maintenant(), fin: maintenant() + 30 * 86400, metadata: s.sub_metadata, item: id('si'), devise: s.devise, montant: s.total, produit: null, cancel: false };
      etat.abonnements[sub.id] = sub; s.subscription = sub.id;
      await webhook('checkout.session.completed', vueSession(s));
      await webhook('invoice.paid', { id: id('in'), object: 'invoice', subscription: sub.id, billing_reason: 'subscription_create', lines: { data: [{ period: { end: sub.fin } }] } });
    } else {
      const pi = id('pi'); s.payment_intent = pi; etat.intents[pi] = { compte: s.compte, montant: s.total, session: s.id };
      await webhook('checkout.session.completed', vueSession(s), s.compte);
    }
    return true;
  }

  /* Pilotage des scénarios (appelé par le script d'essai) */
  const pilote = {
    etat,
    async renouveler(subId, { refus = false } = {}) {
      const s = etat.abonnements[subId];
      s.debut = s.fin; s.fin = s.fin + 30 * 86400;   // Stripe passe à la période suivante même si le paiement échoue
      if (refus) { s.status = 'past_due'; await webhook('invoice.payment_failed', { id: id('in'), object: 'invoice', subscription: subId, attempt_count: 1 }); }
      else { s.status = 'active'; await webhook('invoice.paid', { id: id('in'), object: 'invoice', parent: { subscription_details: { subscription: subId } }, lines: { data: [{ proration: true, period: { end: s.debut } }, { period: { end: s.fin } }] } }); }
    },
    async litige(pi, raison = 'fraudulent') {
      const intent = etat.intents[pi];
      return webhook('charge.dispute.created', { id: id('dp'), object: 'dispute', payment_intent: pi, amount: intent.montant, reason: raison, status: 'needs_response', evidence_details: { due_by: maintenant() + 7 * 86400 } }, intent.compte);
    },
    activerTwint(compte) { const a = etat.comptes[compte].objet; a.capabilities.twint_payments = 'active'; return webhook('account.updated', a, compte); },
    async expedierFournisseur(ref) {
      const c = etat.commandesFournisseur[ref]; if (!c || c.statut === 'expediee') return 0;
      c.statut = 'expediee';
      const corps = JSON.stringify({ ref, statut: 'expediee', transporteur: 'La Poste', suivi: `99.60.${String(Object.keys(etat.commandesFournisseur).indexOf(ref) + 100000)}.12345678` });
      const sig = crypto.createHmac('sha256', secretFournisseur).update(corps).digest('hex');
      return (await fetch(`${urlComptoir}/api/webhooks/fournisseurs/principal`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sig }, body: corps })).status;
    }
  };

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), corps = await lireCorps(req);
    try {
      if (url.pathname.startsWith('/v1/')) return await stripe(req, res, url.pathname.slice(4) + (url.search || ''), corps);
      let m;
      if ((m = /^\/checkout\/([\w-]+)$/.exec(url.pathname))) {
        const s = etat.sessions[m[1]]; if (!s) return page(res, 'Session inconnue', '');
        if (req.method === 'POST') {
          const f = formulaire(corps);
          if (f.action === 'annuler') { res.writeHead(303, { Location: s.cancel_url }); return res.end(); }
          const ok = await payer(s);
          if (!ok) return page(res, 'Carte refusée', `<p>Votre banque a refusé le paiement.</p><a href="${s.cancel_url}">Retour à la boutique</a>`);
          res.writeHead(303, { Location: s.success_url }); return res.end();
        }
        return page(res, s.mode === 'subscription' ? 'Abonnement Comptoir' : 'Paiement de la commande', `<p>Montant : <b data-montant>${(s.total / 100).toFixed(2)} ${String(s.devise).toUpperCase()}</b></p><p>Moyens : ${s.moyens.join(', ')}</p>
          <form method="post"><button name="action" value="payer" id="payer">Payer</button> <button name="action" value="annuler" id="annuler">Annuler</button></form>`);
      }
      if ((m = /^\/connect\/([\w-]+)$/.exec(url.pathname))) {
        const a = etat.comptes[m[1]] && etat.comptes[m[1]].objet;
        if (!a) return page(res, 'Compte inconnu', '');
        if (req.method === 'POST') {
          Object.assign(a, { charges_enabled: true, details_submitted: true }); a.capabilities.card_payments = 'active'; a.capabilities.transfers = 'active';
          if (a.capabilities.twint_payments) a.capabilities.twint_payments = 'pending';   // TWINT : validation à part chez Stripe
          if (a.capabilities.bancontact_payments) a.capabilities.bancontact_payments = 'active';
          await webhook('account.updated', a, a.id);
          res.writeHead(303, { Location: url.searchParams.get('retour') }); return res.end();
        }
        return page(res, 'Activer vos paiements', `<p>Identité et IBAN de l’entreprise (fictifs).</p><form method="post"><button id="valider">Valider</button></form>`);
      }
      if (url.pathname === '/portail') { res.writeHead(303, { Location: url.searchParams.get('retour') }); return res.end(); }
      // Faux Brevo
      if (url.pathname === '/v3/smtp/email' && req.method === 'POST') {
        if (req.headers['api-key'] !== 'cle-brevo-essai') return json(res, 401, { message: 'Key not found' });
        if (etat.panneEmail) return json(res, 503, { message: 'Service Unavailable' });
        const e = JSON.parse(corps); etat.emails.push({ a: e.to[0].email, sujet: e.subject, texte: e.textContent, de: e.sender, repondreA: e.replyTo, entetes: e.headers || {} });
        return json(res, 201, { messageId: id('msg') });
      }
      // Faux fournisseur (contrat du README)
      if (url.pathname.startsWith('/fournisseur/')) {
        if (req.headers.authorization !== `Bearer ${cleFournisseur}`) return json(res, 401, { erreur: 'Clé API invalide' });
        if (url.pathname === '/fournisseur/catalogue') return json(res, 200, [
          { id: 'FR-LAMPE-01', nom: 'Lampe en lin', categorie: 'Luminaires', cout: 18, portF: 4.5, entrepot: 'UE', delai: [3, 5], prix: 49, fournisseur: 'Atelier Lumière (FR)', niche: 'maison', description: 'Lampe à poser, abat-jour en lin.' },
          { id: 'CH-TASSE-02', nom: 'Tasse en grès', categorie: 'Cuisine', cout: 7, portF: 3, entrepot: 'CH', delai: [1, 2], prix: 24, fournisseur: 'Céramique Léman (CH)', niche: 'maison', description: 'Tasse tournée main.' }
        ]);
        if (url.pathname === '/fournisseur/commandes' && req.method === 'POST') {
          const cle = req.headers['idempotency-key'];
          const deja = cle && Object.entries(etat.commandesFournisseur).find(([, c]) => c.cle === cle);
          if (deja) return json(res, 200, { ref: deja[0], statut: deja[1].statut });
          const c = JSON.parse(corps), ref = id('SUP');
          etat.commandesFournisseur[ref] = { ...c, cle, statut: 'recue' };
          return json(res, 201, { ref, statut: 'recue' });
        }
      }
      res.writeHead(404); res.end();
    } catch (e) { journal(e); json(res, 500, { error: { message: e.message } }); }
  });
  return { serveur, pilote, demarrer: () => new Promise(ok => serveur.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${serveur.address().port}`; ok(base); })) };
}

module.exports = { creerFauxServices };
