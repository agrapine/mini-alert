import { describe, expect, it } from 'vitest'
import { ensureSeatToken, holdSeatToken } from './seat.ts'

describe('seat token', () => {
  it('keeps a hash and writes one when the page has none', () => {
    const loc = { hash: '' }
    const written: string[] = []
    const token = ensureSeatToken(loc, (next) => {
      written.push(next)
      loc.hash = `#${next}`
    })
    expect(token).toMatch(/^[a-f0-9]{32}$/)
    expect(written).toEqual([token])
    expect(ensureSeatToken(loc, () => written.push('again'))).toBe(token)
    expect(written).toEqual([token])
  })

  it('replaces the hash when the server assigns a different id', () => {
    const loc = { hash: '#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
    const written: string[] = []
    const write = (next: string) => {
      written.push(next)
      loc.hash = `#${next}`
    }
    holdSeatToken('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', loc, write)
    expect(written).toEqual([])
    holdSeatToken('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', loc, write)
    expect(written).toEqual(['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'])
    expect(loc.hash).toBe('#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })
})