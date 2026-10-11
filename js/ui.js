// UI：只負責畫面與輸入，所有規則都在 core.js。
(function () {
  'use strict';
  const ET = window.ET;
  const $ = s => document.querySelector(s);
  const KEY = 'emojitown.v1', PREF = 'emojitown.pref';
  const N = ET.COLS * ET.ROWS;

  let G = null, tab = 'garden', pref = { mute: 0 };
  let selId = null;            // 合成盤選取中的物品 id
  let drag = null, pg = null;  // 拖曳 / 花園滑動手勢
  let modalOpen = false;
  let DM = [];                 // 客人現在缺的東西（每個循環更新一次，花園 / 合成 / 商店都用它）

  // ---------- 儲存 ----------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function save() { if (G) lsSet(KEY, ET.save(G, Date.now())); }
  function loadPref() { try { const o = JSON.parse(lsGet(PREF)); if (o && typeof o === 'object') pref = Object.assign(pref, o); } catch (e) { } }
  function savePref() { lsSet(PREF, JSON.stringify(pref)); }

  // ---------- 音效 ----------
  let ac = null;
  function beep(f, d, type, g, f2) {
    if (pref.mute) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime, o = ac.createOscillator(), v = ac.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
      v.gain.setValueAtTime(g || .06, t); v.gain.exponentialRampToValueAtTime(.001, t + d);
      o.connect(v); v.connect(ac.destination); o.start(t); o.stop(t + d + .02);
    } catch (e) { }
  }
  const SND = {
    harvest: () => beep(520, .1, 'triangle', .05, 780),
    plant: () => beep(300, .07, 'sine', .04),
    boost: () => beep(660, .04, 'square', .02),
    merge: t => beep(400 + t * 90, .18, 'triangle', .07, 700 + t * 120),
    sell: () => beep(880, .1, 'sine', .05, 1320),
    buy: () => beep(500, .22, 'triangle', .06, 1000),
    unlock: () => beep(600, .35, 'triangle', .07, 1200),
    lose: () => beep(220, .4, 'sawtooth', .05, 110)
  };
  function vib(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }

  // ---------- 小工具 ----------
  const fmt = ET.fmt;
  const SER = ET.SERIES;
  const emoji = it => SER[it.s].tiers[it.t - 1];
  function fmtDur(s) {
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    if (h > 0) return `${h} 小時${m ? ' ' + m + ' 分' : ''}`;
    if (m > 0) return `${m} 分${s % 60 >= 10 ? ' ' + (s % 60) + ' 秒' : ''}`;
    return `${s} 秒`;
  }
  let toastT = 0, toastEl = null;
  function toast(t) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = t; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1800);
  }
  function floatAt(el, text, dy, cls) {
    if (!el) return;
    const r = el.getBoundingClientRect(), f = document.createElement('div');
    f.className = 'float' + (cls ? ' ' + cls : ''); f.textContent = text;
    f.style.left = (r.left + r.width / 2) + 'px'; f.style.top = (r.top + r.height / 2 + (dy || 0)) + 'px';
    $('#fx').appendChild(f); setTimeout(() => f.remove(), 950);
  }

  // ---------- Modal ----------
  function showModal(html, handler) {
    cancelDrag();
    const m = $('#modal'); m.innerHTML = `<div class="card">${html}</div>`; m.classList.add('on'); modalOpen = true;
    m.onclick = e => {
      if (e.target === m) { closeModal(); return; }
      const t = e.target.closest('[data-a]');
      if (t && !t.disabled && handler) handler(t.dataset.a, t);
    };
  }
  function closeModal() { const m = $('#modal'); m.classList.remove('on'); m.innerHTML = ''; m.onclick = null; modalOpen = false; }

  // ---------- 分頁 ----------
  let tabKey = '';
  function buildTabs() {
    const items = [
      { id: 'garden', emoji: '🌱', name: '花園' },
      { id: 'merge', emoji: '⚗️', name: '合成', locked: !G.unlocked.merge, need: '湊到兩個一樣的東西就解鎖' },
      { id: 'shop', emoji: '🏪', name: '商店', locked: !G.unlocked.shop, need: '合成出第一個 2 階物品（例如 🍞）就開張' },
      { id: 'quest', emoji: '⚔️', name: '冒險', locked: !G.unlocked.quest, need: '商店開張後，累計賺到 💰300 就開放' }
    ].concat(ET.LOCKED_TABS.map(t => Object.assign({ locked: true }, t)));
    $('#tabs').innerHTML = items.map(t =>
      `<button class="tab${t.locked ? ' lock' : ''}${tab === t.id ? ' on' : ''}" data-t="${t.id}"><b>${t.emoji}</b><small>${t.name}</small>${t.id === 'garden' || t.id === 'merge' || t.id === 'shop' || t.id === 'quest' ? '<i class="dot" hidden></i>' : ''}</button>`).join('');
    $('#tabs').querySelectorAll('.tab').forEach((el, i) => {
      el.onclick = () => {
        const t = items[i];
        if (t.locked) { toast('🔒 ' + t.name + '：' + t.need); return; }
        setTab(t.id);
      };
    });
  }
  function showView(id) { for (const v of ['garden', 'merge', 'shop', 'quest']) $('#v-' + v).hidden = v !== id; }
  function setTab(id) {
    cancelDrag();
    tab = id; selId = null;
    showView(id);
    buildTabs(); boardKey = ''; laneIds = ''; shelfSig = ''; advEls.areaSig = advEls.mobSig = advEls.heroSig = advEls.info = ''; renderBoard(true); renderShop(); renderQuest(); resize();
  }
  function hasPairUI() {
    const c = {};
    for (const it of G.board) { if (!it || it.t >= ET.MAXT) continue; const k = it.s + ':' + it.t; if ((c[k] = (c[k] || 0) + 1) >= 2) return true; }
    return false;
  }

  // ---------- 花園 ----------
  let plotEls = [], plotCache = [], seedKey = '';
  function buildPlots() {
    const n = G.plots.length, cols = n <= 12 ? 3 : n <= 20 ? 4 : 5;
    const el = $('#plots');
    el.style.setProperty('--cols', cols); el.style.setProperty('--rows', Math.ceil(n / cols));
    el.innerHTML = G.plots.map((_, i) => `<button class="plot empty" data-i="${i}"><span class="pe"></span><span class="pb"><i></i></span></button>`).join('');
    plotEls = Array.from(el.children); plotCache = []; resize();
  }
  function renderGarden() {
    if (plotEls.length !== G.plots.length) buildPlots();
    G.plots.forEach((pl, i) => {
      const el = plotEls[i]; let key, st = 'empty', f = 0;
      if (pl.crop) { f = Math.min(1, pl.p / ET.CROPS[pl.crop].time); st = f >= 1 ? 'ripe' : 'grow'; key = pl.crop + '|' + st + '|' + Math.floor(f * 25); } else key = 'e';
      if (plotCache[i] === key) return;
      plotCache[i] = key;
      el.className = 'plot ' + st + (el.classList.contains('pop') ? ' pop' : '');
      const pe = el.firstChild, bar = el.lastChild.firstChild;
      if (!pl.crop) { pe.textContent = ''; bar.style.width = '0'; return; }
      pe.textContent = f < 0.34 ? '🌱' : ET.CROPS[pl.crop].emoji;
      pe.style.setProperty('--s', f < 0.34 ? .8 : st === 'ripe' ? 1 : (.55 + .45 * f).toFixed(2));
      bar.style.width = (f * 100) + '%';
    });
    // 種子列
    const dmBy = {};
    for (const d of DM) dmBy[d.s] = d;
    const sk = G.selected + '|' + Object.keys(ET.CROPS).map(c => ET.cropOpen(G, c) ? 1 : 0).join('') + '|' + DM.map(d => d.s + d.short).join() + '|' + G.up.fert;
    if (sk !== seedKey) {
      seedKey = sk;
      $('#seeds').innerHTML = Object.keys(ET.CROPS).map(c => {
        const C = ET.CROPS[c], open = ET.cropOpen(G, c), dd = dmBy[C.series];
        return `<button class="seed${G.selected === c ? ' sel' : ''}${open ? '' : ' lock'}" data-c="${c}">${dd && open ? `<i class="need">客人要${dd.short > 0 ? ' +' + dd.short : ''}</i>` : ''}<b>${open ? C.emoji : '🔒'}</b><small>${open ? (G.up.fert > 0 ? C.time + ' → ' + ET.fmtSec(ET.cropSeconds(G, c)) : C.time) + ' 秒' : C.hint}</small></button>`;
      }).join('');
    }
    const ex = ET.expandCost(G), be = $('#bExpand');
    if (ex === Infinity) be.hidden = true;
    else { be.hidden = false; be.textContent = `➕ 擴建田地  💰${fmt(ex)}`; be.classList.toggle('off', G.coins < ex); }
    const ba = $('#bAll'), diff = G.plots.some(p => p.crop && p.crop !== G.selected) || G.plots.some(p => !p.crop);
    ba.hidden = !diff; ba.textContent = `🔄 全部種 ${ET.CROPS[G.selected].emoji}`;
    $('#boardInfo').textContent = `📦 合成盤 ${ET.count(G)}/${N}` + (ET.count(G) >= N ? '（滿了！作物收不進去）' : '');
  }

  // 花園手勢：點 = 種/收/加速；滑過去 = 連續種/收；長按 = 改種
  function applyPlot(i, boost) {
    const r = ET.tapPlot(G, i, { boost });
    if (r.act === 'plant') { const el = plotEls[i]; el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 320); plotCache[i] = null; }
    flush(); renderGarden();
  }
  const plotsEl = $('#plots');
  plotsEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.plot'); if (!el) return;
    const i = +el.dataset.i;
    try { plotsEl.setPointerCapture(e.pointerId); } catch (_) { }   // 滑鼠移出範圍也要收得到事件
    pg = { start: i, visited: new Set([i]), moved: false, lp: false };
    pg.timer = setTimeout(() => {
      if (!pg || pg.moved) return;
      pg.lp = true;
      const pl = G.plots[i];
      if (pl.crop && pl.crop !== G.selected) { if (ET.replace(G, i, G.selected)) { plotCache[i] = null; flush(); renderGarden(); } }
      else toast('長按可以改種：先在上面選另一種作物');
    }, 500);
  });
  plotsEl.addEventListener('pointermove', e => {
    if (!pg) return;
    const t = document.elementFromPoint(e.clientX, e.clientY), el = t && t.closest && t.closest('.plot');
    if (!el) return;
    const i = +el.dataset.i;
    if (pg.visited.has(i)) return;
    if (!pg.moved) { pg.moved = true; clearTimeout(pg.timer); applyPlot(pg.start, false); }
    pg.visited.add(i); applyPlot(i, false);
  });
  const endPlot = e => {
    if (!pg) return;
    clearTimeout(pg.timer);
    if (e.type === 'pointerup' && !pg.moved && !pg.lp) applyPlot(pg.start, true);
    pg = null;
  };
  addEventListener('pointerup', endPlot);        // 掛在 window：滑鼠在任何地方放開都收得到
  addEventListener('pointercancel', endPlot);
  $('#seeds').addEventListener('click', e => {
    const b = e.target.closest('.seed'); if (!b) return;
    const c = b.dataset.c;
    if (!ET.select(G, c)) { toast('🔒 ' + ET.CROPS[c].hint); return; }
    seedKey = ''; renderGarden();
  });
  $('#bExpand').addEventListener('click', () => {
    const r = ET.buyExpand(G);
    if (!r.ok) toast('💰 錢還不夠擴建');
    flush(); renderGarden(); renderTop();
  });
  $('#bAll').addEventListener('click', () => {
    if (ET.plantAll(G, G.selected) > 0) { plotCache = []; SND.plant(); }
    flush(); renderGarden();
  });

  // ---------- 合成盤 ----------
  let boardKey = '';
  function boardSig() { return G.ver + '|' + selId + '|' + (drag && drag.started ? drag.i : '') + '|' + DM.map(d => d.s + d.short).join(); }
  function renderBoard(force) {
    if (tab !== 'merge') return;
    const sig = boardSig();
    if (!force && sig === boardKey) return;
    if (drag && drag.started) return;
    boardKey = sig;
    const selIdx = selId == null ? -1 : G.board.findIndex(it => it && it.id === selId);
    if (selIdx < 0) selId = null;
    let h = '';
    const dmSet = new Set(DM.map(d => d.s));
    for (let i = 0; i < N; i++) {
      const it = G.board[i];
      const cls = ['cell'];
      if (i === selIdx) cls.push('sel');
      else if (selIdx >= 0 && it && ET.canMerge(G, selIdx, i)) cls.push('match');
      else if (it && dmSet.has(it.s)) cls.push('want');
      h += `<div class="${cls.join(' ')}" data-i="${i}">` + (it ? `<div class="item${it.t >= ET.MAXT ? ' max' : ''}" data-i="${i}">${emoji(it)}<span class="t">${it.t}</span></div>` : '') + '</div>';
    }
    $('#board').innerHTML = h;
    const sel = selIdx >= 0 ? G.board[selIdx] : null;
    $('#sellTxt').textContent = sel ? `💰 賣出 ${emoji(sel)}　+${fmt(ET.value(sel.s, sel.t))}` : '💰 把東西拖到這裡賣出';
  }
  const boardEl = $('#board'), sellEl = $('#sellzone');
  function cellIndexAt(x, y) { const t = document.elementFromPoint(x, y), c = t && t.closest && t.closest('.cell'); return c && boardEl.contains(c) ? +c.dataset.i : -1; }
  function overSell(x, y) { const t = document.elementFromPoint(x, y); return !!(t && t.closest && t.closest('#sellzone')); }
  function doMove(a, b) {
    const itA = G.board[a];
    const r = ET.moveItem(G, a, b);
    if (r.ok && r.kind === 'merge') { selId = null; vib(15); }
    else if (r.ok) selId = null;
    boardKey = ''; flush(); renderBoard(true); renderTop();
    return r;
  }
  function doSell(i) {
    selId = null; ET.sell(G, i); boardKey = ''; flush(); renderBoard(true); renderTop();
  }
  // 清掉拖曳狀態與殘影（切換分頁、開視窗、上一次沒正常結束時都要呼叫）
  function cancelDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    drag = null;
    document.querySelectorAll('.dragghost').forEach(g => g.remove());
    sellEl.classList.remove('over');
    boardKey = '';
  }
  boardEl.addEventListener('pointerdown', e => {
    cancelDrag();
    const cell = e.target.closest('.cell'); if (!cell) return;
    try { boardEl.setPointerCapture(e.pointerId); } catch (_) { }   // 滑鼠拖出盤面也要收得到 move / up
    const i = +cell.dataset.i, it = G.board[i];
    if (!it) {
      // 點空格：把選取的移過來
      if (selId != null) { const si = G.board.findIndex(q => q && q.id === selId); if (si >= 0) doMove(si, i); }
      return;
    }
    drag = { i, id: it.id, x: e.clientX, y: e.clientY, started: false, ghost: null };
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      drag.started = true;
      const it = G.board[drag.i];
      const g = document.createElement('div'); g.className = 'dragghost'; g.textContent = it ? emoji(it) : '';
      document.body.appendChild(g); drag.ghost = g;
      const c = boardEl.children[drag.i]; if (c) c.classList.add('dragging');
    }
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
    sellEl.classList.toggle('over', overSell(e.clientX, e.clientY));
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag; drag = null;
    sellEl.classList.remove('over');
    if (d.ghost) d.ghost.remove();
    const cur = G.board[d.i];
    if (d.started) {
      if (!cur || cur.id !== d.id) { boardKey = ''; renderBoard(true); return; }   // 拖的過程中盤面被自動化改了
      if (e.type === 'pointerup') {
        if (overSell(e.clientX, e.clientY)) { doSell(d.i); return; }
        const j = cellIndexAt(e.clientX, e.clientY);
        if (j >= 0 && j !== d.i) { doMove(d.i, j); return; }
      }
      boardKey = ''; renderBoard(true); return;
    }
    // 沒拖動 = 點選
    if (e.type !== 'pointerup' || !cur || cur.id !== d.id) return;
    if (selId == null) selId = cur.id;
    else if (selId === cur.id) selId = null;
    else {
      const si = G.board.findIndex(q => q && q.id === selId);
      if (si >= 0 && ET.canMerge(G, si, d.i)) { doMove(si, d.i); return; }
      selId = cur.id;
    }
    boardKey = ''; renderBoard(true);
  }
  addEventListener('pointerup', endDrag);        // 掛在 window：不管在哪放開都會結束拖曳
  addEventListener('pointercancel', endDrag);
  addEventListener('blur', cancelDrag);
  sellEl.addEventListener('click', () => {
    if (selId == null) { toast('先點一個東西，或直接把它拖過來'); return; }
    const si = G.board.findIndex(q => q && q.id === selId);
    if (si >= 0) doSell(si);
  });

  $('#bMergeAll').addEventListener('click', () => {
    const n = ET.mergeAll(G);
    selId = null;
    if (n === 0) { toast('沒有成對的可以合成'); return; }
    toast(`✨ 一鍵合成 ${n} 次`); vib(25);
    boardKey = ''; flush(); renderBoard(true); renderTop();
  });
  // 客人缺的東西，一行文字：🍔+（🌾 還差 6）
  function demandText(list) {
    return (list || DM).map(d => {
      const crop = ET.cropOf(d.s), ce = crop ? ET.CROPS[crop].emoji : SER[d.s].tiers[0];
      return `${ET.wantText(d)}（${d.short > 0 ? ce + ' 還差 ' + d.short : '材料夠了'}）`;
    }).join('　');
  }
  $('#bNeed').addEventListener('click', () => {
    const r = ET.prepareDemand(G);
    if (r.merges || r.stocked) toast(`🎯 為客人合成了 ${r.merges} 次、上架 ${r.stocked} 件`);
    else if (r.demand.length) toast(`🎯 材料還不夠：${demandText(r.demand)}。去花園多種`);
    else toast('客人要的都有貨了');
    boardKey = ''; flush(); renderBoard(true); renderShop(); renderTop();
  });
  function renderAuto() {
    if (tab !== 'merge') return;
    $('#needBar').hidden = !DM.length;
    if (DM.length) $('#needTxt').textContent = '🎯 客人要：' + demandText();
    $('#bMergeAll').classList.toggle('off', !ET.hasPair(G));
    const parts = [];
    if (G.up.bot > 0) {
      const iv = ET.botInterval(G.up.bot), left = Math.max(0, iv - G.botT);
      parts.push(`🤖 ${left < 0.05 ? '待命' : left.toFixed(1) + ' 秒後合成'}`);
    }
    if (G.up.shipper > 0) parts.push('🚚 自動出貨中');
    $('#autoInfo').textContent = parts.length ? parts.join('　') : '到 ⬆️ 升級可以買 🤖 機器人幫你合成';
  }

  // ---------- 商店 ----------
  const laneEl = $('#lane'), shelvesEl = $('#shelves');
  let laneIds = '', shelfSig = '', shelfEls = [];
  const tierEmoji = (s, t) => SER[s].tiers[t - 1];
  const wantTxt = c => c.kind === 'thief' ? '❗' : c.kind === 'noble' ? `${tierEmoji(c.s, c.t)}×${c.qty}+` : `${tierEmoji(c.s, c.t)}${c.t < ET.MAXT ? '+' : ''}`;
  function renderShop() {
    if (tab !== 'shop') return;
    const sp = G.shop, st = ET.stars(G);
    $('#stars').innerHTML = '⭐'.repeat(st) + '☆'.repeat(5 - st) + `<small>人氣 ${Math.floor(sp.pop)}</small>`;
    $('#shopStat').textContent = `賣出 ${sp.sales} 件　流失 ${sp.lost}`;
    const ids = sp.custs.map(c => c.id).join(',');
    if (ids !== laneIds) {
      laneIds = ids;
      laneEl.innerHTML = sp.custs.map(c => `<div class="cust ${c.kind}" data-id="${c.id}"><span class="bub">${wantTxt(c)}</span><span class="face">${c.face}</span><span class="pat"><i></i></span></div>`).join('');
    }
    sp.custs.forEach((c, i) => {
      const el = laneEl.children[i]; if (!el) return;
      const ok = ET.canServe(G, c), left = Math.max(0, 1 - c.wait / c.pat);
      el.classList.toggle('ok', ok); el.classList.toggle('warn', !ok && left < 0.35);
      el.lastChild.firstChild.style.width = (ok ? 1 : left) * 100 + '%';
    });
    const sig = sp.shelves.map(x => (x.item ? x.item.s + x.item.t : '-') + '/' + (x.tpl ? x.tpl.s + x.tpl.t : '-')).join('|') + '|' + G.up.sign;
    if (sig !== shelfSig) {
      shelfSig = sig;
      shelvesEl.innerHTML = sp.shelves.map((x, i) => {
        if (x.item) return `<button class="shelf full" data-i="${i}"><span class="em">${tierEmoji(x.item.s, x.item.t)}</span><span class="t">${x.item.t}</span><span class="pr">💰${ET.price(G, x.item.s, x.item.t)}</span></button>`;
        if (x.tpl) return `<button class="shelf" data-i="${i}"><span class="em tpl">${tierEmoji(x.tpl.s, x.tpl.t)}</span><span class="pr">缺貨</span></button>`;
        return `<button class="shelf" data-i="${i}"><span class="plus">＋</span></button>`;
      }).join('');
      shelfEls = Array.from(shelvesEl.children); resize();
    }
    $('#shopInfo').textContent = DM.length ? '🎯 客人缺：' + demandText() + '　點沒貨的客人看做法' : G.up.clerk > 0 ? '🛎️ 店員顧店中：缺貨先合成再補、趕走小偷（離線也一樣）' : '點客人 = 立刻結帳還有小費。補貨會先把缺的貨合成出來；雇 🛎️ 店員可以自動補貨';
  }
  laneEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.cust'); if (!el || modalOpen) return;
    const id = +el.dataset.id, c = G.shop.custs.find(x => x.id === id);
    const r = ET.serveNow(G, id);
    laneIds = ''; flush(); renderShop(); renderTop();
    if (!r.ok && r.why === 'nostock' && c) openRecipe(c);
  });
  // 這位客人要的東西怎麼做：合成路徑、你現在有多少、還差多少
  function openRecipe(c) {
    const S = SER[c.s], q = c.qty, T = c.t, crop = ET.cropOf(c.s), ce = crop ? ET.CROPS[crop].emoji : S.tiers[0];
    const chain = [];
    for (let k = 1; k <= T; k++) chain.push(`${S.tiers[k - 1]}×${q * Math.pow(2, T - k)}`);
    const cnt = {}; let have = 0;
    for (const it of G.board) if (it && it.s === c.s) { cnt[it.t] = (cnt[it.t] || 0) + 1; have += Math.pow(2, it.t - 1); }
    const haveTxt = Object.keys(cnt).map(Number).sort((a, b) => a - b).map(t => `${S.tiers[t - 1]}×${cnt[t]}`).join('　') || '（沒有）';
    const short = Math.max(0, q * Math.pow(2, T - 1) - have);
    let h = `<div class="big">${S.tiers[T - 1]}</div><h2>${S.names[T - 1]} 怎麼做？</h2>
      <p style="text-align:center">客人要 ${S.tiers[T - 1]}${q > 1 ? ' ×' + q : ''}${T < ET.MAXT ? `（更高階的 ${S.tiers[T]} 也可以）` : ''}</p>
      <div class="recipe">${chain.join(' → ')}</div>
      <p style="text-align:center">兩個一樣的拖在一起，就會升一階。</p>
      <p style="text-align:center">你的合成盤：${haveTxt}<br>${short > 0 ? `約等於 ${have} 個 ${ce}，還差 <b>${short}</b> 個 → 去花園多種 ${ce}` : '材料夠了！按下面的按鈕幫你合成並上架。'}</p>
      <button class="btn" data-a="prep">🎯 幫我合成並上架</button>
      <div class="row"><button class="btn ghost" data-a="garden">🌱 去種 ${ce}</button><button class="btn ghost" data-a="merge">⚗️ 去合成</button></div>
      <button class="btn ghost" data-a="close">關閉</button>`;
    showModal(h, a => {
      closeModal();
      if (a === 'prep') {
        const r = ET.prepareDemand(G);
        toast(r.merges || r.stocked ? `🎯 合成了 ${r.merges} 次、上架 ${r.stocked} 件` : '材料還不夠，去花園多種一些');
        flush(); renderShop(); renderTop();
      } else if (a === 'garden') {
        if (crop && ET.select(G, crop)) { seedKey = ''; toast(`已選 ${ce}，點空地種下去`); } else toast(ce + ' 還沒解鎖');
        setTab('garden');
      } else if (a === 'merge') setTab('merge');
    });
  }
  shelvesEl.addEventListener('click', e => { const b = e.target.closest('.shelf'); if (b && !modalOpen) openShelf(+b.dataset.i); });
  $('#bRestock').addEventListener('click', () => {
    const m0 = G.stats.merges, n = ET.restock(G), m = G.stats.merges - m0;
    toast(n ? `🔄 補了 ${n} 格${m ? `（先合成了 ${m} 次）` : ''}` : (m ? `先合成了 ${m} 次，但還湊不出缺的貨` : '沒有可補的東西（合成盤上沒有合適的貨）'));
    flush(); renderShop(); renderTop(); if (tab === 'merge') renderBoard(true);
  });
  $('#bTakeAll').addEventListener('click', () => {
    const n = ET.takeAll(G);
    toast(n ? `📥 取回 ${n} 件` : '貨架上沒有東西，或合成盤滿了');
    flush(); renderShop(); renderTop();
  });
  function openShelf(i) {
    const sh = G.shop.shelves[i];
    if (!sh) return;
    const cnt = {}, order = Object.keys(SER);
    for (const it of G.board) if (it) { const k = it.s + ':' + it.t; cnt[k] = (cnt[k] || 0) + 1; }
    const keys = Object.keys(cnt).sort((a, b) => { const [sa, ta] = a.split(':'), [sb, tb] = b.split(':'); return order.indexOf(sa) - order.indexOf(sb) || ta - tb; });
    let h = `<h2>📚 貨架 ${i + 1}</h2>`;
    if (sh.item) h += `<p style="text-align:center">目前上架：<b style="font-size:26px">${tierEmoji(sh.item.s, sh.item.t)}</b>　售價 💰${ET.price(G, sh.item.s, sh.item.t)}</p><button class="btn ghost" data-a="back">↩️ 取回合成盤</button>`;
    else if (sh.tpl) h += `<p style="text-align:center">商品設定：<b style="font-size:26px">${tierEmoji(sh.tpl.s, sh.tpl.t)}</b>（🛎️ 店員會照這個補貨）</p><button class="btn ghost" data-a="clear">🧹 清除商品設定</button>`;
    h += keys.length
      ? `<p>從合成盤選一個放上去：</p><div class="pick">${keys.map(k => { const [s2, t2] = k.split(':'); return `<button class="pk" data-a="p:${k}">${tierEmoji(s2, +t2)}<small>×${cnt[k]}</small><small>💰${ET.price(G, s2, +t2)}</small></button>`; }).join('')}</div>`
      : '<p>合成盤上沒有東西可以放。去花園收成，再回來上架。</p>';
    h += '<button class="btn" data-a="close">關閉</button>';
    showModal(h, a => {
      if (a === 'close') { closeModal(); return; }
      if (a === 'back') { const r = ET.takeBack(G, i); if (!r.ok) toast('合成盤滿了，放不回去'); }
      else if (a === 'clear') ET.clearTpl(G, i);
      else if (a.startsWith('p:')) { const [s2, t2] = a.slice(2).split(':'); ET.stock(G, i, s2, +t2); }
      closeModal(); flush(); renderShop(); renderTop(); if (tab === 'merge') renderBoard(true);
    });
  }

  // ---------- 冒險 ----------
  const advEls = { areaSig: '', mobSig: '', heroSig: '', mobEls: [], heroEls: [], info: '' };
  const gearName = g => `${SER[g.s].tiers[g.t - 1]} ${SER[g.s].names[g.t - 1]}`;
  const gearStat = (s, t) => { const b = ET.GEAR[s], m = ET.gearMul(t), p = []; if (b.atk) p.push('攻擊 +' + (b.atk * m).toFixed(1)); if (b.def) p.push('防禦 +' + (b.def * m).toFixed(1)); if (b.hp) p.push('血量 +' + Math.round(b.hp * m)); return p.join('、'); };
  const durTxt = s => s >= 60 ? Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '') : s + ' 秒';
  const seriesOfSlot = slot => Object.keys(SER).find(k => SER[k].gear === slot);
  function foodText(s, t) {
    const m = ET.FOOD[s] && ET.FOOD[s][t]; if (!m) return '';
    const p = [], pc = v => Math.round(v * 100);
    if (m.hp) p.push(`血量 +${pc(m.hp)}%`); if (m.atk) p.push(`攻擊 +${pc(m.atk)}%`); if (m.def) p.push(`防禦 +${pc(m.def)}%`);
    if (m.regen) p.push(`每秒回血 +${m.regen}`); if (m.xp) p.push(`經驗 +${pc(m.xp)}%`);
    return `${p.join('、')}（${durTxt(ET.FOOD_SEC(t))}）`;
  }
  // 盤上某系列的東西，依階數彙整：{ 階: [盤面索引…] }
  function boardByTier(series) { const o = {}; G.board.forEach((it, i) => { if (it && it.s === series) (o[it.t] = o[it.t] || []).push(i); }); return o; }
  function questDot() {
    if (!G.adv) return false;
    for (const h of G.adv.heroes) for (const slot of ET.SLOTS) if (!h.gear[slot] && G.board.some(it => it && SER[it.s].gear === slot)) return true;
    return false;
  }
  function renderQuest() {
    if (tab !== 'quest' || !G.adv) return;
    const A = G.adv, Ar = ET.AREAS[A.area - 1], B = A.battle;
    // 區域按鈕 + 10 關進度點
    const reach = A.reach[A.area] || 1;
    const asig = [A.area, A.stage, reach, !!A.cleared[A.area], ET.AREAS.map(a => A.open[a.id] ? 1 : 0).join('')].join('|');
    if (asig !== advEls.areaSig) {
      advEls.areaSig = asig;
      $('#areas').innerHTML = ET.AREAS.map(a => `<button class="qarea${A.area === a.id ? ' on' : ''}${A.open[a.id] ? '' : ' lock'}" data-a="${a.id}"><b>${A.open[a.id] ? a.emoji : '🔒'}</b><small>${a.name}</small></button>`).join('');
      let d = ''; for (let s = 1; s <= ET.ADV.stages; s++) d += `<i class="${(s < reach || A.cleared[A.area]) ? 'done' : ''}${s === A.stage ? ' cur' : ''}">${s === ET.ADV.stages ? '👑' : s}</i>`;
      $('#stageDots').innerHTML = d;
    }
    // 怪物
    const msig = B ? [A.area, A.stage, A.stats.stages, B.enemies.map(e => e.name + e.maxhp).join()].join(':') : (A.recover > 0 ? 'rest' : 'wait');
    if (msig !== advEls.mobSig) {
      advEls.mobSig = msig;
      $('#mobs').innerHTML = B ? B.enemies.map((e, i) => `<button class="mob${A.stage === ET.ADV.stages && i === 0 ? ' boss' : ''}" data-i="${i}"><span class="me">${e.e}</span><span class="hpb"><i></i></span></button>`).join('') : `<div class="rest">${A.recover > 0 ? '💤 隊伍休息中…' : '…'}</div>`;
      advEls.mobEls = Array.from($('#mobs').querySelectorAll('.mob'));
    }
    if (B) B.enemies.forEach((e, i) => { const el = advEls.mobEls[i]; if (!el) return; el.classList.toggle('dead', e.hp <= 0); el.querySelector('.hpb i').style.width = Math.max(0, e.hp / e.maxhp * 100) + '%'; });
    // 英雄卡
    const hsig = A.heroes.map(h => h.id + h.role + h.lvl + ET.SLOTS.map(sl => h.gear[sl] ? h.gear[sl].s + h.gear[sl].t : '-').join('')).join('|') + '|' + (A.heroes.length < ET.ADV.partyMax);
    if (hsig !== advEls.heroSig) {
      advEls.heroSig = hsig;
      let h = A.heroes.map(x => `<button class="hero" data-id="${x.id}"><span class="hr">${ET.ROLES[x.role].emoji}</span><span class="hl">Lv.${x.lvl}</span><span class="hpb"><i></i></span><span class="hg">${ET.SLOTS.map(sl => `<u>${x.gear[sl] ? SER[x.gear[sl].s].tiers[x.gear[sl].t - 1] : '·'}</u>`).join('')}</span></button>`).join('');
      if (A.heroes.length < ET.ADV.partyMax) h += `<button class="hero add"><b>＋</b>招募 💰${fmt(ET.recruitCost(G))}</button>`;
      $('#heroes').innerHTML = h;
      advEls.heroEls = Array.from($('#heroes').querySelectorAll('.hero:not(.add)'));
    }
    A.heroes.forEach((h, i) => { const el = advEls.heroEls[i]; if (!el) return; el.classList.toggle('down', h.hp <= 0); el.querySelector('.hpb i').style.width = Math.max(0, h.hp / ET.heroStats(G, h).hp * 100) + '%'; });
    // 說明列
    const p = [`${Ar.emoji} ${Ar.name} 第 ${A.stage}/${ET.ADV.stages} 關　過關 💰${ET.stageReward(A.area, A.stage)}`];
    if (A.recover > 0) p.push(`💤 全滅了，${A.recover} 秒後復活`);
    else if (A.hold > 0) p.push(`🔁 穩一穩：再贏 ${A.hold} 場才往上推`);
    else if (A.food.act) p.push(`${tierEmoji(A.food.act.s, A.food.act.t)} 料理加成剩 ${durTxt(A.food.left)}`);
    const info = p.join('<br>');
    if (info !== advEls.info) { advEls.info = info; $('#qInfo').innerHTML = info; }
  }
  $('#areas').addEventListener('click', e => {
    const b = e.target.closest('.qarea'); if (!b) return;
    const r = ET.advGo(G, +b.dataset.a);
    if (!r.ok) toast('🔒 打倒前一區的 Boss 才會開放');
    advEls.areaSig = ''; advEls.mobSig = ''; renderQuest();
  });
  $('#mobs').addEventListener('pointerdown', e => {
    const b = e.target.closest('.mob'); if (!b || modalOpen) return;
    ET.advTap(G, +b.dataset.i); flush(); renderQuest(); renderTop();
  });
  $('#heroes').addEventListener('click', e => {
    const b = e.target.closest('.hero'); if (!b || modalOpen) return;
    if (b.classList.contains('add')) openRecruit(); else openHero(+b.dataset.id);
  });
  $('#bForge').addEventListener('click', () => { if (!modalOpen) openForge(); });
  $('#bFood').addEventListener('click', () => { if (!modalOpen) openFood(); });
  $('#bRecruit').addEventListener('click', () => { if (!modalOpen) openRecruit(); });
  const afterAdv = () => { advEls.heroSig = ''; advEls.mobSig = ''; boardKey = ''; flush(); renderQuest(); renderTop(); };

  function openHero(id) {
    const A = G.adv, h = A.heroes.find(x => x.id === id); if (!h) return;
    const R = ET.ROLES[h.role], st = ET.heroStats(G, h), need = ET.heroXpNeed(h.lvl);
    let html = `<div class="big">${R.emoji}</div><h2>${R.name}　Lv.${h.lvl}</h2><p style="text-align:center">${R.note}</p>
      <div class="hstats"><span>❤️ ${Math.max(0, Math.round(h.hp))}/${st.hp}</span><span>⚔️ ${st.atk.toFixed(1)}</span><span>🛡️ ${st.def.toFixed(1)}</span></div>
      <div class="xpb"><i style="width:${h.lvl >= ET.ADV.heroMaxLv ? 100 : Math.min(100, h.xp / need * 100)}%"></i></div><p style="text-align:center">${h.lvl >= ET.ADV.heroMaxLv ? '已滿級' : `經驗 ${Math.floor(h.xp)}/${need}`}</p>`;
    for (const slot of ET.SLOTS) {
      const g = h.gear[slot], ser = seriesOfSlot(slot), by = boardByTier(ser);
      html += `<div class="slotrow"><div class="sr"><b>${ET.SLOT_NAME[slot]}</b>`;
      if (g) html += `<span class="gn">${gearName(g)}（+${g.t - 1}）<small>${gearStat(g.s, g.t)}</small></span><button class="mini" data-a="enh:${slot}">⬆️ 強化</button><button class="mini" data-a="off:${slot}">卸下</button>`;
      else html += `<span class="gn" style="color:var(--dim)">空著</span>`;
      html += `</div>`;
      const ts = Object.keys(by).map(Number).sort((a, b) => a - b);
      html += ts.length ? `<div class="cands">${ts.map(t => `<button class="cand" data-a="eq:${slot}:${t}">${SER[ser].tiers[t - 1]}<small>×${by[t].length}　${gearStat(ser, t).split('、')[0]}</small></button>`).join('')}</div>`
        : `<p style="margin:6px 0 0;font-size:12px">合成盤上沒有${ET.SLOT_NAME[slot]}可以穿（到 🔨 鍛造，或在冒險中掉落）</p>`;
      html += `</div>`;
    }
    html += `<p style="font-size:12px">點下面的裝備就穿上；穿著的那件，只要合成盤上有另一件一模一樣的，按「⬆️ 強化」就升一階。</p><button class="btn" data-a="close">關閉</button>`;
    showModal(html, a => {
      if (a === 'close') { closeModal(); return; }
      const [op, slot, t] = a.split(':');
      let msg = '';
      if (op === 'eq') { const bi = (boardByTier(seriesOfSlot(slot))[+t] || [])[0]; if (bi != null) { ET.equip(G, bi, h.id); SND.buy(); } }
      else if (op === 'off') { const r = ET.unequip(G, h.id, slot); if (!r.ok) msg = '合成盤滿了，放不下'; }
      else if (op === 'enh') {
        const g = h.gear[slot], r = ET.enhance(G, h.id, slot);
        if (r.ok) { SND.merge(r.tier); msg = `⬆️ 強化成功！${gearName(h.gear[slot])}`; }
        else if (r.why === 'none') msg = `合成盤上要再有一件 ${gearName(g)} 才能強化`;
        else if (r.why === 'max') msg = '已經是最高階了';
      }
      if (msg) toast(msg);
      afterAdv(); openHero(id);
    });
  }
  function openForge() {
    const A = G.adv; if (!A) return;
    let h = `<h2>🔨 鍛造</h2><p>用金幣和花園的材料打造 1 階裝備，放進合成盤。兩件一樣的拖在一起會升階，再到英雄身上穿上或強化。</p>`;
    for (const r of ET.FORGE) {
      const ser = SER[r.s], cost = ET.forgeCost(G, r.id), can = ET.canForge(G, r.id);
      const mats = Object.keys(r.mats).map(s => `${SER[s].tiers[0]}×${r.mats[s]}（你有 ${ET.matMass(G, s)}）`).join(' ');
      h += `<div class="up"><div class="ue">${ser.tiers[0]}</div><div class="ub"><b>${ser.name}：${ser.names[0]}</b><small>${gearStat(r.s, 1)}<br>材料 ${mats}</small></div><button class="btn${can.ok ? '' : ' off'}" data-a="f:${r.id}">💰${fmt(cost)}</button></div>`;
    }
    h += `<p style="font-size:12px">每鍛造一次，同一種的金幣價格 ×1.15。材料用的是合成盤上的東西，會先用掉低階的。</p><button class="btn ghost" data-a="close">關閉</button>`;
    showModal(h, a => {
      if (a === 'close') { closeModal(); return; }
      const id = a.slice(2), r = ET.forge(G, id);
      if (r.ok) { SND.merge(1); toast('🔨 鍛造完成，在合成盤上'); }
      else if (r.why === 'coins') toast('💰 金幣不夠');
      else if (r.why === 'mats') { const rec = ET.FORGE.find(x => x.id === id); toast(`材料不夠：${SER[r.need].tiers[0]} 要 ${rec.mats[r.need]}（現有 ${ET.matMass(G, r.need)}），去花園多種`); }
      afterAdv(); openForge();
    });
  }
  function openFood() {
    const A = G.adv; if (!A) return;
    const F = A.food, by = {};
    G.board.forEach((it, i) => { if (ET.canPack(it)) { const k = it.s + ':' + it.t; (by[k] = by[k] || []).push(i); } });
    const keys = Object.keys(by).sort((a, b) => { const [sa, ta] = a.split(':'), [sb, tb] = b.split(':'); return sa < sb ? -1 : sa > sb ? 1 : ta - tb; });
    let h = `<h2>🍽️ 補給</h2><p>把 2 階以上的料理放進補給，冒險隊會依序吃掉，獲得加成（離線也一樣）。</p>`;
    h += F.act ? `<p style="text-align:center;color:var(--text)">生效中：<b style="font-size:22px">${tierEmoji(F.act.s, F.act.t)}</b><br>${foodText(F.act.s, F.act.t).replace(/（.*）/, '')}　剩 ${durTxt(F.left)}</p>` : `<p style="text-align:center">目前沒有料理加成</p>`;
    h += `<div class="foodq">${[0, 1, 2].map(i => F.queue[i] ? `<button class="on" data-a="un:${i}">${tierEmoji(F.queue[i].s, F.queue[i].t)}</button>` : `<button disabled>·</button>`).join('')}</div><p style="font-size:12px;margin-top:0">排隊中的料理（點一下取回合成盤）</p>`;
    h += keys.length ? keys.map(k => { const [s, t] = k.split(':'); return `<div class="up"><div class="ue">${tierEmoji(s, +t)}</div><div class="ub"><b>${SER[s].names[t - 1]} ×${by[k].length}</b><small>${foodText(s, +t)}</small></div><button class="btn${F.queue.length >= ET.FOOD_QUEUE ? ' off' : ''}" data-a="pk:${k}">放進去</button></div>`; }).join('')
      : `<p>合成盤上沒有可以帶的料理。把 🌾🍎 合成到 2 階以上（🍞 🧃…）就可以。</p>`;
    h += `<button class="btn ghost" data-a="close">關閉</button>`;
    showModal(h, a => {
      if (a === 'close') { closeModal(); return; }
      const [op, x, y] = a.split(':');
      if (op === 'un') { const r = ET.unpackFood(G, +x); if (!r.ok) toast('合成盤滿了，放不下'); }
      else if (op === 'pk') {
        const bi = ((by[x + ':' + y]) || [])[0], r = bi == null ? { ok: false } : ET.packFood(G, bi);
        if (!r.ok && r.why === 'full') toast('最多排 3 份料理');
      }
      afterAdv(); openFood();
    });
  }
  function openRecruit() {
    const A = G.adv; if (!A) return;
    const cost = ET.recruitCost(G), owned = new Set(A.heroes.map(h => h.role));
    let h = `<h2>👥 招募</h2><p>最多 4 位，每個職業只能有 1 位。目前用金幣招募（之後公會開放會改成公會招募）。</p>`;
    if (A.heroes.length >= ET.ADV.partyMax) h += `<p style="text-align:center">隊伍已滿（4 位）</p>`;
    else for (const k of Object.keys(ET.ROLES)) {
      if (owned.has(k)) continue;
      const R = ET.ROLES[k];
      h += `<div class="up"><div class="ue">${R.emoji}</div><div class="ub"><b>${R.name}</b><small>${R.note}<br>血量 ${R.hp}　攻擊 ${R.atk}　防禦 ${R.def}</small></div><button class="btn${G.coins < cost ? ' off' : ''}" data-a="r:${k}">💰${fmt(cost)}</button></div>`;
    }
    h += `<button class="btn ghost" data-a="close">關閉</button>`;
    showModal(h, a => {
      if (a === 'close') { closeModal(); return; }
      const r = ET.recruit(G, a.slice(2));
      if (r.ok) { SND.unlock(); toast('👥 新夥伴加入了！'); } else if (r.why === 'coins') toast('💰 金幣不夠');
      afterAdv(); if (r.ok) closeModal(); else openRecruit();
    });
  }

  // ---------- 頂部 ----------
  let lastCoins = -1, hintLast = '';
  function renderTop() {
    if (G.coins !== lastCoins) { lastCoins = G.coins; $('#coinN').textContent = fmt(G.coins); }
    $('#bUp .dot').hidden = !ET.affordable(G);
    const h = ET.hint(G);
    if (h !== hintLast) { hintLast = h; $('#hint').textContent = h; }
    const tabs = $('#tabs').children;
    if (tabs[0]) { const d = tabs[0].querySelector('.dot'); if (d) d.hidden = !(tab !== 'garden' && G.plots.some(ET.isRipe)); }
    if (tabs[1] && G.unlocked.merge) { const d = tabs[1].querySelector('.dot'); if (d) d.hidden = !(tab !== 'merge' && hasPairUI()); }
    if (tabs[3] && G.unlocked.quest) { const d = tabs[3].querySelector('.dot'); if (d) d.hidden = !(tab !== 'quest' && questDot()); }
    if (tabs[2] && G.unlocked.shop) { const d = tabs[2].querySelector('.dot'); if (d) d.hidden = !(tab !== 'shop' && G.shop.custs.some(c => c.kind === 'thief' || !ET.canServe(G, c))); }
  }

  // ---------- 事件（core 產生，UI 播動畫） ----------
  function flush() {
    for (const e of G.ev) {
      switch (e.t) {
        case 'harvest': floatAt(plotEls[e.i], '+' + SER[ET.CROPS[e.crop].series].tiers[0]); SND.harvest(); plotCache[e.i] = null; break;
        case 'plant': SND.plant(); plotCache[e.i] = null; break;
        case 'boost': floatAt(plotEls[e.i], '⏩', -8); SND.boost(); break;
        case 'merge': {
          SND.merge(e.tier);
          const c = tab === 'merge' && boardEl.children[e.to];
          if (c) { floatAt(c, SER[e.s].tiers[e.tier - 1] + '!'); }
          mergedCell = e.to; break;
        }
        case 'sell': floatAt(sellEl, '+' + fmt(e.v) + ' 💰'); SND.sell(); break;
        case 'buy': case 'expand': SND.buy(); break;
        case 'unlock': toast(e.tab === 'shop' ? '🏪 商店開張了！去商店把東西上架' : e.tab === 'quest' ? '⚔️ 冒險開放了！先到冒險頁鍛造一把武器' : '⚗️ 合成台解鎖了！'); SND.unlock(); buildTabs(); break;
        case 'hit': if (tab === 'quest' && G.adv) {
          if (e.side === 'enemy') floatAt(advEls.mobEls[e.i], '-' + e.dmg, -6, 'dmg');
          else floatAt(advEls.heroEls[G.adv.heroes.findIndex(h => h.id === e.hid)], '-' + e.dmg, -6, 'dmg');
        } break;
        case 'heal': if (tab === 'quest' && G.adv) floatAt(advEls.heroEls[G.adv.heroes.findIndex(h => h.id === e.hid)], '+' + e.v, -6, 'heal'); break;
        case 'advwin': if (tab === 'quest') { floatAt($('#mobs'), '+💰' + fmt(e.coins), 0, 'gold'); SND.sell(); } break;
        case 'advlose': if (tab === 'quest') { toast('💀 全滅了…退一關，休息一下再來'); SND.lose(); } break;
        case 'drop': toast(`🎁 掉落 ${tierEmoji(e.s, e.tier)}，在合成盤上`); SND.unlock(); break;
        case 'lvl': if (tab === 'quest' && G.adv) { const hh = G.adv.heroes.find(x => x.id === e.hid); if (hh) toast(`⬆️ ${ET.ROLES[hh.role].name} 升到 Lv.${e.lvl}`); } break;
        case 'sale': floatAt(tab === 'shop' && shelfEls[e.slot] ? shelfEls[e.slot] : $('#coins'), '+' + fmt(e.total) + ' 💰' + (e.tip ? ' 小費' : '')); SND.sell(); break;
        case 'lost': if (tab === 'shop') floatAt(laneEl, '😞'); break;
        case 'stolen': toast(`🦹 偷走了 ${tierEmoji(e.s, e.tier)}！下次點他趕走，或雇 🛎️ 店員`); break;
        case 'chase': floatAt(laneEl, e.auto ? '🛎️💨' : '💨'); break;
        case 'toast': toast(e.text); break;
        case 'full': toast('📦 合成盤滿了！去合成或賣出'); break;
      }
    }
    G.ev.length = 0;
  }
  let mergedCell = -1;

  // ---------- 升級 / 設定 / 離線 modal ----------
  function openUpgrades() {
    let h = '<h2>⬆️ 升級</h2>';
    let any = false;
    for (const [grp, title] of [['farm', '🌾 農場'], ['shop', '🏪 商店']]) {
      let head = false;
      for (const u of ET.UPGRADES) {
      if (u.group !== grp || !ET.upgradeVisible(G, u.id)) continue;
      if (!head) { h += `<div class="up-h">${title}</div>`; head = true; }
      any = true;
      const l = G.up[u.id], maxed = l >= u.max, c = ET.upgradeCost(G, u.id);
      h += `<div class="up"><div class="ue">${u.emoji}</div><div class="ub"><b>${u.name}${u.max > 1 && l > 0 ? ' Lv.' + l : ''}</b><small>${maxed ? '✅ 已滿級 — ' : ''}${u.desc(l)}</small></div>` +
        (maxed ? '' : `<button class="btn${G.coins < c ? ' off' : ''}" data-a="buy:${u.id}">💰${fmt(c)}</button>`) + '</div>';
      }
    }
    if (!any) h += '<p>多賺一點錢，升級項目就會出現。</p>';
    h += '<button class="btn ghost" data-a="close">關閉</button>';
    showModal(h, (a) => {
      if (a === 'close') { closeModal(); return; }
      if (a.startsWith('buy:')) {
        const r = ET.buy(G, a.slice(4));
        if (!r.ok && r.why === 'coins') toast('💰 錢還不夠');
        flush(); plotCache = []; seedKey = ''; renderTop(); renderGarden(); openUpgrades();
      }
    });
  }
  function encode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function decode(s) { return decodeURIComponent(escape(atob(s.trim()))); }
  function openSettings() {
    showModal(`<h2>⚙️ 設定</h2>
      <button class="btn ghost" data-a="snd">${pref.mute ? '🔇 音效：關' : '🔊 音效：開'}</button>
      <button class="btn ghost" data-a="export">📤 匯出存檔碼</button>
      <button class="btn ghost" data-a="import">📥 匯入存檔碼</button>
      <button class="btn ghost" data-a="reset">🗑️ 重置遊戲</button>
      <p>表情小鎮 S2　每 10 秒自動存檔。換裝置或清瀏覽器資料前，請先匯出存檔碼。</p>
      <button class="btn" data-a="close">關閉</button>`, (a, el) => {
      if (a === 'close') closeModal();
      else if (a === 'snd') { pref.mute = pref.mute ? 0 : 1; savePref(); openSettings(); }
      else if (a === 'export') {
        save();
        showModal(`<h2>📤 存檔碼</h2><p>整段複製起來，存到安全的地方。</p><textarea id="code" readonly>${encode(ET.save(G, Date.now()))}</textarea>
          <button class="btn" data-a="copy">複製</button><button class="btn ghost" data-a="back">返回</button>`, (b) => {
          if (b === 'back') openSettings();
          else if (b === 'copy') { const t = $('#code'); t.select(); try { navigator.clipboard.writeText(t.value); toast('已複製'); } catch (e) { document.execCommand && document.execCommand('copy'); toast('已複製'); } }
        });
      } else if (a === 'import') {
        showModal(`<h2>📥 匯入存檔碼</h2><p>貼上之前匯出的存檔碼。會覆蓋目前的進度！</p><textarea id="code"></textarea>
          <button class="btn" data-a="go">匯入</button><button class="btn ghost" data-a="back">返回</button>`, (b) => {
          if (b === 'back') openSettings();
          else if (b === 'go') {
            let g = null;
            try { g = ET.load(decode($('#code').value)); } catch (e) { }
            if (!g) { toast('存檔碼不正確'); return; }
            G = g; save(); resetUI(); closeModal(); toast('匯入完成');
          }
        });
      } else if (a === 'reset') {
        if (el.dataset.sure) { G = ET.newState(Date.now()); save(); resetUI(); closeModal(); toast('已重置'); }
        else { el.dataset.sure = 1; el.textContent = '⚠️ 再按一次確認（無法復原）'; }
      }
    });
  }
  function openOffline(s) {
    const hv = Object.keys(s.harvested).map(c => `<span>${ET.CROPS[c].emoji} ×${s.harvested[c].toLocaleString()}</span>`).join('');
    let h = `<div class="big">☀️</div><h2>歡迎回來！</h2><p style="text-align:center">你不在的 ${fmtDur(s.rawSec)}${s.capped ? `（只算 ${fmtDur(s.sec)}）` : ''}：</p>`;
    if (hv) h += `<div class="sum">${hv}</div>`;
    else h += `<p style="text-align:center">作物熟了，但沒人收成 😢<br>到 ⬆️ 升級買 🚜 農夫，下次離線也會幫你收。</p>`;
    if (s.merges || s.sold) h += `<p style="text-align:center">合成 ${s.merges.toLocaleString()} 次${s.sold ? `、賣出區賣了 ${s.sold.toLocaleString()} 件` : ''}</p>`;
    if (s.shopSales) h += `<p style="text-align:center">🏪 商店賣出 ${s.shopSales.toLocaleString()} 件，營收 💰${fmt(s.shopRevenue)}${s.shopLost ? `；${s.shopLost.toLocaleString()} 位客人沒買到就走了` : ''}${s.shopStolen ? `；被偷了 ${s.shopStolen} 件 🦹` : ''}</p>`;
    else if (G.unlocked.shop && s.shopLost) h += `<p style="text-align:center">🏪 貨架空了，${s.shopLost.toLocaleString()} 位客人沒買到就走了。雇 🛎️ 店員可以自動補貨。</p>`;
    if (s.earned) h += `<p style="text-align:center;font-size:18px;color:var(--text)"><b>總共賺了 💰${fmt(s.earned)}</b></p>`;
    if (s.advStages) h += `<p style="text-align:center">⚔️ 冒險隊打了 ${s.advStages.toLocaleString()} 關，帶回 💰${fmt(s.advCoins)}${s.advDefeats ? `；全滅 ${s.advDefeats.toLocaleString()} 次` : ''}${s.advLevels ? `；英雄共升了 ${s.advLevels} 級` : ''}${s.advDrops ? `；掉了 ${s.advDrops} 件裝備 🎁` : ''}</p>`;
    if (s.capped) h += `<p style="text-align:center">離線最多累積 ${ET.offlineCapHours(G)} 小時，可以在 ⬆️ 升級提高。</p>`;
    h += '<button class="btn" data-a="ok">收下</button>';
    showModal(h, () => closeModal());
  }

  $('#bUp').addEventListener('click', () => { if (!modalOpen) openUpgrades(); });
  $('#bSet').addEventListener('click', () => { if (!modalOpen) openSettings(); });

  // ---------- 版面尺寸 ----------
  function resize() {
    const p = plotEls[0]; if (p) $('#plots').style.setProperty('--pw', p.clientWidth + 'px');
    const sw = shelvesEl.firstChild; if (sw) shelvesEl.style.setProperty('--sw', sw.clientWidth + 'px');
    const c = boardEl.firstChild; if (c) boardEl.style.setProperty('--cw', c.clientWidth + 'px');
    else boardEl.style.setProperty('--cw', Math.min(boardEl.clientWidth, 420) / 5 + 'px');
  }
  addEventListener('resize', resize);

  function resetUI() {
    cancelDrag();
    selId = null; plotEls = []; plotCache = []; seedKey = ''; boardKey = ''; hintLast = ''; lastCoins = -1; tab = 'garden';
    laneIds = ''; shelfSig = ''; advEls.areaSig = advEls.mobSig = advEls.heroSig = advEls.info = ''; DM = G.unlocked.shop ? ET.demand(G) : [];
    showView('garden');
    buildTabs(); buildPlots(); renderGarden(); renderTop();
  }

  // ---------- 主迴圈 ----------
  let last = Date.now(), saveT = 0;
  function loop() {
    const now = Date.now(), gap = (now - last) / 1000;
    last = now;
    if (gap < 0) return;                   // 系統時間倒退：不給收益
    if (gap > 5) {                         // 分頁在背景被凍結：用離線補算
      const s = ET.offline(G, gap);
      if (s && gap >= 30 && !modalOpen) { s.rawSec = gap; openOffline(s); }
      plotCache = []; boardKey = '';
    } else ET.tick(G, gap);
    flush();
    DM = G.unlocked.shop ? ET.demand(G) : [];
    renderGarden(); renderBoard(); renderShop(); renderQuest(); renderAuto(); renderTop();
    if (mergedCell >= 0) { const c = boardEl.children[mergedCell]; if (c) { c.classList.add('merged'); setTimeout(() => c.classList.remove('merged'), 360); } mergedCell = -1; }
    saveT += gap; if (saveT >= 10) { saveT = 0; save(); }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
  addEventListener('beforeunload', save);
  document.addEventListener('freeze', save);

  // ---------- 啟動 ----------
  loadPref();
  let bootOffline = null;
  function start(loaded, gap) {
    if (loaded) {
      G = loaded;
      if (gap >= 1) { bootOffline = ET.offline(G, gap); if (bootOffline) bootOffline.rawSec = gap; }
      G.ev.length = 0;
    } else G = ET.newState(Date.now());
    last = Date.now();
    resetUI();
    save();
    setInterval(loop, 100);
    $('#boot').hidden = true;
    if (bootOffline && bootOffline.sec >= 30) openOffline(bootOffline);
  }
  const saved = lsGet(KEY);
  const loadedG = saved ? ET.load(saved) : null;
  const bootGap = loadedG ? ET.offlineSeconds(loadedG, Date.now()) : 0;
  if (bootGap >= 1800) {      // 離線超過 30 分鐘：補算要一點時間，先顯示「計算中」，等畫面畫出來再開始算
    $('#boot').hidden = false;
    requestAnimationFrame(() => setTimeout(() => start(loadedG, bootGap), 30));
  } else start(loadedG, bootGap);
  window.__town = { get G() { return G; }, ET };
})();
