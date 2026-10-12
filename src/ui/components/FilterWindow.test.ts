import { describe, expect, it } from 'vitest'
import { NO_SELECTION, matchesSelection, selectionSize } from './FilterWindow'

const park = { city: ['Springfield'], sport: ['C-BB', 'C-FP'], league: [] as string[] }
const valuesOf = (id: string) => park[id as keyof typeof park] ?? []

describe('matchesSelection', () => {
  it('passes everything when nothing is picked', () => {
    expect(matchesSelection(NO_SELECTION, valuesOf)).toBe(true)
    expect(matchesSelection({ city: [] }, valuesOf)).toBe(true)
  })

  it('treats picks within a category as alternatives', () => {
    expect(matchesSelection({ city: ['Shelbyville', 'Springfield'] }, valuesOf)).toBe(true)
    expect(matchesSelection({ city: ['Shelbyville'] }, valuesOf)).toBe(false)
  })

  it('requires every category with picks to hold', () => {
    expect(matchesSelection({ city: ['Springfield'], sport: ['C-FP'] }, valuesOf)).toBe(true)
    expect(matchesSelection({ city: ['Springfield'], sport: ['C-KB'] }, valuesOf)).toBe(false)
  })

  it('fails an item with no value in a picked category', () => {
    expect(matchesSelection({ league: ['Riverbend Rec'] }, valuesOf)).toBe(false)
  })
})

describe('selectionSize', () => {
  it('counts picks across categories', () => {
    expect(selectionSize(NO_SELECTION)).toBe(0)
    expect(selectionSize({ city: ['a', 'b'], sport: ['c'] })).toBe(3)
  })
})
