// 用法：node tests/core.test.js   （或 npm test）
// 把 js/data.js + js/core.js 載入同一個 vm context，無 DOM 執行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = {};
vm.createContext(ctx);
for (const f of ['js/data.js', 'js/core.js', 'js/shop.js', 'js/adventure.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
const ET = ctx.ET;
const N = ET.COLS * ET.ROWS;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); }
}
const fresh = () => ET.newState(0);
const give = (G, i, s, t) => { G.board[i] = { id: G.nextId++, s, t }; G.ver++; };
// 全部種上小麥
const plantAll = G => { G.plots.forEach((p, i) => ET.plant(G, i, 'wheat')); };
// 遊戲內「等價 1 階數量」：合成不應改變它（守恆）
const mass = G => G.board.reduce((n, it) => n + (it ? Math.pow(2, it.t - 1) : 0), 0);

console.log('數字格式');
test('fmt', () => {
  const c = [[0, '0'], [999, '999'], [1000, '1K'], [1234, '1.23K'], [15000, '15K'], [999999, '1M'], [1.5e6, '1.5M'], [100000, '100K'], [2e15, '2.00e15'], [-5, '0'], [NaN, '∞']];
  for (const [n, s] of c) assert.strictEqual(ET.fmt(n), s, String(n));
});
test('物品價值：每階 ×2.5', () => {
  assert.strictEqual(ET.value('wheat', 1), 1);
  assert.strictEqual(ET.value('wheat', 2), 3);
  assert.strictEqual(ET.value('wheat', 5), 39);
  assert.strictEqual(ET.value('flower', 5), 156);
});

console.log('花園');
test('種小麥 10 秒後熟；收成進合成盤並自動重種（進度歸零）', () => {
  const G = fresh();
  assert.ok(ET.plant(G, 0, 'wheat'));
  ET.tick(G, 9.9); assert.ok(!ET.isRipe(G.plots[0]));
  ET.tick(G, 0.1); assert.ok(ET.isRipe(G.plots[0]));
  const r = ET.harvest(G, 0);
  assert.ok(r.ok);
  assert.strictEqual(G.board[0].s, 'wheat'); assert.strictEqual(G.board[0].t, 1);
  assert.strictEqual(G.plots[0].crop, 'wheat'); assert.ok(G.plots[0].p < 1e-9);
});
test('不能重複種、不能種還沒解鎖的作物', () => {
  const G = fresh();
  assert.ok(ET.plant(G, 0, 'wheat')); assert.ok(!ET.plant(G, 0, 'apple'));
  assert.ok(!ET.plant(G, 1, 'flower'), '🌸 3 分鐘後才解鎖');
  G.age = 180; assert.ok(ET.plant(G, 1, 'flower'));
});
test('肥料提高成長速度', () => {
  const G = fresh(); G.up.fert = 5; ET.plant(G, 0, 'wheat');
  ET.tick(G, 6.3);               // 1+0.12*5 = 1.6 倍 → 10/1.6 = 6.25 秒
  assert.ok(ET.isRipe(G.plots[0]));
});
test('點擊加速，不超過成熟；滑動（boost:false）不加速', () => {
  const G = fresh(); ET.plant(G, 0, 'wheat');
  assert.strictEqual(ET.tapPlot(G, 0).act, 'boost');
  assert.strictEqual(G.plots[0].p, 1);
  ET.tapPlot(G, 0, { boost: false }); assert.strictEqual(G.plots[0].p, 1);
  G.up.click = 10; ET.tapPlot(G, 0);   // 1 + 6 = 7
  ET.tapPlot(G, 0);                    // 7 + 6 → 夾在 10
  assert.strictEqual(G.plots[0].p, 10, '不會超過成熟時間');
});
test('tapPlot：空地種選中的作物、熟了收成', () => {
  const G = fresh(); G.selected = 'apple';
  assert.strictEqual(ET.tapPlot(G, 3).act, 'plant'); assert.strictEqual(G.plots[3].crop, 'apple');
  ET.tick(G, 20); assert.strictEqual(ET.tapPlot(G, 3).act, 'harvest');
});
test('盤面滿了不能收成，作物停在熟的狀態；騰出空位後可收', () => {
  const G = fresh(); ET.plant(G, 0, 'wheat');
  for (let i = 0; i < N; i++) give(G, i, 'wood', 1);
  ET.tick(G, 30);
  assert.strictEqual(ET.harvest(G, 0).why, 'full');
  assert.strictEqual(G.plots[0].p, 10, '停在熟');
  ET.sell(G, 5);
  assert.ok(ET.harvest(G, 0).ok);
});
test('農夫：自動收成；盤滿時暫停，空位出現後繼續', () => {
  const G = fresh(); G.up.farmer = 1; plantAll(G);
  ET.tick(G, 10);
  assert.strictEqual(ET.count(G), 9);
  ET.tick(G, 100);                 // 11 個收成週期 × 9，盤面 30 格 → 滿
  assert.strictEqual(ET.count(G), N);
  const sold = ET.count(G);
  ET.sell(G, 0); ET.tick(G, 10);
  assert.strictEqual(ET.count(G), N, '空位又被補滿');
  assert.ok(sold === N);
});
test('長按改種 / 全部改種', () => {
  const G = fresh(); ET.plant(G, 0, 'wheat'); ET.plant(G, 1, 'wheat');
  assert.ok(ET.replace(G, 0, 'apple')); assert.strictEqual(G.plots[0].crop, 'apple'); assert.strictEqual(G.plots[0].p, 0);
  assert.ok(!ET.replace(G, 0, 'apple'), '同作物不動');
  ET.plantAll(G, 'wood');
  assert.ok(G.plots.every(p => p.crop === 'wood'));
});

console.log('合成盤');
test('同系列同階 → 升一階，來源消失', () => {
  const G = fresh(); give(G, 0, 'wheat', 1); give(G, 1, 'wheat', 1);
  const r = ET.moveItem(G, 0, 1);
  assert.strictEqual(r.kind, 'merge'); assert.strictEqual(G.board[1].t, 2); assert.strictEqual(G.board[0], null);
  assert.strictEqual(G.stats.merges, 1);
});
test('不同系列 / 不同階 → 交換；空格 → 移動', () => {
  const G = fresh(); give(G, 0, 'wheat', 1); give(G, 1, 'apple', 1); give(G, 2, 'wheat', 2);
  assert.strictEqual(ET.moveItem(G, 0, 1).kind, 'swap'); assert.strictEqual(G.board[0].s, 'apple');
  assert.strictEqual(ET.moveItem(G, 1, 2).kind, 'swap'); assert.strictEqual(G.board[2].t, 1);
  assert.strictEqual(ET.moveItem(G, 0, 9).kind, 'move'); assert.strictEqual(G.board[0], null); assert.strictEqual(G.board[9].s, 'apple');
});
test('5 階不能再合成（只交換）', () => {
  const G = fresh(); give(G, 0, 'wheat', 5); give(G, 1, 'wheat', 5);
  assert.ok(!ET.canMerge(G, 0, 1)); assert.strictEqual(ET.moveItem(G, 0, 1).kind, 'swap');
});
test('拖到自己 / 空來源 / 越界：無動作', () => {
  const G = fresh(); give(G, 0, 'wheat', 1);
  assert.ok(!ET.moveItem(G, 0, 0).ok); assert.ok(!ET.moveItem(G, 3, 4).ok); assert.ok(!ET.moveItem(G, 0, 99).ok); assert.ok(!ET.moveItem(G, -1, 0).ok);
});
test('賣出：給錢、清格、算入統計', () => {
  const G = fresh(); give(G, 4, 'apple', 3);
  const r = ET.sell(G, 4);
  assert.strictEqual(r.v, ET.value('apple', 3)); assert.strictEqual(G.coins, 13, '2×2.5² = 12.5 四捨五入');
  assert.strictEqual(G.board[4], null); assert.strictEqual(G.stats.sold, 1);
  assert.ok(!ET.sell(G, 4).ok);
});
test('機器人：只合成 ≤ 等級對應階的、先合最低階', () => {
  const G = fresh(); G.up.bot = 1;
  give(G, 0, 'wheat', 2); give(G, 1, 'wheat', 2); give(G, 2, 'wheat', 1); give(G, 3, 'wheat', 1);
  ET.tick(G, 8);
  assert.strictEqual(G.board[2].t, 2, '先合 1 階');
  assert.strictEqual(G.board[0].t, 2, '1 級機器人不碰 2 階');
  ET.tick(G, 8);
  assert.strictEqual(G.board[0].t, 2); assert.strictEqual(G.board[1].t, 2);
  G.up.bot = 2; ET.tick(G, 8); ET.tick(G, 8);
  assert.ok(G.board.some(it => it && it.t === 3), '2 級開始合 2 階');
});
test('自動出貨：擠了就先合成到最高階（不賣低階）；合完不擠就不賣', () => {
  const G = fresh(); G.up.shipper = 1;
  for (let i = 0; i < 27; i++) give(G, i, 'wood', 1);          // 使用者截圖裡的情況：盤面被 1 階塞滿
  const before = mass(G);
  ET.tick(G, 1);
  assert.strictEqual(mass(G), before, '只合成，沒有賣掉任何東西');
  assert.strictEqual(G.coins, 0); assert.strictEqual(G.stats.sold, 0);
  assert.ok(ET.count(G) < 10, '27 個 1 階 → 合成後剩幾個：' + ET.count(G));
  assert.ok(G.board.some(it => it && it.t >= 4), '合到高階');
});
test('自動出貨：合完還是擠 → 優先賣最貴的，留到 22 個', () => {
  const G = fresh(); G.up.shipper = 1;
  for (let i = 0; i < 8; i++) give(G, i, 'flower', 5);          // 156 × 8（5 階不能再合）
  for (let i = 8; i < 14; i++) give(G, i, 'wood', 5);           // 117 × 6
  for (let i = 14; i < 20; i++) give(G, i, 'apple', 5);         // 78 × 6
  give(G, 20, 'wheat', 1); give(G, 21, 'apple', 1); give(G, 22, 'wood', 1);   // 各自落單的低階，合不掉
  give(G, 23, 'flower', 2); give(G, 24, 'wheat', 3); give(G, 25, 'wood', 4); give(G, 26, 'apple', 2);
  assert.strictEqual(ET.count(G), 27);
  ET.tick(G, 1);
  assert.strictEqual(ET.count(G), 22);
  assert.strictEqual(G.stats.sold, 5);
  assert.strictEqual(G.coins, 156 * 5, '先賣最貴的 5 個：玫瑰');
  assert.strictEqual(G.board.filter(it => it && it.s === 'flower' && it.t === 5).length, 3);
  assert.ok(G.board.some(it => it && it.s === 'wheat' && it.t === 1), '低階的留著繼續合成');
});
test('自動出貨：沒到 26 個什麼都不做', () => {
  const G = fresh(); G.up.shipper = 1;
  for (let i = 0; i < 25; i++) give(G, i, 'wood', 1);
  ET.tick(G, 1); assert.strictEqual(ET.count(G), 25); assert.strictEqual(G.stats.merges, 0);
});

test('一鍵合成：連鎖合到不能合、等價量守恆、5 階與落單的不動', () => {
  const G = fresh();
  for (let i = 0; i < 5; i++) give(G, i, 'wheat', 1);          // 5 個 1 階 → 2 個 2 階 + 1 落單 → 1 個 3 階 + 1 個 1 階
  give(G, 10, 'apple', 1); give(G, 11, 'apple', 1);            // → 🧃
  give(G, 12, 'wood', 5); give(G, 13, 'wood', 5);              // 5 階不合
  const before = mass(G), cnt = ET.count(G);
  const n = ET.mergeAll(G);
  assert.strictEqual(n, 4, '小麥 2+1 次、蘋果 1 次');
  assert.strictEqual(mass(G), before, '合成不改變等價量');
  assert.strictEqual(ET.count(G), cnt - n);
  assert.strictEqual(G.stats.merges, n);
  const w = G.board.filter(it => it && it.s === 'wheat').map(it => it.t).sort();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w)), [1, 3]);
  assert.strictEqual(G.board.filter(it => it && it.s === 'wood' && it.t === 5).length, 2);
  assert.ok(!ET.hasPair(G), '合完不應再有成對的');
});
test('一鍵合成：沒有成對的 → 0，不動盤面', () => {
  const G = fresh(); give(G, 0, 'wheat', 1); give(G, 1, 'apple', 1); give(G, 2, 'wheat', 2);
  const snap = JSON.stringify(G.board);
  assert.strictEqual(ET.mergeAll(G), 0); assert.strictEqual(JSON.stringify(G.board), snap);
  assert.strictEqual(ET.mergeAll(fresh()), 0);
});
test('一鍵合成：滿盤 30 個 1 階也能合（4 個同系列一路合到 3 階）', () => {
  const G = fresh(); for (let i = 0; i < N; i++) give(G, i, 'wheat', 1);
  const before = mass(G); ET.mergeAll(G);
  assert.strictEqual(mass(G), before); assert.ok(!ET.hasPair(G));
});

