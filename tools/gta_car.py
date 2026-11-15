#!/usr/bin/env python3
"""Converte um carro do GTA SA (.dff + .txd + linha do handling.cfg) para uma pasta cars/<id>/ do XB Adelaide.
Uso: python3 tools/gta_car.py <id> "<Nome>" Carro.dff Carro.txd handling.cfg [escala]
Requer: numpy, Pillow."""
import sys, os, json, struct
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rwdff import parse, world
from rwtxd import read_txd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AT = 2048
PAD = 0.5
# células do atlas (x,y,w,h) em pixels; texturas "env" do SA usam na verdade o atlas Generic_A
CELLS = {'generic_a': (0, 0, 1024, 1024), 'interior': (1024, 0, 1024, 1024), 'generic_b': (0, 1024, 1024, 512),
         'badges': (1024, 1024, 256, 128), 'plate': (1280, 1024, 512, 256), 'generic_c': (1024, 1280, 256, 256)}
SW = {'paint': 0, 'black': 1, 'chrome': 2, 'trim': 3, 'mirror': 4}      # amostras de cor lisa (64x64) em y=1792
SWY = 1792
TEXMAP = {'n4speed_vc_env': 'generic_a', 'n4speed_vc_generic_a': 'generic_a', 'n4speed_vc_interior': 'interior',
          'n4speed_vc_generic_b': 'generic_b', 'n4speed_vc_badges': 'badges', 'n4speed_vc_plate': 'plate',
          'n4speed_vc_generic_c': 'generic_c'}
FLAT = {'n4speed_vc_black': 'black', 'n4speed_vc_chrome': 'chrome', 'n4speed_vc_extra_1': 'trim',
        'n4speed_vc_mirrors': 'mirror', 'n4speed_vc_willard_eudora': 'paint'}
SKINS = [('vermelho', 'Vermelho', '#a31515', '#e0382c', (150, 22, 22)), ('azul', 'Azul', '#1b3fb0', '#3a63e0', (28, 62, 170)),
         ('preto', 'Preto', '#1c1c1f', '#8a8d94', (24, 24, 27)), ('prata', 'Prata', '#c9ccd1', '#d6dae0', (190, 194, 200))]
SWATCH = {'black': (10, 10, 10), 'chrome': (196, 198, 204), 'trim': (62, 62, 66), 'mirror': (150, 170, 190)}

def handling(path):
    for ln in open(path, errors='ignore'):
        s = ln.strip()
        if not s or s[0] in '#;=': continue
        t = s.split()
        if len(t) > 20:
            f = lambda i: float(t[i])
            return dict(name=t[0], mass=f(1), turn=f(2), drag=f(3), com=(f(4), f(5), f(6)), gears=int(f(11)), vmax=f(12), acc=f(13), drive=t[15])
    raise SystemExit('linha de handling não encontrada')

def cat_of(gname, m):
    t = (m['tex'] or '').lower(); col = tuple(m['color'][:3])
    if t == 'n4speed_vc_glass_ok': return 'glass'
    if gname == 'Willard_Lights': return 'lights'
    if gname.startswith('bump_'): return 'bumpers'
    if t in ('n4speed_vc_chrome', 'n4speed_vc_extra_1'): return 'chrome'
    if t == 'n4speed_vc_willard_eudora' or col in ((60, 255, 0), (255, 0, 175)): return 'paint'
    return 'detail'

CATS = [('paint', 'MSH-Chassis1', 'carmetal', .55), ('bumpers', 'MSH-Bumpers1', 'carmetal', .45), ('detail', 'MSH-Detail1', 'carmetal', .18),
        ('chrome', 'MSH-Chrome1', 'carchrome', .8), ('lights', 'MSH-Headlights1', 'carmetal', .7), ('glass', 'MSH-Windows1', 'carglass', None)]
KEEP = ['chassis', 'Willard_A', 'Willard_B', 'Willard_C', 'Willard_Lights', 'door_rf_ok', 'door_lr_ok', 'door_lf_ok', 'door_rr_ok', 'bonnet_ok',
        'boot_ok', 'bump_front_ok', 'bump_rear_ok', 'windscreen_ok', 'wing_rf_ok', 'wing_lf_ok', 'FUCK_YOU']

