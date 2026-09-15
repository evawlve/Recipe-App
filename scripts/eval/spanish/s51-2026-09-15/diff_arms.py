"""Diff two _seg_ab_driver.ts arm TSVs per idx.
usage: diff_arms.py <armA.tsv> <armB.tsv> [<labels.tsv>] [all]
Prints every idx whose MODAL item count moved, and every idx whose multiset of draw counts moved
(DRAWS), marking lines that contain with/and/con/y. With `all`, prints every idx plus the first
draw's items (rawText|normalizedForm|brand) on both sides.
"""
import csv, json, sys
from collections import Counter, defaultdict

def load(p):
    d = defaultdict(list); lines = {}; items = defaultdict(list)
    for r in csv.DictReader(open(p), delimiter='\t'):
        i = int(r['idx']); lines[i] = r['line']
        d[i].append(int(r['itemCount']) if r['status'] == 'ok' else None)
        try:
            items[i].append(json.loads(r['itemsJson']))
        except Exception:
            items[i].append([])
    return d, lines, items

args = [a for a in sys.argv[1:] if a != 'all']
show_all = 'all' in sys.argv[1:]
a, la, ia = load(args[0]); b, lb, ib = load(args[1])
truth = {}
if len(args) > 2:
    for r in csv.DictReader(open(args[2]), delimiter='\t'):
        truth[int(r['idx'])] = int(r['gradedItems'])

def modal(ns):
    g = [n for n in ns if n is not None]
    return Counter(g).most_common(1)[0][0] if g else None

def fmt(its):
    return ' ; '.join(f"{x.get('r')}|{x.get('n')}|{x.get('b')}" for x in its)

modal_moves = draw_moves = 0
for i in sorted(set(a) | set(b)):
    ma, mb = modal(a.get(i, [])), modal(b.get(i, []))
    ga = sorted(x for x in a.get(i, []) if x is not None)
    gb = sorted(x for x in b.get(i, []) if x is not None)
    flag = 'MODAL' if ma != mb else ('DRAWS' if ga != gb else '')
    line = la.get(i) or lb.get(i)
    joiner = ' [with/and/con/y]' if any(w in line.lower().split() for w in ('with', 'and', 'con', 'y')) else ''
    if flag == 'MODAL': modal_moves += 1
    if flag == 'DRAWS': draw_moves += 1
    if flag or show_all:
        t = truth.get(i)
        print(f"{flag or 'same'}\tidx {i}\ttruth={t}\tA={a.get(i)} modal={ma}\tB={b.get(i)} modal={mb}{joiner}\t{line}")
        if show_all or flag:
            print(f"      A1: {fmt(ia[i][0]) if ia.get(i) else ''}")
            print(f"      B1: {fmt(ib[i][0]) if ib.get(i) else ''}")
print(f"modal movers: {modal_moves}; draw-multiset movers: {draw_moves}")
