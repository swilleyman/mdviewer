/* MD Viewer service worker: offline cache + Android share target. Bump VERSION when releasing. */
const VERSION = 'v1';
const CACHE = 'mdviewer-' + VERSION;
const SHARE_CACHE = 'mdviewer-share';

const SHELL = [
  './', './index.html', './styles.css', './md.css', './app.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css',
];
const CDN_HOSTS = new Set(CDN.map((u) => new URL(u).host));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await Promise.all(CDN.map((u) => cache.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('mdviewer-') && key !== CACHE && key !== SHARE_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN_HOSTS.has(url.host)) return; // e.g. documents opened from URL: always live

  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(new Request(new URL('./index.html', self.registration.scope)), event));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, event));
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: new URL(req.url).origin === location.origin });
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
}

async function handleShare(req) {
  let payload = { name: 'Shared.md', text: '' };
  try {
    const form = await req.formData();
    const file = form.get('file');
    const title = String(form.get('title') || '').trim();
    const text = String(form.get('text') || '');
    const link = String(form.get('url') || '').trim() || (/^\s*https?:\/\/\S+\s*$/.test(text) ? text.trim() : '');
    if (file && typeof file !== 'string' && file.size) payload = { name: file.name || 'Shared.md', text: await file.text() };
    else if (link) payload = { url: link };
    else payload = { name: (title || 'Shared').replace(/[\\/:*?"<>|]/g, '') + '.md', text };
  } catch { /* fall through with empty doc */ }
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(new URL('__share__', self.registration.scope).href,
    new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }));
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}
