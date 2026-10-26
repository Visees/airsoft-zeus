-- Optional map layers: the add-ons of a venue map package (e.g. the sheet's grid). A zone with a
-- layer belongs to it; events.map_layers lists the layers, [{id, name, description, shown}], where
-- shown says whether maps show it at first (each viewer can switch it on and off, per device).

ALTER TABLE zones ADD COLUMN IF NOT EXISTS layer text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS map_layers jsonb NOT NULL DEFAULT '[]';
