/**
 * Organizations: who hired, assigned and paid for the work. An officials'
 * association, or a direct contract — a league or tournament paying you itself,
 * or a freelance game. Not the platform: two associations can both use Assignr.
 *
 * An export may name the organization as a game's payor ("H&B Officials"), so
 * each organization lists the names it goes by, and a payor matching one ties the
 * game to it. Never the assignor: that is a person, who may assign for several.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput, selectStyle } from '../../components/Controls'
import { Card } from '../../components/Tiles'
import { deleteOrganization, patchOrganization, saveOrganization } from '../../../db/repo'
import {
  ORGANIZATION_KINDS,
  type Organization,
  type OrganizationKind,
} from '../../../model/reference'
import { TextCell } from './cells'
import { newOrganizationId } from '../../../model/organizations'

/** "HOG, H&B Officials" → ['HOG', 'H&B Officials']. */
function parseNames(text: string | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function OrganizationsEditor() {
  const { derived, reload } = useStore()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<OrganizationKind>('association')
  const [platform, setPlatform] = useState('')
  const [error, setError] = useState<string | null>(null)

  const games = derived?.allResolved
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const g of games ?? []) if (g.organizationId) out.set(g.organizationId, (out.get(g.organizationId) ?? 0) + 1)
    return out
  }, [games])

  /** Payors on games no organization claims yet, commonest first: the likely organizations. */
  const unclaimed = useMemo(() => {
    const rest = (games ?? []).filter((g) => !g.organizationId)
    const tally = new Map<string, number>()
    let noPayor = 0
    for (const g of rest) {
      const payor = g.game.payor?.trim()
      if (payor) tally.set(payor, (tally.get(payor) ?? 0) + 1)
      else noPayor++
    }
    return { count: rest.length, noPayor, payors: [...tally.entries()].sort((a, b) => b[1] - a[1]) }
  }, [games])

  if (!derived) return null
  const organizations = [...derived.snapshot.organizations].sort((a, b) => a.name.localeCompare(b.name))
  const taken = new Set(organizations.map((o) => o.id))
  const nameInUse = (candidate: string) =>
    organizations.find((o) => [o.name, ...(o.aliases ?? [])].some((n) => sameName(n, candidate)))

  async function run(action: () => Promise<void>) {
    try {
      setError(null)
      await action()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function create(orgName: string, orgKind: OrganizationKind, orgPlatform?: string) {
    const trimmed = orgName.trim()
    if (!trimmed) return false
    const clash = nameInUse(trimmed)
    if (clash) {
      setError(`"${trimmed}" is already ${sameName(clash.name, trimmed) ? 'on the list' : `a name for ${clash.name}`}.`)
      return false
    }
    await run(() =>
      saveOrganization({
        id: newOrganizationId(trimmed, taken),
        name: trimmed,
        kind: orgKind,
        ...(orgPlatform?.trim() ? { platform: orgPlatform.trim() } : {}),
      }),
    )
    return true
  }

  async function add() {
    if (await create(name, kind, platform)) {
      setName('')
      setPlatform('')
    }
  }

  function setAliases(org: Organization, text: string | undefined) {
    const list = parseNames(text).filter((n) => !sameName(n, org.name))
    if (list.join(',') === (org.aliases ?? []).join(',')) return
    const clash = list.map((n) => ({ n, o: nameInUse(n) })).find((c) => c.o && c.o.id !== org.id)
    if (clash) {
      setError(`"${clash.n}" is already a name for ${clash.o!.name}, so it cannot name ${org.name} too.`)
      return
    }
    void run(() => patchOrganization(org.id, { aliases: list.length ? list : undefined }))
  }

  function addAlias(orgId: string, alias: string) {
    const org = organizations.find((o) => o.id === orgId)
    if (org) setAliases(org, [...(org.aliases ?? []), alias].join(', '))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Organizations"
        subtitle="Who hired and paid you: an officials' association, or a direct contract — a league or tournament paying you itself, or a freelance game. Not the platform: two associations can both use Assignr."
      >
        {error ? (
          <p role="alert" className="m-0 mb-2 text-xs" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        ) : null}
        {organizations.length === 0 ? (
          <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            None yet. Add the organizations you work for below, or from the payors on your games.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {['Name', 'Also known as', 'Kind', 'Platform', 'Games', ''].map((h, i) => (
                    <th
                      key={h || i}
                      scope="col"
                      className="px-2 py-1.5 font-medium"
                      style={{
                        textAlign: i === 4 ? 'right' : 'left',
                        color: 'var(--text-secondary)',
                        borderBottom: '1px solid var(--gridline)',
                      }}
                    >
                      {h ? h : <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={org.name}
                        width={180}
                        ariaLabel={`Name of ${org.name}`}
                        onCommit={(v) => {
                          if (!v || v === org.name) return
                          const clash = nameInUse(v)
                          if (clash && clash.id !== org.id) {
                            setError(`"${v}" is already a name for ${clash.name}.`)
                            return
                          }
                          void run(() => patchOrganization(org.id, { name: v }))
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={(org.aliases ?? []).join(', ')}
                        width={240}
                        ariaLabel={`Other names for ${org.name}`}
                        onCommit={(v) => setAliases(org, v)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={org.kind}
                        onChange={(e) =>
                          void run(() => patchOrganization(org.id, { kind: e.target.value as OrganizationKind }))
                        }
                        aria-label={`Kind of ${org.name}`}
                        className="rounded-md px-1.5 py-0.5 text-xs"
                        style={selectStyle}
                      >
                        {ORGANIZATION_KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={org.platform}
                        width={90}
                        ariaLabel={`Platform ${org.name} uses`}
                        onCommit={(v) => {
                          if (v !== org.platform) void run(() => patchOrganization(org.id, { platform: v }))
                        }}
                      />
                    </td>
                    <td className="num-tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {counts.get(org.id) ?? 0}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => void run(() => deleteOrganization(org.id))}
                        aria-label={`Delete ${org.name}`}
                        className="text-xs"
                        style={{ color: 'var(--status-critical)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              A game whose payor is one of an organization's names belongs to it. Separate other names with commas;
              case is ignored. A game set by hand in Trips keeps its organization regardless. Deleting an organization
              clears it from every game and import that used it.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Name
            <TextInput value={name} onChange={setName} width={200} placeholder="Harbor Officials Group" ariaLabel="New organization name" />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as OrganizationKind)}
              aria-label="Kind of the new organization"
              className="rounded-md px-2 py-1 text-xs"
              style={selectStyle}
            >
              {ORGANIZATION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Platform (optional)
            <TextInput value={platform} onChange={setPlatform} width={110} placeholder="Assignr" ariaLabel="Platform the new organization uses" />
          </label>
          <Button onClick={() => void add()} disabled={!name.trim()}>
            Add organization
          </Button>
        </div>
      </Card>

      {unclaimed.count > 0 && (unclaimed.payors.length > 0 || organizations.length > 0) ? (
        <Card
          title={`${unclaimed.count} game${unclaimed.count === 1 ? '' : 's'} with no organization`}
          subtitle="Their payors, commonest first. A payor is often the organization itself — or a league paying you directly, which is a direct contract. Add it, or file it as another name for one you have. Games with no payor can be set on their import, under Import history."
        >
          {unclaimed.payors.length === 0 ? (
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              None of them names a payor.
            </p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <tbody>
                {unclaimed.payors.slice(0, 12).map(([payor, n]) => (
                  <tr key={payor} style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                      {payor}
                    </td>
                    <td className="num-tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
                      {n} game{n === 1 ? '' : 's'}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        <Button onClick={() => void create(payor, 'association')}>Add as association</Button>
                        <Button onClick={() => void create(payor, 'direct')}>Add as direct contract</Button>
                        {organizations.length > 0 ? (
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) addAlias(e.target.value, payor)
                            }}
                            aria-label={`File ${payor} as another name for`}
                            className="rounded-md px-1.5 py-0.5 text-xs"
                            style={selectStyle}
                          >
                            <option value="">Another name for…</option>
                            {organizations.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {unclaimed.noPayor > 0 && unclaimed.payors.length > 0 ? (
            <p className="m-0 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {unclaimed.noPayor} more name no payor; set their organization on their import, under Import history.
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}
