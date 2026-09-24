/**
 * The flag registry is the copy behind every Review chip and dialog. These tests
 * guard the part that rots quietly: a flag code added to the model, or raised in
 * the derive layer, that nobody wrote an explanation for.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { FLAG_INFO, flagGroupTitle, flagInfo, flagMarker, flagTitle } from './flags'
import type { DataQualityFlagCode } from '../model/game'

/**
 * Codes as declared on the model's own union. Read from source rather than
 * imported, because the type is erased at runtime — this is what lets the test
 * notice a code the registry has never heard of.
 */
function declaredCodes(): string[] {
  const src = readFileSync(resolve(__dirname, '../model/game.ts'), 'utf8')
  // `\r?` because a Windows checkout with autocrlf gives the file CRLF endings.
  const block = /export type DataQualityFlagCode =([\s\S]*?)\r?\n\r?\nexport type DataQualityFlag/.exec(src)
  expect(block, 'DataQualityFlagCode union not found in model/game.ts').toBeTruthy()
  return [...block![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!)
}

describe('flag registry covers the model', () => {
  const codes = declaredCodes()

  it('finds the codes declared on the model', () => {
    expect(codes.length).toBeGreaterThan(10)
    expect(codes).toContain('multi-trip-day')
    expect(codes).toContain('missing-duration')
  })

  it('has an entry for every declared code', () => {
    const missing = codes.filter((c) => !(c in FLAG_INFO))
    expect(missing, 'every flag code needs copy in ui/flags.ts').toEqual([])
  })

  it('has no entry for a code the model no longer declares', () => {
    const stale = Object.keys(FLAG_INFO).filter((c) => !codes.includes(c))
    expect(stale, 'remove copy for codes that no longer exist').toEqual([])
  })

  it('gives every entry a title, a plural heading and an explanation', () => {
    for (const [code, info] of Object.entries(FLAG_INFO)) {
      expect(info.title, `${code}.title`).toBeTruthy()
      expect(info.groupTitle, `${code}.groupTitle`).toBeTruthy()
      expect(info.what, `${code}.what`).toBeTruthy()
      // A dialog with no consequence and no remedy tells the reader nothing.
      expect(info.why || info.fix, `${code} needs a why or a fix`).toBeTruthy()
    }
  })

  it('names a location for every flag whose fix is somewhere specific', () => {
    // These are fixed by editing data, so the dialog must say where.
    const needLocation: DataQualityFlagCode[] = [
      'unmatched-venue',
      'missing-duration',
      'multi-trip-day',
      'missing-mileage',
      'self-not-found',
    ]
    for (const code of needLocation) {
      expect(FLAG_INFO[code].fixTarget, `${code} should say where to fix it`).toBeTruthy()
    }
  })

  it('gives every fix target a reachable view and the on-screen wording', () => {
    // A target the store cannot navigate to, or one with no label, would render
    // as a dead button — worse than the plain text it replaced.
    const views = ['reference', 'trips', 'quality', 'import']
    for (const [code, info] of Object.entries(FLAG_INFO)) {
      if (!info.fixTarget) continue
      expect(views, `${code}.fixTarget.view`).toContain(info.fixTarget.view)
      expect(info.fixTarget.label, `${code}.fixTarget.label`).toBeTruthy()
      // The label is a path a reader can follow, not a bare view name.
      expect(info.fixTarget.label, `${code}.fixTarget.label`).toMatch(/→/)
    }
  })

  it('sends a Reference target to the tab that holds the field', () => {
    expect(FLAG_INFO['missing-duration'].fixTarget).toEqual({
      view: 'reference',
      tab: 'durations',
      label: 'Reference data → Game durations',
    })
    // Mileage and drive time are both the park's own figures, one tab.
    for (const code of ['missing-mileage', 'missing-drive-time'] as const) {
      expect(FLAG_INFO[code].fixTarget).toEqual({
        view: 'reference',
        tab: 'parks',
        label: 'Reference data → Parks & mileage',
      })
    }
  })

  it('writes titles as prose, not as the machine code', () => {
    for (const [code, info] of Object.entries(FLAG_INFO)) {
      // Hyphens are fine in prose ('Multi-park day'); reusing the kebab-case
      // code verbatim is not.
      expect(info.title, code).not.toBe(code)
      expect(info.groupTitle, code).not.toBe(code)
      expect(info.title, code).toMatch(/\s/)
      expect(info.title[0], code).toBe(info.title[0]!.toUpperCase())
    }
  })
})

describe('formatting helpers', () => {
  it('reads a title for a known code', () => {
    expect(flagTitle('multi-trip-day')).toBe('Multi-park day')
  })

  it('counts occurrences in a group heading', () => {
    expect(flagGroupTitle('missing-duration', 91)).toBe('Missing game durations (91)')
  })

  it('degrades to the raw code rather than throwing on an unknown one', () => {
    const info = flagInfo('not-a-real-code' as DataQualityFlagCode)
    expect(info.title).toBe('not-a-real-code')
    expect(info.what).toBeTruthy()
  })
})


describe('severity markers', () => {
  it('uses the reserved status tokens for warning and serious', () => {
    expect(flagMarker('warning').color).toBe('var(--status-warning)')
    expect(flagMarker('serious').color).toBe('var(--status-serious)')
  })

  it('never marks an informational flag with a success checkmark', () => {
    // A green tick beside a note reads as "this passed", which is the opposite
    // of what an info flag says.
    const info = flagMarker('info')
    expect(info.color).toBe('var(--text-muted)')
    expect(info.icon).not.toBe('\u2713')
    expect(info.color).not.toBe('var(--status-good)')
  })

  it('always pairs a color with an icon, so hue never stands alone', () => {
    for (const severity of ['info', 'warning', 'serious'] as const) {
      const marker = flagMarker(severity)
      expect(marker.icon, severity).toBeTruthy()
      expect(marker.color, severity).toBeTruthy()
    }
  })
})
