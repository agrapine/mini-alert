// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindMenu, rememberSetting, rememberVolume, settingOn, volumeSetting } from './menu.ts'

const page = new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8'), 'text/html')

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

function one<T extends Element = HTMLElement>(scope: ParentNode, selector: string): T {
  const found = scope.querySelector<T>(selector)
  if (!found) throw new Error(`no ${selector}`)
  return found
}

function settingsMenu() {
  document.body.replaceChildren(document.importNode(one(page, '#menubar'), true), document.importNode(one(page, '#sheet'), true))
  const actions = { onMusicVolume: vi.fn<(volume: number) => void>(), onSoundsVolume: vi.fn<(volume: number) => void>() }
  bindMenu(actions)
  const slider = (name: string) => one<HTMLInputElement>(document, `input[data-volume="${name}"]`)
  const readout = (name: string) => one(document, `output[for="${slider(name).id}"]`).textContent
  return { actions, slider, readout }
}

describe('volume', () => {
  beforeEach(() => localStorage.clear())

  it('is remembered, 0 included, each on its own', () => {
    const store = memory()
    expect(volumeSetting('musicVolume', store)).toBeNull()
    rememberVolume('musicVolume', 0, store)
    expect(volumeSetting('musicVolume', store)).toBe(0)
    expect(volumeSetting('soundsVolume', store)).toBeNull()
  })

  it('starts at 40% for music and 100% for sounds', () => {
    const { actions, readout } = settingsMenu()
    expect(actions.onMusicVolume).toHaveBeenCalledWith(0.4)
    expect(actions.onSoundsVolume).toHaveBeenCalledWith(1)
    expect([readout('musicVolume'), readout('soundsVolume')]).toEqual(['40%', '100%'])
  })

  it('applies as the slider moves, and comes back where it was left', () => {
    const first = settingsMenu()
    const music = first.slider('musicVolume')
    music.value = '25'
    music.dispatchEvent(new Event('input', { bubbles: true }))
    expect(first.actions.onMusicVolume).toHaveBeenLastCalledWith(0.25)
    expect(first.readout('musicVolume')).toBe('25%')
    const next = settingsMenu()
    expect(next.slider('musicVolume').value).toBe('25')
    expect(next.actions.onMusicVolume).toHaveBeenCalledWith(0.25)
  })
})
