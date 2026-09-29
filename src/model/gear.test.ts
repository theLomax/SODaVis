import { describe, expect, it } from 'vitest'
import {
  GEAR_CATEGORIES,
  SEED_GEAR_PRODUCTS,
  describeProduct,
  findDuplicateProduct,
  isValidUpc,
  nextItemLabel,
  normalizeGearProduct,
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

  it('checks a UPC by its last digit, for UPC-A, EAN-13 and EAN-8', () => {
    expect(isValidUpc('036000291452')).toBe(true)
    expect(isValidUpc('0 36000 29145 2')).toBe(true)
    expect(isValidUpc('036000291453')).toBe(false)
    expect(isValidUpc('4006381333931')).toBe(true)
    expect(isValidUpc('96385074')).toBe(true)
    expect(isValidUpc('12345')).toBe(false)
    expect(isValidUpc('')).toBe(false)
  })

  it('moves an old sku to brandProductId, without overwriting a newer one', () => {
    const legacy = { ...shirt, sku: 'OLD' }
    expect(normalizeGearProduct(legacy)).toMatchObject({ brandProductId: 'OLD' })
    expect(normalizeGearProduct(legacy)).not.toHaveProperty('sku')
    expect(normalizeGearProduct({ ...legacy, brandProductId: 'NEW' }).brandProductId).toBe('NEW')
  })

  it('seeds only known categories, with unique ids and no brand claims', () => {
    const categories = new Set(GEAR_CATEGORIES.map((c) => c.id))
    expect(SEED_GEAR_PRODUCTS.every((p) => categories.has(p.category))).toBe(true)
    expect(new Set(SEED_GEAR_PRODUCTS.map((p) => p.id)).size).toBe(SEED_GEAR_PRODUCTS.length)
    expect(SEED_GEAR_PRODUCTS.some((p) => p.brand)).toBe(false)
  })
})

describe('finding a duplicate product', () => {
  const catalog: GearProduct[] = [
    { ...shirt, id: 'a', brand: 'Example Co', upc: '036000291452', brandProductId: 'V3-BLK' },
    { ...shirt, id: 'b', brand: 'Other Co', brandProductId: 'V3-BLK', vendorSkus: [{ vendor: 'Ump Shop', sku: '998' }] },
  ]

  it('matches in order: id, then UPC, then brand product number, then retailer SKU', () => {
    expect(findDuplicateProduct({ id: 'b', upc: '036000291452' }, catalog)).toMatchObject({ on: 'id', product: { id: 'b' } })
    expect(findDuplicateProduct({ upc: '0-36000-29145-2', brand: 'Other Co', brandProductId: 'V3-BLK' }, catalog)).toMatchObject({
      on: 'upc',
      product: { id: 'a' },
    })
    expect(findDuplicateProduct({ brand: 'other co', brandProductId: 'v3-blk' }, catalog)).toMatchObject({
      on: 'brand-product-id',
      product: { id: 'b' },
    })
    expect(findDuplicateProduct({ vendorSkus: [{ vendor: 'UMP SHOP', sku: '998' }] }, catalog)).toMatchObject({
      on: 'vendor-sku',
      product: { id: 'b' },
    })
  })

  it('needs the same brand for a product number, and the same retailer for a SKU', () => {
    expect(findDuplicateProduct({ brand: 'Third Co', brandProductId: 'V3-BLK' }, catalog)).toBeUndefined()
    expect(findDuplicateProduct({ vendorSkus: [{ vendor: 'Other Shop', sku: '998' }] }, catalog)).toBeUndefined()
  })

  it('never matches on a name alone', () => {
    expect(findDuplicateProduct({ name: shirt.name, color: shirt.color }, catalog)).toBeUndefined()
  })
})
