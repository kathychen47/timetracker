# 用法：python tools/make-ldoce.py "Word Origin,Collocations,Verb Table,Word family" "dictionaries/ldoce-#.tsv.gz"
# 欧路的朗文6 mdx 词典本身受版权，只在本机，生成的 .tsv.gz 进 dictionaries/（已 .gitignore），绝不推到公开仓库。
# 例句库 / 同义词库 / 词汇集 这几个弹出层占了 1GB 里的大半，不收；短语动词从词条里抽出来单独成条（take off、give up…）。
# -*- coding: utf-8 -*-
# 朗文6 mdx -> ldoce.tsv（小写词头 \t 显示词 \t 清洗后 HTML），按需要删掉体积巨大的弹出层。
import sys, io, re, gzip, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from mdict_utils.base.readmdict import MDX
P = r"C:\Users\ccche\OneDrive\C. Apps\欧陆词典\6. 朗文6++ V2.19【默认显示中文】\LDOCE6++ En-Cn V2-19 V2\LDOCE6++ En-Cn V2-19.mdx"
KEEP = set(sys.argv[1].split(",")) if len(sys.argv) > 1 and sys.argv[1] else set()
OUT = sys.argv[2] if len(sys.argv) > 2 else None
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 0

DIV_RE = re.compile(r'<(/?)div\b[^>]*>', re.I)
def end_of_div(s, i):
    """s[i] 是 <div ...> 的开头，返回配对的 </div> 之后的位置。"""
    depth = 0
    for m in DIV_RE.finditer(s, i):
        if m.group(1): depth -= 1
        else: depth += 1
        if depth == 0: return m.end()
    return len(s)

ZH = {"Collocations": "搭配", "Word Origin": "词源", "Verb Table": "动词变化", "Word family": "词族"}
SPAN_RE = re.compile(r'<(/?)span\b[^>]*>', re.I)
def end_of_span(s, i):
    depth = 0
    for m in SPAN_RE.finditer(s, i):
        if m.group(1): depth -= 1
        else: depth += 1
        if depth == 0: return m.end()
    return len(s)
PV_RE = re.compile(r'<span class="phrvbentry">')
def pv_blocks(h):
    """这一条里的短语动词：[(\"take off\", 那一块 HTML)]。宾语（somebody / something）去掉当键。"""
    out = []
    for m in PV_RE.finditer(h):
        e = end_of_span(h, m.start()); blk = h[m.start():e]
        hm = re.search(r'<span class="phrvbhwd">(.*?)</span>\s*<span class="pos">', blk, re.S)
        if not hm: continue
        t = re.sub(r'<span class="(?:object|geo|registerlab)">.*?</span>', ' ', hm.group(1), flags=re.S)
        t = re.sub(r'<[^>]+>', '', t); t = re.sub(r'\s+', ' ', t).strip().lower()
        for v in pv_variants(t): out.append((v, blk))
    return out
LABELS = r'\b(?:british|american|australian) english\b|\binformal\b|\bformal\b|\bspoken\b|\bold-fashioned\b|\bliterary\b|\btechnical\b|\bnot polite\b'
def pv_variants(t):
    """词头里的写法变体都拆成能查的键：
    「ponce about/around」→ ponce about、ponce around；「brush up (on)」→ brush up、brush up on；
    「cater for (also cater to somebody)」→ cater for；「cash up british english, cash out american english」→ cash up、cash out。"""
    t = t.replace('’', "'").replace('↔', ' ')
    t = re.sub(r'\(also [^)]*\)', ' ', t)
    t = re.sub(r'\betc\b\.?', ' ', t)
    t = re.sub(LABELS, ' ', t)
    outs = []
    for part in re.split(r'[,;]', t):
        part = re.sub(r'\s+', ' ', part).strip()
        if not part: continue
        alts = [part]
        m = re.search(r'\(([^)]*)\)', part)                     # 可有可无的那段：带 / 不带各一个
        if m: alts = [part[:m.start()] + part[m.end():], part[:m.start()] + m.group(1) + part[m.end():]]
        for a in alts:
            toks = [x.split('/') for x in a.split()]
            combos = ['']
            for opts in toks:
                combos = [(c + ' ' + o).strip() for c in combos for o in opts if o][:12]
            for c in combos:
                c = re.sub(r'\s+', ' ', c).strip()
                if c and ' ' in c and re.fullmatch(r"[a-z' .-]+", c) and c not in outs: outs.append(c)
    return outs
