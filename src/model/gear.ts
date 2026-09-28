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
  /** Manufacturer SKU or product number, where known. */
  sku?: string
  /** Where it was found, for one added from a shop listing. */
  url?: string
  origin: 'seed' | 'user'
}

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

/** A short, stable id for a user-created row. The prefix says which table. */
export function newGearId(prefix: 'gp' | 'gi' | 'gs'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/** "Brand · Name · Colour", skipping what is unknown. */
export function describeProduct(p: GearProduct): string {
  return [p.brand, p.name, p.color].filter(Boolean).join(' · ')
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
