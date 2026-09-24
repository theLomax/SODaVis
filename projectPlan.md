# Project plan

This proposes an order for everything in `toDo.md`. Each task is weighed on four things:

- **Complexity:** how many layers it crosses, and whether it changes the data model.
- **Token cost:** mostly driven by how many large files an agent has to read and edit.
  `Reference.tsx` (1,350 lines), `Charts.tsx` (904), `Trips.tsx` (867), `DataQuality.tsx`
  (796) and `Overview.tsx` (752) dominate.
- **Speed:** whether it fits in one agent run or needs several.
- **Time of day:** a task suits an unattended **overnight** run when it is fully specified
  and the tests can judge it. A task goes in a **daytime** run when it needs a product
  decision partway through, or a person looking at the UI.

The baseline was measured before writing this, not assumed: all 314 tests pass with the
private submodules checked out, 153 pass with the public sample alone, and `npm run
build` succeeds. `node test/private/e2e.mjs` **fails** on `main` (see Phase 0).

## Summary

| Order | Task | Size | Tokens | Run | Depends on |
|---|---|---|---|---|---|
| 0.1 | Fix the stale end-to-end script | S | Low | Any | — |
| 0.2 | Correct the stale test counts in `toDo.md` | XS | Low | Any | — |
| 0.3 | Add fee anomalies to the public sample | S | Low | Any | — |
| 1.1 | One registry for user-owned tables | M | Medium | Overnight | 0.1 |
| 1.2 | Split `Reference.tsx` into one file per editor | M | Medium | Overnight | 1.1 |
| 2.1 | Call tags (Infield Fly, Fourth Out …) | S | Low | Daytime | 1.1 |
| 2.2 | Click a rate data point to see its games | M | Medium | Daytime | 0.1 |
| 3.1 | General expenses, with sport tags | M | Medium | Overnight | 1.1, 1.2 |
| 3.2 | Multiple vehicles | M | Medium | Overnight | 1.1, 1.2 |
| 4.1 | Multi-park day editor + one-way legs | L | High | Design by day, build overnight | 1.1, 0.1 |
| 4.2 | Trip blocks | L | High | Overnight | 3.1, 4.1 |
| 5.1 | User-defined gear items and presets | L | High | Design by day, build overnight | 1.1, 1.2 |
| 5.2 | Per-game item tracking and lifespan | M | Medium | Overnight | 5.1, 3.1 |
| 6.1 | Local ratings of parks and leagues | S | Low | Daytime | 1.2 |
| 6.2 | Chart type options, chosen per chart | M | Medium | Daytime | 2.2 |
| 7 | API support, global analytics, demographics | XL | — | Decision first | a backend |

Sizes are relative: XS is a one-file edit, S is a single run, M is a single run touching
several layers, L is two or more runs, and XL is blocked on a decision that code cannot
make.

## Phase 0: Unblock verification (do first, any time)

Every UI task after this relies on the end-to-end script, and it is currently red.

**0.1 Fix the stale end-to-end script.** It times out waiting for the "trips not timed"
button. The app is not broken. Since the app stopped shipping seed parks, a fresh
browser profile has no parks at all. The script imports the export without first
restoring `data/reference.local.json`, so every venue is unmatched, no trips form, and the
button never renders. The Overview screenshot the script saves shows exactly that. The fix
is to restore the reference file through *Reference data → Backup* before the import
step. The script lives in the private `SODaVis-Tests` repository, so it is committed there
and the pointer is updated with `npm run commit`.

**0.2 Correct the stale test counts.** The Testing section of `toDo.md` says 142 of 306.
The measured figures are 153 of 314, which is what `readme.md` already says. A one-line
edit.

**0.3 Add fee anomalies to the public sample.** Unit tests cover the anomaly panel with
constructed games, but no fixture exercises it end to end, because the real export has no
anomaly. Add one of each kind (`zero-fee-active`, `paid-cancellation`, `no-scheduled-fee`)
to `scripts/make-fixture.mjs`, then run `npm run fixture` to regenerate the CSV and
`expected.json`. This lives in the public `SODaVis-SampleData` repository. It also partly
settles the other Testing note: the public sample has already grown from 19 to 24 games.

## Phase 1: Foundations (overnight run 1)

Both tasks are pure refactors. The 314 tests plus the repaired end-to-end script can judge
them without anyone watching, which makes this the best first overnight run. They also
pay for themselves: six later tasks each add a user-owned table or a Reference-data
editor.

