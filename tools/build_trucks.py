#!/usr/bin/env python3
"""Troca os cavalos mecânicos (cabines 'truck*' da malha da pista) por um caminhão do GTA SA (DFF + TXD), instanciado.
Uso: python3 tools/build_trucks.py <linerun.dff> <linerun.txd> [pasta_do_jogo] [--keep nome1,nome2] [--scale 1.15]
 - o modelo original tem ~330 mil triângulos: peças escondidas (motor, cabos...) saem, peças repetidas (rodas) são
   reduzidas uma vez só e depois copiadas; gera 3 níveis de detalhe (LOD0 ~9 mil, LOD1 ~3 mil, LOD2 ~1 mil triângulos);
 - acha as 17 cabines antigas na malha da pista (triângulos com textura truck*), descobre posição/direção de cada uma
   (o reboque fica ATRÁS) e apaga esses triângulos; os reboques (tral*) ficam;
 - originais da pista ficam em _orig_trucks/ (rodar de novo parte sempre deles);
 - grava assets/trucks/* e data/trucks.json (o motor desenha em js/game.js → drawInst, mesmo sistema das casas).
ATENÇÃO: build_houses.py parte de _orig_buildings/ e traria os caminhões antigos de volta; rode build_houses ANTES e este depois."""
import sys, os, json, shutil, math, hashlib, re, pickle
import numpy as np
from PIL import Image
from scipy.cluster.hierarchy import fcluster, linkage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwdff, rwtxd
from meshdecimate import decimate

av = sys.argv[1:]
def opt(n, d=None):
    if n in av: i = av.index(n); v = av[i + 1]; del av[i:i + 2]; return v
    return d
SCALE = float(opt('--scale', 1.15)); KEEP_X = opt('--keep', '')
args = [a for a in av if not a.startswith('--')]
dff, txdf = args[0], args[1]; dst = args[2] if len(args) > 2 else '.'
OUT = os.path.join(dst, 'assets', 'trucks'); os.makedirs(OUT, exist_ok=True)
ORIG = os.path.join(dst, '_orig_trucks'); os.makedirs(ORIG, exist_ok=True)
for s, nm in ((os.path.join(dst, 'data', 'trk.json'), 'trk.json'), (os.path.join(dst, 'assets', 'track', 'track.ib.bin'), 'track.ib.bin'), (os.path.join(dst, 'assets', 'track', 'track.vb.bin'), 'track.vb.bin')):
    if not os.path.exists(os.path.join(ORIG, nm)): shutil.copy(s, os.path.join(ORIG, nm))
MAXTEX = 512
DROP = {'chassis_vlo', 'tank', 'wheel', 'anschluesse', 'motor', 'interclima', 'suporte da bateria'}    # escondidas ou vazias (3 vértices)
TARGET = (9000, 3200, 1000)
GLASS = {'l_cabin', 'door_rf_ok', 'door_lf_ok', 'widescreeen_ok', 'extra1'}
LDIR = np.array([0.30, 0.86, 0.41]); LDIR /= np.linalg.norm(LDIR)
CACHE = os.path.join(os.path.dirname(os.path.abspath(dff)), '_trucks_decim.pkl')

# ---------------------------------------------------------------- modelo
fr, ge, at = rwdff.parse(dff)
tx = {k.lower(): v for k, v in rwtxd.read_txd(txdf).items()}
items = []                                                      # (nome, geom, matriz mundo)
for fi, gi, fl in at:
    g = ge[gi]; nm = fr[fi]['name']
    if g['verts'] is None or nm.lower() in DROP or g['ntri'] < 4: continue
    if nm.lower() in [x.strip().lower() for x in KEEP_X.split(',') if x.strip()] and False: continue
    items.append((nm, gi, rwdff.world(fr, fi)))
uniq = {}; order = []
for nm, gi, M in items:
    g = ge[gi]; k = hashlib.md5(np.round(g['verts'], 3).tobytes() + g['tri'][:, :3].tobytes()).hexdigest()
    if k not in uniq: uniq[k] = dict(gi=gi, name=nm, mult=0); order.append(k)
    uniq[k]['mult'] += 1
print('peças: %d (%d geometrias únicas)' % (len(items), len(uniq)))
SPEC = {(60, 255, 0): (232, 232, 232), (255, 175, 0): (70, 70, 70), (0, 255, 255): (200, 200, 200), (255, 0, 175): (255, 255, 255), (255, 60, 0): (255, 255, 255)}

def tri_data(g):
    """triângulos por material: devolve pos, uv, cor (RGBA já com a cor do material), tris (T,3), mat (T,)"""
    v = g['verts']; uv = g['uv'][0] if g['uv'] is not None else np.zeros((len(v), 2), np.float32)
    cols = g['cols'] if g['cols'] is not None else np.full((len(v), 4), 255, np.uint8)
    fl, meshes = g['bin']; T = []; Mt = []
    for mi, ix in meshes:
        t = ix.reshape(-1, 3).astype(np.int64); T.append(t); Mt.append(np.full(len(t), mi))
    return v, uv, cols, np.concatenate(T), np.concatenate(Mt)

