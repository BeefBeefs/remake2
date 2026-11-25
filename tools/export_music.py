#!/usr/bin/env python3
"""Export the real music track of every area to public/assets/music/areas.json.

Found in Blaze.exe (PROGRESS.md, Step BI): the script op 8 handler (0x515610) copies byte 0 of the selected entry of the area module's header slot 25
(24-byte entries, 2-8 per area) to the "current music" byte (0x5de514) and calls the play routine 0x529ad0, which indexes the 40-entry pointer table
at VA 0x566cb8 (24-byte name records `@//Music/<name>.WAV` at 0x5680c8..0x568430). Script opcode 34 (handler 0x515ed0) plays a track given in its operand.
Output: { "<quest>_<area>": ["mel01_01", "bos01_01", ...] }  (one name per entry, lowercase like the converted files)
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
            out['%d_%d' % (qi, a)] = [names[m[v]] if m[v] < len(names) else '' for _, v in chain(m, 25)]
    json.dump(out, open(os.path.join(ROOT, 'public/assets/music/areas.json'), 'w'), separators=(',', ':'))
    print('wrote', len(out), 'areas;', 'tracks:', sorted({t for v in out.values() for t in v}))


main()
