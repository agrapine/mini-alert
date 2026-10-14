import { describe, expect, it } from 'vitest'
import { seatLink, seatToken } from './seat.ts'

function browser() {
  const saved = new Map<string, string>()
  return { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) }
}

describe('seat token', () => {
  it('gives every new tab in the browser the same seat', () => {
    const store = browser()
    const first = seatToken({ hash: '' }, store)
    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(seatToken({ hash: '' }, store)).toBe(first)
    expect(seatToken({ hash: '' }, browser())).not.toBe(first)
  })

  it('takes the seat of a #token link and clears it from the address bar', () => {
    const store = browser()
    seatToken({ hash: '' }, store)
    let cleared = 0
    const linked = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    expect(seatToken({ hash: `#${linked}` }, store, () => (cleared += 1))).toBe(linked)
    expect(cleared).toBe(1)
    expect(seatToken({ hash: '' }, store)).toBe(linked)
  })

  it('plays the same seat in another browser that opens its link, without the page query', () => {
    const seat = seatToken({ hash: '' }, browser())
    const page = { origin: 'https://mini.test', pathname: '/', search: '?admin=1' }
    const link = new URL(seatLink(seat, page))
    expect(link.href).toBe(`https://mini.test/#${seat}`)
    expect(seatToken(link, browser(), () => {})).toBe(seat)
  })
})
