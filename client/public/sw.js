const CACHE_NAME = "agrocylo-v2";
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  "/",
  OFFLINE_URL,
  "/favicon.svg",
  "/icon-192x192.svg",
  "/icon-512x512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        // Precache failure is non-fatal — app still works online.
        // Offline fallback may not be available on first install.
        console.warn("SW: precache skipped some resources");
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Network failed — try to serve the cached offline page.
        // caches.open() or cache.match() may themselves reject (e.g. storage
        // quota exceeded, private-browsing restrictions). We also guard the
        // case where cache.match() resolves to `undefined` (cache miss), which
        // is NOT a rejection and therefore cannot be caught with .catch().
        return caches
          .open(CACHE_NAME)
          .then((cache) => cache.match(OFFLINE_URL))
          .then((cached) => {
            if (cached instanceof Response) {
              return cached;
            }
            // Cache miss or evicted entry — return a minimal readable fallback.
            return new Response(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline</title></head>' +
                "<body><h1>You are offline</h1><p>Please check your connection and try again.</p></body></html>",
              {
                status: 503,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              },
            );
          })
          .catch(() => {
            // Cache open/read itself failed — return the same minimal fallback.
            return new Response(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offline</title></head>' +
                "<body><h1>You are offline</h1><p>Please check your connection and try again.</p></body></html>",
              {
                status: 503,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              },
            );
          });
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Agrocylo Global";
  const options = {
    body: data.body || "You have a new notification.",
    icon: "/icon-192x192.svg",
    badge: "/favicon.svg",
    data: data.url || "/",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data));
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-updates") {
    console.log("Syncing in background");
  }
});
