// 把 Typora 主题（themes/*.css）转成笔记本预览能用的样式。
//
// 为什么不能直接引用：Typora 主题写的是 #write、html、body、a、h1、pre、textarea 这种
// 全局选择器，直接 <link> 进来会把整个 app 的样式冲掉。这里做三件事：
//   1. #write / html / body / :root  →  容器 .mdth（:root 上的 CSS 变量也跟着挪进来）
//   2. 其他选择器一律加 .mdth 前缀，关在预览区里
//   3. 丢掉只对 Typora 编辑器有意义的规则（CodeMirror、侧边栏、搜索框、气泡…）
//      以及引用本地字体的 @font-face（字体文件几十 MB，不进仓库）
//
// 用法： node tools/build_md_themes.js "C:/Users/<你>/AppData/Roaming/Typora/themes"
// 输出： themes/<名字>.css + themes/themes.json

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(process.env.APPDATA || '', 'Typora', 'themes');
const OUT = path.join(__dirname, '..', 'themes');
const SCOPE = '.mdth';

// ---------- 极简 CSS 分块（只认花括号、字符串和注释，够用） ----------
function readBlock(css, i) {                     // css[i] === '{'
  let d = 0, s = null, j = i;
  for (; j < css.length; j++) {
    const c = css[j];
    if (s) { if (c === s && css[j - 1] !== '\\') s = null; continue; }
    if (c === '"' || c === "'") { s = c; continue; }
    if (c === '/' && css[j + 1] === '*') { const e = css.indexOf('*/', j + 2); j = e < 0 ? css.length : e + 1; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) break; }
  }
  return { body: css.slice(i + 1, j), end: j + 1 };
}
function parse(css) {
  const out = [];
  let i = 0, buf = '';
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 2; continue; }
    if (c === '@' && !buf.trim()) {
      let head = '', j = i, s = null;
      for (; j < css.length; j++) {
        const d = css[j];
        if (s) { head += d; if (d === s && css[j - 1] !== '\\') s = null; continue; }
        if (d === '"' || d === "'") { s = d; head += d; continue; }
        if (d === ';') { out.push({ t: 'at1', text: head.trim() + ';' }); j++; break; }
        if (d === '{') { const b = readBlock(css, j); out.push({ t: 'atn', head: head.trim(), inner: b.body }); j = b.end; break; }
        head += d;
      }
      i = j; buf = ''; continue;
    }
    if (c === '{') { const b = readBlock(css, i); out.push({ t: 'rule', sel: buf.trim(), body: b.body.trim() }); buf = ''; i = b.end; continue; }
    if (c === '}') { i++; buf = ''; continue; }               // 多余的右括号，跳过
    buf += c; i++;
  }
  return out;
}

// ---------- 只属于 Typora 编辑器、跟渲染无关的东西 ----------
const DROP = new RegExp([
  'CodeMirror', 'cm-s-', 'typora', 'md-toc', 'md-fences', 'popover', 'md-notification',
  'native-window', 'searchpanel', 'md-hover-tip', 'code-tooltip', 'megamenu', 'sidebar',
  'file-list', 'file-node', 'file-tree', 'md-mathjax', '\\bty-', 'md-image', 'md-meta',
  'md-def', 'md-footnote', 'md-diagram', 'auto-suggest', 'dropdown', 'context-menu',
  'modal', 'md-focus', 'md-inline-math', 'md-html-inline', 'md-expand', 'mac-seamless',
  'in-text-selection', 'md-search', '#top-', '#toolbar', '#info-panel', '#md-', '#footer',
  'ext-', 'unibody', 'md-rawblock', 'md-content', 'md-line-height', 'quick-open',
  'md-table-edit', 'md-grid', 'pin-outline', 'outline-', 'md-tooltip', 'ptt-', 'text-null',
].join('|'), 'i');

const ROOTY = /^\s*(html|body|:root|\.typora-export)\b/i;

