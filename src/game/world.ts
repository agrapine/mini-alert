import type { Map, TileCoord } from '../map/map.ts'
import { PathFinder } from '../path/pathfinder.ts'
import { stepUnit } from '../sim/movement.ts'
import { UNIT_TYPES } from '../units/catalog.ts'
import { Unit } from '../units/unit.ts'
import type { UnitTypeId } from '../units/types.ts'

export class World {
  readonly map: Map
  readonly pathfinder: PathFinder
  readonly units: Unit[] = []
  private nextId = 1

  constructor(map: Map) {
    this.map = map
    this.pathfinder = new PathFinder(map)
  }

  spawn(typeId: UnitTypeId, tile: TileCoord, facing = 0): Unit {
    const type = UNIT_TYPES[typeId]
    if (!this.pathfinder.isWalkable(tile.x, tile.y, -1)) {
      throw new Error(`cannot spawn on ${tile.x},${tile.y}`)
    }
    const unit = new Unit(this.nextId++, type, tile, facing)
    this.units.push(unit)
    this.pathfinder.setOccupant(tile.x, tile.y, unit.id)
    return unit
  }

  tick(dt: number) {
    for (const unit of this.units) {
      stepUnit(unit, dt, UNIT_TYPES[unit.typeId], this.pathfinder, this.units)
    }
  }
}
