"""Region view for tracing: sheet at full resolution, pixel grid, and the current built outlines.

    python region.py name x0 y0 x1 y1 [scale]  ->  out/trace/<name>.png
Grid every 10 sheet px, labels every 50 (x blue, y red). Outlines: cyan no-go, magenta playable,
each with its number (or ·) at its centre.
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import OUT, RAW_SCALE, RAW_X0, RAW_Y0, Affine, load_json, raw_image, to_local

name, x0, y0, x1, y1 = sys.argv[1], *map(int, sys.argv[2:6])
k = float(sys.argv[6]) if len(sys.argv) > 6 else 3
aff = Affine(np.array(load_json(OUT / 'registration.json')['affine']))
raw = raw_image()
s = 1 / RAW_SCALE
im = raw.crop((round((x0 - RAW_X0) * s), round((y0 - RAW_Y0) * s), round((x1 - RAW_X0) * s), round((y1 - RAW_Y0) * s)))
im = im.resize((round((x1 - x0) * k), round((y1 - y0) * k)), Image.Resampling.LANCZOS).convert('RGB')
d = ImageDraw.Draw(im, 'RGBA')
f = ImageFont.load_default(size=13)
for gx in range((x0 // 10 + 1) * 10, x1, 10):
    d.line([((gx - x0) * k, 0), ((gx - x0) * k, im.height)], fill=(0, 120, 255, 110 if gx % 50 == 0 else 35), width=1)
    if gx % 50 == 0:
        for gy in range((y0 // 100) * 100 + 30, y1, 100):
            d.text(((gx - x0) * k + 2, (gy - y0) * k), str(gx), fill=(0, 70, 220, 255), font=f)
for gy in range((y0 // 10 + 1) * 10, y1, 10):
    d.line([(0, (gy - y0) * k), (im.width, (gy - y0) * k)], fill=(0, 120, 255, 110 if gy % 50 == 0 else 35), width=1)
    if gy % 50 == 0:
        for gx in range((x0 // 100) * 100 + 70, x1, 100):
            d.text(((gx - x0) * k, (gy - y0) * k + 2), str(gy), fill=(220, 0, 110, 255), font=f)
lf = ImageFont.load_default(size=18)
for feat in load_json(OUT / 'polveriera-taino.geojson')['features']:
    p = feat['properties']
    if feat['geometry']['type'] != 'Polygon' or not p['description'].startswith('Edificio'):
        continue
    c = np.array(feat['geometry']['coordinates'][0])
    sx, sy = aff.to_sheet(*to_local(c[:, 0], c[:, 1]))
    if sx.max() < x0 or sx.min() > x1 or sy.max() < y0 or sy.min() > y1:
        continue
    col = (0, 210, 255, 255) if p['type'] == 'restricted' else (255, 0, 200, 255)
    d.line([((x - x0) * k, (y - y0) * k) for x, y in zip(sx, sy)], fill=col, width=2)
    d.text(((sx.mean() - x0) * k, (sy.mean() - y0) * k + 26), p['name'] or '·', fill=col, font=lf, anchor='mm', stroke_width=2, stroke_fill=(0, 0, 0, 255))
im.save(OUT / 'trace' / f'{name}.png')
print(name, im.size)
