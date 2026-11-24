"""Parse Blaze & Blade mesh-part blobs (reverse-engineered; see docs/FORMATS.md).

Blob layout (all little-endian):
  [7 rows R1] [subheader @h] [vertices V*8 @h+w7-4] [normals N*8 @h+w8-12] [12 B gap] [face rows F2 @h+w9]
  face row (16 B): u8 id[4], u8 uv[4][2], u8 vidx[4]   (textured quad; repeated vidx = triangle)
  subheader (u32 words at h): w0..w4 = counts (u16: N, N, V, N, N ...), w7 = 0x40 (vertices at h+w7-4),
                              w8 -> normals at h+w8-12, w9 -> F2 face rows at h+w9. V=(w8-w7)/8-1, N=(w9-w8)/8.
  vertex: i16 x,y,z, i16 pad. normal: i16 x,y,z (4096 = 1.0), i16 pad.
"""
import struct

def find_subheader(blob):
    for h in range(0, min(len(blob) - 0x28, 0x400), 16):
        w = struct.unpack_from('<10I', blob, h)
        if w[7] == 0x40 and w[8] > w[7] and w[9] > w[8] and (w[8] - w[7]) % 8 == 0 and (w[9] - w[8]) % 8 == 0:
            return h, w
    return None

def parse_part(blob):
    r = find_subheader(blob)
    if not r: return None
    h, w = r
    nv = (w[8] - w[7]) // 8 - 1          # vertices start at h+w7-4 (verified: F2 quads are planar rectangles)
    nn = (w[9] - w[8]) // 8
    if h + w[9] > len(blob) or nv > 4096 or nn > 4096:
        return None
    verts = [struct.unpack_from('<3h', blob, h + w[7] - 4 + 8 * i) for i in range(nv)]
    norms = [struct.unpack_from('<3h', blob, h + w[8] - 12 + 8 * i) for i in range(nn)]
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
