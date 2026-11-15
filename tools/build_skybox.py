#!/usr/bin/env python3
"""Converte o skybox do GTA (cúpula skybox.dff + skyboxes.txd, textura "fisheye") para o céu do jogo (equirretangular).
Uso: python3 tools/build_skybox.py <skybox.dff> <skyboxes.txd> [pasta_do_jogo] [céu_padrão]
Gera assets/skies/<nome>.jpg (2048x1024) e aponta data/ext.json "sky" para o céu padrão (extrasunny_1).
O céu também é o reflexo dos carros/troféus, então tudo acompanha a troca."""
import sys, os, json
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rwdff, rwtxd
dff, txd = sys.argv[1:3]; dst = sys.argv[3] if len(sys.argv) > 3 else '.'; default = sys.argv[4] if len(sys.argv) > 4 else 'extrasunny_1'
fr, ge, at = rwdff.parse(dff); g = ge[0]; V = g['verts'].astype(np.float64); UV = g['uv'][0].astype(np.float64)
elev = np.arctan2(V[:, 2], np.hypot(V[:, 0], V[:, 1])); ruv = np.hypot(UV[:, 0] - .5, UV[:, 1] - .5)
o = np.argsort(elev); E, R = elev[o], ruv[o]                       # raio na textura em função da elevação
W, H = 2048, 1024
lon = (np.arange(W) + .5) / W * 2 * np.pi - np.pi; lat = np.pi / 2 - (np.arange(H) + .5) / H * np.pi
LON, LAT = np.meshgrid(lon, lat)
LATc = np.clip(LAT, E.min(), E.max())                              # abaixo da borda da cúpula repete o horizonte
r = np.interp(LATc, E, R)
xd = np.sin(LON); yd = np.cos(LON)                                 # cúpula: x -> x, y -> frente (-z do jogo)
n = np.maximum(np.hypot(xd, yd), 1e-9)
u = .5 + r * xd / n; v = .5 - r * yd / n
out = os.path.join(dst, 'assets', 'skies'); os.makedirs(out, exist_ok=True)
for name, im in rwtxd.read_txd(txd).items():
    a = np.asarray(im.convert('RGB'), np.float32); h, w = a.shape[:2]
    ch = [map_coordinates(a[..., k], [v * h - .5, u * w - .5], order=1, mode='nearest') for k in range(3)]
    img = np.clip(np.stack(ch, -1), 0, 255).astype(np.float32)
    hz = int((LAT[:, 0] >= E.min()).sum())                           # primeira linha abaixo da borda da cúpula
    if hz < H:                                                       # parte de baixo: média do horizonte, escurecendo (esconde as listras do esticado)
        base = img[max(0, hz - 3):hz].mean((0, 1)); t = np.linspace(0, 1, H - hz)[:, None, None]
        img[hz:] = base * (1 - .25 * t)
        img[hz - 6:hz] = img[hz - 6:hz] * np.linspace(1, .0, 6)[:, None, None] + base * np.linspace(0, 1, 6)[:, None, None]
    img = np.clip(img, 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(out, name + '.jpg'), quality=90); print('ok', name)
p = os.path.join(dst, 'data', 'ext.json'); ext = json.load(open(p))
ext['sky'] = {'$file': 'assets/skies/%s.jpg' % default}; json.dump(ext, open(p, 'w'), separators=(',', ':'))
print('céu padrão:', default)
