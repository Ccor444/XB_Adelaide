#!/usr/bin/env python3
"""Validação do layout (casas, ruínas, pedestres, árvores) contra a malha real da pista. Roda por ÚLTIMO (depois de build_terrain.py). Idempotente.
Remove/corrige:
 - casas/ruínas sobre asfalto, concreto, água; atravessando mureta/cerca; perto da linha de corrida; em terreno íngreme; coladas em outras casas
 - altura (y) das casas = chão real (malha visível ou terreno de preenchimento)
 - pedestres em cima do asfalto, perto demais da linha de corrida, dentro de casas, ou aglomerados demais
 - árvores em cima do asfalto / dentro de casas
Uso: python3 -I tools/build_layout.py [pasta]"""
import sys, os, json, math, re
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ground import *
from scipy.spatial import cKDTree
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
J = lambda *a: os.path.join(dst, *a)
t, V, I = load_track(dst); P = V['p']; nm = t['texnames']
GRASS = re.compile(r'^(gras|grava|grav|green)'); PAVE = re.compile(r'^(road|rmbld|rumbl|ba_rumbl|side0|bridgund|lake)')
tg, tp, tw = [], [], []
for g in t['groups']:
    if g.get('fill') or g['cat'] == 'shadow': continue
    s = I[g['off']:g['off'] + g['cnt']]; s = s[:len(s) // 3 * 3].reshape(-1, 3).astype(int); name = nm[g['tex']]
    a, b, c = P[s[:, 0]], P[s[:, 1]], P[s[:, 2]]; n = np.cross(b - a, c - a); L = np.linalg.norm(n, axis=1) + 1e-9; ny = np.abs(n[:, 1]) / L
    if g['cat'] == 'opaque':
        up = s[ny > .8]
        if GRASS.match(name): tg.append(up)
        elif not re.search(r'tree|lamp|pole|cone|olive|shado|jumbo|cwin|roof|bldng|tent|canv|truck|tral|tire|crane|cran', name):
            (tp if PAVE.match(name) or name.startswith('conc') else tg).append(up) if (PAVE.match(name) or name.startswith('conc')) else None
    vert = s[(ny < .45) & (np.abs(a[:, 1] - c[:, 1]) + np.abs(b[:, 1] - c[:, 1]) > 0)]
    if len(vert) and not re.search(r'tree|olive|shado|green', name): tw.append(vert)
RG = Raster(P, np.concatenate(tg)); RP = Raster(P, np.concatenate(tp)) if tp else None
# paredes/cercas: marca as células (1 m) cobertas por triângulos verticais com altura > .4 m
wall = np.zeros((RG.NX, RG.NZ), bool); WY = np.full((RG.NX, RG.NZ), np.nan, np.float32)
for s in np.concatenate(tw):
    pts = P[s]; hgt = pts[:, 1].max() - pts[:, 1].min()
    if hgt < .4: continue
    for e in ((0, 1), (1, 2), (2, 0)):
        p0, p1 = pts[e[0]], pts[e[1]]; k = max(2, int(math.hypot(p1[0] - p0[0], p1[2] - p0[2]) / .5) + 1)
        for f in np.linspace(0, 1, k):
            i = int(round((p0[0] + (p1[0] - p0[0]) * f - RG.X0) / RG.R)); j = int(round((p0[2] + (p1[2] - p0[2]) * f - RG.Z0) / RG.R))
            if 0 <= i < RG.NX and 0 <= j < RG.NZ: wall[i, j] = True; WY[i, j] = pts[:, 1].min() if np.isnan(WY[i, j]) else min(WY[i, j], pts[:, 1].min())
# terreno de preenchimento (grade não uniforme gravada no fim da malha)
fl = [g for g in t['groups'] if g.get('fill')]
if fl:
    FV = P[fl[0]['v0']:]; xs = np.unique(FV[:, 0]); zs = np.unique(FV[:, 2]); FH = np.zeros((len(xs), len(zs)), np.float32)
    FH[np.searchsorted(xs, FV[:, 0]), np.searchsorted(zs, FV[:, 2])] = FV[:, 1]
def fillh(x, z):
    if not fl or not (xs[0] <= x <= xs[-1] and zs[0] <= z <= zs[-1]): return np.nan
    a = min(max(np.searchsorted(xs, x) - 1, 0), len(xs) - 2); b = min(max(np.searchsorted(zs, z) - 1, 0), len(zs) - 2)
    u = (x - xs[a]) / (xs[a + 1] - xs[a]); v = (z - zs[b]) / (zs[b + 1] - zs[b])
    return FH[a, b] * (1 - u) * (1 - v) + FH[a + 1, b] * u * (1 - v) + FH[a, b + 1] * (1 - u) * v + FH[a + 1, b + 1] * u * v
def ground(x, z, yref):
    g = RG.at(x, z, yref); return g if not np.isnan(g) else fillh(x, z)
def paved(x, z, yref, tol=1.2):
    if RP is None: return False
    g = RP.at(x, z, yref); return (not np.isnan(g)) and abs(g - yref) < tol
def walled(x, z, pad=0):
    i = int(round((x - RG.X0) / RG.R)); j = int(round((z - RG.Z0) / RG.R))
    return 0 <= i < RG.NX and 0 <= j < RG.NZ and bool(wall[max(i - pad, 0):i + pad + 1, max(j - pad, 0):j + pad + 1].any())
ai = np.array(json.load(open(J('data', 'ext.json')))['ai'])[:, [0, 2]]; aitree = cKDTree(ai)

# ------------------------------------------------------------------ casas
H = json.load(open(J('data', 'houses.json'))); inst = np.fromfile(J('assets', 'houses', 'inst.bin'), np.float32).reshape(-1, 6).copy()
VB = np.fromfile(J('assets', 'houses', 'houses.vb.bin'), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4), ('c', 'u1', 4)])['p']
IB = np.fromfile(J('assets', 'houses', 'houses.ib.bin'), np.uint16); BB = []
for m in H['models']:
    idx = np.unique(np.concatenate([IB[p['start']:p['start'] + p['count']] for p in m['parts']])); BB.append((VB[idx].min(0), VB[idx].max(0)))
