/**
 * Palette. Values validated with `scripts/validate_palette.js` against both
 * surfaces before being recorded here — do not change a hex without re-running:
 *
 *   node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#4a3aa7,#e87ba4" --mode light
 *   node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#9085e9,#d55181" --mode dark
 *
 * Results on the adjacent pairlist (bars, stacks, lines): PASS in both modes,
 * worst adjacent CVD ΔE 9.2 light / 9.4 dark.
 *
 * Under `--pairs all` (scatter, bubble, small multiples) four slots FAIL in dark
 * mode — violet vs blue is ΔE 1.9 protan, 9.8 normal-vision. So all-pairs forms
 * cap at ALL_PAIRS_SLOT_CAP = 3 and fold the rest into "Other", verified:
 *
 *   node scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark --pairs all
 *   → ALL CHECKS PASS (worst pair CVD ΔE 9.4, normal-vision 20.9)
 */

import { sportRank } from '../../model/reference'

export { UNSPECIFIED_SPORT } from '../../model/reference'

/**
 * Categorical slots, in fixed order. Never cycled, never generated.
 *
 * Five rather than four: the four sports take slots 1-4, and slot 5 (magenta) is
 * held for the "Unspecified" bucket, so a game with no sport code never borrows
 * kickball's hue. Validated as a set of five in both modes:
 *
 *   node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#4a3aa7,#e87ba4" --mode light
 *   node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#9085e9,#d55181" --mode dark
 *   → ALL CHECKS PASS (worst adjacent CVD ΔE 9.2 light / 9.4 dark)
 */
export const CATEGORICAL_SLOTS = 5

/**
 * The number of slots that validate under `--pairs all`. Scatter, bubble and
 * small-multiple forms must not exceed this.
 */
export const ALL_PAIRS_SLOT_CAP = 3

/** CSS custom properties, so light/dark swap in one place. */
export const seriesVar = (slot: number): string => `var(--series-${((slot - 1) % CATEGORICAL_SLOTS) + 1})`

/**
 * Slots below 3:1 on the light surface: aqua at 2.74:1 and magenta at 2.62:1. The
 * relief rule applies: any chart using them must ship a legend naming the series
 * and a table view carrying the values. `ChartFrame` provides both, which is why
 * every chart form is built on it rather than on Recharts directly.
 */
export const RELIEF_REQUIRED_SLOTS = [3, 5]

export const needsRelief = (slot: number): boolean => RELIEF_REQUIRED_SLOTS.includes(slot)

/**
 * Sport code -> categorical slot, assigned in a fixed order so a sport keeps its
 * color when a filter removes another sport. Color follows the entity, never its
 * rank.
 */
/**
 * Sport code -> slot, taken straight from the model's `SPORT_ORDER` so grouping
 * and colour can never disagree. Each of the four sports holds a fixed slot, and
 * anything unrecognized — including the unspecified bucket — takes slot 5.
 *
 * Kickball and "no sport code" previously both landed on slot 4 and rendered
 * identically in a split chart; slot 5 exists to prevent that collision.
 */
export function sportSlot(code: string | undefined): number {
  return Math.min(sportRank(code), CATEGORICAL_SLOTS)
}

export function sportColor(code: string | undefined): string {
  return seriesVar(sportSlot(code))
}

/**
 * Stable slot for any entity key, assigned by first appearance in a sorted list
 * rather than by rank, so filtering does not repaint the survivors.
 */
export function makeSlotAssigner(keys: string[]): (key: string) => number {
  const order = new Map([...keys].sort().map((k, i) => [k, (i % CATEGORICAL_SLOTS) + 1]))
  return (key) => order.get(key) ?? CATEGORICAL_SLOTS
}

/** Sequential blue steps, light -> dark. For magnitude only. */
export const SEQUENTIAL_STEPS = [
  'var(--seq-100)',
  'var(--seq-250)',
  'var(--seq-400)',
  'var(--seq-450)',
  'var(--seq-550)',
  'var(--seq-700)',
] as const

/**
 * Sequential bin for a continuous value. The lightest step means "near zero"
 * and is allowed to recede toward the surface, which is only correct for
 * genuinely continuous magnitude — not for nominal categories.
 */
export function sequentialStep(value: number, max: number): string {
  if (max <= 0) return SEQUENTIAL_STEPS[0]
  const idx = Math.min(
    SEQUENTIAL_STEPS.length - 1,
    Math.floor((value / max) * SEQUENTIAL_STEPS.length),
  )
  return SEQUENTIAL_STEPS[idx]!
}

/** Diverging: two hues that read as opposite, with a neutral gray midpoint. */
export const DIVERGING = {
  negative: 'var(--div-neg)',
  midpoint: 'var(--div-mid)',
  positive: 'var(--div-pos)',
} as const

/**
 * Status tokens. Reserved for data-quality state, never reused as a series
 * color, and always shipped with an icon and a label — hue never carries the
 * meaning alone.
 */
export const STATUS = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  serious: 'var(--status-serious)',
  critical: 'var(--status-critical)',
} as const

export const STATUS_ICON = {
  good: '✓',
  warning: '!',
  serious: '▲',
  critical: '✕',
} as const

export type StatusRole = keyof typeof STATUS

/** Flag severity -> status token. */
export function severityStatus(severity: 'info' | 'warning' | 'serious'): StatusRole {
  return severity === 'info' ? 'good' : severity === 'warning' ? 'warning' : 'serious'
}

// --- Mark specs, fixed across every chart. ---
export const MARK = {
  /** Bars cap at 24px; the band's leftover is air. */
  maxBarSize: 24,
  /** 4px rounded data-end, square at the baseline. */
  barRadiusHorizontal: [0, 4, 4, 0] as [number, number, number, number],
  barRadiusVertical: [4, 4, 0, 0] as [number, number, number, number],
  lineWidth: 2,
  /** >= 8px diameter, so r >= 4. */
  dotRadius: 4,
  activeDotRadius: 5,
  /** 2px gap in the surface color separates touching marks. */
  surfaceGap: 2,
  areaOpacity: 0.1,
} as const
