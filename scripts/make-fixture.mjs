/**
 * Generates test/fixtures/games-sample.csv — an anonymized stand-in for a real
 * Assignr export.
 *
 * The real export lives in data/ and is gitignored: it carries income, partner
 * names, and venue history. This fixture reproduces every *structural* property
 * the import and derive layers care about, with invented venues, partners, and
 * leagues, so the suite runs on any clone.
 *
 * Structural properties preserved (each one a real edge case from the export):
 *   - 28-column Assignr header, including the always-empty columns
 *   - ragged rows: 26 fields for solo games, 28 when a partner is listed
 *   - a trailing TOTALS: row with 24 fields
 *   - a blank-date row
 *   - self appearing in BOTH official slots, with a rotating (F25)/(S26) suffix
 *   - cancellations at $0 actual against a non-zero scheduled fee
 *   - upward fee adjustments, including the 1.5x single-umpire premium
 *   - duration embedded in Age Group for some groups and absent for others
 *   - venue strings that normalize to one park, including a trailing-period twin
 *   - a multi-park day, and a day with a single park visited twice
 *   - two assignors, one of which leaves the sport code blank
 *   - a Notes field using the ':::' separator
 *   - one of each fee anomaly: an active game at $0, a cancellation that paid,
 *     and a game with no scheduled fee
 *
 * Run: node scripts/make-fixture.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const OUT = resolve(process.cwd(), 'test/sample/games-sample.csv')

const HEADER = [
  'Game ID', 'Date', 'Start Time', 'Venue', 'Sub-Venue', 'Age Group', 'Status',
  'Published', 'Zone', 'League', 'Gender', 'Game Type', 'Home Team', 'Away Team',
  'Pattern', 'Payor', 'Paid Via', 'Assignor', 'Notes', 'Assignor Notes',
  'Assignr Database ID', 'Default Fee', 'Actual Fee', 'Travel Fee',
  'Position 1', 'Official 1', 'Position 2', 'Official 2',
]

const SELF_F = 'Rivera (F25), Sam'
const SELF_S = 'Rivera (S26), Sam'
const PAYOR = 'Example Officials LLC'
const PAID_VIA = 'Check or Direct Deposit'
const ASSIGNOR = 'Alex Assignor'
const ASSIGNOR_2 = 'Dana Scheduler'

let nextId = 90000001

/** Build one row. Omits the Position 2 / Official 2 pair when partner is null. */
function game({
  date, time, venue, ageGroup, league, sport, gameType,
  pattern = '2 umpires', scheduled, actual, self = SELF_F, partner,
  status = 'Active', assignor = ASSIGNOR, notes = '',
}) {
  const row = [
    '', date, time, venue, '', ageGroup, status, 'Published', '', league,
    sport, gameType, 'Home', 'Away', pattern, PAYOR, PAID_VIA, assignor,
    notes, '', String(nextId++), scheduled, actual, '$0.00',
    'Umpire', self,
  ]
  if (partner != null) row.push('Umpire', partner)
  return row
}

const rows = []

// --- Baseball at one park, self in slot 1, a straightforward pair -----------
// Duration is embedded in the age group ("90min"); two games, one trip.
rows.push(game({
  date: '2025-08-27', time: '6:00 PM', venue: 'Northside Complex (Field 3)',
  ageGroup: 'RVL / 9-10U DIV A / 90min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', scheduled: '$45.00', actual: '$45.00',
  partner: 'Boyd, Marcus', notes: 'https://example.org/rvl-rules',
}))
rows.push(game({
  date: '2025-08-27', time: '7:30 PM', venue: 'Northside Complex (Field 3)',
  ageGroup: 'RVL / 9-10U DIV A / 90min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', scheduled: '$45.00', actual: '$45.00',
  partner: 'Boyd, Marcus', notes: 'https://example.org/rvl-rules',
}))

// --- Self in slot 2 --------------------------------------------------------
// The real export puts self in Official 2 about half the time; partner
// derivation must not assume slot 1.
rows.push(game({
  date: '2025-09-02', time: '7:00 PM', venue: 'Eastfield Park Field 1',
  ageGroup: 'Adult-SP-Thursday-Open', league: 'Eastfield Parks & Rec',
  sport: 'C-SP', gameType: 'Adult Slow Pitch Softball',
  scheduled: '$25.00', actual: '$25.00',
  self: 'Chen, Wei', partner: SELF_F,
}))
rows.push(game({
  date: '2025-09-02', time: '8:00 PM', venue: 'Eastfield Park Field 1',
  ageGroup: 'Adult-SP-Thursday-Open', league: 'Eastfield Parks & Rec',
  sport: 'C-SP', gameType: 'Championship Game',
  scheduled: '$25.00', actual: '$30.00',           // upward adjustment
  self: 'Chen, Wei', partner: SELF_F,
}))

