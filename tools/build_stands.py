#!/usr/bin/env python3
"""Tira as arquibancadas e os boxes sem textura (prédio da largada) e coloca no lugar das arquibancadas o modelo novo (DFF+TXD).
Uso: python3 tools/build_stands.py <modelo.dff> <textura.txd> [pasta_do_jogo]
Rode DEPOIS de build_houses.py. Idempotente: o estado "pós-casas" fica em _orig_stands/ e é sempre relido de lá."""
import sys, os, json, shutil, math, re
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwdff, rwtxd

dff, txd = sys.argv[1], sys.argv[2]; dst = sys.argv[3] if len(sys.argv) > 3 else '.'
ORIG = os.path.join(dst, '_orig_stands'); os.makedirs(ORIG, exist_ok=True)
FILES = {'trk.json': 'data/trk.json', 'track.ib.bin': 'assets/track/track.ib.bin', 'track.vb.bin': 'assets/track/track.vb.bin',
         'houses.json': 'data/houses.json', 'houses.vb.bin': 'assets/houses/houses.vb.bin', 'houses.ib.bin': 'assets/houses/houses.ib.bin',
         'houses.inst.bin': 'assets/houses/inst.bin', 'people.bin': 'assets/peds/people.bin', 'peds.json': 'data/peds.json', 'trees.inst.bin': 'assets/trees/inst.bin', 'trees.json': 'data/trees.json'}
for nm, rel in FILES.items():
    if not os.path.exists(os.path.join(ORIG, nm)): shutil.copy(os.path.join(dst, rel), os.path.join(ORIG, nm))
rd = lambda nm: os.path.join(ORIG, nm)

STAND = re.compile(r'^(astnd|stand|grnstnd)')                    # arquibancadas
STEP = re.compile(r'^(steps|stepundr)')                          # degraus que acompanham as arquibancadas
PIT = re.compile(r'^(inwall|pitfrnt|cwin|gantry|stairtra|gssup01|stlit|ptwl02)')   # prédio dos boxes (inwall não tem textura no pacote)
PIT_BOX = (165, 312, -228, -50)                                  # x0,x1,z0,z1 do complexo dos boxes
ROOF_PIT = re.compile(r'^(logo0[12]|grey|metla|jumbo[sb]|tents|tntbase|bridgund|logo05)')      # placas/lajes que só existem presas ao prédio dos boxes (acima de y=12)
FALLBACK = 'tex_1559_0'

trk = json.load(open(rd('trk.json'))); names = trk['texnames']
vbt = np.fromfile(rd('track.vb.bin'), dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)]); Pt = vbt['p']
ibt = np.fromfile(rd('track.ib.bin'), np.uint16)

