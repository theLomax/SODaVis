/**
 * Trip grouping. A trip is one visit to one park on one day: games grouped by
 * `(date, parkId)`, ordered by start time.
 *
 * Cancelled games earn nothing and take no game time, so they never contribute
 * income or minutes. But a cancellation can still have cost a full drive — and
 * the export cannot say whether it did. So a cancelled game joins a trip only
 * when `droveToCancelled` says the drive was made: mileage then counts and
 * reaches the tax view, while income and time stay zero. One that nobody has
 * ruled on is returned as an `uncountedDrive` to be asked about, never assumed
 * either way.
 *
 * Most cancellations in a real season fall on days with no active game, so
 * confirming those drives is the only way their mileage is ever counted.
 *
 * Drive time is computed per leg, each against its own clock, because the two
 * legs of one trip routinely differ: a weekday evening game drives out through
 * rush hour and home on clear roads, while a weekend afternoon game does the
 * reverse.
 */

import type { DataQualityFlag } from '../model/game'
import { isCancelled } from '../model/game'
import type { Park, Settings } from '../model/reference'
import type { TripAnnotation } from '../model/annotation'
import { tripKey } from '../model/annotation'
import { minutesToTime, timeToMinutes } from '../import/transforms'
import type { ResolvedGame } from './resolve'

export type Trip = {
  key: string
  date: string
  parkId: string
  parkName: string
  games: ResolvedGame[]
  /** Earliest start, 'HH:mm'. */
  firstStart: string
  /**
   * Latest known end. `null` when any game on the trip has no duration, since a
   * partial sum would understate the day.
   */
  lastEnd: string | null
  /** Sum of game durations. `null` when any game's duration is unknown. */
  gameMinutes: number | null
  /** Number of games whose duration could not be resolved. */
  gamesMissingDuration: number
  /** Round-trip miles. */
  miles: number | null
  milesSource: 'override' | 'park-round-trip' | 'none'
  /** Both legs together — what every time model and rate uses. */
  driveMinutes: number | null
  driveMinutesSource: 'override' | 'park' | 'park-rush' | 'estimated' | 'none'
  /**
   * The outbound leg, which takes the park's rush figure when the arrival falls
   * in the rush window. `null` when only a round-trip total is known, as with a
   * manual override or a miles-based estimate.
   */
  driveOutMinutes: number | null
  /** The return leg, always the ideal figure — no observed return hits rush hour. */
  driveHomeMinutes: number | null
  /** True when the outbound leg was treated as a rush-hour drive. */
  outboundInRush: boolean
  /**
   * True when the *return* leg was. Weekday games never finish early enough, but
   * a weekend afternoon game lets out straight into it.
   */
  returnInRush: boolean
  tolls: number | null
  tollsSource: 'override' | 'park-estimate' | 'none'
  /** True when this day has more than one trip, so round-trip miles overcount. */
  isMultiTripDay: boolean
  /**
   * True when every game here was cancelled — a drive made for nothing. It still
   * earns its mileage and tolls; it simply has no game time and no income.
   */
  isWastedTrip: boolean
  /** Cancelled games on this trip whose drive was confirmed. */
  cancelledGames: number
  flags: DataQualityFlag[]
}

export type TripContext = {
  parks: Map<string, Park>
  tripAnnotations: Map<string, TripAnnotation>
  settings: Settings
}

/**
 * Games that cannot be placed at a park cannot form a trip. They are returned
 * separately rather than bundled into a null-park trip, so mileage is never
 * computed against an unknown origin.
 */
export type TripResult = {
  trips: Trip[]
  /** Games with an unmatched venue, so no park to travel to. */
  unplaceable: ResolvedGame[]
  /** Every cancelled game, whether or not it formed a trip. */
  cancelled: ResolvedGame[]
  /**
   * Cancellations nobody has ruled on: neither a stage nor a drive answer, so it
   * is unknown whether a journey was made. Their mileage may or may not be owed —
   * the Data Quality view asks rather than assuming either way. Answering "I did
   * not drive" removes a game from this list without creating a trip.
   */
  uncountedDrives: ResolvedGame[]
}

