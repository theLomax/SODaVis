/**
 * Money. Actual fee is truth for income; the gap between scheduled and actual is
 * itself a metric worth reporting, in both directions.
 */

import type { Game } from '../model/game'
import { isActive, isCancelled } from '../model/game'
import type { Expense, TripAnnotation } from '../model/annotation'
import type { Settings, TimeModelId } from '../model/reference'
import type { ResolvedGame } from './resolve'
import type { Trip } from './trips'
import { totalTime, type TimeContext } from './time'

export type MoneyTotals = {
  /** Sum of actual fees on active games. */
  gross: number
  /** Sum of scheduled fees on active games. */
  scheduledActive: number
  /** Sum of scheduled fees on every game, cancellations included. */
  scheduledAll: number
  /**
   * Scheduled pay that never arrived: the full scheduled fee of every
   * cancellation, plus any active game paid below its assigned rate.
   */
  forfeited: number
  /** Actual minus scheduled on active games: pay above the assigned rate. */
  bonus: number
  /**
   * `scheduledAll - gross`. The single figure that reconciles the source file's
   * own totals row, and smaller than `forfeited` whenever upward adjustments
   * offset part of what the cancellations cost.
   */
  netFeeVariance: number
  tolls: number
  expenses: number
  deductibleExpenses: number
  /** gross - tolls - expenses. */
  net: number
  travelFees: number
  activeGames: number
  cancelledGames: number
  currency: string
}

export function sumExpenses(expenses: Expense[]): { total: number; deductible: number } {
  let total = 0
  let deductible = 0
  for (const e of expenses) {
    total += e.amount
    if (e.deductible) deductible += e.amount
  }
  return { total, deductible }
}

export function totalMoney(
  resolved: ResolvedGame[],
  trips: Trip[],
  tripAnnotations: Map<string, TripAnnotation>,
  settings: Settings,
): MoneyTotals {
  let gross = 0
  let scheduledActive = 0
  let scheduledAll = 0
  let forfeited = 0
  let bonus = 0
  let travelFees = 0
  let activeGames = 0
  let cancelledGames = 0

  for (const { game } of resolved) {
    const scheduled = game.fees.scheduled ?? 0
    const actual = game.fees.actual ?? 0
    scheduledAll += scheduled

    if (isCancelled(game.status)) {
      cancelledGames++
      forfeited += Math.max(scheduled - actual, 0)
      continue
    }
    if (!isActive(game.status)) continue

    activeGames++
    gross += actual
    scheduledActive += scheduled
    travelFees += game.fees.travel ?? 0
    if (actual > scheduled) bonus += actual - scheduled
    else if (actual < scheduled) forfeited += scheduled - actual
  }

  // Tolls and expenses are per trip, so they only ever count once per visit.
  let tolls = 0
  let expenses = 0
  let deductibleExpenses = 0
  for (const trip of trips) {
    tolls += trip.tolls ?? 0
    const annotation = tripAnnotations.get(trip.key)
    if (annotation) {
      const sums = sumExpenses(annotation.expenses)
      expenses += sums.total
      deductibleExpenses += sums.deductible
    }
  }

  return {
    gross: round2(gross),
    scheduledActive: round2(scheduledActive),
    scheduledAll: round2(scheduledAll),
    forfeited: round2(forfeited),
    bonus: round2(bonus),
    netFeeVariance: round2(scheduledAll - gross),
    tolls: round2(tolls),
    expenses: round2(expenses),
    deductibleExpenses: round2(deductibleExpenses),
    net: round2(gross - tolls - expenses),
    travelFees: round2(travelFees),
    activeGames,
    cancelledGames,
    currency: settings.currency,
  }
}

export type Rates = {
  /**
   * Gross per hour, by time model. Computed over the trips each model could time,
   * so a trip missing a duration lowers the confidence in the figure (reported as
   * `tripsCountedByModel`) rather than inflating the rate.
   */
  grossPerHourByModel: Record<TimeModelId, number | null>
  /** Net per hour, by time model. Expenses are prorated to the counted trips. */
  netPerHourByModel: Record<TimeModelId, number | null>
  /** How many trips each model's rate is based on, against the total. */
  tripsCountedByModel: Record<TimeModelId, number>
  tripsTotal: number
  perGame: number | null
  perTrip: number | null
  perMile: number | null
}

