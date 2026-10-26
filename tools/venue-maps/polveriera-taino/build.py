"""Build the AirsoftHub map of the Polveriera Taino field from the venue sheet and DBTR.

One source per thing:
- building footprints: DBTR (the official Lombardy topographic database), every building in the
  field; the sheet only says what each building is (number, no-go red or playable hatched,
  split where the sheet colours one building in two);
- everything that exists only on the sheet (boundary, no-go areas, explosives area, car park,
  covered path, entrance, labels, buildings DBTR lacks): sheet coordinates through the fitted
  affine (out/registration.json), then reconciled with the buildings (a building the sheet shows
  inside the field is inside the boundary);
- the sheet itself: warped to north-up Web Mercator as the event's venue map image.

    python register.py   # once, or after changing the matching
    python build.py       # writes out/
"""
import base64
import json
import math
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from shapely import transform
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import unary_union

from common import (COLS, DATA, GRID_PX, GRID_X0, GRID_Y0, OUT, ROWS, Affine, dbtr_buildings, load_json, save_json, sheet_image,
                    to_local, to_lonlat)
from masks import hatch_mask, red_mask

reg = load_json(OUT / 'registration.json')
AFF = Affine(np.array(reg['affine']))

STYLE = {
    'boundary': {'color': '#9DAE5C', 'fillOpacity': 0.0, 'strokeWidth': 3},
    'nogo': {'color': '#F0595C', 'fillOpacity': 0.3, 'strokeWidth': 2},
    'explosives': {'color': '#E6B04F', 'fillOpacity': 0.08, 'strokeWidth': 2},
    'car_park': {'color': '#8F7AC2', 'fillOpacity': 0.3, 'strokeWidth': 2},
    'covered_path': {'color': '#D98032', 'fillOpacity': 0.0, 'strokeWidth': 4},
    'building': {'color': '#A7ADA2', 'fillOpacity': 0.55, 'strokeWidth': 1},
    'building_nogo': {'color': '#F0595C', 'fillOpacity': 0.5, 'strokeWidth': 2},
    'place': {'color': '#7BC86C'},
    'number': {'color': '#C9CDBF'},
    'road': {'color': '#3FA9F5'},
    'grid': {'color': '#7D877E', 'fillOpacity': 0.0, 'strokeWidth': 1},
    'grid_half': {'color': '#59615A', 'fillOpacity': 0.0, 'strokeWidth': 0.5},
    'grid_label': {'color': '#C9CDBF'},
    'case_matte': {'color': '#F0595C', 'fillOpacity': 0.0, 'strokeWidth': 1.5},
}


# ---------------------------------------------------------------- geometry helpers

def sheet_to_local_geom(g):
    return transform(g, lambda c: np.column_stack(AFF.to_local(c[:, 0], c[:, 1])))


def local_to_sheet_geom(g):
    return transform(g, lambda c: np.column_stack(AFF.to_sheet(c[:, 0], c[:, 1])))


def to_geo(g):
    return transform(g, lambda c: np.column_stack(to_lonlat(c[:, 0], c[:, 1])))


def sheet_geom(f):
    g = f['geometry']
    if g['type'] == 'Polygon':
        return Polygon(g['coordinates'][0]).buffer(0)
    if g['type'] == 'LineString':
        return LineString(g['coordinates'])
    return Point(g['coordinates'])


def parts(g):
    if g.is_empty:
        return []
    if isinstance(g, (MultiPolygon,)) or g.geom_type == 'GeometryCollection':
        return [p for p in g.geoms if p.geom_type == 'Polygon' and not p.is_empty]
    return [g] if g.geom_type == 'Polygon' else []


def feature(geom_local, props):
    g = to_geo(geom_local)
    gj = mapping(g)
    if gj['type'] == 'Polygon':
        gj = {'type': 'Polygon', 'coordinates': [gj['coordinates'][0]]}  # zones keep the outer ring only
    rnd = lambda c: [round(c[0], 7), round(c[1], 7)]
    if gj['type'] == 'Polygon':
        gj['coordinates'] = [[rnd(c) for c in gj['coordinates'][0]]]
    elif gj['type'] == 'LineString':
        gj['coordinates'] = [rnd(c) for c in gj['coordinates']]
    elif gj['type'] == 'Point':
        gj['coordinates'] = rnd(gj['coordinates'])
    return {'type': 'Feature', 'properties': props, 'geometry': gj}


# ---------------------------------------------------------------- buildings

