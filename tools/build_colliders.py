#!/usr/bin/env python3
"""Colisores para o modo a pé: troncos de árvore (círculos) e casas/caminhões (caixas giradas), calculados da geometria real dos modelos instanciados.
Saída: data/colliders.json  {c:[[x,z,r]...], b:[[cx,cz,hw,hd,cos,sin,y0,y1]...]}. Uso: python3 tools/build_colliders.py [pasta]"""
import sys, os, json, math
import numpy as np
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
def load(name, stride):
    d = json.load(open(os.path.join(dst, 'data', name + '.json')))
    vb = np.fromfile(os.path.join(dst, d['vb']['$file']), np.uint8).view(np.float32).reshape(-1, stride // 4)[:, :3]
    ib = np.fromfile(os.path.join(dst, d['ib']['$file']), np.uint16)
    I = np.fromfile(os.path.join(dst, d['inst']['$file']), np.float32).reshape(-1, 6)
    P = []
    for m in d['models']:
        idx = np.unique(np.concatenate([ib[p['start']:p['start'] + p['count']] for p in m['parts']])); P.append(vb[idx])
    return d, P, I
circles = []; boxes = []
d, P, I = load('trees', 24)
trunk = []
for m, V in zip(d['models'], P):
    if m['h'] < 3: trunk.append(None); continue          # arbusto: sem colisão
    band = V[(V[:, 1] > .3) & (V[:, 1] < 1.6)]
    r = float(np.clip(np.hypot(band[:, 0], band[:, 2]).max() if len(band) else .4, .25, .9)); trunk.append(r); print(m['name'], 'tronco r=%.2f' % r)
for x, y, z, yaw, sc, mi in I:
    r = trunk[int(mi)]
    if r: circles.append([round(float(x), 2), round(float(z), 2), round(r * float(sc), 2)])
for name in ('houses', 'trucks'):
    d, P, I = load(name, 28); fp = []
    for m, V in zip(d['models'], P):
        W = V[(V[:, 1] > .4) & (V[:, 1] < max(m['h'], 1) * .9)]; W = W if len(W) else V
        lo = W[:, [0, 2]].min(0); hi = W[:, [0, 2]].max(0); fp.append((lo, hi, float(V[:, 1].min()), float(V[:, 1].max())))
    for x, y, z, yaw, sc, mi in I:
        lo, hi, y0, y1 = fp[int(mi)]; c = (lo + hi) / 2; h = (hi - lo) / 2 * sc * .96; cs, sn = math.cos(yaw), math.sin(yaw)
        wx = (c[0] * cs + c[1] * sn) * sc; wz = (-c[0] * sn + c[1] * cs) * sc
        boxes.append([round(float(x + wx), 2), round(float(z + wz), 2), round(float(h[0]), 2), round(float(h[1]), 2), round(float(cs), 4), round(float(sn), 4), round(float(y + y0 * sc), 1), round(float(y + y1 * sc), 1)])
json.dump({'c': circles, 'b': boxes}, open(os.path.join(dst, 'data', 'colliders.json'), 'w'), separators=(',', ':'))
print(len(circles), 'troncos', len(boxes), 'caixas')
