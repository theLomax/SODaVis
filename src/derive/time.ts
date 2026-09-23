/**
 * The time models. Three answers to "how long did that take", computed side by
 * side so the rate-per-hour figure can be read against whichever definition the
 * user considers honest.
 *
 *  1. game       - just the games. Comparable to Assignr's own scheduled time.
 *  2. game-drive - games + drive. What the current workbook computes.
 *  3. committed  - door to door: (last end - first start) + drive + prep + wrap,
 *                  which surfaces between-game downtime as the real cost it is.
 *
 * `committed` is >= `game-drive` by construction: an on-site gap between games
 * is time spent, and the arrival floor puts a minimum on prep.
 */

import type { GearLevel, GearModifier, Settings, SportProfile, TimeModelId } from '../model/reference'
import { timeToMinutes } from '../import/transforms'
import type { Trip } from './trips'

export const TIME_MODELS: { id: TimeModelId; label: string; description: string }[] = [
  {
    id: 'game',
    label: 'Game time',
    description: 'Scheduled game durations only.',
  },
  {
    id: 'game-drive',
    label: 'Game + drive',
    description: 'Game durations plus round-trip drive time.',
  },
  {
    id: 'committed',
    label: 'Committed time',
    description:
      'Door to door: first pitch to last out, plus drive, prep and wrap - including downtime between games.',
  },
]

export type TripTime = {
  /** Sum of game durations. */
  gameMinutes: number | null
  /** Round-trip drive. */
  driveMinutes: number | null
  /** Prep before the first game, at or above the arrival floor. */
  prepMinutes: number
  /** Wrap after the last game. */
  wrapMinutes: number
  /** Last game's end minus first game's start, including on-site gaps. */
  onSiteMinutes: number | null
  /** Downtime between games: onSite - gameMinutes. */
  gapMinutes: number | null
  byModel: Record<TimeModelId, number | null>
}

export type TimeContext = {
  sports: Map<string, SportProfile>
  gearLevels: Map<string, GearLevel>
  /** Conditions on top of the role, summed onto prep when set. */
  gearModifiers?: Map<string, GearModifier>
  settings: Settings
  /** Per-trip prep/wrap overrides, keyed by trip key. */
  prepOverrides?: Map<string, { prepMinutes?: number; wrapMinutes?: number }>
}

/**
 * Prep is charged once per trip — you gear up once — driven by the first game's
 * sport, the role worked, and any conditions on top of it. Never falls below the
 * arrival floor, because you have to be there before the first pitch regardless
 * of how little there was to put on.
 */
export function tripPrepMinutes(trip: Trip, ctx: TimeContext): number {
  const override = ctx.prepOverrides?.get(trip.key)?.prepMinutes
  if (override != null) return Math.max(override, 0)

  const first = trip.games[0]
  const sport = first?.sport ?? (first?.sportCode ? ctx.sports.get(first.sportCode) : undefined)
  const base = sport?.prepMinutes ?? 15
  const roleDelta = ctx.gearLevels.get(first?.gearLevel ?? 'base')?.prepDeltaMinutes ?? 0

  // Conditions stack: a cold, wet plate game carries all three deltas. The role
  // says what was worked; these say what it took to be ready for it.
  const conditionDelta = (first?.gearModifiers ?? []).reduce(
    (sum: number, id: string) => sum + (ctx.gearModifiers?.get(id)?.prepDeltaMinutes ?? 0),
    0,
  )

  return Math.max(base + roleDelta + conditionDelta, ctx.settings.arrivalFloorMinutes)
}

/** Wrap is charged once per trip, from the last game's sport. */
export function tripWrapMinutes(trip: Trip, ctx: TimeContext): number {
  const override = ctx.prepOverrides?.get(trip.key)?.wrapMinutes
  if (override != null) return Math.max(override, 0)

  const last = trip.games[trip.games.length - 1]
  const sport = last?.sport ?? (last?.sportCode ? ctx.sports.get(last.sportCode) : undefined)
  return Math.max(sport?.wrapMinutes ?? 5, 0)
}

export function tripTime(trip: Trip, ctx: TimeContext): TripTime {
  const gameMinutes = trip.gameMinutes
  const driveMinutes = trip.driveMinutes
  const prepMinutes = tripPrepMinutes(trip, ctx)
  const wrapMinutes = tripWrapMinutes(trip, ctx)

  const start = timeToMinutes(trip.firstStart)
  const end = trip.lastEnd ? timeToMinutes(trip.lastEnd) : null
  // A wasted trip has no games to span, so its on-site time is zero rather than
  // unknown. Without this it would be reported as missing a duration, which is
  // wrong twice over: nothing was played, and the trip is fully timed — the
  // drive and the prep are the whole of it.
  const onSiteMinutes = trip.isWastedTrip
    ? 0
    : start != null && end != null
      ? end >= start
        ? end - start
        : end + 24 * 60 - start
      : null

  const gapMinutes =
    onSiteMinutes != null && gameMinutes != null ? Math.max(onSiteMinutes - gameMinutes, 0) : null

  const gameDrive =
    gameMinutes != null && driveMinutes != null ? gameMinutes + driveMinutes : null

  const committed =
    onSiteMinutes != null && driveMinutes != null
      ? onSiteMinutes + driveMinutes + prepMinutes + wrapMinutes
      : null

  return {
    gameMinutes,
    driveMinutes,
    prepMinutes,
    wrapMinutes,
    onSiteMinutes,
    gapMinutes,
    byModel: {
      game: gameMinutes,
      'game-drive': gameDrive,
      committed,
    },
  }
}

