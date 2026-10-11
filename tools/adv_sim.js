// 冒險數值模擬：不同隊伍 / 裝備階數 / 等級，30 分鐘（遊戲內）能推到哪一關。用法：node tools/adv_sim.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
for (const f of ['js/data.js', 'js/core.js', 'js/shop.js', 'js/adventure.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const ET = ctx.ET;

function run(roles, tier, secs, opts) {
  opts = opts || {};
  const G = ET.newState(7);
  G.unlocked.shop = true; G.stats.earned = 1000; G.unlocked.quest = true;
  G.adv = ET.newAdv();
  roles.forEach((r, i) => {
    const h = { id: G.adv.nextId++, role: r, lvl: opts.lvl || 1, xp: 0, hp: 0, gear: { weapon: null, armor: null, trinket: null } };
    if (tier > 0) {
      h.gear.weapon = { id: 1000 + i * 3, s: 'blade', t: tier };
      if (!opts.weaponOnly) { h.gear.armor = { id: 1001 + i * 3, s: 'plate', t: tier }; h.gear.trinket = { id: 1002 + i * 3, s: 'charm', t: tier }; }
    }
    h.hp = ET.heroStats(G, h).hp; G.adv.heroes.push(h);
  });
  G.rs = 12345;
  if (opts.area) { G.adv.open[opts.area] = true; G.adv.reach[opts.area] = 1; ET.advGo(G, opts.area); }
  let bossAt = null, coins0 = G.coins;
  for (let t = 1; t <= secs; t++) { ET.advTick(G, 1); G.ev.length = 0; if (bossAt == null && G.adv.cleared[opts.area || 1]) bossAt = t; }
  const A = G.adv;
  return { reach: A.reach[opts.area || 1], stage: A.stage, boss: bossAt == null ? '—' : Math.round(bossAt / 60 * 10) / 10 + ' 分', defeats: A.stats.defeats, stages: A.stats.stages, cps: ((G.coins - coins0) / secs).toFixed(2), lv: A.heroes.map(h => h.lvl).join('/') };
}
const row = (name, r) => console.log(name.padEnd(30), '最遠關', String(r.reach).padStart(2), '　打倒Boss', String(r.boss).padStart(7), '　全滅', String(r.defeats).padStart(3), '　💰/秒', r.cps.padStart(5), '　等級', r.lv);

console.log('=== 森林（30 分鐘）===');
row('劍士 無裝備', run(['sword'], 0, 1800));
row('劍士 只有 1 階武器', run(['sword'], 1, 1800, { weaponOnly: true }));
row('劍士 1 階全套', run(['sword'], 1, 1800));
row('劍士 2 階全套', run(['sword'], 2, 1800));
row('劍士+騎士 無裝備', run(['sword', 'knight'], 0, 1800));
row('劍士+騎士 1 階全套', run(['sword', 'knight'], 1, 1800));
row('4 人 無裝備', run(['sword', 'knight', 'archer', 'elf'], 0, 1800));
row('4 人 1 階全套', run(['sword', 'knight', 'archer', 'elf'], 1, 1800));
row('4 人 2 階全套', run(['sword', 'knight', 'archer', 'elf'], 2, 1800));
console.log('\n=== 沙漠（30 分鐘，從第 1 關開始）===');
row('4 人 1 階全套', run(['sword', 'knight', 'archer', 'elf'], 1, 1800, { area: 2 }));
row('4 人 2 階全套', run(['sword', 'knight', 'archer', 'elf'], 2, 1800, { area: 2 }));
row('4 人 3 階全套', run(['sword', 'knight', 'archer', 'elf'], 3, 1800, { area: 2 }));
row('4 人 4 階全套', run(['sword', 'knight', 'archer', 'elf'], 4, 1800, { area: 2 }));
row('4 人 5 階全套', run(['sword', 'knight', 'archer', 'elf'], 5, 1800, { area: 2 }));
console.log('\n=== 職業比較（森林、1 階全套、單人）===');
for (const r of ['knight', 'sword', 'archer', 'mage', 'elf']) row(r, run([r], 1, 1800));
console.log('\n=== 隊伍組成（森林、1 階全套）===');
row('劍士+弓手+法師+騎士', run(['sword', 'archer', 'mage', 'knight'], 1, 1800));
row('劍士+騎士+精靈+弓手', run(['sword', 'knight', 'elf', 'archer'], 1, 1800));
