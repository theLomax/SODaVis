/**
 * The publish denylist: patterns that must never appear in a file published to the
 * public repository.
 *
 * The patterns themselves are real identifiers, so they cannot live in this tree —
 * a denylist committed beside the code it guards publishes exactly what it exists
 * to keep out. They live in the private data repository, mounted at `data/`, one
 * case-insensitive regular expression per line:
 *
 *   # comments and blank lines are ignored
 *   \bsome-venue\b
 *   some.partner.name
 *
 * Loading fails closed. A missing, unreadable, empty or malformed denylist throws,
 * because a gate that silently passes when its list is absent is no gate at all.
 */

import { readFileSync } from 'node:fs'

export const DEFAULT_DENYLIST_PATH = 'data/publish-denylist.txt'

export class DenylistError extends Error {}

/** Parses denylist text into patterns. Throws `DenylistError` on any bad line. */
export function parseDenylist(text, source = 'denylist') {
  const patterns = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    try {
      patterns.push(new RegExp(line, 'i'))
    } catch (e) {
      throw new DenylistError(`${source}:${i + 1}: not a valid regular expression (${e.message})`)
    }
  })
  if (patterns.length === 0) {
    throw new DenylistError(`${source}: contains no patterns, so it would let everything through`)
  }
  return patterns
}

/** Reads and parses the denylist at `path`. Throws `DenylistError` if it cannot. */
export function loadDenylist(path = DEFAULT_DENYLIST_PATH) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new DenylistError(
      `${path}: not found. The publish denylist lives in the private data repository; ` +
        'check out the data/ submodule, or point SODAVIS_DENYLIST at a copy.',
    )
  }
  return parseDenylist(text, path)
}

/** The repo URLs contain the owner's username, which is unavoidable and not data. */
const GITHUB_URL = /https:\/\/github\.com\/[^\s"')]+/g

/** Returns the first denylisted string in `text`, or `null` when it is clean. */
export function findForbidden(text, patterns) {
  const withoutUrls = text.replace(GITHUB_URL, '')
  for (const p of patterns) {
    const hit = p.exec(withoutUrls)
    if (hit) return hit[0]
  }
  return null
}
