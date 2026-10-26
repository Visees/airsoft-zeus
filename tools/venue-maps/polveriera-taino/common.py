"""Shared helpers: coordinate systems, the venue sheet raster, DBTR buildings.

Coordinate systems
- geo: WGS84 lon/lat (what the app stores).
- local: metres east/north of (LON0, LAT0); equirectangular, fine at field scale.
- sheet: pixels of the venue sheet rendered at 144 dpi (2 px per PDF point), page as printed
  (landscape, rows A-V top to bottom, columns 1-26 left to right). The grid frame starts at
  (GRID_X0, GRID_Y0); one grid square is GRID_PX pixels (31 m on the ground, not the 20 m the
  sheet's scale bar says).
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data'
OUT = HERE / 'out'
CACHE = OUT / 'cache'

LON0, LAT0 = 8.6065, 45.7557
KX = 111_320 * math.cos(math.radians(LAT0))
KY = 110_574

GRID_X0, GRID_Y0 = 428.0, 336.0
GRID_PX = 188.87
ROWS = 'ABCDEFGHIJKMNOPQRSTUV'  # no L on the sheet
COLS = 26

Image.MAX_IMAGE_PIXELS = None


def to_local(lon, lat):
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY


def to_lonlat(x, y):
    return np.asarray(x) / KX + LON0, np.asarray(y) / KY + LAT0


def load_json(p):
    return json.loads(Path(p).read_text(encoding='utf8'))


def save_json(p, data, indent=None):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(data, ensure_ascii=False, indent=indent), encoding='utf8')


# ---------------------------------------------------------------- the venue sheet


@lru_cache(maxsize=2)
def sheet_image(scale: int = 2) -> Image.Image:
    """The sheet rendered at 72*scale dpi (scale 2 = sheet coordinates; 3 for the overlay)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    png = CACHE / f'sheet@{scale}x.png'
    if not png.exists():
        import pymupdf

        doc = pymupdf.open(DATA / 'pianta-campo.pdf')
        doc[0].get_pixmap(matrix=pymupdf.Matrix(scale, scale)).save(png)
    return Image.open(png).convert('RGB')


def sheet_array(scale: int = 2) -> np.ndarray:
    return np.asarray(sheet_image(scale))


# The drawing itself is one embedded raster (portrait, 4962 x 6143); the grid is vector lines on top.
# Turned upright, the raster fills the grid frame: sheet = RAW_X0/Y0 + raw pixel * RAW_SCALE.
RAW_X0, RAW_Y0 = 428.0, 335.44
RAW_SCALE = 4910.88 / 6143


@lru_cache(maxsize=1)
def raw_image() -> Image.Image:
    """The drawing without the vector grid, upright, at its native resolution (1.25 x sheet pixels)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    png = CACHE / 'raw-upright.png'
    if not png.exists():
        import io
        import pymupdf

        doc = pymupdf.open(DATA / 'pianta-campo.pdf')
        xref = doc[0].get_images(full=True)[0][0]
        im = Image.open(io.BytesIO(doc.extract_image(xref)['image'])).convert('RGB')
        im.transpose(Image.Transpose.ROTATE_90).save(png)
    return Image.open(png).convert('RGB')


@lru_cache(maxsize=1)
def clean_sheet_array() -> np.ndarray:
    """The drawing without the grid, in sheet coordinates (same size as sheet_image(2))."""
    base = sheet_image(2)
    raw = raw_image()
    w, h = round(raw.width * RAW_SCALE), round(raw.height * RAW_SCALE)
    canvas = Image.new('RGB', base.size, (255, 255, 255))
    canvas.paste(raw.resize((w, h), Image.Resampling.LANCZOS), (round(RAW_X0), round(RAW_Y0)))
    return np.asarray(canvas)


# ---------------------------------------------------------------- the previous chat's global fit

class Affine:
    """local metres <-> sheet pixels, as a 2x3 matrix."""

    def __init__(self, m: np.ndarray):
        self.m = np.asarray(m, float)  # local -> sheet
        a = np.vstack([self.m, [0, 0, 1]])
        self.inv = np.linalg.inv(a)[:2]  # sheet -> local

    def to_sheet(self, x, y):
        x, y = np.asarray(x, float), np.asarray(y, float)
        return self.m[0, 0] * x + self.m[0, 1] * y + self.m[0, 2], self.m[1, 0] * x + self.m[1, 1] * y + self.m[1, 2]

    def to_local(self, sx, sy):
        sx, sy = np.asarray(sx, float), np.asarray(sy, float)
        return self.inv[0, 0] * sx + self.inv[0, 1] * sy + self.inv[0, 2], self.inv[1, 0] * sx + self.inv[1, 1] * sy + self.inv[1, 2]

    @staticmethod
    def fit(local_pts, sheet_pts) -> 'Affine':
        L = np.asarray(local_pts, float)
        S = np.asarray(sheet_pts, float)
        A = np.hstack([L, np.ones((len(L), 1))])
        mx, *_ = np.linalg.lstsq(A, S[:, 0], rcond=None)
        my, *_ = np.linalg.lstsq(A, S[:, 1], rcond=None)
        return Affine(np.vstack([mx, my]))


def previous_affine() -> Affine:
    """The transform the first version used (recovered from its grid file), as a starting point."""
    p = load_json(DATA / 'previous-transform.json')
    nc, nr = np.array(p['nc']), np.array(p['nr'])
    # sx = X0 + GRID*(1 + (nc.P - oc)/SC) ; sy = Y0 + GRID*(20 - (nr.P - or)/SR)
    kx, ky = 188.88 / p['SC'], 188.86 / p['SR']
    m = np.array([
        [kx * nc[0], kx * nc[1], 428 + 188.88 * (1 - p['oc'] / p['SC'])],
        [-ky * nr[0], -ky * nr[1], 336 + 188.86 * (20 + p['or'] / p['SR'])],
    ])
    return Affine(m)


# ---------------------------------------------------------------- DBTR buildings

def dbtr_buildings():
    """Building footprints of the Lombardy topographic database (DBTR), in local metres."""
    from shapely.geometry import shape
    from shapely import transform

    j = load_json(DATA / 'dbtr-edifici.json')
    out = []
    for f in j['corpo_edificato']['features']:
        g = shape(f['geometry'])
        g = transform(g, lambda c: np.column_stack(to_local(c[:, 0], c[:, 1])))
        props = f['properties']
        out.append({
            'id': f['id'],
            'use': props.get('dbtr_vs_cr_edf_is.cr_edf_ct') or '',
            'geom': g.buffer(0),
        })
    return out
