#!/usr/bin/env python3
"""Export the 96 stages: room meshes (textured, 32-byte face rows) + collision meshes (16-byte triangle rows) and all
128x256 tile atlases. Room-mesh records are found by scanning every sector for the header signature
(u32[8]==0x40, u32[9]==0x40+8V, u32[10]==u32[9]+8N, u16[4]==V); a 'col16' record (no UV rows, u32[12]!=0) starts a stage and
the textured records that follow belong to it. See docs/FORMATS.md "Room meshes".
usage: export_stages.py <BLAZE.ALL> <out dir>
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshparse
from PIL import Image
S = 2048
d = open(sys.argv[1], 'rb').read()
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
for f in os.listdir(out): os.remove(os.path.join(out, f))
n = len(d) // S

def record(s):
    o = s * S
    w = struct.unpack_from('<16I', d, o)
    V, N, F = w[0] & 0xffff, w[0] >> 16, w[1] & 0xffff
    if not (w[8] == 64 and V > 0 and w[9] == 64 + 8 * V and w[10] == w[9] + 8 * N and (w[2] & 0xffff) == V): return None
    verts = [list(struct.unpack_from('<3h', d, o + 64 + 8 * i)) for i in range(V)]
    tex = w[12] == 0 and w[13] > w[10]
    if tex:
        faces = []
        for i in range(F):
            b = o + w[10] + 32 * i
            v4 = list(struct.unpack_from('<4H', d, b))
            cmd = struct.unpack_from('<I', d, b + 28)[0] >> 24
            # the last byte of each face row is the PS1 GPU command: 0x24-0x27 / 0x34-0x37 = triangle, 0x2c-0x2f / 0x3c-0x3f = quad
            # (bit 1 = semi-transparent, bit 0 = raw texture). A triangle's 4th vertex slot is padded with 0 -> repeat the 3rd.
            if (cmd & 0xc) == 4: v4[3] = v4[2]
            attr = struct.unpack_from('<I', d, b + 28)[0]
            pg = (attr >> 16) & 0xff
            faces.append({'cmd': cmd, 'pg': pg, 'clut': (attr >> 4) & 15, 'tp': attr & 0xffff, 'v': v4, 'uv': [[d[b + 16 + 2 * k], d[b + 17 + 2 * k]] for k in range(4)]})
        return {'sector': s, 'verts': verts, 'faces': faces}
    tris = []
    for i in range(F):
        b = o + w[10] + 16 * i
        tris.append(list(struct.unpack_from('<4H', d, b)))
    return {'sector': s, 'verts': verts, 'tris': tris}

# atlases: TIM-style records, mode 8 = 4-bit with a 16x16 CLUT (16 palettes of 16 colours), pixel header w=64 halfwords -> 256 px wide, 256 high.
# Each face picks its palette through bits 4-7 of its attr word. Exported as aNNN.png (256x256 greyscale, value = colour index) +
# aNNN.pal.png (16 wide x 16 rows RGBA, colour 0 transparent); the viewer composes the coloured page for the cluts a stage uses.
atl = []
for s in range(n):
    o = s * S
    if struct.unpack_from('<II', d, o)[0] == 16 and struct.unpack_from('<I', d, o + 4)[0] in (8, 9) and struct.unpack_from('<I', d, o + 8)[0] == 524:
        A, B = struct.unpack_from('<HH', d, o + 524 + 16)
        if (2 * A, B) == (128, 256) and struct.unpack_from('<I', d, o + 4)[0] == 8: atl.append(s)
richness = []
for k, s in enumerate(atl):
    o = s * S; P = o + 524 + 8
    raw = d[P + 12:P + 12 + 128 * 256]
    idx = bytearray(256 * 256)
    for i, byte in enumerate(raw):
        idx[2 * i] = byte & 15; idx[2 * i + 1] = byte >> 4
    Image.frombytes('L', (256, 256), bytes(idx)).save(os.path.join(out, f'a{k:03d}.png'))
    pal = Image.new('RGBA', (16, 16)); pp = pal.load()
    for r in range(16):
        for c in range(16):
            v = struct.unpack_from('<H', d, o + 0x14 + 2 * (r * 16 + c))[0]
            pp[c, r] = (0, 0, 0, 0) if v == 0 else ((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255)
    pal.save(os.path.join(out, f'a{k:03d}.pal.png'))
    richness.append(len(set(idx)) * 1000 + len(set(raw)))

stages, cur = [], None
for s in range(n):
    r = record(s)
    if r is None: continue
    if 'tris' in r:
        cur = {'collision': r, 'meshes': []}; stages.append(cur)
    elif cur is not None:
        cur['meshes'].append(r)
import bisect
# Stage resource descriptors: ... (sector,size) texture pairs | sentinel word 1601110016, x | (sector,size) mesh pairs ...
# The first mesh pair is the stage's collision record, so find that sector as a u32 and walk back to the sentinel.
words = struct.unpack('<%dI' % (len(d) // 4), d[:len(d) // 4 * 4])
SENT = 1601110016
want = {st['collision']['sector']: st for st in stages}
for i, v in enumerate(words):
    st = want.get(v)
    if st is None or 'texList' in st: continue
    for j in range(i - 1, max(0, i - 12), -1):
        if words[j] == SENT:
            p, tl = j - 1, []
            while p >= 1 and 0 < words[p - 1] < 22600 and 1000 < words[p] < 60000: tl.append([words[p - 1], words[p]]); p -= 2
            st['texList'] = tl[::-1]
            break
# Stage names: a ' - Name -' string (Pascal-style, preceded by a length byte) sits within ~0x900 bytes after the descriptor
import re
for i, v in enumerate(words):
    st = want.get(v)
    if st is None or st.get('name'): continue
    m = re.search(rb"- ([A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}?) -", d[i * 4:i * 4 + 0x900])
    if m: st['name'] = m.group(1).decode()
# Entity table (room-type stages only): right after the descriptor's mesh pairs come 32-byte records
#   i16 kind, sub, flag(-254|130|-126), 0 | x, y(up, floor=400 or 100), z, 0 | rot (4096=360deg), 0, link, -1 | -1, -1, 0, 0
# kind = index of a prop mesh in the stage's props pack for ordinary records (the first two records are the door/trigger).
packs = {p['sector']: p for p in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'packs.json')))}
props_out = {}
for i, v in enumerate(words):
    st = want.get(v)
    if st is None or 'entities' in st: continue
    if not any(words[j] == SENT for j in range(max(0, i - 14), i)): continue
    j, mesh = i, []
    while 0 < words[j] < 22600 and 0 < words[j + 1] < 400000: mesh.append(words[j]); j += 2
    o = j * 4
    mm = re.search(rb"- ([A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}?) -", d[o:o + 0x6000])
    end = o + mm.start() if mm else o + 0x1000
    # Cells are 8-byte aligned: (kind, sub, flag, 0, x, y, z, 0) inside 32-byte records (rot/link follow in the next 16 bytes).
    # Rooms use flag -254 (props) / -126; dungeons -255 / -127 / -126 / -30 (spawn-like records).
    ents = []
    for a in range(o, end - 31, 8):
        w = struct.unpack_from('<16h', d, a)
        if -260 < w[2] < -20 and w[3] == 0 and w[7] == 0 and abs(w[4]) < 12000 and abs(w[6]) < 12000 and -100 <= w[5] <= 800:
            ents.append({'kind': w[0], 'sub': w[1], 'flag': w[2], 'x': w[4], 'y': w[5], 'z': w[6], 'rot': w[8], 'link': w[10]})
    st['entities'] = ents
    st['propsSector'] = None
    if ents:
        for sec in mesh:
            if sec in packs and packs[sec]['n'] >= 15: st['propsSector'] = sec; break
        if st['propsSector'] and st['propsSector'] not in props_out:
            sec = st['propsSector']; pk = packs[sec]
            base = sec * S + 4 + 4 * pk['n']; offs = [b['off'] for b in pk['blobs']]
            nxt = min([q for q in packs if q > sec] or [len(d) // S])
            pp = meshparse.parse_pack(d, base, offs, offs[1:] + [nxt * S - base])
            meshparse.recover_bad_rows(pp)
            props_out[sec] = {str(ix2): {'verts': r['verts'], 'faces': [{'v': list(f['v']), 'uv': [list(c) for c in f['uv']]} for f in r['faces'] + r['extra']]}
                              for ix2, r in sorted(pp.items()) if r['faces']}
for sec, pr in props_out.items():
    json.dump(pr, open(os.path.join(out, f'props{sec}.json'), 'w'), separators=(',', ':'))
# monsters a stage streams in = monster textures in its texture list (model table entries 16..112 -> monster 0..96)
mtab = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'model_table.json')))
mon_by_tex = {sec: k - 16 for k, (sec, _) in enumerate(mtab['textures']) if k >= 16}
for st in stages:
    st['monsters'] = [mon_by_tex[a] for a, z in st.get('texList', []) if a in mon_by_tex]
atlas_index = {s: k for k, s in enumerate(atl)}
total = 0
for k, st in enumerate(stages):
    i = bisect.bisect(atl, st['collision']['sector']) - 1
    st['atlas'] = max(0, i - 1)        # guess: the 128x256 atlas before the last one preceding the stage
    st['id'] = k
    st['atlases'] = [atlas_index[a] for a, z in st.get('texList', []) if z == 33312 and a in atlas_index]
    if st['atlases']:
        # default = the listed atlas with the most distinct colours (blank/flat pages are dynamic or unused ones)
        st['atlas'] = max(st['atlases'], key=lambda a: richness[a])
    p = os.path.join(out, f'stage{k:02d}.json')
    json.dump(st, open(p, 'w'), separators=(',', ':')); total += os.path.getsize(p)
json.dump({'atlasSectors': atl, 'stages': [{'sector': s['collision']['sector'], 'meshes': len(s['meshes']), 'atlas': s['atlas'], 'atlases': s['atlases'], 'texList': s.get('texList'), 'name': s.get('name')} for s in stages]},
          open(os.path.join(out, 'index.json'), 'w'))
print(len(atl), 'atlases,', len(stages), 'stages, json KB', total // 1024)
