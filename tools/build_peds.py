#!/usr/bin/env python3
"""Converte os pedestres do GTA SA (DFF com pele + TXD + ped.ifp) na torcida animada do jogo.
Uso: python3 tools/build_peds.py <pasta com .dff/.txd/ped.ifp> [pasta_do_jogo]
Gera assets/peds/<tipo>.vb.bin|ib.bin|anim.bin|webp, assets/peds/people.bin e data/peds.json.
- malha reduzida (quádricas) para rodar no celular; texturas dos materiais juntadas num atlas por pedestre
- animações do ped.ifp assadas em matrizes de pele (12 quadros/s): parado, conversando, ao telefone, torcendo, sentado, sentado conversando, levanta-torce-senta, coçando
- espectadores: posições de assets/track/crowd.d.bin; quem está sobre o assento (astnd.dds) fica sentado; os demais formam pares de conversa"""
import sys, os, json, glob, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwped, rwtxd, meshdecimate

src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else '.'
OUT = os.path.join(dst, 'assets', 'peds'); os.makedirs(OUT, exist_ok=True)
TARGET = int(os.environ.get('PED_TRIS', 3200)); FPS = 12; CELL = 256; PAD = 8
TYPES = os.environ.get('PED_TYPES', 'vwfyst1').split(',')
FEMALE = set(os.environ.get('PED_FEMALE', 'vwfyst1').split(','))
ifp = rwped.parse_ifp(os.path.join(src, 'ped.ifp'))
dur = lambda n: max(f[0] for x in ifp[n] for f in x['frames']) / 60.0

# ---------- definição dos clipes: lista de (base, tbase, overlay, tover, fator_assento) por quadro ----------
def seq(name, n=None, hold_end=0.0):
    d = dur(name); n = n or max(2, round(d * FPS)); return [(name, i / FPS) for i in range(n)]
CLIPS = []
def add(name, frames): CLIPS.append((name, frames))
add('stand0', [(('IDLE_stance', t), None, 0) for _, t in seq('IDLE_stance')])
add('stand1', [(('idlestance_old', t), None, 0) for _, t in seq('idlestance_old')])
add('stand2', [(('IDLE_HBHB', t), None, 0) for _, t in seq('IDLE_HBHB')])
add('stand3', [(('IDLE_tired', t), None, 0) for _, t in seq('IDLE_tired')])
add('standF', [(('woman_idlestance', t), None, 0) for _, t in seq('woman_idlestance')])
add('chat', [(('IDLE_stance', 0.4), ('IDLE_chat', t), 0) for _, t in seq('IDLE_chat')])
add('phone', [(('IDLE_stance', 0.4), ('phone_talk', t), 0) for _, t in seq('phone_talk')])
add('scratch', [(('XPRESSscratch', t), None, 0) for _, t in seq('XPRESSscratch')])
hu = dur('handsup'); n_up = max(3, round(hu * FPS)); hold = int(.8 * FPS)
cheer = [(('handsup', min(hu, i / FPS)), None, 0) for i in range(n_up)] + [(('handsup', hu), None, 0)] * hold \
      + [(('handsup', max(0, hu - i / FPS)), None, 0) for i in range(n_up)] + [(('handsup', 0.0), None, 0)] * int(.3 * FPS)
add('cheer', cheer)
add('sit', [(('SEAT_idle', t), None, 1) for _, t in seq('SEAT_idle')])
add('sitchat', [(('SEAT_idle', 0.5), ('IDLE_chat', t), 1) for _, t in seq('IDLE_chat')])
up = seq('SEAT_up'); dn = seq('SEAT_down'); hold2 = int(1.2 * FPS)
sc = [(('SEAT_up', t), None, 1) for i, (_, t) in enumerate(up)]
sc += [(('handsup', min(hu, i / FPS)), None, 1) for i in range(n_up)] + [(('handsup', hu), None, 1)] * hold2
sc += [(('handsup', max(0, hu - i / FPS)), None, 1) for i in range(n_up)]
sc += [(('SEAT_down', t), None, 1) for i, (_, t) in enumerate(dn)]
add('sitcheer', sc)
NW = 24; WALKS = [('walkM', 'WALK_civi'), ('walkF', 'WOMAN_walknorm'), ('runM', 'run_civi'), ('runF', 'woman_run')]
for nm, an in WALKS: add(nm, [((an, dur(an) * i / NW), None, 0) for i in range(NW)])      # ciclo real do ped.ifp (esqueleto nativo), sem retarget
meta_clips = []; o = 0
for nm, fr in CLIPS: meta_clips.append({'name': nm, 'start': o, 'len': len(fr)}); o += len(fr)
for c in meta_clips:
    an = dict(WALKS).get(c['name'])
    if an: c['dur'] = dur(an)
