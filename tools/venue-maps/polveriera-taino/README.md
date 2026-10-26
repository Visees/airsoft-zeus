# Polveriera Taino: the field map for AirsoftHub

Builds the map of the Ex polveriera Montedison (Taino, VA) from the venue sheet
(`data/pianta-campo.pdf`, by ASD Raiden) and the Lombardy topographic database (DBTR).

## How it works

One source per thing, so the parts never disagree:

| What | Source |
| --- | --- |
| Building footprints | DBTR (`data/dbtr-edifici.json`): the real outlines |
| Building number, no-go (red) or playable | the sheet, read inside each footprint |
| Boundary, no-go areas, explosives area, car park, covered path, entrance | the sheet (`data/sheet-features.json`, sheet pixels) |
| Building numbers, road names, places | the sheet (`data/labels.json`, checked by eye) |
| Venue map image (the sheet itself, warped north-up) | the sheet |

The sheet is placed on the ground with an affine transform fitted on 22 buildings whose drawn
blob matches the real footprint one to one (leave-one-out error: median 0.5 m, p95 1.6 m). A smooth
local warp was tried and did not do better: the sheet is drawn from a survey and has no drift.

Rules worth knowing:
- A red building has a big white number tag: white inside a footprint is ignored. A footprint is
  split in two only where the sheet paints red next to hatching.
- A number tag names the building it sits in, or the nearest untagged building within 6 m.
  Otherwise it stays a free label where the sheet puts it (the sheet numbers earth-covered bunkers
  and small structures that have no footprint).
- A building the sheet shows inside the field is inside the boundary: the boundary grows around it.
- DBTR buildings the sheet does not draw at all are left out (listed in `out/report.json`).

## Run

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # Windows; bin/ elsewhere
.venv/Scripts/python register.py   # fit the sheet on the ground -> out/registration.json
.venv/Scripts/python build.py      # -> out/
```

`labels.py` (OCR with the reader built into Windows, `ocr.ps1`) and `curate_labels.py` produced
`data/labels.json`; `bootstrap.py` produced `data/sheet-features.json` from the first version.
They are kept to show where the data came from: to fix a label or a shape, edit the files in `data/`.

## Output (`out/`)

| File | What |
| --- | --- |
| `polveriera-taino.geojson` | **the one file for the app** (a venue map package): boundary, areas, buildings with numbers, road and place names (styles included), the add-ons (the sheet's grid, the entrances of the "case matte"), the venue map image and where players' maps open |
| `pianta-campo.webp` + `pianta-campo.position.json` | the venue map image and where it goes (also inside the package; kept for the review tools) |
| `report.json` | registration error, buildings left out, free numbers, buildings with several numbers |
| `review/` | images to check the result by eye |

## Load it into an event

In the event's map editor, menu ⋮ → **Import GeoJSON or CSV** → `polveriera-taino.geojson`. The
dialog shows what the package holds: tick the add-ons wanted (grid, entrances), keep or untick the
venue map image and "Set as event area", and tick "Remove the current areas, lines, labels and points
first" when the event already has an older version of the field (objectives stay). Then **Save as
map template** to reuse the field in other events.

The package format (an `airsofthub` member next to `features`, add-on features tagged
`properties.layer`) is described in `frontend/src/app/features/gm/map-editor/map-package.ts`.

## Tracing by eye (current method, 2026-10-26)

Automatic outlines (DBTR, pixel rules, SAM 2.1) are not reliable on this sheet: buildings and
earth banks use the same hatching. Building outlines are now traced by eye and stored in
`data/traced.json` (sheet pixels); they win over every other source in `build.py`.

Done (2026-10-26): every building the sheet draws, regions A-K, plus the two red squares in the
north and the Black hole point circle. Keys: a number; "18/19" for one building with two numbers;
a name with `"n": [64]` for a second piece that carries a number again (64 has two tags).
Not traced, on purpose: 25, 126, 131, 132, 133 keep a tag-sized box (the sheet draws nothing under
the tag, the tag may hide a small structure); 31, 32, 38, 57, 77, 78, 103, 105, 106, 113, 117,
118, 123, 124 are free labels (no building on the sheet). labels.json had 104, 107, 108 shifted
by one tag: fixed.
Steps used (also for any later fix):
1. `python region.py A 3540 3440 4420 4260 1.6` renders the sheet with a pixel grid and the
   current outlines (cyan no-go, magenta playable).
2. Right as is: `python freeze.py <numbers>` copies them into traced.json.
3. Wrong: render a close-up (`python trace_view.py name x0 y0 x1 y1 5`), read the corners on the
   grid (sheet px = x0 + X/scale, y0 + Y/scale), add them to traced.json.
4. `python build.py`, then check with region.py again before the next area.
Tag positions (sheet px) are in data/labels.json; region A covers buildings 1-11.
5. Next (not started): the same check for everything else in `data/sheet-features.json` (traced
   by the first version, never checked closely): the field boundary (follow the fence on the sheet,
   segment by segment), the car park, the 4 no-go areas, the explosives area, the covered path and
   the entrance. Retrace whatever is off; edit the points in sheet-features.json (sheet px).