def rect(h):
    lo, hi = BB[int(h[5])]; c, s = math.cos(h[3]), math.sin(h[3]); sc = h[4]; cx = (lo[0] + hi[0]) / 2; cz = (lo[2] + hi[2]) / 2
    return (h[0] + (cx * c + cz * s) * sc, h[2] + (-cx * s + cz * c) * sc, (hi[0] - lo[0]) / 2 * sc, (hi[2] - lo[2]) / 2 * sc, c, s)
def samples(R_, step=1.0, pad=0.0):
    cx, cz, hx, hz, c, s = R_; a = np.arange(-hx - pad, hx + pad + .01, step); b = np.arange(-hz - pad, hz + pad + .01, step); A_, B_ = np.meshgrid(a, b, indexing='ij')
    return np.c_[cx + A_.ravel() * c + B_.ravel() * s, cz - A_.ravel() * s + B_.ravel() * c]
def inrect(R_, x, z, pad=0.0):
    cx, cz, hx, hz, c, s = R_; dx = x - cx; dz = z - cz; return (np.abs(dx * c - dz * s) < hx + pad) & (np.abs(dx * s + dz * c) < hz + pad)
ruin_ids = {i for i, m in enumerate(H['models']) if m['name'].startswith('des_ruin')}
keep = np.ones(len(inst), bool); why = {}; RC = [rect(h) for h in inst]; ct = cKDTree(np.array(RC)[:, :2])
order = sorted(range(len(inst)), key=lambda i: (int(inst[i, 5]) in ruin_ids, i))        # casas têm prioridade sobre ruínas
for i in order:
    h = inst[i]; R_ = RC[i]; S = samples(R_, 1.0); Sp = samples(R_, 1.0, 1.0); ruin = int(h[5]) in ruin_ids
    gs = np.array([ground(x, z, h[1]) for x, z in S]); ok = ~np.isnan(gs)
    if ok.sum() < len(gs) * .98: keep[i] = False; why[i] = 'sem chão'; continue
    if gs.max() - gs.min() > 1.8: keep[i] = False; why[i] = 'terreno íngreme %.1f m' % (gs.max() - gs.min()); continue
    y = float(np.median(gs))
    if any(paved(x, z, y) for x, z in S): keep[i] = False; why[i] = 'sobre asfalto/concreto/água'; continue
    if any(walled(x, z, 0) for x, z in Sp): keep[i] = False; why[i] = 'atravessa mureta/cerca'; continue
    if aitree.query(Sp)[0].min() < (16 if ruin else 11): keep[i] = False; why[i] = 'perto da linha de corrida'; continue
    for j in ct.query_ball_point(R_[:2], 40):
        if j != i and keep[j] and (j < i or True) and (inrect(RC[j], S[:, 0], S[:, 1], 1.5).any() or inrect(R_, samples(RC[j], 1.0)[:, 0], samples(RC[j], 1.0)[:, 1], 1.5).any()):
            keep[i] = False; why[i] = 'colada em outra casa'; break
    if not keep[i]: continue
    if abs(h[1] - y) > .3: inst[i, 1] = y                                      # base no chão real
