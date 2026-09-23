/**
 * The filter row. One row above everything it scopes, never per-chart filters,
 * so every chart on a view re-renders against the same slice.
 */

import { useMemo } from 'react'
import { TIME_MODELS } from '../../derive/time'
import { yearsPresent } from '../../derive/metrics'
import { useStore, type Filter } from '../store'
import { sportColor, UNSPECIFIED_SPORT } from '../charts/palette'

/**
 * Sets one end of the date range, leaving the other exactly as it was — including
 * unset.
 *
 * The bug this replaces: with no period active, picking a `To` date filled `From`
 * with `1900-01-01`, and picking a `From` filled `To` with `2999-12-31`. Both were
 * sentinels standing in for "open-ended", but a date input renders its value
 * literally — so setting one bound scrolled the other picker to the year 1900 or
 * 2999. An open bound is now simply null, and `matches` skips a null bound rather
 * than comparing against a fabricated date.
 *
 * Clearing both is the same thing as having no filter, so it returns null rather
 * than an object with two empty ends.
 */
export function withBound(
  period: Filter['period'],
  which: 'start' | 'end',
  value: string,
): Filter['period'] {
  const next = { ...(period ?? { start: null, end: null }), [which]: value || null }
  return next.start == null && next.end == null ? null : next
}

