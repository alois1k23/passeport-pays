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

/* Fenêtres glissantes en mémoire : nombre de commandes par réseau et par e-mail (remis à zéro au redémarrage). */
function creerCompteurs() {
  const m = new Map();
  return {
    ajouter(cle, t = Date.now()) { const l = (m.get(cle) || []).filter(x => t - x < 86400000); l.push(t); m.set(cle, l); if (m.size > 50000) m.delete(m.keys().next().value); return l; },
    compter(cle, fenetre, t = Date.now()) { return (m.get(cle) || []).filter(x => t - x < fenetre).length; }
  };
}

const sansVoyelle = t => { const l = String(t || '').toLowerCase().replace(/[^a-zà-ÿ]/g, ''); return l.length >= 6 && !/[aeiouyàâäéèêëîïôöùûü]/.test(l); };

/* c : commande ; contexte : { reseau, compteurs, panierMoyen, clientConnu, paysBoutique } */
function evaluer(c, { reseau, compteurs, panierMoyen = 0, clientConnu = false, paysBoutique = 'ch' }) {
  const raisons = [];
  const ajouter = (points, texte) => raisons.push({ points, texte });
  const email = String(c.client && c.client.email || '').toLowerCase(), domaine = email.split('@')[1] || '';
  if (JETABLES.has(domaine)) ajouter(30, `Adresse e-mail jetable (${domaine})`);
  if (/^[a-z]{1,3}\d{5,}@/.test(email) || /\d{8,}@/.test(email)) ajouter(10, 'Adresse e-mail générée (suite de chiffres)');
  const nom = String(c.client && c.client.nom || '');
  if (sansVoyelle(nom) || /(.)\1{3,}/.test(nom.toLowerCase())) ajouter(20, 'Nom du client incohérent');
  // Rafale de commandes depuis le même réseau ou la même adresse e-mail (cartes testées les unes après les autres).
  const parReseau = reseau ? compteurs.compter('r:' + reseau, 3600000) : 0;
  const parEmail = email ? compteurs.compter('e:' + email, 86400000) : 0;
  if (parReseau >= 3) ajouter(Math.min(40, 10 * parReseau), `${parReseau} autres commandes depuis le même réseau en une heure`);
  if (parEmail >= 2) ajouter(Math.min(30, 10 * parEmail), `${parEmail} autres commandes avec cette adresse e-mail en 24 h`);
  // Quantités de revente et montants inhabituels pour la boutique.
  const maxQte = Math.max(0, ...(c.lignes || []).map(l => l.qte || 0));
  if (maxQte >= 5) ajouter(maxQte >= 10 ? 25 : 15, `${maxQte} exemplaires du même article`);
  if (panierMoyen > 0 && c.total > 4 * panierMoyen && c.total >= 150) ajouter(20, `Montant ${Math.round(c.total / panierMoyen)} fois supérieur au panier moyen de la boutique`);
  if (!clientConnu && c.total >= 500) ajouter(10, 'Premier achat d’un montant élevé');
  if (c.client && c.client.pays && paysBoutique && c.client.pays !== paysBoutique && c.livraison !== 'retrait') ajouter(5, 'Livraison hors du pays de la boutique');
  if (clientConnu && raisons.length) ajouter(-15, 'Client ayant déjà acheté et payé');
  const score = Math.max(0, Math.min(100, raisons.reduce((a, r) => a + r.points, 0)));
  return { score, niveau: score >= 60 ? 'eleve' : score >= 30 ? 'moyen' : 'faible', raisons: raisons.filter(r => r.points > 0).map(r => r.texte), le: Date.now() };
}

module.exports = { evaluer, creerCompteurs, JETABLES };
