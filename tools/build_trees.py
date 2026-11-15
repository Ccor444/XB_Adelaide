#!/usr/bin/env python3
"""Troca as árvores da pista (pares de planos cruzados na malha) por um modelo 3D instanciado.
Uso: python3 tools/build_trees.py <Leaf_Oak.fbx> <casca.jpg> <folhas.png> [pasta_do_jogo]
Precisa de tools/fbx.py e tools/load_oak.py. Lê o trk.json/track.ib.bin ORIGINAIS de <jogo>/_orig_trees/ (criados na 1ª execução)
para poder rodar de novo sem perder as árvores antigas."""
import sys, os, json, shutil, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_oak
fbx_path, bark_path, leaf_path = sys.argv[1:4]; dst = sys.argv[4] if len(sys.argv) > 4 else '.'
OUT = os.path.join(dst, 'assets', 'trees'); os.makedirs(OUT, exist_ok=True)
ORIG = os.path.join(dst, '_orig_trees'); os.makedirs(ORIG, exist_ok=True)
for src, nm in ((os.path.join(dst, 'data', 'trk.json'), 'trk.json'), (os.path.join(dst, 'assets', 'track', 'track.ib.bin'), 'track.ib.bin')):
    if not os.path.exists(os.path.join(ORIG, nm)): shutil.copy(src, os.path.join(ORIG, nm))
TREE_TEX = ['tree01.dds', 'tree02.dds', 'tree03.dds', 'tree05.dds', 'tree07.dds', 'tree09.dds']
MODEL_H = None

# ---------- modelo (cm -> m) ----------
parts = load_oak.load(fbx_path)
def pack(sel):
    P, U, N, I = [], [], [], []; base = 0
    for x in sel:
        P.append(x['pos'] / 100.0); U.append(x['uv']); N.append(x['n']); I.append(x['idx'] + base); base += len(x['pos'])
    return np.concatenate(P), np.concatenate(U), np.concatenate(N), np.concatenate(I)
bP, bU, bN, bI = pack([x for x in parts if not x['leaf']])
lP, lU, lN, lI = pack([x for x in parts if x['leaf']])
P = np.concatenate([bP, lP]); U = np.concatenate([bU, lU]); N = np.concatenate([bN, lN])
I = np.concatenate([bI, lI + len(bP)]).astype(np.uint16)
H = float(P[:, 1].max()); cx, cz = float(bP[:, 0].mean()), float(bP[:, 2].mean())
P[:, 0] -= cx; P[:, 2] -= cz                       # tronco na origem, pés em y=0
vb = np.zeros(len(P), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4)])
vb['p'] = P; vb['uv'] = U; vb['uv'][:, 1] = 1 - U[:, 1]   # FBX: v para cima; WebGL: v para baixo
vb['n'][:, :3] = np.clip(np.round(N * 127), -127, 127)
vb.tofile(f'{OUT}/oak.vb.bin'); I.tofile(f'{OUT}/oak.ib.bin')
nBark = len(bI); nLeaf = len(lI)
print('modelo: altura %.2f m, raio copa %.2f m, vertices %d, tris casca %d folhas %d' % (H, np.hypot(P[:, 0], P[:, 2]).max(), len(P), nBark // 3, nLeaf // 3))

# ---------- texturas ----------
leaf = Image.open(leaf_path).convert('RGBA'); a = np.array(leaf)
opq = a[..., 3] > 128; mean = a[opq][:, :3].mean(0) if opq.any() else np.array([90, 120, 50])
a[~opq, :3] = mean.astype(np.uint8)               # evita halo claro nas bordas com mipmap
leaf = Image.fromarray(a).resize((512, 683), Image.LANCZOS); leaf.save(f'{OUT}/leaf.webp', quality=85, method=6)
Image.open(bark_path).convert('RGB').resize((512, 512), Image.LANCZOS).save(f'{OUT}/bark.jpg', quality=88)

# ---------- árvores antigas na pista ----------
trk = json.load(open(f'{ORIG}/trk.json')); names = trk['texnames']
vbt = np.fromfile(f'{dst}/assets/track/track.vb.bin', dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
ibt = np.fromfile(f'{ORIG}/track.ib.bin', np.uint16)
quads = []   # (cx, cz, ybase, altura, largura)
for g in trk['groups']:
    if names[g['tex']] not in TREE_TEX or g['cat'] != 'alpha': continue
    tri = ibt[g['off']:g['off'] + g['cnt']].reshape(-1, 3); par = {}
    def f(x):
        while par.setdefault(x, x) != x: par[x] = par[par[x]]; x = par[x]
        return x
    for t in tri: par[f(t[0])] = f(t[1]); par[f(t[1])] = f(t[2])
    cl = {}
    for t in tri: cl.setdefault(f(t[0]), set()).update(map(int, t))
    for vs in cl.values():
        q = vbt['p'][sorted(vs)]; sz = q.max(0) - q.min(0)
        quads.append((q[:, 0].mean(), q[:, 2].mean(), q[:, 1].min(), sz[1], max(sz[0], sz[2])))
quads = np.array(quads); used = np.zeros(len(quads), bool)
arr = []
for i in range(len(quads)):
    if used[i]: continue
    d = np.hypot(quads[:, 0] - quads[i, 0], quads[:, 1] - quads[i, 1]); m = (d < 3) & ~used; used |= m
    q = quads[m]; h = np.median(q[:, 3]); k = len(arr); hh = (k * 2654435761 & 0xffffffff)
    s = h / H * 0.85 * (0.92 + 0.16 * ((hh >> 8) & 255) / 255)
    arr.append((q[:, 0].mean(), q[:, 2].min(), q[:, 1].mean(), ((hh >> 16) & 1023) / 1023 * 2 * math.pi, s, 0.0))
arr = np.array(arr, np.float32); arr.tofile(f'{OUT}/inst.bin')
print('arvores antigas substituidas:', len(arr), 'escala media %.2f' % arr[:, 4].mean())

# ---------- remove os planos das árvores da pista (compacta o índice) ----------
newib = []; groups = []; pos = 0
for g in sorted(trk['groups'], key=lambda g: g['off']):
    if names[g['tex']] in TREE_TEX and g['cat'] == 'alpha': continue
    seg = ibt[g['off']:g['off'] + g['cnt']]; ng = dict(g); ng['off'] = pos; pos += len(seg); newib.append(seg); groups.append(ng)
trk['groups'] = groups
np.concatenate(newib).astype(np.uint16).tofile(f'{dst}/assets/track/track.ib.bin')
json.dump(trk, open(f'{dst}/data/trk.json', 'w'), separators=(',', ':'))
json.dump({'oak': {'vb': {'$file': 'assets/trees/oak.vb.bin'}, 'ib': {'$file': 'assets/trees/oak.ib.bin'}, 'nBark': int(nBark), 'nLeaf': int(nLeaf)},
           'inst': {'$file': 'assets/trees/inst.bin'}, 'n': len(arr), 'bark': {'$file': 'assets/trees/bark.jpg'}, 'leaf': {'$file': 'assets/trees/leaf.webp'},
           'far': 520, 'sway': 1}, open(f'{dst}/data/trees.json', 'w'), separators=(',', ':'))
print('ok')