export function buildTrips(resolved: ResolvedGame[], ctx: TripContext): TripResult {
  const cancelled = resolved.filter((r) => isCancelled(r.game.status))
  const active = resolved.filter((r) => !isCancelled(r.game.status))

  // A cancellation earns nothing and takes no game time, but it may still have
  // cost a drive — and the export cannot say whether it did. So it joins the
  // trip layer only once the drive is confirmed by hand. Without that, no trip
  // is formed and no mileage is claimed on the strength of a schedule entry.
  const drove = cancelled.filter((r) => r.droveToCancelled === true)
  // Open questions only: a recorded stage, or an explicit "I did not drive", both
  // count as answered. `undefined` is the unanswered state, which is why the flag
  // is tri-state rather than a plain boolean.
  const uncountedDrives = cancelled.filter(
    (r) => r.droveToCancelled == null && r.cancelStage == null,
  )

  const forTrips = [...active, ...drove]
  const unplaceable = forTrips.filter((r) => r.parkId === null)
  const placeable = forTrips.filter((r) => r.parkId !== null)

  const grouped = new Map<string, ResolvedGame[]>()
  for (const r of placeable) {
    const key = tripKey(r.game.date, r.parkId!)
    const bucket = grouped.get(key)
    if (bucket) bucket.push(r)
    else grouped.set(key, [r])
  }

  // How many trips fall on each date, so multi-trip days can be flagged.
  const tripsPerDate = new Map<string, number>()
  for (const key of grouped.keys()) {
    const date = key.split('|')[0]!
    tripsPerDate.set(date, (tripsPerDate.get(date) ?? 0) + 1)
  }

  const trips = [...grouped.entries()]
    .map(([key, games]) => buildTrip(key, games, tripsPerDate, ctx))
    .sort((a, b) => a.date.localeCompare(b.date) || a.firstStart.localeCompare(b.firstStart))

  return { trips, unplaceable, cancelled, uncountedDrives }
}

function buildTrip(
  key: string,
  gamesIn: ResolvedGame[],
  tripsPerDate: Map<string, number>,
  ctx: TripContext,
): Trip {
  const games = [...gamesIn].sort((a, b) =>
    a.game.startTime.localeCompare(b.game.startTime),
  )
  const first = games[0]!
  const date = first.game.date
  const parkId = first.parkId!
  const park = ctx.parks.get(parkId)
  const annotation = ctx.tripAnnotations.get(key)
  const flags: DataQualityFlag[] = []

  // A cancelled game was never played, so it contributes no minutes and its
  // unknown duration is not a gap to report — only the games that went ahead
  // are asked for a duration.
  const played = games.filter((g) => !isCancelled(g.game.status))
  const gamesMissingDuration = played.filter((g) => g.duration.minutes == null).length
  const gameMinutes =
    gamesMissingDuration > 0
      ? null
      : played.reduce((sum, g) => sum + (g.duration.minutes ?? 0), 0)

  // The committed-time window spans the games actually played. On a trip made
  // only for games that were then cancelled, there is no window — the drive was
  // the whole cost, and `lastEnd` stays null rather than inventing a finish.
  const firstStart = (played[0] ?? first).game.startTime
  const lastEnd = played.length > 0 ? computeLastEnd(played) : null

  // --- Mileage: override wins; else round-trip per park. ---
  let miles: number | null = null
  let milesSource: Trip['milesSource'] = 'none'
  if (annotation?.milesOverride != null) {
    miles = annotation.milesOverride
    milesSource = 'override'
  } else if (park?.oneWayMiles != null) {
    miles = round1(park.oneWayMiles * 2)
    milesSource = 'park-round-trip'
  } else {
    flags.push({
      code: 'missing-mileage',
      severity: 'warning',
      message: `No mileage on record for ${park?.name ?? parkId}. Add one-way miles in Reference data, or enter a trip override.`,
      context: park?.name ?? parkId,
    })
  }

  const isMultiTripDay = (tripsPerDate.get(date) ?? 0) > 1
  if (isMultiTripDay && annotation?.milesOverride == null) {
    flags.push({
      code: 'multi-trip-day',
      severity: 'warning',
      message:
        'More than one park on this date, so round-trip mileage counts the drive home twice. Enter the actual miles for this trip.',
      context: date,
    })
  }

  // --- Drive time, one leg at a time ---------------------------------------
  // The two legs are not the same drive, and each is judged on its own clock: the
  // outbound by the first pitch, the return by when you actually leave. A weekday
  // 6pm game drives out through rush hour and home on empty roads; a Saturday
  // afternoon game is the reverse, driving out clear and letting out into traffic.
  // Neither leg can be assumed from the other.
  const outboundInRush = isRushHour(date, firstStart, ctx.settings)
  // Only knowable when the last game's end is, which needs its duration.
  const returnInRush = lastEnd != null && isRushHour(date, lastEnd, ctx.settings)

  let driveMinutes: number | null = null
  let driveMinutesSource: Trip['driveMinutesSource'] = 'none'
  let driveOutMinutes: number | null = null
  let driveHomeMinutes: number | null = null
  if (annotation?.driveMinutesOverride != null) {
    driveMinutes = annotation.driveMinutesOverride
    driveMinutesSource = 'override'
  } else if (park?.oneWayDriveMinutes != null) {
    const ideal = park.oneWayDriveMinutes
    // Falls back to the ideal figure where no rush figure is on record: better the
    // same number both ways than a guess at how much worse the traffic was.
    const rush = park.oneWayDriveMinutesRush ?? ideal
    driveOutMinutes = Math.round(outboundInRush ? rush : ideal)
    driveHomeMinutes = Math.round(returnInRush ? rush : ideal)
    driveMinutes = driveOutMinutes + driveHomeMinutes
    driveMinutesSource =
      (outboundInRush || returnInRush) && park.oneWayDriveMinutesRush != null
        ? 'park-rush'
        : 'park'
  } else if (miles != null && ctx.settings.fallbackMph > 0) {
    driveMinutes = Math.round((miles / ctx.settings.fallbackMph) * 60)
    driveMinutesSource = 'estimated'
  } else {
    flags.push({
      code: 'missing-drive-time',
      severity: 'info',
      message: `No drive time for ${park?.name ?? parkId}, and no mileage to estimate it from.`,
      context: park?.name ?? parkId,
    })
  }

  let tolls: number | null = null
  let tollsSource: Trip['tollsSource'] = 'none'
  if (annotation?.tollsOverride != null) {
    tolls = annotation.tollsOverride
    tollsSource = 'override'
  } else if (park?.tollEstimate != null) {
    tolls = park.tollEstimate
    tollsSource = 'park-estimate'
  }

  return {
    key,
    date,
    parkId,
    parkName: park?.name ?? parkId,
    games,
    firstStart,
    lastEnd,
    gameMinutes,
    gamesMissingDuration,
    miles,
    milesSource,
    driveMinutes,
    driveMinutesSource,
    tolls,
    tollsSource,
    driveOutMinutes,
    driveHomeMinutes,
    outboundInRush,
    returnInRush,
    isMultiTripDay,
    isWastedTrip: played.length === 0,
    cancelledGames: games.length - played.length,
    flags,
  }
}

