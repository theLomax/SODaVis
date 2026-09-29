/**
 * Gear inventory: the products that exist, the pieces a user owns, and the sets
 * they wear together.
 *
 * Three layers rather than one, because the later questions need them apart.
 * "The most popular chest-protector brand" counts products across users, so a
 * product must mean the same thing on every machine. "How long does a mask
 * last" follows one owned piece from purchase to retirement, so two identical
 * shirts must be two records. A set is only a convenience for putting a kit on
 * a game in one step.
 *
 * Nothing here feeds prep time yet. Position and the gear modifiers on a game
 * annotation still do that; see `toDo.md` for the decision on merging them.
 */

export type GearCategory =
  | 'shirt'
  | 'jacket'
  | 'pants'
  | 'hat'
  | 'mask'
  | 'chest-protector'
  | 'shin-guards'
  | 'shoes'
  | 'ball-bag'
  | 'indicator'
  | 'brush'
  | 'other'

/** Display order and labels. Fixed, so a picker never reshuffles. */
export const GEAR_CATEGORIES: { id: GearCategory; label: string }[] = [
  { id: 'shirt', label: 'Shirt' },
  { id: 'jacket', label: 'Jacket' },
  { id: 'pants', label: 'Pants' },
  { id: 'hat', label: 'Hat' },
  { id: 'mask', label: 'Mask' },
  { id: 'chest-protector', label: 'Chest protector' },
  { id: 'shin-guards', label: 'Shin guards' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'ball-bag', label: 'Ball bag' },
  { id: 'indicator', label: 'Indicator' },
  { id: 'brush', label: 'Brush' },
  { id: 'other', label: 'Other' },
]

export function gearCategoryLabel(id: GearCategory): string {
  return GEAR_CATEGORIES.find((c) => c.id === id)?.label ?? id
}

/**
 * A kind of gear, not a piece of it: "a black V3 short-sleeve shirt from brand
 * X". Seeded rows and user-added rows share the shape; `origin` tells them apart
 * so the seed can be refreshed later without touching the user's own.
 *
 * No personal detail belongs here. A product is the unit that cross-user counts
 * group by, so it has to be something any user could have bought.
 */
export type GearProduct = {
  id: string
  category: GearCategory
  name: string
  brand?: string
  color?: string
  /**
   * Universal Product Code from the barcode: 12 digits (UPC-A), or 13 (EAN-13)
   * outside North America. The strongest match between two entries for the same
   * product, but often missing from user-typed data. Stored as digits only.
   */
  upc?: string
  /**
   * The manufacturer's own product number. Unique within a brand, not across
   * brands, so it only matches together with the brand. Named `sku` before;
   * `normalizeGearProduct` moves an old `sku` here.
   */
  brandProductId?: string
  /**
   * Retailer SKUs. A SKU is the retailer's number for the product, so it only
   * means something paired with the retailer that issued it.
   */
  vendorSkus?: VendorSku[]
  /** Where it was found, for one added from a shop listing. */
  url?: string
  origin: 'seed' | 'user'
}

export type VendorSku = { vendor: string; sku: string }

/**
 * One physical piece a user owns. Two identical shirts are two items, which is
 * what lets "Black V3 #1" be told from #2 and each carry its own lifespan.
 */
export type GearItem = {
  id: string
  productId: string
  /** The user's own name for it, e.g. "Black V3 #1". */
  label: string
  /** Purchase or acquisition date, ISO `YYYY-MM-DD`. */
  acquiredOn?: string
  /**
   * As printed on the piece: "L", "10.5", "7 3/8". Free text, because every
   * category sizes differently. On the item, not the product, since the same
   * shirt can be owned in two sizes.
   */
  size?: string
  /**
   * What this piece cost, in the settings currency. Per item for the same reason:
   * two of the same shirt can cost differently, bought on sale or second-hand.
   */
  pricePaid?: number
  /**
   * Set when the item leaves service. A retired item stays on the games that
   * used it; it only stops being offered for new ones.
   */
  retiredOn?: string
  notes?: string
}

