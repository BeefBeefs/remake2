"""LHA -lh5- (8 KiB window) decoder, plus reader for the game's '.pic' wrapper.

Blaze & Blade's .pic files are LHA level-1 members whose 5-byte method field is overwritten with b'xxxxx'
(see wsyskern.dll `Unpack`, 0x3e70 -> 0x3480). The payload is plain lh5.
"""
import struct

NC, NT, NP, CBIT, TBIT, PBIT, THRESHOLD = 510, 19, 14, 9, 5, 4, 3
WIN = 0x2000


class _Bits:
    def __init__(self, data):
        self.d = data; self.pos = 0; self.acc = 0; self.n = 0

    def peek(self, k):
        while self.n < k:
            b = self.d[self.pos] if self.pos < len(self.d) else 0
            self.pos += 1
            self.acc = (self.acc << 8) | b; self.n += 8
        return (self.acc >> (self.n - k)) & ((1 << k) - 1)

    def skip(self, k):
        self.peek(k); self.n -= k; self.acc &= (1 << self.n) - 1

    def get(self, k):
        if k == 0: return 0
        v = self.peek(k); self.skip(k); return v


class _Huff:
    """Canonical Huffman decoder from code lengths (LHA assigns codes by length, then symbol order)."""
    def __init__(self, lens):
        self.lens = lens
        maxl = max(lens) if lens else 0
        self.maxl = maxl
        cnt = [0] * (maxl + 2)
        for l in lens:
            if l: cnt[l] += 1
        self.first = [0] * (maxl + 2); self.index = [0] * (maxl + 2)
        code = 0; idx = 0
        self.syms = sorted((s for s, l in enumerate(lens) if l), key=lambda s: (lens[s], s))
        for l in range(1, maxl + 1):
            code <<= 1
            self.first[l] = code; self.index[l] = idx
            code += cnt[l]; idx += cnt[l]
        self.cnt = cnt

    def decode(self, br):
        code = 0
        for l in range(1, self.maxl + 1):
            code = (code << 1) | br.get(1)
            off = code - self.first[l]
            if 0 <= off < self.cnt[l]:
                return self.syms[self.index[l] + off]
        raise ValueError('bad huffman code')


def _read_pt_len(br, nn, nbit, i_special):
    n = br.get(nbit)
    if n == 0:
        return ('const', br.get(nbit))
    lens = [0] * nn
    i = 0
    while i < n:
        c = br.peek(3)
        if c == 7:
            mask = 1 << 12; c = 7
            # unary extension: count further 1 bits after the first 3
            bits = br.peek(16)
            while bits & mask:
                mask >>= 1; c += 1
            br.skip(c - 3)
        else:
            br.skip(3)
        lens[i] = c; i += 1
        if i == i_special:
            z = br.get(2)
            for _ in range(z): lens[i] = 0; i += 1
    return _Huff(lens)


def _read_c_len(br, pt):
    n = br.get(CBIT)
    if n == 0:
        return ('const', br.get(CBIT))
    lens = [0] * NC
    i = 0
    while i < n:
        c = pt[1] if isinstance(pt, tuple) else pt.decode(br)
        if c <= 2:
            if c == 0: c = 1
            elif c == 1: c = br.get(4) + 3
            else: c = br.get(CBIT) + 20
            for _ in range(c): lens[i] = 0; i += 1
        else:
            lens[i] = c - 2; i += 1
    return _Huff(lens)


def _dec(h, br):
    return h[1] if isinstance(h, tuple) else h.decode(br)


def lh5_decode(data, out_size):
    br = _Bits(data)
    out = bytearray()
    win = bytearray(b' ' * WIN)
    wpos = 0
    blocksize = 0
    ch = ph = None
    while len(out) < out_size:
        if blocksize == 0:
            blocksize = br.get(16)
            pt = _read_pt_len(br, NT, TBIT, 3)
            ch = _read_c_len(br, pt)
            ph = _read_pt_len(br, NP, PBIT, -1)
        blocksize -= 1
        c = _dec(ch, br)
        if c < 256:
            out.append(c); win[wpos] = c; wpos = (wpos + 1) & (WIN - 1)
        else:
            ln = c - 256 + THRESHOLD
            j = _dec(ph, br)
            if j: j = (1 << (j - 1)) + br.get(j - 1)
            src = (wpos - j - 1) & (WIN - 1)
            for _ in range(ln):
                b = win[src]; src = (src + 1) & (WIN - 1)
                out.append(b); win[wpos] = b; wpos = (wpos + 1) & (WIN - 1)
                if len(out) >= out_size: break
    return bytes(out[:out_size])


def crc16(data, crc=0):
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def read_pic(data):
    """Decode a Blaze & Blade .pic file. Returns (original_name, bytes, crc_ok)."""
    hs = data[0]
    method = data[2:7]
    packed, orig = struct.unpack_from('<II', data, 7)
    level = data[20]
    nlen = data[21]
    name = data[22:22 + nlen].decode('latin1')
    crc, = struct.unpack_from('<H', data, 22 + nlen)
    start = hs + 2
    payload = data[start:start + packed]
    out = payload if method[3:4] == b'0' else lh5_decode(payload, orig)
    return name, out, crc16(out) == crc
