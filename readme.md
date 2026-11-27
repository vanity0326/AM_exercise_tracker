# AM Exercise Tracker — Version 76

Netlify publishes the static app from `site/` and functions from `netlify/functions/`.

## Version 76

- Removes the preloaded holiday block and its holiday-only starter routines; the holiday program remains available as a separate PDF.
- Clears unstarted plan entries dated November 23, 2026 or later while retaining completed workout data and class history.
- Makes exercise edit scope explicit. On a date with logged workout data, edits default to “This workout only”; the user can choose the reusable routine for future workouts. Set count changes apply to the chosen scope.
- Keeps flexible day and finisher routines, optional Exercise Bank designations, templates, supersets, substitutions, progression, workout snapshots, and full JSON backup and restore.
- Keeps automatic class-to-History transfer, multiple class assignments, dated History, Progress tables/charts, and the existing tracker tools.
- Replaces the Classes tab status filter with a class type/category filter based on class title, such as Stride or Cooldown. Class statuses remain visible on each record.
- Preserves timestamped routine and Exercise Bank sync snapshots. Legacy unversioned data is merged conservatively.
- Removes the Body Progress page from the published Exercise Tracker; the separate `/api/body` endpoint remains available for the separate Health Tracker.

## Deployment

Deploy from the repository root using `netlify.toml`. No build command is required because `site/` is already populated. Keep `netlify/functions/` as the functions directory. `/api/data` is handled by `data.mjs`; `/api/body` remains a separate handler.