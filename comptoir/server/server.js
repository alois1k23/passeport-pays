// Point d'entrée : `node server/server.js` (Node ≥ 22.13, aucune dépendance à installer).
'use strict';
// Heure de Lausanne pour tout ce qui est daté (année des factures, dates des e-mails, jours des statistiques) :
// un serveur réglé en UTC facturerait un paiement du 1er janvier à 0 h 30 sur l'année précédente.
process.env.TZ = process.env.TZ || 'Europe/Zurich';
const http = require('node:http');
const path = require('node:path');
const { ouvrir } = require('./src/db');
const { creerApp } = require('./src/app');

const env = process.env;

/* Vérification avant la mise en ligne : `node server/server.js --verifier` liste ce qui manque ou cloche, puis s'arrête. */
// Restauration d'une sauvegarde chiffrée : node server/server.js --restaurer comptoir-AAAA-MM-JJ.db.enc destination.db
const Sauvegarde = require('./src/sauvegarde');
if (process.argv.includes('--restaurer')) {
  const [source, destination] = process.argv.slice(process.argv.indexOf('--restaurer') + 1);
  if (!source || !destination || !Sauvegarde.cleValide(env.SAUVEGARDE_CLE)) { console.error('Usage : SAUVEGARDE_CLE=… node server/server.js --restaurer <sauvegarde.db.enc> <destination.db>'); process.exit(1); }
  if (require('node:fs').existsSync(destination)) { console.error('La destination existe déjà : choisissez un autre nom (rien n’est écrasé).'); process.exit(1); }
  Sauvegarde.dechiffrer(source, destination, env.SAUVEGARDE_CLE).then(() => { console.log(`Sauvegarde restaurée dans ${destination}.`); process.exit(0); }, e => { console.error(e.message); process.exit(1); });
  return;
}
if (process.argv.includes('--verifier')) {
  (async () => {
    const res = [];
    const v = (ok, quoi, conseil) => res.push(`${ok ? '✓' : '✗'} ${quoi}${ok ? '' : ` — ${conseil}`}`);
    const url = env.URL_PUBLIQUE || '';
    v(/^https:\/\//.test(url), 'URL_PUBLIQUE en https', 'indiquez l’adresse publique, par ex. https://comptoir.example');
    v(env.NODE_ENV === 'production', 'NODE_ENV=production', 'sans cela, les paiements simulés restent possibles');
    v(['EXPLOITANT_NOM', 'EXPLOITANT_ADRESSE', 'EXPLOITANT_EMAIL'].every(k => env[k]), 'identité de l’exploitant (EXPLOITANT_NOM, _ADRESSE, _EMAIL)', 'obligatoire pour les mentions légales');
    v(!!env.HEBERGEUR, 'hébergeur indiqué (HEBERGEUR)', 'obligatoire en France dans les mentions légales');
    v(/^sk_live_/.test(env.STRIPE_SECRET_KEY || ''), 'clé Stripe réelle (sk_live_…)', env.STRIPE_SECRET_KEY ? 'clé de test : parfait pour l’essai, à remplacer avant d’ouvrir' : 'STRIPE_SECRET_KEY manquante : paiements simulés');
    v(!!env.STRIPE_WEBHOOK_SECRET, 'secret du webhook Stripe de la plateforme', 'déclarez le webhook (abonnements) et copiez son secret');
    v(!!env.STRIPE_CONNECT_WEBHOOK_SECRET, 'secret du webhook Stripe Connect', 'déclarez le webhook Connect (ventes, comptes, litiges) et copiez son secret');
    v(!env.STRIPE_API_URL && !env.BREVO_API_URL && !env.POSTMARK_API_URL && !env.DOMAINES_SANS_VERIFICATION, 'aucun réglage d’essai en production', 'retirez STRIPE_API_URL, BREVO_API_URL, POSTMARK_API_URL, DOMAINES_SANS_VERIFICATION');
    v(!!((env.BREVO_API_KEY || env.POSTMARK_TOKEN) && env.EMAIL_EXPEDITEUR), 'service d’envoi d’e-mails (Brevo ou Postmark) et EMAIL_EXPEDITEUR', 'sans cela, aucun e-mail ne part');
    v(!!env.FOURNISSEUR_URL_API, 'vrai fournisseur déclaré (FOURNISSEUR_*)', 'sans fournisseur réel, le dropshipping est impossible avec une clé Stripe réelle');
    v((env.TZ || '') === 'Europe/Zurich' || !env.TZ, 'heure de Lausanne', 'TZ doit valoir Europe/Zurich');
    v(/^[0-9a-f]{64}$/i.test(env.SECRET_CHIFFREMENT || ''), 'clé de chiffrement des secrets de double authentification (SECRET_CHIFFREMENT)', 'générez-la avec « openssl rand -hex 32 » et gardez-la hors de la base (sinon une copie volée de la base suffit à lire les secrets)');
    v(env.VERIFIER_FUITES !== 'non', 'mots de passe parus dans des fuites refusés (VERIFIER_FUITES)', 'retirez VERIFIER_FUITES=non');
    { let hote = ''; try { hote = new URL(url).hostname; } catch { /* vide */ }
      v(!env.WEBAUTHN_RP_ID || hote === env.WEBAUTHN_RP_ID || hote.endsWith('.' + env.WEBAUTHN_RP_ID), `clés d’accès liées au domaine ${env.WEBAUTHN_RP_ID || hote || '(URL_PUBLIQUE)'}`, 'WEBAUTHN_RP_ID doit être le domaine de URL_PUBLIQUE ou un domaine parent'); }
    v(Sauvegarde.cleValide(env.SAUVEGARDE_CLE), 'sauvegardes chiffrées (SAUVEGARDE_CLE)', 'générez-la avec « openssl rand -hex 32 », gardez-la hors du serveur : les copies envoyées ailleurs seront illisibles sans elle');
    v(!env.INTEGRATIONS_HTTP_LOCAL, 'webhooks marchands : adresses locales interdites', 'retirez INTEGRATIONS_HTTP_LOCAL (réservé aux essais)');
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_API_URL) {
      try {
        const r = await fetch('https://api.stripe.com/v1/account', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2024-06-20' }, signal: AbortSignal.timeout(10000) });
        const a = await r.json();
        v(r.ok, 'clé Stripe acceptée par Stripe', a.error ? a.error.message : `statut ${r.status}`);
        if (r.ok) v(!!(a.settings && a.settings.dashboard), `compte Stripe de la plateforme : ${a.business_profile && a.business_profile.name || a.email || a.id}`, '');
        const c = await fetch('https://api.stripe.com/v1/accounts?limit=1', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2024-06-20' }, signal: AbortSignal.timeout(10000) });
        v(c.ok, 'Stripe Connect activé sur le compte de la plateforme', 'activez Connect dans le tableau de bord Stripe (Connect > Commencer)');
      } catch (e) { v(false, 'Stripe joignable', e.message); }
    }
    console.log(`Vérification de mise en ligne de Comptoir\n\n${res.join('\n')}\n\n${res.filter(x => x.startsWith('✗')).length} point(s) à régler.`);
    process.exit(0);
  })();
  return;
}
const port = Number(env.PORT || 3000);
const urlPublique = (env.URL_PUBLIQUE || `http://localhost:${port}`).replace(/\/$/, '');
const db = ouvrir(env.BASE_DE_DONNEES || path.join(__dirname, 'donnees', 'comptoir.db'));
const gerer = creerApp({ db, env, urlPublique });

// Le pilote des réseaux sociaux publie ce qui est programmé, chaque minute.
setInterval(() => gerer.publierEcheances().catch(e => console.error('[social]', e.message)), Number(env.SOCIAL_INTERVALLE_MS || 60000)).unref();

// E-mails automatiques (relances de paiement, avis, reconquête), toutes les 5 minutes.
setInterval(() => { try { gerer.automatisationsEcheances(); } catch (e) { console.error('[relances]', e.message); } }, Number(env.AUTO_INTERVALLE_MS || 300000)).unref();

// File d'e-mails : envoi réel si BREVO_API_KEY ou POSTMARK_TOKEN et EMAIL_EXPEDITEUR sont définis.
setInterval(() => gerer.envoyerEmails().catch(e => console.error('[e-mail]', e.message)), Number(env.EMAIL_INTERVALLE_MS || 30000)).unref();
setInterval(() => gerer.envoyerWebhooks().catch(e => console.error('[webhook]', e.message)), Number(env.WEBHOOK_INTERVALLE_MS || 15000)).unref();

// Produits stars : signaux de demande (ventes Comptoir, Google Trends via SerpApi, fichier importé), toutes les 6 heures.
const tendances = () => gerer.rafraichirTendances().catch(e => console.error('[tendances]', e.message));
setTimeout(tendances, 5000).unref();
setInterval(tendances, Number(env.TENDANCES_INTERVALLE_MS || 6 * 3600000)).unref();
// Ventes observées sur Comptoir : calcul local, toutes les 15 minutes.
setInterval(() => { try { gerer.actualiserVentesTendances(); } catch (e) { console.error('[tendances]', e.message); } }, Number(env.TENDANCES_VENTES_INTERVALLE_MS || 15 * 60000)).unref();

// Sauvegarde quotidienne de la base (copie cohérente par VACUUM INTO, même en mode WAL), 14 jours gardés.
// SAUVEGARDE_DOSSIER (par défaut : dossier « sauvegardes » à côté de la base) ; copiez-le aussi hors de la machine.
{
  const fs = require('node:fs');
  const dossier = env.SAUVEGARDE_DOSSIER || path.join(path.dirname(env.BASE_DE_DONNEES || path.join(__dirname, 'donnees', 'comptoir.db')), 'sauvegardes');
  const sauvegarder = async () => {
    try {
      fs.mkdirSync(dossier, { recursive: true });
      const nom = path.join(dossier, `comptoir-${new Date().toISOString().slice(0, 10)}.db`);
      const chiffree = Sauvegarde.cleValide(env.SAUVEGARDE_CLE);
      if (!fs.existsSync(nom) && !fs.existsSync(nom + '.enc')) {
        db.exec(`VACUUM INTO '${nom.replace(/'/g, "''")}'`);
        // Clé fournie : la copie est chiffrée, puis la version en clair est effacée.
        if (chiffree) await Sauvegarde.chiffrer(nom, nom + '.enc', env.SAUVEGARDE_CLE).then(() => fs.rmSync(nom));
      }
      const fichiers = fs.readdirSync(dossier).filter(f => /^comptoir-\d{4}-\d{2}-\d{2}\.db(\.enc)?$/.test(f)).sort();
      for (const f of fichiers.slice(0, -14)) fs.rmSync(path.join(dossier, f));
    } catch (e) { console.error('[sauvegarde] ÉCHEC', e.message); }
  };
  if (env.SAUVEGARDE !== 'non') { setTimeout(sauvegarder, 60000).unref(); setInterval(sauvegarder, 6 * 3600000).unref(); }
}

http.createServer(gerer).listen(port, () => {
  console.log(`Comptoir écoute sur ${urlPublique}`);
  console.log(`Paiements : ${env.STRIPE_SECRET_KEY ? 'Stripe Connect (chaque boutique encaisse sur son compte)' : 'simulation (aucune clé Stripe)'}`);
  // Sans ces secrets, Stripe ne peut pas confirmer les paiements : les commandes payées resteraient « en attente ».
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) console.error('ATTENTION : STRIPE_WEBHOOK_SECRET manque — abonnements et paiements ne seront pas confirmés par Stripe.');
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_CONNECT_WEBHOOK_SECRET) console.error('ATTENTION : STRIPE_CONNECT_WEBHOOK_SECRET manque — les ventes des boutiques ne seront confirmées qu’au retour du client sur la boutique (déclarez le webhook Connect).');
  console.log(`E-mails : ${env.BREVO_API_KEY ? 'Brevo' : env.POSTMARK_TOKEN ? 'Postmark' : 'file d’attente seulement (aucune clé d’envoi)'}`);
});
