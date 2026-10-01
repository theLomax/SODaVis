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
import { parseDelimited, type ParsedFile } from '../../import/parse'
import { isExcelData, parseWorkbook } from '../../import/excel'
import { CONFIDENT_THRESHOLD, detectProfile, suggestFieldMap, type DetectionCandidate } from '../../import/detect'
import { feesNotInSource, mapRows, type MapResult } from '../../import/map'
import { reconcile, resolveToIncoming, type Reconciliation } from '../../import/reconcile'
import {
  BUILT_IN_PROFILES,
  genericProfile,
  type ImportFileType,
  type SourceProfile,
} from '../../import/profiles'
import { CANONICAL_FIELDS, type CanonicalField } from '../../model/game'
import {
  commitImport,
  saveOrganization,
  setImportOrganization,
  saveCustomProfile,
  seedDurations,
  undoBlockers,
  undoImport,
} from '../../db/repo'
import type { ImportRun } from '../../model/game'
import {
  DIRECT_CONTRACT_NAME,
  planImportOrganization,
  type ImportOrganizationChoice,
} from '../../model/organizations'
import { Dialog } from '../components/Dialog'
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
  /** Who this file's games were for. "Later" still leaves every game with one; see `planImportOrganization`. */
  const [organization, setOrganization] = useState<ImportOrganizationChoice>({ kind: 'later' })
  const inputRef = useRef<HTMLInputElement>(null)

  const profiles = useMemo(
    () => [...BUILT_IN_PROFILES, ...(snapshot?.customProfiles ?? [])],
    [snapshot],
  )

  /** The format picked above the drop zone: auto-detect, a profile id, or the mapper. */
  const [format, setFormat] = useState<string>('auto')
  const pickedProfile =
    format === 'auto' ? undefined : format === 'generic' ? genericProfile : profiles.find((p) => p.id === format)

  const analyze = useCallback(
    (fileName: string, parsed: ParsedFile, profile?: SourceProfile) => {
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
        analyze(file.name, await readImportFile(file), pickedProfile)
      } catch (e) {
        setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    },
    [analyze, pickedProfile],
  )

  async function commit() {
    if (stage.kind !== 'ready') return
    setBusy(true)
    try {
      const updates = acceptConflicts
        ? stage.recon.conflicts.map((c) => resolveToIncoming(c.stored, c.incoming))
        : []

      // Create the organization first if the choice needs one, so the run can name it.
      const plan = planImportOrganization(
        organization,
        stage.mapped.games.map((g) => g.payor),
        snapshot?.organizations ?? [],
      )
      if (plan.create) await saveOrganization(plan.create)

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
        ...(plan.organizationId ? { organizationId: plan.organizationId } : {}),
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
        subtitle="A CSV or Excel export from Assignr, RefTown, or any source you can map. Nothing leaves this machine."
      >
        <FormatPicker
          format={format}
          setFormat={(next) => {
            setFormat(next)
            // A file already under review is re-read under the new format, so a
            // wrong first pick needs no second trip to the file dialog.
            if (stage.kind === 'ready') {
              const profile =
                next === 'auto' ? undefined : next === 'generic' ? genericProfile : profiles.find((p) => p.id === next)
              analyze(stage.fileName, stage.parsed, profile)
            }
          }}
          profiles={profiles}
          picked={pickedProfile}
        />
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
            Drop the file here, or
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={acceptFor(pickedProfile?.fileTypes)}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
              // Cleared at once, so picking the same file again — after Cancel, or
              // after changing the format — is still a change the browser reports.
              e.target.value = ''
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
              // Re-running from the parsed rows keeps every step consistent, and
              // works for a spreadsheet, which has no text to re-read.
              analyze(stage.fileName, stage.parsed, profile)
            }}
            onSavedProfile={reload}
          />
          <ReconStep
            stage={stage}
            acceptConflicts={acceptConflicts}
            setAcceptConflicts={setAcceptConflicts}
            currency={snapshot?.settings.currency ?? 'USD'}
          />
          <OrganizationChoice
            value={organization}
            onChange={setOrganization}
            payors={stage.mapped.games.map((g) => g.payor)}
          />
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={() => void commit()}
              disabled={busy || (organization.kind === 'new' && !organization.name.trim())}
            >
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

/**
 * Reads a picked file as a table. Excel is told apart by its first bytes, not its
 * name, so a renamed or extension-less download still reads.
 */