function mapSel(sel) {
  return sel.split(',').map(s => {
    s = s.trim().replace(/\s+/g, ' ');
    if (!s) return null;
    if (DROP.test(s)) return null;
    if (s.includes('#write')) {
      let r = s.replace(/#write/g, SCOPE).trim();
      r = r.replace(/(\.mdth)(\s+\.mdth)+/g, '$1');            // 别叠成 .mdth .mdth
      // .mdth 前面还挂着别的东西（.on-focus-mode #write …）——那是 Typora 的界面状态，
      // 在这儿永远不成立，留着只会是死规则，直接丢
      if (!r.startsWith(SCOPE)) return null;
      return r;
    }
    if (ROOTY.test(s)) {
      const rest = s.replace(ROOTY, '').trim();
      if (!rest) return SCOPE;
      if (/^[>+~]/.test(rest)) return SCOPE + ' ' + rest;
      return SCOPE + ' ' + rest;
    }
    if (s.startsWith('@')) return null;
    return SCOPE + ' ' + s;
  }).filter(Boolean).join(',');
}

function localUrl(text) {                                     // 引用了本地文件的 url()
  const urls = text.match(/url\(([^)]*)\)/gi) || [];
  return urls.some(u => !/^url\(\s*['"]?(https?:|data:|\/\/)/i.test(u));
}

function emit(nodes, imports, depth) {
  const pad = '  '.repeat(depth);
  const out = [];
  for (const n of nodes) {
    if (n.t === 'at1') {
      if (/^@import/i.test(n.text)) { if (!localUrl(n.text)) imports.push(n.text); }
      else if (/^@charset/i.test(n.text)) { /* 丢掉 */ }
      else out.push(pad + n.text);
      continue;
    }
    if (n.t === 'atn') {
      const h = n.head;
      if (/^@font-face/i.test(h)) {                            // 字体文件不进仓库，本地引用的整条丢掉
        if (!localUrl(n.inner)) out.push(pad + h + '{' + n.inner.trim() + '}');
        continue;
      }
      if (/^@(media|supports|layer|container)/i.test(h)) {
        const inner = emit(parse(n.inner), imports, depth + 1);
        if (inner.trim()) out.push(pad + h + '{\n' + inner + '\n' + pad + '}');
        continue;
      }
      if (/^@(keyframes|-webkit-keyframes)/i.test(h)) { out.push(pad + h + '{' + n.inner + '}'); continue; }
      continue;                                                // @page / @namespace 之类，用不上
    }
    const sel = mapSel(n.sel);
    if (!sel || !n.body.trim()) continue;
    let body = n.body.replace(/url\(\s*(['"]?)(?!https?:|data:|\/\/|#)([^)'"]+)\1\s*\)/gi, 'none');  // 本地图片没带过来
    out.push(pad + sel + '{' + body.trim() + '}');
  }
  return out.join('\n');
}

// ---------- 深浅色：直接看容器背景的亮度，别靠文件名猜 ----------
function lum(css) {
  const m = css.match(/\.mdth\s*\{[^}]*background(?:-color)?\s*:\s*([^;}]+)/i);
  let c = m && m[1].trim();
  if (!c) { const m2 = css.match(/--bg[^:]*:\s*(#[0-9a-f]{3,8})/i); c = m2 && m2[1]; }
  if (!c) return null;
  let r, g, b;
  let h = c.match(/#([0-9a-f]{3,8})/i);
  if (h) {
    let s = h[1];
    if (s.length === 3) s = s.split('').map(x => x + x).join('');
    r = parseInt(s.slice(0, 2), 16); g = parseInt(s.slice(2, 4), 16); b = parseInt(s.slice(4, 6), 16);
  } else {
    const rgb = c.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (!rgb) return null;
    r = +rgb[1]; g = +rgb[2]; b = +rgb[3];
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const NAMES = {
  orangeheart: '橙心', github: 'GitHub', newsprint: 'report', pixyll: 'Pixyll', whitey: 'Whitey',
  lapis: 'Lapis', 'lapis-dark': 'Lapis 暗', mint: 'Mint', 'mint-dark': 'Mint 暗',
  night: 'Night', vue: 'Vue', 'vue-dark': 'Vue 暗', cobalt: 'Cobalt',
};

if (!fs.existsSync(SRC)) { console.error('找不到主题目录：' + SRC); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.css') && f !== 'default.css');
const manifest = [];
for (const f of files) {
  const name = f.replace(/\.css$/, '');
  const raw = fs.readFileSync(path.join(SRC, f), 'utf8');
  const imports = [];
  let css = emit(parse(raw), imports, 0);
  if (!css.trim()) { console.log('skip  ' + name + '（转换后是空的）'); continue; }
  const head = '/* ' + name + ' — 由 Typora 主题转换而来，原作 MIT License (c) 2019 evgo，见 themes/LICENSE */\n';
  const out = head + (imports.length ? imports.join('\n') + '\n' : '') + css + '\n';
  fs.writeFileSync(path.join(OUT, name + '.css'), out, 'utf8');
  const L = lum(out);
  manifest.push({ id: name, name: NAMES[name] || name, dark: L === null ? /dark|night|black|cobalt/i.test(name) : L < 0.4 });
  console.log('ok    ' + name.padEnd(24) + (out.length / 1024).toFixed(1) + 'KB  ' +
    (manifest[manifest.length - 1].dark ? '暗色' : '亮色') + (imports.length ? '  (@import ' + imports.length + ')' : ''));
}
manifest.sort((a, b) => (a.dark - b.dark) || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'themes.json'), JSON.stringify(manifest, null, 2), 'utf8');
fs.copyFileSync(path.join(SRC, 'License'), path.join(OUT, 'LICENSE'));
console.log('\n共 ' + manifest.length + ' 个主题 → ' + OUT);
