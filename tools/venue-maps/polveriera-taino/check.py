"""Automatic check of the buildings against the sheet, so nothing depends on looking at thumbnails.

Reports (out/review/check.json + check.png):
- drawn but not covered: red or hatched patches on the sheet inside the field, over 4 m2, with no
  building on them (a missing building, or a piece cut off one);
- covered but not drawn: buildings whose area is mostly plain paper on the sheet;
- overlaps between buildings.
"""
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import Polygon

from common import OUT, Affine, clean_sheet_array, load_json, to_local
from masks import hatch_mask, red_mask

aff = Affine(np.array(load_json(OUT / 'registration.json')['affine']))
feats = load_json(OUT / 'polveriera-taino.geojson')['features']
blds = [f for f in feats if f['geometry']['type'] == 'Polygon' and f['properties']['description'].startswith('Edificio')]
bound = [f for f in feats if f['properties']['type'] == 'playable'][0]


def sheet_poly(f):
    c = np.array(f['geometry']['coordinates'][0])
    sx, sy = aff.to_sheet(*to_local(c[:, 0], c[:, 1]))
    return list(zip(sx, sy))


a = clean_sheet_array()
H, W = a.shape[:2]
cover = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(cover)
for f in blds:
    d.polygon(sheet_poly(f), fill=255)
cover = np.asarray(cover) > 0
field = Image.new('L', (W, H), 0)
ImageDraw.Draw(field).polygon(sheet_poly(bound), fill=255)
field = np.asarray(field) > 0

m2_per_px = (1 / np.sqrt(abs(np.linalg.det(aff.m[:, :2])))) ** 2
painted = (red_mask(a) | hatch_mask(a)) & field
grown = ndimage.binary_dilation(cover, iterations=6)  # tolerance: drawing vs outline, about 1 m
left = ndimage.binary_opening(painted & ~grown, np.ones((5, 5)))
lab, n = ndimage.label(left)
missing = []
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    area = (lab[sl] == i).sum() * m2_per_px
    if area >= 4:
        cy, cx = ndimage.center_of_mass(lab == i)
        missing.append({'x': round(float(cx)), 'y': round(float(cy)), 'm2': round(float(area), 1)})

empty = []
for f in blds:
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon(sheet_poly(f), fill=255)
    m = np.asarray(m) > 0
    if m.sum() and (painted[m].mean() < 0.3):
        empty.append({'name': f['properties']['name'], 'desc': f['properties']['description'][:40], 'painted': round(float(painted[m].mean()), 2)})

loc = [Polygon(np.column_stack(to_local(*np.array(f['geometry']['coordinates'][0]).T))).buffer(0) for f in blds]
overlaps = [(blds[i]['properties']['name'], blds[j]['properties']['name']) for i in range(len(loc)) for j in range(i + 1, len(loc)) if loc[i].intersection(loc[j]).area > 0.2]

json.dump({'missing': missing, 'mostly_unpainted': empty, 'overlaps': overlaps}, open(OUT / 'review' / 'check.json', 'w'), indent=1)
print(f'drawn but not covered: {len(missing)}; mostly unpainted buildings: {len(empty)}; overlaps: {len(overlaps)}')
for m in sorted(missing, key=lambda m: -m['m2']):
    print('  missing', m)
for e in empty:
    print('  unpainted', e)
