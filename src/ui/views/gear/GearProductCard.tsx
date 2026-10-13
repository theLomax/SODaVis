/**
 * One catalog product as a card, locked until its Edit button unlocks it.
 */

import { useState } from 'react'
import { Button, TextInput } from '../../components/Controls'
import { CardField, LockableCard } from '../../components/LockableCard'
import { describeProduct, gearCategoryLabel, isValidUpc, type GearProduct, type VendorSku } from '../../../model/gear'
import { TextCell } from '../reference/cells'

type TextKey = 'name' | 'brand' | 'color' | 'upc' | 'brandProductId'

export function GearProductCard({
  product: p,
  owned,
  unlocked,
  onToggle,
  onPatchText,
  onVendorSkus,
  onDelete,
}: {
  product: GearProduct
  /** How many owned items are this product. */
  owned: number
  unlocked: boolean
  onToggle: () => void
  /** Commits one text field; the caller checks it against duplicates first. */
  onPatchText: (key: TextKey, value: string | undefined) => void
  onVendorSkus: (next: VendorSku[]) => void
  onDelete: () => void
}) {
  const label = describeProduct(p)
  const upcWarning =
    p.upc && !isValidUpc(p.upc) ? (
      <span
        className="ml-1"
        title="The last digit does not check out for a 12- or 13-digit UPC. Kept as typed, in case the label reads that way."
        style={{ color: 'var(--status-warning)' }}
      >
        check
      </span>
    ) : null
  const field = (key: TextKey, text: string) =>
    unlocked ? (
      <TextCell value={p[key]} fill ariaLabel={`${text} of ${label}`} onCommit={(v) => onPatchText(key, v)} />
    ) : (
      (p[key] ?? '—')
    )

  return (
    <LockableCard
      data-gear-product={p.id}
      name={label}
      summary={`${gearCategoryLabel(p.category)} · ${owned} owned`}
      unlocked={unlocked}
      onToggle={onToggle}
    >
      {unlocked ? (
        <label className="flex flex-col gap-0.5" style={{ color: 'var(--text-muted)' }}>
          Name
          {field('name', 'Name')}
        </label>
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
        <CardField label="Brand">{field('brand', 'Brand')}</CardField>
        <CardField label="Color">{field('color', 'Color')}</CardField>
        <CardField label="UPC">
          {field('upc', 'UPC')}
          {upcWarning}
        </CardField>
        <CardField label="Product no.">{field('brandProductId', 'Product number')}</CardField>
      </dl>

      <div className="flex flex-col gap-1">
        <span style={{ color: 'var(--text-muted)' }}>Retailer SKUs</span>
        <VendorSkus product={p} editable={unlocked} onChange={onVendorSkus} />
      </div>

      {p.url || unlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--text-secondary)' }}>
              Link
            </a>
          ) : (
            <span />
          )}
          {unlocked ? (
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </LockableCard>
  )
}

/**
 * A product's retailer SKUs as chips, each removable, with an inline form to add
 * one. A pair, never a bare SKU: a SKU is only unique at the retailer that set it.
 */
function VendorSkus({
  product,
  editable,
  onChange,
}: {
  product: GearProduct
  editable: boolean
  onChange: (next: VendorSku[]) => void
}) {
  const [vendor, setVendor] = useState('')
  const [sku, setSku] = useState('')
  const list = product.vendorSkus ?? []
  const label = describeProduct(product)

  function save() {
    if (!vendor.trim() || !sku.trim()) return
    onChange([...list, { vendor: vendor.trim(), sku: sku.trim() }])
    setVendor('')
    setSku('')
  }

  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 && !editable ? <span style={{ color: 'var(--text-primary)' }}>—</span> : null}
      {list.length > 0 ? (
        <span className="flex flex-wrap items-center gap-1">
          {list.map((v, i) => (
            <span
              key={`${v.vendor}|${v.sku}`}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{ border: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{v.vendor}:</span> {v.sku}
              {editable ? (
                <button
                  type="button"
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                  aria-label={`Remove the ${v.vendor} SKU from ${label}`}
                  style={{ color: 'var(--text-muted)' }}
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))}
        </span>
      ) : null}
      {editable ? (
        <span className="flex flex-wrap items-center gap-1">
          <TextInput value={vendor} onChange={setVendor} width={90} placeholder="Retailer" ariaLabel={`Retailer for a new SKU on ${label}`} />
          <TextInput value={sku} onChange={setSku} width={90} placeholder="SKU" ariaLabel={`New retailer SKU for ${label}`} />
          <Button onClick={save} disabled={!vendor.trim() || !sku.trim()}>
            Add SKU
          </Button>
        </span>
      ) : null}
    </div>
  )
}
