# 检查 index.html 里那几行图标是不是真的能用。
# 光看「有没有这几行」不够 —— data URI 写坏了浏览器只会安静地退回默认地球，不会报错。
#   用法：python tools/test-favicon.py
import base64, io, re, sys
from urllib.parse import unquote
from PIL import Image

html = open("index.html", encoding="utf-8").read()
ok = fail = 0
def chk(cond, msg):
    global ok, fail
    if cond: ok += 1
    else:
        fail += 1
        print("  x " + msg)

def attr(pat):
    m = re.search(pat, html)
    return m.group(1) if m else None

print("")
print("== 网站图标 ==")

# 1) 三个 link 都在，且各自只有一处（跑两遍脚本不该堆成两份）
for rel, pat in (("icon(svg)",  r'<link rel="icon" href="(data:image/svg\+xml,[^"]+)"'),
                 ("icon(png32)",r'<link rel="icon" href="(data:image/png;base64,[^"]+)" type="image/png" sizes="32x32"'),
                 ("apple",      r'<link rel="apple-touch-icon" href="(data:image/png;base64,[^"]+)"')):
    hits = re.findall(pat, html)
    chk(len(hits) == 1, rel + " 应该正好一处，实际 " + str(len(hits)))

# 2) SVG 解得开、是完整的 svg、没有裸空格
svg = attr(r'<link rel="icon" href="(data:image/svg\+xml,[^"]+)"')
chk(svg is not None, "找不到 SVG 图标")
if svg:
    body = svg.split(",", 1)[1]
    chk(" " not in body, "data URI 里不该有裸空格")
    dec = unquote(body)
    chk(dec.startswith("<svg") and dec.rstrip().endswith("</svg>"), "解出来不是完整的 svg：" + dec[:60])
    chk("#6366f1" in dec, "底色该是 app 的 --primary #6366f1")
    chk("<circle" in dec and "<path" in dec, "该有表盘和指针")

# 3) 两张 PNG 解得开、尺寸对、真的画了东西（不是一整块空白）
for name, pat, want in (("32×32", r'sizes="32x32"', 32), ("iOS 180", r'rel="apple-touch-icon"', 180)):
    m = re.search(r'<link[^>]*' + pat + r'[^>]*href="data:image/png;base64,([^"]+)"', html) or \
        re.search(r'<link[^>]*href="data:image/png;base64,([^"]+)"[^>]*' + pat, html)
    chk(m is not None, name + " 找不到")
    if not m: continue
    im = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert("RGBA")
    chk(im.size == (want, want), name + " 尺寸应为 %d，实际 %s" % (want, im.size))
    cols = im.getcolors(maxcolors=1 << 16) or []
    chk(len(cols) > 4, name + " 只有 %d 种颜色，八成画空了" % len(cols))
    # 正中间应该是白的（时钟中心那一带），四角应该是透明的（圆角切掉了）
    cx = im.getpixel((want // 2, want // 2))
    chk(im.getpixel((0, 0))[3] < 40, name + " 左上角该是透明的（圆角），实际 alpha=%d" % im.getpixel((0,0))[3])
    chk(cx[3] > 200, name + " 正中间不该是透明的")

# 4) 顺带确认没把原来的 head 弄丢
chk("<title>" in html, "title 没了")
chk('name="viewport"' in html, "viewport 没了")
chk(html.count('name="theme-color"') == 2, "theme-color 该是明暗各一条")

print("")
print(("x %d 条不通过，" % fail if fail else "") + "v %d 条通过" % ok)
sys.exit(1 if fail else 0)
