/* Comptoir — service worker de l'espace marchand (portée /app).
   Réseau d'abord : on sert toujours la dernière version en ligne ; la copie locale ne sert que hors connexion
   (l'application s'ouvre et affiche un message clair au lieu d'une page d'erreur du navigateur).
   Les appels à l'API ne sont jamais mis en cache : aucune donnée de la boutique ne reste dans le cache. */
const CACHE = 'comptoir-coquille-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/app', '/css/app.css', '/img/icone-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const statique = e.request.mode === 'navigate' || /^\/(css|js|img)\//.test(u.pathname);
  if (!statique) return;
  e.respondWith(fetch(e.request).then(rep => {
    if (rep.ok && rep.type === 'basic') { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(e.request.mode === 'navigate' ? '/app' : e.request, copie)); }
    return rep;
  }).catch(async () => (await caches.match(e.request.mode === 'navigate' ? '/app' : e.request)) || new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hors connexion</title><body style="font:16px system-ui;padding:40px;color:#111"><h1>Pas de connexion</h1><p>Comptoir a besoin d’Internet pour afficher vos commandes. Réessayez dès que la connexion revient.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
// Notification cliquée : on ouvre (ou ramène) l'espace marchand sur les commandes.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => { const c = l.find(x => new URL(x.url).pathname.startsWith('/app')); return c ? c.focus() : self.clients.openWindow('/app#commandes'); }));
});
