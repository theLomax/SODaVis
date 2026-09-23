/**
 * Layer 4 — Derived. Decomposing an age-group string into its parts.
 *
 * Every league writes its own, so the same competition appears as
 * `CFB / 9-10U DIV A / 90min`, `LBSA-DFW Interlock-10U (90 min)` and
 * `MBSA-Softball-10U-Modified Kid Pitch`. Treating the whole string as the unit
 * makes 47 distinct "age groups" out of maybe a dozen real ones, which is why
 * "age groups seen" overcounts and why a duration has to be entered once per
 * league rather than once per competition.
 *
 * Nothing here is stored. The raw string stays on the game as the imported fact,
 * and this is recomputed on read — so improving the parse costs nothing but a
 * reload, and a game whose string changes upstream is re-read rather than stale.
 *
 * The parse is deliberately conservative: a component it cannot find is left
 * `undefined` rather than guessed, since a wrong `ruleSet` would silently merge
 * two competitions that keep different time.
 */

/** A recognised rule set, in match order — longest and most specific first. */
const RULE_SETS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bASA\s*\/\s*USA\b/i, name: 'ASA/USA' },
  { pattern: /\bUSSSA\b/i, name: 'USSSA' },
  { pattern: /\bASA\b/i, name: 'ASA' },
  { pattern: /\bDFW[\s-]*Interlock\b/i, name: 'DFW Interlock' },
  { pattern: /\bDFW[\s-]*ALL\*?STARS\b/i, name: 'DFW All-Stars' },
  { pattern: /\bTEBA\b/i, name: 'TEBA' },
  { pattern: /\bTX\s*Blowout\b/i, name: 'TX Blowout' },
  { pattern: /\bTOURNEY\b/i, name: 'Tournament' },
  { pattern: /\bPremier\b/i, name: 'Premier' },
  { pattern: /\bSelect\b/i, name: 'Select' },
]

/**
 * An age band, in either of the two forms the data uses: `9-10U` and `10UC`
 * (a single U, optionally with a division letter), or `9u/10u` (a U per number).
 */
const AGE_DUAL_U = /\b(\d{1,2})\s*[Uu]\s*[-/]\s*(\d{1,2})\s*[Uu]\b/
const AGE_SINGLE_U = /\b(\d{1,2}(?:\s*[-/]\s*\d{1,2})?)\s*U(?![a-z])([A-Z])?\b/

const PITCH_STYLES: { pattern: RegExp; name: string }[] = [
  { pattern: /\bmodified\s+kid\s+pitch\b/i, name: 'Modified Kid Pitch' },
  { pattern: /\bkid\s+pitch\b/i, name: 'Kid Pitch' },
  { pattern: /\bcoach\s+pitch\b/i, name: 'Coach Pitch' },
  { pattern: /\bMOD\b/, name: 'Modified' },
  { pattern: /\bCP\b/, name: 'Coach Pitch' },
]

/** Competitive tier, which is not the same thing as the age band. */
const DIVISIONS: { pattern: RegExp; name?: string }[] = [
  { pattern: /\bDIV\s*(AA|A|B)\b/i },
  { pattern: /"?\bAA\b"?\s*Select\b/i, name: 'AA' },
  { pattern: /\bPremier\s*\/\s*ADV\b/i, name: 'Premier/ADV' },
  { pattern: /\bRec\b/i, name: 'Rec' },
  { pattern: /\bComp\b/i, name: 'Comp' },
  // Adult slowpitch: a skill letter, not an age. "Men's Church E Lower".
  { pattern: /\b(?:Men's|Mens|Women's|Womens|Co-?Rec)\b(?:\s+Church)?\s+([A-E](?:\s*\/\s*[A-E])?)\b/i },
]

/**
 * Tournament stage, which changes the clock: TX Blowout runs 8U coach pitch for 60
 * minutes in pool play and 75 in bracket play. Part of the duration key for that
 * reason — merging the two would average a real difference away.
 */
const STAGES: { pattern: RegExp; name: string }[] = [
  { pattern: /\bpool\s*play\b/i, name: 'Pool' },
  { pattern: /\bbracket\b/i, name: 'Bracket' },
]

