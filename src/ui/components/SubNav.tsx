/**
 * The second row of navigation: the pages of the selected group, or the tabs of
 * Reference.
 *
 * On a wide screen the row wraps like any toolbar. On a narrow one it stays a
 * single line that scrolls sideways, and brings the current page into view, so a
 * group with eight pages costs one row of a phone screen rather than three.
 */

import { useEffect, useRef } from 'react'

export type SubNavItem<Id extends string> = {
  id: Id
  label: string
  /** Starts a new section of the row, drawn as a hairline before the item. */
  divider?: boolean
}

export function SubNav<Id extends string>({
  label,
  items,
  current,
  onSelect,
}: {
  /** Names the row for assistive technology: the group it belongs to. */
  label: string
  items: readonly SubNavItem<Id>[]
  current: Id | undefined
  onSelect: (id: Id) => void
}) {
  const currentRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current, label])

  return (
    <nav
      aria-label={label}
      className="flex flex-nowrap items-center gap-1 overflow-x-auto px-6 py-2 sm:flex-wrap"
      style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface-1)' }}
    >
      {items.map((item) => (
        <span key={item.id} className="flex shrink-0 items-center gap-1">
          {item.divider ? (
            <span aria-hidden="true" className="mx-1.5 h-4 w-px" style={{ background: 'var(--border-hairline)' }} />
          ) : null}
          <button
            ref={current === item.id ? currentRef : undefined}
            type="button"
            aria-current={current === item.id ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
            className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs"
            style={{
              background: current === item.id ? 'var(--gridline)' : 'transparent',
              color: current === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {item.label}
          </button>
        </span>
      ))}
    </nav>
  )
}
