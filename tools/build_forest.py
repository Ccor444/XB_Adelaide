#!/usr/bin/env python3
"""Floresta ao lado da pista: acrescenta coqueiros (palmeiras), pinheiros (sequoias) e arbustos do GTA SA em faixas de 8 a 85 m
das estruturas/pista, com clareiras. Evita pista, muros, casas, pneus e praia/mar. Roda depois de build_gta_trees.py / build_world_fx.py.
Uso: python3 tools/build_forest.py [pasta_do_jogo] [--max N]"""
import sys, os, json, math, shutil
import numpy as np, cv2
from scipy import ndimage as ndi
dst = '.'; MAXN = 3200
for a in sys.argv[1:]:
    if a.startswith('--max='): MAXN = int(a[6:])
    elif not a.startswith('--'): dst = a
D = lambda *a: os.path.join(dst, *a)
CELL = 6.5; RES = 2.0
# base: instâncias de árvore da pista (antes da floresta)
if not os.path.exists(D('_orig_oak/base_inst.bin')): shutil.copy(D('assets/trees/inst.bin'), D('_orig_oak/base_inst.bin'))
base = np.fromfile(D('_orig_oak/base_inst.bin'), np.float32).reshape(-1, 6)
tj = json.load(open(D('data/trees.json'))); names = [m['name'] for m in tj['models']]; MI = {n: i for i, n in enumerate(names)}
trk = json.load(open(D('data/trk.json'))); tn = trk['texnames']
vb = np.fromfile(D('assets/track/track.vb.bin'), dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)]); ib = np.fromfile(D('assets/track/track.ib.bin'), np.uint16); P = vb['p']
GROUND = ('gras.dds', 'grav.dds', 'grava.dds', 'lake.dds', 'shado1.dds', 'tshado1.dds', 'green.dds', 'ptmarsh.dds', 'pline.dds')
X0, X1, Z0, Z1 = -1500., 1400., -1300., 1450.; NX = int((X1 - X0) / RES); NZ = int((Z1 - Z0) / RES)
occ = np.zeros((NZ, NX), np.uint8); Hg = np.full((NZ, NX), np.nan, np.float32)
for g in trk['groups']:
    n = tn[g['tex']]; tt = ib[g['off']:g['off'] + g['cnt']].reshape(-1, 3)
    if n in ('gras.dds', 'lake.dds'):           # altura do terreno (inclui a praia rebaixada)
        for a, b, c in tt:
            pa, pb, pc = P[a], P[b], P[c]
            ux = lambda p: (p[0] - X0) / RES; uz = lambda p: (p[2] - Z0) / RES
            xs = [ux(pa), ux(pb), ux(pc)]; zs = [uz(pa), uz(pb), uz(pc)]
            i0, i1 = max(0, int(min(xs))), min(NX - 1, int(max(xs)) + 1); j0, j1 = max(0, int(min(zs))), min(NZ - 1, int(max(zs)) + 1)
            if i0 > i1 or j0 > j1: continue
            gx, gz = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1)); d = (zs[1] - zs[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (zs[0] - zs[2])
            if abs(d) < 1e-9: continue
            l1 = ((zs[1] - zs[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gz - zs[2])) / d; l2 = ((zs[2] - zs[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gz - zs[2])) / d; l3 = 1 - l1 - l2
            m = (l1 >= -.02) & (l2 >= -.02) & (l3 >= -.02)
            if m.any(): y = l1 * pa[1] + l2 * pb[1] + l3 * pc[1]; sub = Hg[j0:j1 + 1, i0:i1 + 1]; sub[m] = np.where(np.isnan(sub[m]), y[m], np.maximum(sub[m], y[m]))
    if n not in GROUND:                          # estruturas e pista ocupam o chão
        ps = ((P[tt][:, :, [0, 2]] - [X0, Z0]) / RES).astype(np.int32)
        for q in ps: cv2.fillConvexPoly(occ, q, 1)
print('terreno com altura: %.0f%%  ocupado por estruturas/pista: %.1f%%' % (100 * (~np.isnan(Hg)).mean(), 100 * occ.mean()))
# casas, pneus e árvores já existentes viram obstáculos
def stamp(xz, r):
    for x, z in xz:
        cv2.circle(occ, (int((x - X0) / RES), int((z - Z0) / RES)), max(1, int(r / RES)), 1, -1)
hs = np.fromfile(D('assets/houses/inst.bin'), np.float32).reshape(-1, 6); stamp(hs[:, [0, 2]], 12)
if os.path.exists(D('assets/tires/inst.bin')): stamp(np.fromfile(D('assets/tires/inst.bin'), np.float32).reshape(-1, 6)[:, [0, 2]], 2.5)
stamp(base[:, [0, 2]], 3.5)
dist = ndi.distance_transform_edt(occ == 0) * RES      # m até a estrutura/pista mais próxima
# ruído de baixa frequência para clareiras e tipos de mata
def noise(x, z, seed):
    r = np.random.default_rng(seed); ph = r.uniform(0, 6.283, (4, 2)); k = [.006, .013, .029, .061]; a = [1, .6, .35, .2]; o = 0
    for i in range(4): o = o + a[i] * np.sin(x * k[i] + ph[i, 0]) * np.cos(z * k[i] * 1.13 + ph[i, 1])
    return (o / 2.15 + 1) / 2
rng = np.random.default_rng(11); out = []
WT = {'sm_redwoodgrp': 1, 'veg_palm04': 1, 'vgs_palm01': 1, 'veg_palm02': 1, 'new_bushtest': 1}
def pick(patch):          # patch<.4 pinheiral, <.75 coqueiral, resto misto
    w = np.array([{.0: 0}.get(0, 0)] * 5, float)
    pine, p4, p1, p2, bush = [MI[k] for k in ('sm_redwoodgrp', 'veg_palm04', 'vgs_palm01', 'veg_palm02', 'new_bushtest')]
    if patch < .4: w[pine] = .66; w[bush] = .2; w[p1] = .07; w[p4] = .07
    elif patch < .75: w[pine] = .1; w[bush] = .16; w[p1] = .26; w[p4] = .24; w[p2] = .24
    else: w[pine] = .34; w[bush] = .18; w[p1] = .16; w[p4] = .16; w[p2] = .16
    return int(rng.choice(5, p=w / w.sum()))
xs = np.arange(X0 + CELL / 2, X1, CELL); zs = np.arange(Z0 + CELL / 2, Z1, CELL)
for z in zs:
    for x in xs:
        x += rng.uniform(-CELL * .38, CELL * .38); zz = z + rng.uniform(-CELL * .38, CELL * .38)
        i = int((x - X0) / RES); j = int((zz - Z0) / RES)
        if not (0 <= i < NX and 0 <= j < NZ): continue
        d = dist[j, i]; h = Hg[j, i]
        if d < 7 or d > 88 or np.isnan(h) or h < 3.2 or occ[j, i]: continue
        dens = noise(x, zz, 3); fall = 1.0 if d < 62 else max(0., 1 - (d - 62) / 26)
        if dens < .42 or rng.random() > min(1, (dens - .32) * 2.2) * fall: continue       # clareiras
        mdl = pick(noise(x, zz, 9)); sc = rng.uniform(.85, 1.3) if names[mdl] == 'sm_redwoodgrp' else rng.uniform(.85, 1.25)
        out.append((x, h - .05, zz, rng.uniform(0, 6.283), sc, mdl))
out = np.array(out, np.float32)
if len(out) > MAXN: out = out[rng.choice(len(out), MAXN, replace=False)]
allin = np.concatenate([base, out]); allin.tofile(D('assets/trees/inst.bin'))
tj['n'] = int(len(allin)); json.dump(tj, open(D('data/trees.json'), 'w'), separators=(',', ':'))
print('floresta: +%d árvores (total %d)' % (len(out), len(allin)), {n: int((out[:, 5] == i).sum()) for n, i in MI.items()})
