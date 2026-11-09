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

http.createServer(gerer).listen(port, () => {
  console.log(`Comptoir écoute sur ${urlPublique}`);
  console.log(`Paiements : ${env.STRIPE_SECRET_KEY ? 'Stripe (TWINT + cartes)' : 'simulation (aucune clé Stripe)'}`);
});
