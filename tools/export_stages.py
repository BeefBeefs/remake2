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
    if not (w[8] == 64 and V > 0 and w[9] == 64 + 8 * V and w[10] == w[9] + 8 * N): return None
    # w[2] low half normally repeats V; 16 textured records (e.g. the inn's walls, sectors 5047/5054) have a smaller number there. Accept those only
    # when the face rows tile the record exactly (w[13] = end of the 32-byte rows), so no collision record or junk slips in.
    strict = (w[2] & 0xffff) == V
    if not strict and not (w[12] == 0 and w[13] > w[10] and (w[13] - w[10]) == 32 * F): return None
    verts = [list(struct.unpack_from('<3h', d, o + 64 + 8 * i)) for i in range(V)]
    tex = w[12] == 0 and w[13] > w[10]
    # 17 stages (17-19, 30, 34, 36, 42-45, 48, 49, 66, 77, 79, 81, 82) start with a record whose w[13] is 0 but whose rows are valid 32-byte
    # textured rows: that record is the stage's visible mesh AND its walkable floor (no separate collision record).
    both = False
    if not tex and w[12] == 0 and w[13] == 0 and F > 0:
        both = all(d[o + w[10] + 32 * i + 31] in (0x24, 0x25, 0x26, 0x27, 0x2c, 0x2d, 0x2e, 0x2f, 0x34, 0x35, 0x36, 0x37, 0x3c, 0x3d, 0x3e, 0x3f)
                   for i in range(min(F, 8)))
        tex = both
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
        return {'sector': s, 'verts': verts, 'faces': faces, 'both': both}
    tris = []
    for i in range(F):
        b = o + w[10] + 16 * i
        t4 = list(struct.unpack_from('<4H', d, b))
        t4[3] = d[b + 15]   # 4th slot (was always 0): row byte 15 = floor-warp value (the player handler re-enters the area at arrival value-1)
        tris.append(t4)
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
    elif r.get('both'):
        # headerless textured record: either an extra mesh of the stage whose descriptor lists it (merged below) or, if nothing owns
        # it, a stage of its own whose walkable floor is its own faces.
        tris = []
        for f in r['faces']:
            v = f['v']
            if v[2] != v[3]: tris.append([v[0], v[1], v[2], 0]); tris.append([v[0], v[2], v[3], 0])
            else: tris.append([v[0], v[1], v[2], 0])
        cur = {'collision': {'sector': s, 'verts': r['verts'], 'tris': tris}, 'meshes': [r], 'headerless': True}; stages.append(cur)
    elif cur is not None:
        cur['meshes'].append(r)
