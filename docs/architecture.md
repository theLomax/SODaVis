# Architecture

How the code is shaped and why. Read this before scanning the tree; most questions about
where something lives or what a change touches are answered here or in the generated
[`module-map.md`](generated/module-map.md) (every module's purpose, size, exports,
imports and importers). Product reasoning — why three time models, why the app refuses
to guess — lives in [`readme.md`](../readme.md); decisions and their history in
`toDone.md`; open work in `toDo.md` and `projectPlan.md`.

**Keep this current:** a change to layers, tables, state ownership or an extension recipe
updates this file in the same PR. The module map is regenerated with `npm run map`, and a
test fails while it is stale.

## In one paragraph

A single-page React app (Vite, TypeScript) that runs entirely in the browser. Game
exports (Assignr CSV, RefTown Excel, or any mapped CSV/Excel) are parsed into canonical
**facts**; the user's own knowledge (parks, durations, sports, organizations, vehicles,
gear…) is **reference data**; per-game and per-trip corrections are **annotations**. All
three live in IndexedDB (Dexie). Everything shown — trips, time, money, rates, tax — is
**derived** on read by pure functions and never stored. There is no server.

## Layers and data flow

```
 file ──► import/ ──► Game (facts) ──┐
                                     ├──► IndexedDB (db/) ──► AppSnapshot ──► derive() ──► DerivedState ──► views
 user edits ──► db/repo ─────────────┘        tables.ts          repo.ts      store.tsx     (ui/store)       ui/views
               (reference, annotations)
```

| Layer | Directory | Rule |
|---|---|---|
| Model (types, seeds, pure helpers) | `src/model/` | No imports outside `model/`. The four data layers are typed here: `game.ts` (facts), `reference.ts` (user knowledge), `annotation.ts` (corrections), plus `gear.ts`, `organizations.ts`. |
| Import | `src/import/` | File → `ParsedFile` → `Game[]`. Never writes; `reconcile.ts` only *decides* inserts, skips and conflicts. Formats are `profiles/*` (see below). |
| Persistence | `src/db/` | `tables.ts` is the **registry** of every table; `schema.ts` builds Dexie from it; `repo.ts` is the only writer; `backup.ts` exports/restores from the registry. |
| Derive | `src/derive/` | **Pure functions** of a snapshot. `resolve.ts` turns a stored game into a `ResolvedGame` (park, duration, sport, organization, flags…); `trips.ts` groups by `(date, park)`; `time.ts`, `money.ts`, `metrics.ts`, `tax.ts`, `anomalies.ts` aggregate. |
| App state | `src/ui/store.tsx` | Loads the snapshot, owns filter/view/drill/focus/theme, and runs `derive(snapshot, filter)` in one memo. |
| Views | `src/ui/views/`, `ui/components/`, `ui/charts/` | Read `useStore().derived`; write through `db/repo` then `reload()`. |