NF = o
print('clipes:', [(c['name'], c['len']) for c in meta_clips], 'quadros', NF)

# ---------- pose composta ----------
def pose_c(B, base, tb, ov=None, to=0.0):
    nb = len(B['ids']); nbase = {n['bone']: n for n in ifp[base]}; nov = {n['bone']: n for n in ifp[ov]} if ov else {}
    W = [None] * nb
    for k in range(nb):
        L = B['local'][k].copy(); bid = B['ids'][k]
        if bid in nov: q, tr = rwped.sample_node(nov[bid], to)
        elif bid in nbase: q, tr = rwped.sample_node(nbase[bid], tb)
        else: q = tr = None
        if q is not None:
            L[:3, :3] = rwped.quat_row(q, True)
            if tr is not None: L[3, :3] = tr
        W[k] = L @ W[B['par'][k]] if B['par'][k] >= 0 else L @ B['base']
    return np.array(W)

def skin_pos(B, V, W):
    S = rwped.skin_matrices(B, W); sk = B['skin']; P = np.c_[V, np.ones(len(V))]; out = np.zeros((len(V), 3))
    for k in range(4): out += sk['w'][:, k][:, None] * np.einsum('vi,vij->vj', P, S[sk['bi'][:, k]])[:, :3]
    return out

def sample_tex(im, uv): pass

