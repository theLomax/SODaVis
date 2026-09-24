/**
 * Aggregations by venue, partner, league, assignor, sport, month and weekday.
 *
 * Every breakdown reports income, games, time and rate against the selected
 * time model, so the same slice reads consistently everywhere.
 *
 * Trip-scoped quantities (miles, tolls, drive time) attach to the park
 * breakdown, where they are meaningful, and are deliberately absent from
 * partner/league breakdowns, where splitting a shared drive across dimensions
 * would double-count it.
 */

import { isCancelled, type Game } from '../model/game'
import type { Settings, TimeModelId } from '../model/reference'
import type { TripAnnotation } from '../model/annotation'
import type { ResolvedGame } from './resolve'
import type { Trip } from './trips'
import { tripTime, type TimeContext } from './time'
import { sportRank, UNSPECIFIED_SPORT } from '../model/reference'
import { round2, sumExpenses } from './money'

export type Period = { start: string; end: string; label: string }

export function calendarYear(year: number): Period {
  return { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) }
}

export function inPeriod(date: string, period: Period | null): boolean {
  if (!period) return true
  return date >= period.start && date <= period.end
}

export function yearsPresent(games: Game[]): number[] {
  return [...new Set(games.map((g) => Number(g.date.slice(0, 4))))]
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => b - a)
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export type Breakdown = {
  key: string
  label: string
  games: number
  gross: number
  /** Minutes under the selected model, over the games whose time is known. */
  minutes: number
  /**
   * Income per hour across the games counted in `minutes` only. `null` when none
   * of the group's games has a resolvable time, so a partial denominator can
   * never inflate the rate.
   */
  perHour: number | null
  perGame: number | null
  /** Populated only for park breakdowns. */
  trips?: number
  /** Round-trip miles across this park's trips. `null` when none has a figure. */
  miles?: number | null
  /** Trips at this park with no mileage on record, so `miles` understates. */
  tripsMissingMiles?: number
  tolls?: number
  /** Games in this group whose duration is unknown, so minutes understates. */
  incompleteGames: number
}

type Accumulator = {
  label: string
  games: number
  gross: number
  minutes: number
  /** Income from the games counted in `minutes`, so the rate divides like with like. */
  timedGross: number
  incompleteGames: number
  trips: Set<string>
  miles: number
  tripsMissingMiles: number
  tolls: number
}

function emptyAcc(label: string): Accumulator {
  return {
    label,
    games: 0,
    gross: 0,
    minutes: 0,
    timedGross: 0,
    incompleteGames: 0,
    trips: new Set(),
    miles: 0,
    tripsMissingMiles: 0,
    tolls: 0,
  }
}

/**
 * Per-game share of a trip's time under the selected model. The models differ in
 * what they include per *trip*, so a trip-level quantity (drive, prep, wrap, the
 * on-site gap) is divided evenly across the trip's games. Game duration itself
 * is never divided.
 *
 * Returns `null` for a game whose time cannot be established, rather than 0.
 * Counting an unknown duration as zero would put that game's income over almost
 * no time and invent a rate — an early build reported an absurd hourly rate for a
 * month whose games had no duration on record.
 */
function perGameMinutes(trip: Trip, model: TimeModelId, ctx: TimeContext): Map<string, number | null> {
  const t = tripTime(trip, ctx)
  const out = new Map<string, number | null>()
  const n = trip.games.length || 1

  // Trip overhead is null when the model needs an input the trip does not have.
  let tripOverhead: number | null
  if (model === 'game') tripOverhead = 0
  else if (model === 'game-drive') tripOverhead = t.driveMinutes
  else {
    tripOverhead =
      t.driveMinutes == null || t.gapMinutes == null
        ? null
        : t.driveMinutes + t.prepMinutes + t.wrapMinutes + t.gapMinutes
  }

  for (const g of trip.games) {
    const duration = g.duration.minutes
    out.set(
      g.game.id,
      duration == null || tripOverhead == null ? null : duration + tripOverhead / n,
    )
  }
  return out
}

export type BreakdownContext = {
  trips: Trip[]
  timeCtx: TimeContext
  model: TimeModelId
  tripAnnotations: Map<string, TripAnnotation>
}

type KeyFn = (g: ResolvedGame, trip: Trip) => { key: string; label: string }[]

