#!/usr/bin/env python3
"""Extract Blaze & Blade .snd banks to WAV.

Format (reverse-engineered, validated against all 79 files in Snd/):
  table of N little-endian (offset:u32, size:u32) pairs, offsets are relative
  to the end of the table, chained back-to-back (offset[i+1] == offset[i]+size[i]).
  Table length = 8*N where 8*N + sum(sizes) == file size.
  Samples: 8-bit unsigned PCM, mono. Sample rate is NOT stored (assumed 22050).

usage: extract_snd.py <Snd dir> <out dir> [rate]
"""
import json, os, struct, sys, wave

def parse(data):
    # Try every plausible table length; accept the one that chains and matches file size.
    for n in range(1, 513):
        base = n * 8
        if base > len(data): break
        ents = struct.unpack_from('<%dI' % (n * 2), data, 0)
        pairs = list(zip(ents[0::2], ents[1::2]))
        ok = pairs[0][0] == 0
        pos = 0
        for off, sz in pairs:
            if off != pos: ok = False; break
            pos += sz
        if ok and base + pos == len(data):
            return base, pairs
    return None

def main():
    src, dst = sys.argv[1], sys.argv[2]
    rate = int(sys.argv[3]) if len(sys.argv) > 3 else 22050
    os.makedirs(dst, exist_ok=True)
    good = bad = clips = 0
    manifest = []
    for fn in sorted(os.listdir(src)):
        if not fn.lower().endswith('.snd'): continue
        data = open(os.path.join(src, fn), 'rb').read()
        r = parse(data)
        if not r:
            print('UNPARSED', fn, len(data)); bad += 1; continue
        base, pairs = r
        good += 1
        for i, (off, sz) in enumerate(pairs):
            if sz == 0: continue
            out = os.path.join(dst, '%s_%02d.wav' % (os.path.splitext(fn)[0], i))
            with wave.open(out, 'wb') as w:
                w.setnchannels(1); w.setsampwidth(1); w.setframerate(rate)
                w.writeframes(data[base + off: base + off + sz])
            clips += 1
            manifest.append({'file': os.path.basename(out), 'bank': os.path.splitext(fn)[0], 'index': i, 'bytes': sz, 'seconds': round(sz / rate, 3)})
    with open(os.path.join(dst, 'manifest.json'), 'w') as f:
        json.dump({'sampleRate': rate, 'clips': manifest}, f, indent=0)
    print('banks ok=%d unparsed=%d clips=%d' % (good, bad, clips))

if __name__ == '__main__':
    main()
