"""Turn the OCR result (out/labels-ocr.json) into the checked label list data/labels.json.

The corrections below were made by looking at out/review/numbers-*.jpg and labels-*.png: OCR
readings that are wrong are removed or moved, tags it missed are added (sheet coordinates).
Place and road names are read by eye from the contact sheets (the OCR is only used for positions).
Once data/labels.json exists, edit it directly; this script is kept to show where it came from.
"""
import json

import numpy as np

from common import DATA, OUT, save_json

ocr = json.loads((OUT / 'labels-ocr.json').read_text(encoding='utf8'))

DELETE = [(4, 2991, 1075), (60, 2784, 2948), (111, 3178, 3365), (66, 2223, 3240), (3, 2422, 3987), (3, 3241, 4081), (76, 1829, 2946)]
MOVE = {103: (1455, 2038), 74: (1903, 2790), 62: (2552, 3085)}
ADD = {
    137: (3061, 1035), 131: (3225, 1159), 139: (3019, 452), 97: (1520, 2310), 95: (1706, 2308), 123: (3061, 2050),
    24: (4715, 2742), 70: (2295, 2984), 69: (2074, 3030), 65: (2231, 3204), 66: (1795, 3062), 14: (4083, 3080),
    9: (3895, 3514), 8: (3950, 3514), 7: (4042, 3514), 5: (3949, 3689), 4: (4175, 3786), 3: (4344, 3799),
    2: (4252, 3959), 1: (4194, 4209),
}

nums = []
for n in ocr['numbers']:
    if any(n['n'] == d and np.hypot(n['x'] - x, n['y'] - y) < 60 for d, x, y in DELETE):
        continue
    x, y = MOVE.get(n['n'], (n['x'], n['y']))
    nums.append({'n': n['n'], 'x': round(float(x), 1), 'y': round(float(y), 1)})
have = {n['n'] for n in nums}
for k, (x, y) in ADD.items():
    if k in have:
        nums = [n for n in nums if n['n'] != k]
    nums.append({'n': k, 'x': float(x), 'y': float(y)})
nums.sort(key=lambda n: n['n'])

# Read by eye from out/review/labels-poi.png and labels-road.png (index = OCR tag index).
POI = ['Hear Point', 'Cobra head', 'Shooting range plaza', 'Clover crossing', 'Woodland hill', 'Octupus point', 'Green mill crossing',
       'Black hole point', 'Hiroshima point', 'The temple', 'Fallen Hoak', 'Specter point', 'Patrol point', 'UniCredit', 'Black Hawk plaza',
       'The Village', 'Cherokee plaza', 'Sherwood plaza', 'Hollywood plaza', 'Black river', 'Ramadi crossing', 'Caterpillar point',
       'Golden Gate', 'Mailbox', None, 'The Church']
ROAD = ['South Avenue', 'Clover street', 'South Avenue', 'Gold Avenue', 'Clover street', 'Cadillac Avenue', 'Clover street', 'Gold Avenue',
        'Cadillac Avenue', 'Gold Avenue', 'George Washington Avenue', 'Malboro street', 'G. Washington Ave.', 'Viper road', 'Cadillac Avenue',
        'Chainsaw street', 'Rook street', 'Hidden Boulevard', 'Hidden Boulevard', 'Hidden Boulevard', 'Hummer Road', 'Gold Avenue', 'Desert Road',
        'Grease Road', 'G. Washington Ave.', 'Malboro street', 'Detroit Boulevard', 'Viper road', 'Viking street', 'Ronin road',
        'Detroit Boulevard', 'Detroit Boulevard', 'Detroit Boulevard', 'Detroit Boulevard', 'G. Washington Ave.', 'Cadillac Avenue', 'Ronin road',
        'Desert Road', 'Hummer Road', 'Grease Road', 'Twins road', 'Gold Avenue', 'Viking street', 'Hummer Road', 'Cherokee Boulevard',
        'Toy Road', 'Twins road', 'Abbate Avenue', 'Cherokee Boulevard', 'Village road', 'Lake Road', 'Toy Road', 'Vanguard road',
        'Vanguard road', 'Cowboys road', 'Range Rover Boulevard', 'Toy Road', 'Pine road', 'Lake Road', 'Bridge road', 'Red Road',
        'Reaper road', 'Red Road', None, 'Red Road']

assert len(POI) == len(ocr['poi']) and len(ROAD) == len(ocr['road']), (len(ocr['poi']), len(ocr['road']))


def tags(found, names):
    out = []
    for t, name in zip(found, names):
        if name:  # None = the legend's sample tag
            a = t['angle']
            a = (a + 90) % 180 - 90  # text direction, -90..90
            out.append({'text': name, 'x': round(t['cx'], 1), 'y': round(t['cy'], 1), 'angle': round(a, 1)})
    return out


save_json(DATA / 'labels.json', {
    'note': 'Sheet coordinates (144 dpi). numbers: building number tags; places: green tags; roads: blue tags.',
    'numbers': nums,
    'places': tags(ocr['poi'], POI),
    'roads': tags(ocr['road'], ROAD),
}, indent=1)
print(len(nums), 'numbers;', 'missing:', [k for k in range(1, 140) if k not in {n['n'] for n in nums}])
from collections import Counter

print('repeated:', [k for k, c in Counter(n['n'] for n in nums).items() if c > 1])
