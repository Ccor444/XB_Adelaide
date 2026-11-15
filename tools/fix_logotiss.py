#!/usr/bin/env python3
"""logotiss.dds e logo02.dds vieram PRETAS da conversão (painéis pretos no pórtico/passarelas dos boxes). Gera painéis neutros no lugar.
Uso: python3 tools/fix_logotiss.py [pasta_do_jogo]"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
dst = sys.argv[1] if len(sys.argv) > 1 else '.'
def panel(W, H, text):
    im = Image.new('RGB', (W, H)); px = im.load()
    for y in range(H):
        for x in range(W): t = y / H; px[x, y] = (int(34 + 22 * (1 - t)), int(44 + 26 * (1 - t)), int(62 + 30 * (1 - t)))     # degradê azul-petróleo escuro
    d = ImageDraw.Draw(im); b = max(10, H // 16)
    d.rectangle([0, 0, W, b], fill=(214, 40, 40)); d.rectangle([0, b, W, b + b // 3], fill=(245, 245, 245))
    d.rectangle([0, H - b - b // 3, W, H - b], fill=(245, 245, 245)); d.rectangle([0, H - b, W, H], fill=(214, 40, 40))
    f = ImageFont.load_default()
    for c in ('/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(c):
            for sz in range(200, 20, -4):
                f = ImageFont.truetype(c, sz)
                if d.textlength(text, font=f) < W * 0.82 and sz < H * 0.45: break
            break
    tw = d.textlength(text, font=f); d.text(((W - tw) / 2, H * 0.27), text, font=f, fill=(245, 245, 245)); return im
for fn, (W, H), text in (('107_logotiss.dds.webp', (512, 256), 'ADELAIDE'), ('061_logo02.dds.webp', (1024, 256), 'ADELAIDE')):
    panel(W, H, text).save(os.path.join(dst, 'assets', 'track', 'textures', fn), quality=90)
print('ok')
