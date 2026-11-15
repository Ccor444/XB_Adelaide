#!/usr/bin/env python3
"""Anda de verdade: assa os ciclos de caminhada reais do ped.ifp (WALK_civi / WOMAN_walknorm) nas animações da torcida.
Uso: python3 tools/bake_walk.py <pasta com andre.dff + ped.ifp> [pasta_do_jogo]
O motor3d só traz o André; os outros 8 tipos (army, ballas*, bb*, bf*) recebem o mesmo ciclo por retarget: para cada osso,
C = pele_tipo(quadro parado) · pele_andre(quadro parado)^-1 aplicado ao ciclo do André (erro medido ≈ 1-5 cm; bb ≈ 10-30 cm, corrigido por mínimos quadrados).
Acrescenta os clipes walkM/walkF/runM/runF (só os que faltam) (com 'stride' = metros por ciclo) em data/peds.json e as linhas em assets/peds/<tipo>.anim.bin. Idempotente."""
import sys, os, json, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwped
src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else '.'
OUT = os.path.join(dst, 'assets', 'peds'); mp = os.path.join(dst, 'data', 'peds.json')
meta = json.load(open(mp))
SPECS = [('walkM', 'WALK_civi'), ('walkF', 'WOMAN_walknorm'), ('runM', 'run_civi'), ('runF', 'woman_run')]
HAVE = {c['name'] for c in meta['clips']}; SPECS = [x for x in SPECS if x[0] not in HAVE]
if not SPECS: print('já tem walk/run'); sys.exit()
ifp = rwped.parse_ifp(os.path.join(src, 'ped.ifp'))
dur = lambda n: max(f[0] for x in ifp[n] for f in x['frames']) / 60.0
B = rwped.bone_info(os.path.join(src, 'andre.dff')); g = B['geom']; nb = len(B['ids'])

def pose(base, tb):
    nbase = {n['bone']: n for n in ifp[base]}; W = [None] * nb
    for k in range(nb):
        L = B['local'][k].copy(); bid = B['ids'][k]
        if bid in nbase:
            q, tr = rwped.sample_node(nbase[bid], tb); L[:3, :3] = rwped.quat_row(q, True)
            if tr is not None: L[3, :3] = tr
        W[k] = L @ W[B['par'][k]] if B['par'][k] >= 0 else L @ B['base']
    return np.array(W)
def skin_pos(V, W):
    S = rwped.skin_matrices(B, W); sk = B['skin']; P = np.c_[V, np.ones(len(V))]; out = np.zeros((len(V), 3))
    for k in range(4): out += sk['w'][:, k][:, None] * np.einsum('vi,vij->vj', P, S[sk['bi'][:, k]])[:, :3]
    return out
V = g['verts'].astype(np.float64); gmin = float(skin_pos(V, pose('IDLE_stance', 0.0))[:, 2].min())
def frame(base, tb):
    W = pose(base, tb); S = rwped.skin_matrices(B, W)
    M = np.eye(4); M[:3, :3] = [[1, 0, 0], [0, 0, 1], [0, 1, 0]]; M[3, :3] = [-W[1][3, 0], -gmin, -W[1][3, 1]]
    return np.transpose(np.einsum('kij,jl->kil', S, M), (0, 2, 1))[:, :3, :].reshape(nb * 3, 4), W[1][3, :3].copy()

# ---- confere que reproduzimos o assado existente do André (parado) ----
old = np.fromfile(os.path.join(OUT, 'andre.anim.bin'), np.float16).reshape(-1, nb * 3, 4).astype(np.float32)
c0 = next(c for c in meta['clips'] if c['name'] == 'stand0')
chk = np.abs(frame('IDLE_stance', 0.0)[0] - old[c0['start']]).max(); print('conferência stand0: erro máx %.4f' % chk)
assert chk < .02, 'não reproduz o assado do André'

NW = 24; new = []; clips = []
for name, an in SPECS:
    d = dur(an); fr = []; hp = []
    for i in range(NW + 1):
        f, p = frame(an, d * i / NW); hp.append(p)
        if i < NW: fr.append(f)
    hp = np.array(hp); stride = float(np.hypot(*(hp[-1, :2] - hp[0, :2])))
    print(name, an, 'duração %.2fs' % d, 'passada do quadril: %.2f m' % stride, 'oscilação quadril x,y: %.2f %.2f' % tuple(np.ptp(hp[:, :2], axis=0)))
    clips.append({'name': name, 'start': 0, 'len': NW, 'stride': stride, 'dur': d}); new.append(np.array(fr))
base_n = meta['types'][0]['frames']
for i, c in enumerate(clips): c['start'] = base_n + i * NW
A = np.concatenate(new)                                        # (2*NW, nb*3, 4) do André
def h4(M): X = np.zeros(M.shape[:-2] + (4, 4)); X[..., :3, :] = M; X[..., 3, 3] = 1; return X
DT = [('p', '<f4', 3), ('uv', '<f4', 2), ('b', 'u1', 4), ('w', 'u1', 4), ('n', 'i1', 4)]
Aold = h4(old.reshape(-1, nb, 3, 4).astype(np.float64))
for t in meta['types']:
    n = t['name']; o = np.fromfile(os.path.join(OUT, n + '.anim.bin'), np.float16).reshape(-1, nb * 3, 4).astype(np.float64)
    if n == 'andre': add = A
    else:
        T = h4(o.reshape(-1, nb, 3, 4)); a = Aold[:c0['start'] + 302]; tt = T[:c0['start'] + 302]
        C0 = np.array([tt[0, k] @ np.linalg.inv(a[0, k]) for k in range(nb)])
        # mínimos quadrados sobre todos os quadros parados (mais estável que um quadro só)
        C1 = np.array([tt[:, k].transpose(1, 0, 2).reshape(4, -1) @ np.linalg.pinv(a[:, k].transpose(1, 0, 2).reshape(4, -1)) for k in range(nb)])
        vb = np.fromfile(os.path.join(OUT, n + '.vb.bin'), DT); P = np.c_[vb['p'], np.ones(len(vb))]; w = vb['w'] / 255.
        def err(C):
            e = 0
            for f in (5, 40, 100, 200, 260, 300):
                x = np.einsum('kij,kjl->kil', C, a[f]); y = np.zeros((len(P), 3)); z = np.zeros((len(P), 3))
                for k in range(4):
                    y += w[:, k:k+1] * np.einsum('vij,vj->vi', tt[f][vb['b'][:, k]][:, :3], P); z += w[:, k:k+1] * np.einsum('vij,vj->vi', x[vb['b'][:, k]][:, :3], P)
                e += np.linalg.norm(y - z, axis=1).mean()
            return e / 6
        e0, e1 = err(C0), err(C1); C = C0 if e0 <= e1 else C1
        print('  %-8s erro médio retarget: quadro0 %.3f m  mín.quadrados %.3f m -> %s' % (n, e0, e1, 'quadro0' if e0 <= e1 else 'mín.quadrados'))
        Ah = h4(A.reshape(-1, nb, 3, 4).astype(np.float64)); add = np.einsum('kij,fkjl->fkil', C, Ah)[:, :, :3, :].reshape(-1, nb * 3, 4)
    np.concatenate([o, add.astype(np.float64)]).astype(np.float16).tofile(os.path.join(OUT, n + '.anim.bin')); t['frames'] = base_n + len(A)
meta['clips'] += clips
json.dump(meta, open(mp, 'w'), separators=(',', ':')); print('ok', base_n, '->', base_n + len(A), 'quadros')
