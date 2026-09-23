/**
 * Tax view. Two jobs:
 *  - Reconcile a 1099 against what was actually received, by payor, for one
 *    calendar year.
 *  - Compute the IRS standard-mileage deduction at that year's rate.
 *
 * Income is recognized on the game date, which is what the CSV carries. A 1099
 * is issued on the payor's payment dates, so a December game paid in January
 * will differ — the view says so rather than implying the two must match.
 */

import { isCancelled } from '../model/game'
import type { Settings } from '../model/reference'
import type { Expense, ExpenseCategory, TripAnnotation } from '../model/annotation'
import type { ResolvedGame } from './resolve'
import type { Trip } from './trips'
import { round2, sumExpenses } from './money'

export type PayorLine = {
  payor: string
  games: number
  gross: number
  /** Travel fees, which a payor may report separately. */
  travel: number
  paidVia: string[]
}

export type MileageDeduction = {
  year: number
  miles: number
  rate: number
  deduction: number
  /** Trips with no mileage figure, so `miles` is a floor, not a total. */
  tripsMissingMiles: number
  /** Trips whose miles came from a manual override rather than the park default. */
  tripsWithOverride: number
  /** Multi-trip days where round-trip-per-park overcounts unless overridden. */
  multiTripDaysNeedingReview: number
}

export type ExpenseLine = {
  category: ExpenseCategory
  total: number
  deductible: number
  count: number
}

export type TaxYear = {
  year: number
  byPayor: PayorLine[]
  gross: number
  travel: number
  /** Toll estimates plus logged expenses that are marked deductible. */
  deductibleExpenses: number
  expensesTotal: number
  expensesByCategory: ExpenseLine[]
  mileage: MileageDeduction
  /** gross - deductibleExpenses - mileage.deduction. */
  netAfterDeductions: number
  activeGames: number
  cancelledGames: number
  currency: string
}

