/**
 * One owned piece of gear as a card, locked until its Edit button unlocks it.
 *
 * Retiring is the everyday exit and keeps history; delete is for an item entered
 * by mistake. Both show only while the card is unlocked.
 */

import { Button, selectStyle } from '../../components/Controls'
import { CardField, LockableCard } from '../../components/LockableCard'
import { StatusChip } from '../../components/Tiles'
import { formatMoney } from '../../../derive/money'
import { describeProduct, gearCategoryLabel, isRetired, type GearItem, type GearProduct } from '../../../model/gear'
import { MoneyCell, TextCell } from '../reference/cells'

export function GearItemCard({
  item,
  product,
  setCount,
  currency,
  unlocked,
  onToggle,
  onPatch,
  onDelete,
}: {
  item: GearItem
  product: GearProduct | undefined
  /** How many sets the item is part of. */
  setCount: number
  currency: string
  unlocked: boolean
  onToggle: () => void
  onPatch: (patch: Partial<Omit<GearItem, 'id'>>) => void
  onDelete: () => void
}) {
  const retired = isRetired(item)
  return (
    <LockableCard
      data-gear-item={item.id}
      name={item.label}
      badge={retired ? <StatusChip role="warning" label={`retired ${item.retiredOn}`} /> : null}
      summary={
        product ? (
          <>
            <span style={{ color: 'var(--text-muted)' }}>{gearCategoryLabel(product.category)} · </span>
            {describeProduct(product)}
          </>
        ) : (
          'Unknown product'
        )
      }
      unlocked={unlocked}
      onToggle={onToggle}
      dimmed={retired}
    >
      {unlocked ? (
        <label className="flex flex-col gap-0.5" style={{ color: 'var(--text-muted)' }}>
          Name
          <TextCell
            value={item.label}
            fill
            ariaLabel={`Name of ${item.label}`}
            onCommit={(v) => {
              if (v && v !== item.label) onPatch({ label: v })
            }}
          />
        </label>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
        <CardField label="Size">
          {unlocked ? (
            <TextCell
              value={item.size}
              fill
              ariaLabel={`Size of ${item.label}`}
              onCommit={(v) => {
                if (v !== item.size) onPatch({ size: v })
              }}
            />
          ) : (
            (item.size ?? '—')
          )}
        </CardField>
        <CardField label="Price paid">
          {unlocked ? (
            <MoneyCell
              value={item.pricePaid}
              currency={currency}
              fill
              ariaLabel={`Price paid for ${item.label}`}
              onCommit={(v) => {
                // A negative price is a typo, not a refund; leave the figure alone.
                if (v === item.pricePaid || (v !== undefined && v < 0)) return
                onPatch({ pricePaid: v })
              }}
            />
          ) : (
            formatMoney(item.pricePaid, currency)
          )}
        </CardField>
        <CardField label="Acquired">
          {unlocked ? (
            <input
              type="date"
              value={item.acquiredOn ?? ''}
              onChange={(e) => onPatch({ acquiredOn: e.target.value || undefined })}
              aria-label={`Date ${item.label} was acquired`}
              className="w-full rounded-md px-1.5 py-0.5 text-xs"
              style={selectStyle}
            />
          ) : (
            (item.acquiredOn ?? '—')
          )}
        </CardField>
        <CardField label="In sets">{setCount}</CardField>
      </dl>

      {unlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {retired ? (
            <Button onClick={() => onPatch({ retiredOn: undefined })}>Unretire</Button>
          ) : (
            <Button onClick={() => onPatch({ retiredOn: new Date().toISOString().slice(0, 10) })}>Retire</Button>
          )}
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </LockableCard>
  )
}
