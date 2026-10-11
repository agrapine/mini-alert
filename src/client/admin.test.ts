import { describe, expect, it } from 'vitest'
import { adminEnabled } from './admin.ts'

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

describe('admin mode', () => {
  it('turns on from the query and stays on for this tab', () => {
    const store = memory()
    expect(adminEnabled('', store)).toBe(false)
    expect(adminEnabled('?admin=1', store)).toBe(true)
    expect(adminEnabled('', store)).toBe(true)
    expect(store.getItem('rts.admin')).toBe('1')
  })

  it('ignores other query values', () => {
    const store = memory()
    expect(adminEnabled('?admin=true', store)).toBe(false)
    expect(adminEnabled('?other=1', store)).toBe(false)
  })
})
