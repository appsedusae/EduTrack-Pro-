/* sw.js — service worker E-Agenda: cangkang aplikasi disimpan agar terbuka instan & tetap tampil saat offline.
   Panggilan API ke script.google.com dan berkas Google lain TIDAK disentuh (selalu langsung ke jaringan). */
const VERSI = 'ea-1.0.0';
const V = '?v=1.0.0';
const CANGKANG = [
  './', 'index.html', 'verifikasi.html', 'manifest.webmanifest',
  'css/style.css' + V, 'js/config.js' + V, 'js/inti.js' + V, 'js/data.js' + V, 'js/ui.js' + V, 'js/grafik.js' + V,
  'js/ekspor.js' + V, 'js/hal-utama.js' + V, 'js/hal-admin.js' + V, 'js/app.js' + V,
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSI).then((c) => Promise.allSettled(CANGKANG.map((u) => c.add(new Request(u, { cache: 'reload' }))))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((daftar) => Promise.all(daftar.filter((k) => k !== VERSI).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'lewati') self.skipWaiting(); });

/** Jaringan dulu (maks 4 detik), lalu cadangan dari cache — untuk halaman & config.js. */
async function jaringanDulu(req, cadangan) {
  const cache = await caches.open(VERSI);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, tolak) => setTimeout(() => tolak(new Error('lambat')), 4000))]);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || (cadangan && (await cache.match(cadangan))) || Response.error();
  }
}

/** Cache dulu, segarkan di latar (stale-while-revalidate) — untuk CSS/JS/ikon/pustaka. */
async function cacheDulu(e, req) {
  const cache = await caches.open(VERSI);
  const ada = await cache.match(req);
  const segar = fetch(req).then((res) => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
  if (ada) { e.waitUntil(segar); return ada; }
  return (await segar) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(jaringanDulu(req, /verifikasi\.html$/.test(url.pathname) ? 'verifikasi.html' : 'index.html'));
    return;
  }
  if (/\/js\/config\.js$/.test(url.pathname)) { e.respondWith(jaringanDulu(req)); return; }
  e.respondWith(cacheDulu(e, req));
});