function buildBreakdown(ctx: BreakdownContext, keyOf: KeyFn, isParkScoped: boolean): Breakdown[] {
  const acc = new Map<string, Accumulator>()

  for (const trip of ctx.trips) {
    const minutesByGame = perGameMinutes(trip, ctx.model, ctx.timeCtx)
    const annotation = ctx.tripAnnotations.get(trip.key)
    const tripExpenses = annotation ? sumExpenses(annotation.expenses).total : 0

    for (const g of trip.games) {
      for (const { key, label } of keyOf(g, trip)) {
        const a = acc.get(key) ?? emptyAcc(label)
        const fee = g.game.fees.actual ?? 0
        const minutes = minutesByGame.get(g.game.id) ?? null
        a.games++
        a.gross += fee
        if (minutes == null) {
          // No time for this game, so it contributes income but not a rate.
          a.incompleteGames++
        } else {
          a.minutes += minutes
          a.timedGross += fee
        }
        if (isParkScoped && !a.trips.has(trip.key)) {
          a.trips.add(trip.key)
          if (trip.miles == null) a.tripsMissingMiles++
          else a.miles += trip.miles
          a.tolls += (trip.tolls ?? 0) + tripExpenses
        }
        acc.set(key, a)
      }
    }
  }

  return [...acc.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      games: a.games,
      gross: round2(a.gross),
      minutes: Math.round(a.minutes),
      // Rate over the games whose time is known — never total income over partial time.
      perHour: a.minutes > 0 ? round2((a.timedGross / a.minutes) * 60) : null,
      perGame: a.games > 0 ? round2(a.gross / a.games) : null,
      incompleteGames: a.incompleteGames,
      ...(isParkScoped
        ? {
            trips: a.trips.size,
            // Null, not zero, when nothing is known — a park with no mileage on
            // record has not been driven zero miles.
            miles: a.tripsMissingMiles === a.trips.size ? null : Math.round(a.miles * 10) / 10,
            tripsMissingMiles: a.tripsMissingMiles,
            tolls: round2(a.tolls),
          }
        : {}),
    }))
    .sort((x, y) => y.gross - x.gross || x.label.localeCompare(y.label))
}

export function byPark(ctx: BreakdownContext): Breakdown[] {
  return buildBreakdown(ctx, (_g, trip) => [{ key: trip.parkId, label: trip.parkName }], true)
}

/**
 * One row per partner. A game with two partners counts toward both, so the
 * games column sums above the game count - that is the intent of the view.
 * Solo games get their own row rather than being dropped.
 */
export function byPartner(ctx: BreakdownContext): Breakdown[] {
  return buildBreakdown(
    ctx,
    (g) =>
      g.partners.length === 0
        ? [{ key: '(solo)', label: 'Solo (no partner)' }]
        : g.partners.map((p) => ({ key: p.key, label: displayName(p.key) })),
    false,
  )
}

function displayName(key: string): string {
  const comma = key.indexOf(',')
  if (comma === -1) return key
  const last = key.slice(0, comma).trim()
  const first = key.slice(comma + 1).trim()
  return first ? `${first} ${last}` : last
}

export function byLeague(ctx: BreakdownContext): Breakdown[] {
  return buildBreakdown(ctx, (g) => {
    const label = g.game.league ?? 'Unknown league'
    return [{ key: label, label }]
  }, false)
}

export function byAssignor(ctx: BreakdownContext): Breakdown[] {
  return buildBreakdown(ctx, (g) => {
    const label = g.game.assignor ?? 'Unknown assignor'
    return [{ key: label, label }]
  }, false)
}

export function bySport(ctx: BreakdownContext, sportLabel: (code: string) => string): Breakdown[] {
  return buildBreakdown(ctx, (g) => {
    const code = g.sportCode ?? '(unknown)'
    return [{ key: code, label: code === '(unknown)' ? 'Unknown sport' : sportLabel(code) }]
  }, false)
}

export type CallCount = { key: string; label: string; games: number }

/**
 * How often each call type was tagged. Count only — a game's fee does not
 * belong to the Infield Fly — and a game with two tags counts toward both.
 * Known types with no tags stay in the list at zero, so a call never made is
 * visible the same way a day never worked is.
 */
