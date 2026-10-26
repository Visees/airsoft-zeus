"""Big view of the sheet with a labelled pixel grid, for tracing corners by eye.

    python trace_view.py name x0 y0 x1 y1 [scale]   ->  out/trace/<name>.png
Grid every 10 sheet px (labels every 50). Sheet px = 144 dpi of the venue sheet.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from common import OUT, raw_image, RAW_SCALE, RAW_X0, RAW_Y0

name, x0, y0, x1, y1 = sys.argv[1], *map(int, sys.argv[2:6])
k = float(sys.argv[6]) if len(sys.argv) > 6 else 4
raw = raw_image()  # native resolution
s = 1 / RAW_SCALE
crop = raw.crop((round((x0 - RAW_X0) * s), round((y0 - RAW_Y0) * s), round((x1 - RAW_X0) * s), round((y1 - RAW_Y0) * s)))
im = crop.resize((round((x1 - x0) * k), round((y1 - y0) * k)), Image.Resampling.LANCZOS).convert('RGB')
d = ImageDraw.Draw(im, 'RGBA')
f = ImageFont.load_default(size=14)
for gx in range((x0 // 10 + 1) * 10, x1, 10):
    major = gx % 50 == 0
    d.line([((gx - x0) * k, 0), ((gx - x0) * k, im.height)], fill=(0, 120, 255, 160 if major else 60), width=1)
    if major:
        for gy in range((y0 // 100) * 100 + 25, y1, 100):
            d.text(((gx - x0) * k + 2, (gy - y0) * k), str(gx), fill=(0, 80, 220, 255), font=f)
for gy in range((y0 // 10 + 1) * 10, y1, 10):
    major = gy % 50 == 0
    d.line([(0, (gy - y0) * k), (im.width, (gy - y0) * k)], fill=(0, 120, 255, 160 if major else 60), width=1)
    if major:
        for gx in range((x0 // 100) * 100 + 25, x1, 100):
            d.text(((gx - x0) * k, (gy - y0) * k + 2), str(gy), fill=(220, 0, 120, 255), font=f)
Path(OUT / 'trace').mkdir(parents=True, exist_ok=True)
im.save(OUT / 'trace' / f'{name}.png')
print(im.size)
