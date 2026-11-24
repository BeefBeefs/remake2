"""Parse Blaze & Blade mesh-part blobs (reverse-engineered; see docs/FORMATS.md).

Blob layout (all little-endian):
  [7 rows R1] [subheader @h] [vertices V*8 @h+w7-4] [normals N*8 @h+w8-4] [4 B gap] [face rows F2 @h+w9]
  face row (16 B): u8 id[4], u8 uv[4][2], u8 vidx[4]   (textured quad; repeated vidx = triangle)
  subheader (u32 words at h): w0..w4 = counts (u16: N, N, V, N, N ...), w7 = 0x40 (vertices at h+w7-4),
                              w8 -> normals at h+w8-4, w9 -> F2 face rows at h+w9. V=(w8-w7)/8, N=(w9-w8)/8.
  vertex: i16 x,y,z, i16 pad. normal: i16 x,y,z (4096 = 1.0), i16 pad.
"""
import struct

def find_subheader(blob):
    """Subheader start h (any 4-byte phase) plus its words; validated against w1 = V | N << 16."""
    for h in range(0, min(len(blob) - 0x28, 0x400), 4):
        w = struct.unpack_from('<10I', blob, h)
        if w[7] == 0x40 and w[8] > w[7] and w[9] > w[8] and (w[8] - w[7]) % 8 == 0 and (w[9] - w[8]) % 8 == 0:
            if (w[1] & 0xffff) == (w[8] - w[7]) // 8 and (w[1] >> 16) == (w[9] - w[8]) // 8:
                return h, w
    return None

def parse_part_at(d, start, end):
    """Parse the part whose pack-table slice is d[start:end].

    Face rows are 16 B and run through the blob boundaries: for some heroes the slice starts mid-row. The window is
    shifted back by (-h) % 16 so that the subheader lands 16-byte aligned (the shift is 0 for hero 0 / hero 2)."""
    r = find_subheader(d[start:end])
    if not r:
        return None
    sh = (-r[0]) % 16
    return parse_part(d[start - sh:end - sh])

def parse_part(blob):
    r = find_subheader(blob)
    if not r: return None
    h, w = r
    nv = (w[8] - w[7]) // 8              # == subheader w1 low half; vertices start at h+w7-4 (slot before is a zero vertex)
    nn = (w[9] - w[8]) // 8
    if h + w[9] > len(blob) or nv > 4096 or nn > 4096:
        return None
    verts = [struct.unpack_from('<3h', blob, h + w[7] - 4 + 8 * i) for i in range(nv)]
    norms = [struct.unpack_from('<3h', blob, h + w[8] - 4 + 8 * i) for i in range(nn)]
    def rows(a, b):
        out = []
        for o in range(a, b - 15, 16):
            r_ = blob[o:o + 16]
            out.append({'id': tuple(r_[0:4]), 'uv': [(r_[4 + 2 * k], r_[5 + 2 * k]) for k in range(4)], 'v': tuple(r_[12:16])})
        return out
    f1 = rows(0, h)
    f2 = rows(h + w[9], len(blob))
    if len(f1) + len(f2) > nn:        # blobs are padded / followed by other data: #faces == #normals
        f2 = f2[:max(0, nn - len(f1))]
    faces = f1 + f2
    return {'subheader_at': h, 'verts': verts, 'normals': norms, 'faces': faces}


