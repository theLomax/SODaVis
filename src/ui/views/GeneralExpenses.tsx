/**
 * General expenses: what the work cost that no single trip did — shoes, a uniform,
 * association dues. Entered here, beside the tax summary they feed, because that
 * is the only place they count besides net take-home. They are never in a rate.
 */

import { useState } from 'react'
import { useStore } from '../store'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { Card } from '../components/Tiles'
import { CardField, LockableCard, toggledIn } from '../components/LockableCard'
import { MoneyCell, TextCell } from './reference/cells'
import { deleteGeneralExpense, saveGeneralExpense } from '../../db/repo'
import { formatMoney } from '../../derive/money'
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type GeneralExpense,
} from '../../model/annotation'

export function GeneralExpenses({ year }: { year: number }) {
  const { derived, reload } = useStore()
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('gear')
  const [note, setNote] = useState('')
  const [deductible, setDeductible] = useState(true)
  const [sportCodes, setSportCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())

  if (!derived) return null
  const { generalExpenses, settings } = derived.snapshot
  const sports = derived.trackedSports
  const currency = settings.currency
  // Labels from every sport: an old expense may name one no longer tracked.
  const sportLabel = (code: string) => derived.snapshot.sports.find((s) => s.code === code)?.label ?? code

  const inYear = generalExpenses
    .filter((e) => e.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date))

  async function add() {
    const value = Number(amount)
    if (!date) return setError('Pick the date it was bought — it decides the tax year.')
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      return setError('Enter an amount above zero.')
    }
    const expense: GeneralExpense = {
      id: `gx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      amount: value,
      category,
      deductible,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(sportCodes.length ? { sportCodes } : {}),
    }
    await saveGeneralExpense(expense)
    setAmount('')
    setNote('')
    setSportCodes([])
    setError(null)
    await reload()
  }

  async function remove(id: string) {
    await deleteGeneralExpense(id)
    await reload()
  }

  // One field at a time from a locked-by-default card, so a whole-row save is safe.
  async function change(expense: GeneralExpense, patch: Partial<GeneralExpense>) {
    const next: Record<string, unknown> = { ...expense, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    await saveGeneralExpense(next as GeneralExpense)
    await reload()
  }

  return (
    <Card
      title="General expenses"
      subtitle="Costs tied to no single trip — shoes, uniform, dues. They count here and in net take-home, never in a per-hour rate."
    >
      {inYear.length > 0 ? (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {inYear.map((e) => {
            const open = unlocked.has(e.id)
            const what = `the ${e.category} expense of ${e.date}`
            return (
              <LockableCard
                key={e.id}
                data-general-expense={e.id}
                name={formatMoney(e.amount, currency)}
                editLabel={what}
                summary={`${e.category} · ${e.date}`}
                unlocked={open}
                onToggle={() => setUnlocked((u) => toggledIn(u, e.id))}
              >
                {open ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2" style={{ color: 'var(--text-muted)' }}>
                    <label className="flex min-w-0 flex-col gap-0.5">
                      Amount
                      <MoneyCell
                        value={e.amount}
                        currency={currency}
                        fill
                        ariaLabel={`Amount of ${what}`}
                        onCommit={(v) => {
                          if (v !== undefined && v > 0 && v !== e.amount) void change(e, { amount: v })
                        }}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-0.5">
                      Note
                      <TextCell
                        value={e.note}
                        fill
                        ariaLabel={`Note on ${what}`}
                        onCommit={(v) => {
                          if (v !== e.note) void change(e, { note: v })
                        }}
                      />
                    </label>
                  </div>
                ) : e.note ? (
                  <span className="break-words" style={{ color: 'var(--text-secondary)' }}>
                    {e.note}
                  </span>
                ) : null}
                <dl className="m-0 grid grid-cols-2 gap-x-3">
                  <CardField label="Sports">{e.sportCodes?.length ? e.sportCodes.map(sportLabel).join(', ') : 'All'}</CardField>
                  <CardField label="Deductible">
                    {open ? (
                      <input
                        type="checkbox"
                        checked={e.deductible}
                        onChange={(ev) => void change(e, { deductible: ev.target.checked })}
                        aria-label={`Whether ${what} is deductible`}
                      />
                    ) : e.deductible ? (
                      'Yes'
                    ) : (
                      'No'
                    )}
                  </CardField>
                </dl>
                {open ? (
                  <div className="flex justify-end">
                    <Button variant="danger" onClick={() => void remove(e.id)}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </LockableCard>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          None logged for {year}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Expense date"
            className="rounded-md px-2 py-1 text-xs"
            style={selectStyle}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Amount
          <TextInput value={amount} onChange={setAmount} type="number" step="0.01" width={90} ariaLabel="General expense amount" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="rounded-md px-2 py-1 text-xs"
            style={selectStyle}
            aria-label="General expense category"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Note
          <TextInput value={note} onChange={setNote} width={160} ariaLabel="General expense note" />
        </label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={deductible} onChange={(e) => setDeductible(e.target.checked)} />
          Deductible
        </label>
        <Button onClick={() => void add()} disabled={!amount.trim()}>
          Add expense
        </Button>
      </div>

      {/* Optional. Untagged is the usual case — shoes serve every sport — and it
          is what keeps the expense out of a single-sport view's take-home. */}
      <div role="group" aria-label="Sports this was for" className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span style={{ color: 'var(--text-muted)' }}>For (optional)</span>
        {sports.map((s) => {
          const on = sportCodes.includes(s.code)
          return (
            <button
              key={s.code}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setSportCodes(on ? sportCodes.filter((c) => c !== s.code) : [...sportCodes, s.code])
              }
              className="rounded-full px-2 py-0.5"
              style={{
                background: on ? 'var(--gridline)' : 'transparent',
                color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid var(--border-hairline)',
              }}
            >
              {on ? '✓ ' : ''}
              {s.label}
            </button>
          )
        })}
      </div>

      {error ? (
        <p className="m-0 mt-2 text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      ) : null}
    </Card>
  )
}