def classify_cells(poly_local, red, hatch, step=0.5):
    """Sample the footprint every `step` metres: what the sheet paints there (red, hatched, white or
    nothing usable). Number tags and outlines are left out: a fully red building has a big white tag."""
    minx, miny, maxx, maxy = poly_local.bounds
    xs = np.arange(minx + step / 2, maxx, step)
    ys = np.arange(miny + step / 2, maxy, step)
    X, Y = np.meshgrid(xs, ys)
    pts = np.column_stack([X.ravel(), Y.ravel()])
    from shapely import contains_xy

    inside = contains_xy(poly_local, pts[:, 0], pts[:, 1])
    pts = pts[inside]
    if not len(pts):
        return pts, np.zeros(0, bool), np.zeros(0, bool), np.zeros(0, bool), np.zeros(0, bool)
    sx, sy = AFF.to_sheet(pts[:, 0], pts[:, 1])
    sx = np.clip(np.round(sx).astype(int), 0, red.shape[1] - 1)
    sy = np.clip(np.round(sy).astype(int), 0, red.shape[0] - 1)
    usable = USABLE[sy, sx]
    r, h, w = red[sy, sx], hatch[sy, sx], WHITE[sy, sx]
    if usable.any() and not usable.all():
        # under number tags and ink the sheet says nothing: take the colour of the nearest read sample
        from scipy.spatial import cKDTree

        _, k = cKDTree(pts[usable]).query(pts[~usable])
        for arr in (r, h, w):
            arr[~usable] = arr[usable][k]
    return pts, r, h, w, usable


def cells_to_polygon(pts, sel, step, clip):
    if not sel.any():
        return Polygon()
    squares = [box(x - step / 2, y - step / 2, x + step / 2, y + step / 2) for x, y in pts[sel]]
    u = unary_union(squares).buffer(0.35).buffer(-0.35)
    return u.intersection(clip).buffer(0)


USABLE = WHITE = None
FOOTPRINTS = {}  # split buildings: real outline by DBTR index, so pieces can be redrawn around a replaced one
FIXES = json.loads((DATA / 'building-fixes.json').read_text(encoding='utf8')) if (DATA / 'building-fixes.json').exists() else {}
FIXES = {k: v for k, v in FIXES.items() if not k.startswith('_')}


def prepare_masks(labels):
    """White = unpainted paper (neither beige nor grey); usable = not a number tag, not ink."""
    global USABLE, WHITE
    from common import clean_sheet_array

    a = clean_sheet_array().astype(np.int16)
    neutral = (np.abs(a[..., 0] - a[..., 2]) < 18) & (np.abs(a[..., 0] - a[..., 1]) < 18)
    WHITE = neutral & (a.min(axis=2) > 232)
    ink = a.max(axis=2) < 110
    usable = ~ndimage.binary_dilation(ink, iterations=1)
    for n in labels['numbers']:
        x, y = int(n['x']), int(n['y'])
        usable[max(0, y - 22) : y + 23, max(0, x - 30) : x + 31] = False
    USABLE = usable


def assign_numbers(tags, shapes):
    """Number tags to building shapes, as the sheet means them.

    A tag names the building it sits in (within 1.5 m). A tag drawn outside any building names the
    nearest building within 6 m only if that building has no tag of its own; otherwise it stays a
    free number (the sheet numbers earth-covered bunkers and structures that have no footprint).
    """
    owner, free = {}, []
    loose = []
    for n, p in tags:
        d = [g.distance(p) for g in shapes]
        k = int(np.argmin(d)) if d else -1
        if k >= 0 and d[k] <= 1.5:
            owner.setdefault(k, []).append(n)
        else:
            loose.append((n, p, d))
    for n, p, d in sorted(loose, key=lambda t: min(t[2]) if t[2] else 1e9):
        order = np.argsort(d) if d else []
        k = next((int(j) for j in order if d[j] <= 6 and int(j) not in owner), None)
        if k is not None:
            owner[k] = [n]
        else:
            free.append((n, p))
    return owner, free


