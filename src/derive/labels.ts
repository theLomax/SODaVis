/**
 * Shortening long category names for chart axes.
 *
 * A y-axis band fits roughly 20 characters; league names in this data run to 46
 * (a four-word league name plus "Association"). Truncating to a prefix wastes the distinguishing part, so words that carry no information in
 * context are dropped first — every league here is a baseball or softball
 * association, so those words separate nothing.
 *
 * The full name always remains available: `ChartFrame` puts it in the tooltip and
 * the table view, so the short form is a label, never the only copy.
 */

/**
 * Words dropped before initialising. These are the ones shared across almost every
 * name in this domain, so they distinguish nothing and cost the most space.
 */
const UNINFORMATIVE = new Set([
  'association',
  'associations',
  'baseball',
  'softball',
  'kickball',
  'tournament',
  'league',
  'club',
  'youth',
  'sports',
  'girls',
  'boys',
  'mens',
  'womens',
  "men's",
  "women's",
  'the',
  'of',
  'at',
  'and',
])

const strip = (w: string) => w.toLowerCase().replace(/[.,]/g, '')

/**
 * A label of at most `limit` characters, preferring meaning over prefix.
 *
 * Three stages, each tried in turn: the name as given, the name with
 * uninformative words removed, then the initials of what is left — which is how
 * a three-word league name becomes its initials — the same abbreviation a source
 * data already uses in its venue strings.
 */
export function abbreviateLabel(name: string, limit = 18): string {
  const trimmed = name.trim()
  if (trimmed.length <= limit) return trimmed

  const words = trimmed.split(/[\s/]+/).filter(Boolean)
  const kept = words.filter((w) => !UNINFORMATIVE.has(strip(w)))
  if (kept.length === 0) return trimmed.slice(0, limit - 1) + '…'

  const shortened = kept.join(' ')
  if (shortened.length <= limit) return shortened

  const initials = kept
    .filter((w) => /^[a-z]/i.test(w))
    .map((w) => w[0]!.toUpperCase())
    .join('')
  // A single letter is not a label; fall back to truncation rather than emit "C".
  return initials.length >= 2 ? initials : shortened.slice(0, limit - 1) + '…'
}

/**
 * Abbreviates a set of names, keeping them distinct from each other.
 *
 * Two leagues that shorten to the same string would be worse than long labels —
 * the reader would merge two rows in their head. A collision falls back to the
 * full name for every member of the clash, since which of them to keep short is
 * not ours to decide.
 */
export function abbreviateLabels(names: string[], limit = 18): Map<string, string> {
  const short = new Map<string, string>()
  const byShort = new Map<string, string[]>()

  for (const name of names) {
    const s = abbreviateLabel(name, limit)
    short.set(name, s)
    const bucket = byShort.get(s)
    if (bucket) bucket.push(name)
    else byShort.set(s, [name])
  }

  for (const [, clashing] of byShort) {
    if (clashing.length > 1) for (const name of clashing) short.set(name, name)
  }
  return short
}