export function FilterBar() {
  const { derived, filter, setFilter } = useStore()

  const years = useMemo(
    () => (derived ? yearsPresent(derived.snapshot.games) : []),
    [derived],
  )

  const sports = useMemo(() => {
    if (!derived) return []
    const present = new Set(
      derived.allResolved.map((r) => r.sportCode ?? UNSPECIFIED_SPORT),
    )
    return derived.snapshot.sports
      .filter((s) => present.has(s.code))
      .map((s) => ({ code: s.code, label: s.label }))
      .concat(
        present.has(UNSPECIFIED_SPORT)
          ? [{ code: UNSPECIFIED_SPORT, label: 'Unspecified' }]
          : [],
      )
  }, [derived])

  /** Today, as an ISO date in the viewer's own timezone. */
  const today = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }, [])

  /** The same day one year ago, so "last 12 months" is inclusive of today. */
  const yearAgo = useMemo(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 1)
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  }, [])

  const activeYear = useMemo(() => {
    if (!filter.period) return 'all'
    const { start, end } = filter.period
    if (start == null || end == null) return 'custom'
    const y = start.slice(0, 4)
    if (start === `${y}-01-01` && end === `${y}-12-31`) return y
    if (start === `${today.slice(0, 4)}-01-01` && end === today) return 'ytd'
    if (start === yearAgo && end === today) return 'last12'
    return 'custom'
  }, [filter.period, today, yearAgo])

  const setBound = (which: 'start' | 'end', value: string) =>
    setFilter({ period: withBound(filter.period, which, value) })

  return (
    <div
      className="flex flex-wrap items-end gap-4 px-6 py-3"
      style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface-1)' }}
    >
      <Field label="Period">
        <select
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
          value={activeYear}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'all') setFilter({ period: null })
            else if (v === 'ytd') {
              setFilter({ period: { start: `${today.slice(0, 4)}-01-01`, end: today } })
            } else if (v === 'last12') {
              setFilter({ period: { start: yearAgo, end: today } })
            } else if (v !== 'custom') {
              setFilter({ period: { start: `${v}-01-01`, end: `${v}-12-31` } })
            }
          }}
        >
          <option value="all">All dates</option>
          <option value="ytd">Year to date</option>
          <option value="last12">Last 12 months</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
          {activeYear === 'custom' ? <option value="custom">Custom range</option> : null}
        </select>
      </Field>

      {/*
        `max` keeps the picker's own scroll anchored to a plausible year: an empty
        date input opens on the current year, and a bound left unset no longer drags
        its partner to 1900 or 2999. The end bound may not precede the start.
      */}
      <Field label="From">
        <input
          type="date"
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
          value={filter.period?.start ?? ''}
          max={filter.period?.end ?? undefined}
          onChange={(e) => setBound('start', e.target.value)}
        />
      </Field>

      <Field label="To">
        <input
          type="date"
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
          value={filter.period?.end ?? ''}
          min={filter.period?.start ?? undefined}
          onChange={(e) => setBound('end', e.target.value)}
        />
      </Field>

      {/*
        These chips double as the colour key for any chart split by sport. A chip
        shows its swatch only while selected, because that is exactly when the sport
        is a series on screen — an unselected chip showing a colour would promise a
        series that is not there.
      */}
      <Field
        label="Sport"
        group
        hint={
          filter.sportCodes.length > 1
            ? 'Charts split by sport use these colours'
            : undefined
        }
      >
        <div className="flex flex-wrap gap-1">
          {sports.map((s) => {
            const on = filter.sportCodes.includes(s.code)
            return (
              <button
                key={s.code}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setFilter({
                    sportCodes: on
                      ? filter.sportCodes.filter((c) => c !== s.code)
                      : [...filter.sportCodes, s.code],
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
                style={{
                  border: '1px solid var(--border-hairline)',
                  background: on ? 'var(--gridline)' : 'transparent',
                  color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {/* Decorative: the label carries the identity, never the hue alone. */}
                {on ? (
                  <span
                    aria-hidden="true"
                    className="inline-block shrink-0 rounded-sm"
                    style={{ width: 8, height: 8, background: sportColor(s.code) }}
                  />
                ) : null}
                {s.label}
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Time model" hint={TIME_MODELS.find((m) => m.id === filter.model)?.description}>
        <select
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
          value={filter.model}
          onChange={(e) => setFilter({ model: e.target.value as typeof filter.model })}
        >
          {TIME_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      {(filter.period != null || filter.sportCodes.length > 0 || filter.parkIds.length > 0) && (
        <button
          type="button"
          onClick={() => setFilter({ period: null, sportCodes: [], parkIds: [] })}
          className="rounded-md px-2 py-1 text-xs"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

/**
 * A labelled filter control.
 *
 * `group` switches the wrapper from `<label>` to `role="group"`. A `<label>` may
 * only wrap a single form control: wrapping a set of toggle buttons in one leaves
 * every button without an accessible name, so a screen reader announces the chips
 * as unnamed buttons. The chip set therefore has to be a group.
 */
function Field({
  label,
  hint,
  children,
  group,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  group?: boolean
}) {
  const labelId = group ? `filter-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined
  const body = (
    <>
      <span id={labelId} className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span className="max-w-xs text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </span>
      ) : null}
    </>
  )

  return group ? (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      {body}
    </div>
  ) : (
    <label className="flex flex-col gap-1">{body}</label>
  )
}

export const selectStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-hairline)',
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  width,
  ariaLabel,
  step,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number'
  width?: number
  ariaLabel?: string
  step?: string
}) {
  return (
    <input
      type={type}
      {...(step ? { step } : {})}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={type === 'number' ? 'num-tabular rounded-md px-2 py-1 text-xs' : 'rounded-md px-2 py-1 text-xs'}
      style={{ ...selectStyle, width }}
    />
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: {
      background: 'var(--surface-1)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-hairline)',
    },
    primary: { background: 'var(--series-1)', color: '#ffffff', border: '1px solid transparent' },
    danger: {
      background: 'transparent',
      color: 'var(--status-critical)',
      border: '1px solid var(--status-critical)',
    },
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      style={styles[variant]}
    >
      {children}
    </button>
  )
}

/**
 * A compact select for a chart's own options — which measure it plots, say.
 *
 * Lives in the chart header via `ChartFrame`'s `action` slot, beside the table
 * toggle, so a chart's controls sit together rather than one in the header and one
 * floating above the plot.
 */
export function ChartOption<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      className="rounded-md px-1.5 py-0.5 text-xs"
      style={selectStyle}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
