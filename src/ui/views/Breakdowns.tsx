/**
 * The dimension views: Venues, Partners, Leagues/Assignors.
 *
 * All three are horizontal bars in a single hue — nominal categories, so a value
 * ramp is wrong — paired with a table that carries the long tail. Partner data is
 * typically exactly the shape that makes this necessary: one regular partner far
 * ahead of a long tail of occasional ones.
 */

import { useMemo } from 'react'
import { useStore } from '../store'
import { HorizontalBar } from '../charts/Charts'
import { Card, EmptyState, StatTile } from '../components/Tiles'
import { DataTable, type TableColumn } from '../charts/ChartFrame'
import { byAssignor, byCall, byLeague, byPark, byPartner, bySport, type Breakdown } from '../../derive/metrics'
import { formatMoney, formatMoneyCompact } from '../../derive/money'
import { formatMinutes } from '../../derive/time'

function useBreakdownTable(currency: string): TableColumn<Breakdown>[] {
  return useMemo(
    () => [
      { key: 'label', header: 'Name', cell: (r) => r.label },
      { key: 'games', header: 'Games', cell: (r) => String(r.games), align: 'right' },
      { key: 'gross', header: 'Income', cell: (r) => formatMoney(r.gross, currency), align: 'right' },
      { key: 'minutes', header: 'Time', cell: (r) => formatMinutes(r.minutes), align: 'right' },
      {
        key: 'perHour',
        header: 'Per hour',
        cell: (r) => (r.perHour == null ? '—' : formatMoney(r.perHour, currency)),
        align: 'right',
      },
      {
        key: 'perGame',
        header: 'Per game',
        cell: (r) => (r.perGame == null ? '—' : formatMoney(r.perGame, currency)),
        align: 'right',
      },
      {
        key: 'incomplete',
        header: 'Missing duration',
        cell: (r) => (r.incompleteGames > 0 ? String(r.incompleteGames) : '—'),
        align: 'right',
      },
    ],
    [currency],
  )
}

export function Venues() {
  const { derived } = useStore()
  const ctx = derived?.breakdownCtx
  const rows = useMemo(() => (ctx ? byPark(ctx) : []), [ctx])
  const currency = derived?.money.currency ?? 'USD'
  const columns = useBreakdownTable(currency)

  if (!derived) return null
  if (rows.length === 0) {
    return <EmptyState title="No trips in this range" body="Widen the period filter, or import more games." />
  }

  const parkColumns: TableColumn<Breakdown>[] = [
    ...columns,
    { key: 'trips', header: 'Trips', cell: (r) => String(r.trips ?? 0), align: 'right' },
    {
      key: 'miles',
      header: 'Miles',
      cell: (r) => {
        if (r.miles == null) return 'not on record'
        const short = r.tripsMissingMiles ?? 0
        return short > 0 ? `${r.miles.toLocaleString()} (${short} trips short)` : r.miles.toLocaleString()
      },
      align: 'right',
    },
    {
      key: 'tolls',
      header: 'Tolls & expenses',
      cell: (r) => formatMoney(r.tolls ?? 0, currency),
      align: 'right',
    },
  ]

  const topRate = [...rows].filter((r) => r.perHour != null).sort((a, b) => b.perHour! - a.perHour!)[0]
  const mostMiles = [...rows].sort((a, b) => (b.miles ?? 0) - (a.miles ?? 0))[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Parks worked" value={String(rows.length)} detail={`${derived.trips.length} trips`} />
        <StatTile
          label="Best rate per hour"
          value={topRate ? formatMoney(topRate.perHour, currency) : '—'}
          detail={topRate?.label}
        />
        <StatTile
          label="Most driving"
          value={mostMiles?.miles ? `${mostMiles.miles.toLocaleString()} mi` : '—'}
          detail={mostMiles?.label}
          {...(rows.some((r) => r.miles == null)
            ? {
                status: {
                  role: 'warning' as const,
                  label: `${rows.filter((r) => r.miles == null).length} parks have no mileage`,
                },
              }
            : {})}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HorizontalBar
          title="Income by park"
          subtitle="Actual fees, grouped by resolved park"
          rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.gross }))}
          format={(n) => formatMoneyCompact(n, currency)}
          valueHeader="Income"
          slot={1}
          maxRows={16}
        />
        <HorizontalBar
          title="Rate per hour by park"
          subtitle="Against the selected time model"
          rows={rows.filter((r) => r.perHour != null).map((r) => ({ key: r.key, label: r.label, value: r.perHour! }))}
          format={(n) => formatMoney(n, currency)}
          valueHeader="Per hour"
          slot={1}
          maxRows={16}
          footnote="Parks whose games have no known duration are omitted; enter durations in Reference data to include them."
        />
      </div>

      <Card title="All parks" subtitle="Miles and tolls are per trip, so they never double-count a shared drive">
        <div className="overflow-auto">
          <DataTable rows={rows} columns={parkColumns} />
        </div>
      </Card>
    </div>
  )
}

