// Paiements. Deux prestataires derrière la même interface :
//  - « simulation » (par défaut, aucune clé) : une page de paiement factice suit
//    exactement le même parcours que le vrai (redirection, confirmation, retour).
//  - « stripe » (si STRIPE_SECRET_KEY est défini) : Stripe Checkout avec TWINT et
//    cartes en CHF, confirmation par webhook signé.
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const centimes = n => Math.round(n * 100);

function prestataireSimulation({ urlPublique }) {
  return {
    nom: 'simulation',
    async creerSession({ paiement }) {
      return { url: `${urlPublique}/paiement-simule/${paiement.id}`, refExterne: paiement.id };
    },
    async rembourser() { return { ok: true }; }
  };
}

/* Stripe Connect : chaque boutique encaisse sur SON compte Stripe (paiement « direct » sur le compte connecté,
   en-tête Stripe-Account). La plateforme ne détient jamais l'argent des ventes des marchands, et ne prend aucune commission. */
function prestataireStripe({ cleSecrete, secretWebhook, secretWebhookConnect, fetchImpl = fetch, baseStripe = 'https://api.stripe.com' }) {
  const entetes = compte => ({ Authorization: `Bearer ${cleSecrete}`, 'Stripe-Version': '2024-06-20', ...(compte ? { 'Stripe-Account': compte } : {}) });   // version figée, comme pour les abonnements
  const lire = async (chemin, compte) => {
    const rep = await fetchImpl(`${baseStripe}/v1/${chemin}`, { headers: entetes(compte) });
    const json = await rep.json();
    if (!rep.ok) { const e = erreur(502, `Stripe : ${json.error ? json.error.message : rep.status}`, 'stripe'); e.refuse = rep.status >= 400 && rep.status < 500; throw e; }
    return json;
  };
  const appeler = async (chemin, params, compte, cleIdempotence) => {
    const corps = new URLSearchParams();
    for (const [k, v] of params) corps.append(k, String(v));
    const rep = await fetchImpl(`${baseStripe}/v1/${chemin}`, {
      method: 'POST',
      headers: { ...entetes(compte), 'Content-Type': 'application/x-www-form-urlencoded', ...(cleIdempotence ? { 'Idempotency-Key': cleIdempotence } : {}) },
      body: corps
    });
    const json = await rep.json();
    if (!rep.ok) {
      // refuse : Stripe a répondu et refusé (4xx) ; rien n'a été exécuté. Une coupure ou une erreur 5xx laisse un doute.
      const e = erreur(502, `Stripe : ${json.error ? json.error.message : rep.status}`, 'stripe'); e.refuse = rep.status >= 400 && rep.status < 500; throw e;
    }
    return json;
  };
  return {
    nom: 'stripe',
    async creerSession({ paiement, commande, devise, urlRetour, urlAnnulation, pays, compte, moyens = null }) {
      const d = devise.toLowerCase();
      const params = [
        ['mode', 'payment'],
        ['payment_method_types[]', 'card'],
        ['success_url', urlRetour],
        ['cancel_url', urlAnnulation],
        ['client_reference_id', commande.id],
        ['customer_email', commande.client.email],
        ['metadata[commande_id]', commande.id],
        ['metadata[paiement_id]', paiement.id]
      ];
      // TWINT n'est proposé par Stripe qu'en CHF.
      // Sur un compte connecté, seulement si Stripe a activé ce moyen pour la boutique (sinon la session entière est refusée).
      const permis = m => !compte || !!(moyens && moyens[m] === true);   // même règle que la boutique publique
      if (d === 'chf' && permis('twint')) params.push(['payment_method_types[]', 'twint']);
      // Belgique : Bancontact, le moyen de paiement le plus utilisé du pays (Stripe le propose en EUR).
      if (d === 'eur' && pays === 'be' && permis('bancontact')) params.push(['payment_method_types[]', 'bancontact']);
      // Partie payée par carte cadeau : une seule ligne, du montant restant à payer (Checkout ne connaît pas les cartes cadeaux).
      // Devis : prix unitaires non arrondis (totaux calculés par ligne) ; le montant exact est celui du paiement.
      if ((commande.carteCadeau || commande.canal === 'devis') && Number.isInteger(paiement.montant_centimes)) {
        params.push(['line_items[0][quantity]', 1], ['line_items[0][price_data][currency]', d], ['line_items[0][price_data][unit_amount]', paiement.montant_centimes],
          ['line_items[0][price_data][product_data][name]', commande.carteCadeau ? `Commande n° ${commande.numero} (après carte cadeau)` : `Commande n° ${commande.numero} (devis ${commande.devis ? commande.devis.numero : ''})`]);
        const s = await appeler('checkout/sessions', params, compte);
        return { url: s.url, refExterne: s.id };
      }
      commande.lignes.forEach((l, i) => {
        params.push([`line_items[${i}][quantity]`, l.qte], [`line_items[${i}][price_data][currency]`, d],
          [`line_items[${i}][price_data][unit_amount]`, centimes(l.prix)], [`line_items[${i}][price_data][product_data][name]`, l.nom]);
      });
      if (commande.port > 0) {
        const i = commande.lignes.length;
        params.push([`line_items[${i}][quantity]`, 1], [`line_items[${i}][price_data][currency]`, d],
          [`line_items[${i}][price_data][unit_amount]`, centimes(commande.port)], [`line_items[${i}][price_data][product_data][name]`, 'Livraison']);
      }
      const s = await appeler('checkout/sessions', params, compte);
      return { url: s.url, refExterne: s.id };
    },
    async expirer(p) {
      if (!p.ref_externe || !/^cs_/.test(p.ref_externe)) return;
      await appeler(`checkout/sessions/${p.ref_externe}/expire`, [], p.compte || null);
    },
    // montant (centimes) : remboursement partiel ; sans montant, Stripe rembourse tout ce qui n'a pas encore été remboursé.
    // cle : clé d'idempotence (une requête répétée après une coupure ne rembourse pas deux fois).
    async rembourser({ paiement, montant, cle }) {
      if (!paiement.ref_externe) return { ok: false };
      // ref_externe = session Checkout ; le remboursement passe par le payment_intent, sur le compte qui a encaissé.
      const s = await lire(`checkout/sessions/${paiement.ref_externe}`, paiement.compte || null);
      if (!s.payment_intent) { const e = erreur(502, 'Stripe : paiement introuvable pour le remboursement.', 'stripe'); e.refuse = true; throw e; }   // rien n'a été remboursé
      await appeler('refunds', [['payment_intent', s.payment_intent], ...(montant ? [['amount', montant]] : [])], paiement.compte || null, cle);
      return { ok: true };
    },
    /* Compte Stripe du marchand (Express) : créé par la plateforme, activé par le marchand chez Stripe (identité, IBAN). */
    async creerCompte({ pays, email, cleIdempotence }) {
      const params = [['type', 'express'], ['country', String(pays || 'ch').toUpperCase()], ['email', email || ''],
        ['capabilities[card_payments][requested]', 'true'], ['capabilities[transfers][requested]', 'true']];
      if (pays === 'ch') params.push(['capabilities[twint_payments][requested]', 'true']);
      if (pays === 'be') params.push(['capabilities[bancontact_payments][requested]', 'true']);
      return (await appeler('accounts', params, null, cleIdempotence)).id;
    },
    async lienActivation({ compte, urlRetour, urlRafraichir }) {
      return (await appeler('account_links', [['account', compte], ['type', 'account_onboarding'], ['return_url', urlRetour], ['refresh_url', urlRafraichir]])).url;
    },
    async etatCompte(compte) {
      let a;
      try { a = await lire(`accounts/${compte}`); }
      catch (e) { if (/No such account/i.test(e.message)) return { introuvable: true, pret: false }; throw e; }   // seulement un compte vraiment inexistant (pas un problème de droits)
      return etatDepuisCompte(a);
    },
    // Le paiement est-il passé ? (retour du client, au cas où le webhook tarde ou manque)
    async sessionPayee(p) {
      if (!p.ref_externe || !/^cs_/.test(p.ref_externe)) return false;
      const s = await lire(`checkout/sessions/${p.ref_externe}`, p.compte || null);
      return s.payment_status === 'paid' ? (s.payment_intent || true) : false;   // payment_intent : sert à retrouver un litige
    },
    modeCle: /^sk_live_/.test(cleSecrete) ? 'live' : 'test',
    /* Vérifie l'en-tête Stripe-Signature (HMAC-SHA256, tolérance 5 minutes) : webhook de la plateforme, ou celui des comptes connectés. */
    verifierWebhook(corpsBrut, entete, maintenant = Date.now()) {
      return verifierSignatureStripe(corpsBrut, entete, secretWebhook, maintenant) || (!!secretWebhookConnect && verifierSignatureStripe(corpsBrut, entete, secretWebhookConnect, maintenant));
    }
  };
}