test('肥料：種子列 / 說明要顯示實際秒數（不是永遠寫基礎秒數）', () => {
  const G = fresh();
  assert.strictEqual(ET.cropSeconds(G, 'wheat'), 10);
  G.up.fert = 4; assert.ok(Math.abs(ET.cropSeconds(G, 'wheat') - 10 / 1.48) < 1e-9);
  assert.strictEqual(ET.fmtSec(ET.cropSeconds(G, 'wheat')), '6.8');
  assert.strictEqual(ET.fmtSec(ET.cropSeconds(G, 'apple')), '14', '20 / 1.48 = 13.5 → 14');
  G.up.fert = 10; assert.strictEqual(ET.fmtSec(ET.cropSeconds(G, 'wood')), '18', '40 / 2.2');
  const d = ET.UPGRADE_BY_ID.fert.desc;
  assert.ok(d(0).includes('10 秒') && !d(0).includes('→'), d(0));
  assert.ok(d(4).includes('10 → 6.8 秒') && d(4).includes('6.3 秒'), d(4));
  assert.ok(d(10).includes('10 → 4.5 秒'), d(10));
  assert.strictEqual(ET.fmtSec(10), '10'); assert.strictEqual(ET.fmtSec(5), '5'); assert.strictEqual(ET.fmtSec(9.96), '10'); assert.strictEqual(ET.fmtSec(0.04), '0');
});
test('肥料：顯示的秒數和實際成熟時間一致', () => {
  const G = fresh(); G.up.fert = 4; ET.plant(G, 0, 'wheat');
  const sec = ET.cropSeconds(G, 'wheat');
  ET.tick(G, sec - 0.05); assert.ok(!ET.isRipe(G.plots[0]));
  ET.tick(G, 0.1); assert.ok(ET.isRipe(G.plots[0]), '在顯示的秒數成熟');
});
test('肥料：種子列的原始碼有帶入實際秒數與肥料等級（避免改回固定秒數）', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  assert.ok(/ET\.cropSeconds\(G, c\)/.test(ui), '種子列要用 cropSeconds');
  assert.ok(/'\|' \+ G\.up\.fert/.test(ui), '肥料等級變了要重畫種子列');
});

console.log('升級與擴建');
test('買升級：扣錢、升級；錢不夠 / 滿級 / 未知 → 失敗', () => {
  const G = fresh(); G.coins = 30;
  assert.ok(ET.buy(G, 'fert').ok); assert.strictEqual(G.up.fert, 1); assert.strictEqual(G.coins, 5);
  assert.strictEqual(ET.buy(G, 'fert').why, 'coins');
  G.coins = 1e9; assert.ok(ET.buy(G, 'farmer').ok); assert.strictEqual(ET.buy(G, 'farmer').why, 'max');
  assert.strictEqual(ET.buy(G, 'nope').why, 'unknown');
  assert.strictEqual(G.coins, 1e9 - 100);
});
test('所有升級成本遞增且為正整數', () => {
  for (const u of ET.UPGRADES) {
    let prev = 0;
    for (let l = 0; l < u.max; l++) {
      const c = u.cost(l);
      assert.ok(Number.isInteger(c) && c > 0, u.id + ' lvl ' + l); assert.ok(c >= prev, u.id + ' 不遞增'); prev = c;
    }
    assert.strictEqual(typeof u.desc(0), 'string'); assert.strictEqual(typeof u.desc(u.max), 'string');
  }
});
test('擴建：9→12→16→20→25，到頂失敗', () => {
  const G = fresh(); G.coins = 1e9;
  for (const n of [12, 16, 20, 25]) { assert.ok(ET.buyExpand(G).ok); assert.strictEqual(G.plots.length, n); }
  assert.strictEqual(ET.buyExpand(G).why, 'max');
});
test('離線上限：4 小時起，每級 +1', () => {
  const G = fresh(); assert.strictEqual(ET.offlineCapHours(G), 4); G.up.offline = 8; assert.strictEqual(ET.offlineCapHours(G), 12);
});

console.log('離線收益');
test('離線補算與線上逐秒 tick 結果一致', () => {
  const mk = () => { const G = fresh(); G.up.farmer = 1; G.up.bot = 2; G.up.shipper = 1; plantAll(G); return G; };
  const a = mk(), b = mk();
  ET.offline(a, 3600);
  for (let i = 0; i < 3600; i++) ET.tick(b, 1);
  assert.strictEqual(a.coins, b.coins); assert.strictEqual(ET.count(a), ET.count(b)); assert.strictEqual(a.stats.merges, b.stats.merges);
});
test('農夫 + 出貨：離線 4 小時有收入；沒農夫則作物停在熟（不收）', () => {
  const G = fresh(); G.up.farmer = 1; G.up.shipper = 1; plantAll(G);
  const s = ET.offline(G, 4 * 3600);
  assert.ok(s.earned > 0 && G.coins === s.earned); assert.ok(s.harvested.wheat > 0);
  const H = fresh(); plantAll(H);
  const s2 = ET.offline(H, 4 * 3600);
  assert.strictEqual(JSON.stringify(s2.harvested), '{}'); assert.strictEqual(ET.count(H), 0);
  assert.ok(H.plots.every(p => ET.isRipe(p)));
});
test('離線上限：離開 10 小時只算 4 小時；升級後算更多', () => {
  const a = fresh(); a.up.farmer = 1; a.up.shipper = 1; plantAll(a);
  const s = ET.offline(a, 10 * 3600);
  assert.strictEqual(s.sec, 4 * 3600); assert.ok(s.capped);
  const b = fresh(); b.up.farmer = 1; b.up.shipper = 1; b.up.offline = 6; plantAll(b);
  assert.strictEqual(ET.offline(b, 10 * 3600).sec, 10 * 3600);
});
test('離開不到 1 秒 → null；系統時間倒退 → 0 秒', () => {
  const G = fresh(); assert.strictEqual(ET.offline(G, 0.5), null);
  G.savedAt = 1e12; assert.strictEqual(ET.offlineSeconds(G, 1e12 - 5000), 0);
  assert.strictEqual(ET.offlineSeconds(G, 1e12 + 5000), 5);
  G.savedAt = NaN; assert.strictEqual(ET.offlineSeconds(G, 1000), 0);
});
test('離線不留下大量事件（避免記憶體 / 動畫洪水）', () => {
  const G = fresh(); G.up.farmer = 1; plantAll(G); ET.offline(G, 3600);
  assert.strictEqual(G.ev.length, 0);
});

test('效能：最壞情況離線 12 小時（25 格全自動化）要在 3 秒內算完', () => {
  const G = fresh(); G.up = { fert: 10, click: 0, farmer: 1, bot: 5, shipper: 1, offline: 8 }; G.expand = 4;
  while (G.plots.length < 25) G.plots.push({ crop: null, p: 0 });
  G.age = 1000; G.plots.forEach((p, i) => ET.plant(G, i, ['wheat', 'apple', 'wood', 'flower'][i % 4]));
  const t0 = Date.now(); const s = ET.offline(G, 12 * 3600); const ms = Date.now() - t0;
  assert.strictEqual(s.sec, 12 * 3600); assert.ok(ms < 3000, '花了 ' + ms + 'ms（優化前約 7000ms）');
});

console.log('解鎖與提示');
test('🌸 3 分鐘後可選；⚗️ 合成台在第一次湊到一對時解鎖', () => {
  const G = fresh(); assert.ok(!ET.select(G, 'flower')); G.age = 180; assert.ok(ET.select(G, 'flower'));
  const H = fresh(); assert.ok(!H.unlocked.merge);
  give(H, 0, 'wheat', 1); ET.tick(H, 0.1); assert.ok(!H.unlocked.merge);
  give(H, 1, 'wheat', 1); ET.tick(H, 0.1); assert.ok(H.unlocked.merge);
  assert.ok(H.ev.some(e => e.t === 'unlock'));
});
test('⚗️ 兩分鐘也會自動解鎖', () => {
  const G = fresh(); ET.tick(G, 119); assert.ok(!G.unlocked.merge); ET.tick(G, 2); assert.ok(G.unlocked.merge);
});
test('新手提示依進度變化', () => {
  const G = fresh();
  assert.ok(ET.hint(G).includes('種下'));
  ET.plant(G, 0, 'wheat'); assert.ok(ET.hint(G).includes('加速'));
  ET.tick(G, 10); assert.ok(ET.hint(G).includes('熟了'));
});
test('升級項目可見規則：錢夠 30% 才出現', () => {
  const G = fresh(); assert.ok(!ET.upgradeVisible(G, 'bot')); G.coins = 100; assert.ok(ET.upgradeVisible(G, 'bot'));
  G.coins = 0; assert.ok(ET.upgradeVisible(G, 'bot'), '看過就一直顯示');
});
test('紅點：買得起任一升級時為真', () => {
  const G = fresh(); assert.ok(!ET.affordable(G)); G.coins = 25; assert.ok(ET.affordable(G));
});

