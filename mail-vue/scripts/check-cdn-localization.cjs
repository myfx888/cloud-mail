// CDN 依赖本地化防回归检查（参照 portal 的 vendor-localization.test 思路）
// 用法: node mail-vue/scripts/check-cdn-localization.js
// 退出码 0 = 通过；非 0 = 有违规项。建议在 CI / 发版前运行。
// 设计文档: docs/cdn-localization.md

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function fail(msg) {
    console.error('  ✗ ' + msg);
    failed++;
}
function pass(msg) {
    console.log('  ✓ ' + msg);
}

function walk(dir, list = []) {
    for (const f of fs.readdirSync(dir)) {
        if (f === 'node_modules' || f === 'dist') continue;
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p, list);
        else list.push(p);
    }
    return list;
}

// ---------- 1. index.html / 源码 无外部 CDN 引用 ----------
console.log('[1] 外部 CDN 引用检查（index.html + src，注释除外）');
// 说明文档的注释里会提到这些域名（如"原引用 googleapis"），剥离注释后再检查
function stripComments(content) {
    return content
        .replace(/\/\*[\s\S]*?\*\//g, '')       // /* ... */
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // // ...（避开 https://）
}
const allowedExternal = [
    'challenges.cloudflare.com', // Turnstile：CF 自家服务，后端有校验，刻意保留
];
const cdnHosts = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'bootcdn.net', 'api.iconify.design'];
let violations1 = 0;
const htmlContent = stripComments(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
for (const host of cdnHosts) {
    if (htmlContent.includes(host)) { fail(`index.html 引用了外部 CDN: ${host}`); violations1++; }
}
const srcFiles = walk(path.join(ROOT, 'src')).filter(f => /\.(vue|js|html|css|scss)$/.test(f));
for (const f of srcFiles) {
    const content = stripComments(fs.readFileSync(f, 'utf8'));
    for (const host of cdnHosts) {
        if (content.includes(host)) { fail(`${path.relative(ROOT, f)} 引用了外部 CDN: ${host}`); violations1++; }
    }
}
if (violations1 === 0) pass(`无外部 CDN 引用（白名单: ${allowedExternal.join(', ')}）`);

// ---------- 2. iconify 图标注册全覆盖 ----------
console.log('[2] iconify 图标注册覆盖检查');
const referenced = new Set();
const patterns = [
    /icon="([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)"/g,
    /['"]([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)['"]/g,
];
for (const f of srcFiles) {
    const content = fs.readFileSync(f, 'utf8');
    for (const re of patterns) {
        let m;
        while ((m = re.exec(content))) referenced.add(m[1] + ':' + m[2]);
    }
}
const iconsSrc = fs.readFileSync(path.join(ROOT, 'src', 'icons', 'index.js'), 'utf8');
const registered = new Set();
const regPrefixes = new Set();
for (const block of iconsSrc.split('addCollection(').slice(1)) {
    const pm = block.match(/"prefix":\s*"([a-z0-9-]+)"/);
    if (!pm) continue;
    regPrefixes.add(pm[1]);
    for (const m of block.matchAll(/"([a-z0-9-]+)":\s*\{\s*("body"|"width"|"height")/g)) {
        registered.add(pm[1] + ':' + m[1]);
    }
}
// 只对比「疑似 iconify 图标」的引用（前缀命中已注册前缀）
const iconRefs = [...referenced].filter(n => regPrefixes.has(n.split(':')[0]));
const missing = iconRefs.filter(n => !registered.has(n));
if (missing.length) {
    missing.forEach(m => fail(`图标未本地注册（会回退在线 api.iconify.design）: ${m}`));
} else {
    pass(`图标引用 ${iconRefs.length} 处全部本地注册（共 ${registered.size} 个）`);
}

// ---------- 3. Inter 字体本地化 ----------
console.log('[3] Inter 字体本地化检查');
const fonts = ['inter-latin-400-normal.woff2', 'inter-latin-600-normal.woff2'];
for (const f of fonts) {
    const p = path.join(ROOT, 'public', 'fonts', f);
    if (!fs.existsSync(p) || fs.statSync(p).size < 10000) fail(`字体文件缺失或过小: public/fonts/${f}`);
}
if (fs.existsSync(path.join(ROOT, 'public', 'fonts', 'inter.css'))) {
    const css = stripComments(fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'inter.css'), 'utf8'));
    if (css.includes('googleapis')) fail('inter.css 引用了 googleapis');
    else pass('字体文件与 @font-face 就位');
} else {
    fail('public/fonts/inter.css 缺失');
}

// ---------- 4. TinyMCE 表情锁定 unicode 模式 ----------
console.log('[4] TinyMCE 表情数据库检查');
const editors = ['src/components/tiny-editor/index.vue', 'src/components/signature-manager/index.vue'];
for (const e of editors) {
    const content = fs.readFileSync(path.join(ROOT, e), 'utf8');
    if (!content.includes("emoticons_database: 'emojis'")) fail(`${e} 缺少 emoticons_database: 'emojis' 锁定（防止误开图片版引入 twemoji CDN）`);
}
if (failed === 0) pass('两处编辑器均已锁定 unicode 表情数据库');

// ---------- 结果 ----------
console.log('');
if (failed > 0) {
    console.error(`FAIL: ${failed} 项违规`);
    process.exit(1);
} else {
    console.log('PASS: CDN 本地化检查全部通过');
}
