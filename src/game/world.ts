import { createSkirmishMap, type GridMap, type TileCoord } from '../map/grid.ts'
import { findPath } from '../path/astar.ts'
import { stepUnit } from '../sim/movement.ts'
import { UNIT_TYPES, type UnitTypeId } from '../units/types.ts'
import { createUnit, type Unit } from '../units/unit.ts'

export class World {
  readonly map: GridMap
  readonly units: Unit[] = []
  selectedId: number | null = null
  private nextId = 1

  constructor(map: GridMap) {
    this.map = map
  }

  spawn(typeId: UnitTypeId, tile: TileCoord, facing = 0): Unit {
    const type = UNIT_TYPES[typeId]
    if (!this.map.isWalkable(tile.x, tile.y, -1)) {
      throw new Error(`cannot spawn on ${tile.x},${tile.y}`)
    }
    const unit = createUnit(this.nextId++, type, tile, facing)
    this.units.push(unit)
    this.map.setOccupant(tile.x, tile.y, unit.id)
    return unit
  }

  select(id: number | null) {
    this.selectedId = id
    for (const unit of this.units) unit.selected = unit.id === id
  }

  selected(): Unit | null {
    return this.units.find((unit) => unit.id === this.selectedId) ?? null
  }

  tick(dt: number) {
    for (const unit of this.units) {
      stepUnit(unit, this.map, dt, UNIT_TYPES[unit.typeId])
    }
  }

  orderMove(tile: TileCoord) {
    const unit = this.selected()
    if (!unit) return
    const path = findPath(this.map, unit.tile, tile, unit.id)
    if (path === null) return
    unit.path = path
  }
}

export function createWorld(): World {
  const world = new World(createSkirmishMap())
  const player = world.spawn('tank', { x: 3, y: 12 }, Math.PI / 2)
  world.spawn('tank', { x: 11, y: 8 }, -Math.PI / 2)
  world.select(player.id)
  return world
}
