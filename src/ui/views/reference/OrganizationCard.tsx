/**
 * One organization as a card, locked until its Edit button unlocks it.
 */

import { Button, selectStyle } from '../../components/Controls'
import { CardField, LockableCard } from '../../components/LockableCard'
import { ORGANIZATION_KINDS, type Organization, type OrganizationKind } from '../../../model/reference'
import { TextCell } from './cells'

export function OrganizationCard({
  organization: org,
  games,
  unlocked,
  onToggle,
  onRename,
  onAliases,
  onPatch,
  onDelete,
}: {
  organization: Organization
  games: number
  unlocked: boolean
  onToggle: () => void
  /** Names are checked against every other organization's before saving. */
  onRename: (name: string) => void
  onAliases: (text: string | undefined) => void
  onPatch: (patch: Partial<Omit<Organization, 'id'>>) => void
  onDelete: () => void
}) {
  const kindLabel = ORGANIZATION_KINDS.find((k) => k.id === org.kind)?.label ?? org.kind
  const aliases = (org.aliases ?? []).join(', ')
  return (
    <LockableCard
      data-organization={org.id}
      name={org.name}
      summary={`${games} game${games === 1 ? '' : 's'}`}
      unlocked={unlocked}
      onToggle={onToggle}
    >
      {unlocked ? (
        <div className="flex flex-col gap-2" style={{ color: 'var(--text-muted)' }}>
          <label className="flex flex-col gap-0.5">
            Name
            <TextCell
              value={org.name}
              fill
              ariaLabel={`Name of ${org.name}`}
              onCommit={(v) => {
                if (v && v !== org.name) onRename(v)
              }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            Also known as (separate with commas)
            <TextCell value={aliases} fill ariaLabel={`Other names for ${org.name}`} onCommit={onAliases} />
          </label>
        </div>
      ) : aliases ? (
        <span className="break-words" style={{ color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)' }}>Also known as: </span>
          {aliases}
        </span>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
        <CardField label="Kind">
          {unlocked ? (
            <select
              value={org.kind}
              onChange={(e) => onPatch({ kind: e.target.value as OrganizationKind })}
              aria-label={`Kind of ${org.name}`}
              className="w-full rounded-md px-1.5 py-0.5 text-xs"
              style={selectStyle}
            >
              {ORGANIZATION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          ) : (
            kindLabel
          )}
        </CardField>
        <CardField label="Platform">
          {unlocked ? (
            <TextCell
              value={org.platform}
              fill
              ariaLabel={`Platform ${org.name} uses`}
              onCommit={(v) => {
                if (v !== org.platform) onPatch({ platform: v })
              }}
            />
          ) : (
            (org.platform ?? '—')
          )}
        </CardField>
      </dl>

      {unlocked ? (
        <div className="flex justify-end">
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </LockableCard>
  )
}
