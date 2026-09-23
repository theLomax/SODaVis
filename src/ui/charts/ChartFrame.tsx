/**
 * The frame every chart sits in. It owns the things the specs require of all
 * charts, so an individual chart cannot forget them:
 *
 *  - a title, and a legend whenever there are two or more series
 *  - a table view twin, always reachable, so no value is gated behind a tooltip
 *  - a container sized to include the x-axis band, so the card never grows a
 *    tiny nested scrollbar
 */

import { useId, useState, type ReactNode } from 'react'
import { MARK } from './palette'

export type TableColumn<T> = {
  key: string
  header: string
  /** Rendered with textContent semantics — returns a string, never markup. */
  cell: (row: T) => string
  align?: 'left' | 'right'
}

export type LegendItem = { label: string; color: string }

type Props<T> = {
  title: string
  subtitle?: string
  /** Shown when the chart has two or more series. */
  legend?: LegendItem[]
  /** Plot height in px, excluding the x-axis band. */
  height?: number
  children: ReactNode
  tableRows: T[]
  tableColumns: TableColumn<T>[]
  /** Note rendered under the chart, e.g. what a partial figure excludes. */
  footnote?: string
  /** Extra controls in the header, e.g. a sort toggle. */
  action?: ReactNode
}

export function ChartFrame<T>({
  title,
  subtitle,
  legend,
  height = 260,
  children,
  tableRows,
  tableColumns,
  footnote,
  action,
}: Props<T>) {
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  const isEmpty = tableRows.length === 0

  return (
    <figure className="card m-0 flex flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <figcaption className="min-w-0">
          <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          {subtitle ? (
            <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {subtitle}
            </p>
          ) : null}
        </figcaption>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={tableId}
            className="rounded-md px-2 py-1 text-xs"
            style={{
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>

      {/* A legend is always present for two or more series. */}
      {legend && legend.length >= 2 ? (
        <ul className="m-0 mb-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          {legend.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span
                aria-hidden="true"
                className="inline-block shrink-0 rounded-sm"
                style={{ width: 10, height: 10, background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {isEmpty ? (
        <p
          className="m-0 flex items-center justify-center text-sm"
          style={{ height, color: 'var(--text-muted)' }}
        >
          No data in this range.
        </p>
      ) : showTable ? (
        <div id={tableId} className="overflow-auto" style={{ maxHeight: height + 60 }}>
          <DataTable rows={tableRows} columns={tableColumns} />
        </div>
      ) : (
        // Sized to include the x-axis band, so labels are never cut off.
        <div style={{ height: height + 28 }}>{children}</div>
      )}

      {footnote ? (
        <p className="m-0 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {footnote}
        </p>
      ) : null}
    </figure>
  )
}

export function DataTable<T>({
  rows,
  columns,
}: {
  rows: T[]
  columns: TableColumn<T>[]
}) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className="sticky top-0 px-2 py-1.5 font-medium"
              style={{
                textAlign: c.align ?? 'left',
                color: 'var(--text-secondary)',
                background: 'var(--surface-1)',
                borderBottom: '1px solid var(--gridline)',
              }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td
                key={c.key}
                className={c.align === 'right' ? 'num-tabular px-2 py-1.5' : 'px-2 py-1.5'}
                style={{
                  textAlign: c.align ?? 'left',
                  color: 'var(--text-primary)',
                  borderBottom: '1px solid var(--gridline)',
                }}
              >
                {/* React escapes this; values reach the DOM as text, never markup. */}
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Tooltip shell. Labels come from source data, so they are rendered as React
 * children (textContent semantics) and never via innerHTML.
 */
export function TooltipBox({
  heading,
  lines,
}: {
  heading: string
  lines: { label: string; value: string; color?: string }[]
}) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-hairline)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="mb-1 font-medium">{heading}</div>
      {lines.map((l) => (
        <div key={l.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            {l.color ? (
              <span
                aria-hidden="true"
                className="inline-block rounded-sm"
                style={{ width: 8, height: 8, background: l.color }}
              />
            ) : null}
            {l.label}
          </span>
          <span className="num-tabular">{l.value}</span>
        </div>
      ))}
    </div>
  )
}

export const CHART_MARGIN = { top: 8, right: 16, bottom: 4, left: 8 }
export { MARK }