import bisect
# Stage resource descriptors: ... (sector,size) texture pairs | sentinel word 1601110016, x | (sector,size) mesh pairs ...
# The first mesh pair is the stage's collision record (col16 'tris' record), the rest are its meshes, prop/monster packs etc.
words = struct.unpack('<%dI' % (len(d) // 4), d[:len(d) // 4 * 4])
SENT = 1601110016
descs = []          # (word index, [(sector, size)] textures, [(sector, size)] meshes)
for i, v in enumerate(words):
    if v != SENT: continue
    p, tl = i - 1, []
    while p >= 1 and 0 < words[p - 1] < 22600 and 1000 < words[p] < 100000: tl.append([words[p - 1], words[p]]); p -= 2
    ms = []
    for j in (i + 2, i + 4):      # stage 1's descriptor has one junk pair (404226048, 4129024) before the mesh pairs
        while 0 < words[j] < 22600 and 0 < words[j + 1] < 400000: ms.append([words[j], words[j + 1]]); j += 2
        if ms: break
    descs.append((i, tl[::-1], ms))
# 17 "stages" (17-19, 30, 34, 36, 42-45, 48, 49, 66, 77, 79, 81, 82 in the old numbering) are headerless textured records that sit inside
# the mesh list of the PREVIOUS stage's descriptor (same coordinate space): they are extra meshes of that stage, not stages.
merged = 0
for st in list(stages):
    if not st.get('headerless'): continue
    sec = st['collision']['sector']
    own = None
    for i, tl, ms in descs:
        if any(a == sec for a, z in ms) and ms[0][0] != sec:
            own = next((q for q in stages if q is not st and not q.get('headerless') and q['collision']['sector'] == ms[0][0]), None)
            if own: break
    if own is None: continue
    own['meshes'].extend(st['meshes']); own.setdefault('extraMeshes', []).append(sec)
    stages.remove(st); merged += 1
print('merged', merged, 'headerless records into their owning stage')
want = {st['collision']['sector']: st for st in stages}
for i, tl, ms in descs:
    st = want.get(ms[0][0]) if ms else None
    if st is not None and 'texList' not in st: st['texList'] = tl
# Fallback (stage 25): the descriptor has no sentinel word; the texture pairs directly precede the first mesh (= collision) pair.
for st in stages:
    if 'texList' in st: continue
    sec = st['collision']['sector']
    for i, v in enumerate(words):
        if v != sec or not 1000 < words[i + 1] < 400000: continue
        p, tl = i - 1, []
        while p >= 1 and 0 < words[p - 1] < 22600 and 1000 < words[p] < 100000 and len(tl) < 14: tl.append([words[p - 1], words[p]]); p -= 2
        if len(tl) >= 3 and any(z == 33312 for a, z in tl):
            st['texList'] = tl[::-1]; print('texList fallback for stage at sector', sec, st['texList']); break
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
# Stage texts: after the ' - Name -' banner comes a byte stream with dialogue boxes (1f d0 id 0c "Speaker:\r text" 0f), signs and menu strings.
# Printable runs between 0x0f terminators are cleaned (control codes dropped, 0b xx xx xx = item name placeholder) and kept in order.
def clean_text(t):
    t = re.sub(rb'\x0b[\x00-\xff]{3}', b'[item]', t)
    t = re.sub(rb'\x04[\x20-\x7e]\x10', b'', t)
    t = t.replace(b'\r', b'\n')
    head, nl, body = t.partition(b'\n')
    body = re.sub(rb'^(?:[\x00-\x09\x0b-\x1f]|[\x20-\x2f\x3c-\x3f\x5b-\x60](?=[\x00-\x1f\x3c-\x3e\x28]))+', b'', body)
    return re.sub(rb'[^\x20-\x7e\n]', b'', head + nl + body).decode().strip()
for i, v in enumerate(words):
    st = want.get(v)
    if st is None or 'texts' in st: continue
    if not any(words[j] == SENT for j in range(max(0, i - 14), i)): continue
    o = i * 4
    mm = re.search(rb"- ([A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}?) -", d[o:o + 0x6000])
    if not mm: continue
    b0 = o + mm.start() + len(mm.group(0))
    seg = d[b0:b0 + 0x2400]
    nb = re.search(rb"- [A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}? -", seg)
    if nb: seg = seg[:nb.start()]
    texts = []
    for chunk in seg.split(b'\x0f'):
        t = clean_text(re.sub(rb'^.*?\x0c', b'', chunk, count=1, flags=re.S) if b'\x1f\xd0' in chunk else chunk)
        t = re.sub(r'^\S(?=[A-Z][A-Za-z ]{2,20}:\n)', '', t)
        if len(re.findall(r'[A-Za-z]', t)) >= 8 and t not in texts: texts.append(t)
    st['texts'] = texts
# Story-state variants: the inn / rooms (and some other maps) exist several times in the file (descriptors with the same first mesh pair but
# different entity tables / dialogue). Stage JSON keeps the first as the main data and the different ones as `variants` (entities, texts, name, desc).
def parse_variant(i):
    j, mesh = i, []
    while 0 < words[j] < 22600 and 0 < words[j + 1] < 400000: mesh.append(words[j]); j += 2
    o = j * 4
    mm = re.search(rb"- ([A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}?) -", d[o:o + 0x6000])
    end = o + mm.start() if mm else o + 0x1000
    ents = []
    for a in range(o, end - 31, 8):
        w = struct.unpack_from('<16h', d, a)
        if -260 < w[2] < -20 and w[3] == 0 and w[7] == 0 and abs(w[4]) < 12000 and abs(w[6]) < 12000 and -100 <= w[5] <= 800:
            ents.append({'kind': w[0], 'sub': w[1], 'flag': w[2], 'x': w[4], 'y': w[5], 'z': w[6], 'rot': w[8], 'link': w[10]})
    name = None; texts = []
    nm = re.search(rb"- ([A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}?) -", d[o:o + 0x900])
    if nm: name = nm.group(1).decode()
    if mm:
        b0 = o + mm.start() + len(mm.group(0))
        seg = d[b0:b0 + 0x2400]
        nb = re.search(rb"- [A-Z][A-Za-z0-9 ,'\.:!?-]{2,40}? -", seg)
        if nb: seg = seg[:nb.start()]
        for chunk in seg.split(b'\x0f'):
            t = clean_text(re.sub(rb'^.*?\x0c', b'', chunk, count=1, flags=re.S) if b'\x1f\xd0' in chunk else chunk)
            t = re.sub(r'^\S(?=[A-Z][A-Za-z ]{2,20}:\n)', '', t)
            if len(re.findall(r'[A-Za-z]', t)) >= 8 and t not in texts: texts.append(t)
    return {'desc': i * 4 // S, 'name': name, 'entities': ents, 'texts': texts}
for st in stages:
    sec = st['collision']['sector']
    seen = [(json.dumps(st.get('entities')), json.dumps(st.get('texts')))]
    st['variants'] = []
    for i, tl, ms in descs:
        if not ms or ms[0][0] != sec: continue
        v = parse_variant(i + 2 - 0 if False else i)
        key = (json.dumps(v['entities']), json.dumps(v['texts']))
        if key in seen: continue
        seen.append(key); st['variants'].append(v)
# Arrival points: every map module starts (header 256, A, B) with a table part of A bytes that holds small 6-word records
#   u32 type | u32 (y<<16 | x & 0xffff) | u32 z | u32 rot | u32 (0xffff0000 | id) | u32 0xffffffff
# = where the hero appears when entering the map (stage 1: id 118 at x -620, z 500 next to the door; the inn: id 419).
mods = []
for sc in range(n):
    w = struct.unpack_from('<4I', d, sc * S)
    if w[0] == 256 and 0 < w[1] < w[2] < 200000 and w[3] == 0 and w[1] % 4 == 0 and w[2] % 4 == 0 and w[2] >= w[1] + 248: mods.append((sc, w[1]))
mod_sectors = [m[0] for m in mods]
def arrivals_of(desc_sector):
    k = bisect.bisect(mod_sectors, desc_sector) - 1
    if k < 0: return []
    sc, A = mods[k]
    w = struct.unpack_from('<%dI' % ((0x100 + A) // 4), d, sc * S)
    out = []
    for q in range(0x100 // 4 + 4, len(w) - 1):
        if (w[q] >> 16) == 0xffff and w[q + 1] == 0xffffffff:
            y = w[q - 3] >> 16; x = w[q - 3] & 0xffff; z = w[q - 2] & 0xffff; rot = w[q - 1]
            if 0 < y < 1000 and rot < 4096:
                out.append({'id': w[q] & 0xffff, 'x': x - 65536 if x >= 32768 else x, 'y': y, 'z': z - 65536 if z >= 32768 else z, 'rot': rot})
    return out
# Monster definitions: a map module's table part holds a section of 96-byte records (char name[16] NUL padded, then 40 u16: [0] = level, ...).
# Names such as 'Lv20.Goblin' (a stronger variant), 'Goblin-Shaman'. Stats beyond the level are not decoded yet (kept raw).
def monster_defs(desc_sector):
    k = bisect.bisect(mod_sectors, desc_sector) - 1
    if k < 0: return []
    sc, A = mods[k]
    hdr = struct.unpack_from('<64I', d, sc * S)
    tab = d[sc * S + 0x100:sc * S + 0x100 + A]
    for o in sorted(set(x for x in hdr[3:] if 0 < x < A)):
        r, p = [], o
        while p + 96 <= A:
            nm = tab[p:p + 16]; z = nm.split(b'\0')[0]
            if len(z) >= 3 and all(32 <= c < 127 for c in z) and nm[len(z):] == b'\0' * (16 - len(z)) and z[:1].isalpha():
                h = struct.unpack_from('<40H', tab, p + 16); r.append({'name': z.decode(), 'level': h[0], 'raw': list(h)}); p += 96
            else: break
        if len(r) >= 2: return r
    return []
for st in stages:
    sec = st['collision']['sector']
    st['monsterDefs'] = []
    for i, tl, ms in descs:
        if ms and ms[0][0] == sec:
            st['monsterDefs'] = monster_defs(i * 4 // S); break
for st in stages:
    sec = st['collision']['sector']
    st['arrivals'] = []
    for i, tl, ms in descs:
        if ms and ms[0][0] == sec:
            st['arrivals'] = arrivals_of(i * 4 // S); break
# Quests: BLAZE.ALL has 11 groups of map descriptors that match the sound banks Q00 (1) Q01 (10) Q02 (1) Q03 (10) Q04 (11) Q05 (10) Q06 (12) Q07 (3) Q08 (2) Q09 (2) Q10 (16):
# one bank per area, areas of a quest are consecutive. Descriptor sector ranges of the groups:
QUEST_SECTORS = [0, 7900, 8200, 10500, 13000, 15200, 18400, 18900, 19300, 19700, 22400]
for st in stages:
    ds = next((i * 4 // S for i, tl, ms in descs if ms and ms[0][0] == st['collision']['sector']), None)
    st['quest'] = bisect.bisect(QUEST_SECTORS, ds if ds is not None else st['collision']['sector']) - 1 if ds is not None else -1
for a, b in zip(stages, stages[1:]):
    if b['quest'] == -1: b['quest'] = a['quest']      # stage 25's descriptor has another layout: it sits between its neighbours
areas = {}
for st in stages:
    st['area'] = areas.get(st['quest'], 0); areas[st['quest']] = st['area'] + 1
qfirst = {}
for k, st in enumerate(stages): qfirst.setdefault(st['quest'], [k, k]); qfirst[st['quest']][1] = k
for st in stages: st['questRange'] = qfirst[st['quest']]
# monsters a stage streams in = monster textures in its texture list (model table entries 16..112 -> monster 0..96)
mtab = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'model_table.json')))
mon_by_tex = {sec: k - 16 for k, (sec, _) in enumerate(mtab['textures']) if k >= 16}
for st in stages:
    st['monsters'] = [mon_by_tex[a] for a, z in st.get('texList', []) if a in mon_by_tex]
# Monster model id -> definition. A stage lists the monster models it streams in (`monsters`) and has a list of definitions (`monsterDefs`) but the
# link between them is not stored (found), so it is solved: a model's name must be in every stage that lists it, and two models of one stage differ.
# Per-stage ground choice (texture-list position, palette) where the default guess is clearly wrong. Stage 72 (volcano): the default picked the
# metal-panel sheet; atlas 255 (position 0) with palette 12 gives a brown volcanic rock floor (checked by render).
GROUND_OVERRIDE = {72: (0, 12)}
def base_name(n): return n.split('.', 1)[1] if n.startswith('Lv') and '.' in n else n
cand = {}
for st in stages:
    names = {base_name(m['name']) for m in st['monsterDefs']}
    if not names: continue
    for mid in st['monsters']: cand[mid] = (cand[mid] & names) if mid in cand else set(names)
changed = True
while changed:
    changed = False
    for st in stages:
        solved = {next(iter(cand[m])) for m in st['monsters'] if m in cand and len(cand[m]) == 1}
        for m in st['monsters']:
            if m in cand and len(cand[m]) > 1 and cand[m] - solved != cand[m]: cand[m] = cand[m] - solved; changed = True
# A stage's streamed model list follows the order of its definition list (41 of 42 solved pairs agree): enumerate the in-order assignments
# that fit every model's candidate names and keep, per model, only the names that occur in some valid assignment. Repeat to a fixpoint.
import itertools
def order_pass():
    ch = False
    for st in stages:
        names = []
        for m in st['monsterDefs']:
            b = base_name(m['name'])
            if b not in names: names.append(b)
        mons = [m for m in st['monsters']]
        if not names or not mons or len(mons) > len(names) or any(m not in cand for m in mons): continue
        seen = [set() for _ in mons]
        for combo in itertools.combinations(range(len(names)), len(mons)):
            if all(names[c] in cand[m] for c, m in zip(combo, mons)):
                for k, c in enumerate(combo): seen[k].add(names[c])
        if not seen[0]: continue
        for m, sn in zip(mons, seen):
            if sn != cand[m] and sn <= cand[m]: cand[m] = sn; ch = True
    return ch
while True:
    c1 = order_pass(); changed = False
    for st in stages:
        solved = {next(iter(cand[m])) for m in st['monsters'] if m in cand and len(cand[m]) == 1}
        for m in st['monsters']:
            if m in cand and len(cand[m]) > 1 and cand[m] - solved != cand[m]: cand[m] = cand[m] - solved; changed = True
    if not (c1 or changed): break
model_name = {m: next(iter(c)) for m, c in cand.items() if len(c) == 1}
# Fallback by majority vote for models the strict 'name in every stage' rule leaves open (a stage may stream a model its definition list does not
# name): take the name that appears in at least 80% of >= 5 stages listing the model (model 17 -> Gargoyle 5/6, 30 -> Lesser-Vampire 4/5).
import collections
_sup = collections.defaultdict(collections.Counter); _tot = collections.Counter()
for st in stages:
    nm = {base_name(m['name']) for m in st['monsterDefs']}
    if not nm: continue
    for mid in st['monsters']:
        _tot[mid] += 1
        for n in nm: _sup[mid][n] += 1
for mid, t in _tot.items():
    if mid in model_name or t < 5: continue
    (n1, c1), = _sup[mid].most_common(1)
    if c1 * 5 >= t * 4 and sum(1 for v in _sup[mid].values() if v == c1) == 1: model_name[mid] = n1
for st in stages:
    info = []
    for mid in st['monsters']:
        e = {'model': mid, 'name': model_name.get(mid)}
        defs = [m for m in st['monsterDefs'] if base_name(m['name']) == e['name']]
        if defs:
            df = next((m for m in defs if m['name'] == e['name']), defs[0])   # prefer the plain (non 'LvN.') variant
            e.update({'level': df['level'], 'hp': df['raw'][2], 'attack': df['raw'][16]})
        info.append(e)
    st['monsterInfo'] = info
atlas_index = {s: k for k, s in enumerate(atl)}
# 8-bit pages (mode 9, 256-entry CLUT at +0x14, w/h halfword pair at +540, pixels at +544): exported as bSECTOR.png (RGBA, colour index 0 with
# a zero CLUT entry transparent). Faces of a few stages (17, 23, 49, 72 ...) point at them through `pg` = position in the full texture list.
def export_page8(sec):
    o = sec * S
    if struct.unpack_from('<III', d, o)[0:3] != (16, 9, 524): return None
    A, B = struct.unpack_from('<HH', d, o + 540)
    w, h = 2 * A, B
    if not (0 < w <= 256 and 0 < h <= 256) or o + 544 + w * h > len(d): return None
    pal = struct.unpack_from('<256H', d, o + 0x14)
    im = Image.new('RGBA', (w, h)); pp = im.load(); raw = d[o + 544:o + 544 + w * h]
    for i, b in enumerate(raw):
        v = pal[b]
        pp[i % w, i // w] = (0, 0, 0, 0) if v == 0 else ((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255)
    im.save(os.path.join(out, f'b{sec}.png'))
    return f'b{sec}'
page8 = {}
total = 0
for k, st in enumerate(stages):
    i = bisect.bisect(atl, st['collision']['sector']) - 1
    st['atlas'] = max(0, i - 1)        # guess: the 128x256 atlas before the last one preceding the stage
    st['id'] = k
    st['atlases'] = [atlas_index[a] for a, z in st.get('texList', []) if z == 33312 and a in atlas_index]
    if st['atlases']:
        # default = the listed atlas with the most distinct colours (blank/flat pages are dynamic or unused ones)
        st['atlas'] = max(st['atlases'], key=lambda a: richness[a])
    pages = []
    for a, z in st.get('texList') or []:
        if z == 33312 and a in atlas_index: pages.append(atlas_index[a])
        else:
            if a not in page8: page8[a] = export_page8(a)
            pages.append(page8[a])
    st['pages'] = pages
    # Ground planes (one big tile, UV 0..127 square, texpage word 0 or pg 131 with palette 0): palette 0 of every atlas is a run-time palette
    # (random colours in the file), so the colours are unknown. GUESS: the atlas after the first one, palette 3 (the common grass/ground tile).
    nat = max(1, len(st['atlases']))
    pos4 = [i for i, p in enumerate(st['pages']) if isinstance(p, int)]   # texture-list positions that are 4-bit atlases
    fixed = 0
    gpg, gcl = GROUND_OVERRIDE.get(k, (pos4[1] if len(pos4) > 1 else (pos4[0] if pos4 else 0), 3))
    for m in st['meshes']:
        for f in m['faces']:
            if f['clut'] == 0 and max(max(u, v) for u, v in f['uv']) >= 100 and (f['tp'] == 0 or (f['pg'] & 31) == 3 and f['pg'] >= 128):
                f['pg'] = gpg; f['clut'] = gcl; fixed += 1
    st['groundGuess'] = fixed
    p = os.path.join(out, f'stage{k:02d}.json')
    json.dump(st, open(p, 'w'), separators=(',', ':')); total += os.path.getsize(p)
json.dump({'atlasSectors': atl, 'stages': [{'sector': s['collision']['sector'], 'meshes': len(s['meshes']), 'atlas': s['atlas'], 'atlases': s['atlases'], 'texList': s.get('texList'), 'name': s.get('name')} for s in stages]},
          open(os.path.join(out, 'index.json'), 'w'))
print(len(atl), 'atlases,', len(stages), 'stages, json KB', total // 1024)
