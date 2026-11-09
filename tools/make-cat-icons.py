# 把她给的两张贴纸图（各 3×2 只猫头）切成 12 个可选的网站图标，内联进 index.html。
#
# 2026-11-10 她：「我想要这些，可以设置成可以在设置里面切换的吗」——
#   蓝色那张（Pastel Blue Kawaii Cat Sticker Sheet.png）是白底，
#   彩色那张（Pastel Kawaii Cat Sticker Collection.png）本来就是透明底，只是每只猫外面有一圈半透明的光晕。
# 做法：
#   1. 按 3×2 切格子（每格 512×512）；
#   2. 白底那张从格子边缘往里泛洪，近白的连通区域变透明（猫脸里的白被描边围着，泛洪进不去）；
#      透明底那张把半透明的光晕去掉（alpha 低于阈值的当背景）；
#   3. 只留猫头：最大的那块 + 中下部挨着它的小块（胡子），头顶外面的小装饰（星星、爱心、ZZZ、「!!」）扔掉；
#   4. 按留下的范围裁成正方形，缩成 64×64 PNG。
# 图标数据写在 index.html 里 `var CAT_ICONS=` 那一行，别手改。
#
# 用法（项目根目录）：python tools/make-cat-icons.py [蓝色那张] [彩色那张]   [--preview 目录]
import base64, io, os, sys
from collections import deque
from PIL import Image

DESK = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop")
SRC = [
    ("blue", os.path.join(DESK, "Pastel Blue Kawaii Cat Sticker Sheet.png")),
    ("pastel", os.path.join(DESK, "Pastel Kawaii Cat Sticker Collection.png")),
]
NAMES = {
    "blue":   ["眨眼蓝虎斑", "蓝花白猫", "趴着睡蓝猫", "深蓝圆眼", "蓝毛团", "蓝白眨眼"],
    "pastel": ["橘猫", "三花", "趴着睡灰虎斑", "黑猫", "白毛团", "灰白眨眼"],
}
OUT_PX = 64

def cut_bg_white(cell):
    """白底：从四边泛洪近白像素 → 透明"""
    w, h = cell.size
    px = cell.load()
    seen = bytearray(w * h)
    q = deque()
    def near_white(p): return p[0] > 232 and p[1] > 232 and p[2] > 232
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]: continue
        seen[i] = 1
        if not near_white(px[x, y]): continue
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    return cell

def cut_glow(cell):
    """透明底：外面那圈半透明光晕去掉，描边自己的抗锯齿边缘保留一点"""
    px = cell.load()
    w, h = cell.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 200: px[x, y] = (r, g, b, 0)
            elif a < 250: px[x, y] = (r, g, b, int((a - 200) * 255 / 50))
    return cell

def components(cell):
    """不透明像素的 4 连通块：[(像素数, minx, miny, maxx, maxy, cx, cy, [像素...])]"""
    w, h = cell.size
    a = cell.getchannel("A").load()
    lab = [0] * (w * h)
    out = []
    for sy in range(h):
        for sx in range(w):
            if a[sx, sy] == 0 or lab[sy * w + sx]: continue
            n = len(out) + 1
            q = deque([(sx, sy)]); lab[sy * w + sx] = n
            pts = []
            while q:
                x, y = q.popleft(); pts.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and a[nx, ny] and not lab[ny * w + nx]:
                        lab[ny * w + nx] = n; q.append((nx, ny))
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            out.append((len(pts), min(xs), min(ys), max(xs), max(ys), sum(xs) / len(xs), sum(ys) / len(ys), pts))
    return out

