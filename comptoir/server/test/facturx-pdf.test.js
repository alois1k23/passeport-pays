// Factur-X : PDF/A-3 avec le XML EN 16931 joint. Structure du fichier (table des références, métadonnées, fichier joint,
// polices intégrées), sous-ensemble de police, route et droits. Les outils poppler (pdfinfo, pdfdetach, pdftotext) sont
// utilisés s'ils sont installés.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ouvrir } = require('../src/db');
const { creerApp } = require('../src/app');
const F = require('../src/facture-electronique');
const FX = require('../src/facturx-pdf');
const Police = require('../src/police-ttf');

const config = { boutique: { nom: 'Maison', pays: 'fr' }, entreprise: { raison: 'Léa Créations SAS', forme: 'SAS', siret: '12345678900012', tvaIntra: 'FR12345678901', adresse: '12 rue des Lilas, 75011 Paris', email: 'contact@lea.fr' } };
const commande = (n = 3) => {
  const lignes = Array.from({ length: n }, (_, i) => ({ nom: i ? `Article ${i}` : 'Bougie « Œillet & figue » (édition limitée) 🎁', prix: 19.9 + i, qte: 1 + (i % 3), tauxTva: i % 2 ? 0.055 : 0.2 }));
  return { id: 'c1', numero: 42, date: Date.UTC(2026, 10, 10), facture: 'FA-2026-0042', statut: 'payee', lignes, port: 5.9, total: Math.round((lignes.reduce((a, l) => a + l.prix * l.qte, 0) + 5.9) * 100) / 100, client: { nom: 'Jean Dupont', adresse: '3 avenue Foch', npa: '69006', ville: 'Lyon' } };
};

/* Lecture minimale d'un PDF : objets par la table des références, flux décompressés. */
function analyser(pdf) {
  const t = pdf.toString('latin1');
  assert.ok(t.startsWith('%PDF-1.7\n%'), 'en-tête PDF');
  assert.ok([...t.slice(10, 14)].every(ch => ch.charCodeAt(0) > 127), 'commentaire binaire (PDF/A)');
  assert.ok(t.endsWith('%%EOF\n'));
  const debutXref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(t)[1]);
  assert.equal(t.slice(debutXref, debutXref + 5), 'xref\n', 'startxref exact');
  const n = Number(/^xref\n0 (\d+)\n/.exec(t.slice(debutXref))[1]);
  const entrees = t.slice(debutXref).split('\n').slice(2, 2 + n);
  assert.equal(entrees[0], '0000000000 65535 f\r');
  const objets = {};
  for (let i = 1; i < n; i++) {
    assert.match(entrees[i], /^\d{10} 00000 n\r$/);
    const o = Number(entrees[i].slice(0, 10));
    assert.equal(t.slice(o, o + `${i} 0 obj\n`.length), `${i} 0 obj\n`, `décalage exact de l'objet ${i}`);
    const fin = t.indexOf('\nendobj\n', o);
    objets[i] = { texte: t.slice(o, fin), octets: pdf.subarray(o, fin) };
  }
  const flux = i => {
    const { texte, octets } = objets[i], d = texte.indexOf('stream\n') + 7, lg = Number(/\/Length (\d+)/.exec(texte)[1]);
    const brut = octets.subarray(d, d + lg);
    assert.equal(texte.slice(d + lg, d + lg + 10), '\nendstream', `longueur exacte du flux ${i}`);
    return /\/FlateDecode/.test(texte.slice(0, d)) ? zlib.inflateSync(brut) : brut;
  };
  const ref = (texte, cle) => Number(new RegExp(`/${cle} (\\d+) 0 R`).exec(texte)[1]);
  return { t, objets, flux, ref, trailer: t.slice(debutXref) };
}
const decoderUtf16 = hex => Buffer.from(hex.slice(4), 'hex').swap16().toString('utf16le');

