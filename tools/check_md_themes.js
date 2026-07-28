// 体检：转换后的主题里不能再有没被 .mdth 圈住的选择器，否则会漏出去污染整个 app
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'themes');
let bad = 0, tot = 0, files = 0;
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.css'))) {
  files++;
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  // 逐条规则取选择器：找每个 '{'，往前回溯到上一个 '}' 或 '\n'
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = m[1].split('\n').pop().trim();
    if (!raw || raw.startsWith('@') || raw.startsWith('/*')) continue;
    for (const one of raw.split(',')) {
      const t = one.trim();
      if (!t || /^(from|to|\d+%)$/.test(t)) continue;      // keyframes 的关键帧
      tot++;
      if (!t.startsWith('.mdth')) { bad++; if (bad <= 10) console.log('  漏网  ' + f + '  →  ' + t.slice(0, 70)); }
    }
  }
}
console.log(files + ' 个主题，' + tot + ' 条选择器，未被 .mdth 圈住的：' + bad);
process.exit(bad ? 1 : 0);
