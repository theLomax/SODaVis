import type { SourceProfile } from './types'
import { assignrProfile } from './assignr'
import { genericProfile } from './generic'

export type { SourceProfile, DedupeSpec, OfficialColumnPair } from './types'
export { assignrProfile } from './assignr'
export { genericProfile, FIELD_SYNONYMS } from './generic'

/** Profiles shipped with the app. Custom profiles are loaded from the db. */
export const BUILT_IN_PROFILES: SourceProfile[] = [assignrProfile]

export function findProfile(
  id: string,
  custom: SourceProfile[] = [],
): SourceProfile | undefined {
  return [...BUILT_IN_PROFILES, ...custom, genericProfile].find((p) => p.id === id)
}
