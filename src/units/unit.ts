import { tileCenter, type TileCoord } from '../map/map.ts'
import type { PathFinder } from '../path/pathfinder.ts'
import type { UnitType, UnitTypeId } from './types.ts'

export class Unit {
  id: number
  typeId: UnitTypeId
  pos: { x: number; z: number }
  tile: TileCoord
  facing: number
  health: number
  path: TileCoord[] = []

  constructor(id: number, type: UnitType, tile: TileCoord, facing: number) {
    this.id = id
    this.typeId = type.id
    this.pos = tileCenter(tile)
    this.tile = { x: tile.x, y: tile.y }
    this.facing = facing
    this.health = type.maxHealth
  }

  orderMove(tile: TileCoord, paths: PathFinder) {
    const path = paths.findPath(this.tile, tile, this.id)
    if (path === null) return
    this.path = path
  }
}
