import type { GameView } from '../render/view.ts'

const PAN_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
])

export function bindPanKeys(view: GameView): { release(): void } {
  const down = new Set<string>()

  const syncAxis = () => {
    const x =
      (down.has('d') || down.has('arrowright') ? 1 : 0) -
      (down.has('a') || down.has('arrowleft') ? 1 : 0)
    const z =
      (down.has('s') || down.has('arrowdown') ? 1 : 0) -
      (down.has('w') || down.has('arrowup') ? 1 : 0)
    view.setPanAxis(x, z)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (typing(event)) return
    const key = event.key.toLowerCase()
    if (key === 'q' || key === 'e') {
      if (event.repeat) return
      event.preventDefault()
      view.nudgeYaw(key === 'e' ? 1 : -1)
      return
    }
    if (!PAN_KEYS.has(key)) return
    event.preventDefault()
    down.add(key)
    syncAxis()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (typing(event)) return
    const key = event.key.toLowerCase()
    if (!PAN_KEYS.has(key)) return
    down.delete(key)
    syncAxis()
  }

  const release = () => {
    down.clear()
    syncAxis()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', release)
  return { release }
}

function typing(event: KeyboardEvent): boolean {
  if (document.body.classList.contains('lobby')) return true
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}
