"""Building outlines as the sheet draws them, for buildings whose real (DBTR) outline is not wanted.

A number tag (white box) sits on its building. The building is the red or hatched patch around
the tag, cut from its neighbours by the black outlines; when the tag sits on nothing coloured
(82, 83: small white boxes between red blocks) the boxed white area is the building itself.
Rectangles are squared to their minimum rotated rectangle.
"""
from functools import lru_cache

import numpy as np
from scipy import ndimage
from shapely.geometry import MultiPoint

from common import clean_sheet_array
from masks import hatch_mask, red_mask


@lru_cache(maxsize=1)
def _masks():
    a = clean_sheet_array().astype(np.int16)
    return a, red_mask(), hatch_mask()


def _to_polygon(mask, ox, oy):
    ys, xs = np.nonzero(mask)
    pts = np.column_stack([xs + ox, ys + oy])
    hull = MultiPoint(pts[:: max(1, len(pts) // 4000)].tolist()).convex_hull
    rect = hull.minimum_rotated_rectangle
    return rect if hull.area / rect.area > 0.85 else hull.simplify(2)


def drawn_blob(x, y, r=320):
    """(sheet-pixel polygon, 'red' | 'hatch' | 'white') of the building drawn under tag (x, y)."""
    a, red, hatch = _masks()
    x0, y0 = max(0, int(x) - r), max(0, int(y) - r)
    win = a[y0 : int(y) + r, x0 : int(x) + r]
    cx, cy = int(x) - x0, int(y) - y0
    white = win.min(axis=2) > 225
    lab, _ = ndimage.label(white)
    near = lab[cy - 8 : cy + 9, cx - 12 : cx + 13]
    ids, counts = np.unique(near[near > 0], return_counts=True)
    if not len(ids):
        return None, None
    box = lab == ids[np.argmax(counts)]
    box = ndimage.binary_fill_holes(box)
    if box.sum() > 9000:  # leaked into the paper: no closed tag box here
        box = np.zeros_like(box)
        box[cy - 15 : cy + 16, cx - 22 : cx + 23] = True
    ring = ndimage.binary_dilation(box, iterations=5) & ~box
    best = None
    for kind, m in (('red', red), ('hatch', hatch)):
        mm = ndimage.binary_erosion(m[y0 : int(y) + r, x0 : int(x) + r], iterations=2)  # cut thin bridges across dashed outlines
        lab2, _ = ndimage.label(mm)
        ids2, c2 = np.unique(lab2[ring & (lab2 > 0)], return_counts=True)
        if len(ids2) and c2.max() > 0.25 * ring.sum() and (best is None or c2.max() > best[2]):
            best = (kind, lab2 == ids2[np.argmax(c2)], c2.max())
    if best:
        kind, comp, _ = best
        shape_mask = ndimage.binary_dilation(ndimage.binary_fill_holes(comp | box), iterations=3)
    else:
        kind, shape_mask = 'white', ndimage.binary_dilation(box, iterations=3)
    return _to_polygon(shape_mask, x0, y0), kind
