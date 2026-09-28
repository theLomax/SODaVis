import type { SourceProfile } from './types'
import { assignrProfile } from './assignr'
import { reftownProfile } from './reftown'
import { genericProfile } from './generic'

export type { SourceProfile, DedupeSpec, OfficialColumnPair, ImportFileType } from './types'
export { assignrProfile } from './assignr'
export { reftownProfile } from './reftown'
export { genericProfile, FIELD_SYNONYMS } from './generic'

/** Profiles shipped with the app. Custom profiles are loaded from the db. */
export const BUILT_IN_PROFILES: SourceProfile[] = [assignrProfile, reftownProfile]

export function findProfile(
  id: string,
  custom: SourceProfile[] = [],
): SourceProfile | undefined {
  return [...BUILT_IN_PROFILES, ...custom, genericProfile].find((p) => p.id === id)
}
