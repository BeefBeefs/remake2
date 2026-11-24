#!/usr/bin/env python3
"""Export the 96 stages: room meshes (textured, 32-byte face rows) + collision meshes (16-byte triangle rows) and all
128x256 tile atlases. Room-mesh records are found by scanning every sector for the header signature
(u32[8]==0x40, u32[9]==0x40+8V, u32[10]==u32[9]+8N, u16[4]==V); a 'col16' record (no UV rows, u32[12]!=0) starts a stage and
the textured records that follow belong to it. See docs/FORMATS.md "Room meshes".
usage: export_stages.py <BLAZE.ALL> <out dir>
"""
import json, os, struct, sys
from PIL import Image
S = 2048
d = open(sys.argv[1], 'rb').read()
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
for f in os.listdir(out): os.remove(os.path.join(out, f))
n = len(d) // S

def record(s):
    o = s * S
    w = struct.unpack_from('<16I', d, o)
    V, N, F = w[0] & 0xffff, w[0] >> 16, w[1] & 0xffff
    if not (w[8] == 64 and V > 0 and w[9] == 64 + 8 * V and w[10] == w[9] + 8 * N and (w[2] & 0xffff) == V): return None
    verts = [list(struct.unpack_from('<3h', d, o + 64 + 8 * i)) for i in range(V)]
    tex = w[12] == 0 and w[13] > w[10]
    if tex:
        faces = []
        for i in range(F):
            b = o + w[10] + 32 * i
            faces.append({'v': list(struct.unpack_from('<4H', d, b)), 'uv': [[d[b + 16 + 2 * k], d[b + 17 + 2 * k]] for k in range(4)]})
        return {'sector': s, 'verts': verts, 'faces': faces}
    tris = []
    for i in range(F):
        b = o + w[10] + 16 * i
        tris.append(list(struct.unpack_from('<4H', d, b)))
    return {'sector': s, 'verts': verts, 'tris': tris}

# atlases: 128-wide, 256-high, psize 524
atl = []
for s in range(n):
    o = s * S
    if struct.unpack_from('<II', d, o)[0] == 16 and struct.unpack_from('<I', d, o + 4)[0] in (8, 9) and struct.unpack_from('<I', d, o + 8)[0] == 524:
        A, B = struct.unpack_from('<HH', d, o + 524 + 16)
        if (2 * A, B) == (128, 256): atl.append(s)
for k, s in enumerate(atl):
    o = s * S; P = o + 524 + 8
    A, B = struct.unpack_from('<HH', d, P + 8)
    pix = d[P + 12:P + 12 + 128 * 256]
    pal = [struct.unpack_from('<H', d, o + 0x14 + 2 * i)[0] for i in range(256)]
    im = Image.new('RGBA', (128, 256)); px = im.load()
    for y in range(256):
        for x in range(128):
            v = pal[pix[y * 128 + x]]
            px[x, y] = (0, 0, 0, 0) if v == 0 else ((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255)
    im.save(os.path.join(out, f'a{k:03d}.png'))

stages, cur = [], None
for s in range(n):
    r = record(s)
    if r is None: continue
    if 'tris' in r:
        cur = {'collision': r, 'meshes': []}; stages.append(cur)
    elif cur is not None:
        cur['meshes'].append(r)
import bisect
total = 0
for k, st in enumerate(stages):
    i = bisect.bisect(atl, st['collision']['sector']) - 1
    st['atlas'] = max(0, i - 1)        # guess: the 128x256 atlas before the last one preceding the stage
    st['id'] = k
    p = os.path.join(out, f'stage{k:02d}.json')
    json.dump(st, open(p, 'w'), separators=(',', ':')); total += os.path.getsize(p)
json.dump({'atlasSectors': atl, 'stages': [{'sector': s['collision']['sector'], 'meshes': len(s['meshes']), 'atlas': s['atlas']} for s in stages]},
          open(os.path.join(out, 'index.json'), 'w'))
print(len(atl), 'atlases,', len(stages), 'stages, json KB', total // 1024)
