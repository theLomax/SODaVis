/**
 * Chart forms, each chosen by the job the data does. Every form here enforces the
 * mark specs rather than leaving them to the caller:
 *
 *  - bars cap at 24px with a 4px rounded data-end, square at the baseline
 *  - lines are 2px with >= 8px end markers carrying a 2px surface ring
 *  - gridlines are solid hairlines; no chart has a second y-axis, ever
 *  - color follows the entity, so a filter never repaints the survivors
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartFrame, CHART_MARGIN, TooltipBox, type LegendItem, type TableColumn } from './ChartFrame'
import { DIVERGING, MARK, seriesVar } from './palette'

type Fmt = (n: number) => string

/**
 * Recharts hands a label formatter whatever the cell holds, which its types model
 * as RenderableText. Our formatters are numeric, so coerce at the boundary and
 * leave a non-numeric cell unlabelled rather than printing 'NaN'.
 */
const labelFormatter =
  (format: Fmt) =>
  (value: unknown): string => {
    const n = Number(value)
    return Number.isFinite(n) ? format(n) : ''
  }

// ---------------------------------------------------------------------------
// Horizontal bar: magnitude across nominal categories
// ---------------------------------------------------------------------------

export type BarRow = {
  key: string
  label: string
  value: number
  /**
   * The unabbreviated name, where `label` had to be shortened to fit an axis band.
   * Shown as the tooltip heading and in the table, so a short label never becomes
   * the only copy of a name.
   */
  detail?: string
}

/**
 * One series, one color. A value ramp here would double-encode bar length as
 * hue, so a single hue is used regardless of magnitude.
 */