def parse_pack(d, base, offs, ends):
    """Parse a whole mesh pack. Returns {part index: {verts, normals, faces, extra}}.

    Findings (PROGRESS.md Turn 7): the pack's blob slices are NOT part boundaries for face data. A part record starts at
    base+offs[i]+h0 (h0 = subheader position inside the slice: 112 / 84 / 132 ...) and consists of
      subheader | V vertices @+w7-4 | N normals @+w8-4 | F face rows @+w9 ...
    where F = low half of subheader word 0 (N, the normal count, can be larger). Face rows run on across the slice boundary
    up to the next record's subheader, so the "7 rows before the subheader" of a slice are the tail of the *previous* part.
    Slices without any subheader are extra face rows ("joint caps") that index the preceding part's vertices; rows beyond
    F are returned in 'extra' and are only kept if every vertex index is in range.
    Row (16 B): u8 normal_idx[4], u8 uv[4][2], u8 vertex_idx[4]."""
    info = {}
    for i in range(len(offs)):
        r = find_subheader(d[base + offs[i]:base + ends[i]])
        if r:
            info[i] = r
    ids = sorted(info)
    def row(o):
        r_ = d[o:o + 16]
        return {'id': tuple(r_[0:4]), 'uv': [(r_[4 + 2 * k], r_[5 + 2 * k]) for k in range(4)], 'v': tuple(r_[12:16])}
    parts = {}
    for n, i in enumerate(ids):
        h0, w = info[i]
        start = base + offs[i] + h0
        nv, nn, nf = (w[8] - w[7]) // 8, (w[9] - w[8]) // 8, w[0] & 0xffff
        if nv > 4096 or nn > 4096 or nf > 4096:
            continue
        verts = [struct.unpack_from('<3h', d, start + w[7] - 4 + 8 * k) for k in range(nv)]
        norms = [struct.unpack_from('<3h', d, start + w[8] - 4 + 8 * k) for k in range(nn)]
        f0 = start + w[9]
        if n + 1 < len(ids):
            end = base + offs[ids[n + 1]] + info[ids[n + 1]][0]
        else:   # last real part: only trailing blobs inside the offset table count (ends[-1] runs on into padding)
            end = base + offs[-1] if i + 1 < len(offs) else f0 + 16 * nf
        faces = [row(f0 + 16 * k) for k in range(nf) if f0 + 16 * k + 16 <= end]
        extra = [row(o) for o in range(f0 + 16 * nf, end - 15, 16)]
        extra = [f for f in extra if all(j < nv for j in f['v'])]
        parts[i] = {'verts': verts, 'normals': norms, 'faces': faces, 'extra': extra}
    return parts


def recover_bad_rows(parts):
    """Repair face rows whose vertex bytes were overwritten by the next record's header (the last row of most parts reads (a,0,b,0)
    with a,b = vertex/normal counts of the *next* part). The row's UVs and its normal id (= the part's last normal, a true face normal)
    are intact, so the missing polygon is: vertices lying on one plane perpendicular to that normal (equal dot product), picked and
    ordered by fitting their 3-D shape to the UV quad (similarity fit, reflection allowed). A triangle when a UV is the (2,123) dummy.
    Operates in place on parts {index: {'verts','normals','faces','extra'}}; returns (fixed, unfixed)."""
    import itertools
    import numpy as np
    fixed = bad = 0
    for pi, r in parts.items():
        nv = len(r['verts'])
        V = np.array(r['verts'], float)
        N = np.array(r['normals'], float)
        for f in r['faces']:
            if not any(j >= nv for j in f['v']):
                continue
            nid = f['id'][0]
            real = [k for k in range(4) if tuple(f['uv'][k]) != (2, 123)]
            m = len(real)
            if nid >= len(N) or nv < m or not np.linalg.norm(N[nid]):
                bad += 1
                continue
            n = N[nid] / np.linalg.norm(N[nid])
            dots = V @ n
            uv = np.array([f['uv'][k] for k in real], float)
            U = uv - uv.mean(0)
            best = None
            for d0 in sorted(set(np.round(dots).astype(int))):
                grp = [j for j in range(nv) if abs(dots[j] - d0) <= 1.01]
                if len(grp) < m or len(grp) > 14:
                    continue
                for comb in itertools.combinations(grp, m):
                    for perm in itertools.permutations(comb):
                        P = V[list(perm)]
                        Pc = P - P.mean(0)
                        _, _, vt = np.linalg.svd(Pc, full_matrices=False)
                        P2 = Pc @ vt[:2].T
                        uu, ss, vv = np.linalg.svd(U.T @ P2)
                        R = uu @ vv
                        sc = ss.sum() / max((P2 ** 2).sum(), 1e-9)
                        err = ((P2 @ R.T * sc - U) ** 2).sum() / max((U ** 2).sum(), 1e-9)
                        if best is None or err < best[0]:
                            best = (err, perm)
            if best is None or best[0] > 0.25:
                bad += 1
                continue
            v4 = [0, 0, 0, 0]
            for k, j in zip(real, best[1]):
                v4[k] = j
            for k in range(4):
                if k not in real:
                    v4[k] = v4[real[-1]]
            f['v'] = tuple(v4)
            f['fixed'] = round(float(best[0]), 3)
            fixed += 1
    return fixed, bad
