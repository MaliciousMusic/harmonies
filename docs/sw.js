// Service worker de la page publiée : le réseau a toujours la priorité, le cache ne sert qu'en secours (hors connexion,
// parties locales). Les requêtes vers d'autres origines (Supabase, CDN, polices) passent directement par le réseau.
// Reçoit aussi les notifications push (« à toi de jouer », nouvelle partie, message) envoyées par la fonction Edge.
const CACHE = 'harmonies-20260920184627';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => { /* précache facultatif */ }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { /* cache plein */ }); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

// ---- notifications push : { title, body, tag, url, badge } ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    if (typeof d.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
      try { if (d.badge > 0) await self.navigator.setAppBadge(d.badge); else await self.navigator.clearAppBadge(); } catch (err) { /* facultatif */ }
    }
    // la page ouverte affiche déjà l'événement : on la prévient pour qu'elle se mette à jour
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach(c => { try { c.postMessage({ type: 'push', data: d }); } catch (err) { /* ignore */ } });
    await self.registration.showNotification(d.title || 'Harmonies', {
      body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', tag: d.tag || 'harmonies', renotify: true, data: { url: d.url || './' },
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => 'focus' in x);
    if (c) { try { c.postMessage({ type: 'open', url: target }); } catch (err) { /* ignore */ } return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
