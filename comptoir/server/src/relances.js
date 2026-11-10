// E-mails automatiques : bienvenue (inscription newsletter), relance de paiement
// abandonné, demande d'avis après livraison, reconquête des clients inactifs.
// Chaque envoi est enregistré une seule fois (table envois_auto) : relancer le
// planificateur ne renvoie jamais deux fois le même e-mail.
'use strict';

const DEFAUT = {
  bienvenue: { actif: true, remise: 10, code: 'BIENVENUE10' },
  // 3 messages, sans remise par défaut (Klaviyo, Omnisend : voir METHODE.md)
  paiement: { actif: true, etapes: [{ heures: 1 }, { heures: 24 }, { heures: 72 }], remise: 0, code: '' },
  avis: { actif: true, jours: 7 },
  reconquete: { actif: false, jours: 90, remise: 15, code: 'RETOUR15' }
};
const HEURE = 3600 * 1000, JOUR = 24 * HEURE;

const nettoyerCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
function nettoyer(a) {
  a = a && typeof a === 'object' ? a : {};
  const n = (v, d, min, max) => { const x = Number(v); return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : d; };
  const b = a.bienvenue || {}, p = a.paiement || {}, v = a.avis || {}, r = a.reconquete || {};
  return {
    bienvenue: { actif: b.actif !== undefined ? !!b.actif : DEFAUT.bienvenue.actif, remise: n(b.remise, 10, 0, 50), code: nettoyerCode(b.code ?? DEFAUT.bienvenue.code) },
    paiement: {
      actif: p.actif !== undefined ? !!p.actif : DEFAUT.paiement.actif,
      etapes: (Array.isArray(p.etapes) && p.etapes.length ? p.etapes : DEFAUT.paiement.etapes).slice(0, 3).map(e => ({ heures: n(e.heures, 1, 0.25, 168) })),
      remise: n(p.remise, 0, 0, 30), code: nettoyerCode(p.code)
    },
    avis: { actif: v.actif !== undefined ? !!v.actif : DEFAUT.avis.actif, jours: n(v.jours, 7, 1, 60) },
    reconquete: { actif: !!r.actif, jours: n(r.jours, 90, 30, 365), remise: n(r.remise, 15, 0, 50), code: nettoyerCode(r.code ?? DEFAUT.reconquete.code) }
  };
}

function creerTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS envois_auto (boutique_id TEXT NOT NULL, cle TEXT NOT NULL, date INTEGER NOT NULL, PRIMARY KEY (boutique_id, cle));
    CREATE TABLE IF NOT EXISTS avis (id TEXT PRIMARY KEY, boutique_id TEXT NOT NULL, commande_id TEXT NOT NULL, produit_id TEXT NOT NULL, note INTEGER NOT NULL, texte TEXT NOT NULL, prenom TEXT NOT NULL, ville TEXT NOT NULL, cree_le INTEGER NOT NULL, reponse TEXT, UNIQUE (commande_id, produit_id));
    CREATE TABLE IF NOT EXISTS abonnes (boutique_id TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE, cree_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, email));`);
}

/* Réserve un envoi : renvoie false s'il a déjà eu lieu. */
function reserver(db, boutiqueId, cle, maintenant) {
  return db.prepare('INSERT OR IGNORE INTO envois_auto (boutique_id, cle, date) VALUES (?, ?, ?)').run(boutiqueId, cle, maintenant).changes === 1;
}

/* Exécute les automatisations d'une boutique. Renvoie le nombre d'e-mails envoyés. */
function executer({ db, boutique, config, commandes, maintenant = Date.now(), urlPublique, envoyerEmail, enregistrerCommande, formatMontant }) {
  const a = nettoyer(config.automatisations);
  const nom = config.boutique.nom;
  let n = 0;

  // 1. Paiement abandonné : la commande a été créée mais jamais payée.
  if (a.paiement.actif) {
    for (const c of commandes) {
      if (c.statut !== 'attente' || !c.client.email || maintenant - c.date > 7 * JOUR) continue;
      a.paiement.etapes.forEach((e, i) => {
        if (maintenant - c.date < e.heures * HEURE) return;
        if ((c.relances || 0) > i || !reserver(db, boutique.id, `paiement:${c.id}:${i}`, maintenant)) return;
        const lien = `${urlPublique}/s/${boutique.slug}?reprendre=${encodeURIComponent(c.id)}&jeton=${encodeURIComponent(c.jeton)}`;
        const derniere = i === a.paiement.etapes.length - 1;
        const offre = derniere && a.paiement.remise && a.paiement.code ? `\n\nPour vous aider à vous décider : -${a.paiement.remise} % avec le code ${a.paiement.code}.` : '';
        envoyerEmail(boutique.id, c.client.email, i === 0 ? `Votre commande chez ${nom} vous attend` : `Votre panier chez ${nom} est encore réservé`,
          `Bonjour ${c.client.nom},\n\nVotre commande n° ${c.numero} (${formatMontant(c.total, config)}) n’a pas été finalisée. Un souci au moment de payer ? Vous pouvez la reprendre ici :\n${lien}${offre}\n\nL’équipe ${nom}`);
        c.relances = i + 1;
        c.historique.push({ date: maintenant, texte: `Relance de paiement n° ${i + 1} envoyée par e-mail` });
        enregistrerCommande(c);
        n++;
      });
    }
  }

  // 2. Demande d'avis, quelques jours après la livraison ou le retrait.
  if (a.avis.actif) {
    for (const c of commandes) {
      if (!['livree', 'retiree'].includes(c.statut) || !c.client.email || c.avisDemande) continue;
      const livre = [...c.historique].reverse().find(h => /^(Livrée|Remise au client)/.test(h.texte));
      const depuis = livre ? livre.date : c.date;
      if (maintenant - depuis < a.avis.jours * JOUR || maintenant - depuis > 60 * JOUR) continue;
      if (!reserver(db, boutique.id, `avis:${c.id}`, maintenant)) continue;
      envoyerEmail(boutique.id, c.client.email, `Votre avis sur votre commande ${nom}`,
        `Bonjour ${c.client.nom},\n\nVous avez reçu ${c.lignes.map(l => l.nom).join(', ')}. Qu’en pensez-vous ? Votre avis aide d’autres clients à choisir, et nous à nous améliorer. Il prend 30 secondes :\n${urlPublique}/s/${boutique.slug}?avis=${encodeURIComponent(c.id)}&jeton=${encodeURIComponent(c.jeton)}\n\nMerci,\nL’équipe ${nom}`);
      c.avisDemande = maintenant;
      enregistrerCommande(c);
      n++;
    }
  }

  // 3. Reconquête : clients sans commande depuis N jours (un seul e-mail par période d'inactivité).
  if (a.reconquete.actif) {
    const derniere = {};
    for (const c of commandes) {
      if (!c.client.email || ['attente', 'annulee'].includes(c.statut)) continue;
      if (!derniere[c.client.email] || c.date > derniere[c.client.email].date) derniere[c.client.email] = c;
    }
    for (const [email, c] of Object.entries(derniere)) {
      if (maintenant - c.date < a.reconquete.jours * JOUR) continue;
      if (!c.client.consentement) continue; // e-mail marketing : uniquement avec accord explicite
      if (!reserver(db, boutique.id, `reconquete:${email}:${c.id}`, maintenant)) continue;
      envoyerEmail(boutique.id, email, `Ça fait longtemps, ${c.client.nom.split(' ')[0]}`,
        `Bonjour ${c.client.nom},\n\nDe nouveaux produits sont arrivés chez ${nom} depuis votre dernière commande.${a.reconquete.remise && a.reconquete.code ? ` Pour votre retour : -${a.reconquete.remise} % avec le code ${a.reconquete.code}.` : ''}\n\n${urlPublique}/s/${boutique.slug}\n\nL’équipe ${nom}\n\nVous recevez cet e-mail car vous avez accepté nos nouvelles. Répondez « STOP » pour ne plus en recevoir.`);
      n++;
    }
  }
  return n;
}

function emailBienvenue({ db, boutique, config, email, urlPublique, envoyerEmail }) {
  const a = nettoyer(config.automatisations);
  if (!a.bienvenue.actif || !reserver(db, boutique.id, `bienvenue:${email}`, Date.now())) return false;
  envoyerEmail(boutique.id, email, `Bienvenue chez ${config.boutique.nom}`,
    `Bonjour,\n\nMerci de votre inscription.${a.bienvenue.remise && a.bienvenue.code ? ` Voici -${a.bienvenue.remise} % sur votre première commande avec le code ${a.bienvenue.code}.` : ''}\n\n${urlPublique}/s/${boutique.slug}\n\nL’équipe ${config.boutique.nom}`);
  return true;
}

module.exports = { DEFAUT, nettoyer, creerTables, executer, emailBienvenue };
