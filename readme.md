# AM Exercise Tracker — Version 77

Netlify publishes the static app from `site/` and functions from `netlify/functions/`.

## Version 77

- Adds a dedicated Routines tab for building reusable exercise lists by day type, including finishers. It supports adding, editing, reordering, removing, and grouping exercises into supersets.
- Routine Builder edits update reusable templates for future workouts. Logged days remain snapshots, and Log still supports editing an individual workout.
- Removes Upper B and Lower B from day-type choices. Existing B-day assignments and bank designations map to Upper Lift or Lower Lift while preserving history.
- Clears dated schedules from November 27, 2026 onward, including per-date routine and finisher lists and incomplete class assignments. Completed set details, notes, and class history are retained.
- Retains set editing and weight carryover, the Classes type filter, automatic class-to-History transfer, flexible routines, sync, full JSON backup/restore, Progress, and existing tracker tools.
- Keeps the separate holiday plan available as a PDF. The Body Progress page is not published in the Exercise Tracker; the separate `/api/body` endpoint remains available.

## Deployment

Deploy from the repository root using `netlify.toml`. No build command is required because `site/` is already populated. Keep `netlify/functions/` as the functions directory. `/api/data` is handled by `data.mjs`; `/api/body` remains a separate handler.