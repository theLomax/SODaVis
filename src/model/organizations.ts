/**
 * Organization names, and the choice made at import. Shared by the resolver (a
 * payor naming an organization), the Organizations editor and the Import view,
 * so "same name" means one thing everywhere.
 */

import type { Organization } from './reference'

/** Case and spacing aside, so "H&B  Officials" and "h&b officials" are one name. */
export function normalizeOrganizationName(name: string | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The organization a name belongs to — its own name or one it goes by. */
export function findOrganizationByName(
  name: string | undefined,
  organizations: Organization[],
): Organization | undefined {
  const wanted = normalizeOrganizationName(name)
  if (!wanted) return undefined
  return organizations.find((o) =>
    [o.name, ...(o.aliases ?? [])].some((n) => normalizeOrganizationName(n) === wanted),
  )
}

export function newOrganizationId(name: string, taken: Set<string>): string {
  const base = `org-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org'}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/** The name a freelance or directly contracted game's organization goes by. */
export const DIRECT_CONTRACT_NAME = 'Direct contract'

/** "Organization 001", "Organization 002"… the first number not yet in use. */
export function nextPlaceholderName(organizations: Organization[]): string {
  for (let n = 1; ; n++) {
    const name = `Organization ${String(n).padStart(3, '0')}`
    if (!findOrganizationByName(name, organizations)) return name
  }
}

/** What the user picked for a file's organization on the Import review. */
export type ImportOrganizationChoice =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; name: string }
  | { kind: 'direct' }
  | { kind: 'later' }

/**
 * Turns the pick into the organization the import records, and any organization
 * that has to be created first.
 *
 * "Later" is not "none": every game should belong to an organization, so a file
 * left unassigned gets a placeholder ("Organization 001") to rename later — unless
 * every game's payor already names one of the user's organizations, in which case
 * nothing would use it.
 */
export function planImportOrganization(
  choice: ImportOrganizationChoice,
  payors: (string | undefined)[],
  organizations: Organization[],
): { organizationId?: string; create?: Organization } {
  const taken = new Set(organizations.map((o) => o.id))
  const create = (name: string, kind: Organization['kind']) => {
    const org: Organization = { id: newOrganizationId(name, taken), name, kind }
    return { organizationId: org.id, create: org }
  }

  switch (choice.kind) {
    case 'existing':
      return { organizationId: choice.id }
    case 'new': {
      const name = choice.name.trim()
      if (!name) return {}
      const existing = findOrganizationByName(name, organizations)
      return existing ? { organizationId: existing.id } : create(name, 'association')
    }
    case 'direct': {
      const existing = findOrganizationByName(DIRECT_CONTRACT_NAME, organizations)
      return existing ? { organizationId: existing.id } : create(DIRECT_CONTRACT_NAME, 'direct')
    }
    case 'later': {
      const allNamed = payors.length > 0 && payors.every((p) => findOrganizationByName(p, organizations))
      return allNamed ? {} : create(nextPlaceholderName(organizations), 'association')
    }
  }
}
