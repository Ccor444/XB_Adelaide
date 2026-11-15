#!/usr/bin/env python3
"""Remove lajes de pista flutuando (roada/road1/roadf/roadc soltas, <=6 triangulos, longe da linha da IA).
Trabalha em _orig_trucks/; rode build_trucks.py depois. Idempotente (_floating_removed)."""
import sys, os, json
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
DT = [('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)]
B = os.path.join(dst, '_orig_trucks')
t = json.load(open(os.path.join(B, 'trk.json')))
if t.get('_floating_removed'): print('ja feito'); sys.exit()
vb = np.fromfile(os.path.join(B, 'track.vb.bin'), dtype=DT); ib = np.fromfile(os.path.join(B, 'track.ib.bin'), np.uint16)
A = np.array(json.load(open(os.path.join(dst, 'data/ext.json')))['ai'])[:, [0, 2]]
n = t['texnames']; ROAD = {'roada.dds', 'road1.dds', 'roadf.dds', 'roadc.dds'}
ref = []
for gi, g in enumerate(t['groups']):
    if n[g['tex']] in ROAD:
        s = ib[g['off']:g['off'] + g['cnt']].reshape(-1, 3)
        for k in range(len(s)): ref.append((gi, k))
T = np.concatenate([ib[g['off']:g['off'] + g['cnt']].reshape(-1, 3) for g in t['groups'] if n[g['tex']] in ROAD])
P = vb['p']; key = np.round(P * 10).astype(np.int64); _, inv = np.unique(key, axis=0, return_inverse=True); W = inv[T]; nv = inv.max() + 1
gr = coo_matrix((np.ones(2 * len(W)), (np.r_[W[:, 0], W[:, 1]], np.r_[W[:, 1], W[:, 2]])), shape=(nv, nv)); _, lab = connected_components(gr, directed=False); tl = lab[W[:, 0]]
kill = set()
for k in np.unique(tl):
    m = tl == k
    if m.sum() > 6: continue
    Q = P[T[m].ravel()][:, [0, 2]]; d = np.sqrt(((Q[:, None] - A[None]) ** 2).sum(2)).min()
    if d > 8:
        for i in np.where(m)[0]: kill.add(ref[i])
print('triangulos removidos:', len(kill))
parts = []; pos = 0
for gi, g in enumerate(t['groups']):
    s = ib[g['off']:g['off'] + g['cnt']].reshape(-1, 3)
    keep = np.array([(gi, k) not in kill for k in range(len(s))], bool); s = s[keep].ravel()
    g['off'] = pos; g['cnt'] = int(len(s)); pos += len(s); parts.append(s)
np.concatenate(parts).astype(np.uint16).tofile(os.path.join(B, 'track.ib.bin'))
t['_floating_removed'] = True; json.dump(t, open(os.path.join(B, 'trk.json'), 'w'), separators=(',', ':'))
