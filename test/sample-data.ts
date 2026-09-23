/**
 * Locates the public sample export.
 *
 * `SODaVis-SampleData` is a public submodule at `test/sample/`: invented games
 * reproducing every structural oddity a real export has. It is what lets the whole
 * pipeline be tested without access to anyone's real records.
 *
 * The private `SODaVis-Data` submodule at `data/` adds assertions about one real
 * season on top; it is never required.
 *
 * Regenerate with `node scripts/make-fixture.mjs`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const FIXTURE_SAMPLE = resolve(import.meta.dirname, 'sample/games-sample.csv')

export function readFixtureSample(): string {
  if (!existsSync(FIXTURE_SAMPLE)) {
    throw new Error(
      `The public sample data is missing (${FIXTURE_SAMPLE}).\n` +
        'Run: git submodule update --init --recursive',
    )
  }
  return readFileSync(FIXTURE_SAMPLE, 'utf8')
}
