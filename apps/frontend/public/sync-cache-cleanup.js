// Older releases cached signed/private GET responses in Workbox's default runtime cache.
// Delete that cache for this registration only; Dexie and precached app files are retained.
self.addEventListener('activate', event => {
  event.waitUntil(caches.delete(`workbox-runtime-${self.registration.scope}`));
});