async function readImportFile(file: File): Promise<ParsedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isExcelData(bytes)) return parseWorkbook(bytes)
  const text = new TextDecoder().decode(bytes)
  // Strip a UTF-8 BOM; it would otherwise poison the first header name.
  return parseDelimited(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}

const ACCEPT: Record<ImportFileType, string> = {
  csv: '.csv,.tsv,.txt,text/csv',
  excel:
    '.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** The file dialog's filter: a format's own types, or everything readable. */
function acceptFor(types: ImportFileType[] | undefined): string {
  return (types?.length ? types : (['csv', 'excel'] as const)).map((t) => ACCEPT[t]).join(',')
}

// ---------------------------------------------------------------------------
// Format picker
// ---------------------------------------------------------------------------

/**
 * Chosen before the file, so the file dialog can offer the right kind and the
 * steps for getting it out of the platform are on screen when they are needed.
 * Auto-detect stays the default: it is right for any file a format already knows.
 */
function FormatPicker({
  format,
  setFormat,
  profiles,
  picked,
}: {
  format: string
  setFormat: (f: string) => void
  profiles: SourceProfile[]
  picked: SourceProfile | undefined
}) {
  const platforms = profiles.filter((p) => !p.isCustom)
  const custom = profiles.filter((p) => p.isCustom)
  return (
    <div className="mb-3 flex flex-col gap-2">
      <label className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        Format
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          aria-label="Import format"
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
        >
          <option value="auto">Auto-detect from the file</option>
          <optgroup label="Platforms">
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          {custom.length ? (
            <optgroup label="My formats">
              {custom.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="generic">Another platform — map the columns</option>
        </select>
      </label>
      {picked?.exportSteps?.length ? (
        <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {picked.exportSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : format === 'generic' ? (
        <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Export your games as CSV or Excel, then match its columns to the app's fields. Save the
          mapping and it appears under My formats next time.
        </p>
      ) : null}
    </div>
  )
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

        {/* A format picked by hand can be the wrong one; say so rather than let
            every column map to nothing. */}
        {best && best.confidence >= CONFIDENT_THRESHOLD && best.profile.id !== stage.profile.id ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusChip role="warning" label={`This file looks like ${best.profile.label}`} />
            <Button onClick={() => onChoose(best.profile)}>Use that format</Button>
          </div>
        ) : null}

        {stage.mapped.games.length > 0 && feesNotInSource({ headers: stage.parsed.headers, profile: stage.profile }) ? (
          <div className="flex flex-col gap-1 text-xs">
            <StatusChip role="warning" label="No pay in this file" />
            <p className="m-0" style={{ color: 'var(--text-secondary)' }}>
              It has no fee columns, so these games import with pay unknown rather than $0, and raise no
              fee warnings. Until pay can be added, their time still counts but their income does not,
              so income and $/hr read low.
            </p>
          </div>
        ) : null}

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
  const [confirming, setConfirming] = useState<ImportRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const imports = snapshot?.imports ?? []
  const organizations = [...(snapshot?.organizations ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  if (imports.length === 0) return null

  async function setOrganization(run: ImportRun, organizationId: string | undefined) {
    setError(null)
    try {
      await setImportOrganization(run.id, organizationId)
      await onUndone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function undo(run: ImportRun) {
    setConfirming(null)
    setBusy(run.id)
    setError(null)
    try {
      await undoImport(run.id)
      await onUndone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title="Import history"
      subtitle="A run can be undone until a later run changes the same games; annotations are never part of an import"
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {['When', 'File', 'Profile', 'Organization', 'New', 'Updated', 'Unchanged', ''].map((h, i) => (
              <th
                key={h || `sp-${i}`}
                scope="col"
                className="px-2 py-1.5 font-medium"
                style={{
                  textAlign: i >= 4 && i <= 6 ? 'right' : 'left',
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
          {imports.map((run) => {
            const blockers = undoBlockers(run.id, imports)
            // Named in full, since the row a reader must undo first is otherwise
            // indistinguishable from this one when the same file was imported twice.
            const blockedBy = blockers.length
              ? `A later import changed these games. Undo ${blockers
                  .map((b) => `${b.fileName} (${new Date(b.importedAt).toLocaleString()})`)
                  .join(', ')} first.`
              : undefined
            return (
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
                <td className="px-2 py-1.5">
                  {/* Changeable after the fact, which is how games imported before
                      organizations existed get one without a re-import. */}
                  <select
                    value={run.organizationId ?? ''}
                    onChange={(e) => void setOrganization(run, e.target.value || undefined)}
                    aria-label={`Organization for ${run.fileName}, imported ${new Date(run.importedAt).toLocaleString()}`}
                    className="rounded-md px-1.5 py-0.5 text-xs"
                    style={selectStyle}
                  >
                    <option value="">From each game's payor</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num-tabular px-2 py-1.5 text-right">{run.counts.inserted}</td>
                <td className="num-tabular px-2 py-1.5 text-right">{run.counts.updated}</td>
                <td className="num-tabular px-2 py-1.5 text-right">{run.counts.unchanged}</td>
                <td className="px-2 py-1.5 text-right">
                  <Button
                    variant="danger"
                    onClick={() => setConfirming(run)}
                    disabled={busy === run.id || blockers.length > 0}
                  >
                    {busy === run.id ? 'Undoing…' : 'Undo'}
                  </Button>
                  {blockedBy ? (
                    <span
                      className="mt-1 block max-w-64 text-left text-xs"
                      style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}
                    >
                      {blockedBy}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {error ? (
        <p role="alert" className="m-0 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {error}
        </p>
      ) : null}

      {confirming ? (
        <Dialog
          open
          onClose={() => setConfirming(null)}
          title={`Undo the import of ${confirming.fileName}?`}
          subtitle={`Imported ${new Date(confirming.importedAt).toLocaleString()}`}
          labelledBy="undo-import-heading"
          footer={
            <>
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void undo(confirming)}>
                Undo this import
              </Button>
            </>
          }
        >
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {confirming.insertedGameIds.length} game
            {confirming.insertedGameIds.length === 1 ? '' : 's'} this run added will be removed,
            and {confirming.replacedGames.length} game
            {confirming.replacedGames.length === 1 ? '' : 's'} it updated will go back to what they
            were before. Annotations are kept, and reattach if the games are imported again.
          </p>
        </Dialog>
      ) : null}
    </Card>
  )
}

/** Convenience wrapper so the import view can reach the snapshot directly. */
/**
 * Which organization this file's games were worked for. Optional: a file that
 * mixes organizations is better left to each game's payor, and it can be set later
 * from the import history.
 */
function OrganizationChoice({
  value,
  onChange,
  payors,
}: {
  value: ImportOrganizationChoice
  onChange: (choice: ImportOrganizationChoice) => void
  payors: (string | undefined)[]
}) {
  const { snapshot } = useImportContext()
  const organizations = [...(snapshot?.organizations ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  // What "decide later" would do with this file, said before it happens.
  const later = planImportOrganization({ kind: 'later' }, payors, organizations)
  const selectValue = value.kind === 'existing' ? `org:${value.id}` : value.kind

  return (
    <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <label className="flex flex-wrap items-center gap-2">
        Organization for these games
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value
            if (v.startsWith('org:')) onChange({ kind: 'existing', id: v.slice(4) })
            else if (v === 'new') onChange({ kind: 'new', name: '' })
            else if (v === 'direct') onChange({ kind: 'direct' })
            else onChange({ kind: 'later' })
          }}
          aria-label="Organization for the games in this file"
          className="rounded-md px-2 py-1 text-xs"
          style={selectStyle}
        >
          <option value="later">Decide later</option>
          {organizations.length ? (
            <optgroup label="Your organizations">
              {organizations.map((o) => (
                <option key={o.id} value={`org:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="direct">{DIRECT_CONTRACT_NAME} (freelance)</option>
          <option value="new">+ Add new organization…</option>
        </select>
        {value.kind === 'new' ? (
          <TextInput
            value={value.name}
            onChange={(name) => onChange({ kind: 'new', name })}
            width={200}
            placeholder="Organization name"
            ariaLabel="Name of the new organization"
          />
        ) : null}
      </label>
      <span style={{ color: 'var(--text-muted)' }}>
        {value.kind === 'later'
          ? later.create
            ? `These games will be filed under a placeholder, "${later.create.name}", to rename under Reference data → Organizations.`
            : 'Every game’s payor already names one of your organizations, so none is needed.'
          : value.kind === 'new' && !value.name.trim()
            ? 'Type a name for the new organization.'
            : 'A game set by hand, or whose payor names an organization, keeps its own.'}
      </span>
    </div>
  )
}

function useImportContext() {
  const store = useStore()
  return { derived: store.derived, reload: store.reload, snapshot: store.derived?.snapshot ?? null }
}

export { StatusChip }