def build_buildings(boundary, labels, sheet_only):
    prepare_masks(labels)
    red = red_mask()
    hatch = hatch_mask()
    tags = [(n['n'], Point(*AFF.to_local(n['x'], n['y']))) for n in labels['numbers']]
    out, report = [], []
    dbtr = [b for b in dbtr_buildings() if b['geom'].intersection(boundary).area >= 0.5 * b['geom'].area]
    owner, free = assign_numbers(tags, [b['geom'] for b in dbtr] + [g for g, _ in sheet_only])
    sheet_numbers = {k - len(dbtr): v for k, v in owner.items() if k >= len(dbtr)}

    for i, b in enumerate(dbtr):
        g = b['geom']
        pts, r, h, w, read = classify_cells(g, red, hatch)
        painted = (r | h | w) & read
        red_frac = float(r[painted].mean()) if painted.any() else 0.0
        hatch_frac = float(h[read].mean()) if read.any() else 0.0
        numbers = sorted(set(owner.get(i, [])))
        label = '/'.join(str(n) for n in numbers)
        on_sheet = red_frac > 0.15 or hatch_frac > 0.25 or bool(numbers)
        entry = {'dbtr': b['id'], 'numbers': numbers, 'red': round(red_frac, 2), 'hatch': round(hatch_frac, 2), 'area': round(g.area, 1),
                 'use': b['use'], 'source': 'dbtr'}
        if not on_sheet:
            entry['result'] = 'not on the sheet: left out'
            report.append(entry)
            continue
        name = f'Edificio {label}' if label else 'Edificio'
        # White inside a footprint is the number tag or the drawing being a little smaller than the
        # real building: it says nothing. Only red next to hatching makes a building half and half.
        step = 0.5
        red_m2, hatch_m2 = r.sum() * step * step, h.sum() * step * step
        # Split where the sheet paints red next to hatching: over a good share of the footprint, or
        # where one real outline holds several numbered buildings drawn in different colours (64/65).
        several = len(numbers) >= 2 and red_m2 >= 15 and hatch_m2 >= 15
        if several or (red_m2 >= 8 and hatch_m2 >= 8 and min(red_m2, hatch_m2) >= 0.35 * len(pts) * step * step):
            nogo = cells_to_polygon(pts, r, step, g)
            play = g.difference(nogo).buffer(-0.5).buffer(0.5)
            nogo = g.difference(play)
            pieces = [('nogo', p) for p in parts(nogo) if p.area >= 4] + [('play', p) for p in parts(play) if p.area >= 4]
        else:
            kind = 'nogo' if red_frac >= 0.35 else 'play'
            # checked by eye (out/review/audit-*.png): data/building-fixes.json wins over the colour reading
            fixed = {FIXES.get(str(n)) for n in numbers} - {None}
            if len(fixed) == 1:
                fix = fixed.pop()
                if fix != kind:
                    entry['fixed'] = f'{kind} -> {fix}'
                kind = fix
            pieces = [(kind, g)]
        entry['result'] = '+'.join(sorted({k for k, _ in pieces}))
        report.append(entry)
        polys = [(kind, poly) for kind, p in pieces for poly in parts(p)]
        # each number goes to the piece its tag is in (or the nearest); a piece without one stays unnamed
        piece_numbers = {}
        if len(polys) > 1:
            for n, pt in tags:
                if n in numbers:
                    j = min(range(len(polys)), key=lambda j: polys[j][1].distance(pt))
                    piece_numbers.setdefault(j, []).append(n)
        else:
            piece_numbers[0] = numbers
        for j, (kind, poly) in enumerate(polys):
            if True:
                own = sorted(piece_numbers.get(j, []))
                shown = '/'.join(str(n) for n in own)
                name = f'Edificio {shown}' if shown else 'Edificio'
                if kind == 'nogo':
                    props = {'type': 'restricted', 'name': shown, 'description': f'{name}: non giocabile, divieto di accesso e transito.', **STYLE['building_nogo']}
                else:
                    props = {'type': 'sector', 'name': shown, 'description': f'{name}: giocabile.', **STYLE['building']}
                if len(polys) > 1:
                    props['_footprint'] = i
                    FOOTPRINTS[i] = g
                out.append((poly, props))
    return out, report, sheet_numbers, free


def sheet_only_buildings(features, dbtr_all):
    """Buildings drawn on the sheet that DBTR lacks (whole, or the part DBTR does not cover)."""
    out = []
    covered = dbtr_all.buffer(0.3)
    for f in features:
        if f['role'] != 'sheet_building':
            continue
        g = sheet_to_local_geom(sheet_geom(f))
        rest = g.difference(covered).buffer(-1).buffer(1, join_style='mitre')
        for p in parts(rest):
            # a strip along a real building is the sheet drawing that building a bit wider, not a building
            if p.area < 6 or (p.distance(covered) < 0.5 and 2 * p.area / p.length < 3.5):  # average width under 3.5 m
                continue
            nogo = f.get('restricted')
            props = {'type': 'restricted' if nogo else 'sector', 'name': '',
                     'description': ('Edificio (solo sulla pianta)' + (': non giocabile, divieto di accesso e transito.' if nogo else ': giocabile.')),
                     **STYLE['building_nogo' if nogo else 'building']}
            out.append((p, props))
    return out


def number_sheet_only(sheet_only, sheet_numbers):
    for k, numbers in sheet_numbers.items():
        g, props = sheet_only[k]
        label = '/'.join(str(n) for n in sorted(set(numbers)))
        props['name'] = label
        props['description'] = props['description'].replace('Edificio (solo sulla pianta)', f'Edificio {label} (solo sulla pianta)')


def numbers_of(props):
    return [int(n) for n in props['name'].split('/') if n.isdigit()]


def building_props(numbers, nogo, note=''):
    label = '/'.join(str(n) for n in sorted(numbers))
    name = f'Edificio {label}' if label else 'Edificio'
    if nogo:
        return {'type': 'restricted', 'name': label, 'description': f'{name}{note}: non giocabile, divieto di accesso e transito.', **STYLE['building_nogo']}
    return {'type': 'sector', 'name': label, 'description': f'{name}{note}: giocabile.', **STYLE['building']}


