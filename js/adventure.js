// S3 冒險 + 裝備：英雄、自動戰鬥、鍛造、裝備、料理補給。不碰 DOM；亂數走 ET.rand（G.rs）。
// 戰鬥以「每 1 秒一回合」推進（累積 dt），所以線上 tick 與離線補算結果一致。
(function (root) {
  'use strict';
  const ET = root.ET, AD = ET.ADV, MAXT = ET.MAXT, N = ET.COLS * ET.ROWS;
  const SLOTS = ['weapon', 'armor', 'trinket'];
  const ev = (G, o) => { if (G.ev.length < 300) G.ev.push(o); };
  const lvMul = l => 1 + 0.06 * (l - 1);      // 每級只 +6%：升級是輔助，推進主要靠裝備
  const roll = G => 0.9 + 0.2 * ET.rand(G);
  ET.SLOTS = SLOTS;
  ET.heroXpNeed = l => Math.round(20 * Math.pow(l, 1.5));
  ET.gearMul = t => Math.pow(ET.GEAR_MUL, t - 1);
  ET.isGear = s => !!(ET.SERIES[s] && ET.SERIES[s].gear);

  ET.newAdv = () => ({
    heroes: [], area: 1, stage: 1, reach: { 1: 1 }, open: { 1: true }, cleared: {},
    battle: null, acc: 0, recover: 0, hold: 0, nextId: 1, forged: {},
    food: { queue: [], act: null, left: 0 },
    stats: { stages: 0, kills: 0, defeats: 0, coins: 0, drops: 0 }
  });

  // ---------- 屬性 ----------
  function foodMod(A) {
    const f = A.food.act, m = { atk: 0, def: 0, hp: 0, regen: 0, xp: 0 };
    if (f && ET.FOOD[f.s] && ET.FOOD[f.s][f.t]) Object.assign(m, ET.FOOD[f.s][f.t]);
    return m;
  }
  ET.foodMod = G => (G.adv ? foodMod(G.adv) : { atk: 0, def: 0, hp: 0, regen: 0, xp: 0 });
  // 英雄目前屬性：職業底 × 等級 + 裝備（每高 1 階 ×1.7）× 料理加成
  ET.heroStats = function (G, h) {
    const R = ET.ROLES[h.role], k = lvMul(h.lvl), m = foodMod(G.adv);
    let hp = R.hp * k, atk = R.atk * k, def = R.def * k;
    for (const slot of SLOTS) {
      const g = h.gear[slot]; if (!g) continue;
      const b = ET.GEAR[g.s], mul = ET.gearMul(g.t);
      hp += (b.hp || 0) * mul; atk += (b.atk || 0) * mul; def += (b.def || 0) * mul;
    }
    return { hp: Math.round(hp * (1 + m.hp)), atk: atk * (1 + m.atk), def: def * (1 + m.def) };
  };
  const maxHp = (G, h) => ET.heroStats(G, h).hp;
  function addHero(G, role) {
    const A = G.adv, h = { id: A.nextId++, role, lvl: 1, xp: 0, hp: 0, gear: { weapon: null, armor: null, trinket: null } };
    h.hp = maxHp(G, h); A.heroes.push(h); return h;
  }
  // 戰力換算（給 UI 顯示用）：血量 × 攻擊 的粗估
  ET.heroPower = (G, h) => { const s = ET.heroStats(G, h); return Math.round(s.hp * 0.2 + s.atk * 4 + s.def * 6); };

  // ---------- 解鎖 ----------
  ET.advCheck = function (G) {
    if (G.unlocked.quest) return;
    if (G.unlocked.shop && G.stats.earned >= AD.unlockEarned) {
      G.unlocked.quest = true;
      G.adv = G.adv || ET.newAdv();
      if (!G.adv.heroes.length) addHero(G, 'sword');
      ev(G, { t: 'unlock', tab: 'quest' });
    }
  };

  // ---------- 招募（S3 暫時用金幣，S4 改成公會招募） ----------
  ET.recruitCost = G => (G.adv && G.adv.heroes.length < AD.partyMax) ? AD.recruitCost[G.adv.heroes.length] : Infinity;
  ET.recruit = function (G, role) {
    const A = G.adv;
    if (!A) return { ok: false, why: 'locked' };
    if (A.heroes.length >= AD.partyMax) return { ok: false, why: 'full' };
    if (!ET.ROLES[role] || A.heroes.some(h => h.role === role)) return { ok: false, why: 'dup' };
    const c = ET.recruitCost(G);
    if (G.coins < c) return { ok: false, why: 'coins' };
    G.coins -= c; addHero(G, role);
    ev(G, { t: 'recruit', role });
    return { ok: true };
  };

  // ---------- 鍛造 ----------
  ET.forgeCost = (G, id) => {
    const r = ET.FORGE.find(x => x.id === id);
    return r ? Math.round(r.coins * Math.pow(ET.FORGE_GROWTH, (G.adv && G.adv.forged[id]) || 0)) : Infinity;
  };
  // 合成盤上某系列折合 1 階的總個數
  ET.matMass = (G, series) => { let m = 0; for (const it of G.board) if (it && it.s === series) m += Math.pow(2, it.t - 1); return m; };
  function takeMass(G, series, need) {
    const idx = [];
    for (let i = 0; i < N; i++) if (G.board[i] && G.board[i].s === series) idx.push(i);
    idx.sort((a, b) => G.board[a].t - G.board[b].t || a - b);     // 低階先用
    let got = 0;
    for (const i of idx) { if (got >= need) break; got += Math.pow(2, G.board[i].t - 1); G.board[i] = null; }
    G.ver++;
  }
  ET.canForge = function (G, id) {
    const r = ET.FORGE.find(x => x.id === id);
    if (!r || !G.adv) return { ok: false, why: 'locked' };
    if (G.coins < ET.forgeCost(G, id)) return { ok: false, why: 'coins' };
    for (const s in r.mats) if (ET.matMass(G, s) < r.mats[s]) return { ok: false, why: 'mats', need: s };
    return { ok: true };
  };
  ET.forge = function (G, id) {
    const c = ET.canForge(G, id); if (!c.ok) return c;
    const r = ET.FORGE.find(x => x.id === id), A = G.adv;
    G.coins -= ET.forgeCost(G, id);
    for (const s in r.mats) takeMass(G, s, r.mats[s]);
    A.forged[id] = (A.forged[id] || 0) + 1;
    const slot = G.board.indexOf(null);             // 材料至少用掉 1 格，一定有空位
    ET.addItem(G, slot, r.s, 1);
    ev(G, { t: 'forge', s: r.s });
    return { ok: true, slot };
  };

  // ---------- 裝備 ----------
  const adjustHp = (G, h, before) => { const after = maxHp(G, h); if (h.hp > 0) h.hp = Math.min(after, h.hp + Math.max(0, after - before)); };
  ET.equip = function (G, bi, hid) {
    const A = G.adv, it = G.board[bi], h = A && A.heroes.find(x => x.id === hid);
    if (!it || !h || !ET.isGear(it.s)) return { ok: false };
    const slot = ET.SERIES[it.s].gear, old = h.gear[slot], before = maxHp(G, h);
    h.gear[slot] = { id: it.id, s: it.s, t: it.t };
    G.board[bi] = old ? { id: old.id, s: old.s, t: old.t } : null;     // 舊的換回同一格
    adjustHp(G, h, before); G.ver++;
    ev(G, { t: 'equip', hid });
    return { ok: true, swapped: !!old };
  };
  ET.unequip = function (G, hid, slot) {
    const A = G.adv, h = A && A.heroes.find(x => x.id === hid), g = h && h.gear[slot];
    if (!g) return { ok: false, why: 'empty' };
    const bi = G.board.indexOf(null); if (bi < 0) return { ok: false, why: 'full' };
    G.board[bi] = { id: g.id, s: g.s, t: g.t }; h.gear[slot] = null;
    h.hp = Math.min(h.hp, maxHp(G, h)); G.ver++;
    return { ok: true };
  };
  // 強化：合成盤上有一件「同系列、同階」的，吃掉它，身上這件 +1（兩件一樣的合成 → +1）
  ET.enhance = function (G, hid, slot) {
    const A = G.adv, h = A && A.heroes.find(x => x.id === hid), g = h && h.gear[slot];
    if (!g) return { ok: false, why: 'empty' };
    if (g.t >= MAXT) return { ok: false, why: 'max' };
    const bi = G.board.findIndex(it => it && it.s === g.s && it.t === g.t);
    if (bi < 0) return { ok: false, why: 'none' };
    const before = maxHp(G, h);
    G.board[bi] = null; g.t++; G.ver++;
    adjustHp(G, h, before);
    ev(G, { t: 'enhance', hid, tier: g.t });
    return { ok: true, tier: g.t };
  };

  // ---------- 料理補給 ----------
  ET.canPack = it => !!(it && ET.FOOD[it.s] && ET.FOOD[it.s][it.t]);
  ET.packFood = function (G, bi) {
    const A = G.adv, it = G.board[bi];
    if (!A || !ET.canPack(it)) return { ok: false, why: 'notfood' };
    if (A.food.queue.length >= ET.FOOD_QUEUE) return { ok: false, why: 'full' };
    A.food.queue.push({ id: it.id, s: it.s, t: it.t }); G.board[bi] = null; G.ver++;
    return { ok: true };
  };
  ET.unpackFood = function (G, qi) {
    const A = G.adv, f = A && A.food.queue[qi];
    if (!f) return { ok: false };
    const bi = G.board.indexOf(null); if (bi < 0) return { ok: false, why: 'full' };
    G.board[bi] = { id: f.id, s: f.s, t: f.t }; A.food.queue.splice(qi, 1); G.ver++;
    return { ok: true };
  };
  function tickFood(G) {
    const F = G.adv.food;
    if (F.act) { F.left--; if (F.left <= 0) { F.act = null; for (const h of G.adv.heroes) h.hp = Math.min(h.hp, maxHp(G, h)); } }
    if (!F.act && F.queue.length) { F.act = F.queue.shift(); F.left = ET.FOOD_SEC(F.act.t); ev(G, { t: 'food', s: F.act.s, tier: F.act.t }); }
  }

  // ---------- 關卡 ----------
  ET.advGo = function (G, area) {
    const A = G.adv;
    if (!A || !A.open[area]) return { ok: false };
    A.area = area; A.stage = Math.min(AD.stages, A.reach[area] || 1); A.battle = null;
    return { ok: true };
  };
  ET.enemyBase = function (area, stage) {
    return { hp: 18 * Math.pow(1.25, stage - 1) * Math.pow(4, area - 1), atk: 4 * Math.pow(1.17, stage - 1) * Math.pow(3, area - 1) };
  };
  function makeEnemies(area, stage) {
    const Ar = ET.AREAS[area - 1], b = ET.enemyBase(area, stage), list = [];
    const n = stage >= 8 ? 3 : stage >= 4 ? 2 : 1;
    const mk = (m, mulHp, mulAtk) => ({ e: m[0], name: m[1], hp: Math.round(b.hp * mulHp), maxhp: Math.round(b.hp * mulHp), atk: b.atk * mulAtk, def: Ar.def });
    if (stage === AD.stages) { list.push(mk(Ar.boss, 3.5, 1.4)); for (let i = 0; i < 2; i++) list.push(mk(Ar.mobs[i % Ar.mobs.length], 1, 1)); return list; }
    for (let i = 0; i < n; i++) list.push(mk(Ar.mobs[(stage + i) % Ar.mobs.length], 1, 1));
    return list;
  }
  ET.stageReward = (area, stage) => Math.round(6 * Math.pow(1.25, stage - 1) * Math.pow(3, area - 1) * (stage === AD.stages ? 2 : 1));

  function gainXp(G, amount) {
    for (const h of G.adv.heroes) {
      if (h.hp <= 0 || h.lvl >= AD.heroMaxLv) continue;
      h.xp += amount;
      while (h.lvl < AD.heroMaxLv && h.xp >= ET.heroXpNeed(h.lvl)) {
        h.xp -= ET.heroXpNeed(h.lvl); const before = maxHp(G, h); h.lvl++; adjustHp(G, h, before);
        ev(G, { t: 'lvl', hid: h.id, lvl: h.lvl });
      }
    }
  }
  function dropGear(G, area, boss) {
    const A = G.adv;
    if (ET.rand(G) >= (boss ? AD.dropBoss : AD.dropNormal)) return;
    const s = ['blade', 'plate', 'charm'][Math.floor(ET.rand(G) * 3)], t = area >= 2 && ET.rand(G) < 0.3 ? 2 : 1;
    A.stats.drops++;
    const slot = G.board.indexOf(null);
    if (slot >= 0) { ET.addItem(G, slot, s, t); ev(G, { t: 'drop', s, tier: t }); }
    else { const v = ET.value(s, t); G.coins += v; G.stats.earned += v; A.stats.coins += v; }     // 盤面滿了 → 直接折現，不浪費
  }
  function win(G) {
    const A = G.adv, area = A.area, stage = A.stage, boss = stage === AD.stages;
    const coins = ET.stageReward(area, stage);
    G.coins += coins; G.stats.earned += coins;
    A.stats.coins += coins; A.stats.stages++; A.stats.kills += A.battle.enemies.length;
    gainXp(G, Math.round(5 * stage * Math.pow(1.6, area - 1) * (1 + foodMod(A).xp)));
    dropGear(G, area, boss);
    A.reach[area] = Math.max(A.reach[area] || 1, Math.min(AD.stages, stage + 1));
    if (boss) {
      if (!A.cleared[area]) {
        A.cleared[area] = true;
        if (ET.AREAS[area]) {
          A.open[area + 1] = true; A.reach[area + 1] = A.reach[area + 1] || 1;
          A.area = area + 1; A.stage = Math.min(AD.stages, A.reach[area + 1]); A.hold = 0;       // 自動前進到下一區
          ev(G, { t: 'toast', text: `🎉 打倒 ${ET.AREAS[area - 1].boss[1]}！前進 ${ET.AREAS[area].emoji} ${ET.AREAS[area].name}` });
        } else ev(G, { t: 'toast', text: `🎉 打倒 ${ET.AREAS[area - 1].boss[1]}！` });
      }
    } else if (A.hold > 0) A.hold--;      // 剛全滅過：先在這一關多打幾場再往上
    else A.stage = stage + 1;
    A.battle = null;
    ev(G, { t: 'advwin', coins, stage, area });
  }
  function lose(G) {
    const A = G.adv;
    A.stats.defeats++; A.stage = Math.max(1, A.stage - 1); A.battle = null; A.recover = AD.recoverSec; A.hold = AD.holdWins;
    ev(G, { t: 'advlose' });
  }

  // ---------- 戰鬥（1 秒一回合） ----------
  function strike(G, e, dmg, fromHero) {
    e.hp -= dmg;
    ev(G, { t: 'hit', side: 'enemy', i: G.adv.battle.enemies.indexOf(e), dmg, from: fromHero });
  }
  function battleStep(G) {
    const A = G.adv, heroes = A.heroes;
    if (!heroes.length) return;
    tickFood(G);
    if (A.recover > 0) {
      A.recover--;
      if (A.recover === 0) for (const h of heroes) h.hp = maxHp(G, h);
      return;
    }
    if (!A.battle) A.battle = { enemies: makeEnemies(A.area, A.stage), t: 0 };
    const B = A.battle, fm = foodMod(A);
    B.t++;
    if (fm.regen) for (const h of heroes) if (h.hp > 0) h.hp = Math.min(maxHp(G, h), h.hp + fm.regen);
    const alive = () => heroes.filter(h => h.hp > 0), mobs = () => B.enemies.filter(e => e.hp > 0);
    // 英雄行動
    for (const h of heroes) {
      if (h.hp <= 0) continue;
      const ms = mobs(); if (!ms.length) break;
      const st = ET.heroStats(G, h);
      if (h.role === 'mage') { for (const e of ms) strike(G, e, Math.max(1, Math.round(st.atk * 0.6 * roll(G) - e.def)), h.id); }
      else if (h.role === 'elf' && B.t % 2 === 0) {
        let t = null, tr = 2;
        for (const x of alive()) { const r = x.hp / maxHp(G, x); if (r < tr) { tr = r; t = x; } }
        if (t) { const heal = Math.max(3, Math.round(st.atk * 2.2)); t.hp = Math.min(maxHp(G, t), t.hp + heal); ev(G, { t: 'heal', hid: t.id, v: heal }); }
      } else {
        const tgt = h.role === 'archer' ? ms[ms.length - 1] : ms[0];
        strike(G, tgt, Math.max(1, Math.round(st.atk * roll(G) - tgt.def)), h.id);
      }
    }
    if (!mobs().length) { win(G); return; }
    // 敵人行動：有騎士時 60% 打騎士（嘲諷），其他隨機
    for (const e of mobs()) {
      const al = alive(); if (!al.length) break;
      const kn = al.filter(h => h.role === 'knight');
      const t = (kn.length && ET.rand(G) < 0.6) ? kn[Math.floor(ET.rand(G) * kn.length)] : al[Math.floor(ET.rand(G) * al.length)];
      const dmg = Math.max(1, Math.round(e.atk * roll(G) - ET.heroStats(G, t).def));
      t.hp -= dmg; if (t.hp < 0) t.hp = 0;
      ev(G, { t: 'hit', side: 'hero', hid: t.id, dmg });
    }
    if (!alive().length) lose(G);
  }
  ET.advTick = function (G, dt) {
    const A = G.adv; if (!A) return;
    A.acc += dt;
    while (A.acc >= 1) { A.acc -= 1; battleStep(G); }
  };
  // 點怪物：額外傷害（隊伍最高攻擊的一半）
  ET.advTap = function (G, i) {
    const A = G.adv, B = A && A.battle, e = B && B.enemies[i];
    if (!e || e.hp <= 0) return { ok: false };
    let top = 0; for (const h of A.heroes) if (h.hp > 0) top = Math.max(top, ET.heroStats(G, h).atk);
    const dmg = Math.max(1, Math.round(top * 0.5 - e.def));
    strike(G, e, dmg, 0); G.stats.taps++;
    if (B.enemies.every(x => x.hp <= 0)) win(G);
    return { ok: true, dmg };
  };

  // ---------- 存檔 ----------
  const num = (x, d, lo, hi) => (typeof x === 'number' && isFinite(x) && x >= (lo == null ? 0 : lo) && (hi == null || x <= hi)) ? x : d;
  ET.sanitizeAdv = function (o, G) {
    const A = ET.newAdv();
    if (!o || typeof o !== 'object') return A;
    const okItem = (g, slot) => g && ET.isGear(g.s) && (!slot || ET.SERIES[g.s].gear === slot) && Number.isInteger(g.t) && g.t >= 1 && g.t <= MAXT;
    const newId = () => G.nextId++;
    A.nextId = Math.max(1, Math.floor(num(o.nextId, 1, 1)));
    if (Array.isArray(o.heroes)) {
      for (const x of o.heroes.slice(0, AD.partyMax)) {
        if (!x || !ET.ROLES[x.role] || A.heroes.some(h => h.role === x.role)) continue;
        const h = { id: Number.isInteger(x.id) && x.id > 0 ? x.id : A.nextId++, role: x.role, lvl: Math.floor(num(x.lvl, 1, 1, AD.heroMaxLv)), xp: num(x.xp, 0), hp: 0, gear: { weapon: null, armor: null, trinket: null } };
        A.nextId = Math.max(A.nextId, h.id + 1);
        for (const slot of SLOTS) { const g = x.gear && x.gear[slot]; if (okItem(g, slot)) { h.gear[slot] = { id: Number.isInteger(g.id) && g.id > 0 ? g.id : newId(), s: g.s, t: g.t }; G.nextId = Math.max(G.nextId, h.gear[slot].id + 1); } }
        A.heroes.push(h);
      }
    }
    A.area = Math.min(ET.AREAS.length, Math.max(1, Math.floor(num(o.area, 1, 1))));
    for (let a = 1; a <= ET.AREAS.length; a++) {
      A.open[a] = a === 1 || !!(o.open && o.open[a]);
      A.cleared[a] = !!(o.cleared && o.cleared[a]);
      A.reach[a] = Math.min(AD.stages, Math.max(1, Math.floor(num(o.reach && o.reach[a], 1, 1))));
    }
    if (!A.open[A.area]) A.area = 1;
    A.stage = Math.min(AD.stages, Math.max(1, Math.floor(num(o.stage, 1, 1))));
    A.recover = Math.floor(num(o.recover, 0, 0, AD.recoverSec));
    A.hold = Math.floor(num(o.hold, 0, 0, 20));
    for (const k of ['blade', 'plate', 'charm']) if (o.forged && o.forged[k]) A.forged[k] = Math.floor(num(o.forged[k], 0));
    if (o.food && typeof o.food === 'object') {
      if (Array.isArray(o.food.queue)) for (const f of o.food.queue.slice(0, ET.FOOD_QUEUE)) if (ET.canPack(f) && Number.isInteger(f.t)) { A.food.queue.push({ id: Number.isInteger(f.id) && f.id > 0 ? f.id : newId(), s: f.s, t: f.t }); }
      const f = o.food.act;
      if (ET.canPack(f) && Number.isInteger(f.t)) { A.food.act = { id: Number.isInteger(f.id) && f.id > 0 ? f.id : newId(), s: f.s, t: f.t }; A.food.left = Math.floor(num(o.food.left, 1, 1, ET.FOOD_SEC(f.t))); }
    }
    if (o.stats && typeof o.stats === 'object') for (const k of Object.keys(A.stats)) A.stats[k] = num(o.stats[k], 0);
    // 血量：存的 hp 若不合理就補滿
    A.heroes.forEach((h, i) => { const x = Array.isArray(o.heroes) ? o.heroes.find(y => y && y.role === h.role) : null; const m = maxHp({ adv: A }, h); h.hp = x && typeof x.hp === 'number' && isFinite(x.hp) && x.hp >= 0 ? Math.min(m, Math.round(x.hp)) : m; });
    G.nextId = Math.max(G.nextId, A.nextId);
    return A;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
