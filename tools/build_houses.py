#!/usr/bin/env python3
"""Troca os prédios da pista (malha bldng*/bckgnd*/roof*) por casas do GTA SA (DFF + TXD), instanciadas.
Uso: python3 tools/build_houses.py <pasta com .dff/.txd> [pasta_do_jogo] [--debug mapa.png]
 - lê TODOS os .dff e .txd da pasta (modelos idênticos são fundidos; textura que faltar usa reboco branco);
 - remove da malha da pista os prédios antigos (originais ficam em _orig_buildings/ — pode rodar de novo sem perdê-los);
 - descobre a pegada de cada quarteirão antigo e preenche com casas (orientadas pela rua mais próxima, escala 1,0 / 0,8 / 0,65);
 - grava assets/houses/* e data/houses.json (o motor desenha em js/game.js → drawHouses)."""
import sys, os, json, shutil, glob, math, hashlib
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwdff, rwtxd

args = [a for a in sys.argv[1:] if not a.startswith('--')]
dbg = None
if '--debug' in sys.argv: dbg = sys.argv[sys.argv.index('--debug') + 1]; args = [a for a in args if a != dbg]
src = args[0]; dst = args[1] if len(args) > 1 else '.'
OUT = os.path.join(dst, 'assets', 'houses'); os.makedirs(OUT, exist_ok=True)
ORIG = os.path.join(dst, '_orig_buildings'); os.makedirs(ORIG, exist_ok=True)
for s, nm in ((os.path.join(dst, 'data', 'trk.json'), 'trk.json'), (os.path.join(dst, 'assets', 'track', 'track.ib.bin'), 'track.ib.bin'), (os.path.join(dst, 'assets', 'track', 'track.vb.bin'), 'track.vb.bin')):
    if not os.path.exists(os.path.join(ORIG, nm)): shutil.copy(s, os.path.join(ORIG, nm))
for s, nm in ((os.path.join(dst, 'assets', 'trees', 'inst.bin'), 'trees.inst.bin'), (os.path.join(dst, 'assets', 'peds', 'people.bin'), 'people.bin')):
    if os.path.exists(s) and not os.path.exists(os.path.join(ORIG, nm)): shutil.copy(s, os.path.join(ORIG, nm))
BLD = __import__('re').compile(r'^(bldng|bckgnd|roof)')       # texturas dos prédios (cwin = janelas dos boxes: fica)
FALLBACK = 'tex_1559_0'                                       # reboco branco, para textura ausente nos TXD
MAXTEX = 512

# ---------------------------------------------------------------- texturas (TXD)
tx = {}
for f in sorted(glob.glob(os.path.join(src, '*.txd'))):
    for k, v in rwtxd.read_txd(f).items(): tx.setdefault(k, v)

# ---------------------------------------------------------------- modelos (DFF)
models = []; seen = {}
for f in sorted(glob.glob(os.path.join(src, '*.dff'))):
    fr, ge, at = rwdff.parse(f); g = ge[0]; v = g['verts']; uv = g['uv'][0]; cols = g['cols']
    fl, meshes = g['bin']
    key = hashlib.md5()
    for mi, ix in meshes:                                      # assinatura da forma (independe da ordem dos vértices)
        c = np.round(v[ix.reshape(-1, 3)].mean(1), 2); key.update(g['mats'][mi]['tex'].lower().encode()); key.update(c[np.lexsort(c.T)].tobytes())
    k = key.hexdigest()
    if k in seen: print('  (igual a %s) %s' % (seen[k], os.path.basename(f))); continue
    seen[k] = os.path.basename(f)
    by = {}
    for mi, ix in meshes: by.setdefault(g['mats'][mi]['tex'].lower(), []).append(ix.reshape(-1, 3))
    models.append(dict(name=os.path.splitext(os.path.basename(f))[0].split('-')[-1], v=v, uv=uv, cols=cols, by=by))
print('modelos distintos:', len(models), [m['name'] for m in models])

