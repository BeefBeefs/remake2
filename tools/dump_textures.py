#!/usr/bin/env python3
"""Dump every paletted texture record in BLAZE.ALL to PNG.

Record layout (reverse-engineered):
  sector-aligned: u32 16, u32 type(8|9), u32 psize
  +12 : palette block. Entries are u16 BGR555 (bit15 = opaque flag): R=v&31, G=(v>>5)&31, B=(v>>10)&31.
        first palette starts at +0x14 (u16 0, u16 0x1e0|0, u16 count(256), u16 1 precede it)
  +psize+8 : 12-byte pixel header: u8 hdrsize(12), u16 height, u8 0, u32 640|768|0, u16 A, u16 B
  +psize+20: height*256 bytes of 8-bit indices (stride 256), then padding / further chunks.

usage: dump_textures.py <BLAZE.ALL> <out dir>
"""
import json, os, struct, sys
from PIL import Image

SECTOR = 2048

def pal_rgba(d, o, count=256):
    out = []
    for i in range(256):
        v = struct.unpack_from('<H', d, o + 0x14 + i * 2)[0] if i < count else 0
        r, g, b = v & 31, (v >> 5) & 31, (v >> 10) & 31
        out.append(((r * 255) // 31, (g * 255) // 31, (b * 255) // 31, 255 if (v & 0x8000 or v) else 0))
    return out

def main():
    path, dst = sys.argv[1], sys.argv[2]
    d = open(path, 'rb').read()
    os.makedirs(dst, exist_ok=True)
    index = []
    for s in range(len(d) // SECTOR):
        a, t, psize = struct.unpack_from('<III', d, s * SECTOR)
        if a != 16 or t not in (8, 9): continue
        o = s * SECTOR
        P = o + psize + 8
        hdr, h = d[P], struct.unpack_from('<H', d, P + 1)[0]
        if hdr not in (12,) or not (0 < h <= 1024):
            index.append({'sector': s, 'type': t, 'skipped': True, 'hdr': hdr, 'h': h}); continue
        count = 256 if psize >= 524 else 16
        pix = d[P + 12: P + 12 + 256 * h]
        if len(pix) < 256 * h:
            pix = pix + bytes(256 * h - len(pix))
        im = Image.new('P', (256, h))
        pal = pal_rgba(d, o, count)
        im.putpalette([c for p in pal for c in p[:3]])
        im.putdata(list(pix))
        rgba = im.convert('RGBA')
        px = rgba.load()
        # make palette entry 0 (and entries with value 0) transparent
        for y in range(h):
            for x in range(256):
                if pal[pix[y * 256 + x]][3] == 0: px[x, y] = (0, 0, 0, 0)
        name = f'tex_{s:05d}.png'
        rgba.save(os.path.join(dst, name))
        index.append({'sector': s, 'type': t, 'file': name, 'h': h, 'psize': psize,
                      'hdr_tail': list(struct.unpack_from('<IHH', d, P + 4))})
    json.dump(index, open(os.path.join(dst, 'index.json'), 'w'))
    print('textures:', sum(1 for e in index if 'file' in e), 'skipped:', sum(1 for e in index if e.get('skipped')))

if __name__ == '__main__':
    main()
