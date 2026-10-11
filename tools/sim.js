// 進度模擬：一個「有在玩、但不精打細算」的玩家，看前 60 分鐘各里程碑的時間，以及商店佔收入多少。
// 用法：node tools/sim.js            （含商店）
//       node tools/sim.js --no-shop  （玩家不使用商店，當對照組）
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
for (const f of ['js/data.js', 'js/core.js', 'js/shop.js', 'js/adventure.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const ET = ctx.ET;
const USE_SHOP = !process.argv.includes('--no-shop');
const N = ET.COLS * ET.ROWS;

const G = ET.newState(1);
const log = [];
const stamp = (t, what) => log.push(`${String(Math.floor(t / 60)).padStart(3)}:${String(Math.floor(t % 60)).padStart(2, '0')}  ${what}`);
const FARM = ['farmer', 'fert', 'bot', 'shipper', 'click', 'offline'];
const SHOP = ['shelf', 'clerk', 'sign', 'deco'];
let shopOpenAt = null, shopRevAtHour = 0;

function playerActs(t) {
  for (let i = 0; i < G.plots.length; i++) if (!G.plots[i].crop) ET.plant(G, i, 'wheat');
  if (G.up.farmer === 0 && t % 8 === 0) for (let i = 0; i < G.plots.length; i++) ET.tapPlot(G, i, { boost: false });
  if (t % 4 === 0) {
    ET.mergeAll(G);   // 玩家用「✨ 一鍵合成」
    if (USE_SHOP && G.unlocked.shop) {
      if (t % 6 === 0) ET.restock(G);
      // 商店撐不下的高階貨才丟賣出區
      for (let i = 0; i < N; i++) { const it = G.board[i]; if (it && (it.t >= 4 || ET.count(G) > 24)) ET.sell(G, i); }
    } else {
      for (let i = 0; i < N; i++) { const it = G.board[i]; if (it && (it.t >= 3 || ET.count(G) > 24)) ET.sell(G, i); }
    }
  }
}
function shop(t) {
  const list = FARM.concat(USE_SHOP && G.unlocked.shop ? SHOP : []);
  while (true) {
    const ec = ET.expandCost(G);
    let best = null, bc = Infinity;
    for (const id of list) { const c = ET.upgradeCost(G, id); if (c < bc && c <= G.coins) { bc = c; best = id; } }
    if (ec <= G.coins && ec < bc) { ET.buyExpand(G); stamp(t, `擴建田地 → ${G.plots.length} 格 (花 ${ec})`); continue; }
    if (best) { ET.buy(G, best); stamp(t, `買 ${best} → Lv.${G.up[best]} (花 ${bc})`); continue; }
    break;
  }
}
for (let t = 0; t <= 3600; t++) {
  ET.tick(G, 1); playerActs(t); shop(t);
  if (G.unlocked.shop && shopOpenAt == null) { shopOpenAt = t; stamp(t, '🏪 商店開張'); }
  if (t === 600 || t === 1800 || t === 3600) {
    stamp(t, `── 狀態：💰${G.coins}（累計 ${G.stats.earned}，其中商店 ${G.shop.revenue}）田 ${G.plots.length} 格 盤 ${ET.count(G)}/30 ⭐${ET.stars(G)} 賣出${G.shop.sales} 流失${G.shop.lost}`);
  }
}
console.log(USE_SHOP ? '【有使用商店】' : '【不使用商店】');
console.log(log.join('\n'));
const share = G.stats.earned ? Math.round(G.shop.revenue / G.stats.earned * 100) : 0;
console.log(`\n1 小時累計收入 ${G.stats.earned}；商店佔 ${share}%`);
