#!/usr/bin/env python3
"""Placas flutuando: 1) devolve às placas ADELAIDE/Jumbo os pés e armações (signbase/bar04 de _orig_sea) que foram apagados da pista;
2) telões altos (≥18 m) que nunca tiveram suporte ganham dois pilares de metal até o chão.
Trabalha em _orig_trucks/ (a base que build_trucks.py lê); rode build_trucks.py depois. Idempotente (marcas _billboards_fixed / _posts_fixed no trk.json).
Uso: python3 tools/fix_billboards.py [pasta_do_jogo]"""
import sys, os, json, re
import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
DT = [('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)]
B = os.path.join(dst, '_orig_trucks'); O = os.path.join(dst, '_orig_sea')
t = json.load(open(os.path.join(B, 'trk.json'))); vb = np.fromfile(os.path.join(B, 'track.vb.bin'), dtype=DT); ib = np.fromfile(os.path.join(B, 'track.ib.bin'), np.uint16)
names = t['texnames']
FACE = re.compile(r'^(logo02|jumbos|jumbob)\.dds$'); SUP = re.compile(r'^(signbase|bar04)\.dds$')
def tris(tt, V, I, pred):
    for g in tt['groups']:
        if pred(tt['texnames'][g['tex']]): yield g, I[g['off']:g['off'] + g['cnt']].reshape(-1, 3)
F = np.concatenate([V for V in (vb['p'][s].reshape(-1, 3) for g, s in tris(t, vb, ib, lambda n: FACE.match(n)))])
lab = fcluster(linkage(F, 'single'), 6, 'distance'); boards = [(F[lab == c].min(0), F[lab == c].max(0)) for c in sorted(set(lab))]
print(len(boards), 'placas')
newv = []; groups = []; nv = len(vb)

if not t.get('_billboards_fixed'):
    o = json.load(open(os.path.join(O, 'trk.json'))); ovb = np.fromfile(os.path.join(O, 'track.vb.bin'), dtype=DT); oib = np.fromfile(os.path.join(O, 'track.ib.bin'), np.uint16)
    newi = {}; added = 0
    for g, seg in tris(o, ovb, oib, lambda n: SUP.match(n) and n in names):
        on = o['texnames'][g['tex']]; c = ovb['p'][seg].mean(1); keep = np.zeros(len(seg), bool)
        for lo, hi in boards:
            keep |= (c[:, 0] > lo[0] - 9) & (c[:, 0] < hi[0] + 9) & (c[:, 2] > lo[2] - 9) & (c[:, 2] < hi[2] + 9) & (c[:, 1] > lo[1] - 9) & (c[:, 1] < hi[1] + 2)
        s = seg[keep]
        if not len(s): continue
        idx = []
        for v in s.ravel():
            if v not in newi: newi[v] = nv + len(newv); newv.append(ovb[v])
            idx.append(newi[v])
        groups.append((dict(tex=names.index(on), cat=g['cat']), np.array(idx, np.uint16))); added += len(s)
    print('pés/armações restaurados: %d triângulos' % added); t['_billboards_fixed'] = True

if not t.get('_posts_fixed'):
    GR = np.concatenate([vb['p'][s].reshape(-1, 3) for g, s in tris(t, vb, ib, lambda n: n == 'gras.dds')]); ti = names.index('metla.dds'); pv = []; pi = []; base = nv + len(newv)
    for lo, hi in boards:
        if lo[1] < 18: continue
        c = (lo + hi) / 2; nb = GR[(abs(GR[:, 0] - c[0]) < 25) & (abs(GR[:, 2] - c[2]) < 25)]
        gy = float(nb[:, 1].min()) if len(nb) else 10.5; ext = hi - lo; ax = (1., 0.) if ext[0] >= ext[2] else (0., 1.); w = .35
        for k in (-.28, .28):
            cx = c[0] + ax[0] * ext[0] * k; cz = c[2] + ax[1] * ext[2] * k; y0, y1 = gy, lo[1] + .2
            C = [(cx - w, y0, cz - w), (cx + w, y0, cz - w), (cx + w, y0, cz + w), (cx - w, y0, cz + w), (cx - w, y1, cz - w), (cx + w, y1, cz - w), (cx + w, y1, cz + w), (cx - w, y1, cz + w)]
            for q in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                for i, (u, v) in zip((q[0], q[1], q[2], q[0], q[2], q[3]), [(0, 0), (1, 0), (1, 1), (0, 0), (1, 1), (0, 1)]):
                    r = np.zeros(1, dtype=DT); r['p'] = C[i]; r['c'] = 255; r['uv'] = (u, -(v * max(1., (y1 - y0) / 4))); pv.append(r[0]); pi.append(base + len(pv) - 1)
    print('pilares: %d triângulos' % (len(pi) // 3))
    if pi: newv += pv; groups.append((dict(tex=ti, cat='opaque'), np.array(pi, np.uint16)))
    t['_posts_fixed'] = True

if newv:
    if nv + len(newv) >= 65536: raise SystemExit('vértices demais')
    pos = len(ib); parts = [ib]
    for gd, ix in groups: gd = dict(gd); gd['off'] = pos; gd['cnt'] = int(len(ix)); pos += len(ix); parts.append(ix); t['groups'].append(gd)
    np.concatenate([vb, np.array(newv, dtype=DT)]).tofile(os.path.join(B, 'track.vb.bin')); np.concatenate(parts).astype(np.uint16).tofile(os.path.join(B, 'track.ib.bin'))
json.dump(t, open(os.path.join(B, 'trk.json'), 'w'), separators=(',', ':'))
print('ok')
