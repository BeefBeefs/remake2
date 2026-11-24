#!/usr/bin/env python3
"""Export the spell table (global module at sector 4624) to public/assets/spells.json.

48-byte records starting at module offset 3688 (end of the table part + body start): name[16] holds one or two NUL separated words ('Fire' 'Bullet'),
then 16 u16: [0] id (a few differ: Thunderbolt 277 ...), [1] low 10 bits = effect/animation id?, high 6 bits = tier, [2] MP cost (Fire Bullet 2 ... Fusion 100),
[3] element (2 fire, 3 water, 4 earth, 5 wind/lightning, 6 light, 7 dark, 8 holy/support, 9 death), [4] power (damage or heal amount), [6..] more flags (raw kept).
90 records. usage: export_spells.py <BLAZE.ALL> <out.json>
"""
import json, struct, sys
d = open(sys.argv[1], 'rb').read()
b = d[4624 * 2048:4624 * 2048 + 0x3c2c + 0x100]
o, out = 3688, []
while o + 48 <= len(b):
    r = b[o:o + 48]
    words = [w for w in r[:16].split(b'\0') if w]
    if not words or not all(32 <= c < 127 for w in words for c in w): break
    h = struct.unpack_from('<16H', r, 16)
    out.append({'n': len(out), 'name': ' '.join(w.decode() for w in words), 'id': h[0], 'effect': h[1] & 1023, 'tier': h[1] >> 10,
                'mp': h[2], 'element': h[3], 'power': h[4], 'raw': list(h)})
    o += 48
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(out), 'spells')
