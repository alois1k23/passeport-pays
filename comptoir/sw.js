/* Comptoir — service worker de l'espace marchand (portée /app).
   Réseau d'abord : on sert toujours la dernière version en ligne ; la copie locale ne sert que hors connexion
   (l'application s'ouvre et affiche un message clair au lieu d'une page d'erreur du navigateur).
   Les appels à l'API ne sont jamais mis en cache : aucune donnée de la boutique ne reste dans le cache. */
const CACHE = 'comptoir-coquille-v2';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/app', '/css/app.css', '/img/icone-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const statique = e.request.mode === 'navigate' || /^\/(css|js|img|fonts)\//.test(u.pathname);
  if (!statique) return;
  e.respondWith(fetch(e.request).then(rep => {
    if (rep.ok && rep.type === 'basic') { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(e.request.mode === 'navigate' ? '/app' : e.request, copie)); }
    return rep;
  }).catch(async () => (await caches.match(e.request.mode === 'navigate' ? '/app' : e.request)) || new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hors connexion</title><body style="font:16px system-ui;padding:40px;color:#111"><h1>Pas de connexion</h1><p>Comptoir a besoin d’Internet pour afficher vos commandes. Réessayez dès que la connexion revient.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
// Notification push du serveur (nouvelle commande), même quand Comptoir est fermé.
self.addEventListener('push', e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { texte: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.titre || 'Comptoir', { body: m.texte || 'Nouvelle activité sur votre boutique.', icon: '/img/icone-192.png', badge: '/img/icone-192.png', tag: m.tag || 'comptoir', data: { url: m.url || '/app#commandes' } }));
});
// Notification cliquée : on ouvre (ou ramène) l'espace marchand à la bonne page.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || '/app#commandes';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => { const c = l.find(x => new URL(x.url).pathname.startsWith('/app')); if (c) { c.navigate && c.navigate(cible).catch(() => {}); return c.focus(); } return self.clients.openWindow(cible); }));
});
