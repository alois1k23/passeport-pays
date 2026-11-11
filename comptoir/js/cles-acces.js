/* Comptoir — clés d'accès (passkeys) côté navigateur : connexion sans mot de passe (visage, empreinte, code de
   l'appareil) et enregistrement depuis Paramètres > Sécurité. La clé privée ne quitte jamais l'appareil. */
const ClesAcces = (() => {
  const vers = b64 => Uint8Array.from(atob(String(b64).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(b64).length / 4) * 4, '=')), c => c.charCodeAt(0)).buffer;
  const depuis = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const disponible = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;
  const messageErreur = e => e && e.name === 'NotAllowedError' ? 'Opération annulée ou délai dépassé.' : e && e.name === 'InvalidStateError' ? 'Cette clé d’accès est déjà enregistrée sur cet appareil.' : (e && e.message) || 'Clé d’accès indisponible sur cet appareil.';
  async function connexion() {
    const { publicKey } = await api('POST', '/api/auth/cle-acces/options');
    const cred = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: vers(publicKey.challenge) } });
    const r = cred.response;
    return api('POST', '/api/auth/cle-acces/connexion', { reponse: { id: cred.id, clientDataJSON: depuis(r.clientDataJSON), authenticatorData: depuis(r.authenticatorData), signature: depuis(r.signature), userHandle: r.userHandle ? depuis(r.userHandle) : null } });
  }
  async function enregistrer(motDePasse, nom, code) {
    const { publicKey } = await api('POST', '/api/admin/compte/cles-acces/options', { motDePasse, code });
    const cred = await navigator.credentials.create({ publicKey: { ...publicKey, challenge: vers(publicKey.challenge), user: { ...publicKey.user, id: vers(publicKey.user.id) }, excludeCredentials: publicKey.excludeCredentials.map(c => ({ ...c, id: vers(c.id) })) } });
    return api('POST', '/api/admin/compte/cles-acces', { nom, reponse: { id: cred.id, clientDataJSON: depuis(cred.response.clientDataJSON), attestationObject: depuis(cred.response.attestationObject) } });
  }
  return { disponible, connexion, enregistrer, messageErreur };
})();
