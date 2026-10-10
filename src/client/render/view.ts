import { Group, Mesh } from 'three'
import type { UnitSnapshot, WorldSnapshot } from '../../shared/protocol.ts'
import { UNIT_TYPES } from '../../shared/unit-types.ts'
import type { TileCoord } from '../../shared/tiles.ts'
import { Stage } from './stage.ts'
import { TILE_TOP, buildTerrain } from './terrain.ts'
import { createUnitMesh, syncUnitMesh, unitSpan } from './units/vehicle.ts'

export class GameView {
  private readonly stage: Stage
  private readonly status: HTMLElement
  private readonly units = new Map<number, Group>()
  private hoveredId: number | null = null

  constructor(canvas: HTMLCanvasElement, status: HTMLElement, mapWidth: number, mapHeight: number) {
    this.status = status
    this.stage = new Stage(canvas, mapWidth, mapHeight)
  }

  mountTerrain(world: WorldSnapshot) {
    this.stage.scene.add(buildTerrain(world))
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

  setHovered(unitId: number | null) {
    this.hoveredId = unitId
  }

  pickUnit(clientX: number, clientY: number): number | null {
    return this.stage.pickUnit([...this.units.values()], clientX, clientY)
  }

  pickTile(clientX: number, clientY: number): TileCoord | null {
    return this.stage.pickTile(clientX, clientY)
  }

  render(units: readonly UnitSnapshot[], selected: UnitSnapshot | null) {
    for (const unit of units) {
      let group = this.units.get(unit.id)
      if (!group) {
        group = createUnitMesh(unit)
        this.units.set(unit.id, group)
        this.stage.scene.add(group)
      }
      syncUnitMesh(group, unit, selected?.id === unit.id)
    }

    this.stage.selection.visible = selected !== null
    if (selected) {
      placeRing(this.stage.selection, selected, this.units.get(selected.id))
      this.stage.orderMark.visible = selected.goal !== null
      if (selected.goal) {
        this.stage.orderMark.position.set(
          selected.goal.x + 0.5,
          TILE_TOP + 0.02,
          selected.goal.y + 0.5,
        )
      }
      const moving = selected.goal ? ' · moving' : ''
      const label = UNIT_TYPES[selected.typeId].label
      this.status.textContent = `${label} ${selected.id} · tile ${selected.tileX},${selected.tileY}${moving}`
    } else {
      this.stage.orderMark.visible = false
      this.status.textContent = 'No unit selected'
    }

    const hovered =
      this.hoveredId !== null && this.hoveredId !== selected?.id
        ? units.find((unit) => unit.id === this.hoveredId)
        : undefined
    this.stage.hover.visible = hovered !== undefined
    if (hovered) placeRing(this.stage.hover, hovered, this.units.get(hovered.id))

    this.stage.draw()
  }
}

function placeRing(ring: Mesh, unit: UnitSnapshot, mesh: Group | undefined) {
  const span = mesh ? unitSpan(mesh) : 0.7
  ring.scale.set(span / 0.72, span / 0.72, 1)
  ring.position.set(unit.x, TILE_TOP + 0.02, unit.z)
}
