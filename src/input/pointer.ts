import type { World } from '../game/world.ts'
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

export function bindInput(canvas: HTMLCanvasElement, world: World, view: GameView) {
  const down = new Set<string>()
  let dragging = false
  let lastX = 0
  let lastY = 0

  const syncAxis = () => {
    const x =
      (down.has('d') || down.has('arrowright') ? 1 : 0) -
      (down.has('a') || down.has('arrowleft') ? 1 : 0)
    const z =
      (down.has('s') || down.has('arrowdown') ? 1 : 0) -
      (down.has('w') || down.has('arrowup') ? 1 : 0)
    view.setPanAxis(x, z)
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  canvas.addEventListener('auxclick', (event) => event.preventDefault())

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      world.select(view.pickUnit(event.clientX, event.clientY))
      return
    }
    if (event.button === 2) {
      const tile = view.pickTile(event.clientX, event.clientY)
      if (tile) world.orderMove(tile)
      return
    }
    if (event.button === 1) {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return
    view.panByPixels(lastX, lastY, event.clientX, event.clientY)
    lastX = event.clientX
    lastY = event.clientY
  })

  const endDrag = (event: PointerEvent) => {
    if (event.button === 1) dragging = false
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', () => {
    dragging = false
  })

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      view.zoomAt(event.deltaY)
    },
    { passive: false },
  )

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase()
    if (!PAN_KEYS.has(key)) return
    event.preventDefault()
    down.add(key)
    syncAxis()
  })

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase()
    if (!PAN_KEYS.has(key)) return
    down.delete(key)
    syncAxis()
  })

  window.addEventListener('blur', () => {
    down.clear()
    dragging = false
    syncAxis()
  })
}
