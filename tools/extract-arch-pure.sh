#!/usr/bin/env bash
# 把 index.html 里跟「Google 日历归档」有关的纯函数抽出来，供 tools/test-arch.js 离线跑。
# 用法（在项目根目录）：
#   bash tools/extract-arch-pure.sh && node tools/test-arch.js
# 改过 index.html 里那几段之后要重抽一次 —— 测的是文件里真正的代码，不是副本。
set -e
SRC="index.html"
OUT="tools/arch-pure.js"

ln() { grep -n "$1" "$SRC" | head -1 | cut -d: -f1; }

S=$(ln 'function evBorn')
E=$(ln 'return Object.keys(kill).length')
U=$(ln 'function uid()')
C=$(ln 'function evCounts')
T=$(ln 'function toMin')
A1=$(ln 'var ARCH_OVERLAP')
A2=$(ln 'return {add:add,upd:upd,skip:skip};}')

{
  echo '// 自动生成，别手改 —— 见 tools/extract-arch-pure.sh'
  echo 'var LSmap={},SAVED={};'
  echo 'function load(k,d){return LSmap[k]!==undefined?JSON.parse(JSON.stringify(LSmap[k])):d;}'
  echo 'var saveFail=false;'
  echo 'function save(k,v){if(saveFail)return false;LSmap[k]=JSON.parse(JSON.stringify(v));SAVED[k]=(SAVED[k]||0)+1;return true;}'
  echo 'function evIsDemo(){return false;}'
  echo 'function fmt(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}'
  echo 'function pad(n){return(n<10?"0":"")+n;}'
  echo 'var gcalArchOn=true,gcalCount=false;'
  sed -n "${S},${E}p" "$SRC"
  sed -n "${U},${U}p" "$SRC"
  sed -n "${C},${C}p" "$SRC"
  sed -n "${T},${T}p" "$SRC"
  sed -n "${A1},${A2}p" "$SRC"
} > "$OUT"

node --check "$OUT"
echo "抽好了：$OUT"
