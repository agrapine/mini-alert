import type { Commander } from '../commander.ts'
import type { Replica } from '../replica.ts'
import type { GameView } from '../render/view.ts'
import { cursorFor } from './cursor.ts'
import { bindPanKeys } from './keys.ts'

export function bindInput(
  canvas: HTMLCanvasElement,
  replica: Replica,
  player: Commander,
  view: GameView,
) {
  const keys = bindPanKeys(view)
  let dragging = false
  let lastX = 0
  let lastY = 0

  const refreshCursor = (clientX: number, clientY: number) => {
    canvas.style.cursor = cursorFor(dragging, replica, player, view, clientX, clientY)
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
      view.setHovered(null)
      lastX = event.clientX
      lastY = event.clientY
      canvas.style.cursor = 'grabbing'
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    view.setZoomCursor(event.clientX, event.clientY)
    view.setHovered(dragging ? null : view.pickUnit(event.clientX, event.clientY))
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

  canvas.addEventListener('pointerleave', () => {
    if (!dragging) view.setHovered(null)
  })

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      view.zoomAt(wheelPixels(event), event.clientX, event.clientY)
    },
    { passive: false },
  )

  window.addEventListener('blur', () => {
    dragging = false
    view.setHovered(null)
    keys.release()
  })
}

function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 40
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * 800
  return event.deltaY
}
