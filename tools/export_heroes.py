#!/usr/bin/env python3
"""Export the 16 hero models (mesh pack + all animation blobs) to public/assets/heroes/hero<k>.json.

usage: export_heroes.py <BLAZE.ALL> <packs.json> <resource_table.json> <out dir>
JSON: {hero, textureSector, parts:[{index, verts, faces:[{uv, v}]}], anims:[{parent, partBone, poses, frames}]}
Normals are not exported (the viewer is unlit PS1 style for now).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshparse, assemble

S = 2048
d = open(sys.argv[1], 'rb').read()
packs = {p['sector']: p for p in json.load(open(sys.argv[2]))}
rt = json.load(open(sys.argv[3]))
os.makedirs(sys.argv[4], exist_ok=True)
total = 0
for k in range(16):
    mp, ap = packs[rt['hero_mesh_packs'][k]], packs[rt['hero_anim_packs'][k]]
    base = mp['sector'] * S + 4 + 4 * mp['n']
    offs = [b['off'] for b in mp['blobs']]
    nxt = min([q['sector'] for q in packs.values() if q['sector'] > mp['sector']] or [len(d) // S])
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
    out = {'hero': k, 'textureSector': rt['hero_textures'][k], 'parts': parts, 'anims': anims}
    path = os.path.join(sys.argv[4], f'hero{k:02d}.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    total += os.path.getsize(path)
    print(k, 'parts', len(parts), '/', mp['n'], 'anims', len(anims), os.path.getsize(path) // 1024, 'KB')
print('total KB', total // 1024)
