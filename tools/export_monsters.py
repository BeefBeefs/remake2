#!/usr/bin/env python3
"""Export the 97 monsters listed in data/model_table.json (entries 16..112: texture, anim pack, mesh pack in parallel).

The table (file offset 0x9119f0, (sector,size) u32 pairs) holds three parallel lists of 113 models: textures, animation packs,
mesh packs; entries 0..15 are the heroes, 16.. the monsters. Each monster has ONE texture record (psize 524 = 1 CLUT, 256 px wide,
<= 64 rows; shorter ones are padded to 64 rows). Faces whose UVs lie below row 63 stay unresolved (viewer skips them).
usage: export_monsters.py <BLAZE.ALL> <packs.json> <model_table.json> <out dir>
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshparse, assemble
from PIL import Image

S = 2048
d = open(sys.argv[1], 'rb').read()
packs = {p['sector']: p for p in json.load(open(sys.argv[2]))}

def pack(sec):
    """packs.json misses single-blob packs (n == 1); read those header-directly."""
    if sec in packs: return packs[sec]
    n = struct.unpack_from('<I', d, sec * S)[0]
    offs = struct.unpack_from('<%dI' % n, d, sec * S + 4)
    return {'sector': sec, 'n': n, 'blobs': [{'off': o} for o in offs]}
T = json.load(open(sys.argv[3]))
out_dir = sys.argv[4]
for f in os.listdir(out_dir) if os.path.isdir(out_dir) else []:
    os.remove(os.path.join(out_dir, f))
os.makedirs(out_dir, exist_ok=True)

def tex_png(sec, path):
    o = sec * S
    psize = struct.unpack_from('<I', d, o + 8)[0]
    P = o + psize + 8
    A, B = struct.unpack_from('<HH', d, P + 8)
    W, H = 2 * A, B
    pix = d[P + 12:P + 12 + W * H]
    pal = [struct.unpack_from('<H', d, o + 0x14 + 2 * i)[0] for i in range(256)]
    im = Image.new('RGBA', (256, 64)); px = im.load()
    for y in range(min(H, 64)):
        for x in range(min(W, 256)):
            v = pal[pix[y * W + x]]
            px[x, y] = (0, 0, 0, 0) if v == 0 else ((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255)
    im.save(path)

total = 0
for k in range(97):
    m = 16 + k
    tsec, asec, msec = T['textures'][m][0], T['anims'][m][0], T['meshes'][m][0]
    mp, ap = pack(msec), pack(asec)
    base = mp['sector'] * S + 4 + 4 * mp['n']
    offs = [b['off'] for b in mp['blobs']]
    nxt = min([q for q in packs if q > mp['sector']] or [len(d) // S])
    ends = offs[1:] + [nxt * S - base]
    pp = meshparse.parse_pack(d, base, offs, ends)
    print("  recovered rows (fixed, unfixed):", meshparse.recover_bad_rows(pp))
    parts = [{'index': i, 'verts': r['verts'],
              'faces': [{'uv': [list(c) for c in f['uv']], 'v': list(f['v'])} for f in r['faces'] + r['extra']]}
             for i, r in sorted(pp.items()) if r['faces']]
    anims = []
    for bi in range(ap['n']):
        a = assemble.load_anim(d, ap, bi)
        anims.append({'parent': a['parent'], 'partBone': a['part_bone'],
                      'poses': [list(p) for p in a['poses']], 'frames': a['frames']})
    tex_png(tsec, os.path.join(out_dir, f'mon{k:02d}.png'))
    out = {'hero': m, 'textureSector': tsec, 'meshSector': msec, 'animSector': asec, 'parts': parts, 'anims': anims}
    path = os.path.join(out_dir, f'mon{k:02d}.json')
    json.dump(out, open(path, 'w'), separators=(',', ':')); total += os.path.getsize(path)
print('97 monsters, total KB', total // 1024)
