#!/usr/bin/env node
/**
 * Commits the app and its private submodules in one go.
 *
 * The privacy boundary costs a three-step commit: the change in a submodule, the
 * change here, and the pointer bump that ties them together. Done by hand that is
 * easy to half-finish, and a half-finished version is worse than either end — the
 * app repo then records a submodule state that does not match its code.
 *
 * So this does all three, in dependency order, and stops at the first failure
 * rather than leaving a partial state behind.
 *
 *   node scripts/commit-all.mjs "message"
 *   node scripts/commit-all.mjs "message" --dry-run
 *
 * Submodules are committed first: the parent records their new commit ids, so they
 * have to exist before the pointer can point at them.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const SUBMODULES = [
  { path: 'data', label: 'SODaVis-Data' },
  { path: 'test/sample', label: 'SODaVis-SampleData' },
  { path: 'test/private', label: 'SODaVis-Tests' },
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const message = args.filter((a) => !a.startsWith('--')).join(' ')

if (!message) {
  console.error('usage: node scripts/commit-all.mjs "commit message" [--dry-run]')
  process.exit(1)
}

/** Runs git, returning stdout. Throws on a non-zero exit. */
const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const dirty = (cwd) => git(cwd, 'status', '--porcelain').length > 0

function run(cwd, label, ...a) {
  if (dryRun) {
    console.log(`  [dry-run] ${label}: git ${a.join(' ')}`)
    return
  }
  git(cwd, ...a)
}

let pushed = 0

for (const { path, label } of SUBMODULES) {
  if (!existsSync(path)) {
    console.log(`—  ${label}: not checked out, skipping`)
    continue
  }
  const branch = git(path, 'branch', '--show-current')
  if (!branch) {
    // A detached HEAD would take the commit somewhere no branch points at, and the
    // next `submodule update` would discard it silently.
    console.error(`✗  ${label}: detached HEAD. Run: git -C ${path} checkout main`)
    process.exit(1)
  }
  if (!dirty(path)) {
    console.log(`—  ${label}: nothing to commit`)
    continue
  }
  console.log(`→  ${label}: committing on ${branch}`)
  run(path, label, 'add', '-A')
  run(path, label, 'commit', '-m', message)
  run(path, label, 'push', 'origin', branch)
  pushed++
}

// The parent last: its commit records the submodule ids created above.
if (!dirty('.') && pushed === 0) {
  console.log('—  app: nothing to commit')
  process.exit(0)
}

console.log('→  app: committing')
run('.', 'app', 'add', '-A')
run('.', 'app', 'commit', '-m', message)

console.log(
  dryRun
    ? '\ndry run only — nothing was committed'
    : `\ncommitted across ${pushed + 1} repositor${pushed === 0 ? 'y' : 'ies'}.` +
        '\nThe app commit is local; push it when you are ready.',
)