export function HorizontalBar({
  title,
  subtitle,
  rows,
  format,
  valueHeader,
  slot = 1,
  extraColumns = [],
  footnote,
  maxRows = 12,
  action,
}: {
  title: string
  subtitle?: string
  rows: BarRow[]
  format: Fmt
  valueHeader: string
  slot?: number
  extraColumns?: TableColumn<BarRow>[]
  footnote?: string
  maxRows?: number
  action?: React.ReactNode
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const shown = sorted.slice(0, maxRows)
  const color = seriesVar(slot)

  const columns: TableColumn<BarRow>[] = [
    // The table has room, so it carries the full name rather than the axis label.
    { key: 'label', header: title, cell: (r) => r.detail ?? r.label },
    { key: 'value', header: valueHeader, cell: (r) => format(r.value), align: 'right' },
    ...extraColumns,
  ]

  const hiddenNote =
    sorted.length > shown.length
      ? `Showing the top ${shown.length} of ${sorted.length}. The table view carries the rest.`
      : undefined

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      height={Math.max(shown.length * 28, 120)}
      tableRows={sorted}
      tableColumns={columns}
      footnote={[footnote, hiddenNote].filter(Boolean).join(' ') || undefined}
      {...(action ? { action } : {})}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shown} layout="vertical" margin={{ ...CHART_MARGIN, left: 4, right: 56 }}>
          <CartesianGrid horizontal={false} stroke="var(--gridline)" />
          <XAxis type="number" tickFormatter={format} stroke="var(--baseline)" />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            stroke="var(--baseline)"
            tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]!.payload as BarRow
              return (
                <TooltipBox
                  heading={row.detail ?? row.label}
                  lines={[{ label: valueHeader, value: format(row.value), color }]}
                />
              )
            }}
          />
          <Bar
            dataKey="value"
            fill={color}
            maxBarSize={MARK.maxBarSize}
            radius={MARK.barRadiusHorizontal}
            // 2px surface gap between adjacent bars.
            stroke="var(--surface-1)"
            strokeWidth={MARK.surfaceGap}
            label={{
              position: 'right',
              formatter: labelFormatter(format),
              fill: 'var(--text-secondary)',
              fontSize: 11,
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Column chart: magnitude over time
// ---------------------------------------------------------------------------

export function ColumnChart({
  title,
  subtitle,
  rows,
  format,
  valueHeader,
  slot = 1,
  extraColumns = [],
  footnote,
  action,
}: {
  title: string
  subtitle?: string
  rows: BarRow[]
  format: Fmt
  valueHeader: string
  slot?: number
  extraColumns?: TableColumn<BarRow>[]
  footnote?: string
  action?: React.ReactNode
}) {
  const color = seriesVar(slot)
  const columns: TableColumn<BarRow>[] = [
    { key: 'label', header: 'Period', cell: (r) => r.label },
    { key: 'value', header: valueHeader, cell: (r) => format(r.value), align: 'right' },
    ...extraColumns,
  ]

  // Label only the extreme, never every column.
  const peak = rows.reduce<BarRow | null>((best, r) => (!best || r.value > best.value ? r : best), null)

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      tableRows={rows}
      tableColumns={columns}
      {...(footnote ? { footnote } : {})}
      {...(action ? { action } : {})}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          <XAxis dataKey="label" stroke="var(--baseline)" interval="preserveStartEnd" />
          <YAxis tickFormatter={format} stroke="var(--baseline)" width={56} />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]!.payload as BarRow
              return (
                <TooltipBox
                  heading={row.detail ?? row.label}
                  lines={[{ label: valueHeader, value: format(row.value), color }]}
                />
              )
            }}
          />
          <Bar
            dataKey="value"
            fill={color}
            maxBarSize={MARK.maxBarSize}
            radius={MARK.barRadiusVertical}
            stroke="var(--surface-1)"
            strokeWidth={MARK.surfaceGap}
          >
            {rows.map((r) => (
              <Cell key={r.key} />
            ))}
          </Bar>
          {peak ? (
            <ReferenceLine
              y={peak.value}
              stroke="var(--gridline)"
              label={{
                value: format(peak.value),
                position: 'insideTopRight',
                fill: 'var(--text-secondary)',
                fontSize: 11,
              }}
              ifOverflow="extendDomain"
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Stacked column: a total over time, split into its parts
// ---------------------------------------------------------------------------

export type StackedRow = { key: string; label: string; total: number } & Record<string, unknown>

/**
 * One column per period, segmented by series. Use when the total is the story and
 * the split is the detail — a grouped bar would make the reader add the parts up
 * to recover the month.
 *
 * Segments carry a 2px surface gap rather than a stroke, and only the top of the
 * stack is rounded, so the column still reads as one bar growing from the baseline.
 */
export function StackedColumn({
  title,
  subtitle,
  rows,
  series,
  format,
  footnote,
  extraColumns = [],
  action,
}: {
  title: string
  subtitle?: string
  rows: StackedRow[]
  series: { key: string; label: string; slot: number }[]
  format: Fmt
  footnote?: string
  extraColumns?: TableColumn<StackedRow>[]
  action?: React.ReactNode
}) {
  const legend: LegendItem[] = series.map((s) => ({ label: s.label, color: seriesVar(s.slot) }))

  const columns: TableColumn<StackedRow>[] = [
    { key: 'label', header: 'Period', cell: (r) => r.label },
    ...series.map((s) => ({
      key: s.key,
      header: s.label,
      cell: (r: StackedRow) => format(Number(r[s.key] ?? 0)),
      align: 'right' as const,
    })),
    { key: 'total', header: 'Total', cell: (r) => format(r.total), align: 'right' },
    ...extraColumns,
  ]

  // Which series actually reaches the top of each column, so only that segment is
  // rounded. A zero-height segment must not take the rounding with it.
  const topSeriesFor = (row: StackedRow): string | undefined => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (Number(row[series[i]!.key] ?? 0) > 0) return series[i]!.key
    }
    return undefined
  }

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      legend={legend}
      tableRows={rows}
      tableColumns={columns}
      {...(footnote ? { footnote } : {})}
      {...(action ? { action } : {})}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          <XAxis dataKey="label" stroke="var(--baseline)" interval="preserveStartEnd" />
          <YAxis tickFormatter={format} stroke="var(--baseline)" width={56} />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]!.payload as StackedRow
              // Only the series present in this column, plus the total.
              const lines = series
                .filter((sr) => Number(row[sr.key] ?? 0) > 0)
                .map((sr) => ({
                  label: sr.label,
                  value: format(Number(row[sr.key] ?? 0)),
                  color: seriesVar(sr.slot),
                }))
              return (
                <TooltipBox
                  heading={String(label)}
                  lines={[...lines, { label: 'Total', value: format(row.total) }]}
                />
              )
            }}
          />
          {series.map((sr) => (
            <Bar
              key={sr.key}
              dataKey={sr.key}
              name={sr.label}
              stackId="total"
              fill={seriesVar(sr.slot)}
              maxBarSize={MARK.maxBarSize}
              // 2px surface gap between stacked segments, never a border.
              stroke="var(--surface-1)"
              strokeWidth={MARK.surfaceGap}
            >
              {rows.map((row) => (
                <Cell
                  key={`${sr.key}-${row.key}`}
                  radius={topSeriesFor(row) === sr.key ? ([4, 4, 0, 0] as never) : undefined}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Grouped bar: comparing series that share one scale
// ---------------------------------------------------------------------------

export type GroupedRow = { key: string; label: string } & Record<string, string | number>

/**
 * Up to 3 series, all on one axis. Never a second y-scale: two measures of
 * different scale get two charts, not two axes.
 *
 * Slot 3 (aqua) measures 2.74:1 on the light surface, so the relief rule applies
 * wherever this form uses three series: the legend names every series and the
 * table view carries every value, neither of which is optional here.
 */
export function GroupedBar({
  title,
  subtitle,
  rows,
  series,
  format,
  footnote,
}: {
  title: string
  subtitle?: string
  rows: GroupedRow[]
  series: { key: string; label: string; slot: number }[]
  format: Fmt
  footnote?: string
}) {
  const legend: LegendItem[] = series.map((s) => ({ label: s.label, color: seriesVar(s.slot) }))

  const columns: TableColumn<GroupedRow>[] = [
    { key: 'label', header: 'Group', cell: (r) => r.label },
    ...series.map((s) => ({
      key: s.key,
      header: s.label,
      cell: (r: GroupedRow) => format(Number(r[s.key] ?? 0)),
      align: 'right' as const,
    })),
  ]

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      legend={legend}
      tableRows={rows}
      tableColumns={columns}
      {...(footnote ? { footnote } : {})}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={CHART_MARGIN} barGap={MARK.surfaceGap}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          <XAxis dataKey="label" stroke="var(--baseline)" />
          <YAxis tickFormatter={format} stroke="var(--baseline)" width={56} />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <TooltipBox
                  heading={String(label)}
                  lines={series.map((s) => ({
                    label: s.label,
                    value: format(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)),
                    color: seriesVar(s.slot),
                  }))}
                />
              )
            }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={seriesVar(s.slot)}
              maxBarSize={MARK.maxBarSize}
              radius={MARK.barRadiusVertical}
              stroke="var(--surface-1)"
              strokeWidth={MARK.surfaceGap}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Line: a rate over time
// ---------------------------------------------------------------------------

export type LineRow = { key: string; label: string; value: number | null }

export function TrendLine({
  title,
  subtitle,
  rows,
  format,
  valueHeader,
  slot = 1,
  footnote,
  action,
}: {
  title: string
  subtitle?: string
  rows: LineRow[]
  format: Fmt
  valueHeader: string
  slot?: number
  footnote?: string
  action?: React.ReactNode
}) {
  const color = seriesVar(slot)
  const columns: TableColumn<LineRow>[] = [
    { key: 'label', header: 'Period', cell: (r) => r.label },
    {
      key: 'value',
      header: valueHeader,
      cell: (r) => (r.value == null ? '—' : format(r.value)),
      align: 'right',
    },
  ]

  const last = [...rows].reverse().find((r) => r.value != null)

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      tableRows={rows}
      tableColumns={columns}
      {...(footnote ? { footnote } : {})}
      {...(action ? { action } : {})}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ ...CHART_MARGIN, right: 52 }}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          <XAxis dataKey="label" stroke="var(--baseline)" interval="preserveStartEnd" />
          <YAxis tickFormatter={format} stroke="var(--baseline)" width={56} />
          <Tooltip
            // Crosshair on lines.
            cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const v = payload[0]!.value
              return (
                <TooltipBox
                  heading={String(label)}
                  lines={[
                    { label: valueHeader, value: v == null ? '—' : format(Number(v)), color },
                  ]}
                />
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={MARK.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            // 2px surface ring keeps a dot legible where it crosses the line.
            dot={{ r: MARK.dotRadius, fill: color, stroke: 'var(--surface-1)', strokeWidth: 2 }}
            activeDot={{ r: MARK.activeDotRadius, fill: color, stroke: 'var(--surface-1)', strokeWidth: 2 }}
          >
            {/* Label the endpoint only — never a number on every point. */}
            <LabelList
              dataKey="value"
              content={(props) => {
                const { index, x, y, value } = props as {
                  index?: number
                  x?: number | string
                  y?: number | string
                  value?: number | string
                }
                const isLast = last != null && index != null && rows[index]?.key === last.key
                if (!isLast || value == null || typeof x !== 'number' || typeof y !== 'number') {
                  return null
                }
                return (
                  <text x={x + 8} y={y + 4} fill="var(--text-secondary)" fontSize={11}>
                    {format(Number(value))}
                  </text>
                )
              }}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Diverging bar: polarity around zero
// ---------------------------------------------------------------------------

export type DivergingRow = { key: string; label: string; value: number; detail?: string }

/**
 * For scheduled-vs-actual variance. Two hues that read as opposite, a neutral
 * gray midpoint at zero, and equal weight per arm.
 */
export function DivergingBar({
  title,
  subtitle,
  rows,
  format,
  negativeLabel,
  positiveLabel,
  footnote,
  maxRows = 14,
}: {
  title: string
  subtitle?: string
  rows: DivergingRow[]
  format: Fmt
  negativeLabel: string
  positiveLabel: string
  footnote?: string
  maxRows?: number
}) {
  const sorted = [...rows].sort((a, b) => a.value - b.value)
  const shown =
    sorted.length <= maxRows
      ? sorted
      : [...sorted.slice(0, Math.ceil(maxRows / 2)), ...sorted.slice(-Math.floor(maxRows / 2))]

  const legend: LegendItem[] = [
    { label: negativeLabel, color: DIVERGING.negative },
    { label: positiveLabel, color: DIVERGING.positive },
  ]

  const columns: TableColumn<DivergingRow>[] = [
    { key: 'label', header: 'Game', cell: (r) => r.label },
    { key: 'detail', header: 'Detail', cell: (r) => r.detail ?? '' },
    { key: 'value', header: 'Variance', cell: (r) => format(r.value), align: 'right' },
  ]

  const hiddenNote =
    sorted.length > shown.length
      ? `Showing the ${shown.length} largest swings of ${sorted.length}. The table view carries the rest.`
      : undefined

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      legend={legend}
      height={Math.max(shown.length * 26, 120)}
      tableRows={sorted}
      tableColumns={columns}
      footnote={[footnote, hiddenNote].filter(Boolean).join(' ') || undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={shown} layout="vertical" margin={{ ...CHART_MARGIN, left: 4, right: 72 }}>
          <CartesianGrid horizontal={false} stroke="var(--gridline)" />
          <XAxis type="number" tickFormatter={format} stroke="var(--baseline)" />
          <YAxis
            type="category"
            dataKey="label"
            width={190}
            stroke="var(--baseline)"
            tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            interval={0}
          />
          {/* Neutral gray midpoint: zero reads as "nothing", not as a hue. */}
          <ReferenceLine x={0} stroke="var(--baseline)" strokeWidth={1} />
          <Tooltip
            cursor={{ fill: 'var(--gridline)', fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]!.payload as DivergingRow
              return (
                <TooltipBox
                  heading={row.label}
                  lines={[
                    ...(row.detail ? [{ label: 'Detail', value: row.detail }] : []),
                    {
                      label: row.value < 0 ? negativeLabel : positiveLabel,
                      value: format(row.value),
                      color: row.value < 0 ? DIVERGING.negative : DIVERGING.positive,
                    },
                  ]}
                />
              )
            }}
          />
          <Bar
            dataKey="value"
            maxBarSize={MARK.maxBarSize}
            stroke="var(--surface-1)"
            strokeWidth={MARK.surfaceGap}
          >
            {/*
              The label rides the bar's data end, which is on the LEFT for a
              negative value. Pinning every label to the right would drop the
              negative ones on top of the y-axis category text.
            */}
            <LabelList
              dataKey="value"
              content={(props) => {
                const { x, y, width, height, value } = props as {
                  x?: number | string
                  y?: number | string
                  width?: number
                  height?: number
                  value?: number | string
                }
                if (
                  value == null ||
                  typeof x !== 'number' ||
                  typeof y !== 'number' ||
                  width == null ||
                  height == null
                ) {
                  return null
                }
                const n = Number(value)
                const negative = n < 0
                // Recharts anchors a negative bar's `x` at the zero line and
                // reports a positive `width`, so its data end (the far left tip)
                // is `x - width`; a positive bar's is `x + width`. Measured, not
                // assumed: anchoring to `x` puts the label inside the fill.
                const dataEnd = negative ? x - width : x + width
                return (
                  <text
                    x={negative ? dataEnd - 6 : dataEnd + 6}
                    y={y + height / 2 + 4}
                    textAnchor={negative ? 'end' : 'start'}
                    fill="var(--text-secondary)"
                    fontSize={11}
                  >
                    {format(n)}
                  </text>
                )
              }}
            />
            {shown.map((r) => (
              <Cell
                key={r.key}
                fill={r.value < 0 ? DIVERGING.negative : DIVERGING.positive}
                // Rounded on the data end, square at the zero baseline.
                radius={r.value < 0 ? ([4, 0, 0, 4] as never) : ([0, 4, 4, 0] as never)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Stacked bar: a two-part split, where a 2-slice pie would be wrong
// ---------------------------------------------------------------------------

export type SplitMeasure = {
  /** Column header in the table view, and the row's label on screen. */
  label: string
  /** Value per part key. */
  values: Record<string, number>
  format: Fmt
}

/**
 * One bar per measure, stacked vertically, over the same categories.
 *
 * Two measures cannot share a bar. An earlier version drew a single bar from the
 * money split and labelled it with both, which put "64% of the time" above a
 * segment 58% wide — the figures disagreed with the geometry, and the geometry is
 * what a reader trusts. Each measure now gets its own bar, so the comparison being
 * offered is the difference between two lengths.
 *
 * The share sits inside its segment in bold, since that is the figure the bar is
 * for; the unit value sits outside, aligned to the same segment.
 */
export function SplitBar({
  title,
  subtitle,
  parts,
  format,
  valueLabel = 'Value',
  footnote,
  secondary,
  action,
}: {
  title: string
  subtitle?: string
  /** The categories, and the primary measure's values. */
  parts: { key: string; label: string; value: number; slot: number }[]
  format: Fmt
  /** Names the primary measure's bar. Defaults to 'Value'. */
  valueLabel?: string
  footnote?: string
  /** A second measure over the same categories, drawn as its own bar above. */
  secondary?: SplitMeasure
  action?: React.ReactNode
}) {
  const legend: LegendItem[] = parts.map((p) => ({ label: p.label, color: seriesVar(p.slot) }))

  const primary: SplitMeasure = {
    label: valueLabel,
    values: Object.fromEntries(parts.map((p) => [p.key, p.value])),
    format,
  }
  // Secondary first: it is the input, and the money it produced reads as the result.
  const measures = secondary ? [secondary, primary] : [primary]

  const columns: TableColumn<(typeof parts)[number]>[] = [
    { key: 'label', header: 'Group', cell: (p) => p.label },
    ...measures.map((m, i) => ({
      key: `m${i}`,
      header: m.label,
      cell: (p: (typeof parts)[number]) => m.format(m.values[p.key] ?? 0),
      align: 'right' as const,
    })),
    ...measures.map((m, i) => {
      const sum = parts.reduce((n, p) => n + (m.values[p.key] ?? 0), 0)
      return {
        key: `s${i}`,
        header: `${m.label} share`,
        cell: (p: (typeof parts)[number]) =>
          sum > 0 ? `${Math.round(((m.values[p.key] ?? 0) / sum) * 100)}%` : '—',
        align: 'right' as const,
      }
    }),
  ]

  /**
   * One measure: its own bar, with the share inside each segment and the unit value
   * outside, both aligned to that segment.
   *
   * The share is dark ink on every segment rather than white, which fails contrast
   * on the light-mode orange (3.2:1 against the 4.5 small text needs). Dark clears
   * it on all four series steps in both modes, and one colour is steadier than
   * switching per segment.
   */
  const measureBar = (m: SplitMeasure, isPrimary: boolean) => {
    const sum = parts.reduce((n, p) => n + (m.values[p.key] ?? 0), 0)
    const share = (p: (typeof parts)[number]) =>
      sum > 0 ? ((m.values[p.key] ?? 0) / sum) * 100 : 0

    return (
      <div key={m.label} className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {m.label}
          </span>
        </div>

        <div className="flex w-full" style={{ height: MARK.maxBarSize, gap: MARK.surfaceGap }}>
          {parts.map((p, i) => {
            const pct = share(p)
            const isFirst = i === 0
            const isLast = i === parts.length - 1
            return (
              <div
                key={p.key}
                className="flex items-center justify-center overflow-hidden"
                title={`${p.label}: ${m.format(m.values[p.key] ?? 0)} (${Math.round(pct)}%)`}
                style={{
                  width: `${pct}%`,
                  background: seriesVar(p.slot),
                  borderRadius: `${isFirst ? '4px' : '0'} ${isLast ? '4px' : '0'} ${
                    isLast ? '4px' : '0'
                  } ${isFirst ? '4px' : '0'}`,
                }}
              >
                {/* Hidden below ~8% rather than clipped mid-digit. The value outside
                    and the table view both still carry it. */}
                {pct >= 8 ? (
                  <span
                    className="num-tabular"
                    style={{
                      color: '#0b0b0b',
                      fontSize: 12,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {Math.round(pct)}%
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Unit values, each box the width of its own segment on this bar. */}
        <div className="flex w-full" style={{ gap: MARK.surfaceGap }}>
          {parts.map((p) => (
            <div
              key={p.key}
              className="flex justify-center"
              style={{ width: `${share(p)}%`, minWidth: 0, whiteSpace: 'nowrap' }}
            >
              <span
                className="num-tabular"
                style={{
                  color: isPrimary ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 16,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {m.format(m.values[p.key] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <ChartFrame
      title={title}
      {...(subtitle ? { subtitle } : {})}
      legend={legend}
      height={measures.length > 1 ? 186 : 104}
      tableRows={parts}
      tableColumns={columns}
      {...(footnote ? { footnote } : {})}
      {...(action ? { action } : {})}
    >
      <div className="flex h-full flex-col justify-center gap-4">
        {measures.map((m, i) => measureBar(m, m === primary && i === measures.length - 1))}
      </div>
    </ChartFrame>
  )
}
