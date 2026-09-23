#!/usr/bin/env node
/**
 * Publishes the current tree to the public repository.
 *
 * Not a `git push`. This local repository's history contains eleven commits that
 * carry real data — venue names, a partner's game count, income totals — from before
 * the de-identification work. The working tree is clean, but a clone fetches every
 * commit, so pushing this branch would republish all of it permanently.
 *
 * So the public repo has its own history, starting from a tree verified clean, and
 * publishing means copying the tracked files into it and committing there. The push
 * URL on `origin` is deliberately set to an invalid value so a reflexive `git push`
 * fails loudly instead of leaking.
 *
 *   node scripts/publish.mjs "commit message"
 *   node scripts/publish.mjs "message" --dry-run
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const PUBLIC_REMOTE = 'https://github.com/theLomax/SODaVis.git'
/** Paths that are submodules here: recorded as gitlinks, never copied as files. */
const SUBMODULES = ['data', 'test/private', 'test/sample']

/**
 * Anything matching these must never reach the public repo. Checked against every
 * file about to be committed, because a scan of the working tree is only as good as
 * the last time someone remembered to run it.
 */
const FORBIDDEN =
  /\bfein\b|mccarter|S&J|mbsatx|wyliesports|dfwinterlock|\b8990\b|\b9336\b|gabe.nesbitt|mcinnish|carroll?ton|mckinney|\bwylie\b|coppell|lewisville|prestonwood|NTWKA|\bspirit\b|foster.village|andrew.brown|little.elm|oran.good|\bpepper\b|texas.star|allen.station|JZM5750|13761487/i

/**
 * This file necessarily contains the forbidden words, since it defines them. Scanning
 * itself would fail every time, so it is exempt — the one file where a match is
 * expected rather than a leak. Kept as an explicit list rather than a pattern, so
 * adding an exemption is a deliberate act.
 */
const SELF_EXEMPT = new Set(['scripts/publish.mjs'])

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const message = args.filter((a) => !a.startsWith('--')).join(' ')

if (!message) {
  console.error('usage: node scripts/publish.mjs "commit message" [--dry-run]')
  process.exit(1)
}

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const here = process.cwd()
const tracked = git(here, 'ls-files').split('\n').filter(Boolean)
const files = tracked.filter((f) => !SUBMODULES.includes(f))

// --- the gate: scan what is about to be published, not what was published before ---
const offenders = []
for (const f of files) {
  if (SELF_EXEMPT.has(f)) continue
  if (/\.(png|jpg|jpeg|ico|svg|woff2?|lock)$/i.test(f)) continue
  let text
  try {
    text = execFileSync('cat', [f], { encoding: 'utf8' })
  } catch {
    continue
  }
  // The repo URLs contain the owner's username, which is unavoidable and not data.
  const withoutUrls = text.replace(/https:\/\/github\.com\/[^\s"')]+/g, '')
  const hit = FORBIDDEN.exec(withoutUrls)
  if (hit) offenders.push(`${f}: ${hit[0]}`)
}

if (offenders.length > 0) {
  console.error('✗ refusing to publish — real data found in:')
  for (const o of offenders) console.error(`    ${o}`)
  console.error('\nRemove it, or widen the allowance in scripts/publish.mjs if it is a false positive.')
  process.exit(1)
}
console.log(`✓ scanned ${files.length} files, no real data`)

const stage = join(tmpdir(), `sodavis-publish-${Date.now()}`)
if (dryRun) {
  console.log(`[dry-run] would copy ${files.length} files and commit: ${message}`)
  process.exit(0)
}

mkdirSync(stage, { recursive: true })
git(stage, 'init', '-q', '-b', 'main')
git(stage, 'remote', 'add', 'origin', PUBLIC_REMOTE)
git(stage, 'fetch', '-q', 'origin', 'main')
git(stage, 'checkout', '-q', 'main')

// Replace the tree wholesale, so a deletion here is a deletion there.
for (const f of git(stage, 'ls-files').split('\n').filter(Boolean)) {
  if (!SUBMODULES.includes(f)) rmSync(join(stage, f), { force: true })
}
for (const f of files) {
  mkdirSync(dirname(join(stage, f)), { recursive: true })
  cpSync(resolve(here, f), join(stage, f))
}

// Submodule pointers, matched to whatever this repo currently records.
for (const path of SUBMODULES) {
  if (!existsSync(resolve(here, path))) continue
  const sha = git(here, 'ls-tree', 'HEAD', path).split(/\s+/)[2]
  if (sha) git(stage, 'update-index', '--add', `--cacheinfo`, `160000,${sha},${path}`)
}

git(stage, 'add', '-A')
const pending = git(stage, 'status', '--porcelain')
if (!pending) {
  console.log('— nothing to publish: the public tree already matches this one')
  process.exit(0)
}
git(stage, 'commit', '-q', '-m', message)
git(stage, 'push', '-q', 'origin', 'main')

console.log(`✓ published to ${PUBLIC_REMOTE}`)
console.log(git(stage, 'log', '--oneline', '-1'))
