#!/usr/bin/env python3
"""Inventory of BLAZE.ALL: classify every 2048-byte sector as the start of a known record type or as unexplained data and print
coverage statistics plus the biggest unexplained runs.
usage: inventory.py <BLAZE.ALL> [packs.json] [--runs N] [--json out.json]
Record starts recognised: TEX (u32 16, mode 8|9, psize), MESH (room mesh header signature), MODULE (u32 256, A, B, 0),
PACK (data/packs.json sector list), ZERO (all-zero sector), FILL (0xCC fill)."""
import json, os, struct, sys
S = 2048
args = [a for a in sys.argv[1:] if not a.startswith('--')]
d = open(args[0], 'rb').read()
packs = {p['sector'] for p in json.load(open(args[1] if len(args) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'packs.json')))}
n = len(d) // S


def classify(s):
    o = s * S
    w = struct.unpack_from('<16I', d, o)
    sec = d[o:o + S]
    if not any(sec): return 'ZERO', 1
    if sec.count(0xcc) > 1900: return 'FILL', 1
    if w[0] == 16 and w[1] in (8, 9) and w[2] in (524, 2060):
        try:
            ww, hh = struct.unpack_from('<HH', d, o + w[2] + 16)
            size = w[2] + 20 + 2 * ww * hh
            if 0 < size < 400000: return ('TEX%d' % w[1]), (size + S - 1) // S
        except struct.error: pass
    V = w[0] & 0xffff; N = w[0] >> 16
    if w[8] == 64 and V > 0 and w[9] == 64 + 8 * V and w[10] == w[9] + 8 * N and (w[2] & 0xffff) == V:
        return 'MESH', 0
    if w[0] == 256 and 0 < w[1] < w[2] < 200000 and w[3] == 0 and w[1] % 4 == 0 and w[2] % 4 == 0:
        return 'MODULE', (w[2] + S - 1) // S
    if s in packs: return 'PACK', 0
    return None, 0


label = [None] * n          # class of the record a sector belongs to
start = [False] * n
cur, left = None, 0
for s in range(n):
    c, span = classify(s)
    if c is not None:
        cur, left = c, span if span else 10 ** 9
        label[s] = cur; start[s] = True
        left -= 1
    elif left > 0:
        label[s] = cur; left -= 1
    else:
        label[s] = None
cnt = {}
for s in range(n):
    k = label[s] or 'UNKNOWN'
    cnt[k] = cnt.get(k, 0) + 1
tot = sum(cnt.values())
print('%d sectors (%.1f MB)' % (n, n * S / 1e6))
for k, v in sorted(cnt.items(), key=lambda kv: -kv[1]): print('  %-8s %6d sectors  %5.1f%%' % (k, v, 100 * v / tot))
# unexplained runs
runs, s = [], 0
while s < n:
    if label[s] is None:
        e = s
        while e < n and label[e] is None: e += 1
        runs.append((e - s, s)); s = e
    else: s += 1
runs.sort(reverse=True)
topn = 25
for a in sys.argv:
    if a.startswith('--runs'): topn = int(a.split('=')[1]) if '=' in a else topn
print('unexplained runs: %d, total %d sectors; biggest:' % (len(runs), sum(r[0] for r in runs)))
for ln, s in runs[:topn]:
    head = d[s * S:s * S + 16].hex()
    print('  sector %6d len %5d  first bytes %s' % (s, ln, head))
for a in sys.argv:
    if a.startswith('--json'):
        json.dump({'counts': cnt, 'runs': [{'sector': s, 'len': ln} for ln, s in runs]}, open(a.split('=')[1], 'w'))
