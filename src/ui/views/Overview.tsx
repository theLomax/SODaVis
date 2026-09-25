/**
 * Overview. A hero net take-home, a KPI row, income by month as columns, and the
 * $/hr trend as a line — plus the time-model comparison, which is the one chart
 * that makes the three definitions of "time worked" legible side by side.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { HeroFigure, StatTile, EmptyState, StatusChip } from '../components/Tiles'
import { Dialog } from '../components/Dialog'
import { ChartOption } from '../components/Controls'
import { ColumnChart, GroupedBar, SplitBar, StackedColumn, TrendLine } from '../charts/Charts'
import {
  byDayOfWeek,
  byMonth,
  byMonthBySport,
  drillPeriod,
  monthLongLabel,
  weekdayWeekendSplit,
  type MonthPoint,
} from '../../derive/metrics'
import { formatMoney, formatMoneyCompact, totalMiles } from '../../derive/money'
import { formatMinutes, minutesToHours, TIME_MODELS, type UntimedTrip } from '../../derive/time'
import { flagMarker } from '../flags'
import { seriesVar, sportSlot, UNSPECIFIED_SPORT } from '../charts/palette'
import type { SportProfile, TimeModelId } from '../../model/reference'

export function Overview() {
  const { derived, filter, drillDown } = useStore()
  const breakdownCtx = derived?.breakdownCtx
  const trips = derived?.trips
  /** Open when the reader asks which trips the selected model could not time. */
  const [showUntimed, setShowUntimed] = useState(false)

  // Hooks run before any early return, so the hook order never changes.
  const months = useMemo(() => (breakdownCtx ? byMonth(breakdownCtx) : []), [breakdownCtx])

  /**
   * Split the income chart by sport once more than one sport is in play — a single
   * stacked column would otherwise silently sum them. With one sport selected (or
   * with no filter at all, where the split would be every sport at once) the totals
   * series is the clearer read.
   */
  /**
   * What "Income by month" plots. Every measure below is already on `MonthPoint`,
   * so this is a choice of field rather than a second aggregation — and the y-axis
   * is relabelled with it, because a column chart of hours that still says Income
   * is worse than no toggle at all.
   */
  const [monthMeasure, setMonthMeasure] = useState<MonthMeasure>('gross')
  /** What "Rate per hour" divides by. */
  const [rateMeasure, setRateMeasure] = useState<RateMeasure>('hour')

  const splitBySport = filter.sportCodes.length > 1
  const monthsBySport = useMemo(
    () =>
      breakdownCtx && splitBySport
        ? byMonthBySport(breakdownCtx, filter.sportCodes)
        : { rows: [], series: [] },
    [breakdownCtx, splitBySport, filter.sportCodes],
  )
  const split = useMemo(
    () =>
      breakdownCtx
        ? weekdayWeekendSplit(breakdownCtx)
        : { weekday: { games: 0, gross: 0, minutes: 0 }, weekend: { games: 0, gross: 0, minutes: 0 } },
    [breakdownCtx],
  )
  const dayRows = useMemo(
    () => (breakdownCtx ? byDayOfWeek(breakdownCtx) : []),
    [breakdownCtx],
  )
  /** Names the peak rather than labelling all seven columns. */
  const busiestDay = useMemo(() => {
    const worked = dayRows.filter((d) => d.games > 0)
    if (worked.length === 0) return ''
    const peak = worked.reduce((best, d) => (d.games > best.games ? d : best), worked[0]!)
    const share = Math.round((peak.games / worked.reduce((n, d) => n + d.games, 0)) * 100)
    const idle = dayRows.filter((d) => d.games === 0).map((d) => d.label.slice(0, 3))
    return `${peak.label} carries ${share}% of the work.${
      idle.length ? ` No games on ${idle.join(', ')}.` : ''
    }`
  }, [dayRows])
  const miles = useMemo(() => totalMiles(trips ?? []), [trips])

  if (!derived || !trips) return null
  const { money, time, rates, snapshot } = derived

  if (snapshot.games.length === 0) {
    return (
      <EmptyState
        title="No games yet"
        body="Import an Assignr or RefTown export from the Import view to get started. Your data stays on this machine."
      />
    )
  }

  const currency = money.currency
  const sportLabel = (code: string) => sportLabelFrom(snapshot.sports, code)
  const selectedModel = TIME_MODELS.find((m) => m.id === filter.model)!
  const perHour = rates.grossPerHourByModel[filter.model]
  const netPerHour = rates.netPerHourByModel[filter.model]

  /**
   * A month's column or point opens Trips for that month. Navigating rather than
   * filtering in place: every chart here would redraw as a single month, which is
   * not what clicking one column asks for. The sport and park filters carry over,
   * since they shaped the column that was clicked.
   */
  const monthDrill = {
    action: 'See trips',
    hint: 'Click a month to see its trips.',
    onSelect: (month: string) =>
      drillDown({
        view: 'trips',
        filter: { period: drillPeriod(month, filter.period) },
        label: monthLongLabel(month),
      }),
  }
  const incomplete = time.incompleteByModel[filter.model]
  const untimed = time.untimedByModel[filter.model]

  const counted = rates.tripsCountedByModel[filter.model]
  const incompleteNote =
    incomplete > 0
      ? `Based on the ${counted} of ${trips.length} trips this model can time. The other ${incomplete} are missing a game duration or a drive figure, and both their time and their income are left out — so the rate is not diluted by them. Click "${incomplete} trips not timed" above to see which, and to fix each one.`
      : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <HeroFigure
          label="Net take-home"
          value={formatMoneyCompact(money.net, currency)}
          detail={`${formatMoney(money.gross, currency)} gross, less ${formatMoney(
            money.tolls + money.expenses,
            currency,
          )} tolls and expenses`}
        >
          {netPerHour != null ? (
            <p className="m-0 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatMoney(netPerHour, currency)}/hr under {selectedModel.label.toLowerCase()}
              {incomplete > 0 ? `, over the ${counted} trips it can time` : ''}
            </p>
          ) : null}
        </HeroFigure>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile
            label="Gross income"
            value={formatMoneyCompact(money.gross, currency)}
            detail={`${money.activeGames} games worked`}
          />
          <StatTile
            label={`Rate per hour (${selectedModel.label.toLowerCase()})`}
            value={perHour == null ? '—' : formatMoney(perHour, currency)}
            detail={
              incomplete > 0
                ? `${minutesToHours(time.byModel[filter.model]).toLocaleString()} hours over ${counted} of ${trips.length} trips`
                : `${minutesToHours(time.byModel[filter.model]).toLocaleString()} hours`
            }
            {...(incomplete > 0
              ? {
                  status: {
                    role: 'warning' as const,
                    label: `${incomplete} trip${incomplete === 1 ? '' : 's'} not timed`,
                    // The count is the entry point: clicking it names the trips and
                    // the field that would time each one.
                    onClick: () => setShowUntimed(true),
                    opensDialog: true,
                    title: 'Open to see which trips, and what each one is missing',
                  },
                }
              : {})}
          />
          <StatTile
            label="Per game"
            value={rates.perGame == null ? '—' : formatMoney(rates.perGame, currency)}
            detail={`${trips.length} trips, ${formatMoney(rates.perTrip, currency)} per trip`}
          />
          <StatTile
            label="Time worked"
            value={formatMinutes(time.byModel[filter.model])}
            detail={`${formatMinutes(time.driveMinutes)} driving, ${formatMinutes(
              time.prepMinutes + time.wrapMinutes,
            )} prep and wrap`}
          />
          <StatTile
            label="Round-trip miles"
            value={miles.miles.toLocaleString()}
            detail={
              miles.tripsMissing > 0
                ? `${miles.tripsMissing} trips have no mileage on record`
                : 'every trip has a mileage figure'
            }
            {...(miles.tripsMissing > 0
              ? { status: { role: 'warning' as const, label: 'Incomplete' } }
              : {})}
          />
          <StatTile
            label="Forfeited to cancellations"
            value={formatMoneyCompact(money.forfeited, currency)}
            detail={`${money.cancelledGames} cancelled; ${formatMoney(
              money.bonus,
              currency,
            )} earned above rate${
              money.unscheduledIncome > 0
                ? ` and ${formatMoney(money.unscheduledIncome, currency)} from games with no rate`
                : ''
            } offsets it to ${formatMoney(money.netFeeVariance, currency)}`}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/*
          The sport split only applies to income: stacking hours by sport would be
          legible but answers a question nobody asked, so choosing another measure
          drops back to the totals series.
        */}
        {splitBySport && monthMeasure === 'gross' ? (
          <StackedColumn
            title="Income by month"
            subtitle={`Actual fees, split across ${monthsBySport.series.length} sports`}
            rows={monthsBySport.rows.map((r) => ({ ...r, key: r.month }))}
            series={monthsBySport.series.map((code) => ({
              key: code,
              label: sportLabel(code),
              slot: sportSlot(code),
            }))}
            format={(n) => formatMoneyCompact(n, currency)}
            action={
              <ChartOption
                value={monthMeasure}
                options={MONTH_MEASURES}
                onChange={setMonthMeasure}
                ariaLabel="Measure for the monthly chart"
              />
            }
            footnote="Each sport keeps its colour from the Sport filter above, so the key is the same in both places."
            drill={monthDrill}
          />
        ) : (
          <ColumnChart
            title={`${measureTitle(monthMeasure)} by month`}
            subtitle={measureSubtitle(monthMeasure, selectedModel.label)}
            rows={months.map((m) => ({
              key: m.month,
              label: m.label,
              value: monthValue(m, monthMeasure),
            }))}
            format={(n) => formatMeasure(n, monthMeasure, currency)}
            valueHeader={measureTitle(monthMeasure)}
            action={
              <ChartOption
                value={monthMeasure}
                options={MONTH_MEASURES}
                onChange={setMonthMeasure}
                ariaLabel="Measure for the monthly chart"
              />
            }
            extraColumns={[
              {
                key: 'games',
                header: 'Games',
                cell: (r) => String(months.find((m) => m.month === r.key)?.games ?? 0),
                align: 'right',
              },
            ]}
            {...(splitBySport
              ? {
                  footnote:
                    'Showing totals rather than the sport split: only income stacks meaningfully by sport.',
                }
              : {})}
            drill={monthDrill}
          />
        )}

        <TrendLine
          title={`${RATE_TITLES[rateMeasure]} by month`}
          subtitle={rateMeasure === 'game' ? 'Income divided by games worked' : selectedModel.description}
          rows={months.map((m) => ({
            key: m.month,
            label: m.label,
            value: rateValue(m, rateMeasure),
          }))}
          format={(n) => formatMoney(n, currency)}
          valueHeader={RATE_TITLES[rateMeasure]}
          action={
            <ChartOption
              value={rateMeasure}
              options={RATE_MEASURES}
              onChange={setRateMeasure}
              ariaLabel="Rate basis for the monthly chart"
            />
          }
          footnote={[
            // Rate per game needs no duration, so the untimed caveat is only true
            // of the two time-based bases.
            rateMeasure !== 'game' && months.some((m) => m.perHour == null && m.games > 0)
              ? `${months.filter((m) => m.perHour == null && m.games > 0).length} month(s) had games but no resolvable duration, so they show no rate rather than a misleading one.`
              : '',
            rateMeasure === 'game' ? '' : (incompleteNote ?? ''),
          ]
            .filter(Boolean)
            .join(' ')}
          drill={monthDrill}
        />

        <TimeModelComparison />

        {/*
          One bar per measure, because time and money do not share proportions: 64%
          of the time earning 58% of the money is the finding, and a single bar would
          have to pick one of those lengths and mislabel the other. The time follows
          the global model selector, so this panel cannot disagree with the rate
          tiles about what an hour means.
        */}
        <SplitBar
          title="Weekday vs Weekend"
          subtitle={`Time and income, against ${selectedModel.label.toLowerCase()}`}
          parts={[
            { key: 'weekday', label: 'Weekday', value: split.weekday.gross, slot: 1 },
            { key: 'weekend', label: 'Weekend', value: split.weekend.gross, slot: 2 },
          ]}
          format={(n) => formatMoneyCompact(n, currency)}
          valueLabel="Income"
          secondary={{
            label: `Time — ${selectedModel.label.toLowerCase()}`,
            values: { weekday: split.weekday.minutes, weekend: split.weekend.minutes },
            format: (n) => formatMinutes(n),
          }}
          footnote={`${split.weekday.games} weekday games, ${split.weekend.games} weekend games. Time is ${selectedModel.label.toLowerCase()}; change the model in the filter bar to compare.`}
        />

        {/*
          Ordered categories, so one hue and more-is-taller rather than a colour
          per day: the days have a natural order and colouring them would burn the
          only free channel on information the bar length already carries.
        */}
        <ColumnChart
          title="Games by day of week"
          subtitle="Which days the work actually falls on"
          rows={dayRows.map((d) => ({
            key: String(d.day),
            // Three letters on the axis; the full day name in the tooltip.
            label: d.label.slice(0, 3),
            value: d.games,
            detail: d.label,
          }))}
          format={(n) => String(n)}
          valueHeader="Games"
          extraColumns={[
            {
              key: 'gross',
              header: 'Income',
              cell: (r) =>
                formatMoneyCompact(
                  dayRows.find((d) => String(d.day) === r.key)?.gross ?? 0,
                  currency,
                ),
              align: 'right',
            },
            {
              key: 'trips',
              header: 'Trips',
              cell: (r) => String(dayRows.find((d) => String(d.day) === r.key)?.trips ?? 0),
              align: 'right',
            },
          ]}
          footnote={busiestDay}
        />
      </div>

      <DataQualityBanner />

      <UntimedTripsDialog
        open={showUntimed}
        onClose={() => setShowUntimed(false)}
        modelLabel={selectedModel.label}
        trips={untimed}
        totalTrips={trips.length}
        currency={currency}
      />
    </div>
  )
}

