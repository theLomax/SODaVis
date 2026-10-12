/**
 * A filter for any list: a button that opens a window of categories, each with
 * the values to pick from.
 *
 * The caller passes the categories as props and owns the selection, so the same
 * window serves any list — parks pass city, league, sport and organization.
 * Within a category the picks are alternatives (either city); across categories
 * they all have to hold (that city and that sport). `matchesSelection` applies
 * that rule, given a way to read an item's values for a category.
 *
 * The picks stay visible next to the button once the window is closed, each one
 * removable, so a narrowed list never looks like a complete one.
 */

import { useState } from 'react'
import { Button } from './Controls'
import { Dialog } from './Dialog'

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

export function FilterWindow({
  noun,
  categories,
  selection,
  onChange,
  shown,
  total,
}: {
  /** What is being filtered, plural: "parks". Used in the window's title and the count. */
  noun: string
  categories: readonly FilterCategory[]
  selection: FilterSelection
  onChange: (selection: FilterSelection) => void
  /** How many items pass, and how many there are, for the "Showing 3 of 12" line. */
  shown: number
  total: number
}) {
  const [open, setOpen] = useState(false)
  const size = selectionSize(selection)
  // A category with nothing to pick from has nothing to offer.
  const offered = categories.filter((c) => c.options.length > 0)
  const picked = offered.flatMap((c) =>
    c.options.filter((o) => selection[c.id]?.includes(o.value)).map((o) => ({ category: c, option: o })),
  )

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button onClick={() => setOpen(true)} disabled={offered.length === 0}>
        {size > 0 ? `Filter (${size})` : 'Filter'}
      </Button>
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Filter ${noun}`}
        subtitle={`Showing ${shown} of ${total}. Picks within a category are alternatives; categories combine.`}
        footer={
          <>
            <Button onClick={() => onChange(NO_SELECTION)} disabled={size === 0}>
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
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
                      className="rounded-full px-2.5 py-1 text-xs"
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
        </div>
      </Dialog>
    </div>
  )
}
