// 共用的打包邏輯：把 CSS / JS / 頁面結構讀進來，給 build_artifact.js 與 build_pwa.js 用。
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 不含冒險時，用空殼取代 adventure.js（core.js 會呼叫這幾個函式）
const advStub = `(function (r) { var ET = r.ET; ET.advCheck = function () {}; ET.advTick = function () {}; ET.isGear = function () { return false; }; ET.sanitizeAdv = function () { return null; }; ET.newAdv = function () { return null; }; })(typeof globalThis !== 'undefined' ? globalThis : this);`;

exports.root = root;
exports.read = read;
exports.bundle = function (withAdv) {
  const html = read('index.html');
  const bodyStart = html.indexOf('<body>') + '<body>'.length;
  const markup = html.slice(bodyStart, html.indexOf('<script')).trim();        // <div id="app">…</div><div id="fx"></div>
  const css = read('css/style.css');
  const parts = [read('js/data.js'), read('js/core.js'), read('js/shop.js'), withAdv ? read('js/adventure.js') : advStub, read('js/ui.js')];
  const js = parts.join('\n').replace(/<\/script/gi, '<\\/script');
  return { markup, css, js };
};