Dependencies point down this table. Known exceptions are listed under
[Design assessment](#design-assessment).

## State: who owns what

| State | Owner | Notes |
|---|---|---|
| Games, imports, reference, annotations | IndexedDB, via `db/repo.ts` | Facts are written by import only; reference and annotations by the user only. |
| Loaded snapshot | `StoreProvider` (`ui/store.tsx`) | Replaced wholesale by `reload()` after every write. |
| Filter, view, drill-down, pending focus | `StoreProvider` | `setFilter` clears a drill-down; `navigate()` sets `pendingFocus` for the destination view to consume. `Reference` clears a tab request itself unless the tab's editor consumes a row focus (Parks, Durations). |
| Navigation groups, the Reference tab, each group's last page | `Shell` (`ui/App.tsx`) | `GROUPS` maps every `ViewId` to Insights, Data or Reference. The second nav row (`components/SubNav.tsx`) shows the group's pages, or Reference's tabs; `Reference` is controlled by the shell. |
| Theme | `StoreProvider` + `localStorage` | Not in IndexedDB, so not in backups. |
| Everything computed | `derive()` → `DerivedState` | Recomputed on any snapshot or filter change. Includes `trackedSports`, `hiddenSports`, and `taxResolved`/`taxTrips` (every game, for Tax only). |
| Form drafts, import stage machine | Component state | `TripDetail` rebuilds its whole annotation on save — see the trap below. |

## Data model

Tables are declared once, in `db/tables.ts`, each with a schema version (`since`), Dexie
indexes, a zod row schema for backups, a merge rule, and optional seed rows. `schema.ts`
derives the Dexie versions from it; backup, restore and the snapshot all read it. The
registry test fails if a Dexie table is missing from it.

| Table (since) | Holds | Key |
|---|---|---|
| `games` (1) | Facts: one row per game, with `source.rawRow` verbatim | `id`; unique `source.dedupeKey` |
| `imports` (1) | One row per import run: counts, undo data, chosen `organizationId` | `id` |
| `parks`, `durations`, `sports`, `gearLevels`, `identity`, `settings`, `customProfiles` (1) | Reference | various |
| `gameAnnotations`, `tripAnnotations` (1) | Annotations | `dedupeKey`; `${date}\|${parkId}` |
| `gearModifiers` (2), `callTypes` (3) | Reference | `id` |
| `generalExpenses` (4) | Expenses tied to no trip | `id` |
| `gearProducts`, `gearItems`, `gearSets` (5) | Gear catalog, owned pieces, kits | `id` |
| `organizations` (6) | Who hired/paid; names and aliases | `id` |
| `vehicles` (7) | Vehicles; the default is `settings.defaultVehicleId` | `id` |

Annotations are keyed by stable identity, never by row index, so re-importing a
corrected export keeps every manual figure attached. Seeds: written to an empty table,
refilled after a restore leaves one empty, and — for tables marked `seedMissing`
(sports) — topped up with missing keys on every start.

### Resolution rules worth knowing

- **Organization** of a game: set by hand → the game's **payor** equals an organization's
  name or alias → the import's organization. Never inferred from assignor or league.
- **Vehicle** of a trip: set on the trip → `settings.defaultVehicleId` → none.
- **Sport** of a game: hand tag (`sportCodeOverride`) → source code. Games in an
  **untracked** sport are dropped from every dashboard view but kept in `taxResolved`.
- **Money:** `gross` is everything received (cancellation pay included); `grossWorked`
  is what every rate divides. A file with no fee column marks `fees.notInSource`, which
  silences fee anomalies.

## Extension recipes

Each lists every place the change touches; skipping one has bitten before.

**A new table**
1. Add the type in `model/`, and an entry to `TABLES` in `db/tables.ts` with `since` = the
   next version (versions must stay contiguous; a test checks).
2. Add the typed field to `AppDatabase` (`db/schema.ts`) and `AppSnapshot` (`db/repo.ts`).
3. Add `save*` / `patch*` / `delete*` to `db/repo.ts`. Use `patchRow` for inline edits.
4. Add the new field to every hand-built `AppSnapshot` in tests:
   `src/derive/{tax-filter,general-expenses,organizations,vehicles,tracked-sports}.test.ts`,
   and check `test/private/` (`grep -rl "customProfiles: \[\]" src test`).
5. Backups need nothing more; add a round-trip test in `db/db.test.ts`.

**A new annotation field** (game or trip)
1. The field in `model/annotation.ts`.
2. The emptiness check in `saveGameAnnotation` / `saveTripAnnotation` — or an annotation
   holding only that field is deleted on save.
3. For trips: `mergeTripAnnotations` (park merges), and **`TripDetail`'s form state and
   `save()` in `views/Trips.tsx`**, which rebuild the whole annotation and drop any field
   they do not hold.

**A new import format**: a profile in `import/profiles/` (see `types.ts`; `reftown.ts` is the
fullest example), listed in `BUILT_IN_PROFILES`. Set `fileTypes`, `exportSteps`, and
`defaultStatus` if the format has no status column. Detection ignores official columns.

**A list of editable records** (parks, vehicles): a grid of cards rather than a table, so it
fits a phone; `reference/ParkCard.tsx` is the example. Values are text until the card's
Edit button unlocks it, destructive actions show only while unlocked, and fields commit on
blur through a `patch*` function.

**Filtering a list**: `components/FilterWindow.tsx`. Build a `FilterCategory[]` (id, label,
options), keep a `FilterSelection` in component state, and filter with `matchesSelection`,
passing a function that returns an item's values for a category id. Parks is the example.
(The dashboard's period and sport filter is separate: `FilterBar`, held in the store.)

**A new Profile section**: a component in `ui/views/profile/` (Vehicles is the example),
rendered from `views/Profile.tsx`. For what is the user's own rather than the games'.

**A new Reference tab**: a component in `ui/views/reference/`, added to `ReferenceTab` and
`REFERENCE_TABS` in `views/Reference.tsx`; the shell draws the tab row from that list. If a flag's fix button should open it, also widen `FixTarget`
(`ui/flags.ts`) and `PendingFocus` (`ui/store.tsx`).

**A new view**: the id in `ViewId` (`ui/store.tsx`), a render line in `ui/App.tsx`, and a
page in one of the `GROUPS` there (Insights, Data, Reference) with `filtered` set to whether
the filter bar applies; `divider` starts a new section of the group's row. A view opened
some other way (the Profile, from the header avatar) belongs to no group, shows no second
row, and falls back to unfiltered. The nav labels are also listed in `go()` in
`test/private/e2e.mjs`.

**A new data-quality flag**: the code in `DataQualityFlagCode` (`model/game.ts`) and its copy
in `FLAG_INFO` (`ui/flags.ts`); `flags.test.ts` fails until both exist.

**A new chart**: a form in `ui/charts/Charts.tsx` built on `ChartFrame` (title, table view,
legend rules). Colors come from `palette.ts`; sports use `sportSlot(code, trackedCodes)`.

**Anything listing sports**: use `derived.trackedSports`, not `snapshot.sports`.

## Traps learned the hard way

- **Whole-row saves race.** Two inline edits committed before `reload()` finishes would
  each save the row as rendered, and the second undoes the first. Inline editors patch
  (`patchRow` in `repo.ts`: gear items/products, organizations, vehicles, parks).
  `saveSports` and the trip form still save whole rows.
- **Forms that rebuild a record** (`TripDetail.save`) must hold every field they own.
- **Never count income out of Tax.** Tax uses `taxResolved`/`taxTrips` so tracked-sport
  filtering cannot hide income a 1099 reports.
- **Privacy.** Real names and figures live only in the private `data/` and `test/private/`
  submodules. `scripts/denylist.test.ts` fails if a denylisted string appears in the
  public tree; use invented names in code and tests.

## Testing

| What | Where | Needs |
|---|---|---|
| Unit and integration (`npm test`) | `src/**/*.test.ts`, `scripts/*.test.ts` | nothing; fake-indexeddb for db tests |
| Public sample fixtures | `test/sample/` (SODaVis-SampleData) | the public submodule |
| Real-data suites | `test/private/*.test.ts` (SODaVis-Tests) | `data/` and `test/private/`; skip without them |
| End-to-end, in Chrome | `node test/private/e2e.mjs <url>` | a running dev server and `data/`; restores `data/reference.local.json` first |

As of 2026-10-01: 459 tests; a clone without the private submodules runs 298.

## Design assessment

The codebase is functional TypeScript and React, not object-oriented: there are three
classes (`AppDatabase extends Dexie`, and two `Error` subclasses). SOLID applies at the
level of modules and data flow rather than class hierarchies.

**What holds up well**
- *Single responsibility, at the layer level:* facts, reference, annotations and derived
  values are separate types, tables and code paths; import never writes, derive never
  writes.
- *Open/closed through registries:* a table is one `TABLES` entry; an import format is one
  profile; a flag is one `FLAG_INFO` entry; tests enforce each registry's completeness.
- *Pure derive layer:* `derive(snapshot, filter)` is a function of its inputs, which is why
  most behavior is testable without a browser.

**Debts** — candidates for the refactoring goal, roughly by payoff
1. **Large view files mix rendering, sub-components and writes:** `Trips.tsx` (~1,040
   lines), `Import.tsx`, `DataQuality.tsx`, `Gear.tsx`, `Overview.tsx`, and `Charts.tsx`.
   Splitting them by sub-component (as `Reference.tsx` was split) cuts the cost of any
   targeted change.
2. **Views write to the database directly** and each repeats a `run → write → reload →
   error` helper (Gear, Organizations, Vehicles). A small shared hook or action
   layer would remove the duplication and give views one way to write (dependency
   inversion).
3. **`DerivedState` is a wide object** every view takes whole, and `derive()` recomputes all of
   it on any change (interface segregation; performance headroom if data grows).
4. **Misplaced utilities:** time helpers (`timeToMinutes`, `minutesBetween`) live in
   `import/transforms.ts`, so `derive/` depends on `import/`; `db/` depends on
   `import/profiles` to rehydrate custom profiles. Both invert the intended direction.
5. **Whole-row saves remain** for sports and the trip form (see Traps).
6. **`db/repo.ts` is a grab bag** of every entity's writes (~750 lines); splitting it by
   aggregate would match how views use it.
7. **Editors hand-build their tables** with repeated header styles, while `DataTable`
   exists in `ui/charts/ChartFrame.tsx`.