BTN_RE = re.compile(r'<span class="popup-button"[^>]*>(.*?)</span>\s*(?=<div class="at-link">)', re.S)
def strip_pops(s, stat):
    out = []; pos = 0
    while True:
        m = BTN_RE.search(s, pos)
        if not m: out.append(s[pos:]); break
        label = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        dstart = m.end(); dend = end_of_div(s, dstart)
        stat[label] += dend - m.start()
        out.append(s[pos:m.start()])
        if label in KEEP:
            out.append('<details class="lpop"><summary>' + ZH.get(label, label) + '</summary>' + s[dstart:dend] + '</details>')
        pos = dend
    return ''.join(out)

def clean(s, stat):
    s = re.sub(r'<link[^>]*>|<script[^>]*>.*?</script>', '', s, flags=re.S)
    s = strip_pops(s, stat)
    s = re.sub(r'<a href="sound://[^"]*">\s*<img[^>]*>\s*</a>', '', s)      # 没有音频文件，喇叭去掉（发音用浏览器朗读）
    s = re.sub(r'<img[^>]*>', '', s)
    s = re.sub(r'<a name="[^"]*" id="[^"]*"></a>', '', s)
    s = re.sub(r'<(deft|exat|l6|cnt|atl)></\1>', '', s)
    s = re.sub(r'\s*onclick="[^"]*"', '', s)
    s = re.sub(r'<div class="chwd">.*?</div>', '', s, flags=re.S)                # 词性跳转条（锚点已删，点了没用）
    s = re.sub(r'<a href="entry://#[^"]*">(.*?)</a>', r'\1', s, flags=re.S)
    s = re.sub(r'<a href="entry://([^"#]+)(?:#[^"]*)?">', lambda m: '<a class="lx" data-lx="' + m.group(1).replace('"', '&quot;') + '">', s)
    s = re.sub(r'<a href="(?:sound|https?)://[^"]*">(.*?)</a>', r'\1', s, flags=re.S)
    s = s.replace('\t', ' ').replace('\r', '').replace('\n', ' ')
    return s

m = MDX(P)
stat = collections.Counter(); recs = collections.OrderedDict(); n = 0; raw = 0
for k, v in m.items():
    n += 1
    if LIMIT and n > LIMIT: break
    key = k.decode('utf-8').strip(); h = v.decode('utf-8', 'replace').rstrip('\x00').strip()
    raw += len(v)
    if not h.startswith('@@@LINK='): h = clean(h, stat)
    lk = key.lower()
    if lk in recs:
        d0, h0 = recs[lk]
        if h0.startswith('@@@LINK='): recs[lk] = (key, h)
        elif not h.startswith('@@@LINK='): recs[lk] = (d0, h0 + h)
    else: recs[lk] = (key, h)
pv = collections.OrderedDict()
for lk, (d, h) in recs.items():
    if h.startswith('@@@LINK='): continue
    for t, blk in pv_blocks(h): pv.setdefault(t, []).append(blk)
addn = 0
for t, blks in pv.items():
    head = ''.join(blks)
    cur = recs.get(t)
    if cur is None: recs[t] = (t, head); addn += 1; continue
    d, h = cur; hops = 0
    while h.startswith('@@@LINK=') and hops < 4:
        nx = recs.get(h[8:].strip().lower()); hops += 1
        if not nx: h = ''; break
        h = nx[1]
    if h.startswith('@@@LINK='): h = ''
    recs[t] = (d, head + h)
print('phrasal verbs', len(pv), 'new keys', addn)
items = list(recs.items()); half = len(items) // 2; tot = 0
for part, chunk in ((1, items[:half]), (2, items[half:])):
    f = gzip.open(OUT.replace('#', str(part)), 'wt', encoding='utf-8', compresslevel=9) if OUT else None
    for lk, (d, h) in chunk:
        if not h.startswith('@@@LINK='): h = '<div class="ldoce">' + h + '</div>'
        line = lk + '\t' + d + '\t' + h + '\n'; tot += len(line.encode('utf-8'))
        if f: f.write(line)
    if f: f.close()
print('records', n, 'keys', len(recs), 'raw MB', raw // 1048576, 'out MB', tot // 1048576)
for lab, b in stat.most_common(): print('  pop', lab, b // 1048576, 'MB')
