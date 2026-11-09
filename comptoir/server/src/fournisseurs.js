// Fournisseurs de dropshipping.
//
// Contrat d'API (le même pour tous les fournisseurs ; un adaptateur traduit si besoin) :
//   GET  {url}/catalogue                       → [{ id, nom, categorie, cout, portF, entrepot, delai, prix, fournisseur }]
//   POST {url}/commandes                       → { ref, statut }
//        corps : { referenceMarchand, lignes: [{ produitId, qte }], livraison: { nom, adresse, npa, ville, pays } }
//   Webhook vers Comptoir quand le colis part :
//   POST /api/webhooks/fournisseurs/{code}     en-tête X-Signature = HMAC-SHA256(corps, secret_webhook) en hex
//        corps : { ref, statut: "expediee", suivi, transporteur }
//
// Le fournisseur « demo » est une fausse API servie par ce même serveur (/demo-fournisseur)
// pour tester tout le parcours sans partenaire réel.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { erreur } = require('./http');

const CATALOGUE_DEMO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue-demo.json'), 'utf8'));

function signer(corps, secret) {
  return crypto.createHmac('sha256', secret).update(corps).digest('hex');
}
function verifierSignature(corps, signature, secret) {
  if (!signature || !secret) return false;
  const attendu = signer(corps, secret);
  return signature.length === attendu.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(attendu));
}

function client(fournisseur, fetchImpl = fetch) {
  const appeler = async (methode, chemin, corps) => {
    let rep;
    try {
      rep = await fetchImpl(fournisseur.url_api + chemin, {
        method: methode,
        headers: { Authorization: `Bearer ${fournisseur.cle_api}`, 'Content-Type': 'application/json' },
        body: corps ? JSON.stringify(corps) : undefined
      });
    } catch (e) {
      throw erreur(502, `Le fournisseur ${fournisseur.nom} ne répond pas.`, 'fournisseur_injoignable');
    }
    const json = await rep.json().catch(() => ({}));
    if (!rep.ok) throw erreur(502, `Le fournisseur ${fournisseur.nom} a refusé la demande : ${json.erreur || rep.status}.`, 'fournisseur_refus');
    return json;
  };
  return {
    catalogue: () => appeler('GET', '/catalogue'),
    passerCommande: c => appeler('POST', '/commandes', c),
    forcerExpedition: ref => appeler('POST', `/commandes/${encodeURIComponent(ref)}/expedier`)
  };
}

/* Enregistre le fournisseur de démonstration au démarrage. */
function installerDemo(db, urlPublique, secrets) {
  db.prepare(`INSERT INTO fournisseurs (code, nom, url_api, cle_api, secret_webhook) VALUES ('demo', 'Réseau fournisseurs (démo)', ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET url_api = excluded.url_api`).run(`${urlPublique}/demo-fournisseur`, secrets.cleApiDemo, secrets.secretWebhookDemo);
}

module.exports = { CATALOGUE_DEMO, client, signer, verifierSignature, installerDemo };
