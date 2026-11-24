#!/usr/bin/env python3
"""Export an animated model (mesh pack + animation blob) to JSON for the three.js viewer.

usage: export_model.py <BLAZE.ALL> <packs.json> <mesh pack sector> <anim pack sector> <anim blob index> <out.json>
Output: parts (verts/normals/faces, with bone index), bones (parent), poses (rot/trans), frames (pose index per bone).
Pose = i16 rot[3] (4096 = 360 deg, matrix order X*Y*Z), trans[3]; relative to parent bone.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshparse, assemble

S = 2048
d = open(sys.argv[1], 'rb').read()
packs = {p['sector']: p for p in json.load(open(sys.argv[2]))}
mp, ap = packs[int(sys.argv[3])], packs[int(sys.argv[4])]
anim = assemble.load_anim(d, ap, int(sys.argv[5]))
base = mp['sector'] * S + 4 + 4 * mp['n']
offs = [b['off'] for b in mp['blobs']]
nxt = min([q['sector'] for q in packs.values() if q['sector'] > mp['sector']] or [len(d) // S])
ends = offs[1:] + [nxt * S - base]   # last blob ends where the next pack starts
parts = []
for i in range(mp['n']):
    r = meshparse.parse_part(d[base + offs[i]:base + ends[i]])
    if r and r['faces'] and i < len(anim['part_bone']):
        parts.append({'index': i, 'bone': anim['part_bone'][i], 'verts': r['verts'], 'normals': r['normals'],
                      'faces': [{'id': f['id'][0], 'uv': f['uv'], 'v': f['v']} for f in r['faces']]})
out = {'meshSector': mp['sector'], 'animSector': ap['sector'], 'parts': parts, 'parent': anim['parent'],
       'poses': [list(p) for p in anim['poses']], 'frames': anim['frames']}
json.dump(out, open(sys.argv[6], 'w'), separators=(',', ':'))
print('parts', len(parts), 'bones', anim['B'], 'frames', anim['D'], 'poses', len(anim['poses']))
