// Envoi réel des e-mails de la file (table `emails`) par un service transactionnel.
// Configuration par variables d'environnement :
//   EMAIL_EXPEDITEUR   adresse d'envoi vérifiée chez le service (ex. « Lacustre <bonjour@lacustre.ch> »)
//   BREVO_API_KEY      Brevo (hébergement UE)          ou
//   POSTMARK_TOKEN     Postmark
// Sans clé : les e-mails restent dans la file (visibles dans l'admin) et rien n'est envoyé.
'use strict';

function prestataire(env, fetchImpl = fetch) {
  const exp = env.EMAIL_EXPEDITEUR || '';
  const m = /^(.*)<([^>]+)>\s*$/.exec(exp);
  const nom = m ? m[1].trim() : '', adresse = m ? m[2].trim() : exp.trim();
  if (env.BREVO_API_KEY && adresse) {
    return {
      nom: 'brevo',
      async envoyer({ destinataire, sujet, corps, nomBoutique, desinscription, repondreA }) {
        const rep = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender: { email: adresse, name: nomBoutique || nom || undefined }, to: [{ email: destinataire }], subject: sujet, textContent: corps, ...(repondreA ? { replyTo: { email: repondreA } } : {}), ...(desinscription ? { headers: { 'List-Unsubscribe': `<${desinscription}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}) })
        });
        if (!rep.ok) throw new Error(`Brevo ${rep.status}`);
      }
    };
  }
  if (env.POSTMARK_TOKEN && adresse) {
    return {
      nom: 'postmark',
      async envoyer({ destinataire, sujet, corps, nomBoutique, desinscription, repondreA }) {
        const rep = await fetchImpl('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { 'X-Postmark-Server-Token': env.POSTMARK_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ From: nomBoutique ? `${nomBoutique.replace(/[<>"]/g, '')} <${adresse}>` : exp, To: destinataire, Subject: sujet, TextBody: corps, MessageStream: 'outbound', ...(repondreA ? { ReplyTo: repondreA } : {}), ...(desinscription ? { Headers: [{ Name: 'List-Unsubscribe', Value: `<${desinscription}>` }, { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }] } : {}) })
        });
        if (!rep.ok) throw new Error(`Postmark ${rep.status}`);
      }
    };
  }
  return null;
}

function creerTables(db) {
  // Colonnes ajoutées après coup : tentatives et dernière erreur (ignoré si déjà présentes).
  for (const sql of ['ALTER TABLE emails ADD COLUMN tentatives INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE emails ADD COLUMN erreur TEXT', 'ALTER TABLE emails ADD COLUMN desinscription TEXT']) {
    try { db.exec(sql); } catch { /* colonne déjà là */ }
  }
}

/* Envoie jusqu'à `lot` e-mails en attente. 5 tentatives au plus par e-mail. */
let envoiEnCours = false;
async function envoyerFile(db, p, { lot = 20, journal = console } = {}) {
  if (!p || envoiEnCours) return 0;   // un lot lent ne doit pas être relu et renvoyé par l'appel suivant
  envoiEnCours = true;
  try { return await envoyerLot(db, p, { lot, journal }); } finally { envoiEnCours = false; }
}
async function envoyerLot(db, p, { lot, journal }) {
  const enAttente = db.prepare(`SELECT e.*, b.config FROM emails e LEFT JOIN boutiques b ON b.id = e.boutique_id
    WHERE e.envoye = 0 AND e.tentatives < 5 ORDER BY e.id LIMIT ?`).all(lot);
  let n = 0;
  for (const e of enAttente) {
    const conf = e.config ? JSON.parse(e.config) : null;
    const nomBoutique = conf ? conf.boutique.nom : 'Comptoir';
    // Les réponses du client vont au marchand, pas à l'adresse d'envoi de Comptoir.
    const repondreA = conf && conf.entreprise && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(conf.entreprise.email || '') ? conf.entreprise.email : null;
    try {
      await p.envoyer({ destinataire: e.destinataire, sujet: e.sujet, corps: e.corps, nomBoutique, desinscription: e.desinscription || null, repondreA });
      db.prepare('UPDATE emails SET envoye = 1, erreur = NULL WHERE id = ?').run(e.id);
      n++;
    } catch (err) {
      db.prepare('UPDATE emails SET tentatives = tentatives + 1, erreur = ? WHERE id = ?').run(String(err.message).slice(0, 200), e.id);
      journal.error('[e-mail]', err.message);
    }
  }
  return n;
}

module.exports = { prestataire, creerTables, envoyerFile };
