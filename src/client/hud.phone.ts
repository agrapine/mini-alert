import { join } from 'node:path'
import { devices, webkit, type Browser, type BrowserContextOptions } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let server: ViteDevServer
let browser: Browser
let mock = ''

const SCREENS: [string, BrowserContextOptions][] = [
  ['1280×720', { viewport: { width: 1280, height: 720 } }],
  ['iPhone 15 portrait', devices['iPhone 15']],
]

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: join(import.meta.dirname, '../..'),
    logLevel: 'silent',
    server: { port: 0, hmr: false },
    optimizeDeps: { noDiscovery: true },
  })
  await server.listen()
  const origin = server.resolvedUrls?.local[0]
  if (!origin) throw new Error('the mock server has no address')
  mock = new URL('mock/hud.html', origin).href
  browser = await webkit.launch()
})

afterAll(async () => {
  await browser.close()
  await server.close()
})

async function inScene<T>(options: BrowserContextOptions, scene: string, probe: () => T): Promise<T> {
  const page = await browser.newPage(options)
  await page.goto(`${mock}?scene=${scene}`)
  await page.waitForSelector('#orders .tile')
  const result = await page.evaluate(probe)
  await page.close()
  return result
}

describe('HUD layout', () => {
  it.each(SCREENS)('%s: the centre of each HUD control in the base scene hits that control', async (_, options) => {
    const { checked, misses } = await inScene(options, 'base', () => {
      const name = (element: Element | null) =>
        element === null ? 'nothing' : element.getAttribute('aria-label') || element.getAttribute('title') || element.id || element.textContent?.trim() || element.tagName
      const onScreen = (element: Element, x: number, y: number) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
        for (let box = element.parentElement; box; box = box.parentElement) {
          const style = getComputedStyle(box)
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
          const rect = box.getBoundingClientRect()
          if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false
        }
        return true
      }
      const checked: string[] = []
      const misses: string[] = []
      for (const control of document.querySelectorAll('#hud button, #hud input, #minimap-marks')) {
        const rect = control.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        if (rect.width === 0 || rect.height === 0 || !onScreen(control, x, y)) continue
        checked.push(name(control))
        const hit = document.elementFromPoint(x, y)
        if (!hit || !control.contains(hit)) misses.push(`${name(control)} hits ${name(hit)}`)
      }
      return { checked, misses }
    })
    expect(misses).toEqual([])
    expect(checked).toEqual(
      expect.arrayContaining(['Menu', 'Changelog', 'Help', 'Full screen', 'minimap-marks', 'Factory', 'Turret', 'Airport', 'Helipad', 'Shipyard', 'Building']),
    )
  })

  it.each(SCREENS)('%s: in the lobby the sheet shows and the match chrome does not', async (_, options) => {
    const shown = await inScene(options, 'help', () => {
      document.body.classList.remove('match')
      document.body.classList.add('lobby')
      const rendered = (selector: string) => (document.querySelector(selector)?.getClientRects().length ?? 0) > 0
      const card = document.querySelector('.sheet-card')?.getBoundingClientRect()
      const hit = card ? document.elementFromPoint(card.left + card.width / 2, card.top + card.height / 2) : null
      return {
        sheet: rendered('#sheet') && hit?.closest('#sheet') !== null,
        menubar: rendered('#menubar'),
        stats: rendered('#stats'),
        side: rendered('#side'),
      }
    })
    expect(shown).toEqual({ sheet: true, menubar: false, stats: false, side: false })
  })
})