def keep_head(cell):
    comps = components(cell)
    if not comps: return cell, None
    main = max(comps, key=lambda c: c[0])
    _, x0, y0, x1, y1 = main[:5]
    band_top = y0 + (y1 - y0) * 0.30          # 头顶 30% 以上的小块是装饰
    W, H = cell.size
    px = cell.load()
    body = set(main[7])
    def enclosed(c):
        # 从这块的中心往上下左右走，四个方向都撞得到猫身 = 被猫包着（尾巴上的肉垫）
        cx, cy = int(c[5]), int(c[6])
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            x, y = cx, cy
            while 0 <= x < W and 0 <= y < H and (x, y) not in body:
                x += dx; y += dy
            if not (0 <= x < W and 0 <= y < H): return False
        return True
    keep = [main]
    for c in comps:
        if c is main or c[0] < 12: continue
        # 碰到格子边的是隔壁那只猫伸过来的胡子尖
        if c[1] == 0 or c[2] == 0 or c[3] == W - 1 or c[4] == H - 1: continue
        if enclosed(c): keep.append(c); continue
        cx, cy = c[5], c[6]
        if not (band_top <= cy <= y1 + 4 and x0 - 70 <= cx <= x1 + 70): continue
        # 胡子是描边色（深），装饰是彩色的（黄的「!!」、浅蓝的 ZZZ、粉的爱心）
        lum = sum(0.3 * px[p][0] + 0.59 * px[p][1] + 0.11 * px[p][2] for p in c[7]) / c[0]
        if lum < 120: keep.append(c)
    mask = Image.new("L", cell.size, 0)
    mp = mask.load()
    for c in keep:
        for p in c[7]: mp[p] = 255
    out = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    out.paste(cell, (0, 0), Image.composite(cell.getchannel("A"), mask, mask))
    bx0 = min(c[1] for c in keep); by0 = min(c[2] for c in keep)
    bx1 = max(c[3] for c in keep); by1 = max(c[4] for c in keep)
    return out, (bx0, by0, bx1 + 1, by1 + 1)

def square(im, box, px):
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0)
    pad = int(side * 0.03)
    side += 2 * pad
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im.crop(box), (int(side / 2 - (x1 - x0) / 2), int(side / 2 - (y1 - y0) / 2)))
    return canvas.resize((px, px), Image.LANCZOS)

def build(paths):
    icons = []
    for (kind, path) in paths:
        sheet = Image.open(path).convert("RGBA")
        W, H = sheet.size
        cw, ch = W // 3, H // 2
        for r in range(2):
            for c in range(3):
                cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).copy()
                cell = cut_bg_white(cell) if kind == "blue" else cut_glow(cell)
                head, box = keep_head(cell)
                if not box: continue
                icons.append((kind + str(r * 3 + c + 1), NAMES[kind][r * 3 + c], square(head, box, OUT_PX)))
    return icons

def data_uri(im):
    buf = io.BytesIO(); im.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def main():
    argv = sys.argv[1:]
    if "--preview" in argv:
        i = argv.index("--preview"); argv = argv[:i] + argv[i + 2:]
    args = [a for a in argv if not a.startswith("--")]
    paths = SRC if not args else list(zip(["blue", "pastel"], args))
    icons = build(paths)
    if "--preview" in sys.argv:
        d = sys.argv[sys.argv.index("--preview") + 1]
        sheet = Image.new("RGBA", (len(icons) * 140, 300), (255, 255, 255, 255))
        for i, (k, n, im) in enumerate(icons):
            for j, bg in enumerate([(255, 214, 220, 255), (40, 42, 48, 255)]):
                tile = Image.new("RGBA", (140, 150), bg)
                tile.alpha_composite(im.resize((96, 96), Image.LANCZOS), (6, 6))
                tile.alpha_composite(im.resize((32, 32), Image.LANCZOS), (104, 10))
                tile.alpha_composite(im.resize((16, 16), Image.LANCZOS), (112, 50))
                sheet.alpha_composite(tile, (i * 140, j * 150))
        sheet.save(os.path.join(d, "cats-preview.png"))
        print("预览：" + os.path.join(d, "cats-preview.png"))
        return
    js = "  var CAT_ICONS=[" + ",".join(
        '{k:"%s",n:"%s",u:"%s"}' % (k, n, data_uri(im)) for k, n, im in icons) + "];"
    html = open("index.html", encoding="utf-8").read()
    i = html.index("  var CAT_ICONS=[")
    j = html.index("];", i) + 2
    html = html[:i] + js + html[j:]
    open("index.html", "w", encoding="utf-8", newline="").write(html)
    print("写好了 %d 个图标，%d KB" % (len(icons), len(js) // 1024))

if __name__ == "__main__":
    main()
