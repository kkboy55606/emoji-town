// 核心邏輯：不碰 DOM、不碰 Date.now()（時間都由呼叫端傳入），可在 Node 直接跑測試與模擬。
(function (root) {
  'use strict';
  const ET = root.ET;
  const N = ET.COLS * ET.ROWS, MAXT = ET.MAXT;

  const ev = (G, o) => { if (G.ev.length < 300) G.ev.push(o); };
  const speed = G => 1 + 0.12 * G.up.fert;
  const boostSec = G => 1 + 0.5 * G.up.click;
  const botInterval = l => 8 * Math.pow(0.8, l - 1);
  const botMaxTier = l => Math.min(4, l);
  const cropOpen = (G, c) => G.age >= ET.CROPS[c].unlockAge;
  const cropTime = pl => ET.CROPS[pl.crop].time;
  const isRipe = pl => !!pl.crop && pl.p >= cropTime(pl);
  const space = G => G.board.indexOf(null);

  ET.offlineCapHours = G => 4 + G.up.offline;
  ET.botInterval = botInterval;
  ET.botMaxTier = botMaxTier;
  ET.speed = speed;
  ET.cropSeconds = (G, crop) => ET.CROPS[crop].time / speed(G);     // 套用肥料後，這個作物實際幾秒長成
  ET.isRipe = isRipe;
  ET.cropOpen = cropOpen;
  // 價值表：預先算好（離線補算會呼叫上千萬次，不能每次都 Math.pow）
  const VAL = {};
  for (const s in ET.SERIES) { VAL[s] = [0]; for (let t = 1; t <= MAXT; t++) VAL[s].push(Math.round(ET.SERIES[s].base * Math.pow(2.5, t - 1))); }
  ET.value = (s, t) => VAL[s][t];

  // ---------- 數字格式 ----------
  ET.fmt = function (n) {
    if (!isFinite(n)) return '∞';
    n = Math.floor(Math.max(0, n));
    if (n < 1000) return String(n);
    if (n >= 1e15) return n.toExponential(2).replace('+', '');
    const u = ['K', 'M', 'B', 'T'];
    let v = n, i = -1;
    while (v >= 999.5 && i < 3) { v /= 1000; i++; }
    const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0);
    return (s.includes('.') ? s.replace(/\.?0+$/, '') : s) + u[i];
  };

  // ---------- 狀態 ----------
  ET.newState = function (now) {
    const G = {
      v: ET.VERSION, age: 0, coins: 0, selected: 'wheat',
      plots: [], board: new Array(N).fill(null), nextId: 1,
      up: {},
      expand: 0, botT: 0,
      unlocked: { merge: false, shop: false, quest: false }, seen: {}, dex: {}, hints: {},
      stats: { harvested: {}, merges: 0, sold: 0, earned: 0, taps: 0 },
      ver: 0, ev: [], savedAt: now || 0
    };
    for (const u of ET.UPGRADES) G.up[u.id] = 0;
    G.rs = (Math.imul((now | 0) || 1, 2654435761) >>> 0) || 1;
    G.shop = ET.newShop(ET.SHOP.baseShelves);
    G.adv = null;
    for (let i = 0; i < ET.START_PLOTS; i++) G.plots.push({ crop: null, p: 0 });
    return G;
  };

  function discover(G, s, t) {
    const k = s + ':' + t;
    if (G.dex[k]) return;
    G.dex[k] = 1;
    if (t >= 2) ev(G, { t: 'toast', text: `📖 發現 ${ET.SERIES[s].tiers[t - 1]} ${ET.SERIES[s].names[t - 1]}` });
  }
  ET.addItem = (G, slot, s, t) => addItem(G, slot, s, t);
  function addItem(G, slot, s, t) {
    G.board[slot] = { id: G.nextId++, s, t };
    G.ver++;
    discover(G, s, t);
  }
  function hasPair(G) {
    const c = {};
    for (const it of G.board) {
      if (!it || it.t >= MAXT) continue;
      const k = it.s + ':' + it.t;
      if ((c[k] = (c[k] || 0) + 1) >= 2) return true;
    }
    return false;
  }
  function checkUnlocks(G) {
    if (!G.unlocked.merge && (G.age >= 120 || hasPair(G))) {
      G.unlocked.merge = true;
      ev(G, { t: 'unlock', tab: 'merge' });
    }
    ET.advCheck(G);
    if (!G.unlocked.shop) {
      for (const k in G.dex) {
        if (+k.split(':')[1] >= 2) { G.unlocked.shop = true; ev(G, { t: 'unlock', tab: 'shop' }); break; }
      }
    }
  }

  // ---------- 花園 ----------
  function harvestInternal(G, i) {
    const pl = G.plots[i], C = ET.CROPS[pl.crop];
    const slot = space(G);
    addItem(G, slot, C.series, 1);
    pl.p = Math.max(0, pl.p - C.time);
    G.stats.harvested[pl.crop] = (G.stats.harvested[pl.crop] || 0) + 1;
    ev(G, { t: 'harvest', i, crop: pl.crop });
  }
  ET.harvest = function (G, i) {
    const pl = G.plots[i];
    if (!pl || !pl.crop) return { ok: false, why: 'empty' };
    if (!isRipe(pl)) return { ok: false, why: 'growing' };
    if (space(G) < 0) { ev(G, { t: 'full' }); return { ok: false, why: 'full' }; }
    harvestInternal(G, i);
    checkUnlocks(G);
    return { ok: true };
  };
  ET.plant = function (G, i, crop) {
    const pl = G.plots[i];
    if (!pl || !ET.CROPS[crop] || !cropOpen(G, crop)) return false;
    if (pl.crop) return false;
    pl.crop = crop; pl.p = 0;
    ev(G, { t: 'plant', i, crop });
    return true;
  };
  // 點一格：空地→種；熟了→收；長中→加速（opts.boost=false 時不加速，用於滑動）
  ET.tapPlot = function (G, i, opts) {
    const pl = G.plots[i];
    if (!pl) return { act: 'none' };
    if (!pl.crop) return { act: ET.plant(G, i, G.selected) ? 'plant' : 'none' };
    if (isRipe(pl)) { const r = ET.harvest(G, i); return { act: r.ok ? 'harvest' : (r.why === 'full' ? 'full' : 'none') }; }
    if (opts && opts.boost === false) return { act: 'none' };
    pl.p = Math.min(cropTime(pl), pl.p + boostSec(G));
    G.stats.taps++;
    ev(G, { t: 'boost', i });
    return { act: 'boost' };
  };
  // 長按改種：已種了別的作物 → 換掉（進度歸零；熟了先收）
  ET.replace = function (G, i, crop) {
    const pl = G.plots[i];
    if (!pl || !pl.crop || pl.crop === crop || !ET.CROPS[crop] || !cropOpen(G, crop)) return false;
    if (isRipe(pl)) ET.harvest(G, i);
    pl.crop = crop; pl.p = 0;
    ev(G, { t: 'plant', i, crop });
    return true;
  };
  ET.plantAll = function (G, crop) {
    if (!ET.CROPS[crop] || !cropOpen(G, crop)) return 0;
    let n = 0;
    for (let i = 0; i < G.plots.length; i++) {
      const pl = G.plots[i];
      if (!pl.crop) { if (ET.plant(G, i, crop)) n++; }
      else if (pl.crop !== crop && ET.replace(G, i, crop)) n++;
    }
    return n;
  };
  ET.select = function (G, crop) {
    if (!ET.CROPS[crop] || !cropOpen(G, crop)) return false;
    G.selected = crop; return true;
  };

  // ---------- 合成盤 ----------
  ET.canMerge = function (G, a, b) {
    const A = G.board[a], B = G.board[b];
    return !!(A && B && a !== b && A.s === B.s && A.t === B.t && A.t < MAXT);
  };
  // 拖曳 / 點選的統一入口：空格=移動、同物同階=合成、其他=交換
  ET.moveItem = function (G, a, b) {
    if (a === b || a < 0 || b < 0 || a >= N || b >= N) return { ok: false };
    const A = G.board[a], B = G.board[b];
    if (!A) return { ok: false };
    if (!B) { G.board[b] = A; G.board[a] = null; G.ver++; return { ok: true, kind: 'move', to: b }; }
    if (ET.canMerge(G, a, b)) {
      B.t++; G.board[a] = null; G.ver++; G.stats.merges++;
      discover(G, B.s, B.t);
      ev(G, { t: 'merge', to: b, tier: B.t, s: B.s });
      checkUnlocks(G);
      return { ok: true, kind: 'merge', to: b, tier: B.t };
    }
    G.board[a] = B; G.board[b] = A; G.ver++;
    return { ok: true, kind: 'swap', to: b };
  };
  ET.sell = function (G, i) {
    const it = G.board[i];
    if (!it) return { ok: false };
    const v = ET.value(it.s, it.t);
    G.coins += v; G.stats.earned += v; G.stats.sold++;
    G.board[i] = null; G.ver++;
    ev(G, { t: 'sell', i, v });
    return { ok: true, v };
  };
  ET.count = G => G.board.reduce((n, it) => n + (it ? 1 : 0), 0);
  ET.hasPair = hasPair;
  // 一鍵合成：由低階到高階，把盤面上所有成對的同物一路合到不能合（5 階封頂）。回傳合成次數
  // keep（可選）：被客人佔著的盤面索引；成對的兩個「都」被佔著就不合（自動化用，手動按鈕不帶）
  ET.mergeAll = function (G, keep) {
    let n = 0;
    for (let t = 1; t < MAXT; t++) {
      const first = {};
      for (let i = 0; i < N; i++) {
        const it = G.board[i];
        if (!it || it.t !== t) continue;
        const s = it.s, f = first[s];
        if (f == null) first[s] = i;
        else {
          if (keep && keep.has(f) && keep.has(i)) continue;
          ET.moveItem(G, i, f); n++;
          if (keep && (keep.has(f) || keep.has(i))) { keep.delete(i); keep.add(f); }
          delete first[s];
        }
      }
    }
    return n;
  };

  function botStep(G) {
    const maxT = botMaxTier(G.up.bot);
    // 被客人佔著的貨：成對的兩個「都」被佔著就不合（合了件數會變少，貴族要 3 件會變 2 件）
    const keep = G.unlocked.shop ? ET.reservedSet(G) : null;
    const blocked = (a, b) => keep && keep.has(a) && keep.has(b);
    // 有客人在等的話，先合成客人要的系列（只合成到他需要的階數以下）
    if (G.unlocked.shop && G.shop.custs.length) {
      for (const d of ET.demand(G)) {
        for (let t = 1; t <= Math.min(maxT, d.t - 1); t++) {
          let first = -1;
          for (let i = 0; i < N; i++) {
            const it = G.board[i];
            if (!it || it.s !== d.s || it.t !== t) continue;
            if (first < 0) first = i;
            else if (!blocked(first, i)) { ET.moveItem(G, i, first); return true; }
          }
        }
      }
    }
    for (let t = 1; t <= maxT; t++) {
      const first = {};
      for (let i = 0; i < N; i++) {
        const it = G.board[i];
        if (!it || it.t !== t) continue;
        if (first[it.s] == null) first[it.s] = i;
        else if (!blocked(first[it.s], i)) { ET.moveItem(G, i, first[it.s]); return true; }
      }
    }
    return false;
  }
  // 自動出貨：盤面擠了（>= SHIP_HIGH）→ 先一鍵合成到最高階（合成會讓同樣的料變值錢），
  // 還是太擠才賣，而且優先賣最貴的（一格換最多錢），賣到剩 SHIP_LOW 個
  // 客人在等的貨、空貨架設定的商品（reservedSet）不合、不賣：不然「優先賣最貴的」會先賣掉客人要的
  function shipStep(G) {
    if (ET.count(G) < ET.SHIP_HIGH) return;
    ET.mergeAll(G, ET.reservedSet(G));
    if (ET.count(G) <= ET.SHIP_LOW) return;
    const keep = ET.reservedSet(G);          // 合成後索引變了，重算
    const order = [];
    for (let i = 0; i < N; i++) { const it = G.board[i]; if (it && !keep.has(i) && !ET.isGear(it.s)) order.push([VAL[it.s][it.t], i]); }     // 裝備不自動賣
    order.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    let n = ET.count(G), k = 0;
    while (n > ET.SHIP_LOW && k < order.length) { ET.sell(G, order[k++][1]); n--; }
  }

  // ---------- 時間推進 ----------
  ET.tick = function (G, dt) {
    if (!(dt > 0)) return;
    G.age += dt;
    const sp = speed(G), farmer = G.up.farmer > 0;
    for (let i = 0; i < G.plots.length; i++) {
      const pl = G.plots[i];
      if (!pl.crop) continue;
      const T = cropTime(pl);
      pl.p += dt * sp;
      while (pl.p >= T) {
        if (farmer && space(G) >= 0) harvestInternal(G, i);
        else { pl.p = T; break; }
      }
    }
    if (G.up.bot > 0) {
      G.botT += dt;
      const iv = botInterval(G.up.bot);
      if (G.botT >= iv) G.botT = botStep(G) ? 0 : iv;
    }
    ET.shopTick(G, dt);
    if (G.adv) ET.advTick(G, dt);
    if (G.up.shipper > 0) shipStep(G);
    checkUnlocks(G);
  };

  // 離線補算：用 1 秒一格跑同一個 tick，所以結果和線上一致
  ET.offline = function (G, sec) {
    const cap = ET.offlineCapHours(G) * 3600;
    const used = Math.min(sec, cap);
    if (!(used >= 1)) return null;
    const before = { merges: G.stats.merges, earned: G.stats.earned, sold: G.stats.sold, h: Object.assign({}, G.stats.harvested),
      shop: { sales: G.shop.sales, lost: G.shop.lost, stolen: G.shop.stolen, revenue: G.shop.revenue },
      adv: G.adv ? { stages: G.adv.stats.stages, defeats: G.adv.stats.defeats, coins: G.adv.stats.coins, drops: G.adv.stats.drops, lv: G.adv.heroes.reduce((m, h) => m + h.lvl, 0) } : null };
    const steps = Math.floor(used);
    for (let i = 0; i < steps; i++) ET.tick(G, 1);
    G.ev.length = 0;
    const harvested = {};
    for (const k in G.stats.harvested) {
      const d = G.stats.harvested[k] - (before.h[k] || 0);
      if (d > 0) harvested[k] = d;
    }
    return { sec: steps, rawSec: sec, capped: sec > cap, harvested, merges: G.stats.merges - before.merges, earned: G.stats.earned - before.earned, sold: G.stats.sold - before.sold,
      advStages: G.adv && before.adv ? G.adv.stats.stages - before.adv.stages : 0, advDefeats: G.adv && before.adv ? G.adv.stats.defeats - before.adv.defeats : 0,
      advCoins: G.adv && before.adv ? G.adv.stats.coins - before.adv.coins : 0, advDrops: G.adv && before.adv ? G.adv.stats.drops - before.adv.drops : 0,
      advLevels: G.adv && before.adv ? G.adv.heroes.reduce((m, h) => m + h.lvl, 0) - before.adv.lv : 0,
      shopSales: G.shop.sales - before.shop.sales, shopRevenue: G.shop.revenue - before.shop.revenue, shopLost: G.shop.lost - before.shop.lost, shopStolen: G.shop.stolen - before.shop.stolen };
  };
  // 從存檔時間算出離線秒數；系統時間倒退 → 0
  ET.offlineSeconds = function (G, now) {
    const s = (now - G.savedAt) / 1000;
    return s > 0 && isFinite(s) ? s : 0;
  };

  // ---------- 升級 / 擴建 ----------
  ET.upgradeCost = (G, id) => { const u = ET.UPGRADE_BY_ID[id]; return G.up[id] >= u.max ? Infinity : u.cost(G.up[id]); };
  ET.buy = function (G, id) {
    const u = ET.UPGRADE_BY_ID[id];
    if (!u) return { ok: false, why: 'unknown' };
    if (G.up[id] >= u.max) return { ok: false, why: 'max' };
    const c = u.cost(G.up[id]);
    if (G.coins < c) return { ok: false, why: 'coins' };
    G.coins -= c; G.up[id]++;
    if (id === 'shelf') ET.shopSync(G);
    ev(G, { t: 'buy', id });
    return { ok: true, cost: c };
  };
  ET.expandCost = G => G.expand >= ET.EXPAND.length ? Infinity : ET.EXPAND[G.expand].cost;
  ET.buyExpand = function (G) {
    if (G.expand >= ET.EXPAND.length) return { ok: false, why: 'max' };
    const E = ET.EXPAND[G.expand];
    if (G.coins < E.cost) return { ok: false, why: 'coins' };
    G.coins -= E.cost; G.expand++;
    while (G.plots.length < E.n) G.plots.push({ crop: null, p: 0 });
    ev(G, { t: 'expand' });
    return { ok: true };
  };
  // 有沒有買得起的東西（給紅點用）
  ET.affordable = function (G) {
    for (const u of ET.UPGRADES) if ((u.group !== 'shop' || G.unlocked.shop) && G.up[u.id] < u.max && G.coins >= u.cost(G.up[u.id])) return true;
    return false;
  };
  // 升級頁可見規則：已買過、或錢夠到成本的 30%、或曾經看過
  ET.upgradeVisible = function (G, id) {
    const u = ET.UPGRADE_BY_ID[id];
    if (u.group === 'shop' && !G.unlocked.shop) return false;
    if (G.up[id] > 0 || G.seen[id]) return true;
    if (G.coins >= u.cost(0) * 0.3) { G.seen[id] = 1; return true; }
    return false;
  };

  // ---------- 提示（新手引導的最小版） ----------
  ET.hint = function (G) {
    if (!G.plots.some(p => p.crop)) return '點空地種下 🌾（手指滑過去可以連續種）';
    const items = ET.count(G), ripe = G.plots.some(isRipe);
    if (items === 0 && G.stats.sold === 0 && G.stats.merges === 0) return ripe ? '冒光的作物熟了，點它收成！' : '點正在長的作物可以加速成長';
    if (!G.unlocked.merge) return '收成的東西會放進合成盤，湊到兩個一樣的就能合成';
    if (G.stats.merges === 0) return '去 ⚗️ 合成：把兩個一樣的拖在一起';
    if (G.unlocked.shop && G.shop.sales === 0) {
      return G.shop.shelves.some(x => x.item) ? '客人會自己來買。點客人可以立刻結帳，還有小費' : '🏪 開張了！去商店點貨架，把東西上架給客人買（比賣出區貴）';
    }
    if (G.stats.sold === 0 && G.shop.sales === 0) return '把東西拖到下面的 💰 賣出區換錢';
    if (G.unlocked.shop) { const dm = ET.demand(G); if (dm.length) return ET.demandHint(G, dm[0]); }
    if (G.unlocked.quest && G.adv && G.adv.heroes.length && G.adv.heroes.every(h => !h.gear.weapon) && !G.board.some(it => it && it.s === 'blade')) return '⚔️ 冒險開放了！去冒險頁點 🔨 鍛造，打造一把武器給英雄';
    if (G.up.farmer === 0) return '點右上 ⬆️ 升級：買 🚜 農夫就能自動收成';
    return '';
  };

  // ---------- 存檔 ----------
  ET.save = function (G, now) {
    G.savedAt = now;
    const o = Object.assign({}, G); delete o.ev;
    o.shop = Object.assign({}, G.shop, { custs: [] });      // 客人是暫時的，不存
    o.adv = G.adv ? Object.assign({}, G.adv, { battle: null, acc: 0 }) : null;     // 戰鬥從頭開始，不存進行中的那場
    return JSON.stringify(o);
  };
  const num = (x, d, lo) => (typeof x === 'number' && isFinite(x) && x >= (lo == null ? 0 : lo)) ? x : d;
  ET.load = function (str) {
    let o;
    try { o = JSON.parse(str); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== ET.VERSION) return null;
    const G = ET.newState(0);
    G.age = num(o.age, 0); G.coins = num(o.coins, 0); G.botT = num(o.botT, 0); G.savedAt = num(o.savedAt, 0);
    G.selected = ET.CROPS[o.selected] ? o.selected : 'wheat';
    for (const u of ET.UPGRADES) G.up[u.id] = Math.min(u.max, Math.floor(num(o.up && o.up[u.id], 0)));
    G.expand = Math.min(ET.EXPAND.length, Math.floor(num(o.expand, 0)));
    const nPlots = G.expand > 0 ? ET.EXPAND[G.expand - 1].n : ET.START_PLOTS;
    G.plots = [];
    for (let i = 0; i < nPlots; i++) {
      const p = Array.isArray(o.plots) ? o.plots[i] : null;
      G.plots.push(p && ET.CROPS[p.crop] ? { crop: p.crop, p: num(p.p, 0) } : { crop: null, p: 0 });
    }
    let maxId = 0;
    G.board = new Array(N).fill(null);
    if (Array.isArray(o.board)) {
      for (let i = 0; i < N; i++) {
        const it = o.board[i];
        if (it && ET.SERIES[it.s] && Number.isInteger(it.t) && it.t >= 1 && it.t <= MAXT) {
          const id = Number.isInteger(it.id) && it.id > 0 ? it.id : ++maxId;
          G.board[i] = { id, s: it.s, t: it.t };
          maxId = Math.max(maxId, id);
        }
      }
    }
    G.nextId = Math.max(maxId + 1, num(o.nextId, 1, 1));
    G.unlocked.merge = !!(o.unlocked && o.unlocked.merge);
    G.unlocked.shop = !!(o.unlocked && o.unlocked.shop);
    G.rs = (Math.floor(num(o.rs, G.rs, 1)) >>> 0) || G.rs;
    G.shop = ET.sanitizeShop(o.shop, ET.shelfCount(G), G);
    G.unlocked.quest = !!(o.unlocked && o.unlocked.quest);
    G.adv = G.unlocked.quest || o.adv ? ET.sanitizeAdv(o.adv, G) : null;
    if (G.adv && !G.unlocked.quest && G.adv.heroes.length) G.unlocked.quest = true;
    if (G.adv && !G.unlocked.quest) G.adv = null;      // 還沒解鎖、也沒有英雄：不留空殼
    if (G.unlocked.quest && !G.adv) G.adv = ET.newAdv();
    if (G.adv && !G.adv.heroes.length && G.unlocked.quest) { const A = G.adv; A.heroes.push({ id: A.nextId++, role: 'sword', lvl: 1, xp: 0, hp: 0, gear: { weapon: null, armor: null, trinket: null } }); A.heroes[0].hp = ET.heroStats(G, A.heroes[0]).hp; }
    for (const k of ['seen', 'dex', 'hints']) if (o[k] && typeof o[k] === 'object') G[k] = Object.assign({}, o[k]);
    if (o.stats && typeof o.stats === 'object') {
      G.stats.merges = num(o.stats.merges, 0); G.stats.sold = num(o.stats.sold, 0);
      G.stats.earned = num(o.stats.earned, 0); G.stats.taps = num(o.stats.taps, 0);
      if (o.stats.harvested && typeof o.stats.harvested === 'object') {
        for (const k in o.stats.harvested) if (ET.CROPS[k]) G.stats.harvested[k] = num(o.stats.harvested[k], 0);
      }
    }
    return G;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
