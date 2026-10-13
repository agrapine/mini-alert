import changelog from '../../changelog.md?raw'
import { version } from '../../package.json'

const SEEN_VERSION = 'rts.seen-version'
const MUSIC_KEY = 'rts.music'

const HELP = `# Shortcuts

- **Select** — click one of your units
- **Select several** — drag a box around them
- **Move** — with units selected, click open ground
- **Attack** — click an enemy. Hold Ctrl or ⌘ and click the ground to shell that spot. Units also fire at enemies they can see
- **Build** — Factory, Turret, Airport, or Helipad goes on open ground beside a city you own. A shipyard goes on water beside a city you own. Building places one of the houses a city grows, only on a tile that city could grow. The price appears when you aim at that city. Right-click cancels
- **Primary factory** — select a factory, then click it again. New units come out of that one. A star marks it
- **Waypoint** — with a factory selected, click the ground. Finished units move there
- **Ranges** — hold Ctrl or ⌘ with one unit selected to show its attack range and sight
- **Pan** — \`WASD\`, arrow keys, middle-drag, hold Space and drag, move the pointer within 25px of the screen edge, or drag with two fingers
- **Turn** — \`Q\` and \`E\` rotate the camera 45°
- **Zoom** — mouse wheel, or pinch with two fingers
- **Minimap** — drag to move the camera. A click orders selected units as if you clicked that tile. With nothing selected, a click moves the camera

# Rules

## Credits

You start with 10,000. Every 10 seconds, each city you hold pays **2** per building. A city pays nothing while an enemy unit is nearby. You cannot hold more than 10,000 plus 500 for each population. Income stops there, and losing population throws away anything above the new limit.

## Cities

Move a unit onto any city tile, including a street, and hold it to capture. A ring shows progress. A city resists for five seconds per building. Each unit wears that down by its unit count each second, so a scout takes five seconds on a one-building city and a heavy tank takes a quarter of that. If both sides stand on a city, the capture pauses. Leave, and the progress fades slowly until it is gone. The owner or another commander standing there pushes it back at the same rate they would capture.

Cities grow on their own, adding streets and buildings. Each city has a hall that stays neutral and cannot be destroyed. Population is the number of buildings still standing, including the hall. Your army cannot grow past that population. Scouts count as 1, medium tanks, turrets, jets, and cruisers as 2, artillery and gunships as 3, and heavy tanks, factories, and helipads as 4. Shipyards count as 8 and airports as 12. The unit count turns red when it is over, and training and construction stop. Guns and shells bring down the other buildings. When the last of those falls, the city is neutral again. A street more than four tiles from a standing building comes up with it.

## Building

Factories, airports, helipads, and turrets take time to finish, and they can only be placed on open ground beside a city you own. A shipyard goes on water beside a city you own. An airport, helipad, or shipyard can be placed only after a factory is finished. An airport is a 3×3 field with a center runway and six parking spots, and it can hold six jets. A building is the same kind a city grows on its own, and it can only go on a tile that city could grow one. It appears at once and takes the full price. Aim at the city and the price appears: 100 while that city has 6 buildings or fewer, and after that 100 times how many buildings it has beyond 5. It adds 1 population. A finished factory trains scouts, medium tanks, heavy tanks, and artillery. An airport trains jets, a helipad trains gunships, and a shipyard trains cruisers onto the water beside it. Each finished yard of that kind adds 25% to that training speed. A build tile appears once that unit can be made. Click it to queue one, and click again to queue another. The corner number is the queue once more than the one being built is waiting, for units and for structures. Shift-click or right-click drops the latest queued order of that type. Credits are spent while a unit or structure is built, and construction pauses if you run out.

Jets taxi from their spot onto the center runway, roll, climb, and circle the ordered tile until you send them back. Each carries five rockets and fires only after it is in the air. A rocket climbs as it flies, and it hits harder and wider than a shell. When the rack is empty the jet returns to the airport that launched it, lands, and taxis to its spot to reload. Click the airport to send one home early. A destroyed jet frees its spot. Gunships climb off the helipad, hover, and turn before they fly. Click the helipad to bring one back down. Cruisers spin in place, then pick up speed slowly, and they only travel on water. Vehicles and turrets shoot enemies and buildings of a city another commander holds. They leave neutral cities alone. Shots scatter more at long range, and more again when the shooter is moving. Shells splash, knock down trees, and bring down those buildings and streets. Artillery reaches farther and is easy to lose. Scouts are fast and light. Tanks turn in place. A friendly unit with nothing to do steps off a tile another unit needs; a unit already on its way is left to move, and the one behind waits.

## Sight

Fog covers ground you have not seen. Finished units reveal a circle around them, and a city you own reveals ten tiles around its center. Enemies outside that sight stay hidden. Ground you have already walked stays dim after you look away.
`

