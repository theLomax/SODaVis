/**
 * Backup & restore. Everything lives in this browser's IndexedDB; a JSON export
 * keeps it portable.
 */

import { useState } from 'react'
import { useStore } from '../../store'
import { Button } from '../../components/Controls'
import { Card } from '../../components/Tiles'
import { exportBackup, backupToBlob, backupFileName, restoreBackup, validateBackup } from '../../../db/backup'
import { Dialog } from '../../components/Dialog'

/** Saves the current database as a JSON file in the browser's download folder. */
async function downloadBackupFile(): Promise<{ games: number }> {
  const backup = await exportBackup()
  const url = URL.createObjectURL(backupToBlob(backup))
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName()
  a.click()
  URL.revokeObjectURL(url)
  return { games: backup.counts['games'] ?? 0 }
}

export function BackupPanel() {
  const { derived, reload } = useStore()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState<File | null>(null)

  const storedGames = derived?.snapshot.games.length ?? 0

  async function download() {
    setBusy(true)
    try {
      const { games } = await downloadBackupFile()
      setStatus(`Exported ${games} games and all reference data.`)
    } finally {
      setBusy(false)
    }
  }

  async function restore(file: File, mode: 'replace' | 'merge') {
    setBusy(true)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const validated = validateBackup(parsed)
      if (!validated.ok) {
        setStatus(`That file is not a valid backup: ${validated.errors.join('; ')}`)
        return
      }
      if (mode === 'replace') {
        // A snapshot of what is about to be wiped, so a mistaken replace is recoverable.
        await downloadBackupFile()
      }
      const report = await restoreBackup(validated.backup, mode)
      await reload()
      setStatus(
        mode === 'replace'
          ? `Replaced everything with the backup: ${report.games.inserted} games restored.`
          : `Merged: ${report.games.inserted} games added, ${report.games.skipped} already present and left alone.`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setReplacing(null)
    }
  }

  return (
    <Card
      title="Backup & restore"
      subtitle="Everything lives in this browser's IndexedDB. A JSON export keeps it portable."
    >
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="primary" onClick={() => void download()} disabled={busy}>
            Export backup JSON
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Restore from a backup file
          </span>
          <RestoreControl
            onMerge={(file) => void restore(file, 'merge')}
            onReplace={(file) => setReplacing(file)}
            busy={busy}
          />
          <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            Merge adds what is missing and never overwrites what is already here. Replace wipes
            everything first and gives you an exact copy of the backup — a copy of what is here
            now is downloaded first, so a mistaken replace can be undone.
          </p>
        </div>

        {status ? (
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {status}
          </p>
        ) : null}
      </div>

      {replacing ? (
        <Dialog
          open
          onClose={() => setReplacing(null)}
          title="Replace everything with this backup?"
          subtitle="This cannot be undone except from the backup that is about to download."
          labelledBy="replace-everything-heading"
          footer={
            <>
              <Button onClick={() => setReplacing(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void restore(replacing, 'replace')}>
                Replace everything
              </Button>
            </>
          }
        >
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {storedGames === 0
              ? 'There is nothing stored yet, so replacing is just a restore. A copy of the current (empty) state is still downloaded first.'
              : `${storedGames} game${storedGames === 1 ? '' : 's'} and all parks, identity, settings and annotations currently in this browser will be deleted. A JSON backup of them will download first.`}
          </p>
        </Dialog>
      ) : null}
    </Card>
  )
}

function RestoreControl({
  onMerge,
  onReplace,
  busy,
}: {
  onMerge: (file: File) => void
  onReplace: (file: File) => void
  busy: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        accept=".json,application/json"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-xs"
        style={{ color: 'var(--text-secondary)' }}
      />
      <Button disabled={!file || busy} onClick={() => file && onMerge(file)}>
        Merge
      </Button>
      <Button variant="danger" disabled={!file || busy} onClick={() => file && onReplace(file)}>
        Replace everything
      </Button>
    </div>
  )
}
