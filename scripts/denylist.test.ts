/**
 * The publish gate. Its patterns are private, so the unit tests here use invented
 * ones; the tree scan at the bottom uses the real list when `data/` is checked out
 * and skips otherwise.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DENYLIST_PATH,
  DenylistError,
  findForbidden,
  loadDenylist,
  parseDenylist,
} from './denylist.mjs'

describe('parsing the denylist', () => {
  it('reads one case-insensitive pattern per line, skipping comments and blanks', () => {
    const patterns = parseDenylist('# header\n\nriverside\n\\bhill\\b\n')
    expect(patterns).toHaveLength(2)
    expect(findForbidden('RIVERSIDE park', patterns)).toBe('RIVERSIDE')
    expect(findForbidden('uphill', patterns)).toBeNull()
  })

  it('refuses a list with no patterns, which would pass everything', () => {
    expect(() => parseDenylist('# only a comment\n\n')).toThrow(DenylistError)
  })

  it('refuses a malformed pattern rather than skipping it', () => {
    expect(() => parseDenylist('fine\n(unclosed\n')).toThrow(/:2:/)
  })

  it('fails closed when the file is missing', () => {
    expect(() => loadDenylist(join(tmpdir(), 'no-such-denylist.txt'))).toThrow(DenylistError)
  })

  it('ignores the repo URLs, which carry the owner username', () => {
    const patterns = parseDenylist('thelomax\n')
    expect(findForbidden('see https://github.com/theLomax/SODaVis.git', patterns)).toBeNull()
    expect(findForbidden('theLomax wrote this', patterns)).toBe('theLomax')
  })
})

describe('publish.mjs', () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['scripts/publish.mjs', 'test run', '--dry-run'], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    })

  it('refuses to publish when the denylist is missing', () => {
    const r = run({ SODAVIS_DENYLIST: join(tmpdir(), 'no-such-denylist.txt') })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/no usable denylist/)
  })

  it('refuses to publish when a tracked file matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'denylist-'))
    const path = join(dir, 'list.txt')
    // Every tracked tree has a package.json naming the app.
    writeFileSync(path, 'SODaVis\n')
    const r = run({ SODAVIS_DENYLIST: path })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/real data found/)
  })

  it('carries no literal denylist of its own', () => {
    const source = readFileSync('scripts/publish.mjs', 'utf8')
    expect(source).not.toMatch(/FORBIDDEN\s*=/)
    expect(source).not.toMatch(/SELF_EXEMPT/)
  })
})

describe.skipIf(!existsSync(DEFAULT_DENYLIST_PATH))('the public tree', () => {
  it('contains nothing on the private denylist', () => {
    const patterns = loadDenylist()
    const submodules = new Set(['data', 'test/private', 'test/sample'])
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f && !submodules.has(f))
      .filter((f) => !/\.(png|jpg|jpeg|ico|svg|woff2?|lock)$/i.test(f))
      .filter((f) => existsSync(f))

    const offenders = files.flatMap((f) => {
      const hit = findForbidden(readFileSync(f, 'utf8'), patterns)
      return hit ? [f] : []
    })
    // File names only: the matched text is exactly what must not be printed.
    expect(offenders).toEqual([])
  })
})
