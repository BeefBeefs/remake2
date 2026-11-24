#!/usr/bin/env python3
"""Export the 16 playable heroes' class names and starting-kit stats to public/assets/heroes/classes.json.

Names: the character-select module (sector 4633) lists 'Warrior (m)', 'Priest', ... 'Fairy (f)' in this order, which matches the hero model
numbers 0..15 (checked by eye: hero 1 priest robe, 3 sorcerer, 4 hunter) and the 8 starting kits (kit k = class k, shared by the m/f pair).
Kit item records: +18 = class bit mask (1 warrior ... 128 fairy), +48 = weapon attack, armor/shield +54 used as defence (leather armor 3, robe 2, shield 2; +50 is 5 for all armors: unverified meaning).
usage: export_classes.py <BLAZE.ALL> <data/start_kits.json> <out.json>
"""
import json, re, sys
d = open(sys.argv[1], 'rb').read()
kits = json.load(open(sys.argv[2]))
b = d[4633 * 2048:4633 * 2048 + 8000]
strs = [m.group().decode() for m in re.finditer(rb'[ -~]{4,}', b)]
i = strs.index('This character?') + 1
names = strs[i:i + 16]
out = []
for h in range(16):
    k = kits[h % 8]
    items = k['items']
    weapon = items[0]
    others = items[1:-1]
    out.append({
        'hero': h, 'class': names[h], 'kit': k['kit'],
        'weapon': weapon['name'], 'attack': weapon['bytes_48_56'][0],
        'defense': sum(it['bytes_48_56'][6] for it in others),
        'gear': [it['name'] for it in items],
    })
json.dump(out, open(sys.argv[3], 'w'), indent=1)
print(len(out), 'heroes', [o['class'] for o in out])
