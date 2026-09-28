import { describe, expect, it } from 'vitest'
import {
  GEAR_CATEGORIES,
  SEED_GEAR_PRODUCTS,
  describeProduct,
  nextItemLabel,
  parsePricePaid,
  type GearProduct,
} from './gear'

const shirt: GearProduct = { id: 'p', category: 'shirt', name: 'V3 shirt', color: 'Black', origin: 'user' }

describe('gear helpers', () => {
  it('numbers a second copy of a product rather than repeating its name', () => {
    expect(nextItemLabel(shirt, [])).toBe('Black V3 shirt #1')
    const taken = [{ id: 'a', productId: 'p', label: 'Black V3 shirt #1' }]
    expect(nextItemLabel(shirt, taken)).toBe('Black V3 shirt #2')
  })

  it('describes a product from whatever is known', () => {
    expect(describeProduct({ ...shirt, brand: 'Example Co' })).toBe('Example Co · V3 shirt · Black')
    expect(describeProduct({ id: 'x', category: 'mask', name: 'Mask', origin: 'user' })).toBe('Mask')
  })

  it('reads a typed price, blank as not recorded and a typo as refused', () => {
    expect(parsePricePaid('')).toBeUndefined()
    expect(parsePricePaid('  ')).toBeUndefined()
    expect(parsePricePaid('12.5')).toBe(12.5)
    expect(parsePricePaid('$1,249.999')).toBe(1250)
    expect(parsePricePaid('0')).toBe(0)
    expect(parsePricePaid('-5')).toBeNull()
    expect(parsePricePaid('twelve')).toBeNull()
  })

  it('seeds only known categories, with unique ids and no brand claims', () => {
    const categories = new Set(GEAR_CATEGORIES.map((c) => c.id))
    expect(SEED_GEAR_PRODUCTS.every((p) => categories.has(p.category))).toBe(true)
    expect(new Set(SEED_GEAR_PRODUCTS.map((p) => p.id)).size).toBe(SEED_GEAR_PRODUCTS.length)
    expect(SEED_GEAR_PRODUCTS.some((p) => p.brand)).toBe(false)
  })
})
