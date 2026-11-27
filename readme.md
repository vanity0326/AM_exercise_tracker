# AM Exercise Tracker — Version 75

Netlify publishes the static app from `site/` and functions from `netlify/functions/`.

## Version 75

- Removes the preloaded holiday block and its Upper A/B and Lower A/B starter routines. The holiday plan is maintained separately as a PDF.
- Safely removes untouched, system-generated holiday suggestions and starter routines on existing installs. Edited dates, workout logs, completed exercise snapshots, user routines, class records, settings, and bank data are retained.
- Keeps flexible day and finisher routines, optional Exercise Bank designations, templates, routine-versus-today edits, supersets, substitutions, workout snapshots, progression, and custom exercise/set editing.
- Keeps automatic class-to-History transfer, multiple class assignments, dated History, Progress tables/charts, full JSON backup and restore, and the existing tracker tools.
- Saves timestamped routine and Exercise Bank snapshots so v75 edits and intentional removals survive sync. Legacy unversioned content is merged conservatively.
- Carries forward saved weights when opening a workout or re-adding a known exercise. Added sets and edits persist to the dated workout.
- Removes the Body Progress page from the published Exercise Tracker; the separate `/api/body` endpoint remains available for the separate Health Tracker.

## Deployment

Deploy from the repository root with the included `netlify.toml`. No build command is required: `site/` is the populated publish directory. Keep `netlify/functions/` as the functions directory; `/api/data` is implemented by `data.mjs` and `/api/body` remains a separate handler.