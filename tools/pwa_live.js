// 對「正式網址」做 PWA 驗證（真的 Chrome，無頭）。用法：node tools/pwa_live.js https://帳號.github.io/專案名/
// 驗證：HTTPS 下 service worker 註冊並啟用、預先快取、manifest 與圖示都抓得到、可安裝條件、遊戲本體能跑。
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { spawn } = require('child_process');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = process.argv[2];
if (!URL_) { console.log('用法：node tools/pwa_live.js <網址>'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const DBG = 9335, results = [];
  const check = (name, ok, extra) => { results.push(ok); console.log(ok ? '  ✓' : '  ✗', name, extra || ''); };
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-live-'));
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
    events.length = 0; await send('Page.navigate', { url: URL_ });
    for (let i = 0; i < 150; i++) { await sleep(100); if (events.some(e => e.method === 'Page.loadEventFired')) break; }
    await sleep(500);
    console.log('正式網址 PWA 驗證：' + URL_);
    const page = await ev(`({ https: location.protocol === 'https:', secure: isSecureContext, title: document.title, game: !!window.__town, coins: window.__town && window.__town.G.coins, plots: window.__town && window.__town.G.plots.length })`);
    check('HTTPS、安全環境，遊戲本體正常啟動', page.https && page.secure && page.game && page.title === '表情小鎮', JSON.stringify(page));
    let st = null;
    for (let i = 0; i < 60; i++) { st = await ev(`(async()=>{const r=await navigator.serviceWorker.getRegistration();const k=await caches.keys();return {active:!!(r&&r.active),state:r&&r.active&&r.active.state,scope:r&&r.scope,keys:k,n:k.length?(await (await caches.open(k[0])).keys()).length:0}})()`); if (st.active && st.n >= 7) break; await sleep(250); }
    check('service worker 註冊並啟用', st.active && st.state === 'activated' && st.scope === URL_, st.scope);
    check('預先快取 7 項（遊戲、manifest、圖示）', st.n === 7 && st.keys.length === 1, JSON.stringify(st.keys) + ' ' + st.n);
    const man = await ev(`(async()=>{const l=document.querySelector('link[rel=manifest]');const r=await fetch(l.href);const m=await r.json();const icons=[];for(const i of m.icons){const x=await fetch(new URL(i.src,l.href));icons.push([i.sizes,x.status,x.headers.get('content-type')]);}const a=await fetch(document.querySelector('link[rel=apple-touch-icon]').href);return {ok:r.ok,name:m.name,display:m.display,start:m.start_url,icons,apple:a.status};})()`);
    check('manifest 抓得到、standalone、圖示（192 / 512 / apple-touch）都是 200 的 PNG', man.ok && man.display === 'standalone' && man.icons.length === 2 && man.icons.every(i => i[1] === 200 && /png/.test(i[2])) && man.apple === 200, JSON.stringify(man));
    const err = events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
    check('載入過程沒有 JavaScript 錯誤', err.length === 0, err.length ? JSON.stringify(err[0]).slice(0, 200) : '');
    // 存檔寫入 / 讀回（在這個全新的瀏覽器設定檔裡）
    await ev(`window.__town.G.coins = 321; window.dispatchEvent(new Event('pagehide')); true`);
    events.length = 0; await send('Page.reload'); for (let i = 0; i < 150; i++) { await sleep(100); if (events.some(e => e.method === 'Page.loadEventFired')) break; } await sleep(500);
    const coins = await ev(`window.__town && window.__town.G.coins`);
    check('重新載入後存檔還在（localStorage）', coins >= 321, String(coins));
    ws.close();
  } catch (e) { console.log('  ✗ 例外：', e.message); results.push(false); }
  finally { chrome.kill(); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { } }
  console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`);
  process.exit(results.length && results.every(Boolean) ? 0 : 1);
})();
