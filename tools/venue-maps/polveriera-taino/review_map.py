"""Draw the built map over satellite imagery and over the warped sheet, to check it by eye.

    python review_map.py <esri tiles jpg> <meta json>   (tiles from fetch in the scratch folder)
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import OUT, load_json

img_path, meta_path = sys.argv[1], sys.argv[2]
m = json.load(open(meta_path))
z = m['z']
n = 2 ** z
sat = Image.open(img_path).convert('RGB')


def px(lon, lat):
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return ((x - m['tx0']) * 256, (y - m['ty0']) * 256)


ov = Image.open(OUT / 'pianta-campo.webp').convert('RGBA')
b = load_json(OUT / 'pianta-campo.position.json')
x0, y0 = px(b['west'], b['north'])
x1, y1 = px(b['east'], b['south'])
ovr = ov.resize((int(x1 - x0), int(y1 - y0)))
sheet = sat.copy().convert('RGBA')
sheet.alpha_composite(ovr, (int(x0), int(y0)))

feats = load_json(OUT / 'polveriera-taino.geojson')['features']
font = ImageFont.load_default(size=18)
for name, base, fill_alpha in (('sat', sat.convert('RGBA'), 70), ('sheet', sheet, 0)):
    im = base.copy()
    d = ImageDraw.Draw(im, 'RGBA')
    for f in feats:
        g, p = f['geometry'], f['properties']
        col = p.get('color', '#ffffff')
        rgb = tuple(int(col[i : i + 2], 16) for i in (1, 3, 5))
        if g['type'] == 'Polygon':
            pts = [px(*c) for c in g['coordinates'][0]]
            if p['type'] in ('sector', 'restricted') and p['description'].startswith('Edificio'):
                d.polygon(pts, fill=rgb + (fill_alpha,), outline=(0, 255, 255, 255) if name == 'sheet' else rgb + (255,), width=2)
            else:
                d.line(pts + [pts[0]], fill=rgb + (255,), width=3)
        elif g['type'] == 'LineString':
            d.line([px(*c) for c in g['coordinates']], fill=rgb + (255,), width=4)
        elif g['type'] == 'Point' and p['type'] == 'label':
            x, y = px(*g['coordinates'])
            d.text((x, y), p['name'], fill=rgb + (255,), font=font, anchor='mm', stroke_width=2, stroke_fill=(0, 0, 0))
    for f in feats:
        if f['geometry']['type'] == 'Polygon' and f['properties'].get('name') and f['properties']['description'].startswith('Edificio'):
            c = np.array(f['geometry']['coordinates'][0]).mean(axis=0)
            d.text(px(*c), f['properties']['name'], fill=(255, 255, 0, 255), font=font, anchor='mm', stroke_width=2, stroke_fill=(0, 0, 0))
    im = im.convert('RGB')
    im.save(OUT / 'review' / f'map-{name}.jpg', quality=85)
    s = im.copy()
    s.thumbnail((1800, 1800))
    s.save(OUT / 'review' / f'map-{name}-small.jpg', quality=85)
print('ok')
