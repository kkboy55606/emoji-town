// UI 冒煙測試：用真的 Chrome（無頭）載入開發版 index.html，跑一遍畫面流程。用法：node tools/ui_smoke.js
// 驗證：① 版面（手機尺寸 / 被拉很高的桌面視窗，分頁列一定在畫面內）② 冒險解鎖 ③ 鍛造 → 穿裝備 ④ 補給 ⑤ 招募 ⑥ 沙漠鎖定 ⑦ 英雄全滅顯示 ⑧ 全程沒有 JS 錯誤
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const PORT = 8776, DBG = 9336, results = [];
  const check = (name, ok, extra) => { results.push(ok); console.log(ok ? '  ✓' : '  ✗', name, ok ? '' : (extra || '')); };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]), rel = u === '/' ? 'index.html' : u.slice(1);
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-smoke-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + userDir, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await getJSON(`http://127.0.0.1:${DBG}/json/version`); break; } catch (e) { await sleep(200); } }
    const target = (await getJSON(`http://127.0.0.1:${DBG}/json/list`)).find(t => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pend = {}; const events = [];
    ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } else events.push(d); });
    const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
    const nav = async url => { events.length = 0; await send('Page.navigate', { url }); for (let i = 0; i < 100; i++) { await sleep(100); if (events.some(e => e.method === 'Page.loadEventFired')) break; } await sleep(400); };
    const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });

    console.log('UI 冒煙測試（真的 Chrome）');
    // ---- ① 版面：分頁列一定在畫面內 ----
    for (const [name, w, h, mobile, maxH] of [['手機 375×812', 375, 812, true, 812], ['手機 360×640', 360, 640, true, 640], ['桌面被拉很高 750×1624', 750, 1624, false, 800], ['一般桌面 1280×720', 1280, 720, false, 720]]) {
      await view(w, h, mobile); await nav(`http://127.0.0.1:${PORT}/index.html`);
      await ev(`localStorage.clear(); true`); await nav(`http://127.0.0.1:${PORT}/index.html`);
      const r = await ev(`(()=>{const b=document.getElementById('tabs').getBoundingClientRect();return {bottom:Math.round(b.bottom),h:innerHeight,sw:document.documentElement.scrollWidth,vw:innerWidth}})()`);
      check(`版面 ${name}：分頁列在畫面內、沒有橫向捲動`, r.bottom <= maxH && r.bottom > 0 && r.sw <= r.vw, JSON.stringify(r));
    }
    await view(375, 812, true); await nav(`http://127.0.0.1:${PORT}/index.html`);
    await ev(`document.querySelector('#modal [data-a="ok"]') && document.querySelector('#modal [data-a="ok"]').click(); true`);
    // ---- 準備：玩到冒險解鎖 ----
    const w = ms => sleep(ms);
    await ev(`(()=>{const {G}=window.__town; G.dex['wheat:2']=1; G.unlocked.merge=true; G.coins=2000; G.stats.earned=300;
      const give=(i,s,t)=>{G.board[i]={id:G.nextId++,s,t};}; give(0,'wood',1);give(1,'wood',1);give(2,'wood',2);give(3,'flower',1);give(4,'flower',1);give(5,'wheat',3);give(6,'apple',2);give(7,'wheat',2);G.ver++; return true})()`);
    await w(800);
    const un = await ev(`(()=>{const {G}=window.__town;return {quest:G.unlocked.quest,heroes:G.adv&&G.adv.heroes.length,tab:!document.querySelector('.tab[data-t="quest"]').classList.contains('lock')}})()`);
    check('② 冒險解鎖：分頁開放、送一位英雄', un.quest && un.heroes === 1 && un.tab, JSON.stringify(un));
    await ev(`document.querySelector('.tab[data-t="quest"]').click(); true`); await w(1500);
    const q = await ev(`({ on: document.querySelector('.tab.on').dataset.t, hasHeroCard: !!document.querySelector('#heroes .hero:not(.add)'), mobs: document.querySelectorAll('#mobs .mob').length, rest: !!document.querySelector('#mobs .rest'), dots: document.querySelectorAll('#stageDots i').length, areas: document.querySelectorAll('#areas .qarea').length })`);
    check('冒險頁：英雄卡、怪物（或休息中）、10 個關卡點、2 個區域按鈕', q.on === 'quest' && q.hasHeroCard && (q.mobs > 0 || q.rest) && q.dots === 10 && q.areas === 2, JSON.stringify(q));
    // ---- ③ 鍛造 → 穿裝備 ----
    const forge = await ev(`(async()=>{const {G}=window.__town; const sl=ms=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('bForge').click(); await sl(250); const rows=document.querySelectorAll('#modal .up').length; const c0=G.coins;
      document.querySelector('#modal [data-a="f:blade"]').click(); await sl(250);
      const out={rows,spent:c0-G.coins,blade:G.board.filter(it=>it&&it.s==='blade').length};
      document.querySelector('#modal [data-a="close"]').click(); await sl(200); return out})()`);
    check('③ 鍛造：3 種配方、扣 💰40、盤上多一把 🔪', forge.rows === 3 && forge.spent === 40 && forge.blade === 1, JSON.stringify(forge));
    const eq = await ev(`(async()=>{const {G}=window.__town; const sl=ms=>new Promise(r=>setTimeout(r,ms));
      const h=G.adv.heroes[0], atk0=window.__town.ET.heroStats(G,h).atk;
      document.querySelector('#heroes .hero:not(.add)').click(); await sl(250);
      const cand=document.querySelectorAll('#modal .cand').length;
      document.querySelector('#modal [data-a="eq:weapon:1"]').click(); await sl(250);
      const out={cand,weapon:h.gear.weapon&&h.gear.weapon.s+h.gear.weapon.t,atkUp:window.__town.ET.heroStats(G,h).atk-atk0,gearIcon:document.querySelector('#modal .slotrow .gn')&&document.querySelector('#modal .slotrow .gn').textContent.includes('小刀')};
      document.querySelector('#modal [data-a="close"]').click(); await sl(200); return out})()`);
    check('英雄視窗：列出盤上的武器、點一下穿上、攻擊 +5', eq.cand === 1 && eq.weapon === 'blade1' && Math.abs(eq.atkUp - 5) < 0.01 && eq.gearIcon, JSON.stringify(eq));
    // ---- ④ 補給 ----
    const food = await ev(`(async()=>{const {G}=window.__town; const sl=ms=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('bFood').click(); await sl(250); const rows=document.querySelectorAll('#modal [data-a^="pk:"]').length;
      document.querySelector('#modal [data-a^="pk:"]').click(); await sl(250);
      const out={rows,queued:G.adv.food.queue.length}; await sl(1300); out.act=!!G.adv.food.act;
      document.querySelector('#modal [data-a="close"]').click(); await sl(200); return out})()`);
    check('④ 補給：列出 3 種料理、放進去後生效', food.rows === 3 && food.act, JSON.stringify(food));
    // ---- ⑤ 招募 ----
    const rec = await ev(`(async()=>{const {G}=window.__town; const sl=ms=>new Promise(r=>setTimeout(r,ms));
      const n0=G.adv.heroes.length; document.getElementById('bRecruit').click(); await sl(250); const rows=document.querySelectorAll('#modal [data-a^="r:"]').length;
      document.querySelector('#modal [data-a="r:knight"]').click(); await sl(350);
      return {rows,n0,n1:G.adv.heroes.length,closed:!document.getElementById('modal').classList.contains('on'),cards:document.querySelectorAll('#heroes .hero:not(.add)').length}})()`);
    check('⑤ 招募：列出 4 個職業、招到騎士、視窗關閉、多一張英雄卡', rec.rows === 4 && rec.n1 === rec.n0 + 1 && rec.closed && rec.cards === 2, JSON.stringify(rec));
    // ---- ⑥ 沙漠鎖定 ----
    const lock = await ev(`(async()=>{const {G}=window.__town; const sl=ms=>new Promise(r=>setTimeout(r,ms));
      document.querySelector('.qarea[data-a="2"]').click(); await sl(200);
      return {area:G.adv.area,toast:document.getElementById('toast').textContent,lockCls:document.querySelector('.qarea[data-a="2"]').classList.contains('lock')}})()`);
    check('⑥ 沙漠鎖定：點了不會切過去，提示要先打倒 Boss', lock.area === 1 && /Boss/.test(lock.toast) && lock.lockCls, JSON.stringify(lock));
    // ---- ⑦ 全滅顯示 ----
    const down = await ev(`(async()=>{const {G,ET}=window.__town; const sl=ms=>new Promise(r=>setTimeout(r,ms));
      G.adv.open[2]=true; ET.advGo(G,2); G.adv.stage=10; G.adv.battle=null; G.adv.recover=0;
      for(let i=0;i<40&&G.adv.stats.defeats===0;i++){ET.advTick(G,1);} await sl(500);
      return {defeats:G.adv.stats.defeats,rest:!!document.querySelector('#mobs .rest'),downCards:document.querySelectorAll('#heroes .hero.down').length,info:document.getElementById('qInfo').textContent}})()`);
    check('⑦ 全滅：英雄卡變灰、顯示「休息中 / 幾秒後復活」', down.defeats >= 1 && down.rest && down.downCards >= 1 && /復活/.test(down.info), JSON.stringify(down));
    // ---- 其他分頁都能正常顯示 ----
    const tabs = await ev(`(async()=>{const sl=ms=>new Promise(r=>setTimeout(r,ms)); const res=[]; for(const t of ['garden','merge','shop','quest']){document.querySelector('.tab[data-t="'+t+'"]').click(); await sl(250); res.push(t+':'+(document.querySelector('.tab.on').dataset.t===t && !document.getElementById('v-'+t).hidden));} return res})()`);
    check('四個分頁都能切換並顯示', tabs.every(x => x.endsWith(':true')), tabs.join(' '));
    // ---- ⑧ 沒有 JS 錯誤 ----
    const errs = events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/favicon/.test(e.params.entry.text + (e.params.entry.url || ''))));
    check('⑧ 全程沒有 JavaScript 錯誤', errs.length === 0, errs.length ? JSON.stringify(errs[0]).slice(0, 300) : '');
    ws.close();
  } catch (e) { console.log('  ✗ 例外：', e.message); results.push(false); }
  finally { chrome.kill(); server.close(); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { } }
  console.log(`\n${results.filter(Boolean).length}/${results.length} 通過`);
  process.exit(results.length && results.every(Boolean) ? 0 : 1);
})();