def main():
    cid, cname, dff, txd, hcfg = sys.argv[1:6]
    sc = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
    H = handling(hcfg)
    fr, ge, at = parse(dff)
    T = read_txd(txd)
    out = os.path.join(ROOT, 'cars', cid); os.makedirs(out, exist_ok=True)
    sw = lambda p: (p[0], p[2], p[1])               # GTA (x,y,z: direita,frente,cima) -> jogo (x,y,z: direita,cima,frente)

    # ---------- malha da carroceria ----------
    P, N, UV = [], [], []
    IB = []; objs = []
    for cat, pname, mat, refl in CATS:
        fv = len(P); start = len(IB); keymap = {}
        for fi, gi, fl in at:
            f = fr[fi]
            if f['name'] not in KEEP: continue
            g = ge[gi]; W = world(fr, fi)
            v = (np.c_[g['verts'], np.ones(len(g['verts']))] @ W.T)[:, :3]
            nr = g['norms'] if g['norms'] is not None else np.zeros_like(v)
            nr = nr @ W[:3, :3].T
            uv0 = g['uv'][0] if g['uv'] is not None else np.zeros((len(v), 2), np.float32)
            for t in g['tri']:
                m = g['mats'][t[2]]
                if cat_of(f['name'], m) != cat: continue
                tn = (m['tex'] or '').lower(); tri = (t[1], t[0], t[3])
                if cat == 'glass': kind, cell, sh = 'fix', None, (0, 0)
                elif tn in FLAT or (tuple(m['color'][:3]) in ((60, 255, 0), (255, 0, 175)) and tn not in TEXMAP):
                    kind, cell, sh = 'flat', SW['paint' if (tn == 'n4speed_vc_willard_eudora' or tn not in FLAT) else FLAT[tn]], (0, 0)
                else:
                    cn = TEXMAP.get(tn, 'generic_a'); kind, cell = 'tex', cn
                    cen = uv0[list(tri)].mean(0); sh = (int(np.floor(cen[0])), int(np.floor(cen[1])))
                ids = []
                for vi in tri:
                    key = (gi, int(vi), kind, cell, sh)
                    if key not in keymap:
                        keymap[key] = len(P); P.append(np.array(sw(v[vi])) * sc); N.append(np.array(sw(nr[vi])))
                        if kind == 'fix': u = (0.5, 0.5)
                        elif kind == 'flat': u = ((SW_X(cell) + 32) / AT, (SWY + 32) / AT)
                        else:
                            x0, y0, w, h = CELLS[cell]; uu = float(np.clip(uv0[vi][0] - sh[0], 0, 1)); vv = float(np.clip(uv0[vi][1] - sh[1], 0, 1))
                            u = ((x0 + PAD + uu * (w - 1)) / AT, (y0 + PAD + vv * (h - 1)) / AT)
                        UV.append(u)
                    ids.append(keymap[key])
                IB.append(ids)
        nv = len(P) - fv
        if nv:
            o = dict(name=pname, pos=[0, 0, 0], fv=fv, nv=nv, start=start * 3, count=(len(IB) - start) * 3, mat=mat)
            if refl is not None: o['refl'] = refl
            if cat == 'glass': o['tex'] = 'gls'
            objs.append(o)

    def fixwind(ib_from):
        for i in range(ib_from, len(IB)):
            a, b, c = IB[i]
            gn = np.cross(P[b] - P[a], P[c] - P[a]); vn = N[a] + N[b] + N[c]
            if np.dot(gn, vn) > 0: IB[i] = [a, c, b]
    fixwind(0)

    # ---------- rodas ----------
    wg = ge[[i for fi, i, _ in at if fr[fi]['name'] == 'wheel'][0]]
    wv = wg['verts']; wn = wg['norms']; wuv = wg['uv'][0]
    wc = {n: world(fr, i)[:3, 3] for i, n in [(i, f['name']) for i, f in enumerate(fr)] if n.startswith('wheel_') and n.endswith('_dummy')}
    cen = {'FL': wc['wheel_lf_dummy'], 'FR': wc['wheel_rf_dummy'], 'BL': wc['wheel_lb_dummy'], 'BR': wc['wheel_rb_dummy']}
    wr = float((wv[:, 1].max() - wv[:, 1].min()) / 2) * sc
    for w in ('FL', 'FR', 'BL', 'BR'):
        left = w[1] == 'L'; pos = [float(c) * sc for c in sw(cen[w])]
        for nm, mi in (('Tyre', 1), ('Disc', 0)):
            fv = len(P); start = len(IB); km = {}
            for t in wg['tri']:
                if t[2] != mi: continue
                ids = []
                for vi in (t[1], t[0], t[3]):
                    if vi not in km:
                        p = np.array(sw(wv[vi])) * sc; n = np.array(sw(wn[vi])) if wn is not None else np.array([0, 1, 0.])
                        if left: p = np.array([-p[0], p[1], -p[2]]); n = np.array([-n[0], n[1], -n[2]])
                        km[vi] = len(P); P.append(p); N.append(n)
                        UV.append(((SW_X('trim') + 32) / AT, (SWY + 32) / AT) if nm == 'Disc' else (float(np.clip(wuv[vi][0], 0, 1)), float(np.clip(wuv[vi][1], 0, 1))))
                    ids.append(km[vi])
                IB.append(ids)
            fixwind(start)
            o = dict(name=f'MSH-{w}{nm}', pos=pos, fv=fv, nv=len(P) - fv, start=start * 3, count=(len(IB) - start) * 3, mat='cartyre' if nm == 'Tyre' else 'carmetal')
            if nm == 'Tyre': o['refl'] = .1
            objs.append(o)
    # discos de borrão (blur)
    for w in ('FL', 'FR', 'BL', 'BR'):
        left = w[1] == 'L'; s = -1 if left else 1; pos = [float(c) * sc for c in sw(cen[w])]
        fv = len(P); start = len(IB); R = 0.31 * sc; seg = 24
        P.append(np.array([s * .115 * sc, 0, 0])); N.append(np.array([s, 0, 0.])); UV.append((.5, .5))
        ring = []
        for rr, xo in ((.18, .12), (1.0, .10)):
            base = len(P)
            for k in range(seg):
                th = 2 * np.pi * k / seg; y = np.cos(th) * R * rr; z = np.sin(th) * R * rr
                P.append(np.array([s * xo * sc, y, z])); N.append(np.array([s, 0, 0.])); UV.append((.5 + .5 * rr * np.cos(th), .5 + .5 * rr * np.sin(th)))
            ring.append(base)
        c0 = fv
        for k in range(seg):
            k2 = (k + 1) % seg
            IB.append([c0, ring[0] + k, ring[0] + k2])
            IB.append([ring[0] + k, ring[1] + k, ring[1] + k2]); IB.append([ring[0] + k, ring[1] + k2, ring[0] + k2])
        fixwind(start)
        objs.append(dict(name=f'MSH-{w}_BAlloy', pos=pos, fv=fv, nv=len(P) - fv, start=start * 3, count=(len(IB) - start) * 3, mat='bluralloy'))
    assert len(P) < 65535, f'{len(P)} vértices: passa do limite de 16 bits'

    # ---------- binários ----------
    n = len(P); vb = np.zeros(n, dtype=np.dtype([('p', '<3f4'), ('n', '3i1'), ('pad', 'i1'), ('uv', '<2f4')]))
    vb['p'] = np.array(P, np.float32)
    nn = np.array(N, float); L = np.linalg.norm(nn, axis=1, keepdims=True); L[L < 1e-9] = 1
    vb['n'] = np.round(nn / L * 127).astype(np.int8); vb['uv'] = np.array(UV, np.float32)
    open(os.path.join(out, 'car.vb.bin'), 'wb').write(vb.tobytes())
    open(os.path.join(out, 'car.ib.bin'), 'wb').write(np.array(IB, np.uint16).tobytes())
    open(os.path.join(out, 'car.dd.bin'), 'wb').write(bytes(n * 4))

    # ---------- texturas ----------
    def tx(k): return T[k.lower()]
    def gb_norm():
        a = np.asarray(tx('n4speed_vc_generic_b').convert('RGB'), np.float32) / 255.0
        return a / max(float(np.percentile(a.mean(2), 60)), .05)
    base = Image.new('RGB', (AT, AT), (30, 30, 30))
    base.paste(tx('n4speed_vc_generic_a').convert('RGB').resize((1024, 1024), Image.LANCZOS), (0, 0))
    base.paste(tx('n4speed_vc_interior').convert('RGB').resize((1024, 1024), Image.LANCZOS), (1024, 0))
    base.paste(tx('n4speed_vc_badges').convert('RGB'), (1024, 1024))
    base.paste(tx('n4speed_vc_plate').convert('RGB').resize((512, 256), Image.LANCZOS), (1280, 1024))
    base.paste(tx('n4speed_vc_generic_c').convert('RGB').resize((256, 256), Image.LANCZOS), (1024, 1280))
    dr = ImageDraw.Draw(base)
    for k, c in SWATCH.items(): dr.rectangle([SW_X(k), SWY, SW_X(k) + 63, SWY + 63], fill=c)
    GB = gb_norm()
    for sid, sname, css, dot, rgb in SKINS:
        im = base.copy(); d2 = ImageDraw.Draw(im)
        d2.rectangle([SW_X('paint'), SWY, SW_X('paint') + 63, SWY + 63], fill=rgb)
        g = np.clip(GB * np.array(rgb, np.float32), 0, 255).astype(np.uint8)
        im.paste(Image.fromarray(g).convert('RGB'), (0, 1024))
        im.save(os.path.join(out, f'skin_{sid}.jpg'), quality=88)
    tx('n4speed_sa_tyre').convert('RGB').save(os.path.join(out, 'wheel.jpg'), quality=90)
    src_blur = os.path.join(ROOT, 'cars', 'xb', 'blur.png')
    if os.path.exists(src_blur): open(os.path.join(out, 'blur.png'), 'wb').write(open(src_blur, 'rb').read())
    Image.new('RGBA', (64, 64), (22, 28, 30, 185)).save(os.path.join(out, 'glass_gls.png'))

    # ---------- física (handling.cfg) ----------
    ymax = max(ge[i]['verts'][:, 1].max() for fi, i, _ in at if fr[fi]['name'] == 'chassis'); ymin = min(ge[i]['verts'][:, 1].min() for fi, i, _ in at if fr[fi]['name'] == 'chassis')
    wfz = cen['FL'][1] * sc; wrz = cen['BL'][1] * sc; wx = abs(cen['FR'][0]) * sc; ride = (-cen['FL'][2]) * sc + wr
    red = 5200; fin = round(2 * np.pi * red / 60 * wr / (H['vmax'] / 3.6) / 1.0, 2)
    gears = [0] + [round(x, 2) for x in np.interp(range(H['gears']), [0, H['gears'] - 1], [3.0, 1.0])]
    phys = dict(m=H['mass'], a=round(wfz - H['com'][1] * sc, 3), b=round(H['com'][1] * sc - wrz, 3), Iz=H['turn'], wr=round(wr, 3), gear=gears, rev=3.0, fin=fin,
                idle=800, red=red, up=4900, wx=round(wx, 3), wfz=round(wfz, 3), wrz=round(wrz, 3), ride=round(ride, 3),
                hw=round(1.05 * sc, 3), hl=round((ymax - ymin) / 2 * .94 * sc, 3))
    tq = [[0, .62], [.1, .8], [.2, .94], [.3, 1.0], [.4, .96], [.46, .84], [.5, .55], [.53, .2], [.545, 0]]
    car = dict(id=cid, name=cname, short=cname.split()[-1], phys=phys, torque=dict(peakNm=round(H['acc'] * 24.5), pts=tq),
               skins=[dict(id=s[0], name=s[1], css=s[2], dot=s[3], file={'$file': f'cars/{cid}/skin_{s[0]}.jpg'}) for s in SKINS],
               shadow=[round(1.27 * 1.12 * sc, 2), round(3.55 * sc, 2), round(-ride, 3)], objs=objs,
               vb={'$file': f'cars/{cid}/car.vb.bin'}, ib={'$file': f'cars/{cid}/car.ib.bin'}, dd={'$file': f'cars/{cid}/car.dd.bin'},
               wheel={'$file': f'cars/{cid}/wheel.jpg'}, blur={'$file': f'cars/{cid}/blur.png'}, glass={'gls': {'$file': f'cars/{cid}/glass_gls.png'}})
    json.dump(car, open(os.path.join(out, 'car.json'), 'w'), separators=(',', ':'), ensure_ascii=False, default=float)
    ci = os.path.join(ROOT, 'cars', 'cars.json'); idx = json.load(open(ci))
    if cid not in idx['cars']: idx['cars'].append(cid)
    json.dump(idx, open(ci, 'w'), indent=1)
    print(cid, 'vértices', n, 'triângulos', len(IB), 'peças', len(objs)); print(json.dumps(phys, default=float))

def SW_X(k): return (SW[k] if isinstance(k, str) else k) * 64

if __name__ == '__main__': main()
