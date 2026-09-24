/**
 * Layer 4 — Derived. Resolution of raw source strings against reference data.
 *
 * Nothing here is stored. Every function is pure, so the whole chain is
 * recomputed on read and is directly unit-testable.
 */

import type { DataQualityFlag, Game } from '../model/game'
import { isCancelled } from '../model/game'
import type {
  AgeGroupDuration,
  GearLevelId,
  GearModifierId,
  Identity,
  Park,
  SportProfile,
} from '../model/reference'
import type { CancelStage, GameAnnotation } from '../model/annotation'
import {
  extractDurationMinutes,
  matchesIdentity,
  normalizeOfficialName,
} from '../import/transforms'
import { durationKey, durationKeyLabel, durationKeyScope, parseAgeGroup } from './ageGroup'

// ---------------------------------------------------------------------------
// Venue -> Park
// ---------------------------------------------------------------------------

/** Compiles a glob (`*` = any run of characters) into an anchored regex. */
function globToRegExp(glob: string): RegExp {
  // Two passes, via a placeholder no venue string contains: escape every regex
  // metacharacter first, then turn the placeholder into `.*`. Doing it in one pass
  // would let the inserted `.*` be escaped by its own replacement. Written as an
  // escape rather than a literal control byte, which makes the file read as binary.
  const PLACEHOLDER = '\u001f'
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, (c) =>
    c === '*' ? PLACEHOLDER : `\\${c}`,
  )
  return new RegExp(`^${escaped.split(PLACEHOLDER).join('.*')}$`, 'i')
}

/**
 * Strips field designators so `'Riverside Park Field 1'` and
 * `'Hillcrest Park / Field A'` reduce toward a park name. This is only
 * ever a *seed* for creating a park; it is never trusted as a match, because on
 * real data it leaves artifacts (a venue ending in a word that is not a designator)
 * and splits ': Red Field' from ': Blue Field'.
 */
