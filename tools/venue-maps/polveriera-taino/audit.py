"""Contact sheets of every building: the sheet as drawn, with the built outline in its colour.

    python audit.py   ->  out/review/audit-1.png, audit-2.png, ...
Red outline = no-go in the build, green outline = playable. Wrong ones go in data/building-fixes.json.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import shape

from common import OUT, Affine, clean_sheet_array, load_json, to_local

aff = Affine(np.array(load_json(OUT / 'registration.json')['affine']))
sheet = Image.fromarray(clean_sheet_array()).convert('RGB')
font = ImageFont.load_default(size=20)
items = []
for f in load_json(OUT / 'polveriera-taino.geojson')['features']:
    p = f['properties']
    if f['geometry']['type'] != 'Polygon' or not p['description'].startswith('Edificio'):
        continue
    c = np.array(f['geometry']['coordinates'][0])
    sx, sy = aff.to_sheet(*to_local(c[:, 0], c[:, 1]))
    items.append((p['name'] or '·', p['type'] == 'restricted', sx, sy))
items.sort(key=lambda t: (int(t[0].split('/')[0]) if t[0][0].isdigit() else 999, t[2].mean()))
CELL, PER = 230, 42
for page in range(0, len(items), PER):
    chunk = items[page : page + PER]
    cols = 7
    W = Image.new('RGB', (cols * CELL, ((len(chunk) + cols - 1) // cols) * (CELL + 26)), 'white')
    d = ImageDraw.Draw(W)
    for i, (name, nogo, sx, sy) in enumerate(chunk):
        cx, cy = sx.mean(), sy.mean()
        half = max(70, (max(sx.max() - sx.min(), sy.max() - sy.min())) / 2 + 30)
        box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
        crop = sheet.crop(box).resize((CELL, CELL))
        k = CELL / (2 * half)
        ImageDraw.Draw(crop).line([((x - box[0]) * k, (y - box[1]) * k) for x, y in zip(sx, sy)], fill=(230, 0, 0) if nogo else (0, 170, 0), width=3)
        x0, y0 = (i % cols) * CELL, (i // cols) * (CELL + 26)
        W.paste(crop, (x0, y0))
        d.text((x0 + 4, y0 + CELL + 2), f"{name}  {'NO-GO' if nogo else 'play'}", fill=(200, 0, 0) if nogo else (0, 120, 0), font=font)
    W.save(OUT / 'review' / f'audit-{page // PER + 1}.png')
print(len(items), 'buildings,', (len(items) + PER - 1) // PER, 'sheets')
