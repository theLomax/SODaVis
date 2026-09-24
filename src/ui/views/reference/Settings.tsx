/**
 * Settings: home origin, arrival floor, time model, appearance, rush hour,
 * and IRS mileage rates.
 */

import { useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput, selectStyle } from '../../components/Controls'
import { Card } from '../../components/Tiles'
import { saveSettings } from '../../../db/repo'
import { minutesToTime, timeToMinutes } from '../../../import/transforms'
import { NumberCell } from './cells'

/** Indexed 0 = Monday, matching `RushHourWindow.weekdays`. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * What the window currently costs, in legs rather than trips — a trip can be in
 * traffic one way, both, or neither. Shown beside the control because the setting
 * changes computed figures without changing any data, so its effect is otherwise
 * invisible until someone opens a trip.
 */
function RushHourEffect() {
  const { derived } = useStore()
  if (!derived) return null

  const trips = derived.trips
  const out = trips.filter((t) => t.outboundInRush).length
  const home = trips.filter((t) => t.returnInRush).length
  const both = trips.filter((t) => t.outboundInRush && t.returnInRush).length
  // A park with no rush figure uses its ideal one both ways, so a leg in the
  // window only costs anything once that figure exists.
  const applied = trips.filter((t) => t.driveMinutesSource === 'park-rush').length

  if (trips.length === 0) return null

  return (
    <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
      In the current range: {out} trip{out === 1 ? '' : 's'} drive out through it,{' '}
      {home} drive home through it
      {both > 0 ? `, ${both} both ways` : ''}.{' '}
      {applied === 0
        ? 'No park has a rush-hour figure yet, so this changes nothing until one is entered in Parks & mileage.'
        : `${applied} trip${applied === 1 ? '' : 's'} currently use a park's rush-hour figure.`}
    </p>
  )
}

export function SettingsEditor() {
  const { derived, reload, theme, setTheme } = useStore()
  const [busy, setBusy] = useState(false)
  const [rateYear, setRateYear] = useState('')
  const [rateValue, setRateValue] = useState('')

  if (!derived) return null
  const s = derived.snapshot.settings

  async function patch(next: Partial<typeof s>) {
    setBusy(true)
    try {
      await saveSettings({ ...s, ...next })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Home origin label
            </span>
            <TextInput
              value={s.homeOriginLabel}
              onChange={(v) => void patch({ homeOriginLabel: v })}
              width={200}
              ariaLabel="Home origin label"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Fallback speed for drive-time estimates (mph)
            </span>
            <NumberCell value={s.fallbackMph} onCommit={(v) => void patch({ fallbackMph: v ?? 35 })} ariaLabel="Fallback mph" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Arrival floor before first pitch (minutes)
            </span>
            <NumberCell
              value={s.arrivalFloorMinutes}
              onCommit={(v) => void patch({ arrivalFloorMinutes: v ?? 15 })}
              ariaLabel="Arrival floor minutes"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Preferred time model
            </span>
            <select
              value={s.preferredTimeModel}
              onChange={(e) => void patch({ preferredTimeModel: e.target.value as typeof s.preferredTimeModel })}
              className="rounded-md px-2 py-1 text-xs"
              style={selectStyle}
            >
              <option value="game">Game time</option>
              <option value="game-drive">Game + drive</option>
              <option value="committed">Committed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Appearance
            </span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'system' | 'light' | 'dark')}
              className="rounded-md px-2 py-1 text-xs"
              style={selectStyle}
            >
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </Card>

      {/* The window is the one setting that changes a figure without changing any
          data, so it says which way each leg is affected rather than leaving the
          reader to infer it from two times and a row of day boxes. */}
      <Card
        title="Rush hour"
        subtitle="Each leg of a trip is judged on its own clock: the drive out by the first pitch, the drive home by the last out. A park's rush-hour figure is used for whichever legs land in this window."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                From
              </span>
              <input
                type="time"
                value={minutesToTime(s.rushHour.startMinutes)}
                disabled={busy}
                onChange={(e) => {
                  const m = timeToMinutes(e.target.value)
                  if (m != null) void patch({ rushHour: { ...s.rushHour, startMinutes: m } })
                }}
                aria-label="Rush hour start"
                className="rounded-md px-2 py-1 text-xs"
                style={selectStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Until
              </span>
              <input
                type="time"
                value={minutesToTime(s.rushHour.endMinutes)}
                disabled={busy}
                onChange={(e) => {
                  const m = timeToMinutes(e.target.value)
                  if (m != null) void patch({ rushHour: { ...s.rushHour, endMinutes: m } })
                }}
                aria-label="Rush hour end"
                className="rounded-md px-2 py-1 text-xs"
                style={selectStyle}
              />
            </label>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Start is included, end is not.
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Days it applies to
            </span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map((label, i) => (
                <label key={label} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={s.rushHour.weekdays.includes(i)}
                    disabled={busy}
                    onChange={(e) => {
                      const next = new Set(s.rushHour.weekdays)
                      if (e.target.checked) next.add(i)
                      else next.delete(i)
                      void patch({
                        rushHour: { ...s.rushHour, weekdays: [...next].sort((a, b) => a - b) },
                      })
                    }}
                    aria-label={`Rush hour applies on ${label}`}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <RushHourEffect />
        </div>
      </Card>

      <Card
        title="IRS standard mileage rate"
        subtitle="Set per calendar year; the tax view uses the rate for the year it is showing"
      >
        <table className="w-full border-collapse text-xs" style={{ maxWidth: 360 }}>
          <tbody>
            {Object.entries(s.irsMileageRateByYear)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([year, rate]) => (
                <tr key={year} style={{ borderBottom: '1px solid var(--gridline)' }}>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    {year}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={rate}
                      step="0.001"
                      ariaLabel={`Mileage rate for ${year}`}
                      onCommit={(v) =>
                        void patch({
                          irsMileageRateByYear: { ...s.irsMileageRateByYear, [year]: v ?? 0 },
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                    per mile
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <TextInput value={rateYear} onChange={setRateYear} placeholder="Year" width={80} ariaLabel="New rate year" />
          <TextInput value={rateValue} onChange={setRateValue} placeholder="0.700" width={90} type="number" step="0.001" ariaLabel="New rate value" />
          <Button
            disabled={!rateYear.trim() || !rateValue.trim() || busy}
            onClick={async () => {
              const n = Number(rateValue)
              if (!Number.isFinite(n)) return
              await patch({ irsMileageRateByYear: { ...s.irsMileageRateByYear, [rateYear.trim()]: n } })
              setRateYear('')
              setRateValue('')
            }}
          >
            Add year
          </Button>
        </div>
      </Card>
    </div>
  )
}