def first_version_outlines():
    """Building outlines traced on the sheet by the first version, in local metres."""
    from common import previous_affine

    pa = previous_affine()
    out = []
    for f in load_json(DATA / 'v1-edifici.geojson')['features']:
        c = np.array(f['geometry']['coordinates'][0])
        sx, sy = pa.to_sheet(*to_local(c[:, 0], c[:, 1]))  # exact: the first version was made with this transform
        out.append(Polygon(np.column_stack(AFF.to_local(sx, sy))).buffer(0))
    return out


def split_overlaps(buildings, tag_pt):
    """Neighbours touch, never overlap: a shared area goes half to each, split between their tags."""
    out = [[g, p] for g, p in buildings]
    for i in range(len(out)):
        for j in range(i + 1, len(out)):
            a, b = out[i][0], out[j][0]
            if not a.intersects(b) or a.intersection(b).area < 0.05:
                continue
            na, nb = numbers_of(out[i][1]), numbers_of(out[j][1])
            pa = tag_pt[na[0]] if na else a.representative_point()
            pb = tag_pt[nb[0]] if nb else b.representative_point()
            # half-plane closer to a's tag
            mx, my = (pa.x + pb.x) / 2, (pa.y + pb.y) / 2
            dx, dy = pb.x - pa.x, pb.y - pa.y
            n = math.hypot(dx, dy) or 1
            dx, dy = dx / n, dy / n
            L = 500
            half_a = Polygon([(mx - dy * L, my + dx * L), (mx + dy * L, my - dx * L), (mx + dy * L - dx * L, my - dx * L - dy * L), (mx - dy * L - dx * L, my + dx * L - dy * L)])
            ov = a.intersection(b)
            out[i][0] = max(parts(a.difference(ov.difference(half_a)).buffer(0)), key=lambda q: q.area, default=a)
            out[j][0] = max(parts(b.difference(ov.intersection(half_a)).buffer(0)), key=lambda q: q.area, default=b)
    return [(g, p) for g, p in out]


