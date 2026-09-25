// 宠物贴图：每一个动作的每一帧，都得指到一个**有东西**的格子上 —— 离线测试。
//
// 为什么要有这个：猫的动作表曾经写成 走路 = [第0列, 第2列]，
// 而那张图第 0、1 行的第 2、3 列是**空格子**。于是每隔一帧猫就消失一下，
// 走路 210ms 换一帧 —— 她连说了四次「还在闪」，我前三次都去修缩放、dpr、步长，
// 一次都没打开贴图看一眼。这类错不报任何错，代码层面一切正常，只有眼睛看得出来。
// 所以这里把每张贴图真的解码出来，逐帧数非透明像素。
//
//   用法：node tools/test-pets.js
var fs = require("fs"), path = require("path"), zlib = require("zlib");

var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log("  x " + m); } }

// ---- 把 PETS 注册表原样抠出来 ----
var a = html.indexOf("  var PETS=[\n"), b = html.indexOf("\n  function petFind(k)");
if (a < 0 || b < 0) { console.log("  x 找不到 PETS 注册表"); process.exit(1); }
var PETS = (new Function(html.slice(a, b).replace(/^\s*var PETS=/, "return ") ))();

// ---- 极简 PNG 解码：只认 8 位 RGBA / RGB / 调色板，不隔行 ----
function decodePNG(buf) {
  var p = 8, w = 0, h = 0, depth = 0, ctype = 0, idat = [], plte = null, trns = null;
  while (p < buf.length) {
    var len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.slice(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9];
      if (data[12] !== 0) throw new Error("隔行扫描的 PNG 不支持"); }
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error("只支持 8 位：" + depth);
  var bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 3 ? 1 : 0;
  if (!bpp) throw new Error("不支持的颜色类型：" + ctype);
  var raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (var y = 0; y < h; y++) {
    var f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (var x = 0; x < stride; x++) {
      var cur = raw[src + x], L = x >= bpp ? out[dst + x - bpp] : 0, U = y ? out[dst - stride + x] : 0,
          UL = (y && x >= bpp) ? out[dst - stride + x - bpp] : 0, v;
      if (f === 0) v = cur;
      else if (f === 1) v = cur + L;
      else if (f === 2) v = cur + U;
      else if (f === 3) v = cur + ((L + U) >> 1);
      else { var pp = L + U - UL, pa = Math.abs(pp - L), pb = Math.abs(pp - U), pc = Math.abs(pp - UL);
        v = cur + ((pa <= pb && pa <= pc) ? L : (pb <= pc ? U : UL)); }
      out[dst + x] = v & 255;
    }
  }
  return { w: w, h: h, alpha: function (x, y) {
    var i = y * stride + x * bpp;
    if (ctype === 6) return out[i + 3];
    if (ctype === 3) { var k = out[i]; return (trns && k < trns.length) ? trns[k] : 255; }
    return 255;
  } };
}
function frames(an) {
  if (an.f) return an.f;
  var o = []; for (var i = 0; i < an[1]; i++) o.push([i, an[0]]); return o;
}

console.log("");
ok(PETS.length === 7, "注册表里是一只猫 + 六只狗：" + PETS.length);
PETS.forEach(function (P) {
  var img;
  try { img = decodePNG(Buffer.from(P.src.split(",")[1], "base64")); }
  catch (e) { ok(false, P.k + " 的贴图解不开：" + e.message); return; }
  ok(img.w === P.w * P.cols && img.h === P.h * P.rows,
     P.k + " 贴图尺寸 = 格子 × 行列（" + img.w + "x" + img.h + " vs " + P.w * P.cols + "x" + P.h * P.rows + "）");
  var empty = [];
  Object.keys(P.a).forEach(function (name) {
    frames(P.a[name]).forEach(function (fr) {
      var c = fr[0], r = fr[1], n = 0;
      if (c >= P.cols || r >= P.rows) { empty.push(name + "@" + c + "," + r + "(出界)"); return; }
      for (var y = r * P.h; y < (r + 1) * P.h && !n; y++)
        for (var x = c * P.w; x < (c + 1) * P.w; x++) if (img.alpha(x, y) > 0) { n = 1; break; }
      if (!n) empty.push(name + "@列" + c + "行" + r);
    });
  });
  ok(empty.length === 0, P.k + "：每个动作的每一帧都有东西（空的：" + empty.join(" ") + "）");
  (P.poke || []).forEach(function (k) { ok(!!P.a[k], P.k + " 点它会演的「" + k + "」在动作表里"); });
});

console.log("\n== 宠物贴图：每一帧都指到有东西的格子 ==");
console.log("  通过 " + pass + "  失败 " + fail);
process.exit(fail ? 1 : 0);
