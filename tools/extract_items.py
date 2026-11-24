#!/usr/bin/env python3
"""Extract the starting-kit item records (resource table 'hero_6400': 8 blobs x 10 records of 640 B).

Record: name[64] | u8 len + "Name/Description\\r(Effect)" text at +64 | binary stat fields (unverified: +16..19, +48..55) | misc.
usage: extract_items.py <BLAZE.ALL> <resource_table.json> <out.json>
"""
import json, sys
d = open(sys.argv[1], 'rb').read()
rt = json.load(open(sys.argv[2]))
out = []
for k, sec in enumerate(rt['hero_6400']):
    blob = d[sec * 2048:sec * 2048 + 6400]
    items = []
    for r in range(10):
        rec = blob[r * 640:(r + 1) * 640]
        name = rec[:64].split(b'\0')[0].decode('latin1')
        if not name:
            continue
        text = rec[65:65 + 255].split(b'\0')[0].decode('latin1')
        items.append({'name': name, 'text': text, 'bytes_16_20': list(rec[16:20]), 'bytes_48_56': list(rec[48:56])})
    out.append({'kit': k, 'sector': sec, 'items': items})
json.dump(out, open(sys.argv[3], 'w'), indent=1)
print(sum(len(k['items']) for k in out), 'items in', len(out), 'kits')
