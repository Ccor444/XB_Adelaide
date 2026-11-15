#!/usr/bin/env python3
"""1) remove as árvores de mentira (sprites trebg1/olive1) da malha da pista;
   2) cria o mar no limite do mundo: rebaixa o terreno de preenchimento em praia + gera o mapa de profundidade (assets/sea/depth.png);
   3) monta o atlas de efeitos (fumaça, nuvens, fogo, explosão, faísca) a partir do particle.txd do GTA SA.
Uso: python3 tools/build_world_fx.py <particle.txd> [pasta_do_jogo]   (parte sempre do backup _orig_sea/, pode rodar de novo)"""
import sys, os, json, shutil, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwtxd
from scipy.spatial import cKDTree
txd = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else '.'
D = lambda *a: os.path.join(dst, *a)
SEA_Y = -1.5; SEA_BED = -4.5
FAKE = ('trebg1.dds', 'olive1.dds',                       # árvores de mentira (sprites)
        'tire.dds', 'tire03.dds', 'tirebig.dds', 'tire02.dds',   # pneus de mentira (os 3D vêm de build_tires.py)
        'tents.dds', 'tntbase.dds', 'canvsb.dds', 'canvsy.dds', 'canvsr.dds')   # barracas (as casas 3D ficam)
PORTAL = ('frame.dds', 'steps.dds', 'stepundr.dds', 'bridgund.dds', 'logotiss.dds', 'signbase.dds', 'bar03.dds', 'bar04.dds')   # portal/passarela da largada (e o guarda-corpo dela)
PBOX = (30., 200., 15., 95.)                              # x0,x1,z0,z1 do portal
os.makedirs(D('_orig_sea'), exist_ok=True); os.makedirs(D('assets', 'sea'), exist_ok=True)
for f, s in (('trk.json', D('data', 'trk.json')), ('track.vb.bin', D('assets/track/track.vb.bin')), ('track.ib.bin', D('assets/track/track.ib.bin'))):
    if not os.path.exists(D('_orig_sea', f)): shutil.copy(s, D('_orig_sea', f))
