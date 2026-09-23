/**
 * Figures — the form to reach for when the story is a number, not a shape.
 *
 * Both the hero figure and the stat tile use the same system sans as everything
 * else and proportional figures, because `tabular-nums` makes a large standalone
 * number look loose.
 */

import type { ReactNode } from 'react'
import { STATUS, STATUS_ICON, type StatusRole } from '../charts/palette'

export function StatTile({
  label,
  value,
  detail,
  delta,
  status,
}: {
  label: string
  value: string
  detail?: string
  /** Signed, against a named period. */
  delta?: { text: string; good: boolean }
  /**
   * The caveat on the figure. Given an `onClick` the chip becomes a control, which
   * is how a tile reading "4 trips not timed" turns into the list of those four
   * trips rather than a number the reader cannot act on.
   */
  status?: {
    role: StatusRole
    label: string
    onClick?: () => void
    title?: string
    opensDialog?: boolean
  }
}) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      {/* Proportional figures: no tabular-nums on a standalone value. */}
      <span className="text-2xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
      {delta ? (
        <span
          className="text-xs"
          style={{ color: delta.good ? 'var(--delta-good)' : 'var(--status-critical)' }}
        >
          {delta.text}
        </span>
      ) : null}
      {detail ? (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </span>
      ) : null}
      {status ? (
        <StatusChip
          role={status.role}
          label={status.label}
          {...(status.onClick ? { onClick: status.onClick } : {})}
          {...(status.title ? { title: status.title } : {})}
          {...(status.opensDialog ? { opensDialog: status.opensDialog } : {})}
        />
      ) : null}
    </div>
  )
}

/** The one number a view leads with. Exactly one per view. */
export function HeroFigure({
  label,
  value,
  detail,
  children,
}: {
  label: string
  value: string
  detail?: string
  children?: ReactNode
}) {
  return (
    <div className="card flex flex-col gap-1 p-5">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span
        className="font-semibold leading-none"
        style={{ fontSize: 48, color: 'var(--text-primary)' }}
      >
        {value}
      </span>
      {detail ? (
        <span className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </span>
      ) : null}
      {children}
    </div>
  )
}

/**
 * A status color never carries meaning alone: every chip ships an icon and a
 * label alongside the hue.
 *
 * Given `onClick`, the chip renders as a real `<button>` rather than a span
 * wrapped in one — so it is keyboard-reachable, announces itself as a control,
 * and can carry `aria-haspopup` when it opens a dialog. Chips sit in dense table
 * rows, so the 24px minimum hit target comes from padding rather than from size.
 */
export function StatusChip({
  role,
  label,
  onClick,
  title,
  opensDialog,
  marker,
}: {
  role: StatusRole
  label: string
  /** Makes the chip interactive. Omit for a static badge. */
  onClick?: () => void
  /** Native tooltip, for the hover affordance. */
  title?: string
  /** Announces that activating the chip opens a dialog. */
  opensDialog?: boolean
  /**
   * Overrides the colour and icon, for cases the four status roles do not
   * describe — an informational flag is a note, not a pass. See `flagMarker`.
   */
  marker?: { color: string; icon: string }
}) {
  const color = marker?.color ?? STATUS[role]
  const icon = marker?.icon ?? STATUS_ICON[role]

  const content = (
    <>
      <span aria-hidden="true" style={{ color, fontWeight: 700 }}>
        {icon}
      </span>
      {label}
    </>
  )

  const shared = 'inline-flex w-fit items-center gap-1.5 rounded-full text-xs'
  const style = { border: `1px solid ${color}`, color: 'var(--text-primary)' }

  if (!onClick) {
    return (
      <span className={`${shared} px-2 py-0.5`} style={style} {...(title ? { title } : {})}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // The chip often sits inside a row that has its own click behaviour.
        e.stopPropagation()
        onClick()
      }}
      {...(title ? { title } : {})}
      {...(opensDialog ? { 'aria-haspopup': 'dialog' as const } : {})}
      className={`${shared} cursor-pointer px-2.5 py-1 underline decoration-dotted underline-offset-2`}
      style={{ ...style, background: 'transparent' }}
    >
      {content}
    </button>
  )
}

export function Meter({
  label,
  value,
  max,
  valueText,
}: {
  label: string
  value: number
  max: number
  valueText: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="num-tabular" style={{ color: 'var(--text-primary)' }}>
          {valueText}
        </span>
      </div>
      {/* The unfilled track is a lighter step of the fill's own ramp. */}
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--seq-100)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--seq-450)' }} />
      </div>
    </div>
  )
}

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card p-4">
      {title ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h3>
            {subtitle ? (
              <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      <p className="m-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {title}
      </p>
      <p className="m-0 max-w-md text-xs" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
    </div>
  )
}
