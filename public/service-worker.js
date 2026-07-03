// service-worker.js
// Minimal offline-capable shell caching. Keeps the app installable and lets
// it open even with a flaky connection. It intentionally does NOT cache the
// shared database calls (window.storage) — those always need a live network
// hit so users see current reports.

const CACHE_NAME = "casefile-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Never cache API/storage calls — always go to network for live data
  if (event.request.url.includes("/api/") || event.request.method !== "GET") {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
