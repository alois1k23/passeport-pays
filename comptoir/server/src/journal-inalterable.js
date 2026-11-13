/* Journal inaltérable des pièces de vente : factures, tickets de caisse et avoirs.
   Chaque pièce est scellée une seule fois, dès son émission, dans une chaîne propre à la boutique :
   empreinte = HMAC-SHA256(clé du serveur, empreinte précédente | n° | type | référence | date | contenu).
   Sans la clé (SECRET_CHIFFREMENT, gardée hors de la base), une copie de la base ne permet pas de recalculer la chaîne.
   La vérification contrôle aussi :
   - la continuité des numéros de pièces jusqu'au compteur de la boutique (une pièce supprimée, même en fin de chaîne, se voit) ;
   - que chaque pièce existante est scellée et correspond à son sceau ;
   - les totaux de chaque clôture et le grand total perpétuel ;
   - les empreintes déjà envoyées au marchand (rapport du lundi) : elles doivent toujours figurer dans la chaîne.
   Chaque jour est clôturé (nombre de pièces, total, grand total perpétuel). Une pièce est rattachée au jour où elle est
   scellée : une vente encaissée hors ligne et envoyée plus tard compte le jour de son envoi (sa date réelle est dans le sceau).
   Aide à la traçabilité, non certifiée : ce journal ne remplace pas la certification NF 525 exigée en France des logiciels
   de caisse (art. 286, I-3° bis du CGI). Le sceau ne contient aucune donnée personnelle du client (effacement RGPD possible). */
'use strict';
const crypto = require('node:crypto');
const Retours = require('./retours-partiels');

