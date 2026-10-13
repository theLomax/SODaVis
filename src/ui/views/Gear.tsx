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
import { formatMoney } from '../../derive/money'
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
import { toggledIn } from '../components/LockableCard'
import { GearItemCard } from './gear/GearItemCard'
import { GearProductCard } from './gear/GearProductCard'
import { GearSetCard } from './gear/GearSetCard'

export function Gear() {
  const { derived, reload } = useStore()
  const [error, setError] = useState<string | null>(null)

  if (!derived) return null
  const { gearProducts, gearItems, gearSets } = derived.snapshot
  const sports = derived.trackedSports
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
      <ItemsCard
        items={gearItems}
        products={gearProducts}
        sets={gearSets}
        currency={derived.snapshot.settings.currency}
        run={run}
      />
      <CatalogCard products={gearProducts} items={gearItems} run={run} />
    </div>
  )
}

type Run = (action: () => Promise<void>) => Promise<void>

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
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
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
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
      subtitle="Kits you wear together, such as “BB: Plate Gear” or “SB: Bases”, so a whole set can go on a game in one step. Choose Edit on a set to change what is in it."
    >
      {sorted.length === 0 ? (
        <Muted>No sets yet. Name one below, then add items to it.</Muted>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((set) => (
            <GearSetCard
              key={set.id}
              set={set}
              items={items}
              products={products}
              sports={sports}
              unlocked={unlocked.has(set.id)}
              onToggle={() => setUnlocked((u) => toggledIn(u, set.id))}
              onSave={(patch) => void run(() => saveGearSet({ ...set, ...patch }))}
              onDelete={() => void run(() => deleteGearSet(set.id))}
            />
          ))}
        </ul>
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

// ---------------------------------------------------------------------------
// Owned items
// ---------------------------------------------------------------------------

function ItemsCard({
  items,
  products,
  sets,
  currency,
  run,
}: {
  items: GearItem[]
  products: GearProduct[]
  sets: GearSet[]
  currency: string
  run: Run
}) {
  const [productId, setProductId] = useState('')
  const [label, setLabel] = useState('')
  const [acquiredOn, setAcquiredOn] = useState('')
  const [size, setSize] = useState('')
  const [price, setPrice] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  /** The cards open for editing. Every card starts locked. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())

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

  return (
    <Card
      title="My gear"
      subtitle="Each physical piece you own. Two of the same shirt are two items, so “Black V3 #1” and “#2” can be tracked apart. Choose Edit on an item to change, retire or delete it."
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
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => (
            <GearItemCard
              key={item.id}
              item={item}
              product={byProduct.get(item.productId)}
              setCount={setCount(item.id)}
              currency={currency}
              unlocked={unlocked.has(item.id)}
              onToggle={() => setUnlocked((u) => toggledIn(u, item.id))}
              onPatch={(patch) => void run(() => patchGearItem(item.id, patch))}
              onDelete={() => void run(() => deleteGearItem(item.id))}
            />
          ))}
        </ul>
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
          Price paid, {currency} (optional)
          <TextInput value={price} onChange={setPrice} width={90} placeholder={formatMoney(0, currency)} ariaLabel="Price paid for the new item" />
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
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
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
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => (
            <GearProductCard
              key={p.id}
              product={p}
              owned={owned(p.id)}
              unlocked={unlocked.has(p.id)}
              onToggle={() => setUnlocked((u) => toggledIn(u, p.id))}
              onPatchText={(key, v) => patch(p, key, v)}
              onVendorSkus={(next) => setVendorSkus(p, next)}
              onDelete={() => void run(() => deleteGearProduct(p.id))}
            />
          ))}
        </ul>
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
