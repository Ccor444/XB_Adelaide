"""Leitor de peds do GTA SA: DFF com pele (Skin PLG + HAnim) e animações ped.ifp (ANP3)."""
import struct, numpy as np
import rwdff
from rwdff import kids

def parse_ped(path):
    d = open(path, 'rb').read()
    frames, geoms, atomics = rwdff.parse(path)
    # HAnim: hierarquia de ossos (ids) no quadro raiz
    clump = kids(d, 0, len(d))[0]; hier = None; fnames = []
    for t, p, s in kids(d, clump[1], clump[1] + clump[2]):
        if t == 0xE:
            fc = kids(d, p, p + s); n = struct.unpack_from('<I', d, fc[0][1])[0]
            for i, (t2, p2, s2) in enumerate(fc[1:1 + n]):
                for t3, p3, s3 in kids(d, p2, p2 + s2):
                    if t3 == 0x11E:
                        ver, nid, cnt = struct.unpack_from('<III', d, p3)
                        if cnt > 0 and hier is None:
                            q = p3 + 12 + 8; nodes = []
                            for k in range(cnt): nodes.append(struct.unpack_from('<III', d, q)); q += 12   # (id, index, flags)
                            hier = dict(frame=i, nodes=nodes)
    # Skin PLG
    skin = None
    for t, p, s in kids(d, clump[1], clump[1] + clump[2]):
        if t == 0x1A:
            for t2, p2, s2 in kids(d, p, p + s):
                if t2 != 0xF: continue
                for t3, p3, s3 in kids(d, p2, p2 + s2):
                    if t3 != 3: continue
                    for t4, p4, s4 in kids(d, p3, p3 + s3):
                        if t4 == 0x116:
                            nb, nu, mw, _ = struct.unpack_from('<BBBB', d, p4); q = p4 + 4 + nu
                            nv = geoms[0]['nvert']
                            bi = np.frombuffer(d, np.uint8, nv * 4, q).reshape(nv, 4).copy(); q += nv * 4
                            w = np.frombuffer(d, np.float32, nv * 4, q).reshape(nv, 4).copy(); q += nv * 16
                            ibm = np.frombuffer(d, np.float32, nb * 16, q).reshape(nb, 4, 4).copy(); ibm[:, :, 3] = (0, 0, 0, 1)
                            skin = dict(nb=nb, bi=bi, w=w, ibm=ibm)
    return frames, geoms[0], hier, skin

def parse_ifp(path):
    d = open(path, 'rb').read(); assert d[:4] == b'ANP3'
    n = struct.unpack_from('<I', d, 0x20)[0]; o = 0x24; anims = {}
    for _ in range(n):
        name = d[o:o + 24].split(b'\0')[0].decode('latin1'); nn, size, unk = struct.unpack_from('<III', d, o + 24); o += 36
        nodes = []
        for _ in range(nn):
            nm = d[o:o + 24].split(b'\0')[0].decode('latin1'); ft, nf, bid = struct.unpack_from('<IIi', d, o + 24); o += 36
            fr = []
            for k in range(nf):
                if ft & 4:     # KRT0: quat int16*4, tempo int16, translação int16*3
                    q0, q1, q2, q3, tm, t0, t1, t2 = struct.unpack_from('<8h', d, o); o += 16
                    fr.append((tm, (q0 / 4096, q1 / 4096, q2 / 4096, q3 / 4096), (t0 / 1024, t1 / 1024, t2 / 1024)))
                else:
                    q0, q1, q2, q3, tm = struct.unpack_from('<5h', d, o); o += 10
                    fr.append((tm, (q0 / 4096, q1 / 4096, q2 / 4096, q3 / 4096), None))
            nodes.append(dict(name=nm, ft=ft, bone=bid, frames=fr))
        anims[name] = nodes
    return anims


# ---------------- esqueleto / pose ----------------
def bone_info(path):
    """ossos na ordem do Skin (índice k): nodeID, quadro DFF, pai (índice k), local (vetor-linha 4x4), IBM"""
    d = open(path, 'rb').read(); frames, g, hier, skin = parse_ped(path)
    clump = kids(d, 0, len(d))[0]; fid = {}
    for t, p, s in kids(d, clump[1], clump[1] + clump[2]):
        if t == 0xE:
            fc = kids(d, p, p + s); n = struct.unpack_from('<I', d, fc[0][1])[0]
            for i, (t2, p2, s2) in enumerate(fc[1:1 + n]):
                for t3, p3, s3 in kids(d, p2, p2 + s2):
                    if t3 == 0x11E: fid[struct.unpack_from('<I', d, p3 + 4)[0]] = i
    nodes = hier['nodes']; ids = [n[0] for n in nodes]; fr_of = [fid[i] for i in ids]
    f2k = {f: k for k, f in enumerate(fr_of)}
    par = []; local = []; base = np.eye(4)
    def Lm(fr):
        L = np.eye(4); L[:3, :3] = fr['rot']; L[3, :3] = fr['pos']; return L
    for k, f in enumerate(fr_of):
        fr = frames[f]; p = fr['parent']
        if p in f2k: par.append(f2k[p])
        else:                                              # pai fora do esqueleto (quadros estáticos acima da raiz): vira matriz-base
            par.append(-1); M = np.eye(4); q = p
            while q >= 0: M = M @ Lm(frames[q]); q = frames[q]['parent']
            base = M
        local.append(Lm(fr))
    return dict(ids=ids, par=par, local=np.array(local), base=base, ibm=skin['ibm'].astype(np.float64), skin=skin, geom=g, names=[frames[f]['name'] for f in fr_of])

def quat_row(q, conj=False):
    x, y, z, w = q
    if conj: x, y, z = -x, -y, -z
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
                  [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
                  [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]])
    return R.T          # vetor-linha

def slerp(a, b, t):
    a = np.array(a); b = np.array(b); d = a @ b
    if d < 0: b = -b; d = -d
    if d > .9995: r = a + t * (b - a); return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)

def sample_node(node, tsec):
    fr = node['frames']; t = tsec * 60
    if t <= fr[0][0]: q, tr = fr[0][1], fr[0][2]
    elif t >= fr[-1][0]: q, tr = fr[-1][1], fr[-1][2]
    else:
        i = max(k for k in range(len(fr)) if fr[k][0] <= t); a, b = fr[i], fr[i + 1]; u = (t - a[0]) / max(1e-6, b[0] - a[0])
        q = slerp(a[1], b[1], u); tr = None if a[2] is None else tuple(np.array(a[2]) * (1 - u) + np.array(b[2]) * u)
    return np.array(q) / np.linalg.norm(q), tr

def pose(B, anim, tsec, conj=False, root_move=False):
    nb = len(B['ids']); by = {n['bone']: n for n in anim}; W = [None] * nb
    for k in range(nb):
        L = B['local'][k].copy()
        n = by.get(B['ids'][k])
        if n is not None:
            q, tr = sample_node(n, tsec); L[:3, :3] = quat_row(q, conj)
            if tr is not None and (B['par'][k] >= 0 or True): L[3, :3] = tr if root_move or B['ids'][k] != 0 else L[3, :3]
        W[k] = L @ W[B['par'][k]] if B['par'][k] >= 0 else L @ B['base']
    return np.array(W)

def skin_matrices(B, W): return np.einsum('kij,kjl->kil', B['ibm'], W)     # vetor-linha: v @ IBM @ W
