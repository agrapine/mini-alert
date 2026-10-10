import { Group, Mesh } from 'three'
import type { UnitSnapshot, WorldSnapshot } from '../../shared/protocol.ts'
import { UNIT_TYPES } from '../../shared/unit-types.ts'
import type { TileCoord } from '../../shared/tiles.ts'
import { buildIsland } from './island.ts'
import { Minimap } from './minimap.ts'
import { loadProps } from './props.ts'
import { Stage } from './stage.ts'
import { TILE_TOP, buildTerrain } from './terrain.ts'
import { createUnitMesh, syncUnitMesh, unitSpan } from './units/vehicle.ts'

export class GameView {
  private readonly stage: Stage
  private readonly status: HTMLElement
  private readonly units = new Map<number, Group>()
  private readonly selectionRings: Mesh[] = []
  private readonly hoverRings: Mesh[] = []
  private readonly orderRings: Mesh[] = []
  private hoveredIds: number[] = []
  private boxPreview = false
  private minimap: Minimap | null = null

  constructor(canvas: HTMLCanvasElement, status: HTMLElement, mapWidth: number, mapHeight: number) {
    this.status = status
    this.stage = new Stage(canvas, mapWidth, mapHeight)
  }

  mountTerrain(world: WorldSnapshot) {
    const root = document.querySelector<HTMLElement>('#minimap')
    const map = document.querySelector<HTMLCanvasElement>('#minimap-map')
    const marks = document.querySelector<HTMLCanvasElement>('#minimap-marks')
    if (world.coast.length > 0) {
      this.stage.scene.add(buildIsland(world))
      if (root && map && marks) {
        this.minimap = new Minimap(root, map, marks, world, (x, z) => this.focus(x, z))
      }
      void loadProps(world).then((props) => this.stage.scene.add(props))
      return
    }
    if (root) root.hidden = true
    this.stage.scene.add(buildTerrain(world))
  }

  focus(x: number, z: number) {
    this.stage.focus(x, z)
  }

  setPanAxis(x: number, z: number) {
    this.stage.setPanAxis(x, z)
  }

  update(dt: number) {
    this.stage.update(dt)
  }

  panByPixels(fromX: number, fromY: number, toX: number, toY: number) {
    this.stage.panByPixels(fromX, fromY, toX, toY)
  }

  setZoomCursor(clientX: number, clientY: number) {
    this.stage.setZoomCursor(clientX, clientY)
  }

  zoomAt(deltaY: number, clientX: number, clientY: number) {
    this.stage.zoomAt(deltaY, clientX, clientY)
  }

  setHovered(ids: readonly number[]) {
    this.hoveredIds = [...ids]
  }

  setBoxPreview(active: boolean) {
    this.boxPreview = active
  }

  unitsInRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    units: readonly UnitSnapshot[],
    ownerId: number | null,
  ): number[] {
    const left = Math.min(x0, x1)
    const right = Math.max(x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    const hits: number[] = []
    for (const unit of units) {
      if (unit.ownerId !== ownerId) continue
      const center = this.stage.project(unit.x, unit.z)
      const mesh = this.units.get(unit.id)
      const span = mesh ? unitSpan(mesh) : 0.7
      const edge = this.stage.project(unit.x + span / 2, unit.z)
      const radius = Math.max(6, Math.hypot(edge.x - center.x, edge.y - center.y))
      if (circleHitsRect(center.x, center.y, radius, left, top, right, bottom)) hits.push(unit.id)
    }
    return hits
  }

  pickUnit(clientX: number, clientY: number): number | null {
    return this.stage.pickUnit([...this.units.values()], clientX, clientY)
  }

  pickTile(clientX: number, clientY: number): TileCoord | null {
    return this.stage.pickTile(clientX, clientY)
  }

  render(units: readonly UnitSnapshot[], selected: readonly UnitSnapshot[]) {
    const selectedIds = new Set(selected.map((unit) => unit.id))
    for (const unit of units) {
      let group = this.units.get(unit.id)
      if (!group) {
        group = createUnitMesh(unit)
        this.units.set(unit.id, group)
        this.stage.scene.add(group)
      }
      syncUnitMesh(group, unit, selectedIds.has(unit.id))
    }

    const showSelection = !this.boxPreview
    this.placeRings(this.selectionRings, this.stage.selection, showSelection ? selected : [])
    const goals = showSelection ? selected.filter((unit) => unit.goal !== null) : []
    this.placeOrders(goals)

    if (selected.length === 1) {
      const unit = selected[0]
      const moving = unit.goal ? ' · moving' : ''
      const label = UNIT_TYPES[unit.typeId].label
      this.status.textContent = `${label} ${unit.id} · tile ${unit.tileX},${unit.tileY}${moving}`
    } else if (selected.length > 1) {
      this.status.textContent = `${selected.length} selected`
    } else {
      this.status.textContent = 'No unit selected'
    }

    const hovered = this.hoveredIds.flatMap((id) => {
      if (!this.boxPreview && selectedIds.has(id)) return []
      const unit = units.find((candidate) => candidate.id === id)
      return unit ? [unit] : []
    })
    this.placeRings(this.hoverRings, this.stage.hover, hovered)

    this.minimap?.draw(units, selectedIds, this.stage.groundViewport())
    this.stage.draw()
  }

  private placeRings(pool: Mesh[], source: Mesh, units: readonly UnitSnapshot[]) {
    source.visible = false
    const rings = growRings(pool, source, units.length, this.stage.scene)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      const unit = units[i]
      if (!unit) {
        ring.visible = false
        continue
      }
      ring.visible = true
      placeRing(ring, unit, this.units.get(unit.id))
    }
  }

  private placeOrders(units: readonly UnitSnapshot[]) {
    this.stage.orderMark.visible = false
    const rings = growRings(this.orderRings, this.stage.orderMark, units.length, this.stage.scene)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      const goal = units[i]?.goal
      if (!goal) {
        ring.visible = false
        continue
      }
      ring.visible = true
      ring.scale.set(1, 1, 1)
      ring.position.set(goal.x + 0.5, TILE_TOP + 0.06, goal.y + 0.5)
    }
  }
}

function growRings(pool: Mesh[], source: Mesh, count: number, scene: { add(mesh: Mesh): void }): Mesh[] {
  while (pool.length < count) {
    const mesh = source.clone()
    mesh.visible = false
    scene.add(mesh)
    pool.push(mesh)
  }
  return pool
}

function circleHitsRect(
  cx: number,
  cy: number,
  radius: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const nearestX = Math.min(right, Math.max(left, cx))
  const nearestY = Math.min(bottom, Math.max(top, cy))
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy <= radius * radius
}

function placeRing(ring: Mesh, unit: UnitSnapshot, mesh: Group | undefined) {
  const span = mesh ? unitSpan(mesh) : 0.7
  ring.scale.set(span / 0.72, span / 0.72, 1)
  ring.position.set(unit.x, TILE_TOP + 0.06, unit.z)
}
