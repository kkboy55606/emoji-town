// 打包成 PWA（給 GitHub Pages 的 /docs 用）。用法：
//   node tools/build_pwa.js            → 含 S3 冒險（預設）
//   node tools/build_pwa.js --no-adv   → 不含冒險
// 產出 docs/：index.html（單檔，CSS / JS 全內嵌）、manifest.webmanifest、sw.js、icons/、.nojekyll
// 所有路徑都用相對路徑，因為 GitHub Pages 的網址是 https://帳號.github.io/專案名/（有子路徑）。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { root, bundle } = require('./bundle');
const withAdv = !process.argv.includes('--no-adv');
const { markup, css, js } = bundle(withAdv);

const out = path.join(root, 'docs');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

// ---- 圖示（pwa/icons 是原稿，用 Pillow 畫的 🏡） ----
const ICONS = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'];
for (const f of ICONS) fs.copyFileSync(path.join(root, 'pwa', 'icons', f), path.join(out, 'icons', f));

// ---- manifest ----
const manifest = {
  name: '表情小鎮', short_name: '表情小鎮', description: '種田、合成、開店的 emoji 放置遊戲',
  lang: 'zh-Hant', start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#fdf6e3', theme_color: '#fdf6e3',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
};
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2), 'utf8');

// ---- 註冊 service worker、更新提示、永久儲存（只在 http(s) 下作用；file:// 與 Artifact 版不含這段） ----
const pwaSnippet = `(function () {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  var reloading = false, hadController = !!navigator.serviceWorker.controller;
  // 只有「換版」才重新載入；第一次安裝時 service worker 接手不需要重載
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }
    if (reloading) return; reloading = true; location.reload();
  });
  function banner(reg) {
    if (document.getElementById('updbar')) return;
    var b = document.createElement('button');
    b.id = 'updbar'; b.textContent = '🔄 有新版本，點這裡更新';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 8px);z-index:100;background:#ff9f43;color:#3a2300;border:0;border-radius:999px;padding:10px 18px;font:700 14px system-ui,sans-serif;box-shadow:0 4px 14px #0004;cursor:pointer';
    b.onclick = function () { b.textContent = '更新中…'; if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); else location.reload(); };
    document.body.appendChild(b);
  }
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    if (reg.waiting && navigator.serviceWorker.controller) banner(reg);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing; if (!w) return;
      w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) banner(reg); });
    });
    var check = function () { try { reg.update(); } catch (e) {} };
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(function () {});
  // 申請「永久儲存」：存檔比較不容易被瀏覽器清掉（已安裝的 PWA 通常會被允許）
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
})();`;

// ---- index.html ----
const indexHtml = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>表情小鎮</title>
<meta name="theme-color" content="#fdf6e3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1d1a14" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="表情小鎮">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>
${css}
</style>
</head>
<body>
${markup}
<script>
${js}
</script>
<script>
${pwaSnippet}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), indexHtml, 'utf8');

// ---- service worker：版本號 = 內容雜湊（內容一變，快取就換新；舊快取在啟用時清掉） ----
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', ...ICONS.map(f => 'icons/' + f)];
const h = crypto.createHash('sha1');
h.update(indexHtml); h.update(JSON.stringify(manifest));
for (const f of ICONS) h.update(fs.readFileSync(path.join(out, 'icons', f)));
const version = h.digest('hex').slice(0, 10);
const sw = `// 表情小鎮 service worker：離線可玩。版本號是內容雜湊，內容一變快取就換新。
const VERSION = '${version}';
const CACHE = 'emojitown-' + VERSION;
const ASSETS = ${JSON.stringify(ASSETS)};
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
`;
fs.writeFileSync(path.join(out, 'sw.js'), sw, 'utf8');
fs.writeFileSync(path.join(out, '.nojekyll'), '', 'utf8');      // 不要讓 GitHub Pages 用 Jekyll 處理

const kb = f => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB';
console.log(`docs/ 已產生：index.html ${kb('index.html')}、sw.js（版本 ${version}）、manifest、${ICONS.length} 個圖示　${withAdv ? '含冒險' : '不含冒險'}`);