export function Partners() {
  const { derived } = useStore()
  const ctx = derived?.breakdownCtx
  const rows = useMemo(() => (ctx ? byPartner(ctx) : []), [ctx])
  const currency = derived?.money.currency ?? 'USD'
  const columns = useBreakdownTable(currency)

  if (!derived) return null
  if (rows.length === 0) {
    return <EmptyState title="No games in this range" body="Widen the period filter, or import more games." />
  }

  const solo = rows.find((r) => r.key === '(solo)')
  const named = rows.filter((r) => r.key !== '(solo)')
  const top = [...named].sort((a, b) => b.games - a.games)[0]

  // Breakdowns are built from trips, which exclude cancellations. A partner you
  // only ever had on a rained-out game therefore does not appear here — say so
  // rather than letting the count look wrong against the raw file.
  const cancelledPartners = new Set(
    derived.cancelled.flatMap((r) => r.partners.map((p) => p.key)),
  )
  const onlyInCancelled = [...cancelledPartners].filter(
    (key) => !named.some((r) => r.key === key),
  ).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Distinct partners"
          value={String(named.length)}
          detail={
            onlyInCancelled > 0
              ? `${onlyInCancelled} more appear only on cancelled games, which are excluded`
              : 'on games actually worked'
          }
        />
        <StatTile
          label="Most frequent partner"
          value={top?.label ?? '—'}
          detail={top ? `${top.games} games, ${formatMoney(top.gross, currency)}` : undefined}
        />
        <StatTile
          label="Solo games"
          value={String(solo?.games ?? 0)}
          detail={solo ? `${formatMoney(solo.gross, currency)} worked alone` : undefined}
        />
      </div>

      <HorizontalBar
        title="Games by partner"
        subtitle="Derived per game as the official in the other slot"
        rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.games }))}
        format={(n) => n.toLocaleString()}
        valueHeader="Games"
        slot={1}
        maxRows={10}
        footnote="A game with two partners counts toward both, so this column can sum above the game count."
      />

      <Card
        title="All partners"
        subtitle="One partner dominates and the rest form a long tail, so the table carries the detail"
      >
        <div className="overflow-auto" style={{ maxHeight: 460 }}>
          <DataTable rows={rows} columns={columns} />
        </div>
      </Card>
    </div>
  )
}

export function Leagues() {
  const { derived } = useStore()
  const ctx = derived?.breakdownCtx
  const leagues = useMemo(() => (ctx ? byLeague(ctx) : []), [ctx])
  const assignors = useMemo(() => (ctx ? byAssignor(ctx) : []), [ctx])
  const sports = useMemo(
    () =>
      ctx && derived
        ? bySport(ctx, (code) => derived.snapshot.sports.find((s) => s.code === code)?.label ?? code)
        : [],
    [ctx, derived],
  )
  const calls = useMemo(
    () => (ctx && derived ? byCall(ctx, derived.snapshot.callTypes) : []),
    [ctx, derived],
  )
  const currency = derived?.money.currency ?? 'USD'
  const columns = useBreakdownTable(currency)

  if (!derived) return null
  if (leagues.length === 0) {
    return <EmptyState title="No games in this range" body="Widen the period filter, or import more games." />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <HorizontalBar
          title="Income by league"
          rows={leagues.map((r) => ({ key: r.key, label: r.label, value: r.gross }))}
          format={(n) => formatMoneyCompact(n, currency)}
          valueHeader="Income"
          slot={1}
          maxRows={12}
        />
        <HorizontalBar
          title="Income by sport"
          subtitle="Sport comes from the source's own code"
          rows={sports.map((r) => ({ key: r.key, label: r.label, value: r.gross }))}
          format={(n) => formatMoneyCompact(n, currency)}
          valueHeader="Income"
          slot={1}
          maxRows={8}
        />
      </div>

      {/* Until something is tagged, a chart of zero-length bars reads as "no calls
          were made" rather than "none recorded yet" — so the hint stands alone. */}
      {calls.every((r) => r.games === 0) ? (
        <Card title="Calls recorded" subtitle="Rare calls tagged on a game.">
          <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            None tagged yet. Open a trip and tick the calls that happened, or add types under
            Reference data → Call types.
          </p>
        </Card>
      ) : (
        <HorizontalBar
          title="Calls recorded"
          subtitle="Rare calls tagged on a game. A game with two tags counts toward both."
          rows={calls.map((r) => ({ key: r.key, label: r.label, value: r.games }))}
          format={(n) => n.toLocaleString()}
          valueHeader="Games"
          slot={1}
          maxRows={12}
        />
      )}

      <Card title="Assignors" subtitle="Who assigned the work">
        <div className="overflow-auto">
          <DataTable rows={assignors} columns={columns} />
        </div>
      </Card>

      <Card title="All leagues">
        <div className="overflow-auto" style={{ maxHeight: 420 }}>
          <DataTable rows={leagues} columns={columns} />
        </div>
      </Card>
    </div>
  )
}
