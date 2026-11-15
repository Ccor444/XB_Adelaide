#!/usr/bin/env python3
"""Troca o carvalho 3D da pista por vegetação do GTA SA (DFF + TXD): palmeiras, sequoias e arbusto.
Uso: python3 tools/build_gta_trees.py <pasta com .dff/.txd> [pasta_do_jogo]
 - lê todos os .dff/.txd da pasta; modelos são normalizados para metros (pés em y=0, altura-alvo em TARGET);
 - reaproveita as posições das árvores da pista (assets/trees/inst.bin; na 1ª execução vai para _orig_oak/positions.bin);
 - grava assets/trees/gta.* + data/trees.json (o motor desenha em js/game.js → drawTrees3)."""
import sys, os, json, glob, shutil, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwdff, rwtxd
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else '.'
OUT = os.path.join(dst, 'assets', 'trees'); os.makedirs(OUT, exist_ok=True)
ORIG = os.path.join(dst, '_orig_oak'); os.makedirs(ORIG, exist_ok=True)
if not os.path.exists(ORIG + '/positions.bin'): shutil.copy(OUT + '/inst.bin', ORIG + '/positions.bin')
# nome do .dff -> (altura-alvo em m [None = usa largura], largura-alvo, peso de sorteio, balanço)
TARGET = {'veg_palm02': (13.0, 0, .24), 'veg_palm04': (12.0, 0, .20), 'vgs_palm01': (12.5, 0, .20),
          'sm_redwoodgrp': (26.0, 0, .16), 'new_bushtest': (0, 3.2, .20)}
MAXTEX = 256
tx = {}
for f in sorted(glob.glob(os.path.join(src, '*.txd'))):
    for k, v in rwtxd.read_txd(f).items(): tx.setdefault(k, v)
VB, IB, MODELS, TEXS = [], [], [], {}; vtot = 0; itot = 0
for f in sorted(glob.glob(os.path.join(src, '*.dff'))):
    name = os.path.splitext(os.path.basename(f))[0]
    if name not in TARGET: print('  ignorado', name); continue
    fr, ge, at = rwdff.parse(f); g = ge[0]; v = g['verts'].astype(np.float64); uv = g['uv'][0]
    gv = np.c_[v[:, 0], v[:, 2], v[:, 1]]                   # GTA (dir, frente, cima) -> jogo (dir, cima, frente)
    th, tw, wt = TARGET[name]
    k = th / (gv[:, 1].max() - gv[:, 1].min()) if th else tw / max(np.ptp(gv[:, 0]), np.ptp(gv[:, 2]))
    gv = gv * k; gv[:, 1] -= gv[:, 1].min() + .12           # base 12 cm abaixo do chão
    nrm = np.zeros_like(gv); by = {}
    for mi, ix in g['bin'][1]:
        t = ix.reshape(-1, 3); a, b, c = gv[t[:, 0]], gv[t[:, 1]], gv[t[:, 2]]
        n = np.cross(b - a, c - a)
        for j in range(3): np.add.at(nrm, t[:, j], n)
        by.setdefault((g['mats'][mi]['tex'] or '').lower(), []).append(t)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    vb = np.zeros(len(gv), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4)])
    vb['p'] = gv; vb['uv'] = uv; vb['n'][:, :3] = np.clip(np.round(nrm * 127), -127, 127)
    parts = []
    for tex, tl in sorted(by.items(), key=lambda kv: -1 if 'bark' in kv[0] or 'trunk' in kv[0] or kv[0] == 'palm_thenathanns' else 0):
        tl = np.concatenate(tl); im = tx[tex]; a = np.array(im)
        alpha = bool((a[..., 3] < 200).mean() > .01)
        if tex not in TEXS:
            if alpha:                                       # evita halo claro nas bordas (mipmap)
                opq = a[..., 3] > 128; mean = a[opq][:, :3].mean(0) if opq.any() else np.array([70, 110, 40]); a[~opq, :3] = mean.astype(np.uint8)
            im = Image.fromarray(a, 'RGBA' if alpha else 'RGBA')
            if max(im.size) > MAXTEX: s = MAXTEX / max(im.size); im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
            if not alpha: im = im.convert('RGB')
            im.save(os.path.join(OUT, 'g_' + tex + '.webp'), quality=86, method=6); TEXS[tex] = {'$file': 'assets/trees/g_%s.webp' % tex}
        ids = (tl.reshape(-1) + vtot).astype(np.uint16)
        trunk = ('bark' in tex or 'trunk' in tex or tex in ('palm_thenathanns', 'prop_thenathanns')) and not alpha
        parts.append(dict(tex=tex, start=itot, count=int(len(ids)), alpha=alpha, sway=.25 if trunk else 1.0)); IB.append(ids); itot += len(ids)
    VB.append(vb); vtot += len(gv)
    MODELS.append(dict(name=name, w=round(float(max(np.ptp(gv[:, 0]), np.ptp(gv[:, 2]))), 2), h=round(float(gv[:, 1].max()), 2), weight=wt, parts=parts))
    print('  %-14s %5.1f m alt, %5.1f m larg, %4d tris' % (name, MODELS[-1]['h'], MODELS[-1]['w'], sum(p['count'] for p in parts) // 3))
assert vtot < 65536
np.concatenate(VB).tofile(OUT + '/gta.vb.bin'); np.concatenate(IB).tofile(OUT + '/gta.ib.bin')
# ---- instâncias: mesmas posições das árvores da pista; modelo sorteado por peso (x,y,z,giro,escala,modelo)
pos = np.fromfile(ORIG + '/positions.bin', np.float32).reshape(-1, 6)
w = np.array([m['weight'] for m in MODELS]); cw = np.cumsum(w / w.sum()); arr = []
for i, p in enumerate(pos):
    hh = (i * 2654435761) & 0xffffffff; r = ((hh >> 4) & 1023) / 1023
    mdl = int(np.searchsorted(cw, r)); mdl = min(mdl, len(MODELS) - 1)
    s = 0.85 + 0.35 * (((hh >> 14) & 255) / 255)
    arr.append((p[0], p[1], p[2], ((hh >> 16) & 1023) / 1023 * 2 * math.pi, s, mdl))
arr = np.array(arr, np.float32); arr.tofile(OUT + '/inst.bin')
print('instancias:', len(arr), {m['name']: int((arr[:, 5] == j).sum()) for j, m in enumerate(MODELS)})
for fn in ('oak.vb.bin', 'oak.ib.bin', 'bark.jpg', 'leaf.webp'):
    if os.path.exists(os.path.join(OUT, fn)): os.remove(os.path.join(OUT, fn))
json.dump({'vb': {'$file': 'assets/trees/gta.vb.bin'}, 'ib': {'$file': 'assets/trees/gta.ib.bin'}, 'models': MODELS, 'tex': TEXS,
           'inst': {'$file': 'assets/trees/inst.bin'}, 'n': len(arr), 'far': 520, 'sway': 1}, open(os.path.join(dst, 'data', 'trees.json'), 'w'), separators=(',', ':'))
print('ok')
