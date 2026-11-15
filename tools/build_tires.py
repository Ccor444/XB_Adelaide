#!/usr/bin/env python3
"""Pilhas de pneus 3D (Old_Tires_PBR: tires with floor.fbx + texturas BaseColor) nos cantos da pista.
Uso: python3 tools/build_tires.py <pasta Old_Tires_PBR> [pasta_do_jogo]
 - lê os 4 pneus do FBX (grosso, fino, padrão, liso), deita cada um (eixo vertical) e normaliza para ~0,8 m de diâmetro;
 - acha as curvas mais fechadas da linha de corrida, encontra a parede (.phy) do lado de fora e encosta uma fileira de pilhas de 3 pneus nela;
 - grava assets/tires/*, data/tires.json (modelos, instâncias e segmentos de colisão da barreira)."""
import sys, os, json, math, base64
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwfbx
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else '.'
D = lambda *a: os.path.join(dst, *a); os.makedirs(D('assets', 'tires'), exist_ok=True)
DIAM = .8; NCORNER = 7; HALFLEN = 15.0; STACK = 3; SPACING = .8
# ---------------- FBX -> modelos
top = rwfbx.parse(os.path.join(src, 'tires with floor.fbx'))
obj = [n for n in top if n.name == 'Objects'][0]; con = [n for n in top if n.name == 'Connections'][0]
byid = {c.props[0]: c for c in obj.children}
link = {}
for c in con.children:
    if c.props[0] == 'OO': link.setdefault(c.props[2], []).append(c.props[1])
nm = lambda n: n.props[1].split('\0')[0]
models = [c for c in obj.children if c.name == 'Model' and nm(c).startswith('tire')]
def tri(g):
    v = g.first('Vertices').props[0].reshape(-1, 3); pv = g.first('PolygonVertexIndex').props[0].astype(np.int64)
    ln = g.first('LayerElementNormal'); lu = g.first('LayerElementUV')
    N = ln.first('Normals').props[0].reshape(-1, 3); ni = ln.first('NormalsIndex'); ni = ni.props[0] if ni else None
    U = lu.first('UV').props[0].reshape(-1, 2); ui = lu.first('UVIndex').props[0]
    out = []; cur = []; pos = 0
    for k, i in enumerate(pv):
        end = i < 0; vi = (~i) if end else i; cur.append((vi, k)); 
        if end:
            for j in range(1, len(cur) - 1): out += [cur[0], cur[j], cur[j + 1]]
            cur = []
    P = np.array([v[a] for a, _ in out]); Nn = np.array([N[ni[k] if ni is not None and len(ni) == len(pv) else k] for _, k in out])
    UV = np.array([U[ui[k]] for _, k in out]); return P, Nn, UV
