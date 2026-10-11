import { describe, expect, it } from 'vitest'
import { rememberedName, rememberName } from './player-name.ts'

function memory(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear() {
      items.clear()
    },
    getItem(key) {
      return items.get(key) ?? null
    },
    key(index) {
      return [...items.keys()][index] ?? null
    },
    removeItem(key) {
      items.delete(key)
    },
    setItem(key, value) {
      items.set(key, value)
    },
  }
}

describe('player name', () => {
  it('prefers this tab, then the last name saved in the browser', () => {
    const session = memory()
    const local = memory()
    rememberName('Ada', session, local)
    expect(rememberedName(session, local)).toBe('Ada')

    const otherTab = memory()
    rememberName('Bea', otherTab, local)
    expect(rememberedName(session, local)).toBe('Ada')
    expect(rememberedName(otherTab, local)).toBe('Bea')
    expect(rememberedName(memory(), local)).toBe('Bea')
  })
})
