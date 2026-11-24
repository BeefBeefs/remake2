#!/usr/bin/env python3
"""Decode the game's .pic files (LHA lh5 in a level-1 header, method field 'xxxxx') to .bmp + .png.

usage: decode_pics.py <dir with .pic> <out dir>
"""
import io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lh5
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for fn in sorted(os.listdir(src)):
    if not fn.lower().endswith('.pic'):
        continue
    name, data, ok = lh5.read_pic(open(os.path.join(src, fn), 'rb').read())
    stem = os.path.splitext(name)[0]
    open(os.path.join(dst, name), 'wb').write(data)
    im = Image.open(io.BytesIO(data)); im.convert('RGBA').save(os.path.join(dst, stem + '.png'))
    print(f'{fn} -> {name} {im.size} {im.mode} crc_ok={ok}')