test('PDF/A-3 : structure, métadonnées, XML joint, polices', () => {
  const c = commande(), xml = F.produire(c, config);
  const pdf = FX.produire(c, config, { xml, maintenant: Date.UTC(2026, 10, 12, 21, 30, 5) });
  const { t, objets, flux, ref, trailer } = analyser(pdf);
  assert.match(trailer, /\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/, 'identifiant de fichier');
  assert.doesNotMatch(t, /\/Encrypt|\/JavaScript|\/JS |\/Launch|\/Transparency|\/SMask|\/OpenAction/, 'rien d’interdit en PDF/A');
  const catalogue = objets[ref(trailer, 'Root')].texte;
  assert.match(catalogue, /\/Type \/Catalog/);

  // Métadonnées XMP (non compressées) : PDF/A-3B et extension Factur-X.
  const meta = flux(ref(catalogue, 'Metadata')).toString('utf8');
  assert.match(objets[ref(catalogue, 'Metadata')].texte, /\/Subtype \/XML/); assert.doesNotMatch(objets[ref(catalogue, 'Metadata')].texte, /Filter/);
  for (const m of ['<pdfaid:part>3</pdfaid:part>', '<pdfaid:conformance>B</pdfaid:conformance>', '<fx:DocumentType>INVOICE</fx:DocumentType>', '<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>', '<fx:Version>1.0</fx:Version>', '<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>', 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#', '<xmp:CreateDate>2026-11-12T21:30:05+00:00</xmp:CreateDate>']) assert.ok(meta.includes(m), m);
  // Info = XMP (titre, auteur, outil, dates).
  const info = objets[ref(trailer, 'Info')].texte;
  assert.equal(decoderUtf16(/\/Title <([0-9A-F]+)>/.exec(info)[1]), 'Facture FA-2026-0042');
  assert.ok(meta.includes('<rdf:li xml:lang="x-default">Facture FA-2026-0042</rdf:li>'));
  assert.equal(decoderUtf16(/\/Author <([0-9A-F]+)>/.exec(info)[1]), 'Léa Créations SAS');
  assert.ok(meta.includes('<rdf:li>Léa Créations SAS</rdf:li>'));
  assert.match(info, /\/CreationDate \(D:20261112213005\+00'00'\)/);
  assert.equal(/\/Producer \(([^)]*)\)/.exec(info)[1], /<pdf:Producer>([^<]*)</.exec(meta)[1]);
  assert.equal(/\/Creator \(([^)]*)\)/.exec(info)[1], /<xmp:CreatorTool>([^<]*)</.exec(meta)[1]);

  // Profil de couleur sRGB.
  const intention = objets[Number(/\/OutputIntents \[(\d+) 0 R\]/.exec(catalogue)[1])].texte;
  assert.match(intention, /\/S \/GTS_PDFA1/);
  const icc = flux(ref(intention, 'DestOutputProfile'));
  assert.equal(icc.toString('latin1', 36, 40), 'acsp'); assert.equal(icc.toString('latin1', 16, 20), 'RGB ');

  // Fichier joint : relation « Data », référencé par AF et par l'arbre des fichiers joints ; contenu identique au XML.
  const spec = Number(/\/AF \[(\d+) 0 R\]/.exec(catalogue)[1]);
  assert.match(catalogue, new RegExp(`/EmbeddedFiles << /Names \\[\\(factur-x\\.xml\\) ${spec} 0 R\\]`));
  const specTexte = objets[spec].texte;
  assert.match(specTexte, /\/AFRelationship \/Data/); assert.match(specTexte, /\/F \(factur-x\.xml\)/);
  const fichier = Number(/\/EF << \/F (\d+) 0 R/.exec(specTexte)[1]);
  assert.match(objets[fichier].texte, /\/Subtype \/text#2Fxml/); assert.match(objets[fichier].texte, /\/ModDate \(D:/);
  assert.equal(flux(fichier).toString('utf8'), xml);

  // Polices : Type0 Identity-H, sous-ensemble intégré (préfixe de 6 lettres), largeurs, ToUnicode ; jamais le glyphe 0.
  const polices = Object.entries(objets).filter(([, o]) => /\/Subtype \/Type0/.test(o.texte));
  assert.equal(polices.length, 2);
  for (const [, o] of polices) {
    assert.match(o.texte, /\/BaseFont \/[A-Z]{6}\+DejaVuSans/); assert.match(o.texte, /\/Encoding \/Identity-H/);
    assert.match(flux(ref(o.texte, 'ToUnicode')).toString('latin1'), /beginbfchar/);
    const cid = objets[Number(/\/DescendantFonts \[(\d+) 0 R\]/.exec(o.texte)[1])].texte;
    assert.match(cid, /\/CIDToGIDMap \/Identity/); assert.match(cid, /\/W \[/);
    const desc = objets[ref(cid, 'FontDescriptor')].texte;
    assert.ok(flux(ref(desc, 'FontFile2')).length < 120000, 'police réduite');
  }
  const pages = Object.values(objets).filter(o => /\/Type \/Page /.test(o.texte));
  for (const pg of pages) {
    const contenu = flux(ref(pg.texte, 'Contents')).toString('latin1');
    for (const [, hex] of contenu.matchAll(/<([0-9a-f]+)> Tj/g)) for (let i = 0; i < hex.length; i += 4) assert.notEqual(hex.slice(i, i + 4), '0000', 'glyphe .notdef interdit');
    assert.doesNotMatch(contenu, / (k|K|g|G|sc|scn|cs|CS) /, 'couleurs RVB uniquement');
  }
});

test('sous-ensemble de police : glyphes gardés, autres vidés, somme de contrôle', () => {
  const p = Police.charger(path.join(__dirname, '..', 'ressources', 'DejaVuSans.ttf'));
  const gA = p.correspondance.get(65), gE = p.correspondance.get(0xC9), gZ = p.correspondance.get(90);
  const sous = Police.sousEnsemble(p, [gA, gE]);
  assert.ok(sous.length < fs.statSync(path.join(__dirname, '..', 'ressources', 'DejaVuSans.ttf')).size / 5);
  const f = path.join(os.tmpdir(), `sous-${process.pid}.ttf`);
  try {
    fs.writeFileSync(f, sous);
    const relu = Police.charger(f);
    assert.equal(relu.nbGlyphes, p.nbGlyphes, 'numéros de glyphes conservés');
    assert.ok(relu.loca[gA + 1] > relu.loca[gA], 'A gardé');
    assert.ok(relu.loca[gE + 1] > relu.loca[gE], 'É gardé');
    for (const g of Police.fermeture(p, new Set([gE]))) assert.ok(relu.loca[g + 1] > relu.loca[g] || p.loca[g + 1] === p.loca[g], 'composants de É gardés');
    assert.equal(relu.loca[gZ + 1], relu.loca[gZ], 'Z vidé');
    assert.equal(relu.avance[gZ], p.avance[gZ], 'métriques intactes');
    let s = 0; const b = Buffer.alloc(Math.ceil(sous.length / 4) * 4); sous.copy(b);
    for (let i = 0; i < b.length; i += 4) s = (s + b.readUInt32BE(i)) >>> 0;
    assert.equal(s, 0xB1B0AFBA, 'somme de contrôle globale (checkSumAdjustment)');
  } finally { fs.rmSync(f, { force: true }); }
});

test('mise en page : plusieurs pages, avoir, outils poppler', () => {
  const c = commande(80); c.avoir = { numero: 'AV-2026-0003', date: Date.UTC(2026, 10, 11) }; c.statut = 'remboursee';
  const xml = F.produire(c, config, { avoir: true }), pdf = FX.produire(c, config, { avoir: true, xml });
  const { objets } = analyser(pdf);
  assert.ok(Object.values(objets).filter(o => /\/Type \/Page /.test(o.texte)).length >= 3, 'plusieurs pages');
  let outils = true; try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); } catch { outils = false; }
  if (!outils) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-'));
  try {
    const f = path.join(dir, 'a.pdf'); fs.writeFileSync(f, pdf);
    const infos = execFileSync('pdfinfo', [f]).toString();
    assert.match(infos, /Title:\s+Avoir AV-2026-0003/); assert.match(infos, /PDF version:\s+1\.7/);
    assert.match(execFileSync('pdfdetach', ['-list', f]).toString(), /1: factur-x\.xml/);
    execFileSync('pdfdetach', ['-save', '1', '-o', path.join(dir, 'x.xml'), f]);
    assert.equal(fs.readFileSync(path.join(dir, 'x.xml'), 'utf8'), xml);
    const texte = execFileSync('pdftotext', ['-layout', f, '-']).toString();
    assert.match(texte, /AVOIR/); assert.match(texte, /Avoir annulant la facture FA-2026-0042/);
    assert.match(texte, /Œillet & figue/, 'texte extractible (ToUnicode), accents et ligatures');
    assert.match(texte, /Article 79/); assert.match(texte, /Page 1 sur \d/);
    assert.match(texte, /Montant remboursé/);
    const polices = execFileSync('pdffonts', [f]).toString();
    assert.equal((polices.match(/CID TrueType\s+Identity-H\s+yes yes yes/g) || []).length, 2, 'polices intégrées, réduites, avec ToUnicode');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('route : contrôles, PDF téléchargeable, avoir absent, droits', async () => {
  const db = ouvrir(':memory:');
  const s = http.createServer(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${s.address().port}`;
  s.on('request', creerApp({ db, env: { LIMITE_ESSAIS: '1000', LIMITES_FACTEUR: '1000', ABONNEMENT_OBLIGATOIRE: 'non' }, urlPublique: base, journal: { log() {}, error() {} } }));
  let cookie = '';
  const c = async (m, chemin, corps) => { const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: corps ? JSON.stringify(corps) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; '); return r; };
  try {
    const conf = { boutique: { nom: 'Atelier', pays: 'fr', secteur: 'maison', sections: [] }, entreprise: { raison: 'Atelier SAS', adresse: '5 rue Neuve, 69001 Lyon', regime: 'normal' } };
    assert.equal((await c('POST', '/api/auth/inscription', { email: 'pdf@exemple.fr', motDePasse: 'un mot de passe solide', config: conf, produits: [{ nom: 'Vase « Été »', prix: 60, stock: 5, type: 'stock' }] })).status, 201);
    const etat = await (await c('GET', '/api/admin/etat')).json();
    const vente = await (await c('POST', '/api/admin/caisse', { lignes: [{ produitId: etat.produits[0].id, qte: 2 }], moyen: 'carte', cle: 't_pdf' })).json();
    let r = await c('GET', `/api/admin/commandes/${vente.id}/facture-pdf`);
    assert.equal(r.status, 409, 'mentions manquantes : rien n’est produit'); assert.match((await r.json()).erreur, /numéro de TVA/);
    const cfg = JSON.parse(db.prepare('SELECT config FROM boutiques').get().config); cfg.entreprise.tvaIntra = 'FR12345678901'; cfg.entreprise.siret = '12345678901234';
    db.prepare('UPDATE boutiques SET config = ?').run(JSON.stringify(cfg));
    r = await c('GET', `/api/admin/commandes/${vente.id}/facture-pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="FA-\d{4}-\d{4}\.pdf"/); assert.match(r.headers.get('cache-control'), /no-store/);
    const pdf = Buffer.from(await r.arrayBuffer());
    const { objets, flux } = analyser(pdf);
    const fichier = Object.entries(objets).find(([, o]) => /\/Type \/EmbeddedFile/.test(o.texte));
    const xml = flux(Number(fichier[0])).toString('utf8');
    assert.deepEqual(F.verifier(xml), []); assert.match(xml, /<ram:GrandTotalAmount>120\.00</);
    assert.equal((await c('GET', `/api/admin/commandes/${vente.id}/facture-pdf?avoir=1`)).status, 404, 'pas d’avoir');
    assert.equal((await fetch(`${base}/api/admin/commandes/${vente.id}/facture-pdf`)).status, 401, 'sans session');
    assert.equal((await c('GET', '/api/admin/commandes/inexistante/facture-pdf')).status, 404);
  } finally { s.close(); }
});

test('relecture : texte géant en temps linéaire, métadonnées propres, noms longs, pas de page vide d’en-tête', () => {
  // Un mot de 300 000 caractères dans l'adresse (champ de configuration) ne bloque pas le serveur.
  const geant = { ...config, entreprise: { ...config.entreprise, adresse: 'x'.repeat(300000), raison: `Société\u0001 très\r\nlongue ${'Nom '.repeat(40)}￾\uD800`, forme: 'y'.repeat(50000) } };
  const c = commande(2); c.client.nom = 'Z'.repeat(100); c.remise = 1; c.motifRemise = 'm'.repeat(100000);
  const t0 = Date.now();
  const pdf = FX.produire(c, geant, { xml: F.produire(c, config) });
  assert.ok(Date.now() - t0 < 2000, `produit en ${Date.now() - t0} ms`);
  const { objets, flux, ref, trailer } = analyser(pdf);
  const meta = flux(ref(objets[ref(trailer, 'Root')].texte, 'Metadata')).toString('utf8');
  const auteur = decoderUtf16(/\/Author <([0-9A-F]+)>/.exec(objets[ref(trailer, 'Info')].texte)[1]);
  assert.doesNotMatch(auteur, /[\u0000-\u001F￾￿]|[\uD800-\uDFFF]/);
  assert.ok(meta.includes(`<rdf:li>${auteur.replace(/&/g, '&amp;')}</rdf:li>`), 'Info = XMP');
  let outils = true; try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { outils = false; }
  if (!outils) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-'));
  try {
    // Totaux et mentions qui débordent : la page suivante n'a pas d'en-tête de tableau vide.
    for (let n = 14; n <= 30; n++) {
      const cn = commande(n); cn.statut = 'attente'; delete cn.payeLe; cn.echeance = Date.UTC(2026, 11, 1);
      const f = path.join(dir, `${n}.pdf`); fs.writeFileSync(f, FX.produire(cn, { ...config, entreprise: { ...config.entreprise, iban: 'FR7630006000011234567890189' } }, { xml: F.produire(cn, config) }));
      const pages = execFileSync('pdftotext', ['-layout', f, '-']).toString().split('\f').filter(p => p.trim());
      pages.forEach((p, i) => { if (i && /Désignation/.test(p)) assert.match(p, /Article \d+|Livraison|Remise/, `${n} lignes, page ${i + 1} : en-tête sans ligne`); });
      assert.equal(pages.findIndex(p => /Montant à payer/.test(p)), pages.findIndex(p => /IBAN/.test(p)), 'mentions ensemble');
    }
    const f = path.join(dir, 'g.pdf'); fs.writeFileSync(f, pdf);
    const texte = execFileSync('pdftotext', ['-layout', f, '-']).toString();
    assert.ok(texte.split('\n').every(l => l.length < 160), 'aucune ligne hors de la page');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('relecture des cartes cadeaux : une facture payée ne demande jamais de paiement', () => {
  for (const carte of [null, { id: 'cc', fin: 'AB12', montant: 10 }]) {
    const c = commande(2); if (carte) c.carteCadeau = carte;
    const cfg = { ...config, entreprise: { ...config.entreprise, iban: 'FR7630006000011234567890189' } };
    const pdf = FX.produire(c, cfg, { xml: F.produire(c, cfg) });
    analyser(pdf);
    let texte = '';   // texte extrait par pdftotext (test ignoré sans poppler)
    try { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fxp-')); const f = path.join(d, 'a.pdf'); fs.writeFileSync(f, pdf); texte = execFileSync('pdftotext', [f, '-']).toString(); fs.rmSync(d, { recursive: true, force: true }); } catch { return; }
    assert.doesNotMatch(texte, /Montant à payer|IBAN/, carte ? 'avec carte' : 'sans carte');
    assert.match(texte, /Paiement reçu/);
    if (carte) assert.match(texte, /Dont 10,00 € réglés par carte cadeau ····AB12/);
  }
});
