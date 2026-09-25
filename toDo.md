# ToDos

Completed items move to `toDone.md`.

Grouped by effort. Estimates are from reading the code, not guessing. The quick-win
section is empty for now — what remains genuinely needs a new mechanism or touches
the data model.

## Medium — needs a new mechanism, but a contained one

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
- 161 of 317 tests need the private submodules and skip without them, so a fresh
  clone runs 156 (measured, not estimated). If a second contributor joins, decide
  whether the public sample should grow to cover more cases first.

## Data errors
- **A paid cancellation breaks the fee reconciliation.** Overview says forfeited,
  less pay above rate and income from games with no rate, "offsets it to" the net
  gap (`scheduledAll − gross`). A cancellation that paid part of its fee counts only
  the unpaid part as forfeited, but its payment is kept out of `gross` by design, so
  the pieces fall short of the gap by exactly that payment. On the sample: $152.50 −
  $28 − $50 = $74.50 against a $97 gap; the $22.50 is the half-paid rainout. The
  real export has no paid cancellation, so no figure shown so far is wrong. Needs a
  decision first: either a paid cancellation's money is income (it arrived), or it
  needs its own term in the sentence.

## Features
- consider decoupling the game gear objects: allow users to create their own items and gear presets, including shirt colors.
- add individual item tracking (like shirt color, or mask 1 / mask 2) per game, for more data tracking and lifespan statistics for gear.
- Anonymized global data tracking: collect and track all metrics across all users, but anonymized to protect user privacy. This will allow us to track popular brands for gear, frequency of calls, contrast those frequencies by region, age, and other demographic factors.
- consider other user metrics, like age, sex, years of experience. Offer users to opt-out, but reinforce that it's anonymized, and used for general analytics and trend tracking.
- Demographic reviews: consider an option for officials to rate gear, brands, fields, leagues (with breakdowns for players, coaches, parents, boardmembers, surrounding neighborhoods, etc.), rulesets, concessions, facilities, and other elements.
