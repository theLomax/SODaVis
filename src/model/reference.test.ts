import { describe, expect, it } from 'vitest'
import { initialsOf } from './reference'

describe('initialsOf', () => {
  it('takes the first letters of the first and last words', () => {
    expect(initialsOf('Sam Rivera')).toBe('SR')
    expect(initialsOf('  sam   q.  rivera ')).toBe('SR')
  })

  it('gives one letter for a single name, and nothing for no name', () => {
    expect(initialsOf('Sam')).toBe('S')
    expect(initialsOf('')).toBe('')
    expect(initialsOf('   ')).toBe('')
    expect(initialsOf(undefined)).toBe('')
  })

  it('skips punctuation and keeps accented letters whole', () => {
    expect(initialsOf('(Sam) O’Rivera')).toBe('SO')
    expect(initialsOf('Élodie Ångström')).toBe('ÉÅ')
    expect(initialsOf('— —')).toBe('')
  })
})
