"""One-off: turn the first version's hand-traced shapes into sheet coordinates (data/sheet-features.json).

Run once; afterwards data/sheet-features.json is the source to edit. It keeps only what exists on
the venue sheet alone: the boundary, the no-go areas, the explosives area, the car park, the covered
path, the entrance, and the buildings drawn on the sheet that have no DBTR footprint.

    python bootstrap.py <folder with polveriera-taino-2-campo.geojson and -3-edifici.geojson>
"""
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import shape
from shapely.ops import unary_union

from common import DATA, dbtr_buildings, load_json, previous_affine, save_json, to_local

src = Path(sys.argv[1])
aff = previous_affine()

# Sanity check: the previous grid lines must land on the sheet's grid.
grid = load_json(src / 'polveriera-taino-4-griglia.geojson')['features']
errs = []
for f in grid:
    if f['geometry']['type'] != 'LineString':
        continue
    c = np.array(f['geometry']['coordinates'])
    sx, sy = aff.to_sheet(*to_local(c[:, 0], c[:, 1]))
    gx, gy = (sx - 428) / 188.87, (sy - 336) / 188.87
    vertical = abs(sx[0] - sx[1]) < abs(sy[0] - sy[1])
    v = gx if vertical else gy
    errs.append(float(np.abs(v - np.round(v)).max() * 188.87))
print(f'grid check: max {max(errs):.2f} px off the sheet grid')


def to_sheet_coords(geom_type, coords):
    def conv(ring):
        a = np.array(ring, float)
        sx, sy = aff.to_sheet(*to_local(a[:, 0], a[:, 1]))
        return [[round(float(x), 2), round(float(y), 2)] for x, y in zip(sx, sy)]

    if geom_type == 'Polygon':
        return [conv(coords[0])]
    if geom_type == 'LineString':
        return conv(coords)
    if geom_type == 'Point':
        return conv([coords])[0]
    raise ValueError(geom_type)


features = []
ROLE = {
    'playable': 'boundary',
    'restricted': 'nogo',
    'route': 'covered_path',
    'custom': 'entrance',
}
for f in load_json(src / 'polveriera-taino-2-campo.geojson')['features']:
    p, g = f['properties'], f['geometry']
    role = ROLE.get(p['type'])
    if p['name'] == 'Area esplosivi consentiti':
        role = 'explosives'
    elif p['name'] == 'Parcheggio auto incustodito':
        role = 'car_park'
    features.append({'role': role, 'name': p['name'], 'geometry': {'type': g['type'], 'coordinates': to_sheet_coords(g['type'], g['coordinates'])}})

# Buildings traced from the sheet that have no real footprint under them.
dbtr = [b['geom'] for b in dbtr_buildings()]
kept = 0
for f in load_json(src / 'polveriera-taino-3-edifici.geojson')['features']:
    g = shape(f['geometry'])
    c = np.array(g.exterior.coords)
    from shapely.geometry import Polygon

    loc = Polygon(np.column_stack(to_local(c[:, 0], c[:, 1]))).buffer(0)
    best = max((loc.intersection(d).area / loc.union(d).area for d in dbtr if d.intersects(loc)), default=0)
    # keep it when DBTR lacks it, or lacks a good part of it (build.py keeps only what DBTR does not cover)
    uncovered = loc.difference(unary_union([d for d in dbtr if d.intersects(loc)])).buffer(-1).buffer(1).area if best else loc.area
    if best >= 0.3 and uncovered < 40:
        continue
    kept += 1
    features.append({
        'role': 'sheet_building',
        'name': '',
        'restricted': f['properties']['type'] == 'restricted',
        'geometry': {'type': 'Polygon', 'coordinates': to_sheet_coords('Polygon', f['geometry']['coordinates'])},
    })

save_json(DATA / 'sheet-features.json', {'note': 'Sheet coordinates (144 dpi pixels of the venue sheet). Edit here, then run build.py.', 'features': features}, indent=1)
print(f'{len(features)} features, {kept} sheet-only buildings')
