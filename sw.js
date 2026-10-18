// オフライン用 Service Worker。アプリ本体のファイルをキャッシュして、ネットがなくても起動できるようにする。
// ファイルを更新したら CACHE の番号を上げること。
const CACHE = 'raz-stamp-v2';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/db.js',
  'js/domain.js',
  'js/stamps.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 同じオリジンのファイルはキャッシュ優先。外部サイト（Raz-Kids へのリンクなど）には関与しない
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
