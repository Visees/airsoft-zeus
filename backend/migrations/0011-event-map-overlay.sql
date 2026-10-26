-- Venue map image shown under the game shapes (a field's own printed map, already georeferenced).
-- {"url": "/api/files/map_overlay-….webp", "corners": [{lat,lng} x4: top-left, top-right,
-- bottom-right, bottom-left], "opacity": 0.85}; NULL when the event has none.

ALTER TABLE events ADD COLUMN IF NOT EXISTS map_overlay jsonb;
