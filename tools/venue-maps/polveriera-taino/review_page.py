"""Build the review page: satellite + venue sheet + the built map, where shapes can be flagged.

    python review_page.py <esri tiles jpg> <meta json>   ->  out/review/review.html

The page stores flags in its artifact database (collection "flags", one document per shape key),
so whoever fixes the map can read them back. Shape keys are kind:name:centre, stable across rebuilds
as long as a shape does not move.
"""
import base64
import io
import json
import math
import sys

import numpy as np
from PIL import Image

from common import OUT, load_json

img_path, meta_path = sys.argv[1], sys.argv[2]
m = json.load(open(meta_path))
z, n = m['z'], 2 ** m['z']
SCALE = 0.5  # page pixels per satellite tile pixel

sat = Image.open(img_path).convert('RGB')
sat = sat.resize((int(sat.width * SCALE), int(sat.height * SCALE)), Image.Resampling.LANCZOS)


def px(lon, lat):
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return [round((x - m['tx0']) * 256 * SCALE, 1), round((y - m['ty0']) * 256 * SCALE, 1)]


def data_uri(im, fmt, **kw):
    buf = io.BytesIO()
    im.save(buf, fmt, **kw)
    return f'data:image/{fmt.lower()};base64,' + base64.b64encode(buf.getvalue()).decode()


b = load_json(OUT / 'pianta-campo.position.json')
tl, br = px(b['west'], b['north']), px(b['east'], b['south'])
sheet = Image.open(OUT / 'pianta-campo.webp')
sheet = sheet.resize((int(br[0] - tl[0]), int(br[1] - tl[1])), Image.Resampling.LANCZOS)


def key_of(p, coords):
    c = np.array(coords, float).reshape(-1, 2).mean(axis=0)
    return f"{p['type']}:{p.get('name', '')}:{c[0]:.5f},{c[1]:.5f}"


def kind_of(p):
    d = p.get('description', '')
    if p['type'] == 'label':
        return 'road' if d.startswith('Nome della strada') else 'place' if d.startswith('Punto') else 'number'
    if d.startswith('Edificio'):
        return 'building_nogo' if p['type'] == 'restricted' else 'building'
    return 'area'


feats = []
for f in load_json(OUT / 'polveriera-taino.geojson')['features']:
    g, p = f['geometry'], f['properties']
    if p.get('layer'):
        continue  # add-ons of the package (grid, entrances): not reviewed here
    if g['type'] == 'Polygon':
        coords, pts = g['coordinates'][0], [px(*c) for c in g['coordinates'][0]]
    elif g['type'] == 'LineString':
        coords, pts = g['coordinates'], [px(*c) for c in g['coordinates']]
    else:
        coords, pts = [g['coordinates']], [px(*g['coordinates'])]
    feats.append({'k': key_of(p, coords), 'g': g['type'][0], 'kind': kind_of(p), 'name': p.get('name', ''), 'desc': p.get('description', ''),
                  'color': p.get('color', '#C9CDBF'), 'pts': pts})

# DBTR buildings the build left out: shown dashed, flaggable too
from common import dbtr_buildings, to_lonlat

rep = load_json(OUT / 'report.json')
left_ids = {e['dbtr'] for e in rep['buildings']['left_out_not_on_sheet']}
for bld in dbtr_buildings():
    if bld['id'] in left_ids:
        g = bld['geom']
        poly = max(g.geoms, key=lambda q: q.area) if g.geom_type == 'MultiPolygon' else g
        lon, lat = to_lonlat(*np.array(poly.exterior.coords).T)
        coords = list(zip(lon.tolist(), lat.tolist()))
        feats.append({'k': f'left:{bld["id"]}', 'g': 'P', 'kind': 'left_out', 'name': '',
                      'desc': f'Real building (DBTR, {poly.area:.0f} m²) that the sheet does not draw: left out of the map.',
                      'color': '#4FC7DD', 'pts': [px(*c) for c in coords]})

checks = []
for e in rep['buildings']['several_numbers']:
    checks.append({'what': f"Buildings {'/'.join(map(str, e['numbers']))} are one real footprint", 'find': '/'.join(map(str, e['numbers']))})
for nnum in rep['free_numbers']:
    checks.append({'what': f'Number {nnum} is on the sheet away from any building: kept as a label', 'find': str(nnum)})
for e in rep['buildings']['left_out_not_on_sheet']:
    checks.append({'what': f"Real building of {e['area']:.0f} m² not drawn on the sheet: left out", 'find': f"left:{e['dbtr']}"})

data = {
    'w': sat.width, 'h': sat.height,
    'sat': data_uri(sat, 'JPEG', quality=72),
    'sheet': data_uri(sheet, 'WEBP', quality=72),
    'sheetBox': [tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]],
    'feats': feats,
    'checks': checks,
    'stats': {'loo': rep['registration']['loo_median_m'], 'p95': rep['registration']['loo_p95_m'], 'matched': rep['registration']['buildings_matched'],
              'features': rep['features'], 'buildings': sum(1 for f in feats if f['kind'].startswith('building'))},
}
tpl = (OUT.parent / 'review_page.html').read_text(encoding='utf8')
html = tpl.replace('/*__DATA__*/null', json.dumps(data, separators=(',', ':')))
(OUT / 'review').mkdir(parents=True, exist_ok=True)
(OUT / 'review' / 'review.html').write_text(html, encoding='utf8')
print(f"{len(feats)} shapes, {len(checks)} checks, {len(html) / 1e6:.1f} MB")
