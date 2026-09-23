/**
 * Cancellations, reported separately because they are excluded from every metric.
 *
 * The scheduled-vs-actual variance goes here as a diverging bar around zero: the
 * two directions are genuinely opposite in meaning (pay lost against pay gained),
 * which is what a diverging scale is for.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { DivergingBar, HorizontalBar } from '../charts/Charts'
import { Card, EmptyState, StatTile } from '../components/Tiles'
import { DataTable, type TableColumn } from '../charts/ChartFrame'
import { cancellationSummary } from '../../derive/metrics'
import {
  feeReconciliation,
  formatMoney,
  formatMoneyCompact,
  formatMoneySigned,
} from '../../derive/money'
import { abbreviateLabel, abbreviateLabels } from '../../derive/labels'
import type { Game } from '../../model/game'

/**
 * Trims a venue string to something that fits one axis line.
 *
 * Generic on purpose. This previously stripped two specific league prefixes by
 * name, which fitted one person's data and did nothing for anyone else's — so the
 * field designator and the filler word go, and `abbreviateLabel` handles the rest
 * by dropping uninformative words before it will truncate.
 */
function shortenVenue(venue: string): string {
  const compact = venue
    // '(Field 12)' -> 'F12', and a trailing 'Field 3' the same way.
    .replace(/\s*[([]?\bfields?\s*#?\s*([A-Za-z0-9]+)[)\]]?\s*$/i, ' F$1')
    .replace(/\bPark\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return abbreviateLabel(compact, 22)
}

export function Cancellations() {
  const { derived } = useStore()

  const summary = useMemo(
    () => (derived ? cancellationSummary(derived.resolved, derived.snapshot.settings) : null),
    [derived],
  )
  /**
   * Two sets, deliberately. The chart plots only the games whose fee differed — a
   * bar of zero is not a variance, and 180 of them would drown the 22 that are. The
   * table can show every game, because the question it answers is "does this add
   * up", and a total cannot be checked against a list that omits most rows.
   */
  const allFees = useMemo(
    () => (derived ? feeReconciliation(derived.resolved.map((r) => r.game)) : []),
    [derived],
  )
  const variances = useMemo(() => allFees.filter((v) => v.delta !== 0), [allFees])
  const [showAll, setShowAll] = useState(false)
  const tableRows = showAll ? allFees : variances
  const leagueLabels = useMemo(
    () => abbreviateLabels((summary?.byLeague ?? []).map((l) => l.label)),
    [summary],
  )

  if (!derived || !summary) return null
  const currency = derived.money.currency

  if (summary.count === 0 && variances.length === 0) {
    return (
      <EmptyState
        title="No cancellations or fee adjustments"
        body="Every game in this range was worked at its scheduled fee."
      />
    )
  }

  const columns: TableColumn<{ game: Game; scheduled: number; actual: number; delta: number }>[] = [
    { key: 'date', header: 'Date', cell: (r) => r.game.date },
    { key: 'venue', header: 'Venue', cell: (r) => r.game.venueRaw },
    { key: 'group', header: 'Age group', cell: (r) => r.game.ageGroupRaw },
    { key: 'status', header: 'Status', cell: (r) => r.game.status },
    { key: 'scheduled', header: 'Scheduled', cell: (r) => formatMoney(r.scheduled, currency), align: 'right' },
    { key: 'actual', header: 'Actual', cell: (r) => formatMoney(r.actual, currency), align: 'right' },
    {
      key: 'delta',
      header: 'Variance',
      // Signed, and an em dash rather than "$0" where there is no variance: with
      // unchanged games in the table, a column of $0 reads as data to scan rather
      // than as the absence of a gap. A plain string, because `cell` is typed to
      // return one on purpose — these values come from a CSV and must never be
      // rendered as markup.
      cell: (r) => (r.delta === 0 ? '—' : formatMoneySigned(r.delta, currency)),
      align: 'right',
    },
  ]

  const up = variances.filter((v) => v.delta > 0)
  const down = variances.filter((v) => v.delta < 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile
          label="Cancelled games"
          value={String(summary.count)}
          detail={`of ${derived.resolved.length} in range`}
        />
        <StatTile
          label="Pay forfeited"
          value={formatMoneyCompact(summary.forfeited, currency)}
          detail="scheduled fees never received"
        />
        <StatTile
          label="Paid above rate"
          value={formatMoneyCompact(derived.money.bonus, currency)}
          detail={`${up.length} games paid more than scheduled`}
        />
        {/*
          `netFeeVariance` is `scheduled - gross`, so it is POSITIVE when money was
          lost. Negated here so the sign reads the way money does: a shortfall shows
          as −$346, a surplus as +$346. Printing the raw figure with a sign would
          have inverted the meaning.
        */}
        <StatTile
          label="Net variance"
          value={formatMoneySigned(-derived.money.netFeeVariance, currency)}
          detail={
            derived.money.netFeeVariance > 0
              ? 'less arrived than was scheduled'
              : derived.money.netFeeVariance < 0
                ? 'more arrived than was scheduled'
                : 'every game paid its scheduled fee'
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DivergingBar
          title="Scheduled vs actual fee"
          subtitle="Each game whose fee differed from its assignment"
          rows={variances.map((v) => ({
            key: v.game.id,
            // Short enough to stay on one line in the y-axis band; the table
            // view carries the full venue string.
            label: `${v.game.date.slice(5)} ${shortenVenue(v.game.venueRaw)}`,
            value: v.delta,
            detail: `${formatMoney(v.scheduled, currency)} scheduled, ${formatMoney(v.actual, currency)} actual`,
          }))}
          format={(n) => formatMoney(n, currency)}
          negativeLabel="Lost"
          positiveLabel="Gained"
          footnote={`${down.length} games paid less than scheduled, ${up.length} paid more.`}
        />

        {/*
          The key is abbreviated; the tooltip and table view carry the full name, so
          nothing is lost. `abbreviateLabels` falls back to full names for any pair
          that would collide — two leagues sharing a label is worse than long ones.
        */}
        <HorizontalBar
          title="Forfeited pay by league"
          subtitle="Which leagues cancel most"
          rows={summary.byLeague.map((l) => ({
            key: l.label,
            label: leagueLabels.get(l.label) ?? l.label,
            value: l.forfeited,
            detail: l.label,
          }))}
          format={(n) => formatMoneyCompact(n, currency)}
          valueHeader="Forfeited"
          slot={2}
          maxRows={10}
          extraColumns={[
            {
              key: 'count',
              header: 'Games',
              cell: (r) => String(summary.byLeague.find((l) => l.label === r.key)?.count ?? 0),
              align: 'right',
            },
          ]}
        />
      </div>

      <Card
        title={showAll ? 'Every game and its fee' : 'Every fee variance'}
        subtitle={
          showAll
            ? `Actual fee is the truth for income. These ${allFees.length} rows total ${formatMoney(
                allFees.reduce((n, v) => n + v.actual, 0),
                currency,
              )}, which is the gross figure on the Overview.`
            : 'Actual fee is the truth for income; this table is the audit trail for the gap'
        }
        action={
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Include games paid as scheduled
          </label>
        }
      >
        <div className="overflow-auto" style={{ maxHeight: 460 }}>
          <DataTable rows={tableRows} columns={columns} />
        </div>
      </Card>
    </div>
  )
}
