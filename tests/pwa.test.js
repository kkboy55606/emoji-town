// 用法：node tests/pwa.test.js
// 先跑一次 tools/build_pwa.js，再檢查 docs/ 能不能直接放上 GitHub Pages（有子路徑）並被手機安裝成 PWA。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'tools', 'build_pwa.js')], { stdio: 'pipe' });
const docs = f => path.join(root, 'docs', f);
const text = f => fs.readFileSync(docs(f), 'utf8');

let pass = 0, fail = 0;
const pending = [];
const ok = name => { pass++; console.log('  ✓', name); };
const bad = (name, e) => { fail++; console.log('  ✗', name, '\n    ', e.message); };
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => ok(name), e => bad(name, e)));   // 非同步測試
    else ok(name);
  } catch (e) { bad(name, e); }
}
const pngSize = f => { const b = fs.readFileSync(docs(f)); assert.strictEqual(b.slice(1, 4).toString(), 'PNG', f + ' 不是 PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

console.log('PWA 打包（docs/）');
test('必要檔案都有，且有 .nojekyll', () => {
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']) assert.ok(fs.existsSync(docs(f)), '缺 ' + f);
});
test('index.html：有 manifest、apple 安裝標籤、service worker 註冊、遊戲本體', () => {
  const h = text('index.html');
  assert.ok(h.startsWith('<!doctype html>'));
  assert.ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(h));
  assert.ok(/rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/.test(h));
  assert.ok(/apple-mobile-web-app-capable/.test(h) && /viewport-fit=cover/.test(h));
  assert.ok(/serviceWorker\.register\('sw\.js'\)/.test(h), '註冊要用相對路徑 sw.js');
  assert.ok(/id="app"/.test(h) && /window\.__town/.test(h), '遊戲本體要在裡面');
  assert.ok(/navigator\.storage\.persist/.test(h), '要申請永久儲存');
});
test('回歸：不能有以 / 開頭的路徑（GitHub Pages 有子路徑 /專案名/，這種路徑會 404）', () => {
  const html = text('index.html'), sw = text('sw.js'), man = text('manifest.webmanifest');
  for (const [name, s] of [['index.html', html.replace(/<script>[\s\S]*?<\/script>/g, m => m.includes('serviceWorker') ? m : '')], ['manifest', man]]) {
    assert.ok(!/(?:href|src|start_url|scope)=?"?:?\s*"\/[^\/"]/.test(s), name + ' 有根目錄路徑');
  }
  assert.ok(!/(?:register|addAll|match|fetch)\(\s*['"]\/(?!\/)/.test(html + sw), '程式裡有根目錄路徑');
  const m = JSON.parse(man);
  assert.strictEqual(m.start_url, './'); assert.strictEqual(m.scope, './');
  for (const i of m.icons) assert.ok(!i.src.startsWith('/'), i.src);
});
test('預設打包含 S3 冒險（畫面與核心都在）', () => {
  const h = text('index.html');
  assert.ok(/id="v-quest"/.test(h) && /ET\.newAdv/.test(h) && /function renderQuest/.test(h) && /ET\.heroStats/.test(h));
  assert.ok(!/ET\.advCheck = function \(\) \{\}/.test(h), '不能是空殼版本');
});
test('第一次安裝不重載頁面（只有換版才重載）', () => {
  const h = text('index.html');
  assert.ok(/hadController/.test(h) && /if \(!hadController\)/.test(h), 'controllerchange 要判斷之前有沒有 controller');
});
test('index.html 不含外部資源（離線可玩、也不外洩）', () => {
  const h = text('index.html').replace(/https?:\/\/www\.w3\.org[^"']*/g, '');
  const m = h.match(/(?:src|href)="https?:\/\/[^"]+"/g);
  assert.ok(!m, '外部連結：' + (m || []).join(', '));
});
test('manifest 完整：名稱、standalone、192 / 512 圖示且檔案存在、尺寸正確', () => {
  const m = JSON.parse(text('manifest.webmanifest'));
  assert.strictEqual(m.display, 'standalone'); assert.ok(m.name && m.short_name && m.lang);
  assert.ok(/^#[0-9a-f]{6}$/i.test(m.theme_color) && /^#[0-9a-f]{6}$/i.test(m.background_color));
  const sizes = {};
  for (const i of m.icons) { const [w, h] = pngSize(i.src); assert.strictEqual(i.sizes, w + 'x' + h, i.src + ' 宣告尺寸與實際不符'); sizes[w] = i; assert.ok(/maskable/.test(i.purpose)); }
  assert.ok(sizes[192] && sizes[512], '要有 192 與 512');
  assert.deepStrictEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]); assert.deepStrictEqual(pngSize('icons/favicon-32.png'), [32, 32]);
});
test('sw.js：版本已填入、預先快取的檔案都存在、有 fetch 與更新（SKIP_WAITING）處理', () => {
  const s = text('sw.js');
  assert.ok(/const VERSION = '[0-9a-f]{10}'/.test(s), '版本號沒填');
  const assets = JSON.parse(s.match(/const ASSETS = (\[.*?\]);/)[1]);
  assert.ok(assets.includes('./') && assets.includes('index.html'));
  for (const a of assets) if (a !== './') assert.ok(fs.existsSync(docs(a)), '快取清單裡的 ' + a + ' 不存在');
  assert.ok(/addEventListener\('fetch'/.test(s) && /SKIP_WAITING/.test(s) && /caches\.delete/.test(s));
  assert.ok(!/self\.skipWaiting\(\);?\s*\}\);?\s*self\.addEventListener\('activate'/.test(s), 'install 時不可直接 skipWaiting（要等玩家按更新）');
});
test('版本號 = 內容雜湊：同內容重複打包結果相同', () => {
  const v1 = text('sw.js');
  execFileSync(process.execPath, [path.join(root, 'tools', 'build_pwa.js')], { stdio: 'pipe' });
  assert.strictEqual(text('sw.js'), v1);
});
test('頁面內的所有 <script> 語法正確', () => {
  const h = text('index.html'); let n = 0;
  for (const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) { new vm.Script(m[1]); n++; }
  assert.ok(n >= 2, 'script 區塊數 ' + n);
  new vm.Script(text('sw.js'));
});
test('service worker 邏輯：模擬安裝 / 啟用 / 抓取（快取優先、換版清舊快取、離線導覽回到首頁）', () => {
  const caches = {}; const log = [];
  const makeCache = name => caches[name] = caches[name] || { name, items: {}, async addAll(l) { for (const u of l) this.items[u] = 'cached:' + u; }, };
  const listeners = {};
  const ctx = {
    caches: {
      open: async n => makeCache(n), keys: async () => Object.keys(caches),
      delete: async n => { delete caches[n]; log.push('delete ' + n); return true; },
      match: async (req) => { const url = typeof req === 'string' ? req : req.url; for (const c of Object.values(caches)) { const k = Object.keys(c.items).find(x => url.endsWith(x === './' ? '/' : x)); if (k) return c.items[k]; } return undefined; }
    },
    self: { addEventListener: (t, f) => { listeners[t] = f; }, clients: { claim: async () => log.push('claim') }, skipWaiting: () => log.push('skipWaiting') },
    location: { origin: 'https://u.github.io' }, URL, Response: { error: () => 'ERR' }, fetch: async () => { throw new Error('offline'); }
  };
  caches['emojitown-old'] = { name: 'emojitown-old', items: {} };
  caches['other-app'] = { name: 'other-app', items: {} };
  vm.runInNewContext(text('sw.js'), ctx);
  const run = async (type, ev) => { let p; ev.waitUntil = x => { p = x; }; ev.respondWith = x => { p = x; }; listeners[type](ev); return p; };
  return (async () => {
    await run('install', {});
    assert.ok(Object.keys(caches).some(k => /^emojitown-[0-9a-f]{10}$/.test(k)), '安裝後有新快取');
    assert.ok(!log.includes('skipWaiting'), '安裝時不能自己接手');
    await run('activate', {});
    assert.ok(!caches['emojitown-old'] && caches['other-app'], '只清自己的舊快取，不碰別人的');
    assert.ok(log.includes('claim'));
    const r = await run('fetch', { request: { method: 'GET', url: 'https://u.github.io/emoji-town/index.html', mode: 'navigate' } });
    assert.strictEqual(r, 'cached:index.html', '命中快取（不連網）');
    const nav = await run('fetch', { request: { method: 'GET', url: 'https://u.github.io/emoji-town/?utm=1', mode: 'navigate' } });
    assert.ok(nav, '帶查詢字串的首頁也要能離線開');
    const other = listeners.fetch({ request: { method: 'GET', url: 'https://example.com/x', mode: 'cors' }, respondWith: () => { throw new Error('不該攔截別人的網站'); } });
    const post = listeners.fetch({ request: { method: 'POST', url: 'https://u.github.io/x', mode: 'cors' }, respondWith: () => { throw new Error('不該攔截 POST'); } });
    listeners.message({ data: 'SKIP_WAITING' }); assert.ok(log.includes('skipWaiting'), '玩家按更新才接手');
  })();
});

Promise.all(pending).then(() => {
  console.log(`\n${pass} 通過，${fail} 失敗`);
  process.exit(fail ? 1 : 0);
});
