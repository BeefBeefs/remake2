#!/usr/bin/env python3
"""Export the 16 hero textures (data/resource_table.json) as one PNG per CLUT: <out>/h<k>_c<j>.png.

Texture record: palette block = 4 CLUTs x 256 u16 BGR555 starting at record+0x14 (2048 B, psize 2060 = block + 12),
pixels (256 wide, 8-bit) at record+psize+20, height from the pixel header. PS1 colour 0x0000 is transparent.
usage: export_hero_tex.py <BLAZE.ALL> <resource_table.json> <out dir>
"""
import json, os, struct, sys
from PIL import Image

S = 2048
d = open(sys.argv[1], 'rb').read()
rt = json.load(open(sys.argv[2]))
os.makedirs(sys.argv[3], exist_ok=True)
meta = []
for k, sec in enumerate(rt['hero_textures']):
    o = sec * S
    psize = struct.unpack_from('<I', d, o + 8)[0]
    P = o + psize + 8
    h = struct.unpack_from('<H', d, P + 1)[0]
    pix = d[P + 12:P + 12 + 256 * h]
    ncl = (psize - 12) // 512
    for j in range(ncl):
        pal = [struct.unpack_from('<H', d, o + 0x14 + 512 * j + 2 * i)[0] for i in range(256)]
        im = Image.new('RGBA', (256, h))
        px = im.load()
        for y in range(h):
            for x in range(256):
                v = pal[pix[y * 256 + x]]
                px[x, y] = (0, 0, 0, 0) if v == 0 else ((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255)
        im.save(os.path.join(sys.argv[3], f'h{k:02d}_c{j}.png'))
    meta.append({'hero': k, 'sector': sec, 'height': h, 'cluts': ncl})
json.dump(meta, open(os.path.join(sys.argv[3], 'index.json'), 'w'))
print(len(meta), 'heroes,', sum(m['cluts'] for m in meta), 'images')
