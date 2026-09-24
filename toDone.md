# Done

Completed items moved out of `toDo.md`, newest first. Kept rather than deleted
because several record *why* a thing is the way it is — the reasoning is easy to
lose and expensive to rediscover.

## Quick wins

- **"Net variance" showed no sign.** `netFeeVariance` is `scheduled - gross`, so it
  is *positive* when money was lost — printing it with a naive `+` would have
  inverted the meaning. Negated at the display boundary instead, so a shortfall
  reads `−the net gap` and a surplus `+the net gap`, with the detail line naming the direction.

- **Alternating row contrast.** One `table tbody > tr:nth-child(even)` rule with a
  new `--surface-stripe` token per mode, rather than a rule per table — the tables
  are hand-built across several views and would have drifted. Even rows, so the
  first row sits on the plain surface; a row with its own background still wins.

- **"Last 12 months" preset**, alongside "Year to date".

- **Weekday vs Weekend split** now shows time above the bar and money below against
  one geometry, with 18px value labels. The comparison it exists to make is
  immediately legible: when weekday work takes a larger share of the time than of
  the money, the weekend pays better per hour. The time follows the
  global model selector rather than carrying its own, so the panel cannot disagree
  with the rate tiles about what an hour means.

- **Long league names abbreviated.** A y-axis band fits about 20 characters and
  some run to more than twice that. `abbreviateLabel` drops the words every league shares
  ("Baseball Softball Association" separates nothing when they all have it), then
  initialises what is left — which tends to land on the same abbreviation the source
  data already uses in its venue strings. Collisions fall back to full names for
  every member of the clash. The full name stays in the tooltip and the table.

- **Games by day of week.** One hue, more-is-taller, all seven days always shown —
  a day never worked is a finding, and an absent row would hide it.

- **Trips date tooltip** now names the weekday, parsed as UTC so the day never
  shifts with the viewer's timezone.

## Data resolution

- **A fee anomaly can be accepted rather than only reported.** The app raises an
  anomaly where money and status disagree — an active game paying nothing, a
  cancellation that paid anyway — but had no way to say "checked, that one is
  correct", so a known-good oddity was reported forever.

  Accepting one changes no figure and removes no row: it records that the oddity was
  examined, with room to say why, and the group then shows a green "all reviewed"
  chip instead of a warning count. The row stays listed deliberately — an accepted
  oddity that vanished could not be told from one nobody had looked at. Acknowledged
  per game *and* per code, since accepting that a cancellation legitimately paid says
  nothing about whether its missing scheduled fee is also fine.

  Keyed by `dedupeKey`, so the re-import that re-raises the same odd row does not
  reopen a settled question — asserted directly, since that is the event the
  acknowledgement exists to survive.


- **Age-group strings decomposed into their parts.** Every league writes its own, so
  the same competition appeared as `CFB / 9-10U DIV A / 90min`,
  `LBSA-DFW Interlock-10U (90 min)` and `MBSA-Softball-10U-Modified Kid Pitch`.
  Treating the whole string as the unit meant dozens of "age groups" for maybe a dozen real
  ones, a duration entered once per league rather than once per competition, and an
  "Age groups seen" figure that overcounted by construction.

  `parseAgeGroup` pulls out the age band, rule set, division, pitch style,
  tournament stage and adult cohort; `durationKey` then keys a duration at the
  broadest scope that is still honest — rule set plus band (`USSSA · 10U`) where a
  rule set is stated, league plus band otherwise, the raw string as a last resort so
  a figure is always recordable. Every string parses, the competitions number well
  below the strings, and the unfilled strings collapse into **far fewer figures to
  enter**. One rule-set entry can cover several league spellings of the same competition.

  Pitch style and tournament stage are part of the key because both change the clock:
  a tournament can run the same age band for a shorter clock in pool play than in
  bracket play, and merging those would have averaged a real difference away. Division
  is parsed but deliberately left out — two divisions of one league keep the same time.

  Nothing is migrated. A duration entered before the decomposition is keyed by raw
  string and still answers, reported as `reference-raw` so the UI can say it is
  narrower than it looks; a scoped figure simply answers first.

## Data visualization

- **"Weekday vs Weekend" split into one bar per measure.** Time and money do not
  share proportions, and the previous version drew a single bar from the money split
  while labelling it with both — putting the time share above a segment sized by the money share.
  The figures disagreed with the geometry, and the geometry is what a reader trusts.
  Each measure now has its own bar, so the finding is a difference in *length*:
  weekday work is visibly longer on time than on income.

  The share sits inside its segment in bold, since that is what the bar is for, with
  the unit value outside aligned to the same segment. Dark ink inside every segment
  rather than white: white fails contrast on the light-mode orange (3.2:1 against
  the 4.5 small text needs) while dark clears it on all four series steps in both
  modes, and one colour is steadier than switching per segment. A segment under 8%
  hides its share rather than clipping it mid-digit — the outside value and the
  table view still carry it.

- **"Scheduled vs actual fee" can include games paid as scheduled.** Split into two
  functions rather than one with a flag: `feeVariances` keeps only the games whose
  fee moved, and the diverging chart still uses it, because a bar of zero is not a
  variance and a wall of them would drown the few that are. `feeReconciliation` returns
  every game, and the table can switch to it — where the question is "does this add
  up", a total cannot be checked against a list that omits most rows. The subtitle
  then states the total and names it as the Overview's gross figure (the export total). An
  unchanged row shows an em dash rather than `$0`, which would read as data to scan
  rather than as the absence of a gap.