export function taxYear(
  year: number,
  resolved: ResolvedGame[],
  trips: Trip[],
  tripAnnotations: Map<string, TripAnnotation>,
  settings: Settings,
): TaxYear {
  const prefix = String(year)
  const inYear = resolved.filter((r) => r.game.date.startsWith(prefix))
  const tripsInYear = trips.filter((t) => t.date.startsWith(prefix))

  const payors = new Map<string, { games: number; gross: number; travel: number; paidVia: Set<string> }>()
  let gross = 0
  let travel = 0
  let activeGames = 0
  let cancelledGames = 0

  for (const { game } of inYear) {
    if (isCancelled(game.status)) {
      cancelledGames++
      continue
    }
    activeGames++
    const amount = game.fees.actual ?? 0
    const tv = game.fees.travel ?? 0
    gross += amount
    travel += tv

    const payor = game.payor ?? 'Unknown payor'
    const p = payors.get(payor) ?? { games: 0, gross: 0, travel: 0, paidVia: new Set<string>() }
    p.games++
    p.gross += amount
    p.travel += tv
    if (game.paidVia) p.paidVia.add(game.paidVia)
    payors.set(payor, p)
  }

  // --- Expenses: tolls per trip, plus whatever the user logged. ---
  const categories = new Map<ExpenseCategory, { total: number; deductible: number; count: number }>()
  const bump = (category: ExpenseCategory, amount: number, deductible: boolean) => {
    const c = categories.get(category) ?? { total: 0, deductible: 0, count: 0 }
    c.total += amount
    if (deductible) c.deductible += amount
    c.count++
    categories.set(category, c)
  }

  let expensesTotal = 0
  let deductibleExpenses = 0

  for (const trip of tripsInYear) {
    // A toll override replaces the park estimate; both are deductible.
    if (trip.tolls != null && trip.tolls > 0) {
      bump('tolls', trip.tolls, true)
      expensesTotal += trip.tolls
      deductibleExpenses += trip.tolls
    }
    const annotation = tripAnnotations.get(trip.key)
    if (!annotation) continue
    for (const e of annotation.expenses as Expense[]) {
      bump(e.category, e.amount, e.deductible)
    }
    const sums = sumExpenses(annotation.expenses)
    expensesTotal += sums.total
    deductibleExpenses += sums.deductible
  }

  const rate = settings.irsMileageRateByYear[prefix] ?? 0
  let miles = 0
  let tripsMissingMiles = 0
  let tripsWithOverride = 0
  let multiTripDaysNeedingReview = 0
  const flaggedDates = new Set<string>()

  for (const trip of tripsInYear) {
    if (trip.miles == null) tripsMissingMiles++
    else miles += trip.miles
    if (trip.milesSource === 'override') tripsWithOverride++
    if (trip.isMultiTripDay && trip.milesSource !== 'override') flaggedDates.add(trip.date)
  }
  multiTripDaysNeedingReview = flaggedDates.size

  const roundedMiles = Math.round(miles * 10) / 10
  const deduction = round2(roundedMiles * rate)

  return {
    year,
    byPayor: [...payors.entries()]
      .map(([payor, v]) => ({
        payor,
        games: v.games,
        gross: round2(v.gross),
        travel: round2(v.travel),
        paidVia: [...v.paidVia].sort(),
      }))
      .sort((a, b) => b.gross - a.gross),
    gross: round2(gross),
    travel: round2(travel),
    deductibleExpenses: round2(deductibleExpenses),
    expensesTotal: round2(expensesTotal),
    expensesByCategory: [...categories.entries()]
      .map(([category, v]) => ({
        category,
        total: round2(v.total),
        deductible: round2(v.deductible),
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total),
    mileage: {
      year,
      miles: roundedMiles,
      rate,
      deduction,
      tripsMissingMiles,
      tripsWithOverride,
      multiTripDaysNeedingReview,
    },
    netAfterDeductions: round2(gross - deductibleExpenses - deduction),
    activeGames,
    cancelledGames,
    currency: settings.currency,
  }
}

/** Flat CSV of the tax year, for handing to a preparer. */
export function taxYearToCsv(t: TaxYear): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines: string[] = []

  lines.push(`Sports officiating - tax summary ${t.year}`)
  lines.push('')
  lines.push('Section,Item,Detail,Amount')
  for (const p of t.byPayor) {
    lines.push(
      ['Income by payor', esc(p.payor), esc(`${p.games} games via ${p.paidVia.join(' / ') || 'unspecified'}`), p.gross.toFixed(2)].join(','),
    )
  }
  lines.push(['Income', 'Gross received', esc(`${t.activeGames} active games`), t.gross.toFixed(2)].join(','))
  if (t.travel > 0) lines.push(['Income', 'Travel fees', '', t.travel.toFixed(2)].join(','))
  lines.push('')

  for (const e of t.expensesByCategory) {
    lines.push(
      ['Expenses', esc(e.category), esc(`${e.count} entries, ${e.deductible.toFixed(2)} deductible`), e.total.toFixed(2)].join(','),
    )
  }
  lines.push(['Expenses', 'Deductible subtotal', '', t.deductibleExpenses.toFixed(2)].join(','))
  lines.push('')

  lines.push(
    ['Mileage', 'Business miles', esc(`rate ${t.mileage.rate.toFixed(3)}/mile`), t.mileage.miles.toFixed(1)].join(','),
  )
  lines.push(['Mileage', 'Standard mileage deduction', '', t.mileage.deduction.toFixed(2)].join(','))
  if (t.mileage.tripsMissingMiles > 0) {
    lines.push(
      ['Mileage', 'Trips with no mileage on record', esc('figure above is a floor, not a total'), t.mileage.tripsMissingMiles].join(','),
    )
  }
  if (t.mileage.multiTripDaysNeedingReview > 0) {
    lines.push(
      ['Mileage', 'Multi-trip days needing review', esc('round-trip per park overcounts these'), t.mileage.multiTripDaysNeedingReview].join(','),
    )
  }
  lines.push('')
  lines.push(['Summary', 'Net after deductions', '', t.netAfterDeductions.toFixed(2)].join(','))

  return lines.join('\n')
}
