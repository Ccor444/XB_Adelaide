#!/usr/bin/env python3
"""Recria texturas da pista que vieram pretas/transparentes/brancas demais no pacote original (idempotente, regrava os .webp).
 conht   : concreto (estava 100% preto -> manchas pretas nas pontes/muros)
 ptmarsh : marcação branca de pista de boxes (estava totalmente transparente)
 roadi   : faixa branca de largada (estava totalmente transparente)
 tents   : lona branca com trama e costuras (estava um branco chapado estourado)
Uso: python3 tools/fix_textures.py [pasta_do_jogo]"""
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
trk = json.load(open(os.path.join(dst, 'data', 'trk.json'))); F = {e['name']: os.path.join(dst, e['d']['$file']) for e in trk['tex']}
rng = np.random.RandomState(7)
def save(name, arr, mode='RGBA'):
    Image.fromarray(arr.astype(np.uint8), mode).save(F[name], quality=90, method=6)
def noise(h, w, s):
    n = rng.normal(0, 1, (h, w)); return np.asarray(Image.fromarray(((n - n.min()) / (np.ptp(n)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s))).astype(float) / 255 - .5
# --- concreto
for name in ('conht.dds',):
    w, h = Image.open(F[name]).size
    base = 150 + 70 * noise(h, w, 2.5) + 30 * noise(h, w, 0.7) + 25 * noise(h, w, 9)
    img = np.repeat(base[..., None], 3, 2) * np.array([1.0, 1.0, 0.97]); 
    for x in range(0, w, 256): img[:, x:x + 2] *= .72                    # juntas de painel
    img[:2] *= .8; img[-2:] *= .8
    save(name, np.dstack([np.clip(img, 0, 255), np.full((h, w), 255)]))
# --- tinta branca (alfa)
def paint(name, draw):
    w, h = Image.open(F[name]).size; a = np.zeros((h, w)); draw(a, h, w)
    a = np.clip(a * (0.85 + 0.15 * (noise(h, w, 1.5) + .5)), 0, 1)
    rgb = np.full((h, w, 3), 235.0); save(name, np.dstack([rgb, a * 255]))
def pit(a, h, w):                                                       # moldura branca da vaga de box
    t = max(3, w // 40); a[:t, :] = 1; a[-t:, :] = 1; a[:, :t] = 1; a[:, -t:] = 1
def start(a, h, w): a[:, :] = 1; a[:, : w // 16] = 0; a[:, -w // 16:] = 0   # faixa cheia com borda
paint('ptmarsh.dds', pit); paint('roadi.dds', start)
# --- lona
name = 'tents.dds'
import zipfile, io
zp = os.path.join(dst, 'assets', 'track', 'textures.zip'); src_ = F[name]
if os.path.exists(zp):                                                   # sempre parte do original (idempotente)
    z = zipfile.ZipFile(zp); src_ = io.BytesIO(z.read('textures/' + os.path.basename(F[name])))
im = Image.open(src_).convert('RGB'); w, h = im.size; a = np.asarray(im).astype(float)
a = a * 0.84 * (1 + 0.05 * noise(h, w, 1.0)[..., None]) * (1 + 0.04 * noise(h, w, 12)[..., None])
yy, xx = np.mgrid[0:h, 0:w]; weave = 0.97 + 0.03 * np.sin(xx * 1.6) * np.sin(yy * 1.6)
a *= weave[..., None]
for x in range(0, w, max(32, w // 8)): a[:, x:x + 2] *= .86             # costuras verticais
a *= np.array([.99, .985, .96])                                          # branco quente levemente envelhecido
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(F[name], quality=90, method=6)
print('texturas recriadas: conht, ptmarsh, roadi, tents')
