// Abonnements Comptoir : le marchand choisit une formule et paie avant d'accéder à son espace.
//  - « simulation » (sans clé Stripe) : page de paiement factice, renouvellement automatique sans débit.
//  - « stripe » : Stripe Checkout en mode abonnement (cartes ; Stripe ne propose pas TWINT pour les
//    paiements récurrents), puis webhooks : invoice.paid prolonge, invoice.payment_failed suspend,
//    customer.subscription.deleted résilie. Le portail client Stripe sert à changer de carte ou résilier.
'use strict';
const crypto = require('node:crypto');
const { erreur } = require('./http');

const JOUR = 86400000;
const PERIODE = 30 * JOUR;
const GRACE = 3 * JOUR;           // délai de grâce après une échéance non payée
const GRACE_IMPAYE = 7 * JOUR;    // paiement refusé : Stripe réessaie ; le marchand garde l'accès une semaine pour régulariser
// Version d'API figée : la forme des objets ne change pas sous nos pieds (Stripe en publie plusieurs par an).
const VERSION_STRIPE = '2024-06-20';
// Définition partagée avec l'application et la page de tarifs (js/formules.js).
const Formules = require('../../js/formules.js');
const FORMULES = Formules.FORMULES;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS abonnements (
  marchand_id TEXT PRIMARY KEY REFERENCES marchands(id) ON DELETE CASCADE,
  formule TEXT NOT NULL,
  statut TEXT NOT NULL,               -- en_attente | actif | impaye | resilie
  devise TEXT NOT NULL,
  periode_fin INTEGER,                -- fin de la période payée (ms)
  fin_demandee INTEGER NOT NULL DEFAULT 0,
  session_ref TEXT,                   -- session de paiement en cours
  ref_externe TEXT,                   -- abonnement Stripe (sub_…)
  client_externe TEXT,                -- client Stripe (cus_…)
  cree_le INTEGER NOT NULL,
  maj_le INTEGER NOT NULL
);`;

function creerGestion({ db, env, urlPublique, fetchImpl = fetch }) {
  db.exec(SCHEMA);
  const stripe = env.STRIPE_SECRET_KEY ? env.STRIPE_SECRET_KEY : null;
  const obligatoire = String(env.ABONNEMENT_OBLIGATOIRE || 'oui') !== 'non';
  const appelerStripe = async (methode, chemin, params = []) => {
    const corps = new URLSearchParams();
    for (const [k, v] of params) corps.append(k, String(v));
    const rep = await fetchImpl(`https://api.stripe.com/v1/${chemin}`, { method: methode, headers: { Authorization: `Bearer ${stripe}`, 'Stripe-Version': VERSION_STRIPE, 'Content-Type': 'application/x-www-form-urlencoded' }, body: methode === 'GET' ? undefined : corps });
    const json = await rep.json();
    if (!rep.ok) throw erreur(502, `Stripe : ${json.error ? json.error.message : rep.status}`, 'stripe');
    return json;
  };
  const lire = marchandId => db.prepare('SELECT * FROM abonnements WHERE marchand_id = ?').get(marchandId) || null;
  const maj = (marchandId, champs) => {
    const cles = Object.keys(champs);
    db.prepare(`UPDATE abonnements SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_le = ? WHERE marchand_id = ?`).run(...cles.map(k => champs[k]), Date.now(), marchandId);
  };

  /* En simulation, une période échue se renouvelle d'elle-même (aucun débit) ; une fin demandée la clôt. */
  function actualiser(a, maintenant = Date.now()) {
    if (!a || stripe || a.statut !== 'actif' || !a.periode_fin || a.periode_fin > maintenant) return a;
    if (a.fin_demandee) { maj(a.marchand_id, { statut: 'resilie' }); return lire(a.marchand_id); }
    let fin = a.periode_fin;
    while (fin <= maintenant) fin += PERIODE;
    maj(a.marchand_id, { periode_fin: fin });
    return lire(a.marchand_id);
  }
  function etat(marchandId, maintenant = Date.now()) {
    const a = actualiser(lire(marchandId), maintenant);
    const actif = !!a && (a.statut === 'actif' || a.statut === 'impaye') && a.periode_fin && a.periode_fin + (a.statut === 'impaye' ? GRACE_IMPAYE : GRACE) > maintenant;
    return {
      obligatoire, prestataire: stripe ? 'stripe' : 'simulation', actif: !obligatoire || actif,
      formule: a ? a.formule : null, statut: a ? a.statut : 'aucun', devise: a ? a.devise : null,
      periodeFin: a ? a.periode_fin : null, finDemandee: !!(a && a.fin_demandee),
      prix: a && FORMULES[a.formule] ? FORMULES[a.formule].prix : null
    };
  }
  function formulesPour(devise) {
    return Object.entries(FORMULES).map(([id, f]) => ({ id, ...f, devise }));
  }

  /* Démarre (ou reprend) le paiement d'une formule. Retourne l'URL de paiement. */
  async function commencer({ marchand, formule, devise }) {
    if (!FORMULES[formule]) throw erreur(400, 'Formule inconnue.', 'formule');
    const a = lire(marchand.id);
    if (a && a.statut === 'actif' && a.periode_fin > Date.now()) throw erreur(409, 'Votre abonnement est déjà actif.', 'deja_actif');
    // Une souscription Stripe existe encore (impayée, en période de grâce) : on la régularise dans le portail plutôt que d'en créer une seconde.
    if (stripe && a && a.ref_externe && a.statut !== 'resilie' && a.client_externe) return portail(marchand);
    // Retour de Checkout avant le webhook, ou second onglet : une session déjà payée n'est pas payée deux fois.
    if (stripe && a && a.session_ref && /^cs_/.test(a.session_ref)) {
      const ancienne = await appelerStripe('GET', `checkout/sessions/${encodeURIComponent(a.session_ref)}`).catch(() => null);
      if (ancienne && ancienne.status === 'complete') { await sessionTerminee(a, ancienne); throw erreur(409, 'Votre paiement est déjà enregistré : votre abonnement est actif.', 'deja_actif'); }
      if (ancienne && ancienne.status === 'open') await appelerStripe('POST', `checkout/sessions/${encodeURIComponent(a.session_ref)}/expire`).catch(() => {});
    }
    // Ancienne souscription impayée ou suspendue (statut local « résilié ») : arrêtée chez Stripe avant d'en créer une autre.
    if (stripe && a && a.ref_externe && a.statut === 'resilie') {
      const sub = await appelerStripe('GET', `subscriptions/${encodeURIComponent(a.ref_externe)}`).catch(() => null);
      if (sub && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') await appelerStripe('DELETE', `subscriptions/${encodeURIComponent(a.ref_externe)}`);
    }
    const ref = 'abo_' + crypto.randomBytes(12).toString('base64url');
    if (a) maj(marchand.id, { formule, devise, session_ref: ref, statut: a.statut === 'resilie' ? 'en_attente' : a.statut });
    else db.prepare('INSERT INTO abonnements (marchand_id, formule, statut, devise, session_ref, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)').run(marchand.id, formule, 'en_attente', devise, ref, Date.now(), Date.now());
    if (!stripe) return { url: `${urlPublique}/abonnement-simule/${ref}` };
    const f = FORMULES[formule];
    const s = await appelerStripe('POST', 'checkout/sessions', [
      ['mode', 'subscription'], ['payment_method_types[]', 'card'],
      ['success_url', `${urlPublique}/app?abonnement=ok`], ['cancel_url', `${urlPublique}/app?abonnement=annule`],
      ...(a && a.client_externe ? [['customer', a.client_externe]] : [['customer_email', marchand.email]]), ['client_reference_id', marchand.id],   // même client Stripe qu'avant
      ['metadata[abonnement_ref]', ref], ['subscription_data[metadata][marchand_id]', marchand.id], ['subscription_data[metadata][formule]', formule],
      ['line_items[0][quantity]', 1], ['line_items[0][price_data][currency]', devise.toLowerCase()],
      ['line_items[0][price_data][unit_amount]', Math.round(f.prix * 100)],
      ['line_items[0][price_data][recurring][interval]', 'month'],
      ['line_items[0][price_data][product_data][name]', `Comptoir ${f.nom}`]
    ]);
    maj(marchand.id, { session_ref: s.id });
    return { url: s.url };
  }

  function confirmerSimulation(ref) {
    const a = db.prepare('SELECT * FROM abonnements WHERE session_ref = ?').get(ref);
    if (!a) throw erreur(404, 'Paiement introuvable.', 'introuvable');
    maj(a.marchand_id, { statut: 'actif', periode_fin: Date.now() + PERIODE, fin_demandee: 0, session_ref: null });
    return a.marchand_id;
  }
  const parRefSimulation = ref => db.prepare('SELECT * FROM abonnements WHERE session_ref = ?').get(ref);

  /* Changer de formule : immédiat. Avec Stripe, la souscription elle-même change de prix (au prorata, sur la prochaine facture)
     et les droits suivent tout de suite ; le portail Stripe ne saurait pas le faire (prix créés à la volée). */
  async function changer({ marchand, formule }) {
    if (!FORMULES[formule]) throw erreur(400, 'Formule inconnue.', 'formule');
    const a = lire(marchand.id);
    if (!a || a.statut !== 'actif') throw erreur(409, 'Aucun abonnement actif à modifier.', 'inactif');
    if (a.formule === formule) return { ok: true };
    if (stripe) {
      if (!a.ref_externe) throw erreur(409, 'Abonnement Stripe introuvable : contactez le support.', 'inactif');
      const sub = await appelerStripe('GET', `subscriptions/${encodeURIComponent(a.ref_externe)}`);
      const item = sub.items && sub.items.data && sub.items.data[0];
      if (!item) throw erreur(502, 'Stripe : abonnement sans ligne de prix.', 'stripe');
      // Produit au nom de la nouvelle formule : les factures Stripe affichent « Comptoir Pro », pas l'ancien nom.
      // Un produit Stripe par formule, réutilisé (recherche par métadonnée) : pas de doublons à chaque changement.
      const trouves = await appelerStripe('GET', `products/search?query=${encodeURIComponent(`metadata['formule']:'${formule}' AND active:'true'`)}`).catch(() => ({ data: [] }));
      const produit = (trouves.data && trouves.data[0]) || await appelerStripe('POST', 'products', [['name', `Comptoir ${FORMULES[formule].nom}`], ['metadata[formule]', formule]]);
      await appelerStripe('POST', `subscriptions/${encodeURIComponent(a.ref_externe)}`, [
        ['items[0][id]', item.id], ['items[0][price_data][currency]', item.price.currency],
        ['items[0][price_data][product]', produit.id],
        ['cancel_at_period_end', 'false'],   // changer de formule annule une résiliation demandée, chez Stripe comme ici
        ['items[0][price_data][unit_amount]', Math.round(FORMULES[formule].prix * 100)], ['items[0][price_data][recurring][interval]', 'month'],
        // À la hausse : la différence est facturée tout de suite (sinon une résiliation avant l'échéance l'effacerait) ;
        // à la baisse : nouveau prix dès la prochaine échéance, sans avoir.
        ['proration_behavior', FORMULES[formule].prix > FORMULES[a.formule].prix ? 'always_invoice' : 'none'], ['metadata[formule]', formule],
        // Hausse : si le supplément n'est pas payé, rien ne change (pas de formule Pro offerte sur un paiement refusé).
        ['payment_behavior', FORMULES[formule].prix > FORMULES[a.formule].prix ? 'error_if_incomplete' : 'allow_incomplete']
      ]);
    }
    maj(marchand.id, { formule, fin_demandee: 0 });
    return { ok: true };
  }
  async function resilier({ marchand }) {
    const a = lire(marchand.id);
    if (!a || a.statut !== 'actif') throw erreur(409, 'Aucun abonnement actif.', 'inactif');
    // Avec Stripe : fin à l'échéance demandée directement (le portail pourrait être réglé pour une résiliation immédiate).
    if (stripe) { if (!a.ref_externe) return portail(marchand); await appelerStripe('POST', `subscriptions/${encodeURIComponent(a.ref_externe)}`, [['cancel_at_period_end', 'true']]); }
    maj(marchand.id, { fin_demandee: 1 });       // accès conservé jusqu'à la fin de la période payée
    return { ok: true };
  }
  async function reprendre({ marchand }) {
    const a = lire(marchand.id);
    if (!a || a.statut !== 'actif') throw erreur(409, 'Aucun abonnement actif.', 'inactif');
    if (stripe) { if (!a.ref_externe) return portail(marchand); await appelerStripe('POST', `subscriptions/${encodeURIComponent(a.ref_externe)}`, [['cancel_at_period_end', 'false']]); }
    maj(marchand.id, { fin_demandee: 0 });
    return { ok: true };
  }
  async function portail(marchand) {
    const a = lire(marchand.id);
    if (!a || !a.client_externe) throw erreur(409, 'Aucun client Stripe associé.', 'inactif');
    const s = await appelerStripe('POST', 'billing_portal/sessions', [['customer', a.client_externe], ['return_url', `${urlPublique}/app#parametres`]]);
    return { url: s.url };
  }

  /* État local tiré de la souscription Stripe elle-même (relue par l'API) : peu importe l'ordre, les doublons
     ou la version d'API des événements, et les lignes de prorata d'une facture. */
  const STATUTS = { active: 'actif', trialing: 'actif', past_due: 'impaye', unpaid: 'resilie', canceled: 'resilie', incomplete: 'en_attente', incomplete_expired: 'resilie', paused: 'resilie' };
  async function synchroniser(a, subId) {
    const sub = await appelerStripe('GET', `subscriptions/${encodeURIComponent(subId)}`);
    const f = sub.metadata && sub.metadata.formule;
    const statut = STATUTS[sub.status] || a.statut;
    // La fin de période n'avance que pour une période réellement payée : un impayé garde l'ancienne (+ 7 jours de grâce),
    // sinon Stripe, qui passe déjà à la période suivante, offrirait un mois de plus.
    const paye = statut === 'actif' && sub.current_period_end;
    const champs = { ref_externe: sub.id, client_externe: sub.customer || a.client_externe, statut,
      periode_fin: paye ? sub.current_period_end * 1000 : (a.periode_fin || (sub.current_period_start ? sub.current_period_start * 1000 : null)), fin_demandee: sub.cancel_at_period_end ? 1 : 0 };
    if (f && FORMULES[f]) champs.formule = f;
    maj(a.marchand_id, champs);
    return lire(a.marchand_id);
  }
  async function sessionTerminee(a, session) {
    const avant = lire(a.marchand_id);
    if (!avant.session_ref) return { abo: avant, devenuActif: false };   // déjà traitée (retour du client ou webhook) : pas de second e-mail
    maj(a.marchand_id, { session_ref: null, client_externe: session.customer || a.client_externe });
    const b = session.subscription ? await synchroniser(lire(a.marchand_id), session.subscription) : lire(a.marchand_id);
    return { abo: b, devenuActif: b.statut === 'actif' };
  }
  /* Retour de Checkout (?abonnement=ok) : le paiement est vérifié tout de suite, sans attendre le webhook. */
  async function verifierRetour(marchandId) {
    const a = lire(marchandId);
    if (!stripe || !a || !a.session_ref || !/^cs_/.test(a.session_ref)) return { etat: etat(marchandId), devenuActif: false };
    const s = await appelerStripe('GET', `checkout/sessions/${encodeURIComponent(a.session_ref)}`);
    const r = s.status === 'complete' ? await sessionTerminee(a, s) : { devenuActif: false };
    return { etat: etat(marchandId), devenuActif: r.devenuActif };
  }

  /* Événements Stripe déjà vérifiés (signature) par l'appelant. */
  async function evenementStripe(ev) {
    const o = ev.data && ev.data.object || {};
    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
      const a = db.prepare('SELECT * FROM abonnements WHERE session_ref = ? OR marchand_id = ?').get(o.id, o.client_reference_id || '');
      if (!a) return true;
      const r = await sessionTerminee(a, o);
      return r.devenuActif ? { marchandId: a.marchand_id, evenement: 'active' } : true;
    }
    // Facture : la souscription est à la racine (anciennes versions) ou sous parent.subscription_details (versions récentes).
    const sub = (typeof o.subscription === 'string' ? o.subscription : o.subscription && o.subscription.id)
      || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription)
      || (ev.type.startsWith('customer.subscription') ? o.id : null);
    const a = sub && db.prepare('SELECT * FROM abonnements WHERE ref_externe = ?').get(sub);
    if (!a) return false;
    if (!['invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted', 'customer.subscription.updated'].includes(ev.type)) return true;
    const b = await synchroniser(a, sub);
    if (b.statut === 'impaye' && a.statut !== 'impaye') return { marchandId: a.marchand_id, evenement: 'impaye' };
    if (b.statut === 'resilie' && a.statut !== 'resilie') return { marchandId: a.marchand_id, evenement: 'termine' };
    // E-mail de résiliation seulement quand elle vient d'être demandée (pas à chaque mise à jour de la souscription).
    if (b.fin_demandee && !a.fin_demandee) return { marchandId: a.marchand_id, evenement: 'resiliation' };
    return true;
  }

  /* Suppression du compte : résiliation immédiate de la souscription Stripe (refus si Stripe ne répond pas). */
  async function arreterDefinitivement(marchandId) {
    const a = lire(marchandId);
    if (stripe && a && a.ref_externe) {   // même « résilié » localement (impayé, suspendu), la souscription peut vivre encore chez Stripe
      const rep = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(a.ref_externe)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${stripe}`, 'Stripe-Version': VERSION_STRIPE } });
      if (!rep.ok && rep.status !== 404 && !(rep.status === 400 && a.statut === 'resilie')) throw erreur(502, 'Stripe ne confirme pas la résiliation : réessayez avant de supprimer le compte.', 'stripe');
    }
  }

  return { verifierRetour, arreterDefinitivement, FORMULES, formulesPour, etat, commencer, confirmerSimulation, parRefSimulation, changer, resilier, reprendre, evenementStripe, obligatoire, prestataire: stripe ? 'stripe' : 'simulation' };
}

function pageAbonnementSimule(a, marchandEmail) {
  const f = FORMULES[a.formule];
  const montant = a.devise === 'CHF' ? `CHF ${f.prix}.–` : `${f.prix} €`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paiement de l’abonnement</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#F4F5F7;color:#151821;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:#fff;border:1px solid #E0E3EA;border-radius:14px;padding:28px;max-width:420px;width:100%;display:grid;gap:14px}
h1{font-size:1.2rem;margin:0}.m{font-size:2rem;font-weight:700}.s{color:#5E6573;font-size:.85rem}
button{font:inherit;padding:12px;border-radius:9px;border:1px solid #2F55D4;background:#2F55D4;color:#fff;font-weight:600;cursor:pointer;width:100%}
button.f{background:#fff;color:#151821;border-color:#D0D4DC}.n{background:#FFF7E6;border:1px solid #F3D9A4;border-radius:9px;padding:10px 12px;font-size:.85rem}</style></head>
<body><main class="c"><h1>Comptoir ${f.nom}</h1><div class="m">${montant}<span class="s"> / mois</span></div>
<p class="s">Abonnement mensuel pour ${marchandEmail.replace(/[<>&"]/g, '')}. Résiliable à tout moment depuis Paramètres, sans frais.</p>
<p class="n">Mode test : aucun montant n’est débité. En production, le paiement passe par Stripe (carte).</p>
<form method="post" action="/abonnement-simule/${a.session_ref}/confirmer"><button>Payer et ouvrir ma boutique</button></form>
<form method="post" action="/abonnement-simule/${a.session_ref}/annuler"><button class="f">Annuler</button></form></main></body></html>`;
}

module.exports = { creerGestion, pageAbonnementSimule, FORMULES };
