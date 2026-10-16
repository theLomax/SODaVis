/**
 * One gear set as a card: the kit's pieces listed, and editable once unlocked.
 *
 * Locked, the card reads as the kit. Unlocked, the set can be renamed, tied to a
 * sport, have pieces added or removed, or be deleted.
 */

import { Button, selectStyle } from '../../components/Controls'
import { LockableCard } from '../../components/LockableCard'
import {
  GEAR_CATEGORIES,
  describeProduct,
  isRetired,
  type GearItem,
  type GearProduct,
  type GearSet,
} from '../../../model/gear'
import { TextCell } from '../reference/cells'

export function GearSetCard({
  set,
  items,
  products,
  sports,
  unlocked,
  onToggle,
  onSave,
  onDelete,
}: {
  set: GearSet
  items: GearItem[]
  products: Map<string, GearProduct>
  sports: { code: string; label: string }[]
  unlocked: boolean
  onToggle: () => void
  /** Sets save whole: each change here is a single field, made one at a time. */
  onSave: (patch: Partial<GearSet>) => void
  onDelete: () => void
}) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const members = set.itemIds.map((id) => byId.get(id)).filter((i): i is GearItem => Boolean(i))
  // A retired piece stays listed on the set it was in, marked, so the set's
  // history reads true; it just is not offered for adding again.
  const addable = items.filter((i) => !isRetired(i) && !set.itemIds.includes(i.id))
  const sport = sports.find((s) => s.code === set.sportCode)

  return (
    <LockableCard
      data-gear-set={set.id}
      name={set.name}
      editLabel={`the ${set.name} set`}
      summary={
        unlocked ? null : `${sport?.label ?? 'Any sport'} · ${members.length} piece${members.length === 1 ? '' : 's'}`
      }
      unlocked={unlocked}
      onToggle={onToggle}
    >
      {unlocked ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2" style={{ color: 'var(--text-muted)' }}>
          <label className="flex min-w-0 flex-col gap-0.5">
            Name
            <TextCell
              value={set.name}
              fill
              ariaLabel={`Name of the ${set.name} set`}
              onCommit={(v) => {
                if (v && v !== set.name) onSave({ name: v })
              }}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-0.5">
            Sport
            <select
              value={set.sportCode ?? ''}
              onChange={(e) => onSave({ sportCode: e.target.value || undefined })}
              aria-label={`Sport for the ${set.name} set`}
              className="w-full rounded-md px-1.5 py-0.5 text-xs"
              style={selectStyle}
            >
              <option value="">Any sport</option>
              {sports.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {members.length === 0 ? (
          <li style={{ color: 'var(--text-muted)' }}>Empty.</li>
        ) : (
          members.map((item) => {
            const product = products.get(item.productId)
            return (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{ border: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}
                title={product ? describeProduct(product) : undefined}
              >
                {item.label}
                {isRetired(item) ? <span style={{ color: 'var(--text-muted)' }}>· retired</span> : null}
                {unlocked ? (
                  <button
                    type="button"
                    onClick={() => onSave({ itemIds: set.itemIds.filter((id) => id !== item.id) })}
                    aria-label={`Remove ${item.label} from ${set.name}`}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            )
          })
        )}
      </ul>

      {unlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Adds on pick, so there is no separate confirm button to forget. */}
          {addable.length > 0 ? (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onSave({ itemIds: [...set.itemIds, e.target.value] })
              }}
              aria-label={`Add an item to ${set.name}`}
              className="min-w-0 rounded-md px-1.5 py-0.5 text-xs"
              style={selectStyle}
            >
              <option value="">+ Add item…</option>
              {GEAR_CATEGORIES.map((c) => {
                const inCategory = addable.filter((i) => products.get(i.productId)?.category === c.id)
                return inCategory.length ? (
                  <optgroup key={c.id} label={c.label}>
                    {inCategory.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              })}
            </select>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              {items.length === 0 ? 'Add owned items below to fill this set.' : 'Every item you own is in this set.'}
            </span>
          )}
          <Button variant="danger" onClick={onDelete}>
            Delete set
          </Button>
        </div>
      ) : null}
    </LockableCard>
  )
}
