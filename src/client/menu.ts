import changelog from '../../changelog.md?raw'
import { version } from '../../package.json'

const SEEN_VERSION = 'rts.seen-version'

const HELP = `# Shortcuts

- **Select** — click one of your units
- **Select several** — drag a box around them
- **Move** — with units selected, click open ground
- **Attack** — click an enemy. Units also fire at enemies they can see
- **Build** — choose Factory or Turret, then click open ground. Right-click cancels
- **Ranges** — hold Ctrl or ⌘ to show attack range and sight
- **Pan** — \`WASD\`, arrow keys, middle-drag, or hold Space and drag
- **Turn** — \`Q\` and \`E\` rotate the camera 45°
- **Zoom** — mouse wheel
- **Minimap** — click or drag to move the camera

# Rules

## Credits

You start with 10,000. Income is **6** per city you hold, plus **1** per population tile, paid continuously.

## Cities

Move a unit onto a city and hold it to capture. A ring shows progress. Neutral cities fall faster than ones another commander already holds. If both sides stand on a city, the capture pauses. Leave, and the progress drains away.

Cities grow on their own, adding streets and buildings. Population is the number of tiles in the city, and a larger city pays more.

## Building

Factories and turrets take time to finish. A finished factory can train scouts, medium tanks, heavy tanks, and artillery. Credits are spent while that unit or structure is built, and construction pauses if you run out. [−] cancels the latest queued unit of that type.

Vehicles and turrets shoot enemies in sight. Shells splash. Artillery reaches farther and is easy to lose. Scouts are fast and light.

## Sight

Fog covers ground you have not seen. Finished units reveal a circle around them, and a city you own reveals ten tiles around its center. Enemies outside that sight stay hidden. Ground you have already walked stays dim after you look away.
`

export function bindMenu(): void {
  const bar = document.querySelector<HTMLElement>('#menubar')
  const menu = document.querySelector<HTMLElement>('#menu')
  const sheet = document.querySelector<HTMLElement>('#sheet')
  const title = document.querySelector<HTMLElement>('#sheet-title')
  const body = document.querySelector<HTMLElement>('#sheet-body')
  if (!bar || !menu || !sheet || !title || !body) return

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
    if (target.closest('[data-dismiss]')) closeMenu()
    const toggle = target.closest<HTMLElement>('[data-toggle]')
    if (!toggle) return
    const on = toggle.getAttribute('aria-pressed') !== 'true'
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    const mark = toggle.querySelector('.mark')
    if (mark) mark.textContent = on ? 'On' : 'Off'
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
