/**
 * The module map is generated, so it is only worth reading if it is current. This
 * fails when it is not; the fix is `npm run map`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain .mjs script, imported for its generator.
import { buildModuleMap } from './module-map.mjs'

describe('docs/generated/module-map.md', () => {
  it('matches the code (run `npm run map` if this fails)', () => {
    const onDisk = readFileSync(resolve(__dirname, '../docs/generated/module-map.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(onDisk).toBe(buildModuleMap())
  })
})
