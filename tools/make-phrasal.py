# 用法：python tools/make-phrasal.py "输出.txt"   —— 牛津 + 朗文 全部短语动词去重，每行一个，可直接在生词本「导入单词」里导入。
# 读的是 dictionaries/ 里本机的词典（受版权，不进仓库）；输出的名单也只放本机。
# -*- coding: utf-8 -*-
# 牛津 + 朗文 的全部短语动词，去重，输出一份可以直接导入生词本的 txt（每行一个）。
import sys, io, re, gzip, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D = r"C:\Users\ccche\OneDrive\1_Code\Timetracker\dictionaries"
OUT = sys.argv[1]

def read(p):
    for l in gzip.open(p, 'rt', encoding='utf-8', newline='\n'):
        k, d, h = l.rstrip('\n').split('\t', 2)
        yield k, d, h

okeys, lkeys = {}, {}
opv, lpv = [], []
for k, d, h in read(D + r"\oald.tsv.gz"):
    okeys[k] = h
    m = re.search(r'<span class="pos">([^<]*)</span>', h[:1500])
    if m and 'phrasal' in m.group(1): opv.append(k)
for p in ("ldoce-1", "ldoce-2"):
    for k, d, h in read(D + "\\" + p + ".tsv.gz"):
        lkeys[k] = h
        if h.startswith('<div class="ldoce"><span class="phrvbentry">'): lpv.append(k)
print("oald pv", len(opv), "ldoce pv", len(lpv))

OBJ = set("somebody something sb sth yourself oneself himself herself itself themselves myself ourselves yourselves one's sb's sth's doing".split())
def clean(k):
    k = k.replace('!', '').replace('’', "'")
    k = re.sub(r',.*$', '', k)                 # "blunder about, around, etc." -> "blunder about"
    k = re.sub(r'(\w+)/\w+', r'\1', k)         # "himself/herself" -> "himself"
    return re.sub(r'\s+', ' ', k).strip()
def norm(k):
    return ' '.join(w for w in clean(k).split() if w not in OBJ)

def wordIssue(s):                              # 和网页导入时的检查一致（index.html 里的 wordIssue）
    if re.search(r'\d', s): return "含数字"
    if len(s) > 40: return "太长"
    if re.search(r"[^A-Za-z\u00c0-\u024f\s'’.\-]", s): return "含奇怪符号"
    if len(s.split()) > 5: return "词太多"
    return ""

def has(store, k):
    return k in store

groups = collections.OrderedDict()
for k in opv: groups.setdefault(norm(k), []).append(('o', k))
for k in lpv: groups.setdefault(norm(k), []).append(('l', k))
out, both, bad = [], 0, []
for n, cands in groups.items():
    if not n or ' ' not in n: continue
    srcs = set(s for s, _ in cands)
    if len(srcs) == 2: both += 1
    # 挑一个两本词典都查得到的写法；没有就挑去掉 somebody/something 的那个；再不行用词典原样的词头
    opts = [n] + [clean(k) for _, k in cands] + [k for _, k in cands]
    pick = None
    for o in opts:
        if has(okeys, o) and has(lkeys, o): pick = o; break
    if not pick:
        for o in opts:
            if has(okeys, o) or has(lkeys, o): pick = o; break
    pick = pick or n
    why = wordIssue(pick)
    if why and not wordIssue(n): pick = n; why = ""          # 词头写法太怪（带括号 / 逗号）：用干净的写法，网页查词时按「去掉宾语后相同」找回原词条
    if why: bad.append((pick, why)); continue
    out.append(pick)
seen = set(); final = []
for w in out:
    if w.lower() in seen: continue
    seen.add(w.lower()); final.append(w)
final.sort(key=lambda w: (w.split()[0], w))
io.open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(final) + '\n')
only_o = sum(1 for c in groups.values() if set(s for s, _ in c) == {'o'})
only_l = sum(1 for c in groups.values() if set(s for s, _ in c) == {'l'})
print("unique", len(final), "both", both, "only oald", only_o, "only ldoce", only_l, "bad", bad[:20], len(bad))
hit_o = sum(1 for w in final if w in okeys); hit_l = sum(1 for w in final if w in lkeys)
print("needs norm-lookup", [w for w in final if w not in okeys and w not in lkeys][:40])
print("lookup hits: oald", hit_o, "ldoce", hit_l, "neither", sum(1 for w in final if w not in okeys and w not in lkeys))
print(final[:30])