export function bindMenu(actions: { onMusic?(on: boolean): void; onSurrender?(): void } = {}): void {
  const bar = document.querySelector<HTMLElement>('#menubar')
  const menu = document.querySelector<HTMLElement>('#menu')
  const sheet = document.querySelector<HTMLElement>('#sheet')
  const title = document.querySelector<HTMLElement>('#sheet-title')
  const body = document.querySelector<HTMLElement>('#sheet-body')
  if (!bar || !menu || !sheet || !title || !body) return

  const musicToggle = bar.querySelector<HTMLElement>('[data-toggle="music"]')
  if (musicToggle && !musicOn()) {
    setPressed(musicToggle, false)
    actions.onMusic?.(false)
  }

  const closeMenu = () => menu.classList.remove('open')

  const openSheet = (label: string, markdown: string) => {
    closeMenu()
    title.textContent = label
    body.innerHTML = renderMarkdown(stripMatchingTitle(markdown, label))
    sheet.hidden = false
    if (label === 'Changelog') markSeen(version)
  }

  const closeSheet = () => {
    sheet.hidden = true
  }

  bar.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const opener = target.closest<HTMLElement>('[data-open]')
    if (opener?.dataset.open === 'menu') {
      menu.classList.toggle('open')
      return
    }
    if (opener?.dataset.open === 'changelog') {
      openSheet('Changelog', changelog)
      return
    }
    if (opener?.dataset.open === 'help') {
      openSheet('Help', HELP)
      return
    }
    if (target.closest('[data-dismiss]')) {
      closeMenu()
      actions.onSurrender?.()
      return
    }
    const toggle = target.closest<HTMLElement>('[data-toggle]')
    if (!toggle) return
    const on = toggle.getAttribute('aria-pressed') !== 'true'
    setPressed(toggle, on)
    if (toggle.dataset.toggle === 'music') {
      rememberMusic(on)
      actions.onMusic?.(on)
    }
  })

  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet()
  })
  document.querySelector('#sheet-close')?.addEventListener('click', closeSheet)

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (!sheet.hidden) closeSheet()
    else closeMenu()
  })

  window.addEventListener('pointerdown', (event) => {
    if (!menu.classList.contains('open')) return
    const target = event.target
    if (target instanceof Node && menu.contains(target)) return
    closeMenu()
  })

  if (seenVersion() !== version) openSheet('Changelog', changelog)
}

export function musicOn(store: Storage = localStorage): boolean {
  try {
    return store.getItem(MUSIC_KEY) !== 'off'
  } catch {
    return true
  }
}

export function rememberMusic(on: boolean, store: Storage = localStorage) {
  try {
    store.setItem(MUSIC_KEY, on ? 'on' : 'off')
  } catch {
    // Storage can be blocked. The toggle still applies for this visit.
  }
}

function setPressed(toggle: HTMLElement, on: boolean) {
  toggle.setAttribute('aria-pressed', on ? 'true' : 'false')
  const mark = toggle.querySelector('.mark')
  if (mark) mark.textContent = on ? 'On' : 'Off'
}

function seenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_VERSION)
  } catch {
    return version
  }
}

function markSeen(next: string) {
  try {
    localStorage.setItem(SEEN_VERSION, next)
  } catch {
    // Storage can be blocked. Skip the write and leave the sheet as the only notice.
  }
}

function stripMatchingTitle(markdown: string, label: string): string {
  const source = markdown.trim()
  const match = /^#\s+(.+)\n+/.exec(source)
  if (!match || match[1] !== label) return source
  return source.slice(match[0].length)
}

function renderMarkdown(source: string): string {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const out: string[] = []
  let list: string[] | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length === 0) return
    out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  const flushList = () => {
    if (!list) return
    out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
    list = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flushPara()
      flushList()
      continue
    }
    if (/^---+$/.test(trimmed)) {
      flushPara()
      flushList()
      out.push('<hr>')
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    const item = /^[-*]\s+(.+)$/.exec(trimmed)
    if (item) {
      flushPara()
      list ??= []
      list.push(item[1])
      continue
    }
    flushList()
    para.push(trimmed)
  }
  flushPara()
  flushList()
  return out.join('')
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
