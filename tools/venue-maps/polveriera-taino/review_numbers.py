"""Draw the building numbers (OCR + fixes) on the sheet, region by region, to check them by eye."""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

from common import DATA, OUT, clean_sheet_array

src = sys.argv[1] if len(sys.argv) > 1 else 'ocr'
if src == 'ocr':
    nums = json.loads((OUT / 'labels-ocr.json').read_text(encoding='utf8'))['numbers']
else:
    nums = json.loads((DATA / 'labels.json').read_text(encoding='utf8'))['numbers']
im = Image.fromarray(clean_sheet_array()).convert('RGB')
d = ImageDraw.Draw(im)
f = ImageFont.load_default(size=30)
for n in nums:
    x, y = n['x'], n['y']
    d.ellipse((x - 7, y - 7, x + 7, y + 7), outline=(255, 0, 255), width=4)
    d.text((x + 10, y - 34), str(n['n']), fill=(255, 0, 255), font=f, stroke_width=3, stroke_fill='white')
# 3 x 3 regions over the drawing, with overlap; a grid of sheet coordinates every 200 px for reading positions
for gx in range(0, im.width, 200):
    d.line([(gx, 0), (gx, im.height)], fill=(0, 160, 255), width=1)
    for gy in range(0, im.height, 600):
        d.text((gx + 2, gy + 2), str(gx), fill=(0, 120, 255), font=ImageFont.load_default(size=16))
for gy in range(0, im.height, 200):
    d.line([(0, gy), (im.width, gy)], fill=(0, 160, 255), width=1)
    for gx in range(0, im.width, 600):
        d.text((gx + 2, gy + 2), str(gy), fill=(0, 120, 255), font=ImageFont.load_default(size=16))
xs = [(400, 2200), (2000, 3800), (3600, 5400)]
ys = [(250, 1700), (1500, 2950), (2750, 4350)]
for i, (y0, y1) in enumerate(ys):
    for j, (x0, x1) in enumerate(xs):
        c = im.crop((x0, y0, x1, y1))
        c.thumbnail((1600, 1600))
        c.save(OUT / 'review' / f'numbers-{i}{j}.jpg', quality=85)
