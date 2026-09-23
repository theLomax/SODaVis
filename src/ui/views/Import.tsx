/**
 * Import. Four steps, each of which the user can see and correct before anything
 * is written: pick a file, confirm the profile (or map an unknown one), review the
 * reconciliation, commit.
 *
 * Nothing is written to the database until the Commit button. A conflict is shown
 * as a field-level diff first, because the stored value may be the corrected one.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { Card, StatTile, StatusChip } from '../components/Tiles'
import { parseDelimited, readFileAsText, type ParsedFile } from '../../import/parse'
import { CONFIDENT_THRESHOLD, detectProfile, suggestFieldMap, type DetectionCandidate } from '../../import/detect'
import { mapRows, type MapResult } from '../../import/map'
import { reconcile, resolveToIncoming, type Reconciliation } from '../../import/reconcile'
import { BUILT_IN_PROFILES, genericProfile, type SourceProfile } from '../../import/profiles'
import { CANONICAL_FIELDS, type CanonicalField } from '../../model/game'
import { commitImport, saveCustomProfile, seedDurations, undoImport } from '../../db/repo'
import { seedAgeGroupDurations } from '../../derive/resolve'
import { formatMoney } from '../../derive/money'

type Stage =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      fileName: string
      parsed: ParsedFile
      candidates: DetectionCandidate[]
      profile: SourceProfile
      mapped: MapResult
      recon: Reconciliation
    }

export function ImportView() {
  const { derived, reload, snapshot } = useImportContext()
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [acceptConflicts, setAcceptConflicts] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const profiles = useMemo(
    () => [...BUILT_IN_PROFILES, ...(snapshot?.customProfiles ?? [])],
    [snapshot],
  )

  const analyze = useCallback(
    (fileName: string, text: string, profile?: SourceProfile) => {
      const parsed = parseDelimited(text)
      if (parsed.headers.length === 0) {
        setStage({ kind: 'error', message: 'That file has no readable header row.' })
        return
      }

      const candidates = detectProfile(parsed.headers, profiles)
      const chosen =
        profile ??
        (candidates[0] && candidates[0].confidence >= CONFIDENT_THRESHOLD
          ? candidates[0].profile
          : genericProfile)

      const mapped = mapRows(parsed.rows, {
        profile: chosen,
        identity: snapshot?.identity ?? { id: 'self', patterns: [], displayName: 'Me' },
        importId: 'pending',
        importedAt: new Date().toISOString(),
        headers: parsed.headers,
        currency: snapshot?.settings.currency ?? 'USD',
      })

      const recon = reconcile(snapshot?.games ?? [], mapped.games)
      setStage({ kind: 'ready', fileName, parsed, candidates, profile: chosen, mapped, recon })
      setResult(null)
    },
    [profiles, snapshot],
  )

  const onFile = useCallback(
    async (file: File) => {
      try {
        const text = await readFileAsText(file)
        analyze(file.name, text)
      } catch (e) {
        setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    },
    [analyze],
  )

  async function commit() {
    if (stage.kind !== 'ready') return
    setBusy(true)
    try {
      const updates = acceptConflicts
        ? stage.recon.conflicts.map((c) => resolveToIncoming(c.stored, c.incoming))
        : []

      const run = await commitImport({
        inserts: stage.recon.inserts,
        updates,
        unchangedCount: stage.recon.unchanged.length,
        conflictCount: stage.recon.conflicts.length,
        fileName: stage.fileName,
        profileId: stage.profile.id,
        profileLabel: stage.profile.label,
        rowsInFile: stage.parsed.rows.length,
        rowsSkipped: stage.mapped.nonDataRows + stage.mapped.skipped.length,
      })

      // Seed age-group durations from whatever the new rows state, without
      // disturbing any the user has entered by hand.
      const { seeded } = seedAgeGroupDurations(stage.recon.inserts)
      const added = await seedDurations(seeded)

      await reload()
      setResult(
        `Imported ${run.counts.inserted} new games, updated ${run.counts.updated}, left ${run.counts.unchanged} unchanged. ` +
          `Seeded ${added} age-group durations.`,
      )
      setStage({ kind: 'idle' })
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Import a game export"
        subtitle="CSV from Assignr, RefTown, or any source you can map. Nothing leaves this machine."
      >
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) void onFile(file)
          }}
          className="flex flex-col items-center gap-3 rounded-lg p-8 text-center"
          style={{ border: '1px dashed var(--baseline)' }}
        >
          <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Drop a CSV here, or
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
            }}
            className="text-xs"
            style={{ color: 'var(--text-secondary)' }}
          />
        </div>
        {result ? (
          <p className="m-0 mt-3 text-xs" style={{ color: 'var(--delta-good)' }}>
            {result}
          </p>
        ) : null}
      </Card>

      {stage.kind === 'error' ? (
        <Card title="Import failed">
          <p className="m-0 text-sm" style={{ color: 'var(--status-critical)' }}>
            {stage.message}
          </p>
        </Card>
      ) : null}

      {stage.kind === 'ready' ? (
        <>
          <ProfileStep
            stage={stage}
            profiles={profiles}
            onChoose={(profile) => {
              // Re-analyzing from the parsed text keeps every step consistent.
              const text = rebuildCsv(stage.parsed)
              analyze(stage.fileName, text, profile)
            }}
            onSavedProfile={reload}
          />
          <ReconStep
            stage={stage}
            acceptConflicts={acceptConflicts}
            setAcceptConflicts={setAcceptConflicts}
            currency={snapshot?.settings.currency ?? 'USD'}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => void commit()} disabled={busy}>
              {busy
                ? 'Importing…'
                : `Commit ${stage.recon.inserts.length} new${
                    acceptConflicts && stage.recon.conflicts.length
                      ? ` and ${stage.recon.conflicts.length} changed`
                      : ''
                  }`}
            </Button>
            <Button onClick={() => setStage({ kind: 'idle' })}>Cancel</Button>
          </div>
        </>
      ) : null}

      <ImportLog onUndone={reload} />

      {derived && derived.snapshot.games.length > 0 ? (
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          {derived.snapshot.games.length} games stored. Re-importing the same file is safe — it
          inserts nothing and keeps every manual note attached.
        </p>
      ) : null}
    </div>
  )
}

/** Reassembles a CSV from the parsed table so a profile change can be re-run. */
function rebuildCsv(parsed: ParsedFile): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [parsed.headers.map(esc).join(',')]
  for (const row of parsed.rows) {
    lines.push(parsed.headers.map((h) => esc(row[h] ?? '')).join(','))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Step: profile detection & mapping
// ---------------------------------------------------------------------------

function ProfileStep({
  stage,
  profiles,
  onChoose,
  onSavedProfile,
}: {
  stage: Extract<Stage, { kind: 'ready' }>
  profiles: SourceProfile[]
  onChoose: (p: SourceProfile) => void
  onSavedProfile: () => Promise<void>
}) {
  const best = stage.candidates[0]
  const isGeneric = stage.profile.id === 'generic'
  const [showMapper, setShowMapper] = useState(isGeneric)

  return (
    <Card
      title="Source profile"
      subtitle={`${stage.parsed.headers.length} columns, ${stage.parsed.rows.length} rows in ${stage.fileName}`}
      action={
        <select
          value={stage.profile.id}
          onChange={(e) => {
            const next = [...profiles, genericProfile].find((p) => p.id === e.target.value)
            if (next) onChoose(next)
          }}
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
          aria-label="Source profile"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="generic">Unrecognized — map manually</option>
        </select>
      }
    >
      <div className="flex flex-col gap-3">
        {best ? (
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Best match: {best.profile.label} at {Math.round(best.confidence * 100)}% confidence
            {best.missingHeaders.length
              ? ` — missing ${best.missingHeaders.length} expected column${best.missingHeaders.length === 1 ? '' : 's'}`
              : ''}
            .
          </p>
        ) : (
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            No known profile matched this header set. Map the columns below and save it as a reusable
            profile.
          </p>
        )}

        {Object.keys(stage.parsed.fieldCounts).length > 1 ? (
          <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            Rows are ragged ({Object.entries(stage.parsed.fieldCounts)
              .map(([n, c]) => `${c}×${n} fields`)
              .join(', ')}), which is expected for solo assignments and is handled.
          </p>
        ) : null}

        <div>
          <Button onClick={() => setShowMapper((v) => !v)}>
            {showMapper ? 'Hide column mapping' : 'Review column mapping'}
          </Button>
        </div>

        {showMapper ? (
          <ColumnMapper stage={stage} onChoose={onChoose} onSavedProfile={onSavedProfile} />
        ) : null}
      </div>
    </Card>
  )
}

function ColumnMapper({
  stage,
  onChoose,
  onSavedProfile,
}: {
  stage: Extract<Stage, { kind: 'ready' }>
  onChoose: (p: SourceProfile) => void
  onSavedProfile: () => Promise<void>
}) {
  const suggestions = useMemo(() => suggestFieldMap(stage.parsed.headers), [stage.parsed.headers])

  const [map, setMap] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of CANONICAL_FIELDS) {
      const existing = stage.profile.fieldMap[field]
      const header = Array.isArray(existing) ? existing[0] : existing
      initial[field] =
        (header && stage.parsed.headers.includes(header) ? header : undefined) ??
        suggestions.find((s) => s.field === field)?.header ??
        ''
    }
    return initial
  })

  const [profileName, setProfileName] = useState('')
  const [saving, setSaving] = useState(false)

  function buildProfile(id: string, label: string): SourceProfile {
    const fieldMap: Partial<Record<CanonicalField, string>> = {}
    for (const field of CANONICAL_FIELDS) {
      if (map[field]) fieldMap[field] = map[field]!
    }
    const dateColumn = map['date']
    return {
      id,
      label,
      fingerprint: stage.parsed.headers,
      fieldMap,
      statusVocabulary: genericProfile.statusVocabulary,
      officialColumns: 'auto',
      dedupe: map['sourceId']
        ? { strategy: 'natural', column: map['sourceId']! }
        : { strategy: 'fingerprint', columns: ['date', 'startTime', 'venueRaw', 'ageGroupRaw'] },
      isDataRow: (row) => {
        if (dateColumn && !(row[dateColumn] ?? '').trim()) return false
        // A totals trailer repeats the word 'total' in some cell.
        return !Object.values(row).some((v) => /^totals?:?$/i.test((v ?? '').trim()))
      },
      isCustom: true,
    }
  }

  async function save() {
    const name = profileName.trim()
    if (!name) return
    setSaving(true)
    try {
      const id = `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      const profile = buildProfile(id, name)
      const required = map['date'] ? [map['date']!] : []
      await saveCustomProfile(profile, required)
      await onSavedProfile()
      onChoose(profile)
    } finally {
      setSaving(false)
    }
  }

  const required: CanonicalField[] = ['date', 'startTime', 'venueRaw', 'ageGroupRaw', 'status', 'feeActual']

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {CANONICAL_FIELDS.map((field) => {
          const suggestion = suggestions.find((s) => s.field === field)
          const isRequired = required.includes(field)
          return (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: isRequired ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {field}
                {isRequired ? ' *' : ''}
              </span>
              <select
                value={map[field] ?? ''}
                onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}
                className="rounded-md px-2 py-1 text-xs"
                style={selectStyle}
              >
                <option value="">— not mapped —</option>
                {stage.parsed.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              {suggestion && suggestion.header && suggestion.score < 1 ? (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  suggested: {suggestion.header}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Save as profile
          </span>
          <TextInput value={profileName} onChange={setProfileName} placeholder="e.g. RefTown export" width={200} />
        </label>
        <Button onClick={() => void save()} disabled={!profileName.trim() || saving}>
          {saving ? 'Saving…' : 'Save & apply'}
        </Button>
        <Button onClick={() => onChoose(buildProfile('generic', 'Ad-hoc mapping'))}>Apply without saving</Button>
      </div>
      <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
        Position and Official columns are discovered automatically by pattern, so a 3- or 4-official
        crew needs no mapping here.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step: reconciliation
// ---------------------------------------------------------------------------

function ReconStep({
  stage,
  acceptConflicts,
  setAcceptConflicts,
  currency,
}: {
  stage: Extract<Stage, { kind: 'ready' }>
  acceptConflicts: boolean
  setAcceptConflicts: (v: boolean) => void
  currency: string
}) {
  const { recon, mapped } = stage
  const gross = mapped.games.reduce((s, g) => s + (g.fees.actual ?? 0), 0)
  const flagged = mapped.games.filter((g) => g.flags.length > 0)

  return (
    <Card title="Review before writing" subtitle="Nothing is saved until you commit">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="New games" value={String(recon.inserts.length)} />
        <StatTile label="Unchanged" value={String(recon.unchanged.length)} detail="skipped" />
        <StatTile
          label="Conflicts"
          value={String(recon.conflicts.length)}
          detail="a stored value differs from the file"
          {...(recon.conflicts.length
            ? { status: { role: 'warning' as const, label: 'Needs a decision' } }
            : {})}
        />
        <StatTile
          label="Rows skipped"
          value={String(mapped.nonDataRows + mapped.skipped.length)}
          detail="blank rows and totals trailers"
        />
      </div>

      <p className="m-0 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {mapped.games.length} games parsed, {formatMoney(gross, currency)} in actual fees.
        {flagged.length ? ` ${flagged.length} carry a data-quality flag.` : ''}
        {recon.absentFromFile.length
          ? ` ${recon.absentFromFile.length} stored games are not in this file; they are left untouched, because a narrower date range is not a deletion.`
          : ''}
      </p>

      {mapped.skipped.length > 0 ? (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
          {mapped.skipped.slice(0, 5).map((s, i) => (
            <li key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {s.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {recon.conflicts.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
            <input
              type="checkbox"
              checked={acceptConflicts}
              onChange={(e) => setAcceptConflicts(e.target.checked)}
            />
            Accept the file's values for all {recon.conflicts.length} conflicts
          </label>
          <div className="overflow-auto" style={{ maxHeight: 360 }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {['Game', 'Field', 'Stored', 'In file'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="sticky top-0 px-2 py-1.5 text-left font-medium"
                      style={{
                        color: 'var(--text-secondary)',
                        background: 'var(--surface-1)',
                        borderBottom: '1px solid var(--gridline)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recon.conflicts.flatMap((c) =>
                  c.diffs.map((d, i) => (
                    <tr key={`${c.stored.id}-${d.field}`} style={{ borderBottom: '1px solid var(--gridline)' }}>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {i === 0 ? `${c.stored.date} ${c.stored.venueRaw}` : ''}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                        {d.field}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {d.stored}
                      </td>
                      <td className="px-2 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {d.incoming}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Import log
// ---------------------------------------------------------------------------

function ImportLog({ onUndone }: { onUndone: () => Promise<void> }) {
  const { snapshot } = useImportContext()
  const [busy, setBusy] = useState<string | null>(null)

  const imports = snapshot?.imports ?? []
  if (imports.length === 0) return null

  async function undo(id: string) {
    setBusy(id)
    try {
      await undoImport(id)
      await onUndone()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title="Import history" subtitle="Each run can be undone; annotations are never part of an import">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {['When', 'File', 'Profile', 'New', 'Updated', 'Unchanged', ''].map((h, i) => (
              <th
                key={h || `sp-${i}`}
                scope="col"
                className="px-2 py-1.5 font-medium"
                style={{
                  textAlign: i >= 3 && i <= 5 ? 'right' : 'left',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--gridline)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {imports.map((run) => (
            <tr key={run.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
              <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                {new Date(run.importedAt).toLocaleString()}
              </td>
              <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                {run.fileName}
              </td>
              <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                {run.profileLabel}
              </td>
              <td className="num-tabular px-2 py-1.5 text-right">{run.counts.inserted}</td>
              <td className="num-tabular px-2 py-1.5 text-right">{run.counts.updated}</td>
              <td className="num-tabular px-2 py-1.5 text-right">{run.counts.unchanged}</td>
              <td className="px-2 py-1.5 text-right">
                <Button variant="danger" onClick={() => void undo(run.id)} disabled={busy === run.id}>
                  {busy === run.id ? 'Undoing…' : 'Undo'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/** Convenience wrapper so the import view can reach the snapshot directly. */
function useImportContext() {
  const store = useStore()
  return { derived: store.derived, reload: store.reload, snapshot: store.derived?.snapshot ?? null }
}

export { StatusChip }
