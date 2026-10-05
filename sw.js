// Service worker : copie de l'app pour l'ouvrir sans réseau, et réception des notifications push.
// Fichiers de l'app : « réseau d'abord » (toujours la dernière version quand c'est possible).
// Bibliothèque Supabase (CDN, version figée) : « cache d'abord ».
// Les appels à Supabase ne passent jamais par le cache.
const CACHE = 'mon-alternance-v3';
const FICHIERS = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'js/main.js',
  'js/config.js',
  'js/cloud.js',
  'js/ui.js',
  'js/icons.js',
  'js/dates.js',
  'js/store.js',
  'js/subjects.js',
  'js/calendar.js',
  'js/courses.js',
  'js/deadlines.js',
  'js/tasks.js',
  'js/views/today.js',
  'js/views/echeances.js',
  'js/views/agenda.js',
  'js/views/taches.js',
  'js/views/sheets.js',
  'js/views/conges.js',
  'js/views/reglages.js',
  'js/views/plus.js',
  'js/views/connexion.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(FICHIERS.map((f) => cache.add(f).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.href.startsWith(CDN)) {
    event.respondWith(
      caches.match(req).then((trouve) => trouve || fetch(req).then((rep) => {
        if (rep.ok) {
          const copie = rep.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copie));
        }
        return rep;
      })),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((rep) => {
        if (rep.ok) {
          const copie = rep.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copie));
        }
        return rep;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

// ---------- Notifications push ----------

self.addEventListener('push', (event) => {
  let message = { titre: 'Mon Alternance', texte: '' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    if (event.data) message.texte = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(message.titre, {
    body: message.texte,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: message.tag,
    data: { url: message.url || '#/aujourdhui' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = event.notification.data?.url || '#/aujourdhui';
  const cible = new URL(hash, self.registration.scope).href;
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of fenetres) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        client.postMessage({ type: 'ouvrir', hash });
        return;
      }
    }
    await self.clients.openWindow(cible);
  })());
});
