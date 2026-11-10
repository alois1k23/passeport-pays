// Collecte des tendances : connecteur Google Trends (SerpApi) avec une réponse simulée, et fichier importé.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ouvrir } = require('../src/db');
const { creerCollecte } = require('../src/tendances');

const catalogue = [{ id: 'f03', nom: 'Humidificateur effet flamme', mots: 'humidificateur' }, { id: 'f07', nom: 'Bougie au bois de cèdre', mots: 'bougie' }];

test('Google Trends via SerpApi : évolution sur 4 semaines, clé jamais exposée', async () => {
  const db = ouvrir(':memory:');
  const appels = [];
  const fetchImpl = async url => {
    appels.push(url);
    const serie = url.includes('humidificateur') ? [40, 40, 42, 40, 41, 40, 39, 40, 52, 56, 60, 64] : [50, 50, 50, 50, 50, 50, 50, 50, 40, 40, 40, 40];
    return { ok: true, json: async () => ({ interest_over_time: { timeline_data: serie.map(v => ({ values: [{ extracted_value: v }] })) } }) };
  };
  const c = creerCollecte({ db, env: { SERPAPI_KEY: 'cle-secrete' }, catalogue, fetchImpl, journal: { error() {} } });
  await c.rafraichir();
  const s = c.signaux('ch');
  assert.equal(appels.length, 2);
  assert.match(appels[0], /engine=google_trends/);
  assert.match(appels[0], /geo=CH/);
  assert.ok(s.trends.f03.evolution > 0.4, 'hausse détectée');
  assert.ok(s.trends.f07.evolution < -0.15, 'baisse détectée');
  assert.equal(s.sources.trends.actif, true);
  assert.ok(!JSON.stringify(s).includes('cle-secrete'));
});

test('fichier importé (outil d’analyse) : reconnu par identifiant ou par nom', async () => {
  const db = ouvrir(':memory:');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tend-')), 'export.json');
  fs.writeFileSync(f, JSON.stringify([{ nom: 'bougie au bois de cèdre', evolution: 0.5, niveau: 80, plateforme: 'Galaxus (relevé)' }, { id: 'inconnu', evolution: 1 }]));
  const c = creerCollecte({ db, env: { TENDANCES_FICHIER: f }, catalogue, journal: { error() {} } });
  await c.rafraichir();
  const s = c.signaux('fr');
  assert.equal(s.trends.f07.evolution, 0.5);
  assert.equal(s.trends.f07.source, 'fichier');
  assert.equal(s.trends.f03, undefined);
  assert.match(s.sources.fichier.detail, /1 produit/);
});