def apply_shape_fixes(buildings, labels):
    """data/shape-fixes.json: buildings checked by eye whose outline comes from the sheet (see that file)."""
    path = DATA / 'shape-fixes.json'
    if not path.exists():
        return buildings
    from sheet_shapes import drawn_blob

    fx = json.loads(path.read_text(encoding='utf8'))
    tag = {n['n']: n for n in labels['numbers']}
    tag_pt = {k: Point(*AFF.to_local(v['x'], v['y'])) for k, v in tag.items()}
    v1 = first_version_outlines()
    v1_numbers = [sorted(k for k, pt in tag_pt.items() if g.buffer(0.7).contains(pt)) for g in v1]

    def sheet_poly(n):
        poly, kind = drawn_blob(tag[n]['x'], tag[n]['y'])
        return (sheet_to_local_geom(poly).buffer(0), kind) if poly is not None else (None, None)

    def nogo_for(n, kind):
        return FIXES.get(str(n), 'nogo' if kind == 'red' else 'play') == 'nogo'

    # 1. first-version outlines for buildings that have their own one
    special = set(fx.get('from_sheet', [])) | {int(k) for k in fx.get('squares', {})} | {int(k) for k in fx.get('carve', {})} | {n for v in fx.get('carve', {}).values() for n in v}
    replaced, traced = set(), []
    for g, p in buildings:
        ns = sorted(numbers_of(p))
        if not ns or set(ns) & special or tuple(ns) in replaced:
            continue
        hit = [i for i, vn in enumerate(v1_numbers) if vn == ns]
        if len(hit) == 1:
            # thin tails of the old tracing go: they are pen strokes, not walls
            t = v1[hit[0]].buffer(-0.6, join_style='mitre').buffer(0.6, join_style='mitre')
            t = max(parts(t), key=lambda q: q.area) if parts(t) else v1[hit[0]]
            traced.append((t, {**p}))
            replaced.add(tuple(ns))
    # 2. one square per number inside a first-version outline (23, 24)
    for n in map(int, fx.get('squares', {})):
        i = next((i for i, vn in enumerate(v1_numbers) if n in vn), None)
        if i is None:
            continue
        rect = v1[i].minimum_rotated_rectangle
        c = np.array(rect.exterior.coords)[:4]
        e1, e2 = c[1] - c[0], c[2] - c[1]
        u, v = (e1, e2) if np.hypot(*e1) >= np.hypot(*e2) else (e2, e1)
        side = np.hypot(*v)
        u, v = u / np.hypot(*u), v / np.hypot(*v)
        mid = c.mean(axis=0)
        ctr = mid + u * float(np.dot(np.array(tag_pt[n].coords[0]) - mid, u))  # on the rectangle's axis, level with the tag
        h = side / 2
        half = h * float(fx['squares'][str(n)])
        lo, hi = -half, half
        sq = Polygon([ctr + hi * u + h * v, ctr + hi * u - h * v, ctr + lo * u - h * v, ctr + lo * u + h * v])
        old = next((p for g, p in buildings if n in numbers_of(p)), None)
        traced.append((sq, building_props([n], old is not None and old['type'] == 'restricted')))
        replaced.add((n,))
    traced_area = unary_union([g for g, _ in traced]) if traced else Polygon()
    kept = []
    for g, p in buildings:
        ns = tuple(sorted(numbers_of(p)))
        if ns in replaced or any(set(ns) & set(r) for r in replaced if len(r) == 1 and str(r[0]) in fx.get('squares', {})):
            continue
        if not ns and g.intersection(traced_area).area > 0.3 * g.area:
            continue  # an unnamed piece under a traced building
        kept.append((g, p))
    # the other pieces of a split building fill the rest of its real outline, with a clean border
    traced_fp = {p.get('_footprint') for _, p in traced} - {None}
    kept = [(max(parts(FOOTPRINTS[p['_footprint']].difference(traced_area.buffer(0.05))), key=lambda q: q.area), p)
            if p.get('_footprint') in traced_fp else (g, p) for g, p in kept]
    buildings = kept + traced

    wanted = set(fx.get('from_sheet', []))
    # numbers sharing a replaced DBTR outline get their sheet outline too, so none is lost
    for g, p in buildings:
        ns = set(numbers_of(p))
        if ns & wanted:
            wanted |= ns
    carve = {int(k): v for k, v in fx.get('carve', {}).items()}
    out, new = [], []
    for n in sorted(wanted):
        poly, kind = sheet_poly(n)
        if poly is not None:
            new.append((poly, building_props([n], nogo_for(n, kind), ' (sagoma della pianta)')))
    for keep, cut in carve.items():
        for n in cut:
            poly, kind = sheet_poly(n)
            if poly is not None:
                new.append((poly, building_props([n], nogo_for(n, kind), ' (sagoma della pianta)')))
    new_area = unary_union([g for g, _ in new]) if new else Polygon()
    for g, p in buildings:
        ns = set(numbers_of(p))
        if ns & wanted:
            continue
        for keep, cut in carve.items():
            if keep in ns:
                g = g.difference(new_area.buffer(0.3)).buffer(-0.3).buffer(0.3)
                g = max(parts(g), key=lambda q: q.area)
                p = building_props([keep], p['type'] == 'restricted')
        if not ns and g.intersection(new_area).area > 0.3 * g.area:
            continue  # an unnamed piece under a replaced building
        out.append((g, p))
    out += new
    out = split_overlaps(out, tag_pt)
    # absorb: unnamed pieces next to these buildings are part of them
    for n in fx.get('absorb', []):
        k = next((i for i, (g, p) in enumerate(out) if n in numbers_of(p)), None)
        if k is None:
            continue
        g, p = out[k]
        near = [i for i, (h, q) in enumerate(out) if i != k and not numbers_of(q) and h.distance(g) < 4]
        if near:
            u = unary_union([g] + [out[i][0] for i in near])
            rect = u.minimum_rotated_rectangle
            # one straight block when the pieces line up (39), else the pieces closed together (43)
            g = rect if u.convex_hull.area / rect.area > 0.9 else u.buffer(2, join_style='mitre').buffer(-2, join_style='mitre')
            out[k] = (max(parts(g), key=lambda q: q.area), p)
            out = [o for i, o in enumerate(out) if i not in near]
    # the app stores outer rings only: fill holes now, so what is checked is what gets drawn
    out = [(Polygon(g.exterior), p) for g, p in out]
    numbered = unary_union([g for g, p in out if numbers_of(p)])
    out = [(g, p) for g, p in out if numbers_of(p) or g.intersection(numbered).area < 0.1 * g.area]
    out = split_overlaps(out, tag_pt)
    # traced outlines (data/traced.json) win over everything else: they replace their building and cut the neighbours
    traced_path = DATA / 'traced.json'
    tr = {k: v for k, v in json.loads(traced_path.read_text(encoding='utf8')).items() if not k.startswith('_')} if traced_path.exists() else {}
    new = []
    for k, v in tr.items():
        poly = sheet_to_local_geom(Polygon(v['pts'])).buffer(0)
        nums = [int(n) for n in k.split('/')] if k.replace('/', '').isdigit() else []  # "18/19": one building, two numbers
        nums = v.get('n', nums)  # a named piece can carry a number the sheet repeats (64 has two tags)
        new.append((poly, building_props(nums, v['nogo'], ' (tracciato dalla pianta)')))
    if new:
        area = unary_union([g for g, _ in new])
        numbered = {n for _, p in new for n in numbers_of(p)}
        rest = []
        for g, p in out:
            if set(numbers_of(p)) & numbered:
                continue
            if g.intersects(area):
                before = g.area
                g = max(parts(g.difference(area.buffer(0.05))), key=lambda q: q.area, default=None)
                if g is None or g.area < 4 or (not numbers_of(p) and g.area < 0.5 * before):
                    continue  # an unnamed piece mostly under a traced outline is that outline, drawn worse
            rest.append((g, p))
        out = rest + new
    return out


