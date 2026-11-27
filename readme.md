# AM Exercise Tracker — Version 78

Netlify publishes the static app from `site/` and functions from `netlify/functions/`.

## Version 78

- The Log tab lets you choose a day type directly when a date has no planned activity, then loads that type's saved routine.
- The Routines tab shows the exercise count and full contents of each saved routine and finisher. Existing exercises can be modified with Edit; Add exercise is for new items.
- The Log tab identifies when an unlogged date has an empty date-specific list but a populated reusable routine and offers to load the saved routine for that date.
- Routine Builder edits update reusable templates for future workouts. Logged days remain snapshots, and Log still supports editing an individual workout.
- Upper B and Lower B are removed from day-type choices. Existing B-day assignments and bank designations map to Upper Lift or Lower Lift while preserving history.
- Clears dated schedules from November 27, 2026 onward, including per-date routine and finisher lists and incomplete class assignments. Completed set details, notes, and class history are retained.
- Retains set editing and weight carryover, the Classes type filter, automatic class-to-History transfer, flexible routines, sync, full JSON backup/restore, Progress, and existing tracker tools.
- Keeps the separate holiday plan available as a PDF. The Body Progress page is not published in the Exercise Tracker; the separate `/api/body` endpoint remains available.

## Deployment

Deploy from the repository root using `netlify.toml`. No build command is required because `site/` is already populated. Keep `netlify/functions/` as the functions directory. `/api/data` is handled by `data.mjs`; `/api/body` remains a separate handler.