meta = {'fps': FPS, 'clips': meta_clips, 'types': []}
for tname in TYPES:
    print('==', tname)
    B = rwped.bone_info(os.path.join(src, tname + '.dff')); g = B['geom']; sk = B['skin']; nb = len(B['ids'])
    V = g['verts'].astype(np.float64); uv0 = g['uv'][0].astype(np.float64)
    tris = []; mat = []
    for m, idx in g['bin'][1]:
        t = np.array(idx, np.int64).reshape(-1, 3); tris.append(t); mat += [m] * len(t)
    tris = np.concatenate(tris); mat = np.array(mat)
    wd = np.zeros((len(V), nb))
    for k in range(4): np.add.at(wd, (np.arange(len(V)), sk['bi'][:, k]), sk['w'][:, k])
    ct, cm = meshdecimate.decimate(V, tris, mat, uv0, wd, TARGET)
    # ---- textura: atlas por pedestre ----
    txd = {k.lower(): v for k, v in rwtxd.read_txd(os.path.join(src, tname + '.txd')).items()}
    names = []; mtex = []
    for m in g['mats']:
        nm = (m['tex'] or '').lower()
        if nm not in names: names.append(nm)
        mtex.append(names.index(nm))
    G = math.ceil(math.sqrt(len(names))); A = G * CELL; atlas = Image.new('RGBA', (A, A), (150, 150, 150, 255))
    inner = CELL - 2 * PAD
    for i, nm in enumerate(names):
        im = txd[nm].convert('RGBA') if nm in txd else Image.new('RGBA', (4, 4), (170, 170, 170, 255))
        c = im.resize((inner, inner), Image.LANCZOS); cell = Image.new('RGBA', (CELL, CELL))
        cell.paste(c, (PAD, PAD))
        arr = np.array(cell); arr = np.pad(np.array(c), ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')   # borda replicada: sem vazamento no mipmap
        atlas.paste(Image.fromarray(arr), ((i % G) * CELL, (i // G) * CELL))
    atlas.save(os.path.join(OUT, tname + '.webp'), quality=84, method=6)
    # ---- vértices finais (UV com repetição -> deslocamento por triângulo, remapeado para o atlas) ----
    vmap = {}; verts = []; idx = []
    for t, m in zip(ct, cm):
        u = uv0[t]; off = np.floor(u.mean(0) + 1e-6); ti = mtex[m]; cx, cy = ti % G, ti // G
        tri = []
        for c in range(3):
            key = (int(t[c]), int(off[0]), int(off[1]), ti)
            if key not in vmap:
                uu = np.clip(u[c] - off, 0, 1)
                au = (cx * CELL + PAD + uu[0] * inner) / A; av = (cy * CELL + PAD + uu[1] * inner) / A
                vmap[key] = len(verts); verts.append((int(t[c]), au, av))
            tri.append(vmap[key])
        idx.append(tri)
    idx = np.array(idx, np.uint16); ov = np.array([v[0] for v in verts]); uvf = np.array([(v[1], v[2]) for v in verts], np.float32)
    # ---- pose de repouso: chão e normais ----
    Ws = pose_c(B, 'IDLE_stance', 0.0); Xs = skin_pos(B, V, Ws); gmin = float(Xs[:, 2].min())
    fn = np.cross(Xs[tris[:, 1]] - Xs[tris[:, 0]], Xs[tris[:, 2]] - Xs[tris[:, 0]])
    nrm = np.zeros((len(V), 3))
    for c in range(3): np.add.at(nrm, tris[:, c], fn)
    wk = {}
    for i, p in enumerate(np.round(V, 5)): wk.setdefault(tuple(p), []).append(i)
    for ids in wk.values():
        s = nrm[ids].sum(0)
        for i in ids: nrm[i] = s
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-12
    nr = nrm[ov][:, [0, 2, 1]]                                       # RW (x,y,z-cima) -> jogo (x,cima,z)
    # ---- buffers ----
    vb = np.zeros(len(verts), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('b', 'u1', 4), ('w', 'u1', 4), ('n', 'i1', 4)])
    vb['p'] = V[ov]; vb['uv'] = uvf; vb['b'] = sk['bi'][ov]
    w = sk['w'][ov]; w = w / np.maximum(w.sum(1, keepdims=True), 1e-6); vb['w'] = np.round(w * 255).astype(np.uint8)
    vb['n'][:, :3] = np.clip(np.round(nr * 127), -127, 127).astype(np.int8)
    vb.tofile(os.path.join(OUT, tname + '.vb.bin')); idx.ravel().tofile(os.path.join(OUT, tname + '.ib.bin'))
    # ---- animação: matrizes de pele (linhas da coluna-maior), já em coordenadas do jogo, pés no chão ----
    Wst = pose_c(B, 'SEAT_idle', 0.5); ps = Wst[1][3, :3]; hh = ps[2] - gmin                      # quadril sentado
    seat_fwd = -ps[1]; seat_up = -(hh - 0.09)
    frames = np.zeros((NF, nb * 3, 4), np.float32); fi = 0; zmin = 1e9; zmax = -1e9
    for nm, fr in CLIPS:
        for (base, tb), ovr, sf in fr:
            W = pose_c(B, base, tb, ovr[0] if ovr else None, ovr[1] if ovr else 0.0)
            S = rwped.skin_matrices(B, W)
            M = np.eye(4); M[:3, :3] = [[1, 0, 0], [0, 0, 1], [0, 1, 0]]; M[3, :3] = [-W[1][3, 0], -gmin + sf * seat_up, -W[1][3, 1]]     # quadril sempre sobre a origem; sentados: pés no piso, assento na origem
            Sf = np.einsum('kij,jl->kil', S, M)
            frames[fi] = np.transpose(Sf, (0, 2, 1))[:, :3, :].reshape(nb * 3, 4); fi += 1
    for c in meta_clips:
        if 'dur' in c:
            h0 = pose_c(B, dict(WALKS)[c['name']], 0.0)[1][3, :3]; h1 = pose_c(B, dict(WALKS)[c['name']], c['dur'])[1][3, :3]
            c['stride'] = float(np.hypot(*(h1[:2] - h0[:2]))); print('  ', c['name'], 'passada %.2f m dur %.2fs' % (c['stride'], c['dur']))
    frames.astype(np.float16).tofile(os.path.join(OUT, tname + '.anim.bin'))
    # validação: altura da pose parada e do assento
    for nm in ('stand0', 'sit', 'cheer'):
        c = next(c for c in meta_clips if c['name'] == nm); f = frames[c['start'] + c['len'] // 2].reshape(nb, 3, 4)
        P = np.c_[V, np.ones(len(V))]; acc = np.zeros((len(V), 3))
        for k in range(4): acc += sk['w'][:, k][:, None] * np.einsum('vij,vj->vi', f[sk['bi'][:, k]], P)
        print('  %-7s altura %.2f  min %.2f  frente %.2f..%.2f' % (nm, acc[:, 1].max(), acc[:, 1].min(), acc[:, 2].min(), acc[:, 2].max()))
    meta['types'].append({'name': tname, 'female': tname in FEMALE, 'nv': len(verts), 'ni': int(idx.size), 'nb': nb, 'frames': NF,
        'vb': {'$file': 'assets/peds/%s.vb.bin' % tname}, 'ib': {'$file': 'assets/peds/%s.ib.bin' % tname},
        'anim': {'$file': 'assets/peds/%s.anim.bin' % tname}, 'tex': {'$file': 'assets/peds/%s.webp' % tname}})
    print('  tris', len(idx), 'verts', len(verts), 'atlas', A)

# ---------- espectadores ----------
trk = json.load(open(os.path.join(dst, 'data', 'trk.json'))); names = trk['texnames']
vbt = np.fromfile(os.path.join(dst, 'assets', 'track', 'track.vb.bin'), dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
ibt = np.fromfile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'), np.uint16); Pp = vbt['p']
Qs = []; Tn = []
for gp in trk['groups']:
    if gp['cat'] == 'shadow': continue
    n = gp['cnt'] // 3 * 3; T = ibt[gp['off']:gp['off'] + n].reshape(-1, 3); Q = Pp[T]
    c = np.cross(Q[:, 1] - Q[:, 0], Q[:, 2] - Q[:, 0]); up = np.abs(c[:, 1]) / (np.linalg.norm(c, axis=1) + 1e-9) > .6
    Qs.append(Q[up]); Tn += [names[gp['tex']]] * int(up.sum())
Q = np.concatenate(Qs); Tn = np.array(Tn)
cdb = os.path.join(dst, 'assets', 'track', 'crowd.d.bin')
if os.path.exists(cdb): cf = np.fromfile(cdb, np.float32).reshape(-1, 6)
else:                                                  # torcida antiga removida: reaproveita as posições já gravadas em people.bin
    pp = np.fromfile(os.path.join(OUT, 'people.bin'), np.float32).reshape(-1, 8); cf = np.zeros((len(pp), 6), np.float32)
    cf[:, 0:4] = pp[:, 0:4]; cf[:, 5] = pp[:, 7]
N = len(cf)
a_, b_, c_ = Q[:, 0], Q[:, 1], Q[:, 2]
den = (b_[:, 2] - c_[:, 2]) * (a_[:, 0] - c_[:, 0]) + (c_[:, 0] - b_[:, 0]) * (a_[:, 2] - c_[:, 2]); okd = np.abs(den) > 1e-9
seat = np.zeros(N, np.uint8)
for i, (x, y, z, yaw, v, ph) in enumerate(cf):
    u = ((b_[:, 2] - c_[:, 2]) * (x - c_[:, 0]) + (c_[:, 0] - b_[:, 0]) * (z - c_[:, 2])) / np.where(okd, den, 1)
    vv = ((c_[:, 2] - a_[:, 2]) * (x - c_[:, 0]) + (a_[:, 0] - c_[:, 0]) * (z - c_[:, 2])) / np.where(okd, den, 1); w = 1 - u - vv
    m = okd & (u >= 0) & (vv >= 0) & (w >= 0)
    if m.any():
        ys = u[m] * a_[m, 1] + vv[m] * b_[m, 1] + w[m] * c_[m, 1]; j = np.argmin(np.abs(y - ys))
        if abs(y - ys[j]) < .3 and Tn[m][j] == 'astnd.dds': seat[i] = 1
rng = np.random.default_rng(7); partner = -np.ones(N, np.int64)
stand = np.where(seat == 0)[0]; P2 = cf[stand][:, [0, 2]]
from scipy.spatial import cKDTree
tree = cKDTree(P2); order = rng.permutation(len(stand))
for oi in order:
    i = stand[oi]
    if partner[i] >= 0 or rng.random() > .55: continue
    for dj in tree.query_ball_point(P2[oi], 2.2):
        j = stand[dj]
        if j != i and partner[j] < 0 and np.hypot(*(cf[j][[0, 2]] - cf[i][[0, 2]])) > .6: partner[i] = j; partner[j] = i; break
ptype = np.zeros(N, np.int64)
for i in range(N): ptype[i] = ((i * 2654435761) >> 7) % len(TYPES)   # com um só tipo: tudo 0
people = np.zeros((N, 8), np.float32)
people[:, 0:4] = cf[:, 0:4]; people[:, 4] = ptype; people[:, 5] = seat; people[:, 6] = partner; people[:, 7] = cf[:, 5]
people.tofile(os.path.join(OUT, 'people.bin'))
print('espectadores', N, 'sentados', int(seat.sum()), 'pares de conversa', int((partner >= 0).sum() // 2))
meta['people'] = {'n': N, 'd': {'$file': 'assets/peds/people.bin'}}
meta.update({'near': 75, 'cap': 140, 'scale': 1.0})
json.dump(meta, open(os.path.join(dst, 'data', 'peds.json'), 'w'), separators=(',', ':'))
print('ok')
