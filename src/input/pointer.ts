import type { Commander } from '../game/commander.ts'
import type { World } from '../game/world.ts'
import type { GameView } from '../render/view.ts'
import { cursorFor } from './cursor.ts'
import { bindPanKeys } from './keys.ts'

export function bindInput(
  canvas: HTMLCanvasElement,
  world: World,
  player: Commander,
  view: GameView,
) {
  const keys = bindPanKeys(view)
  let dragging = false
  let lastX = 0
  let lastY = 0

  const refreshCursor = (clientX: number, clientY: number) => {
    canvas.style.cursor = cursorFor(dragging, world, player, view, clientX, clientY)
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  canvas.addEventListener('auxclick', (event) => event.preventDefault())

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      const unitId = view.pickUnit(event.clientX, event.clientY)
      if (unitId !== null) player.select(unitId)
      else {
        const tile = view.pickTile(event.clientX, event.clientY)
        if (tile) player.orderMove(tile)
      }
      refreshCursor(event.clientX, event.clientY)
      return
    }
    if (event.button === 1) {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas.style.cursor = 'grabbing'
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    if (dragging) {
      view.panByPixels(lastX, lastY, event.clientX, event.clientY)
      lastX = event.clientX
      lastY = event.clientY
      canvas.style.cursor = 'grabbing'
      return
    }
    refreshCursor(event.clientX, event.clientY)
  })

  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 1) return
    dragging = false
    refreshCursor(event.clientX, event.clientY)
  })

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

  window.addEventListener('blur', () => {
    dragging = false
    keys.release()
  })
}