TEXFILE = {'tire thick lines': 'tire thick lines', 'tire thin line': 'tire thin line', 'tire plain': 'tire plain', 'tire pattern': 'tire pattern'}
VB = []; MODS = []; TEX = {}; vtot = 0
for m in models:
    g = byid[[i for i in link[m.props[0]] if byid[i].name == 'Geometry'][0]]; mat = byid[[i for i in link[m.props[0]] if byid[i].name == 'Material'][0]]
    mname = nm(mat); P, Nn, UV = tri(g)
    k = DIAM / (P[:, 1].max() - P[:, 1].min())
    gp = np.c_[P[:, 1], P[:, 0], P[:, 2]] * k; gp[:, 1] -= gp[:, 1].min()          # eixo do pneu (x) -> vertical; base em y=0
    gn = np.c_[Nn[:, 1], Nn[:, 0], Nn[:, 2]]; gn /= np.linalg.norm(gn, axis=1, keepdims=True) + 1e-9
    vb = np.zeros(len(gp), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4)])
    vb['p'] = gp; vb['uv'] = np.c_[UV[:, 0], 1 - UV[:, 1]]; vb['n'][:, :3] = np.clip(np.round(gn * 127), -127, 127)
    f = 'tires with floor_%s_BaseColor.1001.png' % mname
    if mname not in TEX:
        im = Image.open(os.path.join(src, 'PBR', f)).convert('RGB').resize((512, 512), Image.LANCZOS)
        im.save(D('assets/tires/%s.webp' % mname.replace(' ', '_')), quality=84, method=6); TEX[mname] = {'$file': 'assets/tires/%s.webp' % mname.replace(' ', '_')}
    MODS.append(dict(name=nm(m), tex=mname, start=vtot, count=len(gp), h=round(float(gp[:, 1].max()), 3), w=round(float(max(np.ptp(gp[:, 0]), np.ptp(gp[:, 2]))), 3)))
    VB.append(vb); vtot += len(gp)
    print('  %-6s %-17s %5d tris  %.2f x %.2f m' % (nm(m), mname, len(gp) // 3, MODS[-1]['w'], MODS[-1]['h']))
np.concatenate(VB).tofile(D('assets/tires/tires.vb.bin'))
# ---------------- linha de corrida e paredes
ext = json.load(open(D('data/ext.json'))); AIP = np.array(ext['ai'], np.float64); NN = len(AIP)
seg = np.hypot(*(np.roll(AIP, -1, 0)[:, [0, 2]] - AIP[:, [0, 2]]).T); cum = np.r_[0, np.cumsum(seg)]; LAP = cum[-1]
def spl(s):
    s %= LAP; i = int(np.searchsorted(cum, s, 'right') - 1); i = min(i, NN - 1); t = (s - cum[i]) / seg[i]
    p0, p1, p2, p3 = AIP[(i - 1) % NN], AIP[i], AIP[(i + 1) % NN], AIP[(i + 2) % NN]; t2 = t * t; t3 = t2 * t
    f = lambda k: .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
    d = lambda k: .5 * ((-p0[k] + p2[k]) + 2 * (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t + 3 * (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t2)
    tx, tz = d(0), d(2); l = math.hypot(tx, tz) or 1
    return f(0), f(1), f(2), tx / l, tz / l, p1[4] + (p2[4] - p1[4]) * t, p1[5] + (p2[5] - p1[5]) * t
def phy():
    P = ext['phy']; rd = lambda x: open(D(x['$file']), 'rb').read() if isinstance(x, dict) else base64.b64decode(x)
    v = np.frombuffer(rd(P['v']), np.float32).reshape(-1, 3); i = np.frombuffer(rd(P['i']), np.uint16).reshape(-1, 3); return v, i
v, ii = phy(); A, B, C = v[ii[:, 0]], v[ii[:, 1]], v[ii[:, 2]]; n = np.cross(B - A, C - A); ny = np.abs(n[:, 1]) / (np.linalg.norm(n, axis=1) + 1e-9)
W = []
for a, b, c in zip(A[ny < .35], B[ny < .35], C[ny < .35]):
    t = np.array([a, b, c]); 
    if t[:, 1].max() - t[:, 1].min() < .35: continue
    best = (-1, 0, 1)
    for p in range(3):
        for q in range(p + 1, 3):
            dd = math.hypot(t[p, 0] - t[q, 0], t[p, 2] - t[q, 2])
            if dd > best[0]: best = (dd, p, q)
    if best[0] < .05: continue
    pa, pb = t[best[1]], t[best[2]]
    for u in np.linspace(0, 1, max(2, int(best[0] / .5) + 1)): W.append((pa[0] + (pb[0] - pa[0]) * u, pa[2] + (pb[2] - pa[2]) * u))
wt = cKDTree(np.array(W)); print('pontos de parede:', len(W))
def wall_dist(s, side):   # distância lateral (m) até a parede do lado `side` (+1 direita, -1 esquerda)
    x, y, z, tx, tz, wl, wr = spl(s); rx, rz = tz * side, -tx * side
    for d in np.arange(2.0, 30.0, .25):
        if wt.query([x + rx * d, z + rz * d])[0] < .6: return d
    return None
# ---------------- curvas mais fechadas
ss = np.arange(0, LAP, 2.0); th = np.array([math.atan2(spl(s)[3], spl(s)[4]) for s in ss])
wr_ = lambda a: (a + math.pi) % (2 * math.pi) - math.pi
turn = np.array([wr_(th[(i + 15) % len(ss)] - th[(i - 15) % len(ss)]) for i in range(len(ss))])
order = np.argsort(-np.abs(turn)); picks = []
for i in order:
    if abs(turn[i]) < math.radians(35): break
    if all(min(abs(ss[i] - ss[j]), LAP - abs(ss[i] - ss[j])) > 130 for j in picks): picks.append(i)
print('curvas candidatas:', len(picks))
inst = []; segs = []; fence = []; rng = np.random.default_rng(7); done = 0
WGT = np.array([.65, .25, .06, .04]); NAMES = [m['name'] for m in MODS]
order_names = {'tire4': .65, 'tire2': .25, 'tire1': .06, 'tire3': .04}; wgt = np.array([order_names.get(n_, .05) for n_ in NAMES]); wgt /= wgt.sum()
for i in picks:
    if done >= NCORNER: break
    s0 = ss[i]; side = -1 if turn[i] > 0 else 1          # curva p/ direita (th cresce) -> lado de fora = esquerda
    cols = np.arange(s0 - HALFLEN, s0 + HALFLEN, SPACING); dw = [wall_dist(s, side) for s in cols]
    ok = [d for d in dw if d is not None]
    x0, y0, z0, tx0, tz0, wl0, wr0 = spl(s0)
    dmed = np.median(ok) if (len(ok) >= len(cols) * .5 and np.median(ok) < 14) else (wl0 if side < 0 else wr0) + 4.5     # sem parede por perto: fora da pista, na grama
    dw = np.array([d if d is not None else dmed for d in dw])
    k = np.ones(5) / 5; dws = np.convolve(np.pad(dw, 2, mode='edge'), k, 'valid')
    front = []; back = []
    for s, d in zip(cols, dws):
        x, y, z, tx, tz, wl, wr = spl(s); rx, rz = tz * side, -tx * side; dc = d - .6 - DIAM / 2   # centro do pneu: encostado, com folga da parede
        cx, cz = x + rx * dc, z + rz * dc; fx, fz = x + rx * (dc - DIAM / 2), z + rz * (dc - DIAM / 2); front.append((fx, fz, y))
        back.append((x + rx * (dc + DIAM / 2 + .12), z + rz * (dc + DIAM / 2 + .12), y - .05, -rx, -rz))   # grade logo atrás dos pneus, virada p/ a pista
        ya = y - .05
        for h in range(STACK):
            mdl = int(rng.choice(len(MODS), p=wgt)); jx, jz = rng.normal(0, .035, 2)
            inst.append((cx + jx, ya, cz + jz, rng.uniform(0, 6.283), rng.uniform(.97, 1.03), mdl)); ya += MODS[mdl]['h'] * .97
    for a, b in zip(front[:-1], front[1:]): segs += [a[0], a[1], b[0], b[1], min(a[2], b[2]) - .1, max(a[2], b[2]) + STACK * .26 - .1]
    fence.append([[round(float(v), 3) for v in b] for b in back[::3] + ([back[-1]] if (len(back) - 1) % 3 else [])]); done += 1; print('  curva em s=%.0f m  (%.0f°)  parede a %.1f m  -> %d pneus' % (s0, math.degrees(turn[i]), dmed, len(cols) * STACK))
inst = np.array(inst, np.float32); inst.tofile(D('assets/tires/inst.bin'))
json.dump({'vb': {'$file': 'assets/tires/tires.vb.bin'}, 'models': MODS, 'tex': TEX, 'inst': {'$file': 'assets/tires/inst.bin'}, 'n': len(inst), 'far': 260,
           'segs': [round(x, 3) for x in segs]}, open(D('data/tires.json'), 'w'), separators=(',', ':'))
json.dump(fence, open(D('assets/tires/fence.json'), 'w'), separators=(',', ':'))
print('pneus:', len(inst), 'curvas:', done, 'grades:', len(fence))
