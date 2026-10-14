// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyHall, guestRoom, hall, hostRoom, roomPreview } from './lobby-fixtures.ts'
import { LobbyView, type LobbyActions } from './lobby-ui.ts'

const css = readFileSync(join(import.meta.dirname, 'lobby.css'), 'utf8')
const NO_PREFERENCE = '@media (prefers-reduced-motion: no-preference)'
const MOVING = new Set(['transform', 'opacity'])
const COLOUR_SYNTAX = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const NOT_LITERALS = new Set(['transparent', 'currentcolor', 'none', 'inherit', 'initial', 'unset', 'revert'])
const AA = 4.5

type Declaration = { scopes: string[]; property: string; value: string }

function declarations(source: string): Declaration[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: Declaration[] = []
  const scopes: string[] = []
  let pending = ''
  const flush = () => {
    const colon = pending.indexOf(':')
    if (scopes.length > 0 && colon > 0) {
      found.push({ scopes: [...scopes], property: pending.slice(0, colon).trim(), value: pending.slice(colon + 1).trim() })
    }
    pending = ''
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, i + 1)
      pending += text.slice(i, end + 1)
      i = end
    } else if (char === '{') {
      scopes.push(pending.trim().replace(/\s+/g, ' '))
      pending = ''
    } else if (char === ';') flush()
    else if (char === '}') {
      flush()
      scopes.pop()
    } else pending += char
  }
  return found
}

const probe = document.createElement('div').style

function isNamedColour(word: string): boolean {
  if (NOT_LITERALS.has(word.toLowerCase())) return false
  probe.color = ''
  probe.color = word
  return probe.color !== ''
}

function hasColourLiteral({ value }: Declaration): boolean {
  const bare = value.replace(/(['"]).*?\1/g, '').replace(/--[\w-]+/g, '')
  return COLOUR_SYNTAX.test(bare) || (bare.match(/[a-z][a-z-]*/gi) ?? []).some(isNamedColour)
}

const all = declarations(css)

const actions = new Proxy({} as LobbyActions, { get: () => () => undefined })

const SCENES: ((view: LobbyView) => void)[] = [
  (view) => {
    view.setConnected(true)
    view.showWaiting(hall())
  },
  (view) => view.showWaiting(emptyHall()),
  (view) => view.showGame(hostRoom(), roomPreview()),
  (view) => view.showGame(guestRoom(), roomPreview()),
  (view) => view.showReplaced(),
]

function luminance(colour: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new Error(`${colour} is not #rrggbb`)
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(colour.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

function surface(element: Element): string[] {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const { backgroundColor, backgroundImage } = getComputedStyle(at)
    const stops = `${backgroundColor} ${backgroundImage}`.match(/#[0-9a-f]{6}\b/gi)
    if (stops) return stops
  }
  throw new Error(`no surface behind ${element.outerHTML}`)
}

function ownText(element: Element): boolean {
  return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
}

function inks(scene: (view: LobbyView) => void) {
  const root = document.createElement('div')
  root.id = 'lobby'
  document.body.replaceChildren(root)
  scene(new LobbyView(root, actions, true))
  return [...root.querySelectorAll('*')]
    // SVG text paints with its fill attribute, not with color.
    .filter((element) => element instanceof HTMLElement && !element.closest('[hidden]'))
    .filter((element) => ownText(element) || element.matches('input[type="text"]'))
    .map((element) => {
      const { color } = getComputedStyle(element)
      const ratio = Math.min(...surface(element).map((stop) => contrast(color, stop)))
      return { text: element.textContent, color, ratio }
    })
}

describe('lobby.css', () => {
  it('moves only under prefers-reduced-motion: no-preference, and only transform and opacity', () => {
    const motion = all.filter(({ property }) => property.startsWith('animation') || property.startsWith('transition'))
    expect(motion.length).toBeGreaterThan(0)
    for (const { scopes, property } of motion) expect(scopes, property).toContain(NO_PREFERENCE)
    const keyframed = all.filter(({ scopes }) => scopes.some((scope) => scope.startsWith('@keyframes')))
    expect(keyframed.length).toBeGreaterThan(0)
    for (const { property } of keyframed) expect(MOVING).toContain(property)
    for (const { property, value } of all) {
      if (property !== 'transition' && property !== 'transition-property') continue
      for (const item of value.split(',')) expect(MOVING).toContain(item.trim().split(/\s+/)[0])
    }
  })

  it('keeps every colour literal in the :root token block', () => {
    const literals = all.filter(hasColourLiteral)
    expect(literals.filter(({ scopes }) => scopes.join() === ':root').length).toBeGreaterThan(0)
    expect(literals.filter(({ scopes }) => scopes.join() !== ':root')).toEqual([])
  })

  it('draws every text at 4.5:1 or more against the surface behind it', () => {
    const sheet = document.createElement('style')
    sheet.textContent = css
    document.head.append(sheet)
    const drawn = SCENES.flatMap(inks)
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.filter(({ ratio }) => ratio < AA)).toEqual([])
  })

  it('stays within 20 000 bytes', () => {
    expect(Buffer.byteLength(css)).toBeLessThanOrEqual(20_000)
  })
})
