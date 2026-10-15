import { describe, expect, it } from 'vitest'
import { rememberSetting, settingOn } from './menu.ts'

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

describe('settings', () => {
  it('stay on until turned off, each on its own', () => {
    const store = memory()
    expect(settingOn('sounds', store)).toBe(true)
    rememberSetting('sounds', false, store)
    expect(settingOn('sounds', store)).toBe(false)
    expect(settingOn('music', store)).toBe(true)
    rememberSetting('sounds', true, store)
    expect(settingOn('sounds', store)).toBe(true)
  })
})
