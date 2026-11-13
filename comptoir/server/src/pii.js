/* Chiffrement au repos des données personnelles des clients dans les commandes (nom, e-mail, adresse, téléphone…).
   - AES-256-GCM (chiffrement authentifié, étiquette de 16 octets) : une donnée modifiée est refusée. Le chiffré est lié
     à sa boutique et à sa commande (données associées) : recopié dans une autre commande, il est refusé aussi.
   - Index aveugle de l'e-mail : HMAC-SHA256 (clé distincte) de la boutique et de l'adresse normalisée. Il retrouve les
     commandes d'un client sans stocker son adresse, et ne relie pas un même client d'une boutique à l'autre.
   - Trousseau de clés : la clé courante chiffre ; les anciennes (par ex. la clé gardée dans la base avant que
     SECRET_CHIFFREMENT soit défini) déchiffrent encore. Le démarrage rechiffre tout avec la clé courante.
   - Lecture tolérante : une donnée illisible (falsifiée, clé perdue) donne un client « illisible », sans bloquer la
     boutique, et son chiffré d'origine est conservé tel quel à la prochaine écriture (jamais écrasé).
   Formats : « v2. » + base64url(iv 12 | étiquette 16 | chiffré), données associées liées à la commande ;
   « v1. » (premières versions, sans liaison) : lu seulement, rechiffré en v2 au démarrage. */
'use strict';
const crypto = require('node:crypto');

const derive = (cle, etiquette) => Buffer.from(crypto.hkdfSync('sha256', cle, Buffer.alloc(0), etiquette, 32));
const aad = (version, ctx) => Buffer.from(version === 1 ? 'comptoir:client:v1' : `comptoir:client:v2|${ctx.boutique}|${ctx.commande}`);
const normEmail = e => String(e || '').normalize('NFC').trim().toLowerCase();

function creer(cles) {
  const trousseau = (Array.isArray(cles) ? cles : [cles]).filter(Boolean).map(c => ({ chiffre: derive(c, 'comptoir:pii:chiffrement'), index: derive(c, 'comptoir:pii:index') }));
  if (!trousseau.length) throw new Error('clé de chiffrement absente');
  const courante = trousseau[0];
  const empreinteCle = crypto.createHash('sha256').update(courante.chiffre).digest('hex').slice(0, 16);
  const cache = new Map();   // chiffré → client déchiffré (un chiffré est unique : jamais périmé) ; borné
  const ancienne = new Set();   // chiffrés d'une ancienne clé ou d'un ancien format : rechiffrés à la prochaine écriture
  const ORIGINE = new WeakMap();   // client lu → son chiffré d'origine (réutilisé s'il n'a pas changé)
  const garder = (k, v) => { cache.set(k, v); if (cache.size > 5000) cache.delete(cache.keys().next().value); };

  const chiffrer = (objet, ctx) => {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', courante.chiffre, iv, { authTagLength: 16 });
    c.setAAD(aad(2, ctx));
    const ct = Buffer.concat([c.update(JSON.stringify(objet), 'utf8'), c.final()]);
    return `v2.${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url')}`;
  };
  /* Déchiffre avec chaque clé du trousseau. Renvoie { client, ancien } (ancien : clé ou format à renouveler). */
  const dechiffrer = (texte, ctx) => {
    const m = /^v([12])\.([A-Za-z0-9_-]+)$/.exec(String(texte || ''));
    if (!m) throw new Error('format inconnu');
    const version = Number(m[1]), b = Buffer.from(m[2], 'base64url');
    if (b.length < 29) throw new Error('chiffré trop court');
    for (const [i, k] of trousseau.entries()) {
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', k.chiffre, b.subarray(0, 12), { authTagLength: 16 });
        d.setAAD(aad(version, ctx)); d.setAuthTag(b.subarray(12, 28));
        const client = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
        return { client, ancien: i > 0 || version === 1 };
      } catch { /* clé suivante */ }
    }
    throw new Error('déchiffrement impossible');
  };
  const index = (boutique, email) => { const e = normEmail(email); return e ? crypto.createHmac('sha256', courante.index).update(`${boutique}|${e}`).digest('hex').slice(0, 40) : null; };

  return {
    empreinteCle, index, normEmail,
    chiffrer, dechiffrer: (t, ctx) => dechiffrer(t, ctx).client,
    /* Données écrites en base : le client remplacé par son chiffré (un client illisible garde son chiffré d'origine). */
    versStockage(donnees, ctx) {
      if (!donnees || !('client' in donnees)) return donnees;
      const { client, ...reste } = donnees;
      if (client && client.illisible && client.chiffreOrigine) return { ...reste, clientChiffre: client.chiffreOrigine };
      if (!client || typeof client !== 'object') return reste;   // client vide ou malformé : rien à garder
      // Client inchangé depuis sa lecture (même commande) : son chiffré est repris tel quel (pas de rechiffrement à chaque enregistrement).
      const o = ORIGINE.get(client);
      if (o && o.commande === ctx.commande && o.boutique === ctx.boutique && o.json === JSON.stringify(client)) return { ...reste, clientChiffre: o.chiffre };
      return { ...reste, clientChiffre: chiffrer(client, ctx) };
    },
    /* Données lues en base : client déchiffré ; illisible → client de remplacement, sans erreur. */
    depuisStockage(donnees, ctx, { signaler } = {}) {
      if (!donnees || !donnees.clientChiffre) return donnees;
      const { clientChiffre, ...reste } = donnees;
      const k = `${ctx.boutique}|${ctx.commande}|${crypto.createHash('sha256').update(clientChiffre).digest('base64')}`;   // tout le chiffré compte : une falsification n'est jamais servie depuis le cache
      const marquer = c => { const copie = { ...c }; if (!ancienne.has(k)) ORIGINE.set(copie, { chiffre: clientChiffre, json: JSON.stringify(copie), ...ctx }); return copie; };
      if (cache.has(k)) return { ...reste, client: marquer(cache.get(k)) };
      try { const { client, ancien } = dechiffrer(clientChiffre, ctx); if (ancien) ancienne.add(k); garder(k, client); return { ...reste, client: marquer(client) }; }
      catch (e) { if (signaler) signaler(e); return { ...reste, client: { nom: '(données client illisibles)', email: '', adresse: '', npa: '', ville: '', illisible: true, chiffreOrigine: clientChiffre } }; }
    },
    /* Ce chiffré doit-il être renouvelé (ancienne clé, ancien format) ? Lève une erreur s'il est illisible. */
    aRenouveler: (texte, ctx) => dechiffrer(texte, ctx).ancien
  };
}

module.exports = { creer };
