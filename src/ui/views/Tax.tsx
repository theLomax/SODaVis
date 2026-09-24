/**
 * Tax view. A calendar year at a time, because that is the unit a 1099 and a
 * Schedule C use.
 *
 * It states its own caveats rather than implying a precision it does not have:
 * income is recognized on the game date (what the export carries), while a 1099
 * follows the payor's payment dates, and the mileage figure is a floor whenever a
 * trip has no miles on record.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Button } from '../components/Controls'
import { Card, EmptyState, HeroFigure, StatTile, StatusChip } from '../components/Tiles'
import { DataTable, type TableColumn } from '../charts/ChartFrame'
import { taxYear, taxYearToCsv, type ExpenseLine, type PayorLine } from '../../derive/tax'
import { yearsPresent } from '../../derive/metrics'
import { formatMoney, formatMoneyCompact } from '../../derive/money'

export function Tax() {
  const { derived } = useStore()

  const years = useMemo(() => (derived ? yearsPresent(derived.snapshot.games) : []), [derived])
  const [year, setYear] = useState<number | null>(null)
  const activeYear = year ?? years[0] ?? new Date().getFullYear()

  const summary = useMemo(() => {
    if (!derived) return null
    return taxYear(
      activeYear,
      derived.allResolved,
      derived.allTrips,
      new Map(derived.snapshot.tripAnnotations.map((a) => [a.key, a])),
      derived.snapshot.settings,
    )
  }, [derived, activeYear])

  if (!derived || !summary) return null

  if (years.length === 0) {
    return <EmptyState title="No games yet" body="Import a game export to build a tax summary." />
  }

  const currency = summary.currency
  const rateMissing = summary.mileage.rate === 0

  const payorColumns: TableColumn<PayorLine>[] = [
    { key: 'payor', header: 'Payor', cell: (r) => r.payor },
    { key: 'games', header: 'Games', cell: (r) => String(r.games), align: 'right' },
    { key: 'gross', header: 'Gross received', cell: (r) => formatMoney(r.gross, currency), align: 'right' },
    { key: 'travel', header: 'Travel fees', cell: (r) => formatMoney(r.travel, currency), align: 'right' },
    { key: 'paidVia', header: 'Paid via', cell: (r) => r.paidVia.join(' / ') || '—' },
  ]

  const expenseColumns: TableColumn<ExpenseLine>[] = [
    { key: 'category', header: 'Category', cell: (r) => r.category },
    { key: 'count', header: 'Entries', cell: (r) => String(r.count), align: 'right' },
    { key: 'total', header: 'Total', cell: (r) => formatMoney(r.total, currency), align: 'right' },
    { key: 'deductible', header: 'Deductible', cell: (r) => formatMoney(r.deductible, currency), align: 'right' },
  ]

  function download(kind: 'csv' | 'json') {
    const content = kind === 'csv' ? taxYearToCsv(summary!) : JSON.stringify(summary, null, 2)
    const blob = new Blob([content], { type: kind === 'csv' ? 'text/csv' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `officiating-tax-${activeYear}.${kind}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Tax year
          <select
            value={activeYear}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md px-2 py-1 text-xs"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => download('csv')}>Export CSV</Button>
        <Button onClick={() => download('json')}>Export JSON</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <HeroFigure
          label={`Net after deductions, ${activeYear}`}
          value={formatMoneyCompact(summary.netAfterDeductions, currency)}
          detail={`${formatMoney(summary.gross, currency)} gross, less ${formatMoney(
            summary.deductibleExpenses,
            currency,
          )} expenses and ${formatMoney(summary.mileage.deduction, currency)} mileage`}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile
            label="Gross received"
            value={formatMoneyCompact(summary.gross, currency)}
            detail={`${summary.activeGames} games worked`}
          />
          <StatTile
            label="Business miles"
            value={summary.mileage.miles.toLocaleString()}
            detail={
              summary.mileage.tripsMissingMiles > 0
                ? `${summary.mileage.tripsMissingMiles} trip${
                    summary.mileage.tripsMissingMiles === 1 ? ' has' : 's have'
                  } no mileage — this is a floor`
                : 'every trip has a figure'
            }
            {...(summary.mileage.tripsMissingMiles > 0
              ? { status: { role: 'warning' as const, label: 'Understated' } }
              : {})}
          />
          <StatTile
            label="Mileage deduction"
            value={formatMoneyCompact(summary.mileage.deduction, currency)}
            detail={`at ${summary.mileage.rate.toFixed(3)}/mile`}
            {...(rateMissing
              ? { status: { role: 'serious' as const, label: `No rate set for ${activeYear}` } }
              : {})}
          />
          <StatTile
            label="Deductible expenses"
            value={formatMoneyCompact(summary.deductibleExpenses, currency)}
            detail={`of ${formatMoney(summary.expensesTotal, currency)} logged`}
          />
          <StatTile
            label="Travel fees received"
            value={formatMoneyCompact(summary.travel, currency)}
            detail="a payor may report these separately"
          />
          <StatTile
            label="Cancelled games"
            value={String(summary.cancelledGames)}
            detail="no income, excluded here"
          />
        </div>
      </div>

      <Card
        title="Income by payor"
        subtitle="Compare each line against the 1099 that payor issued"
      >
        <DataTable rows={summary.byPayor} columns={payorColumns} />
        <p className="m-0 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          These figures recognize income on the game date, which is what the export carries. A 1099
          follows the payor's payment dates, so a late-December game paid in January will land in a
          different year on their form than on this page.
        </p>
      </Card>

      {summary.expensesByCategory.length > 0 ? (
        <Card title="Expenses by category" subtitle="Toll estimates are included as a deductible category">
          <DataTable rows={summary.expensesByCategory} columns={expenseColumns} />
        </Card>
      ) : null}

      <Card title="Mileage detail">
        <div className="flex flex-col gap-2 text-xs">
          <Row label="Round-trip miles on record" value={summary.mileage.miles.toLocaleString()} />
          <Row label="Rate for this year" value={`${summary.mileage.rate.toFixed(3)} per mile`} />
          <Row label="Standard mileage deduction" value={formatMoney(summary.mileage.deduction, currency)} />
          <Row label="Trips with a manual mileage figure" value={String(summary.mileage.tripsWithOverride)} />
          {summary.mileage.tripsMissingMiles > 0 ? (
            <div className="flex items-center gap-2">
              <StatusChip
                role="warning"
                label={
                  summary.mileage.tripsMissingMiles === 1
                    ? '1 trip has no mileage'
                    : `${summary.mileage.tripsMissingMiles} trips have no mileage`
                }
              />
              <span style={{ color: 'var(--text-secondary)' }}>
                Add one-way miles for those parks in Reference data to complete the figure.
              </span>
            </div>
          ) : null}
          {summary.mileage.multiTripDaysNeedingReview > 0 ? (
            <div className="flex items-center gap-2">
              <StatusChip
                role="warning"
                label={
                  summary.mileage.multiTripDaysNeedingReview === 1
                    ? '1 multi-park day needs review'
                    : `${summary.mileage.multiTripDaysNeedingReview} multi-park days need review`
                }
              />
              <span style={{ color: 'var(--text-secondary)' }}>
                Round-trip-per-park counts the drive home twice on a day with two parks. Enter the
                actual miles on those trips.
              </span>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="num-tabular" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}
