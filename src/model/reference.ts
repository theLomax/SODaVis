/**
 * Layer 2 — Reference data. User-owned, editable, and never written by import.
 *
 * This is the owner's own knowledge: how far a park is, how long a 12U game runs,
 * how much gear a plate assignment costs him in prep time.
 */

export type Park = {
  id: string
  name: string
  city?: string
  /** Exact venue strings from a source file that mean this park. */
  aliases: string[]
  /**
   * Glob patterns matching venue strings at this park, so a field number
   * that has never been seen before still resolves. '*' matches any run.
   */
  venuePatterns: string[]
  oneWayMiles?: number
  /**
   * One-way drive in free-flowing traffic. The return leg of a weekday evening
   * trip uses this, since those games let out after the rush window closes.
   */
  oneWayDriveMinutes?: number
  /**
   * One-way drive arriving in weekday rush hour, when it is materially worse. A
   * 6pm game is a rush-hour drive out and a clear one home, so doubling the ideal
   * figure understates the day. Leave unset where the park is unaffected — the
   * ideal figure is then used both ways.
   */
  oneWayDriveMinutesRush?: number
  /** Round-trip toll estimate, in currency units. */
  tollEstimate?: number
  notes?: string
}

export type DurationOrigin = 'extracted' | 'manual'

export type AgeGroupDuration = {
  /** The raw age-group string, used verbatim as the key. */
  key: string
  durationMinutes: number
  origin: DurationOrigin
}

/**
 * The position worked. Nothing more: what was *worn* is a `GearModifier`, because
 * the two do not track each other. A base umpire wears plate gear in some
 * two-umpire baseball, and none at all in kickball, slowpitch, coach pitch or a
 * solo game — so a single ladder from "most gear" to "least" cannot describe both.
 *
 * `undefined` is the honest default: the export does not say which position was
 * worked, and the app does not guess.
 */
export type GearLevelId = 'plate' | 'base'

export type GearLevel = {
  id: GearLevelId
  label: string
  /**
   * Added to the sport's base prep time for the position itself, independent of
   * gear. Usually 0 — the cost is in what you put on, which the modifiers carry.
   */
  prepDeltaMinutes: number
}

/**
 * Display order. Dexie returns rows in primary-key order, which for these ids is
 * alphabetical and would put "Bases" first, so the intended order is stated here
 * rather than inferred from storage.
 */
export const GEAR_LEVEL_ORDER: GearLevelId[] = ['plate', 'base']

export function sortGearLevels(levels: GearLevel[]): GearLevel[] {
  return [...levels].sort(
    (a, b) => GEAR_LEVEL_ORDER.indexOf(a.id) - GEAR_LEVEL_ORDER.indexOf(b.id),
  )
}

/**
 * Conditions layered on top of the role, each independent of it and of each
 * other. A cold-weather plate game is both `plate` and `cold`; a scrimmage
 * worked in shorts is `base` and `casual`.
 *
 * `shield` is the exception that only applies to the plate: a shield protector
 * instead of chest-worn pads. It is listed here rather than as a fourth role
 * because it modifies how the plate was worked, not whether it was.
 */
export type GearModifierId = 'full-gear' | 'shield' | 'casual' | 'cold' | 'rain'

export type GearModifier = {
  id: GearModifierId
  label: string
  /** Added to the trip's prep time when set. May be negative. */
  prepDeltaMinutes: number
  /** True when this only makes sense on a plate assignment. */
  plateOnly?: boolean
  hint: string
}

/** Display order, for the same reason as `GEAR_LEVEL_ORDER`. */
export const GEAR_MODIFIER_ORDER: GearModifierId[] = [
  'full-gear',
  'shield',
  'casual',
  'cold',
  'rain',
]

export function sortGearModifiers(mods: GearModifier[]): GearModifier[] {
  return [...mods].sort(
    (a, b) => GEAR_MODIFIER_ORDER.indexOf(a.id) - GEAR_MODIFIER_ORDER.indexOf(b.id),
  )
}

