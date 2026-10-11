// 靜態資料表：作物、物品系列、升級。不含任何邏輯狀態。
(function (root) {
  'use strict';
  const ET = root.ET = root.ET || {};

  ET.VERSION = 1;
  // 秒數顯示：10 以下留一位小數（6.8），以上取整；整數不帶 .0
  ET.fmtSec = s => {
    const v = s < 10 ? Math.round(s * 10) / 10 : Math.round(s);
    return String(v);
  };
  ET.COLS = 5;
  ET.ROWS = 6;
  ET.MAXT = 5;                 // 物品最高階
  ET.START_PLOTS = 9;          // 3×3
  ET.SHIP_HIGH = 26;           // 自動出貨：盤面達到這個數量開始賣
  ET.SHIP_LOW = 22;            // 賣到剩這個數量

  // 注意：只用 Emoji 12 以前的字元（Windows 10 的字型沒有 🪵 🪙 🪨 這些 Emoji 13+）
  ET.SERIES = {
    wheat:  { name: '小麥', base: 1, tiers: ['🌾', '🍞', '🥪', '🍔', '🎂'], names: ['小麥', '麵包', '三明治', '漢堡', '蛋糕'] },
    apple:  { name: '蘋果', base: 2, tiers: ['🍎', '🧃', '🥧', '🍷', '🏆'], names: ['蘋果', '果汁', '蘋果派', '蘋果酒', '金蘋果'] },
    wood:   { name: '木材', base: 3, tiers: ['🌲', '🪓', '🏹', '🛋️', '🛶'], names: ['木材', '木板', '木弓', '家具', '木船'] },
    flower: { name: '花',   base: 4, tiers: ['🌸', '🌼', '💐', '🌺', '🌹'], names: ['櫻花', '雛菊', '花束', '朱槿', '玫瑰'] }
  };

  // time = 長成所需秒數（未加成）；unlockAge = 遊戲時間（含離線）幾秒後解鎖
  ET.CROPS = {
    wheat:  { emoji: '🌾', series: 'wheat',  time: 10, unlockAge: 0,   hint: '' },
    apple:  { emoji: '🍎', series: 'apple',  time: 20, unlockAge: 0,   hint: '' },
    wood:   { emoji: '🌲', series: 'wood',   time: 40, unlockAge: 0,   hint: '' },
    flower: { emoji: '🌸', series: 'flower', time: 30, unlockAge: 180, hint: '3 分鐘後解鎖' }
  };

  // 擴建田地：依序購買
  ET.EXPAND = [
    { n: 12, cost: 60 },
    { n: 16, cost: 250 },
    { n: 20, cost: 900 },
    { n: 25, cost: 3500 }
  ];

  const botIv = l => 8 * Math.pow(0.8, l - 1);
  ET.UPGRADES = [
    { id: 'fert', group: 'farm', emoji: '🌱', name: '肥料', max: 10,
      cost: l => Math.round(25 * Math.pow(1.6, l)),
      desc: l => `作物長得更快：目前 +${l * 12}%（🌾 ${l ? '10 → ' : ''}${ET.fmtSec(10 / (1 + 0.12 * l))} 秒），下一級 +${(l + 1) * 12}%（🌾 ${ET.fmtSec(10 / (1 + 0.12 * (l + 1)))} 秒）` },
    { id: 'click', group: 'farm', emoji: '👆', name: '點擊力', max: 10,
      cost: l => Math.round(20 * Math.pow(1.7, l)),
      desc: l => `點正在長的作物：目前加速 ${(1 + 0.5 * l).toFixed(1)} 秒，下一級 ${(1.5 + 0.5 * l).toFixed(1)} 秒` },
    { id: 'farmer', group: 'farm', emoji: '🚜', name: '農夫', max: 1,
      cost: () => 100,
      desc: () => '作物熟了自動收成（盤面有空位時）。關掉遊戲也會繼續收' },
    { id: 'bot', group: 'farm', emoji: '🤖', name: '合成機器人', max: 5,
      cost: l => 300 * Math.pow(2, l),
      desc: l => l === 0
        ? '自動把 1 階的同物合成 2 階，每 8 秒一次'
        : `目前每 ${botIv(l).toFixed(1)} 秒合成 ${Math.min(4, l)} 階以下；下一級每 ${botIv(l + 1).toFixed(1)} 秒、${Math.min(4, l + 1)} 階以下` },
    { id: 'shipper', group: 'farm', emoji: '🚚', name: '自動出貨', max: 1,
      cost: () => 200,
      desc: () => '合成盤超過 26 個時：先自動合成到最高階，還是太擠就優先賣最貴的，留到 22 個' },
    { id: 'offline', group: 'farm', emoji: '⏳', name: '離線上限', max: 8,
      cost: l => Math.round(150 * Math.pow(2, l)),
      desc: l => `關掉遊戲最多累積 ${4 + l} 小時，下一級 ${5 + l} 小時` }
  ];
  // ---- S2 商店 ----
  ET.SHOP = {
    baseShelves: 4,        // 起始貨架數（升級每級 +1，最多 12）
    baseInterval: 10,      // 客人到達的基準間隔（秒）
    queueBase: 3,          // 同時最多幾位客人（裝潢每級 +1）
    priceBase: 1.5,        // 賣給客人的價格倍率（招牌每級 +0.1）；賣出區 / 自動出貨是 1 倍
    tipRate: 0.25,         // 點客人立刻結帳的小費
    serveDelay: 1,         // 有貨後多久結帳（秒）
    restockEvery: 3,       // 店員補貨間隔（秒）
    patience: { normal: 22, noble: 30, thief: 8 },
    reserveMax: 20         // 自動化最多替客人 / 空貨架保留幾件。必須 < SHIP_LOW(22)，不然盤面被佔滿、自動出貨賣不掉、農夫會停工
  };
  ET.UPGRADES.push(
    { id: 'shelf', group: 'shop', emoji: '📚', name: '貨架', max: 8,
      cost: l => Math.round(80 * Math.pow(1.8, l)),
      desc: l => `目前 ${4 + l} 格，下一級 ${5 + l} 格` },
    { id: 'deco', group: 'shop', emoji: '🏮', name: '裝潢', max: 5,
      cost: l => Math.round(150 * Math.pow(2.2, l)),
      desc: l => `客人來得更勤（目前 +${l * 20}%），店裡可同時容納 ${3 + l} 位，下一級 ${4 + l} 位` },
    { id: 'clerk', group: 'shop', emoji: '🛎️', name: '店員', max: 1,
      cost: () => 400,
      desc: () => '自動補貨：缺的貨先從合成盤合成出來再上架，客人想要的也會跟著補；並趕走小偷。關掉遊戲也會幫你顧店' },
    { id: 'sign', group: 'shop', emoji: '🏷️', name: '招牌', max: 5,
      cost: l => Math.round(250 * Math.pow(2.5, l)),
      desc: l => `客人付的價格：目前 ×${(1.5 + 0.1 * l).toFixed(1)}，下一級 ×${(1.6 + 0.1 * l).toFixed(1)}` }
  );
  ET.UPGRADE_BY_ID = {};
  ET.UPGRADES.forEach(u => { ET.UPGRADE_BY_ID[u.id] = u; });

  // 還鎖著的分頁（之後的批次才會做）
  ET.LOCKED_TABS = [
    { id: 'guild', emoji: '🏛️', name: '公會', need: '下一個版本開放（開發中）' }
  ];

  // ---- S3 冒險 + 裝備 ----
  // 裝備是合成盤上的「系列」：兩件一樣的合成 → 高一階（+1）。gear 欄位表示可裝備的欄位
  ET.SERIES.blade = { name: '武器', base: 8, gear: 'weapon', tiers: ['🔪', '🗡️', '⚔️', '🔱', '⚡'], names: ['小刀', '短劍', '雙劍', '三叉戟', '雷霆'] };
  ET.SERIES.plate = { name: '防具', base: 8, gear: 'armor', tiers: ['🧥', '🥋', '🛡️', '⛑️', '🏰'], names: ['布衣', '道服', '盾牌', '頭盔', '城牆'] };
  ET.SERIES.charm = { name: '飾品', base: 12, gear: 'trinket', tiers: ['📿', '💍', '🧿', '🔮', '💎'], names: ['念珠', '戒指', '護符', '水晶球', '寶石'] };
  ET.GEAR = { blade: { atk: 5 }, plate: { def: 3, hp: 15 }, charm: { atk: 1.5, def: 1, hp: 8 } };   // 1 階的屬性
  ET.GEAR_MUL = 1.7;                                                                                // 每高 1 階 ×1.7
  ET.SLOT_NAME = { weapon: '武器', armor: '防具', trinket: '飾品' };

  ET.ROLES = {
    knight: { emoji: '🛡️', name: '騎士', hp: 70, atk: 5, def: 3, note: '坦克：怪物優先打他' },
    sword:  { emoji: '⚔️', name: '劍士', hp: 50, atk: 9, def: 1, note: '近戰輸出' },
    archer: { emoji: '🏹', name: '弓手', hp: 36, atk: 8, def: 0, note: '遠程：優先打最後面的怪' },
    mage:   { emoji: '🧙', name: '法師', hp: 30, atk: 7, def: 0, note: '範圍：同時打全體（60% 傷害）' },
    elf:    { emoji: '🧝', name: '精靈', hp: 40, atk: 3, def: 1, note: '補師：每 2 秒治療最殘血的隊友' }
  };
  ET.AREAS = [
    { id: 1, name: '森林', emoji: '🌲', def: 0, mobs: [['🐺', '野狼'], ['🐗', '野豬'], ['🐍', '毒蛇']], boss: ['🐻', '熊王'] },
    { id: 2, name: '沙漠', emoji: '🏜️', def: 4, mobs: [['🦂', '蠍子'], ['🐫', '駱駝'], ['💀', '骷髏']], boss: ['🦅', '沙漠之鷹'] }
  ];
  ET.ADV = {
    unlockEarned: 300,            // 商店開張後，累計賺到這麼多金幣就開放冒險
    stages: 10,                   // 每區 10 關，第 10 關是 Boss
    partyMax: 4,
    recruitCost: [0, 150, 500, 1500],   // 第 1 位免費（開局送劍士）；S4 公會做好後改成公會招募
    recoverSec: 10,               // 全滅後復活的秒數
    holdWins: 6,                  // 全滅退一關後，先在那一關再贏幾場才往上推（避免卡在極限邊緣一直送死）
    dropBoss: 0.5, dropNormal: 0.07,
    heroMaxLv: 50
  };
  // 鍛造：1 階裝備。金幣每鍛造一次 ×1.15；材料是合成盤上的東西（折合 1 階個數），把花園接進裝備
  ET.FORGE = [
    { id: 'blade', s: 'blade', coins: 40, mats: { wood: 2 } },
    { id: 'plate', s: 'plate', coins: 40, mats: { wood: 4 } },
    { id: 'charm', s: 'charm', coins: 60, mats: { flower: 2 } }
  ];
  ET.FORGE_GROWTH = 1.15;
  // 料理補給：帶上 2 階以上的料理，依系列與階數有不同加成；持續秒數 = 120 × 2^(階-2)
  ET.FOOD = {
    wheat: { 2: { hp: 0.10 }, 3: { def: 0.12 }, 4: { atk: 0.12 }, 5: { xp: 0.25 } },
    apple: { 2: { regen: 2 }, 3: { hp: 0.20 }, 4: { atk: 0.08, def: 0.08 }, 5: { xp: 0.25, atk: 0.10 } }
  };
  ET.FOOD_SEC = t => 120 * Math.pow(2, t - 2);
  ET.FOOD_QUEUE = 3;
})(typeof globalThis !== 'undefined' ? globalThis : this);