- **"Income by month" measure toggle** — income, hours worked, game minutes, days
  worked, or games. Every one was already a field on `MonthPoint` except days
  worked, which needed a distinct-date set so a seven-game Saturday counts once. The
  title and axis follow the measure, because a column chart of hours still labelled
  Income is worse than no toggle. Choosing a non-income measure drops the
  by-sport split: stacking hours by sport is legible but answers a question nobody
  asked.

- **"Rate per hour by month" basis toggle** — per hour, per game, or per game hour.
  The three give genuinely different readings, the per-game-hour figure being the
  highest because it counts only time on the field. Per
  game needs no duration, so it can show a figure for a month the other two leave
  blank — and the untimed-trips caveat is suppressed on that basis, since it is not
  true there.

- **Edited values marked in table cells.** The trips table already suffixed a
  derived drive time with `est.`; that pattern now covers miles, tolls and drive
  time, with `yours` for a manual override and `rush` where a leg used the park's
  rush figure. Only non-obvious provenance is marked — a figure straight from
  reference data is the expected case and says nothing. An asterisk was the original
  idea but would have needed a legend; a word does not.

- **"Weekday vs Weekend" values aligned to their bar sections.** Each value box is
  set to the width of the segment it describes and centred over it, sharing the
  bar's 2px surface gap, so a figure sits above its own section rather than in a
  left-aligned row the reader pairs up by order. Both rows follow the *bar's*
  proportions, since what a label annotates is a section of the bar.

## Data errors

- **Date filter jumped to 1900 or 2999 once one bound was set.** Setting one end
  filled the other with a sentinel (`1900-01-01` / `2999-12-31`) standing in for
  "open-ended", and a date input renders its value literally — so the other picker
  scrolled three centuries away. An open bound is now `null`, the filter type allows
  either end to be null independently, and the matcher skips a null bound rather
  than comparing against a fabricated date. `min`/`max` on each picker prevent an
  inverted range. A "Year to date" preset was added at the same time.

- **Graphs and tables did not reflect a custom time range.** Same root cause as
  above: one bound set meant a range spanning 1900–2999, which excluded nothing, so
  every view looked unfiltered. Now a single month reads only that month's income and
  games against the unfiltered export total, and a half-open "up to" range reads
  everything before its end date.

- **`scripts/e2e.mjs` "the tagged game leaves the unspecified bucket" read the
  untouched total.** The check picked the first untagged row, which is a `cancelled-nopay` game
  at $0 — tagging it moves no money, so the bucket never budged and a correct app
  looked broken. The selector now targets an active row explicitly, keeping the
  check meaningful: it proves tagging *relabels* income rather than losing it. The
  expected figure was kept, not relaxed. The `aria-label` gained the start time,
  since two games at one venue on one date is the norm and several controls
  otherwise shared a name — which a screen reader could not separate either.

## Data adjustments

- **Manual entry for game durations.** Two routes: in bulk by age group in
  *Reference data → Game durations*, and per game in the trip editor for the one
  game that did not match its group — a tournament game in a rec-league bracket, or
  one cut short. The per-game figure takes precedence, and clearing it returns the
  game to the group's figure.

- **A field-role field per game.** Landed as the larger position/gear split: the
  position worked (plate or bases) is recorded per game, independent of what was
  worn. See below.

## Data resolution

- **Position and gear are separate axes.** A single gear ladder conflated two facts
  that do not track each other: a base umpire wears full gear in some two-umpire
  baseball and none at all in kickball, slowpitch, coach pitch or a solo game. The
  position now costs nothing by itself — walking to the plate takes as long as
  walking to first — and the gear carries the prep figures (full gear, shield,
  dressed down, cold, rain), which stack. Full gear is assumed at the plate but the
  tick can be cleared, and no sport seeds a default position, because in a
  two-umpire game it is plate or bases roughly half the time and the export does
  not say which.

- **A cancelled game can carry the drive it cost.** Trips are keyed
  `(date, parkId)`, so a cancelled game formed no trip and therefore had no key for
  an annotation — its mileage was not merely unrecorded but unrecordable. Most of a
  real season's cancellations fall on a date with no active game, forming would-be
  trips and the unrecorded mileage nothing else accounted for. A cancelled game
  now joins a trip when, and only when, the drive is confirmed: mileage and tolls
  count and reach the tax view, while income and game time stay at zero.
  `droveToCancelled` is tri-state, because "I did not drive" is an answer and
  `undefined` is not.

- **The drive out is not the drive home.** Drive time doubled a single one-way
  figure, which assumes the legs are symmetrical. A 6pm game drives out through rush
  hour and home on empty roads; a Saturday afternoon game does the reverse. Each
  park now carries an ideal and a rush figure, and each leg is judged on its own
  clock — the outbound by the first pitch, the return by the last out. The window is
  editable in *Reference data → Settings*, which also reports how many trips each
  direction affects.

## Infrastructure

- **User data is out of version control.** `data/`, `*.csv`, `*.ods` and
  `screenshots/` are gitignored: an export carries income, partner names and venue
  history, and the old workbook's toll sheet carried a transponder account number
  and a licence plate. An anonymized 19-game fixture is committed in their place,
  reproducing every structural edge case, so the pipeline is testable on a clone
  with no access to the real file. Suites asserting real-world totals skip when
  `data/` is absent rather than reporting false passes.
