#!/usr/bin/env python3
"""Index the archive 'packs' in BLAZE.ALL.

Pack (sector aligned): u32 n; u32 offset[n] (offset[0]==0, ascending, relative to end of table = 4+4n).
Blob of kind 'model' (695 found): u32 hdrsize(0x40); u32 bodysize; hdrsize+bodysize == blob length (576/580 hold).
  header u16 @0x10..: counts (e.g. 61,41,20,7); u32 @0x20: offset of pose table inside body (e.g. 0x2bc); 
  body = index tables, then 16-byte pose records [i16 rot xyz (4096=360deg), 0, i16 trans xyz, i16 scale=4096].
usage: scan_packs.py <BLAZE.ALL> <out.json>
"""
import json, struct, sys

S = 2048
d = open(sys.argv[1], 'rb').read()
out = []
for s in range(len(d) // S):
    o = s * S
    n = struct.unpack_from('<I', d, o)[0]
    if not 2 <= n <= 300 or o + 4 + 4 * n > len(d): continue
    offs = struct.unpack_from('<%dI' % n, d, o + 4)
    if offs[0] != 0 or any(offs[i] >= offs[i + 1] for i in range(n - 1)): continue
    base = o + 4 + 4 * n
    blobs = []
    for i, off in enumerate(offs):
        h = struct.unpack_from('<2I', d, base + off)
        kind = 'model' if h[0] == 0x40 else 'other'
        blobs.append({'off': off, 'kind': kind, 'hdr': h[0], 'body': h[1] if kind == 'model' else None,
                      'counts': list(struct.unpack_from('<4H', d, base + off + 0x10)) if kind == 'model' else None})
    out.append({'sector': s, 'n': n, 'blobs': blobs})
json.dump(out, open(sys.argv[2], 'w'))
print('packs:', len(out), 'model blobs:', sum(b['kind'] == 'model' for p in out for b in p['blobs']))
