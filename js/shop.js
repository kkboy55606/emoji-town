// S2 商店：貨架、客人、人氣、店員。不碰 DOM，亂數全走 G.rs（可存檔、離線補算與線上一致）。
(function (root) {
  'use strict';
  const ET = root.ET, S = ET.SHOP, MAXT = ET.MAXT, N = ET.COLS * ET.ROWS;
  const ev = (G, o) => { if (G.ev.length < 300) G.ev.push(o); };
  const val = (s, t) => ET.value(s, t);
  const FACES = ['🧑', '👩', '👴', '👧', '👦', '👵'];
  const WANT_W = { 1: 1, 2: 4, 3: 3, 4: 1.5 };      // 客人想要幾階：偏好 2～3 階

  // mulberry32：狀態存在 G.rs
  ET.rand = function (G) {
    G.rs = (G.rs + 0x6D2B79F5) >>> 0;
    let t = G.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  ET.newShop = n => ({
    shelves: Array.from({ length: n || S.baseShelves }, () => ({ item: null, tpl: null })),
    pop: 20, sales: 0, revenue: 0, lost: 0, stolen: 0, spawnT: 0, nextIv: S.baseInterval, restockT: 0,
    custs: [], cid: 1
  });
  ET.shelfCount = G => S.baseShelves + G.up.shelf;
  ET.priceMult = G => S.priceBase + 0.1 * G.up.sign;
  ET.rateMult = G => (0.6 + 1.4 * G.shop.pop / 100) * (1 + 0.2 * G.up.deco);
  ET.queueMax = G => S.queueBase + G.up.deco;
  ET.stars = G => Math.min(5, Math.floor(G.shop.pop / 20));
  ET.price = (G, s, t) => Math.round(val(s, t) * ET.priceMult(G));
  ET.shopSync = function (G) {
    const sh = G.shop.shelves, n = ET.shelfCount(G);
    while (sh.length < n) sh.push({ item: null, tpl: null });
  };

  // ---------- 客人 ----------
  // 圖鑑裡可當客人需求的品項（已排序、解析好）。圖鑑沒變就重用上次的結果
  const dexCache = new WeakMap();
  function wantPool(G) {
    let n = 0; for (const k in G.dex) n++;
    const c = dexCache.get(G.dex);
    if (c && c.n === n) return c.list;
    const list = [];
    for (const k of Object.keys(G.dex).sort()) {
      const [s, ts] = k.split(':'), t = +ts;
      if (ET.SERIES[s] && !ET.SERIES[s].gear && t < MAXT) list.push({ s, t });
    }
    dexCache.set(G.dex, { n, list });
    return list;
  }
  function pickWant(G, minTier) {
    const pool = [];
    for (const w of wantPool(G)) if (w.t >= minTier) pool.push([w, WANT_W[w.t] || 1]);
    if (!pool.length) return null;
    let sum = 0; for (const p of pool) sum += p[1];
    let r = ET.rand(G) * sum;
    for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
    return pool[pool.length - 1][0];
  }
  function spawnCust(G) {
    const sp = G.shop;
    if (sp.custs.length >= ET.queueMax(G)) return;
    const r = ET.rand(G);
    let kind = 'normal', want = null, qty = 1;
    if (sp.pop >= 40 && sp.sales >= 10 && r < 0.07) kind = 'thief';
    else if (sp.pop >= 30 && r < 0.15) { kind = 'noble'; want = pickWant(G, 2); qty = 3; if (!want) kind = 'normal'; }
    if (kind === 'normal') { qty = 1; want = pickWant(G, 1); if (!want) return; }
    const c = {
      id: sp.cid++, kind, qty, wait: 0, okT: 0, pat: S.patience[kind],
      face: kind === 'thief' ? '🦹' : kind === 'noble' ? '🤴' : FACES[Math.floor(ET.rand(G) * FACES.length)],
      s: want ? want.s : null, t: want ? want.t : 0
    };
    sp.custs.push(c);
    ev(G, { t: 'customer', id: c.id });
  }
  // 客人要的東西：貨架上同系列、階數 >= 要求的；挑最便宜的 qty 個。湊不齊回傳 null
  function qualifying(G, c) {
    const sh = G.shop.shelves, out = [];
    for (let i = 0; i < sh.length; i++) { const it = sh[i].item; if (it && it.s === c.s && it.t >= c.t) out.push(i); }
    if (out.length < c.qty) return null;
    out.sort((a, b) => val(sh[a].item.s, sh[a].item.t) - val(sh[b].item.s, sh[b].item.t) || a - b);
    return out.slice(0, c.qty);
  }
  ET.canServe = (G, c) => c.kind !== 'thief' && !!qualifying(G, c);

  function sale(G, c, idxs, tapped) {
    const sp = G.shop, sh = sp.shelves;
    let total = 0;
    for (const i of idxs) { const it = sh[i].item; total += ET.price(G, it.s, it.t); sh[i].item = null; }
    if (c.kind === 'noble') total = Math.round(total * 1.3);
    const tip = tapped ? Math.max(1, Math.round(total * S.tipRate)) : 0;
    total += tip;
    G.coins += total; G.stats.earned += total;
    sp.sales += idxs.length; sp.revenue += total;
    sp.pop = Math.min(100, sp.pop + (c.kind === 'noble' ? 3 : 2) + (tapped ? 1 : 0));
    c.done = true;
    ev(G, { t: 'sale', total, tip, cid: c.id, slot: idxs[0] });
  }
  function steal(G, c) {
    const sp = G.shop, sh = sp.shelves;
    let best = -1, bv = -1;
    for (let i = 0; i < sh.length; i++) { const it = sh[i].item; if (it && val(it.s, it.t) > bv) { bv = val(it.s, it.t); best = i; } }
    c.done = true;
    if (best < 0) return;
    const it = sh[best].item; sh[best].item = null;
    sp.stolen++; sp.pop = Math.max(0, sp.pop - 3);
    ev(G, { t: 'stolen', s: it.s, tier: it.t, cid: c.id });
  }
  // 點客人：有貨 → 立刻結帳 + 小費；小偷 → 趕走
  ET.serveNow = function (G, id) {
    const sp = G.shop, c = sp.custs.find(x => x.id === id && !x.done);
    if (!c) return { ok: false, why: 'gone' };
    if (c.kind === 'thief') { c.done = true; sp.pop = Math.min(100, sp.pop + 1); ev(G, { t: 'chase', cid: c.id }); sp.custs = sp.custs.filter(x => !x.done); return { ok: true, act: 'chase' }; }
    const idxs = qualifying(G, c);
    if (!idxs) return { ok: false, why: 'nostock' };
    sale(G, c, idxs, true);
    sp.custs = sp.custs.filter(x => !x.done);
    return { ok: true, act: 'sale' };
  };

  // ---------- 貨架 ----------
  // 把合成盤上「剛好是 s/t」的一個放上第 i 格；原本的貨品換回那個空位（所以盤面滿了也能換）
  ET.stock = function (G, i, s, t) {
    const sh = G.shop.shelves[i];
    if (!sh) return { ok: false, why: 'slot' };
    let bi = -1;
    for (let k = 0; k < N; k++) { const it = G.board[k]; if (it && it.s === s && it.t === t) { bi = k; break; } }
    if (bi < 0) return { ok: false, why: 'none' };
    const picked = G.board[bi];
    G.board[bi] = sh.item || null;
    sh.item = picked; sh.tpl = { s, t }; G.ver++;
    return { ok: true };
  };
  ET.takeBack = function (G, i) {
    const sh = G.shop.shelves[i];
    if (!sh || !sh.item) return { ok: false, why: 'empty' };
    const bi = G.board.indexOf(null);
    if (bi < 0) return { ok: false, why: 'full' };
    G.board[bi] = sh.item; sh.item = null; G.ver++;
    return { ok: true };
  };
  ET.takeAll = function (G) {
    let n = 0;
    for (let i = 0; i < G.shop.shelves.length; i++) if (ET.takeBack(G, i).ok) n++;
    return n;
  };
  ET.clearTpl = function (G, i) { const sh = G.shop.shelves[i]; if (sh && !sh.item) { sh.tpl = null; return true; } return false; };
  // 合成盤上能補給 tpl（同系列、階數 >= tpl.t）的最便宜一個
  function findBoard(G, tpl) {
    let best = -1, bv = Infinity;
    for (let k = 0; k < N; k++) {
      const it = G.board[k];
      if (it && it.s === tpl.s && it.t >= tpl.t && val(it.s, it.t) < bv) { bv = val(it.s, it.t); best = k; }
    }
    return best;
  }
  // 沒設定商品的空貨架：建議盤上數量最多的 2 階以上品項（沒有就 1 階）
  function suggest(G) {
    for (const minT of [2, 1]) {
      const c = {};
      for (const it of G.board) if (it && !ET.isGear(it.s) && it.t >= minT && it.t < MAXT) { const k = it.s + ':' + it.t; c[k] = (c[k] || 0) + 1; }
      let bk = null, bc = 0;
      for (const k of Object.keys(c).sort()) if (c[k] > bc) { bc = c[k]; bk = k; }
      if (bk) { const [s, t] = bk.split(':'); return { s, t: +t }; }
    }
    return null;
  }
  // 把合成盤上某個系列「1 階到 t-1 階」的成對品項一路合上去（最高合出 t 階）。回傳合成次數。
  // 只動這個系列，不碰其他系列的東西
  // keep（可選）：被客人佔著的盤面索引。成對的兩個「都」被佔著就不合（合了件數會變少）
  ET.mergeUpTo = function (G, s, t, keep) {
    let n = 0;
    for (let k = 1; k < t && k < MAXT; k++) {
      let first = -1;
      for (let i = 0; i < N; i++) {
        const it = G.board[i];
        if (!it || it.s !== s || it.t !== k) continue;
        if (first < 0) first = i;
        else {
          if (keep && keep.has(first) && keep.has(i)) continue;
          ET.moveItem(G, i, first); n++;
          if (keep && (keep.has(first) || keep.has(i))) { keep.delete(i); keep.add(first); }
          first = -1;
        }
      }
    }
    return n;
  };
  // 保留：「客人在等的貨」+「空貨架設定的商品」，一對一分配給合成盤上現成的貨（難的、高階的先分）。
  // 回傳 reserved（被佔著的盤面索引）與 unfilled（盤上沒有現成貨可以滿足的需求）。
  // 自動出貨、機器人、備貨都不能賣掉 / 合掉 reserved 裡的東西，不然客人要的貨會被自動化吃掉。
  ET.reservedInfo = function (G) {
    const needs = unmetWants(G).map(w => ({ s: w.s, t: w.t }));
    for (const x of G.shop.shelves) if (!x.item && x.tpl) needs.push({ s: x.tpl.s, t: x.tpl.t });
    needs.sort((a, b) => b.t - a.t);
    const reserved = new Set(), unfilled = [];
    for (const nd of needs) {
      if (reserved.size >= S.reserveMax) { unfilled.push(nd); continue; }       // 上限：再多的需求不保護
      let best = -1, bv = Infinity;
      for (let k = 0; k < N; k++) {
        const it = G.board[k];
        if (!it || reserved.has(k) || it.s !== nd.s || it.t < nd.t) continue;
        const v = val(it.s, it.t);
        if (v < bv) { bv = v; best = k; }
      }
      if (best >= 0) reserved.add(best); else unfilled.push(nd);
    }
    return { reserved, unfilled };
  };
  ET.reservedSet = G => (G.unlocked.shop ? ET.reservedInfo(G).reserved : new Set());
  // 取得一件能滿足 tpl 的貨：盤上有現成的就用；沒有就先把同系列的低階貨合成上去再找。回傳盤面索引或 -1
  function supply(G, tpl) {
    let bi = findBoard(G, tpl);
    if (bi >= 0) return bi;
    if (ET.mergeUpTo(G, tpl.s, tpl.t, ET.reservedSet(G)) > 0) bi = findBoard(G, tpl);
    return bi;
  }
  // 店裡客人現在還缺什麼（扣掉貨架上已經夠格的）。貴族要 qty 件就列 qty 筆
  function unmetWants(G) {
    const sh = G.shop.shelves, out = [], used = new Set();
    for (const c of G.shop.custs) {
      if (c.kind === 'thief' || c.done) continue;
      const have = [];
      for (let i = 0; i < sh.length; i++) if (!used.has(i) && sh[i].item && sh[i].item.s === c.s && sh[i].item.t >= c.t) have.push(i);
      const take = have.slice(0, c.qty);
      for (const i of take) used.add(i);
      for (let k = take.length; k < c.qty; k++) out.push({ s: c.s, t: c.t });
    }
    return out;
  }
  // 補貨：把每個空貨架補滿。
  //  1. 照貨架的商品設定補；盤上沒有現成的，先把同系列低階貨合成出來
  //  2. 設定的商品做不出來 → 改做「排隊客人現在想要、而且做得出來」的東西（貨架設定跟著改）
  //  3. 沒設定、也沒人在等 → 建議盤上最多的 2 階以上品項
  // 回傳補了幾格
  ET.restock = function (G) {
    let n = 0;
    const sh = G.shop.shelves, wants = unmetWants(G);
    for (let i = 0; i < sh.length; i++) {
      if (sh[i].item) continue;
      let tpl = sh[i].tpl, bi = tpl ? supply(G, tpl) : -1;
      if (bi < 0) {
        for (let w = 0; w < wants.length; w++) {
          const b2 = supply(G, wants[w]);
          if (b2 >= 0) { tpl = { s: wants[w].s, t: wants[w].t }; bi = b2; break; }
        }
      }
      if (bi < 0 && !sh[i].tpl && !wants.length) { const sg = suggest(G); if (sg) { tpl = sg; bi = findBoard(G, sg); } }
      if (bi < 0) continue;
      const it = G.board[bi]; G.board[bi] = null;
      sh[i].item = it;
      sh[i].tpl = { s: tpl.s, t: tpl.t };
      const wi = wants.findIndex(w => w.s === it.s && w.t <= it.t);   // 這件貨滿足了一筆需求，就不要再為它補第二件
      if (wi >= 0) wants.splice(wi, 1);
      n++;
    }
    if (n) G.ver++;
    return n;
  };

  // ---------- 客人需求（給花園 / 合成的建議用） ----------
  ET.cropOf = series => Object.keys(ET.CROPS).find(c => ET.CROPS[c].series === series) || null;
  // 店裡客人現在缺什麼，依系列彙整：
  //   t = 需要的最高階、n = 要幾件、need = 折合 1 階的個數（2 階=2、3 階=4…）、have = 合成盤上這個系列折合 1 階的個數、short = 還差多少
  ET.demand = function (G) {
    const by = {};
    for (const w of unmetWants(G)) {
      const d = by[w.s] || (by[w.s] = { s: w.s, t: 0, n: 0, need: 0, tiers: {} });
      d.t = Math.max(d.t, w.t); d.n++; d.need += Math.pow(2, w.t - 1); d.tiers[w.t] = (d.tiers[w.t] || 0) + 1;
    }
    const out = [];
    for (const k of Object.keys(by).sort()) {
      const d = by[k]; let have = 0;
      for (const it of G.board) if (it && it.s === d.s) have += Math.pow(2, it.t - 1);
      d.have = have; d.short = Math.max(0, d.need - have);
      out.push(d);
    }
    out.sort((a, b) => b.short - a.short || b.need - a.need);
    return out;
  };
  // 為客人備貨：把客人要的系列先合成上去，再補貨上架。回傳 { merges, stocked, demand }（demand 是做完之後還缺的）
  ET.prepareDemand = function (G) {
    let merges = 0;
    for (const d of ET.demand(G)) merges += ET.mergeUpTo(G, d.s, d.t, ET.reservedSet(G));
    const stocked = ET.restock(G);
    return { merges, stocked, demand: ET.demand(G) };
  };
  // 「🍔、🥪×2」：這個系列客人要哪幾階、各幾件（高階在前）
  ET.wantText = d => Object.keys(d.tiers).map(Number).sort((a, b) => b - a).map(t => ET.SERIES[d.s].tiers[t - 1] + (d.tiers[t] > 1 ? '×' + d.tiers[t] : '')).join('、');
  ET.demandHint = function (G, d) {
    const S = ET.SERIES[d.s], crop = ET.cropOf(d.s), ce = crop ? ET.CROPS[crop].emoji : S.tiers[0];
    const want = ET.wantText(d);
    return d.short > 0 ? `客人在等 ${want}：${ce} 還差 ${d.short} 個，去花園多種 ${ce}` : `客人在等 ${want}：材料夠了！去 ⚗️ 按 🎯 為客人備貨`;
  };

  // ---------- 時間推進（由 ET.tick 呼叫） ----------
  ET.shopTick = function (G, dt) {
    if (!G.unlocked.shop) return;
    const sp = G.shop;
    ET.shopSync(G);
    sp.spawnT += dt;
    if (sp.spawnT >= sp.nextIv) {
      // 貨架上完全沒東西 = 店面沒在營業，客人不會進來（也就不會因為沒貨流失、拉低人氣）。
      // 計時停在「到了」，一上架下一個 tick 就會有客人
      if (!sp.shelves.some(x => x.item)) sp.spawnT = sp.nextIv;
      else {
        sp.spawnT = 0;
        spawnCust(G);
        sp.nextIv = (S.baseInterval / ET.rateMult(G)) * (0.7 + 0.6 * ET.rand(G));
      }
    }
    if (G.up.clerk > 0) {
      sp.restockT += dt;
      if (sp.restockT >= S.restockEvery) { sp.restockT = 0; ET.restock(G); }
    }
    for (const c of sp.custs) {
      c.wait += dt;
      if (c.kind === 'thief') {
        if (G.up.clerk > 0) { c.done = true; ev(G, { t: 'chase', cid: c.id, auto: true }); }
        else if (c.wait >= c.pat) steal(G, c);
        continue;
      }
      const idxs = qualifying(G, c);
      if (idxs) { c.okT += dt; if (c.okT >= S.serveDelay) sale(G, c, idxs, false); }
      else {
        c.okT = 0;
        if (c.wait >= c.pat) { c.done = true; sp.lost++; sp.pop = Math.max(0, sp.pop - 4); ev(G, { t: 'lost', cid: c.id }); }
      }
    }
    if (sp.custs.some(c => c.done)) sp.custs = sp.custs.filter(c => !c.done);
  };

  // ---------- 存檔 ----------
  const num = (x, d, lo, hi) => (typeof x === 'number' && isFinite(x) && x >= (lo == null ? 0 : lo) && (hi == null || x <= hi)) ? x : d;
  const okItem = it => it && ET.SERIES[it.s] && Number.isInteger(it.t) && it.t >= 1 && it.t <= MAXT;
  ET.sanitizeShop = function (o, nShelves, G) {
    const sp = ET.newShop(nShelves);
    if (!o || typeof o !== 'object') return sp;
    sp.pop = num(o.pop, 20, 0, 100);
    for (const k of ['sales', 'revenue', 'lost', 'stolen']) sp[k] = num(o[k], 0);
    sp.spawnT = num(o.spawnT, 0); sp.nextIv = num(o.nextIv, S.baseInterval, 1);
    sp.restockT = num(o.restockT, 0);
    if (Array.isArray(o.shelves)) {
      for (let i = 0; i < nShelves && i < o.shelves.length; i++) {
        const x = o.shelves[i]; if (!x || typeof x !== 'object') continue;
        if (okItem(x.item)) { sp.shelves[i].item = { id: Number.isInteger(x.item.id) && x.item.id > 0 ? x.item.id : G.nextId++, s: x.item.s, t: x.item.t }; G.nextId = Math.max(G.nextId, sp.shelves[i].item.id + 1); }
        if (okItem(x.tpl)) sp.shelves[i].tpl = { s: x.tpl.s, t: x.tpl.t };
      }
    }
    return sp;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
