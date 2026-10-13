/**
 * Sports, positions and gear. Prep and wrap are charged once per trip.
 *
 * Each entry is a card whose figures are text until its Edit button unlocks it,
 * as the park cards are.
 */

import { useState } from 'react'
import { useStore } from '../../store'
import { selectStyle } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { CardField, LockableCard, toggledIn } from '../../components/LockableCard'
import { patchSport, saveGearLevels, saveGearModifiers } from '../../../db/repo'
import { NumberCell } from './cells'
import { isTrackedSport, orderSportCodes, type SportProfile } from '../../../model/reference'

const GRID = 'm-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3'

export function SportsEditor() {
  const { derived, reload } = useStore()
  /** The cards open for editing, across all three lists; ids are prefixed by list. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
  if (!derived) return null
  const { gearLevels, gearModifiers } = derived.snapshot
  // Canonical order, not storage order, so the list reads the same every visit.
  const sports = orderSportCodes(derived.snapshot.sports.map((s) => s.code)).map(
    (code) => derived.snapshot.sports.find((s) => s.code === code)!,
  )
  const lock = (id: string) => ({
    unlocked: unlocked.has(id),
    onToggle: () => setUnlocked((u) => toggledIn(u, id)),
  })

  // A patch, not the sport as rendered: prep and wrap sit side by side, and
  // tabbing between them commits both before the view reloads.
  async function patch(sport: SportProfile, change: Partial<Omit<SportProfile, 'code'>>) {
    await patchSport(sport.code, change)
    await reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Sports"
        subtitle="Track the sports you officiate. Only those appear in filters, charts and pickers, and games in any other sport are left out of the dashboard (the Tax view still counts them). Prep and wrap are charged once per trip; the arrival floor in Settings is a minimum on prep. Choose Edit on a sport to change it."
      >
        <ul className={GRID}>
          {sports.map((sport) => {
            const card = lock(`sport:${sport.code}`)
            const tracked = isTrackedSport(sport)
            const gear = gearLevels.find((g) => g.id === sport.defaultGearLevel)
            return (
              <LockableCard
                key={sport.code}
                data-sport={sport.code}
                name={sport.label}
                summary={`${sport.code}${tracked ? '' : ' · not tracked'}`}
                dimmed={!tracked}
                // A hook for styling the sports in use so they stand out.
                className={tracked ? 'sport-card sport-card--tracked' : 'sport-card'}
                {...card}
              >
                <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
                  <CardField label="Prep minutes">
                    {card.unlocked ? (
                      <NumberCell
                        value={sport.prepMinutes}
                        fill
                        ariaLabel={`Prep minutes for ${sport.label}`}
                        onCommit={(v) => {
                          if ((v ?? 0) !== sport.prepMinutes) void patch(sport, { prepMinutes: v ?? 0 })
                        }}
                      />
                    ) : (
                      sport.prepMinutes
                    )}
                  </CardField>
                  <CardField label="Wrap minutes">
                    {card.unlocked ? (
                      <NumberCell
                        value={sport.wrapMinutes}
                        fill
                        ariaLabel={`Wrap minutes for ${sport.label}`}
                        onCommit={(v) => {
                          if ((v ?? 0) !== sport.wrapMinutes) void patch(sport, { wrapMinutes: v ?? 0 })
                        }}
                      />
                    ) : (
                      sport.wrapMinutes
                    )}
                  </CardField>
                  <CardField label="Default gear">
                    {card.unlocked ? (
                      <select
                        value={sport.defaultGearLevel ?? ''}
                        // "None" stores no default, rather than an empty string.
                        onChange={(e) =>
                          void patch(sport, {
                            defaultGearLevel: (e.target.value || undefined) as SportProfile['defaultGearLevel'],
                          })
                        }
                        className="w-full rounded-md px-1.5 py-0.5 text-xs"
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
                    ) : (
                      (gear?.label ?? 'None')
                    )}
                  </CardField>
                </dl>
                {/* Pinned to the bottom of the card, so the chip sits in the same
                    corner on every card of a row whatever their heights. */}
                {card.unlocked || tracked ? (
                  <div className="mt-auto flex items-center justify-between gap-2">
                    {card.unlocked ? (
                      <label className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                        <input
                          type="checkbox"
                          checked={tracked}
                          onChange={(e) => void patch(sport, { tracked: e.target.checked })}
                          aria-label={`Track ${sport.label}`}
                        />
                        Track this sport
                      </label>
                    ) : (
                      <span />
                    )}
                    {tracked ? <StatusChip role="good" label="tracked" /> : null}
                  </div>
                ) : null}
              </LockableCard>
            )
          })}
        </ul>
      </Card>

      <Card
        title="Positions"
        subtitle="The position itself, independent of what it takes to dress for it — that is below"
      >
        <ul className={GRID}>
          {gearLevels.map((level) => {
            const card = lock(`position:${level.id}`)
            return (
              <LockableCard
                key={level.id}
                data-position={level.id}
                name={level.label}
                editLabel={`the ${level.label} position`}
                {...card}
              >
                <dl className="m-0">
                  <CardField label="Minutes added for the position itself">
                    {card.unlocked ? (
                      <NumberCell
                        value={level.prepDeltaMinutes}
                        fill
                        ariaLabel={`Prep delta for ${level.label}`}
                        onCommit={async (v) => {
                          if ((v ?? 0) === level.prepDeltaMinutes) return
                          await saveGearLevels([{ ...level, prepDeltaMinutes: v ?? 0 }])
                          await reload()
                        }}
                      />
                    ) : (
                      level.prepDeltaMinutes
                    )}
                  </CardField>
                </dl>
              </LockableCard>
            )
          })}
        </ul>
      </Card>

      {/* Conditions are a second, independent axis: the role says what was worked,
          these say what it took to be ready for it. They stack, so a cold, wet
          plate game carries all three deltas. */}
      <Card
        title="Gear"
        subtitle="What was worn, independent of the position. Full gear is assumed at the plate, and available at the bases — some two-umpire games put the base umpire in it too."
      >
        <ul className={GRID}>
          {gearModifiers.map((mod) => {
            const card = lock(`gear:${mod.id}`)
            return (
              <LockableCard
                key={mod.id}
                data-gear-condition={mod.id}
                name={mod.label}
                editLabel={`the ${mod.label} gear condition`}
                badge={mod.plateOnly ? <StatusChip role="warning" label="plate only" /> : null}
                summary={mod.hint}
                {...card}
              >
                <dl className="m-0">
                  <CardField label="Prep minutes added">
                    {card.unlocked ? (
                      <NumberCell
                        value={mod.prepDeltaMinutes}
                        fill
                        ariaLabel={`Prep delta for ${mod.label}`}
                        onCommit={async (v) => {
                          if ((v ?? 0) === mod.prepDeltaMinutes) return
                          await saveGearModifiers([{ ...mod, prepDeltaMinutes: v ?? 0 }])
                          await reload()
                        }}
                      />
                    ) : (
                      mod.prepDeltaMinutes
                    )}
                  </CardField>
                </dl>
              </LockableCard>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
