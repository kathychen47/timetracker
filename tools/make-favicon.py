# 生成网站图标（favicon / iOS 主屏图标），并把它们内联进 index.html。
#
# 为什么内联成 data URI 而不是放两个 .png 文件：
#   这个 app 就是单文件 —— 直接双击本地那份 index.html 也要能用，
#   引用相对路径的图标在 file:// 下会 404，图标就又没了。
#
# 2026-10-12 换成「像素小猫」（她从 7 个候选里挑的 5 号），名字也改成 Meowly。
# 2026-11-10 她要「可爱的蓝色小猫头，最好是勾边的」：同一张格子图，猫身换天蓝，
# 外面自动描一圈深蓝边（8 邻接，耳尖斜角也描上），眼睛左上角点一颗白高光；
# 底色去掉（描边自己就能在浅色 / 深色标签栏上立住），只有 iOS 主屏那张垫浅蓝底 ——
# iOS 会把透明处填黑。
# 描边后格子是 16×15：16 像素的标签页图标一格 1 像素，32 像素一格 2 像素 ——
# 格子正好落在整像素上，不糊；180 那张（iOS 主屏）一格 11 像素。
# app 左上角的 logo（index.html 里 .rail .logo 那个 svg）也由这个脚本一起改，两边不会再走样。
#
# 用法（在项目根目录）：python tools/make-favicon.py        [--preview 目录  只出图不改文件]
import base64, io, sys
from PIL import Image, ImageDraw

NAME = "Meowly"
IOS_BG = (234, 243, 255, 255)        # #eaf3ff 只给 iOS 主屏那张垫底
HEX  = {"g": "#9cc9ff",              # 天蓝猫身
        "o": "#2d5a9a",              # 深蓝描边
        "w": "#ffd3dc",              # 耳朵里
        "k": "#1f2a44",              # 眼睛 / 鼻子 / 嘴
        "s": "#ffffff",              # 眼睛高光
        "p": "#ffb3c4"}              # 腮红
COL  = {k: tuple(int(v[i:i+2], 16) for i in (1, 3, 5)) + (255,) for k, v in HEX.items()}
# 14 列 × 13 行的猫本体，一个字一格（. = 空）。描边和高光由下面两个函数加，别手画。
CAT = [
    ".g..........g.",
    ".gg........gg.",
    "gwgg......ggwg",
    "gwwggggggggwwg",
    "gggggggggggggg",
    "gggggggggggggg",
    "ggkkggggggkkgg",
    "ggkkggggggkkgg",
    "gppgggkkgggppg",
    "gggggk..kggggg",
    "gggggggggggggg",
    ".gggggggggggg.",
    "..gggggggggg..",
]

