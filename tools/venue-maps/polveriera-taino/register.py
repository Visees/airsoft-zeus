"""Register the venue sheet on the ground with an affine transform fitted on matched buildings.

Every DBTR building inside the field is projected on the sheet with the starting transform; when
exactly one drawn blob (red fill, or hatching) covers it, with a similar size and shape, the blob's
centre is where the sheet draws that building. Those pairs fit the affine; buildings whose
leave-one-out error is over 2 m are drawing mistakes and are dropped.

A smooth local warp (thin-plate spline) was tried too: it did not beat the affine out of sample
(the sheet is drawn from a survey, so it has no drift to correct), so the affine is kept.

Writes out/registration.json, used by build.py.
"""
import numpy as np
from shapely.geometry import Polygon

from common import OUT, Affine, dbtr_buildings, load_json, previous_affine, save_json, sheet_array, DATA

SEARCH = 36  # px at 144 dpi (~6 m)


def poly_mask(poly_sheet: np.ndarray, x0: int, y0: int, w: int, h: int) -> np.ndarray:
    from PIL import Image, ImageDraw

    im = Image.new('L', (w, h), 0)
    ImageDraw.Draw(im).polygon([(float(x - x0), float(y - y0)) for x, y in poly_sheet], fill=1)
    return np.asarray(im, np.float32)


def match(mask: np.ndarray, aff: Affine, poly: Polygon):
    """Best shift of the real outline over a sheet mask: score in [-1, 1] (1 = drawn exactly there)."""
    from scipy.signal import correlate

    ring = np.array(poly.exterior.coords)
    sx, sy = aff.to_sheet(ring[:, 0], ring[:, 1])
    x0, y0 = int(sx.min()) - SEARCH, int(sy.min()) - SEARCH
    x1, y1 = int(sx.max()) + SEARCH + 1, int(sy.max()) + SEARCH + 1
    if x0 < 0 or y0 < 0 or x1 >= mask.shape[1] or y1 >= mask.shape[0]:
        return None
    win = mask[y0:y1, x0:x1].astype(np.float32) * 2 - 1
    kern = poly_mask(np.column_stack([sx, sy]), int(sx.min()), int(sy.min()), int(sx.max() - sx.min()) + 1, int(sy.max() - sy.min()) + 1)
    area = kern.sum()
    if area < 30:
        return None
    corr = correlate(win, kern, mode='valid', method='fft') / area  # (2*SEARCH+1)^2 shifts
    i, j = np.unravel_index(np.argmax(corr), corr.shape)
    score = float(corr[i, j])
    far = corr.copy()
    yy, xx = np.ogrid[: corr.shape[0], : corr.shape[1]]
    far[(yy - i) ** 2 + (xx - j) ** 2 <= 100] = -np.inf
    second = float(far.max())
    on_edge = i in (0, corr.shape[0] - 1) or j in (0, corr.shape[1] - 1)
    return float(j - SEARCH), float(i - SEARCH), score, second, on_edge