**1.1 One registry for user-owned tables.** Adding a table currently means editing five
places by hand: the Dexie `version()` block, `AppSnapshot` and `loadSnapshot` in
`db/repo.ts`, the zod schema in `db/backup.ts`, the merge in `restoreBackup`, and the
counts in `exportBackup`. Missing one is not cosmetic. `restoreBackup` in `replace` mode
clears **every** table (`database.tables.map(t => t.clear())`) but only refills the ones
it names, so a new table left out of the backup is silently emptied by a restore. A single
registry (table name, key, zod shape, seed, merge rule) that all five places read from
closes that hole. Vehicles, general expenses, gear items, call types, trip blocks and day
legs would each become a one-entry change.

**1.2 Split `Reference.tsx` into one file per editor.** It is the largest file in the app,
and phases 3, 5 and 6 each add a tab to it. Splitting it now (parks, durations, sports and
gear, identity, settings, backup) means each later task reads a 200-line file instead of
1,350 lines. That is the single biggest token saving in the plan, and it lowers the risk
of edits colliding.

## Phase 2: Quick visible wins (daytime)

Both are small, but each needs a person to judge how it looks.

**2.1 Call tags.** An optional `calls?: string[]` on `GameAnnotation`, a Reference list of
call types seeded with Infield Fly, Fourth Out, Batter's Interference and Catcher's Balk,
chips in the trip editor, and one `HorizontalBar` in Breakdowns. Annotations are
unindexed, and the backup schema already accepts unknown keys, so the field itself needs
no schema migration. The editable list of call types does, which is why this follows 1.1.
*Aligned suggestion:* per-call counts by league and age group are also the first dataset
the anonymized-analytics idea in Phase 7 would collect, so it gets useful local data
before any backend exists.

**2.2 Click a rate data point to see its games.** Cheaper than `toDo.md` suggests, because
the destination already exists. The store has `setFilter({ period })` and `navigate()`, so
clicking a month can set the date filter to that month and open Trips. That is the same
mechanism the "Fix this" buttons use. The work is an optional `onPointClick` prop on
`ChartFrame`, threaded into the seven chart components in `Charts.tsx`, plus a keyboard
equivalent. The table view gets a clickable row so the feature is not mouse-only. The
daytime decision is whether a click should filter in place or navigate away. I recommend
navigating, with a visible "filtered to March" chip, because filtering in place would
change every other chart on the page.

## Phase 3: Money scopes (overnight run 2)

Both tasks touch `derive/money.ts`, `derive/tax.ts` and the Tax view. Doing them in one run
means those files are read once.

**3.1 General expenses.** A second expense scope that is not tied to a trip: a new table
reusing the `Expense` shape, plus an optional `sportCodes` tag. `tax.ts` already groups by
`ExpenseCategory`, so general expenses join the same lines. One subtlety needs a rule
written down before the overnight run starts: per-hour net in `money.ts` deliberately
subtracts only the expenses of trips the time model can time. Untagged general expenses
should stay out of `$/hr` and appear only in the Tax view and net take-home. Sport-tagged
ones can be spread across that sport's games.

**3.2 Multiple vehicles.** A reference table, a default, and an optional `vehicleId` on
`TripAnnotation`. The mileage layer barely changes. The value shows up in Tax, as miles by
vehicle, because the standard-mileage deduction is claimed per vehicle.

*Aligned suggestion:* the toll reconciliation deferred in `readme.md` becomes much easier
once a trip knows its vehicle, because a toll statement is per transponder, which means
per vehicle.

## Phase 4: The day model (design by day, build overnight)

**4.1 Multi-park day editor and one-way legs.** `toDo.md` already pairs these two. Trips
are keyed `(date, parkId)` and today a multi-park day only raises `multi-trip-day` and asks
for a mileage override per trip. The editor lists every venue on the day together and
records legs (home→A, A→B, B→home). The derived miles for each trip then come from the
legs rather than from round trips.

Settle three things in a short daytime session before the overnight run:

- **Where legs live:** a day annotation keyed by date, or an extension of the trip key.
  A day annotation is simpler and survives re-import the same way trip annotations do.
- **Whether park-to-park distances become reference data:** a pair table, so a repeated
  A→B day is entered once. This is the chained model that `readme.md` lists under
  "Deferred by choice".
