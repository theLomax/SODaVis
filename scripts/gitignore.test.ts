/**
 * Files the app writes that carry personal data must be ignored by git wherever
 * they land in the tree. Asked of git itself, so a pattern that looks right but
 * does not match fails here.
 */

import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { backupFileName } from '../src/db/backup'

const ignored = (path: string) =>
  spawnSync('git', ['check-ignore', '-q', '--no-index', path]).status === 0

describe('.gitignore', () => {
  it('ignores the backup file the app downloads, at the root and below it', () => {
    const name = backupFileName()
    expect(ignored(name)).toBe(true)
    expect(ignored(`src/${name}`)).toBe(true)
  })

  it('ignores a restorable reference backup', () => {
    expect(ignored('reference.local.json')).toBe(true)
    expect(ignored('test/reference.local.json')).toBe(true)
  })

  it('ignores the Tax view exports', () => {
    expect(ignored('officiating-tax-2026.json')).toBe(true)
    expect(ignored('officiating-tax-2026.csv')).toBe(true)
  })

  it('still tracks the source', () => {
    expect(ignored('src/db/backup.ts')).toBe(false)
    expect(ignored('package.json')).toBe(false)
  })
})
