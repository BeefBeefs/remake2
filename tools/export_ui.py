#!/usr/bin/env python3
"""Export the 2D UI images stored in BLAZE.ALL.
Usage: python3 -I tools/export_ui.py original/BLAZE.ALL public/assets/ui
 - sectors 62 + 91: title screen halves (16-bit RGB555, 128x224 each) -> title.png (256x224)
 - sectors 4009 / 4092: 8-bit 128x256 sheets with a 256-entry RGB555 palette -> sheet4009.png (ornaments), hud.png (font + HUD)
Record layout (16-bit): u32 16, u32 mode(2), u32 psize, u32 0, u16 w, u16 h, pixels.
Record layout (8-bit):  palette block (u32 16, 8, 1036, 0, 0x20100, 256 x u16) then image block u32 0x800c, 0, u16 w/2, u16 h, pixels at +1056.
"""
import struct, sys, os
from PIL import Image
S = 2048
def rgb(v):
    r = (v & 31) << 3; g = ((v >> 5) & 31) << 3; b = ((v >> 10) & 31) << 3
    return (r | r >> 5, g | g >> 5, b | b >> 5)
def half(d, s):
    a, m, ps, z, w, h = struct.unpack_from('<IIIIHH', d, s * S)
    assert (a, m, z) == (16, 2, 0), (s, a, m, z)
    px = struct.unpack_from('<%dH' % (w * h), d, s * S + 20)
    im = Image.new('RGB', (w, h)); im.putdata([rgb(v) for v in px]); return im
def sheet(d, s, trans0=False):
    a, m, ps = struct.unpack_from('<III', d, s * S)
    assert (a, m, ps) == (16, 8, 1036), (s, a, m, ps)
    pal = struct.unpack_from('<256H', d, s * S + 20)
    ps2, z, wh = struct.unpack_from('<3I', d, s * S + 1044)
    w, h = (wh & 0xffff) * 2, wh >> 16
    data = d[s * S + 1056:s * S + 1056 + w * h]
    im = Image.new('RGBA', (w, h))
    im.putdata([(*rgb(pal[b]), 0 if (pal[b] == 0 and trans0) else 255) for b in data]); return im
def main():
    d = open(sys.argv[1], 'rb').read(); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
    t = Image.new('RGB', (256, 224)); t.paste(half(d, 62), (0, 0)); t.paste(half(d, 91), (128, 0)); t.save(os.path.join(out, 'title.png'))
    sheet(d, 4009, True).save(os.path.join(out, 'sheet4009.png'))
    sheet(d, 4092, True).save(os.path.join(out, 'hud.png'))
    print('wrote title.png, sheet4009.png, hud.png to', out)
main()
