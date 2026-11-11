// Point d'entrée : `node server/server.js` (Node ≥ 22.13, aucune dépendance à installer).
'use strict';
const http = require('node:http');
const path = require('node:path');
const { ouvrir } = require('./src/db');
const { creerApp } = require('./src/app');

const env = process.env;
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

// Produits stars : signaux de demande (ventes Comptoir, Google Trends via SerpApi, fichier importé), toutes les 6 heures.
const tendances = () => gerer.rafraichirTendances().catch(e => console.error('[tendances]', e.message));
setTimeout(tendances, 5000).unref();
setInterval(tendances, Number(env.TENDANCES_INTERVALLE_MS || 6 * 3600000)).unref();
// Ventes observées sur Comptoir : calcul local, toutes les 15 minutes.
setInterval(() => { try { gerer.actualiserVentesTendances(); } catch (e) { console.error('[tendances]', e.message); } }, Number(env.TENDANCES_VENTES_INTERVALLE_MS || 15 * 60000)).unref();

http.createServer(gerer).listen(port, () => {
  console.log(`Comptoir écoute sur ${urlPublique}`);
  console.log(`Paiements : ${env.STRIPE_SECRET_KEY ? 'Stripe Connect (chaque boutique encaisse sur son compte)' : 'simulation (aucune clé Stripe)'}`);
  // Sans ces secrets, Stripe ne peut pas confirmer les paiements : les commandes payées resteraient « en attente ».
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) console.error('ATTENTION : STRIPE_WEBHOOK_SECRET manque — abonnements et paiements ne seront pas confirmés par Stripe.');
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_CONNECT_WEBHOOK_SECRET) console.error('ATTENTION : STRIPE_CONNECT_WEBHOOK_SECRET manque — les ventes des boutiques ne seront confirmées qu’au retour du client sur la boutique (déclarez le webhook Connect).');
  console.log(`E-mails : ${env.BREVO_API_KEY ? 'Brevo' : env.POSTMARK_TOKEN ? 'Postmark' : 'file d’attente seulement (aucune clé d’envoi)'}`);
});