// --- Solo games: 26-field rows (no Position 2 / Official 2) ----------------
// Age group carries no duration, so these exercise the manual-duration path.
rows.push(game({
  date: '2025-09-27', time: '1:30 PM', venue: 'Lakeview Park: Red Field',
  ageGroup: 'Adult Kickball League', league: 'Lakeview Kickball Association',
  sport: 'C-KB', gameType: 'Adult Kickball', pattern: '1 umpire',
  scheduled: '$50.00', actual: '$50.00', partner: null,
  notes: 'https://example.org/kickball :::Extra Innings= R2, 1 out.',
}))
rows.push(game({
  date: '2025-09-27', time: '3:00 PM', venue: 'Lakeview Park: Blue Field',
  ageGroup: 'Adult Kickball League', league: 'Lakeview Kickball Association',
  sport: 'C-KB', gameType: 'Adult Kickball', pattern: '1 umpire',
  scheduled: '$50.00', actual: '$50.00', partner: null,
}))

// --- "2 umpires" pattern, no partner, paid 1.5x ---------------------------
// Not a data error: the note says why. Worked alone at a premium.
rows.push(game({
  date: '2025-10-29', time: '5:30 PM', venue: 'Summit Fields-Field 6',
  ageGroup: 'SUM-9U-Premier (90 min)', league: 'Summit Baseball Club',
  sport: 'C-BB', gameType: 'Makeup', pattern: '2 umpires',
  scheduled: '$45.00', actual: '$68.00', partner: null,
  notes: 'https://example.org/summit Single umpire fee 1.5',
}))

// --- Cancellations: scheduled fee, $0 actual ------------------------------
rows.push(game({
  date: '2026-04-02', time: '6:00 PM', venue: 'Northside Complex (Field 5)',
  ageGroup: 'RVL / 5-6U / MOD / CP / 75min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', pattern: '1 umpire',
  scheduled: '$40.00', actual: '$0.00', status: 'Cancelled - No Pay',
  partner: null,
}))
rows.push(game({
  date: '2026-04-02', time: '7:15 PM', venue: 'Northside Complex (Field 5)',
  ageGroup: 'RVL / 7-8U DIV AA / CP / 90min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$0.00', status: 'Cancelled - No Pay',
  partner: null,
}))

// --- Venue twins: trailing period must resolve to the same park -----------
rows.push(game({
  date: '2026-05-11', time: '6:00 PM', venue: 'Westgate Athletic Park',
  ageGroup: 'RVL / 7-8U DIV A / CP / 90min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$45.00', partner: null,
}))
rows.push(game({
  date: '2026-05-12', time: '6:00 PM', venue: 'Westgate Athletic Park.',
  ageGroup: 'RVL / 7-8U DIV A / CP / 90min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$45.00', partner: null,
}))

// --- Multi-park day: two parks, same date (mileage needs review) ----------
rows.push(game({
  date: '2026-06-13', time: '9:00 AM', venue: 'Northside Complex (Field 3)',
  ageGroup: 'RVL / 11-12U DIV A / 100min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'Pool Play', scheduled: '$50.00', actual: '$50.00',
  self: SELF_S, partner: 'Okafor, Nia',       // rotated suffix on self
}))
rows.push(game({
  date: '2026-06-13', time: '2:00 PM', venue: 'Eastfield Park Field 2',
  ageGroup: 'Adult-SP-Thursday-Open', league: 'Eastfield Parks & Rec',
  sport: 'C-SP', gameType: 'Bracket Play', scheduled: '$25.00', actual: '$25.00',
  self: SELF_S, partner: 'Okafor, Nia',
}))

// --- Second assignor, blank sport code -----------------------------------
// Mirrors the real export, where the secondary assignor's rows omit the code.
rows.push(game({
  date: '2026-05-08', time: '6:00 PM', venue: 'Hilltop-2',
  ageGroup: 'HIL-9u/10u', league: 'Hilltop Select',
  sport: '', gameType: 'Regular Season', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$45.00', partner: null,
  assignor: ASSIGNOR_2,
}))
rows.push(game({
  date: '2026-05-08', time: '7:45 PM', venue: 'Hilltop-2',
  ageGroup: 'HIL-9u/10u', league: 'Hilltop Select',
  sport: '', gameType: 'Regular Season', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$45.00', partner: null,
  assignor: ASSIGNOR_2,
}))

