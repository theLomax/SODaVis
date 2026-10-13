/**
 * One trip as a card: its figures side by side, and its editor once unlocked.
 *
 * Locked, the card is the row the trips table used to be — park, day, games, and
 * each figure marked with where it came from. Unlocked, it spans the whole row,
 * because the editor below it (games, overrides, expenses) is too wide for one
 * column of the grid.
 */

import type { ReactNode, Ref } from 'react'
import { CardField, LockableCard } from '../../components/LockableCard'
import { StatusChip } from '../../components/Tiles'
import { flagMarker, flagTitle } from '../../flags'
import { severityStatus } from '../../charts/palette'
import { formatMoney } from '../../../derive/money'
import { formatMinutes } from '../../../derive/time'
import type { Trip } from '../../../derive/trips'

export function TripCard({
  trip,
  currency,
  startedFrom,
  unlocked,
  highlighted,
  cardRef,
  onToggle,
  onReviewFlags,
  children,
}: {
  trip: Trip
  currency: string
  /** The label of where the trip started, when not from home. */
  startedFrom?: string | undefined
  unlocked: boolean
  /** The card a warning sent the reader to. */
  highlighted: boolean
  cardRef?: Ref<HTMLLIElement>
  onToggle: () => void
  /** Opens the shared flag dialog for this trip. */
  onReviewFlags: () => void
  /** The trip's editor, shown while unlocked. */
  children: ReactNode
}) {
  const gross = trip.games.reduce((s, g) => s + (g.game.fees.actual ?? 0), 0)
  const games = trip.games.length
  const first = trip.flags[0]
  return (
    <LockableCard
      data-trip={trip.key}
      name={trip.parkName}
      editLabel={`${trip.parkName} on ${trip.date}`}
      badge={
        first ? (
          <StatusChip
            role={severityStatus(first.severity)}
            marker={flagMarker(first.severity)}
            label={trip.flags.length === 1 ? 'Review' : `${trip.flags.length} issues`}
            onClick={onReviewFlags}
            opensDialog
            title={
              trip.flags.length === 1
                ? `${flagTitle(first.code)} — open for detail`
                : `${trip.flags.length} items to review — open for detail`
            }
          />
        ) : null
      }
      summary={
        <>
          {weekdayOf(trip.date)} {trip.date} · {games} game{games === 1 ? '' : 's'} ·{' '}
          {trip.lastEnd ? `${trip.firstStart}–${trip.lastEnd}` : `from ${trip.firstStart}`}
          {startedFrom ? ` · started from ${startedFrom}` : ''}
        </>
      }
      unlocked={unlocked}
      onToggle={onToggle}
      highlighted={highlighted}
      className={unlocked ? 'col-span-full' : undefined}
      {...(cardRef ? { cardRef } : {})}
    >
      <dl className="m-0 grid max-w-md grid-cols-3 gap-x-3 gap-y-2">
        <CardField label="Game time">{formatMinutes(trip.gameMinutes)}</CardField>
        <CardField label="Drive">
          {formatMinutes(trip.driveMinutes)}
          <SourceMark source={trip.driveMinutesSource} />
        </CardField>
        <CardField label="Miles">
          {trip.miles == null ? '—' : trip.miles.toLocaleString()}
          <SourceMark source={trip.milesSource} />
        </CardField>
        <CardField label="Tolls">
          {trip.tolls == null ? '—' : formatMoney(trip.tolls, currency)}
          <SourceMark source={trip.tollsSource} />
        </CardField>
        <CardField label="Income">{formatMoney(gross, currency)}</CardField>
      </dl>
      {unlocked ? children : null}
    </LockableCard>
  )
}

/**
 * Where a figure came from, marked on the value itself.
 *
 * Only non-obvious provenance is marked. A figure straight from reference data is
 * the expected case and says nothing; `yours` means you typed it, and `est.` means
 * the app derived it from something else and could be wrong.
 */
function SourceMark({
  source,
}: {
  source: Trip['milesSource'] | Trip['driveMinutesSource'] | Trip['tollsSource']
}) {
  const mark =
    source === 'override'
      ? { text: 'yours', title: 'You entered this figure for this trip' }
      : source === 'estimated'
        ? { text: 'est.', title: 'Estimated from mileage, not measured' }
        : source === 'park-rush'
          ? { text: 'rush', title: "Uses this park's rush-hour figure for at least one leg" }
          : null

  if (!mark) return null
  return (
    <span style={{ color: 'var(--text-muted)' }} title={mark.title}>
      {' '}
      {mark.text}
    </span>
  )
}

/**
 * The short weekday name for an ISO date. Parsed as UTC so the day never shifts
 * with the viewer's timezone — the same reason the metrics layer does it.
 */
function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