/**
 * The end of the last game, from its own start plus duration. Returns `null`
 * when the last game's duration is unknown — better no figure than a wrong one.
 */
function computeLastEnd(games: ResolvedGame[]): string | null {
  let latest: number | null = null
  for (const g of games) {
    const start = timeToMinutes(g.game.startTime)
    if (start == null) continue
    const explicit = timeToMinutes(g.game.endTime)
    const end = explicit ?? (g.duration.minutes != null ? start + g.duration.minutes : null)
    if (end == null) return null
    latest = latest == null ? end : Math.max(latest, end)
  }
  return latest == null ? null : minutesToTime(latest)
}

/**
 * Whether a drive at this time on this date runs through rush hour.
 *
 * Asked once per leg, with that leg's own clock: the first pitch for the drive
 * out, the last out for the drive home. Which is why it takes a time rather than
 * a trip — the two legs of one trip routinely get different answers.
 */
export function isRushHour(date: string, atTime: string, settings: Settings): boolean {
  const { rushHour } = settings
  if (!rushHour) return false

  const day = new Date(`${date}T00:00:00`)
  if (Number.isNaN(day.getTime())) return false
  // JS getDay() is 0=Sunday; the setting is 0=Monday, as ISO weekdays read.
  const isoWeekday = (day.getDay() + 6) % 7
  if (!rushHour.weekdays.includes(isoWeekday)) return false

  const minutes = timeToMinutes(atTime)
  if (minutes == null) return false
  return minutes >= rushHour.startMinutes && minutes < rushHour.endMinutes
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Distinct dates on which any trip occurred. */
export function workDays(trips: Trip[]): string[] {
  return [...new Set(trips.map((t) => t.date))].sort()
}