/* État d'un compte connecté : prêt à encaisser, et moyens de paiement réellement activés par Stripe. */
function etatDepuisCompte(a) {
  const cap = a.capabilities || {};
  return { pret: !!(a.charges_enabled && a.details_submitted), detailsEnvoyes: !!a.details_submitted, livemode: a.livemode,
    moyens: { twint: cap.twint_payments === 'active', bancontact: cap.bancontact_payments === 'active' } };
}

function verifierSignatureStripe(corpsBrut, entete, secret, maintenant = Date.now()) {
  if (!entete || !secret) return false;
  const parts = Object.fromEntries(String(entete).split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const signatures = String(entete).split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(maintenant / 1000 - t) > 300) return false;
  const attendu = crypto.createHmac('sha256', secret).update(`${t}.${corpsBrut}`).digest('hex');
  return signatures.some(s => Buffer.byteLength(s) === Buffer.byteLength(attendu) && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(attendu)));
}

function choisirPrestataire(env, urlPublique, fetchImpl = fetch) {
  if (env.STRIPE_SECRET_KEY) return prestataireStripe({ cleSecrete: env.STRIPE_SECRET_KEY, secretWebhook: env.STRIPE_WEBHOOK_SECRET, secretWebhookConnect: env.STRIPE_CONNECT_WEBHOOK_SECRET, fetchImpl, baseStripe: env.STRIPE_API_URL || 'https://api.stripe.com' });   // STRIPE_API_URL : essais avec un faux Stripe uniquement
  return prestataireSimulation({ urlPublique });
}

module.exports = { etatDepuisCompte, choisirPrestataire, prestataireSimulation, prestataireStripe, verifierSignatureStripe, centimes };