# ---------------------------------------------------------------- bunker entrances (red rings)

def case_matte_entrances(boundary):
    from common import clean_sheet_array

    a = clean_sheet_array().astype(np.int16)
    ring = (a[..., 0] > 110) & (a[..., 0] - a[..., 1] > 70) & (a[..., 0] - a[..., 2] > 60)
    lab, n = ndimage.label(ring)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (22 <= h <= 60 and 22 <= w <= 60 and abs(h - w) <= 8):
            continue
        comp = lab[sl] == i
        if comp.sum() > 0.45 * h * w:  # filled: a red building, not a ring
            continue
        filled = ndimage.binary_fill_holes(comp)
        if filled.sum() < 1.6 * comp.sum():  # not closed
            continue
        cx, cy = sl[1].start + w / 2, sl[0].start + h / 2
        p = Point(*AFF.to_local(cx, cy))
        if boundary.contains(p):
            out.append(p)
    return out


# ---------------------------------------------------------------- grid

def grid_features(boundary):
    area = boundary.buffer(12)
    feats = []
    lines = []
    for k in range(0, COLS * 2 + 1):
        x = GRID_X0 + k * GRID_PX / 2
        lines.append((LineString([(x, GRID_Y0), (x, GRID_Y0 + len(ROWS) * GRID_PX)]), k % 2 == 0))
    for k in range(0, len(ROWS) * 2 + 1):
        y = GRID_Y0 + k * GRID_PX / 2
        lines.append((LineString([(GRID_X0, y), (GRID_X0 + COLS * GRID_PX, y)]), k % 2 == 0))
    for ln, major in lines:
        g = sheet_to_local_geom(ln).intersection(area)
        for seg in ([g] if g.geom_type == 'LineString' else list(getattr(g, 'geoms', []))):
            if seg.length > 3:
                feats.append(feature(seg, {'type': 'line', 'name': '', 'description': '', **STYLE['grid' if major else 'grid_half']}))
    # row and column names at the edge of the field, where the sheet would show them
    for c in range(COLS):
        strip = sheet_to_local_geom(box(GRID_X0 + c * GRID_PX, GRID_Y0, GRID_X0 + (c + 1) * GRID_PX, GRID_Y0 + len(ROWS) * GRID_PX)).intersection(area)
        if strip.is_empty:
            continue
        top = min((p for p in parts(strip.buffer(0))), key=lambda p: AFF.to_sheet(p.centroid.x, p.centroid.y)[1], default=None)
        if top is None:
            continue
        ys = [AFF.to_sheet(x, y)[1] for x, y in top.exterior.coords]
        sy = min(ys) + GRID_PX * 0.5
        pt = Point(*AFF.to_local(GRID_X0 + (c + 0.5) * GRID_PX, sy))
        feats.append(feature(pt, {'type': 'label', 'name': str(c + 1), 'description': f'Colonna {c + 1} della griglia', **STYLE['grid_label']}))
    for r, name in enumerate(ROWS):
        strip = sheet_to_local_geom(box(GRID_X0, GRID_Y0 + r * GRID_PX, GRID_X0 + COLS * GRID_PX, GRID_Y0 + (r + 1) * GRID_PX)).intersection(area)
        if strip.is_empty:
            continue
        xs = [AFF.to_sheet(x, y)[0] for p in parts(strip.buffer(0)) for x, y in p.exterior.coords]
        sx = min(xs) + GRID_PX * 0.5
        pt = Point(*AFF.to_local(sx, GRID_Y0 + (r + 0.5) * GRID_PX))
        feats.append(feature(pt, {'type': 'label', 'name': name, 'description': f'Riga {name} della griglia', **STYLE['grid_label']}))
    return feats


# ---------------------------------------------------------------- venue map image

