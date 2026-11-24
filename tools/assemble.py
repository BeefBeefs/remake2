"""Assemble a Blaze & Blade model from an animation blob + mesh pack (reverse-engineered, see docs/FORMATS.md).

Animation blob: hierarchy = [-1,-1] + parent[B] + part_bone[C]; D frame lists of B pose indices; poses (16 B):
  i16 rot[3] (4096 = 360 deg), i16 0, i16 trans[3], i16 scale(4096).  Pose is relative to the parent bone.
"""
import math, struct

S = 2048

def load_anim(d, pack, blob_index):
    n = pack['n']; base = pack['sector'] * S + 4 + 4 * n
    o = base + pack['blobs'][blob_index]['off']
    hdr = struct.unpack_from('<16I', d, o)
    A, B, C, D = struct.unpack_from('<4H', d, o + 0x10)
    body = o + 0x40
    hl = struct.unpack_from('<%dh' % (A + 2), d, body)
    parent = list(hl[2:2 + B]); part_bone = list(hl[2 + B:2 + B + C])
    frames = [list(struct.unpack_from('<%dh' % B, d, body + (A + 2) * 2 + f * B * 2)) for f in range(D)]
    pose_off = hdr[8]
    npose = (hdr[1] - (pose_off)) // 16     # body size minus start of poses
    poses = [struct.unpack_from('<8h', d, body + pose_off + 16 * i) for i in range(npose)]
    return {'A': A, 'B': B, 'C': C, 'D': D, 'parent': parent, 'part_bone': part_bone, 'frames': frames, 'poses': poses}

def rot_matrix(rx, ry, rz, order='zyx'):
    ax, ay, az = [r * 2 * math.pi / 4096 for r in (rx, ry, rz)]
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    X = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    Y = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    Z = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    mats = {'x': X, 'y': Y, 'z': Z}
    def mul(a, b): return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    m = mats[order[0]]
    for c in order[1:]: m = mul(m, mats[c])
    return m

def bone_world(anim, frame, order='zyx', sign=1):
    """Returns list of (R 3x3, t) per bone in model space."""
    B = anim['B']; world = [None] * B
    def get(b):
        if world[b] is not None: return world[b]
        p = anim['poses'][anim['frames'][frame][b]]
        R = rot_matrix(p[0], p[1], p[2], order); t = (p[4], p[5], p[6])
        par = anim['parent'][b]
        if par == b or par < 0 or par >= B:
            world[b] = (R, t)
        else:
            PR, pt = get(par)
            Rw = [[sum(PR[i][k] * R[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
            tw = tuple(pt[i] + sum(PR[i][k] * t[k] for k in range(3)) for i in range(3))
            world[b] = (Rw, tw)
        return world[b]
    for b in range(B): get(b)
    return world

def apply(Rt, v):
    R, t = Rt
    return tuple(t[i] + sum(R[i][k] * v[k] for k in range(3)) for i in range(3))
