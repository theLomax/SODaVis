/**
 * One partner as a card. The figures are read from the games and cannot be
 * edited; unlocking the card opens the one thing the user can add — how to reach
 * them.
 */

import { CardField, LockableCard } from '../../components/LockableCard'
import type { Breakdown } from '../../../derive/metrics'
import { formatMoney } from '../../../derive/money'
import { formatMinutes } from '../../../derive/time'
import type { PartnerContact } from '../../../model/reference'
import { TextCell } from '../reference/cells'

export function PartnerCard({
  partner,
  contact,
  currency,
  unlocked,
  onToggle,
  onPatch,
}: {
  partner: Breakdown
  contact: PartnerContact | undefined
  currency: string
  unlocked: boolean
  onToggle: () => void
  onPatch: (patch: Partial<Omit<PartnerContact, 'id'>>) => void
}) {
  const name = partner.label
  const field = (key: 'phone' | 'email' | 'notes', label: string, what: string) => (
    <label className="flex flex-col gap-0.5">
      {label}
      <TextCell
        value={contact?.[key]}
        fill
        ariaLabel={`${what} ${name}`}
        onCommit={(v) => {
          if (v !== contact?.[key]) onPatch({ [key]: v })
        }}
      />
    </label>
  )
  return (
    <LockableCard
      data-partner={partner.key}
      name={name}
      editLabel={`contact details for ${name}`}
      summary={`${partner.games} game${partner.games === 1 ? '' : 's'} · ${formatMoney(partner.gross, currency)}`}
      unlocked={unlocked}
      onToggle={onToggle}
    >
      <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-2">
        <CardField label="Time">{formatMinutes(partner.minutes)}</CardField>
        <CardField label="Per hour">{partner.perHour == null ? '—' : formatMoney(partner.perHour, currency)}</CardField>
        <CardField label="Per game">{partner.perGame == null ? '—' : formatMoney(partner.perGame, currency)}</CardField>
      </dl>
      {partner.incompleteGames > 0 ? (
        <span style={{ color: 'var(--text-muted)' }}>
          {partner.incompleteGames} game{partner.incompleteGames === 1 ? ' has' : 's have'} no known duration, so the
          time understates.
        </span>
      ) : null}

      {unlocked ? (
        <div className="flex flex-col gap-2" style={{ color: 'var(--text-muted)' }}>
          {field('phone', 'Phone', 'Phone number for')}
          {field('email', 'Email', 'Email address for')}
          {field('notes', 'Notes', 'Notes on')}
        </div>
      ) : contact ? (
        <div className="flex flex-col gap-1 break-words" style={{ color: 'var(--text-secondary)' }}>
          {contact.phone ? (
            <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} style={{ color: 'var(--text-primary)' }}>
              {contact.phone}
            </a>
          ) : null}
          {contact.email ? (
            <a href={`mailto:${contact.email}`} style={{ color: 'var(--text-primary)' }}>
              {contact.email}
            </a>
          ) : null}
          {contact.notes ? <span style={{ color: 'var(--text-muted)' }}>{contact.notes}</span> : null}
        </div>
      ) : null}
    </LockableCard>
  )
}
