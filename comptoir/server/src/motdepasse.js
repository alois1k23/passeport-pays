/* Politique de mot de passe (recommandations NIST SP 800-63B) : longueur, pas de mot de passe courant ou
   tiré du compte, et — si activé — pas de mot de passe déjà paru dans une fuite de données.
   La vérification des fuites utilise l'anonymat k (Have I Been Pwned, « range ») : seuls les 5 premiers
   caractères de l'empreinte SHA-1 quittent le serveur, jamais le mot de passe ni son empreinte complète. */
'use strict';
const crypto = require('node:crypto');

// Mots de passe et racines les plus utilisés (listes publiques de fuites ; FR, DE, IT, EN).
const COURANTS = new Set(`123456 123456789 12345678 1234567890 1234567 password motdepasse passwort password1 azerty azertyuiop qwerty qwertz
qwertyuiop 111111 000000 123123 abc123 iloveyou jetaime soleil bonjour doudou loulou chouchou marseille paris lausanne geneve zurich bern
basel suisse schweiz svizzera france belgique bruxelles motdepasse1 admin administrateur administrator welcome bienvenue willkommen benvenuto
letmein monkey dragon football fussball baseball sunshine princess master shadow superman batman starwars pokemon nicolas camille thomas
julien chocolat fromage vacances printemps hallo123 passwort1 ciao123 password123 azerty123 qwerty123 changeme comptoir boutique shop
shopify magasin dropshipping secret secret123 test test123 testtest 987654321 147258369 159753 741852963 1q2w3e4r 1qaz2wsx zaq12wsx
aaaaaaaaaa abcdefghij abcdefgh 11111111 12341234 696969 mustang michael jennifer jordan23 trustno1 hunter2 whatever freedom`.split(/\s+/));

const normaliser = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const sansDecor = t => normaliser(t).replace(/[^a-z0-9]/g, '').replace(/(19|20)\d{2}$/, '').replace(/\d{1,4}$/, '').replace(/[!.?]+$/, '');

/* Renvoie un message d'erreur en français, ou null si le mot de passe est acceptable. */
function evaluer(mdp, { email = '', noms = [] } = {}) {
  const m = String(mdp || '');
  if (m.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (m.length > 200) return 'Le mot de passe est trop long (200 caractères au plus).';
  const n = normaliser(m);
  if (new Set(n).size <= 2) return 'Ce mot de passe est trop répétitif. Une phrase de quelques mots est plus sûre et plus facile à retenir.';
  if (estSuite(n)) return 'Ce mot de passe est une simple suite de caractères. Choisissez plutôt une phrase de quelques mots.';
  if (COURANTS.has(n) || COURANTS.has(sansDecor(m))) return 'Ce mot de passe fait partie des plus utilisés : il serait deviné en quelques secondes. Choisissez-en un autre.';
  const local = normaliser(String(email).split('@')[0]).replace(/[^a-z0-9]/g, '');
  const morceaux = [local, ...noms.map(x => normaliser(x).replace(/[^a-z0-9]/g, ''))].filter(x => x.length >= 4);
  const compact = n.replace(/[^a-z0-9]/g, '');
  if (morceaux.some(x => compact.includes(x) && compact.length - x.length < 6)) return 'Le mot de passe ne doit pas reprendre votre e-mail ou le nom de votre boutique.';
  return null;
}
function estSuite(n) {
  const codes = [...n].map(c => c.charCodeAt(0));
  let monte = 0, descend = 0;
  for (let i = 1; i < codes.length; i++) { if (codes[i] - codes[i - 1] === 1) monte++; if (codes[i - 1] - codes[i] === 1) descend++; }
  return monte >= codes.length - 2 || descend >= codes.length - 2;
}

/* Vérifie si le mot de passe figure dans une fuite connue. Renvoie le nombre d'apparitions (0 si inconnu),
   ou null si le service n'a pas répondu (on n'empêche pas l'inscription pour une panne externe). */
function creerVerificationFuites({ url = 'https://api.pwnedpasswords.com/range/', fetchImpl = globalThis.fetch, delai = 2500 } = {}) {
  return async function fuites(mdp) {
    const h = crypto.createHash('sha1').update(String(mdp)).digest('hex').toUpperCase();
    try {
      const r = await fetchImpl(url + h.slice(0, 5), { headers: { 'Add-Padding': 'true', 'User-Agent': 'Comptoir' }, signal: AbortSignal.timeout(delai) });
      if (!r.ok) return null;
      const suffixe = h.slice(5);
      for (const ligne of (await r.text()).split('\n')) {
        const [s, n] = ligne.trim().split(':');
        if (s === suffixe) return Number(n) || 0;
      }
      return 0;
    } catch { return null; }
  };
}

module.exports = { evaluer, creerVerificationFuites, COURANTS };
