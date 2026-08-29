# 生成网站图标（favicon / iOS 主屏图标），并把它们内联进 index.html。
#
# 为什么内联成 data URI 而不是放两个 .png 文件：
#   这个 app 就是单文件 —— 直接双击本地那份 index.html 也要能用，
#   引用相对路径的图标在 file:// 下会 404，图标就又没了。
#
# 图形跟 app 左上角那个 logo 保持一致（靛蓝圆角块 + 白色时钟），
# 只是笔画加粗了一点点：favicon 实际显示常常只有 16px，照搬原比例会细得看不清。
#
# 用法（在项目根目录）：python tools/make-favicon.py
import base64, io, re, sys
from PIL import Image, ImageDraw

SS   = 8                      # 超采样倍数，靠缩小来做抗锯齿
TILE = 32                     # 设计稿按 32×32 画，其余尺寸都从它缩放
BG   = (99, 102, 241, 255)    # --primary #6366f1，跟 app 里的 logo 同色
FG   = (255, 255, 255, 255)

def draw_icon(px):
    """画一张 px×px 的图标（内部按 px*SS 画完再缩小）"""
    s = px * SS
    k = s / TILE                                  # 32 分之一格 → 实际像素
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # 圆角方块。9/32 跟 .rail .logo 的 border-radius:9px 是同一个比例
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=9 * k, fill=BG)

    # 表盘
    cx = cy = 16 * k
    r  = 8 * k
    w  = 2.4 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FG, width=int(round(w)))

    # 指针：先竖着上去，再折向右下 —— 和 logo 里那条 "M12 7v5l3 2" 是同一个形状
    pts = [(16 * k, 10.2 * k), (16 * k, 16 * k), (19.8 * k, 18.3 * k)]
    d.line(pts, fill=FG, width=int(round(w)), joint="curve")
    # PIL 的线没有圆头，两端各补一个圆点补上（不然小尺寸下会看出方角）
    for (x, y) in (pts[0], pts[-1]):
        rr = w / 2
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=FG)

    return im.resize((px, px), Image.LANCZOS)

def png_data_uri(px):
    buf = io.BytesIO()
    draw_icon(px).save(buf, format="PNG", optimize=True)
    b = buf.getvalue()
    return "data:image/png;base64," + base64.b64encode(b).decode("ascii"), len(b)

# SVG 版：Chromium / Firefox 会优先用它，任意尺寸都清晰，而且只有几百字节。
# Safari 至今不认 SVG favicon，所以 PNG 那两个不能省。
SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<rect width="32" height="32" rx="9" fill="#6366f1"/>'
    '<g fill="none" stroke="#fff" stroke-width="2.4" '
    'stroke-linecap="round" stroke-linejoin="round">'
    '<circle cx="16" cy="16" r="8"/>'
    '<path d="M16 10.2V16l3.8 2.3"/>'
    '</g></svg>'
)

def svg_data_uri():
    # 不用 base64：SVG 本来就是文本，转义几个字符更短也更好读。
    # 空格也要转 —— 多数浏览器忍得了裸空格，但 data URI 里留空格本来就不合规，没必要赌。
    s = (SVG.replace('"', "'").replace("#", "%23")
            .replace("<", "%3C").replace(">", "%3E").replace(" ", "%20"))
    return "data:image/svg+xml," + s

def main():
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
        '<meta name="apple-mobile-web-app-title" content="时间管理">\n'
        '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">\n'
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#15171c">\n'
    )

    if "--preview" in sys.argv:                         # 只出图不改文件，用来先看一眼
        d = sys.argv[sys.argv.index("--preview") + 1]
        for px in (16, 32, 64, 180):
            draw_icon(px).save(d + "/icon-%d.png" % px)
        print("预览图写到了 " + d)
        return

    html = open("index.html", encoding="utf-8").read()
    START, END = "<!-- 网站图标。", 'content="#15171c">'
    if START in html:                                   # 已经有了：整块换掉，别越堆越多
        i = html.index(START)
        j = html.index(END, i) + len(END)
        html = html[:i] + block.rstrip("\n") + html[j:]
    else:                                               # 头一次：插在 viewport 那行后面
        anchor = '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        if anchor not in html:
            print("找不到 viewport 那行，没敢动", file=sys.stderr); sys.exit(1)
        html = html.replace(anchor, anchor + block, 1)

    open("index.html", "w", encoding="utf-8", newline="").write(html)
    print("写好了：SVG %d 字节 · PNG32 %d 字节 · PNG180 %d 字节 · 一共给 HTML 加了约 %.1f KB"
          % (len(svg), n32, n180, len(block) / 1024))

if __name__ == "__main__":
    main()
