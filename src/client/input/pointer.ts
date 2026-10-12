import type { Commander } from '../commander.ts'
import type { Replica } from '../replica.ts'
import type { GameView } from '../render/view.ts'
import { canPlaceFootprint } from '../../shared/footprint.ts'
import type { UnitSnapshot } from '../../shared/protocol.ts'
import type { Terrain, TileCoord } from '../../shared/tiles.ts'
import { MoveDomain, spanOf, UNIT_TYPES, UnitTypeId } from '../../shared/unit-types.ts'
import { cursorFor } from './cursor.ts'
import { bindPanKeys } from './keys.ts'

const DRAG_SELECT_PX = 8
const EDGE_PX = 25

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
  let groundAttack = false

  const touches = new Map<number, { x: number; y: number }>()
  let pinch: { x: number; y: number; dist: number } | null = null
  let swallowTouch = false

  const syncEdge = (event: PointerEvent) => {
    const target = event.target
    const blocked = target instanceof Element && target.closest('button, a, input, textarea, #minimap, #sheet, #outcome, .dropdown, .flyout') !== null
    if (event.pointerType === 'touch' || pinch || panning || document.body.classList.contains('lobby') || blocked) {
      view.setEdgePan(0, 0)
      return
    }
    let x = 0
    let z = 0
    if (event.clientX <= EDGE_PX) x = -1
    else if (event.clientX >= window.innerWidth - EDGE_PX) x = 1
    if (event.clientY <= EDGE_PX) z = -1
    else if (event.clientY >= window.innerHeight - EDGE_PX) z = 1
    view.setEdgePan(x, z)
  }
  window.addEventListener('pointermove', syncEdge)
  window.addEventListener('blur', () => view.setEdgePan(0, 0))
  document.documentElement.addEventListener('pointerleave', () => view.setEdgePan(0, 0))

  const refreshCursor = (clientX: number, clientY: number) => {
    if (panning) canvas.style.cursor = 'grabbing'
    else if (spaceDown) canvas.style.cursor = 'grab'
    else if (player.placingType() !== null || player.raisingCity()) canvas.style.cursor = 'crosshair'
    else canvas.style.cursor = cursorFor(false, replica, player, view, clientX, clientY, groundAttack)
  }

  const showGhost = (clientX: number, clientY: number) => {
    const typeId = player.placingType()
    const world = replica.world
    if (player.raisingCity()) {
      const origin = view.pickTile(clientX, clientY)
      player.setAim(origin)
      if (!origin) {
        view.showPlacement(null)
        return
      }
      view.showPlacement([{ x: origin.x, y: origin.y, open: replica.canRaise(origin) }])
      return
    }
    player.setAim(null)
    if (typeId === null || !world) {
      view.showPlacement(null)
      return
    }
    const origin = view.pickTile(clientX, clientY)
    if (!origin) {
      view.showPlacement(null)
      return
    }
    const span = spanOf(UNIT_TYPES[typeId])
    const domain = typeId === UnitTypeId.Shipyard ? MoveDomain.Water : MoveDomain.Ground
    const terrainAt = (x: number, y: number) => world.terrain[y * world.width + x] as Terrain
    const cells: { x: number; y: number; open: boolean }[] = []
    for (let dy = 0; dy < span.y; dy++) {
      for (let dx = 0; dx < span.x; dx++) {
        const tile = { x: origin.x + dx, y: origin.y + dy }
        const onMap = canPlaceFootprint(tile, 1, world.width, world.height, terrainAt, replica.units, 1, domain)
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
    const origin = view.pickTile(clientX, clientY)
    if (!origin) return
    placeAt(origin, replica, player, view)
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

  const fingerPoints = () => [...touches.values()]

  const beginPinch = (event: PointerEvent) => {
    const points = fingerPoints()
    if (points.length < 2) return
    swallowTouch = true
    panning = false
    hideBox()
    view.setHovered([])
    view.setEdgePan(0, 0)
    canvas.setPointerCapture(event.pointerId)
    let x = 0
    let y = 0
    for (const point of points) {
      x += point.x
      y += point.y
    }
    const first = points[0]!
    const second = points[1]!
    pinch = {
      x: x / points.length,
      y: y / points.length,
      dist: Math.hypot(first.x - second.x, first.y - second.y),
    }
  }

  const stepPinch = () => {
    if (!pinch) return
    const points = fingerPoints()
    if (points.length < 2) return
    let x = 0
    let y = 0
    for (const point of points) {
      x += point.x
      y += point.y
    }
    x /= points.length
    y /= points.length
    const first = points[0]!
    const second = points[1]!
    const dist = Math.hypot(first.x - second.x, first.y - second.y)
    view.panByPixels(pinch.x, pinch.y, x, y)
    const spread = pinch.dist - dist
    if (Math.abs(spread) > 0.5) view.zoomAt(spread, x, y)
    pinch = { x, y, dist }
  }

  const endTouch = (pointerId: number) => {
    touches.delete(pointerId)
    if (touches.size < 2) pinch = null
  }

  const blockPageZoom = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', blockPageZoom)
  document.addEventListener('gesturechange', blockPageZoom)
  document.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length > 1) event.preventDefault()
    },
    { passive: false },
  )
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault()
    },
    { passive: false },
  )

  const boxIds = (x: number, y: number) =>
    view.unitsInRect(originX, originY, x, y, replica.units, replica.playerId)

  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  canvas.addEventListener('auxclick', (event) => event.preventDefault())

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touches.size >= 2) {
        beginPinch(event)
        event.preventDefault()
        return
      }
    }
    if (event.button === 0 && spaceDown) {
      beginPan(event)
      return
    }
    if (event.button === 2 && (player.placingType() !== null || player.raisingCity())) {
      player.cancelPlace()
      view.showPlacement(null)
      refreshCursor(event.clientX, event.clientY)
      event.preventDefault()
      return
    }
    if (event.button === 0 && (player.placingType() !== null || player.raisingCity())) {
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
    if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinch) {
        stepPinch()
        event.preventDefault()
        return
      }
    }
    view.setZoomCursor(event.clientX, event.clientY)
    pointerX = event.clientX
    if ((player.placingType() !== null || player.raisingCity()) && !panning) showGhost(event.clientX, event.clientY)
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
    if (event.pointerType === 'touch') {
      endTouch(event.pointerId)
      if (swallowTouch) {
        hideBox()
        panning = false
        if (touches.size === 0) swallowTouch = false
        refreshCursor(event.clientX, event.clientY)
        return
      }
    }
    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      panning = false
      refreshCursor(event.clientX, event.clientY)
      return
    }
    if (event.button !== 0) return
    if (player.placingType() !== null || player.raisingCity()) {
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
    applyClick(tile, picked, replica, player, view, event)
    refreshCursor(event.clientX, event.clientY)
  })

  canvas.addEventListener('pointercancel', (event) => {
    endTouch(event.pointerId)
    if (touches.size === 0) swallowTouch = false
    pinch = null
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
    groundAttack = ctrl || meta
    view.setShowRanges(groundAttack)
    refreshCursor(pointerX, pointerY)
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
    groundAttack = false
    view.setShowRanges(false)
    hideBox()
    view.setHovered([])
    keys.release()
  })
}

