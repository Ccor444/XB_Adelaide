"""Raster do chão visível (malha da pista): altura mínima/máxima por célula de 1 m. Usado por build_terrain.py e build_layout.py."""
import os, json
import numpy as np
DT = np.dtype({'names': ['p', 'n', 'c', 'uv'], 'formats': [('<f4', 3), ('i1', 3), ('u1', 4), ('<f4', 2)], 'offsets': [0, 12, 16, 20], 'itemsize': 28})

def load_track(dst):
    t = json.load(open(os.path.join(dst, 'data', 'trk.json')))
    V = np.fromfile(os.path.join(dst, 'assets', 'track', 'track.vb.bin'), dtype=DT)
    I = np.fromfile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'), np.uint16)
    return t, V, I

def ground_tris(t, V, I, skip_fill=True, only_up=True):
    out = []
    for g in t['groups']:
        if g['cat'] != 'opaque' or (skip_fill and g.get('fill')): continue
        s = I[g['off']:g['off'] + g['cnt']]; out.append(s[:len(s) // 3 * 3].reshape(-1, 3))
    T = np.concatenate(out).astype(int); P = V['p']
    if only_up:
        n = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]); T = T[np.abs(n[:, 1]) / (np.linalg.norm(n, axis=1) + 1e-9) > .8]
    return T

class Raster:
    def __init__(self, P, T, R=1.0, extra=None):
        self.R = R; self.X0 = P[:, 0].min() - 2; self.Z0 = P[:, 2].min() - 2
        self.NX = int((P[:, 0].max() + 2 - self.X0) / R) + 1; self.NZ = int((P[:, 2].max() + 2 - self.Z0) / R) + 1
        self.LO = np.full((self.NX, self.NZ), np.nan, np.float32); self.HI = np.full((self.NX, self.NZ), np.nan, np.float32)
        for tr in T:
            p, q, r = P[tr]; x0 = int((min(p[0], q[0], r[0]) - self.X0) / R); x1 = int((max(p[0], q[0], r[0]) - self.X0) / R) + 1
            z0 = int((min(p[2], q[2], r[2]) - self.Z0) / R); z1 = int((max(p[2], q[2], r[2]) - self.Z0) / R) + 1
            gx, gz = np.meshgrid(np.arange(x0, x1 + 1), np.arange(z0, z1 + 1), indexing='ij'); px = self.X0 + gx * R; pz = self.Z0 + gz * R
            d = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2])
            if abs(d) < 1e-9: continue
            l1 = ((q[2] - r[2]) * (px - r[0]) + (r[0] - q[0]) * (pz - r[2])) / d; l2 = ((r[2] - p[2]) * (px - r[0]) + (p[0] - r[0]) * (pz - r[2])) / d; l3 = 1 - l1 - l2
            m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6); y = l1 * p[1] + l2 * q[1] + l3 * r[1]
            ix = np.clip(gx, 0, self.NX - 1); iz = np.clip(gz, 0, self.NZ - 1)
            c = self.LO[ix, iz]; u = m & (np.isnan(c) | (y < c)); self.LO[ix[u], iz[u]] = y[u]
            c = self.HI[ix, iz]; u = m & (np.isnan(c) | (y > c)); self.HI[ix[u], iz[u]] = y[u]
    def at(self, x, z, yref=None, layer='lo'):
        i = int(round((x - self.X0) / self.R)); j = int(round((z - self.Z0) / self.R))
        if not (0 <= i < self.NX and 0 <= j < self.NZ): return np.nan
        lo, hi = self.LO[i, j], self.HI[i, j]
        if np.isnan(lo): return np.nan
        if yref is None: return lo if layer == 'lo' else hi
        return lo if abs(lo - yref) < abs(hi - yref) else hi