print('casas: %d -> %d' % (len(inst), keep.sum()))
from collections import Counter
print(' removidas por:', dict(Counter(re.sub(r'[\d.]+ m', '', v) for v in why.values())))
inst2 = inst[keep]; inst2.tofile(J('assets', 'houses', 'inst.bin')); H['n'] = int(len(inst2)); json.dump(H, open(J('data', 'houses.json'), 'w'), separators=(',', ':'))
RC2 = [rect(h) for h in inst2]; ct2 = cKDTree(np.array(RC2)[:, :2])
def in_house(x, z, pad=0.0):
    for j in ct2.query_ball_point([x, z], 30):
        if inrect(RC2[j], x, z, pad): return True
    return False

# ------------------------------------------------------------------ árvores
Tr = np.fromfile(J('assets', 'trees', 'inst.bin'), np.float32).reshape(-1, 6); kt = np.ones(len(Tr), bool)
for i, q in enumerate(Tr):
    g = ground(q[0], q[2], q[1])
    if in_house(q[0], q[2], 1.0) or paved(q[0], q[2], q[1] if np.isnan(g) else g) or aitree.query([q[0], q[2]])[0] < 7: kt[i] = False
print('árvores: %d -> %d' % (len(Tr), kt.sum())); Tr[kt].tofile(J('assets', 'trees', 'inst.bin'))
tj = json.load(open(J('data', 'trees.json'))); tj['n'] = int(kt.sum()); json.dump(tj, open(J('data', 'trees.json'), 'w'), separators=(',', ':'))

# ------------------------------------------------------------------ pedestres
PO = np.fromfile(J('assets', 'peds', 'people.bin'), np.float32).reshape(-1, 8).copy(); WK = np.fromfile(J('assets', 'peds', 'walk.bin'), np.float32).reshape(-1, 14).copy()
rng = np.random.RandomState(5); kp = np.ones(len(PO), bool); pw = {}
dai = aitree.query(PO[:, [0, 2]])[0]
for i, q in enumerate(PO):
    g = ground(q[0], q[2], q[1])
    if np.isnan(g): kp[i] = False; pw[i] = 'sem chão'; continue
    if dai[i] < 7.0: kp[i] = False; pw[i] = 'perto da linha de corrida'; continue
    if paved(q[0], q[2], g, .7) and dai[i] < 16: kp[i] = False; pw[i] = 'sobre asfalto'; continue
    if in_house(q[0], q[2], .8): kp[i] = False; pw[i] = 'dentro de casa'; continue
    PO[i, 1] = g
# densidade: no máximo CAP pedestres por célula de 8x8 m
CAPC = int(os.environ.get('PEDCAP', 6)); cell = {}
for i in rng.permutation(len(PO)):
    if not kp[i]: continue
    k = (int(PO[i, 0] // 8), int(PO[i, 2] // 8)); cell[k] = cell.get(k, 0) + 1
    if cell[k] > CAPC: kp[i] = False; pw[i] = 'aglomerado'
# teto de população: parados e andando contados à parte; pares (conversa) saem juntos
MAXS = int(os.environ.get('PEDMAX', 620)); MAXW = int(os.environ.get('WALKMAX', 220))
for walking, cap_ in ((False, MAXS), (True, MAXW)):
    idx = [i for i in rng.permutation(len(PO)) if kp[i] and (WK[i, 12] > 0) == walking]; tot = 0; seen = set()
    for i in idx:
        if i in seen: continue
        grp = [i]; pn = int(PO[i, 6])
        if 0 <= pn < len(PO) and kp[pn] and pn != i: grp.append(pn)
        seen.update(grp)
        if tot + len(grp) <= cap_: tot += len(grp)
        else:
            for g_ in grp: kp[g_] = False; pw[g_] = 'limite de população'
print('pedestres: %d -> %d' % (len(PO), kp.sum()), dict(Counter(pw.values())))
remap = -np.ones(len(PO), np.int64); remap[kp] = np.arange(kp.sum()); P2 = PO[kp].copy(); W2 = WK[kp].copy()
for i in range(len(P2)):
    pn = int(P2[i, 6]); P2[i, 6] = remap[pn] if 0 <= pn < len(PO) and kp[pn] else -1
for i in range(len(P2)):                                                       # quem perdeu o par pode andar? não: segue parado (sem rota nova)
    W2[i, 0:3] = [P2[i, 0], P2[i, 2], P2[i, 1]] if W2[i, 12] <= 0 else W2[i, 0:3]
P2.tofile(J('assets', 'peds', 'people.bin')); W2.tofile(J('assets', 'peds', 'walk.bin'))
pj = json.load(open(J('data', 'peds.json'))); pj['people']['n'] = int(len(P2)); pj['walk']['n'] = int(len(P2)); json.dump(pj, open(J('data', 'peds.json'), 'w'), separators=(',', ':'))
print('andando livremente:', int((W2[:, 12] > 0).sum()))
