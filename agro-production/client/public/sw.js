const CACHE_NAME = "agro-production-shell-v1";
const PRECACHE_URLS = ["/offline", "/icons/agro-production.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("agro-production-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match("/offline")) || Response.error(),
    ));
    return;
  }

  // Never cache application data, auth, websocket, wallet, or transaction routes.
  if (/^\/(api|auth|wallet|rpc|transactions|orders|portfolio)(\/|$)/i.test(url.pathname)) return;

  // Cache only immutable Next build assets and the app icon; HTML and dynamic data stay network-only.
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icons/agro-production.svg") {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
  }
});
