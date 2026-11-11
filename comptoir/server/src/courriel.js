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
          method: 'POST', signal: AbortSignal.timeout(15000),   // un service qui ne répond pas ne bloque pas toute la file
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender: { email: adresse, name: (nomBoutique ? nomExpediteur(nomBoutique) : nom) || undefined }, to: [{ email: destinataire }], subject: sujet, textContent: corps, ...(repondreA ? { replyTo: { email: repondreA } } : {}), ...(desinscription ? { headers: { 'List-Unsubscribe': `<${desinscription}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}) })
        });
        if (!rep.ok) throw Object.assign(new Error(`Brevo ${rep.status}`), { statut: rep.status });
      }
    };
  }
  if (env.POSTMARK_TOKEN && adresse) {
    return {
      nom: 'postmark',
      async envoyer({ destinataire, sujet, corps, nomBoutique, desinscription, repondreA }) {
        const rep = await fetchImpl('https://api.postmarkapp.com/email', {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'X-Postmark-Server-Token': env.POSTMARK_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ From: nomBoutique ? `"${nomExpediteur(nomBoutique)}" <${adresse}>` : exp, To: destinataire, Subject: sujet, TextBody: corps, MessageStream: 'outbound', ...(repondreA ? { ReplyTo: repondreA } : {}), ...(desinscription ? { Headers: [{ Name: 'List-Unsubscribe', Value: `<${desinscription}>` }, { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }] } : {}) })
        });
        if (!rep.ok) throw Object.assign(new Error(`Postmark ${rep.status}`), { statut: rep.status });
      }
    };
  }
  return null;
}

/* Nom d'expéditeur : sans balises ni caractères qui casseraient l'en-tête From (virgule, guillemets, chevrons). */
function nomExpediteur(n) { return String(n).replace(/<[^>]*>/g, '').replace(/[<>"\\\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70); }

function creerTables(db) {
  // Colonnes ajoutées après coup : tentatives et dernière erreur (ignoré si déjà présentes).
  for (const sql of ['ALTER TABLE emails ADD COLUMN tentatives INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE emails ADD COLUMN erreur TEXT', 'ALTER TABLE emails ADD COLUMN desinscription TEXT', 'ALTER TABLE emails ADD COLUMN prochain_essai INTEGER NOT NULL DEFAULT 0', 'CREATE INDEX IF NOT EXISTS emails_file ON emails(envoye, prochain_essai, id)']) {
    try { db.exec(sql); } catch { /* colonne déjà là */ }
  }
}

/* Envoie jusqu'à `lot` e-mails en attente. Un échec n'est pas définitif : nouvel essai de plus en plus espacé
   (1, 2, 4… minutes, jusqu'à 6 heures), 12 essais au plus (≈ 1,5 jour). Ainsi une panne ou une limite de débit
   du service (429, 5xx) de quelques heures ne perd aucune confirmation de commande. */
const ESSAIS_MAX = 12;
let envoiEnCours = false;
async function envoyerFile(db, p, { lot = 20, journal = console } = {}) {
  if (!p || envoiEnCours) return 0;   // un lot lent ne doit pas être relu et renvoyé par l'appel suivant
  envoiEnCours = true;
  try { return await envoyerLot(db, p, { lot, journal }); } finally { envoiEnCours = false; }
}
async function envoyerLot(db, p, { lot, journal }) {
  const enAttente = db.prepare(`SELECT e.*, b.config FROM emails e LEFT JOIN boutiques b ON b.id = e.boutique_id
    WHERE e.envoye = 0 AND e.tentatives < ? AND e.prochain_essai <= ? ORDER BY e.id LIMIT ?`).all(ESSAIS_MAX, Date.now(), lot);
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
      // Adresse refusée (4xx sauf 429) : rien ne sert d'insister longtemps ; sinon (panne, 429, délai dépassé) on réessaie.
      const definitif = err.statut >= 400 && err.statut < 500 && err.statut !== 429;
      const t = e.tentatives + 1, attente = Math.min(6 * 3600000, 60000 * 2 ** (t - 1));
      db.prepare('UPDATE emails SET tentatives = ?, erreur = ?, prochain_essai = ? WHERE id = ?').run(definitif ? ESSAIS_MAX : t, String(err.message).slice(0, 200), Date.now() + attente, e.id);
      journal.error(definitif || t >= ESSAIS_MAX ? '[e-mail] ABANDON (à vérifier par l’exploitant)' : '[e-mail]', `${err.message} · à ${e.destinataire} · « ${e.sujet} »`);
      if (err.statut === 429 || err.name === 'TimeoutError') break;   // service saturé : le reste du lot attend le prochain passage
    }
  }
  return n;
}

module.exports = { prestataire, creerTables, envoyerFile };