console.log('存檔');
test('存 → 讀 完全還原', () => {
  const G = fresh(); G.coins = 777; G.up.fert = 3; G.up.farmer = 1; G.age = 500; G.selected = 'apple';
  ET.buyExpand((G.coins = 1e6, G)); G.coins = 777;
  ET.plant(G, 0, 'apple'); ET.tick(G, 5); give(G, 3, 'wood', 4); G.stats.merges = 9; G.dex['wood:4'] = 1;
  const s = ET.save(G, 12345);
  const H = ET.load(s);
  assert.ok(H);
  assert.strictEqual(H.savedAt, 12345);
  const strip = x => JSON.stringify(Object.assign({}, x, { ev: 0, savedAt: 0, ver: 0 }));
  assert.strictEqual(strip(H), strip(G));
  assert.ok(!('ev' in JSON.parse(s)));
});
test('壞存檔：亂碼 / 版本不對 / 非物件 → null', () => {
  for (const s of ['', 'abc', '{', 'null', '123', '{"v":999}', '[]']) assert.strictEqual(ET.load(s), null, s);
});
test('部分壞資料會被修正，不丟例外、不產生 NaN', () => {
  const bad = { v: 1, coins: 'x', age: -5, selected: 'zzz', up: { fert: 99, farmer: -3, bot: 'a' }, expand: 99,
    plots: [{ crop: 'wheat', p: NaN }, { crop: 'nope', p: 3 }, null], board: [{ s: 'wheat', t: 99 }, { s: 'wheat', t: 2 }, { s: 'x', t: 1 }, 5, null],
    stats: { merges: 'a', harvested: { wheat: 'q', zzz: 4 } } };
  const G = ET.load(JSON.stringify(bad));
  assert.ok(G);
  assert.strictEqual(G.coins, 0); assert.strictEqual(G.age, 0); assert.strictEqual(G.selected, 'wheat');
  assert.strictEqual(G.up.fert, 10); assert.strictEqual(G.up.farmer, 0); assert.strictEqual(G.up.bot, 0);
  assert.strictEqual(G.plots.length, 25); assert.strictEqual(G.plots[0].p, 0); assert.strictEqual(G.plots[1].crop, null);
  assert.strictEqual(G.board.length, N); assert.strictEqual(ET.count(G), 1); assert.strictEqual(G.board[1].t, 2);
  assert.ok(G.nextId > G.board[1].id);
  assert.strictEqual(JSON.stringify(G.stats.harvested), '{"wheat":0}');
  ET.tick(G, 100); assert.ok(Number.isFinite(G.coins));
});
test('讀檔後 id 不重複', () => {
  const G = fresh(); give(G, 0, 'wheat', 1); give(G, 1, 'wheat', 1);
  const H = ET.load(ET.save(G, 1)); give(H, 2, 'wheat', 1);
  const ids = H.board.filter(Boolean).map(it => it.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

console.log('隨機亂按（不變式）');
test('120 局隨機操作：盤面長度固定、錢不為負、合成守恆、無 NaN', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let run = 0; run < 120; run++) {
    const G = fresh();
    for (let step = 0; step < 300; step++) {
      const r = rnd();
      if (r < 0.2) ET.tapPlot(G, (rnd() * G.plots.length) | 0, { boost: rnd() < 0.7 });
      else if (r < 0.4) ET.tick(G, rnd() * 15);
      else if (r < 0.6) { const a = (rnd() * N) | 0, b = (rnd() * N) | 0; const before = mass(G); const k = ET.moveItem(G, a, b); if (k.kind === 'merge') assert.strictEqual(mass(G), before, '合成不應改變等價量'); }
      else if (r < 0.7) ET.sell(G, (rnd() * N) | 0);
      else if (r < 0.8) ET.buy(G, ET.UPGRADES[(rnd() * ET.UPGRADES.length) | 0].id);
      else if (r < 0.82) { const b = mass(G); ET.mergeAll(G); assert.strictEqual(mass(G), b, '一鍵合成守恆'); }
      else if (r < 0.85) ET.buyExpand(G);
      else if (r < 0.9) ET.plantAll(G, ['wheat', 'apple', 'wood', 'flower'][(rnd() * 4) | 0]);
      else if (r < 0.95) ET.offline(G, rnd() * 400);
      else if (rnd() < 0.5) G.coins += 300;
      else { const H = ET.load(ET.save(G, step)); assert.ok(H); Object.assign(G, H); }
      assert.strictEqual(G.board.length, N);
      assert.ok(G.coins >= 0 && Number.isFinite(G.coins), '錢壞了 ' + G.coins);
      for (const p of G.plots) assert.ok(Number.isFinite(p.p) && p.p >= 0);
      const ids = G.board.filter(Boolean).map(it => it.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'id 重複');
    }
  }
});

console.log('S2 商店');
const openShop = G => { G.unlocked.shop = true; G.dex['wheat:1'] = 1; G.dex['wheat:2'] = 1; G.dex['apple:1'] = 1; G.shop.nextIv = 1e9; return G; };
const addCust = (G, o) => { const c = Object.assign({ id: G.shop.cid++, kind: 'normal', face: '🧑', s: 'wheat', t: 2, qty: 1, wait: 0, okT: 0, pat: 22 }, o); G.shop.custs.push(c); return c; };
const shelfItem = (G, i, s, t) => { G.shop.shelves[i].item = { id: G.nextId++, s, t }; };
const J = x => JSON.parse(JSON.stringify(x));

test('商店在第一次發現 2 階物品時才開張，並通知 UI', () => {
  const G = fresh(); give(G, 0, 'wheat', 1); give(G, 1, 'wheat', 1);
  ET.tick(G, 1); assert.ok(!G.unlocked.shop, '只有 1 階還沒開');
  ET.moveItem(G, 0, 1); ET.tick(G, 1);
  assert.ok(G.unlocked.shop); assert.ok(G.ev.some(e => e.t === 'unlock' && e.tab === 'shop'));
});
test('商店沒開張時不會有客人', () => {
  const G = fresh(); G.dex['wheat:2'] = 1; G.shop.nextIv = 0; G.unlocked.shop = false;
  ET.shopTick(G, 100); assert.strictEqual(G.shop.custs.length, 0);
});
test('貨架完全空著 → 沒客人進來、不流失、人氣不變；一上架馬上有客人', () => {
  const G = fresh(); openShop(G); G.shop.nextIv = 5; G.shop.pop = 40;
  for (let i = 0; i < 5000; i++) ET.shopTick(G, 1);
  assert.strictEqual(G.shop.custs.length, 0); assert.strictEqual(G.shop.lost, 0); assert.strictEqual(G.shop.pop, 40);
  const cid = G.shop.cid;
  shelfItem(G, 0, 'wheat', 2); ET.shopTick(G, 1);
  assert.ok(G.shop.cid > cid, '上架後下一個 tick 就有客人來過（可能已經買完走了）');
});
test('有貨但不是客人要的 → 才算流失（人氣會掉）', () => {
  const G = fresh(); openShop(G); shelfItem(G, 0, 'apple', 1); addCust(G, { s: 'wheat', t: 2 });
  ET.shopTick(G, 23); assert.strictEqual(G.shop.lost, 1);
});
test('客人依發現過的物品產生，且依亂數狀態可重現', () => {
  const mk = () => { const G = fresh(); openShop(G); G.shop.nextIv = 1; return G; };
  const restockAll = G => { for (let k = 0; k < G.shop.shelves.length; k++) if (!G.shop.shelves[k].item) shelfItem(G, k, 'wheat', 2); };
  const a = mk(), b = mk();
  for (let i = 0; i < 60; i++) { restockAll(a); restockAll(b); ET.shopTick(a, 1); ET.shopTick(b, 1); }
  assert.ok(a.shop.cid > 3, '應有客人來過');
  assert.strictEqual(JSON.stringify(a.shop), JSON.stringify(b.shop), '同亂數狀態 → 同結果');
  const c = a.shop.custs[0]; if (c) assert.ok(a.dex[c.s + ':' + c.t], '客人只會要玩家做過的東西');
  for (let i = 0; i < 1000; i++) { const r = ET.rand(a); assert.ok(r >= 0 && r < 1); }
});
test('上架：換出舊貨到同一格（盤滿也能換）、設定 tpl；沒有該物品 → 失敗', () => {
  const G = fresh(); openShop(G);
  give(G, 3, 'wheat', 2); give(G, 4, 'wheat', 3);
  assert.ok(ET.stock(G, 0, 'wheat', 2).ok);
  assert.strictEqual(G.shop.shelves[0].item.t, 2); assert.strictEqual(G.board[3], null);
  assert.deepStrictEqual(J(G.shop.shelves[0].tpl), { s: 'wheat', t: 2 });
  assert.ok(ET.stock(G, 0, 'wheat', 3).ok, '換貨');
  assert.strictEqual(G.shop.shelves[0].item.t, 3); assert.strictEqual(G.board[4].t, 2, '舊貨回到被拿走的那格');
  assert.strictEqual(ET.stock(G, 0, 'apple', 4).why, 'none'); assert.strictEqual(ET.stock(G, 99, 'wheat', 2).why, 'slot');
});
test('取回：放回合成盤；盤滿則失敗', () => {
  const G = fresh(); openShop(G); shelfItem(G, 0, 'wheat', 2);
  assert.ok(ET.takeBack(G, 0).ok); assert.strictEqual(G.shop.shelves[0].item, null); assert.strictEqual(ET.count(G), 1);
  shelfItem(G, 1, 'wheat', 2); for (let i = 0; i < N; i++) if (!G.board[i]) give(G, i, 'wood', 1);
  assert.strictEqual(ET.takeBack(G, 1).why, 'full'); assert.ok(G.shop.shelves[1].item);
  assert.strictEqual(ET.takeBack(G, 2).why, 'empty');
});
test('結帳：有貨 1 秒後自動成交，價格 ×1.5，貨架清空但商品設定保留，人氣上升', () => {
  const G = fresh(); openShop(G); shelfItem(G, 0, 'wheat', 2); G.shop.shelves[0].tpl = { s: 'wheat', t: 2 };
  addCust(G, {});
  ET.shopTick(G, 0.5); assert.strictEqual(G.coins, 0, '還沒到');
  ET.shopTick(G, 0.6);
  assert.strictEqual(G.coins, Math.round(3 * 1.5)); assert.strictEqual(G.shop.shelves[0].item, null);
  assert.ok(G.shop.shelves[0].tpl); assert.strictEqual(G.shop.sales, 1); assert.strictEqual(G.shop.pop, 22);
  assert.strictEqual(G.stats.earned, G.coins); assert.strictEqual(G.shop.custs.length, 0);
  assert.ok(G.ev.some(e => e.t === 'sale'));
});
test('客人接受同系列「更高階」，不接受更低階；多件符合時用最便宜的', () => {
  const G = fresh(); openShop(G); shelfItem(G, 0, 'wheat', 3); shelfItem(G, 1, 'wheat', 2); shelfItem(G, 2, 'wheat', 1); shelfItem(G, 3, 'apple', 4);
  addCust(G, { t: 2 }); ET.shopTick(G, 1.1);
  assert.strictEqual(G.shop.shelves[1].item, null, '用掉 2 階'); assert.ok(G.shop.shelves[0].item && G.shop.shelves[2].item && G.shop.shelves[3].item);
  addCust(G, { t: 2 }); ET.shopTick(G, 1.1);
  assert.strictEqual(G.shop.shelves[0].item, null, '2 階沒了，改用 3 階'); assert.ok(G.shop.shelves[2].item, '1 階不夠格，不賣');
  addCust(G, { t: 2 }); ET.shopTick(G, 1.1); assert.strictEqual(G.shop.custs.length, 1, '只剩 1 階 → 等著');
});
test('缺貨：等到耐心用完離開，人氣 -4；等待中補貨還來得及', () => {
  const G = fresh(); openShop(G); addCust(G, {});
  ET.shopTick(G, 21); assert.strictEqual(G.shop.custs.length, 1);
  shelfItem(G, 0, 'wheat', 2); ET.shopTick(G, 1.2);
  assert.strictEqual(G.shop.sales, 1, '最後一刻補貨成功'); assert.strictEqual(G.shop.lost, 0);
  const H = fresh(); openShop(H); addCust(H, {}); const p = H.shop.pop;
  ET.shopTick(H, 23);
  assert.strictEqual(H.shop.custs.length, 0); assert.strictEqual(H.shop.lost, 1); assert.strictEqual(H.shop.pop, p - 4);
  H.shop.pop = 2; addCust(H, {}); ET.shopTick(H, 23); assert.strictEqual(H.shop.pop, 0, '人氣不低於 0');
});
test('人氣不超過 100；招牌提高價格', () => {
  const G = fresh(); openShop(G); G.shop.pop = 99; G.up.sign = 5;
  assert.strictEqual(ET.priceMult(G), 2); assert.strictEqual(ET.price(G, 'wheat', 2), 6);
  shelfItem(G, 0, 'wheat', 2); addCust(G, {}); ET.shopTick(G, 1.1);
  assert.strictEqual(G.shop.pop, 100); assert.strictEqual(G.coins, 6);
});
test('點客人：立刻結帳 + 25% 小費；沒貨回報 nostock；已離開 → gone', () => {
  const G = fresh(); openShop(G); const c = addCust(G, {});
  assert.strictEqual(ET.serveNow(G, c.id).why, 'nostock'); assert.strictEqual(G.shop.custs.length, 1);
  shelfItem(G, 0, 'wheat', 2);
  const r = ET.serveNow(G, c.id);
  assert.ok(r.ok); assert.strictEqual(G.coins, 5 + Math.round(5 * 0.25));  // 價 5（4.5 進位）+ 小費 1
  assert.strictEqual(G.shop.pop, 20 + 2 + 1);
  assert.strictEqual(ET.serveNow(G, c.id).why, 'gone');
});
test('貴族：要湊滿 3 件（同系列、≥2 階），成交價 ×1.3', () => {
  const G = fresh(); openShop(G); addCust(G, { kind: 'noble', qty: 3, t: 2, pat: 30 });
  shelfItem(G, 0, 'wheat', 2); shelfItem(G, 1, 'wheat', 3);
  ET.shopTick(G, 5); assert.strictEqual(G.shop.sales, 0, '只有 2 件，不買');
  shelfItem(G, 2, 'wheat', 2); ET.shopTick(G, 1.1);
  const base = ET.price(G, 'wheat', 2) * 2 + ET.price(G, 'wheat', 3);
  assert.strictEqual(G.coins, Math.round(base * 1.3)); assert.strictEqual(G.shop.sales, 3);
});
test('小偷：不理他 8 秒就偷走最貴的；點他 = 趕走；有店員自動趕走；貨架空的無害', () => {
  const G = fresh(); openShop(G); shelfItem(G, 0, 'wheat', 2); shelfItem(G, 1, 'apple', 4); addCust(G, { kind: 'thief', s: null, t: 0, pat: 8 });
  ET.shopTick(G, 7); assert.ok(G.shop.shelves[1].item); ET.shopTick(G, 1.5);
  assert.strictEqual(G.shop.shelves[1].item, null, '偷走最貴的'); assert.ok(G.shop.shelves[0].item); assert.strictEqual(G.shop.stolen, 1);
  assert.ok(G.ev.some(e => e.t === 'stolen'));
  const H = fresh(); openShop(H); shelfItem(H, 0, 'wheat', 2); const t = addCust(H, { kind: 'thief', s: null, t: 0, pat: 8 });
  assert.strictEqual(ET.serveNow(H, t.id).act, 'chase'); ET.shopTick(H, 20);
  assert.ok(H.shop.shelves[0].item); assert.strictEqual(H.shop.stolen, 0);
  const K = fresh(); openShop(K); K.up.clerk = 1; shelfItem(K, 0, 'wheat', 2); addCust(K, { kind: 'thief', s: null, t: 0, pat: 8 });
  ET.shopTick(K, 1); assert.ok(K.shop.shelves[0].item); assert.strictEqual(K.shop.custs.length, 0);
  const E = fresh(); openShop(E); addCust(E, { kind: 'thief', s: null, t: 0, pat: 8 }); ET.shopTick(E, 9);
  assert.strictEqual(E.shop.stolen, 0); assert.strictEqual(E.shop.custs.length, 0);
});
test('補貨：照貨架商品設定從合成盤補（≥ 該階、最便宜優先）；沒設定的建議最多的 2 階品項', () => {
  const G = fresh(); openShop(G);
  G.shop.shelves[0].tpl = { s: 'wheat', t: 2 }; give(G, 0, 'wheat', 3); give(G, 1, 'wheat', 2); give(G, 2, 'wheat', 1);
  assert.strictEqual(ET.restock(G), 3, '4 個貨架、盤上 3 件 → 全上架');
  assert.strictEqual(G.shop.shelves[0].item.t, 2, '有設定的貨架：最便宜的合格品（2 階）');
  assert.strictEqual(G.shop.shelves[1].item.t, 3, '沒設定的貨架：先建議 2 階以上（3 階）');
  assert.strictEqual(G.shop.shelves[2].item.t, 1, '2 階以上用完了才用 1 階');
  assert.strictEqual(G.shop.shelves[3].item, null, '沒東西了');
  const H = fresh(); openShop(H); H.shop.shelves[0].tpl = { s: 'apple', t: 4 };
  assert.strictEqual(ET.restock(H), 0, '盤上沒有就不補');
});
test('補貨：缺的貨先在合成盤合成出來（你截圖裡的 🧃 缺貨：盤上有成對的 🍎）', () => {
  const G = fresh(); openShop(G);
  G.shop.shelves[0].tpl = { s: 'apple', t: 2 };
  give(G, 0, 'apple', 1); give(G, 1, 'apple', 1);
  const before = mass(G);
  assert.strictEqual(ET.restock(G), 1);
  assert.strictEqual(G.shop.shelves[0].item.s, 'apple'); assert.strictEqual(G.shop.shelves[0].item.t, 2, '合成出 🧃 上架');
  assert.strictEqual(G.stats.merges, 1); assert.strictEqual(ET.count(G), 0, '兩個 🍎 合成成 1 個 🧃，上了架');
  assert.strictEqual(mass(G) + 2, before, '合成守恆：1 個 🧃 (等價 2) 上了架');
});
test('補貨：要高階的貨會一路連鎖合成（8 個 🍎 → 🍷 4 階）；湊不齊就只合成、不上架', () => {
  const G = fresh(); openShop(G); G.shop.shelves[0].tpl = { s: 'apple', t: 4 };
  for (let i = 0; i < 8; i++) give(G, i, 'apple', 1);
  assert.strictEqual(ET.restock(G), 1); assert.strictEqual(G.shop.shelves[0].item.t, 4); assert.strictEqual(ET.count(G), 0);
  const H = fresh(); openShop(H); H.shop.shelves[0].tpl = { s: 'apple', t: 4 };
  for (let i = 0; i < 7; i++) give(H, i, 'apple', 1);
  ET.restock(H);
  assert.strictEqual(H.shop.shelves[0].item, null, '7 個合不出 4 階，設定 4 階的貨架仍然缺貨');
  assert.strictEqual(H.stats.merges, 4, '7 個 → 3 個 2 階 + 1 → 1 個 3 階，共合成 4 次');
  assert.ok(H.board.filter(it => it && it.t === 1).length <= 1, '1 階成對的都合掉了');
});
test('補貨：只動缺貨那個系列，不碰其他系列的成對品項', () => {
  const G = fresh(); openShop(G); G.shop.shelves[0].tpl = { s: 'apple', t: 2 };
  give(G, 0, 'apple', 1); give(G, 1, 'apple', 1); give(G, 2, 'wheat', 1); give(G, 3, 'wheat', 1); give(G, 4, 'wood', 1); give(G, 5, 'wood', 1);
  ET.restock(G);
  assert.strictEqual(G.stats.merges, 1, '只合成了 🍎 這一次');
  const all = [...G.board.filter(Boolean), ...G.shop.shelves.map(x => x.item).filter(Boolean)];
  assert.ok(!all.some(it => (it.s === 'wheat' || it.s === 'wood') && it.t >= 2), '小麥、木材沒被合成');
});
test('補貨：設定的商品做不出來 → 改做排隊客人想要、而且做得出來的；貨架設定跟著改', () => {
  const G = fresh(); openShop(G); G.shop.shelves[0].tpl = { s: 'wheat', t: 2 };    // 盤上完全沒有小麥
  give(G, 0, 'apple', 1); give(G, 1, 'apple', 1);
  addCust(G, { s: 'apple', t: 2 });
  assert.strictEqual(ET.restock(G), 1);
  assert.deepStrictEqual(J(G.shop.shelves[0].tpl), { s: 'apple', t: 2 }); assert.strictEqual(G.shop.shelves[0].item.t, 2);
  ET.shopTick(G, 1.1); assert.strictEqual(G.shop.sales, 1, '客人買到了');
});
test('補貨：已被貨架滿足的客人不會再佔用額外貨架；貴族要 3 件就補 3 格', () => {
  const G = fresh(); openShop(G);
  for (let i = 0; i < 12; i++) give(G, i, 'apple', 1);
  shelfItem(G, 0, 'apple', 3);
  addCust(G, { s: 'apple', t: 2 });                                      // 已有 apple3 可賣給他
  assert.strictEqual(ET.restock(G), 3, '客人已被滿足，沒有額外需求 → 其餘 3 格只用「建議」補');
  assert.strictEqual(G.stats.merges, 0, '沒有需求就不用特地合成：建議只拿盤上現成的');
  const H = fresh(); openShop(H);
  for (let i = 0; i < 12; i++) give(H, i, 'apple', 1);
  addCust(H, { kind: 'noble', qty: 3, s: 'apple', t: 2, pat: 30 });
  assert.strictEqual(ET.restock(H), 4, '貴族要 3 件 → 先合成補 3 格；第 4 格沒有需求 → 用建議補滿');
  assert.strictEqual(H.shop.shelves.filter(x => x.item && x.item.s === 'apple' && x.item.t >= 2).length, 4);
  ET.shopTick(H, 1.1); assert.strictEqual(H.shop.sales, 3, '貴族 3 件成交');
});
test('補貨：小偷不算需求；沒有需求、沒設定 → 退回「建議」', () => {
  const G = fresh(); openShop(G); give(G, 0, 'wheat', 2); give(G, 1, 'wheat', 2);
  addCust(G, { kind: 'thief', s: null, t: 0, pat: 8 });
  assert.strictEqual(ET.restock(G), 2);
});
test('店員：缺貨時自動合成、補貨、客人買到（離線也一樣）', () => {
  const G = fresh(); openShop(G); G.up.clerk = 1; G.shop.nextIv = 1e9;
  G.shop.shelves[0].tpl = { s: 'apple', t: 2 };
  give(G, 0, 'apple', 1); give(G, 1, 'apple', 1);
  addCust(G, { s: 'apple', t: 2, pat: 60 });
  ET.shopTick(G, 3); ET.shopTick(G, 1.1);
  assert.strictEqual(G.shop.sales, 1);
});
test('補貨守恆：隨機盤面補貨前後，盤面 + 貨架的等價量不變', () => {
  let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ser = ['wheat', 'apple', 'wood', 'flower'];
  for (let run = 0; run < 200; run++) {
    const G = fresh(); openShop(G); G.rs = run + 1;
    for (let i = 0; i < N; i++) if (rnd() < 0.6) give(G, i, ser[(rnd() * 4) | 0], 1 + ((rnd() * 3) | 0));
    for (let k = 0; k < G.shop.shelves.length; k++) if (rnd() < 0.5) G.shop.shelves[k].tpl = { s: ser[(rnd() * 4) | 0], t: 1 + ((rnd() * 4) | 0) };
    for (let k = 0; k < 3; k++) addCust(G, { s: ser[(rnd() * 4) | 0], t: 1 + ((rnd() * 3) | 0), qty: rnd() < 0.2 ? 3 : 1 });
    const shelfMass = () => G.shop.shelves.reduce((m, x) => m + (x.item ? Math.pow(2, x.item.t - 1) : 0), 0);
    const before = mass(G) + shelfMass();
    ET.restock(G);
    assert.strictEqual(mass(G) + shelfMass(), before, '補貨改變了等價量 run ' + run);
    const ids = [...G.board.filter(Boolean), ...G.shop.shelves.map(x => x.item).filter(Boolean)].map(it => it.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  }
});

test('店員：每 3 秒自動補貨；沒店員不會自己補', () => {
  const mk = clerk => { const G = fresh(); openShop(G); G.up.clerk = clerk; G.shop.shelves[0].tpl = { s: 'wheat', t: 2 }; give(G, 5, 'wheat', 2); return G; };
  const a = mk(1); ET.shopTick(a, 2.9); assert.strictEqual(a.shop.shelves[0].item, null); ET.shopTick(a, 0.2); assert.ok(a.shop.shelves[0].item);
  const b = mk(0); ET.shopTick(b, 30); assert.strictEqual(b.shop.shelves[0].item, null);
});
test('客流：人氣與裝潢提高來客率；店內人數有上限，滿了不再進', () => {
  const G = fresh(); openShop(G);
  G.shop.pop = 0; assert.ok(Math.abs(ET.rateMult(G) - 0.6) < 1e-9);
  G.shop.pop = 100; assert.ok(Math.abs(ET.rateMult(G) - 2.0) < 1e-9);
  G.up.deco = 5; assert.ok(Math.abs(ET.rateMult(G) - 4.0) < 1e-9); assert.strictEqual(ET.queueMax(G), 8);
  const H = fresh(); openShop(H); H.shop.nextIv = 0;
  for (let i = 0; i < 3; i++) addCust(H, { pat: 1e9 });
  for (let i = 0; i < 20; i++) ET.shopTick(H, 5);
  assert.strictEqual(H.shop.custs.length, 3);
});
test('貨架升級：4 → 12 格，買了立刻多出空格', () => {
  const G = fresh(); openShop(G); G.coins = 1e9; assert.strictEqual(G.shop.shelves.length, 4);
  assert.ok(ET.buy(G, 'shelf').ok); assert.strictEqual(G.shop.shelves.length, 5);
  for (let i = 0; i < 7; i++) ET.buy(G, 'shelf');
  assert.strictEqual(G.shop.shelves.length, 12); assert.strictEqual(ET.buy(G, 'shelf').why, 'max');
});
test('商店升級在商店開張前不顯示、不亮紅點', () => {
  const G = fresh(); G.coins = 1e6;
  assert.ok(!ET.upgradeVisible(G, 'clerk')); assert.ok(ET.affordable(G), '農場升級買得起');
  for (const u of ET.UPGRADES) if (u.group === 'farm') G.up[u.id] = u.max;
  assert.ok(!ET.affordable(G), '只剩商店升級時不亮紅點');
  G.unlocked.shop = true; assert.ok(ET.upgradeVisible(G, 'clerk')); assert.ok(ET.affordable(G));
});
test('提示：開張後引導上架 → 點客人', () => {
  const G = fresh(); openShop(G); G.stats.merges = 1; G.unlocked.merge = true; ET.plant(G, 0, 'wheat');
  assert.ok(ET.hint(G).includes('貨架'));
  shelfItem(G, 0, 'wheat', 2); assert.ok(ET.hint(G).includes('點客人'));
});
test('離線補算與逐秒 tick 一致（商店 + 店員 + 全自動化）', () => {
  const mk = () => { const G = fresh(); G.up.farmer = 1; G.up.bot = 3; G.up.shipper = 1; G.up.clerk = 1; G.up.deco = 2; G.up.shelf = 3;
    G.unlocked.shop = true; G.dex['wheat:2'] = 1; G.dex['wheat:1'] = 1; G.dex['apple:1'] = 1; G.dex['apple:2'] = 1; G.age = 1000;
    G.plots.forEach((p, i) => ET.plant(G, i, i % 2 ? 'wheat' : 'apple')); return G; };
  const a = mk(), b = mk();
  ET.offline(a, 7200); for (let i = 0; i < 7200; i++) ET.tick(b, 1);
  assert.strictEqual(a.coins, b.coins); assert.strictEqual(a.shop.sales, b.shop.sales); assert.strictEqual(a.shop.lost, b.shop.lost);
  assert.strictEqual(a.shop.pop, b.shop.pop); assert.strictEqual(a.rs, b.rs);
  assert.ok(a.shop.sales > 10, '兩小時應賣出不少：' + a.shop.sales);
});
test('離線摘要含商店賣出 / 營收 / 流失', () => {
  const G = fresh(); G.up.farmer = 1; G.up.bot = 2; G.up.clerk = 1; G.unlocked.shop = true; G.dex['wheat:2'] = 1; G.dex['wheat:1'] = 1; G.age = 1000;
  G.plots.forEach((p, i) => ET.plant(G, i, 'wheat'));
  const s = ET.offline(G, 3600);
  assert.ok(s.shopSales > 0 && s.shopRevenue > 0); assert.strictEqual(typeof s.shopLost, 'number'); assert.strictEqual(typeof s.shopStolen, 'number');
  assert.ok(s.earned >= s.shopRevenue, '營收也算進總收入');
});
test('存檔：貨架 / 商品設定 / 人氣 / 亂數狀態還原，客人不存', () => {
  const G = fresh(); openShop(G); G.up.shelf = 2; ET.shopSync(G);
  shelfItem(G, 0, 'wheat', 2); G.shop.shelves[1].tpl = { s: 'apple', t: 1 }; G.shop.pop = 63; G.shop.sales = 7; G.shop.revenue = 99; addCust(G, {}); ET.rand(G);
  const H = ET.load(ET.save(G, 5));
  assert.ok(H); assert.strictEqual(H.shop.shelves.length, 6); assert.strictEqual(H.shop.shelves[0].item.t, 2);
  assert.deepStrictEqual(J(H.shop.shelves[1].tpl), { s: 'apple', t: 1 });
  assert.strictEqual(H.shop.pop, 63); assert.strictEqual(H.shop.sales, 7); assert.strictEqual(H.shop.revenue, 99);
  assert.strictEqual(H.shop.custs.length, 0); assert.strictEqual(H.rs, G.rs); assert.ok(H.unlocked.shop);
  give(H, 9, 'wood', 1);
  const ids = [...H.board.filter(Boolean), ...H.shop.shelves.map(x => x.item).filter(Boolean)].map(it => it.id);
  assert.strictEqual(new Set(ids).size, ids.length, '讀檔後新物品 id 不能和貨架上的撞號');
});
test('相容：S1 的舊存檔（沒有 shop / rs / 新升級）能讀，補上預設值', () => {
  const old = { v: 1, age: 500, coins: 321, selected: 'apple', plots: [{ crop: 'wheat', p: 3 }], board: [{ id: 4, s: 'wheat', t: 2 }, null],
    nextId: 9, up: { fert: 2, click: 0, farmer: 1, bot: 0, shipper: 0, offline: 0 }, expand: 0, botT: 0, unlocked: { merge: true },
    seen: {}, dex: { 'wheat:1': 1, 'wheat:2': 1 }, hints: {}, stats: { harvested: { wheat: 5 }, merges: 2, sold: 3, earned: 40, taps: 1 }, savedAt: 1234 };
  const G = ET.load(JSON.stringify(old));
  assert.ok(G); assert.strictEqual(G.coins, 321); assert.strictEqual(G.up.fert, 2); assert.strictEqual(G.up.shelf, 0); assert.strictEqual(G.up.clerk, 0);
  assert.strictEqual(G.shop.shelves.length, 4); assert.strictEqual(G.shop.pop, 20); assert.ok(Number.isInteger(G.rs) && G.rs > 0);
  assert.ok(!G.unlocked.shop); ET.tick(G, 1); assert.ok(G.unlocked.shop, '舊存檔裡已有 2 階物品 → 補開張');
});
test('壞掉的商店存檔資料會被修正，不丟例外', () => {
  const G = ET.save(fresh(), 1); const o = JSON.parse(G);
  o.shop = { pop: 1e9, sales: -5, revenue: 'x', shelves: [null, 5, { item: { s: 'zzz', t: 1 }, tpl: { s: 'wheat', t: 99 } }, { item: { s: 'wheat', t: 2 }, tpl: { s: 'apple', t: 1 } }], nextIv: -3, spawnT: NaN };
  o.rs = 'abc';
  const H = ET.load(JSON.stringify(o));
  assert.ok(H); assert.strictEqual(H.shop.pop, 20); assert.strictEqual(H.shop.sales, 0); assert.strictEqual(H.shop.revenue, 0);
  assert.strictEqual(H.shop.shelves[2].item, null); assert.strictEqual(H.shop.shelves[2].tpl, null);
  assert.strictEqual(H.shop.shelves[3].item.t, 2); assert.ok(H.shop.nextIv >= 1);
  assert.ok(H.rs > 0); H.unlocked.shop = true; H.dex['wheat:2'] = 1; for (let i = 0; i < 50; i++) ET.tick(H, 1);
  assert.ok(Number.isFinite(H.coins));
  assert.strictEqual(ET.load(JSON.stringify(Object.assign(JSON.parse(G), { shop: 'garbage' }))).shop.shelves.length, 4);
});
test('效能：商店全開、離線 12 小時要在 3 秒內算完', () => {
  const G = fresh(); G.up = Object.assign(G.up, { fert: 10, farmer: 1, bot: 5, shipper: 1, offline: 8, shelf: 8, deco: 5, clerk: 1, sign: 5 }); G.expand = 4;
  while (G.plots.length < 25) G.plots.push({ crop: null, p: 0 });
  G.unlocked.shop = true; for (const s of ['wheat', 'apple', 'wood', 'flower']) for (let t = 1; t <= 4; t++) G.dex[s + ':' + t] = 1;
  G.age = 1000; G.plots.forEach((p, i) => ET.plant(G, i, ['wheat', 'apple', 'wood', 'flower'][i % 4]));
  const t0 = Date.now(); const s = ET.offline(G, 12 * 3600); const ms = Date.now() - t0;
  assert.strictEqual(s.sec, 12 * 3600); assert.ok(ms < 3000, '花了 ' + ms + 'ms'); assert.ok(s.shopSales > 100);
});
test('S2 隨機亂按：物品 id 不重複、貨架數正確、人氣 0~100、錢有限', () => {
  let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ser = ['wheat', 'apple', 'wood', 'flower'];
  for (let run = 0; run < 80; run++) {
    const G = fresh(); G.rs = run + 1; G.age = 500; openShop(G); G.shop.nextIv = 3; G.coins = 500;
    for (let step = 0; step < 250; step++) {
      const r = rnd();
      if (r < 0.2) ET.tick(G, rnd() * 8);
      else if (r < 0.32) { const i = (rnd() * N) | 0; if (!G.board[i]) give(G, i, ser[(rnd() * 4) | 0], 1 + ((rnd() * 4) | 0)); }
      else if (r < 0.44) ET.stock(G, (rnd() * G.shop.shelves.length) | 0, ser[(rnd() * 4) | 0], 1 + ((rnd() * 4) | 0));
      else if (r < 0.52) ET.takeBack(G, (rnd() * G.shop.shelves.length) | 0);
      else if (r < 0.6) ET.restock(G);
      else if (r < 0.7) { const c = G.shop.custs[(rnd() * G.shop.custs.length) | 0]; if (c) ET.serveNow(G, c.id); }
      else if (r < 0.76) ET.mergeAll(G);
      else if (r < 0.82) ET.buy(G, ET.UPGRADES[(rnd() * ET.UPGRADES.length) | 0].id);
      else if (r < 0.86) ET.takeAll(G);
      else if (r < 0.9) ET.clearTpl(G, (rnd() * G.shop.shelves.length) | 0);
      else if (r < 0.95) { G.coins += 200; }
      else { const H = ET.load(ET.save(G, step)); assert.ok(H); Object.assign(G, H); G.shop.nextIv = 3; }
      const ids = [...G.board.filter(Boolean), ...G.shop.shelves.map(x => x.item).filter(Boolean)].map(it => it.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'id 重複');
      assert.ok(G.shop.shelves.length >= ET.shelfCount(G));
      assert.ok(G.shop.pop >= 0 && G.shop.pop <= 100, '人氣 ' + G.shop.pop);
      assert.ok(Number.isFinite(G.coins) && G.coins >= 0);
      assert.ok(G.shop.custs.length <= ET.queueMax(G));
    }
  }
});

console.log('客人需求導向（花園 / 合成建議）');
test('需求統計：依系列彙整，折合 1 階個數、扣掉盤上已有的，小偷與已滿足的不算', () => {
  const G = fresh(); openShop(G);
  addCust(G, { s: 'wheat', t: 4 });                     // 🍔：折合 8
  give(G, 0, 'wheat', 2);                               // 盤上 🍞 = 2
  addCust(G, { s: 'apple', t: 2 });                     // 🧃：折合 2
  addCust(G, { kind: 'thief', s: null, t: 0 });
  addCust(G, { s: 'wood', t: 2 }); shelfItem(G, 0, 'wood', 3);   // 已有 🏹 可賣 → 不算缺
  const d = ET.demand(G);
  assert.strictEqual(d.length, 2);
  assert.deepStrictEqual(J(d[0]), { s: 'wheat', t: 4, n: 1, need: 8, have: 2, short: 6, tiers: { 4: 1 } });
  assert.deepStrictEqual(J(d[1]), { s: 'apple', t: 2, n: 1, need: 2, have: 0, short: 2, tiers: { 2: 1 } });
  assert.strictEqual(ET.cropOf('wheat'), 'wheat'); assert.strictEqual(ET.cropOf('flower'), 'flower'); assert.strictEqual(ET.cropOf('zzz'), null);
});
test('需求統計：同系列多位客人合併，貴族要 3 件算 3 筆；盤上材料夠 → short = 0', () => {
  const G = fresh(); openShop(G);
  addCust(G, { s: 'apple', t: 3 }); addCust(G, { kind: 'noble', qty: 3, s: 'apple', t: 2, pat: 30 });
  for (let i = 0; i < 12; i++) give(G, i, 'apple', 1);
  const d = ET.demand(G)[0];
  assert.strictEqual(d.n, 4); assert.strictEqual(d.t, 3); assert.strictEqual(d.need, 4 + 2 * 3); assert.strictEqual(d.have, 12); assert.strictEqual(d.short, 0);
});
test('需求文字：同系列不同階分開列（高階在前），不會寫成「🍔×2」', () => {
  const G = fresh(); openShop(G);
  addCust(G, { s: 'wheat', t: 4 }); addCust(G, { s: 'wheat', t: 3 }); addCust(G, { s: 'wheat', t: 3 });
  const d = ET.demand(G)[0];
  assert.strictEqual(ET.wantText(d), '🍔、🥪×2');
  assert.ok(ET.demandHint(G, d).includes('🍔、🥪×2'));
});
test('需求提示：開張第一筆賣出後，提示改成客人缺什麼、該種什麼', () => {
  const G = fresh(); openShop(G); G.stats.merges = 1; G.unlocked.merge = true; G.shop.sales = 3; ET.plant(G, 0, 'wheat'); G.up.farmer = 1;
  addCust(G, { s: 'wheat', t: 4 });
  const h1 = ET.hint(G);
  assert.ok(h1.includes('客人在等') && h1.includes('🍔') && h1.includes('還差 8'), h1);
  for (let i = 0; i < 8; i++) give(G, i, 'wheat', 1);
  assert.ok(ET.hint(G).includes('材料夠了'), ET.hint(G));
  G.shop.custs.length = 0; assert.ok(!ET.hint(G).includes('客人在等'));
});
test('🤖 機器人：有客人在等時，優先合成客人要的系列（不再按系列順序）', () => {
  const mk = custWants => {
    const G = fresh(); openShop(G); G.up.bot = 1;
    give(G, 0, 'wheat', 1); give(G, 1, 'wheat', 1); give(G, 2, 'apple', 1); give(G, 3, 'apple', 1);
    if (custWants) addCust(G, { s: 'apple', t: 2 });
    ET.tick(G, 8); return G;
  };
  const a = mk(false); assert.strictEqual(a.board[0].t, 2, '沒客人：照順序先合小麥');
  const b = mk(true);  assert.strictEqual(b.board[2].t, 2, '客人要 🧃：先合蘋果'); assert.strictEqual(b.board[0].t, 1);
});
test('為客人備貨：先合成客人要的系列再上架；材料不夠就只往上合成', () => {
  const G = fresh(); openShop(G);
  for (let i = 0; i < 8; i++) give(G, i, 'wheat', 1);
  addCust(G, { s: 'wheat', t: 4, pat: 100 });
  const r = ET.prepareDemand(G);
  assert.strictEqual(r.stocked >= 1, true); assert.ok(G.shop.shelves.some(x => x.item && x.item.s === 'wheat' && x.item.t === 4), '🍔 上架');
  assert.strictEqual(r.demand.length, 0, '需求滿足了');
  ET.shopTick(G, 1.1); assert.strictEqual(G.shop.sales, 1);
  const H = fresh(); openShop(H);
  for (let i = 0; i < 3; i++) give(H, i, 'wheat', 1);
  addCust(H, { s: 'wheat', t: 4, pat: 100 });
  const r2 = ET.prepareDemand(H);
  assert.ok(r2.merges >= 1); assert.strictEqual(r2.demand[0].s, 'wheat'); assert.ok(r2.demand[0].short > 0, '還差：' + r2.demand[0].short);
});
test('為客人備貨：沒客人 → 什麼都不合成', () => {
  const G = fresh(); openShop(G); give(G, 0, 'wheat', 1); give(G, 1, 'wheat', 1); G.shop.shelves.forEach(x => { x.tpl = { s: 'wood', t: 5 }; });
  const r = ET.prepareDemand(G); assert.strictEqual(r.merges, 0); assert.strictEqual(G.stats.merges, 0);
});

console.log('升級自動化 vs 客人需求：不能打架');
test('🚚 自動出貨不能把客人在等的貨賣掉（原本「優先賣最貴的」會先賣掉客人要的 5 階）', () => {
  const G = fresh(); openShop(G); G.up.shipper = 1; G.dex['flower:1'] = 1; G.dex['flower:4'] = 1;
  give(G, 0, 'flower', 5);                                   // 156，盤上最貴
  for (let i = 1; i < 27; i++) give(G, i, 'wood', 5);        // 117 × 26，合不掉
  addCust(G, { s: 'flower', t: 4, pat: 1e9 });               // 客人要 🌺（5 階也行）
  ET.tick(G, 1);
  assert.ok(G.board.some(it => it && it.s === 'flower' && it.t === 5), '客人要的 🌹 不該被賣掉');
  assert.strictEqual(ET.count(G), 22); assert.strictEqual(G.stats.sold, 5, '改賣其他的最貴貨');
});
test('🚚 自動出貨也不能賣掉「空貨架設定的商品」（店員 3 秒內就要補的貨）', () => {
  const G = fresh(); openShop(G); G.up.shipper = 1;
  G.shop.shelves[0].tpl = { s: 'flower', t: 4 };
  give(G, 0, 'flower', 5); for (let i = 1; i < 27; i++) give(G, i, 'wood', 5);
  ET.tick(G, 1);
  assert.ok(G.board.some(it => it && it.s === 'flower' && it.t === 5), '貨架在等的 🌹 不該被賣掉');
});
test('🚚 自動出貨的合成不能把貴族要的 3 件合成剩 2 件', () => {
  const G = fresh(); openShop(G); G.up.shipper = 1;
  for (let i = 0; i < 3; i++) give(G, i, 'apple', 2);        // 3 個 🧃
  for (let i = 3; i < 27; i++) give(G, i, 'wood', 5);        // 湊滿 27 個，觸發自動出貨
  addCust(G, { kind: 'noble', qty: 3, s: 'apple', t: 2, pat: 1e9 });
  ET.tick(G, 1);
  assert.strictEqual(G.board.filter(it => it && it.s === 'apple' && it.t >= 2).length, 3, '3 件都要留著');
});
test('🤖 機器人預設合成也不能把貴族要的件數合少（沒有別的可合時寧可不合）', () => {
  const G = fresh(); openShop(G); G.up.bot = 2;
  for (let i = 0; i < 3; i++) give(G, i, 'apple', 2);       // 3 個 🧃，這是盤上唯一成對的東西
  addCust(G, { kind: 'noble', qty: 3, s: 'apple', t: 2, pat: 1e9 });
  ET.tick(G, 20);
  assert.strictEqual(G.board.filter(it => it && it.s === 'apple' && it.t === 2).length, 3, '🧃 沒被合掉');
  assert.strictEqual(G.stats.merges, 0);
});
test('🤖 機器人：被客人佔著的不合，但還有別的可合時照常合成（沒卡住）', () => {
  const G = fresh(); openShop(G); G.up.bot = 2;
  for (let i = 0; i < 3; i++) give(G, i, 'apple', 2);
  give(G, 5, 'wheat', 1); give(G, 6, 'wheat', 1);
  addCust(G, { kind: 'noble', qty: 3, s: 'apple', t: 2, pat: 1e9 });
  ET.tick(G, 7);
  assert.strictEqual(G.board.filter(it => it && it.s === 'apple' && it.t === 2).length, 3);
  assert.ok(G.board.some(it => it && it.s === 'wheat' && it.t === 2), '改合小麥');
});
test('沒有客人時機器人 / 自動出貨照舊（保留機制不影響平常）', () => {
  const G = fresh(); openShop(G); G.up.bot = 2;
  for (let i = 0; i < 3; i++) give(G, i, 'apple', 2);
  ET.tick(G, 7); assert.strictEqual(G.stats.merges, 1, '沒客人 → 3 個 🧃 照合');
  const H = fresh(); H.up.shipper = 1; for (let i = 0; i < 27; i++) give(H, i, 'wood', 5);
  ET.tick(H, 1); assert.strictEqual(ET.count(H), 22); assert.strictEqual(H.stats.sold, 5);
});
test('為客人備貨不能吃掉別的客人已經有的貨（貴族 3 個 🧃 + 另一位要 🥧）', () => {
  const G = fresh(); openShop(G);
  for (let i = 0; i < 3; i++) give(G, i, 'apple', 2);
  for (let i = 3; i < 7; i++) give(G, i, 'apple', 1);        // 4 個 🍎 → 湊 1 個 🥧
  addCust(G, { kind: 'noble', qty: 3, s: 'apple', t: 2, pat: 60 });
  addCust(G, { s: 'apple', t: 3, pat: 60 });
  const r = ET.prepareDemand(G);
  assert.strictEqual(r.demand.length, 0, '需求都滿足了：' + JSON.stringify(r.demand));
  ET.shopTick(G, 1.1); ET.shopTick(G, 1.1);
  assert.strictEqual(G.shop.sales, 4, '貴族 3 件 + 另一位 1 件都買到');
});
test('保留有上限：需求再多也不能把盤面佔滿，否則自動出貨賣不掉、🚜 農夫會停工', () => {
  const G = fresh(); openShop(G); G.up.shipper = 1; G.up.shelf = 8; G.up.deco = 5; G.up.farmer = 1; ET.shopSync(G);
  G.shop.shelves.forEach(x => { x.tpl = { s: 'wood', t: 5 }; });                 // 12 個空貨架都在等 🛶
  for (let i = 0; i < 8; i++) addCust(G, { kind: 'noble', qty: 3, s: 'wood', t: 2, pat: 1e9 });   // 8 位貴族 × 3 件
  for (let i = 0; i < 30; i++) give(G, i, 'wood', 5);                            // 盤面全是客人想要的
  assert.ok(ET.reservedInfo(G).reserved.size <= ET.SHOP.reserveMax, '保留 ≤ 上限');
  ET.tick(G, 1);
  assert.ok(ET.count(G) <= ET.SHIP_LOW, '自動出貨仍然把盤面降到 ' + ET.SHIP_LOW + ' 以下：' + ET.count(G));
  assert.ok(ET.SHOP.reserveMax < ET.SHIP_LOW, '上限必須小於出貨目標，才保證賣得下來');
  ET.plantAll(G, 'wheat'); ET.tick(G, 12);
  assert.ok(G.board.some(it => it && it.s === 'wheat'), '農夫有空位可以收成，沒有停工');
});
test('保留邏輯：成對但都被客人佔著的不合；只佔一個的，另一個可以合', () => {
  const G = fresh(); openShop(G);
  give(G, 0, 'apple', 2); give(G, 1, 'apple', 2);
  addCust(G, { s: 'apple', t: 2, pat: 1e9 });                // 只要 1 件 → 兩個裡只保留 1 個
  const { reserved } = ET.reservedInfo(G);
  assert.strictEqual(reserved.size, 1);
});

console.log('S3 冒險 + 裝備');
const advGame = (roles, opts) => {
  opts = opts || {};
  const G = fresh(); G.unlocked.shop = true; G.unlocked.quest = true; G.adv = ET.newAdv(); G.rs = opts.rs || 4242;
  for (const r of roles) { const h = { id: G.adv.nextId++, role: r, lvl: opts.lvl || 1, xp: 0, hp: 0, gear: { weapon: null, armor: null, trinket: null } }; h.hp = ET.heroStats(G, h).hp; G.adv.heroes.push(h); }
  return G;
};
const wear = (G, h, slot, s, t) => { h.gear[slot] = { id: G.nextId++, s, t }; h.hp = ET.heroStats(G, h).hp; };
const runAdv = (G, secs) => { for (let i = 0; i < secs; i++) { ET.advTick(G, 1); G.ev.length = 0; } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
const strongTeam = (lvl, tier) => {
  const G = advGame(['sword', 'knight', 'archer', 'elf'], { lvl });
  for (const h of G.adv.heroes) { wear(G, h, 'weapon', 'blade', tier); wear(G, h, 'armor', 'plate', tier); wear(G, h, 'trinket', 'charm', tier); }
  return G;
};

test('英雄屬性：職業底 × 等級（每級 +6%）+ 裝備（每高 1 階 ×1.7）× 料理加成', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0];
  let s = ET.heroStats(G, h); assert.strictEqual(s.hp, 50); assert.ok(near(s.atk, 9) && near(s.def, 1));
  h.lvl = 11; s = ET.heroStats(G, h); assert.strictEqual(s.hp, 80); assert.ok(near(s.atk, 14.4) && near(s.def, 1.6));
  h.lvl = 1;
  wear(G, h, 'weapon', 'blade', 1); assert.ok(near(ET.heroStats(G, h).atk, 14));
  wear(G, h, 'weapon', 'blade', 2); assert.ok(near(ET.heroStats(G, h).atk, 9 + 5 * 1.7));
  wear(G, h, 'weapon', 'blade', 3); assert.ok(near(ET.heroStats(G, h).atk, 9 + 5 * 2.89));
  wear(G, h, 'armor', 'plate', 3); s = ET.heroStats(G, h); assert.ok(near(s.def, 1 + 3 * 2.89)); assert.strictEqual(s.hp, Math.round(50 + 15 * 2.89));
  wear(G, h, 'trinket', 'charm', 1); assert.ok(near(ET.heroStats(G, h).atk, 9 + 5 * 2.89 + 1.5));
  G.adv.food.act = { s: 'wheat', t: 4 }; assert.ok(near(ET.heroStats(G, h).atk, (9 + 5 * 2.89 + 1.5) * 1.12));
  assert.strictEqual(ET.GEAR_MUL, 1.7);
});
test('冒險解鎖：商店開張後累計賺到 300 才開放，送一位劍士並通知 UI', () => {
  const G = fresh(); G.unlocked.shop = true; G.stats.earned = 299;
  ET.tick(G, 1); assert.ok(!G.unlocked.quest && !G.adv);
  G.stats.earned = 300; ET.tick(G, 1);
  assert.ok(G.unlocked.quest); assert.strictEqual(G.adv.heroes.length, 1); assert.strictEqual(G.adv.heroes[0].role, 'sword');
  assert.ok(G.ev.some(e => e.t === 'unlock' && e.tab === 'quest'));
  const H = fresh(); H.stats.earned = 999; ET.tick(H, 1); assert.ok(!H.unlocked.quest, '商店沒開張不解鎖');
});
test('招募：1 位免費（開局），之後 150 / 500 / 1500，不能重複職業、最多 4 位', () => {
  const G = advGame(['sword']); assert.strictEqual(ET.recruitCost(G), 150);
  assert.strictEqual(ET.recruit(G, 'knight').why, 'coins');
  G.coins = 1e6;
  assert.ok(ET.recruit(G, 'knight').ok); assert.strictEqual(G.coins, 1e6 - 150);
  assert.strictEqual(ET.recruit(G, 'sword').why, 'dup'); assert.strictEqual(ET.recruit(G, 'nobody').why, 'dup');
  assert.ok(ET.recruit(G, 'archer').ok); assert.strictEqual(G.coins, 1e6 - 150 - 500);
  assert.ok(ET.recruit(G, 'elf').ok); assert.strictEqual(G.coins, 1e6 - 150 - 500 - 1500);
  assert.strictEqual(ET.recruit(G, 'mage').why, 'full'); assert.strictEqual(G.adv.heroes.length, 4); assert.strictEqual(ET.recruitCost(G), Infinity);
  assert.strictEqual(ET.recruit(fresh(), 'knight').why, 'locked');
});
test('鍛造：扣金幣與材料（低階先用）、產出 1 階裝備放上合成盤、金幣每次 ×1.15', () => {
  const G = advGame(['sword']); G.coins = 1000;
  give(G, 0, 'wood', 1); give(G, 1, 'wood', 2); give(G, 2, 'wood', 2);
  assert.strictEqual(ET.forgeCost(G, 'blade'), 40);
  const r = ET.forge(G, 'blade');
  assert.ok(r.ok); assert.strictEqual(G.coins, 960);
  assert.strictEqual(G.board[0].s, 'blade'); assert.strictEqual(G.board[0].t, 1);
  assert.strictEqual(G.board[1], null); assert.strictEqual(G.board[2].s, 'wood');
  assert.strictEqual(ET.forgeCost(G, 'blade'), Math.round(40 * 1.15)); assert.strictEqual(G.adv.forged.blade, 1);
  assert.ok(G.dex['blade:1']);
});
test('鍛造：缺錢 / 缺材料 / 未解鎖 → 失敗且不扣東西；防具要木頭 4、飾品要花 2', () => {
  const G = advGame(['sword']);
  give(G, 0, 'wood', 1); give(G, 1, 'wood', 1);
  assert.strictEqual(ET.forge(G, 'blade').why, 'coins'); G.coins = 500;
  assert.strictEqual(ET.forge(G, 'plate').why, 'mats'); assert.strictEqual(ET.forge(G, 'plate').need, 'wood');
  assert.strictEqual(ET.forge(G, 'charm').need, 'flower');
  assert.strictEqual(G.coins, 500); assert.strictEqual(ET.count(G), 2);
  give(G, 2, 'wood', 2); assert.ok(ET.forge(G, 'plate').ok, '木頭折合 4 夠了');
  give(G, 5, 'flower', 1); give(G, 6, 'flower', 1); assert.ok(ET.forge(G, 'charm').ok);
  assert.strictEqual(ET.forge(G, 'nope').why, 'locked'); assert.strictEqual(ET.forge(fresh(), 'blade').why, 'locked');
});
test('裝備：穿上、舊的換回同一格、血量上限提高時補上增加的部分', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0];
  give(G, 5, 'plate', 1); give(G, 6, 'blade', 1); give(G, 7, 'blade', 2);
  assert.ok(ET.equip(G, 5, h.id).ok);
  assert.strictEqual(h.gear.armor.s, 'plate'); assert.strictEqual(G.board[5], null);
  assert.strictEqual(h.hp, 65, '血量上限 50 → 65，現有血量一起補上');
  ET.equip(G, 6, h.id); const r = ET.equip(G, 7, h.id);
  assert.ok(r.swapped); assert.strictEqual(h.gear.weapon.t, 2); assert.strictEqual(G.board[7].s, 'blade'); assert.strictEqual(G.board[7].t, 1, '舊的換回同一格');
  give(G, 8, 'wood', 1); assert.ok(!ET.equip(G, 8, h.id).ok, '不是裝備');
  assert.ok(!ET.equip(G, 9, h.id).ok, '空格'); assert.ok(!ET.equip(G, 7, 999).ok, '沒有這位英雄');
});
test('卸下：放到第一個空格；盤面滿了失敗。血量不超過新上限', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0];
  wear(G, h, 'armor', 'plate', 1); h.hp = 65;
  assert.ok(ET.unequip(G, h.id, 'armor').ok); assert.strictEqual(G.board[0].s, 'plate'); assert.strictEqual(h.gear.armor, null); assert.strictEqual(h.hp, 50);
  assert.strictEqual(ET.unequip(G, h.id, 'armor').why, 'empty');
  wear(G, h, 'weapon', 'blade', 1); for (let i = 0; i < 30; i++) if (!G.board[i]) give(G, i, 'wood', 1);
  assert.strictEqual(ET.unequip(G, h.id, 'weapon').why, 'full'); assert.ok(h.gear.weapon);
});
test('強化：吃掉盤上同系列同階的一件，身上這件 +1；沒有 / 滿階 / 空欄都失敗', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0];
  wear(G, h, 'weapon', 'blade', 1);
  assert.strictEqual(ET.enhance(G, h.id, 'weapon').why, 'none');
  give(G, 3, 'blade', 2); assert.strictEqual(ET.enhance(G, h.id, 'weapon').why, 'none', '階數不同不算');
  give(G, 4, 'blade', 1); const r = ET.enhance(G, h.id, 'weapon');
  assert.ok(r.ok); assert.strictEqual(h.gear.weapon.t, 2); assert.strictEqual(G.board[4], null); assert.ok(G.board[3], '別的不動');
  assert.strictEqual(ET.enhance(G, h.id, 'armor').why, 'empty');
  wear(G, h, 'weapon', 'blade', 5); give(G, 6, 'blade', 5); assert.strictEqual(ET.enhance(G, h.id, 'weapon').why, 'max');
});
test('料理補給：只收 2 階以上的 🍞🥪🍔🎂🧃🥧🍷🏆，最多排 3 個，可取回', () => {
  const G = advGame(['sword']);
  give(G, 0, 'wheat', 1); give(G, 1, 'wheat', 2); give(G, 2, 'apple', 2); give(G, 3, 'wood', 3); give(G, 4, 'wheat', 3); give(G, 5, 'apple', 3);
  assert.strictEqual(ET.packFood(G, 0).why, 'notfood', '1 階不算料理'); assert.strictEqual(ET.packFood(G, 3).why, 'notfood', '木頭不是料理');
  assert.ok(ET.packFood(G, 1).ok && ET.packFood(G, 2).ok && ET.packFood(G, 4).ok);
  assert.strictEqual(ET.packFood(G, 5).why, 'full'); assert.strictEqual(G.adv.food.queue.length, 3); assert.strictEqual(G.board[1], null);
  assert.ok(ET.unpackFood(G, 0).ok); assert.strictEqual(G.adv.food.queue.length, 2); assert.strictEqual(G.board.filter(it => it && it.s === 'wheat' && it.t === 2).length, 1);
  assert.ok(!ET.unpackFood(G, 9).ok);
});
test('料理補給：依序啟用、效果持續 120 × 2^(階-2) 秒、期滿後血量上限回復', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0]; G.adv.recover = 1e6;     // 躺平中：不戰鬥，只算料理
  give(G, 0, 'wheat', 2); give(G, 1, 'wheat', 3);
  ET.packFood(G, 0); ET.packFood(G, 1);
  runAdv(G, 1);
  assert.strictEqual(G.adv.food.act.t, 2); assert.strictEqual(G.adv.food.left, 120); assert.strictEqual(G.adv.food.queue.length, 1);
  assert.strictEqual(ET.heroStats(G, h).hp, 55, '🍞 血量 +10%');
  h.hp = 55; runAdv(G, 100); assert.ok(G.adv.food.act && G.adv.food.act.t === 2);
  runAdv(G, 25);
  assert.strictEqual(G.adv.food.act.t, 3, '🍞 結束，🥪 接著'); assert.strictEqual(h.hp, 50, '血量不超過新上限');
  assert.ok(near(ET.heroStats(G, h).def, 1 * 1.12), '🥪 防禦 +12%');
  assert.strictEqual(ET.FOOD_SEC(2), 120); assert.strictEqual(ET.FOOD_SEC(3), 240); assert.strictEqual(ET.FOOD_SEC(5), 960);
  runAdv(G, 245); assert.strictEqual(G.adv.food.act, null);
});
test('料理效果：🧃 回血、🎂 經驗 +25%', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0]; G.adv.recover = 1e6;
  G.adv.recover = 0; give(G, 0, 'apple', 2); ET.packFood(G, 0); h.hp = 10;
  G.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1e9, maxhp: 1e9, atk: 1, def: 0 }], t: 0 };      // 戰鬥中（敵人每回合只打 1）
  runAdv(G, 6);
  assert.ok(h.hp >= 10 + 2 * 6 - 6, '每秒 +2、扣掉敵人每回合 1：' + h.hp);
  const A = advGame(['sword']), B = advGame(['sword']);
  A.adv.food.act = { s: 'wheat', t: 5 }; A.adv.food.left = 9999;
  for (const g of [A, B]) { g.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 }; ET.advTick(g, 1); }
  assert.ok(A.adv.heroes[0].xp > B.adv.heroes[0].xp, '🎂 經驗較多：' + A.adv.heroes[0].xp + ' vs ' + B.adv.heroes[0].xp);
});
test('戰鬥：贏了拿 💰（等於 stageReward）、經驗、前進一關；結果可重現', () => {
  const G = advGame(['sword']);
  const c0 = G.coins; runAdv(G, 60);
  assert.ok(G.adv.stats.stages >= 1); assert.ok(G.coins >= c0 + ET.stageReward(1, 1));
  assert.strictEqual(G.stats.earned, G.coins, '冒險收入也算進總收入');
  assert.ok(G.adv.heroes[0].xp > 0 || G.adv.heroes[0].lvl > 1); assert.ok(G.adv.stage >= 2 || G.adv.stats.defeats > 0);
  const a = advGame(['sword', 'knight'], { rs: 77 }), b = advGame(['sword', 'knight'], { rs: 77 });
  runAdv(a, 300); runAdv(b, 300);
  assert.strictEqual(JSON.stringify(a.adv), JSON.stringify(b.adv)); assert.strictEqual(a.coins, b.coins);
});
test('戰鬥節奏與 dt 無關：0.5 秒 × 2 = 1 秒，累積不足 1 秒不出手', () => {
  const a = advGame(['sword'], { rs: 5 }), b = advGame(['sword'], { rs: 5 });
  ET.advTick(a, 0.4); assert.strictEqual(a.adv.battle, null, '不到 1 秒不開打');
  for (let i = 0; i < 200; i++) { ET.advTick(a, 0.5); ET.advTick(a, 0.5); ET.advTick(b, 1); }
  a.adv.acc = 0; b.adv.acc = 0;
  const strip = g => JSON.stringify(Object.assign({}, g.adv, { acc: 0 }));
  assert.strictEqual(strip(a), strip(b));
});
test('職業：法師打全體、弓手打最後面、劍士打最前面、精靈每 2 秒治療最殘血的', () => {
  const mkB = () => ({ enemies: [0, 1, 2].map(i => ({ e: '🐺', name: 'm' + i, hp: 1000, maxhp: 1000, atk: 1, def: 0 })), t: 0 });
  for (const [role, check] of [
    ['mage', e => { for (const x of e) assert.ok(x.hp < 1000 && x.hp >= 1000 - 5, '全體：' + x.hp); }],
    ['archer', e => { assert.strictEqual(e[0].hp, 1000); assert.strictEqual(e[1].hp, 1000); assert.ok(e[2].hp < 1000, '最後面'); }],
    ['sword', e => { assert.ok(e[0].hp < 1000); assert.strictEqual(e[1].hp, 1000); assert.strictEqual(e[2].hp, 1000); }]
  ]) { const G = advGame([role]); G.adv.battle = mkB(); runAdv(G, 1); check(G.adv.battle.enemies); }
  const G = advGame(['knight', 'elf']); const kn = G.adv.heroes[0];
  G.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1e9, maxhp: 1e9, atk: 1, def: 0 }], t: 1 };   // 下一回合 t=2 → 精靈治療
  kn.hp = 10; ET.advTick(G, 1);
  assert.ok(kn.hp >= 10 + 7 - 1, '被補血：' + kn.hp); assert.ok(G.ev.some(e => e.t === 'heal'));
});
test('騎士嘲諷：有騎士時怪物約 70% 打騎士（60% 嘲諷 + 其餘隨機 1/4）', () => {
  const G = advGame(['knight', 'sword', 'archer', 'mage']); let onKnight = 0, total = 0;
  const kid = G.adv.heroes[0].id;
  for (let i = 0; i < 600; i++) {
    for (const h of G.adv.heroes) h.hp = 1e9;
    G.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1e9, maxhp: 1e9, atk: 1, def: 0 }], t: 0 };
    ET.advTick(G, 1);
    for (const e of G.ev) if (e.t === 'hit' && e.side === 'hero') { total++; if (e.hid === kid) onKnight++; }
    G.ev.length = 0;
  }
  assert.ok(total > 500 && onKnight / total > 0.6 && onKnight / total < 0.8, '打騎士比例 ' + (onKnight / total).toFixed(2));
});
test('全滅：退一關、躺平 10 秒後血量補滿重新開打；再贏 6 場才往上推', () => {
  const G = advGame(['sword']); G.adv.open[2] = true; G.adv.area = 2; G.adv.stage = 10;
  let n = 0; while (G.adv.stats.defeats === 0 && n++ < 100) runAdv(G, 1);
  assert.strictEqual(G.adv.stats.defeats, 1); assert.strictEqual(G.adv.stage, 9); assert.strictEqual(G.adv.recover, ET.ADV.recoverSec); assert.strictEqual(G.adv.hold, ET.ADV.holdWins);
  assert.strictEqual(G.adv.heroes[0].hp, 0);
  runAdv(G, ET.ADV.recoverSec); assert.strictEqual(G.adv.recover, 0); assert.strictEqual(G.adv.heroes[0].hp, ET.heroStats(G, G.adv.heroes[0]).hp, '血量補滿');
  const S = strongTeam(20, 5); S.adv.stage = 3; S.adv.hold = 3;
  let w = 0; while (S.adv.stats.stages < 3 && w++ < 200) runAdv(S, 1);
  assert.strictEqual(S.adv.stage, 3, '前 3 場贏了都留在原地'); assert.strictEqual(S.adv.hold, 0);
  w = 0; while (S.adv.stats.stages < 4 && w++ < 200) runAdv(S, 1);
  assert.strictEqual(S.adv.stage, 4, '第 4 場才往上');
});
test('Boss：第一次打倒 → 開放下一區並自動前進；最後一區打倒只通知；已打倒的 Boss 可重複刷', () => {
  const G = strongTeam(30, 5); G.adv.stage = 10;
  let n = 0; while (!G.adv.cleared[1] && n++ < 300) runAdv(G, 1);
  assert.ok(G.adv.cleared[1]); assert.ok(G.adv.open[2]); assert.strictEqual(G.adv.area, 2); assert.strictEqual(G.adv.stage, 1); assert.strictEqual(G.adv.hold, 0);
  G.adv.area = 1; G.adv.stage = 10; const before = G.adv.stats.stages; G.adv.battle = null;
  n = 0; while (G.adv.stats.stages === before && n++ < 300) runAdv(G, 1);
  assert.strictEqual(G.adv.area, 1, '已打倒過的 Boss 留在原地重複刷'); assert.strictEqual(G.adv.stage, 10);
  G.adv.area = 2; G.adv.stage = 10; G.adv.battle = null; G.ev.length = 0; n = 0;
  while (!G.adv.cleared[2] && n++ < 600) { ET.advTick(G, 1); if (G.adv.cleared[2]) break; G.ev.length = 0; }
  assert.ok(G.adv.cleared[2]); assert.strictEqual(G.adv.area, 2, '沒有第 3 區'); assert.ok(G.ev.some(e => e.t === 'toast' && /打倒/.test(e.text)));
  assert.ok(!G.adv.open[3]);
});
test('選區域：只能去開放的、會回到那區已到過的關卡', () => {
  const G = advGame(['sword']);
  assert.ok(!ET.advGo(G, 2).ok); G.adv.open[2] = true; G.adv.reach[2] = 4;
  assert.ok(ET.advGo(G, 2).ok); assert.strictEqual(G.adv.area, 2); assert.strictEqual(G.adv.stage, 4);
  assert.ok(ET.advGo(G, 1).ok); assert.strictEqual(G.adv.stage, G.adv.reach[1]); assert.ok(!ET.advGo(fresh(), 1).ok);
});
test('掉寶：過關有機率掉 1 階裝備放上合成盤；盤面滿了直接折現（不浪費、不卡）', () => {
  const realRand = ET.rand;
  try {
    ET.rand = () => 0;                                                       // 每次擲骰都是 0：一定掉、掉第一種（武器）、區域 2 掉 2 階
    const G = strongTeam(10, 3); G.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 }; ET.advTick(G, 1);
    assert.ok(G.board.some(it => it && it.s === 'blade' && it.t === 1)); assert.strictEqual(G.adv.stats.drops, 1);
    const F = strongTeam(10, 3); for (let i = 0; i < 30; i++) give(F, i, 'wood', 1);
    const c0 = F.coins; F.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 }; ET.advTick(F, 1);
    assert.strictEqual(ET.count(F), 30); assert.strictEqual(F.coins - c0, ET.stageReward(1, 1) + ET.value('blade', 1), '折現');
    const A2 = strongTeam(10, 3); A2.adv.open[2] = true; A2.adv.area = 2; A2.adv.battle = { enemies: [{ e: '🦂', name: 'x', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 }; ET.advTick(A2, 1);
    assert.ok(A2.board.some(it => it && it.s === 'blade' && it.t === 2), '區域 2 掉 2 階');
  } finally { ET.rand = realRand; }
});
test('點怪物：額外傷害 = 隊伍最高攻擊的一半；打死會過關', () => {
  const G = advGame(['sword']);
  G.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1000, maxhp: 1000, atk: 1, def: 0 }, { e: '🐺', name: 'y', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 };
  const r = ET.advTap(G, 0); assert.ok(r.ok); assert.strictEqual(r.dmg, Math.round(9 * 0.5)); assert.strictEqual(G.adv.battle.enemies[0].hp, 1000 - r.dmg);
  assert.ok(!ET.advTap(G, 5).ok);
  const c0 = G.coins; ET.advTap(G, 1); G.adv.battle.enemies[0].hp = 1; ET.advTap(G, 0);
  assert.strictEqual(G.adv.battle, null); assert.ok(G.coins > c0); assert.strictEqual(G.adv.stats.stages, 1);
  assert.ok(!ET.advTap(G, 0).ok, '沒有戰鬥');
});
test('升級：贏了會升級，每級血量 / 攻擊 +6%，且血量補上增加的部分', () => {
  const G = advGame(['sword']), h = G.adv.heroes[0];
  h.xp = ET.heroXpNeed(1) - 1; h.hp = 30;
  G.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 }; ET.advTick(G, 1);
  assert.strictEqual(h.lvl, 2); assert.strictEqual(ET.heroStats(G, h).hp, Math.round(50 * 1.06)); assert.ok(h.hp >= 30);
  assert.strictEqual(ET.heroXpNeed(1), 20); assert.strictEqual(ET.heroXpNeed(4), 160);
  const L = advGame(['sword'], { lvl: ET.ADV.heroMaxLv }); L.adv.battle = { enemies: [{ e: '🐺', name: 'x', hp: 1, maxhp: 1, atk: 1, def: 0 }], t: 0 }; ET.advTick(L, 1);
  assert.strictEqual(L.adv.heroes[0].lvl, ET.ADV.heroMaxLv, '滿級不再升');
});
test('裝備與商店不打架：客人不想要裝備、補貨不建議裝備、自動出貨不賣裝備', () => {
  const G = fresh(); openShop(G); G.dex['blade:1'] = 1; G.dex['blade:2'] = 1; G.dex['plate:2'] = 1; G.dex['charm:3'] = 1; G.shop.nextIv = 1;
  for (let i = 0; i < 80; i++) { for (let k = 0; k < G.shop.shelves.length; k++) if (!G.shop.shelves[k].item) shelfItem(G, k, 'wheat', 2); ET.shopTick(G, 1); }
  assert.ok(G.shop.cid > 5);
  const H = fresh(); openShop(H); give(H, 0, 'blade', 2); give(H, 1, 'plate', 2); give(H, 2, 'charm', 2);
  assert.strictEqual(ET.restock(H), 0, '沒有設定的貨架不建議裝備');
  const S = fresh(); S.up.shipper = 1;
  give(S, 0, 'blade', 4); give(S, 1, 'plate', 5); give(S, 2, 'charm', 3);
  for (let i = 3; i < 8; i++) give(S, i, 'wood', 5);
  for (let i = 8; i < 27; i++) give(S, i, i % 2 ? 'blade' : 'plate', 1 + (i % 4));
  const gearMass = g => g.board.reduce((m, it) => m + (it && ET.isGear(it.s) ? Math.pow(2, it.t - 1) : 0), 0);
  const gm = gearMass(S); ET.tick(S, 1);
  assert.strictEqual(gearMass(S), gm, '裝備一件都沒被賣（只有合成，等價量不變）'); assert.ok(S.stats.sold >= 0);
});
test('存檔：英雄、裝備、料理、全滅冷卻、已開區域都還原；進行中的那場戰鬥不存', () => {
  const G = advGame(['sword', 'knight'], { lvl: 7 }); const [a, b] = G.adv.heroes;
  wear(G, a, 'weapon', 'blade', 3); wear(G, b, 'armor', 'plate', 2); a.xp = 33; b.hp = 12;
  give(G, 0, 'wheat', 3); ET.packFood(G, 0); G.adv.food.act = { id: G.nextId++, s: 'apple', t: 2 }; G.adv.food.left = 77;
  G.adv.hold = 3; G.adv.recover = 4; G.adv.open[2] = true; G.adv.cleared[1] = true; G.adv.reach[2] = 5; G.adv.stage = 6; G.adv.area = 2; G.adv.forged.blade = 3; G.adv.stats.stages = 42;
  runAdv(G, 3); assert.ok(G.adv.battle || G.adv.recover >= 0);
  const H = ET.load(ET.save(G, 9));
  assert.ok(H && H.adv); assert.strictEqual(H.adv.battle, null); assert.strictEqual(H.adv.acc, 0);
  const strip = x => JSON.stringify(Object.assign({}, x, { battle: null, acc: 0, cleared: { 1: !!x.cleared[1], 2: !!x.cleared[2] } }));     // 還原時會把沒打過的區域補成 false，語意相同
  assert.strictEqual(strip(H.adv), strip(G.adv)); assert.ok(H.unlocked.quest);
  const ids = [...H.board.filter(Boolean), ...H.shop.shelves.map(x => x.item).filter(Boolean), ...H.adv.heroes.flatMap(h => Object.values(h.gear).filter(Boolean)), ...H.adv.food.queue].map(it => it.id);
  assert.strictEqual(new Set(ids).size, ids.length, '物品 id 不重複'); assert.ok(H.nextId > Math.max(...ids));
});
test('存檔相容與壞檔：沒有冒險資料的舊存檔、只有旗標沒有資料、亂填的英雄與裝備', () => {
  const old = JSON.parse(ET.save(fresh(), 1)); delete old.adv; delete old.unlocked.quest;
  const G = ET.load(JSON.stringify(old)); assert.ok(G && G.adv === null && !G.unlocked.quest);
  const flag = JSON.parse(ET.save(fresh(), 1)); flag.unlocked.quest = true; delete flag.adv;
  const F = ET.load(JSON.stringify(flag)); assert.ok(F.adv); assert.strictEqual(F.adv.heroes.length, 1); assert.strictEqual(F.adv.heroes[0].role, 'sword');
  const bad = JSON.parse(ET.save(advGame(['sword']), 1));
  bad.adv.heroes = [{ role: 'nope' }, { role: 'sword', lvl: 999, xp: 'x', hp: NaN, gear: { weapon: { s: 'plate', t: 1 }, armor: { s: 'plate', t: 99 }, trinket: { s: 'charm', t: 2 } } },
    { role: 'sword' }, { role: 'knight', hp: -5 }, { role: 'archer' }, { role: 'elf' }, { role: 'mage' }, null, 5];
  bad.adv.area = 99; bad.adv.stage = -3; bad.adv.recover = 1e9; bad.adv.hold = 'x'; bad.adv.food = { queue: [{ s: 'wood', t: 3 }, { s: 'wheat', t: 3 }, 7, { s: 'apple', t: 99 }], act: { s: 'zzz', t: 1 }, left: 'x' };
  const B = ET.load(JSON.stringify(bad));
  assert.ok(B && B.adv); const A = B.adv;
  assert.ok(A.heroes.length <= 4 && new Set(A.heroes.map(h => h.role)).size === A.heroes.length, '最多 4 位、職業不重複');
  const s = A.heroes.find(h => h.role === 'sword'); assert.strictEqual(s.lvl, ET.ADV.heroMaxLv); assert.strictEqual(s.xp, 0);
  assert.strictEqual(s.gear.weapon, null, '防具不能穿在武器欄'); assert.strictEqual(s.gear.armor, null); assert.strictEqual(s.gear.trinket.s, 'charm');
  assert.ok(Number.isFinite(s.hp) && s.hp > 0); const k = A.heroes.find(h => h.role === 'knight'); assert.ok(k.hp >= 0 && Number.isFinite(k.hp));
  assert.ok(A.area >= 1 && A.area <= 2 && A.stage >= 1 && A.stage <= 10 && A.recover <= ET.ADV.recoverSec && A.hold === 0);
  assert.strictEqual(A.food.queue.length, 1); assert.strictEqual(A.food.act, null);
  runAdv(B, 200); assert.ok(Number.isFinite(B.coins));
  assert.strictEqual(ET.load(JSON.stringify(Object.assign(JSON.parse(ET.save(fresh(), 1)), { adv: 'garbage' }))).adv, null);
});
test('離線補算與逐秒 tick 一致（冒險 + 商店 + 農場全自動化）；摘要含冒險數字', () => {
  const mk = () => { const G = strongTeam(3, 2); G.up.farmer = 1; G.up.bot = 2; G.up.clerk = 1; G.up.shipper = 1; G.dex['wheat:2'] = 1; G.dex['wheat:1'] = 1; G.age = 1000; G.plots.forEach((p, i) => ET.plant(G, i, 'wheat')); return G; };
  const a = mk(), b = mk(); const sum = ET.offline(a, 3600); for (let i = 0; i < 3600; i++) ET.tick(b, 1);
  assert.strictEqual(a.coins, b.coins); assert.strictEqual(JSON.stringify(a.adv), JSON.stringify(b.adv)); assert.strictEqual(a.rs, b.rs);
  assert.ok(sum.advStages > 20, '一小時打了不少關：' + sum.advStages); assert.ok(sum.advCoins > 0 && typeof sum.advDefeats === 'number' && typeof sum.advLevels === 'number' && typeof sum.advDrops === 'number');
});
test('冒險提示：開放後引導鍛造武器，鍛造後提示消失', () => {
  const G = advGame(['sword']); G.stats.merges = 1; G.unlocked.merge = true; G.stats.sold = 1; G.shop.sales = 3; ET.plant(G, 0, 'wheat'); G.up.farmer = 1;
  assert.ok(ET.hint(G).includes('鍛造'), ET.hint(G));
  give(G, 0, 'blade', 1); assert.ok(!ET.hint(G).includes('鍛造'));
  const H = advGame(['sword']); H.stats.merges = 1; H.unlocked.merge = true; H.stats.sold = 1; H.shop.sales = 3; ET.plant(H, 0, 'wheat'); H.up.farmer = 1;
  wear(H, H.adv.heroes[0], 'weapon', 'blade', 1); assert.ok(!ET.hint(H).includes('鍛造'));
});
test('效能：一切全開（農場、商店、4 位英雄）離線 12 小時要在 4 秒內算完', () => {
  const G = strongTeam(5, 3); G.up = Object.assign(G.up, { fert: 10, farmer: 1, bot: 5, shipper: 1, offline: 8, shelf: 8, deco: 5, clerk: 1, sign: 5 }); G.expand = 4;
  while (G.plots.length < 25) G.plots.push({ crop: null, p: 0 });
  for (const s of ['wheat', 'apple', 'wood', 'flower']) for (let t = 1; t <= 4; t++) G.dex[s + ':' + t] = 1;
  G.age = 1000; G.plots.forEach((p, i) => ET.plant(G, i, ['wheat', 'apple', 'wood', 'flower'][i % 4]));
  const t0 = Date.now(); const s = ET.offline(G, 12 * 3600); const ms = Date.now() - t0;
  assert.strictEqual(s.sec, 12 * 3600); assert.ok(ms < 4000, '花了 ' + ms + 'ms'); assert.ok(s.advStages > 100);
});
test('S3 隨機亂按：id 不重複、血量 0~上限、英雄 ≤ 4、關卡在範圍內、錢有限', () => {
  let seed = 31337; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ser = ['wheat', 'apple', 'wood', 'flower', 'blade', 'plate', 'charm'];
  for (let run = 0; run < 60; run++) {
    const G = advGame(['sword'], { rs: run + 1 }); G.coins = 2000; G.age = 500; openShop(G); G.shop.nextIv = 5;
    for (let step = 0; step < 220; step++) {
      const r = rnd(), hs = G.adv.heroes, h = hs[(rnd() * hs.length) | 0];
      if (r < 0.25) { for (let k = 0; k < 1 + ((rnd() * 8) | 0); k++) ET.tick(G, rnd() * 4); }
      else if (r < 0.38) { const i = (rnd() * 30) | 0; if (!G.board[i]) give(G, i, ser[(rnd() * 7) | 0], 1 + ((rnd() * 5) | 0)); }
      else if (r < 0.46) ET.forge(G, ['blade', 'plate', 'charm'][(rnd() * 3) | 0]);
      else if (r < 0.56) ET.equip(G, (rnd() * 30) | 0, h.id);
      else if (r < 0.62) ET.unequip(G, h.id, ET.SLOTS[(rnd() * 3) | 0]);
      else if (r < 0.68) ET.enhance(G, h.id, ET.SLOTS[(rnd() * 3) | 0]);
      else if (r < 0.74) ET.packFood(G, (rnd() * 30) | 0);
      else if (r < 0.77) ET.unpackFood(G, (rnd() * 3) | 0);
      else if (r < 0.80) ET.recruit(G, ['knight', 'archer', 'mage', 'elf', 'sword'][(rnd() * 5) | 0]);
      else if (r < 0.84) ET.advGo(G, 1 + ((rnd() * 2) | 0));
      else if (r < 0.87) { if (G.adv.battle) ET.advTap(G, (rnd() * 3) | 0); }
      else if (r < 0.90) ET.mergeAll(G);
      else if (r < 0.93) { G.coins += 500; }
      else if (r < 0.96) ET.restock(G);
      else { const H = ET.load(ET.save(G, step)); assert.ok(H); Object.assign(G, H); G.shop.nextIv = 5; }
      G.ev.length = 0;
      const A = G.adv;
      const ids = [...G.board.filter(Boolean), ...G.shop.shelves.map(x => x.item).filter(Boolean), ...A.heroes.flatMap(x => Object.values(x.gear).filter(Boolean)), ...A.food.queue, ...(A.food.act ? [A.food.act] : [])].map(it => it.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'id 重複 run ' + run + ' step ' + step);
      assert.ok(A.heroes.length >= 1 && A.heroes.length <= 4);
      for (const x of A.heroes) assert.ok(x.hp >= 0 && x.hp <= ET.heroStats(G, x).hp && Number.isFinite(x.hp), '血量 ' + x.hp);
      assert.ok(A.stage >= 1 && A.stage <= 10 && A.area >= 1 && A.area <= 2 && A.open[A.area]);
      assert.ok(Number.isFinite(G.coins) && G.coins >= 0);
    }
  }
});

