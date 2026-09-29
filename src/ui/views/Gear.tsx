/**
 * Gear: the pieces the user owns, the sets they wear together, and the catalog
 * both are drawn from. Managed here rather than analyzed — there are no charts,
 * because the questions this data exists for ("which shirt color is worn most")
 * need per-game gear first, and that is a later step.
 *
 * Top to bottom in the order the work happens: sets are what a game will use, so
 * they lead; owned items are what sets are made of; the catalog is the reference
 * underneath, consulted only when adding something new.
 */

import { useState } from 'react'
import { useStore } from '../store'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { Card } from '../components/Tiles'
import {
  deleteGearItem,
  deleteGearProduct,
  deleteGearSet,
  patchGearItem,
  patchGearProduct,
  saveGearItem,
  saveGearProduct,
  saveGearSet,
} from '../../db/repo'
import {
  GEAR_CATEGORIES,
  describeProduct,
  gearCategoryLabel,
  isRetired,
  newGearId,
  nextItemLabel,
  parsePricePaid,
  DUPLICATE_REASON,
  findDuplicateProduct,
  isValidUpc,
  normalizeGearProduct,
  type DuplicateMatch,
  type GearCategory,
  type GearItem,
  type GearProduct,
  type GearSet,
  type VendorSku,
} from '../../model/gear'
import { NumberCell, TextCell } from './reference/cells'

export function Gear() {
  const { derived, reload } = useStore()
  const [error, setError] = useState<string | null>(null)

  if (!derived) return null
  const { gearProducts, gearItems, gearSets, sports } = derived.snapshot
  const products = new Map(gearProducts.map((p) => [p.id, p]))

  /** Every write goes through here, so a refusal from the repo shows as a message. */
  async function run(action: () => Promise<void>) {
    try {
      setError(null)
      await action()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="card m-0 p-3 text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      ) : null}
      <SetsCard sets={gearSets} items={gearItems} products={products} sports={sports} run={run} />
      <ItemsCard items={gearItems} products={gearProducts} sets={gearSets} run={run} />
      <CatalogCard products={gearProducts} items={gearItems} run={run} />
    </div>
  )
}

type Run = (action: () => Promise<void>) => Promise<void>

const th = (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
  textAlign: align,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--gridline)',
})

const rowStyle: React.CSSProperties = { borderBottom: '1px solid var(--gridline)', color: 'var(--text-primary)' }

