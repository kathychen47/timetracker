# 生成网站图标（favicon / iOS 主屏图标），并把它们内联进 index.html。
#
# 为什么内联成 data URI 而不是放两个 .png 文件：
#   这个 app 就是单文件 —— 直接双击本地那份 index.html 也要能用，
#   引用相对路径的图标在 file:// 下会 404，图标就又没了。
#
# 2026-10-12 换成「像素小猫」（她从 7 个候选里挑的 5 号），名字也改成 Meowly。
# 画法是一张 14×13 的格子图：16 像素的标签页图标一格就是 1 像素，32 像素一格 2 像素 ——
# 格子正好落在整像素上，不糊；180 那张（iOS 主屏）一格 11 像素。
# app 左上角的 logo 用的是同一张格子图（index.html 里 .rail .logo 那个 svg），改这里记得两边一起改。
#
# 用法（在项目根目录）：python tools/make-favicon.py        [--preview 目录  只出图不改文件]
import base64, io, sys
from PIL import Image, ImageDraw

NAME = "Meowly"
BG   = (223, 227, 243, 255)          # #dfe3f3 淡灰紫底
COL  = {"g": (154, 160, 181, 255),   # #9aa0b5 灰猫
        "w": (255, 211, 220, 255),   # #ffd3dc 耳朵里
        "k": (42, 40, 56, 255),      # #2a2838 眼睛 / 鼻子 / 嘴
        "p": (255, 179, 196, 255)}   # #ffb3c4 腮红
HEX  = {"g": "#9aa0b5", "w": "#ffd3dc", "k": "#2a2838", "p": "#ffb3c4"}
# 14 列 × 13 行，一个字一格（. = 空）
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
W, H = len(CAT[0]), len(CAT)

def draw_icon(px):
    """画一张 px×px 的图标：圆角底 + 整像素对齐的格子猫"""
    cell = max(1, (px * 2) // 32)
    ox = (px - W * cell) // 2
    oy = (px - H * cell + 1) // 2
    ss = 4                                            # 只给圆角做抗锯齿：先大后小
    bg = Image.new("RGBA", (px * ss, px * ss), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, px * ss - 1, px * ss - 1], radius=px * ss * 8 // 32, fill=BG)
    im = bg.resize((px, px), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for y, row in enumerate(CAT):
        for x, c in enumerate(row):
            if c in COL:
                d.rectangle([ox + x * cell, oy + y * cell, ox + (x + 1) * cell - 1, oy + (y + 1) * cell - 1], fill=COL[c])
    return im

def png_data_uri(px):
    buf = io.BytesIO()
    draw_icon(px).save(buf, format="PNG", optimize=True)
    b = buf.getvalue()
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii"), len(b)

def cat_rects(x0, y0, cell):
    out = []
    for y, row in enumerate(CAT):
        for x, c in enumerate(row):
            if c in HEX:
                out.append('<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>' % (x0 + x * cell, y0 + y * cell, cell, cell, HEX[c]))
    return "".join(out)

# SVG 版：Chromium / Firefox 优先用它。Safari 不认 SVG favicon，所以 PNG 那两个不能省。
SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">'
       '<rect width="32" height="32" rx="8" fill="#dfe3f3" shape-rendering="auto"/>' + cat_rects(2, 3, 2) + '</svg>')

def svg_data_uri():
    # 不用 base64：SVG 本来就是文本，转义几个字符更短也更好读；空格也转，data URI 里留裸空格不合规。
    s = (SVG.replace('"', "'").replace("#", "%23")
            .replace("<", "%3C").replace(">", "%3E").replace(" ", "%20"))
    return "data:image/svg+xml," + s

def main():
    if "--preview" in sys.argv:
        d = sys.argv[sys.argv.index("--preview") + 1]
        for px in (16, 32, 64, 180):
            draw_icon(px).save(d + "/icon-%d.png" % px)
        print("预览图写到了 " + d)
        return
    svg = svg_data_uri()
    p32, n32 = png_data_uri(32)
    p180, n180 = png_data_uri(180)
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
    open("index.html", "w", encoding="utf-8", newline="").write(html)
    print("写好了：SVG %d 字节 · PNG32 %d 字节 · PNG180 %d 字节" % (len(svg), n32, n180))

if __name__ == "__main__":
    main()