/**
 * A named kit, e.g. "BB: Plate Gear". Items only, never products: a set is what
 * this user wears, and wearing needs a specific piece.
 */
export type GearSet = {
  id: string
  name: string
  itemIds: string[]
  /** Optional sport it is for, so a later picker can offer it first. */
  sportCode?: string
  notes?: string
}

/**
 * A starting catalog. Deliberately generic: no brand is claimed, so nothing here
 * is a guess about a real product line. It exists so a new user can build a set
 * before typing anything, and every user adds the branded products they own.
 */
export const SEED_GEAR_PRODUCTS: GearProduct[] = [
  { id: 'seed-shirt-black-ss', category: 'shirt', name: 'Short-sleeve shirt', color: 'Black', origin: 'seed' },
  { id: 'seed-shirt-black-ls', category: 'shirt', name: 'Long-sleeve shirt', color: 'Black', origin: 'seed' },
  { id: 'seed-shirt-blue-ss', category: 'shirt', name: 'Short-sleeve shirt', color: 'Powder blue', origin: 'seed' },
  { id: 'seed-shirt-navy-ss', category: 'shirt', name: 'Short-sleeve shirt', color: 'Navy', origin: 'seed' },
  { id: 'seed-shirt-red-ss', category: 'shirt', name: 'Short-sleeve shirt', color: 'Red', origin: 'seed' },
  { id: 'seed-jacket-black', category: 'jacket', name: 'Jacket', color: 'Black', origin: 'seed' },
  { id: 'seed-pants-plate', category: 'pants', name: 'Plate pants', color: 'Heather grey', origin: 'seed' },
  { id: 'seed-pants-base', category: 'pants', name: 'Base pants', color: 'Heather grey', origin: 'seed' },
  { id: 'seed-hat-plate', category: 'hat', name: 'Plate cap', color: 'Black', origin: 'seed' },
  { id: 'seed-hat-base', category: 'hat', name: 'Base cap', color: 'Black', origin: 'seed' },
  { id: 'seed-mask-traditional', category: 'mask', name: 'Traditional mask', origin: 'seed' },
  { id: 'seed-mask-hockey', category: 'mask', name: 'Hockey-style mask', origin: 'seed' },
  { id: 'seed-cp-hard', category: 'chest-protector', name: 'Hard-shell chest protector', origin: 'seed' },
  { id: 'seed-cp-soft', category: 'chest-protector', name: 'Soft chest protector', origin: 'seed' },
  { id: 'seed-shins', category: 'shin-guards', name: 'Shin guards', origin: 'seed' },
  { id: 'seed-shoes-plate', category: 'shoes', name: 'Plate shoes', color: 'Black', origin: 'seed' },
  { id: 'seed-shoes-base', category: 'shoes', name: 'Base shoes', color: 'Black', origin: 'seed' },
  { id: 'seed-ball-bag', category: 'ball-bag', name: 'Ball bag', color: 'Black', origin: 'seed' },
  { id: 'seed-indicator', category: 'indicator', name: 'Indicator', origin: 'seed' },
  { id: 'seed-brush', category: 'brush', name: 'Plate brush', origin: 'seed' },
]

/**
 * Reads a product in its current shape. A row saved before identifiers were split
 * carries `sku`, which held the manufacturer's number, so it becomes
 * `brandProductId`. Applied on every read and write, so rows already in the
 * browser and old backups both come forward without a migration step.
 */
export function normalizeGearProduct(p: GearProduct & { sku?: string }): GearProduct {
  const { sku, ...rest } = p
  const product: GearProduct = { ...rest }
  if (sku && !product.brandProductId) product.brandProductId = sku
  if (product.upc) {
    const digits = upcDigits(product.upc)
    if (digits) product.upc = digits
    else delete product.upc
  }
  if (product.vendorSkus) {
    const pairs = product.vendorSkus
      .map((v) => ({ vendor: v.vendor.trim(), sku: v.sku.trim() }))
      .filter((v) => v.vendor && v.sku)
    if (pairs.length) product.vendorSkus = pairs
    else delete product.vendorSkus
  }
  return product
}