console.log('UI 原始碼防護（Node 無法模擬滑鼠，所以檢查關鍵寫法沒被改掉）');
test('回歸：拖曳殘影卡住 —— 結束事件掛 window、開始拖曳捕捉指標、切分頁 / 開視窗清殘影、CSS 類別不撞名', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8');
  assert.ok(/addEventListener\('pointerup',\s*endDrag\)/.test(ui), '合成盤的 pointerup 要掛在 window（滑鼠在盤外放開也要收到）');
  assert.ok(/addEventListener\('pointercancel',\s*endDrag\)/.test(ui));
  assert.ok(!/boardEl\.addEventListener\('pointerup'/.test(ui), '不可把 pointerup 改回只掛在 boardEl');
  assert.ok(/boardEl\.setPointerCapture/.test(ui) && /plotsEl\.setPointerCapture/.test(ui), '要捕捉指標');
  assert.ok(/function setTab\(id\) \{\s*cancelDrag\(\)/.test(ui), '切換分頁要清拖曳');
  assert.ok(/function showModal\([^)]*\) \{\s*cancelDrag\(\)/.test(ui), '開視窗要清拖曳');
  assert.ok(/addEventListener\('pointerup',\s*endPlot\)/.test(ui), '花園手勢的結束事件也要掛 window');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css/style.css'), 'utf8');
  assert.ok(/\.dragghost\{/.test(css) && !/^\.ghost\{/m.test(css), '殘影類別 .ghost 會撞到 .btn.ghost');
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
