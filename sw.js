// Service worker: guarda la app en el teléfono para usarla sin conexión y muestra los avisos de llegada.
// Cambia VERSION en cada publicación para que los teléfonos descarguen la nueva versión.
const PREFIX = 'import-business-';
const VERSION = PREFIX + 'v1.0.0';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/core.js',
  'js/store.js',
  'js/sync.js',
  'js/ui.js',
  'js/icons.js',
  'js/orders.js',
  'js/remit.js',
  'js/money.js',
  'js/closure.js',
  'js/settings.js',
  'fonts/roboto-latin-400-normal.woff2',
  'fonts/roboto-latin-500-normal.woff2',
  'fonts/roboto-latin-700-normal.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)));
});

// Solo borra cachés antiguas de esta app (otras apps de marcoh03.github.io comparten el mismo origen).
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        return fetch(req)
          .then((res) => {
            if (res.ok && !req.url.endsWith('.pdf') && !req.url.includes('/preview/')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
      }),
    ),
  );
});

/* ---------- avisos con la app cerrada (Android, si el navegador lo permite) ---------- */
function idb(key, value) {
  return new Promise((resolve) => {
    const r = indexedDB.open('import-business', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => resolve(undefined);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('kv', value === undefined ? 'readonly' : 'readwrite');
      const st = tx.objectStore('kv');
      const q = value === undefined ? st.get(key) : st.put(value, key);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => resolve(undefined);
    };
  });
}
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
async function showDue() {
  const local = await idb('local');
  if (!local?.notify || Notification.permission !== 'granted') return;
  const list = (await idb('reminders')) || [];
  const done = new Set((await idb('notified')) || []);
  const t = todayStr();
  for (const r of list.filter((x) => x.date <= t && !done.has(x.key)).slice(0, 5)) {
    await self.registration.showNotification(r.title, { body: r.body, tag: r.key, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' } });
    done.add(r.key);
  }
  await idb('notified', [...done].slice(-400));
}
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'ib-avisos') e.waitUntil(showDue());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    }),
  );
});
