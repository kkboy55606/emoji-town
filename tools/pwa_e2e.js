// PWA 端對端驗證：用真的 Chrome（無頭）跑 service worker。需要先 node tools/build_pwa.js。
// 用法：node tools/pwa_e2e.js            （Chrome 路徑可用環境變數 CHROME 指定）
// 驗證：① 註冊並啟用 ② 預先快取 ③ 不重載頁面 ④ 伺服器關掉後離線仍能開、存檔還在 ⑤ 換版時出現更新提示、按下去後換新快取並清掉舊的
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREFIX = '/emoji-town/';                      // 模擬 GitHub Pages 專案網址的子路徑
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

// ---- 小型靜態伺服器（可關可開、可覆寫某個檔案的內容）----
const overrides = {};
function serve(port) {
  const s = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith(PREFIX)) { res.writeHead(404); return res.end('not found'); }
    let rel = u.slice(PREFIX.length) || 'index.html'; if (rel.endsWith('/')) rel += 'index.html';
    const body = overrides[rel] != null ? Buffer.from(overrides[rel]) : (fs.existsSync(path.join(root, 'docs', rel)) ? fs.readFileSync(path.join(root, 'docs', rel)) : null);
    if (!body) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
  return new Promise(r => s.listen(port, '127.0.0.1', () => r(s)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const PORT = 8774, DBG = 9334, results = [];
  const check = (name, ok, extra) => { results.push(ok); console.log(ok ? '  ✓' : '  ✗', name, extra || ''); };
  let server = await serve(PORT);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-e2e-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + userDir, '--no-first-run', '--disable-gpu', '--window-size=420,860', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await getJSON(`http://127.0.0.1:${DBG}/json/version`); break; } catch (e) { await sleep(200); } }
    const target = (await getJSON(`http://127.0.0.1:${DBG}/json/list`)).find(t => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pend = {}; const events = [];
    ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else events.push(d); });
    const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)); return r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    const nav = async url => { events.length = 0; await send('Page.navigate', { url }); for (let i = 0; i < 100; i++) { await sleep(100); if (events.some(e => e.method === 'Page.loadEventFired')) break; } await sleep(300); };
    const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;

    console.log('PWA 端對端（真的 Chrome）');
    await nav(BASE);
    const firstLoadId = await ev('window.__bootId = Math.random(); window.__bootId');
    // ① 註冊並啟用 ② 預先快取
    let st = null;
    for (let i = 0; i < 50; i++) { st = await ev(`(async()=>{const r=await navigator.serviceWorker.getRegistration();const k=await caches.keys();return {active:!!(r&&r.active),state:r&&r.active&&r.active.state,scope:r&&r.scope,keys:k,n:k.length?(await (await caches.open(k[0])).keys()).length:0,ctl:!!navigator.serviceWorker.controller}})()`); if (st.active && st.n >= 7) break; await sleep(200); }
    check('service worker 註冊並啟用，範圍在子路徑底下', st.active && st.state === 'activated' && st.scope === BASE, st.scope);
    check('預先快取了遊戲、manifest、圖示（7 項）', st.n === 7 && st.keys.length === 1 && /^emojitown-[0-9a-f]{10}$/.test(st.keys[0]), JSON.stringify(st.keys) + ' ' + st.n);
    // ③ 第一次安裝不重載
    await sleep(1500);
    check('第一次安裝時頁面沒有被重新載入', (await ev('window.__bootId')) === firstLoadId);
    // 存檔：改金幣、觸發存檔
    await ev(`window.__town.G.coins = 777; window.dispatchEvent(new Event('pagehide')); true`);
    // ④ 關掉伺服器，離線重載
    await new Promise(r => server.close(r));
    await nav(BASE);
    const off = await ev(`({ game: !!window.__town, coins: window.__town && window.__town.G.coins, title: document.title, ctl: !!navigator.serviceWorker.controller })`);
    check('伺服器關掉後重新載入，遊戲仍然能開（離線）', off.game && off.ctl && off.title === '表情小鎮', JSON.stringify(off));
    check('離線開啟後存檔還在（金幣 777 以上）', off.coins >= 777, String(off.coins));
    // ⑤ 換版：伺服器重開，sw.js 內容不同
    server = await serve(PORT);
    overrides['sw.js'] = fs.readFileSync(path.join(root, 'docs', 'sw.js'), 'utf8').replace(/const VERSION = '[0-9a-f]{10}'/, "const VERSION = 'aaaaaaaaaa'");
    await nav(BASE);
    await ev(`(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();return true})()`);
    let bar = false;
    for (let i = 0; i < 50; i++) { bar = await ev(`!!document.getElementById('updbar')`); if (bar) break; await sleep(200); }
    check('有新版本時出現「有新版本，點這裡更新」提示', bar);
    const beforeKeys = await ev(`caches.keys()`);
    check('新版本裝好後先等著（舊快取還在，不會玩到一半被換掉）', beforeKeys.length === 2, JSON.stringify(beforeKeys));
    const bootBefore = await ev('window.__bootId = Math.random(); window.__bootId');
    await ev(`document.getElementById('updbar').click(); true`);
    let after = null;
    for (let i = 0; i < 60; i++) { await sleep(250); try { after = await ev(`({ boot: window.__bootId || null, keys: null })`); } catch (e) { continue; } if (after && after.boot == null) break; }
    await sleep(800);
    const fin = await ev(`(async()=>({keys:await caches.keys(), ctl:!!navigator.serviceWorker.controller, game:!!window.__town, coins: window.__town && window.__town.G.coins}))()`);
    check('按下更新後重新載入，換成新快取並清掉舊的', fin.keys.length === 1 && fin.keys[0] === 'emojitown-aaaaaaaaaa' && fin.ctl, JSON.stringify(fin.keys));
    check('換版後存檔沒掉（金幣 777 以上）', fin.coins >= 777, String(fin.coins));
    ws.close();
  } catch (e) {
    console.log('  ✗ 例外：', e.message); results.push(false);
  } finally {
    chrome.kill(); server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { }
  }
  const okAll = results.length > 0 && results.every(Boolean);
  console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`);
  process.exit(okAll ? 0 : 1);
})();
