/**
 * Shared inline editors used by the parks, durations, sports and settings tabs.
 *
 * The seeded city is only ever a guess from the park's name, so it has to be
 * correctable in the app: seeding is skipped once the parks table exists, and a
 * fix in source would never reach an installed copy.
 */

import { useState } from 'react'
import { selectStyle } from '../../components/Controls'

export function TextCell({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string | undefined
  onCommit: (v: string | undefined) => void
  ariaLabel: string
}) {
  const [text, setText] = useState(value ?? '')
  return (
    <input
      type="text"
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text.trim() || undefined)}
      className="w-28 rounded-md px-1.5 py-0.5 text-xs"
      style={selectStyle}
    />
  )
}

export function NumberCell({
  value,
  onCommit,
  step,
  ariaLabel,
}: {
  value: number | undefined
  onCommit: (v: number | undefined) => void
  step?: string
  ariaLabel: string
}) {
  const [text, setText] = useState(value?.toString() ?? '')
  return (
    <input
      type="number"
      {...(step ? { step } : {})}
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text)
        onCommit(text.trim() && Number.isFinite(n) ? n : undefined)
      }}
      className="num-tabular w-20 rounded-md px-1.5 py-0.5 text-right text-xs"
      style={selectStyle}
    />
  )
}
