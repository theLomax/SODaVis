/**
 * A filter for any list: a panel of categories, each with the values to pick
 * from, shown alongside the list it narrows.
 *
 * The caller passes the categories as props, owns the selection, and passes the
 * list as children, so the same panel serves any list — parks pass city, league,
 * sport and organization. Within a category the picks are alternatives (either
 * city); across categories they all have to hold (that city and that sport).
 * `matchesSelection` applies that rule, given a way to read an item's values for
 * a category.
 *
 * The panel is not modal: it stays open while the list changes beside it. On a
 * wide screen it is a column to the left of the list; on a narrow one it sits
 * above. The Filter button shows and hides it, and the picks stay listed next to
 * that button either way, each one removable, so a narrowed list never looks
 * like a complete one.
 */

import { useId, useState, type ReactNode } from 'react'
import { Button } from './Controls'

export type FilterCategory = {
  id: string
  label: string
  options: readonly { value: string; label: string }[]
}

/** The values picked in each category, by category id. A missing or empty entry means "any". */
export type FilterSelection = Readonly<Record<string, readonly string[]>>

export const NO_SELECTION: FilterSelection = {}

/** How many values are picked across every category. */
export function selectionSize(selection: FilterSelection): number {
  return Object.values(selection).reduce((n, picks) => n + picks.length, 0)
}

/**
 * Whether an item passes: for every category with picks, the item has at least
 * one of the picked values.
 */
export function matchesSelection(
  selection: FilterSelection,
  valuesOf: (categoryId: string) => Iterable<string>,
): boolean {
  return Object.entries(selection).every(([categoryId, picks]) => {
    if (picks.length === 0) return true
    const values = new Set(valuesOf(categoryId))
    return picks.some((p) => values.has(p))
  })
}

function toggled(selection: FilterSelection, categoryId: string, value: string): FilterSelection {
  const picks = selection[categoryId] ?? []
  const next = picks.includes(value) ? picks.filter((p) => p !== value) : [...picks, value]
  const { [categoryId]: _dropped, ...rest } = selection
  return next.length > 0 ? { ...rest, [categoryId]: next } : rest
}

export function FilterPanel({
  noun,
  categories,
  selection,
  onChange,
  shown,
  total,
  children,
}: {
  /** What is being filtered, plural: "parks". Used in the panel's name and the count. */
  noun: string
  categories: readonly FilterCategory[]
  selection: FilterSelection
  onChange: (selection: FilterSelection) => void
  /** How many items pass, and how many there are, for the "Showing 3 of 12" line. */
  shown: number
  total: number
  /** The list being filtered, laid out beside the panel. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const size = selectionSize(selection)
  // A category with nothing to pick from has nothing to offer.
  const offered = categories.filter((c) => c.options.length > 0)
  const picked = offered.flatMap((c) =>
    c.options.filter((o) => selection[c.id]?.includes(o.value)).map((o) => ({ category: c, option: o })),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={panelId}
          disabled={offered.length === 0}
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{
            background: open ? 'var(--gridline)' : 'var(--surface-1)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-hairline)',
          }}
        >
          {size > 0 ? `Filter (${size})` : 'Filter'}
        </button>
        {picked.map(({ category, option }) => (
          <button
            key={`${category.id}:${option.value}`}
            type="button"
            onClick={() => onChange(toggled(selection, category.id, option.value))}
            aria-label={`Remove ${category.label}: ${option.label}`}
            className="rounded-full px-2.5 py-1"
            style={{ background: 'var(--gridline)', color: 'var(--text-primary)', border: '1px solid var(--border-hairline)' }}
          >
            {category.label}: {option.label} <span aria-hidden="true">×</span>
          </button>
        ))}
        {size > 0 ? (
          <>
            <span role="status" style={{ color: 'var(--text-secondary)' }}>
              Showing {shown} of {total} {noun}
            </span>
            <Button onClick={() => onChange(NO_SELECTION)}>Show all</Button>
          </>
        ) : null}
      </div>

      <div className={open ? 'flex flex-col gap-3 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start' : undefined}>
        {open ? (
          <aside
            id={panelId}
            aria-label={`Filter ${noun}`}
            className="flex flex-col gap-4 rounded-lg p-3"
            style={{ border: '1px solid var(--border-hairline)' }}
          >
            {offered.map((c) => (
              <fieldset key={c.id} className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-1.5 p-0 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {c.label}
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {c.options.map((o) => {
                    const on = selection[c.id]?.includes(o.value) ?? false
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(toggled(selection, c.id, o.value))}
                        className="rounded-full px-2.5 py-1 text-left text-xs"
                        style={{
                          background: on ? 'var(--series-1)' : 'var(--surface-1)',
                          color: on ? '#ffffff' : 'var(--text-primary)',
                          border: `1px solid ${on ? 'transparent' : 'var(--border-hairline)'}`,
                        }}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            ))}
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              Picks within a category are alternatives; categories combine.
            </p>
          </aside>
        ) : null}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