def overlay(boundary, m_per_px=0.15):
    """The sheet (with its grid) warped to north-up Web Mercator, transparent outside the field."""
    R = 6378137.0
    merc = lambda lon, lat: (np.radians(lon) * R, np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R)
    area = boundary.buffer(10)
    lon, lat = to_lonlat(*np.array(area.exterior.coords).T)
    mx, my = merc(lon, lat)
    k = 1 / math.cos(math.radians(float(np.mean(lat))))  # mercator metres per ground metre
    step = m_per_px * k
    x0, x1, y0, y1 = mx.min(), mx.max(), my.min(), my.max()
    W, H = int((x1 - x0) / step) + 1, int((y1 - y0) / step) + 1
    gx = x0 + (np.arange(W) + 0.5) * step
    gy = y1 - (np.arange(H) + 0.5) * step
    LON = np.degrees(gx / R)
    LAT = np.degrees(2 * np.arctan(np.exp(gy / R)) - np.pi / 2)
    LX, LY = np.meshgrid(*to_local(LON, np.zeros_like(LON)))[0], None
    X = np.broadcast_to(to_local(LON, LAT[0])[0][None, :], (H, W))
    Y = np.broadcast_to(to_local(LON[0], LAT)[1][:, None], (H, W))
    sx, sy = AFF.to_sheet(X, Y)
    src = np.asarray(sheet_image(3)).astype(np.float32)
    coords = np.stack([sy * 1.5, sx * 1.5])
    rgb = np.stack([ndimage.map_coordinates(src[..., c], coords, order=1, mode='constant', cval=255) for c in range(3)], axis=-1)
    # alpha: inside the field (+10 m), feathered
    mask = Image.new('L', (W, H), 0)
    ex, ey = merc(*to_lonlat(*np.array(area.exterior.coords).T))
    ImageDraw.Draw(mask).polygon([((x - x0) / step, (y1 - y) / step) for x, y in zip(ex, ey)], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(6))
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert('RGBA')
    img.putalpha(mask)
    west, east = float(np.degrees(x0 / R)), float(np.degrees(x1 / R))
    north = float(np.degrees(2 * np.arctan(np.exp(y1 / R)) - np.pi / 2))
    south = float(np.degrees(2 * np.arctan(np.exp(y0 / R)) - np.pi / 2))
    return img, {'north': north, 'south': south, 'east': east, 'west': west}


# ---------------------------------------------------------------- main