/** Adult leagues state a cohort rather than an age: "Men's", "Co-Rec". */
const COHORTS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bCo-?Rec\b/i, name: 'Co-Rec' },
  { pattern: /\b(?:Men's|Mens)\b/i, name: "Men's" },
  { pattern: /\b(?:Women's|Womens)\b/i, name: "Women's" },
]

export type AgeGroupParts = {
  /** The string exactly as the source wrote it. Always present. */
  raw: string
  /**
   * Normalised age band — `9-10U`, `12U`, or `Adult` where the league states a
   * cohort instead. `undefined` when neither is stated.
   */
  ageBand?: string
  /** A division letter attached to the band, as in `10UC`. */
  bandSuffix?: string
  ruleSet?: string
  division?: string
  pitchStyle?: string
  /** `Men's`, `Women's`, `Co-Rec` — adult leagues only. */
  cohort?: string
  /** `Pool` or `Bracket`, where a tournament states its stage. */
  stage?: string
}

/** `9/10U` and `9-10U` are the same band written two ways. */
const normalizeBand = (digits: string) => digits.replace(/\s+/g, '').replace(/\//g, '-') + 'U'

export function parseAgeGroup(raw: string): AgeGroupParts {
  const s = raw.trim()
  const parts: AgeGroupParts = { raw: s }
  if (!s) return parts

  const dual = AGE_DUAL_U.exec(s)
  if (dual) {
    parts.ageBand = `${dual[1]}-${dual[2]}U`
  } else {
    const single = AGE_SINGLE_U.exec(s)
    if (single) {
      parts.ageBand = normalizeBand(single[1]!)
      if (single[2]) parts.bandSuffix = single[2]
    }
  }

  for (const { pattern, name } of RULE_SETS) {
    if (pattern.test(s)) {
      parts.ruleSet = name
      break
    }
  }
  for (const { pattern, name } of PITCH_STYLES) {
    if (pattern.test(s)) {
      parts.pitchStyle = name
      break
    }
  }
  for (const { pattern, name } of DIVISIONS) {
    const m = pattern.exec(s)
    if (m) {
      // A capture group means the pattern found the tier inside a longer phrase.
      parts.division = name ?? (m[1] ?? m[0]).replace(/\s+/g, '').toUpperCase()
      break
    }
  }
  for (const { pattern, name } of COHORTS) {
    if (pattern.test(s)) {
      parts.cohort = name
      break
    }
  }
  for (const { pattern, name } of STAGES) {
    if (pattern.test(s)) {
      parts.stage = name
      break
    }
  }

  // Adult leagues name a cohort and a skill letter but no age. Filling the band
  // here keeps every game groupable, and `Adult` is a real answer rather than a
  // guess — it is what "Men's D" means.
  if (!parts.ageBand && parts.cohort) parts.ageBand = 'Adult'

  return parts
}

/**
 * The key a duration should be stored against.
 *
 * Preference order is the point of this whole module: a rule set plus an age band
 * (`USSSA · 10U`) describes a competition that keeps the same time wherever it is
 * played, so one entry covers every league running it. Without a rule set, the
 * league is the next best scope. With neither, the raw string stands — never
 * nothing, so a duration can always be recorded.
 *
 * `pitchStyle` and `stage` join the key because both change the clock: an 8U
 * coach-pitch game is not an 8U kid-pitch game, and TX Blowout runs 8U coach pitch
 * for 60 minutes in pool play against 75 in bracket play.
 */
export function durationKey(parts: AgeGroupParts, league: string | undefined): string {
  const band = parts.ageBand
  if (!band) return `raw:${parts.raw}`

  const tail = [parts.pitchStyle, parts.stage].filter(Boolean).map((p) => ` · ${p}`).join('')
  if (parts.ruleSet) return `rs:${parts.ruleSet} · ${band}${tail}`
  if (league) return `lg:${league} · ${band}${tail}`
  return `raw:${parts.raw}`
}

/** How specific a `durationKey` is, for reporting which scope answered. */
export function durationKeyScope(key: string): 'ruleSet' | 'league' | 'raw' {
  if (key.startsWith('rs:')) return 'ruleSet'
  if (key.startsWith('lg:')) return 'league'
  return 'raw'
}

/** Human-readable form of a `durationKey`, for tables and pickers. */
export function durationKeyLabel(key: string): string {
  return key.replace(/^rs:/, '').replace(/^lg:/, '').replace(/^raw:/, '')
}
