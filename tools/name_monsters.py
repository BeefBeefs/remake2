#!/usr/bin/env python3
"""Name the monster models that tools/export_stages.py could not solve, from the order of the definitions' family ids. Run AFTER export_stages.py
(and idempotent): it only fills `monsterInfo` entries whose name is null, in public/assets/stages/stageNN.json.

Monster pack model ids follow the order of the definitions' family id (`raw[1]` of the 96-byte records): in all 54 solved models the family ids increase
strictly with the model id (0 Kobold = family 1, 1 Goblin = 2, 2 Goblin-Shaman = 3, ... 20 Stalker = 24 ... 70 Carberos = 89); families without a pack of
their own (e.g. the recoloured Frost-Salamander shares model 7) leave gaps. An unsolved model between two solved ones therefore takes the family in
between: gap sizes are compared (models in the gap vs families that occur in definitions; if there are more families than models, only families that
occur in a stage listing one of the models count) and, when equal, families are assigned in order. Models 53 and 56 have no candidate family (their
definitions are in no exported stage) and models >= 73 have too many unknown families: they stay unnamed.
"""
import collections, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
D = os.path.join(ROOT, 'public/assets/stages')


def base(n): return n.split('.', 1)[1] if n.startswith('Lv') and '.' in n else n


def main():
    paths = [os.path.join(D, 'stage%02d.json' % i) for i in range(78)]
    stages = [json.load(open(p)) for p in paths]
    fam_names = collections.defaultdict(list)
    for st in stages:
        for m in st.get('monsterDefs', []):
            b = base(m['name'])
            if b not in fam_names[m['raw'][1]]: fam_names[m['raw'][1]].append(b)
    name_fam = {n: f for f, ns in fam_names.items() for n in ns}
    solved = {e['model']: e['name'] for st in stages for e in st.get('monsterInfo', []) if e['name']}
    anchor = {m: name_fam[n] for m, n in solved.items() if n in name_fam}
    models = sorted({m for st in stages for m in st['monsters']})
    assign = {}
    keys = sorted(anchor)
    for lo, hi in zip(keys, keys[1:]):
        unknown = [m for m in models if lo < m < hi and m not in anchor]
        if not unknown or anchor[hi] <= anchor[lo]: continue
        fams = sorted(f for f in fam_names if anchor[lo] < f < anchor[hi])
        if len(fams) > len(unknown):
            near = {base(d['name']) for st in stages if any(m in st['monsters'] for m in unknown) for d in st.get('monsterDefs', [])}
            fams = [f for f in fams if any(n in near for n in fam_names[f])]
        if len(fams) == len(unknown):
            for m, f in zip(unknown, fams): assign[m] = f
    changed = 0
    for p, st in zip(paths, stages):
        dirty = False
        for e in st.get('monsterInfo', []):
            if e['name'] or e['model'] not in assign: continue
            fam = fam_names[assign[e['model']]]
            here = [n for n in fam if any(base(d['name']) == n for d in st.get('monsterDefs', []))]
            e['name'] = (here or fam)[0]
            defs = [d for d in st.get('monsterDefs', []) if base(d['name']) == e['name']]
            if defs:
                df = next((d for d in defs if d['name'] == e['name']), defs[0])
                e.update({'level': df['level'], 'hp': df['raw'][2], 'attack': df['raw'][16]})
            dirty = True; changed += 1
        if dirty: json.dump(st, open(p, 'w'), separators=(',', ':'))
    print('named', changed, 'monsterInfo entries;', {m: fam_names[f][0] for m, f in sorted(assign.items())})


main()
