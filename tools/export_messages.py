#!/usr/bin/env python3
"""Export every stage's message table (area module header slot 24, 72-111 entries) to public/assets/stages/messages.json as {stageIndex: [text or ""]}.

An entity's `link` (low 7 bits) indexes this table (script op 14 `0e nn` = show message nn; checked on the inn: NPC links 59-61 are "...I need more
information...", 41 "Do you know any good tales of adventure?"). Entry text = the first printable string (>= 3 letters) after the entry's offset; the
per-hero variants of one remark are consecutive entries. Stage index = first[quest] + area (areas beyond the quest's stage count have no stage).
"""
import json, os, re, struct
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
exec(open(os.path.join(HERE, 'export_doors.py')).read().split('\ndef main')[0].split('import json, os, re, struct, sys')[1])  # SPEC + chain()
S = 2048
AREAS = [6, 10, 1, 10, 11, 10, 12, 3, 2, 2, 16]


def text(m, v):
    for part in m[v:v + 400].split(b'\x00'):
        s = re.sub(rb'[^\x20-\x7e\r\n]', b'', part).decode().strip('*').strip()
        if len(re.findall(r'[A-Za-z]', s)) >= 3: return s
    return ''


def main():
    f = open(os.path.join(ROOT, 'original/BLAZE.ALL'), 'rb')
    f.seek(0x1210 * S)
    g3 = f.read(0x4404)
    quest_mods = [struct.unpack_from('<II', g3, v) for _, v in chain(g3, 14)][:11]
    first = [sum(AREAS[:i]) for i in range(11)]
    out = {}
    for qi, (sec, size) in enumerate(quest_mods):
        f.seek(sec * S)
        d = f.read(size)
        lst = [struct.unpack_from('<II', d, v) for _, v in chain(d, 14)]
        for a, (s2, z2) in enumerate(lst[:{0: 6}.get(qi, len(lst))]):
            st = first[qi] + a
            if a >= AREAS[qi] or not os.path.exists(os.path.join(ROOT, 'public/assets/stages/stage%02d.json' % st)): continue
            f.seek(s2 * S)
            m = f.read(z2)
            out[st] = [text(m, v) for _, v in chain(m, 24)]
    json.dump(out, open(os.path.join(ROOT, 'public/assets/stages/messages.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    print(len(out), 'stages', sum(len(x) for x in out.values()), 'entries')


main()