/** Digits of a UPC, or undefined if it has none. Spaces and dashes are common when typed. */
export function upcDigits(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '')
  return digits || undefined
}

/**
 * Whether a UPC's last digit checks out: UPC-A (12 digits), EAN-13, or EAN-8. A
 * typo almost always breaks the check digit, so the form can say so, though a
 * value that fails is still kept: the user may be copying a label exactly.
 */
export function isValidUpc(raw: string): boolean {
  const d = upcDigits(raw)
  if (!d || ![8, 12, 13].includes(d.length)) return false
  const nums = [...d].map(Number)
  const check = nums.pop()!
  // Weights run 3,1,3,1… leftward from the digit before the check digit.
  const sum = nums.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

export type DuplicateMatch = {
  product: GearProduct
  /** What matched, in the order checked. */
  on: 'id' | 'upc' | 'brand-product-id' | 'vendor-sku'
}

const same = (a: string | undefined, b: string | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())

/**
 * The existing catalog entry this one duplicates, if any. Checked strongest
 * first: the app's own id, then UPC, then the brand's product number (with the
 * same brand), then a retailer and SKU pair. A candidate with none of these
 * cannot be told apart from another product by anything but its name, so it
 * matches nothing: two "Black short-sleeve shirt" rows may well be different.
 */
export function findDuplicateProduct(
  candidate: Partial<GearProduct>,
  products: GearProduct[],
): DuplicateMatch | undefined {
  const others = products.filter((p) => p !== candidate)
  if (candidate.id) {
    const byId = others.find((p) => p.id === candidate.id)
    if (byId) return { product: byId, on: 'id' }
  }
  const upc = candidate.upc ? upcDigits(candidate.upc) : undefined
  if (upc) {
    const byUpc = others.find((p) => p.upc && upcDigits(p.upc) === upc)
    if (byUpc) return { product: byUpc, on: 'upc' }
  }
  if (candidate.brandProductId) {
    const byBrandId = others.find(
      (p) => same(p.brand, candidate.brand) && same(p.brandProductId, candidate.brandProductId),
    )
    if (byBrandId) return { product: byBrandId, on: 'brand-product-id' }
  }
  for (const v of candidate.vendorSkus ?? []) {
    const byVendor = others.find((p) =>
      p.vendorSkus?.some((o) => same(o.vendor, v.vendor) && same(o.sku, v.sku)),
    )
    if (byVendor) return { product: byVendor, on: 'vendor-sku' }
  }
  return undefined
}

export const DUPLICATE_REASON: Record<DuplicateMatch['on'], string> = {
  id: 'the same catalog id',
  upc: 'the same UPC',
  'brand-product-id': 'the same brand and product number',
  'vendor-sku': 'the same retailer SKU',
}

/** A short, stable id for a user-created row. The prefix says which table. */
export function newGearId(prefix: 'gp' | 'gi' | 'gs'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/** "Brand · Name · Color", skipping what is unknown. */
export function describeProduct(p: GearProduct): string {
  return [p.brand, p.name, p.color].filter(Boolean).join(' · ')
}

/**
 * A typed price, as the new-item form needs it: blank is "not recorded"
 * (`undefined`), and anything that is not a non-negative amount is `null`, so the
 * form can refuse it rather than save a typo. `$12.50` and `12.5` both read.
 */
export function parsePricePaid(text: string): number | undefined | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function isRetired(item: GearItem): boolean {
  return Boolean(item.retiredOn)
}

/**
 * The next free "#n" label for another piece of the same product, so a second
 * black shirt defaults to "… #2" rather than a duplicate name.
 */
export function nextItemLabel(product: GearProduct, items: GearItem[]): string {
  const base = [product.color, product.name].filter(Boolean).join(' ')
  const taken = new Set(items.filter((i) => i.productId === product.id).map((i) => i.label))
  let n = 1
  while (taken.has(`${base} #${n}`)) n++
  return `${base} #${n}`
}
