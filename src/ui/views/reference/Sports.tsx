/**
 * Sports, positions and gear. Prep and wrap are charged once per trip.
 */

import { useStore } from '../../store'
import { selectStyle } from '../../components/Controls'
import { Card } from '../../components/Tiles'
import { saveGearLevels, saveGearModifiers, saveSports } from '../../../db/repo'
import { NumberCell } from './cells'
import { isTrackedSport, orderSportCodes } from '../../../model/reference'

export function SportsEditor() {
  const { derived, reload } = useStore()
  if (!derived) return null
  const { gearLevels, gearModifiers } = derived.snapshot
  // Canonical order, not storage order, so the list reads the same every visit.
  const sports = orderSportCodes(derived.snapshot.sports.map((s) => s.code)).map(
    (code) => derived.snapshot.sports.find((s) => s.code === code)!,
  )

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Sports"
        subtitle="Tick the sports you officiate. Only those appear in filters, charts and pickers, and games in any other sport are left out of the dashboard (the Tax view still counts them). Prep and wrap are charged once per trip; the arrival floor in Settings is a minimum on prep."
      >
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Track', 'Code', 'Label', 'Prep min', 'Wrap min', 'Default gear'].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className="px-2 py-1.5 font-medium"
                  style={{
                    textAlign: i === 3 || i === 4 ? 'right' : 'left',
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
            {sports.map((sport) => (
              <tr
                key={sport.code}
                style={{ borderBottom: '1px solid var(--gridline)', opacity: isTrackedSport(sport) ? 1 : 0.55 }}
              >
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={isTrackedSport(sport)}
                    onChange={async (e) => {
                      await saveSports([{ ...sport, tracked: e.target.checked }])
                      await reload()
                    }}
                    aria-label={`Track ${sport.label}`}
                  />
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {sport.code}
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {sport.label}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={sport.prepMinutes}
                    ariaLabel={`Prep minutes for ${sport.label}`}
                    onCommit={async (v) => {
                      await saveSports([{ ...sport, prepMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={sport.wrapMinutes}
                    ariaLabel={`Wrap minutes for ${sport.label}`}
                    onCommit={async (v) => {
                      await saveSports([{ ...sport, wrapMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={sport.defaultGearLevel ?? ''}
                    onChange={async (e) => {
                      // "None" stores no default, rather than an empty string.
                      const { defaultGearLevel: _old, ...rest } = sport
                      void _old
                      const level = e.target.value as NonNullable<typeof sport.defaultGearLevel> | ''
                      await saveSports([level ? { ...rest, defaultGearLevel: level } : rest])
                      await reload()
                    }}
                    className="rounded-md px-2 py-1 text-xs"
                    style={selectStyle}
                    aria-label={`Default gear for ${sport.label}`}
                  >
                    <option value="">None</option>
                    {gearLevels.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Positions"
        subtitle="The position itself, independent of what it takes to dress for it — that is below"
      >
        <table className="w-full border-collapse text-xs">
          <tbody>
            {gearLevels.map((level) => (
              <tr key={level.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {level.label}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={level.prepDeltaMinutes}
                    ariaLabel={`Prep delta for ${level.label}`}
                    onCommit={async (v) => {
                      await saveGearLevels([{ ...level, prepDeltaMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  minutes added for the position itself
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Conditions are a second, independent axis: the role says what was worked,
          these say what it took to be ready for it. They stack, so a cold, wet
          plate game carries all three deltas. */}
      <Card
        title="Gear"
        subtitle="What was worn, independent of the position. Full gear is assumed at the plate, and available at the bases — some two-umpire games put the base umpire in it too."
      >
        <table className="w-full border-collapse text-xs">
          <tbody>
            {gearModifiers.map((mod) => (
              <tr key={mod.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {mod.label}
                  {mod.plateOnly ? (
                    <span style={{ color: 'var(--text-muted)' }}> · plate only</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={mod.prepDeltaMinutes}
                    ariaLabel={`Prep delta for ${mod.label}`}
                    onCommit={async (v) => {
                      await saveGearModifiers([{ ...mod, prepDeltaMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  {mod.hint}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