VB, IB, MOD, used_tex = [], [], [], {}
vtot = 0
for m in models:
    v = m['v']; gv = np.c_[v[:, 0], v[:, 2], v[:, 1]]          # GTA (direita, frente, cima) -> jogo (direita, cima, frente)
    mn, mx = gv.min(0), gv.max(0); cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    off = np.array([cx, mn[1] + 0.20, cz])                       # base 20 cm abaixo do chão (fundação assenta no terreno)
    parts = []
    for tex, tl in sorted(m['by'].items()):
        tl = np.concatenate(tl); name = tex if tex in tx else FALLBACK
        if tex not in tx: print('  textura ausente %s -> %s' % (tex, FALLBACK))
        used_tex[name] = 1
        i0 = sum(len(x) for x in IB)
        P = gv[tl.reshape(-1)] - off; U = m['uv'][tl.reshape(-1)]; C = m['cols'][tl.reshape(-1)]
        T = P.reshape(-1, 3, 3); n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        N = np.repeat(n, 3, axis=0)
        vb = np.zeros(len(P), dtype=[('p', '<f4', 3), ('uv', '<f4', 2), ('n', 'i1', 4), ('c', 'u1', 4)])
        vb['p'] = P; vb['uv'] = U; vb['n'][:, :3] = np.clip(np.round(N * 127), -127, 127); vb['c'] = C
        VB.append(vb); ids = (np.arange(len(P)) + vtot).astype(np.uint16); vtot += len(P); IB.append(ids)
        parts.append(dict(tex=name, start=int(i0), count=int(len(ids))))
    w = float(mx[0] - mn[0]); d = float(mx[2] - mn[2]); h = float(mx[1] - mn[1])
    MOD.append(dict(name=m['name'], w=round(w, 2), d=round(d, 2), h=round(h, 2), parts=parts))
    print('  %-18s %4.1f x %4.1f m, altura %4.1f, %d tris' % (m['name'], w, d, h, sum(p['count'] for p in parts) // 3))
assert vtot < 65536, 'vertices demais para índice de 16 bits'
np.concatenate(VB).tofile(os.path.join(OUT, 'houses.vb.bin')); np.concatenate(IB).tofile(os.path.join(OUT, 'houses.ib.bin'))
texjson = {}
for name in sorted(used_tex):
    im = tx[name].convert('RGB')
    if max(im.size) > MAXTEX: s = MAXTEX / max(im.size); im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.webp'), quality=88, method=6); texjson[name] = {'$file': 'assets/houses/%s.webp' % name}

# ---------------------------------------------------------------- pista: prédios antigos
trk = json.load(open(os.path.join(ORIG, 'trk.json'))); names = trk['texnames']
vbt = np.fromfile(os.path.join(ORIG, 'track.vb.bin'), dtype=[('p', '<f4', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('uv', '<f4', 2)])
ibt = np.fromfile(os.path.join(ORIG, 'track.ib.bin'), np.uint16); Pt = vbt['p']
X0, Z0, R = -780, -640, 1.0; Wc, Hc = int(1450 / R), int(1360 / R)
def px(p): return np.round(np.c_[(p[:, 0] - X0) / R, (p[:, 2] - Z0) / R]).astype(np.int32)
bm = np.zeros((Hc, Wc), np.uint8); road = np.zeros((Hc, Wc), np.uint8); block = np.zeros((Hc, Wc), np.uint8)
gh = np.full((Hc, Wc), -1e9, np.float32); rtri = []; bvert = []
ROAD = __import__('re').compile(r'^(road|grava|ba_rumbl|rmbld)'); GROUND = __import__('re').compile(r'^(gras|grava|road|ba_rumbl|rmbld|conc|steps|stepundr)')
INFRA = __import__('re').compile(r'^(tents|tntbase|stall|canv|astnd|stand|grnstnd|gantry|pitfrnt|truck|tral|cwin)')   # arquibancadas, boxes, tendas, caminhões
for g in trk['groups']:
    n = names[g['tex']]; seg = ibt[g['off']:g['off'] + g['cnt']]; tri = seg[:len(seg) // 3 * 3].reshape(-1, 3)   # (há um grupo de sombra com 20 índices: ignora o resto)
    if BLD.match(n):
        bvert.append(np.unique(tri))
        for t in tri:
            q = px(Pt[t]); cv2.fillConvexPoly(bm, q, 255); cv2.polylines(bm, [q], True, 255, 1)
    elif g['cat'] == 'opaque':
        if ROAD.match(n):
            for t in tri: cv2.fillConvexPoly(road, px(Pt[t]), 255)
            rtri.append(np.unique(tri))
        if INFRA.match(n):
            for t in tri: cv2.fillConvexPoly(block, px(Pt[t]), 255)
        if GROUND.match(n):                                    # altura do chão (plano de cada triângulo, 1 m)
            for t in tri:
                a, b, c = Pt[t]; nrm = np.cross(b - a, c - a); l = np.linalg.norm(nrm)
                if l < 1e-6 or abs(nrm[1]) / l < .45: continue
                q = px(Pt[t]); x0, z0 = q.min(0); x1, z1 = q.max(0)
                if x1 - x0 > 400 or z1 - z0 > 400: continue
                xs, zs = np.meshgrid(np.arange(x0, x1 + 1), np.arange(z0, z1 + 1)); m = np.zeros(xs.shape, np.uint8)
                cv2.fillConvexPoly(m, q - [x0, z0], 1)
                wx = xs * R + X0; wz = zs * R + Z0; y = a[1] - (nrm[0] * (wx - a[0]) + nrm[2] * (wz - a[2])) / nrm[1]
                sub = gh[z0:z1 + 1, x0:x1 + 1]; sel = (m > 0) & (y > sub); sub[sel] = y[sel]
# corredor da pista: traçado da IA (data/ext.json) com a largura de cada ponto + folga
ai = json.load(open(os.path.join(dst, 'data', 'ext.json')))['ai']; aip = np.array(ai, np.float64)
for i in range(len(aip)):
    a, b = aip[i], aip[(i + 1) % len(aip)]; hw = max(a[4], a[5], b[4], b[5]) + 5.0
    cv2.line(block, tuple(px(np.array([a[:3]]))[0]), tuple(px(np.array([b[:3]]))[0]), 255, int(round(2 * hw / R)))
bm = cv2.dilate(bm, np.ones((5, 5), np.uint8))
bm = cv2.morphologyEx(bm, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
bm = (ndi.binary_fill_holes(bm > 0) * 255).astype(np.uint8)       # preenche o miolo de paredes que fecham um anel
# orientação local das paredes antigas (tensor de ângulo x4, vale para qualquer quarteirão girado)
gx = cv2.Sobel(cv2.GaussianBlur(bm.astype(np.float32) / 255, (0, 0), 1.5), cv2.CV_32F, 1, 0); gz = cv2.Sobel(cv2.GaussianBlur(bm.astype(np.float32) / 255, (0, 0), 1.5), cv2.CV_32F, 0, 1)
th4 = 4 * np.arctan2(gz, gx); mag = np.hypot(gx, gz)
c4 = cv2.GaussianBlur(mag * np.cos(th4), (0, 0), 18); s4 = cv2.GaussianBlur(mag * np.sin(th4), (0, 0), 18)
wall_ang = np.arctan2(s4, c4) / 4                              # direção (x,z) das paredes, módulo 90°
bv = np.unique(np.concatenate(bvert)); byv = Pt[bv][:, 1]
hit = gh > -1e8; idx = ndi.distance_transform_edt(~hit, return_distances=False, return_indices=True); gh = gh[idx[0], idx[1]]
def ground(x, z):
    i = int(np.clip((z - Z0) / R, 0, Hc - 1)); j = int(np.clip((x - X0) / R, 0, Wc - 1)); return float(gh[i, j])

# tangente da rua (PCA dos vértices de asfalto num raio de 45 m)
rv = Pt[np.unique(np.concatenate(rtri))][:, [0, 2]]; tree = cKDTree(rv)
def street_dir(x, z, fallback=None):
    ix = tree.query_ball_point([x, z], 45)
    if len(ix) < 6: return fallback
    q = rv[ix] - rv[ix].mean(0); w, V = np.linalg.eigh(q.T @ q / len(q)); return V[:, 1]

# ---------------------------------------------------------------- empacotamento das casas nas pegadas
lab, nc = ndi.label(bm > 0); rng = np.random.RandomState(7)
occ = np.zeros((Hc, Wc), np.uint8); inst = []; stats = []; bad = (block > 0)
def rect_poly(cx, cz, yaw, w, d):                              # cantos no mundo, mesma rotação do shader
    c, s = math.cos(yaw), math.sin(yaw); pts = []
    for lx, lz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        pts.append((cx + lx * c + lz * s, cz - lx * s + lz * c))
    return np.array(pts)
def local(poly):                                               # máscara do retângulo só no seu quadro (x0,z0,x1,z1)
    q = px(np.c_[poly[:, 0], np.zeros(len(poly)), poly[:, 1]]); x0, z0 = np.maximum(q.min(0), 0); x1, z1 = np.minimum(q.max(0) + 1, [Wc, Hc])
    m = np.zeros((z1 - z0, x1 - x0), np.uint8); cv2.fillConvexPoly(m, q - [x0, z0], 1); return m, (z0, z1, x0, x1)
for k in range(1, nc + 1):
    comp = lab == k; area = int(comp.sum())
    if area < 160: continue
    ys, xs = np.nonzero(comp); cand = sorted(zip(ys.tolist(), xs.tolist()), key=lambda c: (c[0] // 3, c[1])); placed = 0
    for (iy, ix) in cand:
        if iy % 2 or ix % 2 or occ[iy, ix]: continue
        x = ix * R + X0; z = iy * R + Z0
        wa = float(wall_ang[iy, ix]); sd = street_dir(x, z, None)
        # eixo longo da casa (local z -> mundo (sin yaw, cos yaw)) paralelo à parede/rua; 4 giros possíveis
        opts = [wa + math.pi / 2 * i for i in range(4)] if True else []
        yaw0 = min(opts, key=lambda y: abs(math.sin(y) * (sd[1] if sd is not None else 0) - math.cos(y) * (sd[0] if sd is not None else 0))) if sd is not None else opts[0]
        yaw0 += math.pi if rng.rand() < .5 else 0.0
        done = False
        # combinações (escala, modelo): maiores primeiro, com sorteio para variar (cabendo, prefere casa grande)
        pairs = sorted(((scl, mi) for scl in (1.0, 0.8, 0.65) for mi in range(len(MOD))), key=lambda t: -(t[0] * t[0] * MOD[t[1]]['w'] * MOD[t[1]]['d']) * (0.55 + 0.9 * rng.rand()))
        for scl, mi in pairs:
            M = MOD[mi]; w, d = M['w'] * scl, M['d'] * scl
            for dy in (0.0, math.pi / 2):                        # tenta o eixo longo ao longo e atravessado
                yaw = yaw0 + dy; poly = rect_poly(x, z, yaw, w, d); r, (z0, z1, x0, x1) = local(poly); a = int(r.sum())
                if a < 20: continue
                if (r & comp[z0:z1, x0:x1]).sum() < .72 * a: continue
                if (r & occ[z0:z1, x0:x1]).sum() > .04 * a: continue
                if (r & bad[z0:z1, x0:x1]).sum() > .02 * a: continue
                cl, (cz0, cz1, cx0, cx1) = local(rect_poly(x, z, yaw, w + 2.5, d + 2.5)); occ[cz0:cz1, cx0:cx1] |= cl
                gy = min(ground(*p) for p in list(poly) + [(x, z)])
                inst.append((x, gy + 0.05, z, yaw, scl * (0.97 + 0.06 * rng.rand()), mi)); placed += 1; done = True; break
            if done: break
    stats.append((k, area, placed))
inst = np.array(inst, np.float32)
print('quarteirões: %d, casas: %d (por modelo %s)' % (len(stats), len(inst), np.bincount(inst[:, 5].astype(int), minlength=len(MOD)).tolist()))
inst.tofile(os.path.join(OUT, 'inst.bin'))

# ---------------------------------------------------------------- árvores/pedestres que cairiam dentro de uma casa (parte dos ORIGINAIS guardados)
def to_local(px_, pz_, h):                                     # mundo -> quadro da casa (inverso da rotação do shader)
    x, y, z, yaw, sc, mi = h; c, sn = math.cos(yaw), math.sin(yaw); dx, dz = px_ - x, pz_ - z
    return dx * c - dz * sn, dx * sn + dz * c, MOD[int(mi)]['w'] * sc / 2, MOD[int(mi)]['d'] * sc / 2
def near(P, h, r=30): return np.nonzero((np.abs(P[:, 0] - h[0]) < r) & (np.abs(P[:, 2] - h[2]) < r))[0]
tf = os.path.join(ORIG, 'trees.inst.bin')
if os.path.exists(tf):
    T = np.fromfile(tf, np.float32).reshape(-1, 6); keep = np.ones(len(T), bool)
    for h in inst:
        for i in near(T, h):
            lx, lz, hw, hd = to_local(T[i, 0], T[i, 2], h)
            if abs(lx) <= hw + 1.0 and abs(lz) <= hd + 1.0: keep[i] = False
    T[keep].tofile(os.path.join(dst, 'assets', 'trees', 'inst.bin'))
    tj = os.path.join(dst, 'data', 'trees.json'); tcfg = json.load(open(tj)); tcfg['n'] = int(keep.sum()); json.dump(tcfg, open(tj, 'w'), separators=(',', ':'))
    print('árvores dentro de casas removidas: %d (restam %d)' % ((~keep).sum(), keep.sum()))
pf_ = os.path.join(ORIG, 'people.bin')
if os.path.exists(pf_):
    Pp = np.fromfile(pf_, np.float32).reshape(-1, 8).copy(); moved = 0
    for h in inst:
        for i in near(Pp, h):
            lx, lz, hw, hd = to_local(Pp[i, 0], Pp[i, 2], h)
            if abs(lx) <= hw + 0.3 and abs(lz) <= hd + 0.3:        # empurra para fora pela borda mais próxima (+0,8 m)
                if hw - abs(lx) < hd - abs(lz): lx = math.copysign(hw + 0.8, lx)
                else: lz = math.copysign(hd + 0.8, lz)
                c, sn = math.cos(h[3]), math.sin(h[3])
                Pp[i, 0] = h[0] + lx * c + lz * sn; Pp[i, 2] = h[2] - lx * sn + lz * c; moved += 1
    Pp.tofile(os.path.join(dst, 'assets', 'peds', 'people.bin')); print('pedestres tirados de dentro de casas:', moved)

# ---------------------------------------------------------------- remove os prédios antigos da malha da pista + limpa sombras
bm_near = cv2.dilate(bm, np.ones((25, 25), np.uint8))          # ~12 m em volta dos prédios antigos
def keep_shadow(name, tri):
    """Descarta sombras 'baked' defeituosas: inclinadas, gigantes (faixas no céu), no ar (tshado) e sombras de prédios que sumiram (shado)."""
    A, B, C = Pt[tri[:, 0]], Pt[tri[:, 1]], Pt[tri[:, 2]]; n = np.cross(B - A, C - A); ny = np.abs(n[:, 1]) / (np.linalg.norm(n, axis=1) + 1e-9)
    ext = np.max([np.abs(A - B).max(1), np.abs(B - C).max(1), np.abs(A - C).max(1)], axis=0); keep = (ny >= .8) & (ext <= 40); cen = (A + B + C) / 3
    for i in np.nonzero(keep)[0]:
        x, y, z = cen[i]; gi = int(np.clip((z - Z0) / R, 0, Hc - 1)); gj = int(np.clip((x - X0) / R, 0, Wc - 1))
        if name.startswith('tshado') and y - gh[gi, gj] > 2.0: keep[i] = False
        elif name.startswith('shado') and bm_near[gi, gj]: keep[i] = False
    return keep
newib = []; groups = []; pos = 0; removed = 0; shadow_cut = 0
for g in sorted(trk['groups'], key=lambda g: g['off']):
    nm_ = names[g['tex']]
    if g['cat'] != 'shadow' and nm_.startswith(('shado', 'tshado')): continue      # sombra mal categorizada como opaca = triângulo preto sólido
    if BLD.match(nm_): removed += g['cnt'] // 3; continue
    seg = ibt[g['off']:g['off'] + g['cnt']]
    if g['cat'] == 'shadow':
        t3 = seg[:len(seg) // 3 * 3].reshape(-1, 3); k_ = keep_shadow(nm_, t3); shadow_cut += int((~k_).sum()); seg = t3[k_].ravel()
    ng = dict(g); ng['off'] = pos; ng['cnt'] = int(len(seg)); pos += len(seg); newib.append(seg); groups.append(ng)
# sombra de contato sob cada casa (decalque 'shado1', mesmo grupo de sombras da pista)
sh_tex = next(g['tex'] for g in trk['groups'] if g['cat'] == 'shadow' and names[g['tex']].startswith('shado1'))
nv = len(vbt); qv = np.zeros(len(inst) * 4, dtype=vbt.dtype); qi = []
for k_, (x, y, z, yaw, sc, mi) in enumerate(inst):
    M = MOD[int(mi)]; q = rect_poly(x - 0.30 * M['h'] * sc, z - 0.26 * M['h'] * sc, yaw, M['w'] * sc + 1.0, M['d'] * sc + 1.0)   # deslocada para o lado oposto ao sol
    for j in range(4): qv[k_ * 4 + j]['p'] = (q[j][0], y + 0.03, q[j][1]); qv[k_ * 4 + j]['n'] = (0, 127, 0, 0); qv[k_ * 4 + j]['c'] = (255, 255, 255, 255); qv[k_ * 4 + j]['uv'] = ((0, 0), (1, 0), (1, 1), (0, 1))[j]
    b0 = nv + k_ * 4; qi += [b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3]
qi = np.array(qi, np.uint16); assert nv + len(qv) < 65536
groups.append({'tex': sh_tex, 'cat': 'shadow', 'off': pos, 'cnt': int(len(qi))}); newib.append(qi)
trk['groups'] = groups
np.concatenate([vbt, qv]).tofile(os.path.join(dst, 'assets', 'track', 'track.vb.bin'))
np.concatenate(newib).astype(np.uint16).tofile(os.path.join(dst, 'assets', 'track', 'track.ib.bin'))
json.dump(trk, open(os.path.join(dst, 'data', 'trk.json'), 'w'), separators=(',', ':'))
print('triângulos de prédios removidos da pista:', removed, '| sombras defeituosas/órfãs removidas:', shadow_cut, '| sombras de casas:', len(inst))

json.dump({'vb': {'$file': 'assets/houses/houses.vb.bin'}, 'ib': {'$file': 'assets/houses/houses.ib.bin'}, 'models': MOD, 'tex': texjson,
           'inst': {'$file': 'assets/houses/inst.bin'}, 'n': int(len(inst)), 'far': 1100, 'light': 1.4},
          open(os.path.join(dst, 'data', 'houses.json'), 'w'), separators=(',', ':'))

if dbg:
    from PIL import ImageDraw
    im = np.zeros((Hc, Wc, 3), np.uint8); im[gh > -1e8] = (30, 60, 30); im[road > 0] = (110, 110, 110); im[bm > 0] = (150, 50, 40); im[block > 0] = (160, 140, 60)
    im = Image.fromarray(im); dr = ImageDraw.Draw(im)
    for x, y, z, yaw, s, mi in inst:
        M = MOD[int(mi)]; p = rect_poly(x, z, yaw, M['w'] * s, M['d'] * s)
        dr.polygon([((a - X0) / R, (b - Z0) / R) for a, b in p], outline=(80, 200, 255), fill=(40, 120, 180))
    im.save(dbg)
print('ok')
