import type { Commander } from '../commander.ts'
import type { Replica } from '../replica.ts'
import type { GameView } from '../render/view.ts'
import { cursorFor } from './cursor.ts'
import { bindPanKeys } from './keys.ts'

const DRAG_SELECT_PX = 8

export function bindInput(
  canvas: HTMLCanvasElement,
  replica: Replica,
  player: Commander,
  view: GameView,
) {
  const keys = bindPanKeys(view)
  const marquee = document.createElement('div')
  marquee.id = 'marquee'
  document.body.append(marquee)

  let panning = false
  let selectArmed = false
  let boxSelecting = false
  let originX = 0
  let originY = 0
  let lastX = 0
  let lastY = 0

  const refreshCursor = (clientX: number, clientY: number) => {
    canvas.style.cursor = cursorFor(panning, replica, player, view, clientX, clientY)
  }

  const hideBox = () => {
    boxSelecting = false
    selectArmed = false
    marquee.style.display = 'none'
    view.setBoxPreview(false)
  }

  const boxIds = (x: number, y: number) =>
    view.unitsInRect(originX, originY, x, y, replica.units, replica.playerId)

  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  canvas.addEventListener('auxclick', (event) => event.preventDefault())

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      selectArmed = true
      boxSelecting = false
      originX = event.clientX
      originY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 1) {
      panning = true
      view.setHovered([])
      lastX = event.clientX
      lastY = event.clientY
      canvas.style.cursor = 'grabbing'
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    view.setZoomCursor(event.clientX, event.clientY)
    if (panning) {
      view.panByPixels(lastX, lastY, event.clientX, event.clientY)
      lastX = event.clientX
      lastY = event.clientY
      canvas.style.cursor = 'grabbing'
      view.setHovered([])
      return
    }
    if (selectArmed) {
      const dx = event.clientX - originX
      const dy = event.clientY - originY
      if (!boxSelecting && dx * dx + dy * dy >= DRAG_SELECT_PX * DRAG_SELECT_PX) {
        boxSelecting = true
        view.setBoxPreview(true)
      }
      if (boxSelecting) {
        placeMarquee(marquee, originX, originY, event.clientX, event.clientY)
        view.setHovered(boxIds(event.clientX, event.clientY))
        canvas.style.cursor = 'default'
        return
      }
    }
    const hovered = view.pickUnit(event.clientX, event.clientY)
    view.setHovered(hovered === null ? [] : [hovered])
    refreshCursor(event.clientX, event.clientY)
  })

  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 1) {
      panning = false
      refreshCursor(event.clientX, event.clientY)
      return
    }
    if (event.button !== 0) return
    if (boxSelecting) {
      player.selectIds(boxIds(event.clientX, event.clientY))
      hideBox()
      view.setHovered([])
      refreshCursor(event.clientX, event.clientY)
      return
    }
    if (!selectArmed) return
    selectArmed = false
    const unitId = view.pickUnit(event.clientX, event.clientY)
    if (unitId !== null) player.select(unitId)
    else {
      const tile = view.pickTile(event.clientX, event.clientY)
      if (tile) player.orderMove(tile)
    }
    refreshCursor(event.clientX, event.clientY)
  })

  canvas.addEventListener('pointercancel', () => {
    panning = false
    hideBox()
    view.setHovered([])
  })

  canvas.addEventListener('pointerleave', () => {
    if (!panning && !selectArmed) view.setHovered([])
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
    panning = false
    hideBox()
    view.setHovered([])
    keys.release()
  })
}

function placeMarquee(marquee: HTMLElement, x0: number, y0: number, x1: number, y1: number) {
  marquee.style.display = 'block'
  marquee.style.left = `${Math.min(x0, x1)}px`
  marquee.style.top = `${Math.min(y0, y1)}px`
  marquee.style.width = `${Math.abs(x1 - x0)}px`
  marquee.style.height = `${Math.abs(y1 - y0)}px`
}

function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 40
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * 800
  return event.deltaY
}
