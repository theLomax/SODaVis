/**
 * One park as a card: its figures read-only until the card is unlocked.
 *
 * Mileage and drive times feed every trip to the park, so they sit behind the
 * card's lock. Each field still commits on blur, as the table it replaced did.
 */

import type { Ref } from 'react'
import { Button } from '../../components/Controls'
import { CardField, LockableCard } from '../../components/LockableCard'
import { StatusChip } from '../../components/Tiles'
import { formatMoney } from '../../../derive/money'
import type { Park } from '../../../model/reference'
import { NumberCell, TextCell } from './cells'

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
    <LockableCard
      data-park={park.id}
      name={park.name}
      badge={
        needsMiles ? (
          <StatusChip role="warning" label="no mileage" title={`${games} games here have no distance on record`} />
        ) : null
      }
      summary={
        <>
          {unlocked ? null : `${park.city ?? 'No city'} · `}
          {games} game{games === 1 ? '' : 's'}
        </>
      }
      unlocked={unlocked}
      onToggle={onToggle}
      highlighted={highlighted}
      {...(cardRef ? { cardRef } : {})}
    >
      {unlocked ? (
        <label className="flex flex-col gap-0.5" style={{ color: 'var(--text-muted)' }}>
          City
          <TextCell value={park.city} fill onCommit={(v) => onPatch({ city: v })} ariaLabel={`City for ${park.name}`} />
        </label>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
        <CardField label="One-way miles">
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
        </CardField>
        <CardField label="Tolls, round trip">
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
        </CardField>
        <CardField label="Minutes (ideal)">
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
        </CardField>
        {/* The return leg always uses the ideal figure, so this one only ever
            applies outbound. Left blank where traffic makes no real difference
            to this park. */}
        <CardField label="Minutes (rush)">
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
        </CardField>
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
    </LockableCard>
  )
}
