// 打包成 Artifact 單檔。用法：
//   node tools/build_artifact.js          → 不含 S3 冒險（目前穩定版）
//   node tools/build_artifact.js --adv    → 含 S3 冒險
// 產出：
//   dist/artifact.html  要發佈的檔案（只有 <title>、<style>、頁面結構、<script>；平台會自己包上 doctype / head / body）
//   dist/preview.html   本機預覽用：把上面那份包進和平台外殼相近的文件（doctype、viewport、安全區 padding、14px 字級）
const fs = require('fs'), path = require('path');
const { root, bundle } = require('./bundle');
const withAdv = process.argv.includes('--adv');
const { markup, css, js } = bundle(withAdv);

const fragment = `<title>表情小鎮</title>
<style>
${css}
</style>
${markup}
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), fragment, 'utf8');

const preview = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${fragment}</body></html>`;
fs.writeFileSync(path.join(root, 'dist', 'preview.html'), preview, 'utf8');

const kb = n => (Buffer.byteLength(n, 'utf8') / 1024).toFixed(0) + ' KB';
console.log(`artifact.html ${kb(fragment)}　preview.html ${kb(preview)}　${withAdv ? '含冒險' : '不含冒險'}`);
if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(fragment.replace(/<script>[\s\S]*<\/script>/, ''))) console.log('⚠️ 片段裡有不該出現的標籤');
if (/https?:\/\/(?!cdnjs|fonts)/i.test(css)) console.log('⚠️ CSS 裡有外部連結');
