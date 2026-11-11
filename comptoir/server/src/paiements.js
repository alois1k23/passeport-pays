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

function prestataireStripe({ cleSecrete, secretWebhook, fetchImpl = fetch }) {
  const appeler = async (chemin, params) => {
    const corps = new URLSearchParams();
    for (const [k, v] of params) corps.append(k, String(v));
    const rep = await fetchImpl(`https://api.stripe.com/v1/${chemin}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cleSecrete}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps
    });
    const json = await rep.json();
    if (!rep.ok) throw erreur(502, `Stripe : ${json.error ? json.error.message : rep.status}`, 'stripe');
    return json;
  };
  return {
    nom: 'stripe',
    async creerSession({ paiement, commande, devise, urlRetour, urlAnnulation, pays }) {
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
      if (d === 'chf') params.push(['payment_method_types[]', 'twint']);
      // Belgique : Bancontact, le moyen de paiement le plus utilisé du pays (Stripe le propose en EUR).
      if (d === 'eur' && pays === 'be') params.push(['payment_method_types[]', 'bancontact']);
      commande.lignes.forEach((l, i) => {
        params.push([`line_items[${i}][quantity]`, l.qte], [`line_items[${i}][price_data][currency]`, d],
          [`line_items[${i}][price_data][unit_amount]`, centimes(l.prix)], [`line_items[${i}][price_data][product_data][name]`, l.nom]);
      });
      if (commande.port > 0) {
        const i = commande.lignes.length;
        params.push([`line_items[${i}][quantity]`, 1], [`line_items[${i}][price_data][currency]`, d],
          [`line_items[${i}][price_data][unit_amount]`, centimes(commande.port)], [`line_items[${i}][price_data][product_data][name]`, 'Livraison']);
      }
      const s = await appeler('checkout/sessions', params);
      return { url: s.url, refExterne: s.id };
    },
    async expirer(p) {
      if (!p.ref_externe || !/^cs_/.test(p.ref_externe)) return;
      await appeler(`checkout/sessions/${p.ref_externe}/expire`, []);
    },
    async rembourser({ paiement }) {
      if (!paiement.ref_externe) return { ok: false };
      // ref_externe = session Checkout ; le remboursement passe par le payment_intent.
      const rep = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${paiement.ref_externe}`, { headers: { Authorization: `Bearer ${cleSecrete}` } });
      const s = await rep.json();
      if (!s.payment_intent) throw erreur(502, 'Stripe : paiement introuvable pour le remboursement.', 'stripe');
      await appeler('refunds', [['payment_intent', s.payment_intent]]);
      return { ok: true };
    },
    /* Vérifie l'en-tête Stripe-Signature (HMAC-SHA256, tolérance 5 minutes). */
    verifierWebhook(corpsBrut, entete, maintenant = Date.now()) {
      return verifierSignatureStripe(corpsBrut, entete, secretWebhook, maintenant);
    }
  };
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

function choisirPrestataire(env, urlPublique) {
  if (env.STRIPE_SECRET_KEY) return prestataireStripe({ cleSecrete: env.STRIPE_SECRET_KEY, secretWebhook: env.STRIPE_WEBHOOK_SECRET });
  return prestataireSimulation({ urlPublique });
}

module.exports = { choisirPrestataire, prestataireSimulation, prestataireStripe, verifierSignatureStripe, centimes };
