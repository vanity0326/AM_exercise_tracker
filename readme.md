# AM Exercise Tracker — Version 73

This repository deploys Toni's Exercise Tracker. Netlify serves only the committed `site/` directory and builds functions from `netlify/functions/`.

## Deployment layout

- `site/` contains the selected static Exercise Tracker pages and assets.
- `netlify/functions/data.mjs` is the only handler for `/api/data`. It stores the exercise tracker snapshot in the `iron-log` Netlify Blobs store.
- `netlify/functions/body.mjs` handles the separate Body Progress endpoint `/api/body`.
- `legacy-source/daily-health-data-handler.mjs` is retained for reference only; it is outside both the published site and functions directory.
- The old `public/` tracker and other source files are not published.

Deploy from the repository root using the included `netlify.toml`. No build command is needed because `site/` is already populated. Keep `site/` as the publish directory and `netlify/functions/` as the functions directory.

## Version 72 changes

- Clearing a suggested activity clears its auto-assigned day type when the date has no completed workout data.
- The Thanksgiving Lower B suggestion moves from Sunday, November 29, to Saturday, November 28. On an existing v70 install, the migration moves only the untouched, uncompleted v70 suggestion and only when Saturday has no plan or workout data.
- App and service-worker cache versions are updated to v72.
- The data endpoint is unambiguous, and function source files are kept outside the published directory.

## Holiday block

The editable block runs November 23, 2026 through January 3, 2027. It contains four strength sessions per regular week, Wednesday lap-swim suggestions, and holiday adjustments. Existing dated plans are preserved. Completed workouts remain historical records.


## Version 73 changes

- Add Set works across the Log, finisher, and superset exercise cards, and the added set count and values persist in the dated workout snapshot.
- Assigned classes appear in History automatically after a workout entry is logged on that date, including classes saved under generated IDs.
- Static app and service-worker assets use cache version 73. Existing workout data and settings need no migration.