# ---------------------------------------------------------------- 1) acha as arquibancadas
stand_v = []
for g in trk['groups']:
    if g['cat'] != 'shadow' and STAND.match(names[g['tex']]):
        seg = ibt[g['off']:g['off'] + g['cnt']]; stand_v.append(Pt[seg[:len(seg) // 3 * 3]])
SV = np.concatenate(stand_v); tree = cKDTree(SV[:, [0, 2]])
print('vértices de arquibancada:', len(SV))

def near_stand(c, r):
    return tree.query(c[:, [0, 2]], distance_upper_bound=r)[0] < r

newib = []; groups = []; pos = 0; removed = {}
for g in trk['groups']:
    n = names[g['tex']]; seg = ibt[g['off']:g['off'] + g['cnt']]
    if g['cat'] != 'shadow':
        tri = seg[:len(seg) // 3 * 3].reshape(-1, 3); cen = Pt[tri].mean(1); drop = np.zeros(len(tri), bool)
        inpit = (cen[:, 0] > PIT_BOX[0]) & (cen[:, 0] < PIT_BOX[1]) & (cen[:, 2] > PIT_BOX[2]) & (cen[:, 2] < PIT_BOX[3])
        if STAND.match(n): drop[:] = True
        elif STEP.match(n): drop = near_stand(cen, 10.0)
        elif re.match(r'^bar0[123]', n): drop = near_stand(cen, 14.0)                      # cercas/guarda-corpos das arquibancadas (laranja/marrom)
        elif re.match(r'^(tents|tntbase|gssup01|green|stlit)', n) and True: drop = near_stand(cen, 12.0) | (inpit if (PIT.match(n) or n.startswith(('tents', 'tntbase'))) else False)   # tendas/cobertura e base das arquibancadas
        elif re.match(r'^canvs', n): drop = inpit                                       # coberturas de lona que ficavam sobre os boxes
        elif PIT.match(n): drop = inpit
        elif ROOF_PIT.match(n): drop = inpit & (cen[:, 1] > 12.0)
        if drop.any(): removed[n] = removed.get(n, 0) + int(drop.sum())
        seg = tri[~drop].ravel()
    else:
        tri = seg[:len(seg) // 3 * 3].reshape(-1, 3); cen = Pt[tri].mean(1)
        dr = near_stand(cen, 18.0) | ((cen[:, 0] > 165) & (cen[:, 0] < 232) & (cen[:, 2] > -228) & (cen[:, 2] < -50))   # sombras das arquibancadas e do prédio dos boxes
        if dr.any(): removed['sombra:' + n] = removed.get('sombra:' + n, 0) + int(dr.sum())
        seg = tri[~dr].ravel()
    ng = dict(g); ng['off'] = pos; ng['cnt'] = int(len(seg)); pos += len(seg); newib.append(seg); groups.append(ng)
print('triângulos removidos:', removed)
trk['groups'] = groups
np.concatenate(newib).astype(np.uint16).tofile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'))
shutil.copy(rd('track.vb.bin'), os.path.join(dst, 'assets', 'track', 'track.vb.bin'))
json.dump(trk, open(os.path.join(dst, 'data', 'trk.json'), 'w'), separators=(',', ':'))

pj = json.load(open(rd('peds.json')))

# ---------------------------------------------------------------- 3) novo modelo
tx = rwtxd.read_txd(txd); tx = {k.lower(): v for k, v in tx.items()}
fr, ge, at = rwdff.parse(dff); g = ge[0]; v = g['verts']; uv = g['uv'][0]; cols = g['cols']; fl, meshes = g['bin']
gv = np.c_[v[:, 0], v[:, 2], v[:, 1]]; mn, mx = gv.min(0), gv.max(0)
off = np.array([(mn[0] + mx[0]) / 2, mn[1] + 0.20, (mn[2] + mx[2]) / 2])
H = json.load(open(rd('houses.json')))
VB0 = np.fromfile(rd('houses.vb.bin'), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4), ('c', 'u1', 4)])
IB0 = np.fromfile(rd('houses.ib.bin'), np.uint16)
by = {}
for mi, ix_ in meshes: by.setdefault(g['mats'][mi]['tex'].lower(), []).append(ix_.reshape(-1, 3))
vtot = len(VB0); VB = [VB0]; IB = [IB0]; parts = []; i0 = len(IB0); texjson = dict(H['tex'])
for tex, tl in sorted(by.items()):
    tl = np.concatenate(tl); name = tex if tex in tx else FALLBACK
    if tex in tx and np.asarray(tx[tex].convert('RGB')).max() == 0:        # textura só de sombra (preto + alfa): o motor não tem alfa nas casas -> viraria mancha preta
        print('  descartada (sombra preta): %s, %d tris' % (tex, len(tl))); continue
    if tex not in tx: print('  textura ausente %s -> %s' % (tex, FALLBACK))
    P = gv[tl.reshape(-1)] - off; U = uv[tl.reshape(-1)]; C = cols[tl.reshape(-1)] if cols is not None else np.full((len(tl) * 3, 4), 255, np.uint8)
    T = P.reshape(-1, 3, 3); n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    vb = np.zeros(len(P), dtype=VB0.dtype); vb['p'] = P; vb['uv'] = U; vb['n'][:, :3] = np.clip(np.round(np.repeat(n, 3, axis=0) * 127), -127, 127); vb['c'] = C
    ids = (np.arange(len(P)) + vtot).astype(np.uint16); vtot += len(P); VB.append(vb); IB.append(ids)
    parts.append(dict(tex=name, start=int(i0), count=int(len(ids)))); i0 += len(ids)
    if name not in texjson and name in tx:
        im = tx[name].convert('RGB')
        if max(im.size) > 512: s = 512 / max(im.size); im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        im.save(os.path.join(dst, 'assets', 'houses', name + '.webp'), quality=88, method=6); texjson[name] = {'$file': 'assets/houses/%s.webp' % name}
assert vtot < 65536, 'vértices demais'
np.concatenate(VB).tofile(os.path.join(dst, 'assets', 'houses', 'houses.vb.bin')); np.concatenate(IB).astype(np.uint16).tofile(os.path.join(dst, 'assets', 'houses', 'houses.ib.bin'))
mname = os.path.splitext(os.path.basename(dff))[0].split('-')[-1]
W, D, Hh = float(mx[0] - mn[0]), float(mx[2] - mn[2]), float(mx[1] - mn[1])
H['models'].append(dict(name=mname, w=round(W, 2), d=round(D, 2), h=round(Hh, 2), parts=parts)); mi_new = len(H['models']) - 1
H['tex'] = texjson
print('modelo %s: %.1f x %.1f m, altura %.1f, %d tris' % (mname, W, D, Hh, sum(p['count'] for p in parts) // 3))

# ---------------------------------------------------------------- 4) posiciona no lugar das arquibancadas
from scipy import ndimage as ndi
ai = np.array(json.load(open(os.path.join(dst, 'data', 'ext.json')))['ai'])[:, :3]; aitree = cKDTree(ai[:, [0, 2]])
cell = 8.0; x0, z0 = SV[:, 0].min(), SV[:, 2].min()
gx = ((SV[:, 0] - x0) / cell).astype(int); gz = ((SV[:, 2] - z0) / cell).astype(int)
m = np.zeros((gx.max() + 1, gz.max() + 1), bool); m[gx, gz] = 1; m = ndi.binary_dilation(m, iterations=2)
L, nc = ndi.label(m); lab = L[gx, gz]
gc = []
for g_ in trk['groups']:
    if g_['cat'] == 'opaque' and re.match(r'^(gras|grava|road|ba_rumbl|rmbld)', names[g_['tex']]):
        sg = ibt[g_['off']:g_['off'] + g_['cnt']]; tr_ = sg[:len(sg) // 3 * 3].reshape(-1, 3)
        # (a malha antiga ainda está em ibt: usa os índices ORIGINAIS do estado pós-casas, o chão não muda)
        A_, B_, C_ = Pt[tr_[:, 0]], Pt[tr_[:, 1]], Pt[tr_[:, 2]]; nn = np.cross(B_ - A_, C_ - A_); okn = np.abs(nn[:, 1]) / (np.linalg.norm(nn, axis=1) + 1e-9) > .85
        gc.append(((A_ + B_ + C_) / 3)[okn])
gc = np.concatenate(gc); gtree = cKDTree(gc[:, [0, 2]])
def ground(x, z):
    for r in (8, 16, 30):
        ii = gtree.query_ball_point([x, z], r)
        if len(ii) >= 3: return float(np.median(gc[ii, 1]))
    return float(gc[gtree.query([x, z])[1], 1])
inst0 = np.fromfile(rd('houses.inst.bin'), np.float32).reshape(-1, 6); new = []
STEP_M = 60.0                                                            # uma ruína a cada ~60 m (antes ~18 m: lotava)
for k in range(1, nc + 1):
    q = SV[lab == k]
    if len(q) < 4: continue
    c = q[:, [0, 2]].mean(0); u, s, vt = np.linalg.svd(q[:, [0, 2]] - c, full_matrices=False); ax = vt[0]; pr = (q[:, [0, 2]] - c) @ ax
    length = pr.max() - pr.min()
    if length < 18: continue
    cnt = max(1, min(3, int(round(length / STEP_M)))); ts = np.linspace(pr.min() + length / (2 * cnt), pr.max() - length / (2 * cnt), cnt) if cnt > 1 else [(pr.min() + pr.max()) / 2]
    yaw = math.atan2(-ax[1], ax[0])
    for t in ts:
        p = c + ax * t
        if aitree.query(p)[0] < 11.0: continue
        y = ground(p[0], p[1])
        new.append((p[0], y + 0.05, p[1], yaw, 1.0, mi_new))
new = np.array(new, np.float32).reshape(-1, 6); print('modelos novos colocados:', len(new))
def inside(xz, h, pad):                                                  # pontos dentro da pegada de uma instância (retângulo girado)
    c, sn = math.cos(h[3]), math.sin(h[3]); dx, dz = xz[:, 0] - h[0], xz[:, 1] - h[2]
    lx = dx * c - dz * sn; lz = dx * sn + dz * c                         # inverso de x' = x c + z s, z' = -x s + z c
    return (np.abs(lx) < W / 2 * h[4] + pad) & (np.abs(lz) < D / 2 * h[4] + pad)
Tr = np.fromfile(rd('trees.inst.bin'), np.float32).reshape(-1, 6); kt = np.ones(len(Tr), bool)
for h in new: kt &= ~inside(Tr[:, [0, 2]], h, 1.5)
Tr[kt].tofile(os.path.join(dst, 'assets', 'trees', 'inst.bin')); tj = json.load(open(rd('trees.json'))); tj['n'] = int(kt.sum()); json.dump(tj, open(os.path.join(dst, 'data', 'trees.json'), 'w'), separators=(',', ':'))
print('árvores tiradas de dentro das ruínas:', int((~kt).sum()))

# ---------------------------------------------------------------- 5) pedestres: sem arquibancada, em pé no chão e andando livres
import cv2
allinst = np.concatenate([inst0, new])
MD = H['models']
X0r, Z0r, Wc, Hc = -780, -640, 1450, 1360
def pxr(p): return np.round(np.c_[(p[:, 0] - X0r), (p[:, 2] - Z0r)]).astype(np.int32)
grass = np.zeros((Hc, Wc), np.uint8); block = np.zeros((Hc, Wc), np.uint8)
tid = -np.ones((Hc, Wc), np.int32); TRI = []                            # id do triângulo caminhável em cada pixel de 1 m
ibn = np.concatenate(newib).astype(np.uint16)
WALKRE = re.compile(r'^(gras|grava|conc|roada|roadf|roadg|side0|steps)')
walk_groups = []
for g_ in trk['groups']:
    n_ = names[g_['tex']]
    if g_['cat'] == 'shadow' or g_['cnt'] < 3: continue
    tr_ = ibn[g_['off']:g_['off'] + g_['cnt']].reshape(-1, 3); A_, B_, C_ = Pt[tr_[:, 0]], Pt[tr_[:, 1]], Pt[tr_[:, 2]]
    nn = np.cross(B_ - A_, C_ - A_); ny = np.abs(nn[:, 1]) / (np.linalg.norm(nn, axis=1) + 1e-9)
    if WALKRE.match(n_) and g_['cat'] == 'opaque': walk_groups.append((n_.startswith('gras'), tr_, ny))
    else:
        hy = np.max([A_[:, 1], B_[:, 1], C_[:, 1]], axis=0) - np.min([A_[:, 1], B_[:, 1], C_[:, 1]], axis=0)
        for k_ in np.nonzero((hy > .4) & (ny < .9))[0]:
            q_ = pxr(Pt[tr_[k_]]); cv2.fillConvexPoly(block, q_, 255); cv2.polylines(block, [q_], True, 255, 1)
for isg in (False, True):                                               # piso/concreto primeiro, relva por cima (a relva é a verdade do chão)
    for g_isg, tr_, ny in walk_groups:
        if g_isg != isg: continue
        for k_ in np.nonzero(ny > .85)[0]:
            TRI.append(Pt[tr_[k_]]); cv2.fillConvexPoly(tid, pxr(Pt[tr_[k_]]), len(TRI) - 1)
TRI = np.array(TRI); grass = ((tid >= 0) * 255).astype(np.uint8)
def g2(x, z):                                                           # altura exata do chão caminhável em (x,z) (interpolação no triângulo); None = não há chão (ficou no ar)
    ix, iz = int(round(x - X0r)), int(round(z - Z0r))
    for dz_ in (0, -1, 1):
        for dx_ in (0, -1, 1):
            jx, jz = ix + dx_, iz + dz_
            if 0 <= jx < Wc and 0 <= jz < Hc and tid[jz, jx] >= 0:
                A_, B_, C_ = TRI[tid[jz, jx]]; den = (B_[2] - C_[2]) * (A_[0] - C_[0]) + (C_[0] - B_[0]) * (A_[2] - C_[2])
                if abs(den) < 1e-9: return float(TRI[tid[jz, jx]][:, 1].mean())
                l1 = ((B_[2] - C_[2]) * (x - C_[0]) + (C_[0] - B_[0]) * (z - C_[2])) / den; l2 = ((C_[2] - A_[2]) * (x - C_[0]) + (A_[0] - C_[0]) * (z - C_[2])) / den
                l1, l2 = min(max(l1, 0), 1), min(max(l2, 0), 1)
                if l1 + l2 > 1: tt = l1 + l2; l1, l2 = l1 / tt, l2 / tt
                return float(l1 * A_[1] + l2 * B_[1] + (1 - l1 - l2) * C_[1])
    return None
aiw = np.array(json.load(open(os.path.join(dst, 'data', 'ext.json')))['ai'])
for k_ in range(len(aiw)):                                              # corredor da pista: pedestre nunca entra (largura de cada ponto + 6 m)
    a_, b_ = aiw[k_], aiw[(k_ + 1) % len(aiw)]; rr = int(round(max(a_[4], a_[5], b_[4], b_[5]) + 6))
    cv2.line(block, (int(round(a_[0] - X0r)), int(round(a_[2] - Z0r))), (int(round(b_[0] - X0r)), int(round(b_[2] - Z0r))), 255, rr * 2)
for h in allinst:                                                       # casas (todas) com folga
    M_ = MD[int(h[5])]; c_, s_ = math.cos(h[3]), math.sin(h[3]); hw, hd = M_['w'] * h[4] / 2 + 1.5, M_['d'] * h[4] / 2 + 1.5
    q_ = np.array([(h[0] + lx * c_ + lz * s_, h[2] - lx * s_ + lz * c_) for lx, lz in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))])
    cv2.fillConvexPoly(block, np.round(q_ - [X0r, Z0r]).astype(np.int32), 255)
for t_ in Tr[kt]: cv2.circle(block, (int(round(t_[0] - X0r)), int(round(t_[2] - Z0r))), 2, 255, -1)
block = cv2.dilate(block, np.ones((3, 3), np.uint8)); free = (cv2.erode(grass, np.ones((3, 3), np.uint8)) > 0) & (block == 0)
if os.environ.get('DBGMASK'):
    dbg = np.dstack([grass, free.astype(np.uint8) * 255, block]); cv2.imwrite(os.environ['DBGMASK'], dbg)
def isfree(x, z):
    ix, iz = int(round(x - X0r)), int(round(z - Z0r)); return 0 <= ix < Wc and 0 <= iz < Hc and bool(free[iz, ix])

PO = np.fromfile(rd('people.bin'), np.float32).reshape(-1, 8).copy(); rng = np.random.RandomState(11)
seated = PO[:, 5] > 0
keep = np.ones(len(PO), bool)
for h in new: keep &= ~inside(PO[:, [0, 2]], h, 1.0)                    # dentro das ruínas
keep &= ~(seated & (rng.rand(len(PO)) < .55))                           # os que estavam sentados: afina (a arquibancada acabou)
remap = -np.ones(len(PO), np.int64); remap[keep] = np.arange(keep.sum())
for i in np.nonzero(keep)[0]:                                           # sem chão embaixo (estava num assento que não existe mais) -> some
    if g2(PO[i, 0], PO[i, 2]) is None: keep[i] = False
remap = -np.ones(len(PO), np.int64); remap[keep] = np.arange(keep.sum())
P2 = PO[keep].copy(); P2[:, 5] = 0                                      # ninguém mais "sentado"
for i in range(len(P2)):
    pn = int(P2[i, 6]); P2[i, 6] = remap[pn] if 0 <= pn < len(PO) and keep[pn] else -1   # índices dos pares refeitos
for i in range(len(P2)): P2[i, 1] = g2(P2[i, 0], P2[i, 2])         # pés no chão (os da arquibancada flutuavam)
N2 = len(P2); WALK = np.zeros((N2, 14), np.float32); nwalk = 0
for i in range(N2):
    x, z, y = P2[i, 0], P2[i, 2], P2[i, 1]; hy0 = y; WALK[i, :12] = [x, z, y] * 4
    if P2[i, 6] >= 0 or rng.rand() < .22: continue    # em conversa / sem espaço livre / 22% ficam parados
    wps = [(x, z)]
    for _ in range(3):
        for _t in range(14):
            r_ = 3 + rng.rand() * 12; a_ = rng.rand() * 6.2832; cx_, cz_ = wps[-1][0] + math.cos(a_) * r_, wps[-1][1] + math.sin(a_) * r_
            if not isfree(cx_, cz_) or math.hypot(cx_ - x, cz_ - z) > 16 or (g2(cx_, cz_) is None or abs(g2(cx_, cz_) - hy0) > .7): continue
            ok = all((isfree(px_, pz_) or math.hypot(px_ - x, pz_ - z) < 2.5) and (g2(px_, pz_) is not None and abs(g2(px_, pz_) - hy0) < .9) for px_, pz_ in ((wps[-1][0] + (cx_ - wps[-1][0]) * f, wps[-1][1] + (cz_ - wps[-1][1]) * f) for f in np.linspace(0, 1, max(2, int(r_ * 2)))))   # (a folga junto à cerca onde ele já está é tolerada)
            if ok: wps.append((cx_, cz_)); break
    if len(wps) < 2: continue
    while len(wps) < 4: wps.append(wps[-1])
    for k_, (wx, wz) in enumerate(wps[:4]): WALK[i, k_ * 3:k_ * 3 + 3] = [wx, wz, g2(wx, wz)]
    WALK[i, 12] = 1.0 + rng.rand() * .6; WALK[i, 13] = 2.0 + rng.rand() * 5.0; nwalk += 1
P2.tofile(os.path.join(dst, 'assets', 'peds', 'people.bin')); WALK.tofile(os.path.join(dst, 'assets', 'peds', 'walk.bin'))
pj['people']['n'] = int(N2); pj['walk'] = {'n': int(N2), 'd': {'$file': 'assets/peds/walk.bin'}}
json.dump(pj, open(os.path.join(dst, 'data', 'peds.json'), 'w'), separators=(',', ':'))
print('pedestres: %d -> %d | andando livremente: %d | sem par de conversa: %d' % (len(PO), N2, nwalk, int((P2[:, 6] < 0).sum())))
allinst.tofile(os.path.join(dst, 'assets', 'houses', 'inst.bin')); H['n'] = int(len(allinst))
json.dump(H, open(os.path.join(dst, 'data', 'houses.json'), 'w'), separators=(',', ':'))
