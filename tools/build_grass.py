#!/usr/bin/env python3
"""Converte a grama estilo GTA SA (grass*_*.dff, plant1.dff/.txd, plants.dat) para o jogo.
Uso: python3 tools/build_grass.py <pasta com os .dff/.txd/plants.dat> [pasta_do_jogo]
Gera: assets/grass/*.webp (texturas), grass.vb.bin/grass.ib.bin (modelos), ground.f32/ground.flg (chão com textura de grama)
      e data/grass.json (camadas, densidades, cores — editável sem refazer).
A grama é espalhada em tempo de execução SÓ sobre os triângulos da pista com a textura GROUND_TEX (padrão gras.dds)."""
import sys, os, re, json, glob
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwdff, rwtxd

src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else '.'
GROUND_TEX = 'gras.dds'
OUT = os.path.join(dst, 'assets', 'grass'); os.makedirs(OUT, exist_ok=True)

# ---------- texturas (TXD) ----------
txd = glob.glob(os.path.join(src, '*.txd'))
tex = {}
for t in txd: tex.update(rwtxd.read_txd(t))
for name, im in tex.items():
    a = np.array(im.convert('RGBA')); opq = a[..., 3] > 100
    mean = a[opq][:, :3].mean(0) if opq.any() else np.array([90, 120, 50])
    a[~opq, :3] = mean.astype(np.uint8)                 # sem halo claro nas bordas (mipmap)
    im = Image.fromarray(a)
    if im.width > 512: im = im.resize((512, max(1, im.height * 512 // im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.webp'), quality=82, method=6)
print('texturas:', sorted(tex))

# ---------- modelos (DFF) ----------
def tris_of(g):
    if g['bin'] and g['bin'][1]:
        strip = g['bin'][0] & 1; idx = np.concatenate([m[1] for m in g['bin'][1]]).astype(np.int64)
        if not strip: return idx[:len(idx) // 3 * 3].reshape(-1, 3)
        out = []
        for i in range(len(idx) - 2):
            a, b, c = idx[i], idx[i + 1], idx[i + 2]
            if a == b or b == c or a == c: continue
            out.append((a, c, b) if i & 1 else (a, b, c))
        return np.array(out, np.int64)
    t = g['tri']; return np.stack([t[:, 1], t[:, 0], t[:, 3]], 1).astype(np.int64)

models = {}; VB = []; IB = []; base = 0
for f in sorted(glob.glob(os.path.join(src, '*.dff'))):
    nm = os.path.splitext(os.path.basename(f))[0]
    fr, ge, at = rwdff.parse(f); g = ge[0]
    if g['verts'] is None or g['uv'] is None: print('ignorado (sem UV):', nm); continue
    P = g['verts'].astype(np.float32); uv = g['uv'][0].astype(np.float32)
    P = np.stack([P[:, 0], P[:, 2], P[:, 1]], 1)        # RW (x,y,z-cima) -> jogo (x, cima, z)
    T = tris_of(g)
    if len(T) == 0: continue
    v = np.zeros(len(P), dtype=[('p', '<f4', 3), ('uv', '<f4', 2)]); v['p'] = P; v['uv'] = uv
    VB.append(v); IB.append((T + base).astype(np.uint16).ravel())
    mat = g['mats'][0]['tex'] if g['mats'] else ''
    models[nm] = dict(first=sum(len(x) for x in IB[:-1]), count=int(T.size), tex=(mat or '').lower(), h=float(P[:, 1].max()))
    base += len(P)
np.concatenate(VB).tofile(os.path.join(OUT, 'grass.vb.bin')); np.concatenate(IB).tofile(os.path.join(OUT, 'grass.ib.bin'))
print('modelos:', {k: (v['count'] // 3, v['tex']) for k, v in models.items()})

# ---------- plants.dat ----------
plants = {}
for line in open(os.path.join(src, 'plants.dat'), encoding='latin1'):
    line = line.split(';')[0].strip()
    if not line: continue
    p = line.split()
    if len(p) < 17: continue
    n = p[0]; v = [float(x) for x in p[1:18]]
    plants.setdefault(n, []).append(dict(pcd=int(v[0]), slot=int(v[1]), model=int(v[2]), uv=int(v[3]), rgb=[int(v[4]), int(v[5]), int(v[6])],
        inten=int(v[7]), varI=int(v[8]), alpha=int(v[9]), sclXY=v[10], sclZ=v[11], varXY=v[12], varZ=v[13], bend=v[14], bendVar=v[15], dens=v[16]))

def tex_of(slot, model):
    """textura da camada: slot 0 usa a do próprio DFF quando existe no TXD; os demais usam txgrass1_<modelo> (4 variações)"""
    m = models.get('grass%d_%d' % (slot, model + 1))
    if slot == 0 and m and m['tex'] in tex: return m['tex']
    for cand in ('txgrass%d_%d' % (min(slot, 1), model), 'txgrass0_%d' % model, 'gras07si'):
        if cand in tex: return cand
    return sorted(tex)[0]

def layer(row, name=None):
    m = 'grass%d_%d' % (row['slot'], row['model'] + 1)
    if m not in models: m = 'grass1_1'
    return dict(model=m, tex=tex_of(row['slot'], row['model']), rgb=row['rgb'], inten=row['inten'], varI=row['varI'],
                sclXY=row['sclXY'], sclZ=row['sclZ'], varXY=row['varXY'], varZ=row['varZ'], bend=row['bend'], bendVar=row['bendVar'], dens=row['dens'])

SURF = ['GRASS_SHORT_LUSH', 'GRASS_MEDIUM_LUSH', 'GRASS_LONG_LUSH']
layers = [layer(r) for s in SURF for r in plants.get(s, [])]
# modelos detalhados (3D de verdade) e a planta extra: esparsos, para variar o gramado
extra = [('grass0_2', 'txgrass0_1', [150, 220, 120], .035, .55), ('grass0_3', 'txgrass0_1', [200, 240, 150], .05, .6),
         ('plant1', 'gras07si', [210, 250, 150], .04, .8)]
for m, tx, rgb, d, s in extra:
    if m in models: layers.append(dict(model=m, tex=tx if tx in tex else tex_of(0, 0), rgb=rgb, inten=255, varI=30, sclXY=s, sclZ=s, varXY=.5, varZ=.4, bend=1.0, bendVar=1.0, dens=d))

# ---------- chão com textura de grama (triângulos + arestas de borda) ----------
trk = json.load(open(os.path.join(dst, '_orig_trees', 'trk.json') if os.path.exists(os.path.join(dst, '_orig_trees', 'trk.json')) else os.path.join(dst, 'data', 'trk.json')))
trk_now = json.load(open(os.path.join(dst, 'data', 'trk.json'))); names = trk_now['texnames']
vbt = np.fromfile(os.path.join(dst, 'assets', 'track', 'track.vb.bin'), dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
ibt = np.fromfile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'), np.uint16); Pp = vbt['p']
key = lambda i: tuple(np.round(Pp[i], 2))
edges = {}; gt = []
for g in trk_now['groups']:
    if g['cat'] == 'shadow': continue
    isg = names[g['tex']] == GROUND_TEX; n = g['cnt'] // 3 * 3
    for a, b, c in ibt[g['off']:g['off'] + n].reshape(-1, 3):
        if isg: gt.append((a, b, c))
        for u, w in ((a, b), (b, c), (c, a)):
            edges.setdefault(tuple(sorted((key(u), key(w)))), []).append(isg)
F = []; FL = []
for a, b, c in gt:
    q = Pp[[a, b, c]]
    nrm = np.cross(q[1] - q[0], q[2] - q[0]); ar = np.linalg.norm(nrm)
    if ar < 1e-6 or abs(nrm[1]) / ar < 0.75: continue      # só chão (descarta paredes/taludes íngremes)
    fl = 0
    for k, (u, w) in enumerate(((a, b), (b, c), (c, a))):
        l = edges[tuple(sorted((key(u), key(w))))]
        if len(l) == 1 or not all(l): fl |= 1 << k           # aresta que encosta em asfalto/muro/borda aberta -> margem sem grama
    F.append(q.ravel()); FL.append(fl)
F = np.array(F, np.float32); FL = np.array(FL, np.uint8)
F.tofile(os.path.join(OUT, 'ground.f32')); FL.tofile(os.path.join(OUT, 'ground.flg'))
print('triangulos de chao com grama:', len(F), 'area %.0f m2' % (np.linalg.norm(np.cross(F[:, 3:6] - F[:, 0:3], F[:, 6:9] - F[:, 0:3]), axis=1).sum() / 2))

# ---------- data/grass.json ----------
used = sorted({l['tex'] for l in layers})
cfg = {
    'vb': {'$file': 'assets/grass/grass.vb.bin'}, 'ib': {'$file': 'assets/grass/grass.ib.bin'},
    'ground': {'$file': 'assets/grass/ground.f32'}, 'flags': {'$file': 'assets/grass/ground.flg'},
    'models': {k: {'first': v['first'], 'count': v['count']} for k, v in models.items()},
    'tex': {t: {'$file': 'assets/grass/%s.webp' % t} for t in used},
    'layers': layers,
    'far': 42, 'cell': 16, 'densMul': 2.0, 'cap': 1400, 'edge': 0.9, 'sway': 1, 'scale': 1.0, 'adaptive': 1,
    'plantsDat': {s: plants[s] for s in SURF if s in plants},
}
json.dump(cfg, open(os.path.join(dst, 'data', 'grass.json'), 'w'), separators=(',', ':'))
print('ok: %d camadas, texturas %s' % (len(layers), used))