/**
 * A trip one model could not time, and the reason — so the count of untimed
 * trips can always be turned back into a list of parks, dates and the field
 * that would fix each one. A bare count says a number is partial; this says
 * which trip made it partial.
 */
export type UntimedTrip = {
  tripKey: string
  date: string
  parkId: string
  parkName: string
  /** Which inputs are absent. Both can be true. */
  missing: { duration: boolean; drive: boolean }
  /** Games whose duration is unknown, for the duration case. */
  gamesMissingDuration: number
  /** Age groups needing a figure, so the fix is nameable without a second lookup. */
  ageGroupsMissingDuration: string[]
  /** Income excluded from this model's rate along with the time. */
  gross: number
}

export type TimeTotals = {
  byModel: Record<TimeModelId, number>
  /**
   * Trips excluded from each model's total for want of an input. Always equal to
   * `untimedByModel[model].length` — it is derived from that list rather than
   * counted alongside it, so the figure and the identities cannot disagree.
   */
  incompleteByModel: Record<TimeModelId, number>
  /** The trips each model could not time, and what each one is missing. */
  untimedByModel: Record<TimeModelId, UntimedTrip[]>
  /**
   * Income earned on the trips actually counted in `byModel`, per model. A rate
   * must divide this — not total income — by `byModel`, or income from an
   * excluded trip lands over time that was never added.
   */
  grossByModel: Record<TimeModelId, number>
  prepMinutes: number
  wrapMinutes: number
  driveMinutes: number
  gapMinutes: number
  tripsCounted: number
}

/**
 * Why one model could not time one trip.
 *
 * `game` needs only a duration; the other two additionally need a drive figure.
 * Both can be absent at once, so `missing` reports each independently rather
 * than picking a single cause.
 */
function untimedTrip(
  trip: Trip,
  t: TripTime,
  model: TimeModelId,
  gross: number,
): UntimedTrip {
  const duration = model === 'committed' ? t.onSiteMinutes == null : t.gameMinutes == null
  const drive = model !== 'game' && t.driveMinutes == null

  return {
    tripKey: trip.key,
    date: trip.date,
    parkId: trip.parkId,
    parkName: trip.parkName,
    missing: { duration, drive },
    gamesMissingDuration: trip.gamesMissingDuration,
    ageGroupsMissingDuration: [
      ...new Set(
        trip.games
          .filter((g) => g.duration.minutes == null)
          .map((g) => g.game.ageGroupRaw)
          .filter(Boolean),
      ),
    ],
    gross,
  }
}

/**
 * Sums the models over trips. A trip missing an input is excluded from that
 * model's total and counted, so a partial figure is always visibly partial
 * rather than quietly low.
 */
export function totalTime(trips: Trip[], ctx: TimeContext): TimeTotals {
  const byModel: Record<TimeModelId, number> = { game: 0, 'game-drive': 0, committed: 0 }
  const untimedByModel: Record<TimeModelId, UntimedTrip[]> = {
    game: [],
    'game-drive': [],
    committed: [],
  }
  const grossByModel: Record<TimeModelId, number> = { game: 0, 'game-drive': 0, committed: 0 }
  let prepMinutes = 0
  let wrapMinutes = 0
  let driveMinutes = 0
  let gapMinutes = 0

  for (const trip of trips) {
    const t = tripTime(trip, ctx)
    const tripGross = trip.games.reduce((sum, g) => sum + (g.game.fees.actual ?? 0), 0)
    for (const model of ['game', 'game-drive', 'committed'] as TimeModelId[]) {
      const v = t.byModel[model]
      if (v == null) untimedByModel[model].push(untimedTrip(trip, t, model, tripGross))
      else {
        byModel[model] += v
        grossByModel[model] += tripGross
      }
    }
    prepMinutes += t.prepMinutes
    wrapMinutes += t.wrapMinutes
    driveMinutes += t.driveMinutes ?? 0
    gapMinutes += t.gapMinutes ?? 0
  }

  const incompleteByModel = Object.fromEntries(
    (['game', 'game-drive', 'committed'] as TimeModelId[]).map((m) => [
      m,
      untimedByModel[m].length,
    ]),
  ) as Record<TimeModelId, number>

  return {
    byModel,
    incompleteByModel,
    untimedByModel,
    grossByModel,
    prepMinutes,
    wrapMinutes,
    driveMinutes,
    gapMinutes,
    tripsCounted: trips.length,
  }
}

export const minutesToHours = (m: number): number => Math.round((m / 60) * 100) / 100

/** `135` -> `'2h 15m'`. */
export function formatMinutes(m: number | null): string {
  if (m == null) return '—'
  const sign = m < 0 ? '-' : ''
  const abs = Math.abs(Math.round(m))
  const h = Math.floor(abs / 60)
  const min = abs % 60
  if (h === 0) return `${sign}${min}m`
  if (min === 0) return `${sign}${h}h`
  return `${sign}${h}h ${min}m`
}