# ---------------------------------------------------------------- redução (com cache)
def work(args_):
    k, tgt = args_; g = ge[uniq[k]['gi']]; v, uv, cols, T, Mt = tri_data(g); res = {}
    for lv, t in enumerate(tgt):
        if t >= len(T): res[lv] = (T, Mt)
        else:
            c, m = decimate(v, T, Mt, uv, np.zeros((len(v), 1)), t); res[lv] = (c, m)
    return k, res
tot = {k: len(tri_data(ge[uniq[k]['gi']])[3]) for k in order}
need = {}
for lv in range(3):
    wsum = sum(uniq[k]['mult'] * math.sqrt(tot[k]) for k in order)
    for k in order:
        share = TARGET[lv] * math.sqrt(tot[k]) / wsum                  # por cópia
        need.setdefault(k, []).append(int(max(min(tot[k], 12), min(tot[k], round(share)))))
cache = pickle.load(open(CACHE, 'rb')) if os.path.exists(CACHE) else {}
todo = [(k, need[k]) for k in order if cache.get(k, (None,))[0] != tuple(need[k])]
if todo:
    print('reduzindo %d geometrias…' % len(todo), flush=True)
    import multiprocessing as mp
    with mp.get_context('fork').Pool(2) as pool:
        for k, res in pool.imap_unordered(work, todo):
            cache[k] = (tuple(need[k]), res); print('  ', uniq[k]['name'], tot[k], '->', [len(res[l][0]) for l in range(3)], flush=True)
    pickle.dump(cache, open(CACHE, 'wb'))

