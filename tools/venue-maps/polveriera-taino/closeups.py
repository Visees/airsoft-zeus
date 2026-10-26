"""Large close-ups of given buildings: the sheet with every built outline around it.

    python closeups.py 39 75 ...   ->  out/review/closeup-<n>.png (4 per image, 2x2)
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import DATA, OUT, Affine, clean_sheet_array, load_json, to_local

aff = Affine(np.array(load_json(OUT / 'registration.json')['affine']))
sheet = Image.fromarray(clean_sheet_array()).convert('RGB')
tag = {n['n']: n for n in load_json(DATA / 'labels.json')['numbers']}
feats = [f for f in load_json(OUT / 'polveriera-taino.geojson')['features'] if f['geometry']['type'] == 'Polygon' and f['properties']['description'].startswith('Edificio')]
outl = []
for f in feats:
    c = np.array(f['geometry']['coordinates'][0])
    outl.append((f['properties'], *aff.to_sheet(*to_local(c[:, 0], c[:, 1]))))
nums = [int(a) for a in sys.argv[1:]]
font = ImageFont.load_default(size=26)
for page in range(0, len(nums), 4):
    W = Image.new('RGB', (1400, 1400), 'white')
    for i, k in enumerate(nums[page : page + 4]):
        n = tag[k]
        x0, y0 = int(n['x']) - 175, int(n['y']) - 175
        c = sheet.crop((x0, y0, x0 + 350, y0 + 350)).resize((700, 700), Image.Resampling.LANCZOS)
        d = ImageDraw.Draw(c)
        for p, sx, sy in outl:
            if abs(sx.mean() - n['x']) < 500 and abs(sy.mean() - n['y']) < 500:
                col = (0, 160, 255) if p['type'] == 'restricted' else (255, 0, 200)
                d.line([((x - x0) * 2, (y - y0) * 2) for x, y in zip(sx, sy)], fill=col, width=3)
        d.text((8, 8), str(k), fill=(0, 0, 0), font=font, stroke_width=3, stroke_fill='yellow')
        W.paste(c, ((i % 2) * 700, (i // 2) * 700))
    W.save(OUT / 'review' / f'closeup-{page // 4 + 1}.png')
print((len(nums) + 3) // 4, 'images')