function HeaderRow({ headers }: { headers: string[] }) {
  return (
    <thead>
      <tr>
        {headers.map((h, i) => (
          <th key={h || i} scope="col" className="px-2 py-1.5 font-medium" style={th()}>
            {h ? h : <span className="sr-only">Actions</span>}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  )
}

/** A row action that reads as a link, matching the ✕ / Delete buttons elsewhere. */
function RowAction({
  children,
  onClick,
  ariaLabel,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="text-xs"
      style={{ color: danger ? 'var(--status-critical)' : 'var(--text-secondary)' }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

function SetsCard({
  sets,
  items,
  products,
  sports,
  run,
}: {
  sets: GearSet[]
  items: GearItem[]
  products: Map<string, GearProduct>
  sports: { code: string; label: string }[]
  run: Run
}) {
  const [name, setName] = useState('')
  const sorted = [...sets].sort((a, b) => a.name.localeCompare(b.name))

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    await run(() => saveGearSet({ id: newGearId('gs'), name: trimmed, itemIds: [] }))
    setName('')
  }

  return (
    <Card
      title="Gear sets"
      subtitle="Kits you wear together, such as “BB: Plate Gear” or “SB: Bases”, so a whole set can go on a game in one step."
    >
      {sorted.length === 0 ? (
        <Muted>No sets yet. Name one below, then add items to it.</Muted>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((set) => (
            <SetRow key={set.id} set={set} items={items} products={products} sports={sports} run={run} />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          New set
          <TextInput value={name} onChange={setName} width={220} placeholder="BB: Plate Gear" ariaLabel="New gear set name" />
        </label>
        <Button onClick={() => void add()} disabled={!name.trim()}>
          Add set
        </Button>
      </div>
    </Card>
  )
}

function SetRow({
  set,
  items,
  products,
  sports,
  run,
}: {
  set: GearSet
  items: GearItem[]
  products: Map<string, GearProduct>
  sports: { code: string; label: string }[]
  run: Run
}) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const members = set.itemIds.map((id) => byId.get(id)).filter((i): i is GearItem => Boolean(i))
  // A retired piece stays listed on the set it was in, marked, so the set's
  // history reads true; it just is not offered for adding again.
  const addable = items.filter((i) => !isRetired(i) && !set.itemIds.includes(i.id))

  const save = (patch: Partial<GearSet>) => run(() => saveGearSet({ ...set, ...patch }))

  return (
    <div className="rounded-md p-3" style={{ border: '1px solid var(--border-hairline)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <TextCell
          value={set.name}
          ariaLabel={`Name of the ${set.name} set`}
          width={200}
          onCommit={(v) => {
            if (v && v !== set.name) void save({ name: v })
          }}
        />
        <select
          value={set.sportCode ?? ''}
          onChange={(e) => void save({ sportCode: e.target.value || undefined })}
          aria-label={`Sport for the ${set.name} set`}
          className="rounded-md px-1.5 py-0.5 text-xs"
          style={selectStyle}
        >
          <option value="">Any sport</option>
          {sports.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="ml-auto">
          <RowAction danger onClick={() => void run(() => deleteGearSet(set.id))} ariaLabel={`Delete the ${set.name} set`}>
            Delete set
          </RowAction>
        </span>
      </div>

      <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
        {members.length === 0 ? (
          <li className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Empty.
          </li>
        ) : (
          members.map((item) => {
            const product = products.get(item.productId)
            return (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                style={{ border: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}
                title={product ? describeProduct(product) : undefined}
              >
                {item.label}
                {isRetired(item) ? <span style={{ color: 'var(--text-muted)' }}>· retired</span> : null}
                <button
                  type="button"
                  onClick={() => void save({ itemIds: set.itemIds.filter((id) => id !== item.id) })}
                  aria-label={`Remove ${item.label} from ${set.name}`}
                  style={{ color: 'var(--text-muted)' }}
                >
                  ✕
                </button>
              </li>
            )
          })
        )}
      </ul>

      {/* Adds on pick, so there is no separate confirm button to forget. */}
      {addable.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) void save({ itemIds: [...set.itemIds, e.target.value] })
          }}
          aria-label={`Add an item to ${set.name}`}
          className="mt-2 rounded-md px-1.5 py-0.5 text-xs"
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
      ) : items.length === 0 ? (
        <p className="m-0 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Add owned items below to fill this set.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Owned items
// ---------------------------------------------------------------------------

function ItemsCard({
  items,
  products,
  sets,
  run,
}: {
  items: GearItem[]
  products: GearProduct[]
  sets: GearSet[]
  run: Run
}) {
  const [productId, setProductId] = useState('')
  const [label, setLabel] = useState('')
  const [acquiredOn, setAcquiredOn] = useState('')
  const [size, setSize] = useState('')
  const [price, setPrice] = useState('')
  const [showRetired, setShowRetired] = useState(false)

  const byProduct = new Map(products.map((p) => [p.id, p]))
  const setCount = (id: string) => sets.filter((s) => s.itemIds.includes(id)).length
  const retiredCount = items.filter(isRetired).length
  const shown = items
    .filter((i) => showRetired || !isRetired(i))
    .sort((a, b) => {
      const ca = GEAR_CATEGORIES.findIndex((c) => c.id === byProduct.get(a.productId)?.category)
      const cb = GEAR_CATEGORIES.findIndex((c) => c.id === byProduct.get(b.productId)?.category)
      return ca - cb || a.label.localeCompare(b.label)
    })

  function pickProduct(id: string) {
    setProductId(id)
    const product = byProduct.get(id)
    // Suggest "Black Short-sleeve shirt #2" so a second copy is never a duplicate
    // name; the user can overwrite it before adding.
    setLabel(product ? nextItemLabel(product, items) : '')
  }

  const pricePaid = parsePricePaid(price)

  async function add() {
    if (!productId || !label.trim() || pricePaid === null) return
    await run(() =>
      saveGearItem({
        id: newGearId('gi'),
        productId,
        label: label.trim(),
        ...(acquiredOn ? { acquiredOn } : {}),
        ...(size.trim() ? { size: size.trim() } : {}),
        ...(pricePaid !== undefined ? { pricePaid } : {}),
      }),
    )
    setProductId('')
    setLabel('')
    setAcquiredOn('')
    setSize('')
    setPrice('')
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <Card
      title="My gear"
      subtitle="Each physical piece you own. Two of the same shirt are two items, so “Black V3 #1” and “#2” can be tracked apart."
      action={
        retiredCount > 0 ? (
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show retired ({retiredCount})
          </label>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <Muted>
          {items.length === 0
            ? 'Nothing owned yet. Pick a product below, from the catalog or one you add to it.'
            : 'Every item is retired.'}
        </Muted>
      ) : (
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <HeaderRow headers={['Item', 'Product', 'Size', 'Price paid', 'Acquired', 'In sets', 'Status', '']} />
            <tbody>
              {shown.map((item) => {
                const product = byProduct.get(item.productId)
                const retired = isRetired(item)
                return (
                  <tr key={item.id} style={{ ...rowStyle, opacity: retired ? 0.6 : 1 }}>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={item.label}
                        ariaLabel={`Name of ${item.label}`}
                        width={220}
                        onCommit={(v) => {
                          if (v && v !== item.label) void run(() => patchGearItem(item.id, { label: v }))
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {product ? (
                        <>
                          <span style={{ color: 'var(--text-muted)' }}>{gearCategoryLabel(product.category)} · </span>
                          {describeProduct(product)}
                        </>
                      ) : (
                        'Unknown product'
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={item.size}
                        ariaLabel={`Size of ${item.label}`}
                        width={70}
                        onCommit={(v) => {
                          if (v !== item.size) void run(() => patchGearItem(item.id, { size: v }))
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberCell
                        value={item.pricePaid}
                        step="0.01"
                        ariaLabel={`Price paid for ${item.label}`}
                        onCommit={(v) => {
                          // A negative price is a typo, not a refund; leave the figure alone.
                          if (v === item.pricePaid || (v !== undefined && v < 0)) return
                          void run(() => patchGearItem(item.id, { pricePaid: v }))
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={item.acquiredOn ?? ''}
                        onChange={(e) =>
                          void run(() => patchGearItem(item.id, { acquiredOn: e.target.value || undefined }))
                        }
                        aria-label={`Date ${item.label} was acquired`}
                        className="rounded-md px-1.5 py-0.5 text-xs"
                        style={selectStyle}
                      />
                    </td>
                    <td className="num-tabular px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {setCount(item.id)}
                    </td>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {retired ? `Retired ${item.retiredOn}` : 'In use'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {/* Retiring is the everyday exit and keeps history; delete is
                          for a row entered by mistake. */}
                      <span className="inline-flex gap-3">
                        {retired ? (
                          <RowAction
                            onClick={() => void run(() => patchGearItem(item.id, { retiredOn: undefined }))}
                            ariaLabel={`Return ${item.label} to use`}
                          >
                            Unretire
                          </RowAction>
                        ) : (
                          <RowAction
                            onClick={() => void run(() => patchGearItem(item.id, { retiredOn: today }))}
                            ariaLabel={`Retire ${item.label}`}
                          >
                            Retire
                          </RowAction>
                        )}
                        <RowAction
                          danger
                          onClick={() => void run(() => deleteGearItem(item.id))}
                          ariaLabel={`Delete ${item.label}`}
                        >
                          Delete
                        </RowAction>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Product
          <select
            value={productId}
            onChange={(e) => pickProduct(e.target.value)}
            aria-label="Product for the new item"
            className="rounded-md px-2 py-1 text-xs"
            style={selectStyle}
          >
            <option value="">Choose…</option>
            {GEAR_CATEGORIES.map((c) => {
              const inCategory = products.filter((p) => p.category === c.id)
              return inCategory.length ? (
                <optgroup key={c.id} label={c.label}>
                  {inCategory.map((p) => (
                    <option key={p.id} value={p.id}>
                      {describeProduct(p)}
                    </option>
                  ))}
                </optgroup>
              ) : null
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Name
          <TextInput value={label} onChange={setLabel} width={200} placeholder="Black V3 #1" ariaLabel="Name for the new item" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Acquired (optional)
          <input
            type="date"
            value={acquiredOn}
            onChange={(e) => setAcquiredOn(e.target.value)}
            aria-label="Date the new item was acquired"
            className="rounded-md px-2 py-1 text-xs"
            style={selectStyle}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Size (optional)
          <TextInput value={size} onChange={setSize} width={70} placeholder="L" ariaLabel="Size of the new item" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Price paid (optional)
          <TextInput value={price} onChange={setPrice} type="number" step="0.01" width={90} ariaLabel="Price paid for the new item" />
        </label>
        <Button onClick={() => void add()} disabled={!productId || !label.trim() || pricePaid === null}>
          Add item
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function CatalogCard({
  products,
  items,
  run,
}: {
  products: GearProduct[]
  items: GearItem[]
  run: Run
}) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<GearCategory>('shirt')
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [color, setColor] = useState('')
  const [upc, setUpc] = useState('')
  const [brandProductId, setBrandProductId] = useState('')
  const [vendor, setVendor] = useState('')
  const [vendorSku, setVendorSku] = useState('')
  const [url, setUrl] = useState('')
  /** A likely duplicate found on Add, held until the user confirms or backs out. */
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null)
  /** Said after an inline edit makes two entries share an identifier. */
  const [notice, setNotice] = useState<string | null>(null)

  const owned = (id: string) => items.filter((i) => i.productId === id).length
  const sorted = [...products].sort(
    (a, b) =>
      GEAR_CATEGORIES.findIndex((c) => c.id === a.category) - GEAR_CATEGORIES.findIndex((c) => c.id === b.category) ||
      describeProduct(a).localeCompare(describeProduct(b)),
  )

  const opt = (v: string) => v.trim() || undefined

  function draft(): GearProduct {
    return normalizeGearProduct({
      id: newGearId('gp'),
      category,
      name: name.trim(),
      origin: 'user',
      ...(opt(brand) ? { brand: opt(brand)! } : {}),
      ...(opt(color) ? { color: opt(color)! } : {}),
      ...(opt(upc) ? { upc: opt(upc)! } : {}),
      ...(opt(brandProductId) ? { brandProductId: opt(brandProductId)! } : {}),
      ...(opt(vendor) && opt(vendorSku) ? { vendorSkus: [{ vendor: opt(vendor)!, sku: opt(vendorSku)! }] } : {}),
      ...(opt(url) ? { url: opt(url)! } : {}),
    })
  }

  /** Checks for a duplicate first; `force` is the "add anyway" answer. */
  async function add(force = false) {
    if (!name.trim()) return
    const product = draft()
    // The draft's fresh id cannot match anything, so it is left out of the check.
    const { id: _fresh, ...identifiers } = product
    void _fresh
    const match = force ? undefined : findDuplicateProduct(identifiers, products)
    if (match) {
      setDuplicate(match)
      return
    }
    await run(() => saveGearProduct(product))
    setDuplicate(null)
    for (const clear of [setName, setBrand, setColor, setUpc, setBrandProductId, setVendor, setVendorSku, setUrl]) clear('')
  }

  type TextKey = 'name' | 'brand' | 'color' | 'upc' | 'brandProductId'

  /** Blank clears the field rather than storing an empty string. */
  function patch(product: GearProduct, key: TextKey, v: string | undefined) {
    if (key === 'name' && !v) return
    if ((product[key] ?? undefined) === v) return
    const { id: _own, ...next } = normalizeGearProduct({ ...product, [key]: v || undefined })
    void _own
    const match = findDuplicateProduct(next, products.filter((p) => p.id !== product.id))
    setNotice(
      match
        ? `${describeProduct(product)} now has ${DUPLICATE_REASON[match.on]} as ${describeProduct(match.product)}. They are probably the same product.`
        : null,
    )
    void run(() => patchGearProduct(product.id, { [key]: v || undefined }))
  }

  function setVendorSkus(product: GearProduct, next: VendorSku[]) {
    void run(() => patchGearProduct(product.id, { vendorSkus: next.length ? next : undefined }))
  }

  return (
    <Card
      title="Catalog"
      subtitle="The products your items are drawn from. A starting list ships with the app; add the exact ones you own. A UPC, the brand's product number or a retailer SKU lets the same product be recognized when it is entered twice."
      action={
        <Button onClick={() => setOpen(!open)}>{open ? 'Hide catalog' : `Show catalog (${products.length})`}</Button>
      }
    >
      {notice ? (
        <p role="status" className="m-0 mb-2 text-xs" style={{ color: 'var(--status-warning)' }}>
          {notice}
        </p>
      ) : null}
      {/* Collapsed by default: the catalog is consulted when adding gear, not
          read every visit, and a long list would push the sets off screen. */}
      {open ? (
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <HeaderRow headers={['Category', 'Name', 'Brand', 'Color', 'UPC', 'Product no.', 'Retailer SKUs', 'Owned', '']} />
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} style={rowStyle}>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {gearCategoryLabel(p.category)}
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell
                      value={p.name}
                      width={190}
                      ariaLabel={`Name of ${describeProduct(p)}`}
                      onCommit={(v) => patch(p, 'name', v)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={p.brand} ariaLabel={`Brand of ${describeProduct(p)}`} onCommit={(v) => patch(p, 'brand', v)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell value={p.color} ariaLabel={`Color of ${describeProduct(p)}`} onCommit={(v) => patch(p, 'color', v)} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <TextCell value={p.upc} width={120} ariaLabel={`UPC of ${describeProduct(p)}`} onCommit={(v) => patch(p, 'upc', v)} />
                    {p.upc && !isValidUpc(p.upc) ? (
                      <span
                        className="ml-1"
                        title="The last digit does not check out for a 12- or 13-digit UPC. Kept as typed, in case the label reads that way."
                        style={{ color: 'var(--status-warning)' }}
                      >
                        check
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell
                      value={p.brandProductId}
                      ariaLabel={`Product number of ${describeProduct(p)}`}
                      onCommit={(v) => patch(p, 'brandProductId', v)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <VendorSkuCell product={p} onChange={(next) => setVendorSkus(p, next)} />
                  </td>
                  <td className="num-tabular px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {owned(p.id)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <span className="inline-flex gap-3">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--text-secondary)' }}>
                          Link
                        </a>
                      ) : null}
                      <RowAction
                        danger
                        onClick={() => void run(() => deleteGearProduct(p.id))}
                        ariaLabel={`Delete ${describeProduct(p)} from the catalog`}
                      >
                        Delete
                      </RowAction>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as GearCategory)}
            aria-label="Category for the new product"
            className="rounded-md px-2 py-1 text-xs"
            style={selectStyle}
          >
            {GEAR_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Name
          <TextInput value={name} onChange={setName} width={170} placeholder="V3 short-sleeve shirt" ariaLabel="Name for the new product" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Brand
          <TextInput value={brand} onChange={setBrand} width={110} ariaLabel="Brand for the new product" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Color
          <TextInput value={color} onChange={setColor} width={100} ariaLabel="Color for the new product" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          UPC
          <TextInput value={upc} onChange={setUpc} width={120} placeholder="12 digits" ariaLabel="UPC for the new product" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Product no.
          <TextInput value={brandProductId} onChange={setBrandProductId} width={110} ariaLabel="Brand product number for the new product" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Retailer
          <TextInput value={vendor} onChange={setVendor} width={100} ariaLabel="Retailer for the new product's SKU" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Retailer SKU
          <TextInput value={vendorSku} onChange={setVendorSku} width={100} ariaLabel="Retailer SKU for the new product" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Link (optional)
          <TextInput value={url} onChange={setUrl} width={180} placeholder="https://" ariaLabel="Shop link for the new product" />
        </label>
        <Button onClick={() => void add()} disabled={!name.trim()}>
          Add product
        </Button>
      </div>
      {opt(upc) && !isValidUpc(upc) ? (
        <p className="m-0 mt-1 text-xs" style={{ color: 'var(--status-warning)' }}>
          The UPC's last digit does not check out. It will be saved as typed; compare it with the label.
        </p>
      ) : null}
      {Boolean(opt(vendor)) !== Boolean(opt(vendorSku)) ? (
        <p className="m-0 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          A retailer SKU needs both the retailer and the SKU; one on its own is not saved.
        </p>
      ) : null}
      {duplicate ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span style={{ color: 'var(--status-warning)' }}>
            Looks like {describeProduct(duplicate.product)}, already in the catalog with {DUPLICATE_REASON[duplicate.on]}.
          </span>
          <Button onClick={() => void add(true)}>Add anyway</Button>
          <Button onClick={() => setDuplicate(null)}>Cancel</Button>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * Retailer SKUs as chips, each removable, with an inline pair of fields to add
 * one. A pair, never a bare SKU: a SKU is only unique at the retailer that set it.
 */
function VendorSkuCell({ product, onChange }: { product: GearProduct; onChange: (next: VendorSku[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [vendor, setVendor] = useState('')
  const [sku, setSku] = useState('')
  const list = product.vendorSkus ?? []
  const label = describeProduct(product)

  function save() {
    if (!vendor.trim() || !sku.trim()) return
    onChange([...list, { vendor: vendor.trim(), sku: sku.trim() }])
    setVendor('')
    setSku('')
    setAdding(false)
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {list.map((v, i) => (
        <span
          key={`${v.vendor}|${v.sku}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{ border: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}
        >
          <span style={{ color: 'var(--text-muted)' }}>{v.vendor}:</span> {v.sku}
          <button
            type="button"
            onClick={() => onChange(list.filter((_, j) => j !== i))}
            aria-label={`Remove the ${v.vendor} SKU from ${label}`}
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <TextInput value={vendor} onChange={setVendor} width={80} placeholder="Retailer" ariaLabel={`Retailer for a new SKU on ${label}`} />
          <TextInput value={sku} onChange={setSku} width={80} placeholder="SKU" ariaLabel={`New retailer SKU for ${label}`} />
          <RowAction onClick={save} ariaLabel={`Save the retailer SKU on ${label}`}>
            Save
          </RowAction>
          <RowAction onClick={() => setAdding(false)} ariaLabel="Cancel adding a retailer SKU">
            Cancel
          </RowAction>
        </span>
      ) : (
        <RowAction onClick={() => setAdding(true)} ariaLabel={`Add a retailer SKU to ${label}`}>
          + SKU
        </RowAction>
      )}
    </span>
  )
}
