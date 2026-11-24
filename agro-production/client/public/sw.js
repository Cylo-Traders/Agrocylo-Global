const CACHE_NAME = "agro-production-shell-v1";
const MARKETPLACE_CACHE = "agro-production-marketplace-v1";
const PRECACHE_URLS = ["/offline", "/icons/agro-production.svg"];

// Public, read-only marketplace listing endpoints that are safe to cache.
const MARKETPLACE_LISTING_PATTERN = /^\/api\/marketplace\/(listings|products)(\/|$)/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("agro-production-") && key !== CACHE_NAME && key !== MARKETPLACE_CACHE)
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
    return;
  }

  // Public marketplace listings: network-first, fall back to cached copy when offline.
  // Responses are tagged so the client can distinguish cached/read-only data from fresh data.
  if (MARKETPLACE_LISTING_PATTERN.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(MARKETPLACE_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) {
          const headers = new Headers(response.headers);
          headers.set("X-Marketplace-Cache", "fresh");
          const tagged = new Response(await response.clone().blob(), {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
          await cache.put(request, tagged.clone());
          return tagged;
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set("X-Marketplace-Cache", "stale");
          return new Response(await cached.blob(), {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }
        throw error;
      }
    })());
  }
});
