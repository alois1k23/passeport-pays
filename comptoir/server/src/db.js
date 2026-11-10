// Base de données SQLite (module intégré à Node ≥ 22.13, aucune dépendance).
// Une seule base pour toutes les boutiques : chaque requête d'administration
// filtre par boutique_id, et chaque boutique appartient à un marchand.
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS marchands (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  mot_de_passe TEXT NOT NULL,          -- scrypt$sel$hash
  cree_le INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  jeton_hash TEXT PRIMARY KEY,         -- SHA-256 du jeton : un vol de la base ne donne pas de session valide
  marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE,
  expire_le INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boutiques (
  id TEXT PRIMARY KEY,
  marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,                -- JSON : boutique, entreprise, magasin, réglages, campagnes
  compteur_commande INTEGER NOT NULL DEFAULT 1000,
  compteur_facture INTEGER NOT NULL DEFAULT 0,
  cree_le INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS produits (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  donnees TEXT NOT NULL,               -- JSON : nom, prix, type, fournisseur, délai…
  supprime INTEGER NOT NULL DEFAULT 0,
  ordre INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS produits_boutique ON produits(boutique_id);

CREATE TABLE IF NOT EXISTS commandes (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  date INTEGER NOT NULL,
  statut TEXT NOT NULL,
  jeton_client TEXT NOT NULL,          -- permet au client de suivre sa commande sans compte
  donnees TEXT NOT NULL,               -- JSON : client, lignes, totaux, livraison, historique…
  UNIQUE (boutique_id, numero)
);
CREATE INDEX IF NOT EXISTS commandes_boutique ON commandes(boutique_id, date);

CREATE TABLE IF NOT EXISTS paiements (
  id TEXT PRIMARY KEY,
  commande_id TEXT NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  fournisseur TEXT NOT NULL,           -- simulation | stripe
  ref_externe TEXT,
  montant_centimes INTEGER NOT NULL,
  devise TEXT NOT NULL,
  statut TEXT NOT NULL,                -- cree | paye | annule | rembourse
  cree_le INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS paiements_ref ON paiements(ref_externe);

CREATE TABLE IF NOT EXISTS fournisseurs (
  code TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  url_api TEXT NOT NULL,
  cle_api TEXT NOT NULL,
  secret_webhook TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id TEXT,
  destinataire TEXT NOT NULL,
  sujet TEXT NOT NULL,
  corps TEXT NOT NULL,
  cree_le INTEGER NOT NULL,
  envoye INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  boutique_id TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  reseau TEXT NOT NULL,
  date INTEGER NOT NULL,
  statut TEXT NOT NULL,                -- brouillon | programmee | publiee | echec
  donnees TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS publications_echeance ON publications(statut, date);

CREATE TABLE IF NOT EXISTS evenements (
  boutique_id TEXT NOT NULL,
  type TEXT NOT NULL,
  session TEXT NOT NULL,              -- identifiant aléatoire d'onglet, sans cookie ni adresse IP
  produit_id TEXT,
  valeur TEXT,
  date INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS evenements_boutique ON evenements(boutique_id, date);
CREATE INDEX IF NOT EXISTS evenements_session ON evenements(boutique_id, session);

CREATE TABLE IF NOT EXISTS reinitialisations (
  jeton_hash TEXT PRIMARY KEY,
  marchand_id TEXT NOT NULL REFERENCES marchands(id) ON DELETE CASCADE,
  expire_le INTEGER NOT NULL
);

-- Faux fournisseur de démonstration (représente une API externe).
CREATE TABLE IF NOT EXISTS demo_fournisseur_commandes (
  ref TEXT PRIMARY KEY,
  donnees TEXT NOT NULL,
  statut TEXT NOT NULL,
  cree_le INTEGER NOT NULL
);
`;

function ouvrir(fichier) {
  if (fichier !== ':memory:') fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const db = new DatabaseSync(fichier);
  db.exec(SCHEMA);
  return db;
}

/* Transaction simple : tout ou rien. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { ouvrir, transaction };
