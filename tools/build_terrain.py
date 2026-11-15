#!/usr/bin/env python3
"""Terreno de preenchimento: a malha visível da pista tem buracos (miolo do circuito, bordas onde ficam as casas) e termina no vazio.
Gera uma malha de grama que cobre tudo até além do horizonte, sempre ABAIXO da malha existente (sem z-fighting), e a acrescenta ao
fim de track.vb/ib + um grupo 'fill' em trk.json. Roda DEPOIS de build_stands/build_lod/fix_textures (que reescrevem a malha). Idempotente.
Uso: python3 -I tools/build_terrain.py [pasta]"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ground import *
from scipy.ndimage import minimum_filter, uniform_filter
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
t, V, I = load_track(dst)
fill = [g for g in t['groups'] if g.get('fill')]
if fill:                                       # desfaz o preenchimento anterior
    f = fill[0]; V = V[:f['v0']]; I = I[:f['off']]; t['groups'] = [g for g in t['groups'] if not g.get('fill')]
nv0 = len(V); ni0 = len(I)
T = ground_tris(t, V, I, skip_fill=False); P = V['p']
Ra = Raster(P, T); LO = Ra.LO
# grade não uniforme: fina na região do circuito, grossa até o horizonte
def ticks(a, b, c, d, fine, coarse, lim):
    return np.unique(np.concatenate([np.arange(-lim, a, coarse), np.arange(a, b + .1, fine), np.arange(b, lim + .1, coarse)]))
xs = ticks(-840, 660, 0, 0, 24, 200, 2600); zs = ticks(-660, 720, 0, 0, 24, 200, 2600)
NXg, NZg = len(xs), len(zs); print('grade', NXg, 'x', NZg, '=', NXg * NZg, 'vértices')
assert nv0 + NXg * NZg < 65500, 'estoura índices uint16'
# alturas conhecidas: mínimo local (±14 m) - margem
win = 29
mn = minimum_filter(np.where(np.isnan(LO), 1e9, LO), size=win, mode='nearest'); mn[mn > 1e8] = np.nan
H = np.full((NXg, NZg), np.nan, np.float32); known = np.zeros((NXg, NZg), bool)
for a, x in enumerate(xs):
    for b, z in enumerate(zs):
        i = int(round((x - Ra.X0) / Ra.R)); j = int(round((z - Ra.Z0) / Ra.R))
        if 0 <= i < Ra.NX and 0 <= j < Ra.NZ and not np.isnan(mn[i, j]):
            # só confia se há cobertura perto (evita pegar uma ilha isolada de telhado)
            H[a, b] = mn[i, j] - 0.6; known[a, b] = True
base = float(np.nanmedian(H)); print('altura mediana conhecida %.1f' % base, '| vértices conhecidos', int(known.sum()))
Hf = np.where(known, H, base).astype(np.float64)
for _ in range(6000):                          # relaxação harmônica: preenche os buracos de forma suave
    N = Hf.copy(); N[1:-1, 1:-1] = .25 * (Hf[2:, 1:-1] + Hf[:-2, 1:-1] + Hf[1:-1, 2:] + Hf[1:-1, :-2]); N[known] = Hf[known]; Hf = N
# garante ficar abaixo da malha: confere em todos os pixels cobertos e abaixa vértices que furam
def interp(x, z):
    a = np.clip(np.searchsorted(xs, x) - 1, 0, NXg - 2); b = np.clip(np.searchsorted(zs, z) - 1, 0, NZg - 2)
    u = (x - xs[a]) / (xs[a + 1] - xs[a]); v = (z - zs[b]) / (zs[b + 1] - zs[b])
    return (Hf[a, b] * (1 - u) * (1 - v) + Hf[a + 1, b] * u * (1 - v) + Hf[a, b + 1] * (1 - u) * v + Hf[a + 1, b + 1] * u * v), a, b
ii, jj = np.where(~np.isnan(LO)); xw = Ra.X0 + ii * Ra.R; zw = Ra.Z0 + jj * Ra.R; lo = LO[ii, jj]
for it in range(40):
    h, a, b = interp(xw, zw); bad = h > lo - .15
    if not bad.any(): break
    d = h[bad] - (lo[bad] - .3)
    for k, (aa, bb) in enumerate(zip(a[bad], b[bad])):
        for da in (0, 1):
            for db in (0, 1): Hf[aa + da, bb + db] = min(Hf[aa + da, bb + db], Hf[aa + da, bb + db] - d[k])
    print('iter', it, 'furos', int(bad.sum()))
print('altura final: min %.1f max %.1f' % (Hf.min(), Hf.max()))
# malha
gx, gz = np.meshgrid(xs, zs, indexing='ij')
nv = np.zeros(NXg * NZg, DT); nv['p'] = np.c_[gx.ravel(), Hf.ravel(), gz.ravel()]; nv['n'] = (0, 127, 0); nv['c'] = 255; nv['uv'] = np.c_[gx.ravel() * .1, gz.ravel() * .1]
idx = np.arange(NXg * NZg).reshape(NXg, NZg); a = idx[:-1, :-1].ravel(); b = idx[1:, :-1].ravel(); c = idx[1:, 1:].ravel(); d = idx[:-1, 1:].ravel()
WIND = os.environ.get('WIND', 'a')
tri = np.concatenate([np.c_[a, d, b], np.c_[b, d, c]]) if WIND == 'a' else np.concatenate([np.c_[a, b, d], np.c_[b, c, d]])
tri = (tri + nv0).astype(np.uint16).ravel()
gras = t['texnames'].index('gras.dds')
t['groups'].append({'tex': gras, 'cat': 'opaque', 'off': ni0, 'cnt': int(len(tri)), 'fill': 1, 'v0': nv0})
np.concatenate([V.view(np.uint8).ravel(), nv.view(np.uint8).ravel()]).tofile(os.path.join(dst, 'assets', 'track', 'track.vb.bin')); np.concatenate([I, tri]).tofile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'))
json.dump(t, open(os.path.join(dst, 'data', 'trk.json'), 'w'), separators=(',', ':'))
print('ok: +%d vértices, +%d triângulos' % (len(nv), len(tri) // 3))
