import { describe, expect, it } from 'vitest'
import { musicOn, rememberMusic } from './menu.ts'

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

describe('music setting', () => {
  it('stays on until it is turned off', () => {
    const store = memory()
    expect(musicOn(store)).toBe(true)
    rememberMusic(false, store)
    expect(musicOn(store)).toBe(false)
    rememberMusic(true, store)
    expect(musicOn(store)).toBe(true)
  })
})