/**
 * Which trips the selected model could not time, and the one field that fixes
 * each.
 *
 * This exists because "8 trips not timed" is a true statement a reader can do
 * nothing with. Each row names the park, the date, the income left out of the rate
 * with the time, and a button to the exact input — the park's mileage, or the age
 * group's duration. A trip missing both gets both buttons.
 */
function UntimedTripsDialog({
  open,
  onClose,
  modelLabel,
  trips,
  totalTrips,
  currency,
}: {
  open: boolean
  onClose: () => void
  modelLabel: string
  trips: UntimedTrip[]
  totalTrips: number
  currency: string
}) {
  const { navigate } = useStore()
  const strandedGross = trips.reduce((s, t) => s + t.gross, 0)

  const go = (target: Parameters<typeof navigate>[0]) => {
    navigate(target)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${trips.length} of ${totalTrips} trips have no ${modelLabel.toLowerCase()}`}
      titleMarker={flagMarker('warning')}
      subtitle={`${formatMoney(strandedGross, currency)} of income sits outside the rate along with the time. Fill the missing figure and both come back.`}
      labelledBy="untimed-trips-heading"
    >
      {trips.length === 0 ? (
        <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Every trip in range has the figures this model needs.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {trips.map((t) => (
            <li
              key={t.tripKey}
              className="flex flex-col gap-1.5 rounded-lg px-3 py-2"
              style={{
                background: 'var(--surface-page)',
                border: '1px solid var(--border-hairline)',
              }}
            >
              <span className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t.parkName}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>{t.date}</span>
                <span className="num-tabular" style={{ color: 'var(--text-muted)' }}>
                  {formatMoney(t.gross, currency)} excluded
                </span>
              </span>

              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {missingText(t)}
              </span>

              <span className="flex flex-wrap gap-2">
                {t.missing.drive ? (
                  <FixButton
                    label={`Enter miles for ${t.parkName}`}
                    onClick={() =>
                      go({
                        view: 'reference',
                        tab: 'parks',
                        label: 'Reference data → Parks & mileage',
                        focus: t.parkId,
                      })
                    }
                  />
                ) : null}
                {t.missing.duration ? (
                  <FixButton
                    label={
                      t.ageGroupsMissingDuration.length === 1
                        ? `Enter a duration for ${t.ageGroupsMissingDuration[0]}`
                        : `Enter durations for ${t.ageGroupsMissingDuration.length} age groups`
                    }
                    onClick={() =>
                      go({
                        view: 'reference',
                        tab: 'durations',
                        label: 'Reference data → Game durations',
                        // The first group is where the reader lands; the rest sort
                        // to the top of that table anyway, since it puts unfilled
                        // rows first.
                        ...(t.ageGroupsMissingDuration[0]
                          ? { focus: t.ageGroupsMissingDuration[0] }
                          : {}),
                      })
                    }
                  />
                ) : null}
                <FixButton
                  label="Open the trip"
                  onClick={() => go({ view: 'trips', label: 'Trips', focus: t.tripKey })}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

/** What this trip is missing, as a sentence rather than two booleans. */
function missingText(t: UntimedTrip): string {
  const parts: string[] = []
  if (t.missing.drive) {
    parts.push('no drive time, because the park has no mileage on record to estimate it from')
  }
  if (t.missing.duration) {
    const groups = t.ageGroupsMissingDuration
    parts.push(
      `no duration for ${t.gamesMissingDuration} game${t.gamesMissingDuration === 1 ? '' : 's'}` +
        (groups.length ? ` (${groups.join(', ')})` : ''),
    )
  }
  return parts.length ? `Missing: ${parts.join('; and ')}.` : 'Missing an input for this model.'
}

function FixButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-xs font-medium"
      style={{
        background: 'var(--surface-1)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-hairline)',
      }}
    >
      {label}
    </button>
  )
}

/**
 * The three time models as a grouped bar: one measure (hours) across three
 * series, on one axis. Hours and rate-per-hour are NOT plotted together — two
 * measures of different scale would be a dual-axis chart in disguise, so the
 * rate for each model is reported beside it as its own row of figures.
 */
function TimeModelComparison() {
  const { derived } = useStore()
  const breakdownCtx = derived?.breakdownCtx

  const rows = useMemo(() => {
    if (!breakdownCtx) return []
    const perModel = (['game', 'game-drive', 'committed'] as const).map((model) => ({
      model,
      months: byMonth({ ...breakdownCtx, model }),
    }))
    const labels = perModel[0]!.months
    return labels.map((m, i) => ({
      key: m.month,
      label: m.label,
      game: minutesToHours(perModel[0]!.months[i]?.minutes ?? 0),
      'game-drive': minutesToHours(perModel[1]!.months[i]?.minutes ?? 0),
      committed: minutesToHours(perModel[2]!.months[i]?.minutes ?? 0),
    }))
  }, [breakdownCtx])

  if (!derived) return null
  const { time, money, rates, trips } = derived

  // Read the rate from the shared derive layer rather than recomputing it here,
  // so this strip cannot drift from the KPI tile above it.
  const rateFor = (model: TimeModelId) => {
    const rate = rates.grossPerHourByModel[model]
    return rate == null ? '—' : formatMoney(rate, money.currency)
  }

  return (
    <div className="flex flex-col gap-3">
      <GroupedBar
        title="Hours by time model"
        subtitle="One measure, three definitions of time worked"
        rows={rows}
        series={[
          { key: 'game', label: 'Game time', slot: 1 },
          { key: 'game-drive', label: 'Game + drive', slot: 2 },
          { key: 'committed', label: 'Committed', slot: 3 },
        ]}
        format={(n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        footnote="Committed time includes drive, prep, wrap and the downtime between games, so it is always the largest and gives the lowest rate."
      />
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        {TIME_MODELS.map((m, i) => (
          <div key={m.id} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span
                aria-hidden="true"
                className="inline-block rounded-sm"
                style={{ width: 10, height: 10, background: seriesVar(i + 1) }}
              />
              {m.label}
            </span>
            <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {rateFor(m.id)}
              <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                {' '}
                / hr
              </span>
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatMinutes(time.byModel[m.id])} over{' '}
              {rates.tripsCountedByModel[m.id]} of {trips.length} trips
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A compact banner so data problems are visible without opening a view. */
function DataQualityBanner() {
  const { derived } = useStore()
  if (!derived) return null

  const counts = new Map<string, number>()
  for (const r of derived.allResolved) {
    for (const f of r.flags) counts.set(f.code, (counts.get(f.code) ?? 0) + 1)
  }
  for (const t of derived.trips) {
    for (const f of t.flags) counts.set(f.code, (counts.get(f.code) ?? 0) + 1)
  }

  const items: { role: 'warning' | 'serious'; label: string }[] = []
  const unmatched = counts.get('unmatched-venue') ?? 0
  const missingDuration = counts.get('missing-duration') ?? 0
  const crew = counts.get('crew-pattern-mismatch') ?? 0
  const multiTrip = counts.get('multi-trip-day') ?? 0

  if (unmatched) items.push({ role: 'serious', label: `${unmatched} games at an unmatched venue` })
  if (missingDuration) items.push({ role: 'warning', label: `${missingDuration} games with no duration` })
  if (crew) items.push({ role: 'warning', label: `${crew} crew-size mismatches` })
  if (multiTrip) items.push({ role: 'warning', label: `${multiTrip} trips needing a mileage figure` })

  if (items.length === 0) return null

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
        Data quality
      </span>
      {items.map((i) => (
        <StatusChip key={i.label} role={i.role} label={i.label} />
      ))}
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Open the Data quality view to resolve these.
      </span>
    </div>
  )
}


/**
 * Sport code -> label, matching what the Sport filter shows so the two read as one
 * key. Lives here rather than in the store because it is a pure lookup.
 */
export function sportLabelFrom(sports: SportProfile[], code: string): string {
  if (code === UNSPECIFIED_SPORT) return 'Unspecified'
  return sports.find((sp) => sp.code === code)?.label ?? code
}

// ---------------------------------------------------------------------------
// Monthly chart measures
// ---------------------------------------------------------------------------

/**
 * What the monthly column chart plots. Every one of these is already a field on
 * `MonthPoint`, so switching between them is a choice of field rather than another
 * pass over the trips.
 */
type MonthMeasure = 'gross' | 'hours' | 'gameMinutes' | 'daysWorked' | 'games'

const MONTH_MEASURES: { value: MonthMeasure; label: string }[] = [
  { value: 'gross', label: 'Income' },
  { value: 'hours', label: 'Hours worked' },
  { value: 'gameMinutes', label: 'Game minutes' },
  { value: 'daysWorked', label: 'Days worked' },
  { value: 'games', label: 'Games' },
]

const MONTH_TITLES: Record<MonthMeasure, string> = {
  gross: 'Income',
  hours: 'Hours worked',
  gameMinutes: 'Game minutes',
  daysWorked: 'Days worked',
  games: 'Games',
}

const measureTitle = (m: MonthMeasure) => MONTH_TITLES[m]

function measureSubtitle(m: MonthMeasure, modelLabel: string): string {
  switch (m) {
    case 'gross':
      return 'Actual fees on games worked'
    case 'hours':
      // Says which model, because the figure changes with it.
      return `Total time under ${modelLabel.toLowerCase()}`
    case 'gameMinutes':
      return 'Scheduled game time only, excluding travel and prep'
    case 'daysWorked':
      return 'Distinct dates worked — a seven-game Saturday counts once'
    default:
      return 'Games worked'
  }
}

function monthValue(m: MonthPoint, measure: MonthMeasure): number {
  switch (measure) {
    case 'gross':
      return m.gross
    // `minutes` is the selected model's total, so hours follow the model too.
    case 'hours':
      return Math.round((m.minutes / 60) * 10) / 10
    case 'gameMinutes':
      return m.minutes
    case 'daysWorked':
      return m.daysWorked
    default:
      return m.games
  }
}

function formatMeasure(n: number, measure: MonthMeasure, currency: string): string {
  switch (measure) {
    case 'gross':
      return formatMoneyCompact(n, currency)
    case 'hours':
      return `${n}h`
    case 'gameMinutes':
      return formatMinutes(n)
    default:
      return String(n)
  }
}

/** What a monthly rate divides income by. */
type RateMeasure = 'hour' | 'game' | 'gameMinute'

const RATE_MEASURES: { value: RateMeasure; label: string }[] = [
  { value: 'hour', label: 'Per hour' },
  { value: 'game', label: 'Per game' },
  { value: 'gameMinute', label: 'Per game hour' },
]

const RATE_TITLES: Record<RateMeasure, string> = {
  hour: 'Rate per hour',
  game: 'Rate per game',
  gameMinute: 'Rate per game hour',
}

/**
 * A month's rate on the chosen basis.
 *
 * `perHour` is already computed over only the games whose time is known, so it is
 * used as-is rather than recomputed. Per-game needs no duration at all, which is
 * why it can show a figure for a month the other two leave blank.
 */
function rateValue(m: MonthPoint, measure: RateMeasure): number | null {
  switch (measure) {
    case 'hour':
      return m.perHour
    case 'game':
      return m.games > 0 ? Math.round((m.gross / m.games) * 100) / 100 : null
    default:
      // Game time only: income over scheduled minutes, expressed hourly.
      return m.minutes > 0 ? Math.round((m.gross / m.minutes) * 60 * 100) / 100 : null
  }
}
