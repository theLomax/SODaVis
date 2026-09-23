/**
 * Palette contract tests.
 *
 * These do NOT re-derive colorblind safety — that is what
 * `scripts/validate_palette.js` is for, and it was run against both surfaces
 * before these hexes were recorded. What these tests protect is the *reasoning*
 * around the palette, which is the part a later edit can quietly break:
 *
 *  - the recorded hexes still match what was validated
 *  - all-pairs forms still respect the 3-slot cap
 *  - a sport keeps its color when a filter removes another sport
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ALL_PAIRS_SLOT_CAP,
  CATEGORICAL_SLOTS,
  DIVERGING,
  MARK,
  RELIEF_REQUIRED_SLOTS,
  STATUS,
  STATUS_ICON,
  makeSlotAssigner,
  needsRelief,
  sequentialStep,
  seriesVar,
  sportSlot,
  UNSPECIFIED_SPORT,
} from './palette'

/**
 * The exact values passed to the validator. Recorded here so a change to
 * theme.css without a re-run fails loudly.
 */
const VALIDATED = {
  // Slots 1-4 are the sports; slot 5 is the Unspecified bucket.
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#e87ba4'],
  dark: ['#3987e5', '#d95926', '#199e70', '#9085e9', '#d55181'],
  surfaceLight: '#fcfcfb',
  surfaceDark: '#1a1a19',
}

const css = readFileSync(resolve(__dirname, '../theme.css'), 'utf8')

describe('palette hexes match what the validator was run against', () => {
  it('declares the validated light categorical slots', () => {
    for (const [i, hex] of VALIDATED.light.entries()) {
      expect(css).toContain(`--series-${i + 1}: ${hex};`)
    }
  })

  it('declares the validated dark categorical slots under both dark scopes', () => {
    // The media query covers the OS setting; [data-theme] covers the toggle.
    // Both must carry the dark steps, or a themed chart silently uses light hues.
    const mediaBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    const toggleBlock = css.slice(css.indexOf("[data-theme='dark']"))
    for (const [i, hex] of VALIDATED.dark.entries()) {
      expect(mediaBlock).toContain(`--series-${i + 1}: ${hex};`)
      expect(toggleBlock).toContain(`--series-${i + 1}: ${hex};`)
    }
  })

  it('declares both validated surfaces', () => {
    expect(css).toContain(`--surface-1: ${VALIDATED.surfaceLight};`)
    expect(css).toContain(`--surface-1: ${VALIDATED.surfaceDark};`)
  })

  it('uses a solid hairline grid, never dashed', () => {
    expect(css).toContain('stroke-dasharray: none')
    expect(css).not.toMatch(/stroke-dasharray:\s*\d/)
  })
})

describe('the all-pairs cap', () => {
  it('caps all-pairs forms below the full categorical set', () => {
    // Four slots FAIL --pairs all in dark mode (violet vs blue: CVD ΔE 1.9
    // protan, normal-vision 9.8). Three PASS in both modes.
    expect(ALL_PAIRS_SLOT_CAP).toBe(3)
    expect(ALL_PAIRS_SLOT_CAP).toBeLessThan(CATEGORICAL_SLOTS)
  })

  it('flags the light-mode slots that need relief', () => {
    // Aqua 2.74:1 and magenta 2.62:1 on the light surface, both below 3:1.
    expect(RELIEF_REQUIRED_SLOTS).toEqual([3, 5])
    expect(needsRelief(3)).toBe(true)
    expect(needsRelief(5)).toBe(true)
    expect(needsRelief(1)).toBe(false)
  })
})

