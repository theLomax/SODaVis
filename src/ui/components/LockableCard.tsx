/**
 * One record of an editable list — a park, a vehicle, a piece of gear — as a card
 * whose values are read-only until it is unlocked.
 *
 * Locked is the resting state: a stray tap in a field must not be able to change
 * a figure. Edit unlocks this card alone and Done locks it again. The caller
 * renders text or fields in the body according to `unlocked`, and shows anything
 * destructive only while unlocked.
 */

import type { ReactNode, Ref } from 'react'

export function LockableCard({
  name,
  editLabel = name,
  badge,
  summary,
  unlocked,
  onToggle,
  highlighted,
  dimmed,
  className,
  cardRef,
  children,
  ...data
}: {
  /** The record's name: the card's heading, and what the Edit button names. */
  name: string
  /** What the Edit button names, where the name alone is shared by several cards. */
  editLabel?: string
  /** Chips shown after the name. */
  badge?: ReactNode
  /** A line under the name. */
  summary?: ReactNode
  unlocked: boolean
  onToggle: () => void
  /** The card a link elsewhere sent the reader to. */
  highlighted?: boolean
  /** For a record no longer in use. */
  dimmed?: boolean
  /** Extra classes for the list item, such as a grid span. */
  className?: string
  cardRef?: Ref<HTMLLIElement>
  children: ReactNode
  /** `data-*` attributes for the list item, so a card can be found by its record. */
  [data: `data-${string}`]: string
}) {
  return (
    <li
      ref={cardRef}
      {...data}
      // Border, background and fade come from `.lockable-card` and its modifiers
      // in theme.css rather than an inline style, so a list's own class (a tracked
      // sport, say) can restyle its cards without `!important`.
      className={[
        'lockable-card flex flex-col gap-3 rounded-lg p-3 text-xs',
        unlocked ? 'lockable-card--unlocked' : '',
        highlighted ? 'lockable-card--arrived' : '',
        // An unlocked card is being worked on, so it is never faded.
        dimmed && !unlocked ? 'lockable-card--dimmed' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {name}
            {badge}
          </span>
          {summary ? <span style={{ color: 'var(--text-secondary)' }}>{summary}</span> : null}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={unlocked}
          aria-label={unlocked ? `Done editing ${editLabel}` : `Edit ${editLabel}`}
          className="shrink-0 rounded-md px-2.5 py-1 text-xs"
          style={{
            background: unlocked ? 'var(--series-1)' : 'var(--surface-1)',
            color: unlocked ? '#ffffff' : 'var(--text-primary)',
            border: `1px solid ${unlocked ? 'transparent' : 'var(--border-hairline)'}`,
          }}
        >
          {unlocked ? 'Done' : 'Edit'}
        </button>
      </div>
      {children}
    </li>
  )
}

/** A labeled value in a card's grid of figures. */
export function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="num-tabular m-0" style={{ color: 'var(--text-primary)' }}>
        {children}
      </dd>
    </div>
  )
}

/** Keeps the set of unlocked cards for a list: every card starts locked. */
export function toggledIn(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}
