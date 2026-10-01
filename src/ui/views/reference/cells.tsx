/**
 * Shared inline editors used by the parks, durations, sports and settings tabs.
 *
 * The seeded city is only ever a guess from the park's name, so it has to be
 * correctable in the app: seeding is skipped once the parks table exists, and a
 * fix in source would never reach an installed copy.
 */

import { useState } from 'react'
import { selectStyle } from '../../components/Controls'
import { formatMoney } from '../../../derive/money'
import { parseMoney } from '../../../import/transforms'

export function TextCell({
  value,
  onCommit,
  ariaLabel,
  width,
}: {
  value: string | undefined
  onCommit: (v: string | undefined) => void
  ariaLabel: string
  /** Pixel width, for a column whose values run longer than a park's city. */
  width?: number
}) {
  const [text, setText] = useState(value ?? '')
  return (
    <input
      type="text"
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text.trim() || undefined)}
      className={width ? 'rounded-md px-1.5 py-0.5 text-xs' : 'w-28 rounded-md px-1.5 py-0.5 text-xs'}
      style={width ? { ...selectStyle, width } : selectStyle}
    />
  )
}

/**
 * An amount of money, shown formatted in the user's currency ("$39.99") and
 * edited as a plain number: the formatting is dropped on focus and the typed text
 * read on blur. "$1,249.50" reads as 1249.5; text with no number in it is
 * treated as a slip and the field goes back to the stored amount.
 */
export function MoneyCell({
  value,
  currency,
  onCommit,
  ariaLabel,
}: {
  value: number | undefined
  currency: string
  onCommit: (v: number | undefined) => void
  ariaLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const shown = editing ? text : value == null ? '' : formatMoney(value, currency)
  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      aria-label={ariaLabel}
      onFocus={() => {
        setText(value == null ? '' : String(value))
        setEditing(true)
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (!text.trim()) return onCommit(undefined)
        const n = parseMoney(text)
        if (n != null) onCommit(Math.round(n * 100) / 100)
      }}
      className="num-tabular w-24 rounded-md px-1.5 py-0.5 text-right text-xs"
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
