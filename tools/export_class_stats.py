#!/usr/bin/env python3
"""Add the real base attributes of the 8 hero classes to public/assets/heroes/classes.json (`stats`: str, int, wil, agl, con, pow, lck).

Source: the character-creation module (sector 4633, the one with 'Please choose a character.'): header slot 25 entry 0 = 8 rows of 8 bytes
(STR INT WIL AGL CON POW LCK + 0) in class order Warrior, Priest, Rogue, Sorcerer, Hunter, Elf, Dwarf, Fairy (m and f share a row).
Meaning of the attributes (the module's own help texts): STR = attacks, INT = effective sorcery, WIL = resistance to magic, AGL = defense,
CON = health and healing, POW = recovery of magical energy, LCK = luck.
"""
import json, os, struct
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
exec(open(os.path.join(HERE, 'export_doors.py')).read().split('\ndef main')[0].split('import json, os, re, struct, sys')[1])  # SPEC + chain()
S = 2048


def main():
    f = open(os.path.join(ROOT, 'original/BLAZE.ALL'), 'rb')
    f.seek(4633 * S)
    m = f.read(0x30000)
    v = chain(m, 25)[0][1]
    keys = ['str', 'int', 'wil', 'agl', 'con', 'pow', 'lck']
    rows = [dict(zip(keys, m[v + 8 * i:v + 8 * i + 7])) for i in range(8)]
    p = os.path.join(ROOT, 'public/assets/heroes/classes.json')
    cl = json.load(open(p))
    for c in cl: c['stats'] = rows[c['hero'] % 8]
    json.dump(cl, open(p, 'w'), separators=(',', ':'))
    print([(c['class'], c['stats']) for c in cl[:8]])


main()