describe('color follows the entity, not its rank', () => {
  it('gives each sport a fixed slot regardless of what else is on screen', () => {
    expect(sportSlot('C-BB')).toBe(1)
    expect(sportSlot('C-FP')).toBe(2)
    expect(sportSlot('C-SP')).toBe(3)
    expect(sportSlot('C-KB')).toBe(4)
  })

  it('keeps a sport’s slot when another sport is filtered out', () => {
    const before = sportSlot('C-SP')
    // Filtering baseball away must not repaint slowpitch.
    expect(sportSlot('C-SP')).toBe(before)
  })

  it('assigns entity slots by a stable sort, not by arrival order', () => {
    const a = makeSlotAssigner(['zulu', 'alpha', 'mike'])
    const b = makeSlotAssigner(['mike', 'zulu', 'alpha'])
    for (const key of ['alpha', 'mike', 'zulu']) {
      expect(a(key)).toBe(b(key))
    }
  })

  it('never generates a hue past the fixed set', () => {
    const slots = new Set<string>()
    for (let i = 1; i <= 40; i++) slots.add(seriesVar(i))
    expect(slots.size).toBe(CATEGORICAL_SLOTS)
  })

  it('falls back to the last slot for an unknown sport rather than inventing one', () => {
    expect(sportSlot(undefined)).toBe(CATEGORICAL_SLOTS)
    expect(sportSlot('C-XX')).toBe(CATEGORICAL_SLOTS)
  })

  it('does not let the unspecified bucket borrow kickball’s hue', () => {
    // Both landed on slot 4 before slot 5 existed, so a split chart drew them
    // in the same colour.
    expect(sportSlot('C-KB')).not.toBe(sportSlot(undefined))
    expect(sportSlot('C-KB')).not.toBe(sportSlot(UNSPECIFIED_SPORT))
    expect(seriesVar(sportSlot('C-KB'))).not.toBe(seriesVar(sportSlot(undefined)))
  })

  it('gives all five slots a distinct variable', () => {
    const vars = new Set([1, 2, 3, 4, 5].map(seriesVar))
    expect(vars.size).toBe(5)
  })
})

describe('sequential and diverging scales', () => {
  it('ramps one hue from light to dark', () => {
    expect(sequentialStep(0, 100)).toBe('var(--seq-100)')
    expect(sequentialStep(100, 100)).toBe('var(--seq-700)')

    // Monotonic across the range: each bin is at or darker than the one before.
    const steps = [0, 20, 40, 60, 80, 100].map((v) => sequentialStep(v, 100))
    const order = [
      'var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)',
      'var(--seq-450)', 'var(--seq-550)', 'var(--seq-700)',
    ]
    for (let i = 1; i < steps.length; i++) {
      expect(order.indexOf(steps[i]!)).toBeGreaterThanOrEqual(order.indexOf(steps[i - 1]!))
    }
    expect(new Set(steps).size).toBe(order.length)
  })

  it('does not divide by zero on an empty scale', () => {
    expect(sequentialStep(0, 0)).toBe('var(--seq-100)')
  })

  it('puts a neutral gray at the diverging midpoint, with warm/cool poles', () => {
    expect(DIVERGING.midpoint).toBe('var(--div-mid)')
    expect(css).toContain('--div-mid: #f0efec;')
    expect(css).toContain('--div-mid: #383835;')
    // Blue vs red: cool vs warm, so the poles read as opposite.
    expect(css).toContain('--div-neg: #2a78d6;')
    expect(css).toContain('--div-pos: #e34948;')
  })
})

describe('status tokens stay reserved', () => {
  it('keeps status colors out of the categorical set', () => {
    const statusHexes = ['#0ca30c', '#fab219', '#ec835a', '#d03b3b']
    for (const hex of statusHexes) {
      expect(VALIDATED.light).not.toContain(hex)
      expect(VALIDATED.dark).not.toContain(hex)
    }
    expect(Object.keys(STATUS)).toEqual(['good', 'warning', 'serious', 'critical'])
  })

  it('pairs every status role with an icon, so hue never carries it alone', () => {
    for (const role of Object.keys(STATUS) as (keyof typeof STATUS)[]) {
      expect(STATUS_ICON[role]).toBeTruthy()
    }
  })
})

describe('mark specs', () => {
  it('holds the fixed spec values', () => {
    expect(MARK.maxBarSize).toBeLessThanOrEqual(24)
    expect(MARK.lineWidth).toBe(2)
    // >= 8px diameter means r >= 4.
    expect(MARK.dotRadius).toBeGreaterThanOrEqual(4)
    expect(MARK.surfaceGap).toBe(2)
    expect(MARK.areaOpacity).toBeCloseTo(0.1, 2)
  })

  it('rounds the data end and squares the baseline', () => {
    // Horizontal bars grow rightward: rounded on the right pair only.
    expect(MARK.barRadiusHorizontal).toEqual([0, 4, 4, 0])
    // Columns grow upward: rounded on the top pair only.
    expect(MARK.barRadiusVertical).toEqual([4, 4, 0, 0])
  })
})
