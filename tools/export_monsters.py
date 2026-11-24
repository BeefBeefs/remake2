#!/usr/bin/env python3
"""Export monster models: anim pack <-> mesh pack pairs (data/monster_pairs.json), textures grouped as stacked strips.

Monster textures are 256-wide strips of 64 rows (the last strip of a group is shorter, which ends the group); a group is
stacked vertically into one image, because mesh UVs run past v=64 (up to ~208). Group k <-> monster k is a HYPOTHESIS
(works well for monsters 0, 2; 1 and 3 still show wrong areas). One CLUT only (psize 524).
usage: export_monsters.py <BLAZE.ALL> <packs.json> <pairs.json> <out json dir> <out png dir>
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshparse, assemble
from PIL import Image

S = 2048
d = open(sys.argv[1], 'rb').read()
packs = {p['sector']: p for p in json.load(open(sys.argv[2]))}
pairs = json.load(open(sys.argv[3]))
os.makedirs(sys.argv[4], exist_ok=True); os.makedirs(sys.argv[5], exist_ok=True)

def strip(sec):
    o = sec * S
    psize = struct.unpack_from('<I', d, o + 8)[0]
    P = o + psize + 8
    A, B = struct.unpack_from('<HH', d, P + 8)
    W, H = 2 * A, B
    pix = d[P + 12:P + 12 + W * H]
    pal = [struct.unpack_from('<H', d, o + 0x14 + 2 * i)[0] for i in range(256)]
    im = Image.new('RGBA', (256, H)); px = im.load()
    for y in range(H):
        for x in range(W):
            k = y * W + x
            v = pal[pix[k]] if k < len(pix) else 0
            px[x, y] = (0, 0, 0, 0) if v == 0 else ((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255)
    return im

# texture groups: consecutive 524-psize records in sectors 280..1030; a strip shorter than 64 rows closes the group
recs = []
for sec in sorted(packs_s for packs_s in range(280, 1031)):
    o = sec * S
    if struct.unpack_from('<II', d, o) != (16, 8) and struct.unpack_from('<I', d, o)[0] != 16: continue
    if struct.unpack_from('<I', d, o + 8)[0] != 524: continue
    recs.append(sec)
groups, cur = [], []
for sec in recs:
    cur.append(sec)
    o = sec * S; P = o + 524 + 8
    if struct.unpack_from('<H', d, P + 10)[0] != 64:
        groups.append(cur); cur = []
if cur: groups.append(cur)
print(len(recs), 'texture records,', len(groups), 'groups')

strip_h = {}
for g, secs in enumerate(groups):
    ims = [strip(x) for x in secs]
    for x, i in zip(secs, ims): strip_h[x] = i.height
    sheet = Image.new('RGBA', (256, sum(i.height for i in ims))); y = 0
    for i in ims: sheet.paste(i, (0, y)); y += i.height
    sheet.save(os.path.join(sys.argv[5], f'g{g:02d}.png'))
json.dump([{'sectors': g, 'height': sum(strip_h[x] for x in g)} for g in groups], open(os.path.join(sys.argv[5], 'groups.json'), 'w'))
total = 0
for k, pr in enumerate(pairs):
    mp, ap = packs[pr['mesh']], packs[pr['anim']]
    base = mp['sector'] * S + 4 + 4 * mp['n']
    offs = [b['off'] for b in mp['blobs']]
    nxt = min([q for q in packs if q > mp['sector']] or [len(d) // S])
    ends = offs[1:] + [nxt * S - base]
    pp = meshparse.parse_pack(d, base, offs, ends)
    parts = [{'index': i, 'verts': r['verts'],
              'faces': [{'uv': [list(c) for c in f['uv']], 'v': list(f['v'])} for f in r['faces'] + r['extra']]}
             for i, r in sorted(pp.items()) if r['faces']]
    anims = []
    for bi in range(ap['n']):
        a = assemble.load_anim(d, ap, bi)
        anims.append({'parent': a['parent'], 'partBone': a['part_bone'],
                      'poses': [list(p) for p in a['poses']], 'frames': a['frames']})
    tex = {'height': groups[k] and sum(strip_h[x] for x in groups[k])} if k < len(groups) else None
    out = {'hero': k, 'textureSector': groups[k][0] if k < len(groups) else 0, 'texHeight': tex['height'] if tex else 64, 'defaultGroup': k if k < len(groups) else 0,
           'meshSector': pr['mesh'], 'animSector': pr['anim'], 'parts': parts, 'anims': anims}
    path = os.path.join(sys.argv[4], f'mon{k:02d}.json')
    json.dump(out, open(path, 'w'), separators=(',', ':')); total += os.path.getsize(path)
print(len(pairs), 'monsters, total KB', total // 1024)
