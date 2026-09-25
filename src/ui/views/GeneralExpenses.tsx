/**
 * General expenses: what the work cost that no single trip did — shoes, a uniform,
 * association dues. Entered here, beside the tax summary they feed, because that
 * is the only place they count besides net take-home. They are never in a rate.
 */

import { useState } from 'react'
import { useStore } from '../store'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { Card } from '../components/Tiles'
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

  if (!derived) return null
  const { generalExpenses, sports, settings } = derived.snapshot
  const currency = settings.currency
  const sportLabel = (code: string) => sports.find((s) => s.code === code)?.label ?? code

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

  const headers = ['Date', 'Category', 'Sports', 'Note', 'Deductible', 'Amount', '']

  return (
    <Card
      title="General expenses"
      subtitle="Costs tied to no single trip — shoes, uniform, dues. They count here and in net take-home, never in a per-hour rate."
    >
      {inYear.length > 0 ? (
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={h || i}
                    scope="col"
                    className="px-2 py-1.5 font-medium"
                    style={{
                      textAlign: h === 'Amount' ? 'right' : 'left',
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
              {inYear.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--gridline)', color: 'var(--text-primary)' }}>
                  <td className="px-2 py-1.5">{e.date}</td>
                  <td className="px-2 py-1.5">{e.category}</td>
                  <td className="px-2 py-1.5">
                    {e.sportCodes?.length ? e.sportCodes.map(sportLabel).join(', ') : 'All'}
                  </td>
                  <td className="px-2 py-1.5">{e.note ?? ''}</td>
                  <td className="px-2 py-1.5">{e.deductible ? 'Yes' : 'No'}</td>
                  <td className="num-tabular px-2 py-1.5 text-right">{formatMoney(e.amount, currency)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(e.id)}
                      aria-label={`Remove the ${e.category} expense of ${e.date}`}
                      style={{ color: 'var(--status-critical)' }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