export function byCall(
  ctx: BreakdownContext,
  types: { id: string; label: string }[],
): CallCount[] {
  const acc = new Map<string, CallCount>()
  for (const t of types) acc.set(t.id, { key: t.id, label: t.label, games: 0 })
  for (const trip of ctx.trips) {
    for (const g of trip.games) {
      for (const id of g.calls) {
        const row = acc.get(id) ?? { key: id, label: id, games: 0 }
        row.games++
        acc.set(id, row)
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.games - a.games || a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

export type MonthPoint = {
  /** 'YYYY-MM'. */
  month: string
  label: string
  gross: number
  games: number
  minutes: number
  /** Distinct dates worked. A 7-game Saturday is one day, not seven. */
  daysWorked: number
  /** Income per hour over the games whose time is known, else null. */
  perHour: number | null
  /** Games in the month with no resolvable time, excluded from `perHour`. */
  untimedGames: number
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  const idx = Number(m) - 1
  return `${MONTH_LABELS[idx] ?? m} ${String(y).slice(2)}`
}

/**
 * Income per month, split by sport.
 *
 * Returned alongside `byMonth` rather than replacing it: the totals series is
 * still what a single-sport view wants, and keeping both means the split can never
 * disagree with the total. `series` lists only the sports actually present, in the
 * fixed slot order, so a chart's colour assignment follows the sport and not its
 * position in the data.
 */
export type MonthBySport = {
  /** One row per month: `{ month, label, [sportCode]: gross, total }`. */
  rows: (Record<string, number> & { month: string; label: string; total: number })[]
  /** Sport codes present, in `SPORT_SLOT_ORDER`. */
  series: string[]
}

export function byMonthBySport(
  ctx: BreakdownContext,
  /** Restricts and orders the series; defaults to every sport present. */
  sportCodes?: string[],
): MonthBySport {
  const acc = new Map<string, Map<string, number>>()
  const present = new Set<string>()

  for (const trip of ctx.trips) {
    for (const g of trip.games) {
      const month = g.game.date.slice(0, 7)
      const code = g.sportCode ?? UNSPECIFIED_SPORT
      present.add(code)
      const bucket = acc.get(month) ?? new Map<string, number>()
      bucket.set(code, (bucket.get(code) ?? 0) + (g.game.fees.actual ?? 0))
      acc.set(month, bucket)
    }
  }

  const series = (sportCodes && sportCodes.length ? sportCodes : [...present])
    .filter((c) => present.has(c))
    .sort((a, b) => sportRank(a) - sportRank(b) || a.localeCompare(b))

  const rows = fillMonths([...acc.keys()]).map((month) => {
    const bucket = acc.get(month)
    const row = { month, label: monthLabel(month), total: 0 } as Record<string, number> & {
      month: string
      label: string
      total: number
    }
    for (const code of series) {
      const value = round2(bucket?.get(code) ?? 0)
      row[code] = value
      row.total = round2(row.total + value)
    }
    return row
  })

  return { rows, series }
}

/** Contiguous 'YYYY-MM' keys spanning the months present, gaps included. */
function fillMonths(monthsPresent: string[]): string[] {
  const months = [...monthsPresent].sort()
  if (months.length === 0) return []

  const filled: string[] = []
  const [startY, startM] = months[0]!.split('-').map(Number)
  const [endY, endM] = months[months.length - 1]!.split('-').map(Number)
  for (let y = startY!, m = startM!; y < endY! || (y === endY! && m <= endM!); ) {
    filled.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return filled
}

/** Income and rate per calendar month, with empty months filled in. */
export function byMonth(ctx: BreakdownContext): MonthPoint[] {
  const acc = new Map<
    string,
    {
      gross: number
      games: number
      minutes: number
      timedGross: number
      untimedGames: number
      /** Dates, not a count: two trips on one day must not read as two days. */
      dates: Set<string>
    }
  >()

  for (const trip of ctx.trips) {
    const minutesByGame = perGameMinutes(trip, ctx.model, ctx.timeCtx)
    for (const g of trip.games) {
      const month = g.game.date.slice(0, 7)
      const a =
        acc.get(month) ??
        { gross: 0, games: 0, minutes: 0, timedGross: 0, untimedGames: 0, dates: new Set<string>() }
      a.dates.add(g.game.date)
      const fee = g.game.fees.actual ?? 0
      const minutes = minutesByGame.get(g.game.id) ?? null
      a.gross += fee
      a.games++
      if (minutes == null) a.untimedGames++
      else {
        a.minutes += minutes
        a.timedGross += fee
      }
      acc.set(month, a)
    }
  }

  const filled = fillMonths([...acc.keys()])
  if (filled.length === 0) return []

  return filled.map((month) => {
    const a =
      acc.get(month) ??
      { gross: 0, games: 0, minutes: 0, timedGross: 0, untimedGames: 0, dates: new Set<string>() }
    return {
      month,
      label: monthLabel(month),
      gross: round2(a.gross),
      games: a.games,
      minutes: Math.round(a.minutes),
      daysWorked: a.dates.size,
      perHour: a.minutes > 0 ? round2((a.timedGross / a.minutes) * 60) : null,
      untimedGames: a.untimedGames,
    }
  })
}

export type WeekdaySplit = {
  weekday: { games: number; gross: number; minutes: number }
  weekend: { games: number; gross: number; minutes: number }
}

/** Saturday and Sunday count as weekend. */
export function weekdayWeekendSplit(ctx: BreakdownContext): WeekdaySplit {
  const out: WeekdaySplit = {
    weekday: { games: 0, gross: 0, minutes: 0 },
    weekend: { games: 0, gross: 0, minutes: 0 },
  }

  for (const trip of ctx.trips) {
    const minutesByGame = perGameMinutes(trip, ctx.model, ctx.timeCtx)
    // Parse as UTC so the bucket never shifts with the viewer's timezone.
    const day = new Date(`${trip.date}T00:00:00Z`).getUTCDay()
    const bucket = day === 0 || day === 6 ? out.weekend : out.weekday
    for (const g of trip.games) {
      bucket.games++
      bucket.gross += g.game.fees.actual ?? 0
      // Only timed games add minutes, so the split's hours stay comparable.
      bucket.minutes += minutesByGame.get(g.game.id) ?? 0
    }
  }

  out.weekday.gross = round2(out.weekday.gross)
  out.weekend.gross = round2(out.weekend.gross)
  out.weekday.minutes = Math.round(out.weekday.minutes)
  out.weekend.minutes = Math.round(out.weekend.minutes)
  return out
}

export type DayOfWeekRow = {
  /** 0 = Monday, so the week reads Mon–Sun rather than starting on Sunday. */
  day: number
  label: string
  games: number
  trips: number
  gross: number
  minutes: number
  isWeekend: boolean
}

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * One row per day of the week, always all seven — a day you never work is a
 * finding, and dropping it would hide that. Ordered Monday first so the weekend
 * sits together at the end rather than split across both ends.
 */
export function byDayOfWeek(ctx: BreakdownContext): DayOfWeekRow[] {
  const rows: DayOfWeekRow[] = DAY_LABELS.map((label, day) => ({
    day,
    label,
    games: 0,
    trips: 0,
    gross: 0,
    minutes: 0,
    isWeekend: day >= 5,
  }))

  for (const trip of ctx.trips) {
    const minutesByGame = perGameMinutes(trip, ctx.model, ctx.timeCtx)
    // Parsed as UTC so the bucket never shifts with the viewer's timezone, then
    // rotated from JS's Sunday-first to Monday-first.
    const row = rows[(new Date(`${trip.date}T00:00:00Z`).getUTCDay() + 6) % 7]!
    row.trips++
    for (const g of trip.games) {
      row.games++
      row.gross += g.game.fees.actual ?? 0
      row.minutes += minutesByGame.get(g.game.id) ?? 0
    }
  }

  for (const row of rows) {
    row.gross = round2(row.gross)
    row.minutes = Math.round(row.minutes)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Cancellations
// ---------------------------------------------------------------------------

export type CancellationSummary = {
  count: number
  /** Scheduled pay lost to these cancellations, gross. */
  forfeited: number
  byLeague: { label: string; count: number; forfeited: number }[]
  byMonth: { month: string; label: string; count: number; forfeited: number }[]
  games: ResolvedGame[]
}

export function cancellationSummary(resolved: ResolvedGame[], settings: Settings): CancellationSummary {
  void settings
  const cancelled = resolved.filter((r) => isCancelled(r.game.status))
  const leagues = new Map<string, { count: number; forfeited: number }>()
  const months = new Map<string, { count: number; forfeited: number }>()
  let forfeited = 0

  for (const r of cancelled) {
    const lost = Math.max((r.game.fees.scheduled ?? 0) - (r.game.fees.actual ?? 0), 0)
    forfeited += lost

    const league = r.game.league ?? 'Unknown league'
    const l = leagues.get(league) ?? { count: 0, forfeited: 0 }
    l.count++
    l.forfeited += lost
    leagues.set(league, l)

    const month = r.game.date.slice(0, 7)
    const m = months.get(month) ?? { count: 0, forfeited: 0 }
    m.count++
    m.forfeited += lost
    months.set(month, m)
  }

  return {
    count: cancelled.length,
    forfeited: round2(forfeited),
    byLeague: [...leagues.entries()]
      .map(([label, v]) => ({ label, count: v.count, forfeited: round2(v.forfeited) }))
      .sort((a, b) => b.forfeited - a.forfeited),
    byMonth: [...months.entries()]
      .map(([month, v]) => ({ month, label: monthLabel(month), count: v.count, forfeited: round2(v.forfeited) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    games: cancelled,
  }
}
