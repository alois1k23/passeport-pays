// Double authentification : conformité RFC 6238 (vecteurs officiels), rejeu refusé, chiffrement des secrets.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const totp = require('../src/totp');

test('TOTP : vecteurs de test de la RFC 6238 (SHA-1, 6 derniers chiffres)', () => {
  const secret = totp.base32(Buffer.from('12345678901234567890'));
  for (const [t, attendu] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totp.code(secret, Math.floor(t / 30)), attendu, `t=${t}`);
  }
});

test('TOTP : tolérance d’un pas, rejeu refusé, saisie invalide', () => {
  const s = totp.nouveauSecret(), t = Date.now();
  const c = totp.code(s, totp.pasActuel(t));
  const pas = totp.verifier(s, c, { t });
  assert.equal(pas, totp.pasActuel(t));
  assert.equal(totp.verifier(s, c, { t, dernierPas: pas }), null, 'même code une seconde fois : refusé');
  assert.equal(totp.verifier(s, totp.code(s, totp.pasActuel(t) - 1), { t }), totp.pasActuel(t) - 1, 'code de la période précédente accepté');
  assert.equal(totp.verifier(s, totp.code(s, totp.pasActuel(t) - 3), { t }), null, 'code trop ancien refusé');
  assert.equal(totp.verifier(s, 'abcdef', { t }), null);
  assert.equal(totp.verifier(s, '12345', { t }), null);
  assert.match(totp.uri(s, 'a@b.ch'), /^otpauth:\/\/totp\/Comptoir:a%40b\.ch\?secret=[A-Z2-7]+&issuer=Comptoir/);
});

test('codes de secours et chiffrement des secrets', () => {
  const { codes, empreintes } = totp.codesSecours();
  assert.equal(codes.length, 10); assert.equal(new Set(codes).size, 10);
  assert.equal(totp.empreinteSecours(codes[0].toUpperCase().replace('-', ' ')), empreintes[0], 'saisie tolérante (majuscules, espaces)');
  const cle = crypto.randomBytes(32), env = totp.chiffrer(cle, 'SECRETBASE32');
  assert.equal(totp.dechiffrer(cle, env), 'SECRETBASE32');
  assert.throws(() => totp.dechiffrer(crypto.randomBytes(32), env), 'autre clé : refusé');
  assert.notEqual(totp.chiffrer(cle, 'x'), totp.chiffrer(cle, 'x'), 'chiffrement aléatoire');
});