export function commandAt(
  tile: TileCoord,
  replica: Replica,
  player: Commander,
  view: GameView,
  mods: { ctrlKey: boolean; metaKey: boolean },
): boolean {
  if (player.placingType() !== null || player.raisingCity()) {
    placeAt(tile, replica, player, view)
    return true
  }
  if (!player.commanding() && !player.factorySelected()) return false
  applyClick(tile, replica.occupant(tile), replica, player, view, mods)
  return true
}

function placeAt(tile: TileCoord, replica: Replica, player: Commander, view: GameView) {
  if (player.raisingCity()) {
    player.setAim(tile)
    if (!replica.canRaise(tile)) return
    player.placeCity(tile)
    view.showPlacement(null)
    return
  }
  const typeId = player.placingType()
  const world = replica.world
  if (typeId === null || !world) return
  const terrainAt = (x: number, y: number) => world.terrain[y * world.width + x] as Terrain
  const span = spanOf(UNIT_TYPES[typeId])
  const domain = typeId === UnitTypeId.Shipyard ? MoveDomain.Water : MoveDomain.Ground
  if (!canPlaceFootprint(tile, span.x, world.width, world.height, terrainAt, replica.units, span.y, domain)) return
  if (!replica.nearCity(tile, span.x, span.y)) return
  player.placeBuilding(tile)
  view.showPlacement(null)
}

function applyClick(
  tile: TileCoord | null,
  picked: UnitSnapshot | undefined,
  replica: Replica,
  player: Commander,
  view: GameView,
  mods: { ctrlKey: boolean; metaKey: boolean },
) {
  const standing = picked ?? (tile ? replica.occupant(tile) : undefined)
  const shellGround = (mods.ctrlKey || mods.metaKey) && player.commanding() && tile !== null
  const ownUnit = picked !== undefined && picked.ownerId === replica.playerId
  if (shellGround && tile && !ownUnit) {
    player.orderAttackGround(tile)
    view.ping(tile.x + 0.5, tile.y + 0.5, true)
  } else if (standing && standing.ownerId !== replica.playerId && player.commanding()) {
    player.orderAttack(standing.id)
    view.ping(standing.x, standing.z, true)
  } else if (picked && picked.ownerId === replica.playerId && replica.homePad(picked, player.selected())) {
    const pad = { x: picked.tileX, y: picked.tileY }
    player.orderMove(pad)
    view.ping(pad.x + 0.5, pad.y + 0.5, false)
  } else if (picked && picked.ownerId === replica.playerId) {
    player.select(picked.id)
  } else if (tile && player.factorySelected() && replica.isOpen(tile, [])) {
    player.setRally(tile)
    view.ping(tile.x + 0.5, tile.y + 0.5, false)
  } else if (tile && player.commanding() && replica.canCommand(tile, player.selected())) {
    player.orderMove(tile)
    view.ping(tile.x + 0.5, tile.y + 0.5, false)
  }
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
