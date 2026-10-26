"""Masks of what the sheet draws: red (no-go) building fill and hatched (playable) building fill."""
import numpy as np
from scipy import ndimage

from common import clean_sheet_array


def red_mask(a=None):
    a = clean_sheet_array() if a is None else a
    r, g, b = (a[..., i].astype(np.int16) for i in range(3))
    return (r > 170) & (g < 100) & (b < 110)


def hatch_mask(a=None):
    a = clean_sheet_array() if a is None else a
    f = a.astype(np.int16)
    gray = f.mean(axis=2)
    neutral = (np.abs(f[..., 0] - f[..., 1]) < 30) & (np.abs(f[..., 1] - f[..., 2]) < 30)
    ink = (gray < 185) & neutral
    dens = ndimage.uniform_filter(ink.astype(np.float32), 13)
    m = (dens > 0.22) & (dens < 0.8)
    m = ndimage.binary_opening(m, np.ones((7, 7)))
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > 400
    return keep[lab]


def building_mask():
    a = clean_sheet_array()
    return red_mask(a) | hatch_mask(a)