def main():
    aff = previous_affine()
    feats = load_json(DATA / 'sheet-features.json')['features']
    boundary_s = next(f for f in feats if f['role'] == 'boundary')['geometry']['coordinates'][0]
    b = np.array(boundary_s)
    bx, by = aff.to_local(b[:, 0], b[:, 1])
    boundary = Polygon(np.column_stack([bx, by])).buffer(10)

    from masks import hatch_mask, red_mask
    from scipy import ndimage

    pts = []
    taken = set()
    for kind, mask in (('red', red_mask()), ('hatch', hatch_mask())):
        lab, n = ndimage.label(ndimage.binary_closing(mask, np.ones((3, 3))))
        objs = ndimage.find_objects(lab)
        for bld in dbtr_buildings():
            g = bld['geom']
            if bld['id'] in taken or not boundary.contains(g.centroid) or g.area < 12:
                continue
            poly = max(g.geoms, key=lambda q: q.area) if g.geom_type == 'MultiPolygon' else g
            ring = np.array(poly.exterior.coords)
            sx, sy = aff.to_sheet(ring[:, 0], ring[:, 1])
            x0, y0 = int(sx.min()) - 4, int(sy.min()) - 4
            w, h = int(sx.max() - x0) + 5, int(sy.max() - y0) + 5
            P = poly_mask(np.column_stack([sx, sy]), x0, y0, w, h) > 0
            L = lab[y0 : y0 + h, x0 : x0 + w]
            ids, counts = np.unique(L[P & (L > 0)], return_counts=True)
            if not len(ids):
                continue
            comp = ids[np.argmax(counts)]
            if counts.max() < 0.5 * P.sum():
                continue
            sl = objs[comp - 1]
            C = lab[sl] == comp
            area_ratio = C.sum() / P.sum()
            cy_, cx_ = ndimage.center_of_mass(C)
            comp_c = (sl[1].start + cx_, sl[0].start + cy_)
            pcy, pcx = ndimage.center_of_mass(P)
            poly_c = (x0 + pcx, y0 + pcy)
            dx, dy = comp_c[0] - poly_c[0], comp_c[1] - poly_c[1]
            # IoU of the shifted outline with the drawn blob
            Ps = poly_mask(np.column_stack([sx + dx, sy + dy]), sl[1].start, sl[0].start, C.shape[1], C.shape[0]) > 0
            iou = (Ps & C).sum() / max(1, (Ps | C).sum() + (P.sum() - Ps.sum()))
            ok = 0.7 <= area_ratio <= 1.4 and iou >= 0.6 and np.hypot(dx, dy) < 50
            pts.append({'id': bld['id'], 'kind': kind, 'comp': int(comp), 'local': [poly.centroid.x, poly.centroid.y],
                        'sheet': [float(v) for v in aff.to_sheet(poly.centroid.x, poly.centroid.y)], 'shift_px': [round(dx, 1), round(dy, 1)],
                        'area_ratio': round(float(area_ratio), 2), 'iou': round(float(iou), 2), 'area': round(g.area, 1), 'ok': bool(ok)})
            if ok:
                taken.add(bld['id'])
                pts[-1]['sheet'] = [pts[-1]['sheet'][0] + dx, pts[-1]['sheet'][1] + dy]
        # one blob, one building: blobs claimed by several buildings are merged drawings, not control points
        from collections import Counter

        dup = Counter(p['comp'] for p in pts if p['kind'] == kind and p['ok'])
        for p in pts:
            if p['kind'] == kind and p['ok'] and dup[p['comp']] > 1:
                p['ok'] = False
                taken.discard(p['id'])
    good = [p for p in pts if p['ok']]
    print(f'{len(pts)} buildings tried, {len(good)} clear one-to-one matches')

    def loo_errors(sel):
        L = np.array([p['local'] for p in sel])
        S = np.array([p['sheet'] for p in sel])
        errs = []
        for k in range(len(sel)):
            m = np.ones(len(sel), bool)
            m[k] = False
            x, y = Affine.fit(L[m], S[m]).to_local(*S[k])
            errs.append(float(np.hypot(x - L[k, 0], y - L[k, 1])))
        return np.array(errs)

    # Drawing mistakes (a building drawn in the wrong place) are outliers, not drift: drop them.
    errs = loo_errors(good)
    for p, e in zip(good, errs):
        p['loo_m'] = round(float(e), 2)
        p['outlier'] = bool(e > 2.0)
    used = [p for p in good if not p['outlier']]
    errs = loo_errors(used)
    aff2 = Affine.fit([p['local'] for p in used], [p['sheet'] for p in used])
    print(f'affine from {len(used)} buildings: leave-one-out median {np.median(errs):.2f} m, p95 {np.percentile(errs, 95):.2f} m, max {errs.max():.2f} m')
    save_json(OUT / 'registration.json', {
        'affine': aff2.m.tolist(),
        'loo_median_m': round(float(np.median(errs)), 2),
        'loo_p95_m': round(float(np.percentile(errs, 95)), 2),
        'points': pts,
    }, indent=1)


if __name__ == '__main__':
    main()
