/**
 * The user's avatar: their initials in a circle, or a person icon when no display
 * name is set. Decorative on its own — the button or heading around it carries the
 * name — so it is hidden from assistive technology.
 */

import { initialsOf } from '../../model/reference'

export function Avatar({ displayName, size = 28 }: { displayName: string | undefined; size?: number }) {
  const initials = initialsOf(displayName)
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: 'var(--gridline)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-hairline)',
      }}
    >
      {initials || (
        <svg width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
        </svg>
      )}
    </span>
  )
}