def outlined(grid):
    """四周各扩一格，猫外面一圈（含斜角）标成 o；嘴里被包住的空格填成猫身，不描边"""
    H, W = len(grid), len(grid[0])
    g = [["."] * (W + 2) for _ in range(H + 2)]
    for y in range(H):
        for x in range(W):
            g[y + 1][x + 1] = grid[y][x]
    def inside(y, x):
        return 0 <= y < H + 2 and 0 <= x < W + 2 and g[y][x] != "."
    out = [r[:] for r in g]
    for y in range(H + 2):
        for x in range(W + 2):
            if g[y][x] == "." and inside(y, x - 1) and inside(y, x + 1) and inside(y - 1, x):
                out[y][x] = "g"
    for y in range(H + 2):
        for x in range(W + 2):
            if out[y][x] == "." and any(inside(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                out[y][x] = "o"
    return ["".join(r) for r in out]

def sparkle(grid):
    """每只 2×2 的眼睛左上角换成白高光"""
    rows = [list(r) for r in grid]
    for y in range(len(rows) - 1):
        for x in range(len(rows[0]) - 1):
            if rows[y][x] == rows[y][x + 1] == rows[y + 1][x] == rows[y + 1][x + 1] == "k":
                rows[y][x] = "s"
    return ["".join(r) for r in rows]

GRID = sparkle(outlined(CAT))
W, H = len(GRID[0]), len(GRID)

def draw_icon(px, ios=False):
    """画一张 px×px 的图标：整像素对齐的格子猫，透明底（iOS 那张垫浅蓝底）"""
    cell = max(1, px // 16)
    ox = (px - W * cell) // 2
    oy = (px - H * cell + 1) // 2
    im = Image.new("RGBA", (px, px), IOS_BG if ios else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for y, row in enumerate(GRID):
        for x, c in enumerate(row):
            if c in COL:
                d.rectangle([ox + x * cell, oy + y * cell, ox + (x + 1) * cell - 1, oy + (y + 1) * cell - 1], fill=COL[c])
    return im

def png_data_uri(px, ios=False):
    buf = io.BytesIO()
    draw_icon(px, ios).save(buf, format="PNG", optimize=True)
    b = buf.getvalue()
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii"), len(b)

def cat_rects(x0, y0, cell):
    out = []
    for y, row in enumerate(GRID):
        for x, c in enumerate(row):
            if c in HEX:
                out.append('<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>' % (x0 + x * cell, y0 + y * cell, cell, cell, HEX[c]))
    return "".join(out)

# SVG 版：Chromium / Firefox 优先用它。Safari 不认 SVG favicon，所以 PNG 那两个不能省。
# 16×15 格、一格 2 → 32×30，上下各留 1。
SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">' +
       cat_rects(0, 1, 2) + '</svg>')

def svg_data_uri():
    # 不用 base64：SVG 本来就是文本，转义几个字符更短也更好读；空格也转，data URI 里留裸空格不合规。
    s = (SVG.replace('"', "'").replace("#", "%23")
            .replace("<", "%3C").replace(">", "%3E").replace(" ", "%20"))
    return "data:image/svg+xml," + s

def main():
    if "--preview" in sys.argv:
        d = sys.argv[sys.argv.index("--preview") + 1]
        for px in (16, 32, 64):
            draw_icon(px).save(d + "/icon-%d.png" % px)
        draw_icon(180, True).save(d + "/icon-180.png")
        print("预览图写到了 " + d)
        return
    svg = svg_data_uri()
    p32, n32 = png_data_uri(32)
    p180, n180 = png_data_uri(180, True)
    block = (
        '<!-- 网站图标。内联成 data URI，本地直接打开这个文件时也有图标。\n'
        '     改图标请跑 tools/make-favicon.py，别手改这几行。\n'
        '     SVG 给 Chromium/Firefox（任意尺寸都清晰）；PNG 给 Safari（它不认 SVG favicon）；\n'
        '     180 那张是 iOS「添加到主屏幕」用的。 -->\n'
        '<link rel="icon" href="' + svg + '" type="image/svg+xml" sizes="any">\n'
        '<link rel="icon" href="' + p32 + '" type="image/png" sizes="32x32">\n'
        '<link rel="apple-touch-icon" href="' + p180 + '">\n'
        '<meta name="apple-mobile-web-app-title" content="' + NAME + '">\n'
        '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">\n'
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#15171c">\n'
    )
    html = open("index.html", encoding="utf-8").read()
    START, END = "<!-- 网站图标。", 'content="#15171c">'
    if START in html:                                   # 已经有了：整块换掉，别越堆越多
        i = html.index(START)
        j = html.index(END, i) + len(END)
        html = html[:i] + block.rstrip("\n") + html[j:]
    else:
        anchor = '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        if anchor not in html:
            print("找不到 viewport 那行，没敢动", file=sys.stderr); sys.exit(1)
        html = html.replace(anchor, anchor + block, 1)
    # 左上角 logo 是同一只猫：整段 <svg> 换掉。认的是那行注释后面紧跟的 svg。
    LS = '<div class="logo" title="Meowly">'
    if LS in html:
        i = html.index("<svg", html.index(LS))
        j = html.index("</svg>", i) + len("</svg>")
        html = html[:i] + SVG.replace(' xmlns="http://www.w3.org/2000/svg"', "") + html[j:]
    else:
        print("没找到左上角 logo，只改了网站图标", file=sys.stderr)
    open("index.html", "w", encoding="utf-8", newline="").write(html)
    print("写好了：SVG %d 字节 · PNG32 %d 字节 · PNG180 %d 字节" % (len(svg), n32, n180))

if __name__ == "__main__":
    main()
