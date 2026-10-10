import { Group } from 'three'
import type { World } from '../game/world.ts'
import { type Map as Field, type TileCoord } from '../map/map.ts'
import { UNIT_TYPES } from '../units/catalog.ts'
import type { Unit } from '../units/unit.ts'
import { Stage } from './stage.ts'
import { TILE_TOP, buildTerrain } from './terrain.ts'
import { createUnitMesh, syncUnitMesh, unitSpan } from './units/vehicle.ts'

export class GameView {
  private readonly stage: Stage
  private readonly status: HTMLElement
  private readonly units = new Map<number, Group>()

  constructor(canvas: HTMLCanvasElement, status: HTMLElement, mapWidth: number, mapHeight: number) {
    this.status = status
    this.stage = new Stage(canvas, mapWidth, mapHeight)
  }

  mountTerrain(map: Field) {
    this.stage.scene.add(buildTerrain(map))
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

  zoomAt(deltaY: number) {
    this.stage.zoomAt(deltaY)
  }

  pickUnit(clientX: number, clientY: number): number | null {
    return this.stage.pickUnit([...this.units.values()], clientX, clientY)
  }

  pickTile(clientX: number, clientY: number): TileCoord | null {
    return this.stage.pickTile(clientX, clientY)
  }

  render(world: World, selected: Unit | null) {
    for (const unit of world.units) {
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
      const mesh = this.units.get(selected.id)
      const span = mesh ? unitSpan(mesh) : 0.7
      this.stage.selection.scale.set(span / 0.72, span / 0.72, 1)
      this.stage.selection.position.set(selected.pos.x, TILE_TOP + 0.02, selected.pos.z)
      const dest = selected.path[selected.path.length - 1]
      this.stage.orderMark.visible = dest !== undefined
      if (dest) this.stage.orderMark.position.set(dest.x + 0.5, TILE_TOP + 0.02, dest.y + 0.5)
      const moving = selected.path.length > 0 ? ' · moving' : ''
      const label = UNIT_TYPES[selected.typeId].label
      this.status.textContent = `${label} ${selected.id} · tile ${selected.tile.x},${selected.tile.y}${moving}`
    } else {
      this.stage.orderMark.visible = false
      this.status.textContent = 'No unit selected'
    }

    this.stage.draw()
  }
}