# ---------------------------------------------------------------- monta os vértices (GTA -> jogo: x, z, y), pés no chão, centro no meio
allp = np.concatenate([((M[:3, :3] @ ge[gi]['verts'].T).T + M[:3, 3]) for nm, gi, M in items if nm.lower() != 'extra1'])
mn, mx = allp.min(0), allp.max(0); cx = (mn[0] + mx[0]) / 2; cy = (mn[1] + mx[1]) / 2; gz = mn[2]
print('caixa do modelo (GTA): %s .. %s -> %.2f x %.2f x %.2f m' % (np.round(mn, 2), np.round(mx, 2), *(mx - mn)))
VB, IB, LODP = [], [], [[], [], []]; vtot = 0; used = {}; matcol = {}
for lv in range(3):
    by = {}                                                    # textura -> lista de (pos, uv, cor, nrm) triângulo-sopa
    for nm, gi, M in items:
        k = hashlib.md5(np.round(ge[gi]['verts'], 3).tobytes() + ge[gi]['tri'][:, :3].tobytes()).hexdigest()
        g = ge[gi]; v, uv, cols, _, _ = tri_data(g); T, Mt = cache[k][1][lv]
        W = (M[:3, :3] @ v.T).T + M[:3, 3]; G = np.c_[W[:, 0] - cx, W[:, 2] - gz, W[:, 1] - cy] * SCALE      # (x, cima, frente)
        for mi in np.unique(Mt):
            mat = g['mats'][mi]; tn = (mat['tex'] or '').lower(); col = tuple(mat['color'][:3])
            col = SPEC.get(col, col)
            if tn not in tx: tn = ''
            if tn == 'preto' and nm.lower() in GLASS: tn = ''; col = (34, 52, 70)             # vidros: azul-grafite em vez de preto chapado
            tt = T[Mt == mi].reshape(-1)
            cc = cols[tt].astype(np.float32) / 255 * np.array(list(col) + [255], np.float32)
            tr = G[tt].reshape(-1, 3, 3); fn = np.cross(tr[:, 1] - tr[:, 0], tr[:, 2] - tr[:, 0]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
            sh = 0.60 + 0.40 * np.clip(fn @ LDIR, 0, 1)                                       # sombreado "assado": topo claro, laterais mais escuras
            cc[:, :3] *= np.repeat(sh, 3)[:, None]
            by.setdefault(tn, []).append((G[tt], uv[tt], np.clip(cc, 0, 255).astype(np.uint8)))
    for tn in sorted(by):
        P = np.concatenate([a for a, b, c in by[tn]]); U = np.concatenate([b for a, b, c in by[tn]]); C = np.concatenate([c for a, b, c in by[tn]])
        n = len(P)
        if vtot + n >= 65536: raise SystemExit('vértices demais (%d) — reduza TARGET' % (vtot + n))
        Tr = P.reshape(-1, 3, 3); nr = np.cross(Tr[:, 1] - Tr[:, 0], Tr[:, 2] - Tr[:, 0]); nr /= np.linalg.norm(nr, axis=1, keepdims=True) + 1e-12
        vb = np.zeros(n, dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4), ('c', 'u1', 4)])
        vb['p'] = P; vb['uv'] = U; vb['n'][:, :3] = np.clip(np.round(np.repeat(nr, 3, axis=0) * 127), -127, 127); vb['c'] = C
        start = sum(len(x) for x in IB); VB.append(vb); IB.append((np.arange(n) + vtot).astype(np.uint16)); vtot += n
        nm_ = tn or '_white'; used[nm_] = 1
        LODP[lv].append(dict(tex=nm_, start=int(start), count=int(n)))
    print('LOD%d: %d triângulos' % (lv, sum(p['count'] for p in LODP[lv]) // 3))
np.concatenate(VB).tofile(os.path.join(OUT, 'trucks.vb.bin')); np.concatenate(IB).tofile(os.path.join(OUT, 'trucks.ib.bin'))
texjson = {}
for name in sorted(used):
    im = Image.new('RGB', (4, 4), (255, 255, 255)) if name == '_white' else tx[name].convert('RGB')
    if max(im.size) > MAXTEX: s = MAXTEX / max(im.size); im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    fn = re.sub(r'[^a-z0-9_]+', '_', name); im.save(os.path.join(OUT, fn + '.webp'), quality=88, method=6); texjson[name] = {'$file': 'assets/trucks/%s.webp' % fn}
W_ = float((mx[0] - mn[0]) * SCALE); D_ = float((mx[1] - mn[1]) * SCALE); H_ = float((mx[2] - mn[2]) * SCALE)
MOD = [dict(name='linerunner', w=round(W_, 2), d=round(D_, 2), h=round(H_, 2), parts=LODP[0], lod=[LODP[1], LODP[2]])]

# ---------------------------------------------------------------- pista: acha as cabines antigas
trk = json.load(open(os.path.join(ORIG, 'trk.json'))); names = trk['texnames']
vbt = np.fromfile(os.path.join(ORIG, 'track.vb.bin'), dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
ibt = np.fromfile(os.path.join(ORIG, 'track.ib.bin'), np.uint16); Pt = vbt['p']
def collect(rx):
    C = []; T = []; N = []
    for g in trk['groups']:
        n = names[g['tex']]
        if re.match(rx, n):
            seg = ibt[g['off']:g['off'] + g['cnt']]; seg = seg[:len(seg) // 3 * 3].reshape(-1, 3)
            C.append(Pt[seg].mean(1)); T.append(seg); N += [n] * len(seg)
    return np.concatenate(C), np.concatenate(T), np.array(N)
C, T, N = collect(r'^truck'); lab = fcluster(linkage(C, 'single'), 3.2, 'distance')
Ct, Tt, Nt = collect(r'^tral')
inst = []; wheels = []
for c in range(1, lab.max() + 1):
    m = lab == c
    if m.sum() < 100: wheels.append(np.unique(Pt[T[m].ravel()], axis=0)); continue
for c in range(1, lab.max() + 1):
    m = lab == c
    if m.sum() < 100: continue
    P = np.unique(Pt[T[m].ravel()], axis=0); xz = P[:, [0, 2]]; mu = (xz.min(0) + xz.max(0)) / 2
    w, V = np.linalg.eigh(np.cov((xz - mu).T)); ax = V[:, 1]                     # eixo longo
    d = np.linalg.norm(Ct[:, [0, 2]] - mu, axis=1); nb = Ct[d < 16]
    rear = (nb[:, [0, 2]].mean(0) - mu) if len(nb) else -ax
    if ax @ rear > 0: ax = -ax                                                  # ax = frente
    yaw = math.atan2(ax[0], ax[1])
    near = [wh for wh in wheels if np.linalg.norm(wh[:, [0, 2]].mean(0) - mu) < 7]
    ground = min([wh[:, 1].min() for wh in near] + [P[:, 1].min() - 0.3])
    inst.append((float(mu[0]), float(ground) + 0.25, float(mu[1]), yaw, 1.0, 0))
inst = np.array(inst, np.float32); print('cabines substituídas:', len(inst)); inst.tofile(os.path.join(OUT, 'inst.bin'))

# ---------------------------------------------------------------- tira os triângulos truck* da pista
newib = []; groups = []; pos = 0; removed = 0
for g in sorted(trk['groups'], key=lambda g: g['off']):
    if re.match(r'^truck', names[g['tex']]): removed += g['cnt'] // 3; continue
    seg = ibt[g['off']:g['off'] + g['cnt']]; ng = dict(g); ng['off'] = pos; ng['cnt'] = int(len(seg)); pos += len(seg); newib.append(seg); groups.append(ng)
trk['groups'] = groups
np.concatenate(newib).astype(np.uint16).tofile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'))
shutil.copy(os.path.join(ORIG, 'track.vb.bin'), os.path.join(dst, 'assets', 'track', 'track.vb.bin'))
json.dump(trk, open(os.path.join(dst, 'data', 'trk.json'), 'w'), separators=(',', ':'))
print('triângulos de cabines antigas removidos:', removed)
json.dump({'vb': {'$file': 'assets/trucks/trucks.vb.bin'}, 'ib': {'$file': 'assets/trucks/trucks.ib.bin'}, 'models': MOD, 'tex': texjson,
           'inst': {'$file': 'assets/trucks/inst.bin'}, 'n': int(len(inst)), 'far': 900, 'light': 1.1, 'l1': 70, 'l2': 200},
          open(os.path.join(dst, 'data', 'trucks.json'), 'w'), separators=(',', ':'))
print('ok')
