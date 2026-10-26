"""Copy the current built outline of the given numbers into data/traced.json (checked by eye: right as is).

    python freeze.py 3 8 10 ...      (rounded to 0.1 sheet px; never overwrites an existing entry)
"""
import json
import sys

import numpy as np

from common import DATA, OUT, Affine, load_json, to_local

aff = Affine(np.array(load_json(OUT / 'registration.json')['affine']))
path = DATA / 'traced.json'
tr = json.loads(path.read_text(encoding='utf8'))
want = set(sys.argv[1:])
for f in load_json(OUT / 'polveriera-taino.geojson')['features']:
    p = f['properties']
    if f['geometry']['type'] != 'Polygon' or not p['description'].startswith('Edificio') or p['name'] not in want or p['name'] in tr:
        continue
    c = np.array(f['geometry']['coordinates'][0])[:-1]
    sx, sy = aff.to_sheet(*to_local(c[:, 0], c[:, 1]))
    tr[p['name']] = {'nogo': p['type'] == 'restricted', 'pts': [[round(float(x), 1), round(float(y), 1)] for x, y in zip(sx, sy)]}
    print('frozen', p['name'])
path.write_text(json.dumps(tr, indent=1) + '\n', encoding='utf8')