// --- Fastpitch, repeat partner (gives one clear "most common partner") ----
// Eight games with the same partner, so the runner-up is far behind. The partner
// breakdown and every rank-ordered chart depend on a clear leader, and a suite that
// asserts "dominant" needs the gap to be unambiguous.
for (const [date, time] of [
  ['2026-09-12', '9:00 AM'], ['2026-09-12', '10:15 AM'],
  ['2026-09-17', '6:00 PM'], ['2026-09-17', '7:30 PM'],
  ['2026-09-24', '6:00 PM'], ['2026-09-24', '7:30 PM'],
  ['2026-10-01', '6:00 PM'], ['2026-10-01', '7:30 PM'],
]) {
  rows.push(game({
    date, time, venue: 'Cedar Ridge Softball / Field A',
    ageGroup: 'CRS-Softball-10U-Modified Kid Pitch (65 min)',
    league: 'Cedar Ridge Softball Association',
    sport: 'C-FP', gameType: 'Fastpitch Softball',
    scheduled: '$45.00', actual: '$45.00',
    self: SELF_S, partner: 'Boyd, Marcus',
  }))
}

// --- A park reached only by a cancellation -------------------------------
// It resolves to a park, but forms no trip: the trip layer must place it among the
// cancelled games and leave it out of the mileage, which is a distinct case from a
// park that simply has no games.
rows.push(game({
  date: '2026-04-18', time: '10:00 AM', venue: 'Brookside Fields (Field 2)',
  ageGroup: 'RVL / 9-10U DIV A / 90min', league: 'Riverview Little League',
  sport: 'C-BB', gameType: 'RVL Baseball', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$0.00', status: 'Cancelled - No Pay',
  partner: null,
}))

// --- Fee anomalies: one of each kind the app raises -----------------------
// The real export happens to carry none, so without these the anomaly panel has
// nothing to show end to end. Each is plausible rather than an error, which is the
// case acknowledgement exists for.

// An active game paying nothing: an unpaid preseason scrimmage. Scheduled at $0
// too, so it is an anomaly without also being a variance.
rows.push(game({
  date: '2025-10-11', time: '10:00 AM', venue: 'Summit Fields-Field 4',
  ageGroup: 'SUM-9U-Premier (90 min)', league: 'Summit Baseball Club',
  sport: 'C-BB', gameType: 'Scrimmage',
  scheduled: '$0.00', actual: '$0.00', partner: 'Chen, Wei',
  notes: 'Preseason scrimmage, unpaid',
}))
// A cancellation that paid: a rainout at half rate.
rows.push(game({
  date: '2026-05-20', time: '6:00 PM', venue: 'Cedar Ridge Softball / Field B',
  ageGroup: 'CRS-Softball-10U-Modified Kid Pitch (65 min)',
  league: 'Cedar Ridge Softball Association',
  sport: 'C-FP', gameType: 'Fastpitch Softball', pattern: '1 umpire',
  scheduled: '$45.00', actual: '$22.50', status: 'Cancelled - Paid',
  partner: null, notes: 'Rained out after one inning; half fee',
}))
// No scheduled fee: a tournament add-on whose rate was set after the game.
rows.push(game({
  date: '2026-07-18', time: '9:00 AM', venue: 'Lakeview Park: Red Field',
  ageGroup: 'Adult Kickball League', league: 'Lakeview Kickball Association',
  sport: 'C-KB', gameType: 'Tournament', pattern: '1 umpire',
  scheduled: '', actual: '$50.00', partner: null,
}))

// --- Trailing junk rows the parser must drop -----------------------------
// A blank-date row, then the 24-field TOTALS: line the real export appends.
rows.push(Array(28).fill(''))

const money = (cents) =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
const sum = (idx) =>
  rows.reduce((acc, r) => {
    const v = r[idx]
    if (!v || !v.startsWith('$')) return acc
    return acc + Math.round(parseFloat(v.replace(/[$,]/g, '')) * 100)
  }, 0)

const totals = Array(24).fill('')
totals[20] = 'TOTALS:'
totals[21] = money(sum(21))
totals[22] = money(sum(22))
totals[23] = '$0.00'
rows.push(totals)

/** RFC 4180: quote a field only when it contains a comma, quote, or newline. */
function csvField(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = [HEADER, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n'

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, csv, 'utf8')

const dataRows = rows.filter((r) => r[1]).length
console.log(`wrote ${OUT}`)
console.log(`  ${dataRows} games + 1 blank row + 1 TOTALS row`)
console.log(`  scheduled ${totals[21]} / actual ${totals[22]}`)
