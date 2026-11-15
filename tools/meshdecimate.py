"""Redução de malha por colapso de arestas (quádricas, Garland-Heckbert) preservando UV/materiais/pesos de pele.
Trabalha nos vértices soldados por posição; cada triângulo mantém seus vértices indexados originais (UV, pesos),
e no colapso o canto escolhe o gêmeo do vértice destino com UV/material mais próximos (costuras não abrem)."""
import heapq
import numpy as np

def decimate(pos, tris, mat, uv, wdense, target, bw=60.0, lam=0.15, verbose=False):
    pos = np.asarray(pos, np.float64); N = len(pos); tris = np.array(tris, np.int64); T = len(tris)
    key = {}; wid = np.zeros(N, np.int64)
    for i, p in enumerate(np.round(pos, 5)): wid[i] = key.setdefault(tuple(p), len(key))
    NW = len(key); wpos = np.zeros((NW, 3)); twins = [[] for _ in range(NW)]
    for i in range(N): wpos[wid[i]] = pos[i]; twins[wid[i]].append(i)
    vmat = np.zeros(N, np.int64)
    for t in range(T):
        for c in range(3): vmat[tris[t, c]] = mat[t]
    wd = np.zeros((NW, wdense.shape[1]))
    for i in range(N): wd[wid[i]] = wdense[i]
    scale = np.ptp(pos, axis=0).max()
    corner = tris.copy(); alive = np.ones(T, bool); inc = [set() for _ in range(NW)]
    W3 = wid[corner]
    for t in range(T):
        for c in range(3): inc[W3[t, c]].add(t)
    def plane(t):
        a, b, c = wpos[W3[t, 0]], wpos[W3[t, 1]], wpos[W3[t, 2]]; n = np.cross(b - a, c - a); ar = np.linalg.norm(n)
        if ar < 1e-14: return None, 0
        n = n / ar; return np.append(n, -n @ a), ar / 2
    Q = np.zeros((NW, 4, 4)); edge_tris = {}
    for t in range(T):
        p, ar = plane(t)
        if p is None: continue
        K = np.outer(p, p) * ar
        for c in range(3): Q[W3[t, c]] += K
        for c in range(3):
            e = tuple(sorted((W3[t, c], W3[t, (c + 1) % 3]))); edge_tris.setdefault(e, []).append(t)
    bnd = np.zeros(NW, bool)
    for e, ts in edge_tris.items():
        mats = {mat[t] for t in ts}
        if len(ts) == 1 or len(mats) > 1:                       # borda aberta ou de material: plano perpendicular com peso alto
            t = ts[0]; p, ar = plane(t)
            if p is None: continue
            ev = wpos[e[1]] - wpos[e[0]]; ln = np.linalg.norm(ev)
            if ln < 1e-12: continue
            n = np.cross(ev / ln, p[:3]); n /= max(np.linalg.norm(n), 1e-12); q = np.append(n, -n @ wpos[e[0]])
            for w in e: Q[w] += np.outer(q, q) * bw * ln * ln; bnd[w] = True
    ver = np.zeros(NW, np.int64); heap = []
    def cost(a, b):
        v = np.append(wpos[b], 1.0); Qs = Q[a] + Q[b]
        c = v @ Qs @ v + lam * scale * scale * 1e-3 * np.abs(wd[a] - wd[b]).sum()
        if bnd[a] and not bnd[b]: c += 1e-3 * scale * scale
        return c
    def push(a, b): heapq.heappush(heap, (cost(a, b), a, b, ver[a], ver[b]))
    nbrs = [set() for _ in range(NW)]
    for e in edge_tris:
        nbrs[e[0]].add(e[1]); nbrs[e[1]].add(e[0])
    for a in range(NW):
        for b in nbrs[a]: push(a, b)
    ntri = int(alive.sum())
    while ntri > target and heap:
        c, a, b, va, vb = heapq.heappop(heap)
        if ver[a] != va or ver[b] != vb or not inc[a] or not inc[b] or b not in nbrs[a]: continue
        # impede inversão de faces
        ok = True; new = {}
        for t in inc[a]:
            if b in W3[t]: continue
            p0, _ = plane(t)
            tmp = W3[t].copy(); tmp[tmp == a] = b
            A, B_, C = wpos[tmp[0]], wpos[tmp[1]], wpos[tmp[2]]; n = np.cross(B_ - A, C - A); ln = np.linalg.norm(n)
            if p0 is None: continue
            if ln < 1e-12 or n @ p0[:3] / ln < 0.2: ok = False; break
        if not ok: ver[a] += 1; continue
        # aplica: a -> b
        for t in list(inc[a]):
            if b in W3[t]:
                alive[t] = False; ntri -= 1
                for w in set(W3[t]): inc[w].discard(t)
                continue
            for cidx in range(3):
                if W3[t, cidx] == a:
                    iv = corner[t, cidx]; best = None; bd = 1e18
                    for j in twins[b]:
                        d = np.hypot(*(uv[iv] - uv[j])) + (0 if vmat[j] == mat[t] else 10.0)
                        if d < bd: bd, best = d, j
                    corner[t, cidx] = best; W3[t, cidx] = b
            inc[a].discard(t); inc[b].add(t)
        Q[b] += Q[a]; bnd[b] |= bnd[a]
        for n_ in nbrs[a]:
            nbrs[n_].discard(a)
            if n_ != b: nbrs[n_].add(b); nbrs[b].add(n_)
        nbrs[a] = set(); inc[a] = set(); ver[a] += 1; ver[b] += 1
        for n_ in list(nbrs[b]):
            ver[n_] += 0
            push(b, n_); push(n_, b)
    keep = np.where(alive)[0]
    if verbose: print('tris', T, '->', len(keep))
    return corner[keep], np.asarray(mat)[keep]
