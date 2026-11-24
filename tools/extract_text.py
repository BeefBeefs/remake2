#!/usr/bin/env python3
"""Dump English text runs from BLAZE.ALL (plain ASCII, '\\r' line breaks) to a TSV: byte_offset<TAB>text.

Heuristic filter (>=80% letters/spaces, >=3 words) drops image/binary noise. Offsets are file byte offsets.
usage: extract_text.py <BLAZE.ALL> <out.tsv>
"""
import re, sys

def good(r):
    s = r.decode('latin1')
    letters = sum(c.isalpha() or c == ' ' for c in s)
    words = [w for w in re.findall(r'[A-Za-z]{3,}', s) if re.search(r'[aeiouyAEIOUY]', w)]
    return letters / len(s) > 0.8 and len(words) >= 3 and s.count(' ') >= 2 and sum(c.isupper() for c in s) < 0.35 * len(s)

d = open(sys.argv[1], 'rb').read()
n = 0
with open(sys.argv[2], 'w', encoding='utf-8') as f:
    for m in re.finditer(rb'[\x20-\x7e\r\n]{16,}', d):
        if good(m.group()):
            f.write('%d\t%s\n' % (m.start(), m.group().decode('latin1').replace('\r', '\\r').replace('\n', '\\n')))
            n += 1
print('runs:', n)
