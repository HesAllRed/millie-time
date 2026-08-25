// App-shell cache.
//
// Bump CACHE_VERSION on every release. Cloudflare serves this file with
// Cache-Control: no-cache (see _headers) so the browser always revalidates it —
// which is the whole reason this project is on Cloudflare Pages rather than
// GitHub Pages, where you get no header control at all.
//
// If this ever ships broken: a standalone PWA has no reload button, so three
// taps on the version stamp in the footer clears every cache and hard-reloads.

const CACHE_VERSION = "millie-v1.0.5";

const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.webmanifest",
  "./js/main.js",
  "./js/config.js",
  "./js/state.js",
  "./js/dates.js",
  "./js/exif.js",
  "./js/compose.js",
  "./js/media.js",
  "./js/print.js",
  "./js/share.js",
  "./js/ui.js",
  "./js/views/intake.js",
  "./js/views/sort.js",
  "./js/views/deck.js",
  "./js/views/send.js",
  "./js/views/debug.js",
  "./fonts/bricolage.woff2",
  "./fonts/fraunces.woff2",
  "./fonts/caveat.woff2",
  "./fonts/jetmono.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(SHELL.map((url) =>
      // `cache: "reload"` bypasses the HTTP cache entirely. Without it a fresh
      // service worker can bake a *stale* file into a brand-new cache version —
      // the update looks applied, the version stamp ticks over, and the actual
      // change is nowhere to be seen. Individually, so one missing icon can't
      // fail the whole install.
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE_VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations fall back to the cached shell so a cold launch works offline.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch (e) {
      return hit || Response.error();
    }
  })());
});
