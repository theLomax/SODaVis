/**
 * Modal dialog.
 *
 * Rendered through a portal to `document.body` rather than in place, because the
 * triggers live inside tables with `overflow: auto` — an in-place dialog would be
 * clipped by the scroll container and would scroll away with its row.
 *
 * Uses the native `<dialog>` element for its top-layer and focus semantics
 * instead of hand-rolling them: the browser handles stacking above everything,
 * focus containment, and returning focus to the trigger on close.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  labelledBy,
  titleMarker,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  /** Overrides the generated heading id, when a caller needs its own. */
  labelledBy?: string
  /**
   * Optional colour-and-icon pair shown before the title. Decorative: the title
   * text carries the meaning, so this is `aria-hidden` and never the only cue.
   */
  titleMarker?: { color: string; icon: string }
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = labelledBy ?? 'dialog-heading'

  // showModal()/close() rather than the `open` attribute: only the method call
  // puts the dialog in the top layer and makes it genuinely modal.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  if (!open) return null

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      // Escape fires `cancel`; both paths route through the same handler so the
      // parent's state always matches what is on screen.
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself, never on its
      // content, which is how we tell the two apart without an extra overlay div.
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl p-0"
      style={{
        background: 'var(--surface-1)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-hairline)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
      }}
    >
      <div className="flex flex-col">
        <header
          className="flex items-start justify-between gap-4 px-5 pt-5 pb-3"
          style={{ borderBottom: '1px solid var(--gridline)' }}
        >
          <div className="min-w-0">
            <h2
              id={headingId}
              className="m-0 flex items-center gap-2 text-sm font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {titleMarker ? (
                <span aria-hidden="true" style={{ color: titleMarker.color, fontWeight: 700 }}>
                  {titleMarker.icon}
                </span>
              ) : null}
              {title}
            </h2>
            {subtitle ? (
              <p className="m-0 mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-xs"
            style={{
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-hairline)',
              background: 'var(--surface-1)',
            }}
          >
            Close
          </button>
        </header>

        <div className="max-h-[min(60vh,32rem)] overflow-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer
            className="flex flex-wrap items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: '1px solid var(--gridline)' }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>,
    document.body,
  )
}
