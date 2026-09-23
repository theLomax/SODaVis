# ToDos

Completed items move to `toDone.md`.

Grouped by effort. Estimates are from reading the code, not guessing. The quick-win
section is empty for now — what remains genuinely needs a new mechanism or touches
the data model.

## Medium — needs a new mechanism, but a contained one

- **Click a rate data point to see its games.** `ChartFrame` already owns a
  table-view toggle, so the frame is the right place for a click-through; the work
  is threading a handler through and deciding what the destination looks like.
- **Multi-park day editor** — list every venue for that day together, so the mileage can be adjudicated across them rather than one field at a time.
- **One-way leg entry for multi-park days.** Round trip is the wrong model when the
  day is home→A→B→home. Depends on the editor above, so they land together.
- **Multiple vehicles** with a default and per-trip attribution. A new reference
  entity and an optional trip field; the mileage layer changes very little.
- **General expenses** (shoes, uniform, gear) with optional sport tags. Expenses
  already exist per trip, so this is a second scope — not-trip-bound — rather than
  a new concept.

## Large — changes the data model

- **Trip blocks** for out-of-town tournaments, so travel, lodging and meals attach
  to a block and spread across its games. You suspected this needs a new relational
  structure; it does — a parent entity above trips.
- **Chart type options** (line, donut, radar). Deliberately last, because it is the
  item most likely to make the app worse. A donut only works at six segments or
  fewer, and radar is genuinely poor for comparing magnitudes — it is worth picking
  the right alternate form per chart rather than offering a universal switcher.
- **API support** (Assignr, RefTown), with credentials, OAuth/JWT and cloud storage.
  Still the big lift you called it. The import profile abstraction means the parsing
  half is ready; the blocker is that a browser cannot hold a client secret, so this
  needs a local helper or a backend.

## Testing
- 164 of 306 tests need the real export in `data/` and skip without it, so a fresh
  clone runs 142 (measured, not estimated). If a second contributor joins, decide
  whether the anonymized fixture should grow to cover more cases first.
- The real export carries no fee anomaly — no active game at $0, no cancellation that
  paid, no game without a scheduled fee — so `scripts/e2e.mjs` cannot exercise that
  panel. Unit tests cover it with constructed games. Worth adding an anomaly to the
  committed fixture if the panel changes again.

## Features
- consider decoupling the game gear objects: allow users to create their own items and gear presets, including shirt colors.
- add individual item tracking (like shirt color, or mask 1 / mask 2), for more data tracking and lifespan statistics for gear.
