#!/usr/bin/env python3
"""Small MIPS R3000 (PlayStation) disassembler incl. GTE (COP2) names.
usage: mips.py <file> <file offset (hex or dec)> <instruction count> <load address of that offset (hex)>
As a module: dis(word, pc) -> text."""
import struct, sys

REG = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7',
       's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra']
R = lambda i: '$' + REG[i]
SPECIAL = {0: 'sll', 2: 'srl', 3: 'sra', 4: 'sllv', 6: 'srlv', 7: 'srav', 8: 'jr', 9: 'jalr', 12: 'syscall', 13: 'break',
           16: 'mfhi', 17: 'mthi', 18: 'mflo', 19: 'mtlo', 24: 'mult', 25: 'multu', 26: 'div', 27: 'divu',
           32: 'add', 33: 'addu', 34: 'sub', 35: 'subu', 36: 'and', 37: 'or', 38: 'xor', 39: 'nor', 42: 'slt', 43: 'sltu'}
IMM = {8: 'addi', 9: 'addiu', 10: 'slti', 11: 'sltiu', 12: 'andi', 13: 'ori', 14: 'xori'}
MEM = {32: 'lb', 33: 'lh', 34: 'lwl', 35: 'lw', 36: 'lbu', 37: 'lhu', 38: 'lwr', 40: 'sb', 41: 'sh', 42: 'swl', 43: 'sw', 46: 'swr',
       50: 'lwc2', 58: 'swc2'}
GTE = {1: 'RTPS', 6: 'NCLIP', 12: 'OP', 16: 'DPCS', 17: 'INTPL', 18: 'MVMVA', 19: 'NCDS', 20: 'CDP', 22: 'NCDT', 27: 'NCCS', 28: 'CC',
       30: 'NCS', 32: 'NCT', 40: 'SQR', 41: 'DCPL', 42: 'DPCT', 45: 'AVSZ3', 46: 'AVSZ4', 48: 'RTPT', 61: 'GPF', 62: 'GPL', 63: 'NCCT'}


def s16(x): return x - 0x10000 if x & 0x8000 else x


def dis(w, pc):
    op = w >> 26; rs = (w >> 21) & 31; rt = (w >> 16) & 31; rd = (w >> 11) & 31; sh = (w >> 6) & 31; fn = w & 63; im = w & 0xffff
    if w == 0: return 'nop'
    if op == 0:
        n = SPECIAL.get(fn)
        if n is None: return '.word 0x%08x' % w
        if fn in (0, 2, 3): return '%s %s, %s, %d' % (n, R(rd), R(rt), sh)
        if fn in (4, 6, 7): return '%s %s, %s, %s' % (n, R(rd), R(rt), R(rs))
        if fn == 8: return 'jr %s' % R(rs)
        if fn == 9: return 'jalr %s, %s' % (R(rd), R(rs))
        if fn in (12, 13): return n
        if fn in (16, 18): return '%s %s' % (n, R(rd))
        if fn in (17, 19): return '%s %s' % (n, R(rs))
        if fn in (24, 25, 26, 27): return '%s %s, %s' % (n, R(rs), R(rt))
        if fn == 33 and rt == 0: return 'move %s, %s' % (R(rd), R(rs))
        if fn == 37 and rt == 0: return 'move %s, %s' % (R(rd), R(rs))
        return '%s %s, %s, %s' % (n, R(rd), R(rs), R(rt))
    if op == 1:
        n = {0: 'bltz', 1: 'bgez', 16: 'bltzal', 17: 'bgezal'}.get(rt, '.word')
        return '%s %s, 0x%08x' % (n, R(rs), (pc + 4 + 4 * s16(im)) & 0xffffffff)
    if op == 2: return 'j 0x%08x' % (((pc + 4) & 0xf0000000) | ((w & 0x3ffffff) << 2))
    if op == 3: return 'jal 0x%08x' % (((pc + 4) & 0xf0000000) | ((w & 0x3ffffff) << 2))
    if op in (4, 5): return '%s %s, %s, 0x%08x' % ('beq' if op == 4 else 'bne', R(rs), R(rt), (pc + 4 + 4 * s16(im)) & 0xffffffff)
    if op in (6, 7): return '%s %s, 0x%08x' % ('blez' if op == 6 else 'bgtz', R(rs), (pc + 4 + 4 * s16(im)) & 0xffffffff)
    if op in IMM:
        if op == 9 and rs == 0: return 'li %s, %d' % (R(rt), s16(im))
        if op in (12, 13, 14): return '%s %s, %s, 0x%x' % (IMM[op], R(rt), R(rs), im)
        return '%s %s, %s, %d' % (IMM[op], R(rt), R(rs), s16(im))
    if op == 15: return 'lui %s, 0x%x' % (R(rt), im)
    if op in MEM: return '%s %s, %d(%s)' % (MEM[op], R(rt) if op not in (50, 58) else '$c2_%d' % rt, s16(im), R(rs))
    if op == 16:
        if rs == 0: return 'mfc0 %s, $%d' % (R(rt), rd)
        if rs == 4: return 'mtc0 %s, $%d' % (R(rt), rd)
        if rs == 16 and fn == 16: return 'rfe'
    if op == 18:
        if w & (1 << 25): return 'GTE %s (0x%07x)' % (GTE.get(fn, '?%d' % fn), w & 0x1ffffff)
        n = {0: 'mfc2', 2: 'cfc2', 4: 'mtc2', 6: 'ctc2'}.get(rs, '?')
        return '%s %s, $%d' % (n, R(rt), rd)
    return '.word 0x%08x' % w


if __name__ == '__main__':
    d = open(sys.argv[1], 'rb').read()
    off = int(sys.argv[2], 0); cnt = int(sys.argv[3]); base = int(sys.argv[4], 16)
    for i in range(cnt):
        w = struct.unpack_from('<I', d, off + 4 * i)[0]
        print('%08x: %08x  %s' % (base + 4 * i, w, dis(w, base + 4 * i)))
