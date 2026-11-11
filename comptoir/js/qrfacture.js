/* Comptoir — QR-facture suisse (norme SIX « Swiss Payment Standards », Implementation Guidelines QR-bill v2.3).
   Contenu du QR code (« Swiss QR Code »), références QRR / SCOR, contrôle de l'IBAN, dessin SVG avec la croix suisse.
   Partagé par le serveur (page de facture, e-mail) et l'application (aperçu, impression). */
(function (racine, fabrique) {
  const m = fabrique(typeof module !== 'undefined' && module.exports ? require('./vendor/qrcode-generator.js') : racine.qrcode);
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else racine.QrFacture = m;
})(typeof self !== 'undefined' ? self : this, function (qrcode) {
  // IBAN suisse ou liechtensteinois : 21 caractères, contrôle modulo 97 (ISO 13616).
  const normaliserIban = i => String(i || '').toUpperCase().replace(/\s/g, '');
  function ibanValide(iban) {
    const i = normaliserIban(iban);
    if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(i)) return false;
    return mod97(i.slice(4) + i.slice(0, 4)) === 1;
  }
  function mod97(txt) {
    let r = 0;
    for (const c of txt) { const v = /\d/.test(c) ? c : String(c.charCodeAt(0) - 55); for (const d of v) r = (r * 10 + Number(d)) % 97; }
    return r;
  }
  // QR-IBAN : identifiant d'institution (positions 5 à 9) entre 30000 et 31999 ; il exige une référence QRR.
  const estQrIban = iban => { const n = Number(normaliserIban(iban).slice(4, 9)); return n >= 30000 && n <= 31999; };

  // Référence QR (QRR) : 26 chiffres + chiffre de contrôle (modulo 10 récursif).
  function chiffreControleMod10(chiffres) {
    const t = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
    let report = 0;
    for (const c of chiffres) report = t[(report + Number(c)) % 10];
    return String((10 - report) % 10);
  }
  function referenceQrr(base) {
    const ch = String(base).replace(/\D/g, '').slice(-26).padStart(26, '0');
    return ch + chiffreControleMod10(ch);
  }
  const qrrValide = r => /^\d{27}$/.test(r) && chiffreControleMod10(r.slice(0, 26)) === r[26];
  // Référence créancier ISO 11649 (SCOR) : « RF » + 2 chiffres de contrôle + jusqu'à 21 caractères.
  function referenceScor(base) {
    const b = String(base).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 21);
    const controle = 98 - mod97(b + 'RF00');
    return `RF${String(controle).padStart(2, '0')}${b}`;
  }
  const scorValide = r => /^RF\d{2}[0-9A-Z]{1,21}$/.test(r) && mod97(r.slice(4) + r.slice(0, 4)) === 1;

  // Jeu de caractères autorisé (latin étendu de la norme) : le reste est remplacé.
  const nettoyer = (t, max) => String(t || '').normalize('NFC').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E -ſȘ-ț€]/g, '').trim().slice(0, max);
  /* Adresse « Rue du Lac 12, 1003 Lausanne » → rue, numéro, NPA, localité (adresse structurée, type S). */
  function decouperAdresse(adresse, pays = 'CH') {
    const parties = String(adresse || '').split(/,|\n/).map(x => x.trim()).filter(Boolean);
    const ligneVille = parties.find(p => /^(?:[A-Z]{2}-)?\d{4,5}\s+\S/.test(p)) || '';
    const mv = /^(?:[A-Z]{2}-)?(\d{4,5})\s+(.+)$/.exec(ligneVille) || [];
    // Rue : la partie qui commence ou finit par un numéro (« Atelier Bleu, Rue du Lac 12, … » garde la rue, pas le nom).
    const autres = parties.filter(p => p !== ligneVille);
    const rueComplete = autres.find(p => /\s\d+[a-zA-Z]?$/.test(p) || /^\d+[a-zA-Z]?,?\s/.test(p)) || autres[autres.length - 1] || '';
    const mr = /^(.*?)\s+(\d+[a-zA-Z]?)$/.exec(rueComplete) || /^(\d+[a-zA-Z]?),?\s+(.*)$/.exec(rueComplete);
    const [rue, numero] = mr ? (/^\d/.test(mr[1]) ? [mr[2], mr[1]] : [mr[1], mr[2]]) : [rueComplete, ''];
    return { rue: nettoyer(rue, 70), numero: nettoyer(numero, 16), npa: nettoyer(mv[1], 16), localite: nettoyer(mv[2], 35), pays };
  }
  const montant = n => (Math.round(Number(n) * 100) / 100).toFixed(2);
  // Montant permis par la norme : 0.01 à 999 999 999.99 ; sinon le champ reste vide (le payeur saisit le montant).
  const montantValide = n => Number.isFinite(Number(n)) && Number(n) >= 0.01 && Number(n) <= 999999999.99;
  // Adresse utilisable dans le QR code : NPA et localité obligatoires (type S).
  const adresseComplete = a => !!(a && a.nom && a.npa && a.localite);

  /* Contenu du Swiss QR Code (lignes séparées par CR LF, sans ligne finale vide). */
  function charge({ iban, creancier, montant: m, devise = 'CHF', debiteur = null, reference = '', message = '' }) {
    const i = normaliserIban(iban);
    const type = !reference ? 'NON' : /^RF/.test(reference) ? 'SCOR' : 'QRR';
    const adr = a => a ? ['S', nettoyer(a.nom, 70), a.rue, a.numero, a.npa, a.localite, a.pays] : ['', '', '', '', '', '', ''];
    const lignes = ['SPC', '0200', '1', i, ...adr(creancier), '', '', '', '', '', '', '', montantValide(m) ? montant(m) : '', devise, ...adr(adresseComplete(debiteur) ? debiteur : null), type, reference, nettoyer(message, 140), 'EPD'];
    return lignes.join('\r\n');
  }

  /* Dessin SVG du QR code (correction M), avec la croix suisse au centre (7 mm sur 46 mm). */
  function svg(contenu, taille = 46) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    let q;
    // La norme limite le QR code à la version 25 (117 × 117 modules) : le message (avant-dernier champ) est raccourci au besoin.
    for (let essai = contenu; ; ) {
      q = qrcode(0, 'M'); q.addData(essai, 'Byte'); q.make();
      if (q.getModuleCount() <= 117) break;
      const l = essai.split('\r\n'); if (!l[29]) throw new Error('QR-facture trop longue');
      l[29] = l[29].slice(0, Math.floor(l[29].length * 0.7)); essai = l.join('\r\n');
    }
    const n = q.getModuleCount(), u = taille / n;
    let chemin = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) chemin += `M${(x * u).toFixed(3)} ${(y * u).toFixed(3)}h${u.toFixed(3)}v${u.toFixed(3)}h-${u.toFixed(3)}z`;
    const c = 7, o = (taille - c) / 2, b = c * 0.0857, l = c * 0.2;   // croix : carré noir bordé de blanc, croix blanche
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${taille} ${taille}" width="${taille}mm" height="${taille}mm" role="img" aria-label="QR code de paiement suisse"><rect width="${taille}" height="${taille}" fill="#fff"/><path d="${chemin}" fill="#000"/>`
      + `<rect x="${o}" y="${o}" width="${c}" height="${c}" fill="#fff"/><rect x="${o + b}" y="${o + b}" width="${c - 2 * b}" height="${c - 2 * b}" fill="#000"/>`
      + `<rect x="${o + c / 2 - l / 2}" y="${o + c * 0.2}" width="${l}" height="${c * 0.6}" fill="#fff"/><rect x="${o + c * 0.2}" y="${o + c / 2 - l / 2}" width="${c * 0.6}" height="${l}" fill="#fff"/></svg>`;
  }

  const groupesIban = i => normaliserIban(i).replace(/(.{4})/g, '$1 ').trim();
  const groupesQrr = r => r.replace(/^(\d{2})(\d{5})(\d{5})(\d{5})(\d{5})(\d{5})$/, '$1 $2 $3 $4 $5 $6');
  const groupesScor = r => r.replace(/(.{4})/g, '$1 ').trim();

  /* Section paiement complète (récépissé + section paiement), au format de la norme pour l'impression A4 (bas de page). */
  function sectionPaiement(d) {
    const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const adr = a => adresseComplete(a) ? `${esc(a.nom)}<br>${esc([a.rue, a.numero].filter(Boolean).join(' '))}<br>${esc(`${a.pays === 'CH' ? '' : a.pays + '-'}${a.npa} ${a.localite}`)}` : '';
    const ref = !d.reference ? '' : /^RF/.test(d.reference) ? groupesScor(d.reference) : groupesQrr(d.reference);
    const bloc = (titre, contenu) => contenu ? `<p class="qrf-t">${titre}</p><p>${contenu}</p>` : '';
    const mt = montantValide(d.montant) ? montant(d.montant).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
    return `<div class="qrf" role="group" aria-label="Section paiement QR-facture"><p class="qrf-coupe">✂ À détacher avant le versement</p>
      <div class="qrf-recu"><h3>Récépissé</h3>${bloc('Compte / Payable à', `${groupesIban(d.iban)}<br>${adr(d.creancier)}`)}${bloc('Référence', esc(ref))}${adresseComplete(d.debiteur) ? bloc('Payable par', adr(d.debiteur)) : '<p class="qrf-t">Payable par (nom/adresse)</p><div class="qrf-cadre qrf-cadre-recu"></div>'}
        <div class="qrf-montant"><div><p class="qrf-t">Monnaie</p><p>${esc(d.devise || 'CHF')}</p></div><div><p class="qrf-t">Montant</p><p>${mt}</p></div></div><p class="qrf-depot">Point de dépôt</p></div>
      <div class="qrf-paiement"><h3>Section paiement</h3><div class="qrf-code">${svg(charge(d))}</div>
        <div class="qrf-montant"><div><p class="qrf-t">Monnaie</p><p>${esc(d.devise || 'CHF')}</p></div><div><p class="qrf-t">Montant</p><p>${mt}</p></div></div></div>
      <div class="qrf-infos">${bloc('Compte / Payable à', `${groupesIban(d.iban)}<br>${adr(d.creancier)}`)}${bloc('Référence', esc(ref))}${bloc('Informations supplémentaires', esc(nettoyer(d.message, 140)))}${adresseComplete(d.debiteur) ? bloc('Payable par', adr(d.debiteur)) : '<p class="qrf-t">Payable par (nom/adresse)</p><div class="qrf-cadre"></div>'}</div>
    </div>`;
  }
  // Mise en page (mm) : récépissé 62 mm, section paiement 148 mm, hauteur 105 mm, ligne de découpe.
  // Mise en page (norme) : récépissé 62 mm, section paiement 148 mm, hauteur 105 mm ; titres 11 pt, intitulés 6 pt
  // (récépissé) et 8 pt (paiement), contenu 8 pt et 10 pt ; ligne de découpe ; cadres à coins quand l'adresse manque.
  const CSS = `.qrf{position:relative;display:grid;grid-template-columns:62mm 51mm 1fr;width:210mm;height:105mm;border-top:1px dashed #000;font:8pt/1.2 Helvetica,Arial,sans-serif;color:#000;background:#fff;box-sizing:border-box;page-break-inside:avoid}
.qrf-coupe{position:absolute;top:-3.2mm;left:2mm;margin:0;font-size:7pt;background:#fff;padding:0 1mm}
.qrf h3{font-size:11pt;font-weight:700;margin:0 0 3mm}.qrf p{margin:0 0 2mm}.qrf .qrf-t{font-size:6pt;font-weight:700;margin:0}
.qrf-recu{padding:5mm;border-right:1px dashed #000;position:relative}.qrf-paiement{padding:5mm}.qrf-infos{padding:5mm 5mm 5mm 0;font-size:10pt}
.qrf-paiement .qrf-t,.qrf-infos .qrf-t{font-size:8pt}.qrf-paiement .qrf-montant p:not(.qrf-t){font-size:10pt}.qrf-code{margin:2mm 0 4mm;width:46mm;height:46mm}
.qrf-montant{display:flex;gap:6mm}.qrf-depot{position:absolute;right:5mm;bottom:5mm;font-size:6pt;font-weight:700;margin:0}
.qrf-cadre{width:65mm;height:25mm;margin:1mm 0 2mm;background:linear-gradient(#000,#000) 0 0/3mm .3mm,linear-gradient(#000,#000) 0 0/.3mm 3mm,linear-gradient(#000,#000) 100% 0/3mm .3mm,linear-gradient(#000,#000) 100% 0/.3mm 3mm,linear-gradient(#000,#000) 0 100%/3mm .3mm,linear-gradient(#000,#000) 0 100%/.3mm 3mm,linear-gradient(#000,#000) 100% 100%/3mm .3mm,linear-gradient(#000,#000) 100% 100%/.3mm 3mm;background-repeat:no-repeat}
.qrf-cadre-recu{width:52mm;height:20mm}`;

  return { montantValide, adresseComplete, ibanValide, estQrIban, referenceQrr, qrrValide, referenceScor, scorValide, decouperAdresse, charge, svg, sectionPaiement, CSS, normaliserIban, groupesIban };
});
