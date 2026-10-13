// ICU Handover service worker.
// Keeps an offline copy of the app (network first, so updates arrive straight away)
// and receives an XML export shared to the installed app on Android. Patient data is never cached:
// a shared file is held only until the app picks it up, then deleted.
const CACHE = 'icuho-app-v5';
const SHELL = ['./', './index.html', './handover.webmanifest',
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
      let got = 'nofile'; const seen = []; let raw = null;
      const c = await caches.open('icuho-shared');
      try {
        // keep a copy of the raw upload in case the browser can't read it as a form
        raw = await e.request.clone().arrayBuffer().catch(() => null);
        seen.push({kind: 'request', type: e.request.headers.get('content-type') || '', bytes: raw ? raw.byteLength : null});
        const form = await e.request.formData();
        let file = null;
        for (const [k, v] of form.entries()){
          if (v && typeof v === 'object' && 'size' in v){ seen.push({kind: 'file', field: k, name: v.name || '', type: v.type || '', bytes: v.size}); if (!file && v.size) file = v; }
          else if (v) seen.push({kind: 'text', field: k, value: String(v).slice(0, 300)});
        }
        if (file){
          await c.put('shared-file', new Response(file, {headers: {'X-Name': encodeURIComponent(file.name || 'shared.xml'), 'X-Modified': String(file.lastModified || Date.now())}}));
          got = 'file';
        }
      } catch (err) {
        // the browser couldn't read the share: pull the file out of the raw upload directly
        got = 'error'; seen.push({kind: 'error', value: String(err && err.message || err)});
        try {
          const f = raw && parseMultipart(new Uint8Array(raw), e.request.headers.get('content-type') || '');
          if (f){ await c.put('shared-file', new Response(f.data, {headers: {'X-Name': encodeURIComponent(f.name || 'shared.xml'), 'X-Modified': String(Date.now())}})); seen.push({kind: 'file', field: 'raw', name: f.name, bytes: f.data.length}); got = 'file'; }
        } catch (e2) {}
      }
      await c.put('shared-info', new Response(JSON.stringify(seen)));
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

// Minimal multipart/form-data reader: returns the first part that carries a file.
function parseMultipart(u8, contentType){
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType); if (!m) return null;
  const enc = new TextEncoder(), dec = new TextDecoder('latin1');
  const bnd = enc.encode('--' + (m[1] || m[2]).trim());
  const find = (pat, from) => { outer: for (let i = from; i <= u8.length - pat.length; i++){ for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; } return -1; };
  let pos = find(bnd, 0);
  while (pos >= 0){
    const start = pos + bnd.length + 2, next = find(bnd, start); if (next < 0) break;
    const headEnd = find(enc.encode('\r\n\r\n'), start);
    if (headEnd > 0 && headEnd < next){
      const head = dec.decode(u8.subarray(start, headEnd));
      const fn = /filename\*?=(?:UTF-8'')?"?([^";\r\n]*)"?/i.exec(head);
      if (fn){ const data = u8.slice(headEnd + 4, next - 2); if (data.length){ let name = fn[1]; try { name = decodeURIComponent(name); } catch (e) {} return {name, data}; } }
    }
    pos = next;
  }
  return null;
}
