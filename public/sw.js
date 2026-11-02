const CACHE = "daily-tracker-shell-v58";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./seed-history.js", "./achilles.html", "./manifest.webmanifest", "./icons/tracker.svg"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); }));
  }));
  self.clients.claim();
});
self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/") || event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(function (cached) {
    if (cached) return cached;
    return fetch(event.request).then(function (response) {
      if (response.ok && url.origin === location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    }).catch(function () { return cached; });
  }));
});
self.addEventListener("push", function (event) {
  let payload = { title: "A gentle check-in", body: "Add an entry whenever you’re ready. Even a partial log counts." };
  try { if (event.data) payload = Object.assign(payload, event.data.json()); } catch {}
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "./icons/tracker.svg",
    badge: "./icons/tracker.svg",
    tag: payload.tag || "daily-tracker-reminder",
    data: { url: "./index.html" },
    renotify: false
  }));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
    for (const client of windows) {
      if ("focus" in client) return client.focus();
    }
    return clients.openWindow("./index.html");
  }));
});

