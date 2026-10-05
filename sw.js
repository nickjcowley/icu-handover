// ICU Handover service worker.
// Keeps an offline copy of the app (network first, so updates arrive straight away)
// and receives an XML export shared to the installed app on Android. Patient data is never cached:
// a shared file is held only until the app picks it up, then deleted.
const CACHE = 'icuho-app-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('icuho-app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')){
    e.respondWith((async () => {
      let got = 'nofile';
      try {
        const form = await e.request.formData();
        for (const [, v] of form.entries()){
          if (v && typeof v === 'object' && 'size' in v && v.size){
            const c = await caches.open('icuho-shared');
            await c.put('shared-file', new Response(v, {headers: {'X-Name': encodeURIComponent(v.name || 'shared.xml'), 'X-Modified': String(v.lastModified || Date.now())}}));
            got = 'file'; break;
          }
        }
      } catch (err) { got = 'error'; }
      return Response.redirect('./?shared=' + got, 303);
    })());
    return;
  }
  // only the app's own files are cached, never anything else
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.includes('/icu-handover/') || url.pathname.endsWith('version.json')) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
});
