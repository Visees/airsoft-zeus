"""Read the sheet's text: building numbers, road names (blue tags) and places (green tags).

Uses the OCR built into Windows (ocr.ps1). Results go to out/labels-ocr.json together with a contact
sheet per kind (out/review/labels-*.png) to check them by eye. Corrections go in
data/labels-fixes.json, which build.py applies on top of the OCR (that file is the source of truth
for any label the OCR gets wrong or misses).

    python labels.py
"""
import json
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage

from common import CACHE, OUT, RAW_SCALE, RAW_X0, RAW_Y0, clean_sheet_array, raw_image, save_json

OCR_DIR = CACHE / 'ocr'
REVIEW = OUT / 'review'


def run_ocr(paths):
    OCR_DIR.mkdir(parents=True, exist_ok=True)
    lst = OCR_DIR / 'list.txt'
    out = OCR_DIR / 'result.json'
    lst.write_text('\n'.join(str(Path(p).resolve()) for p in paths), encoding='utf8')
    subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('ocr.ps1')), str(lst), str(out)], check=True)
    res = json.loads(out.read_text(encoding='utf-8-sig'))
    return {Path(r['image']).name: r['lines'] for r in res}


def colour_components(kind):
    a = clean_sheet_array().astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if kind == 'poi':  # green tags
        m = (g > 170) & (r > 70) & (r < 190) & (b < 140) & (g - r > 30) & (g - b > 70)
    else:  # blue road tags
        m = (b > 190) & (g > 120) & (g < 200) & (r < 120) & (b - r > 110)
    m = ndimage.binary_closing(m, np.ones((5, 5)))
    m = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(m)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        comp = lab[sl] == i
        area = int(comp.sum())
        if area < 250:
            continue
        ys, xs = np.nonzero(comp)
        xs = xs + sl[1].start
        ys = ys + sl[0].start
        c = np.array([xs.mean(), ys.mean()])
        cov = np.cov(np.vstack([xs - c[0], ys - c[1]]))
        evals, evecs = np.linalg.eigh(cov)
        major = evecs[:, 1]
        angle = float(np.degrees(np.arctan2(major[1], major[0])))
        length = float(4 * np.sqrt(evals[1]))
        width = float(4 * np.sqrt(evals[0]))
        out.append({'cx': float(c[0]), 'cy': float(c[1]), 'angle': angle, 'len': length, 'wid': width, 'area': area})
    return out


def crop_upright(comp, invert):
    """The tag cut from the native raster, turned so its long side is horizontal, text dark on light."""
    raw = raw_image()
    s = 1 / RAW_SCALE
    cx, cy = (comp['cx'] - RAW_X0) * s, (comp['cy'] - RAW_Y0) * s
    half = (max(comp['len'], comp['wid']) * s) / 2 + 12
    box = raw.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
    ang = comp['angle']
    # vertical-ish tags: keep text reading direction bottom-to-top (as the sheet writes them)
    rot = box.rotate(ang, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(255, 255, 255))
    w = comp['len'] * s + 16
    h = comp['wid'] * s + 10
    cw, ch = rot.size
    rot = rot.crop((int(cw / 2 - w / 2), int(ch / 2 - h / 2), int(cw / 2 + w / 2), int(ch / 2 + h / 2)))
    g = ImageOps.grayscale(rot)
    if invert:
        g = ImageOps.invert(g)
    g = ImageOps.autocontrast(g, cutoff=2)
    return g.resize((g.width * 3, g.height * 3), Image.Resampling.LANCZOS)


def read_tags(kind):
    comps = colour_components(kind)
    paths = []
    for i, c in enumerate(comps):
        img = crop_upright(c, invert=(kind == 'road'))
        for flip in (0, 180):
            p = OCR_DIR / f'{kind}-{i:03d}-{flip}.png'
            p.parent.mkdir(parents=True, exist_ok=True)
            (img.rotate(flip, expand=True) if flip else img).save(p)
            paths.append(p)
    res = run_ocr(paths)

    def text_of(name):
        return ' '.join(l['text'] for l in res.get(name, [])).strip()

    def quality(t):
        return sum(ch.isalpha() for ch in t) - 3 * sum(not (ch.isalnum() or ch == ' ') for ch in t)

    for i, c in enumerate(comps):
        a, b = text_of(f'{kind}-{i:03d}-0.png'), text_of(f'{kind}-{i:03d}-180.png')
        c['text'] = a if quality(a) >= quality(b) else b
        c['flip'] = 0 if quality(a) >= quality(b) else 180
        c['crop'] = f'{kind}-{i:03d}-{c["flip"]}.png'
    return comps


def tag_boxes(a):
    """Centres of the white number tags: small closed white rectangles with dark digits inside."""
    f = a.astype(np.int16)
    white = (f.min(axis=2) > 236)
    lab, n = ndimage.label(white)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (14 <= min(h, w) <= 45 and 20 <= max(h, w) <= 95):
            continue
        comp = lab[sl] == i
        filled = ndimage.binary_fill_holes(comp)
        holes = filled.sum() - comp.sum()
        if filled.sum() < 0.85 * h * w or holes < 25:  # a box, with digits punched in it
            continue
        out.append((sl[1].start + w / 2, sl[0].start + h / 2))
    return np.array(out)


