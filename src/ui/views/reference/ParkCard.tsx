/**
 * One park as a card: its figures read-only until the card is unlocked.
 *
 * Locked is the resting state. Mileage and drive times feed every trip to the
 * park, so a stray tap in a field must not be able to change one; Edit unlocks
 * this card alone, and Done locks it again. Each field still commits on blur, as
 * the table it replaced did.
 */

import type { ReactNode, Ref } from 'react'
import { Button } from '../../components/Controls'
import { StatusChip } from '../../components/Tiles'
import { formatMoney } from '../../../derive/money'
import type { Park } from '../../../model/reference'
import { NumberCell, TextCell } from './cells'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="num-tabular m-0" style={{ color: 'var(--text-primary)' }}>
        {children}
      </dd>
    </div>
  )
}

export function ParkCard({
  park,
  games,
  needsMiles,
  unlocked,
  highlighted,
  currency,
  cardRef,
  onToggle,
  onPatch,
  onDelete,
}: {
  park: Park
  /** Games on record here. A park with any cannot be deleted. */
  games: number
  needsMiles: boolean
  unlocked: boolean
  /** The card a warning sent the reader to. */
  highlighted: boolean
  currency: string
  cardRef?: Ref<HTMLLIElement>
  onToggle: () => void
  onPatch: (patch: Partial<Omit<Park, 'id'>>) => void
  onDelete: () => void
}) {
  const plain = (n: number | undefined) => (n == null ? '—' : n.toLocaleString())
  return (
    <li
      ref={cardRef}
      data-park={park.id}
      className="flex flex-col gap-3 rounded-lg p-3 text-xs"
      style={{
        border: `1px solid ${unlocked ? 'var(--series-1)' : 'var(--border-hairline)'}`,
        background: highlighted ? 'var(--gridline)' : 'var(--surface-1)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {park.name}
            {needsMiles ? (
              <StatusChip role="warning" label="no mileage" title={`${games} games here have no distance on record`} />
            ) : null}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {unlocked ? null : `${park.city ?? 'No city'} · `}
            {games} game{games === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={unlocked}
          aria-label={unlocked ? `Done editing ${park.name}` : `Edit ${park.name}`}
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

      {unlocked ? (
        <label className="flex flex-col gap-0.5" style={{ color: 'var(--text-muted)' }}>
          City
          <TextCell value={park.city} fill onCommit={(v) => onPatch({ city: v })} ariaLabel={`City for ${park.name}`} />
        </label>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="One-way miles">
          {unlocked ? (
            <NumberCell
              value={park.oneWayMiles}
              step="0.1"
              fill
              onCommit={(v) => onPatch({ oneWayMiles: v })}
              ariaLabel={`One-way miles for ${park.name}`}
            />
          ) : (
            plain(park.oneWayMiles)
          )}
        </Field>
        <Field label="Tolls, round trip">
          {unlocked ? (
            <NumberCell
              value={park.tollEstimate}
              step="0.01"
              fill
              onCommit={(v) => onPatch({ tollEstimate: v })}
              ariaLabel={`Toll estimate for ${park.name}`}
            />
          ) : (
            formatMoney(park.tollEstimate, currency)
          )}
        </Field>
        <Field label="Minutes (ideal)">
          {unlocked ? (
            <NumberCell
              value={park.oneWayDriveMinutes}
              fill
              onCommit={(v) => onPatch({ oneWayDriveMinutes: v })}
              ariaLabel={`Ideal one-way drive minutes for ${park.name}`}
            />
          ) : (
            plain(park.oneWayDriveMinutes)
          )}
        </Field>
        {/* The return leg always uses the ideal figure, so this one only ever
            applies outbound. Left blank where traffic makes no real difference
            to this park. */}
        <Field label="Minutes (rush)">
          {unlocked ? (
            <NumberCell
              value={park.oneWayDriveMinutesRush}
              fill
              onCommit={(v) => onPatch({ oneWayDriveMinutesRush: v })}
              ariaLabel={`Rush-hour one-way drive minutes for ${park.name}`}
            />
          ) : (
            plain(park.oneWayDriveMinutesRush)
          )}
        </Field>
      </dl>

      {park.aliases.length > 0 || park.venuePatterns.length > 0 || park.notes ? (
        <div className="flex flex-col gap-1 break-words" style={{ color: 'var(--text-secondary)' }}>
          {park.aliases.length > 0 ? (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Aliases: </span>
              {park.aliases.join(' · ')}
            </span>
          ) : null}
          {park.venuePatterns.length > 0 ? (
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Patterns: </span>
              {park.venuePatterns.join(' · ')}
            </span>
          ) : null}
          {park.notes ? <span style={{ color: 'var(--text-muted)' }}>{park.notes}</span> : null}
        </div>
      ) : null}

      {unlocked && games === 0 ? (
        <div className="flex justify-end">
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  )
}
