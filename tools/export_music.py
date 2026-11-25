#!/usr/bin/env python3
"""Export the real music track of every area to public/assets/music/areas.json.

Found in Blaze.exe (PROGRESS.md, Step BI): the script op 8 handler (0x515610) copies byte 0 of the selected entry of the area module's header slot 25
(24-byte entries, 2-8 per area) to the "current music" byte (0x5de514) and calls the play routine 0x529ad0, which indexes the 40-entry pointer table
at VA 0x566cb8 (24-byte name records `@//Music/<name>.WAV` at 0x5680c8..0x568430). Script opcode 34 (handler 0x515ed0) plays a track given in its operand.
Script ops (lengths read from the handler returns, table at VA 0x563290; a script = ops up to 0xff, pointers in header slot 31) include op 34 `22 <track>`:
the boss-fight scripts start the boss theme with it (`22 18` = Bos01_01, `22 27` = Bos99_01 = mid-boss theme ...) and a later script restores the area theme.
Output: { "<quest>_<area>": {"main": "mel01_01", "boss": "bos01_01" or "", "all": [names of the slot-25 entries], "alt": first melody an op 34 sets, "ops": [track names of op 34 in script order]} }
"""
import json, os, re, struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
S = 2048
exec(open(os.path.join(HERE, 'export_doors.py')).read().split('\ndef main')[0].split('import json, os, re, struct, sys')[1])  # SPEC + chain()


def track_names():
    d = open(os.path.join(ROOT, 'original/bin/Blaze.exe'), 'rb').read()
    off = lambda va: va - 0x54f000 + 0x14d600
    rec = {}
    for m in re.finditer(rb'@//Music/([A-Za-z0-9_]+)\.WAV', d):
        rec[0x54f000 + m.start() - 0x14d600] = m.group(1).decode().lower()
    out = []
    for k in range(40):
        v = struct.unpack_from('<I', d, off(0x566cb8 + 4 * k))[0]
        out.append(rec.get(v, rec.get(v + 1, '')))
    return out


LEN = {0: 4, 1: 3, 2: 3, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 6, 9: 6, 10: 7, 11: 3, 12: 2, 13: 5, 14: 2, 15: 2, 16: 4, 17: 4, 18: 2, 19: 1, 20: 6, 21: 6, 22: 4,
       23: 2, 24: 2, 25: 2, 26: 2, 27: 2, 28: 4, 29: 4, 30: 2, 31: 3, 32: 1, 33: 1, 34: 2, 35: 2, 36: 2, 37: 1, 38: 4}


def music_ops(m):
    """Track numbers of every op 34 in the area's scripts (in script order)."""
    out = []
    for _, t in chain(m, 31):
        p = t
        while p < len(m) and m[p] != 0xff and m[p] in LEN:
            if m[p] == 34 and p + 1 < len(m): out.append(m[p + 1])
            p += LEN[m[p]]
    return out


def main():
    names = track_names()
    f = open(os.path.join(ROOT, 'original', 'BLAZE.ALL'), 'rb')
    f.seek(0x1210 * S)
    g3 = f.read(0x4404)
    quest_mods = [struct.unpack_from('<II', g3, v) for _, v in chain(g3, 14)][:11]
    out = {}
    for qi, (sec, size) in enumerate(quest_mods):
        f.seek(sec * S)
        d = f.read(size)
        lst = [struct.unpack_from('<II', d, v) for _, v in chain(d, 14)]
        for a, (s2, z2) in enumerate(lst[:{0: 6}.get(qi, len(lst))]):
            f.seek(s2 * S)
            m = f.read(z2)
            nm = lambda i: names[i] if i < len(names) else ''
            ent = [nm(m[v]) for _, v in chain(m, 25)]
            ops = [nm(i) for i in music_ops(m)]
            main_t = next((n for n in ent if n.startswith('mel')), ent[0] if ent else '')
            boss = next((n for n in ops + ent if n.startswith('bos')), '')
            out['%d_%d' % (qi, a)] = {'main': main_t, 'boss': boss, 'alt': next((n for n in ops if n.startswith('mel')), ''), 'all': ent, 'ops': ops}
    json.dump(out, open(os.path.join(ROOT, 'public/assets/music/areas.json'), 'w'), separators=(',', ':'))
    print('wrote', len(out), 'areas;', 'tracks:', sorted({t for v in out.values() for t in v['all'] + v['ops']}))


main()