def read_numbers():
    """Building numbers: large-font integers anywhere on the sheet, upright or turned 90 degrees."""
    a = clean_sheet_array()
    im = Image.fromarray(a)
    tile, step, up = 1100, 900, 2
    paths, meta = [], {}
    for rot in (0, 90, 270):
        r = im.rotate(rot, expand=True)
        for y in range(0, r.height - 200, step):
            for x in range(0, r.width - 200, step):
                t = r.crop((x, y, x + tile, y + tile)).resize((tile * up, tile * up), Image.Resampling.LANCZOS)
                p = OCR_DIR / f'num-{rot}-{x}-{y}.png'
                p.parent.mkdir(parents=True, exist_ok=True)
                t.save(p)
                paths.append(p)
                meta[p.name] = (rot, x, y, r.size)
    res = run_ocr(paths)
    W, H = im.size
    found = []
    for name, lines in res.items():
        rot, x0, y0, (rw, rh) = meta[name]
        for line in lines:
            for w in line['words']:
                txt = w['text'].strip().strip('.,:;')
                if not re.fullmatch(r'\d{1,3}', txt) or not 1 <= int(txt) <= 160:
                    continue
                if w['h'] / up < 12:  # spot heights use a smaller font
                    continue
                # a turned tile also shows the upright tags, turned: OCR reads some of them with loose boxes
                if rot and len(txt) > 1 and w['w'] < 1.2 * w['h']:
                    continue
                # centre in rotated-image coords, then back to sheet coords
                cx, cy = x0 + (w['x'] + w['w'] / 2) / up, y0 + (w['y'] + w['h'] / 2) / up
                if rot == 0:
                    sx, sy = cx, cy
                elif rot == 90:  # PIL rotates counter-clockwise
                    sx, sy = W - cy, cx
                else:
                    sx, sy = cy, H - cx
                found.append({'n': int(txt), 'x': float(sx), 'y': float(sy), 'h': w['h'] / up, 'rot': rot})
    # Number tags are white boxes: of several readings of one number nearby, keep the one on white.
    gray = a.mean(axis=2)

    def on_white(f):
        x, y = int(f['x']), int(f['y'])
        win = gray[max(0, y - 9) : y + 10, max(0, x - 14) : x + 15]
        return float((win > 235).mean()) if win.size else 0.0

    for f in found:
        f['white'] = round(on_white(f), 2)
    merged = []
    for f in sorted(found, key=lambda f: (-f['white'], f['rot'] != 0, -f['h'])):
        if any(m['n'] == f['n'] and np.hypot(m['x'] - f['x'], m['y'] - f['y']) < 160 for m in merged):
            continue
        merged.append(f)
    # OCR boxes are sometimes shifted by tens of pixels: move each reading onto the nearest tag box.
    boxes = tag_boxes(a)
    claimed = set()
    for f in sorted(merged, key=lambda f: -f['white']):
        d = np.hypot(boxes[:, 0] - f['x'], boxes[:, 1] - f['y']) if len(boxes) else np.array([])
        for k in np.argsort(d)[:3] if len(d) else []:
            if d[k] < 90 and k not in claimed:
                claimed.add(int(k))
                f['x'], f['y'], f['snapped'] = float(boxes[k, 0]), float(boxes[k, 1]), round(float(d[k]), 1)
                break
    return merged


def contact_sheet(items, title, path, cell=(330, 70)):
    font = ImageFont.load_default(size=14)
    cols = 4
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell[0], rows * (cell[1] + 22) + 30), 'white')
    d = ImageDraw.Draw(sheet)
    d.text((6, 6), title, fill='black', font=font)
    for k, (label, img) in enumerate(items):
        x, y = (k % cols) * cell[0], 30 + (k // cols) * (cell[1] + 22)
        th = img.copy()
        th.thumbnail((cell[0] - 8, cell[1]))
        sheet.paste(th, (x + 4, y))
        d.text((x + 4, y + cell[1] + 2), label, fill=(200, 0, 0), font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main():
    import sys

    out = {}
    if '--numbers-only' in sys.argv:
        out = json.loads((OUT / 'labels-ocr.json').read_text(encoding='utf8'))
    for kind in () if '--numbers-only' in sys.argv else ('poi', 'road'):
        tags = read_tags(kind)
        out[kind] = tags
        items = [(f'{i}: {t["text"] or "?"}', Image.open(OCR_DIR / t['crop'])) for i, t in enumerate(tags)]
        contact_sheet(items, f'{kind}: index: OCR text', REVIEW / f'labels-{kind}.png')
        print(kind, len(tags))
    nums = read_numbers()
    out['numbers'] = nums
    a = clean_sheet_array()
    items = []
    for i, n in enumerate(sorted(nums, key=lambda n: n['n'])):
        crop = Image.fromarray(a[int(n['y']) - 30 : int(n['y']) + 30, int(n['x']) - 45 : int(n['x']) + 45])
        items.append((f'{n["n"]}', crop))
    contact_sheet(items, 'numbers (OCR value under each crop)', REVIEW / 'labels-numbers.png', cell=(160, 70))
    have = {n['n'] for n in nums}
    print('numbers', len(nums), 'missing from 1..139:', [k for k in range(1, 140) if k not in have])
    save_json(OUT / 'labels-ocr.json', out, indent=1)


if __name__ == '__main__':
    main()
