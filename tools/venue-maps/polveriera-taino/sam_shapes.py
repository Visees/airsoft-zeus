"""Building outlines with SAM 2.1 (Segment Anything), prompted at each building's number tag.

For each tag: cut a window of the sheet around it, paint the white number box over with the colour
around it (so the building reads as one patch), then ask SAM for the region under the tag. The mask
becomes a polygon in sheet pixels; mostly-rectangular masks are squared.

    python sam_shapes.py [numbers...]   ->  out/sam/shapes.json (+ out/review/sam-*.png)
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from shapely.geometry import MultiPoint, Polygon

from common import DATA, OUT, clean_sheet_array, load_json

WIN = 320  # half window, sheet px (about 53 m)
UP = 2     # SAM sees the window at 2x


def load_model():
    from ultralytics import SAM

    return SAM('sam2.1_b.pt')


def tag_box(win, cx, cy):
    white = win.min(axis=2) > 225
    lab, _ = ndimage.label(white)
    near = lab[cy - 8 : cy + 9, cx - 12 : cx + 13]
    ids, counts = np.unique(near[near > 0], return_counts=True)
    if not len(ids):
        return None
    box = ndimage.binary_fill_holes(lab == ids[np.argmax(counts)])
    return None if box.sum() > 9000 else box


def prompts(win, box, cx, cy):
    """Click points for SAM: on the building's own fill just outside the number box.

    Red fill or hatching around the box: the building is that patch, click it in up to 4 places.
    Plain paper around the box: the box itself is the building (82, 83), click its centre."""
    from masks import hatch_mask, red_mask

    if box is None:
        return [[cx, cy]], 'centre'
    red = red_mask(win)
    hatch = hatch_mask(win)
    ys, xs = np.nonzero(box)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pts = []
    xm, ym = (x0 + x1) // 2, (y0 + y1) // 2
    around = [(x0 - 7, ym), (x1 + 7, ym), (xm, y0 - 7), (xm, y1 + 7), (x0 - 7, y0 - 7), (x1 + 7, y0 - 7), (x0 - 7, y1 + 7), (x1 + 7, y1 + 7),
              (x0 - 14, ym), (x1 + 14, ym), (xm, y0 - 14), (xm, y1 + 14)]
    for px, py in around:
        if 0 <= px < win.shape[1] and 0 <= py < win.shape[0] and (red[py, px] or hatch[py, px]):
            pts.append([int(px), int(py)])
    if len(pts) >= 2:
        return pts + [[cx, cy]], 'fill'
    if len(pts) == 1:
        return pts + [[cx, cy]], 'fill'
    # plain paper around: the box is the building only if it is drawn as one (thick outline around it)
    ink = win.max(axis=2) < 110
    ring = ndimage.binary_dilation(box, iterations=4) & ~box
    return [[cx, cy]], 'box' if ink[ring].mean() > 0.3 else 'free'


def paint_out_tag(win, cx, cy):
    """Fill the white box at (cx, cy) with the median colour of the ring just outside it."""
    white = win.min(axis=2) > 225
    lab, _ = ndimage.label(white)
    near = lab[cy - 8 : cy + 9, cx - 12 : cx + 13]
    ids, counts = np.unique(near[near > 0], return_counts=True)
    if not len(ids):
        return win
    box = ndimage.binary_fill_holes(lab == ids[np.argmax(counts)])
    if box.sum() > 9000:
        return win
    box = ndimage.binary_dilation(box, iterations=1)
    ring = ndimage.binary_dilation(box, iterations=5) & ~box
    out = win.copy()
    out[box] = np.median(win[ring], axis=0).astype(np.uint8)
    return out


def to_polygon(mask, ox, oy):
    ys, xs = np.nonzero(mask)
    if len(xs) < 20:
        return None
    pts = np.column_stack([xs / UP + ox, ys / UP + oy])
    hull = MultiPoint(pts[:: max(1, len(pts) // 5000)].tolist()).convex_hull
    rect = hull.minimum_rotated_rectangle
    filled = mask.sum() / (UP * UP)
    if filled / rect.area > 0.9:
        return rect, 'rect'
    # not a rectangle: trace the mask outline
    import cv2

    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 1.5 * UP, True)[:, 0, :]
    g = Polygon(np.column_stack([c[:, 0] / UP + ox, c[:, 1] / UP + oy])).buffer(0)
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda q: q.area)
    return g, 'traced'


def main():
    tags = {n['n']: n for n in load_json(DATA / 'labels.json')['numbers']}
    nums = [int(a) for a in sys.argv[1:]] or sorted(tags)
    model = load_model()
    a = clean_sheet_array()
    out = {}
    (OUT / 'sam').mkdir(parents=True, exist_ok=True)
    for k in nums:
        t = tags[k]
        x0, y0 = int(t['x']) - WIN, int(t['y']) - WIN
        win = a[max(0, y0) : y0 + 2 * WIN, max(0, x0) : x0 + 2 * WIN]
        ox, oy = max(0, x0), max(0, y0)
        cx, cy = int(t['x']) - ox, int(t['y']) - oy
        pts, mode = prompts(win, tag_box(win, cx, cy), cx, cy)
        if mode == 'centre':
            mode = 'free'
        if mode == 'free':
            print(k, 'free (number on open ground, no building)', flush=True)
            continue
        if mode == 'fill':
            win = paint_out_tag(win, cx, cy)
        img = Image.fromarray(win).resize((win.shape[1] * UP, win.shape[0] * UP), Image.Resampling.LANCZOS)
        res = model(np.asarray(img)[:, :, ::-1], points=[[[x * UP, y * UP] for x, y in pts]], labels=[[1] * len(pts)], verbose=False)
        masks = res[0].masks.data.cpu().numpy() if res[0].masks is not None and len(res[0].masks.data) else []
        if not len(masks):
            continue
        mask = masks[0] > 0.5
        box = tag_box(a[max(0, y0) : y0 + 2 * WIN, max(0, x0) : x0 + 2 * WIN], cx, cy)
        if mode == 'fill' and box is not None and mask.sum() < 4.0 * box.sum() * UP * UP:
            # only the number box came back: ask again with the clicks on the fill alone
            res = model(np.asarray(img)[:, :, ::-1], points=[[[x * UP, y * UP] for x, y in pts[:-1]]], labels=[[1] * (len(pts) - 1)], verbose=False)
            if res[0].masks is not None and len(res[0].masks.data):
                m2 = res[0].masks.data.cpu().numpy()[0] > 0.5
                if m2.sum() > mask.sum():
                    mask, mode = m2, 'fill2'
        if mode in ('fill', 'fill2') and box is not None and mask.sum() < 4.0 * box.sum() * UP * UP:
            # still only the box: solid red fill, take the red patch around the number instead
            from masks import red_mask

            w0 = a[max(0, y0) : y0 + 2 * WIN, max(0, x0) : x0 + 2 * WIN]
            red = ndimage.binary_erosion(red_mask(w0), iterations=2)  # cut joins through dashed outlines
            lab, _ = ndimage.label(red)
            ring = ndimage.binary_dilation(box, iterations=6) & ~box
            ids, c = np.unique(lab[ring & (lab > 0)], return_counts=True)
            if len(ids):
                comp = ndimage.binary_dilation(ndimage.binary_fill_holes((lab == ids[np.argmax(c)]) | box), iterations=2)
                mask = np.asarray(Image.fromarray(comp.astype(np.uint8) * 255).resize((comp.shape[1] * UP, comp.shape[0] * UP))) > 127
                mode = 'colour'
        r = to_polygon(mask, ox, oy)
        if r:
            poly, how = r
            out[k] = {'how': f'{mode}/{how}', 'coords': [list(map(float, c)) for c in poly.exterior.coords]}
        print(k, out.get(k, {}).get('how'), flush=True)
    path = OUT / 'sam' / 'shapes.json'
    prev = json.loads(path.read_text()) if path.exists() else {}
    prev.update({str(k): v for k, v in out.items()})
    path.write_text(json.dumps(prev))
    # review image
    sheet = Image.fromarray(a).convert('RGB')
    font = ImageFont.load_default(size=22)
    cells = []
    for k in nums:
        if k not in out:
            continue
        t = tags[k]
        x0, y0 = int(t['x']) - 175, int(t['y']) - 175
        c = sheet.crop((x0, y0, x0 + 350, y0 + 350)).resize((500, 500))
        d = ImageDraw.Draw(c)
        s = 500 / 350
        d.line([((x - x0) * s, (y - y0) * s) for x, y in out[k]['coords']], fill=(255, 0, 200), width=3)
        d.text((6, 6), f'{k} {out[k]["how"]}', fill=(0, 0, 0), font=font, stroke_width=3, stroke_fill='yellow')
        cells.append(c)
    for p in range(0, len(cells), 9):
        W = Image.new('RGB', (1500, 1500), 'white')
        for i, c in enumerate(cells[p : p + 9]):
            W.paste(c, ((i % 3) * 500, (i // 3) * 500))
        W.save(OUT / 'review' / f'sam-{p // 9 + 1}.png')


if __name__ == '__main__':
    main()
