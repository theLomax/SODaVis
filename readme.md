# SODaVis: Sports Official Data Visualizer

A local web app for tracking officiating work — baseball, fastpitch, slowpitch and
kickball — replacing a Google Sheets workbook that had outgrown its formulas.

Everything runs in the browser and stays on your machine. Data lives in IndexedDB;
a JSON export keeps it portable.

## Installation

Node 20 or newer, and a Chromium browser if you want to run the end-to-end checks.

```bash
git clone https://github.com/theLomax/SODaVis.git
cd SODaVis
git submodule update --init test/sample   # public: the sample data
npm install
npm run dev          # http://localhost:5173
```

Fetch the sample explicitly rather than with `--recurse-submodules`. Two of the three
submodules are private, and a recursive clone **aborts** on the first one it cannot
read — taking the public sample down with it. Naming it avoids that entirely.

If you do have access to the private repositories:

```bash
git submodule update --init --recursive   # all three
```

### Where the sample data comes from

`test/sample/` is a **public** submodule,
[SODaVis-SampleData](https://github.com/theLomax/SODaVis-SampleData): 27 invented
games reproducing every structural oddity a real Assignr export has, plus the figures
they produce. Nothing in it describes a real person, league or payment.

It is what lets the whole pipeline be tested by anyone. Import
`test/sample/games-sample.csv` through *Import* in the running app and every view
fills with plausible data — which is also the fastest way to see what the app does
before feeding it your own export.

```bash
npm test             # 156 with the public sample alone; 317 with the private data too
npm run build        # static bundle in dist/
```

### Using your own export

Export your games from Assignr as CSV and import it through the *Import* view. Nothing
leaves the browser: the file is parsed in the page, and the result is stored in
IndexedDB on your machine. *Reference data → Backup* writes a JSON file you can keep
somewhere you trust.

The app ships with **no parks and no identity**, because a park list is one person's
commute and an identity pattern is their name — neither belongs in a public repository
as a default. On first import every venue is flagged as unmatched, which is the
designed path: *Data quality* offers a suggested name and one-click creation for each.

### The private submodules

Two are private and neither is needed to run, build, or meaningfully test the app:

| Path | Repo | Holds |
|---|---|---|
| `data/` | SODaVis-Data | One real export, a reference seed, and the figures derived from them. |
| `test/private/` | SODaVis-Tests | Suites that assert that season's actual totals. |

With them checked out, `npm test` runs 317 and `node test/private/e2e.mjs` drives the
built app in Chrome against the real file. Without them it runs 156 and nothing fails
— the sample covers the same code.

```bash
npm run validate:palette -- "#2a78d6,#eb6834,#1baf7a,#4a3aa7" --mode light
npm run commit -- "message"        # commits app + submodules in order
npm run publish:app -- "message"   # copies the clean tree to the public repo
```

### Publishing is a copy, not a push

The development repository's history contains commits that carried real data in test
assertions, from before that was fixed. A working tree can be cleaned; a history
cannot, short of rewriting it — and a clone fetches every commit. So the public
repository has its own history, beginning from a tree verified clean, and
`npm run publish:app` copies the current tracked files into it rather than pushing
this branch.

The push URL on `origin` is deliberately set to an invalid value, so a reflexive
`git push` fails loudly instead of republishing eleven commits of real data. The
script also scans every file it is about to publish and refuses if it finds a partner
name, venue, league or income figure — because a scan is only worth as much as the
last time someone remembered to run one. The list it scans for is itself personal, so
it lives in the private data repository as `data/publish-denylist.txt` (or wherever
`SODAVIS_DENYLIST` points); without it the script refuses to publish at all. With
`data/` checked out, `npm test` runs the same scan over the tracked tree.

## The four layers

Imported facts, personal knowledge and computed values never mix. This is the whole
design, and the reason a re-import can't destroy your corrections.

| Layer | What it holds | Who writes it |
|---|---|---|
| **1. Facts** (`model/game.ts`) | Games exactly as a source file stated them, plus the verbatim `rawRow` | import only |
| **2. Reference** (`model/reference.ts`) | Parks and mileage, game durations, sport prep/wrap, gear levels, identity patterns, settings | you only |
| **3. Annotations** (`model/annotation.ts`) | Per-game and per-trip overrides and expenses, keyed by stable identity | you only |
| **4. Derived** (`derive/*`) | Parks, trips, time models, money, metrics, tax — pure functions, recomputed on read | nobody; never stored |

Annotations are keyed by `dedupeKey` (a game) and `${date}|${parkId}` (a trip), never
by row index — so re-importing a corrected export keeps every manual number attached
to the thing it describes.

## Import is source-agnostic

Assignr's export is one profile, not the shape of the pipeline. RefTown is a
configuration exercise, not a code change.

1. **Parse** — tolerant of ragged rows (a solo game omits its trailing columns) and
   trailer rows (a `TOTALS:` sum line).
2. **Detect** — ranks known profiles by header fingerprint and reports its confidence.
3. **Map** — a known profile applies its field map; an unknown file opens a mapping UI
   with fuzzy suggestions, saved as a reusable custom profile. `Position N`/`Official N`
   pairs are discovered by pattern, so a 3- or 4-official crew needs no schema change.
4. **Normalize** — money, dates, times, status vocabulary, officials, `isSelf`.
5. **Reconcile** — new inserts; identical skips; **changed shows a field-level diff
   before anything is written**; missing from this file is **left untouched**, because a
   narrower date range is not a deletion.
6. **Commit** — one `Import` record, with undo.

## Three time models, chosen deliberately

`$/hr` means nothing until you say what counts as an hour, so all three are computed
and one is selected for display:

- **Game time** — Σ scheduled durations. Comparable to Assignr's own reporting.
- **Game + drive** — adds the drive, one leg at a time. What the old workbook
  computed, except that the workbook doubled a single one-way figure.
- **Committed** — door to door: (last out − first pitch) + drive + prep + wrap, so
  the downtime between games shows up as the cost it is.

A trip missing an input is **excluded from that model, along with its income** — the
rate is computed over what the model can actually time, and the view says how many
trips that is. Counting an unknown duration as zero minutes is what produced an
absurd hourly rate for one month in an early build.

That count is a control, not a footnote. **Click "N trips not timed"** and the dialog
names every one: the park, the date, the income held outside the rate with the time,
which input is absent, and a button to the exact field that supplies it. `totalTime`
returns `untimedByModel` alongside `incompleteByModel`, and the count is derived from
the list's length — a test asserts they are equal for all three models, so a figure on
screen can never again name a number of trips the app cannot name individually.

Two different inputs produce the same symptom, and the dialog distinguishes them:

- **No duration** for an age group — nulls `gameMinutes`, so every model drops the trip.
  Fixed once per age group in *Reference data → Game durations*.
- **No mileage** for the park — drive time is estimated from miles, so no miles means no
  drive figure, which drops the trip from *game + drive* and *committed* (`game` still
  times it). Fixed once per park in *Reference data → Parks & mileage*.

With every age group filled, four trips in the sample still cannot be timed, all for the
second reason — four parks
carry no `oneWayMiles`, because the workbook's `Park Details` sheet never did. **Those
figures are not invented here**; the app's rule is that it never guesses a distance. The
four rows sort to the top of the parks table with a `no mileage` marker instead, and
entering the four numbers clears all four trips and returns the held income of income to the rate.

## The drive out is not the drive home

A 6pm game means driving out through rush hour and home on empty roads. An hour
each way is not what happened — it was an hour out and half an hour back — so
doubling either one-way figure is wrong in one direction, and doubling the ideal
one understates the day.

So each park carries two figures, and **each leg is judged on its own clock** —
the outbound by the first pitch, the return by when you actually leave the field.
One trip's two legs routinely get different answers, and in both directions:

- A weekday 6pm game drives **out** through rush hour, home on empty roads.
- A Saturday 9am game that finishes at 15:45 does the reverse — out on clear
  roads, then **home** straight into it.

The window is 15:00–19:00, every day, and is editable in *Reference data →
Settings*. It was weekdays only at first, on the evidence that weekday games finish
after the window closes — true, but it silently charged a clear-road drive home to
every weekend afternoon game.

Because the window changes computed figures without changing any data, its effect
is otherwise invisible until you open a trip — so the control states it: how many
trips drive out through the window, how many drive home through it, and how many
actually use a park's rush figure. Narrow it to 17:00 and the return count drops
to zero, which is the weekday finding restated as a live number.

Where a park has no rush figure, the ideal one is used both ways: better the same
number twice than a guess at how much worse the traffic was. A game with no
duration has no known finish, so whether the drive home hit traffic is unknowable
and the ideal figure stands. Manual entry still wins over both, and the editor
labels whichever legs were affected — `30m out (rush hour) + 12m home`, or
`12m out + 30m home (rush hour)` — because otherwise a round trip that is not
twice the one-way figure reads as an error rather than the point.

This makes the rate figures lower and more honest: unpaid drive time that was
previously invisible lands in `game + drive` and `committed`. On a full season most
trips have a rush-hour outbound leg, and a handful of weekend afternoons a rush-hour
return.

## Every warning is a route to its fix

A flag that says where to go, in prose, still leaves the reader to navigate. So the
destination is data: `FLAG_INFO[code].fixTarget` is a `{ view, tab, label }`, the `label`
being the same wording that used to be a bare string. `navigate(target)` lives in the
store beside `filter` — which is why `view` is store state rather than local to the shell
— and takes an optional `focus`: a park id, an age-group key or a trip key. The
destination view consumes it, scrolls to the row, and focuses the input itself.

The reader therefore lands on the field, not the page:

- The **untimed-trips dialog** gives every row a button to its own park or age group.
- The **flag dialog** turns its "Where:" line into a button, and gains a footer that
  navigates whenever the caller supplies no action of its own. Where a flag *can* be
  fixed in place, the in-place action still wins: the Trips chip keeps "Open this trip to
  enter it", and a missing duration — which lives in Reference data — gets the target.
- **Data quality** puts a `Fix this` button on each row, focused on that row's park, age
  group or trip rather than the top of a long table.

## What the app refuses to guess

The workbook's real failure was quiet wrongness. These all surface in **Data quality**
rather than resolving themselves, and every `! Review` chip is a real control —
click it for what was detected, what it costs, and how to fix it:

- An unmatched venue never silently becomes its own park.
- A missing game duration excludes the game from time and rate, and is reported.
- `2 umpires` with one official listed is flagged, not filled in.
- A multi-park day is flagged for manual mileage, because round-trip-per-park counts
  the drive home twice.
- A park with no mileage shows *not on record*, not `0` — and if games resolve to it,
  the row is marked and sorted first, so the gap is not a blank cell to scroll past.

Flag copy lives in one place (`ui/flags.ts`), so the Trips chip, the Data quality
heading and the dialog can never drift apart. A test asserts every code declared on
the model has copy, that no copy outlives its code, and that every `fixTarget` names a
view the store can actually reach. An informational flag gets neutral ink rather than
the `good` status token, since a green tick beside a note reads as "this passed".

## Your data stays out of the repository

An officiating export is personal: income, the partners you worked with, every venue
and date. The old workbook's toll sheet also carried a transponder account number and
a licence plate. None of it belongs in a repository that may be public — and it is not
enough to gitignore the files, because facts about the data leak into code as seeds, as
test assertions and as documentation, where no ignore rule can catch them.

Hence four repositories, and the split follows what each holds rather than what it is:

| Repo | Visibility | Holds |
|---|---|---|
| **SODaVis** | public | The application. No real name, figure, park or league anywhere in it. |
| **SODaVis-SampleData** | public | Invented games covering every structural case, at `test/sample/`. |
| **SODaVis-Data** | private | One real export and its reference seed, at `data/`. |
| **SODaVis-Tests** | private | Suites asserting that season's actual totals, at `test/private/`. |

The sample being public is the load-bearing part. Before it existed, a clone without
access skipped 161 tests, and a skipped test tells a contributor nothing about whether
their change was safe.

### Why submodules and not a monorepo

Git visibility is per *repository*, never per directory. One repo holding the app
alongside the real export is entirely private or entirely public — there is no setting
that publishes `src/` and withholds `data/`. A monorepo would mean rewriting history at
every publish, and `git subtree` is no better: it copies files into the parent's own
history, so publishing would publish everything ever merged in.

The cost is that a change touching both the app and a private test needs three commits
— the submodule, the app, and the pointer that ties them. `npm run commit` does all
three in order and stops at the first failure, rather than leaving the app recording a
submodule state that does not match its code. Every submodule tracks `main` rather than
a detached commit, so editing one in place is safe.

### Expected figures are named, not hardcoded

A test asserting a bare `toBe(n)` needs a comment saying where `n` came from, and that
comment is where venue names and income totals creep back into the repo — which is
exactly how they got there the first time. So the figures live in a file and the tests
read them by name:

```ts
expect(games).toHaveLength(expectedFigures.games.total)
```

`test/sample/expected.json` covers the public sample; `data/expected.json` overrides it
for the real export. Both are **derived**, by `scripts/write-expected-example.mjs` and
`scripts/write-expected.mjs`, so neither can drift from the CSV it describes — a
hand-kept count goes stale the moment the data changes, and a test asserting a stale
number is worse than no test.

A suite testing the sample always reads the sample's figures, even on a machine where
the real export is present. Getting that wrong was a real bug: the fixture suite failed
on the one machine that had the data.

A key the file does not define throws at the point of use, naming the file and the key.
Returning `undefined` would let `toBe(undefined)` pass against `undefined`: a test that
asserts nothing while looking like it asserts something.

### The app ships no seed parks

`SEED_PARKS` and `SEED_IDENTITY` are empty. A real park list is one person's commute —
names, cities, distances, tolls — and an identity pattern is their name, so neither can
be a default in a public repository. A fresh install starts with empty reference tables
and the first import flags every venue as unmatched, which is already the designed path
for an unknown park: Data Quality offers a suggested name and one-click creation.

On a machine entitled to the real data, restore `data/reference.local.json` from
*Reference data → Backup* and the parks, mileage, tolls and identity come back at once.

## Verified against the sample export

The real export lives in the private `SODaVis-Data` submodule, and the suites that
assert its figures live in `SODaVis-Tests` at `test/private/`. Every figure was derived
from the file independently of the code, which is what made the derive layer
trustworthy — and what caught several real bugs. The table below describes *what* is
checked; the numbers themselves stay in the private repo.

| | What is asserted |
|---|---|
| Parse | Every game read; the blank-date row and `TOTALS:` trailer dropped; ragged rows yielding one official each |
| Status | Active and cancelled counts; no active game at $0, and no cancellation paid |
| Money | Actual against scheduled, reconciled to the net gap — forfeited less paid-above-rate |
| Identity | Self found on every row despite the rotating `(F25)`/`(S26)` suffix, in either official slot; partner counts, one dominant and a long tail |
| Parks | Venue strings collapsing to parks; a trailing-period twin merging by alias; a park appearing only in cancellations producing no trip |
| Trips | Trip and work-day counts; multi-park days flagged for mileage |
| Durations | Rows whose duration is extracted, and the scopes still needing a figure |
| Untimed | With durations filled, the trips still untimed for want of mileage — each named individually rather than only counted |
| Re-import | The same file inserting nothing; one edited fee raising exactly one conflict, annotations intact |

`test/private/e2e.mjs` then drives the real app in Chrome — restores the parks and identity
from `data/reference.local.json` (the app ships neither, so without them no trip forms),
imports the export, checks the Overview reads the export total, fills in durations, adds a trip expense, re-imports to confirm
nothing is lost — and gates on console errors, horizontal overflow, overlapping chart
labels, value labels drawn inside their bars, and charts that drew axes but no marks.
It also drives the flag dialog: that the chip is a button announcing `aria-haspopup`,
that the dialog is genuinely modal and portalled clear of its scrolling table, that
Escape/backdrop/Close all dismiss it, that its "Where:" line is a control, and that its
fix action lands on the field where the fix is made. And it drives the trace from a
count to its fix end to end: the untimed badge is a button, its dialog lists one row per
untimed trip, a row's fix button lands on Reference → Parks with that park's miles field
focused, and typing a figure there drops the badge count by one. It runs against both
`npm run dev` and the built bundle.

## Visualization

Palette validated with `scripts/validate_palette.js` against both surfaces, not
eyeballed. Sports take categorical slots 1–4; those PASS every adjacent-pair gate in
both modes (worst CVD ΔE 9.2 light / 9.4 dark). Under `--pairs all` four slots FAIL in
dark mode (violet↔blue ΔE 1.9 protan), so all-pairs forms cap at three slots — see
`ui/charts/palette.ts`, whose tests assert the recorded hexes still match what was
validated.

Enforced in the chart wrappers: no dual-axis charts anywhere; color follows the entity
so filtering never repaints survivors; ≤24px bars with 4px rounded data-ends square at
the baseline; 2px surface gaps and rings; legend for ≥2 series with selective direct
labels; every chart has a table view; dark mode uses its own validated steps.

## Deferred by choice

- **Assignr API** — OAuth 2.0 + HAL+JSON at `api.assignr.com/api/v2`, carrying venue
  coordinates and payment status. A browser can't hold a client secret, so this needs a
  small local helper; the profile abstraction means the API becomes one more profile.
- **Toll reconciliation** — the workbook's `Tolls` sheet is a pasted toll-authority
  statement. Matching real gantry charges to trip dates is the follow-on; per-park
  estimates are the fallback. (A statement total is also how a toll conflict between
  the workbook's sheets was settled in favour of `Park Details`.)
- **Park-to-park mileage** — a chained home→A→B→home model, if multi-park days become
  common. Flagged for manual entry now.
- **Mileage for the four parks with none** — your knowledge, not the app's. The rows are
  marked and sorted first; the app will not put a number there on your behalf.