trk = json.load(open(D('_orig_sea/trk.json')))
VT = np.dtype([('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
vb = np.fromfile(D('_orig_sea/track.vb.bin'), VT); ib = np.fromfile(D('_orig_sea/track.ib.bin'), np.uint16)
names = trk['texnames']
# ---- 0) colisão das barracas: remove da malha .phy as paredes altas dentro da pegada das barracas (senão sobram paredes invisíveis)
from scipy import ndimage as ndi
for f in ('phy.i.bin', 'phy.f.bin'):
    if not os.path.exists(D('_orig_sea', f)): shutil.copy(D('assets/track', f), D('_orig_sea', f))
_ext = json.load(open(D('data/ext.json'))); _pv = np.fromfile(D('assets/track/phy.v.bin'), np.float32).reshape(-1, 3)
_pi = np.fromfile(D('_orig_sea/phy.i.bin'), np.uint16).reshape(-1, 3); _pf = np.fromfile(D('_orig_sea/phy.f.bin'), np.uint8)
_T = [ib[g['off']:g['off'] + g['cnt']].reshape(-1, 3) for g in trk['groups'] if names[g['tex']] in ('tents.dds', 'tntbase.dds')]
_T = np.concatenate(_T); _Q = vb['p'][_T].reshape(-1, 3); _x0, _z0 = _Q[:, 0].min() - 5, _Q[:, 2].min() - 5
_W = int(_Q[:, 0].max() - _x0 + 6); _H = int(_Q[:, 2].max() - _z0 + 6); _m = np.zeros((_H, _W), bool)
for _t in _T:
    _a = vb['p'][_t]; _xs = (_a[:, 0] - _x0).astype(int); _zs = (_a[:, 2] - _z0).astype(int); _m[_zs.min():_zs.max() + 1, _xs.min():_xs.max() + 1] = True
_m = ndi.binary_closing(_m, iterations=2)
_A, _B, _C = _pv[_pi[:, 0]], _pv[_pi[:, 1]], _pv[_pi[:, 2]]; _n = np.cross(_B - _A, _C - _A); _ny = np.abs(_n[:, 1]) / (np.linalg.norm(_n, axis=1) + 1e-9)
_cen = (_A + _B + _C) / 3; _hh = np.maximum.reduce([_A[:, 1], _B[:, 1], _C[:, 1]]) - np.minimum.reduce([_A[:, 1], _B[:, 1], _C[:, 1]])
_ix = (_cen[:, 0] - _x0).astype(int); _iz = (_cen[:, 2] - _z0).astype(int); _ok = (_ix >= 0) & (_ix < _W) & (_iz >= 0) & (_iz < _H)
_in = np.zeros(len(_cen), bool); _in[_ok] = _m[_iz[_ok], _ix[_ok]]
_drop = _in & (_ny < .35) & (_hh >= 1.8)
print('paredes de colisão das barracas removidas:', int(_drop.sum()), 'de', int((_in & (_ny < .35)).sum()), 'na pegada')
_keep = ~_drop; _pi[_keep].astype(np.uint16).tofile(D('assets/track/phy.i.bin')); _pf[_keep].tofile(D('assets/track/phy.f.bin'))
_ext['phy']['nt'] = int(_keep.sum()); json.dump(_ext, open(D('data/ext.json'), 'w'), separators=(',', ':'))
# ---- 1) árvores de mentira
groups = []; nib = []; off = 0; removed = 0
for g in trk['groups']:
    if names[g['tex']] in FAKE: removed += g['cnt'] // 3; continue
    seg = ib[g['off']:g['off'] + g['cnt']]
    if names[g['tex']] in PORTAL:
        tt = seg.reshape(-1, 3); c = vb['p'][tt].mean(1); m = (c[:, 0] > PBOX[0]) & (c[:, 0] < PBOX[1]) & (c[:, 2] > PBOX[2]) & (c[:, 2] < PBOX[3])
        removed += int(m.sum()); seg = tt[~m].reshape(-1)
        if len(seg) == 0: continue
    ng = dict(g); ng['off'] = off; ng['cnt'] = len(seg); off += len(seg); groups.append(ng); nib.append(seg)
print('triângulos removidos (árvores/pneus/barras/portal):', removed)
ib2 = np.concatenate(nib)
# ---- 1b) grade (alambrado) atrás das pilhas de pneus: usa a textura/estilo do fence.dds que já existe no jogo
FH = 3.2; TILE_V = 3.86; U_PER_M = .7 / 1.5                       # altura da grade; metros por repetição; repetições verticais por metro (igual à cerca original)
if os.path.exists(D('assets/tires/fence.json')) and 'fence.dds' in names:
    fti = names.index('fence.dds'); nv = []; ni = []; base = len(vb)
    for line in json.load(open(D('assets/tires/fence.json'))):
        vcum = 0.
        for a, b in zip(line[:-1], line[1:]):
            L = math.hypot(b[0] - a[0], b[1] - a[1]); 
            if L < .05: continue
            nx, nz = (a[3] + b[3]) / 2, (a[4] + b[4]) / 2; nl = math.hypot(nx, nz) or 1; nx, nz = nx / nl, nz / nl
            v0, v1 = -vcum / TILE_V, -(vcum + L) / TILE_V; vcum += L
            for side in (1, -1):               # dois lados (a cerca é alpha e pode ser vista de trás)
                q = [(a, 0, v0), (b, 0, v1), (a, FH, v0), (b, FH, v1)]; k = len(nv)
                for p_, hh, vv in q: nv.append((p_[0], p_[2] + hh, p_[1], nx * side, nz * side, hh * U_PER_M, vv))
                ni += [k, k + 1, k + 2, k + 2, k + 1, k + 3] if side > 0 else [k, k + 2, k + 1, k + 1, k + 2, k + 3]
    nvb = np.zeros(len(nv), VT)
    for i, (x, y, z, nx, nz, u, v) in enumerate(nv):
        nvb['p'][i] = (x, y, z); nvb['n'][i] = (int(nx * 127), 0, int(nz * 127), 0); nvb['c'][i] = (255, 255, 255, 255); nvb['uv'][i] = (u, v)
    vb = np.concatenate([vb, nvb]); assert len(vb) < 65535, len(vb)
    ib2 = np.concatenate([ib2, (np.array(ni, np.uint16) + base).astype(np.uint16)]); groups.append({'tex': fti, 'cat': 'alpha', 'off': len(ib2) - len(ni), 'cnt': len(ni)})
    print('grade atrás dos pneus: %d triângulos, %d trechos' % (len(ni) // 3, len(json.load(open(D('assets/tires/fence.json'))))))
# ---- 2) praia + mar
road = [];
for g in groups:
    if names[g['tex']].startswith(('road', 'ba_rumbl')): road.append(vb['p'][np.unique(ib2[g['off']:g['off'] + g['cnt']])])
road = np.concatenate(road); tree = cKDTree(road[:, [0, 2]])
fill = [g for g in groups if g.get('fill') and names[g['tex']] == 'gras.dds']
other = set()
for g in groups:
    if g in fill: continue
    other.update(np.unique(ib2[g['off']:g['off'] + g['cnt']]).tolist())
fv = set()
for g in fill: fv.update(np.unique(ib2[g['off']:g['off'] + g['cnt']]).tolist())
fv = np.array(sorted(fv - other)); P = vb['p'].copy()
x, z = P[fv, 0], P[fv, 2]; dist, _ = tree.query(np.c_[x, z])
R = 470 + 45 * np.sin(x * .0031 + 1.3) * np.cos(z * .0027) + 30 * np.sin(.0079 * x + .0061 * z)
s = np.clip((dist - R) / 140, 0, 1); s = s * s * (3 - 2 * s)
y0 = P[fv, 1]; P[fv, 1] = np.where(y0 > SEA_BED, y0 + (SEA_BED - y0) * s, y0)
print('vértices de terreno rebaixados:', int((s > 0).sum()), 'de', len(fv))
vb2 = vb.copy(); vb2['p'][:len(P)] = P
# mapa de profundidade (SEA_Y - altura do chão) a 5,6 m/texel
X0, X1, Z0, Z1 = -1500., 1400., -1300., 1450.; N = 512
H = np.full((N, N), np.nan, np.float32)
for g in groups:
    if names[g['tex']] not in ('gras.dds', 'lake.dds'): continue
    t = ib2[g['off']:g['off'] + g['cnt']].reshape(-1, 3)
    for a, b, c in t:
        pa, pb, pc = P[a], P[b], P[c]
        ux = lambda p: (p[0] - X0) / (X1 - X0) * (N - 1); uz = lambda p: (p[2] - Z0) / (Z1 - Z0) * (N - 1)
        xs = [ux(pa), ux(pb), ux(pc)]; zs = [uz(pa), uz(pb), uz(pc)]
        i0, i1 = max(0, int(np.floor(min(xs)))), min(N - 1, int(np.ceil(max(xs))))
        j0, j1 = max(0, int(np.floor(min(zs)))), min(N - 1, int(np.ceil(max(zs))))
        if i0 > i1 or j0 > j1: continue
        gx, gz = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1))
        d = (zs[1] - zs[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (zs[0] - zs[2])
        if abs(d) < 1e-9: continue
        l1 = ((zs[1] - zs[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gz - zs[2])) / d
        l2 = ((zs[2] - zs[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gz - zs[2])) / d; l3 = 1 - l1 - l2
        m = (l1 >= -.02) & (l2 >= -.02) & (l3 >= -.02)
        if m.any():
            y = l1 * pa[1] + l2 * pb[1] + l3 * pc[1]; sub = H[j0:j1 + 1, i0:i1 + 1]
            sub[m] = np.where(np.isnan(sub[m]), y[m], np.minimum(sub[m], y[m]))
H = np.where(np.isnan(H), SEA_BED, H)            # sem malha = fundo do mar
H[:6, :] = H[-6:, :] = SEA_BED; H[:, :6] = H[:, -6:] = SEA_BED
depth = np.clip((SEA_Y - H) * 40, 0, 255).astype(np.uint8)
Image.fromarray(depth, 'L').save(D('assets/sea/depth.png'), optimize=True)
print('mar: %.1f%% do mapa de profundidade' % ((depth > 0).mean() * 100))
vb2.tofile(D('assets/track/track.vb.bin')); ib2.astype(np.uint16).tofile(D('assets/track/track.ib.bin'))
KEEP_TEX = ('jumbo.dds',)                                  # usada por nome pelo jogo (painel animado)
groups = [g for g in groups if g['cnt'] > 0]; used = {g['tex'] for g in groups}; keep = [i for i in range(len(trk['tex'])) if i in used or names[i] in KEEP_TEX]
remap = {o: n for n, o in enumerate(keep)}; drop = [i for i in range(len(trk['tex'])) if i not in remap]
for g in groups: g['tex'] = remap[g['tex']]
freed = 0
for i in drop:
    f = trk['tex'][i]['d']['$file']
    if os.path.exists(D(f)): freed += os.path.getsize(D(f)); os.remove(D(f))
print('texturas removidas (sem uso): %d de %d  (%s)  -> %.1f MB liberados' % (len(drop), len(trk['tex']), ', '.join(names[i] for i in drop), freed / 1e6))
trk['tex'] = [trk['tex'][i] for i in keep]; trk['texnames'] = [names[i] for i in keep]
trk['groups'] = groups; json.dump(trk, open(D('data/trk.json'), 'w'), separators=(',', ':'))
# ---- 3) atlas de efeitos
tx = rwtxd.read_txd(txd)
CELLS = ['smokeii_3', 'collisionsmoke', 'bullethitsmoke', 'cloud1', 'cloud2', 'cloud3', 'flame1', 'flame5', 'explo01', 'explo02', 'explo03', 'explo04', 'explo05', 'explo06', 'spark', 'corona']
S = 256; atlas = Image.new('RGBA', (S * 4, S * 4), (0, 0, 0, 0))
for i, n in enumerate(CELLS):
    a = np.array(tx[n].resize((S, S), Image.LANCZOS))
    if (a[..., 3] >= 250).mean() > .9: a[..., 3] = np.clip(a[..., :3].max(-1).astype(np.float32) * 1.25, 0, 255).astype(np.uint8)  # fundo preto -> alpha pela luminância
    atlas.paste(Image.fromarray(a, 'RGBA'), ((i % 4) * S, (i // 4) * S))
atlas.save(D('assets/fx/fx_atlas.webp'), quality=88, method=6)
w = tx['waterclear256'].convert('L').resize((256, 256), Image.LANCZOS); w.save(D('assets/sea/water.webp'), quality=85)
fx = json.load(open(D('data/fx.json')))
fx['atlas'] = {'$file': 'assets/fx/fx_atlas.webp'}; fx['water'] = {'$file': 'assets/sea/water.webp'}; fx['depth'] = {'$file': 'assets/sea/depth.png'}
fx['sea'] = {'y': SEA_Y, 'x0': X0, 'x1': X1, 'z0': Z0, 'z1': Z1}
json.dump(fx, open(D('data/fx.json'), 'w'), separators=(',', ':')); print('ok')
