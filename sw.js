/* Seite: Netz zuerst, damit neue Versionen sofort ankommen; der Cache springt nur ohne Verbindung ein.
   Modell und Laufzeit (über 50 MB) ändern sich nicht und kommen zuerst aus dem Cache. */
const CACHE = "hausprobe-v3";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
);
function put(req, res) {
  if (res.ok && res.status === 200) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (/^\/(models|vendor)\//.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => put(e.request, res))));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => put(e.request, res))
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
