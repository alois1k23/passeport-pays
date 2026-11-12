/* Score de risque d'une commande (fraude, carte volée, revente) : règles explicables, sans boîte noire.
   Chaque point vient avec sa raison, en clair, pour que le marchand décide en connaissance de cause.
   Le score ne bloque jamais une vente : il retient seulement la transmission automatique au fournisseur
   (dropshipping) quand il est élevé, pour éviter de payer un fournisseur avant un litige bancaire. */
'use strict';

// Domaines d'adresses e-mail jetables les plus courants.
const JETABLES = new Set(`yopmail.com yopmail.fr yopmail.net mailinator.com guerrillamail.com guerrillamail.net sharklasers.com 10minutemail.com
10minutemail.net tempmail.com temp-mail.org tempmail.net throwawaymail.com trashmail.com trashmail.de getnada.com nada.email dispostable.com
maildrop.cc mailnesia.com mintemail.com mohmal.com emailondeck.com fakeinbox.com spamgourmet.com jetable.org mail-temporaire.fr
moakt.com tempr.email discard.email mailcatch.com burnermail.io spambox.us 33mail.com tempinbox.com emailfake.com fakemail.net`.split(/\s+/));

/* Fenêtres glissantes en mémoire (remises à zéro au redémarrage). Les clés et les valeurs sont des empreintes
   (HMAC, clé aléatoire du processus) : ni e-mail ni adresse IP en clair, même en mémoire ; effacées après 24 h.
   On compte des valeurs DISTINCTES : un même client qui réessaie son paiement n'est pas une « rafale ». */
function creerCompteurs() {
  const crypto = require('node:crypto'), cleProcessus = crypto.randomBytes(32);
  const h = t => crypto.createHmac('sha256', cleProcessus).update(String(t)).digest('base64url').slice(0, 22);
  const m = new Map();
  let menage = Date.now();
  const nettoyer = t => { if (t - menage < 600000) return; menage = t; for (const [k, l] of m) { const r = l.filter(x => t - x.t < 86400000); if (r.length) m.set(k, r); else m.delete(k); } };
  return {
    ajouter(cle, valeur, t = Date.now()) {
      nettoyer(t);
      const k = h(cle), l = (m.get(k) || []).filter(x => t - x.t < 86400000);
      l.push({ t, v: h(valeur) }); m.delete(k); m.set(k, l);   // réinsérée : l'éviction touche la clé la moins récente
      if (m.size > 50000) m.delete(m.keys().next().value);
    },
    // Nombre de valeurs distinctes vues pour « cle » dans la fenêtre, sans compter « sauf » (le client actuel).
    distincts(cle, fenetre, sauf, t = Date.now()) { const hs = h(sauf); return new Set((m.get(h(cle)) || []).filter(x => t - x.t < fenetre && x.v !== hs).map(x => x.v)).size; }
  };
}

const sansVoyelle = t => { const l = String(t || '').toLowerCase().replace(/[^a-zà-ÿœ]/g, ''); return l.length >= 6 && !/[aeiouyàáâãäåæéèêëìíîïòóôõöøœùúûü]/.test(l); };

/* c : commande ; contexte : { reseau, compteurs, panierMoyen, clientConnu, paysBoutique } */
function evaluer(c, { reseau, compteurs, panierMoyen = 0, clientConnu = false, boutique = '' }) {
  const raisons = [];
  const ajouter = (points, texte) => raisons.push({ points, texte });
  const email = String(c.client && c.client.email || '').toLowerCase(), domaine = email.split('@')[1] || '';
  if (JETABLES.has(domaine)) ajouter(30, `Adresse e-mail jetable (${domaine})`);
  if (/^[a-z]{1,3}\d{6,}@/.test(email)) ajouter(10, 'Adresse e-mail générée (lettres puis longue suite de chiffres)');
  const nom = String(c.client && c.client.nom || '');
  if (sansVoyelle(nom) || /(.)\1{3,}/.test(nom.toLowerCase())) ajouter(20, 'Nom du client incohérent');
  // Rafale dans CETTE boutique : plusieurs clients différents depuis le même réseau en une heure, ou une même adresse
  // e-mail utilisée depuis plusieurs réseaux en 24 h (cartes testées). Un client qui réessaie son paiement ne compte pas.
  const autresClients = reseau && email ? compteurs.distincts(`r:${boutique}:${reseau}`, 3600000, email) : 0;
  const autresReseaux = reseau && email ? compteurs.distincts(`e:${boutique}:${email}`, 86400000, reseau) : 0;
  if (autresClients >= 3) ajouter(Math.min(40, 10 * autresClients), `${autresClients} autres clients depuis le même réseau en une heure`);
  if (autresReseaux >= 2) ajouter(Math.min(30, 10 * autresReseaux), `Même adresse e-mail depuis ${autresReseaux + 1} réseaux différents en 24 h`);
  // Quantités de revente et montants inhabituels : plafonnés ensemble, ils ne suffisent jamais seuls à un risque élevé
  // (un client professionnel qui commande en nombre n'est pas un fraudeur).
  const maxQte = Math.max(0, ...(c.lignes || []).map(l => l.qte || 0));
  const volume = [];
  if (maxQte >= 5) volume.push([maxQte >= 10 ? 25 : 15, `${maxQte} exemplaires du même article`]);
  if (panierMoyen > 0 && c.total > 4 * panierMoyen && c.total >= 150) volume.push([20, `Montant ${Math.round(c.total / panierMoyen)} fois supérieur au panier moyen de la boutique`]);
  if (!clientConnu && c.total >= 500) volume.push([10, 'Premier achat d’un montant élevé']);
  let resteVolume = 45;
  for (const [pts, texte] of volume) { const p = Math.min(pts, resteVolume); resteVolume -= p; ajouter(p, texte); }
  if (clientConnu && raisons.length) ajouter(-15, 'Client ayant déjà acheté et payé');
  const score = Math.max(0, Math.min(100, raisons.reduce((a, r) => a + r.points, 0)));
  return { score, niveau: score >= 60 ? 'eleve' : score >= 30 ? 'moyen' : 'faible', raisons: raisons.filter(r => r.points > 0).map(r => r.texte), le: Date.now() };
}

module.exports = { evaluer, creerCompteurs, JETABLES };
