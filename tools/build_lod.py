#!/usr/bin/env python3
"""Gera LODs (níveis de detalhe) de casas e pedestres por clustering de vértices. Roda DEPOIS de build_stands.py. Idempotente.
 - Casas : novos índices em assets/houses/houses.ib.bin (acrescentados ao fim) + models[i].lod = [[parts LOD1],[parts LOD2]] em data/houses.json
 - Peds  : assets/peds/<tipo>.ib.lod1.bin / lod2.bin + types[i].lib / nli em data/peds.json
Os LODs reutilizam os MESMOS vértices (cada cluster vira um dos seus vértices originais), então não há vértices novos nem VBO novo.
Uso: python3 tools/build_lod.py [pasta_do_jogo]"""
import sys, os, json
import numpy as np

dst = sys.argv[1] if len(sys.argv) > 1 else '.'
RATIOS = (0.28, 0.08)                                   # fração de triângulos de LOD1 e LOD2


def decimate(P, tris, keys, target):
    """P: (nv,3) posições; tris: (nt,3) índices; keys: (nt,) grupo (parte) de cada triângulo.
    Retorna (tris_novos, keys_novos) com ~target*nt triângulos, usando uma grade uniforme cuja célula é achada por bisseção."""
    nt = len(tris)
    if nt <= 24: return tris, keys
    lo_, hi_ = P.min(0), P.max(0); ext = float(np.max(hi_ - lo_))

    def run(cs):
        q = np.floor((P - lo_) / cs).astype(np.int64)
        cell = np.unique(q, axis=0, return_inverse=True)[1].ravel().astype(np.int64)   # id exato da célula (sem colisão de hash)
        out = []
        for part in np.unique(keys):                      # a célula é por parte: não mistura texturas
            m = keys == part; tp = tris[m]; vs = np.unique(tp.ravel())
            cid = cell[vs]
            order = np.argsort(cid, kind='stable'); cs_ = cid[order]; vs_ = vs[order]
            first = np.r_[True, cs_[1:] != cs_[:-1]]; grp = np.cumsum(first) - 1
            cen = np.zeros((grp[-1] + 1, 3)); np.add.at(cen, grp, P[vs_]); cnt = np.bincount(grp).astype(float); cen /= cnt[:, None]
            dist = np.linalg.norm(P[vs_] - cen[grp], axis=1)
            best = np.full(grp[-1] + 1, np.inf); np.minimum.at(best, grp, dist)
            rep = np.zeros(grp[-1] + 1, np.int64); ok = dist <= best[grp] + 1e-12; rep[grp[ok]] = vs_[ok]   # vértice mais perto do centro
            remap = {}                                    # vértice -> representante
            mp = np.zeros(vs.max() + 1, np.int64); mp[vs_] = rep[grp]
            nt_ = mp[tp]
            good = (nt_[:, 0] != nt_[:, 1]) & (nt_[:, 1] != nt_[:, 2]) & (nt_[:, 0] != nt_[:, 2])
            nt_ = nt_[good]
            srt = np.sort(nt_, axis=1); _, ui = np.unique(srt, axis=0, return_index=True)   # tira triângulos duplicados
            nt_ = nt_[np.sort(ui)]
            out.append((nt_, np.full(len(nt_), part)))
        T = np.concatenate([o[0] for o in out]) if out else np.zeros((0, 3), np.int64)
        K = np.concatenate([o[1] for o in out]) if out else np.zeros(0, np.int64)
        return T, K

    lo, hi = ext / 400, ext / 1.5; best = run(hi)
    for _ in range(14):
        mid = (lo * hi) ** .5; T, K = run(mid)
        if len(T) > target * nt: lo = mid
        else: hi = mid; best = (T, K)
    return best


# ------------------------------------------------------------------ casas
H = json.load(open(os.path.join(dst, 'data', 'houses.json')))
IBp = os.path.join(dst, 'assets', 'houses', 'houses.ib.bin'); VBp = os.path.join(dst, 'assets', 'houses', 'houses.vb.bin')
IB = np.fromfile(IBp, np.uint16)
base = max(p['start'] + p['count'] for m in H['models'] for p in m['parts'])      # fim dos índices do LOD0 (descarta LODs antigos)
IB = IB[:base]
VB = np.fromfile(VBp, dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4), ('c', 'u1', 4)]); VP = VB['p'].astype(np.float64)
extra = []; pos = base; tot0 = tot1 = tot2 = 0
for m in H['models']:
    tris = []; keys = []
    for k, p in enumerate(m['parts']):
        t = IB[p['start']:p['start'] + p['count']].reshape(-1, 3).astype(np.int64); tris.append(t); keys.append(np.full(len(t), k))
    tris = np.concatenate(tris); keys = np.concatenate(keys)
    lods = []
    for r in RATIOS:
        T, K = decimate(VP, tris, keys, r); parts = []
        for k, p in enumerate(m['parts']):
            tk = T[K == k].astype(np.uint16).ravel()
            if len(tk): parts.append(dict(tex=p['tex'], start=int(pos), count=int(len(tk)))); extra.append(tk); pos += len(tk)
        lods.append(parts)
    m['lod'] = lods
    n0, n1, n2 = len(tris), sum(p['count'] for p in lods[0]) // 3, sum(p['count'] for p in lods[1]) // 3
    print('casa %-18s %5d -> %5d -> %4d tris' % (m['name'], n0, n1, n2))
np.concatenate([IB] + extra).astype(np.uint16).tofile(IBp)
json.dump(H, open(os.path.join(dst, 'data', 'houses.json'), 'w'), separators=(',', ':'))

# ------------------------------------------------------------------ pedestres
PJ = json.load(open(os.path.join(dst, 'data', 'peds.json')))
for t in PJ['types']:
    base_name = t['vb']['$file'].rsplit('.vb.bin', 1)[0]
    V = np.fromfile(os.path.join(dst, base_name + '.vb.bin'), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('b', 'u1', 4), ('w', 'u1', 4), ('n', 'i1', 4)])
    I = np.fromfile(os.path.join(dst, base_name + '.ib.bin'), np.uint16).reshape(-1, 3).astype(np.int64)
    lib = []; nli = []
    for li, r in enumerate((0.50, 0.20), 1):
        T, K = decimate(V['p'].astype(np.float64), I, np.zeros(len(I), np.int64), r)
        fn = '%s.ib.lod%d.bin' % (base_name, li); T.astype(np.uint16).ravel().tofile(os.path.join(dst, fn))
        lib.append({'$file': fn}); nli.append(int(len(T) * 3))
    t['lib'] = lib; t['nli'] = nli
print('pedestres: %d tipos; %d -> %d -> %d tris (ex.: %s)' % (len(PJ['types']), PJ['types'][0]['ni'] // 3, PJ['types'][0]['nli'][0] // 3, PJ['types'][0]['nli'][1] // 3, PJ['types'][0]['name']))
json.dump(PJ, open(os.path.join(dst, 'data', 'peds.json'), 'w'), separators=(',', ':'))