export function stripFieldDesignator(venue: string): string {
  return venue
    .replace(/[([]?\bfields?\s*[#]?\s*[A-Za-z0-9]+\)?\]?\s*$/i, '')
    .replace(/[:/\-–]\s*[A-Za-z]+\s+field\s*$/i, '')
    .replace(/[:/\-–]\s*$/, '')
    .replace(/[\s.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type ParkMatch =
  | { parkId: string; via: 'alias' | 'pattern' }
  | { parkId: null; via: 'unmatched'; suggestedName: string }

/**
 * Resolves a venue string to a park: exact alias, then glob pattern, then
 * unmatched. An unmatched venue never silently becomes its own park — it goes
 * to the Data Quality panel with a suggested name for one-click creation.
 */
export function resolvePark(venueRaw: string, parks: Park[]): ParkMatch {
  const venue = venueRaw.trim()

  for (const park of parks) {
    if (park.aliases.some((a) => a.trim().toLowerCase() === venue.toLowerCase())) {
      return { parkId: park.id, via: 'alias' }
    }
  }

  for (const park of parks) {
    if (park.venuePatterns.some((p) => globToRegExp(p).test(venue))) {
      return { parkId: park.id, via: 'pattern' }
    }
  }

  return { parkId: null, via: 'unmatched', suggestedName: stripFieldDesignator(venue) || venue }
}

// ---------------------------------------------------------------------------
// Age group -> duration
// ---------------------------------------------------------------------------

export type DurationResolution = {
  minutes: number | null
  source: 'annotation' | 'reference' | 'reference-raw' | 'extracted' | 'none'
  /** The reference key that answered, when one did. */
  key?: string
}

/**
 * Duration precedence: this game's own override, then the reference table, then
 * extraction from the age-group string, then nothing.
 *
 * The reference table is consulted twice, and the order matters. First by
 * `durationKey` — the decomposed scope, `USSSA · 10U`, which one entry can answer
 * for every league running that competition. Then by the raw age-group string,
 * because every duration entered before the decomposition existed is keyed that
 * way. Nothing is migrated: an old entry keeps working, and a new one written
 * against the broader key simply answers first.
 *
 * `reference-raw` is reported distinctly so the UI can say which entry answered —
 * a figure stored against one league's spelling is narrower than it looks.
 */
export function resolveDuration(
  game: Game,
  durations: Map<string, AgeGroupDuration>,
  annotation?: GameAnnotation,
): DurationResolution {
  if (annotation?.durationMinutesOverride != null) {
    return { minutes: annotation.durationMinutesOverride, source: 'annotation' }
  }

  const key = durationKey(parseAgeGroup(game.ageGroupRaw), game.league)
  const scoped = durations.get(key)
  if (scoped) return { minutes: scoped.durationMinutes, source: 'reference', key }

  const raw = durations.get(game.ageGroupRaw)
  if (raw) {
    return { minutes: raw.durationMinutes, source: 'reference-raw', key: game.ageGroupRaw }
  }

  const extracted = extractDurationMinutes(game.ageGroupRaw)
  if (extracted != null) return { minutes: extracted, source: 'extracted' }

  return { minutes: null, source: 'none' }
}

/** A duration scope needing a figure, with enough context to fill it in. */
export type DurationGap = {
  /** The `durationKey` the figure should be stored against. */
  key: string
  scope: 'ruleSet' | 'league' | 'raw'
  /** Readable form of the key, for a table row. */
  label: string
  /** The raw age-group strings this scope covers. */
  rawGroups: string[]
  games: number
}

/**
 * Seeds the reference table from whatever the source strings state, and reports
 * the scopes that still need a figure.
 *
 * Seeding is keyed by `durationKey`, not by the raw string, so a duration stated
 * once covers every league spelling of the same competition. Where two strings in
 * one scope disagree — a real possibility, since the scope is a judgement — the
 * first is taken and the conflict is reported rather than averaged away.
 *
 * `needsManual` counts scopes, not strings, which is the point of the whole
 * exercise: 25 unparseable strings collapse into far fewer real gaps to fill.
 */
export function seedAgeGroupDurations(games: Game[]): {
  seeded: AgeGroupDuration[]
  /** Scopes with no stated duration, each fillable by one entry. */
  gaps: DurationGap[]
  /** Raw strings with no stated duration. Kept for continuity of older callers. */
  needsManual: string[]
  /** Scopes where two source strings state different durations. */
  conflicts: { key: string; label: string; minutes: number[]; rawGroups: string[] }[]
} {
  type Bucket = {
    key: string
    minutesByGroup: Map<string, number | null>
    games: number
  }
  const buckets = new Map<string, Bucket>()

  for (const game of games) {
    if (!game.ageGroupRaw) continue
    const key = durationKey(parseAgeGroup(game.ageGroupRaw), game.league)
    const bucket = buckets.get(key) ?? { key, minutesByGroup: new Map(), games: 0 }
    bucket.games++
    if (!bucket.minutesByGroup.has(game.ageGroupRaw)) {
      bucket.minutesByGroup.set(game.ageGroupRaw, extractDurationMinutes(game.ageGroupRaw))
    }
    buckets.set(key, bucket)
  }

  const seeded: AgeGroupDuration[] = []
  const gaps: DurationGap[] = []
  const needsManual: string[] = []
  const conflicts: { key: string; label: string; minutes: number[]; rawGroups: string[] }[] = []

  for (const bucket of [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const rawGroups = [...bucket.minutesByGroup.keys()].sort()
    const stated = [...new Set([...bucket.minutesByGroup.values()].filter((m): m is number => m != null))]

    if (stated.length === 0) {
      gaps.push({
        key: bucket.key,
        scope: durationKeyScope(bucket.key),
        label: durationKeyLabel(bucket.key),
        rawGroups,
        games: bucket.games,
      })
      needsManual.push(...rawGroups)
      continue
    }

    if (stated.length > 1) {
      conflicts.push({
        key: bucket.key,
        label: durationKeyLabel(bucket.key),
        minutes: [...stated].sort((a, b) => a - b),
        rawGroups,
      })
    }
    seeded.push({ key: bucket.key, durationMinutes: stated[0]!, origin: 'extracted' })
  }

  return { seeded, gaps, needsManual: [...new Set(needsManual)].sort(), conflicts }
}

// ---------------------------------------------------------------------------
// Officials -> partner / self
// ---------------------------------------------------------------------------

export type PartnerRef = {
  /** Suffix-stripped name, stable across seasons. Used for grouping. */
  key: string
  /** The name as the source most recently wrote it. Used for display. */
  raw: string
  position: string
}

export function partnersOf(game: Game): PartnerRef[] {
  return game.assignments
    .filter((a) => !a.isSelf)
    .map((a) => ({ key: normalizeOfficialName(a.official), raw: a.official, position: a.position }))
}

export function selfAssignment(game: Game) {
  return game.assignments.find((a) => a.isSelf)
}

export function isSolo(game: Game): boolean {
  return partnersOf(game).length === 0
}

/**
 * Re-resolves `isSelf` against the current identity.
 *
 * `isSelf` is stamped at import with whatever identity existed then, which may have
 * been none at all. Deriving it on read is what lets an identity saved later apply
 * to every stored game without a re-import — which could not do it anyway, since a
 * re-import of an unchanged row is reported as unchanged and never rewritten.
 * Returns the same object when nothing changes.
 */
export function reresolveIdentity(game: Game, identity: Identity): Game {
  let changed = false
  const assignments = game.assignments.map((a) => {
    const isSelf = matchesIdentity(a.official, identity.patterns)
    if (isSelf === a.isSelf) return a
    changed = true
    return { ...a, isSelf }
  })
  return changed ? { ...game, assignments } : game
}

// ---------------------------------------------------------------------------
// Sport & gear
// ---------------------------------------------------------------------------

/**
 * The sport code in effect: a manual override first, then whatever the source
 * stated. The raw `game.sportCode` is never modified — the override lives in the
 * annotation layer so a re-import cannot clobber it.
 */
export function effectiveSportCode(
  game: Game,
  annotation?: GameAnnotation,
): string | undefined {
  return annotation?.sportCodeOverride ?? game.sportCode
}

export function resolveSport(
  game: Game,
  sports: Map<string, SportProfile>,
  annotation?: GameAnnotation,
): SportProfile | undefined {
  const code = effectiveSportCode(game, annotation)
  return code ? sports.get(code) : undefined
}

/**
 * What was worn. No source states any of it, so this is the annotation — except
 * that `full-gear` is *assumed at the plate*: the plate umpire is in gear unless
 * told otherwise, which spares an explicit tick on the common case.
 *
 * The assumption is one-way. A base umpire is not assumed to be in gear (they
 * often are in two-umpire baseball, and never in kickball or slowpitch), and
 * recording `gearModifiers: []` against a plate game is respected — that is how
 * a plate umpire in shorts for a scrimmage is described.
 *
 * `shield` needs the plate: it is a choice of chest protection, so it is dropped
 * elsewhere rather than quietly shortening prep.
 */
export function resolveGearModifiers(
  annotation?: GameAnnotation,
  role?: GearLevelId,
): GearModifierId[] {
  const stated = annotation?.gearModifiers
  if (stated) return role === 'plate' ? stated : stated.filter((m) => m !== 'shield')
  // Nothing recorded: the plate implies full gear, anything else implies nothing.
  return role === 'plate' ? ['full-gear'] : []
}

/**
 * The position worked: a manual entry first, then the sport's usual position, then
 * nothing. `undefined` is a real answer — the export does not record who took the
 * plate, and kickball and slowpitch do not imply a position at all.
 */
export function resolveGearLevel(
  game: Game,
  sports: Map<string, SportProfile>,
  annotation?: GameAnnotation,
): GearLevelId | undefined {
  if (annotation?.gearLevel) return annotation.gearLevel
  return resolveSport(game, sports, annotation)?.defaultGearLevel
}

// ---------------------------------------------------------------------------
// Per-game resolution bundle
// ---------------------------------------------------------------------------

export type ResolvedGame = {
  game: Game
  parkId: string | null
  parkMatch: ParkMatch
  duration: DurationResolution
  partners: PartnerRef[]
  /**
   * The position worked, when known. `undefined` where neither the user nor the
   * sport says — kickball and slowpitch imply no position.
   */
  gearLevel?: GearLevelId
  /** What was worn. Defaults to full gear at the plate; empty elsewhere. */
  gearModifiers: GearModifierId[]
  /**
   * Sport code in effect after any manual override — what every breakdown, filter
   * and chart should group by. Read this rather than `game.sportCode`.
   */
  sportCode?: string
  /** True when `sportCode` came from a manual tag rather than the source. */
  sportCodeIsManual: boolean
  sport?: SportProfile
  /**
   * Cancellation detail, all manual: the export says a game was cancelled, not
   * what it cost. Only meaningful when `game.status` is a cancellation.
   */
  cancelStage?: CancelStage
  /**
   * Whether the drive was made anyway — the one thing that admits a cancellation
   * to a trip. Deliberately tri-state: `undefined` means nobody has said, which
   * is different from `false` meaning "I did not drive". Only the latter settles
   * the question.
   */
  droveToCancelled?: boolean
  /** Whether weather or field conditions were the cause. `undefined` if unrecorded. */
  weatherRelated?: boolean
  /** Import flags plus any raised during resolution. */
  flags: DataQualityFlag[]
}

export type ResolveContext = {
  parks: Park[]
  durations: Map<string, AgeGroupDuration>
  sports: Map<string, SportProfile>
  annotations: Map<string, GameAnnotation>
  /**
   * The current identity. When given, `isSelf` and the `self-not-found` flag are
   * derived from it rather than read from what was stamped at import. The app
   * always passes it; omitting it trusts the stored values.
   */
  identity?: Identity
}

export function resolveGame(stored: Game, ctx: ResolveContext): ResolvedGame {
  const game = ctx.identity ? reresolveIdentity(stored, ctx.identity) : stored
  const annotation = ctx.annotations.get(game.source.dedupeKey)
  const parkMatch = resolvePark(game.venueRaw, ctx.parks)
  const duration = resolveDuration(game, ctx.durations, annotation)
  const flags: DataQualityFlag[] = ctx.identity
    ? game.flags.filter((f) => f.code !== 'self-not-found')
    : [...game.flags]

  if (ctx.identity && game.assignments.length && !game.assignments.some((a) => a.isSelf)) {
    flags.push({
      code: 'self-not-found',
      severity: 'serious',
      message:
        'None of this game’s officials matched your identity patterns, so no partner could be derived.',
      context: game.assignments.map((a) => a.official).join('; '),
    })
  }

  if (parkMatch.parkId === null) {
    flags.push({
      code: 'unmatched-venue',
      severity: 'serious',
      message: `Venue "${game.venueRaw}" does not match any park. Add it as an alias or create a park.`,
      context: game.venueRaw,
    })
  }

  // Raised here rather than at import: a manual tag resolves it, and the flag
  // should disappear when it does.
  if (!effectiveSportCode(game, annotation)) {
    flags.push({
      code: 'missing-sport-code',
      severity: 'info',
      message:
        'The source row carried no sport code. Tag the sport by hand to fix prep, wrap and the sport breakdown.',
      context: game.league ?? '',
    })
  }

  // A cancelled game was never played, so it needs no duration: it contributes
  // no minutes to any model and asking for one is a gap that cannot be closed
  // usefully. The age group is still reported if an active game shares it.
  if (duration.minutes == null && !isCancelled(game.status)) {
    flags.push({
      code: 'missing-duration',
      severity: 'warning',
      message: `No duration known for age group "${game.ageGroupRaw}". Enter one in Reference data.`,
      context: game.ageGroupRaw,
    })
  }

  const sport = resolveSport(game, ctx.sports, annotation)
  const sportCode = effectiveSportCode(game, annotation)
  const gearLevel = resolveGearLevel(game, ctx.sports, annotation)

  return {
    game,
    parkId: parkMatch.parkId,
    parkMatch,
    duration,
    partners: partnersOf(game),
    ...(gearLevel ? { gearLevel } : {}),
    gearModifiers: resolveGearModifiers(annotation, gearLevel),
    ...(sportCode ? { sportCode } : {}),
    sportCodeIsManual: annotation?.sportCodeOverride != null,
    ...(sport ? { sport } : {}),
    ...(annotation?.cancelStage ? { cancelStage: annotation.cancelStage } : {}),
    ...(annotation?.droveToCancelled != null
      ? { droveToCancelled: annotation.droveToCancelled }
      : {}),
    ...(annotation?.weatherRelated != null
      ? { weatherRelated: annotation.weatherRelated }
      : {}),
    flags,
  }
}

export function resolveGames(games: Game[], ctx: ResolveContext): ResolvedGame[] {
  return games.map((g) => resolveGame(g, ctx))
}
