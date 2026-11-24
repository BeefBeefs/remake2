#!/usr/bin/env python3
"""Export the mesh parts of one BLAZE.ALL pack to JSON (for the three.js loader).

usage: export_parts.py <BLAZE.ALL> <packs.json> <pack sector> <out.json>
Face vertex indices are *model-global* (can exceed the part's own vertex count - shared joints); the mapping from
global index to part is not yet understood, so indices are exported raw.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshparse

S = 2048
d = open(sys.argv[1], 'rb').read()
sector = int(sys.argv[3])
pack = next(p for p in json.load(open(sys.argv[2])) if p['sector'] == sector)
n = pack['n']
base = sector * S + 4 + 4 * n
offs = [b['off'] for b in pack['blobs']]
ends = offs[1:] + [min(offs[-1] + 0x10000, len(d) - base)]
parts = []
for i in range(n):
    r = meshparse.parse_part(d[base + offs[i]:base + ends[i]])
    if r and r['faces']:
        parts.append({'index': i, 'verts': r['verts'], 'normals': r['normals'],
                      'faces': [{'id': f['id'][0], 'uv': f['uv'], 'v': f['v']} for f in r['faces']]})
json.dump({'sector': sector, 'parts': parts}, open(sys.argv[4], 'w'), separators=(',', ':'))
print('parts:', len(parts))