export function computeRates(
  money: MoneyTotals,
  trips: Trip[],
  timeCtx: TimeContext,
): Rates {
  const time = totalTime(trips, timeCtx)
  const models: TimeModelId[] = ['game', 'game-drive', 'committed']

  // Deductions are a whole-period figure, so scale them to the share of income
  // the model could time. Otherwise net/hour would subtract expenses belonging to
  // trips that are not in the denominator.
  const deductions = money.tolls + money.expenses

  const perHour = (useNet: boolean) =>
    Object.fromEntries(
      models.map((m) => {
        const minutes = time.byModel[m]
        const gross = time.grossByModel[m]
        if (minutes <= 0) return [m, null]
        const share = money.gross > 0 ? gross / money.gross : 0
        const amount = useNet ? gross - deductions * share : gross
        return [m, round2((amount / minutes) * 60)]
      }),
    ) as Record<TimeModelId, number | null>

  const miles = trips.reduce((s, t) => s + (t.miles ?? 0), 0)
  const tripsCountedByModel = Object.fromEntries(
    models.map((m) => [m, trips.length - time.incompleteByModel[m]]),
  ) as Record<TimeModelId, number>

  return {
    grossPerHourByModel: perHour(false),
    netPerHourByModel: perHour(true),
    tripsCountedByModel,
    tripsTotal: trips.length,
    perGame: money.activeGames > 0 ? round2(money.gross / money.activeGames) : null,
    perTrip: trips.length > 0 ? round2(money.gross / trips.length) : null,
    perMile: miles > 0 ? round2(money.gross / miles) : null,
  }
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

export function formatMoney(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Compact form for stat tiles: `$8,450` / `$12.9K`. */
export function formatMoneyCompact(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const opts: Intl.NumberFormatOptions =
    abs >= 100_000
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { maximumFractionDigits: abs % 1 === 0 ? 0 : 2 }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...opts }).format(n)
}

/**
 * A signed figure, where the sign is the point.
 *
 * `netFeeVariance` is the gap between what was scheduled and what arrived, and
 * `$346` alone cannot say whether that is money lost or money gained. An explicit
 * `+` on a gain is not decoration: without it, only the minus sign carries meaning
 * and its absence reads as "no sign shown" rather than "positive".
 */
export function formatMoneySigned(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  if (n === 0) return formatMoneyCompact(0, currency)
  const body = formatMoneyCompact(Math.abs(n), currency)
  return `${n < 0 ? '−' : '+'}${body}`
}

/** Total round-trip miles across trips, and how many trips lacked a figure. */
export function totalMiles(trips: Trip[]): { miles: number; tripsMissing: number } {
  let miles = 0
  let tripsMissing = 0
  for (const t of trips) {
    if (t.miles == null) tripsMissing++
    else miles += t.miles
  }
  return { miles: Math.round(miles * 10) / 10, tripsMissing }
}

export type FeeVariance = {
  game: Game
  scheduled: number
  actual: number
  delta: number
}

/**
 * Every game with its scheduled and actual fee, whether or not they differ.
 *
 * Sorted by delta, so shortfalls lead and bonuses trail with the unchanged games
 * between them. This is the reconciliation view: the total of `actual` here is the
 * gross income figure, which cannot be checked against a list that omits most rows.
 */
export function feeReconciliation(games: Game[]): FeeVariance[] {
  return games
    .map((game) => {
      const scheduled = game.fees.scheduled ?? 0
      const actual = game.fees.actual ?? 0
      return { game, scheduled, actual, delta: round2(actual - scheduled) }
    })
    .sort((a, b) => a.delta - b.delta || a.game.date.localeCompare(b.game.date))
}

/**
 * Only the games whose fee differed from its assignment.
 *
 * The narrower set, for the diverging chart: a bar of zero is not a variance, and
 * 180 of them would drown the 22 that are. `feeReconciliation` is the one to use
 * when the question is "does this add up".
 */
export function feeVariances(games: Game[]): FeeVariance[] {
  return feeReconciliation(games).filter((v) => v.delta !== 0)
}