- **Which wins when both exist:** the leg figures or an existing per-trip override.
  I recommend the override, since that is the rule everywhere else in the app.

Once those are fixed, the build is well-specified. `trips.ts` has thorough tests to extend,
so it runs well overnight.

**4.2 Trip blocks.** A parent entity above trips, holding a date range and optionally a
park set. It gets its own expense list, which is the third scope after trip and general
from 3.1, and those expenses spread across the block's games. It lands after 3.1 and 4.1
because it reuses both: the scoped-expense idea from one and the grouping of several trips
under a shared key from the other. It is the largest single build in the plan, so give it
its own overnight run.

## Phase 5: Gear (design by day, build overnight)

**5.1 User-defined gear items and presets.** Today `GearModifierId` is a closed union and
the order lives in `GEAR_MODIFIER_ORDER`. Opening it up to user-created items (shirt
colours, specific masks) and presets (a named set applied in one click) is a model change,
but a contained one. The migration rule matters most: the existing ids (`full-gear`,
`shield`, `casual`, `cold`, `rain`) must stay as seed items with the same ids, so no
stored annotation is orphaned. The daytime decision is the taxonomy: which items carry
prep minutes (conditions do today) and which are only tracked (a shirt colour should not
change the time model).

**5.2 Per-game item tracking and lifespan.** An optional `itemIds` on `GameAnnotation`,
plus a view showing games worn and days since purchase per item. *Aligned suggestion:*
link an item to the general expense that bought it (3.1), and the lifespan view can
report cost per game, which is the number that actually decides whether a more expensive
mask was worth it. Brand becomes a field on the item, which is also the input the gear
ratings idea in Phase 7 needs.

## Phase 6: Polish (daytime, whenever there is a gap)

**6.1 Local ratings.** The "demographic reviews" idea needs a backend to be useful across
users, but a single official rating their own parks, leagues and facilities is useful now:
an optional rating and note on `Park`, and on a league reference entry. It is small, and
the local data becomes the payload if Phase 7 goes ahead.

**6.2 Chart type options.** Kept last, as `toDo.md` says. The palette gives this a hard
constraint: under `--pairs all`, four categorical slots fail in dark mode, so any form
where every segment touches every other (a donut) caps at three series. Pick one
alternate form per chart where it genuinely helps (for example, a line for rate over time)
rather than adding a universal switcher. It follows 2.2 so the click-through works in
whichever form is shown.

## Phase 7: Needs a decision before any code

These three share one blocker, and it runs against the app's founding rule: *"Everything
runs in the browser and stays on your machine."*

- **API support (Assignr, RefTown)** needs a place to hold a client secret, which means a
  local helper or a backend. The import-profile abstraction means parsing is ready.
- **Anonymized global analytics** and **demographic metrics** need a server that collects
  data from many users, plus a privacy design: opt-in or opt-out, what counts as anonymized
  at small regional sample sizes, and retention.
- **Demographic reviews** across users need the same server.

I recommend one decision covering all three: either a small local helper (keeps the
local-only promise and unlocks APIs only), or a hosted backend (unlocks everything, and
changes what the app promises its users). Until then, 2.1, 5.2 and 6.1 collect the same
data locally, so nothing is wasted whichever way it goes.

## Suggested schedule

| Run | Contents | Why then |
|---|---|---|
| Next daytime | Phase 0, then 2.1 | Unblocks everything; small enough to review in one sitting |
| Overnight 1 | Phase 1 | Pure refactor, fully judged by tests |
| Daytime | 2.2, and the design decisions for 4.1 and 5.1 | Needs eyes on the UI and a few answers |
| Overnight 2 | Phase 3 | Well-specified once the `$/hr` rule is written down |
| Overnight 3 | 4.1 | Specified by the daytime session; `trips.ts` is well tested |
| Overnight 4 | 4.2 | Largest build; runs alone |
| Overnight 5 | 5.1 and 5.2 | Specified by the daytime taxonomy decision |
| Gaps | 6.1, 6.2 | Low risk, low cost |
| When ready | Phase 7 decision | Not a coding task until the backend question is answered |

## Other findings

- **The bundle is one 1 MB chunk,** twice Vite's 500 kB warning. Recharts is the likely bulk. Lazy-loading
  views with `import()` is a small, test-safe overnight job whenever there is spare
  capacity.
- **The end-to-end script depends on a restored reference file.** After 0.1, add a line to
  `readme.md` saying so, since the next person to run it will hit the same timeout.
