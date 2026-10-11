import type { Commander } from '../commander.ts'
import type { Replica } from '../replica.ts'
import type { GameView } from '../render/view.ts'
import { canPlaceFootprint } from '../../shared/footprint.ts'
import type { Terrain } from '../../shared/tiles.ts'
import { UNIT_TYPES } from '../../shared/unit-types.ts'
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
  let spaceDown = false
  let selectArmed = false
  let boxSelecting = false
  let originX = 0
  let originY = 0
  let lastX = 0
  let lastY = 0
  let pointerX = 0
  let pointerY = 0

  const refreshCursor = (clientX: number, clientY: number) => {
    if (panning) canvas.style.cursor = 'grabbing'
    else if (spaceDown) canvas.style.cursor = 'grab'
    else if (player.placingType() !== null) canvas.style.cursor = 'crosshair'
    else canvas.style.cursor = cursorFor(false, replica, player, view, clientX, clientY)
  }

  const showGhost = (clientX: number, clientY: number) => {
    const typeId = player.placingType()
    const world = replica.world
    if (typeId === null || !world) {
      view.showPlacement(null)
      return
    }
    const origin = view.pickTile(clientX, clientY)
    if (!origin) {
      view.showPlacement(null)
      return
    }
    const footprint = UNIT_TYPES[typeId].footprint
    const terrainAt = (x: number, y: number) => world.terrain[y * world.width + x] as Terrain
    const cells: { x: number; y: number; open: boolean }[] = []
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const tile = { x: origin.x + dx, y: origin.y + dy }
        const onMap = canPlaceFootprint(tile, 1, world.width, world.height, terrainAt, replica.units)
        cells.push({
          x: tile.x,
          y: tile.y,
          open: onMap && replica.nearCity(tile, 1),
        })
      }
    }
    view.showPlacement(cells)
  }

  const commitPlace = (clientX: number, clientY: number) => {
    const typeId = player.placingType()
    const world = replica.world
    const origin = view.pickTile(clientX, clientY)
    if (typeId === null || !world || !origin) return
    const terrainAt = (x: number, y: number) => world.terrain[y * world.width + x] as Terrain
    const footprint = UNIT_TYPES[typeId].footprint
    if (!canPlaceFootprint(origin, footprint, world.width, world.height, terrainAt, replica.units)) return
    if (!replica.nearCity(origin, footprint)) return
    player.placeBuilding(origin)
    view.showPlacement(null)
  }

  const beginPan = (event: PointerEvent) => {
    panning = true
    view.setHovered([])
    lastX = event.clientX
    lastY = event.clientY
    canvas.style.cursor = 'grabbing'
    canvas.setPointerCapture(event.pointerId)
    event.preventDefault()
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
    if (event.button === 0 && spaceDown) {
      beginPan(event)
      return
    }
    if (event.button === 2 && player.placingType() !== null) {
      player.cancelPlace()
      view.showPlacement(null)
      refreshCursor(event.clientX, event.clientY)
      event.preventDefault()
      return
    }
    if (event.button === 0 && player.placingType() !== null) {
      canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 0) {
      selectArmed = true
      boxSelecting = false
      originX = event.clientX
      originY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 1) {
      beginPan(event)
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    view.setZoomCursor(event.clientX, event.clientY)
    pointerX = event.clientX
    if (player.placingType() !== null && !panning) showGhost(event.clientX, event.clientY)
    pointerY = event.clientY
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
    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      panning = false
      refreshCursor(event.clientX, event.clientY)
      return
    }
    if (event.button !== 0) return
    if (player.placingType() !== null) {
      commitPlace(event.clientX, event.clientY)
      refreshCursor(event.clientX, event.clientY)
      return
    }
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
    const picked = unitId === null ? undefined : replica.unit(unitId)
    const tile = view.pickTile(event.clientX, event.clientY)
    const standing = picked ?? (tile ? replica.occupant(tile) : undefined)
    if (standing && standing.ownerId !== replica.playerId && player.selected().length > 0) {
      player.orderAttack(standing.id)
      view.ping(standing.x, standing.z, true)
    } else if (picked && picked.ownerId === replica.playerId) {
      player.select(picked.id)
    } else if (tile && player.selected().length > 0 && replica.isOpen(tile, player.selected().map((unit) => unit.id))) {
      player.orderMove(tile)
      view.ping(tile.x + 0.5, tile.y + 0.5, false)
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

  const syncRanges = (event: KeyboardEvent) => {
    const ctrl = event.key === 'Control' && event.type === 'keyup' ? false : event.ctrlKey
    const meta = event.key === 'Meta' && event.type === 'keyup' ? false : event.metaKey
    view.setShowRanges(ctrl || meta)
  }

  window.addEventListener('keydown', (event) => {
    syncRanges(event)
    if (event.code !== 'Space') return
    if (document.body.classList.contains('lobby')) return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    if (target instanceof HTMLElement && target.isContentEditable) return
    event.preventDefault()
    if (spaceDown) return
    spaceDown = true
    hideBox()
    view.setHovered([])
    refreshCursor(pointerX, pointerY)
  })

  window.addEventListener('keyup', (event) => {
    syncRanges(event)
    if (event.code !== 'Space') return
    spaceDown = false
    panning = false
    refreshCursor(pointerX, pointerY)
  })

  window.addEventListener('blur', () => {
    panning = false
    spaceDown = false
    view.setShowRanges(false)
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
