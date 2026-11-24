#!/usr/bin/env python3
"""Export the real door destinations of every stage to public/assets/stages/doors.json.

How it was found (see PROGRESS.md, steps AN/AO):
  * SYSTEM.INI (ENGLISH/SYSTEM.INI, supplied from the ISO) is a module; its group-3 module (sector 0x1210) lists the 11 per-quest modules
    (sectors 4057.. in BLAZE.ALL, slot +0x48), and each per-quest module lists its area modules as (sector, size) pairs (slot +0x48).
  * Every area module has a script pointer array (header slot +0x8c, 4-byte entries relocated by the module's second base) whose scripts
    are command streams ending in 0xff; opcode 17 = `11 group area arrival`, group 0xff = same quest. Door scripts have the form
    `03 02 2d 01 11 gg aa ii ff`, in script-id order.
Output: { "<stage>": [ {"quest": q, "area": a, "arrival": i, "stage": dest stage or null} ... ] }
"""
import json, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
S = 2048
SPEC = [(0, 8), (1, 8), (2, 8), (3, 8), (4, 8), (5, 8), (6, 8), (7, 8), (8, 4), (9, 4), (10, 4), (11, 20), (14, 4), (16, 4), (17, 4), (20, 4), (21, 8), (23, 4),
        (24, 4), (25, 4), (27, 4), (28, 4), (29, 8), (30, 4), (31, 4), (33, 4), (35, 4), (37, 4), (38, 4), (39, 8), (40, 4), (42, 4)]  # table at VA 0x56ac90 of Blaze.exe


def chain(d, slot):
    """Pointer chain of a module header slot: [(file offset of the word, relocated value)]."""
    a = struct.unpack_from('<I', d, 0)[0]
    b = a + struct.unpack_from('<I', d, 4)[0]
    stride = dict(SPEC)[slot]
    p = a + struct.unpack_from('<I', d, 0x10 + 4 * slot)[0]
    out = []
    while p + 4 <= len(d) and struct.unpack_from('<I', d, p)[0] != 0:
        out.append((p, struct.unpack_from('<I', d, p)[0] + b))
        n = p + stride
        if n + 4 > len(d) or struct.unpack_from('<I', d, n)[0] == 0: break
        p = n
    return out


def main():
    f = open(os.path.join(ROOT, 'original', 'BLAZE.ALL'), 'rb')
    f.seek(0x1210 * S)
    g3 = f.read(0x4404)                                   # group-3 module of SYSTEM.INI's group table
    quest_mods = [struct.unpack_from('<II', g3, v) for _, v in chain(g3, 14)][:11]
    stage_json = [json.load(open(os.path.join(ROOT, 'public/assets/stages/stage%02d.json' % i))) for i in range(78)]
    first, nst = {}, {}
    for i, j in enumerate(stage_json):
        first.setdefault(j['quest'], i)
        nst[j['quest']] = nst.get(j['quest'], 0) + 1
    areas = {}
    for qi, (sec, size) in enumerate(quest_mods):
        f.seek(sec * S)
        d = f.read(size)
        n = {0: 6, 2: 1}.get(qi)                          # quest 0 lists its inn + 5 rooms; the pair list continues with other data
        lst = [struct.unpack_from('<II', d, v) for _, v in chain(d, 14)]
        # the list is the area modules; its length is the area count (quest 0: more words follow, cut at 6)
        count = {0: 6}.get(qi, len(lst))
        for a, (s2, z2) in enumerate(lst[:count]):
            f.seek(s2 * S)
            areas[(qi, a)] = f.read(z2)
    pat = re.compile(rb'\x03\x02\x2d\x01\x11([\x00-\x0a\xff])([\x00-\x1f\xff])([\x00-\x1f\xff])\xff')
    out, arr = {}, {}
    for (qi, a), m in sorted(areas.items()):
        if qi not in first or a >= nst[qi]: continue
        st = first[qi] + a
        ex = []
        for mm in pat.finditer(m):
            g, ar, ai = mm.group(1)[0], mm.group(2)[0], mm.group(3)[0]
            dq = qi if g == 0xff else g
            dst = first[dq] + ar if dq in first and ar < nst[dq] else None
            ex.append({'quest': dq, 'area': ar, 'arrival': ai, 'stage': dst})
        out[str(st)] = ex
        # arrival table (header word +0x40 -> 32-byte records `i16 flag, tag, x, y, z, 0, rot, 0, id, ...`), indexed by the arrival byte of the door script
        A = struct.unpack_from('<I', m, 0)[0]
        o = A + struct.unpack_from('<I', m, 0x40)[0]
        recs = []
        while o + 32 <= len(m):
            r = struct.unpack_from('<16h', m, o)
            if not (0 <= r[0] < 64 and 0 < r[1] < 1000 and r[5] == 0 and r[7] == 0 and r[10] == -1): break
            recs.append({'x': r[2], 'y': r[3], 'z': r[4], 'rot': r[6], 'id': r[8]})
            o += 32
        arr[str(st)] = recs
    path = os.path.join(ROOT, 'public/assets/stages/doors.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    json.dump(arr, open(os.path.join(ROOT, 'public/assets/stages/arrivals.json'), 'w'), separators=(',', ':'))
    print('wrote', path, sum(len(v) for v in out.values()), 'door scripts in', len(out), 'stages')


main()
