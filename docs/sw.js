// 表情小鎮 service worker：離線可玩。版本號是內容雜湊，內容一變快取就換新。
const VERSION = '4059850419';
const CACHE = 'emojitown-' + VERSION;
const ASSETS = ["./","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","icons/favicon-32.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('emojitown-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 新版本裝好後先等著，玩家按「更新」才接手（不會在玩到一半被換掉）
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
