/**
 * The dialog behind a Review chip: what was detected, what it costs, and how to
 * fix it, per flag.
 *
 * It reads its copy from the flag registry and owns no state. Where a flag's
 * registry entry names a `fixTarget`, the dialog can act on it directly — the
 * footer button and the "Where:" line both become navigation — so a reader never
 * has to translate a path into clicks. A caller that can fix the flag in place
 * still wins: `Trips` passes its own `action`, because expanding the row beats
 * leaving the view.
 */

import type { DataQualityFlag } from '../../model/game'
import { flagInfo, flagMarker, type FixTarget } from '../flags'
import { useStore } from '../store'
import { Dialog } from './Dialog'

export type FlagAction = {
  label: string
  onClick: () => void
}

export function FlagDialog({
  open,
  onClose,
  /** What the flags are about: a trip, or a game. */
  subject,
  subjectDetail,
  flags,
  action,
}: {
  open: boolean
  onClose: () => void
  subject: string
  subjectDetail?: string
  flags: DataQualityFlag[]
  action?: FlagAction
}) {
  const { navigate } = useStore()

  const title =
    flags.length === 1
      ? flagInfo(flags[0]!.code).title
      : `${flags.length} items to review`

  /**
   * The fix location, when the flags agree on one. With several codes pointing at
   * different places there is no single destination, so the footer offers none
   * rather than picking the first arbitrarily — each section's own "Where:" line
   * still navigates.
   */
  const sharedTarget = singleFixTarget(flags)
  const footerAction: FlagAction | undefined =
    action ??
    (sharedTarget
      ? { label: `Go to ${sharedTarget.label}`, onClick: () => navigate(sharedTarget) }
      : undefined)

  // With one flag there are no per-section headings, so the severity marker goes
  // on the dialog's own title — otherwise a note and a serious problem look alike.
  // With several, the worst severity leads and each section carries its own.
  const lead = worstSeverity(flags)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      titleMarker={flagMarker(lead)}
      subtitle={subjectDetail ? `${subject} · ${subjectDetail}` : subject}
      labelledBy="flag-dialog-heading"
      footer={
        footerAction ? (
          <button
            type="button"
            onClick={() => {
              footerAction.onClick()
              onClose()
            }}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--series-1)', color: '#ffffff', border: '1px solid transparent' }}
          >
            {footerAction.label}
          </button>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        {flags.map((flag, i) => (
          <FlagSection
            key={`${flag.code}-${i}`}
            flag={flag}
            showTitle={flags.length > 1}
            onNavigate={(target) => {
              navigate(target)
              onClose()
            }}
          />
        ))}
      </div>
    </Dialog>
  )
}

/**
 * The one place these flags are fixed, or nothing.
 *
 * Distinct destinations cancel out: a footer button reading "Go to Reference data"
 * beside a flag fixed on Trips would send the reader to the wrong field.
 */
function singleFixTarget(flags: DataQualityFlag[]): FixTarget | undefined {
  const targets = flags.map((f) => flagInfo(f.code).fixTarget).filter(Boolean) as FixTarget[]
  if (targets.length === 0) return undefined
  const first = targets[0]!
  const sameLabel = targets.every((t) => t.label === first.label)
  return sameLabel ? first : undefined
}

/** The severity a reader should notice first. */
function worstSeverity(flags: DataQualityFlag[]): DataQualityFlag['severity'] {
  if (flags.some((f) => f.severity === 'serious')) return 'serious'
  if (flags.some((f) => f.severity === 'warning')) return 'warning'
  return 'info'
}

function FlagSection({
  flag,
  showTitle,
  onNavigate,
}: {
  flag: DataQualityFlag
  showTitle: boolean
  onNavigate?: (target: FixTarget) => void
}) {
  const info = flagInfo(flag.code)
  const marker = flagMarker(flag.severity)

  return (
    <section className="flex flex-col gap-2">
      {showTitle ? (
        <h3
          className="m-0 flex items-center gap-2 text-xs font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {/* Icon plus label: the severity hue never carries the meaning alone. */}
          <span aria-hidden="true" style={{ color: marker.color, fontWeight: 700 }}>
            {marker.icon}
          </span>
          {info.title}
        </h3>
      ) : null}

      {/* The row-specific message from where the flag was raised. */}
      <p
        className="m-0 rounded-lg px-3 py-2 text-xs"
        style={{
          background: 'var(--surface-page)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-hairline)',
        }}
      >
        {flag.message}
      </p>

      <Detail label="What this means" body={info.what} />
      {info.why ? <Detail label="Why it matters" body={info.why} /> : null}
      {info.fix ? (
        <Detail
          label="How to fix it"
          body={info.fix}
          {...(info.fixTarget ? { target: info.fixTarget } : {})}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ) : null}
    </section>
  )
}

/**
 * A labelled paragraph, optionally naming where the fix is made.
 *
 * With a navigation handler the "Where:" line is a button; without one it is the
 * same sentence as plain text, so the dialog reads identically wherever it is
 * rendered outside a store.
 */
function Detail({
  label,
  body,
  target,
  onNavigate,
}: {
  label: string
  body: string
  target?: FixTarget
  onNavigate?: (target: FixTarget) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: 'var(--text-muted)', fontSize: 10 }}
      >
        {label}
      </span>
      <p className="m-0 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
      {target ? (
        <p className="m-0 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Where:{' '}
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate(target)}
              className="underline decoration-dotted underline-offset-2"
              style={{ color: 'var(--text-secondary)', background: 'transparent' }}
            >
              {target.label}
            </button>
          ) : (
            target.label
          )}
        </p>
      ) : null}
    </div>
  )
}