def main():
    feats = load_json(DATA / 'sheet-features.json')['features']
    labels = load_json(DATA / 'labels.json')
    by_role = {}
    for f in feats:
        by_role.setdefault(f['role'], []).append(f)

    boundary = sheet_to_local_geom(sheet_geom(by_role['boundary'][0]))
    dbtr_all = unary_union([b['geom'] for b in dbtr_buildings()])
    sheet_only = sheet_only_buildings(feats, dbtr_all)
    buildings, report, sheet_numbers, free = build_buildings(boundary, labels, sheet_only)
    number_sheet_only(sheet_only, sheet_numbers)
    buildings += sheet_only
    buildings = apply_shape_fixes(buildings, labels)

    # A building the sheet shows inside the field is inside the boundary (the sheet draws the fence
    # along their outer walls; the real walls are a little further out in places).
    straddling = [g for g, _ in buildings if g.intersection(boundary).area >= 0.5 * g.area and not boundary.contains(g)]
    boundary_fixed = unary_union([boundary] + [g.buffer(0.3, join_style='mitre') for g in straddling]).buffer(0.5).buffer(-0.5)
    boundary_fixed = max(parts(boundary_fixed), key=lambda p: p.area).simplify(0.15)

    out = [feature(boundary_fixed, {'type': 'playable', 'name': 'Confine della polveriera', 'description': 'Confine del campo (Ex polveriera Montedison, Taino).', **STYLE['boundary']})]
    for f in by_role.get('nogo', []):
        g = sheet_to_local_geom(sheet_geom(f)).intersection(boundary_fixed)
        for p in parts(g):
            out.append(feature(p.simplify(0.15), {'type': 'restricted', 'name': 'Area non giocabile', 'description': 'Area non giocabile: divieto di accesso e transito.', **STYLE['nogo']}))
    for f in by_role.get('explosives', []):
        g = sheet_to_local_geom(sheet_geom(f)).intersection(boundary_fixed)
        for p in parts(g):
            out.append(feature(p.simplify(0.15), {'type': 'sector', 'name': 'Area esplosivi consentiti', 'description': "Area in cui è permesso l'utilizzo di esplosivi.", **STYLE['explosives']}))
    for f in by_role.get('car_park', []):
        g = sheet_to_local_geom(sheet_geom(f))
        inside = [b for b, _ in buildings if b.intersection(g).area >= 0.5 * b.area]
        g = unary_union([g] + inside).buffer(0.3).buffer(-0.3).intersection(boundary_fixed)
        for p in parts(g):
            out.append(feature(p.simplify(0.15), {'type': 'sector', 'name': 'Parcheggio auto incustodito', 'description': 'Posteggio auto incustodito.', **STYLE['car_park']}))
    for f in by_role.get('covered_path', []):
        out.append(feature(sheet_to_local_geom(sheet_geom(f)), {'type': 'route', 'name': 'Percorso coperto', 'description': 'Percorso coperto.', **STYLE['covered_path']}))
    for f in by_role.get('entrance', []):
        out.append(feature(sheet_to_local_geom(sheet_geom(f)), {'type': 'custom', 'name': 'Entrata polveriera', 'description': 'Ingresso al campo.'}))
    for g, props in buildings:
        props.pop('_footprint', None)
        out.append(feature(g.simplify(0.05), props))
    built_numbers = {n for _, q in buildings for n in numbers_of(q)}
    free = [(n, p) for n, p in free if n not in built_numbers]
    for n, p in free:
        out.append(feature(p, {'type': 'label', 'name': str(n), 'description': f'Numero {n} della pianta (struttura senza sagoma, per esempio una casamatta).', **STYLE['number']}))
    for t in labels['places']:
        out.append(feature(Point(*AFF.to_local(t['x'], t['y'])), {'type': 'label', 'name': t['text'], 'description': 'Punto di interesse (P.O.I.) della pianta.', **STYLE['place']}))
    for t in labels['roads']:
        out.append(feature(Point(*AFF.to_local(t['x'], t['y'])), {'type': 'label', 'name': t['text'], 'description': 'Nome della strada sulla pianta.', **STYLE['road']}))

    OUT.mkdir(parents=True, exist_ok=True)
    img, bounds = overlay(boundary_fixed)
    img.save(OUT / 'pianta-campo.webp', 'WEBP', quality=80, method=6)
    save_json(OUT / 'pianta-campo.position.json', bounds, indent=1)

    # One file for the app (a venue map package, see frontend map-package.ts): the map, the add-ons the
    # GM can choose in the import dialog (features tagged with their layer), the venue map image and
    # where players' maps open. Still plain GeoJSON for any other tool.
    grid = grid_features(boundary_fixed)
    entrances = case_matte_entrances(boundary_fixed)
    addons = [{**f, 'properties': {**f['properties'], 'layer': 'grid'}} for f in grid] + [
        feature(p, {'type': 'sector', 'name': '', 'description': 'Ingresso "case matte".', 'radius': 1.5, 'layer': 'entrances', **STYLE['case_matte']})
        for p in entrances]
    clon, clat = to_lonlat(*boundary_fixed.centroid.coords[0])
    image = 'data:image/webp;base64,' + base64.b64encode((OUT / 'pianta-campo.webp').read_bytes()).decode()
    save_json(OUT / 'polveriera-taino.geojson', {
        'type': 'FeatureCollection',
        'airsofthub': {
            'version': 1,
            'name': 'Ex polveriera Montedison, Taino',
            'layers': [
                {'id': 'grid', 'name': 'Griglia della pianta',
                 'description': 'Quadrati da 31 m e mezzi quadrati, con i nomi di righe e colonne come sulla pianta stampata.', 'default': False},
                {'id': 'entrances', 'name': 'Ingressi delle case matte', 'description': 'Gli anelli rossi della pianta.', 'default': False},
            ],
            'overlay': {'image': image, **bounds, 'opacity': 0.85},
            'area': {'lat': round(float(clat), 6), 'lng': round(float(clon), 6), 'zoom': 17},
        },
        'features': out + addons,
    })

    # report
    numbers_on_buildings = {n for e in report for n in e['numbers']} | {n for v in sheet_numbers.values() for n in v}
    all_numbers = {n['n'] for n in labels['numbers']}
    rep = {
        'registration': {'buildings_matched': sum(1 for p in reg['points'] if p.get('ok') and not p.get('outlier')),
                         'loo_median_m': reg['loo_median_m'], 'loo_p95_m': reg['loo_p95_m']},
        'features': len(out),
        'buildings': {
            'dbtr_in_field': len(report),
            'left_out_not_on_sheet': [e for e in report if e['result'].startswith('not on')],
            'split_two_colours': [e for e in report if e['result'] == 'nogo+play'],
            'several_numbers': [e for e in report if len(e['numbers']) > 1],
            'no_number': [e for e in report if not e['numbers'] and not e['result'].startswith('not on')],
            'sheet_only': sum(1 for _, p in buildings if 'solo sulla pianta' in p['description']),
        },
        'numbers_without_building': sorted(all_numbers - numbers_on_buildings),
        'free_numbers': sorted(n for n, _ in free),
        'boundary_grown_for_buildings': len(straddling),
        'case_matte_entrances': len(entrances),
        'overlay': {'size': img.size, 'bounds': bounds, 'bytes': (OUT / 'pianta-campo.webp').stat().st_size},
        'all_buildings': report,
    }
    save_json(OUT / 'report.json', rep, indent=1)
    b = rep['buildings']
    print(f"features {len(out)}; buildings in field {b['dbtr_in_field']}, left out {len(b['left_out_not_on_sheet'])}, split {len(b['split_two_colours'])}, "
          f"several numbers {len(b['several_numbers'])}, no number {len(b['no_number'])}, sheet-only {b['sheet_only']}")
    print(f"numbers without building: {rep['numbers_without_building']} (free labels: {rep['free_numbers']})")
    print(f"boundary grown around {len(straddling)} buildings; entrances {len(entrances)}; overlay {img.size} {rep['overlay']['bytes'] / 1e6:.1f} MB")


if __name__ == '__main__':
    main()
