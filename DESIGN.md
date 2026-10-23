# Design — "Field Ops"

## Direction

A field operations console, not a game. Players glance at it in a wood, in daylight,
wearing gloves, between bursts of adrenaline; Game Masters run it for hours on a tablet
or laptop. So: dark graphite surfaces, hairline structure, one muted olive accent, and
numbers you can read at arm's length. It should look like equipment.

Archetypes mixed: *Technical precise* (mono numbers, grids, signal colours) led,
*Enterprise functional* (compact density, small radius, clear tables) for GM screens.

## Tokens

Implemented once in `frontend/src/styles.css` (CSS custom properties → Tailwind
`@theme` → Spartan variables). Never hardcode colours in components.

### Colour

| Role | Dark (default in live games) | Light | Use |
| --- | --- | --- | --- |
| background | `#0E100F` | `#F2F2EC` | page |
| card | `#161917` | `#FFFFFF` | panels, sheets |
| muted | `#1F2420` | `#E8E8E0` | inset areas, chips |
| foreground | `#E9ECE6` | `#151813` | text |
| muted-foreground | `#A2AA9F` | `#565C51` | secondary text, labels |
| border | `#2C322D` | `#CFD2C5` | hairlines |
| primary (olive) | `#A4B465` on `#121509` text | `#4A5A1F` on white | main actions, own team, success |
| warning (amber) | `#E6B04F` | `#8F5D09` | active objectives, cooldowns, stale GPS |
| destructive (red) | `#F0595C` | `#C42B2F` | danger, enemies, destructive actions only |
| nav (cyan) | `#4FC7DD` | `#0B7A90` | own location, distance, navigation only |

**Classic dark** (theme choice in Settings, `.dark-classic`): neutral-gray surfaces instead
of green-tinted graphite: background `#121212`, card `#1E1E1E`, popover `#2A2A2A`, muted
`#262626`, border `#333333`, muted-foreground `#A3A3A3`. Primary is the logo red, lightened to
`#E8555A` on `#1A0606` text, in place of olive; the other accents stay as in dark.

Status is never colour alone: every status chip has a shape glyph + label
(`●` online, `◐` stale, `○` offline, `▲` contested, `■` locked, `◆` captured).

Team identity = team colour **+ pattern** (solid, stripes, dots, chevron, cross, grid)
**+ icon**. Two teams can never be told apart by hue alone.

### Type

* **Archivo Variable** — all UI text. Headings use the condensed width
  (`font-stretch: 80%`) in uppercase with tracking, like stencilled labels on kit.
* **JetBrains Mono Variable** — timers, scores, currency, coordinates, codes, distances.
  Always `tabular-nums`.

Scale (rem): 0.75 label · 0.875 dense UI · 1 body · 1.125 · 1.375 · 1.75 · 2.5 HUD numbers.
Inputs are ≥ 16px (no iOS zoom).

### Space, shape, depth

* Spacing: 4px grid (Tailwind default).
* Radius: 6px panels, 4px chips/inputs, full only for avatars and markers.
* Borders: 1px hairlines carry structure; shadows only on floating map HUD and sheets.
* Touch targets ≥ 44px (live screens use 48–56px).

### Motion

120–200ms, `ease-out`, only for state changes (sheet open, toast, progress).
Capture progress ring animates; nothing loops decoratively. All motion is disabled under
`prefers-reduced-motion`.

## Signature moves

1. **Section labels as stencil tags** — condensed uppercase label with a mono metadata tail:
   `OBJECTIVES · 4 ACTIVE`.
2. **HUD strip** on the live map: timer, own score, currency, GPS and link status in one
   mono row on a translucent graphite bar.
3. **Team chips with pattern swatches** — a small square filled with the team pattern next
   to every team name, marker and score.

## Rules

* Red means danger or enemy. Never use it for decoration or brand. The one exception is the
  classic dark theme, whose primary (and so the "AH" brand tile) is red.
* Cyan means *you* / navigation. Never use it for buttons.
* No camouflage, stencil fonts, neon, glows, gradients, or skull/weapon iconography.
* Map first on live screens; panels are bottom sheets on phones, side panels on ≥1024px.
* Destructive and game-changing actions always go through the confirm dialog, with the
  consequence spelled out ("Team Alpha loses 150 points").
* Every data view has loading (skeleton), empty, error and offline states.
