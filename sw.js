/* 오프라인용: 사이트 파일을 이 기기에 저장해 두고, 인터넷이 없으면 저장된 것으로 열기
 * (인터넷이 있으면 항상 최신 파일을 받아서 저장본을 갱신) */
const CACHE = 'sat-bank-v4';
const CORE = [
  './', './index.html', './css/app.css', './css/bluebook.css',
  './js/firebase-config.js', './js/db.js', './js/parser.js', './js/calc.js', './js/vocab.js', './js/wrong.js', './js/croptool.js', './js/exam.js', './js/app.js',
  './js/vendor/pdf.min.js', './js/vendor/pdf.worker.min.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
  './js/vendor/firebase/firebase-app-compat.js', './js/vendor/firebase/firebase-auth-compat.js', './js/vendor/firebase/firebase-firestore-compat.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Firebase 등 다른 서버 요청은 건드리지 않음
  // 기본 문제 파일(약 10MB)은 저장본을 바로 쓰고, 뒤에서 새로 받아 갱신
  if (url.pathname.endsWith('/data/bank.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = (await cache.match('./index.html', { ignoreSearch: true })) || (await cache.match('./', { ignoreSearch: true }));
        if (page) return page;
      }
      throw err;
    }
  })());
});
