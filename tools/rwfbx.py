"""Leitor mínimo de FBX binário (7.x): nós, propriedades, geometrias e modelos."""
import struct, zlib
import numpy as np
class Node:
    def __init__(s, name): s.name = name; s.props = []; s.children = []
    def find(s, n): return [c for c in s.children if c.name == n]
    def first(s, n):
        r = s.find(n); return r[0] if r else None
def parse(path):
    d = open(path, 'rb').read(); ver = struct.unpack_from('<I', d, 23)[0]; big = ver >= 7500
    def rd(o):
        if big: end, npr, plen, nl = struct.unpack_from('<QQQB', d, o); o += 25
        else: end, npr, plen, nl = struct.unpack_from('<IIIB', d, o); o += 13
        if end == 0: return None, o
        n = Node(d[o:o + nl].decode('latin1')); o += nl; ps = o
        for _ in range(npr):
            t = chr(d[o]); o += 1
            if t in 'YCFDLIR' and t != 'R':
                f = {'Y': '<h', 'C': '<B', 'F': '<f', 'D': '<d', 'L': '<q', 'I': '<i'}[t]; n.props.append(struct.unpack_from(f, d, o)[0]); o += struct.calcsize(f)
            elif t in 'fdlib':
                ln, enc, cl = struct.unpack_from('<III', d, o); o += 12; raw = d[o:o + cl]; o += cl
                if enc: raw = zlib.decompress(raw)
                dt = {'f': '<f4', 'd': '<f8', 'l': '<i8', 'i': '<i4', 'b': '<u1'}[t]; n.props.append(np.frombuffer(raw, dt, ln))
            elif t in 'SR':
                ln = struct.unpack_from('<I', d, o)[0]; o += 4; raw = d[o:o + ln]; o += ln
                n.props.append(raw.decode('latin1') if t == 'S' else raw)
        o = ps + plen
        while o < end:
            c, o = rd(o)
            if c is None: break
            n.children.append(c)
        return n, end
    o = 27; top = []
    while o < len(d) - 13:
        n, o2 = rd(o)
        if n is None: break
        top.append(n); o = o2
    return top