export type SportProfile = {
  /** Raw source code, e.g. 'C-BB'. */
  code: string
  label: string
  prepMinutes: number
  wrapMinutes: number
  /** The position usually worked in this sport, if any. */
  defaultGearLevel?: GearLevelId
}

/**
 * Self-identification. Names carry a rotating season suffix
 * ('Rivera (F25), Sam' → 'Rivera (S26), Sam'), so matching is by pattern.
 */
export type Identity = {
  id: 'self'
  /** Regex sources, matched case-insensitively against the official string. */
  patterns: string[]
  displayName: string
}

export type TimeModelId = 'game' | 'game-drive' | 'committed'

/**
 * When a drive is treated as rush hour.
 *
 * Applies to both legs, each judged on its own clock: the outbound leg by the
 * first pitch, the return by when you actually leave the field. A weekday evening
 * return is usually clear, but weekend afternoon games do let out into traffic, so
 * neither leg can be assumed either way.
 */
export type RushHourWindow = {
  /** Minutes past midnight, inclusive. */
  startMinutes: number
  /** Minutes past midnight, exclusive. */
  endMinutes: number
  /** Days the window applies to. 0 = Monday … 6 = Sunday. */
  weekdays: number[]
}

export type Settings = {
  id: 'settings'
  homeOriginLabel: string
  /** Fallback speed for estimating drive time from miles. */
  fallbackMph: number
  /** IRS standard mileage rate per calendar year, in currency units per mile. */
  irsMileageRateByYear: Record<string, number>
  currency: string
  preferredTimeModel: TimeModelId
  /** Minimum minutes on site before first pitch, enforced by the time model. */
  arrivalFloorMinutes: number
  /**
   * When to use a park's rush-hour figure for the outbound leg. The return leg
   * never uses it.
   */
  rushHour: RushHourWindow
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/**
 * The position alone costs no extra prep: walking to the plate takes as long as
 * walking to first. What costs time is the gear, so both deltas are 0 and
 * `full-gear` carries the figure.
 */
export const GEAR_LEVELS: GearLevel[] = [
  { id: 'plate', label: 'Plate', prepDeltaMinutes: 0 },
  { id: 'base', label: 'Bases', prepDeltaMinutes: 0 },
]

/**
 * What was worn, independent of the position and of each other, and cumulative.
 *
 * `full-gear` defaults on at the plate and off at the bases — the usual case for
 * baseball and fastpitch — but it is only a default. A base umpire in two-umpire
 * baseball may well be in full gear, and a plate umpire in kickball or slowpitch
 * may not be, so either can be set against either position.
 */
export const GEAR_MODIFIERS: GearModifier[] = [
  {
    id: 'full-gear',
    label: 'Full gear',
    prepDeltaMinutes: 10,
    hint: 'Mask, chest and shin protection. Assumed at the plate, and available at the bases — some two-umpire games put the base umpire in gear too.',
  },
  {
    id: 'shield',
    label: 'Shield',
    prepDeltaMinutes: -5,
    plateOnly: true,
    hint: 'A shield protector instead of chest-worn pads. Plate only.',
  },
  {
    id: 'casual',
    label: 'Dressed down',
    prepDeltaMinutes: -5,
    hint: 'Shorts and a dri-fit shirt, as for kickball or slowpitch. Scrimmages and special games.',
  },
  {
    id: 'cold',
    label: 'Cold weather',
    prepDeltaMinutes: 5,
    hint: 'Extra layers for a cold-weather game.',
  },
  { id: 'rain', label: 'Rain gear', prepDeltaMinutes: 5, hint: 'Wet-weather protection.' },
]

/**
 * Seeded from the four sport codes observed in the sample export.
 *
 * No sport seeds a default position. In a two-umpire game you are plate or bases
 * roughly half the time each, and the export does not record which — so a default
 * would be a guess about a specific game, and that guess would flow through
 * `full-gear` into prep minutes. `defaultGearLevel` stays available for a sport
 * where one position genuinely is the norm, but nothing claims that by default.
 */
export const SEED_SPORT_PROFILES: SportProfile[] = [
  { code: 'C-BB', label: 'Baseball', prepMinutes: 25, wrapMinutes: 10 },
  { code: 'C-FP', label: 'Fastpitch Softball', prepMinutes: 25, wrapMinutes: 10 },
  { code: 'C-SP', label: 'Slowpitch Softball', prepMinutes: 15, wrapMinutes: 5 },
  // No default position: kickball and slowpitch do not imply one, and the base
  // umpire wears no plate gear in either.
  { code: 'C-KB', label: 'Kickball', prepMinutes: 15, wrapMinutes: 5 },
]

/**
 * The canonical order sports are presented in — the basis for both grouping in the
 * derive layer and colour assignment in the UI. Fixed, so a sport keeps its place
 * (and therefore its hue) regardless of what else is on screen.
 */
export const SPORT_ORDER = ['C-BB', 'C-FP', 'C-SP', 'C-KB'] as const

/**
 * A rare call worth tagging on a game — Infield Fly, Fourth Out, and the rest.
 * User-owned: the seed is a starting list, and Reference data can add or rename.
 */
export type CallType = {
  id: string
  label: string
}

/** Stable ids so a rename does not orphan tags already on games. */
export const SEED_CALL_TYPES: CallType[] = [
  { id: 'infield-fly', label: 'Infield Fly' },
  { id: 'fourth-out', label: 'Fourth Out' },
  { id: 'batters-interference', label: "Batter's Interference" },
  { id: 'catchers-balk', label: "Catcher's Balk" },
]

/** Slug used as the id when the user adds a call type. */
export function callTypeId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The key a game with no sport code is grouped under. */
export const UNSPECIFIED_SPORT = '(none)'

/** Position in `SPORT_ORDER`, 1-based. Anything unrecognized sorts last. */
export function sportRank(code: string | undefined): number {
  if (!code) return SPORT_ORDER.length + 1
  const i = (SPORT_ORDER as readonly string[]).indexOf(code)
  return i === -1 ? SPORT_ORDER.length + 1 : i + 1
}

export const SEED_IDENTITY: Identity = {
  id: 'self',
  // Empty, deliberately. A name here would ship one person's identity as every
  // installation's default, and this file is public. The pattern is set in
  // Reference data → Identity on first run, or loaded from a local seed file
  // (see `loadLocalReference` in db/schema.ts).
  patterns: [],
  displayName: '',
}

export const SEED_SETTINGS: Settings = {
  id: 'settings',
  homeOriginLabel: 'Home',
  fallbackMph: 35,
  irsMileageRateByYear: {
    '2024': 0.67,
    '2025': 0.7,
    '2026': 0.7,
  },
  currency: 'USD',
  preferredTimeModel: 'game-drive',
  arrivalFloorMinutes: 15,
  rushHour: {
    // 15:00–19:00, every day. Weekday evening games drive out through it; weekend
    // afternoon games let out into it.
    startMinutes: 15 * 60,
    endMinutes: 19 * 60,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  },
}

/**
 * Parks ship empty.
 *
 * Real parks are one person's commute — names, cities, distances, toll amounts —
 * and this file is public, so they cannot be defaults. A fresh install starts with
 * no parks, and the first import flags every venue as unmatched, which is already
 * the designed path for a park the app has not seen: Data Quality offers a
 * suggested name and one-click creation.
 *
 * To avoid re-entering them on a machine that already knows them, put a
 * `data/reference.local.json` alongside the export — `data/` is gitignored, and
 * `seedReferenceData` loads it when present.
 */
export const SEED_PARKS: Park[] = []