const ORIGINE = '0'.repeat(64);
const centimes = n => Math.round(Number(n || 0) * 100);
const FORMAT_JOUR = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' });
const jourDe = ms => FORMAT_JOUR.format(new Date(ms));   // jour civil à Zurich (même fuseau en France et en Belgique)
const lendemain = jour => { const d = new Date(`${jour}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const pause = () => new Promise(r => setImmediate(r));
const numeroDe = ref => { const m = /-(\d+)$/.exec(String(ref || '')); return m ? Number(m[1]) : null; };

/* Contenu scellé d'une pièce, champs dans un ordre fixe.
   Avoir partiel (retour d'une partie des articles) : ref = son numéro ; scellé avec ses seules lignes et son montant.
   Avoir final d'une commande qui a eu des avoirs partiels : scellé avec ce qui restait. */
function contenuPiece(type, c, ref) {
  if (type === 'avoir-partiel') {
    const piece = (c.retoursPartiels || []).find(p => p.numero === ref);
    return piece ? contenuPiece('avoir', Retours.vuePartielle(c, piece)).replace('{"type":"avoir"', '{"type":"avoir-partiel"') : null;
  }
  if (type === 'avoir' && c.retoursPartiels && c.retoursPartiels.length && c.avoir) c = Retours.vueReste(c);
  const avoir = type === 'avoir';
  const lignes = (c.lignes || []).map(l => [String(l.nom), Number(l.qte), centimes(l.prix), typeof l.tauxTva === 'number' ? Math.round(l.tauxTva * 1000) : null]);
  return JSON.stringify({
    type, numero: avoir ? c.avoir.numero : c.facture, commande: c.numero, date: avoir ? c.avoir.date : (c.dateFacture || c.date),
    canal: c.canal || 'web', total: (avoir ? -1 : 1) * centimes(avoir ? (c.avoir.montant ?? c.total) : c.total),
    port: centimes(c.port), remise: centimes(c.remise), tva: typeof c.tauxTva === 'number' ? Math.round(c.tauxTva * 1000) : null, lignes,
    // Caisse : moyen de paiement et arrondi des espèces (montant réellement encaissé)
    // Part payée par carte cadeau (moyen de paiement, pas une remise) : scellée avec la pièce.
    carteCadeau: c.carteCadeau && c.carteCadeau.montant ? centimes(c.carteCadeau.montant) : undefined,
    moyen: c.canal === 'magasin' ? (c.moyen || null) : undefined, encaisse: typeof c.encaisse === 'number' ? centimes(c.encaisse) : undefined, arrondi: typeof c.arrondi === 'number' ? centimes(c.arrondi) : undefined,
    factureOrigine: avoir ? c.facture : undefined
  });
}

/* cle : une clé, ou un trousseau [courante, ...anciennes] (rotation de SECRET_CHIFFREMENT). Les nouvelles entrées sont
   signées avec la courante ; la vérification accepte les anciennes, sous deux conditions, quel que soit l'ordre dans
   lequel l'exploitant les a listées :
   - le long de la chaîne, une clé remplacée ne revient jamais (chaque clé couvre une seule suite d'entrées, et la clé
     courante, une fois apparue, couvre tout le reste) ;
   - une entrée signée avec une ancienne clé ne peut pas être datée d'après la rotation qui l'a remplacée.
   Les anciennes clés doivent donc être gardées tant que le journal l'est. Limite : quelqu'un qui détient une ancienne clé
   ET peut écrire dans la base pourrait re-signer toute la chaîne avec elle ; seules les empreintes envoyées chaque
   semaine au marchand (ancres) le révèlent. Après une fuite de clé, ce sont elles qui font foi. */
function creer(db, cles) {
  const trousseau = (Array.isArray(cles) ? cles : [cles]).filter(Boolean), cle = trousseau[0];
  db.exec(`CREATE TABLE IF NOT EXISTS journal_inalterable (
      boutique_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, ref TEXT NOT NULL, commande_id TEXT, le INTEGER NOT NULL,
      contenu TEXT NOT NULL, empreinte TEXT NOT NULL, cloture_seq INTEGER, PRIMARY KEY (boutique_id, seq), UNIQUE (boutique_id, type, ref));
    CREATE INDEX IF NOT EXISTS journal_inalterable_commande ON journal_inalterable (boutique_id, commande_id);
    CREATE TABLE IF NOT EXISTS journal_ancres (boutique_id TEXT NOT NULL, seq INTEGER NOT NULL, empreinte TEXT NOT NULL, envoye_le INTEGER NOT NULL, PRIMARY KEY (boutique_id, seq));
    CREATE TABLE IF NOT EXISTS journal_verifications (boutique_id TEXT PRIMARY KEY, le INTEGER NOT NULL, resultat TEXT NOT NULL);`);
  try { db.exec('ALTER TABLE journal_inalterable ADD COLUMN cloture_seq INTEGER'); } catch { /* déjà là */ }
  db.exec('CREATE TABLE IF NOT EXISTS journal_meta (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)');
  const meta = k => (db.prepare('SELECT valeur FROM journal_meta WHERE cle = ?').get(k) || {}).valeur;
  const signerAvec = (k, prec, e) => crypto.createHmac('sha256', k).update(`${prec}|${e.seq}|${e.type}|${e.ref}|${e.le}|${e.contenu}`).digest('hex');
  const signer = (prec, e) => signerAvec(cle, prec, e);
  // Version 1 (empreintes SHA-256 simples, quelques minutes de développement, jamais en production) : mise de côté
  // telle quelle dans journal_inalterable_v1, puis les pièces sont rescellées en version 2 (reprise).
  if (!meta('version')) {
    if (db.prepare('SELECT 1 FROM journal_inalterable LIMIT 1').get()) {
      db.exec('DROP TABLE IF EXISTS journal_inalterable_v1; ALTER TABLE journal_inalterable RENAME TO journal_inalterable_v1; DELETE FROM journal_verifications; DELETE FROM journal_ancres;');
      db.exec(`CREATE TABLE journal_inalterable (boutique_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, ref TEXT NOT NULL, commande_id TEXT, le INTEGER NOT NULL,
        contenu TEXT NOT NULL, empreinte TEXT NOT NULL, cloture_seq INTEGER, PRIMARY KEY (boutique_id, seq), UNIQUE (boutique_id, type, ref));
        DROP INDEX IF EXISTS journal_inalterable_commande; CREATE INDEX journal_inalterable_commande ON journal_inalterable (boutique_id, commande_id);`);
    }
    db.prepare("INSERT INTO journal_meta (cle, valeur) VALUES ('version', '2')").run();
  }
  // Empreinte de la clé de signature : une clé changée (SECRET_CHIFFREMENT modifié) est signalée comme telle,
  // et non comme une falsification de chaque pièce.
  const empreinteDe = k => crypto.createHmac('sha256', k).update('comptoir:journal:cle').digest('hex').slice(0, 16);
  const empreinteCle = empreinteDe(cle), empreintesConnues = trousseau.map(empreinteDe);
  if (!meta('cle')) db.prepare("INSERT INTO journal_meta (cle, valeur) VALUES ('cle', ?)").run(empreinteCle);
  // Rotation : la clé enregistrée est une ancienne clé du trousseau. La nouvelle devient la référence, et le changement
  // est noté (date, empreintes, jamais les clés).
  else if (meta('cle') !== empreinteCle && empreintesConnues.includes(meta('cle'))) {
    const rotations = JSON.parse(meta('rotations') || '[]'); rotations.push({ le: Date.now(), de: meta('cle'), vers: empreinteCle });
    db.prepare("INSERT INTO journal_meta (cle, valeur) VALUES ('rotations', ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur").run(JSON.stringify(rotations));
    db.prepare("UPDATE journal_meta SET valeur = ? WHERE cle = 'cle'").run(empreinteCle);
  }
  const cleChangee = () => meta('cle') !== empreinteCle;

  function ajouter(boutiqueId, type, ref, commandeId, contenu, le) {
    const dernier = db.prepare('SELECT seq, empreinte FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq DESC LIMIT 1').get(boutiqueId);
    const e = { seq: dernier ? dernier.seq + 1 : 1, type, ref, le, contenu };
    const empreinte = signer(dernier ? dernier.empreinte : ORIGINE, e);
    db.prepare('INSERT INTO journal_inalterable (boutique_id, seq, type, ref, commande_id, le, contenu, empreinte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(boutiqueId, e.seq, type, ref, commandeId, le, contenu, empreinte);
    return { seq: e.seq, empreinte };
  }

  /* Scelle la facture (ou le ticket) et l'avoir d'une commande s'ils ne le sont pas encore. Idempotent.
     Une commande a au plus une facture et un avoir : un second numéro pour la même commande est refusé (conflit signalé). */
  function sceller(boutiqueId, c, le = Date.now(), leAvoir = le, { reprise = false } = {}) {
    const faits = [], conflits = [];
    const existant = types => db.prepare(`SELECT ref FROM journal_inalterable WHERE boutique_id = ? AND commande_id = ? AND type IN (${types.map(() => '?').join(', ')})`).get(boutiqueId, c.id, ...types);
    if (c.facture) {
      const type = c.canal === 'magasin' ? 'ticket' : 'facture', e = existant(['facture', 'ticket']);
      if (!e) { ajouter(boutiqueId, type, c.facture, c.id, contenuPiece(type, c), le); faits.push(c.facture); } else if (e.ref !== c.facture) conflits.push(`${c.facture} (déjà ${e.ref})`);
    }
    // Avoirs partiels, dans l'ordre (avant l'avoir final, qui ne vient qu'après eux).
    for (const piece of c.retoursPartiels || []) {
      if (!piece.numero) continue;
      const e = db.prepare("SELECT 1 FROM journal_inalterable WHERE boutique_id = ? AND type = 'avoir-partiel' AND ref = ?").get(boutiqueId, piece.numero);
      if (!e) { ajouter(boutiqueId, 'avoir-partiel', piece.numero, c.id, contenuPiece('avoir-partiel', c, piece.numero), reprise ? piece.date : leAvoir); faits.push(piece.numero); }
    }
    if (c.avoir && c.avoir.numero) {
      const e = existant(['avoir']);
      if (!e) { ajouter(boutiqueId, 'avoir', c.avoir.numero, c.id, contenuPiece('avoir', c), leAvoir); faits.push(c.avoir.numero); } else if (e.ref !== c.avoir.numero) conflits.push(`${c.avoir.numero} (déjà ${e.ref})`);
    }
    return { faits, conflits };
  }

  /* Pièces émises mais pas encore scellées (journal créé après elles, ou scellement interrompu). */
  function nonScellees(boutiqueId = null) {
    return db.prepare(`SELECT c.* FROM commandes c WHERE ${boutiqueId ? 'c.boutique_id = ? AND' : ''} (
        (json_extract(c.donnees, '$.facture') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_inalterable j WHERE j.boutique_id = c.boutique_id AND j.commande_id = c.id AND j.type IN ('facture', 'ticket')))
        OR (json_extract(c.donnees, '$.avoir.numero') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_inalterable j WHERE j.boutique_id = c.boutique_id AND j.commande_id = c.id AND j.type = 'avoir'))
        OR (json_type(c.donnees, '$.retoursPartiels') = 'array' AND EXISTS (SELECT 1 FROM json_each(c.donnees, '$.retoursPartiels') r WHERE json_extract(r.value, '$.numero') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_inalterable j WHERE j.boutique_id = c.boutique_id AND j.type = 'avoir-partiel' AND j.ref = json_extract(r.value, '$.numero')))))`)
      .all(...(boutiqueId ? [boutiqueId] : []));
  }

  /* Reprise (démarrage) : scelle les pièces manquantes de chaque boutique, dans l'ordre de leur date, en une transaction
     par boutique. Une reprise interrompue repart d'où elle s'était arrêtée. La date de scellement est celle du document. */
  function reprendre(lireCommande) {
    const parBoutique = new Map();
    for (const row of nonScellees()) { if (!parBoutique.has(row.boutique_id)) parBoutique.set(row.boutique_id, []); parBoutique.get(row.boutique_id).push(lireCommande(row)); }
    let n = 0;
    for (const [bid, cmds] of parBoutique) {
      cmds.sort((a, b) => (a.dateFacture || a.date) - (b.dateFacture || b.date));
      db.exec('BEGIN');
      try { for (const c of cmds) n += sceller(bid, c, c.dateFacture || c.date, (c.avoir && c.avoir.date) || c.dateFacture || c.date, { reprise: true }).faits.length; db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    return n;
  }

  /* Clôture des jours terminés. Chaque pièce est couverte par exactement une clôture : celle du jour où elle a été
     scellée, ou la première clôture suivante si ce jour était déjà clôturé (reprise). */
  function cloturer(boutiqueId, maintenant = Date.now()) {
    const aujourdHui = jourDe(maintenant);
    const derniere = db.prepare("SELECT ref, contenu FROM journal_inalterable WHERE boutique_id = ? AND type = 'cloture' ORDER BY seq DESC LIMIT 1").get(boutiqueId);
    let grandTotal = derniere ? JSON.parse(derniere.contenu).grandTotal : 0;
    const premierJourOuvert = derniere ? lendemain(derniere.ref) : '0000-00-00';
    const parJour = new Map();
    for (const p of db.prepare("SELECT seq, le, contenu FROM journal_inalterable WHERE boutique_id = ? AND type != 'cloture' AND cloture_seq IS NULL ORDER BY seq").all(boutiqueId)) {
      const j = jourDe(p.le) < premierJourOuvert ? premierJourOuvert : jourDe(p.le);
      if (j >= aujourdHui) continue;
      if (!parJour.has(j)) parJour.set(j, []);
      parJour.get(j).push({ seq: p.seq, ...JSON.parse(p.contenu) });
    }
    const faites = [];
    for (const [jour, liste] of [...parJour].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      db.exec('BEGIN');
      try {
        const totalJour = liste.reduce((a, x) => a + x.total, 0);
        grandTotal += totalJour;
        const contenu = JSON.stringify({ jour, pieces: liste.length, factures: liste.filter(x => x.type !== 'avoir' && x.type !== 'avoir-partiel').length, avoirs: liste.filter(x => x.type === 'avoir' || x.type === 'avoir-partiel').length, totalJour, grandTotal, seqs: liste.map(x => x.seq) });
        const { seq, empreinte } = ajouter(boutiqueId, 'cloture', jour, null, contenu, maintenant);
        const marquer = db.prepare('UPDATE journal_inalterable SET cloture_seq = ? WHERE boutique_id = ? AND seq = ?');
        for (const x of liste) marquer.run(seq, boutiqueId, x.seq);
        db.exec('COMMIT');
        faites.push({ jour, empreinte, pieces: liste.length, totalJour: liste.reduce((a, x) => a + x.total, 0), grandTotal });
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    return faites;   // clôtures créées (jour, empreinte, totaux en centimes)
  }

  /* Empreinte remise au marchand (rapport du lundi) : gardée pour vérifier plus tard qu'elle figure toujours dans la chaîne. */
  function ancrer(boutiqueId, maintenant = Date.now()) {
    const cl = db.prepare("SELECT seq, ref, empreinte FROM journal_inalterable WHERE boutique_id = ? AND type = 'cloture' ORDER BY seq DESC LIMIT 1").get(boutiqueId);
    if (cl) db.prepare('INSERT OR IGNORE INTO journal_ancres (boutique_id, seq, empreinte, envoye_le) VALUES (?, ?, ?, ?)').run(boutiqueId, cl.seq, cl.empreinte, maintenant);
    return cl;
  }

  /* État sans vérification (affichage rapide). */
  function etat(boutiqueId) {
    const n = db.prepare("SELECT SUM(type != 'cloture') pieces, SUM(type = 'cloture') clotures FROM journal_inalterable WHERE boutique_id = ?").get(boutiqueId);
    const der = db.prepare('SELECT empreinte FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq DESC LIMIT 1').get(boutiqueId);
    const cl = db.prepare("SELECT ref, empreinte, contenu FROM journal_inalterable WHERE boutique_id = ? AND type = 'cloture' ORDER BY seq DESC LIMIT 1").get(boutiqueId);
    const v = db.prepare('SELECT le, resultat FROM journal_verifications WHERE boutique_id = ?').get(boutiqueId);
    let resume = {}; try { const { seqs, ...r } = cl ? JSON.parse(cl.contenu) : {}; void seqs; resume = r; } catch { /* entrée illisible : signalée à la vérification */ }
    return { pieces: n.pieces || 0, clotures: n.clotures || 0, empreinte: der ? der.empreinte : null,
      derniereCloture: cl ? { jour: cl.ref, empreinte: cl.empreinte, ...resume } : null,
      derniereVerification: v ? { le: v.le, ...JSON.parse(v.resultat) } : null, cleChangee: cleChangee(), rotationsCle: JSON.parse(meta('rotations') || '[]').length };
  }

  /* Vérification complète, par lots (le serveur reste disponible). lireCommandes(ids) → Map id → commande.
     ancre : empreinte reçue par e-mail, à retrouver dans la chaîne. */
  async function verifier(boutiqueId, { lireCommandes, compteurFactures, ancre = null, lot = 1000, maintenant = Date.now() } = {}) {
    const anomalies = [], noter = t => { if (anomalies.length < 200) anomalies.push(t); };
    // Clé de signature changée : toutes les empreintes diffèrent ; c'est dit une fois, sans accuser chaque pièce.
    const sansSignature = cleChangee();
    if (sansSignature) noter('La clé de signature du serveur a changé (SECRET_CHIFFREMENT) : les empreintes ne peuvent plus être contrôlées. Remettez l’ancienne clé, ou contactez le support.');
    const lire = (e) => { try { return JSON.parse(e.contenu); } catch { noter(`Entrée n° ${e.seq} (${e.ref}) illisible.`); return null; } };
    let prec = ORIGINE, attendu = 1, apres = 0, pieces = 0, clotures = 0, dernier = null, grandTotal = 0, cleEnCours = -1;
    const clesVues = new Set();
    // Date à partir de laquelle chaque ancienne clé ne signe plus (rotation notée vers une clé plus récente).
    const empreintesTrousseau = trousseau.map(empreinteDe), rotations = JSON.parse(meta('rotations') || '[]');
    const finDe = i => { const r = rotations.find(x => x.de === empreintesTrousseau[i]); return r ? r.le : Infinity; };
    const empreintes = new Set(), numeros = new Set(), couverture = new Map(), totaux = new Map(), agees = new Map();
    for (;;) {
      const entrees = db.prepare('SELECT * FROM journal_inalterable WHERE boutique_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(boutiqueId, apres, lot);
      if (!entrees.length) break;
      const commandes = lireCommandes([...new Set(entrees.filter(e => e.commande_id).map(e => e.commande_id))]);
      for (const e of entrees) {
        if (e.seq !== attendu) noter(`Entrées n° ${attendu} à ${e.seq - 1} manquantes (suppression).`);
        attendu = e.seq + 1; apres = e.seq;
        if (!sansSignature) {
          // Clé de l'entrée : celle de l'entrée précédente d'abord, sinon une autre du trousseau.
          let i = cleEnCours >= 0 && signerAvec(trousseau[cleEnCours], prec, e) === e.empreinte ? cleEnCours : trousseau.findIndex(k => signerAvec(k, prec, e) === e.empreinte);
          if (i < 0) noter(`Entrée n° ${e.seq} (${e.ref}) modifiée : son empreinte ne correspond plus.`);
          else {
            if (i !== cleEnCours && (clesVues.has(i) || cleEnCours === 0)) noter(`Entrée n° ${e.seq} (${e.ref}) signée avec une clé déjà remplacée plus haut dans le journal : ajout suspect.`);
            else if (i !== 0 && e.le > finDe(i) + 60000) noter(`Entrée n° ${e.seq} (${e.ref}) signée avec une ancienne clé mais datée d’après sa rotation : ajout suspect.`);
            clesVues.add(i); cleEnCours = i;
          }
        }
        prec = e.empreinte; dernier = e; empreintes.add(e.empreinte);
        if (e.type === 'cloture') {
          clotures++;
          const d = lire(e); if (!d) continue;
          const somme = (d.seqs || []).reduce((a, s) => { if (couverture.get(s) !== undefined) noter(`Pièce n° ${s} comptée dans deux clôtures.`); couverture.set(s, e.seq); return a + (totaux.get(s) ?? (noter(`Clôture du ${e.ref} : pièce n° ${s} inconnue.`), 0)); }, 0);
          if (somme !== d.totalJour) noter(`Clôture du ${e.ref} : total du jour faux (${d.totalJour / 100} au lieu de ${somme / 100}).`);
          if (grandTotal + d.totalJour !== d.grandTotal) noter(`Clôture du ${e.ref} : grand total perpétuel faux.`);
          grandTotal = d.grandTotal;
          continue;
        }
        pieces++;
        const d = lire(e); if (!d) continue;
        totaux.set(e.seq, d.total); if (!couverture.has(e.seq)) agees.set(e.seq, e);
        const num = numeroDe(e.ref); if (num !== null) { if (numeros.has(num)) noter(`Numéro ${num} utilisé deux fois.`); numeros.add(num); }
        const c = e.commande_id ? commandes.get(e.commande_id) : null;
        if (!c) { noter(`${e.ref} : la commande a été supprimée.`); continue; }
        const refActuelle = e.type === 'avoir-partiel' ? ((c.retoursPartiels || []).some(p => p.numero === e.ref) ? e.ref : null) : e.type === 'avoir' ? (c.avoir && c.avoir.numero) : c.facture;
        if (refActuelle !== e.ref || contenuPiece(e.type, c, e.ref) !== e.contenu) noter(`${e.ref} : la pièce ne correspond plus à son sceau (montant, articles ou numéro modifiés).`);
      }
      await pause();
    }
    // Chaque pièce de plus de deux jours doit figurer dans une clôture (la colonne cloture_seq n'est pas signée : on ne s'y fie pas).
    const limite = jourDe(maintenant - 2 * 86400000);
    const horsCloture = [...agees.values()].filter(e => !couverture.has(e.seq) && jourDe(e.le) < limite);
    if (horsCloture.length) noter(`${horsCloture.length} pièce${horsCloture.length > 1 ? 's' : ''} absente${horsCloture.length > 1 ? 's' : ''} de toute clôture (${horsCloture.slice(0, 5).map(e => e.ref).join(', ')}) : grand total incomplet.`);
    // Continuité : tous les numéros de 1 au compteur de la boutique existent (factures, tickets et avoirs partagent la suite).
    const compteur = Number(compteurFactures) || 0;
    const manquants = []; for (let i = 1; i <= compteur && manquants.length < 10; i++) if (!numeros.has(i)) manquants.push(i);
    if (manquants.length) noter(`Numéros de pièces manquants dans le journal : ${manquants.join(', ')}${manquants.length === 10 ? '…' : ''} (sur ${compteur} émis).`);
    const ns = nonScellees(boutiqueId);
    if (ns.length) noter(`${ns.length} pièce${ns.length > 1 ? 's' : ''} émise${ns.length > 1 ? 's' : ''} mais non scellée${ns.length > 1 ? 's' : ''} (n° de commande ${ns.slice(0, 5).map(r => r.numero).join(', ')}).`);
    for (const a of db.prepare('SELECT seq, empreinte, envoye_le FROM journal_ancres WHERE boutique_id = ?').all(boutiqueId))
      if (!empreintes.has(a.empreinte)) noter(`L’empreinte envoyée le ${new Date(a.envoye_le).toLocaleDateString('fr-CH')} ne figure plus dans le journal : la chaîne a été réécrite.`);
    const ancreOk = ancre ? empreintes.has(String(ancre).trim().toLowerCase()) : null;
    // (une empreinte saisie introuvable n'est pas une anomalie du journal en soi : elle peut être mal recopiée ; réponse à part)
    const resultat = { cleChangee: sansSignature, ok: !anomalies.length, nbAnomalies: anomalies.length, anomalies: anomalies.slice(0, 50), pieces, clotures, empreinte: dernier ? dernier.empreinte : null, ancreOk };
    const { ancreOk: _a, ...memo } = resultat; void _a;
    db.prepare('INSERT OR REPLACE INTO journal_verifications (boutique_id, le, resultat) VALUES (?, ?, ?)').run(boutiqueId, maintenant, JSON.stringify(memo));
    return resultat;
  }

  /* Export CSV (archivage) : toutes les entrées, avec leur empreinte. */
  function exporterCsv(boutiqueId) {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const out = ['﻿' + ['seq', 'type', 'reference', 'scelle_le', 'montant', 'grand_total', 'empreinte', 'contenu'].join(';')];
    for (const e of db.prepare('SELECT * FROM journal_inalterable WHERE boutique_id = ? ORDER BY seq').iterate(boutiqueId)) {
      let d; try { d = JSON.parse(e.contenu); } catch { d = { total: 0, totalJour: 0, grandTotal: 0 }; }
      out.push([e.seq, e.type, q(e.ref), new Date(e.le).toISOString(), e.type === 'cloture' ? (d.totalJour / 100).toFixed(2) : (d.total / 100).toFixed(2), e.type === 'cloture' ? (d.grandTotal / 100).toFixed(2) : '', e.empreinte, q(e.contenu)].join(';'));
    }
    return out.join('\n') + '\n';
  }

  return { sceller, nonScellees, reprendre, cloturer, ancrer, etat, verifier, exporterCsv };
}

module.exports = { creer, contenuPiece, jourDe, numeroDe, ORIGINE };
